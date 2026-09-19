'use strict';

const sessionStore = require('./embedSessionStore');

function install(embedState) {
  if (!embedState || embedState.__persistentSessionsInstalled) return embedState;

  const original = {
    getSession: embedState.getSession.bind(embedState),
    saveSession: embedState.saveSession.bind(embedState),
    markUnsaved: embedState.markUnsaved.bind(embedState),
    clearUnsaved: embedState.clearUnsaved.bind(embedState),
    resetSession: embedState.resetSession.bind(embedState),
    clearSession: embedState.clearSession.bind(embedState),
    applyTemplate: embedState.applyTemplate.bind(embedState),
    applyPreset: embedState.applyPreset.bind(embedState),
    setDefault: embedState.setDefault.bind(embedState),
  };
  const hydrated = new Set();

  function keyFor(interaction) {
    return embedState.sessionKey(interaction);
  }

  function persist(interaction, state) {
    sessionStore.save(keyFor(interaction), state);
    return state;
  }

  embedState.getSession = (interaction) => {
    const key = keyFor(interaction);
    if (!hydrated.has(key)) {
      hydrated.add(key);
      const restored = sessionStore.load(key);
      if (restored) return original.saveSession(interaction, restored);
    }
    return original.getSession(interaction);
  };

  embedState.saveSession = (interaction, state) => {
    const saved = original.saveSession(interaction, state);
    hydrated.add(keyFor(interaction));
    return persist(interaction, saved);
  };

  // These functions in embedState call lexical copies of saveSession/getSession.
  // Replace their public boundary implementations so callers destructuring the
  // API (notably embedPanel) always pass through durable persistence.
  embedState.markUnsaved = (interaction, state) => embedState.saveSession(interaction, {
    ...state,
    hasUnsavedChanges: true,
  });

  embedState.clearUnsaved = (interaction, state) => embedState.saveSession(interaction, {
    ...state,
    hasUnsavedChanges: false,
  });

  embedState.resetSession = (interaction) => {
    const key = keyFor(interaction);
    sessionStore.remove(key);
    hydrated.add(key);
    const next = original.resetSession(interaction);
    return persist(interaction, next);
  };

  embedState.clearSession = (interaction) => {
    const key = keyFor(interaction);
    hydrated.delete(key);
    sessionStore.remove(key);
    return original.clearSession(interaction);
  };

  embedState.applyTemplate = (interaction, name) => {
    // Hydrate first so the original lexical getSession sees the restored state.
    embedState.getSession(interaction);
    const next = original.applyTemplate(interaction, name);
    return embedState.saveSession(interaction, next);
  };

  embedState.applyPreset = (interaction, name, preset = {}) => {
    embedState.getSession(interaction);
    const next = original.applyPreset(interaction, name, preset);
    return embedState.saveSession(interaction, next);
  };

  embedState.setDefault = (interaction, name) => {
    embedState.getSession(interaction);
    const next = original.setDefault(interaction, name);
    return embedState.saveSession(interaction, next);
  };

  embedState.__persistentSessionsInstalled = true;
  return embedState;
}

module.exports = { install };
