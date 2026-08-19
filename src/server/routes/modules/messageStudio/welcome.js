'use strict';

const express = require('express');
const guildManager = require('../../../../core/guild/guildManager');
const welcome = require('../../../../modules/messageStudio/welcome/welcome');
const scheduledWelcome = require('../../../../modules/messageStudio/welcome/scheduledWelcome');
const scheduledWelcomeHealth = require('../../../../modules/messageStudio/welcome/scheduledWelcomeHealth');

const router = express.Router();

function success(res, payload = {}) {
  return res.json({ success: true, ...payload });
}

function failure(res, error, status = 500) {
  console.error('[Welcome API]', error);
  return res.status(status).json({ success: false, error: error.message || 'Welcome API request failed.' });
}

function getGuildId(req) {
  const guildId = String(req.params.guildId || '').trim();
  if (!/^\d{15,25}$/.test(guildId)) throw new Error('Invalid guild ID.');
  return guildId;
}

function getActorId(req) {
  return String(req.session?.user?.id || req.body?.actorId || '').trim() || null;
}

function getClient(req) {
  return req.client || req.app?.get?.('goliath.client') || req.app?.locals?.client || null;
}

async function getGuild(req, guildId) {
  const client = getClient(req);
  if (!client?.guilds) return null;
  return client.guilds.cache.get(guildId) || client.guilds.fetch(guildId).catch(() => null);
}

function canonicalConfig(guildId, config = welcome.getWelcomeSection(guildId)) {
  return { ...config, enabled: guildManager.isModuleEnabled(guildId, 'welcome') };
}

function canonicalExport(guildId) {
  const exported = welcome.exportConfiguration(guildId);
  return { ...exported, config: canonicalConfig(guildId, exported.config) };
}

async function buildOverview(req, guildId) {
  const config = canonicalConfig(guildId);
  const scheduled = scheduledWelcome.getScheduledConfig(guildId);
  const guild = await getGuild(req, guildId);
  const health = guild ? await welcome.buildHealthReport(guild) : null;
  const scheduledHealth = guild ? await scheduledWelcomeHealth.buildHealth(guild) : null;
  const templates = welcome.getWelcomeTemplates(guildId, 'welcome');
  const binding = welcome.getWelcomeBinding(guildId, 'welcome');
  return {
    guildId,
    config,
    scheduled,
    templates,
    binding,
    overview: {
      enabled: config.enabled,
      channelId: config.channelId,
      dmEnabled: config.dmEnabled === true,
      analytics: config.analytics,
      health,
      scheduledHealth,
      scheduledEnabled: scheduled.enabled,
      scheduledWaiting: scheduledHealth?.waitingMembers || 0,
      templateId: binding?.templateId || config.templateId,
      templateName: binding?.name || health?.templateName || null,
      templateBound: Boolean(binding),
    },
  };
}

router.get('/:guildId/overview', async (req, res) => {
  try { return success(res, await buildOverview(req, getGuildId(req))); }
  catch (error) { return failure(res, error, 400); }
});

router.put('/:guildId/config', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    const patch = req.body || {};
    const { enabled, templateId, ...settingsPatch } = patch;
    if (typeof enabled === 'boolean') guildManager.setModuleEnabled(guildId, 'welcome', enabled, { actorId: getActorId(req) });
    if (templateId) welcome.bindWelcomeTemplate(guildId, templateId, 'welcome', { actorId: getActorId(req) });
    if (Object.keys(settingsPatch).length) welcome.updateConfig(guildId, settingsPatch, { actorId: getActorId(req) });
    return success(res, await buildOverview(req, guildId));
  } catch (error) { return failure(res, error, 400); }
});

router.patch('/:guildId/enabled', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    guildManager.setModuleEnabled(guildId, 'welcome', req.body?.enabled === true, { actorId: getActorId(req) });
    return success(res, await buildOverview(req, guildId));
  } catch (error) { return failure(res, error, 400); }
});

router.post('/:guildId/template', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    const templateId = String(req.body?.templateId || '').trim();
    if (!templateId) throw new Error('A template ID is required.');
    const result = welcome.bindWelcomeTemplate(guildId, templateId, 'welcome', { actorId: getActorId(req) });
    return success(res, { ...result, ...(await buildOverview(req, guildId)) });
  } catch (error) { return failure(res, error, 400); }
});

router.post('/:guildId/repair', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    const guild = await getGuild(req, guildId);
    if (!guild) throw new Error('Guild is unavailable.');
    await welcome.repairConfiguration(guild, { actorId: getActorId(req) });
    await scheduledWelcomeHealth.repair(guild, { actorId: getActorId(req) });
    return success(res, await buildOverview(req, guildId));
  } catch (error) { return failure(res, error, 400); }
});

router.post('/:guildId/test', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    const guild = await getGuild(req, guildId);
    if (!guild) throw new Error('Guild is unavailable.');
    const userId = String(req.body?.userId || getActorId(req) || '').trim();
    if (!/^\d{15,25}$/.test(userId)) throw new Error('A valid preview user ID is required.');
    const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
    if (!member) throw new Error('Preview member could not be found in this server.');
    const config = welcome.getWelcomeSection(guildId);
    if (!config.channelId && !config.dmEnabled) throw new Error('Select a welcome channel or enable welcome DMs before previewing.');
    const result = await welcome.sendWelcome(member, { silent: false, force: true, previewOnly: true });
    return success(res, { result, ...(await buildOverview(req, guildId)) });
  } catch (error) { return failure(res, error, 400); }
});

router.get('/:guildId/scheduled', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    const guild = await getGuild(req, guildId);
    const scheduled = scheduledWelcome.getScheduledConfig(guildId);
    const health = guild ? await scheduledWelcomeHealth.buildHealth(guild) : null;
    return success(res, { scheduled, health });
  } catch (error) { return failure(res, error, 400); }
});

router.put('/:guildId/scheduled', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    const scheduled = scheduledWelcome.updateScheduledConfig(guildId, req.body || {}, { actorId: getActorId(req) });
    const guild = await getGuild(req, guildId);
    const health = guild ? await scheduledWelcomeHealth.buildHealth(guild) : null;
    return success(res, { scheduled, health });
  } catch (error) { return failure(res, error, 400); }
});

router.get('/:guildId/scheduled/queue', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    const guild = await getGuild(req, guildId);
    if (!guild) throw new Error('Guild is unavailable.');
    const members = await scheduledWelcome.getWaitingMembers(guild);
    return success(res, { count: members.length, members: members.map((member) => ({ id: member.id, username: member.user?.username || member.id, displayName: member.displayName || member.user?.username || member.id })) });
  } catch (error) { return failure(res, error, 400); }
});

router.post('/:guildId/scheduled/run', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    const guild = await getGuild(req, guildId);
    if (!guild) throw new Error('Guild is unavailable.');
    const result = await scheduledWelcome.runScheduledWelcome(guild, { force: true, actorId: getActorId(req) });
    return success(res, { result, ...(await buildOverview(req, guildId)) });
  } catch (error) { return failure(res, error, 400); }
});

router.post('/:guildId/scheduled/repair', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    const guild = await getGuild(req, guildId);
    if (!guild) throw new Error('Guild is unavailable.');
    const result = await scheduledWelcomeHealth.repair(guild, { actorId: getActorId(req) });
    return success(res, { result, ...(await buildOverview(req, guildId)) });
  } catch (error) { return failure(res, error, 400); }
});

router.post('/:guildId/reset', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    welcome.resetWelcome(guildId, { actorId: getActorId(req) });
    return success(res, await buildOverview(req, guildId));
  } catch (error) { return failure(res, error, 400); }
});

router.get('/:guildId/export', (req, res) => {
  try {
    const guildId = getGuildId(req);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="goliath-welcome-${guildId}.json"`);
    return res.send(JSON.stringify(canonicalExport(guildId), null, 2));
  } catch (error) { return failure(res, error, 400); }
});

module.exports = router;
