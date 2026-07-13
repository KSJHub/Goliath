'use strict';

const express = require('express');
const goodbye = require('../../modules/goodbye');

const router = express.Router();
const success = (res, payload = {}) => res.json({ success: true, ...payload });

function failure(res, error, status = 500) {
  console.error('[Goodbye API]', error);
  return res.status(status).json({ success: false, error: error.message || 'Goodbye API request failed.' });
}

function getGuildId(req) {
  const guildId = String(req.params.guildId || '').trim();
  if (!/^\d{15,25}$/.test(guildId)) throw new Error('Invalid guild ID.');
  return guildId;
}

const getActorId = (req) => String(req.session?.user?.id || req.body?.actorId || '').trim() || null;
const getClient = (req) => req.client || req.app?.get?.('goliath.client') || req.app?.locals?.client || null;

async function getGuild(req, guildId) {
  const client = getClient(req);
  if (!client?.guilds) return null;
  return client.guilds.cache.get(guildId) || client.guilds.fetch(guildId).catch(() => null);
}

async function buildOverview(req, guildId) {
  const config = goodbye.getGoodbyeSection(guildId);
  const guild = await getGuild(req, guildId);
  const health = guild ? await goodbye.buildHealthReport(guild) : null;
  const templates = goodbye.getGoodbyeTemplates(guildId);
  const binding = goodbye.getGoodbyeBinding(guildId);
  return {
    guildId,
    config,
    templates,
    binding,
    overview: {
      enabled: config.enabled !== false,
      channelId: config.channelId,
      analytics: config.analytics,
      health,
      templateId: binding?.templateId || config.templateId,
      templateName: binding?.name || health?.templateName || null,
      templateBound: Boolean(binding),
    },
  };
}

router.get('/:guildId/overview', async (req, res) => {
  try {
    return success(res, await buildOverview(req, getGuildId(req)));
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.put('/:guildId/config', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    const patch = req.body || {};
    let config;
    if (patch.templateId) {
      config = goodbye.bindGoodbyeTemplate(guildId, patch.templateId, { actorId: getActorId(req) }).config;
      const { templateId, ...rest } = patch;
      if (Object.keys(rest).length) config = goodbye.updateConfig(guildId, rest, { actorId: getActorId(req) });
    } else {
      config = goodbye.updateConfig(guildId, patch, { actorId: getActorId(req) });
    }
    return success(res, { config, ...(await buildOverview(req, guildId)) });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.patch('/:guildId/enabled', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    goodbye.updateConfig(guildId, { enabled: req.body?.enabled === true }, { actorId: getActorId(req) });
    return success(res, await buildOverview(req, guildId));
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.post('/:guildId/template', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    const templateId = String(req.body?.templateId || '').trim();
    if (!templateId) throw new Error('A template ID is required.');
    const result = goodbye.bindGoodbyeTemplate(guildId, templateId, { actorId: getActorId(req) });
    return success(res, { ...result, ...(await buildOverview(req, guildId)) });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.post('/:guildId/repair', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    const guild = await getGuild(req, guildId);
    if (!guild) throw new Error('Guild is unavailable.');
    const config = await goodbye.repairConfiguration(guild, { actorId: getActorId(req) });
    return success(res, { config, ...(await buildOverview(req, guildId)) });
  } catch (error) {
    return failure(res, error, 400);
  }
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
    const config = goodbye.getGoodbyeSection(guildId);
    if (!config.channelId) throw new Error('Select a goodbye channel before previewing.');
    const result = await goodbye.sendGoodbye(member, { silent: false, force: true, previewOnly: true });
    return success(res, { result, ...(await buildOverview(req, guildId)) });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.post('/:guildId/reset', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    goodbye.resetGoodbye(guildId, { actorId: getActorId(req) });
    return success(res, await buildOverview(req, guildId));
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.get('/:guildId/export', (req, res) => {
  try {
    const guildId = getGuildId(req);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="goliath-goodbye-${guildId}.json"`);
    return res.send(JSON.stringify(goodbye.exportConfiguration(guildId), null, 2));
  } catch (error) {
    return failure(res, error, 400);
  }
});

module.exports = router;
