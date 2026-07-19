'use strict';

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
} = require('discord.js');

const reactionRoles = require('./reactionRoles');
const previousPanel = require('./reactionRolesPanelV6');

const selectedMappings = new Map();
const keyFor = (guildId, userId) => `${guildId}:${userId}`;
const row = (...items) => new ActionRowBuilder().addComponents(...items.filter(Boolean));
const button = (id, label, style = ButtonStyle.Secondary, disabled = false) => new ButtonBuilder()
  .setCustomId(id).setLabel(label).setStyle(style).setDisabled(Boolean(disabled));

function displayName(interaction) {
  return interaction.member?.displayName || interaction.user?.username || 'Unknown User';
}

function modeLabel(mode) {
  if (mode === reactionRoles.MODES.ADD) return 'Add only';
  if (mode === reactionRoles.MODES.REMOVE) return 'Remove role';
  return 'Add + remove on unreact';
}

function currentSelection(guildId, userId, draft) {
  const key = keyFor(guildId, userId);
  const selectedId = selectedMappings.get(key);
  const selected = draft.mappings.find((mapping) => mapping.mappingId === selectedId) || draft.mappings[0] || null;
  if (selected) selectedMappings.set(key, selected.mappingId);
  else selectedMappings.delete(key);
  return selected;
}

function mappingList(draft, guild) {
  if (!draft.mappings.length) return '> No mappings yet. Choose a role, choose the behaviour, then press **Add Emoji**.';
  return draft.mappings.map((mapping, index) => {
    const role = guild.roles.cache.get(mapping.roleId);
    return `**${index + 1}. ${mapping.emoji}** → ${role ? `<@&${role.id}>` : `\`${mapping.roleId}\``}\n└ ${modeLabel(mapping.mode)}`;
  }).join('\n\n');
}

function mappingSelect(draft, selectedId) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('admin:reactionRoles:smart:mapping')
    .setPlaceholder(draft.mappings.length ? 'Select a mapping to edit' : 'No mappings available')
    .setMinValues(1).setMaxValues(1).setDisabled(!draft.mappings.length);
  menu.addOptions(draft.mappings.length ? draft.mappings.slice(0, 25).map((mapping, index) => ({
    label: `${index + 1}. ${mapping.emoji}`.slice(0, 100),
    description: `${modeLabel(mapping.mode)} • ${mapping.roleId}`.slice(0, 100),
    value: mapping.mappingId,
    default: mapping.mappingId === selectedId,
  })) : [{ label: 'Add a mapping first', value: 'none' }]);
  return menu;
}

function addModeSelect(mode) {
  return new StringSelectMenuBuilder()
    .setCustomId('admin:reactionRoles:smart:add-mode')
    .setPlaceholder('Choose assignment behaviour')
    .addOptions([
      { label: 'Add + remove on unreact', value: reactionRoles.MODES.TOGGLE, default: mode === reactionRoles.MODES.TOGGLE },
      { label: 'Add only', value: reactionRoles.MODES.ADD, default: mode === reactionRoles.MODES.ADD },
      { label: 'Remove role', value: reactionRoles.MODES.REMOVE, default: mode === reactionRoles.MODES.REMOVE },
    ]);
}

function editModeSelect(mode) {
  return new StringSelectMenuBuilder()
    .setCustomId('admin:reactionRoles:smart:edit-mode')
    .setPlaceholder('Change selected mapping behaviour')
    .addOptions([
      { label: 'Add + remove on unreact', value: reactionRoles.MODES.TOGGLE, default: mode === reactionRoles.MODES.TOGGLE },
      { label: 'Add only', value: reactionRoles.MODES.ADD, default: mode === reactionRoles.MODES.ADD },
      { label: 'Remove role', value: reactionRoles.MODES.REMOVE, default: mode === reactionRoles.MODES.REMOVE },
    ]);
}

function templateSelect(guildId, selectedId) {
  const templates = reactionRoles.listReactionTemplates(guildId).slice(0, 25);
  const menu = new StringSelectMenuBuilder()
    .setCustomId('admin:reactionRoles:smart:template')
    .setPlaceholder(templates.length ? 'Choose an Embed Studio template' : 'No Role Studio templates found')
    .setMinValues(1).setMaxValues(1).setDisabled(!templates.length);
  menu.addOptions(templates.length ? templates.map((template) => ({
    label: String(template.name || template.templateId).slice(0, 100),
    description: String(template.embed?.title || 'Embed Studio template').slice(0, 100),
    value: String(template.templateId),
    default: String(template.templateId) === String(selectedId),
  })) : [{ label: 'Create a template in Embed Studio first', value: 'none' }]);
  return menu;
}

function deploymentSelect(guildId) {
  const panels = reactionRoles.listPanels(guildId).slice(0, 25);
  const menu = new StringSelectMenuBuilder()
    .setCustomId('admin:reactionRoles:manage:panel')
    .setPlaceholder(panels.length ? '📂 Manage a deployment' : 'No deployments yet')
    .setMinValues(1).setMaxValues(1).setDisabled(!panels.length);
  menu.addOptions(panels.length ? panels.map((panel) => ({
    label: String(panel.name || panel.panelId).slice(0, 100),
    description: `${panel.enabled === false ? 'Disabled' : 'Enabled'} • ${panel.mappings.length} mapping(s)`.slice(0, 100),
    value: panel.panelId,
  })) : [{ label: 'Create or attach a panel to begin', value: 'none' }]);
  return menu;
}

async function buildOverview(guild, memberDisplayName = 'Unknown User') {
  const config = reactionRoles.getSection(guild.id);
  const health = await reactionRoles.buildHealth(guild);
  const panels = reactionRoles.listPanels(guild.id);
  const mappings = panels.reduce((total, panel) => total + panel.mappings.length, 0);
  const hasSetup = Object.keys(config.drafts || {}).length > 0;
  const analytics = config.analytics || {};
  const embed = new EmbedBuilder()
    .setColor(config.enabled !== false && health.healthy ? 0x57f287 : 0xfaa61a)
    .setTitle('🎭 Role Studio')
    .setDescription([
      `### ${config.enabled !== false ? '🟢 Online' : '⏸️ Disabled'} • ${health.healthy ? 'Healthy' : `${health.unhealthy || 0} need attention`}`,
      `**Deployments** \`${panels.length}\` • **Mappings** \`${mappings}\` • **Assigned** \`${analytics.assigned || 0}\` • **Removed** \`${analytics.removed || 0}\` • **Failed** \`${analytics.failed || 0}\``,
      '',
      '**Attach roles to any accessible message or build a new panel through Embed Studio.**',
      'Your active setup is saved automatically and reopens exactly where you left it.',
      '',
      '> Existing text, embeds, components and unrelated reactions are preserved.',
    ].join('\n'))
    .setFooter({ text: `Requested by ${memberDisplayName}` })
    .setTimestamp();
  return {
    embeds: [embed],
    components: [
      row(
        button('admin:reactionRoles:new:existing', 'Attach Existing Message', ButtonStyle.Primary),
        button('admin:reactionRoles:new:template', 'Create New Panel', ButtonStyle.Success),
        button('admin:reactionRoles:continue', hasSetup ? 'Open Builder' : 'Builder', ButtonStyle.Secondary, !hasSetup),
      ),
      row(deploymentSelect(guild.id)),
      row(
        button('admin:reactionRoles:admin', 'Admin Centre', ButtonStyle.Primary),
        button('admin:modules', 'Back to Modules'),
      ),
    ],
  };
}

function buildSmartBuilder(guild, userId) {
  const draft = reactionRoles.getDraft(guild.id, userId);
  if (!draft) throw new Error('No active setup exists. Start by attaching a message or creating a panel.');
  const existing = draft.type === reactionRoles.DRAFT_TYPES.EXISTING;
  if (existing && (!draft.channelId || !draft.messageId)) return null;
  const selectedRole = draft.selectedRoleId ? guild.roles.cache.get(draft.selectedRoleId) : null;
  const target = existing
    ? `<#${draft.channelId}> • \`${draft.messageId}\``
    : `${draft.channelId ? `<#${draft.channelId}>` : 'Channel not selected'} • ${draft.templateId ? `\`${draft.templateId}\`` : 'Template not selected'}`;
  const ready = Boolean(draft.channelId && (existing ? draft.messageId : draft.templateId) && draft.mappings.length);
  const embed = new EmbedBuilder()
    .setColor(ready ? 0x57f287 : 0x5865f2)
    .setTitle('🎭 Role Studio Builder')
    .setDescription([
      `**Target:** ${target}`,
      existing ? '**Source message remains unchanged.**' : '**Embed Studio controls the new panel presentation.**',
      '',
      `### Current mappings (${draft.mappings.length})`,
      mappingList(draft, guild),
      '',
      `**Next role:** ${selectedRole ? `<@&${selectedRole.id}>` : 'Choose a role below'}`,
      `**Behaviour:** ${modeLabel(draft.selectedMode)}`,
      '',
      ready ? '✅ Ready for final review.' : 'Add at least one mapping and complete the target settings.',
    ].join('\n').slice(0, 4096));

  const components = [];
  if (!existing) {
    components.push(row(new ChannelSelectMenuBuilder()
      .setCustomId('admin:reactionRoles:smart:channel')
      .setPlaceholder(draft.channelId ? 'Change target channel' : 'Choose target channel')
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setMinValues(1).setMaxValues(1)));
    components.push(row(templateSelect(guild.id, draft.templateId)));
  }
  components.push(row(new RoleSelectMenuBuilder()
    .setCustomId('admin:reactionRoles:smart:add-role')
    .setPlaceholder(selectedRole ? `Next role: ${selectedRole.name}` : 'Choose the next role')
    .setMinValues(1).setMaxValues(1)));
  components.push(row(addModeSelect(draft.selectedMode)));
  components.push(row(
    button('admin:reactionRoles:wizard:emoji', 'Add Emoji', ButtonStyle.Success, !draft.selectedRoleId),
    button('admin:reactionRoles:smart:manage', `Manage Mappings (${draft.mappings.length})`, ButtonStyle.Primary, !draft.mappings.length),
    button('admin:reactionRoles:wizard:deploy', 'Review & Deploy', ButtonStyle.Success, !ready),
    existing ? button('admin:reactionRoles:source', 'Change Message') : null,
    button('admin:reactionRoles:smart:exit', 'Exit Studio'),
  ));
  return { embeds: [embed], components };
}

function buildMappingManager(guild, userId) {
  const draft = reactionRoles.getDraft(guild.id, userId);
  if (!draft?.mappings?.length) return buildSmartBuilder(guild, userId);
  const selected = currentSelection(guild.id, userId, draft);
  const role = guild.roles.cache.get(selected.roleId);
  const index = draft.mappings.findIndex((mapping) => mapping.mappingId === selected.mappingId);
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🧩 Mapping Manager')
    .setDescription([
      `### Selected mapping ${index + 1} of ${draft.mappings.length}`,
      `**Emoji:** ${selected.emoji}`,
      `**Role:** ${role ? `<@&${role.id}>` : `\`${selected.roleId}\``}`,
      `**Behaviour:** ${modeLabel(selected.mode)}`,
      '',
      'Select another mapping or edit this one directly below.',
    ].join('\n'));
  return {
    embeds: [embed],
    components: [
      row(mappingSelect(draft, selected.mappingId)),
      row(new RoleSelectMenuBuilder()
        .setCustomId('admin:reactionRoles:smart:edit-role')
        .setPlaceholder(role ? `Change role: ${role.name}` : 'Change selected mapping role')
        .setMinValues(1).setMaxValues(1)),
      row(editModeSelect(selected.mode)),
      row(
        button('admin:reactionRoles:smart:edit-emoji', 'Edit Emoji', ButtonStyle.Primary),
        button('admin:reactionRoles:smart:duplicate', 'Duplicate'),
        button('admin:reactionRoles:smart:up', 'Move Up', ButtonStyle.Secondary, index <= 0),
        button('admin:reactionRoles:smart:down', 'Move Down', ButtonStyle.Secondary, index >= draft.mappings.length - 1),
        button('admin:reactionRoles:smart:delete', 'Delete', ButtonStyle.Danger),
      ),
      row(
        button('admin:reactionRoles:smart:back', 'Back to Builder', ButtonStyle.Primary),
        button('admin:reactionRoles:wizard:deploy', 'Review & Deploy', ButtonStyle.Success),
        button('admin:reactionRoles:smart:exit', 'Exit Studio'),
      ),
    ],
  };
}

function editEmojiModal(mapping) {
  const input = new TextInputBuilder()
    .setCustomId('emoji')
    .setLabel('Emoji')
    .setPlaceholder('⭐ or <:name:emoji_id>')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setValue(String(mapping.emoji || ''));
  return new ModalBuilder()
    .setCustomId('admin:reactionRoles:smart:edit-emoji:submit')
    .setTitle('Edit Mapping Emoji')
    .addComponents(row(input));
}

function replaceMapping(guild, userId, mappingId, patch) {
  const draft = reactionRoles.getDraft(guild.id, userId);
  const mappings = draft.mappings.map((mapping) => mapping.mappingId === mappingId
    ? { ...mapping, ...patch, updatedAt: new Date().toISOString() }
    : mapping);
  reactionRoles.saveDraft(guild.id, userId, { mappings }, guild);
}

function reorderMapping(guild, userId, mappingId, offset) {
  const draft = reactionRoles.getDraft(guild.id, userId);
  const mappings = [...draft.mappings];
  const index = mappings.findIndex((mapping) => mapping.mappingId === mappingId);
  const next = index + offset;
  if (index < 0 || next < 0 || next >= mappings.length) return;
  [mappings[index], mappings[next]] = [mappings[next], mappings[index]];
  reactionRoles.saveDraft(guild.id, userId, { mappings }, guild);
}

async function respond(interaction, payload) {
  const clean = { ...payload };
  delete clean.ephemeral;
  if (interaction.isModalSubmit?.() && (typeof interaction.isFromMessage !== 'function' || interaction.isFromMessage())) return interaction.update(clean);
  if (interaction.deferred || interaction.replied) return interaction.editReply(clean);
  if (interaction.isButton?.() || interaction.isAnySelectMenu?.()) return interaction.update(clean);
  return interaction.reply({ ...clean, ephemeral: true });
}

async function handleReactionRolesAdminInteraction(interaction) {
  const id = String(interaction.customId || '');
  if (!id.startsWith('admin:reactionRoles')) return false;
  const guild = interaction.guild;
  const userId = interaction.user.id;
  const selectionKey = keyFor(guild.id, userId);

  if (id === 'admin:reactionRoles') return respond(interaction, await buildOverview(guild, displayName(interaction)));

  if (interaction.isModalSubmit?.() && id === 'admin:reactionRoles:wizard:emoji:submit') {
    const draft = reactionRoles.getDraft(guild.id, userId);
    reactionRoles.addDraftMapping(guild.id, userId, {
      emoji: interaction.fields.getTextInputValue('emoji'),
      roleId: draft.selectedRoleId,
      mode: draft.selectedMode,
      removeOnUnreact: draft.selectedMode === reactionRoles.MODES.TOGGLE,
    }, guild);
    reactionRoles.saveDraft(guild.id, userId, { selectedRoleId: null }, guild);
    return respond(interaction, buildSmartBuilder(guild, userId));
  }

  if (interaction.isModalSubmit?.() && id === 'admin:reactionRoles:smart:edit-emoji:submit') {
    const draft = reactionRoles.getDraft(guild.id, userId);
    const selected = currentSelection(guild.id, userId, draft);
    replaceMapping(guild, userId, selected.mappingId, { emoji: interaction.fields.getTextInputValue('emoji') });
    return respond(interaction, buildMappingManager(guild, userId));
  }

  if (id === 'admin:reactionRoles:continue' || id === 'admin:reactionRoles:smart:back') {
    const payload = buildSmartBuilder(guild, userId);
    if (payload) return respond(interaction, payload);
  }

  if (interaction.isRoleSelectMenu?.() && id === 'admin:reactionRoles:smart:add-role') {
    reactionRoles.saveDraft(guild.id, userId, { selectedRoleId: interaction.values[0] }, guild);
    return respond(interaction, buildSmartBuilder(guild, userId));
  }
  if (interaction.isStringSelectMenu?.() && id === 'admin:reactionRoles:smart:add-mode') {
    reactionRoles.saveDraft(guild.id, userId, { selectedMode: interaction.values[0] }, guild);
    return respond(interaction, buildSmartBuilder(guild, userId));
  }
  if (interaction.isChannelSelectMenu?.() && id === 'admin:reactionRoles:smart:channel') {
    reactionRoles.saveDraft(guild.id, userId, { channelId: interaction.values[0] }, guild);
    return respond(interaction, buildSmartBuilder(guild, userId));
  }
  if (interaction.isStringSelectMenu?.() && id === 'admin:reactionRoles:smart:template') {
    reactionRoles.saveDraft(guild.id, userId, { templateId: interaction.values[0] }, guild);
    return respond(interaction, buildSmartBuilder(guild, userId));
  }

  if (id === 'admin:reactionRoles:smart:manage') return respond(interaction, buildMappingManager(guild, userId));
  if (interaction.isStringSelectMenu?.() && id === 'admin:reactionRoles:smart:mapping') {
    selectedMappings.set(selectionKey, interaction.values[0]);
    return respond(interaction, buildMappingManager(guild, userId));
  }

  if (interaction.isRoleSelectMenu?.() && id === 'admin:reactionRoles:smart:edit-role') {
    const draft = reactionRoles.getDraft(guild.id, userId);
    const selected = currentSelection(guild.id, userId, draft);
    replaceMapping(guild, userId, selected.mappingId, { roleId: interaction.values[0] });
    return respond(interaction, buildMappingManager(guild, userId));
  }
  if (interaction.isStringSelectMenu?.() && id === 'admin:reactionRoles:smart:edit-mode') {
    const draft = reactionRoles.getDraft(guild.id, userId);
    const selected = currentSelection(guild.id, userId, draft);
    replaceMapping(guild, userId, selected.mappingId, {
      mode: interaction.values[0],
      removeOnUnreact: interaction.values[0] === reactionRoles.MODES.TOGGLE,
    });
    return respond(interaction, buildMappingManager(guild, userId));
  }

  if (id === 'admin:reactionRoles:smart:edit-emoji') {
    const draft = reactionRoles.getDraft(guild.id, userId);
    const selected = currentSelection(guild.id, userId, draft);
    await interaction.showModal(editEmojiModal(selected));
    return true;
  }

  if (id === 'admin:reactionRoles:smart:duplicate') {
    const draft = reactionRoles.getDraft(guild.id, userId);
    const selected = currentSelection(guild.id, userId, draft);
    const duplicate = { ...selected, mappingId: `rr_map_${Date.now().toString(36)}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const mappings = [...draft.mappings];
    const index = mappings.findIndex((mapping) => mapping.mappingId === selected.mappingId);
    mappings.splice(index + 1, 0, duplicate);
    reactionRoles.saveDraft(guild.id, userId, { mappings }, guild);
    selectedMappings.set(selectionKey, duplicate.mappingId);
    return respond(interaction, buildMappingManager(guild, userId));
  }

  if (id === 'admin:reactionRoles:smart:up' || id === 'admin:reactionRoles:smart:down') {
    const draft = reactionRoles.getDraft(guild.id, userId);
    const selected = currentSelection(guild.id, userId, draft);
    reorderMapping(guild, userId, selected.mappingId, id.endsWith(':up') ? -1 : 1);
    return respond(interaction, buildMappingManager(guild, userId));
  }

  if (id === 'admin:reactionRoles:smart:delete') {
    const draft = reactionRoles.getDraft(guild.id, userId);
    const selected = currentSelection(guild.id, userId, draft);
    reactionRoles.removeDraftMapping(guild.id, userId, selected.mappingId, guild);
    selectedMappings.delete(selectionKey);
    const nextDraft = reactionRoles.getDraft(guild.id, userId);
    return respond(interaction, nextDraft.mappings.length ? buildMappingManager(guild, userId) : buildSmartBuilder(guild, userId));
  }

  if (id === 'admin:reactionRoles:smart:exit') return respond(interaction, await buildOverview(guild, displayName(interaction)));

  return previousPanel.handleReactionRolesAdminInteraction(interaction);
}

module.exports = {
  buildReactionRolesAdminPanel: buildOverview,
  handleReactionRolesAdminInteraction,
};
