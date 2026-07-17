'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');
const invites = require('./invites');
const memberProfiles = require('./invitesMemberProfiles');

const refreshTimers = new Map();
const row = (...components) => new ActionRowBuilder().addComponents(...components);
const button = (id, label, style = ButtonStyle.Secondary) => new ButtonBuilder()
  .setCustomId(id)
  .setLabel(label)
  .setStyle(style);
const officialUrl = (code) => code ? `https://discord.gg/${code}` : null;

function panelConfig(guildId) {
  return invites.getSection(guildId).settings.publicPanel;
}

function savePanelConfig(guildId, patch, meta = {}) {
  const section = invites.getSection(guildId);
  const next = { ...section.settings.publicPanel, ...patch };
  invites.updateSettings(guildId, { publicPanel: next }, meta);
  return next;
}

function leaderboardLines(guildId, limit) {
  const entries = invites.leaderboard(guildId, limit);
  if (!entries.length) return 'No member invites have been recorded yet.';
  const medals = ['🥇', '🥈', '🥉'];
  return entries.map((entry, index) => {
    const prefix = medals[index] || `**${index + 1}.**`;
    return `${prefix} <@${entry.inviterId}> — **${entry.score}** valid invite${entry.score === 1 ? '' : 's'}`;
  }).join('\n');
}

function buildPublicPayload(guildId) {
  const section = invites.getSection(guildId);
  const panel = section.settings.publicPanel;
  const officialCode = section.settings.officialInvite.code;
  const url = officialUrl(officialCode);
  if (!url) throw new Error('Create the official Goliath invite before sending the public panel.');

  const updated = panel.lastRefreshedAt
    ? `<t:${Math.floor(new Date(panel.lastRefreshedAt).getTime() / 1000)}:R>`
    : 'Waiting for first refresh';

  const embed = new EmbedBuilder()
    .setColor(panel.color)
    .setTitle(panel.title)
    .setDescription(panel.description)
    .addFields(
      { name: 'Official Server Invite', value: url, inline: false },
      { name: 'Leaderboard Updated', value: updated, inline: true },
      { name: 'Automatic Refresh', value: 'Every 2 hours', inline: true },
      { name: '🏆 Invite Leaderboard', value: leaderboardLines(guildId, panel.leaderboardLimit), inline: false },
    )
    .setFooter({ text: panel.footer })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      row(
        button('invites:member-personal', 'Create My Link', ButtonStyle.Primary),
        button('invites:member-profile', 'My Profile', ButtonStyle.Secondary),
        button('invites:member-refresh', 'Update Leaderboard', ButtonStyle.Secondary),
      ),
    ],
  };
}

async function resolveChannel(guild, channelId) {
  const channel = channelId
    ? (guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null))
    : null;
  if (!channel?.send) throw new Error('Select a text channel where Goliath can post the panel.');
  const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
  const permissions = channel.permissionsFor(me);
  if (!permissions?.has(PermissionFlagsBits.ViewChannel)
    || !permissions.has(PermissionFlagsBits.SendMessages)
    || !permissions.has(PermissionFlagsBits.EmbedLinks)) {
    throw new Error(`Goliath needs View Channel, Send Messages and Embed Links in ${channel}.`);
  }
  return channel;
}

async function deployPublicPanel(guild, meta = {}) {
  const panel = panelConfig(guild.id);
  const channel = await resolveChannel(guild, panel.channelId);
  let message = panel.messageId ? await channel.messages.fetch(panel.messageId).catch(() => null) : null;
  savePanelConfig(guild.id, { lastRefreshedAt: new Date().toISOString() }, meta);
  const payload = buildPublicPayload(guild.id);
  if (message) await message.edit(payload);
  else message = await channel.send(payload);
  savePanelConfig(guild.id, { channelId: channel.id, messageId: message.id }, meta);
  return message;
}

async function refreshPublicPanel(guild, meta = {}) {
  const panel = panelConfig(guild.id);
  if (!panel.channelId || !panel.messageId) return false;
  const channel = guild.channels.cache.get(panel.channelId)
    || await guild.channels.fetch(panel.channelId).catch(() => null);
  const message = channel?.messages
    ? await channel.messages.fetch(panel.messageId).catch(() => null)
    : null;
  if (!message) return false;
  savePanelConfig(guild.id, { lastRefreshedAt: new Date().toISOString() }, meta);
  await message.edit(buildPublicPayload(guild.id));
  return true;
}

function queueLeaderboardRefresh(guild, delay = 3000) {
  const key = `queue:${guild.id}`;
  clearTimeout(refreshTimers.get(key));
  refreshTimers.set(key, setTimeout(() => {
    refreshTimers.delete(key);
    refreshPublicPanel(guild, { action: 'invite_panel_join_refresh' })
      .catch((error) => console.error('[InviteStudio] Panel refresh failed:', error));
  }, delay));
}

function startAutoRefresh(guild, intervalMs = invites.TWO_HOURS_MS) {
  const key = `interval:${guild.id}`;
  if (refreshTimers.has(key)) return;
  const timer = setInterval(() => {
    refreshPublicPanel(guild, { action: 'invite_panel_two_hour_refresh' })
      .catch((error) => console.error('[InviteStudio] Scheduled panel refresh failed:', error));
  }, intervalMs);
  timer.unref?.();
  refreshTimers.set(key, timer);
}

function renderTemplate(text, interaction, url) {
  return String(text || '')
    .replaceAll('{server}', interaction.guild.name)
    .replaceAll('{user}', interaction.user.username)
    .replaceAll('{invite}', url);
}

function personalInvitePayload(interaction, result) {
  const template = invites.getSection(interaction.guildId).settings.memberInviteTemplate;
  const url = result.invite.url || officialUrl(result.record.code);
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(renderTemplate(template.dmTitle, interaction, url))
    .setDescription(renderTemplate(template.dmMessage, interaction, url))
    .setFooter({ text: 'This is your only personal Invite Studio link.' })
    .setTimestamp();
  return { embeds: [embed] };
}

async function sendPersonalInviteDm(interaction, result) {
  return interaction.user.send(personalInvitePayload(interaction, result));
}

async function handleMemberInteraction(interaction) {
  const customId = String(interaction.customId || '');
  if (!customId.startsWith('invites:member-')) return false;
  const section = invites.getSection(interaction.guildId);

  if (!section.enabled) {
    await interaction.reply({ content: '❌ Invite Studio is currently disabled.', flags: MessageFlags.Ephemeral });
    return true;
  }

  if (customId === 'invites:member-profile') {
    return memberProfiles.handleProfileInteraction(interaction);
  }

  if (customId === 'invites:member-configure') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: '❌ Manage Server permission is required.', flags: MessageFlags.Ephemeral });
      return true;
    }
    const panel = require('./invitesAdminPanel');
    await interaction.reply({ ...panel.buildInviteStudioPayload(interaction, 'configure'), flags: MessageFlags.Ephemeral });
    return true;
  }

  if (customId === 'invites:member-refresh') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const ok = await refreshPublicPanel(interaction.guild, {
      actorId: interaction.user.id,
      action: 'member_manual_leaderboard_refresh',
    });
    await interaction.editReply(ok
      ? '✅ The leaderboard has been updated.'
      : '❌ The deployed Invite Studio panel could not be found.');
    return true;
  }

  if (customId !== 'invites:member-personal') return false;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const result = await invites.createPersonalInvite(interaction.guild, interaction.user.id, null, {
      actorId: interaction.user.id,
      action: 'member_personal_invite_get',
    });

    let dmSent = true;
    try {
      await sendPersonalInviteDm(interaction, result);
    } catch {
      dmSent = false;
    }

    const payload = personalInvitePayload(interaction, result);
    await interaction.editReply({
      ...payload,
      content: dmSent
        ? (result.created
          ? '✅ Your personal link has been created and sent to your DMs. A private copy is also shown below.'
          : '✅ Your existing personal link has been resent to your DMs. A private copy is also shown below.')
        : '⚠️ I could not DM you. Your private personal-link message is shown below instead.',
    });
  } catch (error) {
    await interaction.editReply(`❌ ${String(error?.message || error).slice(0, 1800)}`);
  }
  return true;
}

module.exports = {
  panelConfig,
  savePanelConfig,
  buildPublicPayload,
  deployPublicPanel,
  refreshPublicPanel,
  refreshLeaderboard: refreshPublicPanel,
  queueLeaderboardRefresh,
  startAutoRefresh,
  handleMemberInteraction,
};