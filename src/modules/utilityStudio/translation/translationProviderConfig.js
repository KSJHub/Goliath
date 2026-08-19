'use strict';

const translationStore = require('./translationStore');
const translationProviderManager = require('./translationProviderManager');

const PROVIDER_LABELS = Object.freeze({
  manual: 'Manual / Not configured',
  openai: 'OpenAI',
  deepl: 'DeepL',
  google: 'Google Translate',
});

const ENV_KEYS = Object.freeze({
  openai: 'OPENAI_API_KEY',
  deepl: 'DEEPL_API_KEY',
  google: 'GOOGLE_TRANSLATE_API_KEY',
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanLanguageCode(value, fallback = 'en') {
  const clean = String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z-]/g, '')
    .slice(0, 12);
  return clean || fallback;
}

function envKeyConfigured(provider) {
  const envKey = ENV_KEYS[provider];
  return Boolean(envKey && process.env[envKey]);
}

function providerStatusCode(provider, providerInfo = {}) {
  if (provider === 'manual') return 'not_configured';
  if (providerInfo.healthy === true) return 'ready';
  if (providerInfo.errorCode === translationProviderManager.ERROR_CODES.MISSING_API_KEY) return 'missing_api_key';
  if (providerInfo.enabled === false) return 'disabled';
  return providerInfo.errorCode ? 'error' : 'not_configured';
}

function getProviderStatus(guildId) {
  const section = translationStore.getTranslationSection(guildId);
  const selectedProvider = translationProviderManager.getConfiguredProvider(section);
  const liveStatus = translationProviderManager.getProviderStatus(section);
  const selectedInfo = liveStatus.providers?.[selectedProvider] || {};

  const supportedProviders = translationProviderManager.listProviders().map((providerMeta) => {
    const id = translationProviderManager.normalizeProvider(providerMeta.id);
    const providerInfo = liveStatus.providers?.[id] || {};
    return {
      ...providerMeta,
      id,
      label: PROVIDER_LABELS[id] || providerMeta.label || id,
      enabled: id === 'manual' ? false : providerInfo.enabled !== false,
      selected: id === selectedProvider,
      healthy: id !== 'manual' && providerInfo.healthy === true,
      ready: id !== 'manual' && providerInfo.healthy === true,
      status: providerStatusCode(id, providerInfo),
      apiKeyConfigured: id === 'manual'
        ? false
        : envKeyConfigured(id) || providerInfo.apiKeyConfigured === true,
      errorCode: providerInfo.errorCode || null,
      errorMessage: providerInfo.errorMessage || null,
    };
  });

  return {
    provider: selectedProvider,
    selectedProvider,
    label: PROVIDER_LABELS[selectedProvider] || selectedProvider,
    defaultLanguage: section.settings?.defaultTargetLanguage || 'en',
    defaultTargetLanguage: section.settings?.defaultTargetLanguage || 'en',
    sourceLanguage: section.settings?.defaultSourceLanguage || 'auto',
    defaultSourceLanguage: section.settings?.defaultSourceLanguage || 'auto',
    apiKeyConfigured: selectedProvider === 'manual'
      ? false
      : envKeyConfigured(selectedProvider) || selectedInfo.apiKeyConfigured === true,
    ready: selectedProvider !== 'manual' && selectedInfo.healthy === true,
    healthy: selectedProvider !== 'manual' && selectedInfo.healthy === true,
    status: providerStatusCode(selectedProvider, selectedInfo),
    errorCode: selectedInfo.errorCode || null,
    errorMessage: selectedInfo.errorMessage || null,
    providers: liveStatus.providers || {},
    supportedProviders,
  };
}

function sanitizeProviderSettings(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const rawProviderSettings = isPlainObject(source.providerSettings)
    ? source.providerSettings
    : isPlainObject(source.settings?.providerSettings)
      ? source.settings.providerSettings
      : {};
  const provider = translationProviderManager.normalizeProvider(source.provider || source.settings?.provider);
  const defaultTargetLanguage = cleanLanguageCode(
    source.defaultLanguage || source.defaultTargetLanguage || source.settings?.defaultTargetLanguage,
    'en'
  );
  const defaultSourceLanguage = cleanLanguageCode(
    source.sourceLanguage || source.defaultSourceLanguage || source.settings?.defaultSourceLanguage,
    'auto'
  );

  const providerSettings = {
    openai: {
      enabled: rawProviderSettings.openai?.enabled !== false,
      model: String(rawProviderSettings.openai?.model || process.env.OPENAI_TRANSLATION_MODEL || 'gpt-4o-mini')
        .trim()
        .slice(0, 80) || 'gpt-4o-mini',
      apiKeyConfigured: envKeyConfigured('openai') || rawProviderSettings.openai?.apiKeyConfigured === true,
    },
    deepl: {
      enabled: rawProviderSettings.deepl?.enabled !== false,
      apiKeyConfigured: envKeyConfigured('deepl') || rawProviderSettings.deepl?.apiKeyConfigured === true,
    },
    google: {
      enabled: rawProviderSettings.google?.enabled !== false,
      apiKeyConfigured: envKeyConfigured('google') || rawProviderSettings.google?.apiKeyConfigured === true,
    },
    fallbackOrder: Array.isArray(rawProviderSettings.fallbackOrder)
      ? rawProviderSettings.fallbackOrder
        .map(translationProviderManager.normalizeProvider)
        .filter((fallbackProvider) => fallbackProvider !== 'manual' && fallbackProvider !== provider)
        .filter((fallbackProvider, index, providers) => providers.indexOf(fallbackProvider) === index)
      : [],
  };

  return { provider, defaultTargetLanguage, defaultSourceLanguage, providerSettings };
}

function saveProviderConfig(guildId, input = {}) {
  const settings = sanitizeProviderSettings(input);
  return translationStore.updateTranslationSection(guildId, (section) => ({
    ...section,
    provider: settings.provider,
    providerSettings: {
      ...(section.providerSettings || {}),
      ...settings.providerSettings,
    },
    settings: {
      ...(section.settings || {}),
      provider: settings.provider,
      providerSettings: {
        ...(section.settings?.providerSettings || section.providerSettings || {}),
        ...settings.providerSettings,
      },
      defaultTargetLanguage: settings.defaultTargetLanguage,
      defaultSourceLanguage: settings.defaultSourceLanguage,
    },
    languages: Array.from(new Set([
      ...(section.languages || []),
      settings.defaultTargetLanguage,
    ])).filter(Boolean),
    updatedAt: new Date().toISOString(),
  }));
}

module.exports = {
  PROVIDER_LABELS,
  getProviderStatus,
  sanitizeProviderSettings,
  saveProviderConfig,
};
