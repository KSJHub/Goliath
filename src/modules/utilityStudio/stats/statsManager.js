'use strict';

const statsStore = require('./statsStore');
const statsCounters = require('./statsCounters');
const sentinelScheduler = require('../../../owner/sentinel/schedulerRegistry.js');

const activeVoiceSessions = new Map();
const refreshTimers = new Map();
const refreshInFlight = new Set();

const COUNTER_REFRESH_DELAY_MS = Number(process.env.STATS_COUNTER_REFRESH_DELAY_MS || 30000);
const COUNTER_REFRESH_INTERVAL_MS = Number(process.env.STATS_COUNTER_REFRESH_INTERVAL_MS || 15 * 60 * 1000);
const SCHEDULER_ID = 'stats:counter-refresh:global';
let startupTimer = null;
let intervalTimer = null;

function sessionKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function shouldRefreshCounters(guildId) {
  if (!guildId || !statsStore.isEnabled(guildId)) return false;
  return statsCounters.listCounters(guildId).length > 0;
}

function queueCounterRefresh(guild, reason = 'activity') {
  if (!guild?.id || !shouldRefreshCounters(guild.id)) return false;

  const existing = refreshTimers.get(guild.id);
  if (existing) clearTimeout(existing);

  const delay = Math.max(5000, COUNTER_REFRESH_DELAY_MS);
  const timer = setTimeout(async () => {
    refreshTimers.delete(guild.id);
    await refreshGuildCounters(guild, reason);
  }, delay);

  timer.unref?.();
  refreshTimers.set(guild.id, timer);
  return true;
}

async function refreshGuildCounters(guild, reason = 'manual') {
  if (!guild?.id || !shouldRefreshCounters(guild.id)) return [];
  if (refreshInFlight.has(guild.id)) return [];

  refreshInFlight.add(guild.id);
  try {
    const refreshed = await statsCounters.refreshCounters(guild);
    if (refreshed.length) {
      console.log(`[Stats] Refreshed ${refreshed.length} counter(s) for ${guild.name} (${reason}).`);
    }
    return refreshed;
  } catch (error) {
    console.error(`[Stats] Failed to refresh counters for ${guild.name || guild.id}:`, error);
    throw error;
  } finally {
    refreshInFlight.delete(guild.id);
  }
}

async function refreshAllGuildCounters(client, reason = 'scheduled') {
  if (!client?.guilds?.cache) throw new Error('Discord client is unavailable.');
  const results = [];
  let failures = 0;
  for (const guild of client.guilds.cache.values()) {
    try {
      const refreshed = await refreshGuildCounters(guild, reason);
      results.push({ guildId: guild.id, count: refreshed.length, failed: false });
    } catch (error) {
      failures += 1;
      results.push({ guildId: guild.id, count: 0, failed: true, error: error?.message || String(error) });
    }
  }
  if (failures > 0) {
    sentinelScheduler.fail(SCHEDULER_ID, new Error(`${failures} guild counter refresh operation(s) failed.`), {
      reason,
      guildsChecked: results.length,
      failures,
    });
  } else {
    sentinelScheduler.beat(SCHEDULER_ID, { reason, guildsChecked: results.length, failures: 0 });
  }
  return results;
}

function startCounterRefreshScheduler(client) {
  if (!client?.guilds?.cache) throw new Error('Discord client is unavailable.');
  if (intervalTimer) return intervalTimer;

  const intervalMs = Math.max(60000, COUNTER_REFRESH_INTERVAL_MS);
  sentinelScheduler.register({
    id: SCHEDULER_ID,
    module: 'stats',
    component: 'counter-refresh',
    intervalMs,
    staleAfterMs: Math.max(intervalMs * 3, 180000),
    details: { scope: 'all-guilds' },
  });

  startupTimer = setTimeout(() => {
    startupTimer = null;
    refreshAllGuildCounters(client, 'startup').catch((error) => {
      sentinelScheduler.fail(SCHEDULER_ID, error, { phase: 'startup' });
      console.error('[Stats] Startup counter refresh failed:', error);
    });
  }, 10000);
  startupTimer.unref?.();

  intervalTimer = setInterval(() => {
    refreshAllGuildCounters(client, 'scheduled').catch((error) => {
      sentinelScheduler.fail(SCHEDULER_ID, error, { phase: 'scheduled' });
      console.error('[Stats] Scheduled counter refresh failed:', error);
    });
  }, intervalMs);

  intervalTimer.unref?.();
  console.log('[Stats] Counter refresh scheduler started.');
  return intervalTimer;
}

function stopCounterRefreshScheduler() {
  if (startupTimer) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
  for (const timer of refreshTimers.values()) clearTimeout(timer);
  refreshTimers.clear();
  refreshInFlight.clear();
  activeVoiceSessions.clear();
  sentinelScheduler.stop(SCHEDULER_ID, { reason: 'stats scheduler stopped intentionally' });
  return true;
}

async function handleMessageCreate(message) {
  try {
    if (!message?.guild || !message.member || !statsStore.isEnabled(message.guild.id)) return;
    statsStore.addMessage(message);
    queueCounterRefresh(message.guild, 'message');
  } catch (error) {
    console.error('[Stats] Failed to track message:', error);
  }
}

async function handleVoiceStateUpdate(oldState, newState) {
  try {
    const guild = newState?.guild || oldState?.guild;
    const member = newState?.member || oldState?.member;
    if (!guild?.id || !member?.id) return;

    const key = sessionKey(guild.id, member.id);
    if (!statsStore.isEnabled(guild.id)) {
      activeVoiceSessions.delete(key);
      return;
    }

    const oldChannelId = oldState?.channelId || null;
    const newChannelId = newState?.channelId || null;

    if (oldChannelId && oldChannelId !== newChannelId) {
      const session = activeVoiceSessions.get(key);
      if (session?.joinedAt && session.channelId) {
        const minutes = (Date.now() - session.joinedAt) / 60000;
        statsStore.addVoiceMinutes(member, session.channelId, minutes);
      }
      activeVoiceSessions.delete(key);
    }

    if (newChannelId && oldChannelId !== newChannelId) {
      activeVoiceSessions.set(key, {
        guildId: guild.id,
        userId: member.id,
        channelId: newChannelId,
        joinedAt: Date.now(),
      });
    }

    if (oldChannelId !== newChannelId) queueCounterRefresh(guild, 'voice');
  } catch (error) {
    console.error('[Stats] Failed to track voice state:', error);
  }
}

async function handleGuildMemberAdd(member) {
  try {
    if (!member?.guild?.id || !statsStore.isEnabled(member.guild.id)) return;
    statsStore.addMemberEvent(member, 'join');
    queueCounterRefresh(member.guild, 'member join');
  } catch (error) {
    console.error('[Stats] Failed to track member join:', error);
  }
}

async function handleGuildMemberRemove(member) {
  try {
    if (!member?.guild?.id || !statsStore.isEnabled(member.guild.id)) return;
    statsStore.addMemberEvent(member, 'leave');
    queueCounterRefresh(member.guild, 'member leave');
  } catch (error) {
    console.error('[Stats] Failed to track member leave:', error);
  }
}

module.exports = {
  handleMessageCreate,
  handleVoiceStateUpdate,
  handleGuildMemberAdd,
  handleGuildMemberRemove,
  queueCounterRefresh,
  refreshGuildCounters,
  refreshAllGuildCounters,
  startCounterRefreshScheduler,
  stopCounterRefreshScheduler,
};