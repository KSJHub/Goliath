'use strict';

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
} = require('discord.js');

const guildManager = require('../../../core/guild/guildManager');
const {
  buildRolePicker,
  mergeRolePickerSelection,
  parseRolePickerId,
  rolePickerCustomId,
  rolePickerPageCount,
} = require('../../../core/ui/panelNavigation');
const { getAllEmbedDeployments } = require('../../messageStudio/embed/embedDeployments');
const reactionRoles = require('./reactionRoles');
const reactionRolesHealth = require('./reactionRolesHealth');

const row = (...components) => new ActionRowBuilder().addComponents(...components.filter(Boolean));
const button = (customId, label, style = ButtonStyle.Secondary, disabled = false) => new ButtonBuilder()
  .setCustomId(customId)
  .setLabel(label)
  .setStyle(style)
  .setDisabled(Boolean(disabled));
const displayName = (interaction) => interaction.member?.displayName || interaction.user?.username || 'Unknown User';
const noticeLine = (notice) => notice ? `> ${notice}` : null;

function modeLabel(mode) {
  if (mode === reactionRoles.MODES.ADD) return 'Add only';
  if (mode === reactionRoles.MODES.REMOVE) return 'Remove only';
  return 'Toggle role';
}

function modeResult(mode) {
  if (mode === reactionRoles.MODES.ADD) return 'React adds the role; removing the reaction keeps it.';
  if (mode === reactionRoles.MODES.REMOVE) return 'React removes the role; removing the reaction makes no change.';
  return 'React adds the role; removing the reaction removes it.';
}

function selectedRoleIds(draft) {
  if (Array.isArray(draft?.selectedRoleIds)) return draft.selectedRoleIds.filter(Boolean).slice(0, 5);
  return draft?.selectedRoleId ? [draft.selectedRoleId] : [];
}

function mappingText(mappings, guild) {
  if (!mappings.length) return '> No mappings added yet.';
  return mappings.slice(0, 20).map((mapping, index) => {
    const role = guild.roles.cache.get(mapping.roleId);
    const roleText = role ? `<@&${role.id}>` : `\`${mapping.roleId}\``;
    return `**${index + 1}. ${mapping.emoji} → ${roleText}**\n└ ${modeLabel(mapping.mode)}\n└ ${modeResult(mapping.mode)}`;
  }).join('\n\n');
}

function selectedRolesText(draft, guild) {
  const ids = selectedRoleIds(draft);
  if (!ids.length) return '> No roles selected.';
  return ids.map((id, index) => {
    const role = guild.roles.cache.get(id);
    return `${index + 1}. ${role ? `<@&${role.id}>` : `\`${id}\``}`;
  }).join('\n');
}

function generatedPanelPayload(name, mappings, guild) {
  const lines = mappings.map((mapping) => {
    const role = guild.roles.cache.get(mapping.roleId);
    return `${mapping.emoji}  ${role ? `<@&${role.id}>` : `\`${mapping.roleId}\``}`;
  });
  return {
    embeds: [new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`🎭 ${name || 'Reaction Roles'}`)
      .setDescription([
        'React below to add or remove the roles you want.',
        '',
        ...lines,
        '',
        '_Remove your reaction to remove toggle roles._',
      ].join('\n'))],
  };
}

function deploymentSelect(guildId) {
  const panels = reactionRoles.listPanels(guildId).slice(0, 25);
  const menu = new StringSelectMenuBuilder()
    .setCustomId('admin:reactionRoles:manage:panel')
    .setPlaceholder(panels.length ? 'Choose a saved panel' : 'No saved panels')
    .setMinValues(1)
    .setMaxValues(1)
    .setDisabled(!panels.length);
  menu.addOptions(panels.length ? panels.map((panel) => ({
    label: String(panel.name || panel.panelId).slice(0, 100),
    description: `${panel.enabled === false ? 'Disabled' : 'Enabled'} • ${panel.mappings.length} mapping${panel.mappings.length === 1 ? '' : 's'}`.slice(0, 100),
    value: panel.panelId,
  })) : [{ label: 'No panels available', value: 'none' }]);
  return menu;
}

function embedDeploymentsForChannel(guildId, channelId) {
  if (!channelId) return [];
  const trackedReactionMessages = new Set(reactionRoles.listPanels(guildId).map((panel) => panel.messageId));
  return Object.values(getAllEmbedDeployments(guildId))
    .filter((deployment) => deployment.channelId === channelId && deployment.messageId && !trackedReactionMessages.has(deployment.messageId))
    .sort((a, b) => String(b.lastUpdatedAt || b.createdAt || '').localeCompare(String(a.lastUpdatedAt || a.createdAt || '')))
    .slice(0, 25);
}

function embedDeploymentSelect(guildId, channelId) {
  const deployments = embedDeploymentsForChannel(guildId, channelId);
  const menu = new StringSelectMenuBuilder()
    .setCustomId('admin:reactionRoles:existing:embed:deployment')
    .setPlaceholder(deployments.length ? '2. Choose an Embed Studio panel' : 'No available Embed Studio panels in this channel')
    .setMinValues(1)
    .setMaxValues(1)
    .setDisabled(!deployments.length);
  menu.addOptions(deployments.length ? deployments.map((deployment) => {
    const name = String(deployment.preset || deployment.template || deployment.key || 'Embed Studio Panel');
    return {
      label: name.slice(0, 100),
      description: `Message ${deployment.messageId}`.slice(0, 100),
      value: deployment.key,
    };
  }) : [{ label: 'No panels available', value: 'none' }]);
  return menu;
}

function normalMessageSelect(draft) {
  const choices = Array.isArray(draft?.messageChoices) ? draft.messageChoices.slice(0, 25) : [];
  const menu = new StringSelectMenuBuilder()
    .setCustomId('admin:reactionRoles:existing:message:select')
    .setPlaceholder(choices.length ? '2. Choose a message' : draft?.channelId ? 'No accessible messages found' : 'Choose a channel first')
    .setMinValues(1)
    .setMaxValues(1)
    .setDisabled(!choices.length);
  menu.addOptions(choices.length ? choices.map((choice) => ({
    label: String(choice.label || `Message ${choice.messageId}`).slice(0, 100),
    description: String(choice.description || `Message ${choice.messageId}`).slice(0, 100),
    value: choice.messageId,
  })) : [{ label: 'No messages available', value: 'none' }]);
  return menu;
}

function messageChoiceLabel(message) {
  const embedTitle = message.embeds?.find((embed) => embed?.title)?.title;
  const content = String(message.content || '').replace(/\s+/g, ' ').trim();
  const author = message.member?.displayName || message.author?.globalName || message.author?.username || 'Unknown author';
  const label = embedTitle || content || `Message by ${author}`;
  return {
    messageId: message.id,
    label: label.slice(0, 100),
    description: `${author} • ID ${message.id}`.slice(0, 100),
  };
}

async function loadMessageChoices(guild, channelId) {
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.messages?.fetch) throw new Error('Goliath cannot read messages in that channel.');
  const trackedReactionMessages = new Set(reactionRoles.listPanels(guild.id).map((panel) => panel.messageId));
  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!messages) throw new Error('Goliath could not load messages from that channel. Check View Channel and Read Message History permissions.');
  return [...messages.values()]
    .filter((message) => !trackedReactionMessages.has(message.id))
    .sort((a, b) => Number(BigInt(b.id) - BigInt(a.id)))
    .slice(0, 25)
    .map(messageChoiceLabel);
}

function modeSelect(mode) {
  return new StringSelectMenuBuilder()
    .setCustomId('admin:reactionRoles:wizard:mode')
    .setPlaceholder('Choose what reacting should do')
    .addOptions([
      { label: 'Toggle role', description: 'React adds it; unreact removes it', value: reactionRoles.MODES.TOGGLE, default: mode === reactionRoles.MODES.TOGGLE },
      { label: 'Add only', description: 'React adds it; unreact keeps it', value: reactionRoles.MODES.ADD, default: mode === reactionRoles.MODES.ADD },
      { label: 'Remove only', description: 'React removes it; unreact changes nothing', value: reactionRoles.MODES.REMOVE, default: mode === reactionRoles.MODES.REMOVE },
    ]);
}

function removeMappingSelect(draft, guild) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('admin:reactionRoles:wizard:remove:mapping')
    .setPlaceholder('Choose a mapping to remove')
    .setMinValues(1)
    .setMaxValues(1);
  menu.addOptions(draft.mappings.slice(0, 25).map((mapping) => ({
    label: `${mapping.emoji} → ${guild.roles.cache.get(mapping.roleId)?.name || mapping.roleId}`.slice(0, 100),
    description: modeLabel(mapping.mode),
    value: mapping.mappingId,
  })));
  return menu;
}

async function buildReactionRolesAdminPanel(guild, memberDisplayName = 'Unknown User', notice = '') {
  const enabled = guildManager.isModuleEnabled(guild.id, reactionRoles.SECTION);
  const health = await reactionRoles.buildHealth(guild);
  const panels = reactionRoles.listPanels(guild.id);
  const mappings = panels.reduce((total, panel) => total + (panel.mappings?.length || 0), 0);
  return {
    embeds: [new EmbedBuilder()
      .setColor(!enabled ? 0x747f8d : health.healthy ? 0x57f287 : 0xfaa61a)
      .setTitle('🎭 Reaction Roles')
      .setDescription([
        noticeLine(notice), notice ? '' : null,
        'Create and manage self-assignable role panels.', '',
        `**Module:** ${enabled ? '🟢 Enabled' : '🔴 Disabled'}`,
        `**Panels:** \`${panels.length}\``,
        `**Role mappings:** \`${mappings}\``,
        `**Health:** ${health.healthy ? '✅ Healthy' : `⚠️ ${health.unhealthy || 0} panel(s) need attention`}`,
      ].filter((line) => line !== null).join('\n'))
      .setFooter({ text: `Requested by ${memberDisplayName}` })
      .setTimestamp()],
    components: [
      row(
        button('admin:reactionRoles:create', '➕ Create', ButtonStyle.Success),
        button('admin:reactionRoles:existing', '🔗 Use Existing', ButtonStyle.Primary),
        button('admin:reactionRoles:manage', '📋 Manage', ButtonStyle.Primary, !panels.length),
      ),
      row(
        button('admin:studio:roleStudio', '⬅️ Back'),
        button('admin:reactionRoles:settings', '⚙️ Settings'),
      ),
    ],
  };
}

function buildExistingPicker(guild) {
  return {
    embeds: [new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🔗 Use Existing')
      .setDescription([
        'Choose an existing item.', '',
        '**Existing Message**', 'Browse normal Discord messages by channel or paste a direct message link.', '',
        '**Existing Panel**', 'Browse Embed Studio panels by Discord channel, then select one by name or message ID.',
      ].join('\n'))],
    components: [
      row(
        button('admin:reactionRoles:new:existing', '🔗 Existing Message', ButtonStyle.Primary),
        button('admin:reactionRoles:existing:embed', '📚 Existing Panel', ButtonStyle.Primary),
      ),
      row(button('admin:reactionRoles', '⬅️ Back'), button('admin:reactionRoles:settings', '⚙️ Settings')),
    ],
  };
}

function buildEmbedStudioPicker(guild, userId, notice = '') {
  const draft = reactionRoles.getDraft(guild.id, userId);
  const channelId = draft?.channelId || null;
  const deployments = embedDeploymentsForChannel(guild.id, channelId);
  return {
    embeds: [new EmbedBuilder()
      .setColor(channelId && deployments.length ? 0x57f287 : 0x5865f2)
      .setTitle('📚 Select Existing Embed Studio Panel')
      .setDescription([
        noticeLine(notice), notice ? '' : null,
        '**Step 1 — Choose a channel**',
        'Select the Discord channel containing the Embed Studio panel.', '',
        `**Channel:** ${channelId ? `<#${channelId}>` : 'Not selected'}`,
        channelId ? `**Available panels:** \`${deployments.length}\`` : null,
        '',
        '**Step 2 — Choose a panel**',
        channelId
          ? deployments.length
            ? 'Select a panel below. Each option shows its saved panel name and Discord message ID.'
            : '> No unassigned Embed Studio panels were found in that channel.'
          : '> Choose a channel first.',
      ].filter((line) => line !== null).join('\n'))],
    components: [
      row(new ChannelSelectMenuBuilder()
        .setCustomId('admin:reactionRoles:existing:embed:channel')
        .setPlaceholder(channelId ? 'Change channel' : '1. Choose a channel')
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(1)
        .setMaxValues(1)),
      row(embedDeploymentSelect(guild.id, channelId)),
      row(
        button('admin:reactionRoles:existing', '⬅️ Back'),
        button('admin:reactionRoles:settings', '⚙️ Settings'),
      ),
    ],
  };
}

async function buildSettingsPage(guild, memberDisplayName = 'Unknown User', notice = '') {
  const enabled = guildManager.isModuleEnabled(guild.id, reactionRoles.SECTION);
  const health = await reactionRoles.buildHealth(guild);
  const panels = reactionRoles.listPanels(guild.id);
  return {
    embeds: [new EmbedBuilder()
      .setColor(!enabled ? 0x747f8d : health.healthy ? 0x57f287 : 0xfaa61a)
      .setTitle('⚙️ Reaction Roles · Settings')
      .setDescription([
        noticeLine(notice), notice ? '' : null,
        `**Module:** ${enabled ? '🟢 Enabled' : '🔴 Disabled'}`,
        `**Saved panels:** \`${panels.length}\``,
        `**Health:** ${health.healthy ? '✅ Healthy' : `⚠️ ${health.unhealthy || 0} panel(s) need attention`}`,
      ].filter((line) => line !== null).join('\n'))
      .setFooter({ text: `Requested by ${memberDisplayName}` })
      .setTimestamp()],
    components: [
      row(
        button(enabled ? 'admin:reactionRoles:disable:confirm' : 'admin:reactionRoles:enable', enabled ? '⏸️ Disable Module' : '▶️ Enable Module', enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        button('admin:reactionRoles:repair', '🩺 Repair All', ButtonStyle.Secondary, !panels.length || !enabled),
      ),
      row(button('admin:reactionRoles', '⬅️ Back to Reaction Roles')),
    ],
  };
}

function buildDisableConfirmation(guild) {
  return {
    embeds: [new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('⚠️ Disable Reaction Roles?')
      .setDescription(`Saved panels: \`${reactionRoles.listPanels(guild.id).length}\`\n\nAssignments stop, but panels, mappings and messages remain saved.`)],
    components: [row(
      button('admin:reactionRoles:disable:execute', 'Disable Reaction Roles', ButtonStyle.Danger),
      button('admin:reactionRoles:settings', 'Cancel'),
    )],
  };
}

function buildManagePicker(guild, notice = '') {
  const panels = reactionRoles.listPanels(guild.id);
  return {
    embeds: [new EmbedBuilder()
      .setColor(notice ? 0x57f287 : 0x5865f2)
      .setTitle('📚 Saved Reaction Role Panels')
      .setDescription([
        noticeLine(notice), notice ? '' : null,
        panels.length ? 'Choose a saved panel.' : 'No panels are configured yet.',
      ].filter((line) => line !== null).join('\n'))],
    components: [
      ...(panels.length ? [row(deploymentSelect(guild.id))] : [row(button('admin:reactionRoles:create', '➕ Create First Panel', ButtonStyle.Success))]),
      row(button('admin:reactionRoles', '⬅️ Back'), button('admin:reactionRoles:settings', '⚙️ Settings')),
    ],
  };
}

function buildExistingMessageStep(guild, userId, notice = '') {
  const draft = reactionRoles.getDraft(guild.id, userId);
  const choices = Array.isArray(draft?.messageChoices) ? draft.messageChoices : [];
  return {
    embeds: [new EmbedBuilder()
      .setColor(draft?.messageId ? 0x57f287 : 0x5865f2)
      .setTitle('🔗 Select Existing Message')
      .setDescription([
        noticeLine(notice), notice ? '' : null,
        '**Step 1 — Choose a channel**',
        'Select the channel containing the normal Discord message.', '',
        `**Channel:** ${draft?.channelId ? `<#${draft.channelId}>` : 'Not selected'}`,
        draft?.channelId ? `**Available recent messages:** \`${choices.length}\`` : null,
        '',
        '**Step 2 — Choose a message**',
        draft?.channelId
          ? choices.length
            ? 'Select a message below. Options show message text or embed title, author and message ID.'
            : '> No accessible unassigned messages were found. Use Paste Message Link for an older message.'
          : '> Choose a channel first.',
        '',
        draft?.messageId ? `**Selected:** <#${draft.channelId}> · \`${draft.messageId}\`` : '> No message selected.',
      ].filter((line) => line !== null).join('\n'))],
    components: [
      row(new ChannelSelectMenuBuilder()
        .setCustomId('admin:reactionRoles:existing:message:channel')
        .setPlaceholder(draft?.channelId ? 'Change channel' : '1. Choose a channel')
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(1)
        .setMaxValues(1)),
      row(normalMessageSelect(draft)),
      row(
        button('admin:reactionRoles:source:link', draft?.messageId ? '🔄 Paste Different Link' : '🔗 Paste Message Link', ButtonStyle.Primary),
        button('admin:reactionRoles:source:continue', '🗺️ Mapping Builder', ButtonStyle.Success, !draft?.messageId),
      ),
      row(
        button('admin:reactionRoles:existing', '⬅️ Back'),
        button('admin:reactionRoles:settings', '⚙️ Settings'),
      ),
    ],
  };
}

function buildProgress(draft, existing) {
  const destinationReady = existing ? Boolean(draft.messageId) : Boolean(draft.channelId);
  const roles = selectedRoleIds(draft);
  return [
    `${destinationReady ? '✅' : '⬜'} ${existing ? 'Message selected' : 'Channel selected'}`,
    `${draft.name && draft.name !== 'Reaction Roles' ? '✅' : '⬜'} Panel named`,
    `${roles.length ? '✅' : '⬜'} Role${roles.length === 1 ? '' : 's'} selected${roles.length ? ` (${roles.length})` : ''}`,
    `${draft.mappings.length ? '✅' : '⬜'} At least one mapping added`,
    `${destinationReady && draft.mappings.length ? '✅' : '⬜'} Ready to deploy`,
  ].join('\n');
}

function buildWizard(guild, userId, showRemove = false, notice = '', rolePage = 0) {
  const draft = reactionRoles.getDraft(guild.id, userId);
  if (!draft) throw new Error('Your setup session has expired. Start again.');
  const existing = draft.type === reactionRoles.DRAFT_TYPES.EXISTING;
  if (existing && !draft.messageId) return buildExistingMessageStep(guild, userId, notice);

  const sourceReady = existing ? Boolean(draft.messageId) : Boolean(draft.channelId);
  const roles = selectedRoleIds(draft);
  const ready = Boolean(sourceReady && draft.mappings.length);
  const components = [];
  const pageCount = rolePickerPageCount(guild);
  const safePage = Math.min(Math.max(0, Number(rolePage) || 0), pageCount - 1);

  if (!existing) {
    components.push(row(
      new ChannelSelectMenuBuilder()
        .setCustomId('admin:reactionRoles:wizard:channel')
        .setPlaceholder(draft.channelId ? 'Change target channel' : '1. Choose target channel')
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(1)
        .setMaxValues(1)
    ));
  } else {
    components.push(row(button('admin:reactionRoles:source', '🔄 Change Source Message')));
  }

  const rolePicker = buildRolePicker(guild, {
    customId: 'admin:reactionRoles:wizard:roles',
    placeholder: roles.length ? `${roles.length} role${roles.length === 1 ? '' : 's'} selected` : '2. Select up to 5 roles',
    selectedIds: roles,
    minValues: 0,
    maxValues: 5,
    page: safePage,
    pagination: false,
  });

  components.push(
    rolePicker.rows[0],
    row(showRemove && draft.mappings.length ? removeMappingSelect(draft, guild) : modeSelect(draft.selectedMode)),
    row(
      button('admin:reactionRoles:wizard:name', '✏️ Name', ButtonStyle.Primary),
      button('admin:reactionRoles:wizard:batch', '➡️ Continue', ButtonStyle.Success, !roles.length),
      button('admin:reactionRoles:wizard:deploy', draft.panelId ? '💾 Save' : existing ? '💾 Attach' : '🚀 Deploy', ButtonStyle.Success, !ready),
      button('admin:reactionRoles:wizard:remove', '🗑️ Remove', ButtonStyle.Secondary, !draft.mappings.length),
    ),
    row(
      button(existing ? 'admin:reactionRoles:existing' : 'admin:reactionRoles', '⬅️ Back'),
      pageCount > 1 ? button(rolePickerCustomId('admin:reactionRoles:wizard:rolePage', 'page', Math.max(0, safePage - 1)), '⬅️ Roles', ButtonStyle.Secondary, safePage <= 0) : null,
      pageCount > 1 ? button(`admin:reactionRoles:wizard:rolePageInfo:${safePage}`, `Page ${safePage + 1}/${pageCount}`, ButtonStyle.Secondary, true) : null,
      pageCount > 1 ? button(rolePickerCustomId('admin:reactionRoles:wizard:rolePage', 'page', Math.min(pageCount - 1, safePage + 1)), 'Roles ➡️', ButtonStyle.Secondary, safePage >= pageCount - 1) : null,
      button('admin:reactionRoles:settings', '⚙️ Settings'),
    ),
  );

  let next = !sourceReady
    ? existing ? 'Select the source message first.' : 'Choose where Goliath should post the panel.'
    : !roles.length
      ? 'Select up to five roles, then press Continue.'
      : 'Press Continue to enter one emoji for each selected role.';
  if (ready && !roles.length) next = 'Ready. Add another batch if needed, name the panel, then deploy.';

  return {
    embeds: [new EmbedBuilder()
      .setColor(notice || ready ? 0x57f287 : 0x5865f2)
      .setTitle(draft.panelId ? '✏️ Edit Reaction Role Mappings' : existing ? '🔗 Attach Reaction Roles' : '✨ Reaction Role Builder')
      .setDescription([
        noticeLine(notice), notice ? '' : null,
        'Select multiple roles, choose one behaviour, then enter their emojis together.', '',
        `**Panel name:** ${draft.name || 'Reaction Roles'}`,
        `**Source:** ${existing ? `Existing message in <#${draft.channelId}>` : 'New Goliath reaction-role panel'}`,
        !existing ? `**Channel:** ${draft.channelId ? `<#${draft.channelId}>` : 'Not selected'}` : null,
        '',
        '### Setup Progress', buildProgress(draft, existing), '',
        roles.length ? `### Selected Roles (${roles.length})` : null,
        roles.length ? selectedRolesText(draft, guild) : null,
        roles.length ? `**Behaviour for this batch:** ${modeLabel(draft.selectedMode)}` : null,
        roles.length ? '' : null,
        `### Current Mappings (${draft.mappings.length})`, mappingText(draft.mappings, guild), '',
        showRemove && draft.mappings.length ? '> Choose a completed mapping above to remove it.' : `> ${next}`,
      ].filter((line) => line !== null).join('\n').slice(0, 4096))],
    components,
  };
}

async function buildManagedPanel(guild, panelId, notice = '') {
  const panel = reactionRoles.getPanel(guild.id, panelId);
  if (!panel) throw new Error('That reaction-role panel no longer exists.');
  return {
    embeds: [new EmbedBuilder()
      .setColor(notice ? 0x57f287 : panel.enabled === false ? 0x747f8d : 0x57f287)
      .setTitle(`🎭 ${panel.name}`)
      .setDescription([
        noticeLine(notice), notice ? '' : null,
        `**Status:** ${panel.enabled === false ? '⏸️ Disabled' : '✅ Enabled'}`,
        `**Channel:** <#${panel.channelId}>`,
        `**Message:** [Open tracked message](https://discord.com/channels/${guild.id}/${panel.channelId}/${panel.messageId})`,
        `**Mappings:** \`${panel.mappings.length}\``, '',
        '### Emoji and roles', mappingText(panel.mappings, guild),
      ].filter((line) => line !== null).join('\n').slice(0, 4096))],
    components: [
      row(
        button(`admin:reactionRoles:manage:edit:${panelId}`, '✏️ Edit Mappings', ButtonStyle.Primary),
        button(`admin:reactionRoles:manage:repair:${panelId}`, '🔄 Sync & Repair', ButtonStyle.Secondary, panel.enabled === false),
        button(`admin:reactionRoles:manage:${panel.enabled === false ? 'enable' : 'disable'}:${panelId}`, panel.enabled === false ? '▶️ Enable Panel' : '⏸️ Disable Panel', panel.enabled === false ? ButtonStyle.Success : ButtonStyle.Secondary),
      ),
      row(
        button(`admin:reactionRoles:manage:remove:confirm:${panelId}`, '🗑️ Delete Panel', ButtonStyle.Danger),
      ),
      row(
        button('admin:reactionRoles:manage', '⬅️ Back'),
        button('admin:reactionRoles:settings', '⚙️ Settings'),
      ),
    ],
  };
}

function buildDeleteConfirmation(guild, panelId) {
  const panel = reactionRoles.getPanel(guild.id, panelId);
  if (!panel) throw new Error('That reaction-role panel no longer exists.');
  return {
    embeds: [new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('⚠️ Remove Reaction-Role Panel?')
      .setDescription([
        `**Panel:** ${panel.name}`,
        `**Channel:** <#${panel.channelId}>`,
        `**Mappings:** \`${panel.mappings.length}\``,
        '',
        '**Remove from Goliath**',
        'Stops tracking the panel and removes Goliath’s reactions. The Discord message remains.',
        '',
        '**Delete Message & Panel**',
        'Deletes the tracked Discord message and removes the panel from Goliath. Existing member roles are not changed.',
      ].join('\n'))],
    components: [row(
      button(`admin:reactionRoles:manage:remove:execute:${panelId}`, 'Remove from Goliath', ButtonStyle.Secondary),
      button(`admin:reactionRoles:manage:remove:message:${panelId}`, 'Delete Message & Panel', ButtonStyle.Danger),
      button(`admin:reactionRoles:manage:view:${panelId}`, 'Cancel'),
    )],
  };
}

function modal(customId, title, fields) {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addComponents(...fields.map((field) => row(
      new TextInputBuilder()
        .setCustomId(field.id)
        .setLabel(field.label)
        .setPlaceholder(field.placeholder || '')
        .setValue(field.value || '')
        .setStyle(field.style || TextInputStyle.Short)
        .setRequired(field.required !== false)
        .setMaxLength(field.maxLength || 100)
    )));
}

async function respond(interaction, payload) {
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  if (interaction.isButton?.() || interaction.isAnySelectMenu?.()) return interaction.update(payload);
  return interaction.reply({ ...payload, ephemeral: true });
}

async function updateGeneratedMessage(guild, panel) {
  if (panel.source !== reactionRoles.DRAFT_TYPES.TEMPLATE || panel.templateId) return;
  const channel = guild.channels.cache.get(panel.channelId) || await guild.channels.fetch(panel.channelId).catch(() => null);
  const message = channel?.messages?.fetch ? await channel.messages.fetch(panel.messageId).catch(() => null) : null;
  if (message?.author?.id === guild.members.me?.id) await message.edit(generatedPanelPayload(panel.name, panel.mappings, guild));
}

async function deployDraft(guild, userId) {
  const draft = reactionRoles.getDraft(guild.id, userId);
  if (!draft) throw new Error('Your setup session has expired. Start again.');
  const existing = draft.type === reactionRoles.DRAFT_TYPES.EXISTING;
  await reactionRolesHealth.assertDeploymentAccess({ guild, channelId: draft.channelId, mappings: draft.mappings, createMessage: !existing && !draft.panelId });

  if (draft.panelId) {
    const panel = await reactionRoles.updatePanelMappings(guild, draft.panelId, draft.mappings, userId);
    const renamed = reactionRoles.savePanel(guild.id, { ...panel, name: draft.name || panel.name }, guild);
    await updateGeneratedMessage(guild, renamed);
    return { panel: renamed, wasEdit: true };
  }

  if (existing) {
    const panel = await reactionRoles.attachExistingMessage({ guild, messageReference: draft.messageId, channelId: draft.channelId, name: draft.name, mappings: draft.mappings, createdBy: userId });
    return { panel, wasEdit: false };
  }

  const channel = guild.channels.cache.get(draft.channelId) || await guild.channels.fetch(draft.channelId).catch(() => null);
  if (!channel?.send) throw new Error('Choose a text channel where Goliath can send messages.');
  let message = null;
  let panel = null;
  try {
    message = await channel.send(generatedPanelPayload(draft.name, draft.mappings, guild));
    panel = reactionRoles.savePanel(guild.id, {
      name: draft.name || 'Reaction Roles', source: reactionRoles.DRAFT_TYPES.TEMPLATE, templateId: null,
      channelId: channel.id, messageId: message.id, mappings: draft.mappings, createdBy: userId, status: 'pending',
    }, guild);
    panel = (await reactionRoles.syncPanelReactions(guild, panel)).panel;
    return { panel, wasEdit: false };
  } catch (error) {
    if (panel?.panelId) reactionRoles.removePanel(guild.id, panel.panelId, guild);
    if (message) await message.delete().catch(() => null);
    throw error;
  }
}

async function deleteTrackedMessageAndPanel(guild, panelId) {
  const panel = reactionRoles.getPanel(guild.id, panelId);
  if (!panel) throw new Error('That reaction-role panel no longer exists.');
  const channel = guild.channels.cache.get(panel.channelId) || await guild.channels.fetch(panel.channelId).catch(() => null);
  if (!channel?.messages?.fetch) throw new Error('Goliath cannot access the tracked message channel.');
  const message = await channel.messages.fetch(panel.messageId).catch(() => null);
  if (!message) {
    reactionRoles.removePanel(guild.id, panelId, guild);
    return { messageDeleted: false, messageMissing: true };
  }
  try {
    await message.delete();
  } catch {
    throw new Error('Goliath could not delete the tracked Discord message. Check its Manage Messages permission and channel access.');
  }
  reactionRoles.removePanel(guild.id, panelId, guild);
  return { messageDeleted: true, messageMissing: false };
}

async function handleReactionRolesAdminInteraction(interaction) {
  const id = String(interaction.customId || '');
  if (!id.startsWith('admin:reactionRoles')) return false;
  const guild = interaction.guild;
  const userId = interaction.user.id;

  try {
    if (interaction.isModalSubmit?.() && id === 'admin:reactionRoles:source:link:submit') {
      const parsed = reactionRoles.parseMessageReference(interaction.fields.getTextInputValue('messageLink'));
      if (parsed.guildId && parsed.guildId !== guild.id) throw new Error('That message belongs to a different server.');
      const channel = guild.channels.cache.get(parsed.channelId) || await guild.channels.fetch(parsed.channelId).catch(() => null);
      const message = channel?.messages?.fetch ? await channel.messages.fetch(parsed.messageId).catch(() => null) : null;
      if (!message) throw new Error('That message could not be found or Goliath cannot access it.');
      reactionRoles.saveDraft(guild.id, userId, { channelId: parsed.channelId, messageId: parsed.messageId, messageChoices: [] }, guild);
      return interaction.reply({ ...buildExistingMessageStep(guild, userId, '✅ Message selected successfully.'), ephemeral: true });
    }

    if (interaction.isModalSubmit?.() && id === 'admin:reactionRoles:wizard:name:submit') {
      const panelName = interaction.fields.getTextInputValue('panelName').trim();
      if (!panelName) throw new Error('Enter a panel name.');
      reactionRoles.saveDraft(guild.id, userId, { name: panelName }, guild);
      return interaction.reply({ ...buildWizard(guild, userId, false, `✅ Panel named “${panelName}”.`), ephemeral: true });
    }

    if (interaction.isModalSubmit?.() && id === 'admin:reactionRoles:wizard:batch:submit') {
      const draft = reactionRoles.getDraft(guild.id, userId);
      const roles = selectedRoleIds(draft);
      if (!roles.length) throw new Error('Select at least one role first.');
      let added = 0;
      for (let index = 0; index < roles.length; index += 1) {
        const emoji = interaction.fields.getTextInputValue(`emoji_${index}`).trim();
        if (!emoji) continue;
        reactionRoles.addDraftMapping(guild.id, userId, {
          emoji,
          roleId: roles[index],
          mode: draft.selectedMode,
          removeOnUnreact: draft.selectedMode === reactionRoles.MODES.TOGGLE,
        }, guild);
        added += 1;
      }
      reactionRoles.saveDraft(guild.id, userId, { selectedRoleId: null, selectedRoleIds: [] }, guild);
      return interaction.reply({ ...buildWizard(guild, userId, false, `✅ Added ${added} mapping${added === 1 ? '' : 's'} in one batch.`), ephemeral: true });
    }

    if (id === 'admin:reactionRoles' || id === 'admin:reactionRoles:open') return respond(interaction, await buildReactionRolesAdminPanel(guild, displayName(interaction)));
    if (id === 'admin:reactionRoles:create') {
      reactionRoles.saveDraft(guild.id, userId, {
        type: reactionRoles.DRAFT_TYPES.TEMPLATE, panelId: null, channelId: null, messageId: null, templateId: null,
        name: 'Reaction Roles', mappings: [], selectedRoleId: null, selectedRoleIds: [], selectedMode: reactionRoles.MODES.TOGGLE,
      }, guild);
      return respond(interaction, buildWizard(guild, userId));
    }
    if (id === 'admin:reactionRoles:existing') return respond(interaction, buildExistingPicker(guild));
    if (id === 'admin:reactionRoles:settings') return respond(interaction, await buildSettingsPage(guild, displayName(interaction)));
    if (id === 'admin:reactionRoles:saved' || id === 'admin:reactionRoles:manage') return respond(interaction, buildManagePicker(guild));
    if (id === 'admin:reactionRoles:disable:confirm') return respond(interaction, buildDisableConfirmation(guild));

    if (id === 'admin:reactionRoles:new:existing') {
      reactionRoles.saveDraft(guild.id, userId, {
        type: reactionRoles.DRAFT_TYPES.EXISTING, panelId: null, channelId: null, messageId: null, templateId: null,
        name: 'Reaction Roles', mappings: [], selectedRoleId: null, selectedRoleIds: [], selectedMode: reactionRoles.MODES.TOGGLE,
        messageChoices: [],
      }, guild);
      return respond(interaction, buildExistingMessageStep(guild, userId));
    }

    if (id === 'admin:reactionRoles:existing:embed') {
      reactionRoles.saveDraft(guild.id, userId, {
        type: reactionRoles.DRAFT_TYPES.EXISTING, panelId: null, channelId: null, messageId: null, templateId: null,
        name: 'Reaction Roles', mappings: [], selectedRoleId: null, selectedRoleIds: [], selectedMode: reactionRoles.MODES.TOGGLE,
      }, guild);
      return respond(interaction, buildEmbedStudioPicker(guild, userId));
    }

    if (id === 'admin:reactionRoles:source') return respond(interaction, buildExistingMessageStep(guild, userId));
    if (id === 'admin:reactionRoles:source:continue') return respond(interaction, buildWizard(guild, userId));

    if (interaction.isChannelSelectMenu?.() && id === 'admin:reactionRoles:existing:message:channel') {
      const channelId = interaction.values[0];
      const messageChoices = await loadMessageChoices(guild, channelId);
      reactionRoles.saveDraft(guild.id, userId, { channelId, messageId: null, messageChoices }, guild);
      return respond(interaction, buildExistingMessageStep(guild, userId, `✅ Loaded ${messageChoices.length} recent message${messageChoices.length === 1 ? '' : 's'}.`));
    }
    if (interaction.isStringSelectMenu?.() && id === 'admin:reactionRoles:existing:message:select') {
      const messageId = interaction.values[0];
      if (messageId === 'none') return respond(interaction, buildExistingMessageStep(guild, userId));
      const draft = reactionRoles.getDraft(guild.id, userId);
      const choice = (draft?.messageChoices || []).find((item) => item.messageId === messageId);
      if (!draft?.channelId || !choice) throw new Error('That message is no longer available. Choose the channel again.');
      const channel = guild.channels.cache.get(draft.channelId) || await guild.channels.fetch(draft.channelId).catch(() => null);
      const message = channel?.messages?.fetch ? await channel.messages.fetch(messageId).catch(() => null) : null;
      if (!message) throw new Error('That message could not be found or Goliath cannot access it.');
      reactionRoles.saveDraft(guild.id, userId, { messageId }, guild);
      return respond(interaction, buildExistingMessageStep(guild, userId, `✅ Selected “${choice.label}”.`));
    }

    if (interaction.isChannelSelectMenu?.() && id === 'admin:reactionRoles:existing:embed:channel') {
      reactionRoles.saveDraft(guild.id, userId, { channelId: interaction.values[0], messageId: null }, guild);
      return respond(interaction, buildEmbedStudioPicker(guild, userId));
    }
    if (interaction.isStringSelectMenu?.() && id === 'admin:reactionRoles:existing:embed:deployment') {
      const key = interaction.values[0];
      if (key === 'none') return respond(interaction, buildEmbedStudioPicker(guild, userId));
      const deployment = getAllEmbedDeployments(guild.id)[key];
      const draft = reactionRoles.getDraft(guild.id, userId);
      if (!deployment || deployment.channelId !== draft?.channelId) throw new Error('That Embed Studio panel is no longer available in the selected channel.');
      const panelName = String(deployment.preset || deployment.template || deployment.key || 'Reaction Roles').slice(0, 100);
      reactionRoles.saveDraft(guild.id, userId, {
        channelId: deployment.channelId,
        messageId: deployment.messageId,
        name: panelName,
      }, guild);
      return respond(interaction, buildWizard(guild, userId, false, `✅ Selected “${panelName}” from <#${deployment.channelId}>.`));
    }

    if (interaction.isChannelSelectMenu?.() && id === 'admin:reactionRoles:wizard:channel') {
      reactionRoles.saveDraft(guild.id, userId, { channelId: interaction.values[0] }, guild);
      return respond(interaction, buildWizard(guild, userId));
    }
    const rolePicker = parseRolePickerId(id);
    if (rolePicker?.baseId === 'admin:reactionRoles:wizard:rolePage' && rolePicker.kind === 'page') {
      return respond(interaction, buildWizard(guild, userId, false, '', rolePicker.page));
    }
    if (rolePicker?.baseId === 'admin:reactionRoles:wizard:roles' && rolePicker.kind === 'select') {
      const draft = reactionRoles.getDraft(guild.id, userId);
      const merged = mergeRolePickerSelection(guild, selectedRoleIds(draft), interaction.values || [], rolePicker.page).slice(0, 6);
      if (merged.length > 5) throw new Error('Reaction Roles supports up to 5 roles in one batch. Remove a role before adding another.');
      reactionRoles.saveDraft(guild.id, userId, { selectedRoleId: merged[0] || null, selectedRoleIds: merged }, guild);
      return respond(interaction, buildWizard(guild, userId, false, '', rolePicker.page));
    }
    if (interaction.isStringSelectMenu?.() && id === 'admin:reactionRoles:wizard:mode') {
      reactionRoles.saveDraft(guild.id, userId, { selectedMode: interaction.values[0] }, guild);
      return respond(interaction, buildWizard(guild, userId));
    }
    if (interaction.isStringSelectMenu?.() && id === 'admin:reactionRoles:wizard:remove:mapping') {
      reactionRoles.removeDraftMapping(guild.id, userId, interaction.values[0], guild);
      return respond(interaction, buildWizard(guild, userId, false, '✅ Mapping removed.'));
    }
    if (interaction.isStringSelectMenu?.() && id === 'admin:reactionRoles:manage:panel' && interaction.values[0] !== 'none') return respond(interaction, await buildManagedPanel(guild, interaction.values[0]));

    if (id === 'admin:reactionRoles:source:link') {
      await interaction.showModal(modal(`${id}:submit`, 'Select Discord Message', [{ id: 'messageLink', label: 'Full Discord message link', placeholder: 'https://discord.com/channels/server/channel/message', maxLength: 300 }]));
      return true;
    }
    if (id === 'admin:reactionRoles:wizard:name') {
      const draft = reactionRoles.getDraft(guild.id, userId);
      await interaction.showModal(modal(`${id}:submit`, 'Name Reaction Role Panel', [{ id: 'panelName', label: 'Panel name', placeholder: 'Example: Gaming Roles', value: draft?.name === 'Reaction Roles' ? '' : draft?.name, maxLength: 100 }]));
      return true;
    }
    if (id === 'admin:reactionRoles:wizard:batch') {
      const draft = reactionRoles.getDraft(guild.id, userId);
      const roles = selectedRoleIds(draft);
      if (!roles.length) throw new Error('Select at least one role first.');
      const fields = roles.map((roleId, index) => {
        const role = guild.roles.cache.get(roleId);
        return {
          id: `emoji_${index}`,
          label: `Emoji for ${role?.name || `role ${index + 1}`}`.slice(0, 45),
          placeholder: 'Example: ⭐ or <:server_emoji:123456789>',
          maxLength: 100,
        };
      });
      await interaction.showModal(modal(`${id}:submit`, 'Add Role Emojis', fields));
      return true;
    }
    if (id === 'admin:reactionRoles:wizard:remove') return respond(interaction, buildWizard(guild, userId, true));
    if (id === 'admin:reactionRoles:wizard:deploy') {
      await interaction.deferUpdate();
      const { panel, wasEdit } = await deployDraft(guild, userId);
      reactionRoles.clearDraft(guild.id, userId, guild);
      return interaction.editReply(await buildManagedPanel(guild, panel.panelId, wasEdit ? '✅ Changes saved and reactions synchronised.' : '✅ Reaction roles deployed successfully.'));
    }

    if (id.startsWith('admin:reactionRoles:manage:view:')) return respond(interaction, await buildManagedPanel(guild, id.split(':').pop()));
    if (id.startsWith('admin:reactionRoles:manage:remove:confirm:')) return respond(interaction, buildDeleteConfirmation(guild, id.split(':').pop()));
    if (id.startsWith('admin:reactionRoles:manage:edit:')) {
      const panel = reactionRoles.getPanel(guild.id, id.split(':').pop());
      if (!panel) throw new Error('That reaction-role panel no longer exists.');
      reactionRoles.saveDraft(guild.id, userId, {
        type: panel.source, panelId: panel.panelId, channelId: panel.channelId, messageId: panel.messageId,
        name: panel.name, templateId: panel.templateId, mappings: panel.mappings,
        selectedRoleId: null, selectedRoleIds: [], selectedMode: reactionRoles.MODES.TOGGLE,
      }, guild);
      return respond(interaction, buildWizard(guild, userId));
    }
    if (id.startsWith('admin:reactionRoles:manage:enable:') || id.startsWith('admin:reactionRoles:manage:disable:')) {
      const panelId = id.split(':').pop();
      const enabling = id.includes(':enable:');
      await interaction.deferUpdate();
      const panel = await reactionRoles.setPanelEnabled(guild, panelId, enabling, guild);
      if (panel.enabled !== false) await reactionRolesHealth.ensurePanelReactions(guild, panel);
      return interaction.editReply(await buildManagedPanel(guild, panelId, enabling ? '✅ Panel enabled and reactions synchronised.' : '✅ Panel disabled. Its mappings remain saved.'));
    }
    if (id.startsWith('admin:reactionRoles:manage:repair:')) {
      const panelId = id.split(':').pop();
      await interaction.deferUpdate();
      const panel = await reactionRoles.repairPanel(guild, panelId, guild);
      await reactionRolesHealth.ensurePanelReactions(guild, panel);
      return interaction.editReply(await buildManagedPanel(guild, panelId, '✅ Panel checked and repaired successfully.'));
    }
    if (id.startsWith('admin:reactionRoles:manage:remove:message:')) {
      const panelId = id.split(':').pop();
      await interaction.deferUpdate();
      const result = await deleteTrackedMessageAndPanel(guild, panelId);
      const notice = result.messageMissing
        ? '✅ Panel removed. The tracked Discord message had already been deleted.'
        : '✅ Panel and tracked Discord message deleted.';
      return interaction.editReply(buildManagePicker(guild, notice));
    }
    if (id.startsWith('admin:reactionRoles:manage:remove:execute:')) {
      const panelId = id.split(':').pop();
      await interaction.deferUpdate();
      await reactionRoles.detachPanel(guild, panelId, { clearReactions: true });
      return interaction.editReply(buildManagePicker(guild, '✅ Panel removed from Goliath. The Discord message was left in place.'));
    }

    if (id === 'admin:reactionRoles:enable') {
      guildManager.setModuleEnabled(guild.id, reactionRoles.SECTION, true, { actorId: userId });
      return respond(interaction, await buildSettingsPage(guild, displayName(interaction), '✅ Reaction Roles enabled.'));
    }
    if (id === 'admin:reactionRoles:disable:execute') {
      guildManager.setModuleEnabled(guild.id, reactionRoles.SECTION, false, { actorId: userId });
      return respond(interaction, await buildSettingsPage(guild, displayName(interaction), '✅ Reaction Roles disabled. Saved panels were preserved.'));
    }
    if (id === 'admin:reactionRoles:repair') {
      await interaction.deferUpdate();
      const result = await reactionRoles.repairAll(guild);
      const repairNotice = result.failed?.length
        ? `⚠️ Repair finished: ${result.repaired.length} repaired, ${result.failed.length} failed.`
        : `✅ Repair finished: ${result.repaired.length} panel${result.repaired.length === 1 ? '' : 's'} synchronised.`;
      return interaction.editReply(await buildSettingsPage(guild, displayName(interaction), repairNotice));
    }

    return respond(interaction, await buildReactionRolesAdminPanel(guild, displayName(interaction)));
  } catch (error) {
    const payload = { content: `❌ Reaction Roles failed: ${error.message}`, ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => null);
    else await interaction.reply(payload).catch(() => null);
    return true;
  }
}

module.exports = { buildReactionRolesAdminPanel, handleReactionRolesAdminInteraction };
