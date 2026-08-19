'use strict';

// src/modules/utilityStudio/translation/providers/deeplProvider.js

const PROVIDER = 'deepl';
const FREE_URL = 'https://api-free.deepl.com/v2/translate';
const PRO_URL = 'https://api.deepl.com/v2/translate';

function apiKey(settings = {}) {
  return String(settings.apiKey || process.env.DEEPL_API_KEY || '').trim();
}

function apiUrl(settings = {}) {
  if (settings.apiUrl) return String(settings.apiUrl).trim();
  if (process.env.DEEPL_API_URL) return String(process.env.DEEPL_API_URL).trim();
  return apiKey(settings).endsWith(':fx') ? FREE_URL : PRO_URL;
}

function mapLanguage(code = 'en', { source = false } = {}) {
  const clean = String(code || '').trim().toUpperCase().replace(/[^A-Z-]/g, '');
  if (!clean || clean === 'AUTO') return source ? null : 'EN';
  if (clean === 'ZH') return 'ZH';
  if (clean === 'PT') return 'PT-PT';
  return clean;
}

function success(payload = {}) {
  return {
    success: true,
    ok: true,
    provider: PROVIDER,
    ...payload,
  };
}

function failure(errorCode, errorMessage, retryable = false, payload = {}) {
  return {
    success: false,
    ok: false,
    provider: PROVIDER,
    errorCode,
    errorMessage,
    error: errorMessage,
    retryable,
    ...payload,
  };
}

function validateConfig(settings = {}) {
  if (!apiKey(settings)) {
    return failure('MISSING_API_KEY', 'DeepL API key is not configured.', false);
  }

  return success({
    translatedText: '',
    warnings: [],
    meta: {
      apiKeyConfigured: true,
      apiUrl: apiUrl(settings),
    },
  });
}

async function translateText({ text, sourceLanguage = 'auto', targetLanguage = 'en', settings = {} } = {}) {
  const key = apiKey(settings);
  const originalText = String(text || '').trim();

  if (!originalText) {
    return failure('EMPTY_TEXT', 'No text provided.', false, {
      originalText,
      sourceLanguage,
      targetLanguage,
    });
  }

  if (!key) {
    return failure('MISSING_API_KEY', 'DeepL API key is not configured.', false, {
      originalText,
      sourceLanguage,
      targetLanguage,
    });
  }

  const body = new URLSearchParams();
  body.set('auth_key', key);
  body.append('text', originalText);
  body.set('target_lang', mapLanguage(targetLanguage));
  body.set('preserve_formatting', '1');

  const mappedSource = mapLanguage(sourceLanguage, { source: true });
  if (mappedSource) body.set('source_lang', mappedSource);

  const response = await fetch(apiUrl(settings), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    data = null;
  }

  if (!response.ok) {
    const status = response.status;
    const message = data?.message || `DeepL request failed with status ${status}.`;

    if (status === 401 || status === 403) {
      return failure('INVALID_API_KEY', message, false, { originalText, sourceLanguage, targetLanguage });
    }

    if (status === 456 || status === 429) {
      return failure('RATE_LIMITED', message, true, { originalText, sourceLanguage, targetLanguage });
    }

    if (status === 400) {
      return failure('UNSUPPORTED_LANGUAGE', message, false, { originalText, sourceLanguage, targetLanguage });
    }

    return failure('PROVIDER_UNAVAILABLE', message, status >= 500, {
      originalText,
      sourceLanguage,
      targetLanguage,
    });
  }

  const translation = data?.translations?.[0];
  const translatedText = String(translation?.text || '').trim();

  if (!translatedText) {
    return failure('TRANSLATION_FAILED', 'DeepL returned an empty translation.', true, {
      originalText,
      sourceLanguage,
      targetLanguage,
    });
  }

  return success({
    translatedText,
    originalText,
    sourceLanguage,
    targetLanguage,
    detectedLanguage: translation?.detected_source_language?.toLowerCase() || null,
    warnings: [],
    meta: {
      apiUrl: apiUrl(settings),
    },
  });
}

module.exports = {
  id: PROVIDER,
  validateConfig,
  translateText,
};
