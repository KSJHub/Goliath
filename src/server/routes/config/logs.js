const express = require('express');

const guildManager = require('../../../core/guild/guildManager');
const { emitGuildUpdate } = require('../../sockets/socketHub');

const router = express.Router();
const MODULE_KEY = 'logging';
const DEFAULT_LOG_SETTINGS = Object.freeze({
  useWebhooks: true,
  ignoreEmbeds: false,
  applyIgnoreToUsersInVoice: false,
  logDeletedPollsWithMessageDelete: true,
  logDeletedStickyMessages: true,
  logDeletedForwardedMessages: true,
  logUnrecognizableMessageDeletions: false,
  ignoredChannels: [],
  ignoredRoles: [],
  ignoredUsers: [],
});

function getBody(req) {
  return req.body && typeof req.body === 'object' ? req.body : {};
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeChannelId(value) {
  const channelId = typeof value === 'string' ? value.trim() : '';
  return channelId || null;
}

function normalizeIdList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))];
}

function normalizeBoolean(value, fallback = true) {
  if (typeof value === 'boolean') return value;
  return fallback;
}

function normalizeLogChannels(bodyChannels = {}, currentChannels = {}) {
  const safeBody = isPlainObject(bodyChannels) ? bodyChannels : {};
  const safeCurrent = isPlainObject(currentChannels) ? currentChannels : {};
  const next = {};

  for (const [key, value] of Object.entries({ ...safeCurrent, ...safeBody })) {
    next[key] = normalizeChannelId(value);
  }

  next.messageDelete = normalizeChannelId(next.messageDelete || safeBody.message || safeCurrent.message);
  next.messageEdit = normalizeChannelId(next.messageEdit || safeBody.message || safeCurrent.message);
  delete next.message;

  return next;
}

function normalizeLogEvents(bodyEvents = {}, currentEvents = {}) {
  const safeBody = isPlainObject(bodyEvents) ? bodyEvents : {};
  const safeCurrent = isPlainObject(currentEvents) ? currentEvents : {};
  const next = {};

  for (const [key, value] of Object.entries({ ...safeCurrent, ...safeBody })) {
    next[key] = normalizeBoolean(value, safeCurrent[key] !== false);
  }

  return next;
}

function normalizeLogSettings(bodySettings = {}, currentSettings = {}) {
  const safeBody = isPlainObject(bodySettings) ? bodySettings : {};
  const safeCurrent = isPlainObject(currentSettings) ? currentSettings : {};
  const merged = {
    ...DEFAULT_LOG_SETTINGS,
    ...safeCurrent,
    ...safeBody,
  };

  return {
    useWebhooks: merged.useWebhooks !== false,
    ignoreEmbeds: merged.ignoreEmbeds === true,
    applyIgnoreToUsersInVoice: merged.applyIgnoreToUsersInVoice === true,
    logDeletedPollsWithMessageDelete: merged.logDeletedPollsWithMessageDelete !== false,
    logDeletedStickyMessages: merged.logDeletedStickyMessages !== false,
    logDeletedForwardedMessages: merged.logDeletedForwardedMessages !== false,
    logUnrecognizableMessageDeletions: merged.logUnrecognizableMessageDeletions === true,
    ignoredChannels: normalizeIdList(merged.ignoredChannels),
    ignoredRoles: normalizeIdList(merged.ignoredRoles),
    ignoredUsers: normalizeIdList(merged.ignoredUsers),
  };
}

function getDefaultLogsConfig() {
  const defaults = {
    channels: {},
    events: {},
    settings: DEFAULT_LOG_SETTINGS,
    ...(guildManager.DEFAULT_LOGS || {}),
  };
  delete defaults.enabled;
  return defaults;
}

function normalizeLogsConfig(config = {}) {
  const defaults = getDefaultLogsConfig();
  const safeConfig = isPlainObject(config) ? config : {};
  const normalized = {
    ...defaults,
    ...safeConfig,
    channels: normalizeLogChannels(safeConfig.channels || {}, defaults.channels || {}),
    events: normalizeLogEvents(safeConfig.events || {}, defaults.events || {}),
    settings: normalizeLogSettings(safeConfig.settings || {}, defaults.settings || {}),
  };
  delete normalized.enabled;
  return normalized;
}

function canonicalConfig(guildId, config = {}) {
  return {
    ...normalizeLogsConfig(config),
    enabled: guildManager.isModuleEnabled(guildId, MODULE_KEY),
  };
}

router.get('/:guildId', (req, res) => {
  try {
    const { guildId } = req.params;

    if (!guildId) {
      return res.status(400).json({
        ok: false,
        error: 'Missing guild ID.',
      });
    }

    const current = guildManager.getGuildSection(guildId, 'logs', getDefaultLogsConfig());
    const config = canonicalConfig(guildId, current);

    return res.json({
      ok: true,
      guildId,
      config,
    });
  } catch (error) {
    console.error('Logs load failed:', error);

    return res.status(500).json({
      ok: false,
      error: 'Failed to load logs config.',
      message: error.message,
    });
  }
});

router.post('/:guildId', (req, res) => {
  try {
    const { guildId } = req.params;
    const body = getBody(req);

    if (!guildId) {
      return res.status(400).json({
        ok: false,
        error: 'Missing guild ID.',
      });
    }

    const current = normalizeLogsConfig(
      guildManager.getGuildSection(guildId, 'logs', getDefaultLogsConfig())
    );

    if (typeof body.enabled === 'boolean') {
      guildManager.setModuleEnabled(guildId, MODULE_KEY, body.enabled);
    }

    const payload = normalizeLogsConfig({
      ...current,
      channels: normalizeLogChannels(body.channels, current.channels),
      events: normalizeLogEvents(body.events, current.events),
      settings: normalizeLogSettings(body.settings, current.settings),
    });

    const saved = guildManager.saveGuildSection(guildId, 'logs', payload);
    const config = canonicalConfig(guildId, saved);

    emitGuildUpdate(guildId, {
      section: 'logs',
      data: config,
    });

    return res.json({
      ok: true,
      guildId,
      config,
    });
  } catch (error) {
    console.error('Logs save failed:', error);

    return res.status(500).json({
      ok: false,
      error: 'Failed to save logs config.',
      message: error.message,
    });
  }
});

module.exports = router;
