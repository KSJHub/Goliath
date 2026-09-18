'use strict';

const fs = require('node:fs');
const path = require('node:path');
const auditStore = require('./auditStore');

const DEFAULT_RETENTION_MONTHS = 12;
const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024;
const DEFAULT_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
let lastCleanupAt = 0;
let lastCleanupResult = null;

function positive(value, fallback) { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : fallback; }
function retentionMonths() { return Math.floor(positive(process.env.GOLIATH_AUDIT_EVENT_RETENTION_MONTHS, DEFAULT_RETENTION_MONTHS)); }
function maxBytes() { return positive(process.env.GOLIATH_AUDIT_EVENT_MAX_BYTES, DEFAULT_MAX_BYTES); }
function cleanupIntervalMs() { return Math.max(60000, positive(process.env.GOLIATH_AUDIT_EVENT_CLEANUP_INTERVAL_MS, DEFAULT_CLEANUP_INTERVAL_MS)); }
function eventsRoot() { return path.join(auditStore.getRoot(), 'events'); }
function monthOrdinal(name) { const match = /^(\d{4})-(\d{2})\.jsonl$/.exec(name); return match ? Number(match[1]) * 12 + Number(match[2]) - 1 : null; }
function currentMonthOrdinal() { const d = new Date(); return d.getUTCFullYear() * 12 + d.getUTCMonth(); }
function files() {
  const root = eventsRoot(); const out = [];
  if (!fs.existsSync(root)) return out;
  for (const guild of fs.readdirSync(root, { withFileTypes: true })) {
    if (!guild.isDirectory()) continue;
    const dir = path.join(root, guild.name);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const ordinal = monthOrdinal(entry.name); if (ordinal == null) continue;
      const file = path.join(dir, entry.name);
      try { const stat = fs.statSync(file); out.push({ file, guildId: guild.name, name: entry.name, ordinal, size: stat.size, mtimeMs: stat.mtimeMs }); } catch {}
    }
  }
  return out;
}
function removeEmptyDirs() {
  const root = eventsRoot(); if (!fs.existsSync(root)) return;
  for (const guild of fs.readdirSync(root, { withFileTypes: true })) {
    if (!guild.isDirectory()) continue;
    const dir = path.join(root, guild.name);
    try { if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir); } catch {}
  }
}
function storageStats() {
  const list = files(); const bytes = list.reduce((sum, item) => sum + item.size, 0);
  return { root: eventsRoot(), files: list.length, bytes, megabytes: Math.round(bytes / 1048576 * 100) / 100, retentionMonths: retentionMonths(), maxBytes: maxBytes(), lastCleanupAt: lastCleanupResult?.finishedAt || null, lastCleanupResult };
}
function cleanup(options = {}) {
  const started = Date.now(); let list = files().sort((a, b) => a.ordinal - b.ordinal || a.mtimeMs - b.mtimeMs);
  const initialFiles = list.length; const initialBytes = list.reduce((sum, item) => sum + item.size, 0);
  const oldestAllowed = currentMonthOrdinal() - Math.max(0, retentionMonths() - 1);
  let removedFiles = 0; let reclaimedBytes = 0; const failures = [];
  function remove(item, reason) { try { fs.unlinkSync(item.file); removedFiles += 1; reclaimedBytes += item.size; return true; } catch (error) { failures.push({ file: item.file, reason, error: String(error?.message || error).slice(0, 300) }); return false; } }
  for (const item of list) if (item.ordinal < oldestAllowed) remove(item, 'retention');
  list = files().sort((a, b) => a.ordinal - b.ordinal || a.mtimeMs - b.mtimeMs);
  let bytes = list.reduce((sum, item) => sum + item.size, 0);
  while (bytes > maxBytes() && list.length > 1) {
    const item = list.shift(); if (!item) break;
    if (item.ordinal >= currentMonthOrdinal()) break;
    if (remove(item, 'byte-limit')) bytes -= item.size; else break;
  }
  removeEmptyDirs();
  lastCleanupAt = Date.now();
  lastCleanupResult = { startedAt: new Date(started).toISOString(), finishedAt: new Date().toISOString(), durationMs: Date.now() - started, initialFiles, finalFiles: Math.max(0, initialFiles - removedFiles), initialBytes, finalBytes: Math.max(0, initialBytes - reclaimedBytes), removedFiles, reclaimedBytes, failures: failures.slice(0, 20), ok: failures.length === 0, forced: options.force === true };
  return lastCleanupResult;
}
function maybeCleanup(options = {}) { if (!options.force && lastCleanupAt && Date.now() - lastCleanupAt < cleanupIntervalMs()) return lastCleanupResult; return cleanup(options); }

module.exports = { eventsRoot, storageStats, cleanup, maybeCleanup, limits: () => ({ retentionMonths: retentionMonths(), maxBytes: maxBytes(), cleanupIntervalMs: cleanupIntervalMs() }) };
