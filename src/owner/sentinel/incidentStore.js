'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ensureRuntimePaths } = require('../../config/runtimePaths');

const DEFAULT_MAX_INCIDENTS = 1000;
const DEFAULT_MAX_REPORTS = 2000;
const DEFAULT_RESOLVED_RETENTION_DAYS = 30;
const DEFAULT_MAX_STORE_BYTES = 8 * 1024 * 1024;
const MAX_DETAILS_BYTES = 64 * 1024;

function positiveNumber(value, fallback) { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : fallback; }
function maxIncidents() { return Math.floor(positiveNumber(process.env.GOLIATH_SENTINEL_MAX_INCIDENTS, DEFAULT_MAX_INCIDENTS)); }
function maxReports() { return Math.floor(positiveNumber(process.env.GOLIATH_SENTINEL_MAX_REPORTS, DEFAULT_MAX_REPORTS)); }
function resolvedRetentionMs() { return positiveNumber(process.env.GOLIATH_SENTINEL_RESOLVED_RETENTION_DAYS, DEFAULT_RESOLVED_RETENTION_DAYS) * 86400000; }
function maxStoreBytes() { return positiveNumber(process.env.GOLIATH_SENTINEL_MAX_STORE_BYTES, DEFAULT_MAX_STORE_BYTES); }
function filePath() { return path.join(ensureRuntimePaths(process.env.BOT_MODE).incidents, 'health-watch.json'); }
function empty() { return { version: 2, updatedAt: null, sequence: 0, incidents: {}, reports: {}, heartbeat: {}, housekeeping: null }; }
function readStore() {
  try { const parsed = JSON.parse(fs.readFileSync(filePath(), 'utf8')); return parsed && typeof parsed === 'object' ? { ...empty(), ...parsed, incidents: parsed.incidents || {}, reports: parsed.reports || {} } : empty(); }
  catch { return empty(); }
}
function boundedObject(value, maxBytes = MAX_DETAILS_BYTES) {
  if (!value || typeof value !== 'object') return {};
  try {
    const raw = JSON.stringify(value);
    if (Buffer.byteLength(raw) <= maxBytes) return value;
    return { truncated: true, originalBytes: Buffer.byteLength(raw), summary: raw.slice(0, Math.max(0, maxBytes - 2000)) };
  } catch { return { truncated: true, reason: 'unserializable' }; }
}
function pruneStore(store) {
  const now = Date.now();
  const cutoff = now - resolvedRetentionMs();
  const incidents = Object.entries(store.incidents || {});
  let removedResolved = 0;
  let removedOverflow = 0;
  const kept = incidents.filter(([, incident]) => {
    if (incident?.status !== 'resolved') return true;
    const resolved = Date.parse(incident.resolvedAt || incident.lastSeenAt || '') || 0;
    if (resolved && resolved < cutoff) { removedResolved += 1; return false; }
    return true;
  });
  kept.sort((a, b) => {
    const ao = a[1]?.status === 'open' ? 1 : 0; const bo = b[1]?.status === 'open' ? 1 : 0;
    if (ao !== bo) return bo - ao;
    return (Date.parse(b[1]?.lastSeenAt || b[1]?.resolvedAt || '') || 0) - (Date.parse(a[1]?.lastSeenAt || a[1]?.resolvedAt || '') || 0);
  });
  const limited = kept.slice(0, maxIncidents());
  removedOverflow = Math.max(0, kept.length - limited.length);
  store.incidents = Object.fromEntries(limited);

  const reports = Object.entries(store.reports || {}).sort((a, b) => (Date.parse(b[1]) || 0) - (Date.parse(a[1]) || 0));
  const limitedReports = reports.slice(0, maxReports());
  const removedReports = Math.max(0, reports.length - limitedReports.length);
  store.reports = Object.fromEntries(limitedReports);
  store.housekeeping = { at: new Date(now).toISOString(), removedResolved, removedOverflow, removedReports, incidents: limited.length, reports: limitedReports.length };
  return store;
}
function writeStore(store) {
  const file = filePath(); const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  let next = pruneStore({ ...store, updatedAt: new Date().toISOString() });
  let payload = JSON.stringify(next, null, 2);
  if (Buffer.byteLength(payload) > maxStoreBytes()) {
    const open = Object.entries(next.incidents || {}).filter(([, x]) => x?.status === 'open');
    const resolved = Object.entries(next.incidents || {}).filter(([, x]) => x?.status !== 'open').sort((a, b) => (Date.parse(b[1]?.lastSeenAt || b[1]?.resolvedAt || '') || 0) - (Date.parse(a[1]?.lastSeenAt || a[1]?.resolvedAt || '') || 0));
    next.incidents = Object.fromEntries([...open, ...resolved.slice(0, Math.max(0, Math.floor(maxIncidents() / 4)))]);
    next.housekeeping = { ...(next.housekeeping || {}), emergencyCompaction: true };
    payload = JSON.stringify(next, null, 2);
  }
  if (Buffer.byteLength(payload) > maxStoreBytes()) throw new Error(`Sentinel incident store exceeds ${maxStoreBytes()} byte safety limit after compaction`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try { fs.writeFileSync(tmp, payload); fs.renameSync(tmp, file); } catch (error) { try { fs.unlinkSync(tmp); } catch {} throw error; }
  return next;
}
function incidentKey(input = {}) { return [String(input.environment || process.env.BOT_MODE || 'DEV').toUpperCase(), input.guildId || 'global', input.module || 'runtime', input.component || 'general', input.code || 'unknown'].map((v) => String(v).replace(/\s+/g, '-').toLowerCase()).join(':'); }
function nextId(store, environment) { store.sequence = Number(store.sequence || 0) + 1; return `INC-${String(environment || process.env.BOT_MODE || 'DEV').toUpperCase()}-${String(store.sequence).padStart(6, '0')}`; }
function openIncident(input = {}) {
  const data = readStore(); const key = incidentKey(input); const now = new Date().toISOString(); const existing = data.incidents[key]; const opened = !existing || existing.status === 'resolved';
  const incident = opened ? { id: nextId(data, input.environment), key, status: 'open', firstSeenAt: now, occurrences: 0 } : { ...existing };
  Object.assign(incident, { status: 'open', lastSeenAt: now, resolvedAt: null, occurrences: Number(incident.occurrences || 0) + 1, environment: String(input.environment || process.env.BOT_MODE || 'DEV').toUpperCase(), guildId: input.guildId || null, guildName: input.guildName || null, module: input.module || 'runtime', component: input.component || 'general', code: input.code || 'unknown', severity: input.severity || 'warning', message: String(input.message || input.code || 'Health issue').slice(0, 1500), details: boundedObject(input.details) });
  data.incidents[key] = incident; writeStore(data); return { incident, opened };
}
function resolveIncident(input = {}, details = {}) {
  const data = readStore(); const key = typeof input === 'string' ? input : incidentKey(input); const existing = data.incidents[key]; if (!existing || existing.status !== 'open') return null;
  const incident = { ...existing, status: 'resolved', resolvedAt: new Date().toISOString(), recoveryDetails: boundedObject(details) }; data.incidents[key] = incident; writeStore(data); return incident;
}
function recordHeartbeat(snapshot = {}) { const data = readStore(); data.heartbeat = { ...boundedObject(snapshot), at: new Date().toISOString() }; writeStore(data); return data.heartbeat; }
function markReport(key) { const data = readStore(); data.reports = { ...(data.reports || {}), [String(key).slice(0, 500)]: new Date().toISOString() }; writeStore(data); }
function snapshot() { return readStore(); }
function housekeeping() { return writeStore(readStore()).housekeeping; }
function storageStats() { try { const stat = fs.statSync(filePath()); const data = readStore(); return { bytes: stat.size, incidents: Object.keys(data.incidents || {}).length, reports: Object.keys(data.reports || {}).length, housekeeping: data.housekeeping || null, limits: { maxIncidents: maxIncidents(), maxReports: maxReports(), resolvedRetentionDays: resolvedRetentionMs() / 86400000, maxStoreBytes: maxStoreBytes(), maxDetailsBytes: MAX_DETAILS_BYTES } }; } catch { return { bytes: 0, incidents: 0, reports: 0, housekeeping: null }; } }
module.exports = { incidentKey, openIncident, resolveIncident, recordHeartbeat, markReport, snapshot, filePath, housekeeping, storageStats };
