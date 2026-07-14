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

router.get('/:guildId/overview', async (req, res) => {
  try {
    const guildId = guildIdFrom(req);
    const guild = await guildFrom(req, guildId);
    return success(res, { config: reactionRoles.getSection(guildId), health: await reactionRoles.buildHealth(guild) });
  } catch (error) { return failure(res, error); }
});

router.patch('/:guildId/enabled', (req, res) => {
  try {
    const guildId = guildIdFrom(req);
    return success(res, { config: reactionRoles.setEnabled(guildId, req.body?.enabled === true, { actorId: actorId(req) }) });
  } catch (error) { return failure(res, error); }
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
      mappings: req.body?.mappings || [],
      createdBy: actorId(req),
    });
    return success(res, { panel, config: reactionRoles.getSection(guildId) });
  } catch (error) { return failure(res, error); }
});

router.put('/:guildId/panels/:panelId', async (req, res) => {
  try {
    const guildId = guildIdFrom(req);
    const guild = await guildFrom(req, guildId);
    const panel = await reactionRoles.updatePanelMappings(guild, req.params.panelId, req.body?.mappings || [], actorId(req));
    return success(res, { panel, config: reactionRoles.getSection(guildId) });
  } catch (error) { return failure(res, error); }
});

router.post('/:guildId/panels/:panelId/repair', async (req, res) => {
  try {
    const guildId = guildIdFrom(req);
    const guild = await guildFrom(req, guildId);
    const panel = reactionRoles.getPanel(guildId, req.params.panelId);
    if (!panel) throw new Error('Reaction-role panel not found.');
    const result = await reactionRoles.syncPanelReactions(guild, panel);
    return success(res, { panel: result.panel, config: reactionRoles.getSection(guildId) });
  } catch (error) { return failure(res, error); }
});

router.post('/:guildId/repair', async (req, res) => {
  try {
    const guildId = guildIdFrom(req);
    const guild = await guildFrom(req, guildId);
    return success(res, { result: await reactionRoles.repairAll(guild), config: reactionRoles.getSection(guildId) });
  } catch (error) { return failure(res, error); }
});

router.delete('/:guildId/panels/:panelId', async (req, res) => {
  try {
    const guildId = guildIdFrom(req);
    const guild = await guildFrom(req, guildId);
    const result = await reactionRoles.detachPanel(guild, req.params.panelId, { clearReactions: req.query.clearReactions === 'true' || req.body?.clearReactions === true });
    return success(res, { result, config: reactionRoles.getSection(guildId) });
  } catch (error) { return failure(res, error); }
});

router.post('/:guildId/reset', (req, res) => {
  try {
    const guildId = guildIdFrom(req);
    return success(res, { config: reactionRoles.reset(guildId, { actorId: actorId(req) }) });
  } catch (error) { return failure(res, error); }
});

router.get('/:guildId/export', (req, res) => {
  try {
    const guildId = guildIdFrom(req);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="goliath-reaction-roles-${guildId}.json"`);
    return res.send(JSON.stringify(reactionRoles.exportConfiguration(guildId), null, 2));
  } catch (error) { return failure(res, error); }
});

module.exports = router;
