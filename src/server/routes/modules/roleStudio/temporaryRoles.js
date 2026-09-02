'use strict';

const express = require('express');
const { PermissionFlagsBits } = require('discord.js');
const guildManager = require('../../../../core/guild/guildManager');
const security = require('../../../../core/security/protection/core');
const temporaryRoles = require('../../../../modules/roleStudio/temporaryRoles/temporaryRolesService');
const temporaryRolesHealth = require('../../../../modules/roleStudio/temporaryRoles/temporaryRolesHealth');
const { validateRoleSelection, isGoliathPermissionError } = require('../../../../core/security/protection/permissions');

const router = express.Router();
const ok = (res, payload = {}) => res.json({ success: true, ...payload });

function fail(res, error, status = 400) {
  if (isGoliathPermissionError(error)) {
    return res.status(403).json({ success: false, code: error.code, error: error.message, ...(error.details || {}) });
  }
  return res.status(status).json({ success: false, error: error.message || 'Temporary Roles request failed.' });
}

function getGuildId(req) {
  const id = String(req.params.guildId || '').trim();
  if (!/^\d{15,25}$/.test(id)) throw new Error('Invalid guild ID.');
  return id;
}
const guildId = getGuildId;
function cleanDiscordId(value) {
  const id = String(value || '').replace(/[<@#!&>]/g, '').trim();
  return /^\d{15,25}$/.test(id) ? id : null;
}
const actor = (req) => cleanDiscordId(req.temporaryRolesActorId || req.session?.user?.id);
const client = (req) => req.client || req.app?.get?.('goliath.client') || null;

async function guild(req, id) {
  const discord = client(req);
  return discord?.guilds?.cache?.get(id) || await discord?.guilds?.fetch?.(id).catch(() => null);
}

async function requireTemporaryRolesAccess(req, res, next) {
  try {
    const userId = cleanDiscordId(req.session?.user?.id);
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required.' });
    const id = guildId(req);
    req.temporaryRolesActorId = userId;
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

router.use('/:guildId', requireTemporaryRolesAccess);

function serializeMember(member) {
  if (!member?.id) return null;
  return {
    id: member.id,
    username: member.user?.username || member.displayName || member.id,
    displayName: member.displayName || member.user?.globalName || member.user?.username || member.id,
    avatarUrl: member.displayAvatarURL?.({ extension: 'png', size: 64 }) || null,
    bot: member.user?.bot === true,
  };
}

async function memberList(target) {
  await target.members.fetch().catch(() => null);
  return [...target.members.cache.values()]
    .filter((member) => member.id !== target.members.me?.id)
    .map(serializeMember)
    .filter(Boolean)
    .sort((a, b) => String(a.displayName).localeCompare(String(b.displayName)));
}

async function overview(req, id) {
  const enabled = guildManager.isModuleEnabled(id, temporaryRoles.SECTION);
  const config = { ...temporaryRoles.getSection(id), enabled };
  const assignments = temporaryRoles.listAssignments(id);
  const activeAssignments = assignments.filter((item) => item.status === 'active');
  const expiringSoon = activeAssignments.filter((item) => {
    const expiry = new Date(item.expiresAt).getTime();
    return Number.isFinite(expiry) && expiry > Date.now() && expiry <= Date.now() + 86_400_000;
  });
  const target = await guild(req, id);
  return {
    guildId: id,
    config,
    assignments,
    members: target ? await memberList(target) : [],
    overview: {
      enabled,
      assignmentCount: assignments.length,
      activeCount: activeAssignments.length,
      expiringSoonCount: expiringSoon.length,
      failedCount: assignments.filter((item) => item.status === 'failed').length,
      analytics: config.analytics,
      health: target ? await temporaryRolesHealth.buildHealth(target) : null,
    },
  };
}

router.get('/:guildId/overview', async (req, res) => {
  try { return ok(res, await overview(req, getGuildId(req))); }
  catch (error) { return fail(res, error); }
});

router.patch('/:guildId/enabled', async (req, res) => {
  try {
    const id = getGuildId(req);
    temporaryRoles.setEnabled(id, req.body?.enabled === true, { actorId: actor(req), action: 'temporary_roles_dashboard_toggle' });
    return ok(res, await overview(req, id));
  } catch (error) { return fail(res, error); }
});

router.patch('/:guildId/settings', async (req, res) => {
  try {
    const id = getGuildId(req);
    const current = temporaryRoles.getSection(id);
    const patch = req.body?.settings || req.body || {};
    const settings = {
      ...current.settings,
      ...(Object.prototype.hasOwnProperty.call(patch, 'removeExpiredOnStartup') ? { removeExpiredOnStartup: patch.removeExpiredOnStartup === true } : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, 'auditLog') ? { auditLog: patch.auditLog === true } : {}),
    };
    temporaryRoles.saveSection(id, { ...current, settings, updatedAt: new Date().toISOString() }, { actorId: actor(req), action: 'temporary_roles_dashboard_settings' });
    return ok(res, await overview(req, id));
  } catch (error) { return fail(res, error); }
});

router.post('/:guildId/assignments', async (req, res) => {
  try {
    const id = getGuildId(req);
    const target = await guild(req, id);
    if (!target) throw new Error('Guild is unavailable.');
    const roleId = cleanDiscordId(req.body?.roleId);
    const memberId = cleanDiscordId(req.body?.memberId);
    if (!roleId || !memberId) throw new Error('Select a valid member and role.');
    const validation = await validateRoleSelection(target, [roleId], { scope: 'temporary_roles.assign', requireManageable: true });
    if (!validation.ok) throw validation.toError();
    const assignment = await temporaryRoles.assignTemporaryRole({
      guild: target,
      memberId,
      roleId,
      value: req.body?.value,
      unit: req.body?.unit,
      reason: req.body?.reason,
      assignedBy: actor(req),
    });
    return ok(res, { assignment, ...(await overview(req, id)) });
  } catch (error) { return fail(res, error); }
});

router.post('/:guildId/assignments/:assignmentId/renew', async (req, res) => {
  try {
    const id = getGuildId(req);
    const current = temporaryRoles.getSection(id).assignments[req.params.assignmentId];
    if (!current) return fail(res, new Error('Temporary role assignment not found.'), 404);
    if (current.status !== 'active') return fail(res, new Error('Only active assignments can be renewed.'));
    const target = await guild(req, id);
    if (!target) throw new Error('Guild is unavailable.');
    const validation = await validateRoleSelection(target, [current.roleId], { scope: 'temporary_roles.renew', requireManageable: true });
    if (!validation.ok) throw validation.toError();
    const assignment = await temporaryRoles.assignTemporaryRole({
      guild: target,
      memberId: current.memberId,
      roleId: current.roleId,
      value: req.body?.value,
      unit: req.body?.unit,
      reason: req.body?.reason || current.reason,
      assignedBy: actor(req),
    });
    return ok(res, { assignment, ...(await overview(req, id)) });
  } catch (error) { return fail(res, error); }
});

router.delete('/:guildId/assignments/:assignmentId', async (req, res) => {
  try {
    const id = getGuildId(req);
    const target = await guild(req, id);
    if (!target) throw new Error('Guild is unavailable.');
    const current = temporaryRoles.getSection(id).assignments[req.params.assignmentId];
    if (!current) return fail(res, new Error('Temporary role assignment not found.'), 404);
    if (current.status !== 'active') return fail(res, new Error('Only active assignments can be removed.'));
    const assignment = await temporaryRoles.removeAssignment(target, req.params.assignmentId, { actorId: actor(req), expired: false, source: 'dashboard' });
    return ok(res, { assignment, ...(await overview(req, id)) });
  } catch (error) { return fail(res, error); }
});

router.post('/:guildId/scan', async (req, res) => {
  try {
    const id = getGuildId(req);
    const target = await guild(req, id);
    if (!target) throw new Error('Guild is unavailable.');
    const result = await temporaryRoles.scanExpired(target, { actorId: actor(req), action: 'temporary_roles_dashboard_scan' });
    return ok(res, { result, ...(await overview(req, id)) });
  } catch (error) { return fail(res, error); }
});

router.post('/:guildId/repair', async (req, res) => {
  try {
    const id = getGuildId(req);
    const target = await guild(req, id);
    if (!target) throw new Error('Guild is unavailable.');
    const repair = await temporaryRolesHealth.repair(target, { actorId: actor(req), action: 'temporary_roles_dashboard_repair' });
    return ok(res, { repair, ...(await overview(req, id)) });
  } catch (error) { return fail(res, error); }
});

router.get('/:guildId/export', (req, res) => {
  try {
    const id = getGuildId(req);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="goliath-temporary-roles-${id}.json"`);
    return res.send(JSON.stringify(temporaryRoles.exportConfiguration(id), null, 2));
  } catch (error) { return fail(res, error); }
});

module.exports = router;
