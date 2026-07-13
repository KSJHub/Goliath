'use strict';

const {
  getModuleSection,
  saveModuleSection,
  updateModuleSection,
} = require('../../core/guild/moduleSectionManager');
const guildManager = require('../../core/guild/guildManager');

const MODULE = 'logging';

const EVENT_KEYS = Object.freeze([
  'messageDelete',
  'messageEdit',
  'memberJoin',
  'memberLeave',
  'memberUpdate',
  'roleCreate',
  'roleUpdate',
  'roleDelete',
  'channelCreate',
  'channelUpdate',
  'channelDelete',
  'voiceJoin',
  'voiceLeave',
  'voiceMove',
  'moderation',
  'automod',
  'verification',
  'tickets',
  'forms',
  'serverUpdate',
]);

function now() {
  return new Date().toISOString();
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function cleanDiscordId(value) {
  const id = String(value || '').replace(/[<@#!&>]/g, '').trim();
  return /^\d{15,25}$/.test(id) ? id : null;
}

function cleanIdList(value) {
  const values = Array.isArray(value) ? value : [];
  return [...new Set(values.map(cleanDiscordId).filter(Boolean))];
}

function defaultSettings() {
  return {
    useWebhooks: true,
    ignoreEmbeds: false,
    applyIgnoreToUsersInVoice: false,
    logDeletedPollsWithMessageDelete: true,
    logDeletedStickyMessages: true,
    logDeletedForwardedMessages: true,
    logUnrecognizableMessageDeletions: false,
    includeTimestamps: true,
    includeActor: true,
    includeReason: true,
    ignoredChannels: [],
    ignoredRoles: [],
    ignoredUsers: [],
  };
}

function defaultEvents() {
  return Object.fromEntries(EVENT_KEYS.map((key) => [key, true]));
}

function defaultChannels() {
  return Object.fromEntries(EVENT_KEYS.map((key) => [key, null]));
}

function defaultAnalytics() {
  return {
    totalSent: 0,
    totalFailed: 0,
    ignored: 0,
    lastLogAt: null,
    lastFailureAt: null,
    byEvent: {},
  };
}

function defaultLoggingSection() {
  return {
    enabled: false,
    channels: defaultChannels(),
    events: defaultEvents(),
    settings: defaultSettings(),
    analytics: defaultAnalytics(),
    createdAt: now(),
    updatedAt: now(),
  };
}

function normalizeChannels(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const legacyMessage = cleanDiscordId(source.message);
  const output = defaultChannels();

  for (const key of EVENT_KEYS) {
    output[key] = cleanDiscordId(source[key]);
  }

  if (!output.messageDelete) output.messageDelete = legacyMessage;
  if (!output.messageEdit) output.messageEdit = legacyMessage;
  return output;
}

function normalizeEvents(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const output = defaultEvents();
  for (const key of EVENT_KEYS) {
    output[key] = source[key] !== false;
  }
  return output;
}

function normalizeSettings(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const defaults = defaultSettings();
  return {
    ...defaults,
    ...clone(source),
    useWebhooks: source.useWebhooks !== false,
    ignoreEmbeds: source.ignoreEmbeds === true,
    applyIgnoreToUsersInVoice: source.applyIgnoreToUsersInVoice === true,
    logDeletedPollsWithMessageDelete: source.logDeletedPollsWithMessageDelete !== false,
    logDeletedStickyMessages: source.logDeletedStickyMessages !== false,
    logDeletedForwardedMessages: source.logDeletedForwardedMessages !== false,
    logUnrecognizableMessageDeletions: source.logUnrecognizableMessageDeletions === true,
    includeTimestamps: source.includeTimestamps !== false,
    includeActor: source.includeActor !== false,
    includeReason: source.includeReason !== false,
    ignoredChannels: cleanIdList(source.ignoredChannels),
    ignoredRoles: cleanIdList(source.ignoredRoles),
    ignoredUsers: cleanIdList(source.ignoredUsers),
  };
}

function normalizeAnalytics(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    ...defaultAnalytics(),
    ...clone(source),
    totalSent: Math.max(0, Number(source.totalSent || 0)),
    totalFailed: Math.max(0, Number(source.totalFailed || 0)),
    ignored: Math.max(0, Number(source.ignored || 0)),
    lastLogAt: source.lastLogAt || null,
    lastFailureAt: source.lastFailureAt || null,
    byEvent: source.byEvent && typeof source.byEvent === 'object' && !Array.isArray(source.byEvent)
      ? clone(source.byEvent)
      : {},
  };
}

function normalizeLoggingSection(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const defaults = defaultLoggingSection();
  return {
    ...defaults,
    ...clone(source),
    enabled: source.enabled === true,
    channels: normalizeChannels(source.channels),
    events: normalizeEvents(source.events),
    settings: normalizeSettings(source.settings),
    analytics: normalizeAnalytics(source.analytics),
    createdAt: source.createdAt || defaults.createdAt,
    updatedAt: source.updatedAt || now(),
  };
}

function getLegacyConfig(guildId) {
  const legacy = guildManager.getGuildSection(guildId, 'logs', null);
  return legacy && typeof legacy === 'object' ? legacy : null;
}

function getLoggingSection(guildId) {
  const stored = getModuleSection(guildId, MODULE, null);
  if (stored && typeof stored === 'object' && Object.keys(stored).length) {
    return normalizeLoggingSection(stored);
  }

  const legacy = getLegacyConfig(guildId);
  if (legacy) {
    const migrated = normalizeLoggingSection({ ...legacy, enabled: legacy.enabled !== false });
    saveModuleSection(guildId, MODULE, migrated, { action: 'logging_legacy_migration' });
    return migrated;
  }

  return defaultLoggingSection();
}

function saveLoggingSection(guildId, section, meta = {}) {
  return normalizeLoggingSection(saveModuleSection(guildId, MODULE, normalizeLoggingSection(section), meta));
}

function updateLoggingSection(guildId, updater, meta = {}) {
  return normalizeLoggingSection(updateModuleSection(
    guildId,
    MODULE,
    (current) => {
      const normalized = normalizeLoggingSection(current);
      const next = typeof updater === 'function' ? updater(clone(normalized)) : updater;
      return normalizeLoggingSection(next);
    },
    defaultLoggingSection(),
    meta
  ));
}

function incrementAnalytics(guildId, eventKey, result = 'sent', meta = {}) {
  return updateLoggingSection(guildId, (section) => {
    const analytics = normalizeAnalytics(section.analytics);
    const timestamp = now();
    const byEvent = { ...(analytics.byEvent || {}) };
    byEvent[eventKey] = Math.max(0, Number(byEvent[eventKey] || 0)) + 1;

    if (result === 'failed') {
      analytics.totalFailed += 1;
      analytics.lastFailureAt = timestamp;
    } else if (result === 'ignored') {
      analytics.ignored += 1;
    } else {
      analytics.totalSent += 1;
      analytics.lastLogAt = timestamp;
    }

    return {
      ...section,
      analytics: { ...analytics, byEvent },
      updatedAt: timestamp,
    };
  }, meta).analytics;
}

module.exports = {
  MODULE,
  EVENT_KEYS,
  defaultSettings,
  defaultEvents,
  defaultChannels,
  defaultAnalytics,
  defaultLoggingSection,
  normalizeChannels,
  normalizeEvents,
  normalizeSettings,
  normalizeAnalytics,
  normalizeLoggingSection,
  getLoggingSection,
  saveLoggingSection,
  updateLoggingSection,
  incrementAnalytics,
};
