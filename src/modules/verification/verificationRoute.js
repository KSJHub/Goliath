'use strict';

const express = require('express');
const guildManager = require('../../core/guild/guildManager');
const verification = require('./verification');

const router = express.Router();

function success(res, payload = {}) {
  return res.json({ success: true, ...payload });
}

function failure(res, error, status = 500) {
  console.error('[Verification API]', error);
  return res.status(status).json({ success: false, error: error.message || 'Verification API request failed.' });
}

function cleanDiscordId(value) {
  const id = String(value || '').replace(/[<@#!&>]/g, '').trim();
  return /^\d{15,25}$/.test(id) ? id : null;
}

function getGuildId(req) {
  const guildId = cleanDiscordId(req.params.guildId || req.query?.guildId);
  if (!guildId) throw new Error('Invalid guild ID.');
  return guildId;
}

function getActorId(req) {
  return cleanDiscordId(req.session?.user?.id || req.body?.actorId || req.query?.actorId);
}

function getClient(req) {
  return req.client || req.app?.get?.('goliath.client') || req.app?.locals?.client || global.client || null;
}

async function getGuild(req, guildId) {
  const client = getClient(req);
  if (!client?.guilds) return null;
  return client.guilds.cache.get(guildId) || client.guilds.fetch(guildId).catch(() => null);
}

async function getSendableChannel(req, guildId, channelId) {
  const guild = await getGuild(req, guildId);
  if (!guild) throw new Error('Guild is unavailable.');
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.send) throw new Error('Channel is unavailable or not sendable.');
  return channel;
}

function getAdminConfig(guildId) {
  const modules = guildManager.getGuildSection(guildId, 'modules', {});
  const admin = modules?.verification && typeof modules.verification === 'object' ? modules.verification : {};
  const section = verification.getVerificationSection(guildId);
  return {
    enabled: typeof admin.enabled === 'boolean' ? admin.enabled : section.enabled,
    ...verification.normalizeSettings({ ...(section.settings || {}), ...admin, ...(admin.settings || {}) }),
  };
}

function saveAdminConfig(guildId, input = {}, meta = {}) {
  const current = getAdminConfig(guildId);
  const enabled = input.enabled === undefined ? current.enabled === true : input.enabled === true;
  const settings = verification.normalizeSettings({ ...current, ...(input.settings || input) });

  guildManager.updateGuildSection(guildId, 'modules', (modules = {}) => ({
    ...(modules && typeof modules === 'object' ? modules : {}),
    verification: {
      enabled,
      ...settings,
      updatedAt: new Date().toISOString(),
    },
  }), {}, meta);

  verification.configureVerification(guildId, { enabled, settings }, meta);
  return getAdminConfig(guildId);
}

function buildExport(guildId) {
  return {
    exportedAt: new Date().toISOString(),
    guildId,
    config: getAdminConfig(guildId),
    module: verification.getVerificationSection(guildId),
  };
}

function resetVerification(guildId, meta = {}) {
  guildManager.updateGuildSection(guildId, 'modules', (modules = {}) => {
    const next = { ...(modules && typeof modules === 'object' ? modules : {}) };
    delete next.verification;
    return next;
  }, {}, meta);
  return verification.saveVerificationSection(guildId, verification.defaultVerificationSection(), meta);
}

router.get('/:guildId/overview', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    const guild = await getGuild(req, guildId);
    const section = verification.getVerificationSection(guildId);
    const status = verification.getVerificationStatus(guildId);
    const health = guild ? await verification.buildHealthReport(guild) : null;

    return success(res, {
      guildId,
      updatedAt: new Date().toISOString(),
      config: getAdminConfig(guildId),
      messages: section.messages,
      panelTemplate: section.panelTemplate,
      panels: Object.values(status.panels || {}),
      analytics: status.analytics || {},
      health,
    });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.get('/:guildId/export', (req, res) => {
  try {
    const guildId = getGuildId(req);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="goliath-verification-${guildId}.json"`);
    return res.send(JSON.stringify(buildExport(guildId), null, 2));
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.post('/:guildId/config', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const config = saveAdminConfig(guildId, req.body || {}, {
      action: 'verification_api_config',
      actorId: getActorId(req),
    });
    return success(res, { guildId, config });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.post('/:guildId/messages', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const messages = verification.updateVerificationMessages(guildId, req.body || {}, {
      action: 'verification_api_messages',
      actorId: getActorId(req),
    });
    return success(res, { guildId, messages });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.post('/:guildId/template', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const template = verification.updatePanelTemplate(guildId, req.body || {}, {
      action: 'verification_api_template',
      actorId: getActorId(req),
    });
    return success(res, { guildId, template });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.post('/:guildId/deploy', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    const config = getAdminConfig(guildId);
    const channelId = cleanDiscordId(req.body?.channelId || config.verificationChannelId);
    if (!channelId) throw new Error('Verification channel is required.');
    const channel = await getSendableChannel(req, guildId, channelId);
    const panelId = req.body?.redeploy === true
      ? verification.getLatestPanel(guildId)?.panelId
      : String(req.body?.panelId || '').trim() || undefined;
    const panel = await verification.deployVerificationPanel(channel, {
      ...verification.getVerificationSection(guildId).panelTemplate,
      ...(req.body?.template || {}),
      panelId,
      createdBy: getActorId(req),
    }, { action: 'verification_api_deploy', actorId: getActorId(req) });
    return success(res, { guildId, panel });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.post('/:guildId/panels/:panelId/redeploy', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    const guild = await getGuild(req, guildId);
    if (!guild) throw new Error('Guild is unavailable.');
    const panel = await verification.refreshVerificationPanel(guild, req.params.panelId, req.body || {}, {
      action: 'verification_api_redeploy',
      actorId: getActorId(req),
    });
    return success(res, { guildId, panel });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.delete('/:guildId/panels/:panelId', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    const guild = await getGuild(req, guildId);
    if (!guild) throw new Error('Guild is unavailable.');
    const section = await verification.deleteVerificationPanel(guild, req.params.panelId, {
      action: 'verification_api_delete_panel',
      actorId: getActorId(req),
    });
    return success(res, { guildId, section });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.post('/:guildId/reset', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const section = resetVerification(guildId, {
      action: 'verification_api_reset',
      actorId: getActorId(req),
    });
    return success(res, { guildId, section });
  } catch (error) {
    return failure(res, error, 400);
  }
});

module.exports = router;
