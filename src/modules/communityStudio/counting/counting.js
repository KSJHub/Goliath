'use strict';

const { getModuleSection, updateModuleSection } = require('../../../core/guild/moduleSectionManager');
const { isModuleEnabled } = require('../../../core/guild/guildManager');

const MODULE_KEY = 'counting';

const DEFAULTS = Object.freeze({
  channelId: null,
  startingNumber: 1,
  maxConsecutivePerMember: 1,
  deleteIncorrect: true,
  funnyResponses: true,
  answerAfterFailures: 2,
  responseCleanupSeconds: 8,
  milestoneAnnouncements: false,
  milestoneInterval: 100,
  currentCount: 0,
  highestCount: 0,
  lastCounterId: null,
  consecutiveCount: 0,
  failureStreak: 0,
  lastJokeIndex: -1,
  memberStats: {},
});

const WRONG_JOKES = Object.freeze([
  '🤨 Creative. Unfortunately numbers still have an order.',
  '😂 That number took a wrong turn.',
  '🧮 I promise the numbers are not shuffled.',
  '💀 We are counting, not improvising.',
  '📚 Somewhere, a maths teacher just sighed.',
  '🔢 Bold choice. Wrong number, though.',
  '😅 Close enough only works with horseshoes, not counting.',
  '👀 I saw that. The numbers saw it too.',
]);

const TURN_JOKES = Object.freeze([
  '😏 Nice try — give somebody else a turn.',
  '😂 You again? Sharing is counting caring.',
  '👋 Easy there, number hog. Let someone else have a go.',
  '🔢 Correct number, wrong turn. Pass the baton!',
]);

const locks = new Map();

function toInteger(value, fallback, { min = 0 } = {}) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min) return fallback;
  return number;
}

function toOptionalPositiveInteger(value, fallback = null) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) return fallback;
  return number;
}

function normalizeSection(section = {}) {
  const startingNumber = toInteger(section.startingNumber, DEFAULTS.startingNumber);
  const baseline = startingNumber - 1;
  const currentCount = toInteger(section.currentCount, baseline, { min: -1 });
  const highestCount = Math.max(
    currentCount,
    toInteger(section.highestCount, currentCount, { min: -1 }),
  );

  return {
    ...DEFAULTS,
    ...section,
    channelId: section.channelId ? String(section.channelId) : null,
    startingNumber,
    maxConsecutivePerMember: toOptionalPositiveInteger(
      section.maxConsecutivePerMember,
      DEFAULTS.maxConsecutivePerMember,
    ),
    deleteIncorrect: section.deleteIncorrect !== false,
    funnyResponses: section.funnyResponses !== false,
    answerAfterFailures: toOptionalPositiveInteger(
      section.answerAfterFailures,
      DEFAULTS.answerAfterFailures,
    ),
    responseCleanupSeconds: toOptionalPositiveInteger(
      section.responseCleanupSeconds,
      DEFAULTS.responseCleanupSeconds,
    ),
    milestoneAnnouncements: section.milestoneAnnouncements === true,
    milestoneInterval: toInteger(section.milestoneInterval, DEFAULTS.milestoneInterval, { min: 1 }),
    currentCount,
    highestCount,
    lastCounterId: section.lastCounterId ? String(section.lastCounterId) : null,
    consecutiveCount: toInteger(section.consecutiveCount, 0),
    failureStreak: toInteger(section.failureStreak, 0),
    lastJokeIndex: Number.isInteger(section.lastJokeIndex) ? section.lastJokeIndex : -1,
    memberStats: section.memberStats && typeof section.memberStats === 'object' && !Array.isArray(section.memberStats)
      ? section.memberStats
      : {},
  };
}

function getSection(guildId) {
  return normalizeSection(getModuleSection(guildId, MODULE_KEY, DEFAULTS));
}

function updateSection(guildId, updater, meta = {}) {
  return normalizeSection(updateModuleSection(
    guildId,
    MODULE_KEY,
    (current) => {
      const normalized = normalizeSection(current);
      const next = typeof updater === 'function' ? updater(normalized) : { ...normalized, ...(updater || {}) };
      return normalizeSection(next);
    },
    DEFAULTS,
    meta,
  ));
}

function expectedNext(section) {
  return Number(section.currentCount) + 1;
}

function resetProgress(guildId, meta = {}) {
  return updateSection(guildId, (section) => {
    const baseline = section.startingNumber - 1;
    return {
      ...section,
      currentCount: baseline,
      highestCount: baseline,
      lastCounterId: null,
      consecutiveCount: 0,
      failureStreak: 0,
      lastJokeIndex: -1,
      memberStats: {},
    };
  }, meta);
}

function setCurrentCount(guildId, count, meta = {}) {
  const nextCount = toInteger(count, null);
  if (nextCount === null) throw new Error('Current count must be a whole number of 0 or higher.');
  return updateSection(guildId, (section) => ({
    ...section,
    currentCount: nextCount,
    highestCount: Math.max(section.highestCount, nextCount),
    lastCounterId: null,
    consecutiveCount: 0,
    failureStreak: 0,
  }), meta);
}

function nextJoke(section, pool) {
  if (!pool.length) return { text: '', index: -1 };
  let index = Math.floor(Math.random() * pool.length);
  if (pool.length > 1 && index === section.lastJokeIndex) index = (index + 1) % pool.length;
  return { text: pool[index], index };
}

async function deleteIncorrectMessage(message, section) {
  if (!section.deleteIncorrect) return;
  await message.delete().catch(() => null);
}

async function sendTemporaryMessage(channel, content, section, userId = null) {
  if (!content || !channel?.send) return null;
  const sent = await channel.send({
    content,
    allowedMentions: userId ? { users: [userId], parse: [] } : { parse: [] },
  }).catch(() => null);
  if (!sent) return null;

  const seconds = section.responseCleanupSeconds;
  if (seconds !== null && seconds !== undefined) {
    const timer = setTimeout(() => sent.delete().catch(() => null), seconds * 1000);
    timer.unref?.();
  }
  return sent;
}

async function rejectWrongCount(message, section, expected) {
  const joke = nextJoke(section, WRONG_JOKES);
  const nextFailureStreak = section.failureStreak + 1;
  const revealAt = section.answerAfterFailures;
  const reveal = revealAt !== null && nextFailureStreak >= revealAt;
  const parts = [];

  if (section.funnyResponses) parts.push(`<@${message.author.id}> ${joke.text}`);
  if (reveal) parts.push(`The next number is **${expected}**.`);
  if (!parts.length) parts.push(`<@${message.author.id}> That count is out of sequence.`);

  const updated = updateSection(message.guild.id, (current) => ({
    ...current,
    failureStreak: nextFailureStreak,
    lastJokeIndex: section.funnyResponses ? joke.index : current.lastJokeIndex,
  }), {
    actorId: message.author.id,
    action: 'counting_failed_attempt',
  });

  await deleteIncorrectMessage(message, updated);
  await sendTemporaryMessage(message.channel, parts.join(' '), updated, message.author.id);
  return true;
}

async function rejectConsecutiveTurn(message, section) {
  const joke = nextJoke(section, TURN_JOKES);
  const updated = updateSection(message.guild.id, (current) => ({
    ...current,
    lastJokeIndex: section.funnyResponses ? joke.index : current.lastJokeIndex,
  }), {
    actorId: message.author.id,
    action: 'counting_consecutive_limit',
  });

  await deleteIncorrectMessage(message, updated);
  const text = section.funnyResponses
    ? `<@${message.author.id}> ${joke.text}`
    : `<@${message.author.id}> Let another member count before you go again.`;
  await sendTemporaryMessage(message.channel, text, updated, message.author.id);
  return true;
}

async function acceptCount(message, section, number) {
  const sameMember = section.lastCounterId === message.author.id;
  const nextConsecutive = sameMember ? section.consecutiveCount + 1 : 1;
  const memberStats = { ...section.memberStats };
  const previous = memberStats[message.author.id] && typeof memberStats[message.author.id] === 'object'
    ? memberStats[message.author.id]
    : {};
  memberStats[message.author.id] = {
    ...previous,
    validCounts: toInteger(previous.validCounts, 0) + 1,
    lastCount: number,
    lastCountedAt: new Date().toISOString(),
  };

  const updated = updateSection(message.guild.id, (current) => ({
    ...current,
    currentCount: number,
    highestCount: Math.max(current.highestCount, number),
    lastCounterId: message.author.id,
    consecutiveCount: nextConsecutive,
    failureStreak: 0,
    memberStats,
  }), {
    actorId: message.author.id,
    action: 'counting_valid_count',
  });

  if (
    updated.milestoneAnnouncements
    && updated.milestoneInterval > 0
    && number > 0
    && number % updated.milestoneInterval === 0
  ) {
    await message.channel.send({
      content: `🎉 **${number}!** The server just hit a counting milestone. Keep it going!`,
      allowedMentions: { parse: [] },
    }).catch(() => null);
  }

  return true;
}

async function processMessage(message) {
  const section = getSection(message.guild.id);
  if (!isModuleEnabled(message.guild.id, MODULE_KEY)) return false;
  if (!section.channelId || message.channelId !== section.channelId) return false;

  const expected = expectedNext(section);
  const content = String(message.content || '').trim();
  const number = /^\d+$/.test(content) ? Number(content) : NaN;

  if (!Number.isSafeInteger(number) || number !== expected) {
    return rejectWrongCount(message, section, expected);
  }

  const maxConsecutive = section.maxConsecutivePerMember;
  if (
    maxConsecutive !== null
    && section.lastCounterId === message.author.id
    && section.consecutiveCount >= maxConsecutive
  ) {
    return rejectConsecutiveTurn(message, section);
  }

  return acceptCount(message, section, number);
}

function enqueue(key, task) {
  const previous = locks.get(key) || Promise.resolve();
  const current = previous
    .catch(() => null)
    .then(task)
    .finally(() => {
      if (locks.get(key) === current) locks.delete(key);
    });
  locks.set(key, current);
  return current;
}

async function handleMessageCreate(message) {
  if (!message?.guild?.id || !message.member || message.author?.bot || message.webhookId) return false;
  if (!isModuleEnabled(message.guild.id, MODULE_KEY)) return false;
  const section = getSection(message.guild.id);
  if (!section.channelId || message.channelId !== section.channelId) return false;
  return enqueue(`${message.guild.id}:${message.channelId}`, () => processMessage(message));
}

module.exports = {
  MODULE_KEY,
  DEFAULTS,
  getSection,
  updateSection,
  expectedNext,
  resetProgress,
  setCurrentCount,
  handleMessageCreate,
};
