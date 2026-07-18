'use strict';

const express = require('express');
const invites = require('./invites');

const router = express.Router();
const actor = (req, action) => ({ action, actorId: req.session?.user?.id || req.body?.actorId || null });
const getClient = (req) => req.client || req.app?.get?.('goliath.client') || null;
async function getGuild(req) {
  const client = getClient(req);
  if (!client?.guilds) throw new Error('Discord client is unavailable.');
  return client.guilds.cache.get(req.params.guildId) || client.guilds.fetch(req.params.guildId).catch(() => null);
}

router.get('/:guildId', (req, res) => {
  try {
    const config = invites.getSection(req.params.guildId);
    res.json({ success: true, config, inviteLinks: invites.listInviteLinks(req.params.guildId), leaderboard: invites.leaderboard(req.params.guildId, Number(req.query.limit || 25)) });
  } catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

router.patch('/:guildId/enabled', (req, res) => {
  try { res.json({ success: true, config: invites.setEnabled(req.params.guildId, req.body?.enabled === true, actor(req, 'invites_enabled')) }); }
  catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

router.patch('/:guildId/settings', (req, res) => {
  try { res.json({ success: true, config: invites.updateSettings(req.params.guildId, req.body?.settings || req.body || {}, actor(req, 'invites_settings')) }); }
  catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

router.post('/:guildId/sync', async (req, res) => {
  try { const guild = await getGuild(req); if (!guild) throw new Error('Guild is unavailable.'); await invites.syncGuild(guild, actor(req, 'invites_sync')); res.json({ success: true, config: invites.getSection(guild.id), inviteLinks: invites.listInviteLinks(guild.id) }); }
  catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

router.get('/:guildId/links', (req, res) => {
  try { res.json({ success: true, inviteLinks: invites.listInviteLinks(req.params.guildId) }); }
  catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

router.post('/:guildId/links', async (req, res) => {
  try {
    const guild = await getGuild(req); if (!guild) throw new Error('Guild is unavailable.');
    const result = await invites.createInviteLink(guild, {
      channelId: req.body?.channelId,
      roleIds: req.body?.roleIds,
      maxAge: req.body?.maxAge,
      maxUses: req.body?.maxUses,
      temporary: req.body?.temporary === true,
    }, actor(req, 'invites_link_create'));
    res.status(201).json({ success: true, invite: { code: result.invite.code, url: result.invite.url }, record: result.record, inviteLinks: invites.listInviteLinks(guild.id) });
  } catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

router.delete('/:guildId/links/:code', async (req, res) => {
  try { const guild = await getGuild(req); if (!guild) throw new Error('Guild is unavailable.'); await invites.deleteInviteLink(guild, req.params.code, actor(req, 'invites_link_delete')); res.json({ success: true, inviteLinks: invites.listInviteLinks(guild.id) }); }
  catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

router.get('/:guildId/leaderboard', (req, res) => {
  try { res.json({ success: true, leaderboard: invites.leaderboard(req.params.guildId, Number(req.query.limit || 25)) }); }
  catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

router.patch('/:guildId/inviters/:userId/bonus', (req, res) => {
  try { res.json({ success: true, inviter: invites.setBonus(req.params.guildId, req.params.userId, req.body?.bonus, actor(req, 'invites_bonus')) }); }
  catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

router.get('/:guildId/history', (req, res) => {
  try {
    const section = invites.getSection(req.params.guildId);
    let history = section.history;
    if (req.query.type) history = history.filter((item) => item.type === req.query.type);
    if (req.query.memberId) history = history.filter((item) => item.memberId === req.query.memberId);
    if (req.query.inviterId) history = history.filter((item) => item.inviterId === req.query.inviterId);
    res.json({ success: true, history: history.slice(-Math.max(1, Math.min(1000, Number(req.query.limit || 100)))).reverse() });
  } catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

router.get('/:guildId/health', async (req, res) => {
  try { const guild = await getGuild(req); if (!guild) throw new Error('Guild is unavailable.'); res.json({ success: true, health: await invites.buildHealth(guild) }); }
  catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

router.post('/:guildId/repair', async (req, res) => {
  try { const guild = await getGuild(req); if (!guild) throw new Error('Guild is unavailable.'); res.json({ success: true, health: await invites.repair(guild, actor(req, 'invites_repair')) }); }
  catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

router.get('/:guildId/export', (req, res) => {
  try { res.json({ success: true, export: invites.exportConfiguration(req.params.guildId) }); }
  catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

router.post('/:guildId/reset', (req, res) => {
  try { res.json({ success: true, config: invites.reset(req.params.guildId, actor(req, 'invites_reset')) }); }
  catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

module.exports = router;
