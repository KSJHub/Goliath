'use strict';

const express = require('express');
const guildManager = require('../../../../core/guild/guildManager');
const polls = require('../../../../modules/communityStudio/polls/polls');
const tracking = require('../../../../modules/communityStudio/polls/pollsTracking');

const router = express.Router();
const success = (res, payload = {}) => res.json({ success: true, ...payload });
function failure(res, error, status = 500) {
  console.error('[Community Polls API]', error);
  return res.status(status).json({ success: false, error: error.message || 'Polls API request failed.' });
}
function getGuildId(req) {
  const guildId = String(req.params.guildId || '').trim();
  if (!/^\d{15,25}$/.test(guildId)) throw new Error('Invalid guild ID.');
  return guildId;
}
function getClient(req) {
  return req.client || req.app?.get?.('goliath.client') || req.app?.locals?.client || global.client || null;
}
async function getGuild(req, guildId) {
  const client = getClient(req);
  if (!client?.guilds) throw new Error('Discord client is unavailable.');
  return client.guilds.cache.get(guildId) || client.guilds.fetch(guildId).catch(() => null);
}
const actor = (req) => ({ actorId: req.session?.user?.id || req.body?.actorId || null });
function publicConfig(guildId, config) {
  return {
    ...config,
    enabled: guildManager.isModuleEnabled(guildId, 'polls'),
    settings: {
      ...(config.settings || {}),
      autoCloseHours: Math.max(0, Number(config.settings?.autoCloseHours || 0)),
    },
  };
}
function normalizeSettingsPayload(body = {}) {
  const source = body?.settings && typeof body.settings === 'object' ? body.settings : body;
  const settings = { ...(source || {}) };
  if (Object.prototype.hasOwnProperty.call(settings, 'autoCloseHours')) {
    const hours = Number(settings.autoCloseHours);
    if (!Number.isFinite(hours) || hours < 0 || hours > 8760) throw new Error('Auto-close hours must be between 0 and 8760.');
    settings.autoCloseHours = hours === 0 ? -1 : hours;
  }
  return settings;
}

router.get('/:guildId', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const config = polls.getSection(guildId);
    const pollList = Object.values(config.polls || {}).map(polls.summarizePoll).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return success(res, { guildId, config: { ...publicConfig(guildId, config), polls: pollList }, overview: {
      enabled: guildManager.isModuleEnabled(guildId, 'polls'),
      total: pollList.length,
      active: pollList.filter((poll) => poll.status === 'active').length,
      closed: pollList.filter((poll) => poll.status === 'closed').length,
      responses: config.analytics?.votes || 0,
    } });
  } catch (error) { return failure(res, error, 400); }
});
router.get('/:guildId/health', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    const guild = await getGuild(req, guildId);
    if (!guild) throw new Error('Guild is unavailable.');
    return success(res, { guildId, health: await tracking.buildHealth(guild) });
  } catch (error) { return failure(res, error, 400); }
});
router.get('/:guildId/export', (req, res) => {
  try {
    const guildId = getGuildId(req);
    return success(res, { guildId, export: { ...tracking.exportConfig(guildId), enabled: guildManager.isModuleEnabled(guildId, 'polls') } });
  } catch (error) { return failure(res, error, 400); }
});
router.patch('/:guildId/enabled', (req, res) => {
  try {
    const guildId = getGuildId(req);
    guildManager.setModuleEnabled(guildId, 'polls', req.body?.enabled === true, actor(req));
    return success(res, { guildId, config: publicConfig(guildId, polls.getSection(guildId)) });
  } catch (error) { return failure(res, error, 400); }
});
router.patch('/:guildId/settings', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const config = polls.getSection(guildId);
    const incoming = normalizeSettingsPayload(req.body || {});
    config.settings = { ...(config.settings || {}), ...incoming };
    if (Object.prototype.hasOwnProperty.call(incoming, 'defaultChannelId')) config.defaultChannelId = incoming.defaultChannelId || null;
    if (Object.prototype.hasOwnProperty.call(incoming, 'anonymousVotes')) config.anonymousVoting = incoming.anonymousVotes === true;
    if (Object.prototype.hasOwnProperty.call(incoming, 'allowMultipleVotes')) config.allowMultipleChoice = incoming.allowMultipleVotes === true;
    if (Object.prototype.hasOwnProperty.call(incoming, 'showResultsLive')) config.showResultsLive = incoming.showResultsLive !== false;
    return success(res, { guildId, config: publicConfig(guildId, polls.saveSection(guildId, config, actor(req))) });
  } catch (error) { return failure(res, error, 400); }
});
router.post('/:guildId/repair', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    const guild = await getGuild(req, guildId);
    if (!guild) throw new Error('Guild is unavailable.');
    return success(res, { guildId, result: await tracking.repair(guild, actor(req)) });
  } catch (error) { return failure(res, error, 400); }
});
router.post('/:guildId/reset', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    const guild = await getGuild(req, guildId);
    if (!guild) throw new Error('Guild is unavailable.');
    return success(res, { guildId, result: await tracking.reset(guild, actor(req)) });
  } catch (error) { return failure(res, error, 400); }
});
router.post('/:guildId/polls', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const result = polls.createPoll(guildId, req.body || {}, actor(req));
    return success(res, { guildId, poll: polls.summarizePoll(result.poll), config: publicConfig(guildId, result.section) });
  } catch (error) { return failure(res, error, 400); }
});
router.put('/:guildId/polls/:pollId', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const result = polls.updatePoll(guildId, req.params.pollId, req.body || {}, actor(req));
    return success(res, { guildId, poll: polls.summarizePoll(result.poll), config: publicConfig(guildId, result.section) });
  } catch (error) { return failure(res, error, 400); }
});
router.post('/:guildId/polls/:pollId/deploy', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    const guild = await getGuild(req, guildId);
    if (!guild) throw new Error('Guild is unavailable.');
    const result = await tracking.deployPoll(guild, req.params.pollId, req.body?.channelId, actor(req));
    return success(res, { guildId, poll: polls.summarizePoll(result.poll), messageId: result.messageId, redeployed: result.redeployed, config: publicConfig(guildId, result.section) });
  } catch (error) { return failure(res, error, 400); }
});
router.patch('/:guildId/polls/:pollId/status', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    const guild = await getGuild(req, guildId);
    if (!guild) throw new Error('Guild is unavailable.');
    const result = await tracking.setPollStatus(guild, req.params.pollId, req.body?.status, actor(req));
    return success(res, { guildId, poll: polls.summarizePoll(result.poll), config: publicConfig(guildId, result.section) });
  } catch (error) { return failure(res, error, 400); }
});
router.delete('/:guildId/polls/:pollId', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    const guild = await getGuild(req, guildId);
    if (!guild) throw new Error('Guild is unavailable.');
    const config = await tracking.deletePoll(guild, req.params.pollId, actor(req));
    return success(res, { guildId, config: publicConfig(guildId, config) });
  } catch (error) { return failure(res, error, 400); }
});

module.exports = router;
