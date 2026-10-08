'use strict';

const verificationChallenges = require('./verificationChallenges');
const verificationStore = require('./verificationStore');

const INTERACTIVE_METHODS = new Set(['captcha', 'minigame', 'one_time_challenge', 'staff_approval']);
const MEMBER_ACTION_PREFIX = 'verify:challenge';
const STAFF_ACTION_PREFIX = 'verify:staff';
const TERMINAL_STATES = new Set(['verified', 'quarantined', 'rejected', 'failed', 'timed_out']);

const clean = value => String(value ?? '').trim();

function challengeConfig(settings = {}, method) {
  const security = settings.security || {};
  if (method === 'captcha') return { ...(security.captchaConfig || settings.captcha || {}) };
  if (method === 'minigame') return { ...(security.minigameConfig || settings.minigame || {}) };
  if (method === 'one_time_challenge') return { ...(security.oneTimeChallengeConfig || settings.oneTimeChallenge || {}) };
  if (method === 'staff_approval') return { ...(security.staffApprovalConfig || settings.staffApproval || {}) };
  return {};
}

function buildMemberActionId(userId, challengeId) { return `${MEMBER_ACTION_PREFIX}:${clean(userId)}:${clean(challengeId)}`; }
function buildStaffActionId(userId, challengeId, action) { return `${STAFF_ACTION_PREFIX}:${clean(userId)}:${clean(challengeId)}:${clean(action)}`; }

function parseActionId(customId = '') {
  const parts = clean(customId).split(':');
  if (parts[0] !== 'verify') return null;
  if (parts[1] === 'challenge' && parts.length === 4) return { type: 'member_answer', userId: parts[2], challengeId: parts[3] };
  if (parts[1] === 'staff' && parts.length === 5) return { type: 'staff_action', userId: parts[2], challengeId: parts[3], action: parts[4] };
  return null;
}

function sessionState(guildId, userId) {
  const session = verificationStore.getSession(guildId, userId);
  if (!session) return { exists: false, state: null, activeChallenge: null, completedSecurity: [] };
  return {
    exists: true,
    state: session.state || null,
    activeSecurityMethod: session.activeSecurityMethod || null,
    activeChallenge: verificationChallenges.active(guildId, userId),
    completedSecurity: Array.isArray(session.completedSecurity) ? [...session.completedSecurity] : [],
  };
}

function markCompleted(guildId, userId, method) {
  const session = verificationStore.getSession(guildId, userId) || {};
  const completed = new Set(Array.isArray(session.completedSecurity) ? session.completedSecurity : []);
  completed.add(method);
  verificationStore.upsertSession(guildId, userId, { state: 'verifying', completedSecurity: [...completed], activeSecurityMethod: null, activeChallenge: null });
  return [...completed];
}

function startStep(guildId, userId, method, settings = {}) {
  if (!INTERACTIVE_METHODS.has(method)) return { ok: false, reason: 'not_interactive', method };
  const session = verificationStore.getSession(guildId, userId) || {};
  if (TERMINAL_STATES.has(session.state)) return { ok: false, reason: 'terminal_session', method, state: session.state };
  const active = verificationChallenges.active(guildId, userId);
  if (active?.status === 'pending') {
    if (active.method !== method) return { ok: false, reason: 'different_challenge_active', method, activeMethod: active.method, challenge: active };
    return {
      ok: true, pending: true, reused: true, method, challenge: active,
      memberActionId: method === 'staff_approval' ? null : buildMemberActionId(userId, active.challengeId),
      staffActionIds: method !== 'staff_approval' ? null : Object.fromEntries((active.allowedActions || []).map(action => [action, buildStaffActionId(userId, active.challengeId, action)])),
    };
  }
  const challenge = verificationChallenges.start(guildId, userId, method, challengeConfig(settings, method));
  if (!challenge?.challengeId) return { ok: false, reason: 'challenge_creation_failed', method };
  verificationStore.upsertSession(guildId, userId, { state: 'verifying', activeSecurityMethod: method, activeChallenge: challenge });
  return {
    ok: true, pending: true, reused: false, method, challenge,
    memberActionId: method === 'staff_approval' ? null : buildMemberActionId(userId, challenge.challengeId),
    staffActionIds: method !== 'staff_approval' ? null : Object.fromEntries((challenge.allowedActions || []).map(action => [action, buildStaffActionId(userId, challenge.challengeId, action)])),
  };
}

function submitAnswer(guildId, actingUserId, targetUserId, challengeId, suppliedAnswer) {
  if (clean(actingUserId) !== clean(targetUserId)) return { ok: false, reason: 'wrong_member' };
  const session = verificationStore.getSession(guildId, targetUserId) || {};
  if (TERMINAL_STATES.has(session.state)) return { ok: false, reason: 'terminal_session', state: session.state };
  const active = verificationChallenges.active(guildId, targetUserId);
  if (!active || clean(active.challengeId) !== clean(challengeId)) return { ok: false, reason: 'stale_challenge' };
  const result = verificationChallenges.answer(guildId, targetUserId, challengeId, suppliedAnswer);
  if (result.ok && result.complete) return { ...result, resumeFlow: true, completedSecurity: markCompleted(guildId, targetUserId, result.challenge.method) };
  if (!result.ok && result.complete) return { ...result, recordFailure: true, resumeFlow: false };
  return { ...result, resumeFlow: false };
}

function resolveStaffAction(guildId, targetUserId, challengeId, staffUserId, action) {
  const session = verificationStore.getSession(guildId, targetUserId) || {};
  if (TERMINAL_STATES.has(session.state)) return { ok: false, complete: false, reason: 'terminal_session', state: session.state };
  const active = verificationChallenges.active(guildId, targetUserId);
  if (!active || clean(active.challengeId) !== clean(challengeId) || active.method !== 'staff_approval') return { ok: false, complete: false, reason: 'stale_challenge' };
  const result = verificationChallenges.staffAction(guildId, targetUserId, challengeId, staffUserId, action);
  if (result.ok && result.action === 'approve') return { ...result, resumeFlow: true, completedSecurity: markCompleted(guildId, targetUserId, 'staff_approval') };
  return { ...result, resumeFlow: false, recordFailure: result.complete === true && result.action === 'reject', quarantine: result.complete === true && result.action === 'quarantine' };
}

function recover(guildId, userId) {
  const before = verificationStore.getSession(guildId, userId);
  if (!before) return { ok: true, changed: false, reason: 'no_session', session: sessionState(guildId, userId) };
  const challenge = before.activeChallenge || null;
  let changed = false;
  let reason = 'healthy';
  if (TERMINAL_STATES.has(before.state) && (challenge || before.activeSecurityMethod)) {
    verificationStore.upsertSession(guildId, userId, { activeChallenge: null, activeSecurityMethod: null }); changed = true; reason = 'terminal_session_cleaned';
  } else if (challenge?.status === 'pending' && verificationChallenges.isExpired(challenge)) {
    verificationChallenges.expire(guildId, userId, challenge.challengeId); changed = true; reason = 'expired_challenge_closed';
  } else if (!challenge && before.activeSecurityMethod) {
    verificationStore.upsertSession(guildId, userId, { activeSecurityMethod: null }); changed = true; reason = 'stale_security_marker_cleared';
  } else if (challenge?.status !== 'pending' && before.activeSecurityMethod) {
    verificationStore.upsertSession(guildId, userId, { activeSecurityMethod: null }); changed = true; reason = 'closed_challenge_marker_cleared';
  } else if (challenge?.status === 'pending' && before.activeSecurityMethod !== challenge.method) {
    verificationStore.upsertSession(guildId, userId, { activeSecurityMethod: challenge.method, state: 'verifying' }); changed = true; reason = 'challenge_marker_repaired';
  }
  return { ok: true, changed, reason, session: sessionState(guildId, userId) };
}

function recoverGuild(guildId) {
  const section = verificationStore.getVerificationSection(guildId);
  const results = Object.keys(section.sessions || {}).map(userId => ({ userId, ...recover(guildId, userId) }));
  return { ok: true, checked: results.length, repaired: results.filter(result => result.changed).length, results };
}

module.exports = { INTERACTIVE_METHODS, MEMBER_ACTION_PREFIX, STAFF_ACTION_PREFIX, challengeConfig, buildMemberActionId, buildStaffActionId, parseActionId, sessionState, markCompleted, startStep, submitAnswer, resolveStaffAction, recover, recoverGuild };
