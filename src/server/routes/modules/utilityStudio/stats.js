'use strict';

const express = require('express');
const guildManager = require('../../../../core/guild/guildManager');
const verificationManager = require('../../../../modules/securityStudio/verificationManager');
const stats = require('../../../../modules/utilityStudio/stats/stats');
const statsHealth = require('../../../../modules/utilityStudio/stats/statsHealth');

const router = express.Router();

function success(res, payload = {}) { return res.json({ success: true, ...payload }); }
function failure(res, error, status = 500) {
  console.error('[Stats API]', error);
  return res.status(status).json({ success: false, error: error.message || 'Stats API request failed.' });
}
function getGuildId(req) {
  const guildId = String(req.params.guildId || req.query?.guildId || '').trim();
  if (!/^\d{15,25}$/.test(guildId)) throw new Error('Invalid guild ID.');
  return guildId;
}
function getClient(req) { return req.client || req.app?.get?.('goliath.client') || req.app?.locals?.client || global.client || null; }
async function getGuild(req, guildId) {
  const client = getClient(req);
  if (!client?.guilds) return null;
  return client.guilds.cache.get(guildId) || client.guilds.fetch(guildId).catch(() => null);
}
function actor(req, action) { return { action, actorId: req.session?.user?.id || req.body?.actorId || null }; }
function countObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).length : 0; }
function countArray(value) { return Array.isArray(value) ? value.length : 0; }
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
  const security = modules.security || data.security || {};
  return {
    activity: stats.getSummary(guildId),
    tickets: { total: countArray(tickets.tickets), panels: countArray(tickets.panels), open: countArray(tickets.tickets?.filter?.((ticket) => ticket.status === 'open') || []), analytics: tickets.analytics || {} },
    forms: { forms: countObject(forms.forms), submissions: countObject(forms.submissions), panels: countObject(forms.panels), analytics: forms.analytics || {} },
    polls: { total: countObject(polls.polls), active: Object.values(polls.polls || {}).filter((poll) => poll?.status === 'active').length, closed: Object.values(polls.polls || {}).filter((poll) => poll?.status === 'closed').length, analytics: polls.analytics || {} },
    verification: buildVerificationStats(guildId),
    logs: { enabled: guildManager.isModuleEnabled(guildId, 'logging'), channels: countObject(logs.channels), events: countObject(logs.events) },
    security: { enabled: guildManager.isModuleEnabled(guildId, 'security'), threatLevel: security.threatLevel || 'low', totalIncidents: Number(security.totalIncidents || 0), criticalIncidents: Number(security.criticalIncidents || 0), incidents: countArray(security.incidents) },
  };
}
async function buildLiveStats(req, guildId) {
  const guild = await getGuild(req, guildId);
  if (!guild) return { available: false, guild: null, members: null, channels: null, roles: null, emojis: null };
  const channels = [...guild.channels.cache.values()];
  const roles = [...guild.roles.cache.values()].filter((role) => role.id !== guild.id);
  const emojis = [...guild.emojis.cache.values()];
  return {
    available: true,
    guild: { id: guild.id, name: guild.name, iconUrl: guild.iconURL?.({ extension: 'png', size: 128 }) || null, createdAt: guild.createdAt?.toISOString?.() || null, ownerId: guild.ownerId || null, premiumTier: guild.premiumTier || 0, premiumSubscriptionCount: guild.premiumSubscriptionCount || 0 },
    members: { total: guild.memberCount || 0 },
    channels: { total: channels.length, text: channels.filter((channel) => channel.type === 0 || channel.type === 5).length, voice: channels.filter((channel) => channel.type === 2 || channel.type === 13).length, categories: channels.filter((channel) => channel.type === 4).length, threads: channels.filter((channel) => channel.isThread?.()).length },
    roles: { total: roles.length, managed: roles.filter((role) => role.managed).length, mentionable: roles.filter((role) => role.mentionable).length },
    emojis: { total: emojis.length, animated: emojis.filter((emoji) => emoji.animated).length, static: emojis.filter((emoji) => !emoji.animated).length },
  };
}

router.get('/:guildId/overview', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    const data = guildManager.getGuildData(guildId);
    return success(res, { guildId, updatedAt: new Date().toISOString(), live: await buildLiveStats(req, guildId), modules: buildModuleStats(data, guildId), stored: buildStoredStats(data, guildId) });
  } catch (error) { return failure(res, error, 400); }
});
router.get('/:guildId/config', (req, res) => {
  try {
    const guildId = getGuildId(req);
    return success(res, { guildId, config: { ...stats.getConfig(guildId), enabled: guildManager.isModuleEnabled(guildId, 'stats') }, summary: stats.getSummary(guildId) });
  } catch (error) { return failure(res, error, 400); }
});
router.patch('/:guildId/config', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const allowed = ['trackMessages', 'trackVoice', 'trackMembers', 'ignoreBots', 'ignoredChannels', 'ignoredRoles', 'settings'];
    if (typeof req.body?.enabled === 'boolean') guildManager.setModuleEnabled(guildId, 'stats', req.body.enabled, actor(req, 'stats_config_enabled'));
    const updates = Object.fromEntries(Object.entries(req.body || {}).filter(([key]) => allowed.includes(key)));
    const stored = stats.store.updateStats(guildId, (current) => ({ ...current, ...updates, settings: updates.settings ? { ...(current.settings || {}), ...updates.settings } : current.settings }), actor(req, 'stats_config_update'));
    return success(res, { guildId, config: { ...stored, enabled: guildManager.isModuleEnabled(guildId, 'stats') } });
  } catch (error) { return failure(res, error, 400); }
});
router.get('/:guildId/health', async (req, res) => {
  try { const guildId = getGuildId(req); const guild = await getGuild(req, guildId); if (!guild) throw new Error('Guild is unavailable.'); return success(res, { guildId, health: await statsHealth.buildHealth(guild) }); }
  catch (error) { return failure(res, error, 400); }
});
router.get('/:guildId/export', (req, res) => {
  try { const guildId = getGuildId(req); return success(res, { export: statsHealth.exportConfig(guildId) }); }
  catch (error) { return failure(res, error, 400); }
});
router.post('/:guildId/repair', async (req, res) => {
  try { const guildId = getGuildId(req); const guild = await getGuild(req, guildId); if (!guild) throw new Error('Guild is unavailable.'); return success(res, { guildId, result: await statsHealth.repair(guild) }); }
  catch (error) { return failure(res, error, 400); }
});
router.post('/:guildId/refresh', async (req, res) => {
  try { const guildId = getGuildId(req); const guild = await getGuild(req, guildId); if (!guild) throw new Error('Guild is unavailable.'); return success(res, { guildId, refreshed: await stats.refreshGuildCounters(guild, 'dashboard') }); }
  catch (error) { return failure(res, error, 400); }
});
router.post('/:guildId/counters/setup', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    const guild = await getGuild(req, guildId);
    if (!guild) throw new Error('Guild is unavailable.');
    guildManager.setModuleEnabled(guildId, 'stats', true, actor(req, 'stats_counter_setup'));
    return success(res, { guildId, result: await stats.counters.createCounterSuite(guild, req.body || {}) });
  } catch (error) { return failure(res, error, 400); }
});
router.post('/:guildId/reset', (req, res) => {
  try { const guildId = getGuildId(req); if (req.body?.confirm !== true) return failure(res, new Error('Reset confirmation is required.'), 400); return success(res, { guildId, config: statsHealth.reset(guildId, actor(req, 'stats_reset')) }); }
  catch (error) { return failure(res, error, 400); }
});

module.exports = router;
