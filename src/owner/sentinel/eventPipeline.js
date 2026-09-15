'use strict';

/**
 * Sentinel event/action pipeline.
 *
 * Sentinel is the single observation boundary for owner-level intelligence.
 * Normal Discord/Goliath events are NOT deduplicated here: every occurrence
 * is forwarded to Audit Intelligence. Stateful health incidents continue to
 * use Sentinel's incident store/report/recovery lifecycle.
 */

const crypto = require('node:crypto');

const PIPELINE_VERSION = 1;
const VALID_KINDS = new Set(['event', 'action', 'incident', 'recovery', 'health']);

function environment(client) {
  return String(client?.botMode || process.env.BOT_MODE || 'DEV').toUpperCase();
}

function pipelineId() {
  return `SEN-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function audit() {
  // Lazy require keeps Sentinel independent during bootstrap and avoids a
  // hard circular dependency while Audit Intelligence provisions Control.
  return require('../auditIntelligence/auditIntelligence');
}

function normalizeKind(input = {}, fallback = 'event') {
  const requested = String(input.sentinelKind || input.kind || fallback).toLowerCase();
  return VALID_KINDS.has(requested) ? requested : fallback;
}

function sentinelMetadata(client, input = {}, kind = 'event') {
  return {
    ...(input.metadata || {}),
    sentinel: {
      pipelineVersion: PIPELINE_VERSION,
      pipelineId: input.metadata?.sentinel?.pipelineId || pipelineId(),
      kind,
      environment: environment(client),
      observedAt: input.metadata?.sentinel?.observedAt || new Date().toISOString(),
      ...(input.metadata?.sentinel || {}),
    },
    environment: input.metadata?.environment || environment(client),
  };
}

function prepare(client, input = {}, fallbackKind = 'event') {
  const kind = normalizeKind(input, fallbackKind);
  return {
    ...input,
    metadata: sentinelMetadata(client, input, kind),
  };
}

async function capture(client, input = {}) {
  return audit().capture(client, prepare(client, input, 'event'));
}

async function captureEvent(client, input = {}) {
  return audit().capture(client, prepare(client, { ...input, sentinelKind: 'event' }, 'event'));
}

async function captureAction(client, input = {}) {
  return audit().captureGoliathAction(client, prepare(client, { ...input, sentinelKind: 'action' }, 'action'));
}

async function captureGoliathAction(client, input = {}) {
  return captureAction(client, input);
}

// Compatibility helpers used by the existing Audit Intelligence gateway
// collectors. Keeping these here lets collectors move behind Sentinel now
// without duplicating mature correlation/snapshot logic.
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
  PIPELINE_VERSION,
  environment,
  prepare,
  capture,
  captureEvent,
  captureAction,
  captureGoliathAction,
  correlate,
  normalize,
  confirmGoliathOutcome,
  ensureGoliathOutputCapture,
  outputMessageState,
  registerOperation,
  findOperationForOutput,
  findOperationForConfirmedOutcome,
  identifyGoliathSystem,
  buildActorSnapshot,
  actorMemberSnapshot,
  buildOperationalSummary,
};
