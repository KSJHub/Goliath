'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { HELPERS, replaceVars } = require('../../../core/guild/guildVariables');

// Durable session persistence is owned by Embed State so all session lifecycle
// behaviour has one canonical boundary.
const SESSION_VERSION = 1;
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const APP_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const VALID_MODES = new Set(['dev', 'beta', 'production']);
function normalizeMode(value) { const raw = String(value || '').trim().toLowerCase(); if (raw === 'development') return 'dev'; if (raw === 'prod') return 'production'; return VALID_MODES.has(raw) ? raw : ''; }
function checkoutMode() { return normalizeMode(path.basename(APP_ROOT)); }
function sessionMode() { return checkoutMode() || normalizeMode(process.env.BOT_MODE) || normalizeMode(process.env.NODE_ENV) || 'dev'; }
function sessionRootDir() { return path.join(APP_ROOT, 'src', 'runtime', sessionMode(), 'data', 'messageStudio', 'embedSessions'); }
function safeSessionKey(key) { return Buffer.from(String(key || 'global:system')).toString('base64url'); }
function sessionFileFor(key) { return path.join(sessionRootDir(), `${safeSessionKey(key)}.json`); }
function ensureSessionDir() { fs.mkdirSync(sessionRootDir(), { recursive: true }); }
function atomicSessionWrite(file, value) { ensureSessionDir(); const tmp = `${file}.${process.pid}.${Date.now()}.tmp`; fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8'); fs.renameSync(tmp, file); }
function loadPersistedSession(key) { const file = sessionFileFor(key); try { if (!fs.existsSync(file)) return null; const payload = JSON.parse(fs.readFileSync(file, 'utf8')); if (!payload || payload.version !== SESSION_VERSION || !payload.state) return null; const savedAt = Date.parse(payload.savedAt || ''); if (Number.isFinite(savedAt) && Date.now() - savedAt > SESSION_MAX_AGE_MS) { fs.rmSync(file, { force: true }); return null; } return payload.state; } catch (error) { console.warn(`[EmbedStudio] Could not restore persisted session ${key}: ${error.message}`); return null; } }
function savePersistedSession(key, state) { try { atomicSessionWrite(sessionFileFor(key), { version: SESSION_VERSION, key: String(key), savedAt: new Date().toISOString(), state }); return true; } catch (error) { console.warn(`[EmbedStudio] Could not persist session ${key}: ${error.message}`); return false; } }
function removePersistedSession(key) { try { fs.rmSync(sessionFileFor(key), { force: true }); return true; } catch (error) { console.warn(`[EmbedStudio] Could not remove persisted session ${key}: ${error.message}`); return false; } }

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
function durationFrom(timestamp) { const started = Number(timestamp || 0); if (!started || started > Date.now()) return 'Unknown'; let months = Math.max(0, Math.floor((Date.now() - started) / (1000 * 60 * 60 * 24 * 30.4375))); const years = Math.floor(months / 12); months %= 12; const parts = []; if (years) parts.push(`${years} year${years === 1 ? '' : 's'}`); if (months || !parts.length) parts.push(`${months} month${months === 1 ? '' : 's'}`); return parts.join(', '); }
function avatar(member) { return member?.displayAvatarURL?.({ size: 1024 }) || member?.user?.displayAvatarURL?.({ size: 1024 }) || undefined; }
function guildIcon(guild) { return guild?.iconURL?.({ size: 1024 }) || undefined; }
function guildBanner(guild) { return guild?.bannerURL?.({ size: 2048 }) || undefined; }
function memberName(interaction) { return interaction?.member?.displayName || interaction?.user?.globalName || interaction?.user?.username || 'Unknown User'; }
function displayName(member) { return member?.displayName || member?.user?.globalName || member?.user?.username || 'Unknown User'; }
function refreshGuild(interaction) { return interaction?.guild || null; }
function sessionKey(interaction) { return `${interaction?.guildId || interaction?.guild?.id || 'global'}:${interaction?.user?.id || 'system'}`; }
function persistOrThrow(key, state, operation = 'save') { if (savePersistedSession(key, state)) return state; const error = new Error(`Embed Studio could not ${operation} the builder session. No success was recorded.`); error.code = 'EMBED_SESSION_PERSIST_FAILED'; throw error; }
function getSession(interaction) { const key = sessionKey(interaction); if (!sessions.has(key)) { if (!hydratedSessions.has(key)) { hydratedSessions.add(key); const restored = loadPersistedSession(key); if (restored) { const synced = stateSync(restored); persistOrThrow(key, synced, 'refresh'); sessions.set(key, synced); return synced; } } if (typeof defaultStateFactory !== 'function') throw new Error('Embed state is not configured with a defaultState factory.'); const fresh = stateSync(defaultStateFactory()); persistOrThrow(key, fresh, 'create'); sessions.set(key, fresh); } const current = sessions.get(key); persistOrThrow(key, current, 'refresh'); return current; }
function saveSession(interaction, state) { const key = sessionKey(interaction); const synced = stateSync(state); persistOrThrow(key, synced); sessions.set(key, synced); hydratedSessions.add(key); return synced; }
function saveSelected(state, patch = {}) { const panels = clone(state?.panels || []); const selectedPanelIndex = Math.max(0, Number(state?.selectedPanelIndex) || 0); if (!panels[selectedPanelIndex]) return stateSync(state); panels[selectedPanelIndex] = { ...panels[selectedPanelIndex], ...clone(patch) }; return stateSync({ ...state, panels }); }
function markUnsaved(interaction, state) { return saveSession(interaction, { ...state, hasUnsavedChanges: true }); }
function clearUnsaved(interaction, state) { return saveSession(interaction, { ...state, hasUnsavedChanges: false }); }
function resetSession(interaction) { if (typeof defaultStateFactory !== 'function') throw new Error('Embed state is not configured with a defaultState factory.'); const key = sessionKey(interaction); const next = stateSync(defaultStateFactory()); persistOrThrow(key, next, 'reset'); sessions.set(key, next); hydratedSessions.add(key); return next; }
function clearSession(interaction) { const key = sessionKey(interaction); if (!removePersistedSession(key)) { const error = new Error('Embed Studio could not clear the persisted builder session.'); error.code = 'EMBED_SESSION_REMOVE_FAILED'; throw error; } hydratedSessions.delete(key); return sessions.delete(key); }
function allowedMentions(state) { return state?.allowUserPing ? { parse: ['users', 'roles'] } : { parse: [] }; }
function presetData(state) { return { template: state?.template || 'custom', panels: clone(state?.panels || []), allowUserPing: !!state?.allowUserPing, showTimestamp: state?.showTimestamp !== false, fieldLayout: state?.fieldLayout || 'auto' }; }
function applyTemplate(interaction, name) { if (typeof basePanelFactory !== 'function') throw new Error('Embed state is not configured with a basePanel factory.'); const current = getSession(interaction); const nextPanel = basePanelFactory(name); return markUnsaved(interaction, stateSync({ ...current, template: name, selectedPanelIndex: 0, panels: [nextPanel], selectedPreset: null })); }
function applyPreset(interaction, name, preset = {}) { if (typeof basePanelFactory !== 'function') throw new Error('Embed state is not configured with a basePanel factory.'); const current = getSession(interaction); const panels = Array.isArray(preset?.panels) && preset.panels.length ? clone(preset.panels) : [basePanelFactory('custom')]; return saveSession(interaction, stateSync({ ...current, template: preset?.template || 'custom', selectedPreset: name || null, panels, selectedPanelIndex: 0, selectedFieldIndex: null, selectedButtonIndex: null, allowUserPing: !!preset?.allowUserPing, showTimestamp: preset?.showTimestamp !== false, fieldLayout: preset?.fieldLayout || 'auto', hasUnsavedChanges: false })); }
function setDefault(interaction, name) { const current = getSession(interaction); return saveSession(interaction, { ...current, selectedPreset: name || null }); }
function bindPanel(panel, { defaultState, sync, basePanel } = {}) { if (!panel || typeof panel !== 'object') return panel; configure({ defaultState, sync, basePanel }); Object.assign(panel, { HELPERS, clone, trim, fmtDate, fmtTs, durationFrom, avatar, guildIcon, guildBanner, memberName, displayName, refreshGuild, sessionKey, replaceVars, getSession, saveSession, saveSelected, markUnsaved, clearUnsaved, resetSession, clearSession, allowedMentions, presetData, applyTemplate, applyPreset, setDefault }); return panel; }

module.exports = { HELPERS, sessions, hydratedSessions, configure, bindPanel, clone, trim, fmtDate, fmtTs, durationFrom, avatar, guildIcon, guildBanner, memberName, displayName, refreshGuild, sessionKey, replaceVars, getSession, saveSession, saveSelected, markUnsaved, clearUnsaved, resetSession, clearSession, allowedMentions, presetData, applyTemplate, applyPreset, setDefault, sessionFileFor, sessionRootDir, sessionMode };
