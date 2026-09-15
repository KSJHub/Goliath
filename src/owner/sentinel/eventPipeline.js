'use strict';

/**
 * Sentinel event/action pipeline.
 * Sentinel is the single observation boundary for owner-level intelligence.
 * Every normal event/action is retained; only stateful incidents use the
 * existing Sentinel incident/reminder/recovery deduplication lifecycle.
 */

const crypto = require('node:crypto');
const { KINDS, familyFor } = require('./taxonomy');

const PIPELINE_VERSION = 1;
const VALID_KINDS = new Set(Object.values(KINDS));

function environment(client) {
  return String(client?.botMode || process.env.BOT_MODE || 'DEV').toUpperCase();
}

function pipelineId() {
  return `SEN-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function audit() {
  return require('../auditIntelligence/auditIntelligence');
}

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
  return {
    ...input,
    category: input.category || familyFor(type, kind === KINDS.ACTION ? 'goliath' : 'guild'),
    metadata: sentinelMetadata(client, input, kind),
  };
}

async function capture(client, input = {}) {
  return audit().capture(client, prepare(client, input, KINDS.EVENT));
}

async function captureEvent(client, input = {}) {
  return audit().capture(client, prepare(client, { ...input, sentinelKind: KINDS.EVENT }, KINDS.EVENT));
}

async function captureAction(client, input = {}) {
  return audit().captureGoliathAction(client, prepare(client, { ...input, sentinelKind: KINDS.ACTION }, KINDS.ACTION));
}

async function captureGoliathAction(client, input = {}) {
  return captureAction(client, input);
}

// Compatibility helpers allow the mature gateway collectors/correlation code
// to move behind Sentinel incrementally without duplicating Audit Intelligence.
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
