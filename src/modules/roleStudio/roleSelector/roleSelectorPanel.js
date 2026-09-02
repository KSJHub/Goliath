'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
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
const emojis = require('../../utilityStudio/emojis/emojis');
const roleSelector = require('./roleSelector');
const healthService = require('./roleSelectorHealth');
const { withDeploymentLock } = require('./roleSelectorLocks');

const sessions = new Map();
const row = (...items) => new ActionRowBuilder().addComponents(...items.filter(Boolean));
const button = (id, label, style = ButtonStyle.Secondary, disabled = false) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
const linkButton = (label, url) => new ButtonBuilder().setLabel(label).setURL(url).setStyle(ButtonStyle.Link);
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
  return row(
    button(back, '⬅️ Back'),
    button('admin:roleSelector:settings', '⚙️ Settings', ButtonStyle.Secondary, settingsDisabled),
  );
}

function rootNav() {
  return row(
    button('admin:studio:roleStudio', '⬅️ Back to Role Studio'),
    button('admin:roleSelector:settings', '⚙️ Settings'),
  );
}

function groups(guildId) { return roleSelector.listGroups(guildId); }
function customGroups(guildId) { return groups(guildId).filter((g) => !g.builtIn); }

function safeSelectEmoji(value, allowed) {
  if (!value) return undefined;
  if (typeof value === 'object' && value.id && /^\d{15,25}$/.test(String(value.id))) {
    return { id: String(value.id), name: String(value.name || 'emoji').slice(0, 32), animated: Boolean(value.animated) };
  }

  const raw = String(typeof value === 'object' ? value.name || '' : value).trim();
  if (!raw) return undefined;

  const named = raw.match(/^:([A-Za-z0-9_]{2,32}):$/);
  if (named) {
    const found = allowed?.get(named[1].toLowerCase());
    return found ? emojis.componentPayload(found) : undefined;
  }

  const mention = raw.match(/^<(a?):([A-Za-z0-9_]{2,32}):(\d{15,25})>$/);
  if (mention) return { id: mention[3], name: mention[2], animated: mention[1] === 'a' };

  const isFlag = /^[\u{1F1E6}-\u{1F1FF}]{2}$/u.test(raw);
  const isKeycap = /^[0-9#*]\uFE0F?\u20E3$/u.test(raw);
  const isUnicodeEmoji = /\p{Extended_Pictographic}/u.test(raw) && !/[\p{L}\p{N}\s]/u.test(raw);
  return isFlag || isKeycap || isUnicodeEmoji ? { name: raw } : undefined;
}

async function resolveComponents(guild, components = []) {
  const allowed = await emojis.allowedGuildEmojis(guild.client, guild.id);
  return components.map((entry) => {
    const data = typeof entry?.toJSON === 'function' ? entry.toJSON() : entry;
    if (!data?.components) return entry;
    return {
      ...data,
      components: data.components.map((component) => {
        if (component.type !== 3 || !Array.isArray(component.options)) return component;
        return {
          ...component,
          options: component.options.map((option) => {
            const next = { ...option };
            const resolved = safeSelectEmoji(option?.emoji, allowed);
            if (resolved) next.emoji = resolved;
            else delete next.emoji;
            return next;
          }),
        };
      }),
    };
  });
}

async function resolvePayload(guild, payload) {
  return {
    ...payload,
    content: payload.content == null ? payload.content : await emojis.resolveText(guild.client, guild.id, payload.content),
    embeds: await emojis.resolveEmbeds(guild.client, guild.id, payload.embeds || []),
    components: await resolveComponents(guild, payload.components || []),
  };
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
    label: `${g.emoji || '🏷️'} ${g.name}`.slice(0, 100),
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
    label: `${g.emoji || '🏷️'} ${g.name}`.slice(0, 100),
    value: g.id,
    description: (g.description || 'Choose your roles').slice(0, 100),
  })));
  return row(menu);
}

function memberDisabledPayload() {
  return {
    embeds: [new EmbedBuilder().setColor(0x747F8D).setTitle('🎭 Role Selector').setDescription('Role Selector is currently unavailable.')],
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
  return deployment ? deployment.groupIds : [];
}

function optionFilterFor(deployment, groupId) {
  const value = deployment?.optionIdsByGroup?.[groupId];
  return Array.isArray(value) ? new Set(value.map(String)) : null;
}

function memberLauncherPayload(guild, allowedIds = null, deploymentId = null) {
  if (!guildManager.isModuleEnabled(guild.id, roleSelector.MODULE)) return memberDisabledPayload();
  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🎭 Choose Your Roles').setDescription('Choose a category below. Each category manages only its own roles, so changing one selection never removes roles from another category.')],
    components: [memberCategoryMenu(guild, allowedIds, null, deploymentId ? customId('roleSelector:openGroup', deploymentId) : 'roleSelector:openGroup')],
  };
}

function memberGroupPayload(guild, member, groupId, allowedIds = null, deploymentId = null, deployment = null) {
  roleSelector.assertModuleEnabled(guild.id);
  const group = roleSelector.getGroup(guild.id, groupId);
  if (!group || !roleSelector.isGroupMemberUsable(group) || (Array.isArray(allowedIds) && !allowedIds.includes(group.id))) throw new Error('That selector is unavailable on this panel.');

  const components = [memberCategoryMenu(guild, allowedIds, group.id, deploymentId ? customId('roleSelector:switchGroup', deploymentId) : 'roleSelector:switchGroup')];
  const embed = new EmbedBuilder().setColor(0x5865F2).setTitle(`${group.emoji || '🏷️'} ${group.name}`).setDescription([
    group.description || 'Choose your role.',
    group.selectionMode === 'multiple' ? 'Select every option that applies.' : 'Select one option.',
    group.allowRemove ? 'You may clear this category at any time.' : null,
  ].filter(Boolean).join('\n'));

  if (group.type === 'colour') {
    const opts = group.palette.filter((x) => x.enabled).sort((a, b) => a.order - b.order).slice(0, 24).map((x) => ({
      label: x.label,
      value: x.hex,
      emoji: x.emoji || undefined,
      description: `${x.hex} · ${x.family}`.slice(0, 100),
      default: Boolean(group.managedRoles?.[x.hex]?.roleId && member?.roles?.cache?.has(group.managedRoles[x.hex].roleId)),
    }));
    if (opts.length) components.push(row(new StringSelectMenuBuilder().setCustomId(customId('roleSelector:colourChoose', deploymentId || 'global')).setPlaceholder('Choose a colour').setMinValues(1).setMaxValues(1).addOptions(opts)));
    components.push(row(
      group.customHexEnabled ? button(customId('roleSelector:customHex', deploymentId || 'global'), '🎨 Pick Your Own', ButtonStyle.Primary) : null,
      group.allowRemove ? button(customId('roleSelector:clear', 'colours', deploymentId || 'global'), '🧹 Clear Selection') : null,
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
    if (opts.length) components.push(row(new StringSelectMenuBuilder()
      .setCustomId(customId('roleSelector:choose', group.id, deploymentId || 'global'))
      .setPlaceholder(group.selectionMode === 'multiple' ? 'Choose one or more' : 'Choose one')
      .setMinValues(group.selectionMode === 'multiple' ? 0 : 1)
      .setMaxValues(group.selectionMode === 'multiple' ? opts.length : 1)
      .addOptions(opts)));
    if (group.allowRemove) components.push(row(button(customId('roleSelector:clear', group.id, deploymentId || 'global'), '🧹 Clear Selection')));
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
    await message.edit(memberDisabledPayload()).catch(() => null);
    return true;
  });
}

async function buildAdminPanel(guild, requestedBy = 'Unknown User') {
  const section = roleSelector.getSection(guild.id);
  const health = await healthService.buildHealth(guild);
  const usage = await roleSelector.getUsage(guild);
  const enabled = guildManager.isModuleEnabled(guild.id, roleSelector.MODULE);
  const deployments = deploymentList(section);
  return {
    embeds: [new EmbedBuilder()
      .setColor(!enabled ? 0x747F8D : health.healthy ? 0x57F287 : 0xFAA61A)
      .setTitle('🎭 Role Selector')
      .setDescription([
        `**Status:** ${enabled ? 'Enabled ✅' : 'Disabled ❌'}`,
        `**Groups:** ${groups(guild.id).length} (${customGroups(guild.id).length} custom)`,
        `**Members using selectors:** ${usage.totalUsing}/${usage.totalMembers}`,
        `**Deployments:** ${deployments.filter((d) => d.status === 'active').length} active`,
        `**Format:** \`${roleSelector.roleNameFor(section, 'Example Role')}\``,
        `**Acceptance:** ${health.acceptance?.ready ? 'Ready ✅' : 'Not ready ⚠️'}`,
      ].join('\n'))
      .setFooter({ text: `Requested by ${requestedBy}` })
      .setTimestamp()],
    components: [
      row(
        button('admin:roleSelector:groups', '🏷️ Groups', ButtonStyle.Primary),
        button('admin:roleSelector:style', '🎨 Appearance', ButtonStyle.Primary),
        button('admin:roleSelector:deployment', '📍 Deployments', ButtonStyle.Primary),
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
      .setTitle('⚙️ Role Selector · Settings')
      .setDescription([
        '**Module Status**',
        enabled ? 'Enabled ✅' : 'Disabled ❌',
        '',
        '**System Health**',
        health.healthy ? 'Healthy ✅' : 'Needs attention ⚠️',
        '',
        '**Guild Role Style**',
        hasSuggestion ? `Detected: \`${section.style.detectedFormat}\`` : 'No guild role style has been scanned yet.',
        '',
        'Manage Role Selector status, diagnostics and automatic role styling.',
      ].join('\n'))],
    components: [
      row(
        button('admin:roleSelector:health', '🩺 Health & Repair', ButtonStyle.Primary),
        button('admin:roleSelector:scanStyle', '🔎 Scan Guild Style', ButtonStyle.Primary),
      ),
      row(
        button('admin:roleSelector:applyStyle', '✅ Apply Suggested Style', hasSuggestion ? ButtonStyle.Success : ButtonStyle.Secondary, !hasSuggestion),
        button(enabled ? 'admin:roleSelector:disable' : 'admin:roleSelector:enable', enabled ? '⏸ Disable Role Selector' : '▶ Enable Role Selector', enabled ? ButtonStyle.Danger : ButtonStyle.Success),
      ),
      nav('admin:roleSelector', true),
    ],
  };
}

function buildGroupsPanel(guildId, selectedId = null) {
  const selected = selectedId ? roleSelector.getGroup(guildId, selectedId) : null;
  if (!selected) {
    return {
      embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🏷️ Role Selector · Groups').setDescription('Create and manage self-role categories.\n\n🌈 **Colours** is the protected built-in group.')],
      components: [groupMenu(guildId), row(button('admin:roleSelector:createGroup', '➕ Create Group', ButtonStyle.Success)), nav()],
    };
  }
  if (selected.type === 'colour') return buildColourPanel(guildId, selected);
  const lines = (selected.options || []).map((x) => `${x.enabled ? '✅' : '⬜'} ${x.emoji || '•'} **${x.label}** · Role: ${x.managed === false ? 'Existing role' : x.roleId ? 'Goliath-managed' : 'Auto-create'}`);
  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🏷️ Role Selector · Groups').setDescription([
      `${selected.emoji || '🏷️'} **${selected.name}**`,
      selected.description || '`No description`', '',
      `**Type:** ${selected.selectionMode === 'multiple' ? 'Multiple choices' : 'Single choice'}`,
      `**Options:** ${(selected.options || []).length}`,
      `**Members can clear:** ${selected.allowRemove ? 'Yes ✅' : 'No'}`, '',
      lines.join('\n') || '`No options yet`',
    ].join('\n').slice(0, 4096))],
    components: [
      groupMenu(guildId, selected.id),
      row(
        button(customId('admin:roleSelector:options', selected.id), '📝 Manage Options', ButtonStyle.Primary),
        button(customId('admin:roleSelector:toggleMode', selected.id), selected.selectionMode === 'multiple' ? '☑️ Multiple Choices' : '1️⃣ Single Choice', ButtonStyle.Primary),
        button(customId('admin:roleSelector:toggleRemove', selected.id), selected.allowRemove ? '🧹 Allow Clear: Yes' : '🧹 Allow Clear: No'),
      ),
      row(
        button('admin:roleSelector:groups', '⬅️ Back'),
        button(customId('admin:roleSelector:deleteGroup', selected.id), '🗑️ Delete Group', ButtonStyle.Danger),
        button('admin:roleSelector:settings', '⚙️ Settings'),
      ),
    ],
  };
}

function buildColourPanel(guildId, group) {
  const palette = [...group.palette].sort((a, b) => a.order - b.order).slice(0, 25);
  const menu = new StringSelectMenuBuilder().setCustomId('admin:roleSelector:palette').setPlaceholder('Enabled preset colours').setMinValues(0).setMaxValues(Math.max(1, palette.length)).addOptions(palette.map((x) => ({
    label: x.label, value: x.id, emoji: x.emoji || undefined, description: x.hex, default: x.enabled,
  })));
  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🌈 Role Selector · Groups · Colours').setDescription([
      '**Built-in group 🔒**', 'Choose preset colours and custom HEX availability.', '',
      ...palette.map((x) => `${x.enabled ? '✅' : '⬜'} ${x.emoji} **${x.label}** · \`${x.hex}\``),
    ].join('\n'))],
    components: [
      groupMenu(guildId, group.id),
      row(menu),
      row(
        button('admin:roleSelector:toggleHex', group.customHexEnabled ? '🎨 Custom HEX: On' : '🎨 Custom HEX: Off'),
        button('admin:roleSelector:colourClearToggle', group.allowRemove ? '🧹 Allow Clear: Yes' : '🧹 Allow Clear: No'),
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
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🎨 Role Selector · Appearance').setDescription([
      '**Role Preview**',
      `\`${preview}\``,
      '',
      '**Where roles are placed**',
      `${placement} ${anchor}`,
      `Keep selector roles together: **${section.style.keepGrouped ? 'On ✅' : 'Off'}**`,
      '',
      'Choose where Role Selector roles should sit, then adjust the role style or divider if needed.',
    ].join('\n'))],
    components: [
      ...rolePicker.rows,
      row(
        button('admin:roleSelector:createDivider', '➕ Create Divider', ButtonStyle.Success),
        button('admin:roleSelector:styleOpen', '✏️ Edit Role Style', ButtonStyle.Primary),
      ),
      row(
        button('admin:roleSelector:togglePlacement', section.style.placement === 'above' ? '⬆️ Place Above' : '⬇️ Place Below', ButtonStyle.Primary),
        button('admin:roleSelector:toggleGrouped', section.style.keepGrouped ? '🧲 Keep Together: On' : '🧲 Keep Together: Off', ButtonStyle.Primary),
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
      return `**${index + 1}.** ${d.channelId ? `<#${d.channelId}>` : '`No channel`'} · ${d.status === 'retired' ? 'Retired 📦' : message ? 'Deployed ✅' : 'Not deployed ⚠️'}\n${names.length ? names.join(' · ') : 'No groups selected'}`;
    }));
    return {
      content: null,
      embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('📍 Role Selector · Deployments').setDescription([
        'Deploy member Role Selector panels and public stats panels from one place. The same group can appear on multiple member panels.', '',
        lines.join('\n\n') || '`No deployments yet`',
      ].join('\n').slice(0, 4096))],
      components: [
        deploymentSelect(i.guildId),
        row(
          button('admin:roleSelector:deploymentCreate', '➕ Create Deployment', ButtonStyle.Success),
          button('admin:roleSelector:statsPublic', '📊 Deploy Stats', ButtonStyle.Success),
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
    embeds: [new EmbedBuilder().setColor(selected.status === 'retired' ? 0x747F8D : 0x5865F2).setTitle('📍 Role Selector · Manage Deployment').setDescription([
      `**Channel:** ${selected.channelId ? `<#${selected.channelId}>` : '`Not selected`'}`,
      `**Message:** ${message ? 'Deployed ✅' : selected.status === 'retired' ? 'Retired 📦' : 'Not deployed'}`,
      `**Groups:** ${names.length ? names.join(' · ') : '`None selected`'}`, '',
      'Choose the destination and open **Groups & Roles** to control exactly what this panel exposes.',
    ].join('\n'))],
    components: [
      deploymentSelect(i.guildId, selected.id),
      row(channelMenu),
      row(
        button(customId('admin:roleSelector:deploymentContent', selected.id), '🏷️ Groups & Roles', ButtonStyle.Primary),
        button(customId('admin:roleSelector:deploy', selected.id), message ? '🔄 Update Panel' : '📨 Deploy Panel', ButtonStyle.Success, !selected.channelId || !selected.groupIds.length),
        jump ? linkButton('↗️ Jump to Panel', jump) : null,
      ),
      row(
        button('admin:roleSelector:deployment', '⬅️ Back'),
        button(customId('admin:roleSelector:deploymentDelete', selected.id), '🗑️ Delete', ButtonStyle.Danger),
        button('admin:roleSelector:settings', '⚙️ Settings'),
      ),
    ],
  };
}

function deploymentGroupFilterMenu(guildId, deployment, selectedGroupId = null) {
  const included = deployment.groupIds.map((id) => roleSelector.getGroup(guildId, id)).filter((g) => g && g.type !== 'colour' && (g.options || []).some((x) => x.enabled)).slice(0, 25);
  const menu = new StringSelectMenuBuilder().setCustomId(customId('admin:roleSelector:deploymentContentGroup', deployment.id)).setPlaceholder('Choose a group to limit roles').setMinValues(1).setMaxValues(1);
  if (!included.length) return row(menu.setDisabled(true).addOptions({ label: 'No role groups selected', value: '__none__' }));
  menu.addOptions(included.map((g) => ({
    label: `${g.emoji || '🏷️'} ${g.name}`.slice(0, 100),
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
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🏷️ Role Selector · Deployment Content').setDescription([
      'Select the groups shown on this panel. For a standard group, you can optionally limit the panel to specific role options.', '',
      `**Groups selected:** ${deployment.groupIds.length}`,
      roleLimitText.length ? `**Role filters:**\n${roleLimitText.join('\n')}` : '**Role filters:** All roles from each selected group',
      group ? `\nEditing roles for **${group.name}**.` : '',
    ].join('\n').slice(0, 4096))],
    components: [
      groupMenu(i.guildId, null, customId('admin:roleSelector:deploymentGroups', deployment.id), true, deployment.groupIds),
      deploymentGroupFilterMenu(i.guildId, deployment, groupId),
      groupId ? deploymentOptionMenu(i.guildId, deployment, groupId) : row(button('admin:roleSelector:deploymentContentHint', 'Select a group above to limit its roles', ButtonStyle.Secondary, true)),
      row(button(customId('admin:roleSelector:deploymentOptionsAll', deployment.id, groupId || 'none'), '♻️ Use All Roles for Group', ButtonStyle.Secondary, !groupId)),
      row(button(customId('admin:roleSelector:deploymentOpen', deployment.id), '⬅️ Back'), button('admin:roleSelector:settings', '⚙️ Settings')),
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
  for (const group of usage.groups || []) for (const item of group.rows || []) rows.push({ ...item, groupId: group.id, groupName: group.name, groupEmoji: group.emoji || '🏷️' });
  rows.sort((a, b) => Number(b.count || 0) - Number(a.count || 0));
  const total = rows.reduce((sum, item) => sum + Number(item.count || 0), 0);
  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('📊 Role Selector · Stats').setDescription([
      `**Members using selectors:** ${usage.totalUsing}/${usage.totalMembers}`,
      `**Total selections:** ${total}`, '', '**🏆 Most Selected**',
      rows.filter((x) => x.count).slice(0, 10).map((x, index) => `${index + 1}. ${x.groupEmoji} **${x.label}** — ${x.count} · ${x.groupName}`).join('\n') || '`No selections yet`',
    ].join('\n'))],
    components: [groupMenu(guild.id, null, 'admin:roleSelector:statsGroup'), nav('admin:roleSelector:deployment', true)],
  };
}

async function buildPublicStatsPayload(guild) {
  const usage = await roleSelector.getUsage(guild);
  const rows = [];
  for (const group of usage.groups || []) for (const item of group.rows || []) rows.push({ ...item, groupName: group.name, groupEmoji: group.emoji || '🏷️' });
  rows.sort((a, b) => Number(b.count || 0) - Number(a.count || 0));
  return resolvePayload(guild, {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('📊 Role Selector Leaderboard').setDescription([
      `👥 **Members using selectors:** ${usage.totalUsing}`,
      `🎯 **Total selections:** ${rows.reduce((sum, item) => sum + Number(item.count || 0), 0)}`, '',
      '**🏆 Top Choices**', rows.filter((x) => Number(x.count || 0) > 0).slice(0, 10).map((x, index) => `${index + 1}. ${x.groupEmoji} **${x.label}** — ${x.count}`).join('\n') || '`No selections yet`',
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
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('📊 Role Selector · Deploy Stats').setDescription([
      `**Channel:** ${deployment.channelId ? `<#${deployment.channelId}>` : '`Not selected`'}`,
      `**Message:** ${message ? 'Deployed ✅' : 'Not deployed'}`, '',
      'Deploy a user-visible community leaderboard. Counts update in place; member names remain admin-only.',
    ].join('\n'))],
    components: [row(menu), row(button('admin:roleSelector:statsDeploy', message ? '🔄 Update Stats Panel' : '📨 Deploy Stats Panel', ButtonStyle.Success, !deployment.channelId), jump ? linkButton('↗️ Jump to Panel', jump) : null), nav('admin:roleSelector:deployment', true)],
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
    embeds: [new EmbedBuilder().setColor(health.healthy ? 0x57F287 : 0xFAA61A).setTitle('🩺 Role Selector · Health / Repair').setDescription([
      `**Overall Health:** ${health.healthy ? 'Healthy ✅' : 'Needs Attention ⚠️'}`,
      `**Acceptance:** ${health.acceptance?.ready ? 'Ready ✅' : 'Not Ready ⚠️'}`,
      `**Managed Roles:** ${health.managedRoleCount || 0}`, '',
      '**Issues**', (health.issues || []).length ? (health.issues || []).map((x) => `• ${format(x)}`).join('\n') : '✅ No issues', '',
      '**Warnings**', (health.warnings || []).length ? (health.warnings || []).map((x) => `• ${format(x)}`).join('\n') : '✅ No warnings',
    ].join('\n').slice(0, 4096))],
    components: [row(button('admin:roleSelector:healthCheck', '🔍 Run Check', ButtonStyle.Primary), button('admin:roleSelector:healthRepair', '🛠️ Repair Safe Issues', ButtonStyle.Success)), nav('admin:roleSelector:settings', true)],
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
    row(new TextInputBuilder().setCustomId('format').setLabel('Role name format').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100).setValue(section.style.format || '🎭 | {role}')),
    row(new TextInputBuilder().setCustomId('icon').setLabel('Default icon / prefix').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100).setValue(section.style.icon || '')),
    row(new TextInputBuilder().setCustomId('separator').setLabel('Separator').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(20).setValue(section.style.separator || '|')),
  );
}

function dividerModal() {
  return new ModalBuilder().setCustomId('admin:roleSelector:createDividerSubmit').setTitle('Create Role Selector Divider').addComponents(
    row(new TextInputBuilder().setCustomId('name').setLabel('Divider role name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100).setValue('🎭 | ROLE SELECTOR')),
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
      return i.reply({ content: `✅ Created **${group.name}**.`, ...buildGroupsPanel(i.guildId, group.id), flags: 64 });
    }
    if (id.startsWith('admin:roleSelector:groupOpen:')) return respond(i, buildGroupsPanel(i.guildId, tail(id, 'admin:roleSelector:groupOpen')));
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
      return i.reply({ content: '✅ Selector options saved.', ...buildGroupsPanel(i.guildId, group.id), flags: 64 });
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
      return i.reply({ content: '✅ Role appearance updated.', ...buildAppearance(i.guild), flags: 64 });
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
      return i.reply({ content: `✅ Created divider **${divider.name}**.`, ...buildAppearance(i.guild), flags: 64 });
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
          embeds: [new EmbedBuilder().setColor(0xFAA61A).setTitle('📍 Move this Role Selector panel?').setDescription(`Current: <#${deployment.channelId}>\nNew: <#${target}>\n\nChoose what to do with the old Goliath-owned panel.`)],
          components: [
            row(button(customId('admin:roleSelector:moveRemove', deploymentId, target), '🗑️ Remove Old Panel & Move', ButtonStyle.Danger), button(customId('admin:roleSelector:moveRetire', deploymentId, target), '📦 Retire Old Panel & Move', ButtonStyle.Primary)),
            row(button(customId('admin:roleSelector:deploymentOpen', deploymentId), '⬅️ Back')),
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
      const sent = await deploySelected(i, deploymentId); const payload = await buildDeploymentsPanel(i, deploymentId); payload.content = `✅ Panel moved to <#${sent.channel.id}>.`; return respond(i, payload);
    }
    if (id.startsWith('admin:roleSelector:deploy:')) {
      const deploymentId = tail(id, 'admin:roleSelector:deploy');
      const message = await deploySelected(i, deploymentId); const payload = await buildDeploymentsPanel(i, deploymentId); payload.content = `✅ Role Selector panel deployed in <#${message.channel.id}>.`; return respond(i, payload);
    }
    if (id.startsWith('admin:roleSelector:deploymentDelete:')) {
      const deploymentId = tail(id, 'admin:roleSelector:deploymentDelete');
      await deleteSelectedDeployment(i, deploymentId); return respond(i, await buildDeploymentsPanel(i));
    }

    if (id === 'admin:roleSelector:stats') return respond(i, await buildStats(i.guild));
    if (id === 'admin:roleSelector:statsGroup' && i.values?.[0] !== '__none__') {
      const usage = await roleSelector.getUsage(i.guild, i.values[0]); const group = usage.groups?.[0];
      return respond(i, { embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle(`📊 ${group?.emoji || '🏷️'} ${group?.name || 'Group'}`).setDescription((group?.rows || []).map((x, index) => `${index + 1}. **${x.label}** — ${x.count || 0}`).join('\n') || '`No selections yet`')], components: [nav('admin:roleSelector:deployment', true)] });
    }
    if (id === 'admin:roleSelector:statsPublic') return respond(i, await buildStatsDeploymentPanel(i));
    if (id === 'admin:roleSelector:statsDeploymentChannel') {
      const target = i.values?.[0]; if (!target) throw new Error('Choose a public stats channel.');
      const current = statsDeploymentRecord(roleSelector.getSection(i.guildId));
      roleSelector.updateSection(i.guildId, (section) => ({ ...section, statsDeployment: { channelId: target, messageId: current.channelId === target ? current.messageId : null } }), { ...actor, action: 'role_selector_stats_channel' });
      return respond(i, await buildStatsDeploymentPanel(i));
    }
    if (id === 'admin:roleSelector:statsDeploy') { const message = await deployStats(i); const payload = await buildStatsDeploymentPanel(i); payload.content = `✅ Public stats panel deployed in <#${message.channel.id}>.`; return respond(i, payload); }
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
      if (deployment && !deployment.groupIds.includes(roleSelector.COLOUR_GROUP_ID)) throw new Error('Colours are not available on this panel.');
      await roleSelector.applyColourSelection(i.guild, i.member, i.values[0]);
      await i.update(await resolvePayload(i.guild, memberGroupPayload(i.guild, await freshMember(i), roleSelector.COLOUR_GROUP_ID, deploymentAllowedGroups(i.guildId, deploymentId), deploymentId, deployment)));
      await syncStatsDeploymentState(i.guild).catch(() => null);
      await i.followUp({ content: '✅ Your colour has been updated.', flags: 64 }); return true;
    }
    if (id.startsWith('roleSelector:customHex:')) { await i.showModal(hexModal(tail(id, 'roleSelector:customHex') || 'global')); return true; }
    if (id.startsWith('roleSelector:customHexSubmit:')) { await roleSelector.applyColourSelection(i.guild, i.member, i.fields.getTextInputValue('hex'), i.fields.getTextInputValue('label')); await syncStatsDeploymentState(i.guild).catch(() => null); return i.reply({ content: '✅ Your custom colour has been applied.', flags: 64 }); }
    if (id.startsWith('roleSelector:choose:')) {
      const [groupId, deploymentId = 'global'] = splitTail(id, 'roleSelector:choose');
      const deployment = deploymentId !== 'global' ? deploymentById(i.guildId, deploymentId) : null; const allowed = deploymentAllowedGroups(i.guildId, deploymentId);
      if (allowed && !allowed.includes(groupId)) throw new Error('That group is not available on this panel.');
      const filter = optionFilterFor(deployment, groupId); if (filter && (i.values || []).some((value) => !filter.has(value))) throw new Error('That role is not available on this panel.');
      await roleSelector.applyStandardSelection(i.guild, i.member, groupId, i.values || []);
      await i.update(await resolvePayload(i.guild, memberGroupPayload(i.guild, await freshMember(i), groupId, allowed, deploymentId, deployment)));
      await syncStatsDeploymentState(i.guild).catch(() => null); await i.followUp({ content: '✅ Your role selection has been updated.', flags: 64 }); return true;
    }
    if (id.startsWith('roleSelector:clear:')) {
      const [groupId, deploymentId = 'global'] = splitTail(id, 'roleSelector:clear');
      const deployment = deploymentId !== 'global' ? deploymentById(i.guildId, deploymentId) : null; const allowed = deploymentAllowedGroups(i.guildId, deploymentId);
      if (allowed && !allowed.includes(groupId)) throw new Error('That group is not available on this panel.');
      await roleSelector.clearSelection(i.guild, i.member, groupId);
      await i.update(await resolvePayload(i.guild, memberGroupPayload(i.guild, await freshMember(i), groupId, allowed, deploymentId, deployment)));
      await syncStatsDeploymentState(i.guild).catch(() => null); await i.followUp({ content: '✅ Your selection has been cleared.', flags: 64 }); return true;
    }
    if (id === 'colourRoles:choose') { await roleSelector.applyColourSelection(i.guild, i.member, i.values[0]); await syncStatsDeploymentState(i.guild).catch(() => null); return i.reply({ content: '✅ Your colour has been updated.', flags: 64 }); }
    if (id === 'colourRoles:remove') { await roleSelector.clearSelection(i.guild, i.member, roleSelector.COLOUR_GROUP_ID); await syncStatsDeploymentState(i.guild).catch(() => null); return i.reply({ content: '✅ Your colour has been removed.', flags: 64 }); }
    if (id === 'colourRoles:custom') { await i.showModal(hexModal()); return true; }
    return true;
  } catch (error) {
    console.error('[RoleSelectorPanel]', error);
    const payload = { content: `❌ ${error.message || 'Role Selector failed.'}`, flags: 64 };
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
