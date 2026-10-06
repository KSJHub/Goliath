'use strict';

const { EmbedBuilder, Events, PermissionFlagsBits } = require('discord.js');
const { getModuleSection, updateModuleSection } = require('../../../core/guild/moduleSectionManager');
const { isModuleEnabled } = require('../../../core/guild/guildManager');

const MODULE_KEY = 'counting';
const PANEL_COLOR = 0x2f80ed;
const DEFAULTS = Object.freeze({ channelId: null, startingNumber: 1, maxConsecutivePerMember: 1, numbersOnly: true, deleteIncorrect: true, funnyResponses: true, answerAfterFailures: 2, responseCleanupSeconds: 8, milestoneAnnouncements: false, milestoneInterval: 100, failureLimit: 0, currentCount: 0, highestCount: 0, lastCounterId: null, consecutiveCount: 0, failureStreak: 0, lastJokeIndex: -1, memberStats: {}, acceptedMessages: {}, playerPanelMessageId: null });
const WRONG_JOKES = Object.freeze(['🤨 Creative. Unfortunately numbers still have an order.', '😂 That number took a wrong turn.', '🧮 I promise the numbers are not shuffled.', '💀 We are counting, not improvising.', '📚 Somewhere, a maths teacher just sighed.', '🔢 Bold choice. Wrong number, though.', '😅 Close enough only works with horseshoes, not counting.', '👀 I saw that. The numbers saw it too.']);
const TURN_JOKES = Object.freeze(['😂 You’ve reached your turn limit. Let somebody else count!', '🛑 Easy there, number machine. Someone else’s turn!', '👀 We know you can count. Now let someone else prove they can.', '🔢 That’s your turn limit reached. Pass the numbers on!', '😏 Correct number, but you’ve used your turns. Share the glory!']);
const CHAT_JOKES = Object.freeze(['🔢 Numbers only in here — save the chat for another channel.', '😂 I admire the conversation, but this channel only speaks numbers.', '🧮 Words? In my counting channel? Try a number instead.', '👀 That does not look very numerical to me. Numbers only!']);
const locks = new Map();
const suppressedDeletes = new Set();
const wiredClients = new WeakSet();

function toInteger(value, fallback, { min = 0 } = {}) { const number = Number(value); if (!Number.isSafeInteger(number) || number < min) return fallback; return number; }
function toOptionalPositiveInteger(value, fallback = null) { if (value === null || value === undefined || value === '') return null; const number = Number(value); if (!Number.isSafeInteger(number) || number < 1) return fallback; return number; }
function normalizeSection(section = {}) {
  const startingNumber = toInteger(section.startingNumber, DEFAULTS.startingNumber); const baseline = startingNumber - 1;
  const currentCount = toInteger(section.currentCount, baseline, { min: -1 }); const highestCount = Math.max(currentCount, toInteger(section.highestCount, currentCount, { min: -1 }));
  return { ...DEFAULTS, ...section, channelId: section.channelId ? String(section.channelId) : null, startingNumber, maxConsecutivePerMember: toOptionalPositiveInteger(section.maxConsecutivePerMember, DEFAULTS.maxConsecutivePerMember), numbersOnly: section.numbersOnly !== false, deleteIncorrect: section.deleteIncorrect !== false, funnyResponses: section.funnyResponses !== false, answerAfterFailures: toOptionalPositiveInteger(section.answerAfterFailures, DEFAULTS.answerAfterFailures), responseCleanupSeconds: toOptionalPositiveInteger(section.responseCleanupSeconds, DEFAULTS.responseCleanupSeconds), milestoneAnnouncements: section.milestoneAnnouncements === true, milestoneInterval: toInteger(section.milestoneInterval, DEFAULTS.milestoneInterval, { min: 1 }), failureLimit: toInteger(section.failureLimit, DEFAULTS.failureLimit), currentCount, highestCount, lastCounterId: section.lastCounterId ? String(section.lastCounterId) : null, consecutiveCount: toInteger(section.consecutiveCount, 0), failureStreak: toInteger(section.failureStreak, 0), lastJokeIndex: Number.isInteger(section.lastJokeIndex) ? section.lastJokeIndex : -1, memberStats: section.memberStats && typeof section.memberStats === 'object' && !Array.isArray(section.memberStats) ? section.memberStats : {}, acceptedMessages: section.acceptedMessages && typeof section.acceptedMessages === 'object' && !Array.isArray(section.acceptedMessages) ? section.acceptedMessages : {}, playerPanelMessageId: section.playerPanelMessageId ? String(section.playerPanelMessageId) : null };
}
function getSection(guildId) { return normalizeSection(getModuleSection(guildId, MODULE_KEY, DEFAULTS)); }
function updateSection(guildId, updater, meta = {}) { return normalizeSection(updateModuleSection(guildId, MODULE_KEY, (current) => { const normalized = normalizeSection(current); const next = typeof updater === 'function' ? updater(normalized) : { ...normalized, ...(updater || {}) }; return normalizeSection(next); }, DEFAULTS, meta)); }
function expectedNext(section) { return Number(section.currentCount) + 1; }
function resetProgress(guildId, meta = {}) { return updateSection(guildId, (section) => { const baseline = section.startingNumber - 1; return { ...section, currentCount: baseline, highestCount: baseline, lastCounterId: null, consecutiveCount: 0, failureStreak: 0, lastJokeIndex: -1, memberStats: {}, acceptedMessages: {}, playerPanelMessageId: null }; }, meta); }
function setCurrentCount(guildId, count, meta = {}) { const nextCount = toInteger(count, null); if (nextCount === null) throw new Error('Current count must be a whole number of 0 or higher.'); return updateSection(guildId, (section) => ({ ...section, currentCount: nextCount, highestCount: Math.max(section.highestCount, nextCount), lastCounterId: null, consecutiveCount: 0, failureStreak: 0, acceptedMessages: {} }), meta); }
function nextJoke(section, pool) { if (!pool.length) return { text: '', index: -1 }; let index = Math.floor(Math.random() * pool.length); if (pool.length > 1 && index === section.lastJokeIndex) index = (index + 1) % pool.length; return { text: pool[index], index }; }
async function deleteIncorrectMessage(message, section) { if (!section.deleteIncorrect) return; await message.delete().catch(() => null); }
async function sendTemporaryMessage(channel, content, section, userId = null) { if (!content || !channel?.send) return null; const sent = await channel.send({ content, allowedMentions: userId ? { users: [userId], parse: [] } : { parse: [] } }).catch(() => null); if (!sent) return null; const seconds = section.responseCleanupSeconds; if (seconds !== null && seconds !== undefined) { const timer = setTimeout(() => sent.delete().catch(() => null), seconds * 1000); timer.unref?.(); } return sent; }

function playerRuleLines(section) {
  const lines = [];
  if (section.maxConsecutivePerMember === null) lines.push('👤 **Turns:** Unlimited');
  else if (section.maxConsecutivePerMember === 1) lines.push('👤 **Turns:** 1 number per member — another member must go next');
  else lines.push(`👤 **Turns:** Up to **${section.maxConsecutivePerMember} numbers in a row** per member`);
  lines.push(section.failureLimit > 0 ? `💀 **Game Over:** ${section.failureLimit} wrong answer${section.failureLimit === 1 ? '' : 's'} will reset the count` : '💀 **Game Over:** Off — wrong answers do not reset the count');
  lines.push(section.answerAfterFailures !== null ? `💡 **Hints:** Correct number revealed after ${section.answerAfterFailures} failed attempt${section.answerAfterFailures === 1 ? '' : 's'}` : '💡 **Hints:** Off');
  lines.push(`🔢 **Numbers Only:** ${section.numbersOnly ? 'On' : 'Off'}`);
  lines.push(section.milestoneAnnouncements ? `🎉 **Milestones:** Celebrated every ${section.milestoneInterval} counts` : '🎉 **Milestones:** Off');
  lines.push('💎 🎯 🏆 **Correct Answers:** Confirmed by Goliath');
  return lines;
}
function buildPlayerEmbed(section) { const rules = playerRuleLines(section); return new EmbedBuilder().setColor(PANEL_COLOR).setTitle('🔢 Counting').setDescription(['**Think you have what it takes to count?**', '', 'Sounds easy, right? Keep the numbers going in order and see how far the server can get before Goliath starts questioning everyone’s maths. 👀', '', `🔢 **Start at \`${section.startingNumber}\`**`, '', '**📋 This Server’s Rules**', ...rules, '', '**How high can you get? Good luck. 🔢**'].join('\n')).setFooter({ text: 'Goliath Counting' }); }
function buildResetEmbed(section) { const rules = playerRuleLines(section); return new EmbedBuilder().setColor(PANEL_COLOR).setTitle('🔄 COUNTING — RESET').setDescription(['**Well... that happened. 😂**', '', 'The last run is over, so we’re heading back to the beginning.', '**Everything above this message belongs to the previous game.**', '', '**Think you have what it takes to start us off again?**', '', `🔢 **Start at \`${section.startingNumber}\`**`, '', 'Keep the numbers going in order and follow the counting rules for this server.', ...rules, '', '**How high can you get this time? Good luck. 👀**'].join('\n')).setFooter({ text: 'Goliath Counting' }); }
async function getCountingChannel(guild, section = getSection(guild.id)) { if (!section.channelId) return null; return guild.channels.cache.get(section.channelId) || guild.channels.fetch(section.channelId).catch(() => null); }
async function deployPlayerPanel(guild, { forceNew = false, actorId = null } = {}) { let section = getSection(guild.id); const channel = await getCountingChannel(guild, section); if (!channel?.isTextBased?.() || !channel.send) throw new Error('Choose a valid counting channel first.'); if (!forceNew && section.playerPanelMessageId) { const existing = await channel.messages.fetch(section.playerPanelMessageId).catch(() => null); if (existing) { await existing.edit({ embeds: [buildPlayerEmbed(section)] }); return existing; } } const sent = await channel.send({ embeds: [buildPlayerEmbed(section)], allowedMentions: { parse: [] } }); section = updateSection(guild.id, (current) => ({ ...current, playerPanelMessageId: sent.id }), { actorId, action: 'counting_player_panel_deployed' }); return sent; }
async function refreshPlayerPanel(guild, section = getSection(guild.id)) { if (!section.playerPanelMessageId) return null; const channel = await getCountingChannel(guild, section); if (!channel?.messages) return null; const message = await channel.messages.fetch(section.playerPanelMessageId).catch(() => null); if (!message) { updateSection(guild.id, (current) => ({ ...current, playerPanelMessageId: null }), { action: 'counting_player_panel_missing' }); return null; } await message.edit({ embeds: [buildPlayerEmbed(section)] }).catch(() => null); return message; }

async function rejectNonNumber(message, section) { if (!section.numbersOnly) return false; const joke = nextJoke(section, CHAT_JOKES); const updated = updateSection(message.guild.id, (current) => ({ ...current, lastJokeIndex: section.funnyResponses ? joke.index : current.lastJokeIndex }), { actorId: message.author.id, action: 'counting_non_number_removed' }); await message.delete().catch(() => null); const text = section.funnyResponses ? `<@${message.author.id}> ${joke.text}` : `<@${message.author.id}> Numbers only in the counting channel.`; await sendTemporaryMessage(message.channel, text, updated, message.author.id); return true; }
async function rejectWrongCount(message, section, expected) {
  const joke = nextJoke(section, WRONG_JOKES);
  const nextFailureStreak = section.failureStreak + 1;
  const gameOver = section.failureLimit > 0 && nextFailureStreak >= section.failureLimit;
  if (gameOver) {
    const reached = section.currentCount;
    const baseline = section.startingNumber - 1;
    const updated = updateSection(message.guild.id, (current) => ({
      ...current, currentCount: baseline, highestCount: Math.max(current.highestCount, reached), lastCounterId: null,
      consecutiveCount: 0, failureStreak: 0, acceptedMessages: {}, lastJokeIndex: section.funnyResponses ? joke.index : current.lastJokeIndex,
    }), { actorId: message.author.id, action: 'counting_game_over' });
    await deleteIncorrectMessage(message, updated);
    await message.channel.send({ embeds: [new EmbedBuilder().setColor(PANEL_COLOR).setTitle('💀 COUNTING — GAME OVER').setDescription([
      `<@${message.author.id}> broke the count at **${reached}**.`, `The correct number was **${expected}**.`, '',
      `🏆 **Run reached:** ${reached}`, `💎 **Server record:** ${updated.highestCount}`, '', `Back to **${updated.startingNumber}**. Try not to break it this time. 👀`,
      `**Next number: ${updated.startingNumber}**`,
    ].join('\n')).setFooter({ text: 'Goliath Counting' })], allowedMentions: { users: [message.author.id], parse: [] } }).catch(() => null);
    return true;
  }
  const revealAt = section.answerAfterFailures;
  const reveal = revealAt !== null && nextFailureStreak >= revealAt;
  const parts = [];
  if (section.funnyResponses) parts.push(`<@${message.author.id}> ${joke.text}`);
  if (reveal) parts.push(`The next number is **${expected}**.`);
  if (!parts.length) parts.push(`<@${message.author.id}> That count is out of sequence.`);
  const updated = updateSection(message.guild.id, (current) => ({ ...current, failureStreak: nextFailureStreak, lastJokeIndex: section.funnyResponses ? joke.index : current.lastJokeIndex }), { actorId: message.author.id, action: 'counting_failed_attempt' });
  await deleteIncorrectMessage(message, updated);
  await sendTemporaryMessage(message.channel, parts.join(' '), updated, message.author.id);
  return true;
}
async function rejectConsecutiveTurn(message, section) { const joke = nextJoke(section, TURN_JOKES); const updated = updateSection(message.guild.id, (current) => ({ ...current, lastJokeIndex: section.funnyResponses ? joke.index : current.lastJokeIndex }), { actorId: message.author.id, action: 'counting_consecutive_limit' }); await deleteIncorrectMessage(message, updated); const limit = section.maxConsecutivePerMember; const simple = limit === 1 ? 'You have used your turn. Let another member count before you go again.' : `You have used your ${limit} turns. Let another member count before you go again.`; const text = section.funnyResponses ? `<@${message.author.id}> ${joke.text}` : `<@${message.author.id}> ${simple}`; await sendTemporaryMessage(message.channel, text, updated, message.author.id); return true; }
async function acceptCount(message, section, number) { const sameMember = section.lastCounterId === message.author.id; const nextConsecutive = sameMember ? section.consecutiveCount + 1 : 1; const memberStats = { ...section.memberStats }; const previous = memberStats[message.author.id] && typeof memberStats[message.author.id] === 'object' ? memberStats[message.author.id] : {}; memberStats[message.author.id] = { ...previous, validCounts: toInteger(previous.validCounts, 0) + 1, lastCount: number, lastCountedAt: new Date().toISOString() }; const acceptedMessages = { ...section.acceptedMessages, [message.id]: { number, userId: message.author.id } }; const updated = updateSection(message.guild.id, (current) => ({ ...current, currentCount: number, highestCount: Math.max(current.highestCount, number), lastCounterId: message.author.id, consecutiveCount: nextConsecutive, failureStreak: 0, memberStats, acceptedMessages }), { actorId: message.author.id, action: 'counting_valid_count' }); const reactionCycle = ['💎', '🎯', '🏆']; const reaction = reactionCycle[Math.abs(number - updated.startingNumber) % reactionCycle.length]; await message.react(reaction).catch(() => null); if (updated.milestoneAnnouncements && updated.milestoneInterval > 0 && number > 0 && number % updated.milestoneInterval === 0) await message.channel.send({ content: `🎉 **${number}!** The server just hit a counting milestone. Keep it going!`, allowedMentions: { parse: [] } }).catch(() => null); return true; }
async function processMessage(message) { const section = getSection(message.guild.id); if (!isModuleEnabled(message.guild.id, MODULE_KEY)) return false; if (!section.channelId || message.channelId !== section.channelId) return false; if (section.acceptedMessages[message.id]) return true; const content = String(message.content || '').trim(); const hasMedia = Boolean(message.attachments?.size || message.stickers?.size || message.embeds?.length); const isPlainNumber = /^\d+$/.test(content) && !hasMedia; if (!isPlainNumber) return rejectNonNumber(message, section); const expected = expectedNext(section); const number = Number(content); if (!Number.isSafeInteger(number) || number !== expected) return rejectWrongCount(message, section, expected); const maxConsecutive = section.maxConsecutivePerMember; if (maxConsecutive !== null && section.lastCounterId === message.author.id && section.consecutiveCount >= maxConsecutive) return rejectConsecutiveTurn(message, section); return acceptCount(message, section, number); }
function enqueue(key, task) { const previous = locks.get(key) || Promise.resolve(); const current = previous.catch(() => null).then(task).finally(() => { if (locks.get(key) === current) locks.delete(key); }); locks.set(key, current); return current; }
function guildQueueKey(guildId) { return `counting:${guildId}`; }
function enqueueGuild(guildId, task) { return enqueue(guildQueueKey(guildId), task); }
async function mutateSection(guildId, updater, meta = {}) { return enqueueGuild(guildId, () => updateSection(guildId, updater, meta)); }
async function setCurrentCountQueued(guildId, count, meta = {}) { return enqueueGuild(guildId, () => setCurrentCount(guildId, count, meta)); }
async function changeChannel(guild, channelId, meta = {}) {
  if (!guild?.id) throw new Error('Guild is unavailable.');
  const nextChannelId = channelId ? String(channelId) : null;
  return enqueueGuild(guild.id, async () => {
    const before = getSection(guild.id);
    if (before.channelId === nextChannelId) return before;
    if (nextChannelId) {
      const nextChannel = guild.channels.cache.get(nextChannelId) || await guild.channels.fetch(nextChannelId).catch(() => null);
      if (!nextChannel?.isTextBased?.() || !nextChannel.send) throw new Error('Choose a valid text channel for Counting.');
    }
    if (before.playerPanelMessageId && before.channelId) {
      const oldChannel = guild.channels.cache.get(before.channelId) || await guild.channels.fetch(before.channelId).catch(() => null);
      const oldPanel = oldChannel?.messages ? await oldChannel.messages.fetch(before.playerPanelMessageId).catch(() => null) : null;
      if (oldPanel) { suppressedDeletes.add(oldPanel.id); await oldPanel.delete().catch(() => suppressedDeletes.delete(oldPanel.id)); }
    }
    return updateSection(guild.id, (section) => ({
      ...section,
      channelId: nextChannelId,
      playerPanelMessageId: null,
      acceptedMessages: {},
      lastCounterId: null,
      consecutiveCount: 0,
      failureStreak: 0,
    }), { ...meta, action: meta.action || 'counting_channel_changed' });
  });
}
async function purgeCountingChannel(guild, channelId, meta = {}) {
  if (!guild?.id || !channelId) throw new Error('Counting channel is unavailable.');
  const channel = guild.channels.cache.get(String(channelId)) || await guild.channels.fetch(String(channelId)).catch(() => null);
  if (!channel?.isTextBased?.() || !channel.messages?.fetch) throw new Error('The Counting channel could not be accessed.');
  const me = guild.members.me;
  const permissions = me ? channel.permissionsFor(me) : null;
  if (!permissions?.has(PermissionFlagsBits.ManageMessages) || !permissions?.has(PermissionFlagsBits.ReadMessageHistory)) throw new Error('Goliath needs Manage Messages and Read Message History to clean up this Counting channel.');
  let deleted = 0;
  let before;
  while (true) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
    if (!batch?.size) break;
    const messages = [...batch.values()];
    before = messages[messages.length - 1]?.id;
    for (const item of messages) {
      suppressedDeletes.add(item.id);
      const ok = await item.delete().then(() => true).catch(() => false);
      if (ok) deleted += 1; else suppressedDeletes.delete(item.id);
    }
    if (batch.size < 100) break;
  }
  updateSection(guild.id, (section) => ({ ...section, ...(String(section.channelId) === String(channelId) ? { playerPanelMessageId: null, acceptedMessages: {} } : {}) }), { ...meta, action: meta.action || 'counting_channel_cleanup' });
  return deleted;
}
async function handleMessageCreate(message) { if (!message?.guild?.id || !message.member || message.author?.bot || message.webhookId) return false; if (!isModuleEnabled(message.guild.id, MODULE_KEY)) return false; const section = getSection(message.guild.id); if (!section.channelId || message.channelId !== section.channelId) return false; return enqueueGuild(message.guild.id, () => processMessage(message)); }
async function handleMessageDelete(message) { if (!message?.guild?.id) return false; if (suppressedDeletes.delete(message.id)) return false; const section = getSection(message.guild.id); if (!isModuleEnabled(message.guild.id, MODULE_KEY) || message.channelId !== section.channelId) return false; if (message.id === section.playerPanelMessageId) { updateSection(message.guild.id, (current) => ({ ...current, playerPanelMessageId: null }), { action: 'counting_player_panel_deleted' }); return true; } const accepted = section.acceptedMessages[message.id]; if (!accepted) return false; const channel = message.channel || await getCountingChannel(message.guild, section); if (!channel?.send) return false; await channel.send({ content: `🗑️ **${accepted.number}** was deleted, but Goliath remembers. Continue with **${expectedNext(section)}**.`, allowedMentions: { parse: [] } }).catch(() => null); return true; }
async function handleMessageUpdate(before, after) { const message = after || before; if (!message?.guild?.id || message.author?.bot) return false; const section = getSection(message.guild.id); if (!isModuleEnabled(message.guild.id, MODULE_KEY) || message.channelId !== section.channelId) return false; const accepted = section.acceptedMessages[message.id]; if (!accepted) return false; const content = String(message.content || '').trim(); if (content === String(accepted.number) && !message.attachments?.size && !message.stickers?.size && !message.embeds?.length) return false; suppressedDeletes.add(message.id); await message.delete().catch(() => suppressedDeletes.delete(message.id)); await message.channel.send({ content: `✏️ **${accepted.number}** was edited, but Goliath remembers the original count. Continue with **${expectedNext(section)}**.`, allowedMentions: { parse: [] } }).catch(() => null); return true; }
async function resetWithMarker(guild, meta = {}) { const before = getSection(guild.id); if (!before.channelId) return resetProgress(guild.id, meta); return enqueueGuild(guild.id, async () => { const channel = await getCountingChannel(guild, before); if (before.playerPanelMessageId && channel?.messages) { const oldPanel = await channel.messages.fetch(before.playerPanelMessageId).catch(() => null); if (oldPanel) { suppressedDeletes.add(oldPanel.id); await oldPanel.delete().catch(() => suppressedDeletes.delete(oldPanel.id)); } } let reset = resetProgress(guild.id, meta); if (channel?.send) { const sent = await channel.send({ embeds: [buildResetEmbed(reset)], allowedMentions: { parse: [] } }).catch(() => null); if (sent) reset = updateSection(guild.id, (current) => ({ ...current, playerPanelMessageId: sent.id }), { actorId: meta.actorId || null, action: 'counting_reset_panel_deployed' }); } return reset; }); }
function registerProtectionEvents(client) { if (!client || wiredClients.has(client)) return false; wiredClients.add(client); client.on(Events.MessageDelete, (message) => handleMessageDelete(message).catch((error) => console.warn('[Counting] MessageDelete:', error?.message || error))); client.on(Events.MessageUpdate, (before, after) => handleMessageUpdate(before, after).catch((error) => console.warn('[Counting] MessageUpdate:', error?.message || error))); return true; }
module.exports = { MODULE_KEY, DEFAULTS, getSection, updateSection, mutateSection, expectedNext, resetProgress, resetWithMarker, setCurrentCount, setCurrentCountQueued, changeChannel, deployPlayerPanel, refreshPlayerPanel, handleMessageCreate, handleMessageDelete, handleMessageUpdate, registerProtectionEvents };
