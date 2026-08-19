'use strict';

// src/modules/utilityStudio/translation/translationStore.js
// Stores all translation config in modules.translation through guildManager/moduleSectionManager.

const guildManager = require('../../../core/guild/guildManager');
const {
  getModuleSection,
  saveModuleSection,
  updateModuleSection,
} = require('../../../core/guild/moduleSectionManager');

const MODULE = 'translation';

const SUPPORTED_PROVIDERS = Object.freeze([
  'manual',
  'openai',
  'deepl',
  'google',
]);

function now() {
  return new Date().toISOString();
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value, fallback = '', maxLength = 500) {
  const text = String(value ?? fallback).trim();
  return (text || fallback).slice(0, maxLength);
}

function cleanLanguageCode(value, fallback = 'en') {
  const code = String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z-]/g, '')
    .slice(0, 12);

  return code || fallback;
}

function cleanProvider(value, fallback = 'manual') {
  const provider = String(value || fallback).trim().toLowerCase();
  return SUPPORTED_PROVIDERS.includes(provider) ? provider : fallback;
}

function cleanDiscordId(value) {
  const id = String(value || '').replace(/[<@#!&>]/g, '').trim();
  return /^\d{15,25}$/.test(id) ? id : null;
}

function cleanIdMap(value = {}) {
  if (!isPlainObject(value)) return {};

  return Object.fromEntries(
    Object.entries(value)
      .map(([id, config]) => [cleanDiscordId(id), config])
      .filter(([id]) => Boolean(id))
  );
}

function cleanLanguageList(value, fallback = ['en']) {
  const list = Array.isArray(value) ? value : fallback;
  return [...new Set(list.map((code) => cleanLanguageCode(code)).filter(Boolean))].slice(0, 10);
}

function normalizeProviderSettings(settings = {}) {
  const source = isPlainObject(settings) ? settings : {};

  return {
    openai: {
      enabled: source.openai?.enabled !== false,
      model: cleanString(source.openai?.model || process.env.OPENAI_TRANSLATION_MODEL || 'gpt-4o-mini', 'gpt-4o-mini', 80),
      apiKeyConfigured: Boolean(process.env.OPENAI_API_KEY || source.openai?.apiKeyConfigured === true),
    },
    deepl: {
      enabled: source.deepl?.enabled !== false,
      apiKeyConfigured: Boolean(process.env.DEEPL_API_KEY || source.deepl?.apiKeyConfigured === true),
    },
    google: {
      enabled: source.google?.enabled !== false,
      apiKeyConfigured: Boolean(process.env.GOOGLE_TRANSLATE_API_KEY || source.google?.apiKeyConfigured === true),
    },
    fallbackOrder: Array.isArray(source.fallbackOrder)
      ? source.fallbackOrder.map((provider) => cleanProvider(provider, null)).filter(Boolean).filter((provider) => provider !== 'manual')
      : [],
  };
}

function defaultTranslationSection() {
  const providerSettings = normalizeProviderSettings();

  return {
    provider: 'manual',
    providerSettings,
    settings: {
      provider: 'manual',
      providerSettings,
      autoDetect: true,
      threadMode: true,
      translateEdits: false,
      defaultSourceLanguage: 'auto',
      defaultTargetLanguage: 'en',
      targetLanguages: ['en'],
      maxCharacters: 1500,
      cooldownMs: 10000,
      createThreadForManual: true,
      createThreadForAuto: true,
      logTranslations: true,
    },
    languages: ['en'],
    channels: {},
    threadChannels: {},
    threadMappings: {},
    userPreferences: {},
    cache: {},
    logs: [],
    analytics: {
      manualTranslations: 0,
      autoTranslations: 0,
      threadsCreated: 0,
      failedTranslations: 0,
      threadChannelsCreated: 0,
      threadTranslations: 0,
      threadRecoveries: 0,
      threadFailures: 0,
    },
    createdAt: now(),
    updatedAt: now(),
  };
}

function normalizeChannelConfig(config = {}) {
  const source = isPlainObject(config) ? config : {};

  return {
    enabled: source.enabled !== false,
    mode: ['manual', 'auto', 'disabled'].includes(source.mode) ? source.mode : 'manual',
    threadMode: source.threadMode !== false,
    autoCreateThreads: source.autoCreateThreads !== false,
    autoDetect: source.autoDetect !== false,
    sourceLanguage: cleanLanguageCode(source.sourceLanguage || 'auto', 'auto'),
    targetLanguages: cleanLanguageList(source.targetLanguages || source.languages || ['en']),
    languages: cleanLanguageList(source.languages || source.targetLanguages || ['en']),
    ignoredRoleIds: Array.isArray(source.ignoredRoleIds)
      ? source.ignoredRoleIds.map(cleanDiscordId).filter(Boolean)
      : [],
    createdAt: source.createdAt || now(),
    updatedAt: source.updatedAt || source.createdAt || now(),
  };
}

function normalizeThreadMapping(mapping = {}) {
  const source = isPlainObject(mapping) ? mapping : {};

  return {
    threadId: cleanDiscordId(source.threadId),
    languageCode: cleanLanguageCode(source.languageCode || 'en'),
    threadName: cleanString(source.threadName || '', '', 100),
    active: source.active !== false,
    archived: source.archived === true,
    locked: source.locked === true,
    lastMessageId: cleanDiscordId(source.lastMessageId),
    lastTranslatedMessageId: cleanDiscordId(source.lastTranslatedMessageId),
    lastTranslatedAt: source.lastTranslatedAt || null,
    recoveredAt: source.recoveredAt || null,
    createdAt: source.createdAt || now(),
    updatedAt: source.updatedAt || now(),
  };
}

function normalizeThreadMappings(value = {}) {
  const normalized = {};

  for (const [channelId, mappings] of Object.entries(cleanIdMap(value))) {
    if (!isPlainObject(mappings)) continue;
    normalized[channelId] = {};

    for (const [languageCode, mapping] of Object.entries(mappings)) {
      const safeLanguage = cleanLanguageCode(languageCode || mapping?.languageCode || 'en');
      normalized[channelId][safeLanguage] = normalizeThreadMapping({
        ...mapping,
        languageCode: safeLanguage,
      });
    }
  }

  return normalized;
}

function normalizeUserPreference(preference = {}) {
  const source = isPlainObject(preference) ? preference : {};

  return {
    enabled: source.enabled !== false,
    preferredLanguage: cleanLanguageCode(source.preferredLanguage || 'en'),
    autoTranslateDMs: source.autoTranslateDMs === true,
    updatedAt: source.updatedAt || now(),
  };
}

function normalizeTranslationSection(section = {}) {
  const base = defaultTranslationSection();
  const source = isPlainObject(section) ? section : {};
  const rawSettings = isPlainObject(source.settings) ? source.settings : {};

  const provider = cleanProvider(source.provider || rawSettings.provider || base.provider);
  const providerSettings = normalizeProviderSettings({
    ...(isPlainObject(rawSettings.providerSettings) ? rawSettings.providerSettings : {}),
    ...(isPlainObject(source.providerSettings) ? source.providerSettings : {}),
  });

  const normalized = {
    ...base,
    ...clone(source),
    provider,
    providerSettings,
    settings: {
      ...base.settings,
      ...clone(rawSettings),
      provider,
      providerSettings,
      autoDetect: rawSettings.autoDetect !== false,
      threadMode: rawSettings.threadMode !== false,
      translateEdits: rawSettings.translateEdits === true,
      defaultSourceLanguage: cleanLanguageCode(rawSettings.defaultSourceLanguage || 'auto', 'auto'),
      defaultTargetLanguage: cleanLanguageCode(rawSettings.defaultTargetLanguage || 'en'),
      targetLanguages: cleanLanguageList(rawSettings.targetLanguages || source.languages || ['en']),
      maxCharacters: Math.min(Math.max(Number(rawSettings.maxCharacters || 1500), 100), 4000),
      cooldownMs: Math.min(Math.max(Number(rawSettings.cooldownMs || 10000), 0), 300000),
      createThreadForManual: rawSettings.createThreadForManual !== false,
      createThreadForAuto: rawSettings.createThreadForAuto !== false,
      logTranslations: rawSettings.logTranslations !== false,
    },
    languages: cleanLanguageList(source.languages || rawSettings.targetLanguages || ['en']),
    channels: Object.fromEntries(
      Object.entries(cleanIdMap(source.channels || {})).map(([channelId, config]) => [
        channelId,
        normalizeChannelConfig(config),
      ])
    ),
    threadChannels: Object.fromEntries(
      Object.entries(cleanIdMap(source.threadChannels || source.channels || {})).map(([channelId, config]) => [
        channelId,
        normalizeChannelConfig(config),
      ])
    ),
    threadMappings: normalizeThreadMappings(source.threadMappings || {}),
    userPreferences: Object.fromEntries(
      Object.entries(cleanIdMap(source.userPreferences || {})).map(([userId, preference]) => [
        userId,
        normalizeUserPreference(preference),
      ])
    ),
    cache: isPlainObject(source.cache) ? clone(source.cache) : {},
    logs: Array.isArray(source.logs) ? source.logs.slice(-100) : [],
    analytics: {
      ...clone(source.analytics || {}),
      manualTranslations: Math.max(0, Number(source.analytics?.manualTranslations || 0)),
      autoTranslations: Math.max(0, Number(source.analytics?.autoTranslations || 0)),
      threadsCreated: Math.max(0, Number(source.analytics?.threadsCreated || 0)),
      failedTranslations: Math.max(0, Number(source.analytics?.failedTranslations || 0)),
      threadChannelsCreated: Math.max(0, Number(source.analytics?.threadChannelsCreated || 0)),
      threadTranslations: Math.max(0, Number(source.analytics?.threadTranslations || 0)),
      threadRecoveries: Math.max(0, Number(source.analytics?.threadRecoveries || 0)),
      threadFailures: Math.max(0, Number(source.analytics?.threadFailures || 0)),
    },
    createdAt: source.createdAt || base.createdAt,
    updatedAt: source.updatedAt || now(),
  };
  delete normalized.enabled;
  return normalized;
}

function getTranslationSection(guildId) {
  return normalizeTranslationSection(getModuleSection(guildId, MODULE, defaultTranslationSection()));
}

function saveTranslationSection(guildId, section, guildOrMeta = {}) {
  return normalizeTranslationSection(saveModuleSection(guildId, MODULE, normalizeTranslationSection(section), guildOrMeta));
}

function updateTranslationSection(guildId, updater, guildOrMeta = {}) {
  return normalizeTranslationSection(updateModuleSection(
    guildId,
    MODULE,
    (current) => {
      const normalized = normalizeTranslationSection(current);
      const next = typeof updater === 'function' ? updater(clone(normalized)) : updater;
      return normalizeTranslationSection(next);
    },
    defaultTranslationSection(),
    guildOrMeta
  ));
}

function setTranslationEnabled(guildId, enabled = true, guildOrMeta = {}) {
  guildManager.setModuleEnabled(guildId, MODULE, enabled === true, guildOrMeta);
  return { ...getTranslationSection(guildId), enabled: guildManager.isModuleEnabled(guildId, MODULE) };
}

function saveChannelConfig(guildId, channelId, config = {}, guildOrMeta = {}) {
  const safeChannelId = cleanDiscordId(channelId);
  if (!safeChannelId) throw new Error('Invalid channel ID.');

  return updateTranslationSection(guildId, (section) => {
    const normalizedConfig = normalizeChannelConfig({
      ...(section.channels[safeChannelId] || {}),
      ...config,
      updatedAt: now(),
    });

    return {
      ...section,
      channels: {
        ...section.channels,
        [safeChannelId]: normalizedConfig,
      },
      threadChannels: {
        ...section.threadChannels,
        [safeChannelId]: normalizedConfig,
      },
      languages: cleanLanguageList([
        ...(section.languages || []),
        ...(normalizedConfig.languages || normalizedConfig.targetLanguages || []),
      ]),
      updatedAt: now(),
    };
  }, guildOrMeta).channels[safeChannelId];
}

function saveThreadMapping(guildId, sourceChannelId, languageCode, mapping = {}, guildOrMeta = {}) {
  const safeChannelId = cleanDiscordId(sourceChannelId);
  const safeLanguage = cleanLanguageCode(languageCode);

  if (!safeChannelId) throw new Error('Invalid source channel ID.');

  return updateTranslationSection(guildId, (section) => ({
    ...section,
    threadMappings: {
      ...section.threadMappings,
      [safeChannelId]: {
        ...(section.threadMappings?.[safeChannelId] || {}),
        [safeLanguage]: normalizeThreadMapping({
          ...(section.threadMappings?.[safeChannelId]?.[safeLanguage] || {}),
          ...mapping,
          languageCode: safeLanguage,
          updatedAt: now(),
        }),
      },
    },
    updatedAt: now(),
  }), guildOrMeta).threadMappings[safeChannelId][safeLanguage];
}

function saveUserPreference(guildId, userId, preference = {}, guildOrMeta = {}) {
  const safeUserId = cleanDiscordId(userId);
  if (!safeUserId) throw new Error('Invalid user ID.');

  return updateTranslationSection(guildId, (section) => ({
    ...section,
    userPreferences: {
      ...section.userPreferences,
      [safeUserId]: normalizeUserPreference({
        ...(section.userPreferences[safeUserId] || {}),
        ...preference,
        updatedAt: now(),
      }),
    },
    updatedAt: now(),
  }), guildOrMeta).userPreferences[safeUserId];
}

function incrementAnalytics(guildId, increments = {}, guildOrMeta = {}) {
  return updateTranslationSection(guildId, (section) => {
    const analytics = { ...section.analytics };

    for (const [key, amount] of Object.entries(increments || {})) {
      const value = Number(amount || 0);
      if (!Number.isFinite(value)) continue;
      analytics[key] = Math.max(0, Number(analytics[key] || 0) + value);
    }

    return {
      ...section,
      analytics,
      updatedAt: now(),
    };
  }, guildOrMeta).analytics;
}

function addTranslationLog(guildId, entry = {}, guildOrMeta = {}) {
  return updateTranslationSection(guildId, (section) => ({
    ...section,
    logs: [
      ...(section.logs || []),
      {
        ...(isPlainObject(entry) ? clone(entry) : { message: String(entry) }),
        createdAt: now(),
      },
    ].slice(-100),
    updatedAt: now(),
  }), guildOrMeta).logs;
}

function setProvider(guildId, provider = 'manual', guildOrMeta = {}) {
  const safeProvider = cleanProvider(provider);

  return updateTranslationSection(guildId, (section) => ({
    ...section,
    provider: safeProvider,
    settings: {
      ...section.settings,
      provider: safeProvider,
    },
    updatedAt: now(),
  }), guildOrMeta);
}

function saveProviderSettings(guildId, provider, settings = {}, guildOrMeta = {}) {
  const safeProvider = cleanProvider(provider, null);
  if (!safeProvider || safeProvider === 'manual') throw new Error('Invalid translation provider.');

  return updateTranslationSection(guildId, (section) => ({
    ...section,
    providerSettings: normalizeProviderSettings({
      ...section.providerSettings,
      [safeProvider]: {
        ...(section.providerSettings?.[safeProvider] || {}),
        ...(isPlainObject(settings) ? settings : {}),
      },
    }),
    updatedAt: now(),
  }), guildOrMeta);
}

module.exports = {
  MODULE,
  SUPPORTED_PROVIDERS,
  defaultTranslationSection,
  normalizeTranslationSection,
  normalizeChannelConfig,
  normalizeUserPreference,
  normalizeProviderSettings,
  getTranslationSection,
  saveTranslationSection,
  updateTranslationSection,
  setTranslationEnabled,
  saveChannelConfig,
  saveThreadMapping,
  saveUserPreference,
  incrementAnalytics,
  addTranslationLog,
  setProvider,
  saveProviderSettings,
};