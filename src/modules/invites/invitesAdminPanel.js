'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const invites = require('./invites');
const publicPanels = require('./invitesPublicPanels');

const PREFIX = 'invites:';
const sessions = new Map();

const row = (...components) => new ActionRowBuilder().addComponents(...components);
const button = (id, label, style = ButtonStyle.Secondary, disabled = false) => new ButtonBuilder()
  .setCustomId(id)
  .setLabel(label)
  .setStyle(style)
  .setDisabled(Boolean(disabled));

function sessionFor(interaction) {
  const key = `${interaction.guildId}:${interaction.user.id}`;
  if (!sessions.has(key)) sessions.set(key, { page: 'overview' });
  return sessions.get(key);
}

function expiryLabel(seconds) {
  return ({
    0: 'Never',
    1800: '30 minutes',
    3600: '1 hour',
    21600: '6 hours',
    43200: '12 hours',
    86400: '1 day',
    604800: '7 days',
    2592000: '30 days',
  })[Number(seconds)] || 'Never';
}

function usesLabel(value) {
  return Number(value) ? String(value) : 'Unlimited';
}

function roleList(roleIds) {
  return roleIds?.length ? roleIds.map((id) => `<@&${id}>`).join(', ') : 'None';
}

function settingsSummary(config) {
  return [
    `Channel: ${config.channelId ? `<#${config.channelId}>` : 'Not selected'}`,
    `Expires: ${expiryLabel(config.maxAge)}`,
    `Maximum uses: ${usesLabel(config.maxUses)}`,
    `Temporary membership: ${config.temporary ? 'On' : 'Off'}`,
    `Roles granted: ${roleList(config.roleIds)}`,
  ].join('\n');
}

function expirySelect(id, current) {
  return new StringSelectMenuBuilder()
    .setCustomId(id)
    .setPlaceholder(`Expire after: ${expiryLabel(current)}`)
    .addOptions(
      { label: 'Never', value: '0' },
      { label: '30 minutes', value: '1800' },
      { label: '1 hour', value: '3600' },
      { label: '6 hours', value: '21600' },
      { label: '12 hours', value: '43200' },
      { label: '1 day', value: '86400' },
      { label: '7 days', value: '604800' },
      { label: '30 days', value: '2592000' },
    );
}

function usesSelect(id, current) {
  return new StringSelectMenuBuilder()
    .setCustomId(id)
    .setPlaceholder(`Max uses: ${usesLabel(current)}`)
    .addOptions(
      { label: 'Unlimited', value: '0' },
      { label: '1 use', value: '1' },
      { label: '5 uses', value: '5' },
      { label: '10 uses', value: '10' },
      { label: '25 uses', value: '25' },
      { label: '50 uses', value: '50' },
      { label: '100 uses', value: '100' },
    );
}

function sameRoles(left = [], right = []) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function officialMatchesConfig(record, config) {
  return Boolean(record?.official)
    && record.channelId === config.channelId
    && Number(record.maxAge || 0) === Number(config.maxAge || 0)
    && Number(record.maxUses || 0) === Number(config.maxUses || 0)
    && Boolean(record.temporary) === Boolean(config.temporary)
    && sameRoles(record.roleIds, config.roleIds);
}

function updateNestedSettings(guildId, key, patch, meta) {
  const section = invites.getSection(guildId);
  invites.updateSettings(guildId, { [key]: { ...section.settings[key], ...patch } }, meta);
}

function overview(interaction) {
  const section = invites.getSection(interaction.guildId);
  const official = section.settings.officialInvite;
  const member = section.settings.memberInviteTemplate;
  const panel = section.settings.publicPanel;
  const memberLinks = invites.listInviteLinks(interaction.guildId).filter((link) => link.personal).length;

  return {
    embeds: [new EmbedBuilder()
      .setColor(section.enabled ? 0x57F287 : 0xED4245)
      .setTitle('📨 Invite Studio')
      .setDescription('Configure Goliath invites, the public leaderboard panel, and Invite Studio administration.')
      .addFields(
        { name: 'Status', value: section.enabled ? 'Enabled' : 'Disabled', inline: true },
        { name: 'Official Invite', value: official.code ? `https://discord.gg/${official.code}` : 'Not selected', inline: true },
        { name: 'Member Links', value: String(memberLinks), inline: true },
        { name: 'Member Template', value: member.channelId ? 'Configured' : 'Not configured', inline: true },
        { name: 'Public Panel', value: panel.messageId ? 'Sent' : 'Not sent', inline: true },
        { name: 'Refresh', value: 'Automatic every 2 hours', inline: true },
      )
      .setFooter({ text: 'Official Goliath invites never appear on member leaderboards.' })],
    components: [
      row(
        button('invites:goliath', 'Configure Goliath', ButtonStyle.Primary),
        button('invites:public-config', 'Configure Public', ButtonStyle.Primary),
        button('invites:admin-config', 'Admin', ButtonStyle.Primary),
      ),
      row(button('admin:modules', 'Back to Modules')),
    ],
  };
}

function goliathView(interaction) {
  const official = invites.getSection(interaction.guildId).settings.officialInvite;
  return {
    embeds: [new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🤖 Configure Goliath')
      .setDescription('Configure and manage official Goliath invite links.')
      .addFields(
        { name: 'Selected Official Link', value: official.code ? `https://discord.gg/${official.code}` : 'None', inline: true },
        { name: 'Official Channel', value: official.channelId ? `<#${official.channelId}>` : 'Not selected', inline: true },
        { name: 'Current Settings', value: settingsSummary(official), inline: false },
      )],
    components: [
      row(button('invites:official-settings', 'Official Invite Settings', ButtonStyle.Primary)),
      row(button('invites:home', 'Back')),
    ],
  };
}

function officialView(interaction) {
  const section = invites.getSection(interaction.guildId);
  const config = section.settings.officialInvite;
  const officialLinks = invites.listInviteLinks(interaction.guildId).filter((link) => link.official);
  const exactDuplicate = officialLinks.some((link) => officialMatchesConfig(link, config));

  return {
    embeds: [new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🌍 Official Goliath Invites')
      .setDescription('Choose the settings, verify the selected link, create a new link only when no identical Goliath link exists, or delete the selected link.')
      .addFields(
        { name: 'Selected Link', value: config.code ? `https://discord.gg/${config.code}` : 'None', inline: true },
        { name: 'Tracked Goliath Links', value: String(officialLinks.length), inline: true },
        { name: 'Configured Settings', value: settingsSummary(config), inline: false },
        { name: 'Duplicate Settings', value: exactDuplicate ? 'An identical Goliath link already exists.' : 'No identical Goliath link found.', inline: false },
      )],
    components: [
      row(new ChannelSelectMenuBuilder().setCustomId('invites:official-channel').setPlaceholder('Select official invite channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
      row(expirySelect('invites:official-expiry', config.maxAge)),
      row(usesSelect('invites:official-uses', config.maxUses)),
      row(new RoleSelectMenuBuilder().setCustomId('invites:official-roles').setPlaceholder('Roles for official invitees (optional)').setMinValues(0).setMaxValues(10)),
      row(
        button('invites:official-temporary', config.temporary ? 'Temporary: On' : 'Temporary: Off'),
        button('invites:official-verify', 'Verify Selected', ButtonStyle.Secondary, !config.code),
        button('invites:official-create', 'Create New Link', ButtonStyle.Success, !config.channelId || exactDuplicate),
        button('invites:official-delete', 'Delete Selected', ButtonStyle.Danger, !config.code),
        button('invites:goliath', 'Back'),
      ),
    ],
  };
}

function memberTemplateView(interaction) {
  const config = invites.getSection(interaction.guildId).settings.memberInviteTemplate;
  return {
    embeds: [new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('👥 Member Link Settings')
      .setDescription('Members press **Create My Link** once. Goliath creates one personal link using these settings and reuses it thereafter.')
      .addFields(
        { name: 'Member Links', value: config.enabled ? 'Enabled' : 'Disabled', inline: true },
        { name: 'Auto Replace Missing', value: config.autoReplaceMissing ? 'On' : 'Off', inline: true },
        { name: 'Template Settings', value: settingsSummary(config), inline: false },
      )],
    components: [
      row(new ChannelSelectMenuBuilder().setCustomId('invites:member-channel').setPlaceholder('Select member invite channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
      row(expirySelect('invites:member-expiry', config.maxAge)),
      row(usesSelect('invites:member-uses', config.maxUses)),
      row(new RoleSelectMenuBuilder().setCustomId('invites:member-roles').setPlaceholder('Roles automatically granted to invitees').setMinValues(0).setMaxValues(10)),
      row(
        button('invites:member-temporary', config.temporary ? 'Temporary: On' : 'Temporary: Off'),
        button('invites:member-enabled', config.enabled ? 'Links: On' : 'Links: Off'),
        button('invites:member-autoreplace', config.autoReplaceMissing ? 'Auto Replace: On' : 'Auto Replace: Off'),
        button('invites:public-config', 'Back'),
      ),
    ],
  };
}

function publicSettingsView(interaction) {
  const section = invites.getSection(interaction.guildId);
  const config = section.settings.publicPanel;
  const member = section.settings.memberInviteTemplate;

  return {
    embeds: [new EmbedBuilder()
      .setColor(config.color)
      .setTitle('📣 Configure Public')
      .setDescription('Choose the panel channel, leaderboard size and member-link settings, then send the public panel. The sent panel includes member buttons and refreshes automatically every 2 hours.')
      .addFields(
        { name: 'Panel Channel', value: config.channelId ? `<#${config.channelId}>` : 'Not selected', inline: true },
        { name: 'Panel Status', value: config.messageId ? 'Sent' : 'Not sent', inline: true },
        { name: 'Leaderboard Size', value: `Top ${config.leaderboardLimit}`, inline: true },
        { name: 'Member Links', value: member.enabled ? 'Enabled' : 'Disabled', inline: true },
        { name: 'Member Template', value: member.channelId ? 'Configured' : 'Not configured', inline: true },
        { name: 'Automatic Refresh', value: 'Every 2 hours', inline: true },
      )],
    components: [
      row(new ChannelSelectMenuBuilder().setCustomId('invites:panel-channel').setPlaceholder('Select public panel channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
      row(new StringSelectMenuBuilder().setCustomId('invites:panel-limit').setPlaceholder(`Leaderboard: Top ${config.leaderboardLimit}`).addOptions(
        { label: 'Top 5', value: '5' },
        { label: 'Top 10', value: '10' },
        { label: 'Top 15', value: '15' },
        { label: 'Top 20', value: '20' },
        { label: 'Top 25', value: '25' },
      )),
      row(button('invites:member-settings', 'Member Link Settings', ButtonStyle.Primary)),
      row(
        button('invites:panel-deploy', 'Send Panel', ButtonStyle.Success, !config.channelId || !section.settings.officialInvite.code),
        button('invites:home', 'Back'),
      ),
    ],
  };
}

function adminView(interaction) {
  const section = invites.getSection(interaction.guildId);
  return {
    embeds: [new EmbedBuilder()
      .setColor(section.enabled ? 0x57F287 : 0xED4245)
      .setTitle('🛠️ Invite Studio Admin')
      .setDescription('Edit user-facing messages and run Invite Studio maintenance.')
      .addFields(
        { name: 'Module Status', value: section.enabled ? 'Enabled' : 'Disabled', inline: true },
        { name: 'Panel Message', value: 'Editable', inline: true },
        { name: 'Member DM', value: 'Editable', inline: true },
      )],
    components: [
      row(button('invites:panel-embed-modal', 'Edit Panel Embed', ButtonStyle.Primary), button('invites:member-dm-modal', 'Edit Member DM', ButtonStyle.Primary)),
      row(button('invites:health', 'Health'), button('invites:repair', 'Repair'), button('invites:toggle', section.enabled ? 'Disable' : 'Enable', section.enabled ? ButtonStyle.Danger : ButtonStyle.Success)),
      row(button('invites:home', 'Back')),
    ],
  };
}

function buildInviteStudioPayload(interaction, forcedPage = null) {
  const state = sessionFor(interaction);
  if (forcedPage === 'configure') state.page = 'overview';
  if (state.page === 'goliath') return goliathView(interaction);
  if (state.page === 'official-settings') return officialView(interaction);
  if (state.page === 'member-settings') return memberTemplateView(interaction);
  if (state.page === 'public-config') return publicSettingsView(interaction);
  if (state.page === 'admin-config') return adminView(interaction);
  return overview(interaction);
}

async function updatePanel(interaction) {
  const payload = buildInviteStudioPayload(interaction);
  if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
  else await interaction.update(payload);
}

function dmModal(interaction) {
  const config = invites.getSection(interaction.guildId).settings.memberInviteTemplate;
  return new ModalBuilder().setCustomId('invites:member-dm-submit').setTitle('Edit Member Invite DM').addComponents(
    row(new TextInputBuilder().setCustomId('title').setLabel('DM title').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(256).setValue(config.dmTitle)),
    row(new TextInputBuilder().setCustomId('message').setLabel('DM message').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(3500).setValue(config.dmMessage)),
  );
}

function embedModal(interaction) {
  const config = invites.getSection(interaction.guildId).settings.publicPanel;
  return new ModalBuilder().setCustomId('invites:panel-embed-submit').setTitle('Edit Invite Panel').addComponents(
    row(new TextInputBuilder().setCustomId('title').setLabel('Embed title').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(256).setValue(config.title)),
    row(new TextInputBuilder().setCustomId('description').setLabel('Embed description').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(4000).setValue(config.description)),
    row(new TextInputBuilder().setCustomId('footer').setLabel('Footer').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(2048).setValue(config.footer)),
    row(new TextInputBuilder().setCustomId('button').setLabel('Official invite button label').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80).setValue(config.buttonLabel)),
    row(new TextInputBuilder().setCustomId('color').setLabel('Embed colour (hex)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(7).setValue(config.color)),
  );
}

async function verifyOfficialInvite(guild) {
  const section = invites.getSection(guild.id);
  const config = section.settings.officialInvite;
  if (!config.code) return { valid: false, reason: 'No official link is currently selected.' };
  const live = await guild.invites.fetch(config.code).catch(() => null);
  if (!live) return { valid: false, reason: 'The selected link no longer exists in Discord.' };
  const record = section.inviteLinks[config.code];
  if (!record?.official) return { valid: false, reason: 'The selected link is not registered as a Goliath official link.' };
  if (!officialMatchesConfig(record, config)) return { valid: false, reason: 'The selected link does not match the settings currently shown.' };
  return { valid: true, invite: live, config };
}

async function createOfficialInvite(guild, meta) {
  const section = invites.getSection(guild.id);
  const config = section.settings.officialInvite;
  if (!config.channelId) throw new Error('Select the official invite channel first.');
  const duplicate = invites.listInviteLinks(guild.id).find((link) => officialMatchesConfig(link, config));
  if (duplicate) {
    const live = await guild.invites.fetch(duplicate.code).catch(() => null);
    if (live) {
      updateNestedSettings(guild.id, 'officialInvite', { code: duplicate.code }, meta);
      return { invite: live, created: false, duplicate: true };
    }
  }
  const result = await invites.createInviteLink(guild, {
    channelId: config.channelId,
    maxAge: config.maxAge,
    maxUses: config.maxUses,
    temporary: config.temporary,
    roleIds: config.roleIds,
    official: true,
  }, meta);
  updateNestedSettings(guild.id, 'officialInvite', { code: result.invite.code }, meta);
  return { invite: result.invite, created: true, duplicate: false };
}

async function deleteSelectedOfficialInvite(guild, meta) {
  const config = invites.getSection(guild.id).settings.officialInvite;
  if (!config.code) return false;
  await invites.deleteInviteLink(guild, config.code, meta);
  updateNestedSettings(guild.id, 'officialInvite', { code: null }, meta);
  return true;
}

async function handleInviteStudioInteraction(interaction) {
  if (!String(interaction.customId || '').startsWith(PREFIX)) return false;
  const customId = String(interaction.customId);
  const isManagement = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
  const managementMemberIds = new Set([
    'invites:member-settings',
    'invites:member-channel',
    'invites:member-roles',
    'invites:member-expiry',
    'invites:member-uses',
    'invites:member-temporary',
    'invites:member-enabled',
    'invites:member-autoreplace',
    'invites:member-dm-modal',
    'invites:member-dm-submit',
  ]);

  if (customId.startsWith('invites:member-') && !managementMemberIds.has(customId) && !isManagement) {
    return publicPanels.handleMemberInteraction(interaction);
  }
  if (!isManagement) throw new Error('Manage Server permission is required.');

  const action = customId.slice(PREFIX.length);
  const state = sessionFor(interaction);
  const meta = { actorId: interaction.user.id, action: `invites_panel_${action}` };

  if (action === 'home') state.page = 'overview';
  else if (['goliath', 'official-settings', 'member-settings', 'public-config', 'admin-config'].includes(action)) state.page = action;
  else if (action === 'toggle') invites.setEnabled(interaction.guildId, !invites.getSection(interaction.guildId).enabled, meta);
  else if (action === 'official-channel' && interaction.isChannelSelectMenu()) updateNestedSettings(interaction.guildId, 'officialInvite', { channelId: interaction.values[0] }, meta);
  else if (action === 'official-roles' && interaction.isRoleSelectMenu()) updateNestedSettings(interaction.guildId, 'officialInvite', { roleIds: interaction.values }, meta);
  else if (action === 'official-expiry' && interaction.isStringSelectMenu()) updateNestedSettings(interaction.guildId, 'officialInvite', { maxAge: Number(interaction.values[0]) }, meta);
  else if (action === 'official-uses' && interaction.isStringSelectMenu()) updateNestedSettings(interaction.guildId, 'officialInvite', { maxUses: Number(interaction.values[0]) }, meta);
  else if (action === 'official-temporary') {
    const current = invites.getSection(interaction.guildId).settings.officialInvite;
    updateNestedSettings(interaction.guildId, 'officialInvite', { temporary: !current.temporary }, meta);
  } else if (action === 'official-verify') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await verifyOfficialInvite(interaction.guild);
    await interaction.editReply(result.valid
      ? `✅ Selected official link is valid.\n${result.invite.url}\n\n**Settings used**\n${settingsSummary(result.config)}`
      : `❌ Verification failed: ${result.reason}`);
    return true;
  } else if (action === 'official-create') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await createOfficialInvite(interaction.guild, meta);
    await interaction.editReply(result.created
      ? `✅ New official Goliath link created: ${result.invite.url}`
      : `⚠️ An identical official link already exists. Selected existing link: ${result.invite.url}`);
    return true;
  } else if (action === 'official-delete') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const deleted = await deleteSelectedOfficialInvite(interaction.guild, meta);
    await interaction.editReply(deleted ? '✅ Selected official Goliath link deleted.' : '❌ No official link is selected.');
    return true;
  } else if (action === 'member-channel' && interaction.isChannelSelectMenu()) updateNestedSettings(interaction.guildId, 'memberInviteTemplate', { channelId: interaction.values[0] }, meta);
  else if (action === 'member-roles' && interaction.isRoleSelectMenu()) updateNestedSettings(interaction.guildId, 'memberInviteTemplate', { roleIds: interaction.values }, meta);
  else if (action === 'member-expiry' && interaction.isStringSelectMenu()) updateNestedSettings(interaction.guildId, 'memberInviteTemplate', { maxAge: Number(interaction.values[0]) }, meta);
  else if (action === 'member-uses' && interaction.isStringSelectMenu()) updateNestedSettings(interaction.guildId, 'memberInviteTemplate', { maxUses: Number(interaction.values[0]) }, meta);
  else if (action === 'member-temporary') {
    const current = invites.getSection(interaction.guildId).settings.memberInviteTemplate;
    updateNestedSettings(interaction.guildId, 'memberInviteTemplate', { temporary: !current.temporary }, meta);
  } else if (action === 'member-enabled') {
    const current = invites.getSection(interaction.guildId).settings.memberInviteTemplate;
    updateNestedSettings(interaction.guildId, 'memberInviteTemplate', { enabled: !current.enabled }, meta);
  } else if (action === 'member-autoreplace') {
    const current = invites.getSection(interaction.guildId).settings.memberInviteTemplate;
    updateNestedSettings(interaction.guildId, 'memberInviteTemplate', { autoReplaceMissing: !current.autoReplaceMissing }, meta);
  } else if (action === 'member-dm-modal') {
    await interaction.showModal(dmModal(interaction));
    return true;
  } else if (action === 'member-dm-submit' && interaction.isModalSubmit()) {
    updateNestedSettings(interaction.guildId, 'memberInviteTemplate', {
      dmTitle: interaction.fields.getTextInputValue('title'),
      dmMessage: interaction.fields.getTextInputValue('message'),
    }, meta);
    await interaction.reply({ content: '✅ Member invite DM updated.', flags: MessageFlags.Ephemeral });
    return true;
  } else if (action === 'panel-channel' && interaction.isChannelSelectMenu()) updateNestedSettings(interaction.guildId, 'publicPanel', { channelId: interaction.values[0] }, meta);
  else if (action === 'panel-limit' && interaction.isStringSelectMenu()) updateNestedSettings(interaction.guildId, 'publicPanel', { leaderboardLimit: Number(interaction.values[0]) }, meta);
  else if (action === 'panel-embed-modal') {
    await interaction.showModal(embedModal(interaction));
    return true;
  } else if (action === 'panel-embed-submit' && interaction.isModalSubmit()) {
    const color = interaction.fields.getTextInputValue('color').trim();
    if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Embed colour must be a hex value such as #5865F2.');
    updateNestedSettings(interaction.guildId, 'publicPanel', {
      title: interaction.fields.getTextInputValue('title'),
      description: interaction.fields.getTextInputValue('description'),
      footer: interaction.fields.getTextInputValue('footer'),
      buttonLabel: interaction.fields.getTextInputValue('button'),
      color,
    }, meta);
    await interaction.reply({ content: '✅ Public panel message updated.', flags: MessageFlags.Ephemeral });
    return true;
  } else if (action === 'panel-deploy') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const message = await publicPanels.deployPublicPanel(interaction.guild, meta);
    publicPanels.startAutoRefresh(interaction.guild);
    await interaction.editReply(`✅ Public invite and leaderboard panel sent in <#${message.channelId}>.`);
    return true;
  } else if (action === 'health') {
    const health = await invites.buildHealth(interaction.guild);
    await interaction.reply({
      content: health.healthy
        ? `✅ Invite Studio is healthy. ${health.warnings.length} warning(s).`
        : `⚠️ ${health.issues.length} issue(s), ${health.warnings.length} warning(s).`,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  } else if (action === 'repair') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const health = await invites.repair(interaction.guild, meta);
    await interaction.editReply(health.healthy ? '✅ Repair complete.' : '⚠️ Repair completed, but issues remain.');
    return true;
  } else {
    return publicPanels.handleMemberInteraction(interaction);
  }

  await updatePanel(interaction);
  return true;
}

module.exports = { buildInviteStudioPayload, handleInviteStudioInteraction };
