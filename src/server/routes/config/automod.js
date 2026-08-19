'use strict';

const express = require('express');

const guildManager = require('../../../core/guild/guildManager');
const { emitGuildUpdate } = require('../../sockets/socketHub');

const router = express.Router();
const MODULE = 'automod';

const AUTOMOD_ACTIONS = new Set(['dm', 'delete', 'warn', 'timeout', 'kick', 'ban']);
const DEFAULT_DM_MESSAGES = {
  antiSpam: '⚠️ **{server} AutoMod**\nSpam Protection triggered: {reason}',
  antiLinks: '⚠️ **{server} AutoMod**\nLink Protection triggered: {reason}',
  badWords: '⚠️ **{server} AutoMod**\nBad Word Filter triggered: {reason}',
  caps: '⚠️ **{server} AutoMod**\nCaps Protection triggered: {reason}',
  mentions: '⚠️ **{server} AutoMod**\nMention Protection triggered: {reason}',
};

function getBody(req) {
  return req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? req.body
    : {};
}

function getGuildId(req, res) {
  const guildId = req.params?.guildId;
  if (guildId) return guildId;

  res.status(400).json({ ok: false, error: 'Missing guild ID.' });
  return null;
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBoolean(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeNumber(value, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];

  return [...new Set(
    value
      .map((item) => normalizeText(item).toLowerCase())
      .filter(Boolean)
  )];
}

function normalizeDomainArray(value) {
  return normalizeStringArray(value)
    .map((domain) => domain
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .replace(/\/.*$/, '')
    )
    .filter(Boolean);
}

function normalizeActions(value, fallback = ['delete']) {
  const source = Array.isArray(value) ? value : value ? [value] : fallback;
  const actions = [...new Set(
    source
      .map((item) => normalizeText(item).toLowerCase())
      .filter((item) => AUTOMOD_ACTIONS.has(item))
  )];

  if (actions.includes('ban')) {
    return actions.filter((action) => action !== 'kick');
  }

  return actions.length ? actions : [...fallback];
}

function normalizeDmMessages(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};

  return Object.fromEntries(
    Object.entries(DEFAULT_DM_MESSAGES).map(([key, fallback]) => [
      key,
      normalizeText(source[key]) || fallback,
    ])
  );
}

function normalizeAutomodConfig(config = {}) {
  const safeConfig = config && typeof config === 'object' && !Array.isArray(config)
    ? config
    : {};

  return {
    dmUser: normalizeBoolean(safeConfig.dmUser, true),
    dmMessages: normalizeDmMessages(safeConfig.dmMessages),

    antiSpam: {
      enabled: normalizeBoolean(safeConfig.antiSpam?.enabled, false),
      maxMessages: normalizeNumber(safeConfig.antiSpam?.maxMessages, 5, 2, 100),
      intervalSeconds: normalizeNumber(safeConfig.antiSpam?.intervalSeconds, 10, 1, 3600),
      actions: normalizeActions(
        safeConfig.antiSpam?.actions || safeConfig.antiSpam?.action,
        ['delete']
      ),
    },

    antiLinks: {
      enabled: normalizeBoolean(safeConfig.antiLinks?.enabled, false),
      allowStaff: normalizeBoolean(safeConfig.antiLinks?.allowStaff, true),
      allowedDomains: normalizeDomainArray(safeConfig.antiLinks?.allowedDomains),
      deniedDomains: normalizeDomainArray(safeConfig.antiLinks?.deniedDomains),
      actions: normalizeActions(
        safeConfig.antiLinks?.actions || safeConfig.antiLinks?.action,
        ['delete']
      ),
    },

    badWords: {
      enabled: normalizeBoolean(safeConfig.badWords?.enabled, false),
      words: normalizeStringArray(safeConfig.badWords?.words),
      actions: normalizeActions(
        safeConfig.badWords?.actions || safeConfig.badWords?.action,
        ['delete']
      ),
    },

    caps: {
      enabled: normalizeBoolean(safeConfig.caps?.enabled, false),
      percent: normalizeNumber(safeConfig.caps?.percent, 70, 1, 100),
      minLength: normalizeNumber(safeConfig.caps?.minLength, 12, 1, 500),
      actions: normalizeActions(
        safeConfig.caps?.actions || safeConfig.caps?.action,
        ['warn']
      ),
    },

    mentions: {
      enabled: normalizeBoolean(safeConfig.mentions?.enabled, false),
      maxMentions: normalizeNumber(safeConfig.mentions?.maxMentions, 5, 1, 100),
      actions: normalizeActions(
        safeConfig.mentions?.actions || safeConfig.mentions?.action,
        ['warn']
      ),
    },

    ignoredRoles: normalizeStringArray(safeConfig.ignoredRoles),
    ignoredChannels: normalizeStringArray(safeConfig.ignoredChannels),
  };
}

function mergeAutomodConfig(current, patch) {
  return {
    ...current,
    ...patch,
    dmMessages: {
      ...(current.dmMessages || {}),
      ...(patch.dmMessages || {}),
    },
    antiSpam: {
      ...(current.antiSpam || {}),
      ...(patch.antiSpam || {}),
    },
    antiLinks: {
      ...(current.antiLinks || {}),
      ...(patch.antiLinks || {}),
    },
    badWords: {
      ...(current.badWords || {}),
      ...(patch.badWords || {}),
    },
    caps: {
      ...(current.caps || {}),
      ...(patch.caps || {}),
    },
    mentions: {
      ...(current.mentions || {}),
      ...(patch.mentions || {}),
    },
  };
}

function canonicalConfig(guildId, config) {
  return {
    ...config,
    enabled: guildManager.isModuleEnabled(guildId, MODULE),
  };
}

function readConfig(guildId) {
  return normalizeAutomodConfig(
    guildManager.getGuildSection(guildId, MODULE, {})
  );
}

function saveConfig(guildId, config) {
  const saved = guildManager.replaceGuildSection(guildId, MODULE, config);
  const responseConfig = canonicalConfig(guildId, saved);

  emitGuildUpdate(guildId, {
    section: MODULE,
    data: responseConfig,
  });

  return responseConfig;
}

function sendSuccess(res, guildId, config) {
  return res.json({
    ok: true,
    guildId,
    config,
  });
}

function sendFailure(res, label, error, publicMessage) {
  console.error(`AutoMod ${label} failed:`, error);
  return res.status(500).json({
    ok: false,
    error: publicMessage,
    message: error.message,
  });
}

router.get('/:guildId', (req, res) => {
  const guildId = getGuildId(req, res);
  if (!guildId) return undefined;

  try {
    return sendSuccess(res, guildId, canonicalConfig(guildId, readConfig(guildId)));
  } catch (error) {
    return sendFailure(res, 'load', error, 'Failed to load automod config.');
  }
});

router.post('/:guildId', (req, res) => {
  const guildId = getGuildId(req, res);
  if (!guildId) return undefined;

  try {
    const body = getBody(req);

    if (Object.prototype.hasOwnProperty.call(body, 'enabled')) {
      guildManager.setModuleEnabled(guildId, MODULE, body.enabled === true);
    }

    const { enabled: _enabled, ...configPatch } = body;
    const payload = normalizeAutomodConfig(
      mergeAutomodConfig(readConfig(guildId), configPatch)
    );

    return sendSuccess(res, guildId, saveConfig(guildId, payload));
  } catch (error) {
    return sendFailure(res, 'save', error, 'Failed to save automod config.');
  }
});

router.post('/:guildId/reset', (req, res) => {
  const guildId = getGuildId(req, res);
  if (!guildId) return undefined;

  try {
    return sendSuccess(
      res,
      guildId,
      saveConfig(guildId, normalizeAutomodConfig({}))
    );
  } catch (error) {
    return sendFailure(res, 'reset', error, 'Failed to reset automod config.');
  }
});

module.exports = router;
