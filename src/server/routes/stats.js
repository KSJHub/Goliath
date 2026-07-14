'use strict';

const express = require('express');
const guildManager = require('../../core/guild/guildManager');
const statsStore = require('../../modules/stats/statsStore');
const verificationStore = require('../../modules/verification/verification');

const router = express.Router();

function success(res, payload = {}) {
  return res.json({ success: true, ...payload });
}

function failure(res, error, status = 500) {
  console.error('[Stats API]', error);
  return res.status(status).json({ success: false, error: error.message || 'Stats API request failed.' });
}

function getGuildId(req) {
  const guildId = String(req.params.guildId || req.query?.guildId || '').trim();
  if (!/^\d{15,25}$/.test(guildId)) throw new Error('Invalid guild ID.');
  return guildId;
}

function getClient(req) {
  return req.client || req.app?.get?.('goliath.client') || req.app?.locals?.client || global.client || null;
}

async function getGuild(req, guildId) {
  const client = getClient(req);
  if (!client?.guilds) return null;
  return client.guilds.cache.get(guildId) || client.guilds.fetch(guildId).catch(() => null);
}

function countObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).length : 0;
}

function countArray(value) {
  return Array.isArray(value) ? value.length : 0;
}

function moduleEnabled(modules, key) {
  const value = modules?.[key];
  if (typeof value === 'boolean') return value !== false;
  if (value && typeof value === 'object') return value.enabled !== false;
  return false;
}

function buildModuleStats(data) {
  const modules = data.modules || {};
  const moduleKeys = Object.keys(modules);
  const enabled = moduleKeys.filter((key) => moduleEnabled(modules, key));

  return {
    total: moduleKeys.length,
    enabled: enabled.length,
    disabled: Math.max(0, moduleKeys.length - enabled.length),
    enabledKeys: enabled.sort(),
  };
}

function buildVerificationStats(guildId, modules = {}) {
  const verification = modules.verification || {};
  const section = verificationStore.getVerificationSection(guildId);
  const panels = Object.values(section.panels || {});
  return {
    enabled: verification.enabled !== false && section.enabled === true,
    verificationChannelId: verification.verificationChannelId || section.settings?.verificationChannelId || null,
    logChannelId: verification.logChannelId || section.settings?.logChannelId || null,
    verifiedRoles: countArray(verification.verifiedRoleIds || (section.settings?.verifiedRoleId ? [section.settings.verifiedRoleId] : [])),
    pendingRoles: countArray(verification.pendingRoleIds || (section.settings?.unverifiedRoleId ? [section.settings.unverifiedRoleId] : [])),
    panels: panels.length,
    deployedPanels: panels.filter((panel) => panel?.messageId && panel?.channelId).length,
    analytics: section.analytics || {},
  };
}

function buildStoredStats(data, guildId) {
  const modules = data.modules || {};
  const tickets = modules.tickets || data.tickets || {};
  const forms = modules.forms || {};
  const polls = modules.polls || {};
  const logs = modules.logs || data.logs || {};
  const security = modules.security || data.security || {};

  return {
    activity: statsStore.getSummary(guildId),
    tickets: {
      total: countArray(tickets.tickets),
      panels: countArray(tickets.panels),
      open: countArray(tickets.tickets?.filter?.((ticket) => ticket.status === 'open') || []),
      analytics: tickets.analytics || {},
    },
    forms: {
      forms: countObject(forms.forms),
      submissions: countObject(forms.submissions),
      panels: countObject(forms.panels),
      analytics: forms.analytics || {},
    },
    polls: {
      total: countObject(polls.polls),
      active: Object.values(polls.polls || {}).filter((poll) => poll?.status === 'active').length,
      closed: Object.values(polls.polls || {}).filter((poll) => poll?.status === 'closed').length,
      analytics: polls.analytics || {},
    },
    verification: buildVerificationStats(guildId, modules),
    logs: {
      enabled: logs.enabled !== false,
      channels: countObject(logs.channels),
      events: countObject(logs.events),
    },
    security: {
      enabled: security.enabled !== false,
      threatLevel: security.threatLevel || 'low',
      totalIncidents: Number(security.totalIncidents || 0),
      criticalIncidents: Number(security.criticalIncidents || 0),
      incidents: countArray(security.incidents),
    },
  };
}

async function buildLiveStats(req, guildId) {
  const guild = await getGuild(req, guildId);
  if (!guild) {
    return {
      available: false,
      guild: null,
      members: null,
      channels: null,
      roles: null,
      emojis: null,
    };
  }

  const channels = [...guild.channels.cache.values()];
  const roles = [...guild.roles.cache.values()].filter((role) => role.id !== guild.id);
  const emojis = [...guild.emojis.cache.values()];

  return {
    available: true,
    guild: {
      id: guild.id,
      name: guild.name,
      iconUrl: guild.iconURL?.({ extension: 'png', size: 128 }) || null,
      createdAt: guild.createdAt?.toISOString?.() || null,
      ownerId: guild.ownerId || null,
      premiumTier: guild.premiumTier || 0,
      premiumSubscriptionCount: guild.premiumSubscriptionCount || 0,
    },
    members: {
      total: guild.memberCount || 0,
    },
    channels: {
      total: channels.length,
      text: channels.filter((channel) => channel.type === 0 || channel.type === 5).length,
      voice: channels.filter((channel) => channel.type === 2 || channel.type === 13).length,
      categories: channels.filter((channel) => channel.type === 4).length,
      threads: channels.filter((channel) => channel.isThread?.()).length,
    },
    roles: {
      total: roles.length,
      managed: roles.filter((role) => role.managed).length,
      mentionable: roles.filter((role) => role.mentionable).length,
    },
    emojis: {
      total: emojis.length,
      animated: emojis.filter((emoji) => emoji.animated).length,
      static: emojis.filter((emoji) => !emoji.animated).length,
    },
  };
}

router.get('/:guildId/overview', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    const data = guildManager.getGuildData(guildId);
    const live = await buildLiveStats(req, guildId);

    return success(res, {
      guildId,
      updatedAt: new Date().toISOString(),
      live,
      modules: buildModuleStats(data),
      stored: buildStoredStats(data, guildId),
    });
  } catch (error) {
    return failure(res, error, 400);
  }
});

module.exports = router;
