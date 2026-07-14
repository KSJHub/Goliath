'use strict';

const express = require('express');
const autoroles = require('./autoroles');
const { validateRoleSelection, isGoliathPermissionError } = require('../../core/security/goliathPermissionGuard');

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

function getActorId(req) {
  return String(req.session?.user?.id || req.body?.actorId || '').trim() || null;
}

function getClient(req) {
  return req.client || req.app?.get?.('goliath.client') || req.app?.locals?.client || null;
}

async function getGuild(req, guildId) {
  const client = getClient(req);
  if (!client?.guilds) return null;
  return client.guilds.cache.get(guildId) || client.guilds.fetch(guildId).catch(() => null);
}

async function validateRoles(guild, roleIds, scope) {
  const ids = autoroles.cleanRoleIds(roleIds || []);
  if (!ids.length) return;
  const result = await validateRoleSelection(guild, ids, { scope, requireManageable: true });
  if (!result.ok) throw result.toError();
}

async function buildOverview(req, guildId) {
  const config = autoroles.getAutoRolesSection(guildId);
  const guild = await getGuild(req, guildId);
  const health = guild ? await autoroles.buildHealthReport(guild) : null;
  return {
    guildId,
    config,
    overview: {
      enabled: config.enabled !== false,
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
  try {
    return success(res, await buildOverview(req, getGuildId(req)));
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.put('/:guildId/config', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    const guild = await getGuild(req, guildId);
    if (!guild) throw new Error('Guild is unavailable.');
    await validateRoles(guild, [...(req.body?.joinRoles || []), ...(req.body?.botRoles || [])], 'auto_roles.config');
    const config = autoroles.configureAutoRoles(guildId, req.body || {}, { actorId: getActorId(req) });
    return success(res, { config, ...(await buildOverview(req, guildId)) });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.patch('/:guildId/enabled', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    autoroles.setAutoRolesEnabled(guildId, req.body?.enabled === true, { actorId: getActorId(req) });
    return success(res, await buildOverview(req, guildId));
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.patch('/:guildId/settings', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    autoroles.updateSettings(guildId, req.body?.settings || req.body || {}, { actorId: getActorId(req) });
    return success(res, await buildOverview(req, guildId));
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.put('/:guildId/roles/join', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    const guild = await getGuild(req, guildId);
    if (!guild) throw new Error('Guild is unavailable.');
    await validateRoles(guild, req.body?.roleIds || [], 'auto_roles.join_roles');
    autoroles.setJoinRoles(guildId, req.body?.roleIds || [], { actorId: getActorId(req) });
    return success(res, await buildOverview(req, guildId));
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.put('/:guildId/roles/bots', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    const guild = await getGuild(req, guildId);
    if (!guild) throw new Error('Guild is unavailable.');
    await validateRoles(guild, req.body?.roleIds || [], 'auto_roles.bot_roles');
    autoroles.setBotRoles(guildId, req.body?.roleIds || [], { actorId: getActorId(req) });
    return success(res, await buildOverview(req, guildId));
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.post('/:guildId/repair', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    const guild = await getGuild(req, guildId);
    if (!guild) throw new Error('Guild is unavailable.');
    const config = await autoroles.repairConfiguration(guild, { actorId: getActorId(req) });
    return success(res, { config, ...(await buildOverview(req, guildId)) });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.post('/:guildId/reapply', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    const guild = await getGuild(req, guildId);
    if (!guild) throw new Error('Guild is unavailable.');
    const result = await autoroles.reapplyToGuild(guild, { reason: `Dashboard reapply by ${getActorId(req) || 'unknown user'}` });
    return success(res, { result, ...(await buildOverview(req, guildId)) });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.post('/:guildId/reset', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    autoroles.resetAutoRoles(guildId, { actorId: getActorId(req) });
    return success(res, await buildOverview(req, guildId));
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.get('/:guildId/export', (req, res) => {
  try {
    const guildId = getGuildId(req);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="goliath-auto-roles-${guildId}.json"`);
    return res.send(JSON.stringify(autoroles.exportConfiguration(guildId), null, 2));
  } catch (error) {
    return failure(res, error, 400);
  }
});

module.exports = router;
