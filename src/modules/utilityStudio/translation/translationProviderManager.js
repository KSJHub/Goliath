'use strict';

// src/modules/utilityStudio/translation/translationProviderManager.js
// Central provider router for Goliath Translation.
// All translation features should call this manager instead of calling providers directly.

const openaiProvider = require('./providers/openaiProvider');
const deeplProvider = require('./providers/deeplProvider');
const googleProvider = require('./providers/googleProvider');

const PROVIDER_MANUAL = 'manual';
const SUPPORTED_PROVIDERS = Object.freeze([PROVIDER_MANUAL, 'openai', 'deepl', 'google']);

const ERROR_CODES = Object.freeze({
  MISSING_API_KEY: 'MISSING_API_KEY',
  INVALID_API_KEY: 'INVALID_API_KEY',
  PROVIDER_DISABLED: 'PROVIDER_DISABLED',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  RATE_LIMITED: 'RATE_LIMITED',
  UNSUPPORTED_LANGUAGE: 'UNSUPPORTED_LANGUAGE',
  EMPTY_TEXT: 'EMPTY_TEXT',
  TEXT_TOO_LONG: 'TEXT_TOO_LONG',
  TRANSLATION_FAILED: 'TRANSLATION_FAILED',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
});

const PROVIDERS = Object.freeze({
  openai: openaiProvider,
  deepl: deeplProvider,
  google: googleProvider,
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeProvider(provider = PROVIDER_MANUAL) {
  const clean = String(provider || PROVIDER_MANUAL).trim().toLowerCase();
  return SUPPORTED_PROVIDERS.includes(clean) ? clean : PROVIDER_MANUAL;
}

function getProviderSettings(section = {}, providerName = PROVIDER_MANUAL) {
  const providerSettings = isPlainObject(section.providerSettings) ? section.providerSettings : {};
  const settingsProviderSettings = isPlainObject(section.settings?.providerSettings)
    ? section.settings.providerSettings
    : {};

  return {
    ...(isPlainObject(settingsProviderSettings[providerName]) ? settingsProviderSettings[providerName] : {}),
    ...(isPlainObject(providerSettings[providerName]) ? providerSettings[providerName] : {}),
  };
}

function getConfiguredProvider(section = {}) {
  return normalizeProvider(section.provider || section.settings?.provider || PROVIDER_MANUAL);
}

function createResponse({
  success = false,
  provider = PROVIDER_MANUAL,
  translatedText = null,
  originalText = '',
  sourceLanguage = 'auto',
  targetLanguage = 'en',
  detectedLanguage = null,
  errorCode = null,
  errorMessage = null,
  retryable = false,
  warnings = [],
  meta = {},
} = {}) {
  return {
    success: Boolean(success),
    ok: Boolean(success),
    provider: normalizeProvider(provider),
    originalText: String(originalText || ''),
    translatedText: translatedText == null ? null : String(translatedText),
    sourceLanguage: String(sourceLanguage || 'auto'),
    targetLanguage: String(targetLanguage || 'en'),
    detectedLanguage: detectedLanguage || null,
    errorCode: errorCode || null,
    errorMessage: errorMessage || null,
    error: errorMessage || null,
    retryable: Boolean(retryable),
    warnings: Array.isArray(warnings) ? warnings.filter(Boolean) : [],
    meta: isPlainObject(meta) ? meta : {},
  };
}

function createFailure(provider, errorCode, errorMessage, options = {}) {
  return createResponse({
    success: false,
    provider,
    errorCode,
    errorMessage,
    retryable: options.retryable === true,
    originalText: options.originalText || options.text || '',
    sourceLanguage: options.sourceLanguage || 'auto',
    targetLanguage: options.targetLanguage || 'en',
    warnings: options.warnings || [],
    meta: options.meta || {},
  });
}

function normalizeProviderResult(provider, result, context = {}) {
  if (!isPlainObject(result)) {
    return createFailure(provider, ERROR_CODES.TRANSLATION_FAILED, 'Provider returned an invalid response.', {
      ...context,
      retryable: true,
    });
  }

  if (result.success === true || result.ok === true) {
    return createResponse({
      success: true,
      provider: result.provider || provider,
      translatedText: result.translatedText,
      originalText: result.originalText || context.text || '',
      sourceLanguage: result.sourceLanguage || context.sourceLanguage || 'auto',
      targetLanguage: result.targetLanguage || context.targetLanguage || 'en',
      detectedLanguage: result.detectedLanguage || null,
      warnings: result.warnings || [],
      meta: result.meta || {},
    });
  }

  return createFailure(
    result.provider || provider,
    result.errorCode || ERROR_CODES.TRANSLATION_FAILED,
    result.errorMessage || result.error || 'Translation failed.',
    {
      ...context,
      retryable: result.retryable === true,
      warnings: result.warnings || [],
      meta: result.meta || {},
    }
  );
}

function providerEnabled(section = {}, providerName = PROVIDER_MANUAL) {
  if (providerName === PROVIDER_MANUAL) return false;

  const settings = getProviderSettings(section, providerName);
  return settings.enabled !== false;
}

function validateProviderConfig(section = {}, providerName = getConfiguredProvider(section)) {
  const provider = normalizeProvider(providerName);

  if (provider === PROVIDER_MANUAL) {
    return createFailure(provider, ERROR_CODES.PROVIDER_DISABLED, 'No translation provider is selected.', {
      retryable: false,
    });
  }

  const adapter = PROVIDERS[provider];
  if (!adapter || typeof adapter.validateConfig !== 'function') {
    return createFailure(provider, ERROR_CODES.PROVIDER_UNAVAILABLE, 'Translation provider is not available.', {
      retryable: false,
    });
  }

  if (!providerEnabled(section, provider)) {
    return createFailure(provider, ERROR_CODES.PROVIDER_DISABLED, 'Translation provider is disabled for this server.', {
      retryable: false,
    });
  }

  return normalizeProviderResult(provider, adapter.validateConfig(getProviderSettings(section, provider)), {});
}

function getFallbackProviders(section = {}, selectedProvider = getConfiguredProvider(section)) {
  const rawFallbackOrder = Array.isArray(section.providerSettings?.fallbackOrder)
    ? section.providerSettings.fallbackOrder
    : Array.isArray(section.settings?.providerSettings?.fallbackOrder)
      ? section.settings.providerSettings.fallbackOrder
      : [];

  return rawFallbackOrder
    .map(normalizeProvider)
    .filter((provider) => provider !== PROVIDER_MANUAL && provider !== selectedProvider)
    .filter((provider, index, providers) => providers.indexOf(provider) === index);
}

async function translateWithProvider(provider, section, payload) {
  const validation = validateProviderConfig(section, provider);
  if (!validation.success) return validation;

  const adapter = PROVIDERS[provider];

  try {
    const result = await adapter.translateText({
      ...payload,
      settings: getProviderSettings(section, provider),
    });

    return normalizeProviderResult(provider, result, payload);
  } catch (error) {
    return createFailure(provider, ERROR_CODES.UNKNOWN_ERROR, error?.message || 'Unexpected provider error.', {
      ...payload,
      retryable: true,
    });
  }
}

async function translateText({
  section = {},
  guildId,
  text,
  sourceLanguage = 'auto',
  targetLanguage = 'en',
  options = {},
} = {}) {
  const originalText = String(text || '').trim();
  const selectedProvider = getConfiguredProvider(section);

  if (!originalText) {
    return createFailure(selectedProvider, ERROR_CODES.EMPTY_TEXT, 'No text provided.', {
      originalText,
      sourceLanguage,
      targetLanguage,
    });
  }

  if (selectedProvider === PROVIDER_MANUAL) {
    return createFailure(selectedProvider, ERROR_CODES.PROVIDER_DISABLED, 'Translation provider is not connected yet.', {
      originalText,
      sourceLanguage,
      targetLanguage,
    });
  }

  const basePayload = {
    guildId,
    text: originalText,
    originalText,
    sourceLanguage,
    targetLanguage,
    options,
  };

  const primary = await translateWithProvider(selectedProvider, section, basePayload);
  if (primary.success || primary.retryable !== true) return primary;

  const fallbackProviders = getFallbackProviders(section, selectedProvider)
    .filter((provider) => providerEnabled(section, provider));

  const failures = [primary];

  for (const fallbackProvider of fallbackProviders) {
    const fallback = await translateWithProvider(fallbackProvider, section, basePayload);
    if (fallback.success) {
      return createResponse({
        ...fallback,
        warnings: [
          ...(fallback.warnings || []),
          `Primary provider ${selectedProvider} failed. Used fallback provider ${fallbackProvider}.`,
        ],
        meta: {
          ...(fallback.meta || {}),
          fallbackFrom: selectedProvider,
          providerFailures: failures.map((failure) => ({
            provider: failure.provider,
            errorCode: failure.errorCode,
            errorMessage: failure.errorMessage,
          })),
        },
      });
    }

    failures.push(fallback);
  }

  return createResponse({
    ...primary,
    meta: {
      ...(primary.meta || {}),
      providerFailures: failures.map((failure) => ({
        provider: failure.provider,
        errorCode: failure.errorCode,
        errorMessage: failure.errorMessage,
      })),
    },
  });
}

function getProviderStatus(section = {}) {
  const selectedProvider = getConfiguredProvider(section);

  return {
    selectedProvider,
    providers: Object.fromEntries(
      SUPPORTED_PROVIDERS.filter((provider) => provider !== PROVIDER_MANUAL).map((provider) => {
        const validation = validateProviderConfig(section, provider);
        return [provider, {
          enabled: providerEnabled(section, provider),
          selected: provider === selectedProvider,
          healthy: validation.success === true,
          errorCode: validation.errorCode,
          errorMessage: validation.errorMessage,
          apiKeyConfigured: validation.success === true || validation.errorCode !== ERROR_CODES.MISSING_API_KEY,
        }];
      })
    ),
  };
}

function listProviders() {
  return SUPPORTED_PROVIDERS.map((provider) => ({
    id: provider,
    label: provider === PROVIDER_MANUAL
      ? 'Manual / Not Connected'
      : provider === 'openai'
        ? 'OpenAI'
        : provider === 'deepl'
          ? 'DeepL'
          : 'Google Translate',
    configurable: provider !== PROVIDER_MANUAL,
  }));
}

module.exports = {
  ERROR_CODES,
  SUPPORTED_PROVIDERS,
  createResponse,
  createFailure,
  normalizeProvider,
  getConfiguredProvider,
  getProviderSettings,
  validateProviderConfig,
  getProviderStatus,
  listProviders,
  translateText,
};
