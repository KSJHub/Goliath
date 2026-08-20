'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const guildManager = require('../../../core/guild/guildManager');
const security = require('../../../core/security/securityCore');
const emojis = require('../../utilityStudio/emojis/emojis');
const roleSelector = require('./roleSelector');
const healthService = require('./roleSelectorHealth');
const { withDeploymentLock } = require('./roleSelectorLocks');

const sessions = new Map();
const SESSION_TTL_MS = 30 * 60 * 1000;
const SESSION_TIMER_KEY = Symbol.for('goliath.roleSelector.panelSessionTimer');
const row = (...items) => new ActionRowBuilder().addComponents(...items.filter(Boolean));
const button = (id, label, style = ButtonStyle.Secondary, disabled = false) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
const displayName = (interaction) => interaction.member?.displayName || interaction.user?.username || 'Unknown User';
const sessionKey = (interaction) => `${interaction.guildId}:${interaction.user.id}`;
const cleanRoleId = (value) => {
  const id = String(value || '').replace(/[^0-9]/g, '');
  return /^\d{15,25}$/.test(id) ? id : null;
};

if (!globalThis[SESSION_TIMER_KEY]) {
  globalThis[SESSION_TIMER_KEY] = setInterval(() => {
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const [key, value] of sessions) if (Number(value?.touchedAt || 0) < cutoff) sessions.delete(key);
  }, 10 * 60 * 1000);
  globalThis[SESSION_TIMER_KEY].unref?.();
}

function getState(interaction) {
  const key = sessionKey(interaction);
  let current = sessions.get(key) || { groupId: null, touchedAt: Date.now() };
  if (Date.now() - Number(current.touchedAt || 0) > SESSION_TTL_MS) current = { groupId: null, touchedAt: Date.now() };
  const group = current.groupId ? roleSelector.getGroup(interaction.guildId, current.groupId) : null;
  if (current.groupId && !group) current.groupId = null;
  current.touchedAt = Date.now();
  sessions.set(key, current);
  return current;
}
async function respond(interaction, payload) {
  if (interaction.isModalSubmit?.()) return interaction.reply({ ...payload, flags: 64 });
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  return interaction.update(payload);
}
async function resolveComponentShortcodes(guild, components = []) {
  const allowed = await emojis.allowedGuildEmojis(guild.client, guild.id);
  return (components || []).map((entry) => {
    const data = typeof entry?.toJSON === 'function' ? entry.toJSON() : entry;
    if (!data || typeof data !== 'object' || !Array.isArray(data.components)) return entry;
    return {
      ...data,
      components: data.components.map((component) => {
        if (!component || component.type !== 3 || !Array.isArray(component.options)) return component;
        return {
          ...component,
          options: component.options.map((option) => {
            const rawName = String(option?.emoji?.name || '');
            const shortcode = rawName.match(/^:([A-Za-z0-9_]{2,32}):$/);
            if (!shortcode) return option;
            const emoji = allowed.get(shortcode[1].toLowerCase());
            if (emoji) return { ...option, emoji: emojis.componentPayload(emoji) };
            const next = { ...option };
            delete next.emoji;
            return next;
          }),
        };
      }),
    };
  });
}
async function resolveMemberPayload(guild, payload = {}) {
  return {
    ...payload,
    content: payload.content == null ? payload.content : await emojis.resolveText(guild.client, guild.id, payload.content),
    embeds: await emojis.resolveEmbeds(guild.client, guild.id, payload.embeds || []),
    components: await resolveComponentShortcodes(guild, payload.components || []),
  };
}
function customGroups(guildId) { return roleSelector.listGroups(guildId).filter((group) => !group.builtIn); }
function customGroupSelect(guildId, selectedId = null, customId = 'admin:roleSelector:groupSelect') {
  const groups = customGroups(guildId).slice(0, 25);
  const menu = new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder(groups.length ? 'Select a custom group' : 'No custom groups yet').setMinValues(1).setMaxValues(1);
  if (!groups.length) return row(menu.setDisabled(true).addOptions({ label: 'No custom groups yet', value: '__none__', description: 'Create a group first.' }));
  menu.addOptions(groups.map((group) => ({
    label: `${group.emoji || '🏷️'} ${group.name}`.slice(0, 100),
    value: group.id,
    description: `${group.selectionMode === 'multiple' ? 'Multiple choices' : 'Single choice'} · ${group.options?.length || 0} options`.slice(0, 100),
    default: group.id === selectedId,
  })));
  return row(menu);
}

function memberDisabledPayload() {
  return {
    embeds: [new EmbedBuilder()
      .setColor(0x747F8D)
      .setTitle('🎭 Role Selector')
      .setDescription('Role Selector is currently unavailable. An administrator can re-enable it from Role Studio.')],
    components: [],
  };
}
function memberLauncherPayload(guild) {
  if (!guildManager.isModuleEnabled(guild.id, roleSelector.MODULE)) return memberDisabledPayload();
  const groups = roleSelector.listGroups(guild.id).filter(roleSelector.isGroupMemberUsable).slice(0, 25);
  const menu = new StringSelectMenuBuilder().setCustomId('roleSelector:openGroup').setPlaceholder('Choose a category').setMinValues(1).setMaxValues(1);
  if (groups.length) menu.addOptions(groups.map((group) => ({ label: `${group.emoji || '🏷️'} ${group.name}`.slice(0, 100), value: group.id, description: (group.description || (group.selectionMode === 'multiple' ? 'Choose one or more' : 'Choose one')).slice(0, 100) })));
  else menu.setDisabled(true).addOptions({ label: 'No selectors available', value: '__none__' });
  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🎭 Choose Your Roles').setDescription('Choose a category below. Each category manages only its own roles, so changing one selection never removes roles from another category.')],
    components: [row(menu)],
  };
}
function memberGroupPayload(guild, member, groupId) {
  roleSelector.assertModuleEnabled(guild.id);
  const group = roleSelector.getGroup(guild.id, groupId);
  if (!group || !roleSelector.isGroupMemberUsable(group)) throw new Error('That selector is unavailable.');
  const embed = new EmbedBuilder().setColor(0x5865F2).setTitle(`${group.emoji || '🏷️'} ${group.name}`).setDescription([group.description || 'Choose your role.', group.selectionMode === 'multiple' ? 'Select every option that applies.' : 'Select one option.', group.allowRemove ? 'You may clear this category at any time.' : null].filter(Boolean).join('\n'));
  const components = [];
  if (group.type === 'colour') {
    const options = group.palette.filter((item) => item.enabled).sort((a, b) => a.order - b.order).slice(0, 24).map((item) => ({ label: item.label, value: item.hex, emoji: item.emoji || undefined, description: `${item.hex} · ${item.family}`.slice(0, 100) }));
    if (options.length) components.push(row(new StringSelectMenuBuilder().setCustomId('roleSelector:colourChoose').setPlaceholder('Choose a colour').setMinValues(1).setMaxValues(1).addOptions(options)));
    components.push(row(group.customHexEnabled ? button('roleSelector:customHex', '🎨 Pick Your Own', ButtonStyle.Primary) : null, group.allowRemove ? button('roleSelector:clear:colours', '🧹 Clear Selection') : null));
  } else {
    const options = (group.options || []).filter((item) => item.enabled).sort((a, b) => a.order - b.order).slice(0, 25).map((item) => ({ label: item.label, value: item.id, emoji: item.emoji || undefined, description: item.description || undefined, default: Boolean(item.roleId && member?.roles?.cache?.has(item.roleId)) }));
    if (options.length) {
      components.push(row(new StringSelectMenuBuilder()
        .setCustomId(`roleSelector:choose:${group.id}`)
        .setPlaceholder(group.selectionMode === 'multiple' ? 'Choose one or more' : 'Choose one')
        .setMinValues(group.selectionMode === 'multiple' ? 0 : 1)
        .setMaxValues(group.selectionMode === 'multiple' ? options.length : 1)
        .addOptions(options)));
    }
    if (group.allowRemove) components.push(row(button(`roleSelector:clear:${group.id}`, '🧹 Clear Selection')));
  }
  return { embeds: [embed], components: components.filter((item) => item.components.length) };
}

async function buildAdminPanel(guild, requestedBy = 'Unknown User') {
  const section = roleSelector.getSection(guild.id);
  const health = await healthService.buildHealth(guild);
  const usage = await roleSelector.getUsage(guild);
  const enabled = guildManager.isModuleEnabled(guild.id, roleSelector.MODULE);
  return {
    embeds: [new EmbedBuilder().setColor(!enabled ? 0x747F8D : health.healthy ? 0x57F287 : 0xFAA61A).setTitle('🎭 Role Selector').setDescription([
      'Universal self-role categories with Colours built in.', '',
      `**Status:** ${enabled ? 'Enabled ✅' : 'Disabled ❌'}`,
      `**Groups:** ${roleSelector.listGroups(guild.id).length} (${customGroups(guild.id).length} custom)`,
      `**Members using selectors:** ${usage.totalUsing}/${usage.totalMembers}`,
      `**Managed roles:** ${health.managedRoleCount}`,
      `**Format:** \`${roleSelector.roleNameFor(section, 'Example Role')}\``,
      `**Anchor:** ${section.style.anchorRoleId ? `<@&${section.style.anchorRoleId}> (${section.style.placement})` : '`Not set`'}`,
      `**Deployed:** ${section.deployment.channelId ? `<#${section.deployment.channelId}>` : '`Not deployed`'}`,
      `**Acceptance:** ${health.acceptance?.ready ? 'Ready ✅' : `Not ready ⚠️ (${health.acceptance?.failed?.length || 0} blocker(s))`}`,
      '', health.issues.length || health.warnings.length ? `⚠️ ${health.issues.length + health.warnings.length} health issue/warning(s)` : '✅ Health checks passed',
    ].join('\n')).setFooter({ text: `Requested by ${requestedBy}` }).setTimestamp()],
    components: [
      row(button(enabled ? 'admin:roleSelector:disable' : 'admin:roleSelector:enable', enabled ? '⏸ Disable' : '▶ Enable', enabled ? ButtonStyle.Secondary : ButtonStyle.Success), button('admin:roleSelector:groups', '🏷️ Groups', ButtonStyle.Primary), button('admin:roleSelector:colours', '🌈 Colours', ButtonStyle.Primary), button('admin:roleSelector:style', '🎨 Style & Placement', ButtonStyle.Primary), button('admin:roleSelector:stats', '📊 Stats', ButtonStyle.Primary)),
      row(button('admin:roleSelector:createGroup', '➕ Add Group', ButtonStyle.Success), button('admin:roleSelector:deploy', '📨 Deploy Selector', ButtonStyle.Success), button('admin:roleSelector:scanStyle', '🔎 Scan Guild Style'), button('admin:roleSelector:health', '🩺 Health / Repair')),
      row(button('admin:studio:roleStudio', '⬅️ Back to Role Studio')),
    ],
  };
}
function buildGroupsPanel(interaction) {
  const selected = getState(interaction).groupId ? roleSelector.getGroup(interaction.guildId, getState(interaction).groupId) : null;
  const options = selected?.options || [];
  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🏷️ Role Selector · Custom Groups').setDescription(selected ? [
      `**${selected.emoji || '🏷️'} ${selected.name}**`, selected.description || '`No description`',
      `Mode: **${selected.selectionMode === 'multiple' ? 'Multiple choices' : 'Single choice'}** · Clear: **${selected.allowRemove ? 'Allowed' : 'Disabled'}**`, '',
      options.length ? options.map((item) => `${item.enabled ? '✅' : '⬜'} ${item.emoji || '•'} **${item.label}**${item.roleId ? ` · <@&${item.roleId}>${item.managed === false ? ' · existing role' : ''}` : ' · created on first use'}`).join('\n') : '`No options yet`',
    ].join('\n').slice(0, 4096) : 'Create custom categories such as Gaming Platform, Region, Interests, Games or Notification Roles.')],
    components: [customGroupSelect(interaction.guildId, selected?.id), row(button('admin:roleSelector:createGroup', '➕ Add Group', ButtonStyle.Success), button('admin:roleSelector:options', '📝 Options', ButtonStyle.Primary, !selected), button('admin:roleSelector:toggleMode', selected?.selectionMode === 'multiple' ? '☑️ Multiple' : '1️⃣ Single', ButtonStyle.Primary, !selected), button('admin:roleSelector:toggleRemove', selected?.allowRemove ? '🧹 Clear On' : '🧹 Clear Off', ButtonStyle.Secondary, !selected)), row(button('admin:roleSelector:deleteGroup', '🗑️ Delete Group', ButtonStyle.Danger, !selected), button('admin:roleSelector', '⬅️ Back'))],
  };
}
function buildColoursPanel(guild) {
  const group = roleSelector.getGroup(guild.id, roleSelector.COLOUR_GROUP_ID);
  const palette = [...group.palette].sort((a, b) => a.order - b.order).slice(0, 25);
  const menu = new StringSelectMenuBuilder().setCustomId('admin:roleSelector:palette').setPlaceholder('Enabled default colours').setMinValues(0).setMaxValues(Math.max(1, palette.length)).addOptions(palette.map((item) => ({ label: item.label, value: item.id, emoji: item.emoji || undefined, description: item.hex, default: item.enabled })));
  return { embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🌈 Role Selector · Colours').setDescription(['Colours remains the built-in special selector. Custom HEX colours are matched into the rainbow hierarchy.', '', ...palette.map((item) => `${item.enabled ? '✅' : '⬜'} ${item.emoji} **${item.label}** · \`${item.hex}\``), '', `**Custom HEX:** ${group.customHexEnabled ? 'Enabled ✅' : 'Disabled'}`].join('\n'))], components: [row(menu), row(button('admin:roleSelector:toggleHex', group.customHexEnabled ? '🎨 Custom HEX On' : '🎨 Custom HEX Off', group.customHexEnabled ? ButtonStyle.Success : ButtonStyle.Secondary), button('admin:roleSelector', '⬅️ Back'))] };
}
function buildStylePanel(guild) {
  const section = roleSelector.getSection(guild.id);
  return { embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🎨 Role Selector · Style & Placement').setDescription([`**Format:** \`${roleSelector.roleNameFor(section, 'Example Role')}\``, `**Anchor:** ${section.style.anchorRoleId ? `<@&${section.style.anchorRoleId}>${section.style.anchorManaged ? ' · Goliath-managed' : ''}` : '`Not set`'}`, `**Placement:** ${section.style.placement}`, `**Keep grouped:** ${section.style.keepGrouped ? 'Yes ✅' : 'No'}`, section.style.detectedFormat ? `**Detected suggestion:** \`${section.style.detectedFormat}\`` : '**Detected suggestion:** `Not scanned`', '', 'Only Goliath-managed Role Selector roles are automatically repositioned.'].join('\n'))], components: [row(new RoleSelectMenuBuilder().setCustomId('admin:roleSelector:anchor').setPlaceholder('Select divider / anchor role').setMinValues(0).setMaxValues(1)), row(button('admin:roleSelector:createDivider', '➕ Create Divider', ButtonStyle.Success), button('admin:roleSelector:styleOpen', '✏️ Edit Format', ButtonStyle.Primary), button('admin:roleSelector:togglePlacement', section.style.placement === 'above' ? '⬆️ Above' : '⬇️ Below', ButtonStyle.Primary), button('admin:roleSelector:toggleGrouped', section.style.keepGrouped ? '🧲 Grouping On' : '🧲 Grouping Off', section.style.keepGrouped ? ButtonStyle.Success : ButtonStyle.Secondary)), row(section.style.detectedFormat ? button('admin:roleSelector:applyStyle', '✅ Apply Suggestion', ButtonStyle.Success) : null, button('admin:roleSelector', '⬅️ Back'))] };
}
async function buildStatsPanel(guild) {
  const usage = await roleSelector.getUsage(guild);
  return { embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('📊 Role Selector · Stats').setDescription(`Members using at least one selector: **${usage.totalUsing}/${usage.totalMembers}**`).addFields(usage.groups.slice(0, 10).map((group) => ({ name: `${group.emoji || '🏷️'} ${group.name}`, value: group.rows.length ? group.rows.slice(0, 8).map((item, index) => `${index + 1}. **${item.label}** — ${item.count}`).join('\n') : '`No selections yet`' })))], components: [customGroupSelect(guild.id, null, 'admin:roleSelector:statsGroup'), row(button('admin:roleSelector:statsColours', '🌈 Colour Members'), button('admin:roleSelector', '⬅️ Back'))] };
}
async function buildGroupStats(guild, groupId) {
  const usage = await roleSelector.getUsage(guild, groupId); const group = usage.groups[0];
  return { embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle(`📊 ${group?.emoji || '🏷️'} ${group?.name || 'Selector'}`).setDescription(group?.rows?.length ? group.rows.map((item, index) => [`${index + 1}. **${item.label}** — ${item.count}`, item.members.length ? item.members.slice(0, 30).map((member) => `<@${member.id}>`).join(', ') : '`Nobody selected this`'].join('\n')).join('\n\n').slice(0, 4096) : '`No selections yet.`')], components: [row(button('admin:roleSelector:stats', '⬅️ Back to Stats'))] };
}

function createGroupModal() { return new ModalBuilder().setCustomId('admin:roleSelector:createGroupSubmit').setTitle('Create Role Selector Group').addComponents(row(new TextInputBuilder().setCustomId('name').setLabel('Group name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80).setPlaceholder('Gaming Platform')), row(new TextInputBuilder().setCustomId('emoji').setLabel('Emoji / icon').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100).setPlaceholder('🎮 or :emoji_name:')), row(new TextInputBuilder().setCustomId('description').setLabel('Description').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(200)), row(new TextInputBuilder().setCustomId('mode').setLabel('single or multiple').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(8).setValue('single'))); }
function optionsModal(group) { return new ModalBuilder().setCustomId('admin:roleSelector:optionsSubmit').setTitle(`Options · ${group.name}`.slice(0, 45)).addComponents(row(new TextInputBuilder().setCustomId('options').setLabel('emoji | label | description | roleId').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(4000).setValue((group.options || []).map((item) => `${item.emoji || ''} | ${item.label} | ${item.description || ''} | ${item.managed === false ? item.roleId || '' : ''}`).join('\n')).setPlaceholder('🎮 | Xbox | Xbox players |\n:playstation: | PlayStation | PS players | 123456789012345678'))); }
function styleModal(section) { return new ModalBuilder().setCustomId('admin:roleSelector:styleSubmit').setTitle('Role Selector Style').addComponents(row(new TextInputBuilder().setCustomId('format').setLabel('Role format').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100).setValue(section.style.format || '🎭 | {role}').setPlaceholder('♥️ | {role}')), row(new TextInputBuilder().setCustomId('icon').setLabel('Default icon / prefix').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100).setValue(section.style.icon || '')), row(new TextInputBuilder().setCustomId('separator').setLabel('Separator').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(20).setValue(section.style.separator || '|'))); }
function dividerModal() { return new ModalBuilder().setCustomId('admin:roleSelector:createDividerSubmit').setTitle('Create Role Selector Divider').addComponents(row(new TextInputBuilder().setCustomId('name').setLabel('Divider role name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100).setValue('🎭 | ROLE SELECTOR'))); }
function hexModal() { return new ModalBuilder().setCustomId('roleSelector:customHexSubmit').setTitle('Pick Your Own Colour').addComponents(row(new TextInputBuilder().setCustomId('hex').setLabel('HEX colour').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(7).setPlaceholder('#1EA7FF')), row(new TextInputBuilder().setCustomId('label').setLabel('Colour name').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(60).setPlaceholder('Sky Blue'))); }

async function fetchDeployment(guild, deployment) {
  if (!deployment?.channelId) return { channel: null, message: null };
  const channel = guild.channels.cache.get(deployment.channelId) || await guild.channels.fetch(deployment.channelId).catch(() => null);
  if (!channel?.messages?.fetch) return { channel, message: null };
  const message = deployment.messageId ? await channel.messages.fetch(deployment.messageId).catch(() => null) : null;
  return { channel, message };
}
function ownedByGoliath(guild, message) { return Boolean(message && (!guild.client?.user?.id || message.author?.id === guild.client.user.id)); }
async function retireDeploymentUnlocked(guild, deployment) {
  const { message } = await fetchDeployment(guild, deployment);
  if (!ownedByGoliath(guild, message)) return false;
  await message.edit(memberDisabledPayload()).catch(() => null);
  return true;
}
async function syncDeploymentState(guild) {
  return withDeploymentLock(guild.id, async () => {
    const section = roleSelector.getSection(guild.id);
    const { message } = await fetchDeployment(guild, section.deployment);
    if (!message) {
      if (section.deployment?.messageId) roleSelector.updateSection(guild.id, (current) => ({ ...current, deployment: { ...current.deployment, messageId: null } }), { action: 'role_selector_deployment_missing' });
      return { updated: false, reason: section.deployment?.messageId ? 'message_missing' : 'not_deployed' };
    }
    if (!ownedByGoliath(guild, message)) {
      roleSelector.updateSection(guild.id, (current) => ({ ...current, deployment: { ...current.deployment, messageId: null } }), { action: 'role_selector_deployment_not_owned' });
      return { updated: false, reason: 'message_not_owned' };
    }
    await message.edit(await resolveMemberPayload(guild, memberLauncherPayload(guild)));
    return { updated: true, messageId: message.id, channelId: message.channel.id };
  });
}
async function retireDeployment(guild, deployment) {
  return withDeploymentLock(guild.id, () => retireDeploymentUnlocked(guild, deployment));
}
async function deploySelector(interaction) {
  return withDeploymentLock(interaction.guildId, async () => {
    const section = roleSelector.getSection(interaction.guildId);
    const channelId = section.deployment.channelId || interaction.channelId;
    const channel = interaction.guild.channels.cache.get(channelId) || await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.send) throw new Error('Choose a sendable text channel.');

    let message = section.deployment.messageId && section.deployment.channelId === channel.id
      ? await channel.messages.fetch(section.deployment.messageId).catch(() => null)
      : null;

    if (message && !ownedByGoliath(interaction.guild, message)) message = null;
    if (section.deployment.messageId && section.deployment.channelId && section.deployment.channelId !== channel.id) await retireDeploymentUnlocked(interaction.guild, section.deployment);

    const payload = await resolveMemberPayload(interaction.guild, memberLauncherPayload(interaction.guild));
    message = message ? await message.edit(payload) : await channel.send(payload);
    roleSelector.updateSection(interaction.guildId, (current) => ({ ...current, deployment: { channelId: channel.id, messageId: message.id } }), { actorId: interaction.user.id, action: 'role_selector_deploy' });
    return message;
  });
}

async function handleRoleSelectorInteraction(interaction) {
  const id = String(interaction.customId || ''); const actor = { actorId: interaction.user?.id };
  if (!id.startsWith('admin:roleSelector') && !id.startsWith('roleSelector:') && !id.startsWith('admin:colourRoles') && !id.startsWith('colourRoles:')) return false;
  try {
    const adminControl = id.startsWith('admin:roleSelector') || id.startsWith('admin:colourRoles');
    if (adminControl) {
      const access = await security.enforceInteractionSecurity(interaction, { level: 'admin', guildOnly: true });
      if (!access.allowed) return true;
    }

    if (id === 'admin:colourRoles' || id === 'admin:roleSelector' || id === 'admin:roleSelector:home') return respond(interaction, await buildAdminPanel(interaction.guild, displayName(interaction)));
    if (id === 'admin:roleSelector:enable' || id === 'admin:roleSelector:disable') {
      guildManager.setModuleEnabled(interaction.guildId, roleSelector.MODULE, id.endsWith(':enable'), { ...actor, action: id });
      await syncDeploymentState(interaction.guild).catch(() => null);
      return respond(interaction, await buildAdminPanel(interaction.guild, displayName(interaction)));
    }
    if (id === 'admin:roleSelector:groups') return respond(interaction, buildGroupsPanel(interaction));
    if (id === 'admin:roleSelector:colours') return respond(interaction, buildColoursPanel(interaction.guild));
    if (id === 'admin:roleSelector:style') return respond(interaction, buildStylePanel(interaction.guild));
    if (id === 'admin:roleSelector:stats') return respond(interaction, await buildStatsPanel(interaction.guild));
    if (id === 'admin:roleSelector:statsColours') return respond(interaction, await buildGroupStats(interaction.guild, roleSelector.COLOUR_GROUP_ID));
    if (id === 'admin:roleSelector:groupSelect' && interaction.values?.[0] !== '__none__') { getState(interaction).groupId = interaction.values[0]; return respond(interaction, buildGroupsPanel(interaction)); }
    if (id === 'admin:roleSelector:statsGroup' && interaction.values?.[0] !== '__none__') return respond(interaction, await buildGroupStats(interaction.guild, interaction.values[0]));
    if (id === 'admin:roleSelector:createGroup') { await interaction.showModal(createGroupModal()); return true; }
    if (id === 'admin:roleSelector:createGroupSubmit') {
      const group = await roleSelector.saveGroupSafe(interaction.guild, { name: interaction.fields.getTextInputValue('name'), emoji: interaction.fields.getTextInputValue('emoji'), description: interaction.fields.getTextInputValue('description'), selectionMode: interaction.fields.getTextInputValue('mode').trim().toLowerCase() === 'multiple' ? 'multiple' : 'single', allowRemove: true, options: [] }, { ...actor, action: 'role_selector_create_group' });
      getState(interaction).groupId = group.id;
      return interaction.reply({ content: `✅ Created **${group.name}**.`, ...buildGroupsPanel(interaction), flags: 64 });
    }
    if (id === 'admin:roleSelector:options') { const group = roleSelector.getGroup(interaction.guildId, getState(interaction).groupId); if (!group) throw new Error('Select a custom group first.'); await interaction.showModal(optionsModal(group)); return true; }
    if (id === 'admin:roleSelector:optionsSubmit') {
      const group = roleSelector.getGroup(interaction.guildId, getState(interaction).groupId); if (!group) throw new Error('Select a custom group first.');
      const byLabel = new Map((group.options || []).map((item) => [item.label.toLowerCase(), item]));
      const options = interaction.fields.getTextInputValue('options').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 25).map((line, index) => {
        const [emoji, label, description, roleIdRaw] = line.split('|').map((part) => part.trim()); if (!label) throw new Error(`Option ${index + 1} needs a label.`);
        const previous = byLabel.get(label.toLowerCase()); const existingRoleId = cleanRoleId(roleIdRaw);
        return { ...(previous || {}), id: previous?.id, emoji, label, description, roleId: existingRoleId || previous?.roleId || null, managed: existingRoleId ? false : previous?.managed !== false, enabled: true, order: (index + 1) * 10 };
      });
      for (const option of options) {
        if (!option.roleId || option.managed !== false) continue;
        const role = interaction.guild.roles.cache.get(option.roleId) || await interaction.guild.roles.fetch(option.roleId).catch(() => null);
        roleSelector.assertSafeSelectorRole(interaction.guild, role);
      }
      await roleSelector.saveGroupSafe(interaction.guild, { ...group, options }, { ...actor, action: 'role_selector_update_options' });
      return interaction.reply({ content: '✅ Selector options saved.', ...buildGroupsPanel(interaction), flags: 64 });
    }
    if (id === 'admin:roleSelector:toggleMode') { const group = roleSelector.getGroup(interaction.guildId, getState(interaction).groupId); if (!group) throw new Error('Select a group first.'); await roleSelector.saveGroupSafe(interaction.guild, { ...group, selectionMode: group.selectionMode === 'multiple' ? 'single' : 'multiple' }, { ...actor, action: 'role_selector_toggle_mode' }); return respond(interaction, buildGroupsPanel(interaction)); }
    if (id === 'admin:roleSelector:toggleRemove') { const group = roleSelector.getGroup(interaction.guildId, getState(interaction).groupId); if (!group) throw new Error('Select a group first.'); await roleSelector.saveGroupSafe(interaction.guild, { ...group, allowRemove: !group.allowRemove }, { ...actor, action: 'role_selector_toggle_remove' }); return respond(interaction, buildGroupsPanel(interaction)); }
    if (id === 'admin:roleSelector:deleteGroup') {
      const group = roleSelector.getGroup(interaction.guildId, getState(interaction).groupId); if (!group) throw new Error('Select a group first.');
      const result = await roleSelector.deleteManagedGroupRoles(interaction.guild, group.id);
      if (result.unresolved) {
        const names = result.unresolvedRoles.map((item) => `@${item.name}`).join(', ');
        throw new Error(`Group not deleted because ${result.unresolved} Goliath-managed role(s) could not be removed${names ? `: ${names}` : '.'}. Move them below Goliath or fix Manage Roles, then retry.`);
      }
      roleSelector.removeGroup(interaction.guildId, group.id, { ...actor, action: 'role_selector_delete_group' }); getState(interaction).groupId = null; return respond(interaction, buildGroupsPanel(interaction));
    }
    if (id === 'admin:roleSelector:palette') { const group = roleSelector.getGroup(interaction.guildId, roleSelector.COLOUR_GROUP_ID); const selected = new Set(interaction.values || []); await roleSelector.saveGroupSafe(interaction.guild, { ...group, palette: group.palette.map((item) => ({ ...item, enabled: selected.has(item.id) })) }, { ...actor, action: 'role_selector_palette' }); return respond(interaction, buildColoursPanel(interaction.guild)); }
    if (id === 'admin:roleSelector:toggleHex') { const group = roleSelector.getGroup(interaction.guildId, roleSelector.COLOUR_GROUP_ID); await roleSelector.saveGroupSafe(interaction.guild, { ...group, customHexEnabled: !group.customHexEnabled }, { ...actor, action: 'role_selector_hex_toggle' }); return respond(interaction, buildColoursPanel(interaction.guild)); }
    if (id === 'admin:roleSelector:styleOpen') { await interaction.showModal(styleModal(roleSelector.getSection(interaction.guildId))); return true; }
    if (id === 'admin:roleSelector:styleSubmit') { roleSelector.updateSection(interaction.guildId, (current) => ({ ...current, style: { ...current.style, format: interaction.fields.getTextInputValue('format'), icon: interaction.fields.getTextInputValue('icon'), separator: interaction.fields.getTextInputValue('separator') || '|' } }), { ...actor, action: 'role_selector_style' }); await roleSelector.syncManagedRoleAppearance(interaction.guild); return interaction.reply({ content: '✅ Role style updated.', flags: 64 }); }
    if (id === 'admin:roleSelector:createDivider') { await interaction.showModal(dividerModal()); return true; }
    if (id === 'admin:roleSelector:createDividerSubmit') {
      const divider = await interaction.guild.roles.create({ name: interaction.fields.getTextInputValue('name').trim().slice(0, 100), permissions: [], hoist: false, mentionable: false, reason: 'Goliath Role Selector divider' });
      try { await roleSelector.setAnchorRole(interaction.guild, divider.id, { managed: true, meta: { ...actor, action: 'role_selector_create_divider' } }); }
      catch (error) { await divider.delete('Unsafe Role Selector divider').catch(() => null); throw error; }
      return interaction.reply({ content: `✅ Created divider **${divider.name}**.`, flags: 64 });
    }
    if (id === 'admin:roleSelector:anchor') { await roleSelector.setAnchorRole(interaction.guild, interaction.values?.[0] || null, { managed: false, meta: { ...actor, action: 'role_selector_anchor' } }); return respond(interaction, buildStylePanel(interaction.guild)); }
    if (id === 'admin:roleSelector:togglePlacement') { roleSelector.updateSection(interaction.guildId, (current) => ({ ...current, style: { ...current.style, placement: current.style.placement === 'above' ? 'below' : 'above' } }), { ...actor, action: 'role_selector_placement' }); await roleSelector.syncManagedRoleHierarchy(interaction.guild); return respond(interaction, buildStylePanel(interaction.guild)); }
    if (id === 'admin:roleSelector:toggleGrouped') { roleSelector.updateSection(interaction.guildId, (current) => ({ ...current, style: { ...current.style, keepGrouped: !current.style.keepGrouped } }), { ...actor, action: 'role_selector_grouping' }); await roleSelector.syncManagedRoleHierarchy(interaction.guild); return respond(interaction, buildStylePanel(interaction.guild)); }
    if (id === 'admin:roleSelector:scanStyle') { const suggestion = roleSelector.suggestRoleStyle(interaction.guild); roleSelector.updateSection(interaction.guildId, (current) => ({ ...current, style: { ...current.style, detectedFormat: suggestion.format, detectedIcon: suggestion.icon, detectedSeparator: suggestion.separator, detectedConfidence: suggestion.confidence } }), { ...actor, action: 'role_selector_style_scan' }); return respond(interaction, buildStylePanel(interaction.guild)); }
    if (id === 'admin:roleSelector:applyStyle') { roleSelector.updateSection(interaction.guildId, (current) => ({ ...current, style: { ...current.style, format: current.style.detectedFormat || current.style.format, icon: current.style.detectedIcon || '', separator: current.style.detectedSeparator || current.style.separator } }), { ...actor, action: 'role_selector_style_apply' }); await roleSelector.syncManagedRoleAppearance(interaction.guild); return respond(interaction, buildStylePanel(interaction.guild)); }
    if (id === 'admin:roleSelector:deploy') { const message = await deploySelector(interaction); return interaction.reply({ content: `✅ Role Selector deployed in <#${message.channel.id}>.`, flags: 64 }); }
    if (id === 'admin:roleSelector:health') {
      const health = await healthService.repair(interaction.guild);
      const failedChecks = (health.acceptance?.checks || []).filter((check) => !check.passed);
      const blockers = failedChecks.length ? failedChecks.slice(0, 7).map((check) => `• ${check.detail}`).join('\n') : '• No acceptance blockers detected.';
      return interaction.reply({ content: [`Role Selector health: **${health.healthy ? 'Healthy ✅' : 'Needs attention ⚠️'}**`, `Issues: ${health.issues.length} · Warnings: ${health.warnings.length}`, `Acceptance: **${health.acceptance?.ready ? 'Ready ✅' : 'Not ready ⚠️'}**`, blockers].join('\n'), flags: 64 });
    }

    if (id.startsWith('roleSelector:')) roleSelector.assertModuleEnabled(interaction.guildId);
    if (id === 'roleSelector:openGroup') { if (interaction.values?.[0] === '__none__') return interaction.reply({ content: 'No selector groups are available.', flags: 64 }); return interaction.reply({ ...(await resolveMemberPayload(interaction.guild, memberGroupPayload(interaction.guild, interaction.member, interaction.values[0]))), flags: 64 }); }
    if (id === 'roleSelector:colourChoose') { await roleSelector.applyColourSelection(interaction.guild, interaction.member, interaction.values[0]); return interaction.reply({ content: '✅ Your colour has been updated.', flags: 64 }); }
    if (id === 'roleSelector:customHex') { await interaction.showModal(hexModal()); return true; }
    if (id === 'roleSelector:customHexSubmit') { await roleSelector.applyColourSelection(interaction.guild, interaction.member, interaction.fields.getTextInputValue('hex'), interaction.fields.getTextInputValue('label')); return interaction.reply({ content: '✅ Your custom colour has been applied.', flags: 64 }); }
    if (id.startsWith('roleSelector:choose:')) { await roleSelector.applyStandardSelection(interaction.guild, interaction.member, id.split(':').slice(2).join(':'), interaction.values || []); return interaction.reply({ content: '✅ Your role selection has been updated.', flags: 64 }); }
    if (id.startsWith('roleSelector:clear:')) { await roleSelector.clearSelection(interaction.guild, interaction.member, id.split(':').slice(2).join(':')); return interaction.reply({ content: '✅ Your selection has been cleared.', flags: 64 }); }

    if (id.startsWith('colourRoles:')) roleSelector.assertModuleEnabled(interaction.guildId);
    if (id === 'colourRoles:choose') { await roleSelector.applyColourSelection(interaction.guild, interaction.member, interaction.values[0]); return interaction.reply({ content: '✅ Your colour has been updated.', flags: 64 }); }
    if (id === 'colourRoles:remove') { await roleSelector.clearSelection(interaction.guild, interaction.member, roleSelector.COLOUR_GROUP_ID); return interaction.reply({ content: '✅ Your colour has been removed.', flags: 64 }); }
    if (id === 'colourRoles:custom') { await interaction.showModal(hexModal()); return true; }
    return true;
  } catch (error) {
    console.error('[RoleSelectorPanel]', error);
    const payload = { content: `❌ ${error.message || 'Role Selector failed.'}`, flags: 64 };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => null);
    else await interaction.reply(payload).catch(() => null);
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