'use strict';

const express = require('express');
const reactionRoles = require('./reactionRoles');

const router = express.Router();
const success = (res, payload = {}) => res.json({ success: true, ...payload });
const failure = (res, error, status = 400) => res.status(status).json({ success: false, error: error.message || 'Reaction Roles request failed.' });
const guildIdFrom = (req) => {
  const guildId = String(req.params.guildId || '').trim();
  if (!/^\d{15,25}$/.test(guildId)) throw new Error('Invalid guild ID.');
  return guildId;
};
const clientFrom = (req) => req.client || req.app?.get?.('goliath.client') || req.app?.locals?.client;
const guildFrom = async (req, guildId) => {
  const client = clientFrom(req);
  if (!client?.guilds) throw new Error('Discord client is unavailable.');
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) throw new Error('Guild is unavailable.');
  return guild;
};
const actorId = (req) => String(req.session?.user?.id || req.body?.actorId || '').trim() || null;
const panelFrom = (guildId, panelId) => {
  const panel = reactionRoles.getPanel(guildId, panelId);
  if (!panel) {
    const error = new Error('Reaction-role panel not found.');
    error.status = 404;
    throw error;
  }
  return panel;
};
const respondFailure = (res, error) => failure(res, error, error.status || 400);
const removalActionFrom = (req) => {
  const requested = String(req.body?.action || req.query?.action || '').trim().toLowerCase();
  if (requested) {
    if (!['detach', 'clear', 'delete'].includes(requested)) throw new Error('Removal action must be detach, clear, or delete.');
    return requested;
  }
  return req.query?.clearReactions === 'true' || req.body?.clearReactions === true ? 'clear' : 'detach';
};

router.get('/:guildId/overview', async (req, res) => {
  try {
    const guildId = guildIdFrom(req);
    const guild = await guildFrom(req, guildId);
    return success(res, { config: reactionRoles.getSection(guildId), health: await reactionRoles.buildHealth(guild) });
  } catch (error) { return respondFailure(res, error); }
});

router.patch('/:guildId/enabled', (req, res) => {
  try {
    const guildId = guildIdFrom(req);
    return success(res, { config: reactionRoles.setEnabled(guildId, req.body?.enabled === true, { actorId: actorId(req) }) });
  } catch (error) { return respondFailure(res, error); }
});

router.post('/:guildId/attach', async (req, res) => {
  try {
    const guildId = guildIdFrom(req);
    const guild = await guildFrom(req, guildId);
    const panel = await reactionRoles.attachExistingMessage({
      guild,
      messageReference: req.body?.messageReference || req.body?.messageId,
      channelId: req.body?.channelId,
      name: req.body?.name,
      templateId: req.body?.templateId || null,
      applyTemplate: req.body?.applyTemplate === true,
      mappings: req.body?.mappings || [],
      createdBy: actorId(req),
    });
    return success(res, { panel, config: reactionRoles.getSection(guildId) });
  } catch (error) { return respondFailure(res, error); }
});

router.post('/:guildId/deploy', async (req, res) => {
  try {
    const guildId = guildIdFrom(req);
    const guild = await guildFrom(req, guildId);
    const panel = await reactionRoles.createFromTemplate({
      guild,
      channelId: req.body?.channelId,
      templateId: req.body?.templateId,
      name: req.body?.name,
      mappings: req.body?.mappings || [],
      createdBy: actorId(req),
    });
    return success(res, { panel, config: reactionRoles.getSection(guildId) });
  } catch (error) { return respondFailure(res, error); }
});

router.put('/:guildId/panels/:panelId', async (req, res) => {
  try {
    const guildId = guildIdFrom(req);
    const guild = await guildFrom(req, guildId);
    panelFrom(guildId, req.params.panelId);
    const panel = await reactionRoles.updatePanelMappings(guild, req.params.panelId, req.body?.mappings || [], actorId(req));
    return success(res, { panel, config: reactionRoles.getSection(guildId) });
  } catch (error) { return respondFailure(res, error); }
});

router.patch('/:guildId/panels/:panelId/enabled', async (req, res) => {
  try {
    const guildId = guildIdFrom(req);
    const guild = await guildFrom(req, guildId);
    panelFrom(guildId, req.params.panelId);
    const panel = await reactionRoles.setPanelEnabled(
      guild,
      req.params.panelId,
      req.body?.enabled === true,
      { actorId: actorId(req) }
    );
    return success(res, { panel, config: reactionRoles.getSection(guildId) });
  } catch (error) { return respondFailure(res, error); }
});

router.put('/:guildId/panels/:panelId/template', async (req, res) => {
  try {
    const guildId = guildIdFrom(req);
    const guild = await guildFrom(req, guildId);
    panelFrom(guildId, req.params.panelId);
    const panel = await reactionRoles.applyTemplateToPanel(guild, req.params.panelId, req.body?.templateId);
    return success(res, { panel, config: reactionRoles.getSection(guildId) });
  } catch (error) { return respondFailure(res, error); }
});

router.post('/:guildId/panels/:panelId/redeploy', async (req, res) => {
  try {
    const guildId = guildIdFrom(req);
    const guild = await guildFrom(req, guildId);
    const current = panelFrom(guildId, req.params.panelId);
    if (!current.templateId) throw new Error('This deployment is not linked to an Embed Studio template.');
    await reactionRoles.applyTemplateToPanel(guild, current.panelId, current.templateId);
    const result = await reactionRoles.syncPanelReactions(guild, reactionRoles.getPanel(guildId, current.panelId));
    return success(res, { panel: result.panel, config: reactionRoles.getSection(guildId) });
  } catch (error) { return respondFailure(res, error); }
});

router.post('/:guildId/panels/:panelId/repair', async (req, res) => {
  try {
    const guildId = guildIdFrom(req);
    const guild = await guildFrom(req, guildId);
    const panel = panelFrom(guildId, req.params.panelId);
    const result = await reactionRoles.syncPanelReactions(guild, panel);
    return success(res, { panel: result.panel, config: reactionRoles.getSection(guildId) });
  } catch (error) { return respondFailure(res, error); }
});

router.post('/:guildId/repair', async (req, res) => {
  try {
    const guildId = guildIdFrom(req);
    const guild = await guildFrom(req, guildId);
    return success(res, { result: await reactionRoles.repairAll(guild), config: reactionRoles.getSection(guildId) });
  } catch (error) { return respondFailure(res, error); }
});

router.delete('/:guildId/panels/:panelId', async (req, res) => {
  try {
    const guildId = guildIdFrom(req);
    const guild = await guildFrom(req, guildId);
    const panel = panelFrom(guildId, req.params.panelId);
    const action = removalActionFrom(req);
    const result = action === 'delete'
      ? await reactionRoles.deleteDeploymentMessage(guild, panel.panelId, { actorId: actorId(req) })
      : await reactionRoles.detachPanel(guild, panel.panelId, { clearReactions: action === 'clear' });
    return success(res, { action, result, config: reactionRoles.getSection(guildId) });
  } catch (error) { return respondFailure(res, error); }
});

router.post('/:guildId/reset', (req, res) => {
  try {
    const guildId = guildIdFrom(req);
    return success(res, { config: reactionRoles.reset(guildId, { actorId: actorId(req) }) });
  } catch (error) { return respondFailure(res, error); }
});

router.get('/:guildId/export', (req, res) => {
  try {
    const guildId = guildIdFrom(req);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="goliath-reaction-roles-${guildId}.json"`);
    return res.send(JSON.stringify(reactionRoles.exportConfiguration(guildId), null, 2));
  } catch (error) { return respondFailure(res, error); }
});

module.exports = router;
