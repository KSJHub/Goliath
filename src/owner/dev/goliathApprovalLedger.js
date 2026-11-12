'use strict';
// Owner review acknowledgements only. No signed execution grants or Discord writes.
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { getRuntimePaths } = require('../../config/runtimePaths');
const SNOWFLAKE = /^\d{16,20}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^[a-f0-9]{64}$/;
const MODES = new Set(['DEV', 'BETA', 'PRODUCTION']);
const MAX_RECORDS = 300;
const TTL_MS = 30 * 60 * 1000;
function ensureDev() {
  if (String(process.env.BOT_MODE || '').toUpperCase() !== 'DEV') throw new Error('Review ledger is DEV-only.');
}
function ledgerFile() {
  return path.join(getRuntimePaths('DEV').data, 'goliath-ai-operation-reviews.json');
}
function digest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function operationKey({ draft, currentDigest, operation, sequence }) {
  return digest({ draftId: draft.id, environment: draft.environment, guildId: draft.guildId,
    blueprint: draft.blueprint, currentDigest, sequence, kind: operation.kind,
    target: operation.target, before: operation.before ?? null, proposed: operation.after ?? operation.proposed ?? null });
}
function load(file = ledgerFile()) {
  ensureDev();
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, 'utf8');
  if (Buffer.byteLength(raw) > 512 * 1024) throw new Error('Review ledger exceeds storage limit.');
  const items = JSON.parse(raw);
  if (!Array.isArray(items) || items.length > MAX_RECORDS) throw new Error('Invalid review ledger.');
  return items;
}
function persist(items, file = ledgerFile()) {
  ensureDev();
  if (items.length > MAX_RECORDS) throw new Error('Review ledger is full.');
  const raw = JSON.stringify(items);
  if (Buffer.byteLength(raw) > 512 * 1024) throw new Error('Review ledger storage limit reached.');
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(tmp, raw, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    fs.renameSync(tmp, file);
    fs.chmodSync(file, 0o600);
  } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
function validateContext({ draft, currentDigest, operations, reviewerId }) {
  ensureDev();
  if (!draft || !UUID.test(String(draft.id || '')) || !MODES.has(draft.environment) ||
      !SNOWFLAKE.test(String(draft.guildId || '')) || !SHA.test(String(currentDigest || '')) ||
      !SNOWFLAKE.test(String(reviewerId || '')) || !Array.isArray(operations) ||
      operations.length > 350) throw new Error('Invalid review context.');
  if (draft.auditDigest !== currentDigest) throw new Error('Saved plan is stale; no operation review is allowed.');
  if (draft.review?.status !== 'reviewed') throw new Error('Review the complete saved plan first.');
}
function recordReview({ draft, currentDigest, operations, reviewerId, sequence, decision }, file) {
  validateContext({ draft, currentDigest, operations, reviewerId });
  if (!['acknowledged', 'rejected'].includes(decision) ||
      !Number.isInteger(sequence) || sequence < 1 || sequence > operations.length)
    throw new Error('Invalid operation sequence or review decision.');
  const operation = operations[sequence - 1];
  if (!operation || operation.executable !== false) throw new Error('Only non-executable preview operations can be reviewed.');
  const key = operationKey({ draft, currentDigest, operation, sequence });
  const now = new Date();
  const existing = load(file);
  // Append-only events: never erase an earlier decision from the audit trail.
  const updated = existing;
  const item = {
    id: randomUUID(), draftId: draft.id, environment: draft.environment, guildId: draft.guildId,
    sequence, operationKey: key, reviewerId: String(reviewerId), decision,
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + TTL_MS).toISOString(),
    status: 'active', isExecutionApproval: false
  };
  if (updated.length >= MAX_RECORDS) throw new Error('Review ledger is full.');
  persist([...updated, item], file);
  return item;
}
function listReviews({ draft, currentDigest, operations }, file) {
  ensureDev();
  if (!draft || !UUID.test(String(draft.id || '')) || !Array.isArray(operations) ||
      !SHA.test(String(currentDigest || ''))) throw new Error('Invalid review listing context.');
  const now = Date.now();
  return operations.map((operation, i) => {
    const sequence = i + 1;
    const key = operationKey({ draft, currentDigest, operation, sequence });
    const latestByReviewer = new Map();
    for (const item of load(file)) {
      if (item.draftId === draft.id && item.environment === draft.environment &&
          item.guildId === draft.guildId && item.sequence === sequence &&
          item.operationKey === key && item.status === 'active' &&
          Date.parse(item.expiresAt) > now) latestByReviewer.set(item.reviewerId, item);
    }
    const records = [...latestByReviewer.values()];
    return { sequence, kind: operation.kind, target: operation.target,
      reviews: records.map(({ reviewerId, decision, createdAt, expiresAt }) =>
        ({ reviewerId, decision, createdAt, expiresAt })),
      needsAttention: !records.length || records.some(item => item.decision === 'rejected'),
      executable: false };
  });
}
function recentEvents({ draftId }, file) {
  ensureDev();
  if (!UUID.test(String(draftId))) throw new Error('Invalid draft ID.');
  return load(file).filter(item => item.draftId === draftId).slice(-100).map(item => ({
    id: item.id, sequence: item.sequence, reviewerId: item.reviewerId,
    decision: item.decision, createdAt: item.createdAt, expiresAt: item.expiresAt,
    environment: item.environment, guildId: item.guildId, isExecutionApproval: false
  }));
}
module.exports = { operationKey, validateContext, recordReview, listReviews, recentEvents };
