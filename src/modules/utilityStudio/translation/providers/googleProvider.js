'use strict';

// src/modules/utilityStudio/translation/providers/googleProvider.js

const PROVIDER = 'google';
const GOOGLE_TRANSLATE_URL = 'https://translation.googleapis.com/language/translate/v2';

function apiKey(settings = {}) {
  return String(settings.apiKey || process.env.GOOGLE_TRANSLATE_API_KEY || '').trim();
}

function apiUrl(settings = {}) {
  return String(settings.apiUrl || process.env.GOOGLE_TRANSLATE_API_URL || GOOGLE_TRANSLATE_URL).trim();
}

function cleanLanguage(code = 'en') {
  const clean = String(code || 'en').trim().toLowerCase().replace(/[^a-z-]/g, '');
  return clean || 'en';
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
    return failure('MISSING_API_KEY', 'Google Translate API key is not configured.', false);
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
    return failure('MISSING_API_KEY', 'Google Translate API key is not configured.', false, {
      originalText,
      sourceLanguage,
      targetLanguage,
    });
  }

  const body = new URLSearchParams();
  body.set('key', key);
  body.append('q', originalText);
  body.set('target', cleanLanguage(targetLanguage));
  body.set('format', 'text');

  const cleanSource = cleanLanguage(sourceLanguage || 'auto');
  if (cleanSource !== 'auto') body.set('source', cleanSource);

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
    const message = data?.error?.message || `Google Translate request failed with status ${status}.`;

    if (status === 400) {
      return failure('UNSUPPORTED_LANGUAGE', message, false, { originalText, sourceLanguage, targetLanguage });
    }

    if (status === 401 || status === 403) {
      return failure('INVALID_API_KEY', message, false, { originalText, sourceLanguage, targetLanguage });
    }

    if (status === 429) {
      return failure('RATE_LIMITED', message, true, { originalText, sourceLanguage, targetLanguage });
    }

    return failure('PROVIDER_UNAVAILABLE', message, status >= 500, {
      originalText,
      sourceLanguage,
      targetLanguage,
    });
  }

  const translation = data?.data?.translations?.[0];
  const translatedText = String(translation?.translatedText || '').trim();

  if (!translatedText) {
    return failure('TRANSLATION_FAILED', 'Google Translate returned an empty translation.', true, {
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
    detectedLanguage: translation?.detectedSourceLanguage || null,
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
