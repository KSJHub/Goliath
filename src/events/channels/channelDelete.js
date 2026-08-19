const { AuditLogEvent } = require('discord.js');

const guildManager = require('../../core/guild/guildManager');
const securitySystem = require('../../core/security/securitySystem');
const antiNukeManager = require('../../core/security/antiNukeManager');
const {
  emitSyncEvent,
} = require('../../server/sockets/socketHub');

function channelPayload(channel, extra = {}) {
  return {
    module: 'channels',
    scope: 'channels',
    channelId: channel?.id || null,
    channelName: channel?.name || null,
    channelType: channel?.type || null,
    parentId: channel?.parentId || null,
    position: Number.isFinite(channel?.position) ? channel.position : null,
    ...extra,
  };
}

function emitChannelEvent(eventName, channel, extra = {}) {
  if (!channel?.guild?.id) return null;

  return emitSyncEvent(
    eventName,
    channel.guild.id,
    channelPayload(channel, extra)
  );
}

async function handleChannelDelete(channel) {
  if (!channel?.guild) return;

  if (!guildManager.isModuleEnabled(channel.guild.id, 'security')) {
    emitChannelEvent('channel.deleted', channel);
    return;
  }

  if (typeof antiNukeManager.handleChannelDelete === 'function') {
    await antiNukeManager.handleChannelDelete(channel);
    emitChannelEvent('channel.deleted', channel);
    return;
  }

  const executor =
    typeof securitySystem.fetchAuditExecutor === 'function'
      ? await securitySystem.fetchAuditExecutor(
          channel.guild,
          AuditLogEvent.ChannelDelete
        )
      : null;

  if (typeof securitySystem.logIncident === 'function') {
    await securitySystem.logIncident(channel.guild, {
      type: securitySystem.INCIDENT_TYPES?.CHANNEL_DELETE || 'channel_delete',
      severity: securitySystem.SEVERITY?.MEDIUM || 'medium',
      actorId: executor?.id || null,
      actorTag: executor?.tag || null,
      targetId: channel.id,
      targetName: channel.name || null,
      targetType: channel.type || 'channel',
      reason: 'Channel deleted.',
      actionTaken: 'Logged channel delete event.',
      metadata: {
        fallbackHook: true,
        actorIsBot: executor?.bot || false,
      },
    });
  }

  emitChannelEvent('channel.deleted', channel);
}

module.exports = [
  {
    name: 'channelCreate',

    async execute(channel) {
      try {
        if (!channel?.guild) return;

        emitChannelEvent('channel.created', channel, {
          syncedAt: new Date().toISOString(),
        });
      } catch (error) {
        console.error('[Event: channelCreate] Error:', error);
      }
    },
  },

  {
    name: 'channelUpdate',

    async execute(oldChannel, newChannel) {
      try {
        if (!newChannel?.guild) return;

        emitChannelEvent('channel.updated', newChannel, {
          oldChannelName: oldChannel?.name || null,
          oldParentId: oldChannel?.parentId || null,
          syncedAt: new Date().toISOString(),
        });
      } catch (error) {
        console.error('[Event: channelUpdate] Error:', error);
      }
    },
  },

  {
    name: 'channelDelete',

    /**
     * @param {import('discord.js').GuildChannel} channel
     */
    async execute(channel) {
      try {
        await handleChannelDelete(channel);
      } catch (err) {
        console.error('[Event: channelDelete] Error:', err);
      }
    },
  },
];