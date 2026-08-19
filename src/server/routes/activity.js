'use strict';

const express = require('express');
const activity = require('../../core/activity/activityStore');
const guildManager = require('../../core/guild/guildManager');

const router = express.Router();

function ok(res, payload = {}) { return res.json({ success: true, ...payload }); }
function fail(res, error, status = 400) { return res.status(status).json({ success: false, error: error.message || 'Activity request failed.' }); }
function guildId(req) {
  const id = String(req.params.guildId || '').trim();
  if (!/^\d{15,25}$/.test(id)) throw new Error('Invalid guild ID.');
  return id;
}
function timelineEnabled(id) { return guildManager.isModuleEnabled(id, 'timeline'); }

router.get('/:guildId', (req, res) => {
  try {
    const id = guildId(req);
    const entries = activity.getTimeline(id, {
      module: req.query.module || '',
      severity: req.query.severity || '',
      search: req.query.search || '',
      limit: req.query.limit || 100,
    });
    return ok(res, { guildId: id, enabled: timelineEnabled(id), entries, summary: activity.summary(id) });
  } catch (error) { return fail(res, error); }
});

router.post('/:guildId', (req, res) => {
  try {
    const id = guildId(req);
    const entry = activity.logActivity(id, req.body || {});
    return ok(res, { guildId: id, enabled: timelineEnabled(id), entry, entries: activity.getTimeline(id), summary: activity.summary(id) });
  } catch (error) { return fail(res, error); }
});

router.delete('/:guildId', (req, res) => {
  try {
    const id = guildId(req);
    return ok(res, { guildId: id, enabled: timelineEnabled(id), entries: activity.clearTimeline(id), summary: activity.summary(id) });
  } catch (error) { return fail(res, error); }
});

router.post('/:guildId/test', (req, res) => {
  try {
    const id = guildId(req);
    const entry = activity.logActivity(id, {
      module: 'dashboard',
      event: 'activity.test',
      title: 'Activity Timeline Test',
      message: 'Safe dashboard activity test entry.',
      severity: 'info',
      route: '/timeline',
    });
    return ok(res, { guildId: id, enabled: timelineEnabled(id), entry, entries: activity.getTimeline(id), summary: activity.summary(id) });
  } catch (error) { return fail(res, error); }
});

module.exports = router;
