'use strict';

const { Events } = require('discord.js');
const loggingService = require('../../core/logging/service');

const inviteCache = new Map();

function cacheKey(guildId) {
  return String(guildId || 'unknown');
}

async function refreshInvites(guild) {
  if (!guild) return new Map();

  const map = new Map();
  const invites = await guild.invites.fetch().catch(() => null);

  if (invites) {
    for (const invite of invites.values()) {
      if (invite.code) map.set(invite.code, invite.uses || 0);
    }
  }

  inviteCache.set(cacheKey(guild.id), map);
  return map;
}

async function logInviteCreate(invite) {
  if (!invite?.guild) return;

  await loggingService.send(invite.guild, 'invite.create', {
    title: 'Invite Created',
    color: '#57F287',
    fields: [
      { name: 'Code', value: `\`${invite.code}\``, inline: true },
      { name: 'Channel', value: invite.channel ? `${invite.channel}` : 'Unknown', inline: true },
      { name: 'Inviter', value: invite.inviter ? `${invite.inviter}` : 'Unknown', inline: true },
      { name: 'Max Uses', value: `\`${invite.maxUses || 'Unlimited'}\``, inline: true },
      { name: 'Temporary', value: invite.temporary ? 'Yes' : 'No', inline: true },
    ],
  });

  await refreshInvites(invite.guild);
}

async function logInviteDelete(invite) {
  if (!invite?.guild) return;

  await loggingService.send(invite.guild, 'invite.delete', {
    title: 'Invite Deleted',
    color: '#ED4245',
    fields: [
      { name: 'Code', value: `\`${invite.code}\``, inline: true },
      { name: 'Channel', value: invite.channel ? `${invite.channel}` : 'Unknown', inline: true },
    ],
  });

  await refreshInvites(invite.guild);
}

async function logInviteUse(member) {
  if (!member?.guild) return;

  const guild = member.guild;
  const previous = inviteCache.get(cacheKey(guild.id)) || new Map();
  const latest = await refreshInvites(guild);
  let usedInvite = null;

  for (const [code, uses] of latest.entries()) {
    const oldUses = previous.get(code) || 0;
    if (uses > oldUses) {
      usedInvite = { code, uses, previousUses: oldUses };
      break;
    }
  }

  await loggingService.send(guild, 'invite.use', {
    title: 'Invite Used',
    color: '#5865F2',
    fields: [
      { name: 'Member', value: `${member} \`${member.user?.tag || member.id}\``, inline: true },
      { name: 'Invite', value: usedInvite ? `\`${usedInvite.code}\`` : 'Unknown', inline: true },
      { name: 'Uses', value: usedInvite ? `\`${usedInvite.previousUses}\` to \`${usedInvite.uses}\`` : 'Unknown', inline: true },
    ],
  });
}

module.exports = [
  { name: Events.ClientReady, async execute(client) { for (const guild of client.guilds.cache.values()) await refreshInvites(guild); } },
  { name: Events.InviteCreate, async execute(invite) { await logInviteCreate(invite); } },
  { name: Events.InviteDelete, async execute(invite) { await logInviteDelete(invite); } },
  { name: Events.GuildMemberAdd, async execute(member) { await logInviteUse(member); } },
];
