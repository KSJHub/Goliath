'use strict';

const { MessageFlags } = require('discord.js');
const polls = require('./polls');
const emojis = require('../../utilityStudio/emojis/emojis');
const { isModuleEnabled } = require('../../../core/guild/guildManager');
const schedulerRegistry = require('../../../owner/sentinel/schedulerRegistry');

const voteQueues = new Map();
const processedInteractions = new Map();
const STARTUP_KEY = Symbol.for('goliath.polls.startup');
const AUTO_CLOSE_INTERVAL_MS = 60 * 1000;
const SCHEDULER_ID = 'polls:auto-close:global';

function cleanupProcessedInteractions() {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [interactionId, timestamp] of processedInteractions.entries()) if (timestamp < cutoff) processedInteractions.delete(interactionId);
}
function queueVote(key, operation) {
  const previous = voteQueues.get(key) || Promise.resolve();
  const current = previous.catch(() => null).then(operation);
  voteQueues.set(key, current);
  return current.finally(() => { if (voteQueues.get(key) === current) voteQueues.delete(key); });
}
async function resolvePollMessage(guild, poll) {
  if (!guild || !poll?.channelId || !poll?.messageId) return null;
  const channel = guild.channels.cache.get(poll.channelId) || await guild.channels.fetch(poll.channelId).catch(() => null);
  if (!channel?.messages?.fetch) return null;
  return channel.messages.fetch(poll.messageId).catch(() => null);
}
async function pollPayload(guild, poll) {
  return {
    embeds: await emojis.resolveEmbeds(guild.client, guild.id, [polls.buildPollEmbed(poll)]),
    components: poll.status === 'active' ? polls.buildPollComponents(poll) : [],
  };
}
async function renderPoll(guild, poll, { required = false } = {}) {
  const message = await resolvePollMessage(guild, poll);
  if (!message?.edit) {
    if (required) throw new Error('The deployed poll message is missing or inaccessible.');
    return null;
  }
  await message.edit(await pollPayload(guild, poll));
  return message;
}
async function deployPoll(guild, pollId, channelId, meta = {}) {
  if (!guild) throw new Error('Guild is required.');
  if (!isModuleEnabled(guild.id, 'polls')) throw new Error('Polls are disabled.');
  const section = polls.getSection(guild.id);
  const poll = section.polls[String(pollId)];
  if (!poll) throw new Error('Poll not found.');
  if (poll.status === 'closed') throw new Error('Closed polls cannot be redeployed.');
  const existing = await resolvePollMessage(guild, poll);
  poll.status = 'active'; poll.closedAt = null; poll.updatedAt = polls.now();
  if (existing?.edit) {
    await existing.edit(await pollPayload(guild, poll)); section.polls[poll.id] = poll;
    return { section: polls.saveSection(guild.id, section, meta), poll, messageId: existing.id, redeployed: true };
  }
  const targetChannelId = polls.cleanSnowflake(channelId || poll.channelId || section.settings?.defaultChannelId);
  if (!targetChannelId) throw new Error('Select a text channel before deploying the poll.');
  const channel = guild.channels.cache.get(targetChannelId) || await guild.channels.fetch(targetChannelId).catch(() => null);
  if (!channel?.send) throw new Error('Selected channel is not sendable.');
  const message = await channel.send(await pollPayload(guild, poll));
  poll.channelId = channel.id; poll.messageId = message.id; section.polls[poll.id] = poll;
  section.analytics.deployed = Number(section.analytics.deployed || 0) + 1;
  try {
    return { section: polls.saveSection(guild.id, section, meta), poll, messageId: message.id, redeployed: false };
  } catch (error) { await message.delete().catch(() => null); throw error; }
}
async function setPollStatus(guild, pollId, status, meta = {}) {
  if (!guild) throw new Error('Guild is required.');
  const section = polls.getSection(guild.id); const poll = section.polls[String(pollId)];
  if (!poll) throw new Error('Poll not found.');
  if (!['draft', 'active', 'closed'].includes(status)) throw new Error('Invalid poll status.');
  if (status === 'active' && !poll.messageId) throw new Error('Deploy the poll before activating it.');
  const wasClosed = poll.status === 'closed'; poll.status = status; poll.updatedAt = polls.now();
  if (status === 'closed') { poll.closedAt = poll.closedAt || poll.updatedAt; if (!wasClosed) section.analytics.closed = Number(section.analytics.closed || 0) + 1; }
  else poll.closedAt = null;
  if (poll.messageId) await renderPoll(guild, poll, { required: true });
  section.polls[poll.id] = poll;
  return { section: polls.saveSection(guild.id, section, meta), poll };
}
async function deletePoll(guild, pollId, meta = {}) {
  if (!guild) throw new Error('Guild is required.');
  const poll = polls.getPoll(guild.id, pollId); if (!poll) throw new Error('Poll not found.');
  const message = await resolvePollMessage(guild, poll);
  const section = polls.deletePollRecord(guild.id, pollId, meta);
  if (message?.delete) await message.delete().catch(() => null);
  return section;
}
async function respond(interaction, content) {
  if (interaction.deferred || interaction.replied) return interaction.editReply({ content }).catch(() => null);
  return interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => null);
}
function markProcessed(interaction) {
  cleanupProcessedInteractions();
  const id = String(interaction.id || '');
  if (id && processedInteractions.has(id)) return false;
  if (id) processedInteractions.set(id, Date.now());
  return true;
}
function applyExactSelection(section, poll, userId, selectedIds) {
  const selected = new Set(selectedIds);
  let added = 0; let removed = 0;
  for (const option of poll.options) {
    const has = option.votes.includes(userId);
    const wants = selected.has(option.id);
    if (wants && !has) { option.votes.push(userId); added += 1; }
    if (!wants && has) { option.votes = option.votes.filter((id) => id !== userId); removed += 1; }
  }
  section.analytics.votes = Number(section.analytics.votes || 0) + added;
  section.analytics.removed = Number(section.analytics.removed || 0) + removed;
  section.analytics.multiSelectSubmissions = Number(section.analytics.multiSelectSubmissions || 0) + 1;
  if (added && removed) section.analytics.switched = Number(section.analytics.switched || 0) + 1;
  poll.updatedAt = polls.now(); section.polls[poll.id] = poll;
  return { added, removed };
}
async function processVote(interaction, pollId, optionId) {
  const guildId = interaction.guildId; const userId = interaction.user?.id;
  if (!guildId || !userId || !interaction.guild) return true;
  if (!isModuleEnabled(guildId, 'polls')) { await respond(interaction, 'Polls are currently disabled.'); return true; }
  const section = polls.getSection(guildId); const poll = section.polls[pollId];
  if (!poll) { await respond(interaction, 'This poll no longer exists.'); return true; }
  if (poll.status !== 'active') { await respond(interaction, 'This poll is closed.'); return true; }
  const option = poll.options.find((item) => item.id === optionId); if (!option) { await respond(interaction, 'That poll option no longer exists.'); return true; }
  const alreadyVoted = option.votes.includes(userId); let removedOtherVote = false;
  if (!poll.allowMultipleVotes && !alreadyVoted) {
    for (const candidate of poll.options) {
      if (candidate.id === option.id) continue;
      const before = candidate.votes.length; candidate.votes = candidate.votes.filter((id) => id !== userId);
      if (candidate.votes.length !== before) removedOtherVote = true;
    }
  }
  if (alreadyVoted) { option.votes = option.votes.filter((id) => id !== userId); section.analytics.removed = Number(section.analytics.removed || 0) + 1; }
  else { option.votes.push(userId); section.analytics.votes = Number(section.analytics.votes || 0) + 1; if (removedOtherVote) section.analytics.switched = Number(section.analytics.switched || 0) + 1; }
  poll.updatedAt = polls.now(); section.polls[poll.id] = poll; polls.saveSection(guildId, section, { actorId: userId });
  if (section.showResultsLive !== false) await renderPoll(interaction.guild, poll).catch(() => null);
  await respond(interaction, alreadyVoted ? `Removed your vote from **${option.label}**.` : removedOtherVote ? `Changed your vote to **${option.label}**.` : `Vote counted for **${option.label}**.`);
  return true;
}
async function processSelect(interaction, pollId) {
  const guildId = interaction.guildId; const userId = interaction.user?.id;
  if (!guildId || !userId || !interaction.guild) return true;
  if (!isModuleEnabled(guildId, 'polls')) { await respond(interaction, 'Polls are currently disabled.'); return true; }
  const section = polls.getSection(guildId); const poll = section.polls[pollId];
  if (!poll) { await respond(interaction, 'This poll no longer exists.'); return true; }
  if (poll.status !== 'active') { await respond(interaction, 'This poll is closed.'); return true; }
  const valid = new Set(poll.options.map((option) => option.id));
  let selectedIds = [...new Set((interaction.values || []).filter((id) => valid.has(id)))];
  if (!poll.allowMultipleVotes) selectedIds = selectedIds.slice(0, 1);
  if (!selectedIds.length) { await respond(interaction, 'Select at least one option.'); return true; }
  const result = applyExactSelection(section, poll, userId, selectedIds);
  polls.saveSection(guildId, section, { actorId: userId, action: 'poll_multi_select' });
  if (section.showResultsLive !== false) await renderPoll(interaction.guild, poll).catch(() => null);
  const labels = poll.options.filter((option) => selectedIds.includes(option.id)).map((option) => option.label);
  await respond(interaction, `Saved your selection${labels.length === 1 ? '' : 's'}: **${labels.join('**, **')}**.${result.removed ? ' Previous selections were updated.' : ''}`);
  return true;
}
async function vote(interaction) {
  const button = String(interaction.customId || '').match(/^poll_vote:([^:]+):([^:]+)$/);
  const select = String(interaction.customId || '').match(/^poll_select:([^:]+)$/);
  if (!button && !select) return false;
  if (!markProcessed(interaction)) { await respond(interaction, 'This vote interaction was already processed.'); return true; }
  if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
  const pollId = button ? button[1] : select[1];
  return queueVote(`${interaction.guildId || 'unknown'}:${pollId}`, () => button ? processVote(interaction, button[1], button[2]) : processSelect(interaction, select[1]));
}
async function buildHealth(guild) {
  if (!guild) throw new Error('Guild is required.');
  const section = polls.getSection(guild.id); const issues = [];
  const activePolls = Object.values(section.polls || {}).filter((poll) => poll.status === 'active');
  const defaultChannelId = section.settings?.defaultChannelId || section.defaultChannelId || null;
  if (defaultChannelId) {
    const channel = guild.channels.cache.get(defaultChannelId) || await guild.channels.fetch(defaultChannelId).catch(() => null);
    if (!channel?.send) issues.push({ code: 'default_channel_missing', severity: 'warning', channelId: defaultChannelId });
  }
  for (const poll of activePolls) {
    if (!poll.channelId || !poll.messageId) { issues.push({ code: 'active_poll_not_deployed', severity: 'error', pollId: poll.id }); continue; }
    if (!await resolvePollMessage(guild, poll)) issues.push({ code: 'poll_message_missing', severity: 'error', pollId: poll.id, channelId: poll.channelId, messageId: poll.messageId });
  }
  return { module: 'polls', guildId: guild.id, healthy: issues.length === 0, checkedAt: polls.now(), enabled: isModuleEnabled(guild.id, 'polls'), totalPolls: Object.keys(section.polls || {}).length, activePolls: activePolls.length, issues };
}
async function repair(guild, meta = {}) {
  const section = polls.getSection(guild.id); const repaired = []; const failed = [];
  for (const poll of Object.values(section.polls || {})) {
    if (poll.status !== 'active') continue;
    try {
      const existing = await resolvePollMessage(guild, poll);
      if (existing?.edit) { await existing.edit(await pollPayload(guild, poll)); repaired.push({ pollId: poll.id, action: 'refreshed' }); }
      else {
        const targetChannelId = poll.channelId || section.settings?.defaultChannelId || section.defaultChannelId;
        if (!targetChannelId) throw new Error('No channel is available for redeployment.');
        const result = await deployPoll(guild, poll.id, targetChannelId, meta);
        repaired.push({ pollId: poll.id, action: result.redeployed ? 'refreshed' : 'redeployed', messageId: result.messageId });
      }
    } catch (error) { failed.push({ pollId: poll.id, error: error.message }); }
  }
  return { repaired, failed, health: await buildHealth(guild) };
}
function exportConfig(guildId) { return { module: 'polls', exportedAt: polls.now(), guildId: String(guildId), config: polls.getSection(guildId) }; }
async function reset(guild, meta = {}) {
  const section = polls.getSection(guild.id); const removedMessages = [];
  for (const poll of Object.values(section.polls || {})) {
    const message = await resolvePollMessage(guild, poll);
    if (message?.delete && await message.delete().then(() => true).catch(() => false)) removedMessages.push(poll.messageId);
  }
  return { config: polls.saveSection(guild.id, polls.DEFAULT_POLLS, meta), removedMessages };
}
async function closeExpiredPollsForGuild(guild) {
  if (!isModuleEnabled(guild.id, 'polls')) return { checked: 0, closed: 0, failed: [] };
  const section = polls.getSection(guild.id); const autoCloseHours = Number(section.settings?.autoCloseHours || 0);
  if (!Number.isFinite(autoCloseHours) || autoCloseHours <= 0) return { checked: 0, closed: 0, failed: [] };
  let checked = 0; let closed = 0; const failed = []; const maxAgeMs = autoCloseHours * 60 * 60 * 1000;
  for (const poll of Object.values(section.polls || {})) {
    if (poll.status !== 'active' || !poll.messageId) continue;
    checked += 1;
    try {
      const message = await resolvePollMessage(guild, poll); if (!message) throw new Error('The deployed poll message is missing or inaccessible.');
      const deployedAt = Number(message.createdTimestamp || message.createdAt?.getTime?.() || 0);
      if (deployedAt && Date.now() - deployedAt >= maxAgeMs) { await setPollStatus(guild, poll.id, 'closed', { actorId: guild.members.me?.id || null, reason: 'auto_close' }); closed += 1; }
    } catch (error) { failed.push({ pollId: poll.id, error: error.message }); }
  }
  return { checked, closed, failed };
}
async function runAutoClose(client) {
  const results = [];
  for (const guild of client.guilds.cache.values()) results.push({ guildId: guild.id, ...(await closeExpiredPollsForGuild(guild)) });
  return results;
}
function summarizeAutoClose(results = []) {
  return results.reduce((summary, result) => {
    summary.guilds += 1;
    summary.checked += Number(result.checked || 0);
    summary.closed += Number(result.closed || 0);
    summary.failed += Array.isArray(result.failed) ? result.failed.length : 0;
    return summary;
  }, { guilds: 0, checked: 0, closed: 0, failed: 0 });
}
async function runMonitoredAutoClose(client, phase = 'scheduled') {
  try {
    const results = await runAutoClose(client);
    const summary = summarizeAutoClose(results);
    if (summary.failed > 0) {
      schedulerRegistry.fail(SCHEDULER_ID, new Error(`${summary.failed} poll auto-close operation(s) failed.`), { phase, ...summary });
    } else {
      schedulerRegistry.beat(SCHEDULER_ID, { phase, ...summary });
    }
    return results;
  } catch (error) {
    schedulerRegistry.fail(SCHEDULER_ID, error, { phase });
    throw error;
  }
}
async function startup(client) {
  if (!client?.guilds?.cache) throw new Error('Discord client is unavailable.');
  if (client[STARTUP_KEY]) return client[STARTUP_KEY];
  schedulerRegistry.register({
    id: SCHEDULER_ID,
    module: 'polls',
    component: 'auto-close',
    intervalMs: AUTO_CLOSE_INTERVAL_MS,
    staleAfterMs: AUTO_CLOSE_INTERVAL_MS * 3,
  });
  await runMonitoredAutoClose(client, 'startup');
  const timer = setInterval(() => {
    runMonitoredAutoClose(client, 'scheduled').catch((error) => console.warn(`[Polls] Auto-close scan failed: ${error.message}`));
  }, AUTO_CLOSE_INTERVAL_MS);
  timer.unref?.();
  client[STARTUP_KEY] = { timer, startedAt: polls.now() };
  return client[STARTUP_KEY];
}

module.exports = {
  resolvePollMessage, renderPoll, deployPoll, setPollStatus, deletePoll, vote,
  buildHealth, repair, exportConfig, reset, closeExpiredPollsForGuild, runAutoClose, startup,
};
