'use strict';

const { PermissionFlagsBits } = require('discord.js');
const guildManager = require('../../../core/guild/guildManager');
const statsStore = require('./statsStore');
const statsCounters = require('./statsCounters');
const sentinelScheduler = require('../../../owner/sentinel/schedulerRegistry.js');
const audit = require('../../../owner/auditIntelligence/auditIntelligence');

const activeVoiceSessions = new Map();
const refreshTimers = new Map();
const refreshInFlight = new Set();
const COUNTER_REFRESH_DELAY_MS = Number(process.env.STATS_COUNTER_REFRESH_DELAY_MS || 30000);
const COUNTER_REFRESH_INTERVAL_MS = Number(process.env.STATS_COUNTER_REFRESH_INTERVAL_MS || 15 * 60 * 1000);
const SCHEDULER_ID = 'stats:counter-refresh:global';
let startupTimer = null; let intervalTimer = null;

function sessionKey(guildId, userId) { return `${guildId}:${userId}`; }
function shouldRefreshCounters(guildId) { return Boolean(guildId && statsStore.isEnabled(guildId) && statsCounters.listCounters(guildId).length > 0); }

function queueCounterRefresh(guild, reason = 'activity') {
  if (!guild?.id || !shouldRefreshCounters(guild.id)) return false;
  const existing = refreshTimers.get(guild.id); if (existing) clearTimeout(existing);
  const timer = setTimeout(async () => { refreshTimers.delete(guild.id); await refreshGuildCounters(guild, reason); }, Math.max(5000, COUNTER_REFRESH_DELAY_MS));
  timer.unref?.(); refreshTimers.set(guild.id, timer); return true;
}

async function refreshGuildCounters(guild, reason = 'manual') {
  if (!guild?.id || !shouldRefreshCounters(guild.id) || refreshInFlight.has(guild.id)) return [];
  refreshInFlight.add(guild.id);
  try { const refreshed = await statsCounters.refreshCounters(guild); if (refreshed.length) console.log(`[Stats] Refreshed ${refreshed.length} counter(s) for ${guild.name} (${reason}).`); return refreshed; }
  catch (error) { console.error(`[Stats] Failed to refresh counters for ${guild.name || guild.id}:`, error); throw error; }
  finally { refreshInFlight.delete(guild.id); }
}

async function recordCounterRefreshAction(client, reason, results, failures) {
  const refreshed = results.reduce((sum, item) => sum + Number(item.count || 0), 0);
  if (reason !== 'startup' && refreshed < 1 && failures < 1) return;
  await audit.captureGoliathAction(client, {
    type: reason === 'startup' ? 'goliath.scheduler.stats_counter_refresh.startup' : 'goliath.scheduler.stats_counter_refresh',
    category: 'goliath', action: 'execute', system: 'Stats', result: failures ? 'Partial / Failed' : 'Success',
    summary: `Stats ${reason} counter refresh updated ${refreshed} configured counter(s) across ${results.length} guild(s) with ${failures} failure(s).`,
    metadata: { schedulerId: SCHEDULER_ID, reason, guildsChecked: results.length, countersRefreshed: refreshed, failures },
  }).catch((error) => console.warn('[Stats] Could not record counter refresh audit action:', error?.message || error));
}

async function refreshAllGuildCounters(client, reason = 'scheduled') {
  if (!client?.guilds?.cache) throw new Error('Discord client is unavailable.');
  const results = []; let failures = 0;
  for (const guild of client.guilds.cache.values()) {
    try { const refreshed = await refreshGuildCounters(guild, reason); results.push({ guildId: guild.id, count: refreshed.length, failed: false }); }
    catch (error) { failures += 1; results.push({ guildId: guild.id, count: 0, failed: true, error: error?.message || String(error) }); }
  }
  if (failures > 0) sentinelScheduler.fail(SCHEDULER_ID, new Error(`${failures} guild counter refresh operation(s) failed.`), { reason, guildsChecked: results.length, failures });
  else sentinelScheduler.beat(SCHEDULER_ID, { reason, guildsChecked: results.length, failures: 0 });
  await recordCounterRefreshAction(client, reason, results, failures);
  return results;
}

function startCounterRefreshScheduler(client) {
  if (!client?.guilds?.cache) throw new Error('Discord client is unavailable.');
  if (intervalTimer) return intervalTimer;
  const intervalMs = Math.max(60000, COUNTER_REFRESH_INTERVAL_MS);
  sentinelScheduler.register({ id: SCHEDULER_ID, module: 'stats', component: 'counter-refresh', intervalMs, staleAfterMs: Math.max(intervalMs * 3, 180000), details: { scope: 'all-guilds' } });
  startupTimer = setTimeout(() => { startupTimer = null; refreshAllGuildCounters(client, 'startup').catch((error) => { sentinelScheduler.fail(SCHEDULER_ID, error, { phase: 'startup' }); console.error('[Stats] Startup counter refresh failed:', error); }); }, 10000); startupTimer.unref?.();
  intervalTimer = setInterval(() => { refreshAllGuildCounters(client, 'scheduled').catch((error) => { sentinelScheduler.fail(SCHEDULER_ID, error, { phase: 'scheduled' }); console.error('[Stats] Scheduled counter refresh failed:', error); }); }, intervalMs); intervalTimer.unref?.();
  console.log('[Stats] Counter refresh scheduler started.'); return intervalTimer;
}

function stopCounterRefreshScheduler() {
  if (startupTimer) { clearTimeout(startupTimer); startupTimer = null; }
  if (intervalTimer) { clearInterval(intervalTimer); intervalTimer = null; }
  for (const timer of refreshTimers.values()) clearTimeout(timer);
  refreshTimers.clear(); refreshInFlight.clear(); activeVoiceSessions.clear();
  sentinelScheduler.stop(SCHEDULER_ID, { reason: 'stats scheduler stopped intentionally' }); return true;
}

function clearGuildVoiceSessions(guildId) {
  let cleared = 0;
  for (const key of [...activeVoiceSessions.keys()]) {
    if (!key.startsWith(`${guildId}:`)) continue;
    activeVoiceSessions.delete(key);
    cleared += 1;
  }
  return cleared;
}

function flushGuildVoiceSessions(guild, now = Date.now()) {
  if (!guild?.id) return 0;
  let flushed = 0;
  for (const [key, session] of [...activeVoiceSessions.entries()]) {
    if (!key.startsWith(`${guild.id}:`)) continue;
    activeVoiceSessions.delete(key);
    const userId = key.slice(guild.id.length + 1);
    const member = guild.members?.cache?.get?.(userId) || guild.voiceStates?.cache?.get?.(userId)?.member || null;
    const minutes = Math.max(0, (now - Number(session?.startedAt || now)) / 60000);
    if (!member || !session?.channelId || minutes <= 0) continue;
    statsStore.addVoiceMinutes(member, session.channelId, minutes);
    flushed += 1;
  }
  return flushed;
}

function reconcileGuildVoiceSessions(guild) {
  if (!guild?.id) return 0;
  clearGuildVoiceSessions(guild.id);
  if (!statsStore.isEnabled(guild.id) || statsStore.getStats(guild.id).trackVoice === false) return 0;
  const now = Date.now();
  let count = 0;
  for (const state of guild.voiceStates?.cache?.values?.() || []) {
    if (!state?.channelId || !state.member?.id || statsStore.isIgnoredActivity(state.member, state.channelId)) continue;
    activeVoiceSessions.set(sessionKey(guild.id, state.member.id), { startedAt: now, channelId: state.channelId });
    count += 1;
  }
  return count;
}

function reconcileActiveVoiceSessions(client) {
  if (!client?.guilds?.cache) return 0;
  activeVoiceSessions.clear();
  let count = 0;
  for (const guild of client.guilds.cache.values()) count += reconcileGuildVoiceSessions(guild);
  return count;
}

function applyRuntimeConfig(guild, changes = {}, guildOrMeta = guild) {
  if (!guild?.id) throw new Error('Guild is required.');
  const hasEnabled = typeof changes.enabled === 'boolean';
  const voiceEligibilityChanged = hasEnabled || ['trackVoice', 'ignoreBots', 'ignoredChannels', 'ignoredRoles'].some((key) => Object.prototype.hasOwnProperty.call(changes, key));
  if (voiceEligibilityChanged) flushGuildVoiceSessions(guild);
  if (hasEnabled) statsStore.setEnabled(guild.id, changes.enabled, guildOrMeta);
  const updates = { ...changes };
  delete updates.enabled;
  let stored = statsStore.getStats(guild.id);
  if (Object.keys(updates).length) {
    stored = statsStore.updateStats(guild.id, (current) => ({
      ...current,
      ...updates,
      settings: updates.settings ? { ...(current.settings || {}), ...updates.settings } : current.settings,
    }), guildOrMeta);
  }
  if (voiceEligibilityChanged) reconcileGuildVoiceSessions(guild);
  return { ...stored, enabled: statsStore.isEnabled(guild.id) };
}

async function startup(client) {
  if (!client?.guilds?.cache) throw new Error('Discord client is unavailable.');
  const sessions = reconcileActiveVoiceSessions(client);
  if (sessions) console.log(`[Stats] Reconciled ${sessions} active voice session(s) at startup.`);
  return startCounterRefreshScheduler(client);
}
function shutdown(client) {
  if (client?.guilds?.cache) {
    const now = Date.now();
    for (const guild of client.guilds.cache.values()) flushGuildVoiceSessions(guild, now);
  }
  statsCounters.stopAllCounterSchedules();
  return stopCounterRefreshScheduler();
}
async function resolveChannel(guild, channelId) { if (!channelId) return null; return guild.channels.cache.get(channelId) || guild.channels.fetch(channelId).catch(() => null); }

async function buildHealth(guild) {
  if (!guild?.id) throw new Error('Guild is required.');
  const config = statsStore.getStats(guild.id);
  const issues = [];
  const counters = statsCounters.listCounters(guild.id);
  const enabledCounters = counters.filter((counter) => counter.enabled !== false);
  const rawCounters = Array.isArray(config.counters) ? config.counters : [];
  const me = guild.members?.me || null;

  if (rawCounters.length !== counters.length) {
    issues.push({ code: 'counter_config_invalid', severity: 'error', configured: rawCounters.length, readable: counters.length });
  }
  const duplicateIds = [...new Set(counters.map((counter) => counter.id).filter((id, index, all) => id && all.indexOf(id) !== index))];
  for (const counterId of duplicateIds) issues.push({ code: 'counter_id_duplicate', severity: 'error', counterId });
  const channelIds = counters.map((counter) => counter.channelId).filter(Boolean);
  const duplicateChannelIds = [...new Set(channelIds.filter((id, index, all) => all.indexOf(id) !== index))];
  for (const channelId of duplicateChannelIds) issues.push({ code: 'counter_channel_duplicate', severity: 'error', channelId });

  const scheduler = sentinelScheduler.snapshot()[SCHEDULER_ID] || null;
  if (!intervalTimer || !scheduler || scheduler.state !== 'running') {
    issues.push({ code: 'scheduler_not_running', severity: 'error', schedulerId: SCHEDULER_ID });
  } else if (scheduler.lastBeatAt && Date.now() - Date.parse(scheduler.lastBeatAt) > Number(scheduler.staleAfterMs || 0)) {
    issues.push({ code: 'scheduler_stale', severity: 'error', schedulerId: SCHEDULER_ID, lastBeatAt: scheduler.lastBeatAt });
  }
  if (scheduler?.consecutiveFailures > 0) {
    issues.push({ code: 'scheduler_recent_failures', severity: 'warning', schedulerId: SCHEDULER_ID, consecutiveFailures: scheduler.consecutiveFailures });
  }

  for (const counter of enabledCounters) {
    const channel = await resolveChannel(guild, counter.channelId);
    if (!channel) {
      issues.push({ code: 'counter_channel_missing', severity: 'error', counterId: counter.id, channelId: counter.channelId, type: counter.segments?.[0]?.type || null });
      continue;
    }
    if (typeof channel.setName !== 'function') {
      issues.push({ code: 'counter_channel_unmanageable', severity: 'error', counterId: counter.id, channelId: counter.channelId, type: counter.segments?.[0]?.type || null });
    }
    if (me && !channel.permissionsFor?.(me)?.has(PermissionFlagsBits.ManageChannels)) {
      issues.push({ code: 'counter_manage_channels_missing', severity: 'error', counterId: counter.id, channelId: counter.channelId });
    }
    if (counter.categoryId) {
      const category = await resolveChannel(guild, counter.categoryId);
      if (!category) issues.push({ code: 'counter_category_missing', severity: 'warning', counterId: counter.id, categoryId: counter.categoryId });
      else if (channel.parentId !== category.id) issues.push({ code: 'counter_category_mismatch', severity: 'warning', counterId: counter.id, channelId: counter.channelId, categoryId: category.id });
    }
    for (const segment of counter.segments || []) {
      if (segment.type === 'role') {
        for (const roleId of segment.options?.roleIds || []) {
          if (!guild.roles.cache.has(roleId)) issues.push({ code: 'counter_role_missing', severity: 'warning', counterId: counter.id, roleId });
        }
      }
      if (segment.type === 'voice' && ['whitelist', 'blacklist'].includes(segment.options?.mode)) {
        for (const channelId of segment.options?.channelIds || []) {
          if (!guild.channels.cache.has(channelId)) issues.push({ code: 'counter_voice_reference_missing', severity: 'warning', counterId: counter.id, channelId });
        }
      }
      if (segment.type === 'datetime') {
        try { new Intl.DateTimeFormat('en-GB', { timeZone: segment.options?.timeZone || 'Europe/London' }).format(); }
        catch { issues.push({ code: 'counter_timezone_invalid', severity: 'warning', counterId: counter.id, timeZone: segment.options?.timeZone }); }
      }
    }
  }

  const retentionDays = Number(config.settings?.retentionDays || 0);
  if (!Number.isFinite(retentionDays) || retentionDays < 1 || retentionDays > 365) issues.push({ code: 'retention_invalid', severity: 'warning', value: config.settings?.retentionDays });
  try { new Intl.DateTimeFormat('en-GB', { timeZone: config.settings?.timeZone || 'Europe/London' }).format(); }
  catch { issues.push({ code: 'default_timezone_invalid', severity: 'warning', timeZone: config.settings?.timeZone }); }
  const activeVoiceCount = [...activeVoiceSessions.keys()].filter((key) => key.startsWith(`${guild.id}:`)).length;
  return {
    module: 'stats', guildId: guild.id, enabled: guildManager.isModuleEnabled(guild.id, 'stats'),
    healthy: issues.every((issue) => issue.severity !== 'error'), checkedAt: new Date().toISOString(),
    counters: { configured: counters.length, enabled: enabledCounters.length, missing: issues.filter((issue) => issue.code === 'counter_channel_missing').length },
    tracking: { messages: config.trackMessages !== false, voice: config.trackVoice !== false, members: config.trackMembers !== false, activeVoiceSessions: activeVoiceCount },
    scheduler: scheduler ? { state: scheduler.state, lastBeatAt: scheduler.lastBeatAt, consecutiveFailures: scheduler.consecutiveFailures } : null,
    issues,
  };
}

async function repair(guild) {
  if (!guild?.id) throw new Error('Guild is required.');
  const before = await buildHealth(guild);
  const repaired = [];

  if (before.issues.some((issue) => issue.code === 'scheduler_not_running')) {
    startCounterRefreshScheduler(guild.client);
    repaired.push({ type: 'scheduler', schedulerId: SCHEDULER_ID });
  }

  for (const issue of before.issues) {
    if (issue.code === 'counter_channel_missing' && issue.counterId) {
      const counter = statsCounters.listCounters(guild.id).find((item) => item.id === issue.counterId);
      if (!counter?.enabled) continue;
      const category = counter.categoryId ? await resolveChannel(guild, counter.categoryId) : null;
      const replacement = await statsCounters.createDock(guild, { ...counter, channelId: null, categoryId: category?.id || null, categoryName: statsStore.getStats(guild.id).settings?.categoryName }, guild);
      repaired.push({ type: 'counter-channel', counterId: replacement.id, channelId: replacement.channelId });
      continue;
    }

    if (issue.code === 'counter_manage_channels_missing' && issue.channelId) {
      const channel = await resolveChannel(guild, issue.channelId);
      if (channel) {
        await statsCounters.ensureManageChannels(guild, channel, 'repair this Stats counter');
        repaired.push({ type: 'permissions', counterId: issue.counterId, channelId: issue.channelId });
      }
      continue;
    }

    if (['counter_category_missing', 'counter_category_mismatch'].includes(issue.code) && issue.counterId) {
      const counter = statsCounters.listCounters(guild.id).find((item) => item.id === issue.counterId);
      const channel = counter?.channelId ? await resolveChannel(guild, counter.channelId) : null;
      if (!counter || !channel?.setParent) continue;
      const category = await statsCounters.findOrCreateCategory(guild, statsStore.getStats(guild.id).settings?.categoryName || '📊 SERVER STATS');
      await channel.setParent(category.id, { lockPermissions: false, reason: 'Goliath Stats health repair' });
      statsCounters.saveDock(guild.id, { ...counter, categoryId: category.id }, guild);
      repaired.push({ type: 'category', counterId: counter.id, categoryId: category.id });
    }
  }

  reconcileGuildVoiceSessions(guild);
  const refreshed = await refreshGuildCounters(guild, 'repair');
  const health = await buildHealth(guild);
  return { repaired, refreshed, health };
}
function exportConfig(guildId) { return { module: 'stats', guildId: String(guildId), exportedAt: new Date().toISOString(), config: { ...statsStore.getStats(guildId), enabled: guildManager.isModuleEnabled(guildId, 'stats') }, summary: statsStore.getSummary(guildId) }; }
function reset(guildId, meta = {}) { return statsStore.resetStats(guildId, meta); }

async function handleMessageCreate(message) { try { if (!message?.guild || !message.member || !statsStore.isEnabled(message.guild.id)) return; statsStore.addMessage(message); queueCounterRefresh(message.guild, 'message'); } catch (error) { console.error('[Stats] Failed to track message:', error); } }
async function handleVoiceStateUpdate(oldState, newState) {
  try {
    const guild = newState?.guild || oldState?.guild;
    const member = newState?.member || oldState?.member;
    if (!guild?.id || !member?.id) return;
    const key = sessionKey(guild.id, member.id);
    const oldChannelId = oldState?.channelId || null;
    const newChannelId = newState?.channelId || null;
    if (oldChannelId === newChannelId) return;
    const now = Date.now();
    const session = activeVoiceSessions.get(key);
    if (oldChannelId && session?.startedAt && session.channelId === oldChannelId) {
      activeVoiceSessions.delete(key);
      const minutes = Math.max(0, (now - session.startedAt) / 60000);
      if (minutes > 0 && statsStore.isEnabled(guild.id)) statsStore.addVoiceMinutes(member, oldChannelId, minutes);
    }
    if (newChannelId && statsStore.isEnabled(guild.id) && statsStore.getStats(guild.id).trackVoice !== false && !statsStore.isIgnoredActivity(member, newChannelId)) activeVoiceSessions.set(key, { startedAt: now, channelId: newChannelId });
    queueCounterRefresh(guild, 'voice');
  } catch (error) { console.error('[Stats] Failed to track voice:', error); }
}
async function handleGuildMemberAdd(member) { try { if (!member?.guild || !statsStore.isEnabled(member.guild.id)) return; statsStore.addMemberEvent(member, 'join'); queueCounterRefresh(member.guild, 'member-add'); } catch (error) { console.error('[Stats] Failed to track member add:', error); } }
async function handleGuildMemberRemove(member) { try { if (!member?.guild || !statsStore.isEnabled(member.guild.id)) return; statsStore.addMemberEvent(member, 'leave'); queueCounterRefresh(member.guild, 'member-remove'); } catch (error) { console.error('[Stats] Failed to track member remove:', error); } }

module.exports = { startup, shutdown, startCounterRefreshScheduler, stopCounterRefreshScheduler, flushGuildVoiceSessions, reconcileGuildVoiceSessions, applyRuntimeConfig, refreshGuildCounters, refreshAllGuildCounters, queueCounterRefresh, buildHealth, repair, exportConfig, reset, handleMessageCreate, handleVoiceStateUpdate, handleGuildMemberAdd, handleGuildMemberRemove };
