'use strict';

const { Events } = require('discord.js');
const loggingService = require('../../core/logging/service');
const invites = require('../../modules/invites/invites');
const invitePanels = require('../../modules/invites/invitesPublicPanels');
const memberProfiles = require('../../modules/invites/invitesMemberProfiles');

async function sendConfiguredLog(guild, payload) {
  const section = invites.getSection(guild.id);
  const channelId = section.settings.logChannelId;
  if (!channelId) return;
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.send) return;
  await channel.send(payload).catch(() => null);
}

async function logInviteCreate(invite) {
  if (!invite?.guild) return;
  await invites.syncGuild(invite.guild, { action: 'invite_created' }).catch(() => null);
  invites.addHistory(invite.guild.id, { type: 'invite_created', code: invite.code, inviterId: invite.inviter?.id || null, channelId: invite.channelId || null }, { action: 'invite_created' });
  await loggingService.send(invite.guild, 'invite.create', {
    title: 'Invite Created', color: '#57F287', fields: [
      { name: 'Code', value: `\`${invite.code}\``, inline: true },
      { name: 'Channel', value: invite.channel ? `${invite.channel}` : 'Unknown', inline: true },
      { name: 'Inviter', value: invite.inviter ? `${invite.inviter}` : 'Unknown', inline: true },
      { name: 'Max Uses', value: `\`${invite.maxUses || 'Unlimited'}\``, inline: true },
    ],
  });
}

async function logInviteDelete(invite) {
  if (!invite?.guild) return;
  await invites.syncGuild(invite.guild, { action: 'invite_deleted' }).catch(() => null);
  invites.addHistory(invite.guild.id, { type: 'invite_deleted', code: invite.code, inviterId: invite.inviter?.id || null, channelId: invite.channelId || null }, { action: 'invite_deleted' });
  await loggingService.send(invite.guild, 'invite.delete', {
    title: 'Invite Deleted', color: '#ED4245', fields: [
      { name: 'Code', value: `\`${invite.code}\``, inline: true },
      { name: 'Channel', value: invite.channel ? `${invite.channel}` : 'Unknown', inline: true },
    ],
  });
}

async function handleJoin(member) {
  const result = await invites.trackJoin(member, { actorId: member.id, action: 'invite_member_join' });
  if (!result) return;
  invitePanels.queueLeaderboardRefresh(member.guild);
  if (result.inviterId) await memberProfiles.notifyInviteUsed(member.guild, result.inviterId, member).catch(() => null);
  await loggingService.send(member.guild, 'invite.use', {
    title: 'Invite Used', color: '#5865F2', fields: [
      { name: 'Member', value: `${member} \`${member.user?.tag || member.id}\``, inline: true },
      { name: 'Inviter', value: result.inviterId ? `<@${result.inviterId}>` : 'Unknown', inline: true },
      { name: 'Invite', value: result.inviteCode ? `\`${result.inviteCode}\`` : 'Unknown', inline: true },
      { name: 'Account', value: result.fake ? 'New account warning' : 'Established', inline: true },
    ],
  });
  await sendConfiguredLog(member.guild, {
    content: `📨 ${member} joined using ${result.inviteCode ? `\`${result.inviteCode}\`` : 'an unknown invite'}${result.inviterId ? ` from <@${result.inviterId}>` : ''}.`,
    allowedMentions: { users: result.inviterId ? [result.inviterId] : [] },
  });
}

async function handleLeave(member) {
  const result = await invites.trackLeave(member, { actorId: member.id, action: 'invite_member_leave' });
  if (!result) return;
  invitePanels.queueLeaderboardRefresh(member.guild);
  await sendConfiguredLog(member.guild, {
    content: `📤 **${member.user?.tag || member.id}** left.${result.inviterId ? ` Invite credit was updated for <@${result.inviterId}>.` : ''}`,
    allowedMentions: { users: result.inviterId ? [result.inviterId] : [] },
  });
}

module.exports = [
  { name: Events.ClientReady, once: true, async execute(client) { await invites.startup(client); } },
  { name: Events.InviteCreate, async execute(invite) { await logInviteCreate(invite); } },
  { name: Events.InviteDelete, async execute(invite) { await logInviteDelete(invite); } },
  { name: Events.GuildMemberAdd, async execute(member) { await handleJoin(member); } },
  { name: Events.GuildMemberRemove, async execute(member) { await handleLeave(member); } },
];
