'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION = 1;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
// Durable state must not depend on the caller's working directory. PM2, tests
// and maintenance commands can launch the same checkout from different cwd
// values. This module is always four directories below the application root.
const APP_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const VALID_MODES = new Set(['dev', 'beta', 'production']);

function normalizeMode(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'development') return 'dev';
  if (raw === 'prod') return 'production';
  return VALID_MODES.has(raw) ? raw : '';
}

function checkoutMode() {
  // The deployed checkouts are /home/goliath/dev, /beta and /production.
  // Prefer that physical namespace over potentially stale PM2 environment
  // variables so a DEV process can never write its sessions into another
  // environment's runtime directory.
  return normalizeMode(path.basename(APP_ROOT));
}

function mode() {
  return checkoutMode()
    || normalizeMode(process.env.BOT_MODE)
    || normalizeMode(process.env.NODE_ENV)
    || 'dev';
}

function rootDir() {
  return path.join(APP_ROOT, 'src', 'runtime', mode(), 'data', 'messageStudio', 'embedSessions');
}

function safeKey(key) {
  return Buffer.from(String(key || 'global:system')).toString('base64url');
}

function fileFor(key) {
  return path.join(rootDir(), `${safeKey(key)}.json`);
}

function ensureDir() {
  fs.mkdirSync(rootDir(), { recursive: true });
}

function atomicWrite(file, value) {
  ensureDir();
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function load(key) {
  const file = fileFor(key);
  try {
    if (!fs.existsSync(file)) return null;
    const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!payload || payload.version !== VERSION || !payload.state) return null;
    const savedAt = Date.parse(payload.savedAt || '');
    if (Number.isFinite(savedAt) && Date.now() - savedAt > MAX_AGE_MS) {
      fs.rmSync(file, { force: true });
      return null;
    }
    return payload.state;
  } catch (error) {
    console.warn(`[EmbedStudio] Could not restore persisted session ${key}: ${error.message}`);
    return null;
  }
}

function save(key, state) {
  try {
    atomicWrite(fileFor(key), {
      version: VERSION,
      key: String(key),
      savedAt: new Date().toISOString(),
      state,
    });
    return true;
  } catch (error) {
    console.warn(`[EmbedStudio] Could not persist session ${key}: ${error.message}`);
    return false;
  }
}

function remove(key) {
  try {
    fs.rmSync(fileFor(key), { force: true });
    return true;
  } catch (error) {
    console.warn(`[EmbedStudio] Could not remove persisted session ${key}: ${error.message}`);
    return false;
  }
}

module.exports = { load, save, remove, fileFor, rootDir, mode };
