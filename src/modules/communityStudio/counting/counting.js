'use strict';

const { EmbedBuilder, Events } = require('discord.js');
const { getModuleSection, updateModuleSection } = require('../../../core/guild/moduleSectionManager');
const { isModuleEnabled } = require('../../../core/guild/guildManager');

const MODULE_KEY = 'counting';
const PANEL_COLOR = 0x2f80ed;

const DEFAULTS = Object.freeze({
  channelId: null,
  startingNumber: 1,
  maxConsecutivePerMember: 1,
  numbersOnly: true,
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
  acceptedMessages: {},
  playerPanelMessageId: null,
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

const CHAT_JOKES = Object.freeze([
  '🔢 Numbers only in here — save the chat for another channel.',
  '😂 I admire the conversation, but this channel only speaks numbers.',
  '🧮 Words? In my counting channel? Try a number instead.',
  '👀 That does not look very numerical to me. Numbers only!',
]);

const locks = new Map();
const suppressedDeletes = new Set();
const wiredClients = new WeakSet();

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
  const highestCount = Math.max(currentCount, toInteger(section.highestCount, currentCount, { min: -1 }));

  return {
    ...DEFAULTS,
    ...section,
    channelId: section.channelId ? String(section.channelId) : null,
    startingNumber,
    maxConsecutivePerMember: toOptionalPositiveInteger(section.maxConsecutivePerMember, DEFAULTS.maxConsecutivePerMember),
    numbersOnly: section.numbersOnly !== false,
    deleteIncorrect: section.deleteIncorrect !== false,
    funnyResponses: section.funnyResponses !== false,
    answerAfterFailures: toOptionalPositiveInteger(section.answerAfterFailures, DEFAULTS.answerAfterFailures),
    responseCleanupSeconds: toOptionalPositiveInteger(section.responseCleanupSeconds, DEFAULTS.responseCleanupSeconds),
    milestoneAnnouncements: section.milestoneAnnouncements === true,
    milestoneInterval: toInteger(section.milestoneInterval, DEFAULTS.milestoneInterval, { min: 1 }),
    currentCount,
    highestCount,
    lastCounterId: section.lastCounterId ? String(section.lastCounterId) : null,
    consecutiveCount: toInteger(section.consecutiveCount, 0),
    failureStreak: toInteger(section.failureStreak, 0),
    lastJokeIndex: Number.isInteger(section.lastJokeIndex) ? section.lastJokeIndex : -1,
    memberStats: section.memberStats && typeof section.memberStats === 'object' && !Array.isArray(section.memberStats) ? section.memberStats : {},
    acceptedMessages: section.acceptedMessages && typeof section.acceptedMessages === 'object' && !Array.isArray(section.acceptedMessages) ? section.acceptedMessages : {},
    playerPanelMessageId: section.playerPanelMessageId ? String(section.playerPanelMessageId) : null,
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
      acceptedMessages: {},
      playerPanelMessageId: null,
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
    acceptedMessages: {},
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
  const sent = await channel.send({ content, allowedMentions: userId ? { users: [userId], parse: [] } : { parse: [] } }).catch(() => null);
  if (!sent) return null;
  const seconds = section.responseCleanupSeconds;
  if (seconds !== null && seconds !== undefined) {
    const timer = setTimeout(() => sent.delete().catch(() => null), seconds * 1000);
    timer.unref?.();
  }
  return sent;
}

function buildPlayerEmbed(section) {
  return new EmbedBuilder()
    .setColor(PANEL_COLOR)
    .setTitle('🔢 Counting')
    .setDescription([
      '**Think you have what it takes to count?**',
      '',
      'Sounds easy, right? Start us off and let’s see how far the server can go before Goliath starts questioning everyone’s maths. 👀',
      '',
      '**How to Play**',
      `Post the **next number** in the sequence${section.maxConsecutivePerMember === 1 ? ' and let somebody else take the next turn' : ''}.`,
      section.numbersOnly ? 'Keep this channel to **numbers only** — other messages may be removed.' : 'Keep the count moving in the correct order.',
      '',
      `**Current Count:** \`${section.currentCount}\``,
      `**Next Number:** \`${expectedNext(section)}\``,
      `**Server Record:** \`${section.highestCount}\``,
      '',
      '**How high can you get? Good luck. 🔢**',
    ].join('\n'))
    .setFooter({ text: 'Goliath Counting' });
}

async function getCountingChannel(guild, section = getSection(guild.id)) {
  if (!section.channelId) return null;
  return guild.channels.cache.get(section.channelId) || guild.channels.fetch(section.channelId).catch(() => null);
}

async function deployPlayerPanel(guild, { forceNew = false, actorId = null } = {}) {
  let section = getSection(guild.id);
  const channel = await getCountingChannel(guild, section);
  if (!channel?.isTextBased?.() || !channel.send) throw new Error('Choose a valid counting channel first.');

  if (!forceNew && section.playerPanelMessageId) {
    const existing = await channel.messages.fetch(section.playerPanelMessageId).catch(() => null);
    if (existing) {
      await existing.edit({ embeds: [buildPlayerEmbed(section)] });
      return existing;
    }
  }

  const sent = await channel.send({ embeds: [buildPlayerEmbed(section)], allowedMentions: { parse: [] } });
  section = updateSection(guild.id, (current) => ({ ...current, playerPanelMessageId: sent.id }), {
    actorId,
    action: 'counting_player_panel_deployed',
  });
  return sent;
}

async function refreshPlayerPanel(guild, section = getSection(guild.id)) {
  if (!section.playerPanelMessageId) return null;
  const channel = await getCountingChannel(guild, section);
  if (!channel?.messages) return null;
  const message = await channel.messages.fetch(section.playerPanelMessageId).catch(() => null);
  if (!message) {
    updateSection(guild.id, (current) => ({ ...current, playerPanelMessageId: null }), { action: 'counting_player_panel_missing' });
    return null;
  }
  await message.edit({ embeds: [buildPlayerEmbed(section)] }).catch(() => null);
  return message;
}

async function rejectNonNumber(message, section) {
  if (!section.numbersOnly) return false;
  const joke = nextJoke(section, CHAT_JOKES);
  const updated = updateSection(message.guild.id, (current) => ({
    ...current,
    lastJokeIndex: section.funnyResponses ? joke.index : current.lastJokeIndex,
  }), { actorId: message.author.id, action: 'counting_non_number_removed' });
  await message.delete().catch(() => null);
  const text = section.funnyResponses ? `<@${message.author.id}> ${joke.text}` : `<@${message.author.id}> Numbers only in the counting channel.`;
  await sendTemporaryMessage(message.channel, text, updated, message.author.id);
  return true;
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
  }), { actorId: message.author.id, action: 'counting_failed_attempt' });

  await deleteIncorrectMessage(message, updated);
  await sendTemporaryMessage(message.channel, parts.join(' '), updated, message.author.id);
  return true;
}

async function rejectConsecutiveTurn(message, section) {
  const joke = nextJoke(section, TURN_JOKES);
  const updated = updateSection(message.guild.id, (current) => ({
    ...current,
    lastJokeIndex: section.funnyResponses ? joke.index : current.lastJokeIndex,
  }), { actorId: message.author.id, action: 'counting_consecutive_limit' });
  await deleteIncorrectMessage(message, updated);
  const text = section.funnyResponses ? `<@${message.author.id}> ${joke.text}` : `<@${message.author.id}> Let another member count before you go again.`;
  await sendTemporaryMessage(message.channel, text, updated, message.author.id);
  return true;
}

async function acceptCount(message, section, number) {
  const sameMember = section.lastCounterId === message.author.id;
  const nextConsecutive = sameMember ? section.consecutiveCount + 1 : 1;
  const memberStats = { ...section.memberStats };
  const previous = memberStats[message.author.id] && typeof memberStats[message.author.id] === 'object' ? memberStats[message.author.id] : {};
  memberStats[message.author.id] = {
    ...previous,
    validCounts: toInteger(previous.validCounts, 0) + 1,
    lastCount: number,
    lastCountedAt: new Date().toISOString(),
  };
  const acceptedMessages = { ...section.acceptedMessages, [message.id]: { number, userId: message.author.id } };

  const updated = updateSection(message.guild.id, (current) => ({
    ...current,
    currentCount: number,
    highestCount: Math.max(current.highestCount, number),
    lastCounterId: message.author.id,
    consecutiveCount: nextConsecutive,
    failureStreak: 0,
    memberStats,
    acceptedMessages,
  }), { actorId: message.author.id, action: 'counting_valid_count' });

  await refreshPlayerPanel(message.guild, updated);

  if (updated.milestoneAnnouncements && updated.milestoneInterval > 0 && number > 0 && number % updated.milestoneInterval === 0) {
    await message.channel.send({ content: `🎉 **${number}!** The server just hit a counting milestone. Keep it going!`, allowedMentions: { parse: [] } }).catch(() => null);
  }
  return true;
}

async function processMessage(message) {
  const section = getSection(message.guild.id);
  if (!isModuleEnabled(message.guild.id, MODULE_KEY)) return false;
  if (!section.channelId || message.channelId !== section.channelId) return false;

  const content = String(message.content || '').trim();
  const hasMedia = Boolean(message.attachments?.size || message.stickers?.size || message.embeds?.length);
  const isPlainNumber = /^\d+$/.test(content) && !hasMedia;
  if (!isPlainNumber) return rejectNonNumber(message, section);

  const expected = expectedNext(section);
  const number = Number(content);
  if (!Number.isSafeInteger(number) || number !== expected) return rejectWrongCount(message, section, expected);

  const maxConsecutive = section.maxConsecutivePerMember;
  if (maxConsecutive !== null && section.lastCounterId === message.author.id && section.consecutiveCount >= maxConsecutive) {
    return rejectConsecutiveTurn(message, section);
  }
  return acceptCount(message, section, number);
}

function enqueue(key, task) {
  const previous = locks.get(key) || Promise.resolve();
  const current = previous.catch(() => null).then(task).finally(() => {
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

async function handleMessageDelete(message) {
  if (!message?.guild?.id) return false;
  if (suppressedDeletes.delete(message.id)) return false;
  const section = getSection(message.guild.id);
  if (!isModuleEnabled(message.guild.id, MODULE_KEY) || message.channelId !== section.channelId) return false;

  if (message.id === section.playerPanelMessageId) {
    updateSection(message.guild.id, (current) => ({ ...current, playerPanelMessageId: null }), { action: 'counting_player_panel_deleted' });
    return true;
  }

  const accepted = section.acceptedMessages[message.id];
  if (!accepted) return false;
  const channel = message.channel || await getCountingChannel(message.guild, section);
  if (!channel?.send) return false;
  await channel.send({
    content: `🗑️ **${accepted.number}** was deleted, but Goliath remembers. Continue with **${expectedNext(section)}**.`,
    allowedMentions: { parse: [] },
  }).catch(() => null);
  return true;
}

async function handleMessageUpdate(before, after) {
  const message = after || before;
  if (!message?.guild?.id || message.author?.bot) return false;
  const section = getSection(message.guild.id);
  if (!isModuleEnabled(message.guild.id, MODULE_KEY) || message.channelId !== section.channelId) return false;
  const accepted = section.acceptedMessages[message.id];
  if (!accepted) return false;
  const content = String(message.content || '').trim();
  if (content === String(accepted.number) && !message.attachments?.size && !message.stickers?.size && !message.embeds?.length) return false;

  suppressedDeletes.add(message.id);
  await message.delete().catch(() => suppressedDeletes.delete(message.id));
  await message.channel.send({
    content: `✏️ **${accepted.number}** was edited, but Goliath remembers the original count. Continue with **${expectedNext(section)}**.`,
    allowedMentions: { parse: [] },
  }).catch(() => null);
  return true;
}

async function resetWithMarker(guild, meta = {}) {
  const before = getSection(guild.id);
  if (!before.channelId) return resetProgress(guild.id, meta);
  return enqueue(`${guild.id}:${before.channelId}`, async () => {
    const channel = await getCountingChannel(guild, before);
    if (before.playerPanelMessageId && channel?.messages) {
      const oldPanel = await channel.messages.fetch(before.playerPanelMessageId).catch(() => null);
      if (oldPanel) await oldPanel.delete().catch(() => null);
    }

    const reset = resetProgress(guild.id, meta);
    if (channel?.send) {
      await channel.send({
        embeds: [new EmbedBuilder()
          .setColor(PANEL_COLOR)
          .setTitle('🔄 COUNT RESET')
          .setDescription([
            '**Well... that happened. 😂**',
            '',
            'The old run is over and we’re heading back to the beginning.',
            '',
            `**New Count Starts At:** \`${reset.startingNumber}\``,
            '',
            'Previous numbers above are from the last run.',
            '**Anything below this message belongs to the new game.**',
            '',
            'Who’s brave enough to start us off? 👀',
          ].join('\n'))],
        allowedMentions: { parse: [] },
      }).catch(() => null);
      await deployPlayerPanel(guild, { forceNew: true, actorId: meta.actorId || null }).catch(() => null);
    }
    return getSection(guild.id);
  });
}

function registerProtectionEvents(client) {
  if (!client || wiredClients.has(client)) return false;
  wiredClients.add(client);
  client.on(Events.MessageDelete, (message) => handleMessageDelete(message).catch((error) => console.warn('[Counting] MessageDelete:', error?.message || error)));
  client.on(Events.MessageUpdate, (before, after) => handleMessageUpdate(before, after).catch((error) => console.warn('[Counting] MessageUpdate:', error?.message || error)));
  return true;
}

module.exports = {
  MODULE_KEY,
  DEFAULTS,
  getSection,
  updateSection,
  expectedNext,
  resetProgress,
  resetWithMarker,
  setCurrentCount,
  deployPlayerPanel,
  refreshPlayerPanel,
  handleMessageCreate,
  handleMessageDelete,
  handleMessageUpdate,
  registerProtectionEvents,
};
