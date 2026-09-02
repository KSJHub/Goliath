'use strict';

const express = require('express');
const guildManager = require('../../../../core/guild/guildManager');
const birthdays = require('../../../../modules/communityStudio/birthdays/birthdays');
const { validateRoleSelection, isGoliathPermissionError } = require('../../../../core/security/protection/permissions');

const router = express.Router();
const ok = (res, payload = {}) => res.json({ success: true, ...payload });

function fail(res, error, status = 400) {
  if (isGoliathPermissionError(error)) {
    return res.status(403).json({ success: false, code: error.code, error: error.message, ...(error.details || {}) });
  }
  return res.status(status).json({ success: false, error: error.message || 'Birthdays request failed.' });
}

function guildId(req) {
  const id = String(req.params.guildId || '').trim();
  if (!/^\d{15,25}$/.test(id)) throw new Error('Invalid guild ID.');
  return id;
}
function userId(req) {
  const id = String(req.params.userId || req.body?.userId || '').trim();
  if (!/^\d{15,25}$/.test(id)) throw new Error('Invalid user ID.');
  return id;
}

const actor = (req) => String(req.session?.user?.id || req.body?.actorId || '').trim() || null;
const client = (req) => req.client || req.app?.get?.('goliath.client') || null;

async function guild(req, id) {
  const discord = client(req);
  return discord?.guilds?.cache?.get(id) || await discord?.guilds?.fetch?.(id).catch(() => null);
}

async function overview(req, id) {
  const enabled = guildManager.isModuleEnabled(id, 'birthdays');
  const config = birthdays.getSection(id);
  const target = await guild(req, id);
  const upcoming = birthdays.listUpcoming(id, 100, 60).map((item) => ({
    userId: item.member.userId,
    month: item.member.month,
    day: item.member.day,
    year: item.member.year,
    listPublic: item.member.listPublic,
    announce: item.member.announce,
    showAge: item.member.showAge,
    daysUntil: item.daysUntil,
    next: item.next,
    displayName: target?.members?.cache?.get(item.member.userId)?.displayName || null,
  }));
  const members = Object.values(config.members || {}).map((item) => ({
    ...item,
    displayName: target?.members?.cache?.get(item.userId)?.displayName || null,
  })).sort((a, b) => `${String(a.month).padStart(2, '0')}-${String(a.day).padStart(2, '0')}`.localeCompare(`${String(b.month).padStart(2, '0')}-${String(b.day).padStart(2, '0')}`));
  return {
    guildId: id,
    config: { ...config, enabled },
    overview: {
      enabled,
      memberCount: members.length,
      upcoming,
      members,
      analytics: config.analytics || {},
      health: target ? await birthdays.buildHealth(target) : null,
    },
  };
}

router.get('/:guildId/overview', async (req, res) => {
  try { return ok(res, await overview(req, guildId(req))); }
  catch (error) { return fail(res, error); }
});

router.patch('/:guildId/enabled', async (req, res) => {
  try {
    const id = guildId(req);
    guildManager.setModuleEnabled(id, 'birthdays', req.body?.enabled === true, { actorId: actor(req), action: 'birthdays_dashboard_toggle' });
    return ok(res, await overview(req, id));
  } catch (error) { return fail(res, error); }
});

router.patch('/:guildId/settings', async (req, res) => {
  try {
    const id = guildId(req);
    const patch = req.body?.settings || req.body || {};
    if (patch.announcementTime !== undefined && !birthdays.validTime(patch.announcementTime)) throw new Error('Announcement time must use HH:MM in 24-hour format.');
    if (patch.monthlyBoardTime !== undefined && !birthdays.validTime(patch.monthlyBoardTime)) throw new Error('Monthly board time must use HH:MM in 24-hour format.');
    if (patch.timezone !== undefined && !birthdays.validTimezone(patch.timezone)) throw new Error('Timezone must be a valid IANA timezone such as Europe/London.');
    if (patch.leapDayMode !== undefined && !['feb28', 'mar1'].includes(patch.leapDayMode)) throw new Error('Leap day mode must be feb28 or mar1.');
    if (patch.birthdayRoleId) {
      const target = await guild(req, id);
      if (!target) throw new Error('Guild is unavailable.');
      const validation = await validateRoleSelection(target, [patch.birthdayRoleId], { scope: 'birthdays.role', requireManageable: true });
      if (!validation.ok) throw validation.toError();
    }
    birthdays.updateSettings(id, patch, { actorId: actor(req), action: 'birthdays_dashboard_settings' });
    return ok(res, await overview(req, id));
  } catch (error) { return fail(res, error); }
});

router.post('/:guildId/process', async (req, res) => {
  try {
    const id = guildId(req);
    const target = await guild(req, id);
    if (!target) throw new Error('Guild is unavailable.');
    const result = await birthdays.processGuild(target, { actorId: actor(req), action: 'birthdays_dashboard_process' });
    return ok(res, { result, ...(await overview(req, id)) });
  } catch (error) { return fail(res, error); }
});

router.put('/:guildId/members/:userId', async (req, res) => {
  try {
    const id = guildId(req); const uid = userId(req);
    const input = req.body?.birthday || req.body || {};
    const saved = birthdays.setBirthday(id, uid, input, { actorId: actor(req), action: 'birthdays_dashboard_set_member' });
    return ok(res, { saved, ...(await overview(req, id)) });
  } catch (error) { return fail(res, error); }
});

router.delete('/:guildId/members/:userId', async (req, res) => {
  try {
    const id = guildId(req); const uid = userId(req);
    const removed = birthdays.removeBirthday(id, uid, { actorId: actor(req), action: 'birthdays_dashboard_remove_member' });
    if (!removed) return fail(res, new Error('Birthday record not found.'), 404);
    return ok(res, { removed, ...(await overview(req, id)) });
  } catch (error) { return fail(res, error); }
});

router.post('/:guildId/import', async (req, res) => {
  try {
    const id = guildId(req);
    const result = birthdays.importData(id, req.body?.data || req.body, { actorId: actor(req), action: 'birthdays_dashboard_import' });
    return ok(res, { result, ...(await overview(req, id)) });
  } catch (error) { return fail(res, error); }
});

router.post('/:guildId/reset', async (req, res) => {
  try {
    const id = guildId(req);
    birthdays.reset(id, { actorId: actor(req), action: 'birthdays_dashboard_reset' });
    return ok(res, await overview(req, id));
  } catch (error) { return fail(res, error); }
});

router.get('/:guildId/export', (req, res) => {
  try {
    const id = guildId(req);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="goliath-birthdays-${id}.json"`);
    return res.send(JSON.stringify(birthdays.exportData(id), null, 2));
  } catch (error) { return fail(res, error); }
});

module.exports = router;
