'use strict';

const express = require('express');
const legacyRouter = require('../../server/routes/tickets');
const tickets = require('./tickets');

const router = express.Router();

function getClient(req) {
  return req.app?.locals?.client
    || req.app?.locals?.discordClient
    || req.client
    || global.client
    || global.discordClient
    || null;
}

async function getGuild(req, guildId) {
  const client = getClient(req);
  if (!client?.guilds?.fetch) return null;
  return client.guilds.cache.get(guildId)
    || client.guilds.fetch(guildId).catch(() => null);
}

router.get('/:guildId/health', async (req, res) => {
  try {
    const guild = await getGuild(req, req.params.guildId);
    if (!guild) return res.status(404).json({ success: false, error: 'Guild is unavailable.' });
    const health = await tickets.buildHealthReport(guild);
    return res.json({ success: true, health });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Unable to check Tickets health.' });
  }
});

router.post('/:guildId/health/repair', async (req, res) => {
  try {
    const guild = await getGuild(req, req.params.guildId);
    if (!guild) return res.status(404).json({ success: false, error: 'Guild is unavailable.' });
    const result = await tickets.repairAll(guild, req.body?.actorId || null);
    return res.json({ success: true, result });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Unable to repair Tickets.' });
  }
});

router.post('/:guildId/panels/:panelId/repair', async (req, res) => {
  try {
    const guild = await getGuild(req, req.params.guildId);
    if (!guild) return res.status(404).json({ success: false, error: 'Guild is unavailable.' });
    const panel = await tickets.repairPanel(guild, req.params.panelId, req.body?.actorId || null);
    return res.json({ success: true, panel });
  } catch (error) {
    const status = /not found/i.test(String(error.message || '')) ? 404 : 500;
    return res.status(status).json({ success: false, error: error.message || 'Unable to repair ticket panel.' });
  }
});

router.use(legacyRouter);

module.exports = router;
