'use strict';

const { AuditLogEvent } = require('discord.js');
const socialStore = require('../../modules/socialStudio/socialAlerts/socialStudioStore');
const schedulerRegistry = require('../../owner/sentinel/schedulerRegistry');

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const CLEANUP_SCHEDULER_ID = 'social:creator-lifecycle-cleanup:global';
let cleanupTimer = null;

async function detectKick(member) {
  try {
    const logs = await member.guild.fetchAuditLogs({
      type: AuditLogEvent.MemberKick,
      limit: 6,
    });

    return logs.entries.some((entry) => {
      const createdAt = Number(entry?.createdTimestamp || 0);
      return String(entry?.target?.id || '') === String(member.user.id)
        && Date.now() - createdAt <= 15_000;
    });
  } catch {
    return false;
  }
}

function cleanupGuild(guildId) {
  return socialStore.deleteExpiredCreators(guildId, Date.now(), {
    actorId: 'system:social-studio-lifecycle',
  });
}

async function cleanupAllGuilds(client) {
  let cleaned = 0;
  for (const guild of client.guilds.cache.values()) {
    const result = cleanupGuild(guild.id);
    cleaned += Number(result?.deleted || result?.removed || 0);
  }
  return { guilds: client.guilds.cache.size, cleaned };
}

async function runCleanup(client, phase = 'scheduled') {
  try {
    const result = await cleanupAllGuilds(client);
    schedulerRegistry.beat(CLEANUP_SCHEDULER_ID, { phase, ...result });
    return result;
  } catch (error) {
    schedulerRegistry.fail(CLEANUP_SCHEDULER_ID, error, { phase });
    throw error;
  }
}

module.exports = [
  {
    name: 'clientReady',
    once: true,
    async execute(client) {
      schedulerRegistry.register({
        id: CLEANUP_SCHEDULER_ID,
        module: 'social',
        component: 'creator-lifecycle-cleanup',
        intervalMs: CLEANUP_INTERVAL_MS,
        staleAfterMs: CLEANUP_INTERVAL_MS * 3,
      });
      await runCleanup(client, 'startup');
      if (cleanupTimer) clearInterval(cleanupTimer);
      cleanupTimer = setInterval(() => {
        runCleanup(client, 'scheduled').catch((error) => {
          console.error('[Social Studio] Creator lifecycle cleanup failed:', error?.stack || error?.message || error);
        });
      }, CLEANUP_INTERVAL_MS);
      cleanupTimer.unref?.();
    },
  },
  {
    name: 'guildMemberAdd',
    async execute(member) {
      if (member.user?.bot) return;
      cleanupGuild(member.guild.id);
      socialStore.markCreatorActive(member.guild.id, member.user.id, {
        actorId: member.user.id,
      });
    },
  },
  {
    name: 'guildMemberRemove',
    async execute(member) {
      if (member.user?.bot) return;
      cleanupGuild(member.guild.id);
      const departureType = await detectKick(member) ? 'kicked' : 'left';
      socialStore.markCreatorDeparted(member.guild.id, member.user.id, departureType, {
        actorId: 'system:social-studio-lifecycle',
      });
    },
  },
  {
    name: 'guildBanAdd',
    async execute(ban) {
      if (ban.user?.bot) return;
      socialStore.deleteCreatorByOwner(ban.guild.id, ban.user.id, {
        actorId: 'system:social-studio-ban',
      });
    },
  },
];
