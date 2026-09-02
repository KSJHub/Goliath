'use strict';

const express = require('express');
const { PermissionFlagsBits } = require('discord.js');
const security = require('../../../../core/security/protection/core');
const autoroles = require('../../../../modules/roleStudio/autoRoles/autoRolesService');
const { validateRoleSelection, isGoliathPermissionError } = require('../../../../core/security/protection/permissions');

const router = express.Router();

function success(res, payload = {}) {
  return res.json({ success: true, ...payload });
}

function failure(res, error, status = 500) {
  console.error('[Auto Roles API]', error);
  if (isGoliathPermissionError(error)) {
    return res.status(403).json({ success: false, code: error.code, error: error.message, ...(error.details || {}) });
  }
  return res.status(status).json({ success: false, error: error.message || 'Auto Roles API request failed.' });
}

function getGuildId(req) {
  const guildId = String(req.params.guildId || '').trim();
  if (!/^\d{15,25}$/.test(guildId)) throw new Error('Invalid guild ID.');
  return guildId;
}

function cleanDiscordId(value) {
  const id = String(value || '').replace(/[<@#!&>]/g, '').trim();
  return /^\d{15,25}$/.test(id) ? id : null;
}

function getActorId(req) {
  return cleanDiscordId(req.autoRolesActorId || req.session?.user?.id);
}

function getClient(req) {
  return req.client || req.app?.get?.('goliath.client') || req.app?.locals?.client || null;
}

async function getGuild(req, guildId) {
  const client = getClient(req);
  if (!client?.guilds) return null;
  return client.guilds.cache.get(guildId) || client.guilds.fetch(guildId).catch(() => null);
}

async function requireAutoRolesAccess(req, res, next) {
  try {
    const userId = cleanDiscordId(req.session?.user?.id);
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required.' });
    const guildId = getGuildId(req);
    req.autoRolesActorId = userId;
    if (security.isBotOwner(userId)) return next();
    const guild = await getGuild(req, guildId);
    if (!guild) return res.status(403).json({ success: false, error: 'Guild is unavailable or not accessible.' });
    const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
    const allowed = Boolean(
      member?.permissions?.has(PermissionFlagsBits.Administrator)
      || member?.permissions?.has(PermissionFlagsBits.ManageGuild)
    );
    if (!allowed) return res.status(403).json({ success: false, error: 'Manage Server permission is required.' });
    return next();
  } catch (error) {
    return failure(res, error, 403);
  }
}

router.use('/:guildId', requireAutoRolesAccess);

function canonicalConfig(guildId, config = autoroles.getAutoRolesSection(guildId)) {
  return {
    ...config,
    enabled: autoroles.isAutoRolesEnabled(guildId),
  };
}

async function validateRoles(guild, roleIds, scope) {
  const ids = autoroles.cleanRoleIds(roleIds || []);
  if (!ids.length) return;
  const result = await validateRoleSelection(guild, ids, { scope, requireManageable: true });
  if (!result.ok) throw result.toError();
}

async function buildOverview(req, guildId) {
  const config = canonicalConfig(guildId);
  const guild = await getGuild(req, guildId);
  const health = guild ? await autoroles.buildHealthReport(guild) : null;
  return {
    guildId,
    config,
    overview: {
      enabled: config.enabled,
      joinRoleCount: config.joinRoles.length,
      botRoleCount: config.botRoles.length,
      applyToBots: config.settings.applyToBots === true,
      reapplyOnStartup: config.settings.reapplyOnStartup === true,
      analytics: config.analytics || {},
      health,
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
    const guild = await getGuild(req, guildId);
    if (!guild) throw new Error('Guild is unavailable.');
    const joinRoles = autoroles.cleanRoleIds(req.body?.joinRoles || []);
    const botRoles = autoroles.cleanRoleIds(req.body?.botRoles || []);
    await validateRoles(guild, [...joinRoles, ...botRoles], 'auto_roles.config');
    await autoroles.withAutoRolesLock(guildId, () => autoroles.configureAutoRoles(guildId, {
      ...(req.body || {}),
      joinRoles,
      botRoles,
    }, { actorId: getActorId(req), action: 'auto_roles_dashboard_config' }));
    return success(res, await buildOverview(req, guildId));
  } catch (error) { return failure(res, error, 400); }
});

router.patch('/:guildId/enabled', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    await autoroles.withAutoRolesLock(guildId, () => autoroles.setAutoRolesEnabled(guildId, req.body?.enabled === true, { actorId: getActorId(req), action: 'auto_roles_dashboard_toggle' }));
    return success(res, await buildOverview(req, guildId));
  } catch (error) { return failure(res, error, 400); }
});

router.patch('/:guildId/settings', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    await autoroles.withAutoRolesLock(guildId, () => autoroles.updateSettings(guildId, req.body?.settings || req.body || {}, { actorId: getActorId(req), action: 'auto_roles_dashboard_settings' }));
    return success(res, await buildOverview(req, guildId));
  } catch (error) { return failure(res, error, 400); }
});

router.put('/:guildId/roles/join', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    const guild = await getGuild(req, guildId);
    if (!guild) throw new Error('Guild is unavailable.');
    const ids = autoroles.cleanRoleIds(req.body?.roleIds || []);
    await validateRoles(guild, ids, 'auto_roles.join_roles');
    await autoroles.setConfiguredRoles(guild, 'join', ids, { actorId: getActorId(req), action: 'auto_roles_dashboard_join_roles' });
    return success(res, await buildOverview(req, guildId));
  } catch (error) { return failure(res, error, 400); }
});

router.put('/:guildId/roles/bots', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    const guild = await getGuild(req, guildId);
    if (!guild) throw new Error('Guild is unavailable.');
    const ids = autoroles.cleanRoleIds(req.body?.roleIds || []);
    await validateRoles(guild, ids, 'auto_roles.bot_roles');
    await autoroles.setConfiguredRoles(guild, 'bot', ids, { actorId: getActorId(req), action: 'auto_roles_dashboard_bot_roles' });
    return success(res, await buildOverview(req, guildId));
  } catch (error) { return failure(res, error, 400); }
});

router.post('/:guildId/repair', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    const guild = await getGuild(req, guildId);
    if (!guild) throw new Error('Guild is unavailable.');
    await autoroles.repairConfiguration(guild, { actorId: getActorId(req), action: 'auto_roles_dashboard_repair' });
    return success(res, await buildOverview(req, guildId));
  } catch (error) { return failure(res, error, 400); }
});

router.post('/:guildId/reapply', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    const guild = await getGuild(req, guildId);
    if (!guild) throw new Error('Guild is unavailable.');
    const result = await autoroles.reapplyToGuild(guild, { reason: `Dashboard reapply by ${getActorId(req) || 'unknown user'}` });
    return success(res, { result, ...(await buildOverview(req, guildId)) });
  } catch (error) { return failure(res, error, 400); }
});

router.post('/:guildId/reset', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    await autoroles.withAutoRolesLock(guildId, () => autoroles.resetAutoRoles(guildId, { actorId: getActorId(req), action: 'auto_roles_dashboard_reset' }));
    return success(res, await buildOverview(req, guildId));
  } catch (error) { return failure(res, error, 400); }
});

router.get('/:guildId/export', (req, res) => {
  try {
    const guildId = getGuildId(req);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="goliath-auto-roles-${guildId}.json"`);
    return res.send(JSON.stringify(canonicalConfig(guildId, autoroles.exportConfiguration(guildId)), null, 2));
  } catch (error) { return failure(res, error, 400); }
});

module.exports = router;
