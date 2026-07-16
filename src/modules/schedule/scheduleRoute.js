'use strict';

const express = require('express');
const schedule = require('./schedule');

const router = express.Router();

function actor(req, action) {
  return { action, actorId: req.session?.user?.id || req.body?.actorId || null };
}
function getClient(req) {
  return req.client || req.app?.get?.('goliath.client') || req.app?.locals?.client || global.client || global.discordClient || null;
}
async function getGuild(req) {
  const client = getClient(req);
  if (!client?.guilds) throw new Error('Discord client is unavailable.');
  return client.guilds.cache.get(req.params.guildId) || client.guilds.fetch(req.params.guildId).catch(() => null);
}

router.get('/:guildId', (req, res) => {
  try {
    const section = schedule.getSection(req.params.guildId);
    return res.json({ success: true, guildId: req.params.guildId, config: section, events: schedule.listEvents(req.params.guildId) });
  } catch (error) { return res.status(400).json({ success: false, error: error.message }); }
});

router.patch('/:guildId/enabled', (req, res) => {
  try { return res.json({ success: true, config: schedule.setEnabled(req.params.guildId, req.body?.enabled === true, actor(req, 'schedule_enabled_update')) }); }
  catch (error) { return res.status(400).json({ success: false, error: error.message }); }
});

router.patch('/:guildId/settings', (req, res) => {
  try { return res.json({ success: true, config: schedule.updateSettings(req.params.guildId, req.body || {}, actor(req, 'schedule_settings_update')) }); }
  catch (error) { return res.status(400).json({ success: false, error: error.message }); }
});

router.post('/:guildId/events', (req, res) => {
  try { return res.status(201).json({ success: true, event: schedule.saveEvent(req.params.guildId, req.body || {}, actor(req, 'schedule_event_create')) }); }
  catch (error) { return res.status(400).json({ success: false, error: error.message }); }
});

router.patch('/:guildId/events/:eventId', (req, res) => {
  try {
    const current = schedule.getEvent(req.params.guildId, req.params.eventId);
    if (!current) return res.status(404).json({ success: false, error: 'Schedule event not found.' });
    return res.json({ success: true, event: schedule.saveEvent(req.params.guildId, { ...current, ...(req.body || {}), eventId: current.eventId }, actor(req, 'schedule_event_update')) });
  } catch (error) { return res.status(400).json({ success: false, error: error.message }); }
});

router.delete('/:guildId/events/:eventId', (req, res) => {
  try {
    const removed = schedule.removeEvent(req.params.guildId, req.params.eventId, actor(req, 'schedule_event_remove'));
    if (!removed) return res.status(404).json({ success: false, error: 'Schedule event not found.' });
    return res.json({ success: true });
  } catch (error) { return res.status(400).json({ success: false, error: error.message }); }
});

router.post('/:guildId/events/:eventId/cancel', (req, res) => {
  try {
    const event = schedule.cancelEvent(req.params.guildId, req.params.eventId, actor(req, 'schedule_event_cancel'));
    if (!event) return res.status(404).json({ success: false, error: 'Schedule event not found.' });
    return res.json({ success: true, event });
  } catch (error) { return res.status(400).json({ success: false, error: error.message }); }
});

router.post('/:guildId/events/:eventId/duplicate', (req, res) => {
  try { return res.status(201).json({ success: true, event: schedule.duplicateEvent(req.params.guildId, req.params.eventId, req.body?.startAt, actor(req, 'schedule_event_duplicate')) }); }
  catch (error) { return res.status(400).json({ success: false, error: error.message }); }
});

router.put('/:guildId/events/:eventId/rsvp/:userId', (req, res) => {
  try { return res.json({ success: true, ...schedule.setRsvp(req.params.guildId, req.params.eventId, req.params.userId, req.body?.status, actor(req, 'schedule_rsvp_update')) }); }
  catch (error) { return res.status(400).json({ success: false, error: error.message }); }
});

router.delete('/:guildId/events/:eventId/rsvp/:userId', (req, res) => {
  try {
    const event = schedule.removeRsvp(req.params.guildId, req.params.eventId, req.params.userId, actor(req, 'schedule_rsvp_remove'));
    if (!event) return res.status(404).json({ success: false, error: 'Schedule event not found.' });
    return res.json({ success: true, event, counts: schedule.rsvpCounts(event) });
  } catch (error) { return res.status(400).json({ success: false, error: error.message }); }
});

router.post('/:guildId/process', async (req, res) => {
  try {
    const guild = await getGuild(req);
    if (!guild) throw new Error('Guild is unavailable.');
    return res.json({ success: true, result: await schedule.processGuild(guild, actor(req, 'schedule_manual_process')) });
  } catch (error) { return res.status(400).json({ success: false, error: error.message }); }
});

router.get('/:guildId/health', async (req, res) => {
  try {
    const guild = await getGuild(req);
    if (!guild) throw new Error('Guild is unavailable.');
    return res.json({ success: true, health: await schedule.buildHealth(guild) });
  } catch (error) { return res.status(400).json({ success: false, error: error.message }); }
});

router.post('/:guildId/repair', async (req, res) => {
  try {
    const guild = await getGuild(req);
    if (!guild) throw new Error('Guild is unavailable.');
    return res.json({ success: true, health: await schedule.repair(guild, actor(req, 'schedule_repair')) });
  } catch (error) { return res.status(400).json({ success: false, error: error.message }); }
});

router.get('/:guildId/export', (req, res) => {
  try { return res.json({ success: true, export: schedule.exportConfiguration(req.params.guildId) }); }
  catch (error) { return res.status(400).json({ success: false, error: error.message }); }
});

router.post('/:guildId/reset', (req, res) => {
  try { return res.json({ success: true, config: schedule.reset(req.params.guildId, actor(req, 'schedule_reset')) }); }
  catch (error) { return res.status(400).json({ success: false, error: error.message }); }
});

module.exports = router;
