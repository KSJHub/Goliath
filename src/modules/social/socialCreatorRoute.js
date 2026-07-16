'use strict';

const express = require('express');
const social = require('./social');

const router = express.Router({ mergeParams: true });

function actor(req, action) {
  return { action, actorId: req.session?.user?.id || req.body?.actorId || null };
}
function client(req) {
  return req.client || req.app?.get?.('goliath.client') || req.app?.locals?.client || global.client || global.discordClient || null;
}

router.get('/diagnostics', (req, res) => {
  try { return res.json({ success: true, diagnostics: social.diagnostics.buildDiagnostics(req.params.guildId) }); }
  catch (error) { return res.status(400).json({ success: false, error: error.message || 'Failed to build Social diagnostics.' }); }
});

router.get('/diagnostics/providers', (req, res) => {
  try { return res.json({ success: true, providers: social.diagnostics.providerDiagnostics(req.params.guildId) }); }
  catch (error) { return res.status(400).json({ success: false, error: error.message || 'Failed to build provider diagnostics.' }); }
});

router.get('/diagnostics/creators', (req, res) => {
  try { return res.json({ success: true, ...social.diagnostics.creatorDiagnostics(req.params.guildId) }); }
  catch (error) { return res.status(400).json({ success: false, error: error.message || 'Failed to build creator diagnostics.' }); }
});

router.get('/', (req, res) => {
  try {
    return res.json({ success: true, guildId: req.params.guildId, summary: social.creators.summary(req.params.guildId), creators: social.creators.list(req.params.guildId) });
  } catch (error) { return res.status(400).json({ success: false, error: error.message || 'Failed to fetch creator profiles.' }); }
});

router.post('/rebuild', (req, res) => {
  try {
    const creators = social.creators.rebuild(req.params.guildId, actor(req, 'social_creator_profiles_rebuild'));
    return res.json({ success: true, creators, summary: social.creators.summary(req.params.guildId) });
  } catch (error) { return res.status(400).json({ success: false, error: error.message || 'Failed to rebuild creator profiles.' }); }
});

router.post('/', (req, res) => {
  try {
    const creator = social.creators.save(req.params.guildId, req.body || {}, actor(req, 'social_creator_profile_create'));
    return res.status(201).json({ success: true, creator });
  } catch (error) { return res.status(400).json({ success: false, error: error.message || 'Failed to create creator profile.' }); }
});

router.patch('/:creatorId', (req, res) => {
  try {
    const existing = social.creators.get(req.params.guildId, req.params.creatorId);
    if (!existing) return res.status(404).json({ success: false, error: 'Creator profile not found.' });
    const creator = social.creators.save(req.params.guildId, { ...existing, ...(req.body || {}), creatorId: existing.creatorId }, actor(req, 'social_creator_profile_update'));
    return res.json({ success: true, creator });
  } catch (error) { return res.status(400).json({ success: false, error: error.message || 'Failed to update creator profile.' }); }
});

router.delete('/:creatorId', (req, res) => {
  try {
    const removed = social.creators.remove(req.params.guildId, req.params.creatorId, actor(req, 'social_creator_profile_remove'));
    if (!removed) return res.status(404).json({ success: false, error: 'Creator profile not found.' });
    return res.json({ success: true, summary: social.creators.summary(req.params.guildId) });
  } catch (error) { return res.status(400).json({ success: false, error: error.message || 'Failed to remove creator profile.' }); }
});

router.post('/:creatorId/accounts/:accountId', (req, res) => {
  try {
    const creator = social.creators.linkAccount(req.params.guildId, req.params.creatorId, req.params.accountId, actor(req, 'social_creator_account_link'));
    return res.json({ success: true, creator });
  } catch (error) { return res.status(400).json({ success: false, error: error.message || 'Failed to link creator account.' }); }
});

router.delete('/:creatorId/accounts/:accountId', (req, res) => {
  try {
    const creator = social.creators.unlinkAccount(req.params.guildId, req.params.creatorId, req.params.accountId, actor(req, 'social_creator_account_unlink'));
    return res.json({ success: true, creator });
  } catch (error) { return res.status(400).json({ success: false, error: error.message || 'Failed to unlink creator account.' }); }
});

router.post('/accounts/:accountId/simulate', async (req, res) => {
  try {
    const result = await social.simulator.simulate(
      req.params.guildId,
      req.params.accountId,
      req.body?.alertType || 'live',
      client(req),
      { send: req.body?.send === true, force: req.body?.force === true, overrides: req.body?.overrides || {} },
      actor(req, 'social_notification_simulation'),
    );
    return res.status(result.status || (result.success ? 200 : 400)).json(result);
  } catch (error) { return res.status(500).json({ success: false, error: error.message || 'Social simulation failed.' }); }
});

module.exports = router;
