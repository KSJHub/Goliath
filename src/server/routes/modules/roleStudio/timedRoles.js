'use strict';

const express = require('express');
const { PermissionFlagsBits } = require('discord.js');
const guildManager = require('../../../../core/guild/guildManager');
const security = require('../../../../core/security/protection/core');
const timedRoles = require('../../../../modules/roleStudio/timedRoles/timedRolesService');
const timedRolesHealth = require('../../../../modules/roleStudio/timedRoles/timedRolesHealth');
const { validateRoleSelection, isGoliathPermissionError } = require('../../../../core/security/protection/permissions');

const router = express.Router();
const ok = (res, payload = {}) => res.json({ success: true, ...payload });

function fail(res, error, status = 400) {
  if (isGoliathPermissionError(error)) {
    return res.status(403).json({ success: false, code: error.code, error: error.message, ...(error.details || {}) });
  }
  return res.status(status).json({ success: false, error: error.message || 'Timed Roles request failed.' });
}

function guildId(req) {
  const id = String(req.params.guildId || '').trim();
  if (!/^\d{15,25}$/.test(id)) throw new Error('Invalid guild ID.');
  return id;
}
function cleanDiscordId(value) {
  const id = String(value || '').replace(/[<@#!&>]/g, '').trim();
  return /^\d{15,25}$/.test(id) ? id : null;
}
const actor = (req) => cleanDiscordId(req.timedRolesActorId || req.session?.user?.id);
const client = (req) => req.client || req.app?.get?.('goliath.client') || null;

async function guild(req, id) {
  const discord = client(req);
  return discord?.guilds?.cache?.get(id) || await discord?.guilds?.fetch?.(id).catch(() => null);
}

async function requireTimedRolesAccess(req, res, next) {
  try {
    const userId = cleanDiscordId(req.session?.user?.id);
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required.' });
    const id = guildId(req);
    req.timedRolesActorId = userId;
    if (security.isBotOwner(userId)) return next();
    const target = await guild(req, id);
    if (!target) return res.status(403).json({ success: false, error: 'Guild is unavailable or not accessible.' });
    const member = target.members.cache.get(userId) || await target.members.fetch(userId).catch(() => null);
    const allowed = Boolean(
      member?.permissions?.has(PermissionFlagsBits.Administrator)
      || member?.permissions?.has(PermissionFlagsBits.ManageGuild)
    );
    if (!allowed) return res.status(403).json({ success: false, error: 'Manage Server permission is required.' });
    return next();
  } catch (error) {
    return fail(res, error, 403);
  }
}

router.use('/:guildId', requireTimedRolesAccess);

async function validateRuleRoles(target, input = {}) {
  const roleIds = [input.roleId, ...(Array.isArray(input.removeRoleIds) ? input.removeRoleIds : [])].filter(Boolean);
  if (!roleIds.length) throw new Error('A target role is required.');
  const validation = await validateRoleSelection(target, roleIds, { scope: 'timed_roles.rules', requireManageable: true });
  if (!validation.ok) throw validation.toError();
}

async function overview(req, id) {
  const enabled = guildManager.isModuleEnabled(id, timedRoles.SECTION);
  const config = { ...timedRoles.getSection(id), enabled };
  const target = await guild(req, id);
  return {
    guildId: id,
    config,
    overview: {
      enabled,
      ruleCount: timedRoles.listRules(id).length,
      analytics: config.analytics,
      health: target ? await timedRolesHealth.buildTimedRolesHealth(target) : null,
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
    timedRoles.setEnabled(id, req.body?.enabled === true, { actorId: actor(req), action: 'timed_roles_dashboard_toggle' });
    return ok(res, await overview(req, id));
  } catch (error) { return fail(res, error); }
});
router.patch('/:guildId/settings', async (req, res) => {
  try {
    const id = guildId(req);
    timedRoles.updateSettings(id, req.body?.settings || req.body || {}, { actorId: actor(req), action: 'timed_roles_dashboard_settings' });
    return ok(res, await overview(req, id));
  } catch (error) { return fail(res, error); }
});
router.post('/:guildId/rules', async (req, res) => {
  try {
    const id = guildId(req);
    const target = await guild(req, id);
    if (!target) throw new Error('Guild is unavailable.');
    await validateRuleRoles(target, req.body || {});
    const rule = timedRoles.saveRule(id, { ...(req.body || {}), createdBy: actor(req) }, { actorId: actor(req), action: 'timed_roles_dashboard_create_rule' });
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
    const rule = timedRoles.saveRule(id, next, { actorId: actor(req), action: 'timed_roles_dashboard_update_rule' });
    return ok(res, { rule, ...(await overview(req, id)) });
  } catch (error) { return fail(res, error); }
});
router.delete('/:guildId/rules/:ruleId', async (req, res) => {
  try {
    const id = guildId(req);
    if (!timedRoles.getRule(id, req.params.ruleId)) return fail(res, new Error('Timed role rule not found.'), 404);
    timedRoles.removeRule(id, req.params.ruleId, { actorId: actor(req), action: 'timed_roles_dashboard_delete_rule' });
    return ok(res, await overview(req, id));
  } catch (error) { return fail(res, error); }
});
router.post('/:guildId/scan', async (req, res) => {
  try {
    const id = guildId(req);
    const target = await guild(req, id);
    if (!target) throw new Error('Guild is unavailable.');
    return ok(res, { result: await timedRoles.scanGuild(target, { actorId: actor(req), action: 'timed_roles_dashboard_scan' }), ...(await overview(req, id)) });
  } catch (error) { return fail(res, error); }
});
router.post('/:guildId/repair', async (req, res) => {
  try {
    const id = guildId(req);
    const target = await guild(req, id);
    if (!target) throw new Error('Guild is unavailable.');
    const repair = await timedRolesHealth.repairTimedRoles(target, { actorId: actor(req), action: 'timed_roles_dashboard_repair' });
    return ok(res, { repair, ...(await overview(req, id)) });
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
