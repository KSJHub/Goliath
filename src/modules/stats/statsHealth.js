'use strict';

const stats = require('./stats');

async function resolveChannel(guild, channelId) {
  if (!channelId) return null;
  return guild.channels.cache.get(channelId) || guild.channels.fetch(channelId).catch(() => null);
}

async function buildHealth(guild) {
  if (!guild?.id) throw new Error('Guild is required.');
  const config = stats.getConfig(guild.id);
  const issues = [];
  const counters = stats.counters.listCounters(guild.id);

  for (const counter of counters) {
    const channel = await resolveChannel(guild, counter.channelId);
    if (!channel) {
      issues.push({ code: 'counter_channel_missing', severity: 'error', channelId: counter.channelId, type: counter.type });
      continue;
    }
    if (typeof channel.setName !== 'function') {
      issues.push({ code: 'counter_channel_unmanageable', severity: 'error', channelId: counter.channelId, type: counter.type });
    }
  }

  const retentionDays = Number(config.settings?.retentionDays || 0);
  if (!Number.isFinite(retentionDays) || retentionDays < 1) {
    issues.push({ code: 'retention_invalid', severity: 'warning', value: config.settings?.retentionDays });
  }

  return {
    module: 'stats',
    guildId: guild.id,
    enabled: config.enabled === true,
    healthy: issues.every((issue) => issue.severity !== 'error'),
    checkedAt: new Date().toISOString(),
    counters: { configured: counters.length, missing: issues.filter((issue) => issue.code === 'counter_channel_missing').length },
    tracking: {
      messages: config.trackMessages !== false,
      voice: config.trackVoice !== false,
      members: config.trackMembers !== false,
    },
    issues,
  };
}

async function repair(guild) {
  if (!guild?.id) throw new Error('Guild is required.');
  const before = await buildHealth(guild);
  let suite = null;

  if (before.issues.some((issue) => issue.code === 'counter_channel_missing')) {
    suite = await stats.counters.createCounterSuite(guild);
  }

  const refreshed = await stats.refreshGuildCounters(guild, 'repair');
  return { suite, refreshed, health: await buildHealth(guild) };
}

function exportConfig(guildId) {
  return {
    module: 'stats',
    guildId: String(guildId),
    exportedAt: new Date().toISOString(),
    config: stats.getConfig(guildId),
    summary: stats.getSummary(guildId),
  };
}

function reset(guildId, meta = {}) {
  return stats.reset(guildId, meta);
}

module.exports = { buildHealth, repair, exportConfig, reset };
