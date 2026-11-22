'use strict';
const { navigationButton, linkButton, goliathNavigation, EMOJIS, emojiLabel } = require('../../../core/guild/goliathNavigation');

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const guildManager = require('../../../core/guild/guildManager');
const security = require('../../../core/security/protection/core');
const { buildRolePicker, parseRolePickerId } = require('../../../core/ui/panelNavigation');
const emojiPayload = require('../../utilityStudio/emojis/emojiPayload');
const roleSelector = require('./roleSelector');
const healthService = require('./roleSelectorHealth');
const { withDeploymentLock } = require('./roleSelectorLocks');

const { createHash } = require('node:crypto');
const optionToken = (id, groupId, deploymentId) => createHash('sha256').update(JSON.stringify([id, groupId, deploymentId])).digest('hex').slice(0, 32);
const sessions = new Map();
const row = (...items) => new ActionRowBuilder().addComponents(...items.filter(Boolean));
const button = (id, label, style = ButtonStyle.Secondary, disabled = false) => navigationButton(id, label, style, disabled);

const cleanId = (value) => {
  const id = String(value || '').replace(/[^0-9]/g, '');
  return /^\d{15,25}$/.test(id) ? id : null;
};
const sessionKey = (i) => `${i.guildId}:${i.user.id}`;
const actorName = (i) => i.member?.displayName || i.user?.username || 'Unknown User';
const safePart = (value) => String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
const customId = (...parts) => parts.filter((part) => part !== null && part !== undefined && part !== '').join(':').slice(0, 100);

function state(i) {
  const key = sessionKey(i);
  const value = sessions.get(key) || { statsGroupId: null, statsOptionId: null, statsPage: 0 };
  sessions.set(key, value);
  return value;
}

async function respond(i, payload) {
  if (i.isModalSubmit?.()) return i.reply({ ...payload, flags: 64 });
  if (i.deferred || i.replied) return i.editReply(payload);
  return i.update(payload);
}

function nav(back = 'admin:roleSelector', settingsDisabled = false) {
  const navigation = goliathNavigation(back, 'admin:roleSelector:settings');
  if (settingsDisabled) navigation.components[1].setDisabled(true);
  return navigation;
}

function rootNav() { return nav('admin:studio:roleStudio'); }

function groups(guildId) { return roleSelector.listGroups(guildId); }
function customGroups(guildId) { return groups(guildId).filter((g) => !g.builtIn); }

async function resolvePayload(guild, payload) {
  return emojiPayload.resolveMessagePayload(guild.client, guild.id, payload, 'roleSelector');
}

function groupMenu(guildId, selected = null, menuId = 'admin:roleSelector:groupSelect', multi = false, selectedIds = []) {
  const list = groups(guildId).slice(0, 25);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(menuId)
    .setPlaceholder(multi ? 'Choose groups for this panel' : 'Choose a group')
    .setMinValues(multi ? 0 : 1)
    .setMaxValues(multi ? Math.max(1, list.length) : 1);
  if (!list.length) return row(menu.setDisabled(true).addOptions({ label: 'No groups available', value: '__none__' }));
  menu.addOptions(list.map((g) => ({
    label: `${g.emoji || EMOJIS.ROLE_TAG} ${g.name}`.slice(0, 100),
    value: g.id,
    description: (g.builtIn ? 'Built-in group · protected' : `${g.selectionMode === 'multiple' ? 'Multiple choices' : 'Single choice'} · ${(g.options || []).length} options`).slice(0, 100),
    default: multi ? selectedIds.includes(g.id) : g.id === selected,
  })));
  return row(menu);
}

function memberCategoryMenu(guild, allowedIds = null, selected = null, menuId = 'roleSelector:switchGroup') {
  const allowed = Array.isArray(allowedIds) ? new Set(allowedIds) : null;
  const list = groups(guild.id).filter((g) => roleSelector.isGroupMemberUsable(g) && (!allowed || allowed.has(g.id))).slice(0, 25);
  const current = list.find((g) => g.id === selected);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(menuId)
    .setPlaceholder(current ? `Current: ${current.name} · choose or switch`.slice(0, 150) : 'Choose a category')
    .setMinValues(1)
    .setMaxValues(1);
  if (!list.length) return row(menu.setDisabled(true).addOptions({ label: 'No selectors available', value: '__none__' }));
  menu.addOptions(list.map((g) => ({
    label: `${g.emoji || EMOJIS.ROLE_TAG} ${g.name}`.slice(0, 100),
    value: g.id,
    description: (g.description || 'Choose your roles').slice(0, 100),
  })));
  return row(menu);
}

function memberDisabledPayload() {
  return {
    embeds: [new EmbedBuilder().setColor(0x747F8D).setTitle(emojiLabel('USER_ROLES', 'Role Selector')).setDescription('Role Selector is currently unavailable.')],
    components: [],
  };
}

function normalizeDeployment(raw, fallbackId = null) {
  const id = safePart(raw?.id || fallbackId) || `p${Date.now().toString(36)}`;
  const optionIdsByGroup = {};
  if (raw?.optionIdsByGroup && typeof raw.optionIdsByGroup === 'object') {
    for (const [groupId, ids] of Object.entries(raw.optionIdsByGroup)) {
      if (Array.isArray(ids)) optionIdsByGroup[groupId] = [...new Set(ids.map(String))].slice(0, 25);
    }
  }
  return {
    id,
    channelId: cleanId(raw?.channelId),
    messageId: cleanId(raw?.messageId),
    groupIds: Array.isArray(raw?.groupIds) ? [...new Set(raw.groupIds.map(String))].slice(0, 25) : [],
    optionIdsByGroup,
    status: raw?.status === 'retired' ? 'retired' : 'active',
    createdAt: raw?.createdAt || new Date().toISOString(),
  };
}

function groupsFromSection(section) {
  return (section?.groupOrder || Object.keys(section?.groups || {})).filter((id) => section?.groups?.[id]);
}

function deploymentList(section) {
  let list = Array.isArray(section?.deployments) ? section.deployments.map((d) => normalizeDeployment(d)) : [];
  if (!list.length && section?.deployment?.channelId) {
    list = [normalizeDeployment({
      id: 'legacy',
      channelId: section.deployment.channelId,
      messageId: section.deployment.messageId,
      groupIds: groupsFromSection(section),
      status: 'active',
    })];
  }
  return list;
}

function saveDeployments(guildId, list, meta = {}) {
  return roleSelector.updateSection(guildId, (current) => ({
    ...current,
    deployments: list.map((d) => normalizeDeployment(d)),
    deployment: { channelId: null, messageId: null },
  }), meta);
}

function deploymentById(guildId, id) {
  return deploymentList(roleSelector.getSection(guildId)).find((d) => d.id === id) || null;
}

function deploymentAllowedGroups(guildId, deploymentId) {
  if (!deploymentId || deploymentId === 'global') return null;
  const deployment = deploymentById(guildId, deploymentId);
  if (!deployment || deployment.status !== 'active') throw new Error('This panel is no longer active. Reopen Role Selector.');
  return deployment.groupIds;
}

function optionFilterFor(deployment, groupId) {
  const value = deployment?.optionIdsByGroup?.[groupId];
  return Array.isArray(value) ? new Set(value.map(String)) : null;
}

function memberLauncherPayload(guild, allowedIds = null, deploymentId = null) {
  if (!guildManager.isModuleEnabled(guild.id, roleSelector.MODULE)) return memberDisabledPayload();
  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle(emojiLabel('USER_ROLES', 'Choose Your Roles')).setDescription('Choose a category below. Each category manages only its own roles, so changing one selection never removes roles from another category.')],
    components: [memberCategoryMenu(guild, allowedIds, null, deploymentId ? customId('roleSelector:openGroup', deploymentId) : 'roleSelector:openGroup')],
  };
}

function memberGroupPayload(guild, member, groupId, allowedIds = null, deploymentId = null, deployment = null) {
  roleSelector.assertModuleEnabled(guild.id);
  const group = roleSelector.getGroup(guild.id, groupId);
  if (!group || !roleSelector.isGroupMemberUsable(group) || (Array.isArray(allowedIds) && !allowedIds.includes(group.id))) throw new Error('That selector is unavailable on this panel.');

  const components = [memberCategoryMenu(guild, allowedIds, group.id, deploymentId ? customId('roleSelector:switchGroup', deploymentId) : 'roleSelector:switchGroup')];
  const embed = new EmbedBuilder().setColor(0x5865F2).setTitle(`${group.emoji || EMOJIS.ROLE_TAG} ${group.name}`).setDescription([
    group.description || 'Choose your role.',
    group.selectionMode === 'multiple' ? 'Select every option that applies.' : 'Select one option.',
    group.allowRemove ? 'You may clear this category at any time.' : null,
  ].filter(Boolean).join('\n'));

  if (group.appearance) {
    const a = group.appearance;
    if (a.title) embed.setTitle(a.title);
    if (a.description) embed.setDescription(a.description);
    if (a.color) embed.setColor(parseInt(a.color.slice(1), 16));
    if (a.footer) embed.setFooter({ text: a.footer });
    if (a.image) embed.setImage(a.image);
    if (a.thumbnail) embed.setThumbnail(a.thumbnail);
  }
  if (group.type === 'colour') {
    const opts = group.palette.filter((x) => x.enabled).sort((a, b) => a.order - b.order).slice(0, 25).map((x) => ({
      label: x.label,
      value: x.hex,
      emoji: x.emoji || undefined,
      description: `${x.hex} · ${x.family}`.slice(0, 100),
      default: Boolean(group.managedRoles?.[x.hex]?.roleId && member?.roles?.cache?.has(group.managedRoles[x.hex].roleId)),
    }));
    if (opts.length) components.push(row(new StringSelectMenuBuilder().setCustomId(customId('roleSelector:colourChoose', deploymentId || 'global')).setPlaceholder('Choose a colour').setMinValues(1).setMaxValues(1).addOptions(opts)));
    components.push(row(
      group.customHexEnabled ? button(customId('roleSelector:customHex', deploymentId || 'global'), emojiLabel('DESIGN', 'Pick Your Own'), ButtonStyle.Primary) : null,
      group.allowRemove ? button(customId('roleSelector:clear', 'colours', deploymentId || 'global'), emojiLabel('ADMIN_PURGE', 'Clear Selection')) : null,
    ));
  } else {
    const filter = optionFilterFor(deployment, group.id);
    const opts = (group.options || []).filter((x) => x.enabled && (!filter || filter.has(x.id))).sort((a, b) => a.order - b.order).slice(0, 25).map((x) => ({
      label: x.label,
      value: x.id,
      emoji: x.emoji || undefined,
      description: x.description || undefined,
      default: Boolean(x.roleId && member?.roles?.cache?.has(x.roleId)),
    }));
    if (group.controlMode === 'buttons' && opts.length <= 15) {
      for (let offset = 0; offset < opts.length; offset += 5) {
        components.push(row(...opts.slice(offset, offset + 5).map(opt => {
          const id = customId('roleSelector:pick', optionToken(opt.value, group.id, deploymentId || 'global'));
          const control = new ButtonBuilder().setCustomId(id).setLabel(opt.label.slice(0,80)).setStyle(opt.default ? ButtonStyle.Success : ButtonStyle.Secondary);
          if (opt.emoji) control.setEmoji(opt.emoji);
          return control;
        })));
      }
    } else if (opts.length) components.push(row(new StringSelectMenuBuilder()
      .setCustomId(customId('roleSelector:choose', group.id, deploymentId || 'global'))
      .setPlaceholder(group.selectionMode === 'multiple' ? 'Choose one or more' : 'Choose one')
      .setMinValues(Math.min(opts.length, Math.max(group.selectionMode === 'single' ? 1 : 0, group.minSelections || 0)))
      .setMaxValues(Math.min(opts.length, group.maxSelections || (group.selectionMode === 'multiple' ? 25 : 1)))
      .addOptions(opts)));
    if (group.allowRemove && !group.minSelections) components.push(row(button(customId('roleSelector:clear', group.id, deploymentId || 'global'), emojiLabel('ADMIN_PURGE', 'Clear Selection'))));
  }
  return { embeds: [embed], components: components.filter((x) => x.components.length) };
}

async function freshMember(i) { return i.guild.members.fetch(i.user.id).catch(() => i.member); }

async function fetchDeployment(guild, deployment) {
  if (!deployment?.channelId) return { channel: null, message: null };
  const channel = guild.channels.cache.get(deployment.channelId) || await guild.channels.fetch(deployment.channelId).catch(() => null);
  const message = channel?.messages?.fetch && deployment.messageId ? await channel.messages.fetch(deployment.messageId).catch(() => null) : null;
  return { channel, message };
}

function owned(guild, message) {
  return Boolean(message && (!guild.client?.user?.id || message.author?.id === guild.client.user.id));
}

async function deploymentPayload(guild, deployment) {
  return resolvePayload(guild, memberLauncherPayload(guild, deployment.groupIds, deployment.id));
}

async function syncOneDeployment(guild, deployment) {
  if (deployment.status === 'retired') return { updated: false, reason: 'retired' };
  const { message } = await fetchDeployment(guild, deployment);
  if (!message || !owned(guild, message)) return { updated: false, reason: message ? 'not_owned' : 'missing' };
  await message.edit(await deploymentPayload(guild, deployment));
  return { updated: true, messageId: message.id, channelId: message.channel.id };
}

async function syncDeploymentState(guild, changedGroupId = null) {
  return withDeploymentLock(guild.id, async () => {
    const list = deploymentList(roleSelector.getSection(guild.id));
    const targets = changedGroupId ? list.filter((d) => d.groupIds.includes(changedGroupId)) : list;
    const results = [];
    for (const deployment of targets) results.push(await syncOneDeployment(guild, deployment).catch((error) => ({ updated: false, reason: error.message })));
    return { updated: results.some((r) => r.updated), results };
  });
}

async function retireDeployment(guild, deployment) {
  return withDeploymentLock(guild.id, async () => {
    const value = typeof deployment === 'string' ? deploymentById(guild.id, deployment) : deployment;
    if (!value) return false;
    const { message } = await fetchDeployment(guild, value);
    if (!owned(guild, message)) return false;
    try { await message.edit(memberDisabledPayload()); return true; } catch (error) { console.error('[RoleSelectorPanel] Unable to retire deployment', error); return false; }
  });
}

async function buildAdminPanel(guild, requestedBy = 'Unknown User') {
  const section = roleSelector.getSection(guild.id);
  const usage = await roleSelector.getUsage(guild);
  const enabled = guildManager.isModuleEnabled(guild.id, roleSelector.MODULE);
  const deployments = deploymentList(section);
  return {
    embeds: [new EmbedBuilder()
      .setColor(enabled ? 0x57F287 : 0x747F8D)
      .setTitle(emojiLabel('USER_ROLES', 'Role Selector Studio'))
      .setDescription([
        'Create and manage self-service roles for your community.', '',
        `**Role groups:** ${groups(guild.id).length}`,
        `**Selectable roles:** ${groups(guild.id).reduce((total, g) => total + (g.type === 'colour' ? (g.palette || []).filter(x => x.enabled).length : (g.options || []).filter(x => x.enabled).length), 0)}`,
        `**Published panels:** ${deployments.filter(d => d.status === 'active' && d.messageId).length}`,
        `**Participating members:** ${usage.totalUsing}/${usage.totalMembers}`, '',
        enabled ? emojiLabel('SUCCESS', 'Module enabled') : emojiLabel('ERROR', 'Module disabled'),
      ].join('\n'))
      .setFooter({ text: `Requested by ${requestedBy}` })
      .setTimestamp()],
    components: [
      row(
        button('admin:roleSelector:createGroup', emojiLabel('ADD', 'Create Selector'), ButtonStyle.Success),
        button('admin:roleSelector:groups', emojiLabel('CLIPBOARD', 'Manage Selectors'), ButtonStyle.Primary),
        button('admin:roleSelector:deployment', emojiLabel('DEPLOY', 'Published Panels'), ButtonStyle.Primary),
      ),
      row(
        button('admin:roleSelector:stats', emojiLabel('ANALYTICS', 'Analytics')),
        button('admin:roleSelector:style', emojiLabel('DESIGN', 'Role Styling')),
      ),
      rootNav(),
    ],
  };
}

async function buildSettingsPanel(guild) {
  const enabled = guildManager.isModuleEnabled(guild.id, roleSelector.MODULE);
  const health = await healthService.buildHealth(guild);
  const section = roleSelector.getSection(guild.id);
  const hasSuggestion = Boolean(section.style.detectedFormat);
  return {
    embeds: [new EmbedBuilder()
      .setColor(!enabled ? 0x747F8D : health.healthy ? 0x57F287 : 0xFAA61A)
      .setTitle(emojiLabel('SETTINGS', 'Role Selector · Settings'))
      .setDescription([
        '**Module Status**',
        enabled ? `Enabled ${EMOJIS.SUCCESS}` : `Disabled ${EMOJIS.ERROR}`,
        '',
        '**System Health**',
        health.healthy ? `Healthy ${EMOJIS.SUCCESS}` : `Needs attention ${EMOJIS.WARNING}`,
        '',
        '**Guild Role Style**',
        hasSuggestion ? `Detected: \`${section.style.detectedFormat}\`` : 'No guild role style has been scanned yet.',
        '',
        'Manage Role Selector status, diagnostics and automatic role styling.',
      ].join('\n'))],
    components: [
      row(
        button('admin:roleSelector:health', emojiLabel('WELCOME_DIAGNOSTICS', 'Health & Repair'), ButtonStyle.Primary),
        button('admin:roleSelector:scanStyle', emojiLabel('INVESTIGATE', 'Scan Guild Style'), ButtonStyle.Primary),
      ),
      row(
        button('admin:roleSelector:applyStyle', emojiLabel('SUCCESS', 'Apply Suggested Style'), hasSuggestion ? ButtonStyle.Success : ButtonStyle.Secondary, !hasSuggestion),
        button(enabled ? 'admin:roleSelector:disable' : 'admin:roleSelector:enable', enabled ? emojiLabel('PAUSE_PLAIN', 'Disable Role Selector') : emojiLabel('WELCOME_RUN', 'Enable Role Selector'), enabled ? ButtonStyle.Danger : ButtonStyle.Success),
      ),
      nav('admin:roleSelector', true),
    ],
  };
}

function buildGroupsPanel(guildId, selectedId = null) {
  const selected = selectedId ? roleSelector.getGroup(guildId, selectedId) : null;
  if (!selected) {
    return {
      embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle(emojiLabel('ROLE_TAG', 'Role Selector Studio · Selectors')).setDescription(`Create and manage self-role categories.\n\n${EMOJIS.ROLE_RAINBOW} **Colours** is the protected built-in group.`)],
      components: [groupMenu(guildId), row(button('admin:roleSelector:createGroup', emojiLabel('ADD', 'Create Selector'), ButtonStyle.Success)), nav()],
    };
  }
  if (selected.type === 'colour') return buildColourPanel(guildId, selected);
  const lines = (selected.options || []).map((x) => `${x.enabled ? EMOJIS.SUCCESS : EMOJIS.USER_LOCKED} ${x.emoji || '•'} **${x.label}** · Role: ${x.managed === false ? 'Existing role' : x.roleId ? 'Goliath-managed' : 'Auto-create'}`);
  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle(emojiLabel('ROLE_TAG', 'Role Selector Studio · Selectors')).setDescription([
      `${selected.emoji || EMOJIS.ROLE_TAG} **${selected.name}**`,
      selected.description || '`No description`', '',
      `**Type:** ${selected.selectionMode === 'multiple' ? 'Multiple choices' : 'Single choice'}`,
      `**Options:** ${(selected.options || []).length}`,
      `**Selection limits:** ${selected.minSelections}–${selected.maxSelections}`,
      `**Members can clear:** ${selected.allowRemove ? `Yes ${EMOJIS.SUCCESS}` : 'No'}`, '',
      lines.join('\n') || '`No options yet`',
    ].join('\n').slice(0, 4096))],
    components: [
      groupMenu(guildId, selected.id),
      row(
        button(customId('admin:roleSelector:addRoles', selected.id), emojiLabel('ADD', 'Add Existing Roles'), ButtonStyle.Success),
        button(customId('admin:roleSelector:options', selected.id), emojiLabel('EDIT', 'Edit Options'), ButtonStyle.Primary),
        button(customId('admin:roleSelector:toggleMode', selected.id), selected.selectionMode === 'multiple' ? emojiLabel('CHECKBOX', 'Multiple Choices') : emojiLabel('CHECKBOX', 'Single Choice'), ButtonStyle.Primary),
        button(customId('admin:roleSelector:toggleRemove', selected.id), selected.allowRemove ? emojiLabel('ADMIN_PURGE', 'Allow Clear: Yes') : emojiLabel('ADMIN_PURGE', 'Allow Clear: No')),
      ),
      row(button(customId('admin:roleSelector:limits', selected.id), emojiLabel('SETTINGS', 'Selection Limits'), ButtonStyle.Primary), button(customId('admin:roleSelector:deleteGroup', selected.id), emojiLabel('DELETE', 'Delete Selector'), ButtonStyle.Danger), button(customId('admin:roleSelector:dependencies', selected.id), emojiLabel('SETTINGS', 'Role Dependencies')), button(customId('admin:roleSelector:guide', selected.id), emojiLabel('ADD', 'Creation Guide'))),
      row(button(customId('admin:roleSelector:design', selected.id), emojiLabel('EDIT', 'Appearance')), button(customId('admin:roleSelector:media', selected.id), emojiLabel('EDIT', 'Images')), button(customId('admin:roleSelector:preview', selected.id), emojiLabel('PREVIEW', 'Preview')), button(customId('admin:roleSelector:controlMode', selected.id), selected.controlMode === 'buttons' ? 'Mode: Buttons' : 'Mode: Dropdown')),
      nav('admin:roleSelector:groups'),
    ],
  };
}

function buildColourPanel(guildId, group) {
  const palette = [...group.palette].sort((a, b) => a.order - b.order).slice(0, 25);
  const menu = new StringSelectMenuBuilder().setCustomId('admin:roleSelector:palette').setPlaceholder('Enabled preset colours').setMinValues(0).setMaxValues(Math.max(1, palette.length)).addOptions(palette.map((x) => ({
    label: x.label, value: x.id, emoji: x.emoji || undefined, description: x.hex, default: x.enabled,
  })));
  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle(emojiLabel('ROLE_RAINBOW', 'Role Selector Studio · Selectors · Colours')).setDescription([
      `**Built-in group ${EMOJIS.LOCKDOWN}**`, 'Choose preset colours and custom HEX availability.', '',
      ...palette.map((x) => `${x.enabled ? EMOJIS.SUCCESS : EMOJIS.USER_LOCKED} ${x.emoji} **${x.label}** · \`${x.hex}\``),
    ].join('\n'))],
    components: [
      groupMenu(guildId, group.id),
      row(menu),
      row(
        button('admin:roleSelector:toggleHex', group.customHexEnabled ? emojiLabel('DESIGN', 'Custom HEX: On') : emojiLabel('DESIGN', 'Custom HEX: Off')),
        button('admin:roleSelector:colourClearToggle', group.allowRemove ? emojiLabel('ADMIN_PURGE', 'Allow Clear: Yes') : emojiLabel('ADMIN_PURGE', 'Allow Clear: No')),
      ),
      nav(),
    ],
  };
}

function buildAppearance(guild, rolePage = 0) {
  const section = roleSelector.getSection(guild.id);
  const preview = roleSelector.roleNameFor(section, 'Example Role');
  const anchor = section.style.anchorRoleId ? `<@&${section.style.anchorRoleId}>` : '`No anchor selected`';
  const placement = section.style.placement === 'above' ? 'Above' : 'Below';
  const rolePicker = buildRolePicker(guild, {
    customId: 'admin:roleSelector:anchor',
    placeholder: 'Choose where Role Selector roles should sit',
    selectedIds: section.style.anchorRoleId ? [section.style.anchorRoleId] : [],
    minValues: 0,
    maxValues: 1,
    page: rolePage,
  });
  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle(emojiLabel('DESIGN', 'Role Selector · Appearance')).setDescription([
      '**Role Preview**',
      `\`${preview}\``,
      '',
      '**Where roles are placed**',
      `${placement} ${anchor}`,
      `Keep selector roles together: **${section.style.keepGrouped ? `On ${EMOJIS.SUCCESS}` : 'Off'}**`,
      '',
      'Choose where Role Selector roles should sit, then adjust the role style or divider if needed.',
    ].join('\n'))],
    components: [
      ...rolePicker.rows,
      row(
        button('admin:roleSelector:createDivider', emojiLabel('ADD', 'Create Divider'), ButtonStyle.Success),
        button('admin:roleSelector:styleOpen', emojiLabel('EDIT', 'Edit Role Style'), ButtonStyle.Primary),
      ),
      row(
        button('admin:roleSelector:togglePlacement', section.style.placement === 'above' ? emojiLabel('ROLE_UP', 'Place Above') : emojiLabel('ROLE_DOWN', 'Place Below'), ButtonStyle.Primary),
        button('admin:roleSelector:toggleGrouped', section.style.keepGrouped ? emojiLabel('ROLE_MAGNET', 'Keep Together: On') : emojiLabel('ROLE_MAGNET', 'Keep Together: Off'), ButtonStyle.Primary),
      ),
      nav(),
    ],
  };
}

function deploymentSelect(guildId, selectedId = null) {
  const list = deploymentList(roleSelector.getSection(guildId)).slice(0, 25);
  const menu = new StringSelectMenuBuilder().setCustomId('admin:roleSelector:deploymentSelect').setPlaceholder(list.length ? 'Choose a deployed panel' : 'No deployments yet').setMinValues(1).setMaxValues(1);
  if (!list.length) return row(menu.setDisabled(true).addOptions({ label: 'No deployments yet', value: '__none__' }));
  menu.addOptions(list.map((d, index) => ({
    label: `Panel ${index + 1}${d.status === 'retired' ? ' · Retired' : ''}`.slice(0, 100),
    value: d.id,
    description: `${d.channelId ? 'Channel selected' : 'No channel'} · ${d.groupIds.length} group(s)`.slice(0, 100),
    default: d.id === selectedId,
  })));
  return row(menu);
}

async function buildDeploymentsPanel(i, selectedId = null) {
  const list = deploymentList(roleSelector.getSection(i.guildId));
  const selected = selectedId ? list.find((d) => d.id === selectedId) : null;
  if (!selected) {
    const lines = await Promise.all(list.map(async (d, index) => {
      const { message } = await fetchDeployment(i.guild, d);
      const names = d.groupIds.map((id) => roleSelector.getGroup(i.guildId, id)?.name).filter(Boolean);
      return `**${index + 1}.** ${d.channelId ? `<#${d.channelId}>` : '`No channel`'} · ${d.status === 'retired' ? `Retired ${EMOJIS.BULK}` : message ? `Deployed ${EMOJIS.SUCCESS}` : `Not deployed ${EMOJIS.WARNING}`}\n${names.length ? names.join(' · ') : 'No groups selected'}`;
    }));
    return {
      content: null,
      embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle(emojiLabel('WELCOME_LOCATION', 'Role Selector · Deployments')).setDescription([
        'Deploy member Role Selector panels and public stats panels from one place. The same group can appear on multiple member panels.', '',
        lines.join('\n\n') || '`No deployments yet`',
      ].join('\n').slice(0, 4096))],
      components: [
        deploymentSelect(i.guildId),
        row(
          button('admin:roleSelector:deploymentCreate', emojiLabel('ADD', 'Create Deployment'), ButtonStyle.Success),
          button('admin:roleSelector:statsPublic', emojiLabel('ANALYTICS', 'Deploy Stats'), ButtonStyle.Success),
        ),
        nav(),
      ],
    };
  }

  const { message } = await fetchDeployment(i.guild, selected);
  const names = selected.groupIds.map((id) => roleSelector.getGroup(i.guildId, id)?.name).filter(Boolean);
  const jump = message ? `https://discord.com/channels/${i.guildId}/${message.channel.id}/${message.id}` : null;
  const channelName = selected.channelId ? i.guild.channels.cache.get(selected.channelId)?.name : null;
  const channelMenu = new ChannelSelectMenuBuilder()
    .setCustomId(customId('admin:roleSelector:deploymentChannel', selected.id))
    .setPlaceholder(channelName ? `Current: #${channelName} · choose to change` : 'Choose deployment channel')
    .setMinValues(1).setMaxValues(1)
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);

  return {
    content: null,
    embeds: [new EmbedBuilder().setColor(selected.status === 'retired' ? 0x747F8D : 0x5865F2).setTitle(emojiLabel('WELCOME_LOCATION', 'Role Selector · Manage Deployment')).setDescription([
      `**Channel:** ${selected.channelId ? `<#${selected.channelId}>` : '`Not selected`'}`,
      `**Message:** ${message ? `Deployed ${EMOJIS.SUCCESS}` : selected.status === 'retired' ? `Retired ${EMOJIS.BULK}` : 'Not deployed'}`,
      `**Groups:** ${names.length ? names.join(' · ') : '`None selected`'}`, '',
      'Choose the destination and open **Groups & Roles** to control exactly what this panel exposes.',
    ].join('\n'))],
    components: [
      deploymentSelect(i.guildId, selected.id),
      row(channelMenu),
      row(
        button(customId('admin:roleSelector:deploymentContent', selected.id), emojiLabel('ROLE_TAG', 'Groups & Roles'), ButtonStyle.Primary),
        button(customId('admin:roleSelector:deploy', selected.id), message ? emojiLabel('REFRESH', 'Update Panel') : emojiLabel('USER_INVITES', 'Deploy Panel'), ButtonStyle.Success, !selected.channelId || !selected.groupIds.length),
        jump ? linkButton(emojiLabel('ROLE_UP_RIGHT', 'Jump to Panel'), jump) : null,
      ),
      row(button(customId('admin:roleSelector:deploymentDelete', selected.id), emojiLabel('DELETE', 'Delete'), ButtonStyle.Danger)),
      nav('admin:roleSelector:deployment'),
    ],
  };
}

function deploymentGroupFilterMenu(guildId, deployment, selectedGroupId = null) {
  const included = deployment.groupIds.map((id) => roleSelector.getGroup(guildId, id)).filter((g) => g && g.type !== 'colour' && (g.options || []).some((x) => x.enabled)).slice(0, 25);
  const menu = new StringSelectMenuBuilder().setCustomId(customId('admin:roleSelector:deploymentContentGroup', deployment.id)).setPlaceholder('Choose a group to limit roles').setMinValues(1).setMaxValues(1);
  if (!included.length) return row(menu.setDisabled(true).addOptions({ label: 'No role groups selected', value: '__none__' }));
  menu.addOptions(included.map((g) => ({
    label: `${g.emoji || EMOJIS.ROLE_TAG} ${g.name}`.slice(0, 100),
    value: g.id,
    description: Array.isArray(deployment.optionIdsByGroup?.[g.id]) ? `${deployment.optionIdsByGroup[g.id].length} selected role(s)` : 'All roles included',
    default: g.id === selectedGroupId,
  })));
  return row(menu);
}

function deploymentOptionMenu(guildId, deployment, groupId) {
  const group = roleSelector.getGroup(guildId, groupId);
  const options = (group?.options || []).filter((x) => x.enabled).slice(0, 25);
  const selected = deployment.optionIdsByGroup?.[groupId];
  const selectedSet = Array.isArray(selected) ? new Set(selected) : new Set(options.map((x) => x.id));
  const menu = new StringSelectMenuBuilder().setCustomId(customId('admin:roleSelector:deploymentOptions', deployment.id, groupId)).setPlaceholder('Choose roles shown on this panel').setMinValues(0).setMaxValues(Math.max(1, options.length));
  if (!options.length) return row(menu.setDisabled(true).addOptions({ label: 'No role options available', value: '__none__' }));
  menu.addOptions(options.map((x) => ({
    label: `${x.emoji || '•'} ${x.label}`.slice(0, 100), value: x.id,
    description: (x.description || 'Role selector option').slice(0, 100), default: selectedSet.has(x.id),
  })));
  return row(menu);
}

async function buildDeploymentContentPanel(i, deploymentId, groupId = null) {
  const deployment = deploymentById(i.guildId, deploymentId);
  if (!deployment) throw new Error('Choose a deployment first.');
  if (groupId && !deployment.groupIds.includes(groupId)) groupId = null;
  const group = groupId ? roleSelector.getGroup(i.guildId, groupId) : null;
  const roleLimitText = Object.entries(deployment.optionIdsByGroup || {}).filter(([id]) => deployment.groupIds.includes(id)).map(([id, ids]) => {
    const g = roleSelector.getGroup(i.guildId, id);
    return g ? `• ${g.name}: ${ids.length} selected role(s)` : null;
  }).filter(Boolean);
  return {
    content: null,
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle(emojiLabel('ROLE_TAG', 'Role Selector · Deployment Content')).setDescription([
      'Select the groups shown on this panel. For a standard group, you can optionally limit the panel to specific role options.', '',
      `**Groups selected:** ${deployment.groupIds.length}`,
      roleLimitText.length ? `**Role filters:**\n${roleLimitText.join('\n')}` : '**Role filters:** All roles from each selected group',
      group ? `\nEditing roles for **${group.name}**.` : '',
    ].join('\n').slice(0, 4096))],
    components: [
      groupMenu(i.guildId, null, customId('admin:roleSelector:deploymentGroups', deployment.id), true, deployment.groupIds),
      deploymentGroupFilterMenu(i.guildId, deployment, groupId),
      groupId ? deploymentOptionMenu(i.guildId, deployment, groupId) : row(button('admin:roleSelector:deploymentContentHint', 'Select a group above to limit its roles', ButtonStyle.Secondary, true)),
      row(button(customId('admin:roleSelector:deploymentOptionsAll', deployment.id, groupId || 'none'), emojiLabel('UPDATE', 'Use All Roles for Group'), ButtonStyle.Secondary, !groupId)),
      nav(customId('admin:roleSelector:deploymentOpen', deployment.id)),
    ],
  };
}

async function deploySelected(i, deploymentId) {
  return withDeploymentLock(i.guildId, async () => {
    const list = deploymentList(roleSelector.getSection(i.guildId));
    const index = list.findIndex((d) => d.id === deploymentId);
    if (index < 0) throw new Error('Choose a deployment first.');
    const deployment = list[index];
    if (!deployment.channelId || !deployment.groupIds.length) throw new Error('Choose a channel and at least one group.');
    roleSelector.assertModuleEnabled(i.guildId);
    for (const groupId of deployment.groupIds) {
      const group = roleSelector.getGroup(i.guildId, groupId);
      if (!group || !roleSelector.isGroupMemberUsable(group)) throw new Error('Remove unavailable selectors from this deployment before publishing.');
      const filter = optionFilterFor(deployment, groupId);
      if (group.type !== 'colour' && filter && !group.options.some(o => o.enabled && filter.has(o.id))) throw new Error('Choose at least one enabled option for ' + group.name + '.');
    }
    const channel = i.guild.channels.cache.get(deployment.channelId) || await i.guild.channels.fetch(deployment.channelId).catch(() => null);
    if (!channel?.send) throw new Error('Choose a sendable text channel.');
    let message = deployment.messageId ? await channel.messages.fetch(deployment.messageId).catch(() => null) : null;
    if (message && !owned(i.guild, message)) message = null;
    message = message ? await message.edit(await deploymentPayload(i.guild, deployment)) : await channel.send(await deploymentPayload(i.guild, deployment));
    list[index] = { ...deployment, messageId: message.id, status: 'active' };
    saveDeployments(i.guildId, list, { actorId: i.user.id, action: 'role_selector_deploy' });
    return message;
  });
}

async function deleteSelectedDeployment(i, deploymentId) {
  return withDeploymentLock(i.guildId, async () => {
    const list = deploymentList(roleSelector.getSection(i.guildId));
    const index = list.findIndex((d) => d.id === deploymentId);
    if (index < 0) throw new Error('Choose a deployment first.');
    const deployment = list[index];
    const { message } = await fetchDeployment(i.guild, deployment);
    if (message) {
      if (!owned(i.guild, message)) throw new Error('Goliath will not delete a message it does not own.');
      await message.delete();
    }
    list.splice(index, 1);
    saveDeployments(i.guildId, list, { actorId: i.user.id, action: 'role_selector_deployment_delete' });
  });
}

function statsDeploymentRecord(section) {
  const value = section?.statsDeployment && typeof section.statsDeployment === 'object' ? section.statsDeployment : {};
  return { channelId: cleanId(value.channelId), messageId: cleanId(value.messageId) };
}

async function buildStats(guild) {
  const usage = await roleSelector.getUsage(guild);
  const rows = [];
  for (const group of usage.groups || []) for (const item of group.rows || []) rows.push({ ...item, groupId: group.id, groupName: group.name, groupEmoji: group.emoji || EMOJIS.ROLE_TAG });
  rows.sort((a, b) => Number(b.count || 0) - Number(a.count || 0));
  const total = rows.reduce((sum, item) => sum + Number(item.count || 0), 0);
  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle(emojiLabel('ANALYTICS', 'Role Selector · Stats')).setDescription([
      `**Members using selectors:** ${usage.totalUsing}/${usage.totalMembers}`,
      `**Total selections:** ${total}`, '', `**${EMOJIS.ROLE_TROPHY} Most Selected**`,
      rows.filter((x) => x.count).slice(0, 10).map((x, index) => `${index + 1}. ${x.groupEmoji} **${x.label}** — ${x.count} · ${x.groupName}`).join('\n') || '`No selections yet`',
    ].join('\n'))],
    components: [groupMenu(guild.id, null, 'admin:roleSelector:statsGroup'), nav('admin:roleSelector:deployment')],
  };
}

async function buildPublicStatsPayload(guild) {
  const usage = await roleSelector.getUsage(guild);
  const rows = [];
  for (const group of usage.groups || []) for (const item of group.rows || []) rows.push({ ...item, groupName: group.name, groupEmoji: group.emoji || EMOJIS.ROLE_TAG });
  rows.sort((a, b) => Number(b.count || 0) - Number(a.count || 0));
  return resolvePayload(guild, {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle(emojiLabel('ANALYTICS', 'Role Selector Leaderboard')).setDescription([
      `${EMOJIS.ROLE_MEMBERS} **Members using selectors:** ${usage.totalUsing}`,
      `${EMOJIS.RISK} **Total selections:** ${rows.reduce((sum, item) => sum + Number(item.count || 0), 0)}`, '',
      `**${EMOJIS.ROLE_TROPHY} Top Choices**`, rows.filter((x) => Number(x.count || 0) > 0).slice(0, 10).map((x, index) => `${index + 1}. ${x.groupEmoji} **${x.label}** — ${x.count}`).join('\n') || '`No selections yet`',
    ].join('\n'))], components: [],
  });
}

async function syncStatsDeploymentState(guild) {
  const deployment = statsDeploymentRecord(roleSelector.getSection(guild.id));
  const { message } = await fetchDeployment(guild, deployment);
  if (!message || !owned(guild, message)) return { updated: false };
  await message.edit(await buildPublicStatsPayload(guild));
  return { updated: true };
}

async function buildStatsDeploymentPanel(i) {
  const deployment = statsDeploymentRecord(roleSelector.getSection(i.guildId));
  const { message } = await fetchDeployment(i.guild, deployment);
  const channelName = deployment.channelId ? i.guild.channels.cache.get(deployment.channelId)?.name : null;
  const menu = new ChannelSelectMenuBuilder().setCustomId('admin:roleSelector:statsDeploymentChannel').setPlaceholder(channelName ? `Current: #${channelName} · choose to change` : 'Choose public stats channel').setMinValues(1).setMaxValues(1).setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
  const jump = message ? `https://discord.com/channels/${i.guildId}/${message.channel.id}/${message.id}` : null;
  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle(emojiLabel('ANALYTICS', 'Role Selector · Deploy Stats')).setDescription([
      `**Channel:** ${deployment.channelId ? `<#${deployment.channelId}>` : '`Not selected`'}`,
      `**Message:** ${message ? `Deployed ${EMOJIS.SUCCESS}` : 'Not deployed'}`, '',
      'Deploy a user-visible community leaderboard. Counts update in place; member names remain admin-only.',
    ].join('\n'))],
    components: [row(menu), row(button('admin:roleSelector:statsDeploy', message ? emojiLabel('REFRESH', 'Update Stats Panel') : emojiLabel('USER_INVITES', 'Deploy Stats Panel'), ButtonStyle.Success, !deployment.channelId), jump ? linkButton(emojiLabel('ROLE_UP_RIGHT', 'Jump to Panel'), jump) : null), nav('admin:roleSelector:deployment')],
  };
}

async function deployStats(i) {
  const deployment = statsDeploymentRecord(roleSelector.getSection(i.guildId));
  const channel = i.guild.channels.cache.get(deployment.channelId) || await i.guild.channels.fetch(deployment.channelId).catch(() => null);
  if (!channel?.send) throw new Error('Choose a sendable text channel.');
  let message = deployment.messageId ? await channel.messages.fetch(deployment.messageId).catch(() => null) : null;
  if (message && !owned(i.guild, message)) message = null;
  message = message ? await message.edit(await buildPublicStatsPayload(i.guild)) : await channel.send(await buildPublicStatsPayload(i.guild));
  roleSelector.updateSection(i.guildId, (current) => ({ ...current, statsDeployment: { channelId: channel.id, messageId: message.id } }), { actorId: i.user.id, action: 'role_selector_stats_deploy' });
  return message;
}

async function buildHealth(guild, result = null) {
  const health = result || await healthService.buildHealth(guild);
  const format = (x) => typeof x === 'string' ? x : x?.detail || x?.message || x?.code || JSON.stringify(x);
  return {
    embeds: [new EmbedBuilder().setColor(health.healthy ? 0x57F287 : 0xFAA61A).setTitle(emojiLabel('WELCOME_DIAGNOSTICS', 'Role Selector · Health / Repair')).setDescription([
      `**Overall Health:** ${health.healthy ? `Healthy ${EMOJIS.SUCCESS}` : `Needs Attention ${EMOJIS.WARNING}`}`,
      `**Acceptance:** ${health.acceptance?.ready ? `Ready ${EMOJIS.SUCCESS}` : `Not Ready ${EMOJIS.WARNING}`}`,
      `**Managed Roles:** ${health.managedRoleCount || 0}`, '',
      '**Issues**', (health.issues || []).length ? (health.issues || []).map((x) => `• ${format(x)}`).join('\n') : emojiLabel('HEALTHY', 'No issues'), '',
      '**Warnings**', (health.warnings || []).length ? (health.warnings || []).map((x) => `• ${format(x)}`).join('\n') : emojiLabel('HEALTHY', 'No warnings'),
    ].join('\n').slice(0, 4096))],
    components: [row(button('admin:roleSelector:healthCheck', emojiLabel('SEARCH', 'Run Check'), ButtonStyle.Primary), button('admin:roleSelector:healthRepair', emojiLabel('WELCOME_CUSTOM', 'Repair Safe Issues'), ButtonStyle.Success)), nav('admin:roleSelector:settings', true)],
  };
}

function createGroupModal() {
  return new ModalBuilder().setCustomId('admin:roleSelector:createGroupSubmit').setTitle('Create Role Selector Group').addComponents(
    row(new TextInputBuilder().setCustomId('name').setLabel('Group name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80)),
    row(new TextInputBuilder().setCustomId('emoji').setLabel('Emoji / icon').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100)),
    row(new TextInputBuilder().setCustomId('description').setLabel('Description').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(200)),
    row(new TextInputBuilder().setCustomId('mode').setLabel('Selection type: single or multiple').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(8).setValue('single')),
  );
}

function optionsModal(group) {
  return new ModalBuilder().setCustomId(customId('admin:roleSelector:optionsSubmit', group.id)).setTitle(`Options · ${group.name}`.slice(0, 45)).addComponents(
    row(new TextInputBuilder().setCustomId('options').setLabel('emoji | label | description | roleId').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(4000).setValue((group.options || []).map((x) => `${x.emoji || ''} | ${x.label} | ${x.description || ''} | ${x.managed === false ? x.roleId || '' : ''}`).join('\n'))),
  );
}

function styleModal(section) {
  return new ModalBuilder().setCustomId('admin:roleSelector:styleSubmit').setTitle('Edit Role Style').addComponents(
    row(new TextInputBuilder().setCustomId('format').setLabel('Role name format').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100).setValue(section.style.format || emojiLabel('USER_ROLES', '| {role}'))),
    row(new TextInputBuilder().setCustomId('icon').setLabel('Default icon / prefix').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100).setValue(section.style.icon || '')),
    row(new TextInputBuilder().setCustomId('separator').setLabel('Separator').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(20).setValue(section.style.separator || '|')),
  );
}

function dividerModal() {
  return new ModalBuilder().setCustomId('admin:roleSelector:createDividerSubmit').setTitle('Create Role Selector Divider').addComponents(
    row(new TextInputBuilder().setCustomId('name').setLabel('Divider role name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100).setValue(emojiLabel('USER_ROLES', '| ROLE SELECTOR'))),
  );
}

function hexModal(deploymentId = 'global') {
  return new ModalBuilder().setCustomId(customId('roleSelector:customHexSubmit', deploymentId)).setTitle('Pick Your Own Colour').addComponents(
    row(new TextInputBuilder().setCustomId('hex').setLabel('HEX colour').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(7).setPlaceholder('#1EA7FF')),
    row(new TextInputBuilder().setCustomId('label').setLabel('Colour name').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(60)),
  );
}

async function syncPanels(guild, changedGroupId = null) {
  await Promise.allSettled([syncDeploymentState(guild, changedGroupId), syncStatsDeploymentState(guild)]);
}

function queueAppearanceSync(guild) {
  void Promise.allSettled([
    roleSelector.syncManagedRoleHierarchy(guild),
    syncPanels(guild),
  ]).then((results) => {
    for (const result of results) {
      if (result.status === 'rejected') console.error('[RoleSelector] Deferred appearance sync failed:', result.reason);
    }
  });
}

function tail(id, prefix) {
  return id.startsWith(`${prefix}:`) ? id.slice(prefix.length + 1) : null;
}

function splitTail(id, prefix) {
  const value = tail(id, prefix);
  return value == null ? [] : value.split(':');
}

function buildCreationGuide(guildId, group) {
  const count = group.options.filter(o => o.enabled).length;
  const id = group.id;
  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle(emojiLabel('ADD', 'Selector Creation Guide')).setDescription([
      '**1. Configuration** — ' + group.name + ' · ' + group.selectionMode,
      '**2. Options** — ' + count + ' enabled options. Add existing roles or configure options.',
      '**3. Appearance** — Configure the embed and control style.',
      '**4. Preview** — Test without assigning roles.',
      '**5. Publishing** — Choose a deployment and its selector groups.'
    ].join('\n\n'))],
    components: [
      row(button(customId('admin:roleSelector:addRoles', id), emojiLabel('ADD', 'Add Roles'), ButtonStyle.Primary), button(customId('admin:roleSelector:groupOpen', id), emojiLabel('EDIT', 'Configure Options'))),
      row(button(customId('admin:roleSelector:design', id), emojiLabel('DESIGN', 'Appearance')), button(customId('admin:roleSelector:controlMode', id), group.controlMode === 'buttons' ? 'Mode: Buttons' : 'Mode: Dropdown')),
      row(button(customId('admin:roleSelector:preview', id), emojiLabel('PREVIEW', 'Preview'), ButtonStyle.Primary, !count), button('admin:roleSelector:deployment', 'Publishing', ButtonStyle.Success, !count)),
      nav('admin:roleSelector:groups')
    ]
  };
}

function buildInteractivePreview(i, group) {
  const preview = state(i).preview;
  const selected = new Set(preview.selected);
  const roleIds = new Set(group.options.filter(o => selected.has(o.id) && o.roleId).map(o => o.roleId));
  const payload = memberGroupPayload(i.guild, { roles: { cache: roleIds } }, group.id);
  // Replace every member control with an admin-only simulation control.
  const controls = payload.components.slice(1).map(r => {
    for (const c of r.components) {
      const original = c.data.custom_id;
      if (original.startsWith('roleSelector:pick:')) c.setCustomId('admin:roleSelector:previewPick:' + original.split(':').pop());
      else if (original.startsWith('roleSelector:choose:')) c.setCustomId('admin:roleSelector:previewChoose');
      else if (original.startsWith('roleSelector:clear:')) c.setCustomId('admin:roleSelector:previewClear');
    }
    return r;
  });
  return { content: 'Preview only — no Discord roles will be changed. Selected: ' + selected.size, embeds: payload.embeds, components: [...controls, nav(customId('admin:roleSelector:groupOpen', group.id))] };
}

async function handleRoleSelectorInteraction(i) {
  const id = String(i.customId || '');
  const actor = { actorId: i.user?.id };
  if (!id.startsWith('admin:roleSelector') && !id.startsWith('roleSelector:') && !id.startsWith('admin:colourRoles') && !id.startsWith('colourRoles:')) return false;
  try {
    if (id.startsWith('admin:')) {
      const access = await security.enforceInteractionSecurity(i, { level: 'admin', guildOnly: true });
      if (!access.allowed) return true;
    }

    if (id === 'admin:colourRoles' || id === 'admin:roleSelector' || id === 'admin:roleSelector:home') return respond(i, await buildAdminPanel(i.guild, actorName(i)));
    if (id === 'admin:roleSelector:settings') return respond(i, await buildSettingsPanel(i.guild));
    if (id === 'admin:roleSelector:enable' || id === 'admin:roleSelector:disable') {
      guildManager.setModuleEnabled(i.guildId, roleSelector.MODULE, id.endsWith(':enable'), { ...actor, action: id });
      await syncPanels(i.guild);
      return respond(i, await buildSettingsPanel(i.guild));
    }

    if (id === 'admin:roleSelector:groups') return respond(i, buildGroupsPanel(i.guildId));
    if (id === 'admin:roleSelector:groupSelect' && i.values?.[0] !== '__none__') return respond(i, buildGroupsPanel(i.guildId, i.values[0]));
    if (id === 'admin:roleSelector:createGroup') { await i.showModal(createGroupModal()); return true; }
    if (id === 'admin:roleSelector:createGroupSubmit') {
      const mode = i.fields.getTextInputValue('mode').trim().toLowerCase();
      if (!['single', 'multiple'].includes(mode)) throw new Error('Selection type must be single or multiple.');
      const group = await roleSelector.saveGroupSafe(i.guild, {
        name: i.fields.getTextInputValue('name'), emoji: i.fields.getTextInputValue('emoji'), description: i.fields.getTextInputValue('description'), selectionMode: mode, allowRemove: true, options: [],
      }, { ...actor, action: 'role_selector_create_group' });
      await syncPanels(i.guild, group.id);
      return i.reply({ content: `${EMOJIS.SUCCESS} Created **${group.name}**.`, ...buildCreationGuide(i.guildId, group), flags: 64 });
    }
    if (id.startsWith('admin:roleSelector:guide:')) {
      const group = roleSelector.getGroup(i.guildId, tail(id, 'admin:roleSelector:guide'));
      if (!group || group.builtIn) throw new Error('Select a custom selector first.');
      return respond(i, buildCreationGuide(i.guildId, group));
    }
    if (id.startsWith('admin:roleSelector:groupOpen:')) return respond(i, buildGroupsPanel(i.guildId, tail(id, 'admin:roleSelector:groupOpen')));
    if (id.startsWith('admin:roleSelector:dependencies:')) {
      const group = roleSelector.getGroup(i.guildId, tail(id, 'admin:roleSelector:dependencies'));
      if (!group || group.builtIn) throw new Error('Select a custom selector first.');
      return respond(i, {
        embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('Role Dependencies').setDescription('Members must hold every required role and none of the conflicting roles. Clearing a selection remains subject to its selection limits.')],
        components: [
          row(new RoleSelectMenuBuilder().setCustomId(customId('admin:roleSelector:dependencyRequired', group.id)).setPlaceholder('Required roles (all)').setMinValues(0).setMaxValues(25).setDefaultRoles(...(group.requiredRoleIds || []))),
          row(new RoleSelectMenuBuilder().setCustomId(customId('admin:roleSelector:dependencyConflicting', group.id)).setPlaceholder('Conflicting roles (any)').setMinValues(0).setMaxValues(25).setDefaultRoles(...(group.conflictingRoleIds || []))),
          nav(customId('admin:roleSelector:groupOpen', group.id))
        ]
      });
    }
    if (/^admin:roleSelector:dependency(Required|Conflicting):/.test(id)) {
      const [, , action, groupId] = id.split(':');
      const group = roleSelector.getGroup(i.guildId, groupId);
      if (!group || group.builtIn) throw new Error('Select a custom selector first.');
      const key = action === 'dependencyRequired' ? 'requiredRoleIds' : 'conflictingRoleIds';
      const other = key === 'requiredRoleIds' ? 'conflictingRoleIds' : 'requiredRoleIds';
      const values = [...new Set(i.values || [])];
      if (values.some(value => value === i.guildId || (group[other] || []).includes(value) || group.options.some(option => option.roleId === value))) throw new Error('Dependencies cannot overlap, include everyone or reference roles in this selector.');
      await roleSelector.saveGroupSafe(i.guild, { ...group, [key]: values }, { ...actor, action: 'role_selector_dependencies' });
      return respond(i, buildGroupsPanel(i.guildId, group.id));
    }
    if (id === 'admin:roleSelector:previewChoose' || id === 'admin:roleSelector:previewClear' || id.startsWith('admin:roleSelector:previewPick:')) {
      const preview = state(i).preview;
      const group = preview && roleSelector.getGroup(i.guildId, preview.groupId);
      if (!group || group.builtIn) throw new Error('Reopen the selector preview.');
      const options = group.options.filter(o => o.enabled);
      let desired = preview.selected;
      if (id === 'admin:roleSelector:previewClear') desired = [];
      else if (id === 'admin:roleSelector:previewChoose') desired = [...new Set(i.values || [])];
      else {
        const token = id.split(':').pop();
        const option = options.find(o => optionToken(o.id, group.id, 'global') === token);
        if (!option) throw new Error('Reopen the selector preview.');
        desired = group.selectionMode === 'single' ? [option.id] : desired.includes(option.id) ? desired.filter(x => x !== option.id) : [...desired, option.id];
      }
      if (desired.some(x => !options.some(o => o.id === x)) || desired.length < (group.minSelections || 0) || desired.length > group.maxSelections) throw new Error('Selection does not meet the configured limits.');
      preview.selected = desired;
      return respond(i, buildInteractivePreview(i, group));
    }
    if (id.startsWith('admin:roleSelector:controlMode:')) {
      const group = roleSelector.getGroup(i.guildId, tail(id, 'admin:roleSelector:controlMode'));
      if (!group || group.builtIn) throw new Error('Select a custom selector first.');
      if (group.controlMode !== 'buttons' && group.options.filter(x => x.enabled).length > 15) throw new Error('Button selectors support up to 15 enabled options.');
      await roleSelector.saveGroupSafe(i.guild, { ...group, controlMode: group.controlMode === 'buttons' ? 'dropdown' : 'buttons' }, { ...actor, action: 'role_selector_control_mode' });
      await syncPanels(i.guild, group.id);
      return respond(i, buildGroupsPanel(i.guildId, group.id));
    }
    if (/^admin:roleSelector:(design|media|preview):/.test(id)) {
      const [, , action, groupId] = id.split(':');
      const group = roleSelector.getGroup(i.guildId, groupId);
      if (!group || group.builtIn) throw new Error('Select a custom selector first.');
      if (action === 'preview') {
        state(i).preview = { groupId: group.id, selected: [] };
        return respond(i, buildInteractivePreview(i, group));
      }
      const fields = action === 'design' ? [['title','Title',256],['description','Description',3000],['color','HEX colour',7],['footer','Footer',2048]] : [['image','Banner image URL',2048],['thumbnail','Thumbnail URL',2048]];
      const modal = new ModalBuilder().setCustomId(customId('admin:roleSelector:' + action + 'Submit', group.id)).setTitle(action === 'design' ? 'Selector Appearance' : 'Selector Images');
      for (const [key,label,max] of fields) {
        const input = new TextInputBuilder().setCustomId(key).setLabel(label).setStyle(max > 256 ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(false).setMaxLength(max);
        if (group.appearance?.[key]) input.setValue(group.appearance[key]);
        modal.addComponents(row(input));
      }
      await i.showModal(modal); return true;
    }
    if (/^admin:roleSelector:(designSubmit|mediaSubmit):/.test(id)) {
      const [, , action, groupId] = id.split(':');
      const group = roleSelector.getGroup(i.guildId, groupId);
      if (!group || group.builtIn) throw new Error('Select a custom selector first.');
      const appearance = { ...group.appearance };
      for (const key of action === 'designSubmit' ? ['title','description','color','footer'] : ['image','thumbnail']) {
        const value = i.fields.getTextInputValue(key).trim();
        if (key === 'color' && value && !/^#[0-9a-f]{6}$/i.test(value)) throw new Error('Use a six-digit HEX colour.');
        if (['image','thumbnail'].includes(key) && value) { const url = new URL(value); if (!['https:','http:'].includes(url.protocol)) throw new Error('Use an HTTP or HTTPS image URL.'); }
        appearance[key] = value;
      }
      await roleSelector.saveGroupSafe(i.guild, { ...group, appearance }, { ...actor, action: 'role_selector_appearance' });
      await syncPanels(i.guild, group.id);
      return respond(i, buildGroupsPanel(i.guildId, group.id));
    }
    if (id.startsWith('admin:roleSelector:limits:')) {
      const group = roleSelector.getGroup(i.guildId, tail(id, 'admin:roleSelector:limits'));
      if (!group || group.builtIn) throw new Error('Select a custom selector first.');
      await i.showModal(new ModalBuilder().setCustomId(customId('admin:roleSelector:limitsSubmit', group.id)).setTitle('Selection Limits').addComponents(
        row(new TextInputBuilder().setCustomId('min').setLabel('Minimum selections').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(2).setValue(String(group.minSelections))),
        row(new TextInputBuilder().setCustomId('max').setLabel('Maximum selections').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(2).setValue(String(group.maxSelections)))
      )); return true;
    }
    if (id.startsWith('admin:roleSelector:limitsSubmit:')) {
      const group = roleSelector.getGroup(i.guildId, tail(id, 'admin:roleSelector:limitsSubmit'));
      if (!group || group.builtIn) throw new Error('Select a custom selector first.');
      const min = Number(i.fields.getTextInputValue('min')), max = Number(i.fields.getTextInputValue('max'));
      const ceiling = group.selectionMode === 'single' ? 1 : 25;
      if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < 1 || min > max || max > ceiling) throw new Error('Enter valid selection limits for this selector.');
      await roleSelector.saveGroupSafe(i.guild, { ...group, minSelections: min, maxSelections: max }, { ...actor, action: 'role_selector_limits' });
      await syncPanels(i.guild, group.id);
      return respond(i, buildGroupsPanel(i.guildId, group.id));
    }
    if (id.startsWith('admin:roleSelector:addRoles:')) {
      const group = roleSelector.getGroup(i.guildId, tail(id, 'admin:roleSelector:addRoles'));
      if (!group || group.builtIn) throw new Error('Select a custom selector first.');
      const remaining = 25 - (group.options || []).length;
      if (remaining <= 0) throw new Error('This selector already has 25 options.');
      return respond(i, {
        embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle(emojiLabel('ADD', 'Add Existing Roles')).setDescription('Choose existing Discord roles to add to this selector. Existing options are preserved.')],
        components: [row(new RoleSelectMenuBuilder().setCustomId(customId('admin:roleSelector:addRolesSubmit', group.id)).setPlaceholder('Select existing Discord roles').setMinValues(1).setMaxValues(remaining)), nav(customId('admin:roleSelector:groupOpen', group.id))],
      });
    }
    if (id.startsWith('admin:roleSelector:addRolesSubmit:')) {
      const group = roleSelector.getGroup(i.guildId, tail(id, 'admin:roleSelector:addRolesSubmit'));
      if (!group || group.builtIn) throw new Error('Select a custom selector first.');
      const options = [...(group.options || [])];
      for (const roleId of new Set(i.values || [])) {
        if (options.some(option => option.roleId === roleId)) continue;
        const role = i.guild.roles.cache.get(roleId) || await i.guild.roles.fetch(roleId).catch(() => null);
        if (!role || role.id === i.guild.id) throw new Error('The everyone role cannot be selected.');
        roleSelector.assertSafeSelectorRole(i.guild, role);
        options.push({ label: role.name.slice(0, 100), roleId: role.id, managed: false, enabled: true, order: (options.length + 1) * 10 });
      }
      if (options.length > 25) throw new Error('A selector can contain at most 25 options.');
      await roleSelector.saveGroupSafe(i.guild, { ...group, options }, { ...actor, action: 'role_selector_add_existing_roles' });
      await syncPanels(i.guild, group.id);
      return respond(i, buildGroupsPanel(i.guildId, group.id));
    }
    if (id.startsWith('admin:roleSelector:options:')) {
      const group = roleSelector.getGroup(i.guildId, tail(id, 'admin:roleSelector:options'));
      if (!group || group.builtIn) throw new Error('Select a custom group first.');
      await i.showModal(optionsModal(group)); return true;
    }
    if (id.startsWith('admin:roleSelector:optionsSubmit:')) {
      const groupId = tail(id, 'admin:roleSelector:optionsSubmit');
      const group = roleSelector.getGroup(i.guildId, groupId);
      if (!group || group.builtIn) throw new Error('Select a custom group first.');
      const old = new Map((group.options || []).map((x) => [x.label.toLowerCase(), x]));
      const options = i.fields.getTextInputValue('options').split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(0, 25).map((line, index) => {
        const [emoji, label, description, roleRaw] = line.split('|').map((x) => x.trim());
        if (!label) throw new Error(`Option ${index + 1} needs a label.`);
        const previous = old.get(label.toLowerCase());
        const roleId = cleanId(roleRaw);
        return { ...(previous || {}), id: previous?.id, emoji, label, description, roleId: roleId || previous?.roleId || null, managed: roleId ? false : previous?.managed !== false, enabled: true, order: (index + 1) * 10 };
      });
      for (const option of options) {
        if (!option.roleId || option.managed !== false) continue;
        const role = i.guild.roles.cache.get(option.roleId) || await i.guild.roles.fetch(option.roleId).catch(() => null);
        roleSelector.assertSafeSelectorRole(i.guild, role);
      }
      await roleSelector.saveGroupSafe(i.guild, { ...group, options }, { ...actor, action: 'role_selector_update_options' });
      await syncPanels(i.guild, group.id);
      return i.reply({ content: emojiLabel('HEALTHY', 'Selector options saved.'), ...buildGroupsPanel(i.guildId, group.id), flags: 64 });
    }
    if (id.startsWith('admin:roleSelector:toggleMode:') || id.startsWith('admin:roleSelector:toggleRemove:')) {
      const prefix = id.startsWith('admin:roleSelector:toggleMode:') ? 'admin:roleSelector:toggleMode' : 'admin:roleSelector:toggleRemove';
      const groupId = tail(id, prefix);
      const group = roleSelector.getGroup(i.guildId, groupId);
      if (!group || group.builtIn) throw new Error('Select a custom group first.');
      const next = prefix.endsWith('toggleMode') ? { ...group, selectionMode: group.selectionMode === 'multiple' ? 'single' : 'multiple' } : { ...group, allowRemove: !group.allowRemove };
      await roleSelector.saveGroupSafe(i.guild, next, { ...actor, action: prefix });
      await syncPanels(i.guild, group.id);
      return respond(i, buildGroupsPanel(i.guildId, group.id));
    }
    if (id.startsWith('admin:roleSelector:deleteGroup:')) {
      const groupId = tail(id, 'admin:roleSelector:deleteGroup');
      const group = roleSelector.getGroup(i.guildId, groupId);
      if (!group || group.builtIn) throw new Error('Select a custom group first.');
      const result = await roleSelector.deleteManagedGroupRoles(i.guild, group.id);
      if (result.unresolved) throw new Error(`Group not deleted because ${result.unresolved} managed role(s) could not be removed.`);
      roleSelector.removeGroup(i.guildId, group.id, { ...actor, action: 'role_selector_delete_group' });
      const list = deploymentList(roleSelector.getSection(i.guildId)).map((d) => {
        const optionIdsByGroup = { ...d.optionIdsByGroup }; delete optionIdsByGroup[group.id];
        return { ...d, groupIds: d.groupIds.filter((x) => x !== group.id), optionIdsByGroup };
      });
      saveDeployments(i.guildId, list, { ...actor, action: 'role_selector_prune_deployments' });
      await syncPanels(i.guild);
      return respond(i, buildGroupsPanel(i.guildId));
    }
    if (id === 'admin:roleSelector:palette' || id === 'admin:roleSelector:toggleHex' || id === 'admin:roleSelector:colourClearToggle') {
      const group = roleSelector.getGroup(i.guildId, roleSelector.COLOUR_GROUP_ID);
      let next = group;
      if (id.endsWith(':palette')) { const selected = new Set(i.values || []); next = { ...group, palette: group.palette.map((x) => ({ ...x, enabled: selected.has(x.id) })) }; }
      else if (id.endsWith(':toggleHex')) next = { ...group, customHexEnabled: !group.customHexEnabled };
      else next = { ...group, allowRemove: !group.allowRemove };
      await roleSelector.saveGroupSafe(i.guild, next, { ...actor, action: id });
      await syncPanels(i.guild, group.id);
      return respond(i, buildColourPanel(i.guildId, roleSelector.getGroup(i.guildId, roleSelector.COLOUR_GROUP_ID)));
    }

    if (id === 'admin:roleSelector:style') return respond(i, buildAppearance(i.guild));
    const rolePicker = parseRolePickerId(id);
    if (rolePicker?.baseId === 'admin:roleSelector:anchor') {
      if (rolePicker.kind === 'page') return respond(i, buildAppearance(i.guild, rolePicker.page));
      const roleId = i.values?.[0] && i.values[0] !== '__none__' ? i.values[0] : null;
      await roleSelector.setAnchorRole(i.guild, roleId, { managed: false, meta: { ...actor, action: 'admin:roleSelector:anchor' } });
      return respond(i, buildAppearance(i.guild, rolePicker.page));
    }
    if (id === 'admin:roleSelector:styleOpen') { await i.showModal(styleModal(roleSelector.getSection(i.guildId))); return true; }
    if (id === 'admin:roleSelector:styleSubmit') {
      roleSelector.updateSection(i.guildId, (section) => ({ ...section, style: { ...section.style, format: i.fields.getTextInputValue('format'), icon: i.fields.getTextInputValue('icon'), separator: i.fields.getTextInputValue('separator') || '|' } }), { ...actor, action: id });
      await roleSelector.syncManagedRoleAppearance(i.guild); await syncPanels(i.guild);
      return i.reply({ content: emojiLabel('HEALTHY', 'Role appearance updated.'), ...buildAppearance(i.guild), flags: 64 });
    }
    if (id === 'admin:roleSelector:togglePlacement' || id === 'admin:roleSelector:toggleGrouped') {
      await i.deferUpdate();
      roleSelector.updateSection(i.guildId, (section) => ({ ...section, style: { ...section.style, ...(id.endsWith('togglePlacement') ? { placement: section.style.placement === 'above' ? 'below' : 'above' } : { keepGrouped: !section.style.keepGrouped }) } }), { ...actor, action: id });
      await i.editReply(buildAppearance(i.guild));
      queueAppearanceSync(i.guild);
      return true;
    }
    if (id === 'admin:roleSelector:scanStyle') {
      const suggestion = roleSelector.suggestRoleStyle(i.guild);
      roleSelector.updateSection(i.guildId, (section) => ({ ...section, style: { ...section.style, detectedFormat: suggestion.format, detectedIcon: suggestion.icon, detectedSeparator: suggestion.separator, detectedConfidence: suggestion.confidence } }), { ...actor, action: id });
      return respond(i, await buildSettingsPanel(i.guild));
    }
    if (id === 'admin:roleSelector:applyStyle') {
      roleSelector.updateSection(i.guildId, (section) => ({ ...section, style: { ...section.style, format: section.style.detectedFormat || section.style.format, icon: section.style.detectedIcon || '', separator: section.style.detectedSeparator || section.style.separator } }), { ...actor, action: id });
      await roleSelector.syncManagedRoleAppearance(i.guild); await syncPanels(i.guild); return respond(i, await buildSettingsPanel(i.guild));
    }
    if (id === 'admin:roleSelector:createDivider') { await i.showModal(dividerModal()); return true; }
    if (id === 'admin:roleSelector:createDividerSubmit') {
      const divider = await i.guild.roles.create({ name: i.fields.getTextInputValue('name').trim().slice(0, 100), permissions: [], hoist: false, mentionable: false, reason: 'Goliath Role Selector divider' });
      try { await roleSelector.setAnchorRole(i.guild, divider.id, { managed: true, meta: { ...actor, action: id } }); }
      catch (error) { await divider.delete('Unsafe Role Selector divider').catch(() => null); throw error; }
      await syncPanels(i.guild);
      return i.reply({ content: `${EMOJIS.SUCCESS} Created divider **${divider.name}**.`, ...buildAppearance(i.guild), flags: 64 });
    }

    if (id === 'admin:roleSelector:deployment') return respond(i, await buildDeploymentsPanel(i));
    if (id === 'admin:roleSelector:deploymentSelect' && i.values?.[0] !== '__none__') return respond(i, await buildDeploymentsPanel(i, i.values[0]));
    if (id === 'admin:roleSelector:deploymentCreate') {
      const list = deploymentList(roleSelector.getSection(i.guildId));
      let candidate = `p${Date.now().toString(36)}`;
      while (list.some((d) => d.id === candidate)) candidate = `${candidate}${Math.random().toString(36).slice(2, 4)}`.slice(0, 20);
      const deployment = normalizeDeployment({ id: candidate, groupIds: [] });
      list.push(deployment);
      saveDeployments(i.guildId, list, { ...actor, action: 'role_selector_deployment_create' });
      return respond(i, await buildDeploymentsPanel(i, deployment.id));
    }
    if (id.startsWith('admin:roleSelector:deploymentOpen:')) return respond(i, await buildDeploymentsPanel(i, tail(id, 'admin:roleSelector:deploymentOpen')));
    if (id.startsWith('admin:roleSelector:deploymentContent:')) return respond(i, await buildDeploymentContentPanel(i, tail(id, 'admin:roleSelector:deploymentContent')));
    if (id.startsWith('admin:roleSelector:deploymentGroups:')) {
      const deploymentId = tail(id, 'admin:roleSelector:deploymentGroups');
      const list = deploymentList(roleSelector.getSection(i.guildId)); const index = list.findIndex((d) => d.id === deploymentId);
      if (index < 0) throw new Error('Choose a deployment first.');
      const selected = [...new Set((i.values || []).filter((x) => x !== '__none__'))];
      const optionIdsByGroup = { ...list[index].optionIdsByGroup };
      for (const groupId of Object.keys(optionIdsByGroup)) if (!selected.includes(groupId)) delete optionIdsByGroup[groupId];
      list[index] = { ...list[index], groupIds: selected, optionIdsByGroup };
      saveDeployments(i.guildId, list, { ...actor, action: 'role_selector_deployment_groups' });
      await syncOneDeployment(i.guild, list[index]).catch(() => null);
      return respond(i, await buildDeploymentContentPanel(i, deploymentId));
    }
    if (id.startsWith('admin:roleSelector:deploymentContentGroup:') && i.values?.[0] !== '__none__') {
      const deploymentId = tail(id, 'admin:roleSelector:deploymentContentGroup');
      return respond(i, await buildDeploymentContentPanel(i, deploymentId, i.values[0]));
    }
    if (id.startsWith('admin:roleSelector:deploymentOptions:')) {
      const [deploymentId, groupId] = splitTail(id, 'admin:roleSelector:deploymentOptions');
      const list = deploymentList(roleSelector.getSection(i.guildId)); const index = list.findIndex((d) => d.id === deploymentId);
      if (index < 0 || !groupId) throw new Error('Choose a deployment group first.');
      list[index] = { ...list[index], optionIdsByGroup: { ...list[index].optionIdsByGroup, [groupId]: [...new Set((i.values || []).filter((x) => x !== '__none__'))] } };
      saveDeployments(i.guildId, list, { ...actor, action: 'role_selector_deployment_options' });
      await syncOneDeployment(i.guild, list[index]).catch(() => null);
      return respond(i, await buildDeploymentContentPanel(i, deploymentId, groupId));
    }
    if (id.startsWith('admin:roleSelector:deploymentOptionsAll:')) {
      const [deploymentId, groupId] = splitTail(id, 'admin:roleSelector:deploymentOptionsAll');
      if (!groupId || groupId === 'none') throw new Error('Choose a deployment group first.');
      const list = deploymentList(roleSelector.getSection(i.guildId)); const index = list.findIndex((d) => d.id === deploymentId);
      if (index < 0) throw new Error('Choose a deployment first.');
      const optionIdsByGroup = { ...list[index].optionIdsByGroup }; delete optionIdsByGroup[groupId];
      list[index] = { ...list[index], optionIdsByGroup };
      saveDeployments(i.guildId, list, { ...actor, action: 'role_selector_deployment_options_all' });
      await syncOneDeployment(i.guild, list[index]).catch(() => null);
      return respond(i, await buildDeploymentContentPanel(i, deploymentId, groupId));
    }
    if (id.startsWith('admin:roleSelector:deploymentChannel:')) {
      const deploymentId = tail(id, 'admin:roleSelector:deploymentChannel');
      const target = i.values?.[0]; if (!target) throw new Error('Choose a deployment channel.');
      const list = deploymentList(roleSelector.getSection(i.guildId)); const index = list.findIndex((d) => d.id === deploymentId);
      if (index < 0) throw new Error('Choose a deployment first.');
      const deployment = list[index];
      if (deployment.messageId && deployment.channelId && deployment.channelId !== target) {
        return respond(i, {
          embeds: [new EmbedBuilder().setColor(0xFAA61A).setTitle(emojiLabel('WELCOME_LOCATION', 'Move this Role Selector panel?')).setDescription(`Current: <#${deployment.channelId}>\nNew: <#${target}>\n\nChoose what to do with the old Goliath-owned panel.`)],
          components: [
            row(button(customId('admin:roleSelector:moveRemove', deploymentId, target), emojiLabel('DELETE', 'Remove Old Panel & Move'), ButtonStyle.Danger), button(customId('admin:roleSelector:moveRetire', deploymentId, target), emojiLabel('WELCOME_PRESET', 'Retire Old Panel & Move'), ButtonStyle.Primary)),
            nav(customId('admin:roleSelector:deploymentOpen', deploymentId)),
          ],
        });
      }
      list[index] = { ...deployment, channelId: target, messageId: deployment.channelId === target ? deployment.messageId : null };
      saveDeployments(i.guildId, list, { ...actor, action: 'role_selector_deployment_channel' });
      return respond(i, await buildDeploymentsPanel(i, deploymentId));
    }
    if (id.startsWith('admin:roleSelector:moveRemove:') || id.startsWith('admin:roleSelector:moveRetire:')) {
      const prefix = id.startsWith('admin:roleSelector:moveRemove:') ? 'admin:roleSelector:moveRemove' : 'admin:roleSelector:moveRetire';
      const [deploymentId, targetChannelId] = splitTail(id, prefix);
      const list = deploymentList(roleSelector.getSection(i.guildId)); const index = list.findIndex((d) => d.id === deploymentId);
      if (index < 0 || !cleanId(targetChannelId)) throw new Error('Choose a deployment and channel first.');
      const deployment = list[index]; const { message } = await fetchDeployment(i.guild, deployment);
      if (message) {
        if (!owned(i.guild, message)) throw new Error('Goliath will not modify a message it does not own.');
        if (prefix.endsWith('moveRemove')) await message.delete(); else await message.edit(memberDisabledPayload());
      }
      list[index] = { ...deployment, channelId: targetChannelId, messageId: null, status: 'active' };
      saveDeployments(i.guildId, list, { ...actor, action: prefix });
      const sent = await deploySelected(i, deploymentId); const payload = await buildDeploymentsPanel(i, deploymentId); payload.content = `${EMOJIS.SUCCESS} Panel moved to <#${sent.channel.id}>.`; return respond(i, payload);
    }
    if (id.startsWith('admin:roleSelector:deploy:')) {
      const deploymentId = tail(id, 'admin:roleSelector:deploy');
      const message = await deploySelected(i, deploymentId); const payload = await buildDeploymentsPanel(i, deploymentId); payload.content = `${EMOJIS.SUCCESS} Role Selector panel deployed in <#${message.channel.id}>.`; return respond(i, payload);
    }
    if (id.startsWith('admin:roleSelector:deploymentDelete:')) {
      const deploymentId = tail(id, 'admin:roleSelector:deploymentDelete');
      await deleteSelectedDeployment(i, deploymentId); return respond(i, await buildDeploymentsPanel(i));
    }

    if (id === 'admin:roleSelector:stats') return respond(i, await buildStats(i.guild));
    if (id === 'admin:roleSelector:statsGroup' && i.values?.[0] !== '__none__') {
      const usage = await roleSelector.getUsage(i.guild, i.values[0]); const group = usage.groups?.[0];
      return respond(i, { embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle(`${EMOJIS.ANALYTICS} ${group?.emoji || EMOJIS.ROLE_TAG} ${group?.name || 'Group'}`).setDescription((group?.rows || []).map((x, index) => `${index + 1}. **${x.label}** — ${x.count || 0}`).join('\n') || '`No selections yet`')], components: [nav('admin:roleSelector:deployment')] });
    }
    if (id === 'admin:roleSelector:statsPublic') return respond(i, await buildStatsDeploymentPanel(i));
    if (id === 'admin:roleSelector:statsDeploymentChannel') {
      const target = i.values?.[0]; if (!target) throw new Error('Choose a public stats channel.');
      const current = statsDeploymentRecord(roleSelector.getSection(i.guildId));
      roleSelector.updateSection(i.guildId, (section) => ({ ...section, statsDeployment: { channelId: target, messageId: current.channelId === target ? current.messageId : null } }), { ...actor, action: 'role_selector_stats_channel' });
      return respond(i, await buildStatsDeploymentPanel(i));
    }
    if (id === 'admin:roleSelector:statsDeploy') { const message = await deployStats(i); const payload = await buildStatsDeploymentPanel(i); payload.content = `${EMOJIS.SUCCESS} Public stats panel deployed in <#${message.channel.id}>.`; return respond(i, payload); }
    if (id === 'admin:roleSelector:health' || id === 'admin:roleSelector:healthCheck') return respond(i, await buildHealth(i.guild));
    if (id === 'admin:roleSelector:healthRepair') { const health = await healthService.repair(i.guild); await syncPanels(i.guild); return respond(i, await buildHealth(i.guild, health)); }

    if (id.startsWith('roleSelector:')) roleSelector.assertModuleEnabled(i.guildId);
    if (id === 'roleSelector:openGroup' || id.startsWith('roleSelector:openGroup:')) {
      if (i.values?.[0] === '__none__') return i.reply({ content: 'No selector groups are available.', flags: 64 });
      const deploymentId = tail(id, 'roleSelector:openGroup');
      const deployment = deploymentId ? deploymentById(i.guildId, deploymentId) : null;
      const allowed = deploymentAllowedGroups(i.guildId, deploymentId);
      return i.reply({ ...await resolvePayload(i.guild, memberGroupPayload(i.guild, await freshMember(i), i.values[0], allowed, deploymentId, deployment)), flags: 64 });
    }
    if (id === 'roleSelector:switchGroup' || id.startsWith('roleSelector:switchGroup:')) {
      if (i.values?.[0] === '__none__') return i.update(memberDisabledPayload());
      const deploymentId = tail(id, 'roleSelector:switchGroup');
      const deployment = deploymentId ? deploymentById(i.guildId, deploymentId) : null;
      const allowed = deploymentAllowedGroups(i.guildId, deploymentId);
      return i.update(await resolvePayload(i.guild, memberGroupPayload(i.guild, await freshMember(i), i.values[0], allowed, deploymentId, deployment)));
    }
    if (id.startsWith('roleSelector:colourChoose:')) {
      const deploymentId = tail(id, 'roleSelector:colourChoose') || 'global';
      const deployment = deploymentId !== 'global' ? deploymentById(i.guildId, deploymentId) : null;
      const allowed = deploymentAllowedGroups(i.guildId, deploymentId);
      if (allowed && !allowed.includes(roleSelector.COLOUR_GROUP_ID)) throw new Error('Colours are not available on this panel.');
      await roleSelector.applyColourSelection(i.guild, i.member, i.values[0]);
      await i.update(await resolvePayload(i.guild, memberGroupPayload(i.guild, await freshMember(i), roleSelector.COLOUR_GROUP_ID, deploymentAllowedGroups(i.guildId, deploymentId), deploymentId, deployment)));
      await syncStatsDeploymentState(i.guild).catch(() => null);
      await i.followUp({ content: emojiLabel('HEALTHY', 'Your colour has been updated.'), flags: 64 }); return true;
    }
    if (id.startsWith('roleSelector:customHex:')) { const deploymentId = tail(id, 'roleSelector:customHex') || 'global'; const allowed = deploymentAllowedGroups(i.guildId, deploymentId); if (allowed && !allowed.includes(roleSelector.COLOUR_GROUP_ID)) throw new Error('Colours are not available on this panel.'); await i.showModal(hexModal(deploymentId)); return true; }
    if (id.startsWith('roleSelector:customHexSubmit:')) { const allowed = deploymentAllowedGroups(i.guildId, tail(id, 'roleSelector:customHexSubmit') || 'global'); if (allowed && !allowed.includes(roleSelector.COLOUR_GROUP_ID)) throw new Error('Colours are not available on this panel.'); await roleSelector.applyColourSelection(i.guild, i.member, i.fields.getTextInputValue('hex'), i.fields.getTextInputValue('label')); await syncStatsDeploymentState(i.guild).catch(() => null); return i.reply({ content: emojiLabel('HEALTHY', 'Your custom colour has been applied.'), flags: 64 }); }
    if (id.startsWith('roleSelector:pick:')) {
      const [token] = splitTail(id, 'roleSelector:pick');
      const candidates = [];
      const deployments = ['global', ...deploymentList(roleSelector.getSection(i.guildId)).filter(d => d.status === 'active').map(d => d.id)];
      for (const g of groups(i.guildId)) {
        if (g.controlMode !== 'buttons') continue;
        for (const d of new Set(deployments)) {
          for (const o of g.options || []) {
            if (o.enabled && optionToken(o.id, g.id, d) === token) candidates.push({ groupId: g.id, deploymentId: d });
          }
        }
      }
      if (candidates.length !== 1) throw new Error('This selector has changed. Reopen it.');
      const { groupId, deploymentId } = candidates[0];
      const deployment = deploymentId !== 'global' ? deploymentById(i.guildId, deploymentId) : null;
      const allowed = deploymentAllowedGroups(i.guildId, deploymentId);
      const group = roleSelector.getGroup(i.guildId, groupId);
      if (!group || group.controlMode !== 'buttons' || (allowed && !allowed.includes(groupId))) throw new Error('Selector unavailable.');
      const filter = optionFilterFor(deployment, groupId);
      const options = group.options.filter(x => x.enabled && (!filter || filter.has(x.id))).sort((a,b) => a.order-b.order);
      const matches = options.filter(x => optionToken(x.id, groupId, deploymentId) === token);
      const option = matches.length === 1 ? matches[0] : null;
      if (!option || options.length > 15) throw new Error('This selector has changed. Reopen it.');
      const member = await freshMember(i);
      const current = group.options.filter(x => x.enabled && x.roleId && member.roles.cache.has(x.roleId)).map(x => x.id);
      const desired = group.selectionMode === 'single' ? [option.id] : current.includes(option.id) ? current.filter(x => x !== option.id) : [...current, option.id];
      await roleSelector.applyStandardSelection(i.guild, member, groupId, desired);
      await i.update(await resolvePayload(i.guild, memberGroupPayload(i.guild, await freshMember(i), groupId, allowed, deploymentId, deployment)));
      await syncStatsDeploymentState(i.guild).catch(() => null);
      return true;
    }
    if (id.startsWith('roleSelector:choose:')) {
      const [groupId, deploymentId = 'global'] = splitTail(id, 'roleSelector:choose');
      const deployment = deploymentId !== 'global' ? deploymentById(i.guildId, deploymentId) : null; const allowed = deploymentAllowedGroups(i.guildId, deploymentId);
      if (allowed && !allowed.includes(groupId)) throw new Error('That group is not available on this panel.');
      const filter = optionFilterFor(deployment, groupId); if (filter && (i.values || []).some((value) => !filter.has(value))) throw new Error('That role is not available on this panel.');
      await roleSelector.applyStandardSelection(i.guild, i.member, groupId, i.values || []);
      await i.update(await resolvePayload(i.guild, memberGroupPayload(i.guild, await freshMember(i), groupId, allowed, deploymentId, deployment)));
      await syncStatsDeploymentState(i.guild).catch(() => null); await i.followUp({ content: emojiLabel('HEALTHY', 'Your role selection has been updated.'), flags: 64 }); return true;
    }
    if (id.startsWith('roleSelector:clear:')) {
      const [groupId, deploymentId = 'global'] = splitTail(id, 'roleSelector:clear');
      const deployment = deploymentId !== 'global' ? deploymentById(i.guildId, deploymentId) : null; const allowed = deploymentAllowedGroups(i.guildId, deploymentId);
      if (allowed && !allowed.includes(groupId)) throw new Error('That group is not available on this panel.');
      await roleSelector.clearSelection(i.guild, i.member, groupId);
      await i.update(await resolvePayload(i.guild, memberGroupPayload(i.guild, await freshMember(i), groupId, allowed, deploymentId, deployment)));
      await syncStatsDeploymentState(i.guild).catch(() => null); await i.followUp({ content: emojiLabel('HEALTHY', 'Your selection has been cleared.'), flags: 64 }); return true;
    }
    if (id === 'colourRoles:choose') { await roleSelector.applyColourSelection(i.guild, i.member, i.values[0]); await syncStatsDeploymentState(i.guild).catch(() => null); return i.reply({ content: emojiLabel('HEALTHY', 'Your colour has been updated.'), flags: 64 }); }
    if (id === 'colourRoles:remove') { await roleSelector.clearSelection(i.guild, i.member, roleSelector.COLOUR_GROUP_ID); await syncStatsDeploymentState(i.guild).catch(() => null); return i.reply({ content: emojiLabel('HEALTHY', 'Your colour has been removed.'), flags: 64 }); }
    if (id === 'colourRoles:custom') { await i.showModal(hexModal()); return true; }
    return true;
  } catch (error) {
    console.error('[RoleSelectorPanel]', error);
    const payload = { content: `${EMOJIS.ERROR} ${error.message || 'Role Selector failed.'}`, flags: 64 };
    if (i.deferred || i.replied) await i.followUp(payload).catch(() => null); else await i.reply(payload).catch(() => null);
    return true;
  }
}

module.exports = {
  buildAdminPanel,
  handleRoleSelectorInteraction,
  memberDisabledPayload,
  memberLauncherPayload,
  retireDeployment,
  syncDeploymentState,
};
