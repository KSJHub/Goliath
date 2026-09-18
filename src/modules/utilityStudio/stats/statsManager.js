'use strict';

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

async function startup(client) { if (!client?.guilds?.cache) throw new Error('Discord client is unavailable.'); return startCounterRefreshScheduler(client); }
function shutdown() { return stopCounterRefreshScheduler(); }
async function resolveChannel(guild, channelId) { if (!channelId) return null; return guild.channels.cache.get(channelId) || guild.channels.fetch(channelId).catch(() => null); }

async function buildHealth(guild) {
  if (!guild?.id) throw new Error('Guild is required.');
  const config = statsStore.getStats(guild.id); const issues = []; const counters = statsCounters.listCounters(guild.id);
  for (const counter of counters) { const channel = await resolveChannel(guild, counter.channelId); if (!channel) { issues.push({ code: 'counter_channel_missing', severity: 'error', channelId: counter.channelId, type: counter.type }); continue; } if (typeof channel.setName !== 'function') issues.push({ code: 'counter_channel_unmanageable', severity: 'error', channelId: counter.channelId, type: counter.type }); }
  const retentionDays = Number(config.settings?.retentionDays || 0); if (!Number.isFinite(retentionDays) || retentionDays < 1) issues.push({ code: 'retention_invalid', severity: 'warning', value: config.settings?.retentionDays });
  return { module: 'stats', guildId: guild.id, enabled: guildManager.isModuleEnabled(guild.id, 'stats'), healthy: issues.every((issue) => issue.severity !== 'error'), checkedAt: new Date().toISOString(), counters: { configured: counters.length, missing: issues.filter((issue) => issue.code === 'counter_channel_missing').length }, tracking: { messages: config.trackMessages !== false, voice: config.trackVoice !== false, members: config.trackMembers !== false }, issues };
}

async function repair(guild) { if (!guild?.id) throw new Error('Guild is required.'); const before = await buildHealth(guild); let suite = null; if (before.issues.some((issue) => issue.code === 'counter_channel_missing')) suite = await statsCounters.createCounterSuite(guild); const refreshed = await refreshGuildCounters(guild, 'repair'); return { suite, refreshed, health: await buildHealth(guild) }; }
function exportConfig(guildId) { return { module: 'stats', guildId: String(guildId), exportedAt: new Date().toISOString(), config: { ...statsStore.getStats(guildId), enabled: guildManager.isModuleEnabled(guildId, 'stats') }, summary: statsStore.getSummary(guildId) }; }
function reset(guildId, meta = {}) { return statsStore.resetStats(guildId, meta); }

async function handleMessageCreate(message) { try { if (!message?.guild || !message.member || !statsStore.isEnabled(message.guild.id)) return; statsStore.addMessage(message); queueCounterRefresh(message.guild, 'message'); } catch (error) { console.error('[Stats] Failed to track message:', error); } }
async function handleVoiceStateUpdate(oldState, newState) { try { const guild = newState?.guild || oldState?.guild; const member = newState?.member || oldState?.member; if (!guild?.id || !member?.id) return; const key = sessionKey(guild.id, member.id); if (newState?.channelId && !oldState?.channelId) activeVoiceSessions.set(key, Date.now()); if (!newState?.channelId && oldState?.channelId) { const started = activeVoiceSessions.get(key); activeVoiceSessions.delete(key); if (started && statsStore.isEnabled(guild.id)) statsStore.addVoiceDuration(guild.id, member.id, Date.now() - started); } queueCounterRefresh(guild, 'voice'); } catch (error) { console.error('[Stats] Failed to track voice:', error); } }
async function handleGuildMemberAdd(member) { try { if (!member?.guild || !statsStore.isEnabled(member.guild.id)) return; statsStore.recordMemberJoin(member); queueCounterRefresh(member.guild, 'member-add'); } catch (error) { console.error('[Stats] Failed to track member add:', error); } }
async function handleGuildMemberRemove(member) { try { if (!member?.guild || !statsStore.isEnabled(member.guild.id)) return; statsStore.recordMemberLeave(member); queueCounterRefresh(member.guild, 'member-remove'); } catch (error) { console.error('[Stats] Failed to track member remove:', error); } }

module.exports = { startup, shutdown, startCounterRefreshScheduler, stopCounterRefreshScheduler, refreshGuildCounters, refreshAllGuildCounters, queueCounterRefresh, buildHealth, repair, exportConfig, reset, handleMessageCreate, handleVoiceStateUpdate, handleGuildMemberAdd, handleGuildMemberRemove };
