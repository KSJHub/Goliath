'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ensureRuntimePaths } = require('../../config/runtimePaths');

function filePath() { return path.join(ensureRuntimePaths(process.env.BOT_MODE).incidents, 'health-watch.json'); }
function empty() { return { version: 1, updatedAt: null, sequence: 0, incidents: {}, reports: {}, heartbeat: {} }; }
function readStore() {
  try { const parsed = JSON.parse(fs.readFileSync(filePath(), 'utf8')); return parsed && typeof parsed === 'object' ? { ...empty(), ...parsed, incidents: parsed.incidents || {} } : empty(); }
  catch { return empty(); }
}
function writeStore(store) {
  const file = filePath(); const tmp = `${file}.${process.pid}.tmp`; const next = { ...store, updatedAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(tmp, JSON.stringify(next, null, 2)); fs.renameSync(tmp, file); return next;
}
function incidentKey(input = {}) { return [String(input.environment || process.env.BOT_MODE || 'DEV').toUpperCase(), input.guildId || 'global', input.module || 'runtime', input.component || 'general', input.code || 'unknown'].map((v) => String(v).replace(/\s+/g, '-').toLowerCase()).join(':'); }
function nextId(store, environment) { store.sequence = Number(store.sequence || 0) + 1; return `INC-${String(environment || process.env.BOT_MODE || 'DEV').toUpperCase()}-${String(store.sequence).padStart(6, '0')}`; }
function openIncident(input = {}) {
  const data = readStore(); const key = incidentKey(input); const now = new Date().toISOString(); const existing = data.incidents[key]; const opened = !existing || existing.status === 'resolved';
  const incident = opened ? { id: nextId(data, input.environment), key, status: 'open', firstSeenAt: now, occurrences: 0 } : { ...existing };
  Object.assign(incident, { status: 'open', lastSeenAt: now, resolvedAt: null, occurrences: Number(incident.occurrences || 0) + 1, environment: String(input.environment || process.env.BOT_MODE || 'DEV').toUpperCase(), guildId: input.guildId || null, guildName: input.guildName || null, module: input.module || 'runtime', component: input.component || 'general', code: input.code || 'unknown', severity: input.severity || 'warning', message: String(input.message || input.code || 'Health issue').slice(0, 1500), details: input.details && typeof input.details === 'object' ? input.details : {} });
  data.incidents[key] = incident; writeStore(data); return { incident, opened };
}
function resolveIncident(input = {}, details = {}) {
  const data = readStore(); const key = typeof input === 'string' ? input : incidentKey(input); const existing = data.incidents[key]; if (!existing || existing.status !== 'open') return null;
  const incident = { ...existing, status: 'resolved', resolvedAt: new Date().toISOString(), recoveryDetails: details && typeof details === 'object' ? details : {} }; data.incidents[key] = incident; writeStore(data); return incident;
}
function recordHeartbeat(snapshot = {}) { const data = readStore(); data.heartbeat = { ...snapshot, at: new Date().toISOString() }; writeStore(data); return data.heartbeat; }
function markReport(key) { const data = readStore(); data.reports = { ...(data.reports || {}), [key]: new Date().toISOString() }; writeStore(data); }
function snapshot() { return readStore(); }
module.exports = { incidentKey, openIncident, resolveIncident, recordHeartbeat, markReport, snapshot, filePath };
