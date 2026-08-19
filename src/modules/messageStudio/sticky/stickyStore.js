'use strict';

const {
  getModuleSection,
  saveModuleSection,
} = require('../../../core/guild/moduleSectionManager');
const guildManager = require('../../../core/guild/guildManager');

const MODULE_KEY = 'sticky';

function now() {
  return new Date().toISOString();
}

function cleanDiscordId(value) {
  const id = String(value || '').replace(/[<@&#!>]/g, '').trim();
  return /^\d{15,25}$/.test(id) ? id : null;
}

function cleanIdArray(value) {
  return Array.isArray(value) ? [...new Set(value.map(cleanDiscordId).filter(Boolean))] : [];
}

function pickNumber(value, fallback, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === null || value === undefined || value === '') return Number(fallback);
  const parsed = Number(value);
  const number = Number.isFinite(parsed) ? parsed : Number(fallback);
  return Math.min(maximum, Math.max(minimum, Math.floor(number)));
}

function defaultStickySection() {
  return {
    channels: {},
    managerRoleIds: [],
    defaultContent: '📌 Sticky message configured by Goliath.',
    repostEvery: 10,
    cooldownSeconds: 60,
    cleanupPrevious: true,
    allowEmbeds: true,
    mode: 'per-channel',
    analytics: {
      deployed: 0,
      refreshed: 0,
      cleaned: 0,
      removed: 0,
    },
    createdAt: now(),
    updatedAt: now(),
  };
}

function normalizeSticky(channelId, input = {}, defaults = {}) {
  const id = cleanDiscordId(channelId || input.channelId);
  if (!id) return null;

  const type = input.type === 'embed' ? 'embed' : 'text';
  return {
    enabled: input.enabled !== false,
    channelId: id,
    type,
    content: String(input.content ?? defaults.defaultContent ?? '').trim().slice(0, 1800),
    embed: input.embed && typeof input.embed === 'object' ? input.embed : null,
    repostEvery: pickNumber(input.repostEvery, defaults.repostEvery ?? 10, 1, 100),
    cooldownSeconds: pickNumber(input.cooldownSeconds, defaults.cooldownSeconds ?? 60, 0, 3600),
    messageCount: pickNumber(input.messageCount, 0, 0),
    lastMessageId: cleanDiscordId(input.lastMessageId),
    lastPostedAt: input.lastPostedAt || null,
    createdBy: cleanDiscordId(input.createdBy),
    updatedBy: cleanDiscordId(input.updatedBy),
    createdAt: input.createdAt || now(),
    updatedAt: input.updatedAt || input.createdAt || now(),
  };
}

function normalizeSection(section = {}) {
  const base = defaultStickySection();
  const source = section && typeof section === 'object' ? section : {};
  const defaults = {
    defaultContent: String(source.defaultContent || source.message || base.defaultContent).trim().slice(0, 1800),
    repostEvery: pickNumber(source.repostEvery, base.repostEvery, 1, 100),
    cooldownSeconds: pickNumber(source.cooldownSeconds, base.cooldownSeconds, 0, 3600),
  };
  const rawChannels = source.channels && typeof source.channels === 'object' && !Array.isArray(source.channels)
    ? source.channels
    : {};

  const normalized = {
    ...base,
    ...source,
    channels: Object.fromEntries(Object.entries(rawChannels)
      .map(([channelId, sticky]) => normalizeSticky(channelId, sticky, defaults))
      .filter(Boolean)
      .map((sticky) => [sticky.channelId, sticky])),
    managerRoleIds: cleanIdArray(source.managerRoleIds),
    defaultContent: defaults.defaultContent,
    repostEvery: defaults.repostEvery,
    cooldownSeconds: defaults.cooldownSeconds,
    cleanupPrevious: source.cleanupPrevious !== false,
    allowEmbeds: source.allowEmbeds !== false,
    mode: source.mode === 'manual' ? 'manual' : 'per-channel',
    analytics: {
      deployed: Math.max(0, Number(source.analytics?.deployed || 0)),
      refreshed: Math.max(0, Number(source.analytics?.refreshed || 0)),
      cleaned: Math.max(0, Number(source.analytics?.cleaned || 0)),
      removed: Math.max(0, Number(source.analytics?.removed || 0)),
    },
    createdAt: source.createdAt || now(),
    updatedAt: source.updatedAt || now(),
  };
  delete normalized.enabled;
  return normalized;
}

function isEnabled(guildId) {
  return guildManager.isModuleEnabled(guildId, MODULE_KEY) === true;
}

function setEnabled(guildId, enabled, guildOrMeta = {}) {
  return guildManager.setModuleEnabled(guildId, MODULE_KEY, enabled === true, guildOrMeta);
}

function loadStickyData(guildId) {
  return normalizeSection(getModuleSection(guildId, MODULE_KEY, defaultStickySection()));
}

function saveStickyData(guildId, data, meta = {}) {
  return normalizeSection(saveModuleSection(guildId, MODULE_KEY, normalizeSection(data), meta));
}

function exportConfiguration(guildId) {
  return {
    ...loadStickyData(guildId),
    enabled: isEnabled(guildId),
  };
}

function getChannelSticky(guildId, channelId) {
  const id = cleanDiscordId(channelId);
  return id ? loadStickyData(guildId).channels[id] || null : null;
}

function setChannelSticky(guildId, channelId, sticky = {}, meta = {}) {
  const data = loadStickyData(guildId);
  const id = cleanDiscordId(channelId);
  if (!id) throw new Error('A valid channel ID is required.');
  const existing = data.channels[id] || {};
  const normalized = normalizeSticky(id, {
    ...existing,
    ...sticky,
    enabled: true,
    createdAt: existing.createdAt,
    createdBy: existing.createdBy || sticky.updatedBy,
    updatedAt: now(),
  }, data);
  data.channels[id] = normalized;
  data.updatedAt = now();
  saveStickyData(guildId, data, meta);
  return normalized;
}

function updateChannelSticky(guildId, channelId, updates = {}, meta = {}) {
  const data = loadStickyData(guildId);
  const id = cleanDiscordId(channelId);
  const existing = id ? data.channels[id] : null;
  if (!existing) return null;
  const normalized = normalizeSticky(id, { ...existing, ...updates, updatedAt: now() }, data);
  data.channels[id] = normalized;
  data.updatedAt = now();
  saveStickyData(guildId, data, meta);
  return normalized;
}

function deleteChannelSticky(guildId, channelId, meta = {}) {
  const data = loadStickyData(guildId);
  const id = cleanDiscordId(channelId);
  const existing = id ? data.channels[id] || null : null;
  if (!existing) return null;
  delete data.channels[id];
  data.analytics.removed += 1;
  data.updatedAt = now();
  saveStickyData(guildId, data, meta);
  return existing;
}

function incrementAnalytics(guildId, changes = {}, meta = {}) {
  const data = loadStickyData(guildId);
  for (const key of ['deployed', 'refreshed', 'cleaned', 'removed']) {
    data.analytics[key] = Math.max(0, Number(data.analytics[key] || 0) + Math.max(0, Number(changes[key] || 0)));
  }
  data.updatedAt = now();
  saveStickyData(guildId, data, meta);
  return data.analytics;
}

module.exports = {
  MODULE_KEY,
  now,
  defaultStickySection,
  normalizeSection,
  isEnabled,
  setEnabled,
  loadStickyData,
  saveStickyData,
  exportConfiguration,
  getChannelSticky,
  setChannelSticky,
  updateChannelSticky,
  deleteChannelSticky,
  incrementAnalytics,
};
