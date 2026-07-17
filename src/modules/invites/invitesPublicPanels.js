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
const DEFAULT_PUBLIC = {
  channelId: null,
  messageId: null,
  inviteCode: null,
  title: '💎 Help Grow the Community',
  description: 'Share our official invite link with your friends and help grow the community.\n\nWant to climb the leaderboard? Get your own personal invite below and every valid join will count towards your score.',
  color: '#5865F2',
  footer: 'Invite friends • Grow the community • Climb the leaderboard',
  buttonLabel: 'Join Server',
  showMemberHelp: true,
};
const DEFAULT_LEADERBOARD = {
  channelId: null,
  messageId: null,
  title: '🏆 Community Invite Leaderboard',
  description: 'Invite friends and climb the rankings.',
  color: '#5865F2',
  footer: 'Updated automatically by Goliath',
  limit: 10,
};

function cleanText(value, max) { return String(value ?? '').trim().slice(0, max); }
function cleanColor(value, fallback = '#5865F2') { const colour = cleanText(value, 7); return /^#[0-9a-f]{6}$/i.test(colour) ? colour : fallback; }
function panelConfig(guildId) {
  const settings = invites.getSection(guildId).settings || {};
  return {
    publicPanel: { ...DEFAULT_PUBLIC, ...(settings.publicPanel || {}) },
    leaderboardPanel: { ...DEFAULT_LEADERBOARD, ...(settings.leaderboardPanel || {}) },
  };
}
function savePanelConfig(guildId, key, patch, meta = {}) {
  const current = panelConfig(guildId)[key];
  const next = { ...current, ...patch };
  invites.updateSettings(guildId, { [key]: next }, meta);
  return next;
}
function row(...components) { return new ActionRowBuilder().addComponents(...components); }
function officialUrl(code) { return code ? `https://discord.gg/${code}` : null; }

function buildPublicPayload(guildId) {
  const { publicPanel } = panelConfig(guildId);
  const url = officialUrl(publicPanel.inviteCode);
  if (!url) throw new Error('Select a permanent Invite Studio link before deploying the public panel.');
  const embed = new EmbedBuilder()
    .setColor(cleanColor(publicPanel.color))
    .setTitle(cleanText(publicPanel.title, 256) || DEFAULT_PUBLIC.title)
    .setDescription(cleanText(publicPanel.description, 4000) || DEFAULT_PUBLIC.description)
    .setFooter({ text: cleanText(publicPanel.footer, 2048) || DEFAULT_PUBLIC.footer })
    .setTimestamp();
  const buttons = [new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel(cleanText(publicPanel.buttonLabel, 80) || 'Join Server')];
  if (publicPanel.showMemberHelp !== false) {
    buttons.push(new ButtonBuilder().setCustomId('invites:member-personal').setStyle(ButtonStyle.Primary).setLabel('Get My Invite'));
    buttons.push(new ButtonBuilder().setCustomId('invites:member-profile').setStyle(ButtonStyle.Secondary).setLabel('My Invite Profile'));
    buttons.push(new ButtonBuilder().setCustomId('invites:member-personal-delete').setStyle(ButtonStyle.Danger).setLabel('Delete My Invite'));
  }
  return { embeds: [embed], components: [row(...buttons)] };
}

function leaderboardLines(guildId, limit) {
  const entries = invites.leaderboard(guildId, limit);
  if (!entries.length) return 'No valid invites have been recorded yet.';
  const medals = ['🥇', '🥈', '🥉'];
  return entries.map((entry, index) => `${medals[index] || `**${index + 1}.**`} <@${entry.inviterId}> — **${entry.score}** valid invite${entry.score === 1 ? '' : 's'}`).join('\n');
}
function buildLeaderboardPayload(guildId) {
  const { leaderboardPanel } = panelConfig(guildId);
  const limit = Math.max(3, Math.min(25, Number(leaderboardPanel.limit || 10)));
  const embed = new EmbedBuilder()
    .setColor(cleanColor(leaderboardPanel.color))
    .setTitle(cleanText(leaderboardPanel.title, 256) || DEFAULT_LEADERBOARD.title)
    .setDescription(`${cleanText(leaderboardPanel.description, 1200) || DEFAULT_LEADERBOARD.description}\n\n${leaderboardLines(guildId, limit)}`)
    .setFooter({ text: cleanText(leaderboardPanel.footer, 2048) || DEFAULT_LEADERBOARD.footer })
    .setTimestamp();
  return { embeds: [embed], components: [] };
}

async function resolveChannel(guild, channelId) {
  const channel = channelId ? (guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null)) : null;
  if (!channel?.send) throw new Error('Select a text channel where Goliath can post this panel.');
  const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
  const permissions = channel.permissionsFor(me);
  if (!permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions.has(PermissionFlagsBits.SendMessages) || !permissions.has(PermissionFlagsBits.EmbedLinks)) {
    throw new Error(`Goliath needs View Channel, Send Messages and Embed Links in ${channel}.`);
  }
  return channel;
}
async function upsertMessage(guild, configKey, payload, meta = {}) {
  const config = panelConfig(guild.id)[configKey];
  const channel = await resolveChannel(guild, config.channelId);
  let message = config.messageId ? await channel.messages.fetch(config.messageId).catch(() => null) : null;
  if (message) await message.edit(payload);
  else message = await channel.send(payload);
  savePanelConfig(guild.id, configKey, { channelId: channel.id, messageId: message.id }, meta);
  return message;
}
async function deployPublicPanel(guild, meta = {}) { return upsertMessage(guild, 'publicPanel', buildPublicPayload(guild.id), meta); }
async function deployLeaderboardPanel(guild, meta = {}) { return upsertMessage(guild, 'leaderboardPanel', buildLeaderboardPayload(guild.id), meta); }
async function refreshLeaderboard(guild) {
  const config = panelConfig(guild.id).leaderboardPanel;
  if (!config.channelId || !config.messageId) return false;
  const channel = guild.channels.cache.get(config.channelId) || await guild.channels.fetch(config.channelId).catch(() => null);
  const message = channel?.messages ? await channel.messages.fetch(config.messageId).catch(() => null) : null;
  if (!message) return false;
  await message.edit(buildLeaderboardPayload(guild.id));
  return true;
}
function queueLeaderboardRefresh(guild, delay = 3000) {
  clearTimeout(refreshTimers.get(guild.id));
  refreshTimers.set(guild.id, setTimeout(() => {
    refreshTimers.delete(guild.id);
    refreshLeaderboard(guild).catch((error) => console.error('[InviteStudio] Leaderboard refresh failed:', error));
  }, delay));
}

function personalInviteChannelId(guildId) {
  const { publicPanel } = panelConfig(guildId);
  const official = publicPanel.inviteCode ? invites.listInviteLinks(guildId).find((link) => link.code === publicPanel.inviteCode) : null;
  return official?.channelId || null;
}

async function sendPersonalInviteDm(interaction, result) {
  const score = invites.leaderboard(interaction.guildId, 100).find((entry) => entry.inviterId === interaction.user.id)?.score || 0;
  const url = result.invite.url || officialUrl(result.record.code);
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`🔗 Your personal invite for ${interaction.guild.name}`)
    .setDescription(`Share this link to invite people to **${interaction.guild.name}** and increase your score on the invite leaderboard.\n\n${url}`)
    .addFields({ name: 'Current leaderboard score', value: String(score), inline: true })
    .setFooter({ text: 'This is your only active personal invite. Use the public panel to resend or delete it.' })
    .setTimestamp();
  return interaction.user.send({ embeds: [embed] });
}

async function handleMemberInteraction(interaction) {
  if (!String(interaction.customId || '').startsWith('invites:member-')) return false;

  const section = invites.getSection(interaction.guildId);
  if (!section.enabled) {
    await interaction.reply({ content: '❌ Invite Studio is currently disabled in this server.', flags: MessageFlags.Ephemeral });
    return true;
  }

  if (await memberProfiles.handleProfileInteraction(interaction)) return true;
  if (!['invites:member-personal', 'invites:member-personal-delete'].includes(interaction.customId)) return false;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (interaction.customId === 'invites:member-personal-delete') {
    const deleted = await invites.deletePersonalInvite(interaction.guild, interaction.user.id, { actorId: interaction.user.id, action: 'member_personal_invite_delete' });
    await interaction.editReply(deleted
      ? '✅ Your personal invite has been deleted. You may now create a new one using **Get My Invite**.'
      : 'ℹ️ You do not currently have a personal invite to delete.');
    return true;
  }

  const channelId = personalInviteChannelId(interaction.guildId);
  if (!channelId) {
    await interaction.editReply('❌ Management must select a permanent official invite in the Public Invite Panel before personal invites can be created.');
    return true;
  }

  try {
    const result = await invites.createPersonalInvite(interaction.guild, interaction.user.id, channelId, { actorId: interaction.user.id, action: 'member_personal_invite_get' });
    const url = result.invite.url || officialUrl(result.record.code);
    let dmSent = true;
    try { await sendPersonalInviteDm(interaction, result); } catch { dmSent = false; }

    if (dmSent) {
      await interaction.editReply(result.created
        ? '✅ Your personal invite has been created and sent to your DMs.'
        : '✅ Your existing personal invite has been resent to your DMs.');
    } else {
      await interaction.editReply([
        result.created ? '✅ Your personal invite has been created.' : '✅ Your existing personal invite has been found.',
        'I could not DM you, so your link is shown below:',
        '',
        url,
        '',
        'Share it to invite people and increase your leaderboard score.',
      ].join('\n'));
    }
  } catch (error) {
    await interaction.editReply(`❌ ${cleanText(error?.message || error, 1800)}`);
  }
  return true;
}

module.exports = {
  DEFAULT_PUBLIC,
  DEFAULT_LEADERBOARD,
  panelConfig,
  savePanelConfig,
  buildPublicPayload,
  buildLeaderboardPayload,
  deployPublicPanel,
  deployLeaderboardPanel,
  refreshLeaderboard,
  queueLeaderboardRefresh,
  handleMemberInteraction,
};