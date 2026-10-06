'use strict';

const express = require('express');
const { PermissionFlagsBits } = require('discord.js');
const guildManager = require('../../../../core/guild/guildManager');
const security = require('../../../../core/security/protection/core');
const verificationManager = require('../../../../modules/securityStudio/verificationManager');
const stats = require('../../../../modules/utilityStudio/stats/stats');

const router = express.Router();

function success(res, payload = {}) { return res.json({ success: true, ...payload }); }
function failure(res, error, status = 500) {
  console.error('[Stats API]', error);
  return res.status(status).json({ success: false, error: error.message || 'Stats request failed.' });
}
function getGuildId(req) {
  const guildId = String(req.params.guildId || req.query?.guildId || '').trim();
  if (!/^\d{15,25}$/.test(guildId)) throw new Error('Invalid guild ID.');
  return guildId;
}
function getClient(req) { return req.client || req.app?.get?.('goliath.client') || req.app?.locals?.client || global.client || global.discordClient || null; }
async function getGuild(req, guildId) {
  const client = getClient(req);
  if (!client?.guilds) return null;
  return client.guilds.cache.get(guildId) || client.guilds.fetch(guildId).catch(() => null);
}
function actor(req, action) { return { action, actorId: req.session?.user?.id || null }; }
function countObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).length : 0; }
function countArray(value) { return Array.isArray(value) ? value.length : 0; }

async function requireStatsGuildAccess(req, res, next) {
  try {
    const userId = String(req.session?.user?.id || '').trim();
    if (!/^\d{15,25}$/.test(userId)) return res.status(401).json({ success: false, error: 'Authentication required.' });
    const guildId = getGuildId(req);
    if (security.isBotOwner(userId)) return next();
    const guild = await getGuild(req, guildId);
    if (!guild) return res.status(403).json({ success: false, error: 'Guild is unavailable or not accessible.' });
    const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
    const allowed = Boolean(
      member?.permissions?.has(PermissionFlagsBits.Administrator) ||
      member?.permissions?.has(PermissionFlagsBits.ManageGuild)
    );
    if (!allowed) return res.status(403).json({ success: false, error: 'Manage Server permission is required.' });
    return next();
  } catch (error) {
    console.error('[Stats API access]', error);
    return res.status(403).json({ success: false, error: 'Unable to verify server access.' });
  }
}

router.use('/:guildId', requireStatsGuildAccess);

function buildModuleStats(data, guildId) {
  const keys = Object.keys(data.modules || {});
  const enabledKeys = keys.filter((key) => guildManager.isModuleEnabled(guildId, key)).sort();
  return { total: keys.length, enabled: enabledKeys.length, disabled: Math.max(0, keys.length - enabledKeys.length), enabledKeys };
}
function buildVerificationStats(guildId) {
  const section = verificationManager.getVerificationStatus(guildId);
  const settings = section.settings || {};
  const panels = Object.values(section.panels || {});
  return {
    enabled: guildManager.isModuleEnabled(guildId, 'verification'),
    verificationChannelId: settings.verificationChannelId || null,
    logChannelId: settings.logChannelId || null,
    verifiedRoles: countArray(settings.verifiedRoleIds),
    pendingRoles: countArray(settings.pendingRoleIds),
    panels: panels.length,
    deployedPanels: panels.filter((panel) => panel?.messageId && panel?.channelId).length,
    analytics: section.analytics || {},
  };
}
function buildStoredStats(data, guildId) {
  const modules = data.modules || {};
  const tickets = modules.tickets || data.tickets || {};
  const forms = modules.forms || {};
  const polls = modules.polls || {};
  const logs = modules.logs || data.logs || {};
  const securityData = modules.security || data.security || {};
  return {
    activity: stats.getSummary(guildId),
    tickets: { total: countArray(tickets.tickets), panels: countArray(tickets.panels), open: countArray(tickets.tickets?.filter?.((ticket) => ticket.status === 'open') || []), analytics: tickets.analytics || {} },
    forms: { forms: countObject(forms.forms), submissions: countObject(forms.submissions), panels: countObject(forms.panels), analytics: forms.analytics || {} },
    polls: { total: countObject(polls.polls), active: Object.values(polls.polls || {}).filter((poll) => poll?.status === 'active').length, closed: Object.values(polls.polls || {}).filter((poll) => poll?.status === 'closed').length, analytics: polls.analytics || {} },
    verification: buildVerificationStats(guildId),
    logs: { enabled: guildManager.isModuleEnabled(guildId, 'logging'), channels: countObject(logs.channels), events: countObject(logs.events) },
    security: { enabled: guildManager.isModuleEnabled(guildId, 'security'), threatLevel: securityData.threatLevel || 'low', totalIncidents: Number(securityData.totalIncidents || 0), criticalIncidents: Number(securityData.criticalIncidents || 0), incidents: countArray(securityData.incidents) },
  };
}

async function buildLiveStats(req, guildId) {
  const guild = await getGuild(req, guildId);
  if (!guild) return { available: false, guild: null, members: null, channels: null, roles: null, emojis: null };
  await guild.channels.fetch().catch(() => null);
  await guild.roles.fetch().catch(() => null);
  await guild.members.fetch({ withPresences: true }).catch(() => guild.members.fetch().catch(() => null));
  const channels = [...guild.channels.cache.values()];
  const roles = [...guild.roles.cache.values()].filter((role) => role.id !== guild.id).sort((a, b) => b.position - a.position);
  const emojis = [...guild.emojis.cache.values()];
  const members = [...guild.members.cache.values()];
  const statuses = { online: 0, idle: 0, dnd: 0, offline: 0 };
  members.forEach((member) => { const key = member.presence?.status || 'offline'; statuses[key] = Number(statuses[key] || 0) + 1; });
  return {
    available: true,
    guild: { id: guild.id, name: guild.name, iconUrl: guild.iconURL?.({ extension: 'png', size: 128 }) || null, createdAt: guild.createdAt?.toISOString?.() || null, ownerId: guild.ownerId || null, premiumTier: guild.premiumTier || 0, premiumSubscriptionCount: guild.premiumSubscriptionCount || 0 },
    members: { total: guild.memberCount || 0, humans: members.filter((member) => !member.user?.bot).length, bots: members.filter((member) => member.user?.bot).length, statuses, inVoice: members.filter((member) => member.voice?.channelId).length },
    channels: { total: channels.length, text: channels.filter((channel) => (channel.type === 0 || channel.type === 5) && !channel.isThread?.()).length, voice: channels.filter((channel) => channel.type === 2 || channel.type === 13).length, categories: channels.filter((channel) => channel.type === 4).length, threads: channels.filter((channel) => channel.isThread?.()).length, items: channels.filter((channel) => !channel.isThread?.()).sort((a, b) => (a.rawPosition || 0) - (b.rawPosition || 0)).map((channel) => ({ id: channel.id, name: channel.name, type: channel.type, parentId: channel.parentId || null })) },
    roles: { total: roles.length, managed: roles.filter((role) => role.managed).length, mentionable: roles.filter((role) => role.mentionable).length, items: roles.map((role) => ({ id: role.id, name: role.name, position: role.position, managed: role.managed, color: role.hexColor || null, memberCount: role.members?.size || 0 })) },
    emojis: { total: emojis.length, animated: emojis.filter((emoji) => emoji.animated).length, static: emojis.filter((emoji) => !emoji.animated).length },
  };
}

router.get('/:guildId/overview', async (req, res) => {
  try { const guildId = getGuildId(req); const data = guildManager.getGuildData(guildId); return success(res, { guildId, updatedAt: new Date().toISOString(), live: await buildLiveStats(req, guildId), modules: buildModuleStats(data, guildId), stored: buildStoredStats(data, guildId), counterTypes: stats.counters.COUNTER_TYPES, statusValues: stats.counters.STATUS_VALUES }); }
  catch (error) { return failure(res, error, 400); }
});
router.get('/:guildId/config', (req, res) => {
  try { const guildId = getGuildId(req); return success(res, { guildId, config: { ...stats.getConfig(guildId), enabled: guildManager.isModuleEnabled(guildId, 'stats'), counters: stats.counters.listCounters(guildId) }, summary: stats.getSummary(guildId) }); }
  catch (error) { return failure(res, error, 400); }
});
router.patch('/:guildId/config', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    const guild = await getGuild(req, guildId);
    if (!guild) throw new Error('Guild is unavailable.');
    const allowed = ['trackMessages', 'trackVoice', 'trackMembers', 'ignoreBots', 'ignoredChannels', 'ignoredRoles', 'settings'];
    const updates = Object.fromEntries(Object.entries(req.body || {}).filter(([key]) => allowed.includes(key)));
    for (const key of ['trackMessages', 'trackVoice', 'trackMembers', 'ignoreBots']) {
      if (Object.prototype.hasOwnProperty.call(updates, key) && typeof updates[key] !== 'boolean') throw new Error(`${key} must be true or false.`);
    }
    for (const key of ['ignoredChannels', 'ignoredRoles']) {
      if (!Object.prototype.hasOwnProperty.call(updates, key)) continue;
      if (!Array.isArray(updates[key])) throw new Error(`${key} must be an array.`);
      updates[key] = [...new Set(updates[key].map(String).filter((id) => /^\d{15,25}$/.test(id)))].slice(0, 100);
    }
    if (updates.settings != null) {
      if (!updates.settings || typeof updates.settings !== 'object' || Array.isArray(updates.settings)) throw new Error('settings must be an object.');
      if (updates.settings.timeZone != null) {
        const timeZone = String(updates.settings.timeZone).trim();
        try { new Intl.DateTimeFormat('en-GB', { timeZone }).format(new Date()); } catch { throw new Error('Invalid Stats time zone.'); }
        updates.settings.timeZone = timeZone;
      }
      if (updates.settings.retentionDays != null) {
        const days = Number(updates.settings.retentionDays);
        if (!Number.isFinite(days) || days < 1 || days > 365) throw new Error('Retention must be between 1 and 365 days.');
        updates.settings.retentionDays = Math.floor(days);
      }
      if (updates.settings.defaultFrequencyMinutes != null) {
        const minutes = Number(updates.settings.defaultFrequencyMinutes);
        if (!Number.isFinite(minutes) || minutes < 10 || minutes > 1440) throw new Error('Default refresh must be between 10 and 1440 minutes.');
        updates.settings.defaultFrequencyMinutes = Math.floor(minutes);
      }
    }
    if (typeof req.body?.enabled === 'boolean') updates.enabled = req.body.enabled;
    const stored = stats.applyRuntimeConfig(guild, updates, actor(req, 'stats_config_update'));
    return success(res, { guildId, config: { ...stored, counters: stats.counters.listCounters(guildId) } });
  } catch (error) { return failure(res, error, 400); }
});
router.get('/:guildId/health', async (req, res) => {
  try { const guildId = getGuildId(req); const guild = await getGuild(req, guildId); if (!guild) throw new Error('Guild is unavailable.'); return success(res, { guildId, health: await stats.buildHealth(guild) }); }
  catch (error) { return failure(res, error, 400); }
});
router.get('/:guildId/export', (req, res) => {
  try { const guildId = getGuildId(req); return success(res, { export: stats.exportConfig(guildId) }); }
  catch (error) { return failure(res, error, 400); }
});
router.post('/:guildId/repair', async (req, res) => {
  try { const guildId = getGuildId(req); const guild = await getGuild(req, guildId); if (!guild) throw new Error('Guild is unavailable.'); return success(res, { guildId, result: await stats.repair(guild) }); }
  catch (error) { return failure(res, error, 400); }
});
router.post('/:guildId/refresh', async (req, res) => {
  try { const guildId = getGuildId(req); const guild = await getGuild(req, guildId); if (!guild) throw new Error('Guild is unavailable.'); return success(res, { guildId, refreshed: await stats.refreshGuildCounters(guild, 'dashboard') }); }
  catch (error) { return failure(res, error, 400); }
});
router.post('/:guildId/counters/setup', async (req, res) => {
  try { const guildId = getGuildId(req); const guild = await getGuild(req, guildId); if (!guild) throw new Error('Guild is unavailable.'); stats.setEnabled(guildId, true, guild); return success(res, { guildId, result: await stats.counters.createCounterSuite(guild, req.body || {}) }); }
  catch (error) { return failure(res, error, 400); }
});
router.post('/:guildId/counters/preview', async (req, res) => {
  try { const guildId = getGuildId(req); const guild = await getGuild(req, guildId); if (!guild) throw new Error('Guild is unavailable.'); return success(res, { guildId, preview: stats.counters.previewDock(guild, req.body || {}) }); }
  catch (error) { return failure(res, error, 400); }
});
router.post('/:guildId/counters', async (req, res) => {
  try { const guildId = getGuildId(req); const guild = await getGuild(req, guildId); if (!guild) throw new Error('Guild is unavailable.'); stats.setEnabled(guildId, true, guild); const counter = await stats.counters.createDock(guild, req.body || {}, actor(req, 'stats_counter_create')); return success(res, { guildId, counter, counters: stats.counters.listCounters(guildId) }); }
  catch (error) { return failure(res, error, 400); }
});
router.patch('/:guildId/counters/:counterId', async (req, res) => {
  try { const guildId = getGuildId(req); const guild = await getGuild(req, guildId); if (!guild) throw new Error('Guild is unavailable.'); const counter = await stats.counters.updateDock(guild, String(req.params.counterId || ''), req.body || {}, actor(req, 'stats_counter_update')); return success(res, { guildId, counter, counters: stats.counters.listCounters(guildId) }); }
  catch (error) { return failure(res, error, 400); }
});
router.post('/:guildId/counters/:counterId/toggle', async (req, res) => {
  try { const guildId = getGuildId(req); const guild = await getGuild(req, guildId); if (!guild) throw new Error('Guild is unavailable.'); const counter = await stats.counters.setDockEnabled(guild, String(req.params.counterId || ''), req.body?.enabled === true, actor(req, 'stats_counter_toggle')); return success(res, { guildId, counter, counters: stats.counters.listCounters(guildId) }); }
  catch (error) { return failure(res, error, 400); }
});
router.delete('/:guildId/counters/:counterId', async (req, res) => {
  try { const guildId = getGuildId(req); const guild = await getGuild(req, guildId); if (!guild) throw new Error('Guild is unavailable.'); await stats.counters.deleteDock(guild, String(req.params.counterId || ''), actor(req, 'stats_counter_delete')); return success(res, { guildId, counters: stats.counters.listCounters(guildId) }); }
  catch (error) { return failure(res, error, 400); }
});
router.post('/:guildId/reset', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    if (req.body?.confirm !== true) return failure(res, new Error('Reset confirmation is required.'), 400);
    const guild = await getGuild(req, guildId);
    if (!guild) throw new Error('Guild is unavailable.');
    stats.flushGuildVoiceSessions(guild);
    const config = stats.reset(guildId, actor(req, 'stats_reset'));
    stats.reconcileGuildVoiceSessions(guild);
    return success(res, { guildId, config });
  } catch (error) { return failure(res, error, 400); }
});

module.exports = router;
