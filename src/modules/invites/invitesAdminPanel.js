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

const PREFIX = 'invites:';
const sessions = new Map();
let publicPanelsCache = null;

function publicPanels() {
  if (!publicPanelsCache) publicPanelsCache = require('./invitesPublicPanels');
  return publicPanelsCache;
}

const row = (...components) => new ActionRowBuilder().addComponents(...components);
const button = (id, label, style = ButtonStyle.Secondary, disabled = false) => new ButtonBuilder()
  .setCustomId(id)
  .setLabel(label)
  .setStyle(style)
  .setDisabled(Boolean(disabled));

function getSession(interaction) {
  const key = `${interaction.guildId}:${interaction.user.id}`;
  if (!sessions.has(key)) {
    sessions.set(key, {
      page: 'overview',
      draft: {
        channelId: interaction.channelId || null,
        roleIds: [],
        maxAge: 0,
        maxUses: 0,
        temporary: false,
      },
    });
  }
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

function safeConfig(guildId) {
  try {
    return publicPanels().panelConfig(guildId);
  } catch (error) {
    console.error('[InviteStudio] Public panel config failed:', error);
    return {
      publicPanel: { channelId: null, messageId: null, inviteCode: null },
      leaderboardPanel: { channelId: null, messageId: null },
    };
  }
}

function overview(interaction) {
  const section = invites.getSection(interaction.guildId);
  const links = invites.listInviteLinks(interaction.guildId);
  const config = safeConfig(interaction.guildId);
  return {
    embeds: [new EmbedBuilder()
      .setColor(section.enabled ? 0x57F287 : 0xED4245)
      .setTitle('📨 Invite Studio')
      .setDescription('Create invite links, publish a permanent invite panel, and maintain a live leaderboard.')
      .addFields(
        { name: 'Status', value: section.enabled ? 'Enabled' : 'Disabled', inline: true },
        { name: 'Invite links', value: String(links.length), inline: true },
        { name: 'Tracked joins', value: String(section.analytics?.tracked || 0), inline: true },
        { name: 'Public panel', value: config.publicPanel?.messageId ? 'Deployed' : 'Not deployed', inline: true },
        { name: 'Leaderboard', value: config.leaderboardPanel?.messageId ? 'Deployed' : 'Not deployed', inline: true },
        { name: 'Roles granted', value: String(section.analytics?.inviteRolesGranted || 0), inline: true },
      )
      .setFooter({ text: 'Admin Hub › Modules › Invite Studio' })],
    components: [
      row(button('invites:create', 'Create Invite Link', ButtonStyle.Primary), button('invites:links', 'Invite Links'), button('invites:public', 'Public Invite Panel')),
      row(button('invites:leaderboard', 'Leaderboard Panel'), button('invites:sync', 'Sync Invites'), button('invites:health', 'Health')),
      row(button('invites:repair', 'Repair'), button('invites:toggle', section.enabled ? 'Disable' : 'Enable', section.enabled ? ButtonStyle.Danger : ButtonStyle.Success), button('admin:modules', 'Back to Modules')),
    ],
  };
}

function createView(interaction) {
  const draft = getSession(interaction).draft;
  return {
    embeds: [new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🔗 Create Invite Link')
      .setDescription('The generated link remains private until you choose to publish it.')
      .addFields(
        { name: 'Channel', value: draft.channelId ? `<#${draft.channelId}>` : 'Not selected', inline: true },
        { name: 'Expire after', value: expiryLabel(draft.maxAge), inline: true },
        { name: 'Max uses', value: draft.maxUses ? String(draft.maxUses) : 'No limit', inline: true },
        { name: 'Roles', value: draft.roleIds.length ? draft.roleIds.map((id) => `<@&${id}>`).join(', ') : 'None' },
        { name: 'Temporary membership', value: draft.temporary ? 'Enabled' : 'Disabled', inline: true },
      )],
    components: [
      row(new ChannelSelectMenuBuilder().setCustomId('invites:draft-channel').setPlaceholder('Select invite channel').addChannelTypes(ChannelType.GuildText)),
      row(new StringSelectMenuBuilder().setCustomId('invites:draft-expiry').setPlaceholder(`Expire after: ${expiryLabel(draft.maxAge)}`).addOptions(
        { label: 'Never', value: '0' }, { label: '30 minutes', value: '1800' }, { label: '1 hour', value: '3600' }, { label: '6 hours', value: '21600' }, { label: '12 hours', value: '43200' }, { label: '1 day', value: '86400' }, { label: '7 days', value: '604800' }, { label: '30 days', value: '2592000' })),
      row(new StringSelectMenuBuilder().setCustomId('invites:draft-uses').setPlaceholder(`Max uses: ${draft.maxUses || 'No limit'}`).addOptions(
        { label: 'No limit', value: '0' }, { label: '1 use', value: '1' }, { label: '5 uses', value: '5' }, { label: '10 uses', value: '10' }, { label: '25 uses', value: '25' }, { label: '50 uses', value: '50' }, { label: '100 uses', value: '100' })),
      row(new RoleSelectMenuBuilder().setCustomId('invites:draft-roles').setPlaceholder('Roles (optional)').setMinValues(0).setMaxValues(10)),
      row(button('invites:draft-temporary', draft.temporary ? 'Temporary Membership: On' : 'Temporary Membership: Off'), button('invites:generate', 'Generate Invite', ButtonStyle.Primary, !draft.channelId), button('invites:home', 'Cancel')),
    ],
  };
}

function linksView(interaction) {
  const links = invites.listInviteLinks(interaction.guildId);
  const description = links.length
    ? links.slice(0, 20).map((link) => {
      const expiry = link.expiresAt ? `<t:${Math.floor(new Date(link.expiresAt).getTime() / 1000)}:R>` : 'Never';
      const ownerOrRoles = link.personal
        ? `Owner: <@${link.inviterId}>`
        : (link.roleIds?.length ? link.roleIds.map((id) => `<@&${id}>`).join(', ') : 'No roles');
      return `**${link.code}**${link.personal ? ' · Personal' : ''} · ${link.uses || 0}${link.maxUses ? `/${link.maxUses}` : ''} uses · ${expiry}\n${ownerOrRoles}`;
    }).join('\n\n')
    : 'No Invite Studio links have been created.';
  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🔗 Invite Links').setDescription(description)],
    components: [row(button('invites:create', 'Create Invite Link', ButtonStyle.Primary), button('invites:delete', 'Delete Link', ButtonStyle.Danger, !links.length), button('invites:home', 'Back'))],
  };
}

function publicView(interaction) {
  const config = safeConfig(interaction.guildId).publicPanel;
  const links = invites.listInviteLinks(interaction.guildId).filter((link) => !link.personal && link.maxAge === 0 && link.maxUses === 0);
  const components = [row(new ChannelSelectMenuBuilder().setCustomId('invites:public-channel').setPlaceholder('Select public panel channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))];
  if (links.length) {
    const inviteOptions = links.slice(0, 25).map((link) => ({
      label: link.code,
      value: link.code,
      description: `${link.uses || 0} uses`,
    }));

    const inviteSelect = new StringSelectMenuBuilder()
      .setCustomId('invites:public-link')
      .setPlaceholder('Select permanent invite link')
      .addOptions(inviteOptions);

    components.push(row(inviteSelect));
  }
  components.push(row(button('invites:public-deploy', config.messageId ? 'Update Public Panel' : 'Deploy Public Panel', ButtonStyle.Success, !config.channelId || !config.inviteCode), button('invites:home', 'Back')));
  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('📣 Public Invite Panel').setDescription('Choose a permanent invite and a channel, then deploy one public message.').addFields(
      { name: 'Channel', value: config.channelId ? `<#${config.channelId}>` : 'Not selected', inline: true },
      { name: 'Invite', value: config.inviteCode ? `https://discord.gg/${config.inviteCode}` : 'Not selected', inline: true },
      { name: 'Status', value: config.messageId ? 'Deployed' : 'Not deployed', inline: true },
    )],
    components,
  };
}

function leaderboardView(interaction) {
  const config = safeConfig(interaction.guildId).leaderboardPanel;
  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🏆 Leaderboard Panel').setDescription('Deploy one leaderboard message that refreshes when invite totals change.').addFields(
      { name: 'Channel', value: config.channelId ? `<#${config.channelId}>` : 'Not selected', inline: true },
      { name: 'Status', value: config.messageId ? 'Deployed' : 'Not deployed', inline: true },
    )],
    components: [
      row(new ChannelSelectMenuBuilder().setCustomId('invites:leaderboard-channel').setPlaceholder('Select leaderboard channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
      row(button('invites:leaderboard-deploy', config.messageId ? 'Update Leaderboard' : 'Deploy Leaderboard', ButtonStyle.Success, !config.channelId), button('invites:leaderboard-refresh', 'Refresh Now', ButtonStyle.Secondary, !config.messageId), button('invites:home', 'Back')),
    ],
  };
}

function buildInviteStudioPayload(interaction) {
  const page = getSession(interaction).page;
  if (page === 'create') return createView(interaction);
  if (page === 'links') return linksView(interaction);
  if (page === 'public') return publicView(interaction);
  if (page === 'leaderboard') return leaderboardView(interaction);
  return overview(interaction);
}

async function updatePanel(interaction) {
  const payload = buildInviteStudioPayload(interaction);
  if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
  else await interaction.update(payload);
}

async function handleInviteStudioInteraction(interaction) {
  if (!String(interaction.customId || '').startsWith(PREFIX)) return false;
  if (String(interaction.customId).startsWith('invites:member-')) return publicPanels().handleMemberInteraction(interaction);
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) throw new Error('Manage Server permission is required.');

  const action = interaction.customId.slice(PREFIX.length);
  const state = getSession(interaction);
  const meta = { actorId: interaction.user.id, action: `invites_panel_${action}` };

  if (action === 'home') state.page = 'overview';
  else if (['create', 'links', 'public', 'leaderboard'].includes(action)) {
    state.page = action;
    if (action === 'create') state.draft = { channelId: interaction.channelId || null, roleIds: [], maxAge: 0, maxUses: 0, temporary: false };
  } else if (action === 'toggle') {
    const current = invites.getSection(interaction.guildId);
    invites.setEnabled(interaction.guildId, !current.enabled, meta);
  } else if (action === 'sync') {
    await interaction.deferUpdate();
    await invites.syncGuild(interaction.guild, meta);
    await interaction.editReply(buildInviteStudioPayload(interaction));
    return true;
  } else if (action === 'health') {
    const health = await invites.buildHealth(interaction.guild);
    await interaction.reply({ content: health.healthy ? '✅ Invite Studio is healthy.' : `⚠️ ${health.issues.length} issue(s), ${health.warnings.length} warning(s).`, flags: MessageFlags.Ephemeral });
    return true;
  } else if (action === 'repair') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const health = await invites.repair(interaction.guild, meta);
    await interaction.editReply(health.healthy ? '✅ Repair completed and Invite Studio is healthy.' : '⚠️ Repair completed, but issues remain.');
    return true;
  } else if (action === 'draft-channel' && interaction.isChannelSelectMenu()) state.draft.channelId = interaction.values[0];
  else if (action === 'draft-expiry' && interaction.isStringSelectMenu()) state.draft.maxAge = Number(interaction.values[0]);
  else if (action === 'draft-uses' && interaction.isStringSelectMenu()) state.draft.maxUses = Number(interaction.values[0]);
  else if (action === 'draft-roles' && interaction.isRoleSelectMenu()) state.draft.roleIds = interaction.values;
  else if (action === 'draft-temporary') state.draft.temporary = !state.draft.temporary;
  else if (action === 'public-channel' && interaction.isChannelSelectMenu()) publicPanels().savePanelConfig(interaction.guildId, 'publicPanel', { channelId: interaction.values[0] }, meta);
  else if (action === 'public-link' && interaction.isStringSelectMenu()) publicPanels().savePanelConfig(interaction.guildId, 'publicPanel', { inviteCode: interaction.values[0] }, meta);
  else if (action === 'leaderboard-channel' && interaction.isChannelSelectMenu()) publicPanels().savePanelConfig(interaction.guildId, 'leaderboardPanel', { channelId: interaction.values[0] }, meta);
  else if (action === 'public-deploy') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const message = await publicPanels().deployPublicPanel(interaction.guild, meta);
    await interaction.editReply(`✅ Public invite panel deployed in <#${message.channelId}>.`);
    return true;
  } else if (action === 'leaderboard-deploy') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const message = await publicPanels().deployLeaderboardPanel(interaction.guild, meta);
    await interaction.editReply(`✅ Leaderboard deployed in <#${message.channelId}>.`);
    return true;
  } else if (action === 'leaderboard-refresh') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const ok = await publicPanels().refreshLeaderboard(interaction.guild);
    await interaction.editReply(ok ? '✅ Leaderboard refreshed.' : '❌ The deployed leaderboard message could not be found.');
    return true;
  } else if (action === 'generate') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const result = await invites.createInviteLink(interaction.guild, state.draft, meta);
      state.page = 'links';
      await interaction.editReply(`✅ Invite created: ${result.invite.url}${result.record.roleIds.length ? `\nRoles: ${result.record.roleIds.map((id) => `<@&${id}>`).join(', ')}` : ''}`);
    } catch (error) {
      console.error('[InviteStudio] Failed to create invite:', error);
      await interaction.editReply(`❌ ${String(error?.message || error).slice(0, 1800)}`);
    }
    return true;
  } else if (action === 'delete') {
    const links = invites.listInviteLinks(interaction.guildId);
    const modal = new ModalBuilder()
      .setCustomId('invites:delete-modal')
      .setTitle('Delete invite link')
      .addComponents(row(new TextInputBuilder().setCustomId('code').setLabel('Invite code').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder(links[0]?.code || 'abc123')));
    await interaction.showModal(modal);
    return true;
  } else if (action === 'delete-modal' && interaction.isModalSubmit()) {
    const code = interaction.fields.getTextInputValue('code').trim();
    await invites.deleteInviteLink(interaction.guild, code, meta);
    state.page = 'links';
    await interaction.reply({ content: `✅ Invite ${code} deleted.`, flags: MessageFlags.Ephemeral });
    return true;
  } else return false;

  await updatePanel(interaction);
  return true;
}

module.exports = { buildInviteStudioPayload, handleInviteStudioInteraction };
