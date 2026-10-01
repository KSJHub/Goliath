'use strict';

const REGISTRY = Object.freeze({
  suggestions: Object.freeze({
    key: 'suggestions',
    label: 'Suggestions',
    description: 'Suggestion submission panel and suggestion lifecycle messages.',
    slots: Object.freeze(['suggestion_panel', 'suggestion_pending', 'suggestion_accepted', 'suggestion_denied']),
  }),
  welcome: Object.freeze({
    key: 'welcome',
    label: 'Scheduled Welcome',
    description: 'Scheduled welcome message content.',
    slots: Object.freeze(['scheduled_welcome']),
  }),
  goodbye: Object.freeze({
    key: 'goodbye',
    label: 'Goodbye',
    description: 'Member goodbye message content.',
    slots: Object.freeze(['goodbye']),
  }),
});

function clean(value) {
  return String(value || '').trim();
}

function isSupportedBinding(moduleKey, slot) {
  const module = REGISTRY[clean(moduleKey)];
  return Boolean(module && module.slots.includes(clean(slot)));
}

function assertSupportedBinding(moduleKey, slot) {
  const safeModule = clean(moduleKey);
  const safeSlot = clean(slot);
  if (!isSupportedBinding(safeModule, safeSlot)) {
    const error = new Error(`Unsupported Embed Studio binding: ${safeModule || '(missing)'}/${safeSlot || '(missing)'}.`);
    error.code = 'EMBED_BINDING_UNSUPPORTED';
    error.moduleKey = safeModule || null;
    error.slot = safeSlot || null;
    throw error;
  }
  return { moduleKey: safeModule, slot: safeSlot };
}

function publicRegistry() {
  return Object.values(REGISTRY).map((entry) => ({
    key: entry.key,
    label: entry.label,
    description: entry.description,
    slots: [...entry.slots],
  }));
}

module.exports = {
  REGISTRY,
  isSupportedBinding,
  assertSupportedBinding,
  publicRegistry,
};
