'use strict';
// Private DEV-only plan storage: never executes Discord actions.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { getRuntimePaths } = require('../../config/runtimePaths');
const { parseBlueprint } = require('./goliathBlueprint');

const MAX_DRAFTS = 30;
const SNOWFLAKE = /^\d{16,20}$/;
const VALID_MODES = new Set(['DEV', 'BETA', 'PRODUCTION']);
const VALID_ID = /^[a-f0-9-]{36}$/i;
function draftFile() {
  return path.join(getRuntimePaths('DEV').data, 'goliath-ai-drafts.json');
}
function ensureDEV() {
  if (String(process.env.BOT_MODE || '').toUpperCase() !== 'DEV') throw new Error('Draft storage is DEV-only.');
}
function readStore(file = draftFile()) {
  ensureDEV();
  if (!fs.existsSync(file)) return [];
  const source = fs.readFileSync(file, 'utf8');
  if (source.length > 1024 * 1024) throw new Error('Goliath AI draft storage is over its size limit.');
  const data = JSON.parse(source);
  if (!Array.isArray(data) || data.length > MAX_DRAFTS) throw new Error('Invalid Goliath AI draft storage.');
  return data;
}
function writeStore(data, file = draftFile()) {
  ensureDEV();
  if (!Array.isArray(data) || data.length > MAX_DRAFTS) throw new Error('Too many drafts.');
  const raw = JSON.stringify(data);
  if (Buffer.byteLength(raw) > 1024 * 1024) throw new Error('Draft storage size limit reached.');
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temp, raw, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, file);
    fs.chmodSync(file, 0o600);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
function publicDraft(item, includeBlueprint = false) {
  const result = {
    id: item.id, title: item.title, environment: item.environment,
    guildId: item.guildId, guildName: item.guildName,
    createdAt: item.createdAt, updatedAt: item.updatedAt, createdBy: item.createdBy,
    review: item.review, basedOnAudit: item.basedOnAudit,
    auditDigest: item.auditDigest, readOnly: true, executable: false
  };
  if (includeBlueprint) result.blueprint = item.blueprint;
  return result;
}
function listDrafts(file) {
  return readStore(file).map(item => publicDraft(item)).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
}
function loadDraft(id, file) {
  if (!VALID_ID.test(String(id))) return null;
  const item = readStore(file).find(entry => entry.id === id);
  return item ? publicDraft(item, true) : null;
}
function saveDraft({ environment, guildId, guildName, title, blueprint, ownerId, auditDigest, basedOnAudit }, file) {
  ensureDEV();
  if (!VALID_MODES.has(environment) || !SNOWFLAKE.test(guildId) ||
      !SNOWFLAKE.test(String(ownerId || '')) || typeof auditDigest !== 'string' ||
      !/^[a-f0-9]{64}$/.test(auditDigest) || typeof basedOnAudit !== 'string')
    throw new Error('Invalid draft target or audit identity.');
  const name = String(title || '').trim();
  if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('Draft title must be 1–100 characters.');
  const parsed = parseBlueprint(blueprint);
  const data = readStore(file);
  if (data.length >= MAX_DRAFTS) throw new Error('Draft storage is full (30 maximum). Delete an unused draft first.');
  const now = new Date().toISOString();
  const item = { id: randomUUID(), title: name, environment, guildId, guildName: String(guildName || '').slice(0, 100),
    blueprint: parsed, createdBy: String(ownerId), createdAt: now, updatedAt: now,
    basedOnAudit, auditDigest, review: { status: 'draft', checkedBy: null, checkedAt: null } };
  writeStore([...data, item], file);
  return publicDraft(item, true);
}
function reviewDraft({ id, ownerId, currentAuditDigest }, file) {
  ensureDEV();
  if (!VALID_ID.test(id) || !SNOWFLAKE.test(String(ownerId)) ||
      !/^[a-f0-9]{64}$/.test(String(currentAuditDigest))) throw new Error('Invalid review request.');
  const data = readStore(file), item = data.find(entry => entry.id === id);
  if (!item) return null;
  if (item.auditDigest !== currentAuditDigest) throw new Error('The server changed since this draft was saved. Refresh and save a new plan.');
  const now = new Date().toISOString();
  item.updatedAt = now;
  item.review = { status: 'reviewed', checkedBy: String(ownerId), checkedAt: now };
  writeStore(data, file);
  return publicDraft(item, true);
}
function deleteDraft(id, file) {
  ensureDEV();
  if (!VALID_ID.test(String(id))) return false;
  const data = readStore(file);
  const next = data.filter(entry => entry.id !== id);
  if (next.length === data.length) return false;
  writeStore(next, file);
  return true;
}
module.exports = { listDrafts, loadDraft, saveDraft, reviewDraft, deleteDraft };
