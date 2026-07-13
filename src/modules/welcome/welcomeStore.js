'use strict';

const {
  getModuleSection,
  saveModuleSection,
  updateModuleSection,
} = require('../../core/guild/moduleSectionManager');

const MODULE = 'welcome';

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
    publicSent: 0,
    publicFailed: 0,
    dmSent: 0,
    dmFailed: 0,
    skipped: 0,
    lastPublicSentAt: null,
    lastDmSentAt: null,
    lastFailedAt: null,
  };
}

function defaultWelcomeSection() {
  return {
    enabled: false,
    channelId: null,
    templateId: 'welcome_default',
    dmEnabled: false,
    dmTemplateId: 'dm_welcome_default',
    allowUserPing: true,
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
    publicSent: cleanCount(source.publicSent),
    publicFailed: cleanCount(source.publicFailed),
    dmSent: cleanCount(source.dmSent),
    dmFailed: cleanCount(source.dmFailed),
    skipped: cleanCount(source.skipped),
    lastPublicSentAt: cleanDate(source.lastPublicSentAt),
    lastDmSentAt: cleanDate(source.lastDmSentAt),
    lastFailedAt: cleanDate(source.lastFailedAt),
  };
}

function normalizeWelcomeSection(section = {}) {
  const base = defaultWelcomeSection();
  const source = section && typeof section === 'object' ? section : {};
  const channelId = cleanDiscordId(source.channelId || source.welcomeChannelId);

  return {
    ...base,
    ...clone(source),
    enabled: source.enabled === true || (source.enabled !== false && Boolean(channelId)),
    channelId,
    templateId: cleanString(source.templateId || base.templateId, base.templateId, 120),
    dmEnabled: source.dmEnabled === true || source.sendDm === true,
    dmTemplateId: cleanString(source.dmTemplateId || base.dmTemplateId, base.dmTemplateId, 120),
    allowUserPing: source.allowUserPing !== false,
    ignoreBots: source.ignoreBots !== false,
    analytics: normalizeAnalytics(source.analytics),
    createdAt: source.createdAt || base.createdAt,
    updatedAt: source.updatedAt || now(),
  };
}

function getWelcomeSection(guildId) {
  return normalizeWelcomeSection(getModuleSection(guildId, MODULE, defaultWelcomeSection()));
}

function saveWelcomeSection(guildId, section, meta = {}) {
  return normalizeWelcomeSection(saveModuleSection(guildId, MODULE, normalizeWelcomeSection(section), meta));
}

function updateWelcomeSection(guildId, updater, meta = {}) {
  return normalizeWelcomeSection(updateModuleSection(
    guildId,
    MODULE,
    (current) => {
      const normalized = normalizeWelcomeSection(current);
      const next = typeof updater === 'function' ? updater(clone(normalized)) : updater;
      return normalizeWelcomeSection(next);
    },
    defaultWelcomeSection(),
    meta
  ));
}

function updateConfig(guildId, patch = {}, meta = {}) {
  return updateWelcomeSection(guildId, (section) => ({
    ...section,
    ...patch,
    channelId: patch.channelId === undefined ? section.channelId : cleanDiscordId(patch.channelId),
    templateId: patch.templateId === undefined ? section.templateId : cleanString(patch.templateId, section.templateId, 120),
    dmTemplateId: patch.dmTemplateId === undefined ? section.dmTemplateId : cleanString(patch.dmTemplateId, section.dmTemplateId, 120),
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : section.enabled,
    dmEnabled: typeof patch.dmEnabled === 'boolean' ? patch.dmEnabled : section.dmEnabled,
    allowUserPing: typeof patch.allowUserPing === 'boolean' ? patch.allowUserPing : section.allowUserPing,
    ignoreBots: typeof patch.ignoreBots === 'boolean' ? patch.ignoreBots : section.ignoreBots,
    updatedAt: now(),
  }), meta);
}

function incrementAnalytics(guildId, increments = {}, meta = {}) {
  const timestamp = now();
  return updateWelcomeSection(guildId, (section) => {
    const analytics = normalizeAnalytics(section.analytics);
    const next = { ...analytics };
    for (const key of ['publicSent', 'publicFailed', 'dmSent', 'dmFailed', 'skipped']) {
      next[key] = cleanCount(analytics[key] + cleanCount(increments[key]));
    }
    if (cleanCount(increments.publicSent) > 0) next.lastPublicSentAt = timestamp;
    if (cleanCount(increments.dmSent) > 0) next.lastDmSentAt = timestamp;
    if (cleanCount(increments.publicFailed) > 0 || cleanCount(increments.dmFailed) > 0) next.lastFailedAt = timestamp;
    return { ...section, analytics: next, updatedAt: timestamp };
  }, meta).analytics;
}

function resetWelcomeSection(guildId, meta = {}) {
  return saveWelcomeSection(guildId, defaultWelcomeSection(), { action: 'welcome_reset', ...meta });
}

module.exports = {
  MODULE,
  cleanDiscordId,
  defaultAnalytics,
  defaultWelcomeSection,
  normalizeAnalytics,
  normalizeWelcomeSection,
  getWelcomeSection,
  saveWelcomeSection,
  updateWelcomeSection,
  updateConfig,
  incrementAnalytics,
  resetWelcomeSection,
};
