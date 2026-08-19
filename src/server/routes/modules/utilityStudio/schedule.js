'use strict';

const express = require('express');
const guildManager = require('../../../../core/guild/guildManager');
const schedule = require('../../../../modules/utilityStudio/schedule/schedule');
const deployment = require('../../../../modules/utilityStudio/schedule/scheduleDeployment');
const scheduleHealth = require('../../../../modules/utilityStudio/schedule/scheduleHealth');

const router = express.Router();

function actor(req, action) { return { action, actorId: req.session?.user?.id || req.body?.actorId || null }; }
function getClient(req) { return req.client || req.app?.get?.('goliath.client') || req.app?.locals?.client || global.client || global.discordClient || null; }
async function getGuild(req) {
  const client = getClient(req);
  if (!client?.guilds) throw new Error('Discord client is unavailable.');
  return client.guilds.cache.get(req.params.guildId) || client.guilds.fetch(req.params.guildId).catch(() => null);
}
function fail(res, error, status = 400) { return res.status(status).json({ success: false, error: error.message || String(error) }); }
function canonicalConfig(guildId, config = schedule.getSection(guildId)) { return { ...config, enabled: guildManager.isModuleEnabled(guildId, 'schedule') }; }
function assertScheduleEnabled(guildId) { if (!guildManager.isModuleEnabled(guildId, 'schedule')) throw new Error('Schedule is disabled for this server.'); }

router.get('/:guildId', (req, res) => {
  try {
    const config = canonicalConfig(req.params.guildId);
    return res.json({ success: true, guildId: req.params.guildId, config, events: schedule.listEvents(req.params.guildId), templates: schedule.listTemplates(req.params.guildId) });
  } catch (error) { return fail(res, error); }
});
router.patch('/:guildId/enabled', (req, res) => {
  try {
    guildManager.setModuleEnabled(req.params.guildId, 'schedule', req.body?.enabled === true, actor(req, 'schedule_enabled_update'));
    return res.json({ success: true, config: canonicalConfig(req.params.guildId) });
  } catch (error) { return fail(res, error); }
});
router.patch('/:guildId/settings', (req, res) => {
  try {
    const config = schedule.updateSettings(req.params.guildId, req.body || {}, actor(req, 'schedule_settings_update'));
    return res.json({ success: true, config: canonicalConfig(req.params.guildId, config) });
  } catch (error) { return fail(res, error); }
});
router.post('/:guildId/events', (req, res) => {
  try { assertScheduleEnabled(req.params.guildId); return res.status(201).json({ success: true, event: schedule.saveEvent(req.params.guildId, req.body || {}, actor(req, 'schedule_event_create')) }); }
  catch (error) { return fail(res, error); }
});
router.get('/:guildId/events/:eventId', (req, res) => {
  try {
    const event = schedule.getEvent(req.params.guildId, req.params.eventId);
    if (!event) return res.status(404).json({ success: false, error: 'Schedule event not found.' });
    return res.json({ success: true, event });
  } catch (error) { return fail(res, error); }
});
router.patch('/:guildId/events/:eventId', async (req, res) => {
  try {
    assertScheduleEnabled(req.params.guildId);
    const current = schedule.getEvent(req.params.guildId, req.params.eventId);
    if (!current) return res.status(404).json({ success: false, error: 'Schedule event not found.' });
    const event = schedule.saveEvent(req.params.guildId, { ...current, ...(req.body || {}), eventId: current.eventId }, actor(req, 'schedule_event_update'));
    if (event.messageId) {
      const guild = await getGuild(req);
      if (guild) await deployment.updateDeployment(guild, event.eventId).catch(() => null);
    }
    return res.json({ success: true, event });
  } catch (error) { return fail(res, error); }
});
router.delete('/:guildId/events/:eventId', async (req, res) => {
  try {
    assertScheduleEnabled(req.params.guildId);
    const current = schedule.getEvent(req.params.guildId, req.params.eventId);
    if (!current) return res.status(404).json({ success: false, error: 'Schedule event not found.' });
    const guild = await getGuild(req);
    if (guild) await deployment.removeDeployment(guild, current.eventId, actor(req, 'schedule_event_deployment_remove')).catch(() => null);
    const removed = schedule.removeEvent(req.params.guildId, req.params.eventId, actor(req, 'schedule_event_remove'));
    return res.json({ success: true, removed });
  } catch (error) { return fail(res, error); }
});
router.post('/:guildId/events/:eventId/cancel', async (req, res) => {
  try {
    assertScheduleEnabled(req.params.guildId);
    const event = schedule.cancelEvent(req.params.guildId, req.params.eventId, actor(req, 'schedule_event_cancel'));
    if (!event) return res.status(404).json({ success: false, error: 'Schedule event not found.' });
    const guild = await getGuild(req);
    if (guild && event.messageId) await deployment.updateDeployment(guild, event.eventId).catch(() => null);
    return res.json({ success: true, event });
  } catch (error) { return fail(res, error); }
});
router.post('/:guildId/events/:eventId/duplicate', (req, res) => {
  try { assertScheduleEnabled(req.params.guildId); return res.status(201).json({ success: true, event: schedule.duplicateEvent(req.params.guildId, req.params.eventId, req.body?.startAt, actor(req, 'schedule_event_duplicate')) }); }
  catch (error) { return fail(res, error); }
});
router.post('/:guildId/events/:eventId/deploy', async (req, res) => {
  try {
    assertScheduleEnabled(req.params.guildId);
    const guild = await getGuild(req); if (!guild) throw new Error('Guild is unavailable.');
    const current = schedule.getEvent(req.params.guildId, req.params.eventId);
    if (current?.messageId) {
      if (req.body?.channelId && req.body.channelId !== current.channelId) {
        await deployment.removeDeployment(guild, current.eventId, actor(req, 'schedule_event_redeploy_remove'));
        schedule.saveEvent(req.params.guildId, { ...current, channelId: req.body.channelId, messageId: null }, actor(req, 'schedule_event_redeploy_channel'));
        return res.json({ success: true, event: await deployment.deploy(guild, req.params.eventId, req.body.channelId, actor(req, 'schedule_event_redeploy')) });
      }
      await deployment.updateDeployment(guild, current.eventId);
      return res.json({ success: true, event: schedule.getEvent(req.params.guildId, current.eventId) });
    }
    return res.json({ success: true, event: await deployment.deploy(guild, req.params.eventId, req.body?.channelId || null, actor(req, 'schedule_event_deploy')) });
  } catch (error) { return fail(res, error); }
});
router.post('/:guildId/events/:eventId/deployment/update', async (req, res) => {
  try { assertScheduleEnabled(req.params.guildId); const guild = await getGuild(req); if (!guild) throw new Error('Guild is unavailable.'); return res.json({ success: true, result: await deployment.updateDeployment(guild, req.params.eventId) }); }
  catch (error) { return fail(res, error); }
});
router.delete('/:guildId/events/:eventId/deployment', async (req, res) => {
  try { const guild = await getGuild(req); if (!guild) throw new Error('Guild is unavailable.'); return res.json({ success: true, removed: await deployment.removeDeployment(guild, req.params.eventId, actor(req, 'schedule_event_deployment_remove')) }); }
  catch (error) { return fail(res, error); }
});
router.post('/:guildId/events/:eventId/native/sync', async (req, res) => {
  try { assertScheduleEnabled(req.params.guildId); const guild = await getGuild(req); if (!guild) throw new Error('Guild is unavailable.'); const event = schedule.getEvent(req.params.guildId, req.params.eventId); if (!event) return res.status(404).json({ success: false, error: 'Schedule event not found.' }); return res.json({ success: true, result: await deployment.syncDiscordEvent(guild, event), event: schedule.getEvent(req.params.guildId, event.eventId) }); }
  catch (error) { return fail(res, error); }
});
router.put('/:guildId/events/:eventId/rsvp/:userId', (req, res) => {
  try { assertScheduleEnabled(req.params.guildId); return res.json({ success: true, ...schedule.setRsvp(req.params.guildId, req.params.eventId, req.params.userId, req.body?.status, actor(req, 'schedule_rsvp_update')) }); }
  catch (error) { return fail(res, error); }
});
router.delete('/:guildId/events/:eventId/rsvp/:userId', (req, res) => {
  try { assertScheduleEnabled(req.params.guildId); const result = schedule.removeRsvp(req.params.guildId, req.params.eventId, req.params.userId, actor(req, 'schedule_rsvp_remove')); if (!result) return res.status(404).json({ success: false, error: 'Schedule event not found.' }); return res.json({ success: true, ...result }); }
  catch (error) { return fail(res, error); }
});
router.put('/:guildId/events/:eventId/rsvp/:userId/reminders', (req, res) => {
  try { assertScheduleEnabled(req.params.guildId); return res.json({ success: true, event: schedule.setMemberReminder(req.params.guildId, req.params.eventId, req.params.userId, req.body?.minutes || [], actor(req, 'schedule_member_reminders_update')) }); }
  catch (error) { return fail(res, error); }
});

router.get('/:guildId/templates', (req, res) => {
  try { return res.json({ success: true, templates: schedule.listTemplates(req.params.guildId) }); }
  catch (error) { return fail(res, error); }
});
router.post('/:guildId/templates', (req, res) => {
  try { return res.status(201).json({ success: true, template: schedule.saveTemplate(req.params.guildId, req.body || {}, actor(req, 'schedule_template_create')) }); }
  catch (error) { return fail(res, error); }
});
router.delete('/:guildId/templates/:templateId', (req, res) => {
  try { return res.json({ success: true, removed: schedule.removeTemplate(req.params.guildId, req.params.templateId, actor(req, 'schedule_template_remove')) }); }
  catch (error) { return fail(res, error); }
});
router.post('/:guildId/templates/:templateId/create-event', (req, res) => {
  try { assertScheduleEnabled(req.params.guildId); return res.status(201).json({ success: true, event: schedule.createFromTemplate(req.params.guildId, req.params.templateId, req.body || {}, actor(req, 'schedule_template_create_event')) }); }
  catch (error) { return fail(res, error); }
});

router.post('/:guildId/process', async (req, res) => {
  try { const guild = await getGuild(req); if (!guild) throw new Error('Guild is unavailable.'); return res.json({ success: true, result: await schedule.processGuild(guild, actor(req, 'schedule_manual_process')) }); }
  catch (error) { return fail(res, error); }
});
router.get('/:guildId/health', async (req, res) => {
  try { const guild = await getGuild(req); if (!guild) throw new Error('Guild is unavailable.'); return res.json({ success: true, health: await scheduleHealth.buildHealthReport(guild) }); }
  catch (error) { return fail(res, error); }
});
router.post('/:guildId/repair', async (req, res) => {
  try { const guild = await getGuild(req); if (!guild) throw new Error('Guild is unavailable.'); return res.json({ success: true, health: await scheduleHealth.repair(guild, actor(req, 'schedule_repair')) }); }
  catch (error) { return fail(res, error); }
});
router.get('/:guildId/export', (req, res) => {
  try { return res.json({ success: true, export: canonicalConfig(req.params.guildId, schedule.exportConfiguration(req.params.guildId)) }); }
  catch (error) { return fail(res, error); }
});
router.post('/:guildId/reset', (req, res) => {
  try { const config = schedule.reset(req.params.guildId, actor(req, 'schedule_reset')); return res.json({ success: true, config: canonicalConfig(req.params.guildId, config) }); }
  catch (error) { return fail(res, error); }
});

module.exports = router;
