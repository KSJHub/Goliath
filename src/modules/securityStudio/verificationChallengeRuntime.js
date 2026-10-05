'use strict';

const verificationChallenges = require('./verificationChallenges');
const verificationStore = require('./verificationStore');

const INTERACTIVE_METHODS = new Set(['captcha', 'minigame', 'one_time_challenge', 'staff_approval']);
const MEMBER_ACTION_PREFIX = 'verify:challenge';
const STAFF_ACTION_PREFIX = 'verify:staff';

const clean = value => String(value ?? '').trim();

function challengeConfig(settings = {}, method) {
  const security = settings.security || {};
  if (method === 'captcha') return { ...(security.captchaConfig || settings.captcha || {}) };
  if (method === 'minigame') return { ...(security.minigameConfig || settings.minigame || {}) };
  if (method === 'one_time_challenge') return { ...(security.oneTimeChallengeConfig || settings.oneTimeChallenge || {}) };
  if (method === 'staff_approval') return { ...(security.staffApprovalConfig || settings.staffApproval || {}) };
  return {};
}

function buildMemberActionId(userId, challengeId) {
  return `${MEMBER_ACTION_PREFIX}:${clean(userId)}:${clean(challengeId)}`;
}

function buildStaffActionId(userId, challengeId, action) {
  return `${STAFF_ACTION_PREFIX}:${clean(userId)}:${clean(challengeId)}:${clean(action)}`;
}

function parseActionId(customId = '') {
  const parts = clean(customId).split(':');
  if (parts[0] !== 'verify') return null;
  if (parts[1] === 'challenge' && parts.length === 4) {
    return { type: 'member_answer', userId: parts[2], challengeId: parts[3] };
  }
  if (parts[1] === 'staff' && parts.length === 5) {
    return { type: 'staff_action', userId: parts[2], challengeId: parts[3], action: parts[4] };
  }
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
  verificationStore.upsertSession(guildId, userId, {
    state: 'verifying',
    completedSecurity: [...completed],
    activeSecurityMethod: null,
  });
  return [...completed];
}

function startStep(guildId, userId, method, settings = {}) {
  if (!INTERACTIVE_METHODS.has(method)) return { ok: false, reason: 'not_interactive', method };
  const challenge = verificationChallenges.start(guildId, userId, method, challengeConfig(settings, method));
  return {
    ok: true,
    pending: true,
    method,
    challenge,
    memberActionId: method === 'staff_approval' ? null : buildMemberActionId(userId, challenge.challengeId),
    staffActionIds: method !== 'staff_approval' ? null : Object.fromEntries(
      (challenge.allowedActions || []).map(action => [action, buildStaffActionId(userId, challenge.challengeId, action)]),
    ),
  };
}

function submitAnswer(guildId, actingUserId, targetUserId, challengeId, suppliedAnswer) {
  if (clean(actingUserId) !== clean(targetUserId)) return { ok: false, reason: 'wrong_member' };
  const result = verificationChallenges.answer(guildId, targetUserId, challengeId, suppliedAnswer);
  if (result.ok && result.complete) {
    const completedSecurity = markCompleted(guildId, targetUserId, result.challenge.method);
    return { ...result, resumeFlow: true, completedSecurity };
  }
  if (!result.ok && result.complete) return { ...result, recordFailure: true, resumeFlow: false };
  return { ...result, resumeFlow: false };
}

function resolveStaffAction(guildId, targetUserId, challengeId, staffUserId, action) {
  const result = verificationChallenges.staffAction(guildId, targetUserId, challengeId, staffUserId, action);
  if (result.ok && result.action === 'approve') {
    const completedSecurity = markCompleted(guildId, targetUserId, 'staff_approval');
    return { ...result, resumeFlow: true, completedSecurity };
  }
  return {
    ...result,
    resumeFlow: false,
    recordFailure: result.complete === true && result.action === 'reject',
    quarantine: result.complete === true && result.action === 'quarantine',
  };
}

function recover(guildId, userId) {
  const result = verificationChallenges.recover(guildId, userId);
  const state = sessionState(guildId, userId);
  return { ...result, session: state };
}

function recoverGuild(guildId) {
  return verificationChallenges.recoverGuild(guildId);
}

module.exports = {
  INTERACTIVE_METHODS,
  MEMBER_ACTION_PREFIX,
  STAFF_ACTION_PREFIX,
  challengeConfig,
  buildMemberActionId,
  buildStaffActionId,
  parseActionId,
  sessionState,
  markCompleted,
  startStep,
  submitAnswer,
  resolveStaffAction,
  recover,
  recoverGuild,
};
