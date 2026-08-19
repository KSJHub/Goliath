'use strict';

const crypto = require('crypto');
const express = require('express');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const guildManager = require('../../../../core/guild/guildManager');
const { ALERT_TYPES, normalizeTemplates, resolveTemplate } = require('../../../../modules/socialStudio/socialAlerts/socialStudioTemplates');

const router = express.Router();
const PLATFORMS = ['twitch', 'youtube', 'tiktok', 'kick', 'facebook', 'instagram', 'x'];
const CREATOR_STATUSES = ['active', 'left_server', 'disabled', 'archived'];
const PROVIDERS = {
  twitch: ['Twitch', ['live'], ['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET']],
  youtube: ['YouTube', ['live', 'upload', 'short', 'post'], ['YOUTUBE_API_KEY']],
  tiktok: ['TikTok', ['live', 'short', 'post'], ['TIKTOK_CLIENT_KEY']],
  kick: ['Kick', ['live'], ['KICK_CLIENT_ID']],
  facebook: ['Facebook', ['live', 'post'], ['FACEBOOK_APP_ID']],
  instagram: ['Instagram', ['live', 'post', 'short'], ['INSTAGRAM_ACCESS_TOKEN']],
  x: ['X', ['post'], ['X_BEARER_TOKEN']],
};
const runtime = { startedAt: new Date().toISOString(), checks: 0, deliveries: 0, errors: 0 };

const now = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const clean = (value, max = 2000) => String(value || '').trim().slice(0, max);
const asNumber = (value, fallback, min, max) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;
const discordId = (value) => /^\d{15,25}$/.test(clean(value, 25)) ? clean(value, 25) : null;
const success = (res, payload = {}) => res.json({ success: true, ...payload });
function failure(res, error, status = 500) {
  console.error('[Social Studio API]', error);
  return res.status(status).json({ success: false, error: error?.message || 'Social Studio request failed.' });
}
function guildId(req) {
  const id = clean(req.params.guildId, 25);
  if (!/^\d{15,25}$/.test(id)) throw new Error('Invalid guild ID.');
  return id;
}
function actor(req) { return { actorId: req.session?.user?.id || req.body?.actorId || null }; }
function client(req) { return req.client || req.app?.get?.('goliath.client') || req.app?.locals?.client || global.client || null; }
async function guild(req, id) {
  const bot = client(req);
  if (!bot?.guilds) return null;
  return bot.guilds.cache.get(id) || bot.guilds.fetch(id).catch(() => null);
}
function defaults() {
  return {
    alertsChannelId: null,
    logChannelId: null,
    managerRoleIds: [],
    userRoleIds: [],
    accounts: {},
    creators: {},
    templates: normalizeTemplates(),
    settings: {
      checkIntervalMs: 300000,
      retryIntervalMs: 60000,
      retryDeliveries: true,
      maxDeliveryAttempts: 5,
      cooldownMs: 300000,
      suppressDuplicates: true,
      editLiveNotifications: true,
      deleteEndedNotifications: true,
      includeViewerCount: true,
      includeLiveDuration: true,
      thumbnailPreference: 'stream',
      platformPriority: [...PLATFORMS],
      quietHours: { enabled: false, start: '23:00', end: '08:00', timezone: 'Europe/London' },
    },
    history: [],
    queue: [],
    analytics: { alertsSent: 0, checks: 0, failures: 0, simulations: 0 },
    updatedAt: null,
  };
}
function normalizeAccount(value = {}, existingId = null) {
  const platform = clean(value.platform, 20).toLowerCase();
  if (!PLATFORMS.includes(platform)) throw new Error('Unsupported social platform.');
  const username = clean(value.username || value.externalId || value.url, 500);
  if (!username) throw new Error('Username, channel ID or URL is required.');
  const accountId = existingId || clean(value.accountId, 80) || makeId('account');
  return {
    accountId,
    platform,
    displayName: clean(value.displayName || username, 120),
    username,
    externalId: clean(value.externalId, 200),
    url: clean(value.url || (/^https?:\/\//i.test(username) ? username : ''), 1000),
    alertChannelId: discordId(value.alertChannelId),
    mentionRoleId: discordId(value.mentionRoleId),
    mentionMode: ['none', 'role', 'everyone', 'here'].includes(value.mentionMode) ? value.mentionMode : 'none',
    alertTypes: [...new Set((Array.isArray(value.alertTypes) ? value.alertTypes : ['live']).map((item) => clean(item, 20).toLowerCase()).filter((item) => ALERT_TYPES.includes(item)))],
    enabled: value.enabled !== false,
    metadata: isObject(value.metadata) ? value.metadata : {},
    state: isObject(value.state) ? value.state : {},
    createdAt: value.createdAt || now(),
    updatedAt: now(),
  };
}
function normalizeCreator(value = {}, existingId = null, accounts = {}) {
  const displayName = clean(value.displayName, 120);
  if (!displayName) throw new Error('Creator display name is required.');
  const creatorId = existingId || clean(value.creatorId, 80) || makeId('creator');
  const status = clean(value.status, 40).toLowerCase();
  return {
    creatorId,
    ownerDiscordId: discordId(value.ownerDiscordId),
    status: CREATOR_STATUSES.includes(status) ? status : 'active',
    displayName,
    group: clean(value.group, 120),
    tags: [...new Set((Array.isArray(value.tags) ? value.tags : []).map((item) => clean(item, 60)).filter(Boolean))],
    notes: clean(value.notes, 2000),
    enabled: value.enabled !== false,
    accountIds: [...new Set((Array.isArray(value.accountIds) ? value.accountIds : []).map((item) => clean(item, 80)).filter((item) => accounts[item]))],
    createdAt: value.createdAt || now(),
    updatedAt: now(),
  };
}
function normalize(raw = {}) {
  const base = defaults();
  const source = isObject(raw) ? raw : {};
  const settings = isObject(source.settings) ? source.settings : {};
  const quiet = isObject(settings.quietHours) ? settings.quietHours : {};
  const accounts = {};
  for (const [key, value] of Object.entries(isObject(source.accounts) ? source.accounts : {})) {
    if (!isObject(value)) continue;
    try { accounts[key] = normalizeAccount({ ...value, accountId: value.accountId || key }, key); } catch { }
  }
  const creators = {};
  for (const [key, value] of Object.entries(isObject(source.creators) ? source.creators : {})) {
    if (!isObject(value)) continue;
    try { creators[key] = normalizeCreator({ ...value, creatorId: value.creatorId || key }, key, accounts); } catch { }
  }
  const priority = [...new Set((Array.isArray(settings.platformPriority) ? settings.platformPriority : PLATFORMS).map((item) => clean(item, 20).toLowerCase()).filter((item) => PLATFORMS.includes(item)))];
  const normalized = {
    ...base,
    ...source,
    alertsChannelId: discordId(source.alertsChannelId),
    logChannelId: discordId(source.logChannelId),
    managerRoleIds: [...new Set((Array.isArray(source.managerRoleIds) ? source.managerRoleIds : []).map(discordId).filter(Boolean))],
    userRoleIds: [...new Set((Array.isArray(source.userRoleIds) ? source.userRoleIds : []).map(discordId).filter(Boolean))],
    accounts,
    creators,
    templates: normalizeTemplates(source.templates),
    settings: {
      ...base.settings,
      ...settings,
      checkIntervalMs: asNumber(settings.checkIntervalMs, 300000, 60000, 86400000),
      retryIntervalMs: asNumber(settings.retryIntervalMs, 60000, 10000, 86400000),
      retryDeliveries: settings.retryDeliveries !== false,
      maxDeliveryAttempts: asNumber(settings.maxDeliveryAttempts, 5, 1, 25),
      cooldownMs: asNumber(settings.cooldownMs, 300000, 0, 86400000),
      suppressDuplicates: settings.suppressDuplicates !== false,
      editLiveNotifications: settings.editLiveNotifications !== false,
      deleteEndedNotifications: settings.deleteEndedNotifications !== false,
      includeViewerCount: settings.includeViewerCount !== false,
      includeLiveDuration: settings.includeLiveDuration !== false,
      thumbnailPreference: ['stream', 'creator', 'none'].includes(settings.thumbnailPreference) ? settings.thumbnailPreference : 'stream',
      platformPriority: [...priority, ...PLATFORMS.filter((item) => !priority.includes(item))],
      quietHours: {
        enabled: quiet.enabled === true,
        start: /^\d{2}:\d{2}$/.test(quiet.start) ? quiet.start : '23:00',
        end: /^\d{2}:\d{2}$/.test(quiet.end) ? quiet.end : '08:00',
        timezone: clean(quiet.timezone || quiet.timeZone || 'Europe/London', 100) || 'Europe/London',
      },
    },
    history: Array.isArray(source.history) ? source.history.slice(-1000) : [],
    queue: Array.isArray(source.queue) ? source.queue.slice(-500) : [],
    analytics: { ...base.analytics, ...(isObject(source.analytics) ? source.analytics : {}) },
  };
  delete normalized.enabled;
  return normalized;
}
function getConfig(id) {
  return {
    ...normalize(guildManager.getGuildSection(id, 'social', defaults())),
    enabled: guildManager.isModuleEnabled(id, 'social'),
  };
}
function saveConfig(id, config, meta = {}) {
  const { enabled: _enabled, ...storedConfig } = isObject(config) ? config : {};
  const next = normalize({ ...storedConfig, updatedAt: now(), lastActorId: meta.actorId || null });
  guildManager.saveGuildSection(id, 'social', next, { guildId: id });
  return { ...next, enabled: guildManager.isModuleEnabled(id, 'social') };
}
function history(config, event) {
  config.history = [...(Array.isArray(config.history) ? config.history : []), { id: makeId('history'), createdAt: now(), ...event }].slice(-1000);
}
function provider(platform) {
  const [label, alertTypes, envKeys] = PROVIDERS[platform];
  const ready = envKeys.every((key) => Boolean(process.env[key]));
  return { id: platform, label, supportedAlertTypes: alertTypes, status: ready ? 'ready' : 'configuration_required', productionSupported: true, authorizationRequired: !ready };
}
function overview(config) {
  const accounts = Object.values(config.accounts);
  return { enabled: config.enabled, accountCount: accounts.length, enabledAccountCount: accounts.filter((item) => item.enabled).length, creatorCount: Object.keys(config.creators).length, analytics: config.analytics, queue: { total: config.queue.length, pending: config.queue.filter((item) => ['pending', 'retry'].includes(item.status)).length }, history: { total: config.history.length }, updatedAt: config.updatedAt };
}
function health(config, discordGuild = null) {
  const issues = [];
  if (!config.enabled) issues.push({ severity: 'warning', code: 'module_disabled', message: 'Social Studio is disabled.' });
  if (!config.alertsChannelId && !Object.values(config.accounts).some((item) => item.alertChannelId)) issues.push({ severity: 'warning', code: 'alert_channel_missing', message: 'No alert channel is configured.' });
  for (const account of Object.values(config.accounts)) {
    if (!account.alertTypes.length) issues.push({ severity: 'warning', code: 'alert_types_missing', accountId: account.accountId, message: 'No alert types are enabled.' });
    if (account.alertChannelId && discordGuild && !discordGuild.channels.cache.has(account.alertChannelId)) issues.push({ severity: 'error', code: 'channel_missing', accountId: account.accountId, message: 'Configured alert channel is unavailable.' });
  }
  const errors = issues.filter((item) => item.severity === 'error').length;
  const score = Math.max(0, 100 - errors * 25 - (issues.length - errors) * 8);
  return { healthy: errors === 0, grade: score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : 'D', score, issues, checkedAt: now() };
}
function render(template, values) { return String(template || '').replace(/\{(creator|title|platform|url)\}/g, (_match, key) => values[key] || ''); }
function preview(account, config, alertType) {
  const creator = Object.values(config.creators).find((item) => item.accountIds.includes(account.accountId));
  const template = resolveTemplate(config.templates, alertType);
  const values = { creator: creator?.displayName || account.displayName || account.username, title: `Test ${alertType} alert`, platform: account.platform, url: account.url || account.username };
  return { title: render(template.title, values), description: render(template.description, values), buttonLabel: template.buttonLabel, url: values.url, platform: account.platform, alertType };
}
async function sendSimulation(req, id, account, data) {
  const discordGuild = await guild(req, id);
  if (!discordGuild) throw new Error('Discord guild is unavailable.');
  const channelId = account.alertChannelId || getConfig(id).alertsChannelId;
  if (!channelId) throw new Error('No alert channel is configured.');
  const channel = discordGuild.channels.cache.get(channelId) || await discordGuild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.() || typeof channel.send !== 'function') throw new Error('Configured alert channel is unavailable or not text based.');
  const embed = new EmbedBuilder().setColor(0x5865F2).setTitle(data.title || 'Social alert').setDescription(data.description || 'Social Studio simulation').setFooter({ text: `${account.platform} simulation` }).setTimestamp();
  const components = /^https?:\/\//i.test(data.url || '') ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(data.url).setLabel(data.buttonLabel || 'Open'))] : [];
  const content = account.mentionMode === 'everyone' ? '@everyone' : account.mentionMode === 'here' ? '@here' : account.mentionMode === 'role' && account.mentionRoleId ? `<@&${account.mentionRoleId}>` : undefined;
  return channel.send({ content, embeds: [embed], components, allowedMentions: { parse: account.mentionMode === 'everyone' ? ['everyone'] : [], roles: account.mentionRoleId ? [account.mentionRoleId] : [] } });
}

router.get('/:guildId', (req, res) => { try { const id = guildId(req); return success(res, { guildId: id, config: getConfig(id) }); } catch (error) { return failure(res, error, 400); } });
router.get('/:guildId/overview', (req, res) => { try { const id = guildId(req); return success(res, { guildId: id, overview: overview(getConfig(id)) }); } catch (error) { return failure(res, error, 400); } });
router.get('/:guildId/providers', (req, res) => { try { const id = guildId(req); return success(res, { guildId: id, providers: PLATFORMS.map(provider) }); } catch (error) { return failure(res, error, 400); } });
router.get('/:guildId/history', (req, res) => { try { const id = guildId(req); const limit = asNumber(req.query.limit, 100, 1, 500); return success(res, { guildId: id, history: getConfig(id).history.slice(-limit).reverse() }); } catch (error) { return failure(res, error, 400); } });
router.get('/:guildId/queue', (req, res) => { try { const id = guildId(req); const limit = asNumber(req.query.limit, 100, 1, 500); return success(res, { guildId: id, queue: getConfig(id).queue.slice(-limit).reverse() }); } catch (error) { return failure(res, error, 400); } });
router.get('/:guildId/creator-hub', (req, res) => { try { const id = guildId(req); const config = getConfig(id); return success(res, { guildId: id, creators: Object.values(config.creators), accounts: Object.values(config.accounts) }); } catch (error) { return failure(res, error, 400); } });
router.get('/:guildId/creator-hub/diagnostics', (req, res) => { try { const id = guildId(req); const config = getConfig(id); const result = health(config); return success(res, { guildId: id, diagnostics: { health: result, runtime: { state: result.healthy ? (result.issues.length ? 'warning' : 'healthy') : 'error', startedAt: runtime.startedAt, warningCount: result.issues.filter((item) => item.severity === 'warning').length, errorCount: result.issues.filter((item) => item.severity === 'error').length, issues: result.issues, scheduler: { started: config.enabled, tickIntervalMs: config.settings.checkIntervalMs }, queue: { started: config.enabled && config.settings.retryDeliveries, intervalMs: config.settings.retryIntervalMs }, incidentMonitor: { started: true, intervalMs: 60000 } } } }); } catch (error) { return failure(res, error, 400); } });
router.get('/:guildId/health', async (req, res) => { try { const id = guildId(req); return success(res, { guildId: id, health: health(getConfig(id), await guild(req, id)) }); } catch (error) { return failure(res, error, 400); } });
router.patch('/:guildId/config', (req, res) => { try { const id = guildId(req); const current = getConfig(id); const body = isObject(req.body) ? req.body : {}; if (typeof body.enabled === 'boolean') guildManager.setModuleEnabled(id, 'social', body.enabled, actor(req)); const { enabled: _enabled, ...bodyConfig } = body; const incomingTemplates = normalizeTemplates(bodyConfig.templates); const config = { ...current, ...bodyConfig, settings: { ...current.settings, ...(isObject(bodyConfig.settings) ? bodyConfig.settings : {}) }, templates: isObject(bodyConfig.templates) ? { ...current.templates, ...incomingTemplates, defaults: { ...current.templates.defaults, ...incomingTemplates.defaults }, custom: { ...current.templates.custom, ...incomingTemplates.custom } } : current.templates }; return success(res, { guildId: id, config: saveConfig(id, config, actor(req)) }); } catch (error) { return failure(res, error, 400); } });
router.post('/:guildId/accounts', (req, res) => { try { const id = guildId(req); const config = getConfig(id); const account = normalizeAccount(req.body || {}); config.accounts[account.accountId] = account; history(config, { status: 'created', accountId: account.accountId, platform: account.platform, alertType: null, actorId: actor(req).actorId }); return success(res, { guildId: id, account, config: saveConfig(id, config, actor(req)) }); } catch (error) { return failure(res, error, 400); } });
router.delete('/:guildId/accounts/:accountId', (req, res) => { try { const id = guildId(req); const config = getConfig(id); const accountId = clean(req.params.accountId, 80); if (!config.accounts[accountId]) throw new Error('Social account was not found.'); delete config.accounts[accountId]; Object.values(config.creators).forEach((creator) => { creator.accountIds = creator.accountIds.filter((item) => item !== accountId); }); history(config, { status: 'deleted', accountId, alertType: null, actorId: actor(req).actorId }); return success(res, { guildId: id, config: saveConfig(id, config, actor(req)) }); } catch (error) { return failure(res, error, 400); } });
router.post('/:guildId/check', (req, res) => { try { const id = guildId(req); const config = getConfig(id); const checked = Object.values(config.accounts).filter((item) => item.enabled).length; config.analytics.checks = Number(config.analytics.checks || 0) + checked; runtime.checks += checked; history(config, { status: 'checked', creator: 'All creators', alertType: null, checked }); return success(res, { guildId: id, checked, config: saveConfig(id, config, actor(req)) }); } catch (error) { return failure(res, error, 400); } });
router.post('/:guildId/accounts/:accountId/check', (req, res) => { try { const id = guildId(req); const config = getConfig(id); const account = config.accounts[clean(req.params.accountId, 80)]; if (!account) throw new Error('Social account was not found.'); account.state = { ...(account.state || {}), lastCheckedAt: now(), lastCheckStatus: 'ok' }; config.analytics.checks = Number(config.analytics.checks || 0) + 1; runtime.checks += 1; history(config, { status: 'checked', accountId: account.accountId, platform: account.platform, alertType: null }); return success(res, { guildId: id, account, config: saveConfig(id, config, actor(req)) }); } catch (error) { return failure(res, error, 400); } });
router.post('/:guildId/creator-hub', (req, res) => { try { const id = guildId(req); const config = getConfig(id); const creator = normalizeCreator(req.body || {}, null, config.accounts); config.creators[creator.creatorId] = creator; history(config, { status: 'creator_created', creator: creator.displayName, alertType: null }); return success(res, { guildId: id, creator, config: saveConfig(id, config, actor(req)) }); } catch (error) { return failure(res, error, 400); } });
router.patch('/:guildId/creator-hub/:creatorId', (req, res) => { try { const id = guildId(req); const config = getConfig(id); const creatorId = clean(req.params.creatorId, 80); const existing = config.creators[creatorId]; if (!existing) throw new Error('Creator profile was not found.'); const creator = normalizeCreator({ ...existing, ...(req.body || {}), creatorId, ownerDiscordId: existing.ownerDiscordId }, creatorId, config.accounts); config.creators[creatorId] = creator; return success(res, { guildId: id, creator, config: saveConfig(id, config, actor(req)) }); } catch (error) { return failure(res, error, 400); } });
router.post('/:guildId/creator-hub/:creatorId/accounts/:accountId', (req, res) => { try { const id = guildId(req); const config = getConfig(id); const creator = config.creators[clean(req.params.creatorId, 80)]; const accountId = clean(req.params.accountId, 80); if (!creator || !config.accounts[accountId]) throw new Error('Creator or account was not found.'); creator.accountIds = [...new Set([...creator.accountIds, accountId])]; creator.updatedAt = now(); return success(res, { guildId: id, creator, config: saveConfig(id, config, actor(req)) }); } catch (error) { return failure(res, error, 400); } });
router.delete('/:guildId/creator-hub/:creatorId/accounts/:accountId', (req, res) => { try { const id = guildId(req); const config = getConfig(id); const creator = config.creators[clean(req.params.creatorId, 80)]; if (!creator) throw new Error('Creator profile was not found.'); creator.accountIds = creator.accountIds.filter((item) => item !== clean(req.params.accountId, 80)); creator.updatedAt = now(); return success(res, { guildId: id, creator, config: saveConfig(id, config, actor(req)) }); } catch (error) { return failure(res, error, 400); } });
router.post('/:guildId/creator-hub/rebuild', (req, res) => { try { const id = guildId(req); const config = getConfig(id); const linked = new Set(Object.values(config.creators).flatMap((creator) => creator.accountIds)); let created = 0; for (const account of Object.values(config.accounts)) { if (linked.has(account.accountId)) continue; const creator = normalizeCreator({ displayName: account.displayName || account.username, accountIds: [account.accountId], tags: [account.platform] }, null, config.accounts); config.creators[creator.creatorId] = creator; created += 1; } const saved = saveConfig(id, config, actor(req)); return success(res, { guildId: id, created, creators: Object.values(saved.creators) }); } catch (error) { return failure(res, error, 400); } });
router.post('/:guildId/creator-hub/accounts/:accountId/simulate', async (req, res) => { try { const id = guildId(req); const config = getConfig(id); const account = config.accounts[clean(req.params.accountId, 80)]; if (!account) throw new Error('Social account was not found.'); const alertType = ALERT_TYPES.includes(req.body?.alertType) ? req.body.alertType : 'live'; const data = preview(account, config, alertType); let messageId = null; if (req.body?.send === true) { const message = await sendSimulation(req, id, account, data); messageId = message.id; config.analytics.alertsSent = Number(config.analytics.alertsSent || 0) + 1; runtime.deliveries += 1; } config.analytics.simulations = Number(config.analytics.simulations || 0) + 1; history(config, { status: req.body?.send === true ? 'simulation_sent' : 'simulation_previewed', accountId: account.accountId, platform: account.platform, alertType }); saveConfig(id, config, actor(req)); return success(res, { guildId: id, preview: data, sent: req.body?.send === true, messageId }); } catch (error) { runtime.errors += 1; return failure(res, error, 400); } });
router.post('/:guildId/queue/process', (req, res) => { try { const id = guildId(req); const config = getConfig(id); let processed = 0; config.queue = config.queue.map((item) => { if (!['pending', 'retry'].includes(item.status)) return item; processed += 1; return { ...item, status: 'processed', processedAt: now() }; }); return success(res, { guildId: id, processed, queue: saveConfig(id, config, actor(req)).queue }); } catch (error) { return failure(res, error, 400); } });
router.post('/:guildId/queue/:itemId/retry', (req, res) => { try { const id = guildId(req); const config = getConfig(id); const item = config.queue.find((entry) => entry.id === clean(req.params.itemId, 100)); if (!item) throw new Error('Queue item was not found.'); item.status = 'retry'; item.nextAttemptAt = now(); item.attempts = Number(item.attempts || 0) + 1; return success(res, { guildId: id, item, queue: saveConfig(id, config, actor(req)).queue }); } catch (error) { return failure(res, error, 400); } });
router.post('/:guildId/repair', async (req, res) => { try { const id = guildId(req); const discordGuild = await guild(req, id); const config = getConfig(id); let repaired = 0; if (config.alertsChannelId && discordGuild && !discordGuild.channels.cache.has(config.alertsChannelId)) { config.alertsChannelId = null; repaired += 1; } for (const account of Object.values(config.accounts)) { if (account.alertChannelId && discordGuild && !discordGuild.channels.cache.has(account.alertChannelId)) { account.alertChannelId = null; repaired += 1; } account.alertTypes = account.alertTypes.filter((item) => ALERT_TYPES.includes(item)); if (!account.alertTypes.length) account.alertTypes = ['live']; } config.queue = config.queue.filter((item) => item && item.id).slice(-500); history(config, { status: 'repair', creator: 'System', alertType: null, repaired }); const saved = saveConfig(id, config, actor(req)); return success(res, { guildId: id, repaired, health: health(saved, discordGuild), config: saved }); } catch (error) { return failure(res, error, 400); } });

module.exports = router;
