'use strict';

const crypto = require('node:crypto');
const { KINDS, familyFor } = require('./taxonomy');

const PIPELINE_VERSION = 2;
const VALID_KINDS = new Set(Object.values(KINDS));
const DEDUPE_WINDOW_MS = 1800;
const DEDUPE_LIMIT = 5000;
const recentFingerprints = new Map();
let installed = false;
let originals = null;
let storeOriginal = null;
let clientRef = null;

function environment(client = clientRef) { return String(client?.botMode || process.env.BOT_MODE || 'DEV').toUpperCase(); }
function pipelineId() { return `SEN-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`; }
function audit() { return require('../auditIntelligence/auditIntelligence'); }
function auditStore() { return require('../auditIntelligence/auditStore'); }
function normalizeKind(input = {}, fallback = KINDS.EVENT) {
  const requested = String(input.sentinelKind || input.kind || fallback).toLowerCase();
  return VALID_KINDS.has(requested) ? requested : fallback;
}
function stable(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${key}:${stable(value[key])}`).join(',')}}`;
  return String(value);
}
function fingerprint(input = {}, kind = KINDS.EVENT) {
  const metadata = input.metadata || {};
  if (metadata.discordAuditLog && metadata.auditLogEntryId) return `audit:${input.guildId || input.guild?.id || ''}:${metadata.auditLogEntryId}`;
  const parts = [kind, input.type, input.guildId || input.guild?.id, input.channel?.id || input.channelId, input.user?.id, input.actor?.id, input.target?.id, input.action, stable(input.before), stable(input.after)];
  return crypto.createHash('sha1').update(parts.map((part) => String(part ?? '')).join('|')).digest('hex');
}
function duplicate(input = {}, kind = KINDS.EVENT) {
  if (input.metadata?.sentinel?.allowDuplicate === true) return false;
  const now = Date.now();
  const fp = fingerprint(input, kind);
  const previous = recentFingerprints.get(fp) || 0;
  recentFingerprints.set(fp, now);
  if (recentFingerprints.size > DEDUPE_LIMIT) {
    for (const [key, at] of recentFingerprints) if (now - at > 30000) recentFingerprints.delete(key);
    while (recentFingerprints.size > DEDUPE_LIMIT) recentFingerprints.delete(recentFingerprints.keys().next().value);
  }
  return now - previous <= DEDUPE_WINDOW_MS;
}
function sentinelMetadata(client, input = {}, kind = KINDS.EVENT) {
  const env = environment(client);
  return {
    ...(input.metadata || {}),
    environment: input.metadata?.environment || env,
    sentinel: {
      pipelineVersion: PIPELINE_VERSION,
      pipelineId: input.metadata?.sentinel?.pipelineId || pipelineId(),
      kind,
      environment: env,
      observedAt: input.metadata?.sentinel?.observedAt || new Date().toISOString(),
      evidenceSource: input.metadata?.sentinel?.evidenceSource || input.metadata?.evidenceSource || 'Discord gateway / Goliath runtime',
      ...(input.metadata?.sentinel || {}),
    },
  };
}
function prepare(client, input = {}, fallbackKind = KINDS.EVENT) {
  const kind = normalizeKind(input, fallbackKind);
  const type = String(input.type || 'unknown');
  return { ...input, category: input.category || familyFor(type, kind === KINDS.ACTION ? 'goliath' : 'guild'), metadata: sentinelMetadata(client, input, kind) };
}
function originalCapture() {
  if (!originals) {
    const target = audit();
    originals = { capture: target.capture.bind(target), captureGoliathAction: target.captureGoliathAction.bind(target) };
  }
  return originals;
}
async function capturePrepared(client, input, fallbackKind, action = false) {
  const prepared = prepare(client, input, fallbackKind);
  const kind = prepared.metadata?.sentinel?.kind || fallbackKind;
  if (duplicate(prepared, kind)) return { deduplicated: true, type: prepared.type, guildId: prepared.guildId || prepared.guild?.id || null };
  return action ? originalCapture().captureGoliathAction(client, prepared) : originalCapture().capture(client, prepared);
}
async function capture(client, input = {}) { return capturePrepared(client, input, KINDS.EVENT, false); }
async function captureEvent(client, input = {}) { return capturePrepared(client, { ...input, sentinelKind: KINDS.EVENT }, KINDS.EVENT, false); }
async function captureAction(client, input = {}) { return capturePrepared(client, { ...input, sentinelKind: KINDS.ACTION }, KINDS.ACTION, true); }
async function captureGoliathAction(client, input = {}) { return captureAction(client, input); }

function enforceStoredRecord(event) {
  if (!event || typeof event !== 'object') return event;
  const kind = String(event.source || '').toLowerCase() === 'goliath' || String(event.type || '').startsWith('goliath.') ? KINDS.ACTION : KINDS.EVENT;
  event.category = event.category || familyFor(event.type, kind === KINDS.ACTION ? 'goliath' : 'guild');
  event.metadata = sentinelMetadata(clientRef, event, event.metadata?.sentinel?.kind || kind);
  return event;
}

function installBoundary(client = null) {
  if (client) clientRef = client;
  if (installed) return false;
  const target = audit();
  originalCapture();
  target.capture = capture;
  target.captureGoliathAction = captureGoliathAction;

  // Audit Intelligence has mature lexical/internal capture paths. Enforcing at
  // appendEvent guarantees every stored record has Sentinel provenance even if
  // it did not enter through the public capture functions.
  const store = auditStore();
  if (!storeOriginal && typeof store.appendEvent === 'function') {
    storeOriginal = store.appendEvent.bind(store);
    store.appendEvent = (event) => storeOriginal(enforceStoredRecord(event));
  }
  installed = true;
  return true;
}
function boundaryInstalled() { return installed; }
function diagnostics() { return { installed, pipelineVersion: PIPELINE_VERSION, environment: environment(), dedupeWindowMs: DEDUPE_WINDOW_MS, recentFingerprintCount: recentFingerprints.size }; }

function correlate(...args) { return audit().correlate(...args); }
function normalize(...args) { return audit().normalize(...args); }
function confirmGoliathOutcome(...args) { return audit().confirmGoliathOutcome(...args); }
function ensureGoliathOutputCapture(...args) { return audit().ensureGoliathOutputCapture(...args); }
function outputMessageState(...args) { return audit().outputMessageState(...args); }
function registerOperation(...args) { return audit().registerOperation(...args); }
function findOperationForOutput(...args) { return audit().findOperationForOutput(...args); }
function findOperationForConfirmedOutcome(...args) { return audit().findOperationForConfirmedOutcome(...args); }
function identifyGoliathSystem(...args) { return audit().identifyGoliathSystem(...args); }
function buildActorSnapshot(...args) { return audit().buildActorSnapshot(...args); }
function actorMemberSnapshot(...args) { return audit().actorMemberSnapshot(...args); }
function buildOperationalSummary(...args) { return audit().buildOperationalSummary(...args); }

module.exports = {
  PIPELINE_VERSION, environment, prepare, capture, captureEvent, captureAction, captureGoliathAction,
  installBoundary, boundaryInstalled, diagnostics, enforceStoredRecord, correlate, normalize, confirmGoliathOutcome,
  ensureGoliathOutputCapture, outputMessageState, registerOperation, findOperationForOutput,
  findOperationForConfirmedOutcome, identifyGoliathSystem, buildActorSnapshot, actorMemberSnapshot, buildOperationalSummary,
};
