'use strict';

const crypto = require('node:crypto');
const { KINDS, familyFor } = require('./taxonomy');

const PIPELINE_VERSION = 1;
const VALID_KINDS = new Set(Object.values(KINDS));
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
async function capture(client, input = {}) { return originalCapture().capture(client, prepare(client, input, KINDS.EVENT)); }
async function captureEvent(client, input = {}) { return originalCapture().capture(client, prepare(client, { ...input, sentinelKind: KINDS.EVENT }, KINDS.EVENT)); }
async function captureAction(client, input = {}) { return originalCapture().captureGoliathAction(client, prepare(client, { ...input, sentinelKind: KINDS.ACTION }, KINDS.ACTION)); }
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

  // Audit Intelligence has a few mature internal/lexical capture paths (for
  // example Goliath output correlation). Enforcing at appendEvent guarantees
  // those records also cross Sentinel before persistence and Control delivery.
  const store = auditStore();
  if (!storeOriginal && typeof store.appendEvent === 'function') {
    storeOriginal = store.appendEvent.bind(store);
    store.appendEvent = (event) => storeOriginal(enforceStoredRecord(event));
  }
  installed = true;
  return true;
}
function boundaryInstalled() { return installed; }

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
  installBoundary, boundaryInstalled, enforceStoredRecord, correlate, normalize, confirmGoliathOutcome,
  ensureGoliathOutputCapture, outputMessageState, registerOperation, findOperationForOutput,
  findOperationForConfirmedOutcome, identifyGoliathSystem, buildActorSnapshot, actorMemberSnapshot, buildOperationalSummary,
};
