'use strict';

const express = require('express');
const { PermissionFlagsBits } = require('discord.js');
const guildManager = require('../../../../core/guild/guildManager');
const suggestions = require('../../../../modules/feedbackStudio/suggestions/suggestions');
const tracking = require('../../../../modules/feedbackStudio/suggestions/suggestionsTracking');

const router = express.Router();
const ok = (res, payload = {}) => res.json({ success: true, ...payload });
const fail = (res, error, status = 400) => res.status(status).json({ success: false, error: error?.message || 'Suggestions request failed.' });

function guildId(req) {
  const id = String(req.params.guildId || '').trim();
  if (!/^\d{15,25}$/.test(id)) throw new Error('Invalid guild ID.');
  return id;
}

const actorId = (req) => String(req.session?.user?.id || req.body?.actorId || '').trim() || null;
const client = (req) => req.client || req.app?.get?.('goliath.client') || null;

async function guild(req, id) {
  const discord = client(req);
  return discord?.guilds?.cache?.get(id) || await discord?.guilds?.fetch?.(id).catch(() => null);
}

async function channelHealth(target, channelId, label, required) {
  if (!channelId) return required ? { level: 'warning', code: `${label}_missing` } : null;
  const channel = target?.channels?.cache?.get(channelId) || await target?.channels?.fetch?.(channelId).catch(() => null);
  if (!channel?.send) return { level: 'issue', code: `${label}_unavailable`, channelId };
  const me = target?.members?.me;
  const permissions = me && channel.permissionsFor?.(me);
  if (permissions && ![PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks].every((permission) => permissions.has(permission))) {
    return { level: 'issue', code: `${label}_permissions_missing`, channelId };
  }
  return null;
}

async function buildHealth(target, section) {
  if (!target) return null;
  const checks = await Promise.all([
    channelHealth(target, section.submitChannelId, 'submit_channel', section.requireReview === false),
    channelHealth(target, section.reviewChannelId || section.submitChannelId, 'review_channel', section.requireReview !== false),
    channelHealth(target, section.approvedChannelId, 'approved_channel', false),
    channelHealth(target, section.deniedChannelId, 'denied_channel', false),
  ]);
  const issues = checks.filter((item) => item?.level === 'issue');
  const warnings = checks.filter((item) => item?.level === 'warning');
  for (const roleId of section.reviewerRoleIds || []) {
    const role = target.roles.cache.get(roleId) || await target.roles.fetch(roleId).catch(() => null);
    if (!role) warnings.push({ level: 'warning', code: 'reviewer_role_missing', roleId });
  }
  return { healthy: issues.length === 0, issues, warnings, checkedAt: new Date().toISOString() };
}

async function overview(req, id) {
  const target = await guild(req, id);
  const section = suggestions.getSection(id);
  const items = Object.values(section.suggestions || {}).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return {
    guildId: id,
    config: { ...section, enabled: guildManager.isModuleEnabled(id, 'suggestions') },
    overview: {
      enabled: guildManager.isModuleEnabled(id, 'suggestions'),
      pending: items.filter((item) => item.status === 'pending').length,
      approved: items.filter((item) => item.status === 'approved').length,
      denied: items.filter((item) => item.status === 'denied').length,
      suggestions: items.map((item) => ({
        ...item,
        authorName: target?.members?.cache?.get(item.authorId)?.displayName || null,
        upVoteCount: item.upVotes?.length || 0,
        downVoteCount: item.downVotes?.length || 0,
      })),
      analytics: section.analytics || {},
      health: await buildHealth(target, section),
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
    guildManager.setModuleEnabled(id, 'suggestions', req.body?.enabled === true, { actorId: actorId(req), action: 'suggestions_dashboard_toggle' });
    return ok(res, await overview(req, id));
  } catch (error) { return fail(res, error); }
});

router.patch('/:guildId/settings', async (req, res) => {
  try {
    const id = guildId(req);
    const patch = req.body?.settings || req.body || {};
    suggestions.updateSection(id, (section) => ({ ...section, ...patch, updatedAt: new Date().toISOString() }), { actorId: actorId(req), action: 'suggestions_dashboard_settings' });
    return ok(res, await overview(req, id));
  } catch (error) { return fail(res, error); }
});

router.post('/:guildId/suggestions/:suggestionId/review', async (req, res) => {
  try {
    const id = guildId(req);
    const target = await guild(req, id);
    if (!target) throw new Error('Guild is unavailable.');
    const reviewerId = actorId(req);
    if (!reviewerId) throw new Error('Reviewer identity is unavailable.');
    const member = target.members.cache.get(reviewerId) || await target.members.fetch(reviewerId).catch(() => null);
    if (!member) throw new Error('Reviewer is not a member of this server.');
    const action = req.body?.action;
    if (!['approve', 'deny'].includes(action)) throw new Error('Review action must be approve or deny.');
    const interaction = { guildId: id, guild: target, user: { id: reviewerId }, member };
    const panel = require('../../../../modules/feedbackStudio/suggestions/suggestionsPanel');
    const reviewed = await tracking.review(interaction, String(req.params.suggestionId || ''), action, panel, String(req.body?.reason || ''));
    return ok(res, { reviewed, ...(await overview(req, id)) });
  } catch (error) { return fail(res, error); }
});

router.get('/:guildId/export', (req, res) => {
  try {
    const id = guildId(req);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="goliath-suggestions-${id}.json"`);
    return res.send(JSON.stringify({ ...suggestions.getSection(id), enabled: guildManager.isModuleEnabled(id, 'suggestions') }, null, 2));
  } catch (error) { return fail(res, error); }
});

module.exports = router;
