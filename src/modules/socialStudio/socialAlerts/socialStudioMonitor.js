'use strict';

const { EmbedBuilder } = require('discord.js');
const guildManager = require('../../../core/guild/guildManager');
const sentinel = require('../../../owner/sentinel');
const sentinelScheduler = require('../../../owner/sentinel/schedulerRegistry.js');
const core = require('./socialStudioMonitorCore');
const { projectEffectiveAccounts } = require('./socialStudioRoutingResolver');

const LIVE_REFRESH_INTERVALS = Object.freeze([600000, 900000, 1200000, 1800000, 2700000, 3600000]);
const LIVE_REFRESH_INTERVAL_SET = new Set(LIVE_REFRESH_INTERVALS);
const DEFAULT_LIVE_REFRESH_MS = LIVE_REFRESH_INTERVALS[0];
const PLATFORM_FIELDS = Object.freeze({ twitch: ['🟣', 'Twitch'], youtube: ['🔴', 'YouTube'], tiktok: ['⚫', 'TikTok'], kick: ['🟢', 'Kick'], facebook: ['🔵', 'Facebook'], instagram: ['🟠', 'Instagram'], x: ['⚪', 'X'] });
let timer = null;
let schedulerTickMs = 60000;
const GLOBAL_SCHEDULER = 'social:monitor:global';

function clean(value, max = 2000) { return String(value ?? '').trim().slice(0, max); }
function intText(value) { return Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-GB') : ''; }
function liveRefreshEnabled(settings = {}) { return settings.liveMessageRefreshEnabled !== false; }
function liveRefreshMs(settings = {}) { const requested = Number(settings.liveMessageRefreshMs); return LIVE_REFRESH_INTERVAL_SET.has(requested) ? requested : DEFAULT_LIVE_REFRESH_MS; }
function projectedRefreshTimestamp(account, state, settings = {}, dateNow = Date.now()) {
  if (state?.isLive !== true || !liveRefreshEnabled(settings)) return null;
  const raw = state.lastLiveMessageUpdatedAt || state.lastLiveMessageUpdateAt || null;
  const actualMs = typeof raw === 'number' ? raw : raw instanceof Date ? raw.getTime() : Date.parse(String(raw || ''));
  if (!Number.isFinite(actualMs)) return null;
  return new Date(actualMs + liveRefreshMs(settings));
}
function projectLiveRefreshState(account, history = [], settings = {}) {
  if (!account || typeof account !== 'object') return account;
  const state = account.state && typeof account.state === 'object' ? account.state : null;
  if (!state) return account;
  const dedicated = state.isLive === true && Boolean(state.lastLiveMessageId && state.lastLiveMessageChannelId);
  const legacy = state.isLive === true && !dedicated && state.lastAlertMessageId && state.lastAlertChannelId ? { lastLiveMessageId: state.lastAlertMessageId, lastLiveMessageChannelId: state.lastAlertChannelId } : {};
  const persisted = dedicated || Boolean(legacy.lastLiveMessageId && legacy.lastLiveMessageChannelId);
  const historyHit = !persisted ? [...(Array.isArray(history) ? history : [])].reverse().find((entry) => entry?.accountId && String(entry.accountId) === String(account.accountId) && (entry.status === 'alert_sent' || entry.status === 'alert_updated') && entry.alertType === 'live' && entry.messageId && entry.channelId) : null;
  const recovered = state.isLive === true && historyHit ? { lastAlertMessageId: historyHit.messageId, lastAlertChannelId: historyHit.channelId, lastLiveMessageId: historyHit.messageId, lastLiveMessageChannelId: historyHit.channelId, lastAlertKey: state.liveEventId ? `live:${state.liveEventId}` : state.lastAlertKey, lastLiveMessageUpdatedAt: historyHit.createdAt || state.lastLiveMessageUpdatedAt } : {};
  const effectiveState = { ...state, ...legacy, ...recovered };
  const tracked = effectiveState.isLive === true && Boolean((effectiveState.lastLiveMessageId || effectiveState.lastAlertMessageId) && (effectiveState.lastLiveMessageChannelId || effectiveState.lastAlertChannelId));
  const configuredTypes = Array.isArray(account.alertTypes) ? account.alertTypes : null;
  const alertTypes = configuredTypes && tracked && configuredTypes.some((type) => String(type).toLowerCase() === 'live')
    ? [...new Set([...configuredTypes, 'ended'])]
    : configuredTypes;
  return { ...account, ...(Array.isArray(alertTypes) ? { alertTypes } : {}), state: effectiveState };
}
function projectGuildConfig(guildConfig) {
  if (!guildConfig || typeof guildConfig !== 'object') return guildConfig;
  const modules = guildConfig.modules && typeof guildConfig.modules === 'object' ? guildConfig.modules : {};
  const social = modules.social && typeof modules.social === 'object' ? modules.social : null;
  if (!social) return guildConfig;
  const effectiveAccounts = projectEffectiveAccounts(social);
  const history = Array.isArray(social.history) ? social.history : [];
  const rawSettings = social.settings && typeof social.settings === 'object' ? social.settings : {};
  const settings = { ...rawSettings, liveMessageRefreshEnabled: rawSettings.liveMessageRefreshEnabled !== false, liveMessageRefreshMs: liveRefreshMs(rawSettings) };
  const accounts = Object.fromEntries(Object.entries(effectiveAccounts && typeof effectiveAccounts === 'object' ? effectiveAccounts : {}).map(([id, account]) => [id, projectLiveRefreshState(account, history, settings)]));
  return { ...guildConfig, modules: { ...modules, social: { ...social, settings, accounts } } };
}
function projectedOptions(guildId, options = {}) { const source = options.guildConfig && typeof options.guildConfig === 'object' ? options.guildConfig : guildManager.reloadGuild(guildId); return { ...options, guildConfig: projectGuildConfig(source) }; }

function rolloverIncident(guild, account) { return { guildId: guild?.id || null, guildName: guild?.name || null, module: 'social', component: `${account?.platform || 'unknown'}:${account?.username || account?.externalId || account?.accountId || 'account'}`, code: 'live-event-rollover-missed' }; }
async function removeStaleLivePost(client, guildId, previous) {
  const channelId = previous?.lastLiveMessageChannelId || previous?.lastAlertChannelId; const messageId = previous?.lastLiveMessageId || previous?.lastAlertMessageId;
  if (!channelId || !messageId) return false;
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null); if (!guild) return false;
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null); if (!channel?.messages?.fetch) return false;
  const message = await channel.messages.fetch(messageId).catch(() => null); if (!message) return false; await message.delete(); return true;
}
async function repairLiveRollovers(client, guildId, beforeConfig, result) {
  if (!result || result.skipped) return result;
  const guild = client.guilds.cache.get(guildId) || null; const beforeSocial = beforeConfig?.modules?.social || {}; const latestGuild = guildManager.reloadGuild(guildId) || {}; const latestSocial = latestGuild?.modules?.social || {}; const repairs = [];
  for (const item of result.results || []) {
    if (item?.isLive !== true || !item.accountId) continue;
    const beforeAccount = beforeSocial.accounts?.[item.accountId]; const currentAccount = latestSocial.accounts?.[item.accountId]; const previous = beforeAccount?.state || {}; const current = currentAccount?.state || {};
    const previousEventId = previous.liveEventId ? String(previous.liveEventId) : ''; const currentEventId = current.liveEventId ? String(current.liveEventId) : '';
    if (previous.isLive !== true || !previousEventId || !currentEventId || previousEventId === currentEventId || String(current.lastAlertKey || '') === `live:${currentEventId}`) continue;
    const incident = rolloverIncident(guild || { id: guildId }, currentAccount || beforeAccount);
    await sentinel.report(client, { ...incident, severity: 'warning', message: 'A provider returned a new LIVE event while Social Studio still held the previous LIVE session. Automatic rollover repair started.', details: { accountId: item.accountId, previousEventId, currentEventId, previousMessageId: previous.lastLiveMessageId || previous.lastAlertMessageId || null, previousChannelId: previous.lastLiveMessageChannelId || previous.lastAlertChannelId || null } });
    try {
      const repairGuild = guildManager.reloadGuild(guildId) || latestGuild; const repairSocial = repairGuild?.modules?.social || {}; const repairAccount = repairSocial.accounts?.[item.accountId]; if (!repairAccount) throw new Error('The rollover account disappeared before repair could run.');
      const patchedGuild = { ...repairGuild, modules: { ...(repairGuild.modules || {}), social: { ...repairSocial, accounts: { ...(repairSocial.accounts || {}), [item.accountId]: { ...repairAccount, state: { ...(repairAccount.state || {}), isLive: false, liveEventId: previousEventId, lastLiveEvent: previous.lastLiveEvent || repairAccount.state?.lastLiveEvent || null, lastAlertKey: previous.lastAlertKey || null, lastAlertMessageId: null, lastAlertChannelId: null, lastLiveMessageId: null, lastLiveMessageChannelId: null } } } } } };
      const repaired = await core.checkGuildAccounts(client, guildId, projectedOptions(guildId, { force: true, accountIds: [item.accountId], guildConfig: patchedGuild }));
      const repairedItem = (repaired.results || []).find((entry) => String(entry.accountId) === String(item.accountId)); const delivery = (repairedItem?.delivered || []).find((entry) => entry.type === 'live' && String(entry.id || '') === currentEventId); if (!delivery) throw new Error('Rollover repair completed without delivering the new LIVE event.');
      const stalePostRemoved = await removeStaleLivePost(client, guildId, previous).catch(() => false); repairs.push({ accountId: item.accountId, previousEventId, currentEventId, stalePostRemoved, repaired: true }); await sentinel.recover(client, incident, { accountId: item.accountId, previousEventId, currentEventId, stalePostRemoved, deliveredMessageId: delivery.messageId || null });
    } catch (error) { repairs.push({ accountId: item.accountId, previousEventId, currentEventId, repaired: false, error: error?.message || String(error) }); await sentinel.report(client, { ...incident, severity: 'error', message: 'Social Studio detected a LIVE event rollover but automatic repair failed.', details: { accountId: item.accountId, previousEventId, currentEventId, error: error?.stack || error?.message || String(error) } }); }
  }
  return repairs.length ? { ...result, rolloverRepairs: repairs } : result;
}

function livePlatformField(account, event, liveStatus) { const platform = String(account?.platform || '').toLowerCase(); const meta = PLATFORM_FIELDS[platform]; if (!meta) return null; const username = clean(event?.kickUsername || event?.username || account?.username, 100).replace(/^@/, ''); let value = username ? `@${username}` : meta[1]; if (platform === 'tiktok' && !username && liveStatus !== 'OFFLINE') value = 'TikTok LIVE'; return { name: `${meta[0]} ${meta[1]}`, value, inline: true }; }
function buildLiveFields({ account, event, vars = {}, liveStatus, durationText, started, ended }) { const fields = []; const offline = liveStatus === 'OFFLINE'; const platform = String(account?.platform || '').toLowerCase(); if (platform !== 'tiktok' && (event?.category || event?.game)) fields.push({ name: '🎮 Game', value: clean(event.category || event.game, 1024), inline: true }); const platformField = livePlatformField(account, event, liveStatus); if (platformField) fields.push(platformField); if (offline) { const peak = Number(account?.state?.peakViewers || vars.peakViewers || event?.viewerCount || 0); if (peak > 0) fields.push({ name: '📈 Peak Viewers', value: intText(peak), inline: true }); } else if (vars.viewers) fields.push({ name: '👥 Viewers', value: clean(vars.viewers, 1024), inline: true }); if (started) fields.push({ name: '🕐 Started', value: started, inline: true }); if (durationText) fields.push({ name: offline ? '⏱️ Streamed For' : '⏱️ Live For', value: durationText, inline: true }); if (offline) { if (ended) fields.push({ name: '⚫ Ended', value: ended, inline: true }); } else if (event?.language) fields.push({ name: '🌐 Language', value: clean(String(event.language).toUpperCase(), 100), inline: true }); if (!offline && event?.hasMatureContent === true) fields.push({ name: '🔞 Mature', value: 'Yes', inline: true }); return fields; }
function discordTimestamp(value, style = 'R') { const ms = new Date(value).getTime(); return Number.isFinite(ms) && ms >= Date.UTC(2020, 0, 1) && ms <= Date.now() + 86400000 ? `<t:${Math.floor(ms / 1000)}:${style}>` : ''; }
function humanDuration(seconds) { const value = Number(seconds); if (!Number.isFinite(value) || value < 0) return ''; const h = Math.floor(value / 3600), m = Math.floor((value % 3600) / 60), s = Math.floor(value % 60); return [h ? `${h}h` : '', m ? `${m}m` : '', !h && s ? `${s}s` : ''].filter(Boolean).join(' '); }
function secondsBetween(start, end) { const a = new Date(start).getTime(), b = new Date(end).getTime(); return Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.floor((b - a) / 1000) : null; }
function cacheBust(value) { const raw = clean(value, 1000); if (!/^https?:\/\//i.test(raw)) return raw; try { const url = new URL(raw); url.searchParams.set('goliathPreview', String(Date.now())); return url.toString(); } catch { return `${raw}${raw.includes('?') ? '&' : '?'}goliathPreview=${Date.now()}`; } }
function accountFromConfig(config, id) { return config?.modules?.social?.accounts?.[id] || config?.accounts?.[id] || null; }
function socialSettings(config) { return config?.modules?.social?.settings || config?.settings || {}; }
function updateStamp(account) { return account?.state?.lastLiveMessageUpdatedAt || account?.state?.lastLiveMessageUpdateAt || null; }
function stampChanged(before, after) { const a = updateStamp(before), b = updateStamp(after); return Boolean(b && (!a || String(a) !== String(b))); }
async function fetchMessage(client, guildId, state) { const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null); if (!guild) return null; const channelId = state?.lastLiveMessageChannelId || state?.lastAlertChannelId, messageId = state?.lastLiveMessageId || state?.lastAlertMessageId; if (!channelId || !messageId) return null; const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null); return channel?.messages?.fetch ? channel.messages.fetch(messageId).catch(() => null) : null; }
function liveEventFor(result, before, after) { if (result?.isLive === true) return result.live || after?.state?.lastLiveEvent || before?.state?.lastLiveEvent || null; if (before?.state?.isLive === true && result?.isLive === false) return { ...(before.state.lastLiveEvent || {}), endedAt: after?.state?.lastLiveEndedAt || new Date().toISOString() }; return null; }
function liveStatusFor(result, before) { if (result?.isLive === true) return 'LIVE'; if (before?.state?.isLive === true && result?.isLive === false) return 'OFFLINE'; return null; }
function parityFields(account, event, liveStatus, settings) { const startedAt = event?.startedAt || account?.state?.liveStartedAt || null; const endedAt = liveStatus === 'OFFLINE' ? event?.endedAt || account?.state?.lastLiveEndedAt || new Date().toISOString() : null; const seconds = Number.isFinite(Number(event?.durationSeconds)) ? Number(event.durationSeconds) : secondsBetween(startedAt, endedAt || new Date().toISOString()); const viewers = settings.includeViewerCount === false || Number(event?.viewerCount) <= 0 ? '' : intText(event.viewerCount); const peak = Number(account?.state?.peakViewers || event?.peakViewers || event?.viewerCount || 0); return buildLiveFields({ account, event, vars: { viewers, peakViewers: peak > 0 ? intText(peak) : '' }, liveStatus, durationText: settings.includeLiveDuration === false ? '' : humanDuration(seconds), started: discordTimestamp(startedAt), ended: discordTimestamp(endedAt) }); }
function retainedExtraFields(embed) { return (embed?.data?.fields || []).filter((field) => { const name = String(field?.name || ''); return name === '\u200B' || /VOD|Replay/i.test(name); }); }
async function applyOne(client, guildId, account, event, liveStatus, settings) { const message = await fetchMessage(client, guildId, account?.state); if (!message?.embeds?.length) return false; const embed = EmbedBuilder.from(message.embeds[0]); embed.setFields([...parityFields(account, event, liveStatus, settings), ...retainedExtraFields(embed)].slice(0, 25)); const imageUrl = embed.data?.image?.url; if (liveStatus === 'LIVE' && /^https?:\/\//i.test(imageUrl || '')) embed.setImage(cacheBust(event?.thumbnail || imageUrl)); await message.edit({ embeds: [embed] }); return true; }
async function applyLiveMessageParity(client, guildId, beforeConfig, monitorResult) { const results = Array.isArray(monitorResult?.results) ? monitorResult.results : []; if (!results.length) return monitorResult; const afterConfig = guildManager.reloadGuild(guildId), settings = socialSettings(afterConfig); for (const result of results) { const before = accountFromConfig(beforeConfig, result.accountId), after = accountFromConfig(afterConfig, result.accountId), account = after || before; if (!account) continue; const status = liveStatusFor(result, before); if (!status) continue; const delivered = Array.isArray(result.delivered) && result.delivered.some((item) => item?.type === 'live'); const offline = before?.state?.isLive === true && result?.isLive === false; if (!delivered && !offline && !stampChanged(before, after)) continue; const event = liveEventFor(result, before, after); if (!event) continue; try { await applyOne(client, guildId, account, event, status, settings); } catch (error) { console.error(`[Social Studio] LIVE parity update failed for ${result.accountId}:`, error?.message || error); } } return monitorResult; }

async function checkGuildAccounts(client, guildId, options = {}) { const before = options.guildConfig && typeof options.guildConfig === 'object' ? options.guildConfig : guildManager.reloadGuild(guildId); const result = await core.checkGuildAccounts(client, guildId, projectedOptions(guildId, options)); const repaired = await repairLiveRollovers(client, guildId, before, result); await applyLiveMessageParity(client, guildId, before, repaired); return repaired; }
async function forcePostCreatorLive(client, guildId, creatorId, options = {}) { const result = await core.forcePostCreatorLive(client, guildId, creatorId, projectedOptions(guildId, options)); await checkGuildAccounts(client, guildId, { guildConfig: guildManager.reloadGuild(guildId), accountIds: (result?.sent || []).map((item) => item.accountId).filter(Boolean), manual: true, force: true }).catch((error) => console.error('[Social Studio] forced LIVE parity check failed:', error?.message || error)); return result; }
function guildScheduler(guild) { return sentinelScheduler.register({ module: 'social', component: 'automatic-monitor', guildId: guild.id, guildName: guild.name, intervalMs: schedulerTickMs, staleAfterMs: Math.max(schedulerTickMs * 3, 180000) }); }
async function sweep(client) { let checked = 0, failed = 0; for (const guild of client?.guilds?.cache?.values?.() || []) { const id = guildScheduler(guild); try { await checkGuildAccounts(client, guild.id); checked += 1; sentinelScheduler.beat(id, { guildsChecked: checked, lastSweepGuildId: guild.id }); } catch (error) { failed += 1; sentinelScheduler.fail(id, error, { guildId: guild.id }); console.error(`[Social Studio] automatic check failed for guild ${guild.id}:`, error?.message || error); } } sentinelScheduler.beat(GLOBAL_SCHEDULER, { guildsChecked: checked, guildFailures: failed }); return { checked, failed }; }
function runSweep(client, label) { return sweep(client).catch((error) => { sentinelScheduler.fail(GLOBAL_SCHEDULER, error, { phase: label }); console.error(`[Social Studio] ${label} sweep failed:`, error); }); }
function startupSocialStudio(client) { if (timer) return timer; schedulerTickMs = Math.max(30000, Number(process.env.SOCIAL_STUDIO_TICK_MS || 60000)); sentinelScheduler.register({ id: GLOBAL_SCHEDULER, module: 'social', component: 'automatic-monitor', intervalMs: schedulerTickMs, staleAfterMs: Math.max(schedulerTickMs * 3, 180000), details: { scope: 'all-guilds' } }); const initial = setTimeout(() => runSweep(client, 'initial'), 5000); initial.unref?.(); timer = setInterval(() => runSweep(client, 'scheduled'), schedulerTickMs); timer.unref?.(); console.log(`✅ Social Studio monitor started (${schedulerTickMs}ms scheduler tick)`); return timer; }

module.exports = { startupSocialStudio, checkGuildAccounts, forcePostCreatorLive, LIVE_REFRESH_INTERVALS, liveRefreshEnabled, liveRefreshMs, projectedRefreshTimestamp, projectLiveRefreshState, projectGuildConfig, projectedOptions, buildLiveFields, livePlatformField, repairLiveRollovers, applyLiveMessageParity, parityFields };