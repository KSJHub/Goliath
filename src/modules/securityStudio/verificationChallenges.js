'use strict';

const crypto = require('crypto');
const verificationStore = require('./verificationStore');

const METHODS = new Set(['captcha', 'minigame', 'one_time_challenge', 'staff_approval']);
const GAME_TYPES = new Set(['target_match', 'memory_match', 'sequence', 'pattern_match', 'reaction', 'odd_one_out', 'order']);
const TERMINAL_STATES = new Set(['passed', 'failed', 'expired', 'cancelled']);
const now = () => new Date().toISOString();
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const token = (bytes = 12) => crypto.randomBytes(bytes).toString('hex');
const int = (min, max) => crypto.randomInt(min, max + 1);
const pick = values => values[crypto.randomInt(0, values.length)];
const normalizeAnswer = value => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

function getSession(guildId, userId) {
  return verificationStore.getSession(guildId, userId);
}

function ensureSession(guildId, userId) {
  const session = getSession(guildId, userId);
  if (!session) throw new Error('No active Verification session exists for this member.');
  if (session.state === 'verified') throw new Error('This member is already verified.');
  if (session.state === 'quarantined') throw new Error('This member is quarantined and cannot start another challenge.');
  return session;
}

function expiresIn(seconds) {
  return new Date(Date.now() + Math.max(15, Number(seconds || 60)) * 1000).toISOString();
}

function isExpired(challenge) {
  return Boolean(challenge?.expiresAt && new Date(challenge.expiresAt).getTime() <= Date.now());
}

function publicChallenge(challenge) {
  if (!challenge) return null;
  const { answerHash, answerSalt, expectedAnswer, ...safe } = challenge;
  return safe;
}

function active(guildId, userId) {
  const challenge = getSession(guildId, userId)?.activeChallenge || null;
  return publicChallenge(challenge);
}

function persistChallenge(guildId, userId, challenge) {
  verificationStore.upsertSession(guildId, userId, {
    state: 'verifying',
    activeChallenge: challenge,
    activeSecurityMethod: challenge.method,
  });
  verificationStore.addSecurityHistory(guildId, userId, {
    type: 'challenge_started',
    method: challenge.method,
    challengeId: challenge.challengeId,
    expiresAt: challenge.expiresAt,
    round: challenge.round || 1,
    rounds: challenge.rounds || 1,
  });
  verificationStore.incrementAnalytics(guildId, { challengesStarted: 1 });
  return publicChallenge(challenge);
}

function createBase(method, config = {}, extra = {}) {
  if (!METHODS.has(method)) throw new Error(`Unsupported Verification challenge method: ${method}`);
  return {
    challengeId: `challenge_${token(8)}`,
    method,
    status: 'pending',
    attempts: 0,
    maxAttempts: Math.max(1, Number(config.maxChallengeAttempts || 1)),
    createdAt: now(),
    expiresAt: expiresIn(config.timeLimitSeconds || 120),
    resolvedAt: null,
    resolvedBy: null,
    ...extra,
  };
}

function answerFields(answer) {
  const salt = token(8);
  return { answerSalt: salt, answerHash: hash(`${salt}:${normalizeAnswer(answer)}`) };
}

function createMathCaptcha(config = {}) {
  const difficulty = ['easy', 'normal', 'hard'].includes(config.difficulty) ? config.difficulty : 'normal';
  let a; let b; let op; let answer;
  if (difficulty === 'easy') {
    a = int(2, 20); b = int(2, 20); op = '+'; answer = a + b;
  } else if (difficulty === 'hard') {
    a = int(6, 20); b = int(2, 12); op = '×'; answer = a * b;
  } else {
    a = int(10, 60); b = int(2, 30); op = pick(['+', '-']);
    if (op === '-' && b > a) [a, b] = [b, a];
    answer = op === '+' ? a + b : a - b;
  }
  return createBase('captcha', config, {
    prompt: `Security check: what is ${a} ${op} ${b}?`,
    challengeType: 'math',
    difficulty,
    ...answerFields(answer),
  });
}

function createOneTimeChallenge(config = {}) {
  const code = String(int(100000, 999999));
  return createBase('one_time_challenge', config, {
    prompt: `Enter this one-time verification code: ${code}`,
    challengeType: 'code',
    ...answerFields(code),
  });
}

function sequenceGame(config = {}) {
  const length = config.difficulty === 'hard' ? 7 : config.difficulty === 'easy' ? 4 : 5;
  const sequence = Array.from({ length }, () => int(1, 9));
  return { prompt: `Repeat this sequence without spaces: ${sequence.join(' · ')}`, answer: sequence.join(''), gameType: 'sequence' };
}
function orderGame() {
  const values = Array.from({ length: 5 }, () => int(10, 99));
  return { prompt: `Put these numbers in ascending order, separated by spaces: ${values.join(', ')}`, answer: [...values].sort((a, b) => a - b).join(' '), gameType: 'order' };
}
function oddOneOutGame() {
  const sets = [
    ['diamond', 'ruby', 'emerald', 'sapphire', 'banana'],
    ['circle', 'square', 'triangle', 'rectangle', 'guitar'],
    ['red', 'blue', 'green', 'purple', 'window'],
  ];
  const values = pick(sets);
  return { prompt: `Which item does not belong? ${values.join(' · ')}`, answer: values[values.length - 1], gameType: 'odd_one_out' };
}
function targetMatchGame() {
  const target = pick(['◆', '●', '■', '▲', '★']);
  return { prompt: `Type the target symbol exactly: ${target}`, answer: target, gameType: 'target_match' };
}
function patternGame() {
  const start = int(1, 8); const step = int(2, 6);
  const values = Array.from({ length: 4 }, (_, index) => start + index * step);
  return { prompt: `What number comes next? ${values.join(', ')}, ?`, answer: start + 4 * step, gameType: 'pattern_match' };
}
function memoryGame() {
  const words = ['lion', 'diamond', 'ocean', 'forge', 'vault', 'quarry'];
  const chosen = Array.from({ length: 3 }, () => pick(words));
  return { prompt: `Remember and repeat these words in order: ${chosen.join(' · ')}`, answer: chosen.join(' '), gameType: 'memory_match' };
}
function reactionGame() {
  const target = pick(['ROAR', 'CUT', 'GO', 'NOW']);
  return { prompt: `Reaction check — type **${target}** exactly.`, answer: target, gameType: 'reaction' };
}

function makeGame(config = {}, forcedType = null) {
  const enabled = (Array.isArray(config.enabledGames) ? config.enabledGames : []).filter(game => GAME_TYPES.has(game));
  const available = enabled.length ? enabled : [...GAME_TYPES];
  const gameType = forcedType && GAME_TYPES.has(forcedType)
    ? forcedType
    : config.random === false && GAME_TYPES.has(config.gameType) ? config.gameType : pick(available);
  if (gameType === 'sequence') return sequenceGame(config);
  if (gameType === 'order') return orderGame(config);
  if (gameType === 'odd_one_out') return oddOneOutGame(config);
  if (gameType === 'target_match') return targetMatchGame(config);
  if (gameType === 'pattern_match') return patternGame(config);
  if (gameType === 'memory_match') return memoryGame(config);
  return reactionGame(config);
}

function createMinigame(config = {}) {
  const game = makeGame(config);
  const rounds = Math.max(1, Math.min(10, Number(config.rounds || 1)));
  return createBase('minigame', { ...config, maxChallengeAttempts: config.maxChallengeAttempts || 1 }, {
    prompt: game.prompt,
    challengeType: 'minigame',
    gameType: game.gameType,
    difficulty: config.difficulty || 'normal',
    round: 1,
    rounds,
    passedRounds: 0,
    gameConfig: {
      enabledGames: (Array.isArray(config.enabledGames) ? config.enabledGames : []).filter(gameType => GAME_TYPES.has(gameType)),
      random: config.random !== false,
      gameType: GAME_TYPES.has(config.gameType) ? config.gameType : null,
      difficulty: config.difficulty || 'normal',
    },
    ...answerFields(game.answer),
  });
}

function createStaffApproval(config = {}) {
  return createBase('staff_approval', { maxChallengeAttempts: 1, timeLimitSeconds: Math.max(60, Number(config.timeoutMinutes || 1440) * 60) }, {
    prompt: 'Verification is waiting for staff approval.',
    challengeType: 'staff_approval',
    allowedActions: ['approve', 'reject', 'quarantine'].filter(action => config[`allow${action[0].toUpperCase()}${action.slice(1)}`] !== false),
  });
}

function start(guildId, userId, method, config = {}) {
  const session = ensureSession(guildId, userId);
  if (session.activeChallenge?.status === 'pending' && !isExpired(session.activeChallenge)) {
    if (session.activeChallenge.method !== method) throw new Error('Another Verification security challenge is already active.');
    return publicChallenge(session.activeChallenge);
  }
  if (session.activeChallenge?.status === 'pending' && isExpired(session.activeChallenge)) expire(guildId, userId, session.activeChallenge.challengeId);
  let challenge;
  if (method === 'captcha') challenge = createMathCaptcha(config);
  else if (method === 'minigame') challenge = createMinigame(config);
  else if (method === 'one_time_challenge') challenge = createOneTimeChallenge(config);
  else if (method === 'staff_approval') challenge = createStaffApproval(config);
  else throw new Error(`Unsupported Verification challenge method: ${method}`);
  return persistChallenge(guildId, userId, challenge);
}

function expire(guildId, userId, challengeId = null) {
  const session = getSession(guildId, userId);
  const challenge = session?.activeChallenge;
  if (!challenge || (challengeId && challenge.challengeId !== challengeId)) return { ok: false, reason: 'stale_challenge' };
  if (TERMINAL_STATES.has(challenge.status)) return { ok: false, reason: 'challenge_closed', challenge: publicChallenge(challenge) };
  const expired = { ...challenge, status: 'expired', resolvedAt: now() };
  verificationStore.upsertSession(guildId, userId, { activeChallenge: expired, activeSecurityMethod: null });
  verificationStore.addSecurityHistory(guildId, userId, { type: 'challenge_expired', method: challenge.method, challengeId: challenge.challengeId });
  verificationStore.incrementAnalytics(guildId, { challengesExpired: 1 });
  return { ok: false, reason: 'expired', challenge: publicChallenge(expired) };
}

function nextMinigameRound(guildId, userId, challenge) {
  const nextRound = Number(challenge.round || 1) + 1;
  const game = makeGame(challenge.gameConfig || {});
  const updated = {
    ...challenge,
    prompt: game.prompt,
    gameType: game.gameType,
    round: nextRound,
    passedRounds: Number(challenge.passedRounds || 0) + 1,
    attempts: 0,
    ...answerFields(game.answer),
  };
  verificationStore.upsertSession(guildId, userId, { activeChallenge: updated });
  verificationStore.addSecurityHistory(guildId, userId, {
    type: 'challenge_round_passed',
    method: 'minigame',
    challengeId: challenge.challengeId,
    round: challenge.round || 1,
    nextRound,
    rounds: challenge.rounds || 1,
  });
  return { ok: true, reason: 'next_round', complete: false, challenge: publicChallenge(updated) };
}

function answer(guildId, userId, challengeId, suppliedAnswer) {
  const session = ensureSession(guildId, userId);
  const challenge = session.activeChallenge;
  if (!challenge || challenge.challengeId !== challengeId) return { ok: false, reason: 'stale_challenge' };
  if (challenge.method === 'staff_approval') return { ok: false, reason: 'staff_action_required' };
  if (challenge.status !== 'pending') return { ok: false, reason: 'challenge_closed' };
  if (isExpired(challenge)) return expire(guildId, userId, challengeId);
  const attempts = Number(challenge.attempts || 0) + 1;
  const correct = hash(`${challenge.answerSalt}:${normalizeAnswer(suppliedAnswer)}`) === challenge.answerHash;

  if (correct && challenge.method === 'minigame' && Number(challenge.round || 1) < Number(challenge.rounds || 1)) {
    return nextMinigameRound(guildId, userId, { ...challenge, attempts });
  }

  const status = correct ? 'passed' : attempts >= Number(challenge.maxAttempts || 1) ? 'failed' : 'pending';
  const updated = {
    ...challenge,
    attempts,
    status,
    passedRounds: correct && challenge.method === 'minigame' ? Number(challenge.rounds || 1) : Number(challenge.passedRounds || 0),
    resolvedAt: status === 'pending' ? null : now(),
  };
  verificationStore.upsertSession(guildId, userId, {
    activeChallenge: updated,
    activeSecurityMethod: status === 'pending' ? challenge.method : null,
  });
  verificationStore.addSecurityHistory(guildId, userId, {
    type: correct ? 'challenge_passed' : 'challenge_answer_failed',
    method: challenge.method,
    challengeId,
    attempts,
    round: challenge.round || 1,
    rounds: challenge.rounds || 1,
    closed: status !== 'pending',
  });
  if (correct) verificationStore.incrementAnalytics(guildId, { challengesPassed: 1 });
  else if (status === 'failed') verificationStore.incrementAnalytics(guildId, { challengesFailed: 1 });
  return {
    ok: correct,
    reason: correct ? 'passed' : status === 'failed' ? 'failed' : 'incorrect',
    complete: status !== 'pending',
    attempts,
    attemptsRemaining: Math.max(0, Number(challenge.maxAttempts || 1) - attempts),
    challenge: publicChallenge(updated),
  };
}

function staffAction(guildId, userId, challengeId, staffUserId, action) {
  const session = ensureSession(guildId, userId);
  const challenge = session.activeChallenge;
  if (!challenge || challenge.challengeId !== challengeId || challenge.method !== 'staff_approval') return { ok: false, reason: 'stale_challenge' };
  if (challenge.status !== 'pending') return { ok: false, reason: 'challenge_closed' };
  if (isExpired(challenge)) return expire(guildId, userId, challengeId);
  if (!['approve', 'reject', 'quarantine'].includes(action) || !challenge.allowedActions?.includes(action)) return { ok: false, reason: 'action_not_allowed' };
  const status = action === 'approve' ? 'passed' : 'failed';
  const updated = { ...challenge, status, resolvedAt: now(), resolvedBy: String(staffUserId || ''), staffAction: action };
  verificationStore.upsertSession(guildId, userId, { activeChallenge: updated, activeSecurityMethod: null });
  verificationStore.addSecurityHistory(guildId, userId, { type: 'staff_verification_action', challengeId, action, staffUserId: String(staffUserId || '') });
  verificationStore.incrementAnalytics(guildId, action === 'approve' ? { challengesPassed: 1, staffApprovals: 1 } : action === 'reject' ? { challengesFailed: 1, staffRejections: 1 } : { challengesFailed: 1 });
  return { ok: action === 'approve', action, complete: true, challenge: publicChallenge(updated) };
}

function clear(guildId, userId, reason = 'cleared') {
  const session = getSession(guildId, userId);
  if (!session?.activeChallenge) return false;
  verificationStore.addSecurityHistory(guildId, userId, { type: 'challenge_cleared', method: session.activeChallenge.method, challengeId: session.activeChallenge.challengeId, reason });
  verificationStore.upsertSession(guildId, userId, { activeChallenge: null, activeSecurityMethod: null });
  return true;
}

function sweepExpired(guildId, userIds = []) {
  const expired = [];
  for (const userId of userIds) {
    const challenge = getSession(guildId, userId)?.activeChallenge;
    if (challenge?.status === 'pending' && isExpired(challenge)) {
      expire(guildId, userId, challenge.challengeId);
      expired.push(String(userId));
    }
  }
  return expired;
}

module.exports = {
  METHODS,
  GAME_TYPES,
  TERMINAL_STATES,
  normalizeAnswer,
  publicChallenge,
  active,
  isExpired,
  start,
  answer,
  staffAction,
  expire,
  clear,
  sweepExpired,
};
