'use strict';

const guildManager = require('../../../core/guild/guildManager');
const { getModuleSection, updateModuleSection } = require('../../../core/guild/moduleSectionManager');
const emojis = require('../../utilityStudio/emojis/emojis');
const queue = require('./scheduledWelcomeQueue');
const messages = require('./scheduledWelcomeMessage');

const MODULE = 'welcome';
const now = () => new Date().toISOString();
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

function defaultAnalytics() {
  return {
    runs: 0,
    emptyRuns: 0,
    messagesSent: 0,
    membersWelcomed: 0,
    sendFailed: 0,
    roleRemovalFailed: 0,
    lastRunAt: null,
    lastRunDate: null,
    lastError: null,
  };
}

function defaultScheduledConfig() {
  return {
    enabled: false,
    queueRoleId: null,
    channelId: null,
    time: '19:00',
    timezone: 'Europe/London',
    message: '👋 Welcome our newest members!\n\n{members}',
    pingMembers: true,
    removeQueueRole: true,
    ignoreBots: true,
    batchSize: 20,
    completedMemberIds: [],
    analytics: defaultAnalytics(),
    createdAt: now(),
    updatedAt: now(),
  };
}

function cleanTime(value) {
  const match = String(value || '').trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return match ? `${match[1]}:${match[2]}` : '19:00';
}

function cleanTimezone(value) {
  const timezone = String(value || 'Europe/London').trim().slice(0, 80);
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return 'Europe/London';
  }
}

function normalizeScheduledConfig(value = {}) {
  const base = defaultScheduledConfig();
  const source = value && typeof value === 'object' ? value : {};
  const batchSize = Number(source.batchSize ?? base.batchSize);
  return {
    ...base,
    ...clone(source),
    enabled: source.enabled === true,
    queueRoleId: queue.cleanId(source.queueRoleId),
    channelId: queue.cleanId(source.channelId),
    time: cleanTime(source.time),
    timezone: cleanTimezone(source.timezone),
    message: String(source.message || base.message).slice(0, 1800),
    pingMembers: source.pingMembers !== false,
    removeQueueRole: source.removeQueueRole !== false,
    ignoreBots: source.ignoreBots !== false,
    batchSize: Number.isFinite(batchSize) ? Math.min(50, Math.max(1, Math.floor(batchSize))) : base.batchSize,
    completedMemberIds: [...new Set((Array.isArray(source.completedMemberIds) ? source.completedMemberIds : []).map(queue.cleanId).filter(Boolean))].slice(-1000),
    analytics: { ...defaultAnalytics(), ...(source.analytics || {}) },
    createdAt: source.createdAt || base.createdAt,
    updatedAt: source.updatedAt || now(),
  };
}

function getScheduledConfig(guildId) {
  const welcome = getModuleSection(guildId, MODULE, {});
  return normalizeScheduledConfig(welcome?.scheduled);
}

function updateScheduledConfig(guildId, patch = {}, meta = {}) {
  if (patch?.enabled === true && !guildManager.isModuleEnabled(guildId, MODULE)) {
    guildManager.setModuleEnabled(guildId, MODULE, true, { ...meta, action: meta.action || 'scheduled_welcome_enable_parent' });
  }
  let saved = null;
  updateModuleSection(guildId, MODULE, (section = {}) => {
    const current = normalizeScheduledConfig(section.scheduled);
    saved = normalizeScheduledConfig({ ...current, ...(patch || {}), updatedAt: now() });
    return { ...section, scheduled: saved, updatedAt: now() };
  }, {}, meta);
  return saved || getScheduledConfig(guildId);
}

function zonedDateKey(timezone, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: cleanTimezone(timezone), year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function resolveChannel(guild, channelId) {
  if (!guild || !channelId) return null;
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  return channel?.isTextBased?.() ? channel : null;
}

async function clearCompletedWithoutRole(guild, config) {
  if (!config.completedMemberIds.length || !config.queueRoleId) return config;
  await queue.refreshMembers(guild);
  const stillQueued = config.completedMemberIds.filter((memberId) => guild.members.cache.get(memberId)?.roles?.cache?.has(config.queueRoleId));
  if (stillQueued.length === config.completedMemberIds.length) return config;
  return updateScheduledConfig(guild.id, { completedMemberIds: stillQueued }, { action: 'scheduled_welcome_completed_cleanup' });
}

async function getWaitingMembers(guild) {
  let config = getScheduledConfig(guild.id);
  config = await clearCompletedWithoutRole(guild, config);
  const completed = new Set(config.completedMemberIds);
  const members = await queue.getQueuedMembers(guild, config);
  return members.filter((member) => !completed.has(member.id));
}

async function runScheduledWelcome(guild, options = {}) {
  let config = getScheduledConfig(guild.id);
  if (!options.force && !guildManager.isModuleEnabled(guild.id, MODULE)) return { skipped: true, reason: 'welcome_disabled' };
  if (!options.force && !config.enabled) return { skipped: true, reason: 'scheduled_disabled' };
  if (!config.queueRoleId) throw new Error('Scheduled Welcome queue role is not configured.');
  if (!config.channelId) throw new Error('Scheduled Welcome channel is not configured.');

  const channel = await resolveChannel(guild, config.channelId);
  if (!channel) throw new Error('Scheduled Welcome channel is unavailable.');
  const role = guild.roles.cache.get(config.queueRoleId) || await guild.roles.fetch(config.queueRoleId).catch(() => null);
  if (!role) throw new Error('Scheduled Welcome queue role is unavailable.');

  const waiting = await getWaitingMembers(guild);
  const runDate = zonedDateKey(config.timezone);
  if (!waiting.length) {
    const analytics = {
      ...config.analytics,
      runs: Number(config.analytics.runs || 0) + 1,
      emptyRuns: Number(config.analytics.emptyRuns || 0) + 1,
      lastRunAt: now(),
      lastRunDate: runDate,
      lastError: null,
    };
    updateScheduledConfig(guild.id, { analytics }, { actorId: options.actorId, action: 'scheduled_welcome_empty_run' });
    return { skipped: false, empty: true, welcomed: 0, messagesSent: 0, roleRemovalFailed: 0, errors: [] };
  }

  const batches = messages.splitIntoBatches(waiting, config, guild);
  let welcomed = 0;
  let messagesSent = 0;
  let sendFailed = 0;
  let roleRemovalFailed = 0;
  const errors = [];
  const completed = new Set(config.completedMemberIds);

  for (const batch of batches) {
    try {
      const payload = messages.buildBatchPayload(guild, batch, config);
      payload.content = await emojis.resolveText(guild.client, guild.id, payload.content);
      await channel.send(payload);
      messagesSent += 1;
      welcomed += batch.length;
      for (const member of batch) {
        if (!config.removeQueueRole) {
          completed.add(member.id);
          continue;
        }
        const removal = await queue.removeQueueRole(member, config.queueRoleId);
        if (!removal.removed && !removal.skipped) {
          roleRemovalFailed += 1;
          completed.add(member.id);
          errors.push(`${member.id}: welcome sent but queue role removal failed: ${removal.error || 'Unknown error'}`);
        }
      }
    } catch (error) {
      sendFailed += batch.length;
      errors.push(`Batch send failed: ${error.message || error}`);
    }
  }

  config = getScheduledConfig(guild.id);
  const analytics = {
    ...config.analytics,
    runs: Number(config.analytics.runs || 0) + 1,
    messagesSent: Number(config.analytics.messagesSent || 0) + messagesSent,
    membersWelcomed: Number(config.analytics.membersWelcomed || 0) + welcomed,
    sendFailed: Number(config.analytics.sendFailed || 0) + sendFailed,
    roleRemovalFailed: Number(config.analytics.roleRemovalFailed || 0) + roleRemovalFailed,
    lastRunAt: now(),
    lastRunDate: sendFailed > 0 ? config.analytics.lastRunDate : runDate,
    lastError: errors.length ? errors[0].slice(0, 500) : null,
  };
  updateScheduledConfig(guild.id, { analytics, completedMemberIds: [...completed] }, { actorId: options.actorId, action: 'scheduled_welcome_run' });

  return { skipped: false, empty: false, welcomed, messagesSent, sendFailed, roleRemovalFailed, errors };
}

module.exports = {
  MODULE,
  defaultScheduledConfig,
  normalizeScheduledConfig,
  getScheduledConfig,
  updateScheduledConfig,
  zonedDateKey,
  resolveChannel,
  getWaitingMembers,
  runScheduledWelcome,
};
