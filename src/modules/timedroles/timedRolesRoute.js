'use strict';

const express = require('express');
const timedRoles = require('./timedRoles');
const { validateRoleSelection, isGoliathPermissionError } = require('../../core/security/goliathPermissionGuard');

const router = express.Router();
const ok = (res, payload = {}) => res.json({ success: true, ...payload });
function fail(res, error, status = 400) {
  if (isGoliathPermissionError(error)) {
    return res.status(403).json({ success: false, code: error.code, error: error.message, ...(error.details || {}) });
  }
  return res.status(status).json({ success: false, error: error.message || 'Timed Roles request failed.' });
}
const guildId = (req) => {
  const id = String(req.params.guildId || '').trim();
  if (!/^\d{15,25}$/.test(id)) throw new Error('Invalid guild ID.');
  return id;
};
const actor = (req) => String(req.session?.user?.id || req.body?.actorId || '').trim() || null;
const client = (req) => req.client || req.app?.get?.('goliath.client') || null;
async function guild(req, id) {
  const discord = client(req);
  return discord?.guilds?.cache?.get(id) || await discord?.guilds?.fetch?.(id).catch(() => null);
}
async function validateRuleRoles(target, input = {}) {
  const roleIds = [input.roleId, ...(Array.isArray(input.removeRoleIds) ? input.removeRoleIds : [])].filter(Boolean);
  if (!roleIds.length) throw new Error('A target role is required.');
  const validation = await validateRoleSelection(target, roleIds, { scope: 'timed_roles.rules', requireManageable: true });
  if (!validation.ok) throw validation.toError();
}
async function overview(req, id) {
  const config = timedRoles.getSection(id);
  const target = await guild(req, id);
  return {
    guildId: id,
    config,
    overview: {
      enabled: config.enabled !== false,
      ruleCount: timedRoles.listRules(id).length,
      analytics: config.analytics,
      health: target ? await timedRoles.buildHealth(target) : null,
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
    timedRoles.setEnabled(id, req.body?.enabled === true, { actorId: actor(req) });
    return ok(res, await overview(req, id));
  } catch (error) { return fail(res, error); }
});
router.patch('/:guildId/settings', async (req, res) => {
  try {
    const id = guildId(req);
    timedRoles.updateSettings(id, req.body?.settings || req.body || {}, { actorId: actor(req) });
    return ok(res, await overview(req, id));
  } catch (error) { return fail(res, error); }
});
router.post('/:guildId/rules', async (req, res) => {
  try {
    const id = guildId(req);
    const target = await guild(req, id);
    if (!target) throw new Error('Guild is unavailable.');
    await validateRuleRoles(target, req.body || {});
    const rule = timedRoles.saveRule(id, { ...(req.body || {}), createdBy: actor(req) }, { actorId: actor(req) });
    return ok(res, { rule, ...(await overview(req, id)) });
  } catch (error) { return fail(res, error); }
});
router.put('/:guildId/rules/:ruleId', async (req, res) => {
  try {
    const id = guildId(req);
    const current = timedRoles.getRule(id, req.params.ruleId);
    if (!current) return fail(res, new Error('Timed role rule not found.'), 404);
    const target = await guild(req, id);
    if (!target) throw new Error('Guild is unavailable.');
    const next = { ...current, ...(req.body || {}), ruleId: current.ruleId };
    await validateRuleRoles(target, next);
    const rule = timedRoles.saveRule(id, next, { actorId: actor(req) });
    return ok(res, { rule, ...(await overview(req, id)) });
  } catch (error) { return fail(res, error); }
});
router.delete('/:guildId/rules/:ruleId', async (req, res) => {
  try {
    const id = guildId(req);
    if (!timedRoles.getRule(id, req.params.ruleId)) return fail(res, new Error('Timed role rule not found.'), 404);
    timedRoles.removeRule(id, req.params.ruleId, { actorId: actor(req) });
    return ok(res, await overview(req, id));
  } catch (error) { return fail(res, error); }
});
router.post('/:guildId/scan', async (req, res) => {
  try {
    const id = guildId(req);
    const target = await guild(req, id);
    if (!target) throw new Error('Guild is unavailable.');
    return ok(res, { result: await timedRoles.scanGuild(target, { actorId: actor(req) }), ...(await overview(req, id)) });
  } catch (error) { return fail(res, error); }
});
router.post('/:guildId/repair', async (req, res) => {
  try {
    const id = guildId(req);
    const target = await guild(req, id);
    if (!target) throw new Error('Guild is unavailable.');
    await timedRoles.repair(target, { actorId: actor(req) });
    return ok(res, await overview(req, id));
  } catch (error) { return fail(res, error); }
});
router.get('/:guildId/export', (req, res) => {
  try {
    const id = guildId(req);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="goliath-timed-roles-${id}.json"`);
    return res.send(JSON.stringify(timedRoles.exportConfiguration(id), null, 2));
  } catch (error) { return fail(res, error); }
});

module.exports = router;
