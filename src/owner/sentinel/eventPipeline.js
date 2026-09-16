'use strict';

const crypto = require('node:crypto');
const { KINDS, familyFor, ACTION_SURFACE } = require('./taxonomy');

const PIPELINE_VERSION = 3;
const VALID_KINDS = new Set(Object.values(KINDS));
const DEDUPE_WINDOW_MS = 1800;
const DEDUPE_LIMIT = 5000;
const CORRELATION_WINDOW_MS = 15000;
const CORRELATION_LIMIT = 3000;
const recentFingerprints = new Map();
const recentEvidence = new Map();
const counters = { accepted: 0, deduplicated: 0, correlated: 0, auditEvidence: 0, actions: 0, events: 0, errors: 0 };
let installed = false;
let originals = null;
let storeOriginal = null;
let clientRef = null;

function environment(client = clientRef) { return String(client?.botMode || process.env.BOT_MODE || 'DEV').toUpperCase(); }
function pipelineId() { return `SEN-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`; }
function audit() { return require('../auditIntelligence/auditIntelligence'); }
function auditStore() { return require('../auditIntelligence/auditStore'); }
function normalizeKind(input = {}, fallback = KINDS.EVENT) { const requested = String(input.sentinelKind || input.kind || fallback).toLowerCase(); return VALID_KINDS.has(requested) ? requested : fallback; }
function stable(value) { if (value === null || value === undefined) return ''; if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`; if (typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${key}:${stable(value[key])}`).join(',')}}`; return String(value); }
function fingerprint(input = {}, kind = KINDS.EVENT) {
  const metadata = input.metadata || {};
  if (metadata.discordAuditLog && metadata.auditLogEntryId) return `audit:${input.guildId || input.guild?.id || ''}:${metadata.auditLogEntryId}`;
  const parts = [kind,input.type,input.guildId || input.guild?.id,input.channel?.id || input.channelId,input.user?.id,input.actor?.id,input.target?.id,input.action,stable(input.before),stable(input.after)];
  return crypto.createHash('sha1').update(parts.map((part) => String(part ?? '')).join('|')).digest('hex');
}
function trimMap(map, max, ageMs = 30000) { const now = Date.now(); for (const [key, value] of map) { const at = Number(value?.at ?? value ?? 0); if (now - at > ageMs) map.delete(key); } while (map.size > max) map.delete(map.keys().next().value); }
function duplicate(input = {}, kind = KINDS.EVENT) { if (input.metadata?.sentinel?.allowDuplicate === true) return false; const now = Date.now(); const fp = fingerprint(input, kind); const previous = recentFingerprints.get(fp) || 0; recentFingerprints.set(fp, now); trimMap(recentFingerprints, DEDUPE_LIMIT); return now - previous <= DEDUPE_WINDOW_MS; }
function sentinelMetadata(client, input = {}, kind = KINDS.EVENT) {
  const env = environment(client);
  return { ...(input.metadata || {}), environment: input.metadata?.environment || env, sentinel: { pipelineVersion:PIPELINE_VERSION, pipelineId:input.metadata?.sentinel?.pipelineId || pipelineId(), kind, environment:env, observedAt:input.metadata?.sentinel?.observedAt || new Date().toISOString(), evidenceSource:input.metadata?.sentinel?.evidenceSource || input.metadata?.evidenceSource || 'Discord gateway / Goliath runtime', ...(input.metadata?.sentinel || {}) } };
}
function prepare(client, input = {}, fallbackKind = KINDS.EVENT) { const kind = normalizeKind(input, fallbackKind); const type = String(input.type || 'unknown'); return { ...input, category:input.category || familyFor(type, kind === KINDS.ACTION ? 'goliath' : 'guild'), metadata:sentinelMetadata(client, input, kind) }; }
function evidenceKeys(event = {}) {
  const guildId = String(event.guildId || event.guild?.id || ''); const targetId = String(event.target?.id || event.user?.id || ''); const channelId = String(event.channel?.id || event.channelId || '');
  return [guildId && targetId ? `g:${guildId}:t:${targetId}` : null, guildId && channelId ? `g:${guildId}:c:${channelId}` : null, guildId ? `g:${guildId}` : null].filter(Boolean);
}
function rememberEvidence(event = {}) { const at = Date.now(); const item = { at, type:event.type, actor:event.actor || null, reason:event.reason || null, target:event.target || null, metadata:event.metadata || {}, eventId:event.eventId || null }; for (const key of evidenceKeys(event)) recentEvidence.set(key, item); trimMap(recentEvidence, CORRELATION_LIMIT, CORRELATION_WINDOW_MS * 2); }
function correlateEvidence(event = {}) {
  if (event.metadata?.discordAuditLog) { rememberEvidence(event); counters.auditEvidence += 1; return event; }
  const now = Date.now(); let match = null;
  for (const key of evidenceKeys(event)) { const candidate = recentEvidence.get(key); if (!candidate || now - candidate.at > CORRELATION_WINDOW_MS) continue; if (!candidate.metadata?.discordAuditLog) continue; match = candidate; break; }
  if (!match) return event;
  event.actor = event.actor || match.actor || null; event.reason = event.reason || match.reason || null;
  event.metadata = { ...(event.metadata || {}), sentinel:{ ...(event.metadata?.sentinel || {}), correlated:true, correlationConfidence:event.target?.id && match.target?.id && String(event.target.id) === String(match.target.id) ? 'high' : 'medium', correlatedAuditLogEntryId:match.metadata?.auditLogEntryId || null, correlatedAuditAction:match.metadata?.auditAction ?? null, correlationEvidence:'Discord Audit Log evidence observed within correlation window' } };
  counters.correlated += 1; return event;
}
function originalCapture() { if (!originals) { const target = audit(); originals = { capture:target.capture.bind(target), captureGoliathAction:target.captureGoliathAction.bind(target) }; } return originals; }
async function capturePrepared(client, input, fallbackKind, action = false) {
  try {
    let prepared = prepare(client, input, fallbackKind); const kind = prepared.metadata?.sentinel?.kind || fallbackKind;
    if (duplicate(prepared, kind)) { counters.deduplicated += 1; return { deduplicated:true, type:prepared.type, guildId:prepared.guildId || prepared.guild?.id || null }; }
    prepared = correlateEvidence(prepared); counters.accepted += 1; counters[kind === KINDS.ACTION ? 'actions' : 'events'] += 1;
    return action ? originalCapture().captureGoliathAction(client, prepared) : originalCapture().capture(client, prepared);
  } catch (error) { counters.errors += 1; throw error; }
}
async function capture(client, input = {}) { return capturePrepared(client, input, KINDS.EVENT, false); }
async function captureEvent(client, input = {}) { return capturePrepared(client, { ...input, sentinelKind:KINDS.EVENT }, KINDS.EVENT, false); }
async function captureAction(client, input = {}) { return capturePrepared(client, { ...input, sentinelKind:KINDS.ACTION }, KINDS.ACTION, true); }
async function captureGoliathAction(client, input = {}) { return captureAction(client, input); }
function enforceStoredRecord(event) { if (!event || typeof event !== 'object') return event; const kind = String(event.source || '').toLowerCase() === 'goliath' || String(event.type || '').startsWith('goliath.') ? KINDS.ACTION : KINDS.EVENT; event.category = event.category || familyFor(event.type, kind === KINDS.ACTION ? 'goliath' : 'guild'); event.metadata = sentinelMetadata(clientRef, event, event.metadata?.sentinel?.kind || kind); return event; }
function installBoundary(client = null) {
  if (client) clientRef = client; if (installed) return false; const target = audit(); originalCapture(); target.capture = capture; target.captureGoliathAction = captureGoliathAction;
  const store = auditStore(); if (!storeOriginal && typeof store.appendEvent === 'function') { storeOriginal = store.appendEvent.bind(store); store.appendEvent = (event) => storeOriginal(enforceStoredRecord(event)); }
  installed = true; return true;
}
function boundaryInstalled() { return installed; }
function coverage() { const groups = Object.entries(ACTION_SURFACE).map(([group, actions]) => ({ group, actionCount:actions.length })); return { groups, groupCount:groups.length, declaredActionCount:groups.reduce((sum, item) => sum + item.actionCount, 0), families:['guild','member','moderation','security','message','voice','role','goliath'] }; }
function diagnostics() { return { installed, pipelineVersion:PIPELINE_VERSION, environment:environment(), dedupeWindowMs:DEDUPE_WINDOW_MS, correlationWindowMs:CORRELATION_WINDOW_MS, recentFingerprintCount:recentFingerprints.size, recentEvidenceCount:recentEvidence.size, counters:{ ...counters }, coverage:coverage() }; }
async function selfTest(client = clientRef, guild = null) {
  const selected = guild || client?.guilds?.cache?.first?.() || null; if (!client || !selected) return { ok:false, reason:'no-live-guild', diagnostics:diagnostics() };
  const marker = `sentinel-selftest-${Date.now()}`; const base = { guild:selected, guildId:selected.id, type:'sentinel.selftest', category:'goliath', action:'health', title:'Sentinel Pipeline Self Test', target:{ id:marker, label:'Sentinel self-test marker' }, summary:'Sentinel exercised its persistence and deduplication pipeline.', metadata:{ sentinel:{ allowDuplicate:true }, selfTest:true } };
  const first = await captureEvent(client, base); const duplicateResult = await captureEvent(client, { ...base, metadata:{ selfTest:true } });
  return { ok:Boolean(first), firstStored:Boolean(first), duplicateSuppressed:Boolean(duplicateResult?.deduplicated), diagnostics:diagnostics() };
}
function correlate(...args) { return audit().correlate(...args); } function normalize(...args) { return audit().normalize(...args); } function confirmGoliathOutcome(...args) { return audit().confirmGoliathOutcome(...args); } function ensureGoliathOutputCapture(...args) { return audit().ensureGoliathOutputCapture(...args); } function outputMessageState(...args) { return audit().outputMessageState(...args); } function registerOperation(...args) { return audit().registerOperation(...args); } function findOperationForOutput(...args) { return audit().findOperationForOutput(...args); } function findOperationForConfirmedOutcome(...args) { return audit().findOperationForConfirmedOutcome(...args); } function identifyGoliathSystem(...args) { return audit().identifyGoliathSystem(...args); } function buildActorSnapshot(...args) { return audit().buildActorSnapshot(...args); } function actorMemberSnapshot(...args) { return audit().actorMemberSnapshot(...args); } function buildOperationalSummary(...args) { return audit().buildOperationalSummary(...args); }
module.exports = { PIPELINE_VERSION,environment,prepare,capture,captureEvent,captureAction,captureGoliathAction,installBoundary,boundaryInstalled,diagnostics,coverage,selfTest,enforceStoredRecord,correlate,normalize,confirmGoliathOutcome,ensureGoliathOutputCapture,outputMessageState,registerOperation,findOperationForOutput,findOperationForConfirmedOutcome,identifyGoliathSystem,buildActorSnapshot,actorMemberSnapshot,buildOperationalSummary };
