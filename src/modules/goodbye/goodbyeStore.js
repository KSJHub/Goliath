'use strict';

const {
  getModuleSection,
  saveModuleSection,
  updateModuleSection,
} = require('../../core/guild/moduleSectionManager');

const MODULE = 'goodbye';

function now() {
  return new Date().toISOString();
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function cleanDiscordId(value) {
  const id = String(value || '').replace(/[<@&#!>]/g, '').trim();
  return /^\d{15,25}$/.test(id) ? id : null;
}

function cleanString(value, fallback = '', maxLength = 1000) {
  return String(value ?? fallback).trim().slice(0, maxLength);
}

function cleanCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function cleanDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function defaultAnalytics() {
  return {
    sent: 0,
    failed: 0,
    skipped: 0,
    lastSentAt: null,
    lastFailedAt: null,
  };
}

function defaultGoodbyeSection() {
  return {
    enabled: false,
    channelId: null,
    templateId: 'goodbye_default',
    ignoreBots: true,
    analytics: defaultAnalytics(),
    createdAt: now(),
    updatedAt: now(),
  };
}

function normalizeAnalytics(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    ...defaultAnalytics(),
    ...clone(source),
    sent: cleanCount(source.sent),
    failed: cleanCount(source.failed),
    skipped: cleanCount(source.skipped),
    lastSentAt: cleanDate(source.lastSentAt),
    lastFailedAt: cleanDate(source.lastFailedAt),
  };
}

function normalizeGoodbyeSection(section = {}) {
  const base = defaultGoodbyeSection();
  const source = section && typeof section === 'object' ? section : {};
  const channelId = cleanDiscordId(source.channelId || source.leaveChannelId || source.goodbyeChannelId);
  return {
    ...base,
    ...clone(source),
    enabled: source.enabled === true || (source.enabled !== false && Boolean(channelId)),
    channelId,
    templateId: cleanString(source.templateId || base.templateId, base.templateId, 120),
    ignoreBots: source.ignoreBots !== false,
    analytics: normalizeAnalytics(source.analytics),
    createdAt: source.createdAt || base.createdAt,
    updatedAt: source.updatedAt || now(),
  };
}

function getGoodbyeSection(guildId) {
  return normalizeGoodbyeSection(getModuleSection(guildId, MODULE, defaultGoodbyeSection()));
}

function saveGoodbyeSection(guildId, section, meta = {}) {
  return normalizeGoodbyeSection(saveModuleSection(guildId, MODULE, normalizeGoodbyeSection(section), meta));
}

function updateGoodbyeSection(guildId, updater, meta = {}) {
  return normalizeGoodbyeSection(updateModuleSection(
    guildId,
    MODULE,
    (current) => {
      const normalized = normalizeGoodbyeSection(current);
      const next = typeof updater === 'function' ? updater(clone(normalized)) : updater;
      return normalizeGoodbyeSection(next);
    },
    defaultGoodbyeSection(),
    meta
  ));
}

function updateConfig(guildId, patch = {}, meta = {}) {
  return updateGoodbyeSection(guildId, (section) => ({
    ...section,
    ...patch,
    channelId: patch.channelId === undefined ? section.channelId : cleanDiscordId(patch.channelId),
    templateId: patch.templateId === undefined ? section.templateId : cleanString(patch.templateId, section.templateId, 120),
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : section.enabled,
    ignoreBots: typeof patch.ignoreBots === 'boolean' ? patch.ignoreBots : section.ignoreBots,
    updatedAt: now(),
  }), meta);
}

function incrementAnalytics(guildId, increments = {}, meta = {}) {
  const timestamp = now();
  return updateGoodbyeSection(guildId, (section) => {
    const analytics = normalizeAnalytics(section.analytics);
    const next = { ...analytics };
    for (const key of ['sent', 'failed', 'skipped']) {
      next[key] = cleanCount(analytics[key] + cleanCount(increments[key]));
    }
    if (cleanCount(increments.sent) > 0) next.lastSentAt = timestamp;
    if (cleanCount(increments.failed) > 0) next.lastFailedAt = timestamp;
    return { ...section, analytics: next, updatedAt: timestamp };
  }, meta).analytics;
}

function resetGoodbyeSection(guildId, meta = {}) {
  return saveGoodbyeSection(guildId, defaultGoodbyeSection(), { action: 'goodbye_reset', ...meta });
}

module.exports = {
  MODULE,
  cleanDiscordId,
  defaultAnalytics,
  defaultGoodbyeSection,
  normalizeAnalytics,
  normalizeGoodbyeSection,
  getGoodbyeSection,
  saveGoodbyeSection,
  updateGoodbyeSection,
  updateConfig,
  incrementAnalytics,
  resetGoodbyeSection,
};
