'use strict';
const { Events, EmbedBuilder } = require('discord.js');
const loggingService = require('../../core/logging/service');
const guildManager = require('../../core/guild/guildManager');
const invites = require('../../modules/communityStudio/invites/invites');
const tracking = require('../../modules/communityStudio/invites/invitesTracking');
async function sendConfiguredLog(guild, payload) { const channelId = invites.getSection(guild.id).settings.logChannelId; if (!channelId) return; const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null); if (channel?.send) await channel.send(payload).catch(() => null); }
async function logInviteCreate(invite) { if (!invite?.guild || !guildManager.isModuleEnabled(invite.guild.id, 'invites')) return; await invites.syncGuild(invite.guild, { action: 'invite_created' }).catch(() => null); invites.addHistory(invite.guild.id, { type: 'invite_created', code: invite.code, inviterId: invite.inviter?.id || null, channelId: invite.channelId || null }, { action: 'invite_created' }); await loggingService.send(invite.guild, 'invite.create', { title: 'Invite Created', color: '#57F287', fields: [{ name: 'Code', value: `\`${invite.code}\``, inline: true }, { name: 'Channel', value: invite.channel ? `${invite.channel}` : 'Unknown', inline: true }, { name: 'Inviter', value: invite.inviter ? `${invite.inviter}` : 'Unknown', inline: true }] }); }
async function logInviteDelete(invite) { if (!invite?.guild || !guildManager.isModuleEnabled(invite.guild.id, 'invites')) return; await invites.syncGuild(invite.guild, { action: 'invite_deleted' }).catch(() => null); invites.addHistory(invite.guild.id, { type: 'invite_deleted', code: invite.code, inviterId: invite.inviter?.id || null, channelId: invite.channelId || null }, { action: 'invite_deleted' }); await loggingService.send(invite.guild, 'invite.delete', { title: 'Invite Deleted', color: '#ED4245', fields: [{ name: 'Code', value: `\`${invite.code}\``, inline: true }, { name: 'Channel', value: invite.channel ? `${invite.channel}` : 'Unknown', inline: true }] }); }
function memberActivityEmbed(member, result, leaving = false) {
  const user = member.user;
  const timestamp = value => value ? `<t:${Math.floor(value / 1000)}:F>\n<t:${Math.floor(value / 1000)}:R>` : 'Unknown';
  const embed = new EmbedBuilder().setColor(leaving ? '#ED4245' : '#57F287')
    .setTitle(leaving ? '📤 Member Left' : '📨 Member Joined')
    .setDescription(leaving ? 'Member departure recorded by Invite Studio.' : 'Member arrival recorded by Invite Studio.')
    .addFields(
      { name: 'Member', value: leaving ? String(user?.tag || member.id) : `<@${member.id}>\n${user?.tag || member.id}`, inline: true },
      { name: 'User ID', value: `\`${member.id}\``, inline: true },
      { name: 'Member Count', value: String(member.guild.memberCount ?? 'Unknown'), inline: true },
      { name: 'Account Created', value: timestamp(user?.createdTimestamp), inline: true },
      { name: 'Joined Server', value: timestamp(member.joinedTimestamp), inline: true },
      { name: leaving ? 'Departure Recorded' : 'Arrival Recorded', value: timestamp(Date.now()), inline: true },
      { name: 'Inviter', value: result.inviterId ? `<@${result.inviterId}>` : 'Unknown / not attributed', inline: true },
      { name: 'Invite', value: result.inviteCode ? `\`${result.inviteCode}\`` : 'Unknown', inline: true }
    ).setFooter({ text: 'Goliath • Invite Studio' }).setTimestamp();
  if (leaving && result.inviterId) embed.addFields({ name: 'Invite Credit', value: 'Invite attribution updated following departure.', inline: false });
  const avatar = member.displayAvatarURL?.({ extension: 'png', size: 256 }) || user?.displayAvatarURL?.({ extension: 'png', size: 256 });
  if (avatar) embed.setThumbnail(avatar);
  return embed;
}
async function handleJoin(member) { const result = await tracking.trackJoin(member, { actorId: member.id, action: 'invite_member_join' }); if (!result) return; await loggingService.send(member.guild, 'invite.use', { title: 'Invite Used', color: '#5865F2', fields: [{ name: 'Member', value: `${member} \`${member.user?.tag || member.id}\``, inline: true }, { name: 'Inviter', value: result.inviterId ? `<@${result.inviterId}>` : 'Unknown', inline: true }, { name: 'Invite', value: result.inviteCode ? `\`${result.inviteCode}\`` : 'Unknown', inline: true }] }); await sendConfiguredLog(member.guild, { embeds: [memberActivityEmbed(member, result)], allowedMentions: { parse: [] } }); }
async function handleLeave(member) { const result = await tracking.trackLeave(member, { actorId: member.id, action: 'invite_member_leave' }); if (!result) return; await sendConfiguredLog(member.guild, { embeds: [memberActivityEmbed(member, result, true)], allowedMentions: { parse: [] } }); }
module.exports = [{ name: Events.ClientReady, once: true, async execute(client) { await tracking.startup(client); } }, { name: Events.InviteCreate, async execute(invite) { await logInviteCreate(invite); } }, { name: Events.InviteDelete, async execute(invite) { await logInviteDelete(invite); } }, { name: Events.GuildMemberAdd, async execute(member) { await handleJoin(member); } }, { name: Events.GuildMemberRemove, async execute(member) { await handleLeave(member); } }];