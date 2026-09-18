'use strict';

const fs = require('node:fs');
const path = require('node:path');
const auditStore = require('./auditStore');

const root = path.join(auditStore.getRoot(), 'message-evidence');
const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_MAX_FILES = 50_000;
const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;
const DEFAULT_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MAX_REVISIONS = 50;
let lastCleanupAt = 0;
let lastCleanupResult = null;

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function retentionDays() { return positiveNumber(process.env.GOLIATH_EVIDENCE_RETENTION_DAYS, DEFAULT_RETENTION_DAYS); }
function maxFiles() { return Math.floor(positiveNumber(process.env.GOLIATH_EVIDENCE_MAX_FILES, DEFAULT_MAX_FILES)); }
function maxBytes() { return positiveNumber(process.env.GOLIATH_EVIDENCE_MAX_BYTES, DEFAULT_MAX_BYTES); }
function cleanupIntervalMs() { return Math.max(60_000, positiveNumber(process.env.GOLIATH_EVIDENCE_CLEANUP_INTERVAL_MS, DEFAULT_CLEANUP_INTERVAL_MS)); }
function safe(v) { return String(v || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_'); }
function file(guildId, messageId) { return path.join(root, safe(guildId), `${safe(messageId)}.json`); }
function read(guildId, messageId) { try { return JSON.parse(fs.readFileSync(file(guildId, messageId), 'utf8')); } catch { return null; } }
function atomicWrite(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.write.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, target);
  return value;
}
function write(guildId, messageId, value) { return atomicWrite(file(guildId, messageId), value); }
function record(snapshot, kind = 'observed') {
  if (!snapshot?.guildId || !snapshot?.id) return null;
  const current = read(snapshot.guildId, snapshot.id) || { guildId: snapshot.guildId, messageId: snapshot.id, firstObservedAt: new Date().toISOString(), revisions: [], deleted: null };
  const revision = { kind, observedAt: new Date().toISOString(), ...snapshot };
  const last = current.revisions.at(-1);
  if (!last || JSON.stringify({ content: last.content, attachments: last.attachments, embeds: last.embeds, stickers: last.stickers }) !== JSON.stringify({ content: revision.content, attachments: revision.attachments, embeds: revision.embeds, stickers: revision.stickers })) current.revisions.push(revision);
  current.revisions = current.revisions.slice(-MAX_REVISIONS);
  current.latest = revision;
  return write(snapshot.guildId, snapshot.id, current);
}
function markDeleted(snapshot, attribution = null) {
  if (!snapshot?.guildId || !snapshot?.id) return null;
  const current = record(snapshot, 'delete-observed') || {};
  current.deleted = { observedAt: new Date().toISOString(), attribution: attribution || null };
  return write(snapshot.guildId, snapshot.id, current);
}
function latest(guildId, messageId) { const x = read(guildId, messageId); return x?.latest || x?.revisions?.at?.(-1) || null; }
function previous(guildId, messageId) { const x = read(guildId, messageId), r = x?.revisions || []; return r.length > 1 ? r[r.length - 2] : r[0] || null; }

function evidenceFiles() {
  const files = [];
  if (!fs.existsSync(root)) return files;
  for (const guild of fs.readdirSync(root, { withFileTypes: true })) {
    if (!guild.isDirectory()) continue;
    const guildDir = path.join(root, guild.name);
    for (const entry of fs.readdirSync(guildDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const target = path.join(guildDir, entry.name);
      try {
        const stat = fs.statSync(target);
        files.push({ file: target, guildId: guild.name, size: stat.size, mtimeMs: stat.mtimeMs });
      } catch {}
    }
  }
  return files;
}
function storageStats() {
  const files = evidenceFiles();
  const bytes = files.reduce((sum, item) => sum + item.size, 0);
  const oldestMs = files.length ? Math.min(...files.map((item) => item.mtimeMs)) : null;
  const newestMs = files.length ? Math.max(...files.map((item) => item.mtimeMs)) : null;
  return {
    root,
    files: files.length,
    bytes,
    megabytes: Math.round((bytes / 1024 / 1024) * 100) / 100,
    oldestAt: oldestMs ? new Date(oldestMs).toISOString() : null,
    newestAt: newestMs ? new Date(newestMs).toISOString() : null,
    retentionDays: retentionDays(),
    maxFiles: maxFiles(),
    maxBytes: maxBytes(),
    lastCleanupAt: lastCleanupResult?.finishedAt || null,
    lastCleanupResult,
  };
}
function removeEmptyGuildDirs() {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    try { if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir); } catch {}
  }
}
function cleanup(options = {}) {
  const started = Date.now();
  const cutoff = started - retentionDays() * 24 * 60 * 60 * 1000;
  let files = evidenceFiles().sort((a, b) => a.mtimeMs - b.mtimeMs);
  const initialFiles = files.length;
  const initialBytes = files.reduce((sum, item) => sum + item.size, 0);
  let removedFiles = 0;
  let reclaimedBytes = 0;
  const failures = [];

  function remove(item, reason) {
    try {
      fs.unlinkSync(item.file);
      removedFiles += 1;
      reclaimedBytes += item.size;
      return true;
    } catch (error) {
      failures.push({ file: item.file, reason, error: String(error?.message || error).slice(0, 300) });
      return false;
    }
  }

  for (const item of files) if (item.mtimeMs < cutoff) remove(item, 'retention');
  files = evidenceFiles().sort((a, b) => a.mtimeMs - b.mtimeMs);
  let bytes = files.reduce((sum, item) => sum + item.size, 0);
  while (files.length > maxFiles() || bytes > maxBytes()) {
    const item = files.shift();
    if (!item) break;
    if (remove(item, files.length >= maxFiles() ? 'file-limit' : 'byte-limit')) bytes -= item.size;
    else break;
  }
  removeEmptyGuildDirs();
  const result = {
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    initialFiles,
    finalFiles: Math.max(0, initialFiles - removedFiles),
    initialBytes,
    finalBytes: Math.max(0, initialBytes - reclaimedBytes),
    removedFiles,
    reclaimedBytes,
    failures: failures.slice(0, 20),
    ok: failures.length === 0,
    forced: options.force === true,
  };
  lastCleanupAt = Date.now();
  lastCleanupResult = result;
  return result;
}
function maybeCleanup(options = {}) {
  const now = Date.now();
  if (!options.force && lastCleanupAt && now - lastCleanupAt < cleanupIntervalMs()) return lastCleanupResult;
  return cleanup(options);
}

module.exports = {
  record,
  markDeleted,
  read,
  latest,
  previous,
  getRoot: () => root,
  storageStats,
  cleanup,
  maybeCleanup,
  limits: () => ({ retentionDays: retentionDays(), maxFiles: maxFiles(), maxBytes: maxBytes(), cleanupIntervalMs: cleanupIntervalMs(), maxRevisions: MAX_REVISIONS }),
};
