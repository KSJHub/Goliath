'use strict';

const sessionStore = require('./embedSessionStore');
const { HELPERS, replaceVars } = require('../../../core/guild/guildVariables');

const sessions = new Map();
const hydratedSessions = new Set();
let defaultStateFactory = null;
let stateSync = (state) => state;
let basePanelFactory = null;

function configure({ defaultState, sync, basePanel } = {}) {
  if (typeof defaultState === 'function') defaultStateFactory = defaultState;
  if (typeof sync === 'function') stateSync = sync;
  if (typeof basePanel === 'function') basePanelFactory = basePanel;
}

function clone(value) { return JSON.parse(JSON.stringify(value || {})); }
function trim(value, max = 4096) { const text = String(value || ''); return text.length > max ? `${text.slice(0, max - 3)}...` : text; }
function fmtDate(value) { if (!value) return 'Unknown'; const date = value instanceof Date ? value : new Date(value); return Number.isNaN(date.getTime()) ? 'Unknown' : date.toISOString(); }
function fmtTs(value, style = 'F') { if (!value) return 'Unknown'; const date = value instanceof Date ? value : new Date(value); if (Number.isNaN(date.getTime())) return 'Unknown'; return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`; }
function durationFrom(timestamp) {
  const started = Number(timestamp || 0); if (!started || started > Date.now()) return 'Unknown';
  let months = Math.max(0, Math.floor((Date.now() - started) / (1000 * 60 * 60 * 24 * 30.4375))); const years = Math.floor(months / 12); months %= 12;
  const parts = []; if (years) parts.push(`${years} year${years === 1 ? '' : 's'}`); if (months || !parts.length) parts.push(`${months} month${months === 1 ? '' : 's'}`); return parts.join(', ');
}
function avatar(member) { return member?.displayAvatarURL?.({ size: 1024 }) || member?.user?.displayAvatarURL?.({ size: 1024 }) || undefined; }
function guildIcon(guild) { return guild?.iconURL?.({ size: 1024 }) || undefined; }
function guildBanner(guild) { return guild?.bannerURL?.({ size: 2048 }) || undefined; }
function memberName(interaction) { return interaction?.member?.displayName || interaction?.user?.globalName || interaction?.user?.username || 'Unknown User'; }
function displayName(member) { return member?.displayName || member?.user?.globalName || member?.user?.username || 'Unknown User'; }
function refreshGuild(interaction) { return interaction?.guild || null; }
function sessionKey(interaction) { return `${interaction?.guildId || interaction?.guild?.id || 'global'}:${interaction?.user?.id || 'system'}`; }
function persistOrThrow(key, state, operation = 'save') {
  if (sessionStore.save(key, state)) return state;
  const error = new Error(`Embed Studio could not ${operation} the builder session. No success was recorded.`);
  error.code = 'EMBED_SESSION_PERSIST_FAILED';
  throw error;
}

// Persistence belongs at the canonical state boundary. Every consumer — including
// functions destructured by embedPanel and lexical calls inside this module — now
// uses the same durable path. This avoids wrapper/load-order bypasses.
function getSession(interaction) {
  const key = sessionKey(interaction);
  if (!sessions.has(key)) {
    if (!hydratedSessions.has(key)) {
      hydratedSessions.add(key);
      const restored = sessionStore.load(key);
      if (restored) {
        const synced = stateSync(restored);
        persistOrThrow(key, synced, 'refresh');
        sessions.set(key, synced);
        return synced;
      }
    }
    if (typeof defaultStateFactory !== 'function') throw new Error('Embed state is not configured with a defaultState factory.');
    const fresh = stateSync(defaultStateFactory());
    persistOrThrow(key, fresh, 'create');
    sessions.set(key, fresh);
  }
  const current = sessions.get(key);
  // A live builder session must always have a durable counterpart. Some flows
  // hydrate/replace the in-memory Map directly (for example deployment/editor
  // recovery), and the JSON file can also disappear independently of memory.
  // Make reads self-healing so any active Embed Studio interaction recreates
  // the canonical session file before it can be lost on restart.
  persistOrThrow(key, current, 'refresh');
  return current;
}

function saveSession(interaction, state) {
  const key = sessionKey(interaction);
  const synced = stateSync(state);
  // Persist before publishing the new state in memory. A failed durable write
  // must never leave the live process claiming a state that cannot survive restart.
  persistOrThrow(key, synced);
  sessions.set(key, synced);
  hydratedSessions.add(key);
  return synced;
}

function saveSelected(state, patch = {}) {
  const panels = clone(state?.panels || []); const selectedPanelIndex = Math.max(0, Number(state?.selectedPanelIndex) || 0);
  if (!panels[selectedPanelIndex]) return stateSync(state);
  panels[selectedPanelIndex] = { ...panels[selectedPanelIndex], ...clone(patch) };
  return stateSync({ ...state, panels });
}
function markUnsaved(interaction, state) { return saveSession(interaction, { ...state, hasUnsavedChanges: true }); }
function clearUnsaved(interaction, state) { return saveSession(interaction, { ...state, hasUnsavedChanges: false }); }
function resetSession(interaction) {
  if (typeof defaultStateFactory !== 'function') throw new Error('Embed state is not configured with a defaultState factory.');
  const key = sessionKey(interaction); const next = stateSync(defaultStateFactory()); persistOrThrow(key, next, 'reset'); sessions.set(key, next); hydratedSessions.add(key); return next;
}
function clearSession(interaction) {
  const key = sessionKey(interaction);
  if (!sessionStore.remove(key)) {
    const error = new Error('Embed Studio could not clear the persisted builder session.');
    error.code = 'EMBED_SESSION_REMOVE_FAILED';
    throw error;
  }
  hydratedSessions.delete(key);
  return sessions.delete(key);
}
function allowedMentions(state) { return state?.allowUserPing ? { parse: ['users', 'roles'] } : { parse: [] }; }
function presetData(state) { return { template: state?.template || 'custom', panels: clone(state?.panels || []), allowUserPing: !!state?.allowUserPing, showTimestamp: state?.showTimestamp !== false, fieldLayout: state?.fieldLayout || 'auto' }; }
function applyTemplate(interaction, name) { if (typeof basePanelFactory !== 'function') throw new Error('Embed state is not configured with a basePanel factory.'); const current = getSession(interaction); const nextPanel = basePanelFactory(name); return markUnsaved(interaction, stateSync({ ...current, template: name, selectedPanelIndex: 0, panels: [nextPanel], selectedPreset: null })); }
function applyPreset(interaction, name, preset = {}) {
  if (typeof basePanelFactory !== 'function') {
    throw new Error('Embed state is not configured with a basePanel factory.');
  }

  const current = getSession(interaction);

  const panels =
    Array.isArray(preset?.panels) && preset.panels.length
      ? clone(preset.panels)
      : [basePanelFactory('custom')];

  /*
   * Loading an existing saved preset establishes a clean editor
   * baseline. The editor only becomes dirty after the user changes
   * something after the load.
   */
  return saveSession(
    interaction,
    stateSync({
      ...current,
      template: preset?.template || 'custom',
      selectedPreset: name || null,
      panels,
      selectedPanelIndex: 0,
      selectedFieldIndex: null,
      selectedButtonIndex: null,
      allowUserPing: !!preset?.allowUserPing,
      showTimestamp: preset?.showTimestamp !== false,
      fieldLayout: preset?.fieldLayout || 'auto',
      hasUnsavedChanges: false,
    })
  );
}
function setDefault(interaction, name) { const current = getSession(interaction); return saveSession(interaction, { ...current, selectedPreset: name || null }); }

function bindPanel(panel, { defaultState, sync, basePanel } = {}) {
  if (!panel || typeof panel !== 'object') return panel; configure({ defaultState, sync, basePanel });
  Object.assign(panel, { HELPERS, clone, trim, fmtDate, fmtTs, durationFrom, avatar, guildIcon, guildBanner, memberName, displayName, refreshGuild, sessionKey, replaceVars, getSession, saveSession, saveSelected, markUnsaved, clearUnsaved, resetSession, clearSession, allowedMentions, presetData, applyTemplate, applyPreset, setDefault }); return panel;
}

module.exports = { HELPERS, sessions, hydratedSessions, configure, bindPanel, clone, trim, fmtDate, fmtTs, durationFrom, avatar, guildIcon, guildBanner, memberName, displayName, refreshGuild, sessionKey, replaceVars, getSession, saveSession, saveSelected, markUnsaved, clearUnsaved, resetSession, clearSession, allowedMentions, presetData, applyTemplate, applyPreset, setDefault };