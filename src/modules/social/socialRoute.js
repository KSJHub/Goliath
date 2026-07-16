'use strict';

const express = require('express');
const social = require('./social');
const socialHealth = require('./socialHealth');
const socialCreatorRoute = require('./socialCreatorRoute');

const router = express.Router();

function getDiscordClient(req) {
  return req.client || req.app?.get?.('goliath.client') || req.app?.locals?.client || global.client || global.discordClient || null;
}

function actor(req, action) {
  return { action, actorId: req.session?.user?.id || req.body?.actorId || null };
}

async function getGuild(req) {
  const client = getDiscordClient(req);
  if (!client?.guilds) throw new Error('Discord client is unavailable.');
  return client.guilds.cache.get(req.params.guildId) || client.guilds.fetch(req.params.guildId).catch(() => null);
}

function buildProviderMetadata(result = {}) {
  return {
    providerStatus: result.providerStatus || result.status || 'unknown',
    lastCheckedAt: result.checkedAt || new Date().toISOString(),
    lastError: result.success ? '' : result.error || '',
    isLive: result.isLive === true,
    lastTitle: result.title || '',
    lastGameName: result.gameName || '',
    lastViewerCount: Number(result.viewerCount || 0),
  };
}

router.get('/:guildId/providers', (req, res) => {
  try { return res.json({ success: true, guildId: req.params.guildId, ownerManaged: true, credentialOwner: 'Goliath', providers: social.providers.listProviders() }); }
  catch (error) { return res.status(500).json({ success: false, error: error.message || 'Failed to fetch social providers.' }); }
});

router.get('/:guildId/overview', (req, res) => {
  try { return res.json({ success: true, guildId: req.params.guildId, overview: { ...social.getOverview(req.params.guildId), creators: social.creators.summary(req.params.guildId) } }); }
  catch (error) { return res.status(500).json({ success: false, error: error.message || 'Failed to fetch social overview.' }); }
});

router.get('/:guildId/history', (req, res) => {
  try {
    const history = social.history.list(req.params.guildId, { limit: req.query.limit, status: req.query.status, accountId: req.query.accountId, platform: req.query.platform, alertType: req.query.alertType });
    return res.json({ success: true, guildId: req.params.guildId, summary: social.history.summary(req.params.guildId), history });
  } catch (error) { return res.status(400).json({ success: false, error: error.message || 'Failed to fetch Social alert history.' }); }
});

router.delete('/:guildId/history', (req, res) => {
  try {
    social.history.clear(req.params.guildId, actor(req, 'social_history_clear'));
    return res.json({ success: true, guildId: req.params.guildId, summary: social.history.summary(req.params.guildId) });
  } catch (error) { return res.status(400).json({ success: false, error: error.message || 'Failed to clear Social alert history.' }); }
});

router.get('/:guildId/queue', (req, res) => {
  try {
    return res.json({ success: true, guildId: req.params.guildId, summary: social.queue.summary(req.params.guildId), queue: social.queue.list(req.params.guildId, { status: req.query.status, accountId: req.query.accountId, limit: req.query.limit }) });
  } catch (error) { return res.status(400).json({ success: false, error: error.message || 'Failed to fetch Social delivery queue.' }); }
});

router.post('/:guildId/queue/process', async (req, res) => {
  try {
    const client = getDiscordClient(req);
    if (!client) throw new Error('Discord client is unavailable.');
    const result = await social.queue.processGuild(req.params.guildId, client, { meta: actor(req, 'social_queue_process') });
    return res.json({ success: true, result, summary: social.queue.summary(req.params.guildId) });
  } catch (error) { return res.status(400).json({ success: false, error: error.message || 'Failed to process Social delivery queue.' }); }
});

router.post('/:guildId/queue/:queueId/retry', (req, res) => {
  try {
    const item = social.queue.retryNow(req.params.guildId, req.params.queueId, actor(req, 'social_queue_retry_now'));
    if (!item) return res.status(404).json({ success: false, error: 'Queued delivery not found.' });
    return res.json({ success: true, item, summary: social.queue.summary(req.params.guildId) });
  } catch (error) { return res.status(400).json({ success: false, error: error.message || 'Failed to retry queued Social delivery.' }); }
});

router.delete('/:guildId/queue/:queueId', (req, res) => {
  try {
    const removed = social.queue.remove(req.params.guildId, req.params.queueId, actor(req, 'social_queue_remove'));
    if (!removed) return res.status(404).json({ success: false, error: 'Queued delivery not found.' });
    return res.json({ success: true, summary: social.queue.summary(req.params.guildId) });
  } catch (error) { return res.status(400).json({ success: false, error: error.message || 'Failed to remove queued Social delivery.' }); }
});

router.delete('/:guildId/queue', (req, res) => {
  try {
    social.queue.clear(req.params.guildId, actor(req, 'social_queue_clear'));
    return res.json({ success: true, summary: social.queue.summary(req.params.guildId) });
  } catch (error) { return res.status(400).json({ success: false, error: error.message || 'Failed to clear Social delivery queue.' }); }
});

router.use('/:guildId/creator-hub', socialCreatorRoute);

router.get('/:guildId', (req, res) => {
  try { return res.json({ success: true, guildId: req.params.guildId, config: social.getConfig(req.params.guildId), creators: social.creators.list(req.params.guildId) }); }
  catch (error) { return res.status(500).json({ success: false, error: error.message || 'Failed to fetch social config.' }); }
});

router.patch('/:guildId/config', (req, res) => {
  try {
    const allowed = ['settings', 'providers', 'templates', 'alertsChannelId', 'logChannelId', 'managerRoleIds'];
    const updates = Object.fromEntries(allowed.filter((key) => Object.prototype.hasOwnProperty.call(req.body || {}, key)).map((key) => [key, req.body[key]]));
    social.store.updateSocialSection(req.params.guildId, (section) => ({ ...section, ...updates, settings: updates.settings ? { ...(section.settings || {}), ...updates.settings } : section.settings, providers: updates.providers ? { ...(section.providers || {}), ...updates.providers } : section.providers, templates: updates.templates ? { ...(section.templates || {}), ...updates.templates } : section.templates, updatedAt: new Date().toISOString() }), actor(req, 'social_config_update'));
    return res.json({ success: true, config: social.getConfig(req.params.guildId) });
  } catch (error) { return res.status(400).json({ success: false, error: error.message || 'Failed to update Social Studio configuration.' }); }
});

router.get('/:guildId/health', async (req, res) => {
  try {
    const guild = await getGuild(req);
    if (!guild) throw new Error('Guild is unavailable.');
    return res.json({ success: true, guildId: req.params.guildId, health: await socialHealth.buildHealth(guild) });
  } catch (error) { return res.status(400).json({ success: false, error: error.message }); }
});

router.get('/:guildId/export', (req, res) => {
  try { return res.json({ success: true, export: socialHealth.exportConfig(req.params.guildId) }); }
  catch (error) { return res.status(400).json({ success: false, error: error.message }); }
});

router.post('/:guildId/repair', async (req, res) => {
  try {
    const guild = await getGuild(req);
    if (!guild) throw new Error('Guild is unavailable.');
    return res.json({ success: true, result: await socialHealth.repair(guild, actor(req, 'social_repair')) });
  } catch (error) { return res.status(400).json({ success: false, error: error.message }); }
});

router.post('/:guildId/reset', (req, res) => {
  try { return res.json({ success: true, config: socialHealth.reset(req.params.guildId, actor(req, 'social_reset')) }); }
  catch (error) { return res.status(400).json({ success: false, error: error.message }); }
});

router.patch('/:guildId/enabled', (req, res) => {
  try { return res.json({ success: true, section: social.setEnabled(req.params.guildId, req.body?.enabled === true, actor(req, 'social_enabled_update')) }); }
  catch (error) { return res.status(500).json({ success: false, error: error.message || 'Failed to update social module state.' }); }
});

router.post('/:guildId/accounts', (req, res) => {
  try { return res.status(201).json({ success: true, account: social.addAccount(req.params.guildId, req.body || {}, actor(req, 'social_account_save')) }); }
  catch (error) { return res.status(400).json({ success: false, error: error.message || 'Failed to save social account.' }); }
});

router.patch('/:guildId/accounts/:accountId', (req, res) => {
  try {
    const account = social.updateAccount(req.params.guildId, req.params.accountId, req.body || {}, actor(req, 'social_account_update'));
    if (!account) return res.status(404).json({ success: false, error: 'Social account not found.' });
    return res.json({ success: true, account });
  } catch (error) { return res.status(400).json({ success: false, error: error.message || 'Failed to update social account.' }); }
});

router.delete('/:guildId/accounts/:accountId', (req, res) => {
  try { return res.json({ success: true, section: social.removeAccount(req.params.guildId, req.params.accountId, actor(req, 'social_account_remove')) }); }
  catch (error) { return res.status(400).json({ success: false, error: error.message || 'Failed to remove social account.' }); }
});

router.post('/:guildId/accounts/:accountId/check', async (req, res) => {
  try {
    const { guildId, accountId } = req.params;
    const account = social.getConfig(guildId).accounts.find((item) => item.accountId === accountId || item.id === accountId);
    if (!account) return res.status(404).json({ success: false, error: 'Social account not found.' });
    const result = await social.providers.checkAccount(account);
    const metadata = buildProviderMetadata(result);
    const updated = social.updateAccount(guildId, account.accountId, { externalId: result.externalId || account.externalId, metadata: { ...(account.metadata || {}), provider: metadata }, lastSeen: { ...(account.lastSeen || {}), lastCheckedAt: metadata.lastCheckedAt, lastProviderStatus: metadata.providerStatus, lastProviderError: metadata.lastError, lastLiveState: metadata.isLive ? 'live' : 'offline' } }, actor(req, 'social_manual_provider_check'));
    if (!result.success) social.store.incrementAnalytics(guildId, { errors: 1 }, actor(req, 'social_manual_provider_error'));
    social.history.record(guildId, { status: result.success ? 'skipped' : 'failed', eventType: 'manual_provider_check', accountId: account.accountId, creator: account.displayName || account.username, platform: account.platform, providerStatus: metadata.providerStatus, reason: result.success ? (result.isLive ? 'live_detected_no_delivery' : 'check_complete') : null, error: result.success ? null : result.error, contentId: result.contentId, title: result.title }, actor(req, 'social_manual_provider_history'));
    return res.json({ success: true, result, account: updated });
  } catch (error) { return res.status(500).json({ success: false, error: error.message || 'Failed to check social account.' }); }
});

router.post('/:guildId/accounts/:accountId/test', async (req, res) => {
  try {
    const result = await social.sendTestAlert(req.params.guildId, req.params.accountId, getDiscordClient(req), actor(req, 'social_test_alert'));
    if (!result.success) return res.status(result.status || 400).json(result);
    return res.json(result);
  } catch (error) { return res.status(500).json({ success: false, error: error.message || 'Failed to send test alert.' }); }
});

router.post('/:guildId/check', async (req, res) => {
  try {
    const client = getDiscordClient(req);
    if (!client) throw new Error('Discord client is unavailable.');
    return res.json({ success: true, guildId: req.params.guildId, result: await social.scheduler.runSocialCheck(client, { guildIds: [req.params.guildId] }) });
  } catch (error) { return res.status(500).json({ success: false, error: error.message || 'Failed to run social check.' }); }
});

module.exports = router;
