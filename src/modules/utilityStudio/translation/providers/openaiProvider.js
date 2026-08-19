'use strict';

// src/modules/utilityStudio/translation/providers/openaiProvider.js

const PROVIDER = 'openai';
const DEFAULT_MODEL = 'gpt-4o-mini';
const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';

function apiKey(settings = {}) {
  return String(settings.apiKey || process.env.OPENAI_API_KEY || '').trim();
}

function modelName(settings = {}) {
  return String(settings.model || process.env.OPENAI_TRANSLATION_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
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
    return failure('MISSING_API_KEY', 'OpenAI API key is not configured.', false);
  }

  return success({
    translatedText: '',
    warnings: [],
    meta: {
      model: modelName(settings),
      apiKeyConfigured: true,
    },
  });
}

function buildSystemPrompt() {
  return [
    'You are Goliath Translation, a Discord-safe translation engine.',
    'Translate only the human-readable natural language text.',
    'Preserve Discord mentions exactly, including <@id>, <@!id>, <@&id>, and <#id>.',
    'Preserve custom emojis exactly, including <:name:id> and <a:name:id>.',
    'Preserve URLs exactly.',
    'Preserve Discord markdown, spoiler tags, bullet spacing, new lines, block quotes, and code blocks.',
    'Do not translate code inside inline code or fenced code blocks.',
    'Do not add explanations, labels, quotation marks, or commentary.',
  ].join('\n');
}

function buildUserPrompt({ text, sourceLanguage, targetLanguage }) {
  return [
    `Source language: ${sourceLanguage || 'auto'}`,
    `Target language: ${targetLanguage || 'en'}`,
    '',
    'Text:',
    text,
  ].join('\n');
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
    return failure('MISSING_API_KEY', 'OpenAI API key is not configured.', false, {
      originalText,
      sourceLanguage,
      targetLanguage,
    });
  }

  const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelName(settings),
      temperature: 0.1,
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: buildUserPrompt({ text: originalText, sourceLanguage, targetLanguage }) },
      ],
    }),
  });

  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    data = null;
  }

  if (!response.ok) {
    const status = response.status;
    const message = data?.error?.message || `OpenAI request failed with status ${status}.`;

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

  const translatedText = String(data?.choices?.[0]?.message?.content || '').trim();

  if (!translatedText) {
    return failure('TRANSLATION_FAILED', 'OpenAI returned an empty translation.', true, {
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
    detectedLanguage: sourceLanguage === 'auto' ? null : sourceLanguage,
    warnings: [],
    meta: {
      model: modelName(settings),
      usage: data?.usage || null,
    },
  });
}

module.exports = {
  id: PROVIDER,
  validateConfig,
  translateText,
};
