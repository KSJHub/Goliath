'use strict';

const { MessageFlags } = require('discord.js');
const pollsManager = require('./pollsManager');

const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const voteQueues = new Map();
const processedInteractions = new Map();
const STARTUP_KEY = Symbol.for('goliath.polls.startup');

function cleanupProcessedInteractions() {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [interactionId, timestamp] of processedInteractions.entries()) {
    if (timestamp < cutoff) processedInteractions.delete(interactionId);
  }
}

function queueVote(key, operation) {
  const previous = voteQueues.get(key) || Promise.resolve();
  const current = previous.catch(() => null).then(operation);
  voteQueues.set(key, current);
  return current.finally(() => {
    if (voteQueues.get(key) === current) voteQueues.delete(key);
  });
}

async function resolvePollMessage(guild, poll) {
  if (!guild || !poll?.channelId || !poll?.messageId) return null;
  const channel = guild.channels.cache.get(poll.channelId)
    || await guild.channels.fetch(poll.channelId).catch(() => null);
  if (!channel?.messages?.fetch) return null;
  return channel.messages.fetch(poll.messageId).catch(() => null);
}

function pollPayload(poll) {
  return {
    embeds: [pollsManager.buildPollEmbed(poll)],
    components: poll.status === 'active' ? pollsManager.buildPollComponents(poll) : [],
  };
}

async function renderPoll(guild, poll, { required = false } = {}) {
  const message = await resolvePollMessage(guild, poll);
  if (!message?.edit) {
    if (required) throw new Error('The deployed poll message is missing or inaccessible.');
    return null;
  }
  await message.edit(pollPayload(poll));
  return message;
}

async function deployPoll(guild, pollId, channelId, meta = {}) {
  if (!guild) throw new Error('Guild is required.');
  const section = pollsManager.getSection(guild.id);
  if (section.enabled === false) throw new Error('Polls are disabled.');
  const poll = section.polls[String(pollId)];
  if (!poll) throw new Error('Poll not found.');
  if (poll.status === 'closed') throw new Error('Closed polls cannot be redeployed.');

  const previous = clone(poll);
  const existing = await resolvePollMessage(guild, poll);
  poll.status = 'active';
  poll.closedAt = null;
  poll.updatedAt = new Date().toISOString();

  if (existing?.edit) {
    await existing.edit(pollPayload(poll));
    section.polls[poll.id] = poll;
    try {
      return {
        section: pollsManager.saveSection(guild.id, section, meta),
        poll,
        messageId: existing.id,
        redeployed: true,
      };
    } catch (error) {
      await existing.edit(pollPayload(previous)).catch(() => null);
      throw error;
    }
  }

  const targetChannelId = String(channelId || poll.channelId || section.settings?.defaultChannelId || '').replace(/[<#>]/g, '').trim();
  if (!/^\d{15,25}$/.test(targetChannelId)) throw new Error('Select a text channel before deploying the poll.');
  const channel = guild.channels.cache.get(targetChannelId)
    || await guild.channels.fetch(targetChannelId).catch(() => null);
  if (!channel?.send) throw new Error('Selected channel is not sendable.');

  const message = await channel.send(pollPayload(poll));
  poll.channelId = channel.id;
  poll.messageId = message.id;
  section.polls[poll.id] = poll;
  section.analytics.deployed = Number(section.analytics.deployed || 0) + 1;

  try {
    const saved = pollsManager.saveSection(guild.id, section, meta);
    return { section: saved, poll, messageId: message.id, redeployed: false };
  } catch (error) {
    await message.delete().catch(() => null);
    throw error;
  }
}

async function setPollStatus(guild, pollId, status, meta = {}) {
  if (!guild) throw new Error('Guild is required.');
  const section = pollsManager.getSection(guild.id);
  const poll = section.polls[String(pollId)];
  if (!poll) throw new Error('Poll not found.');
  if (!['draft', 'active', 'closed'].includes(status)) throw new Error('Invalid poll status.');
  if (status === 'active' && !poll.messageId) throw new Error('Deploy the poll before activating it.');

  const previous = clone(poll);
  const wasClosed = poll.status === 'closed';
  poll.status = status;
  poll.updatedAt = new Date().toISOString();
  if (status === 'closed') {
    poll.closedAt = poll.closedAt || poll.updatedAt;
    if (!wasClosed) section.analytics.closed = Number(section.analytics.closed || 0) + 1;
  } else {
    poll.closedAt = null;
  }

  const message = poll.messageId ? await renderPoll(guild, poll, { required: true }) : null;
  section.polls[poll.id] = poll;
  try {
    const saved = pollsManager.saveSection(guild.id, section, meta);
    return { section: saved, poll };
  } catch (error) {
    if (message?.edit) await message.edit(pollPayload(previous)).catch(() => null);
    throw error;
  }
}

async function deletePoll(guild, pollId, meta = {}) {
  if (!guild) throw new Error('Guild is required.');
  const poll = pollsManager.getPoll(guild.id, pollId);
  if (!poll) throw new Error('Poll not found.');
  const message = await resolvePollMessage(guild, poll);
  const section = pollsManager.deletePoll(guild.id, pollId, meta);
  if (message?.delete) await message.delete().catch(() => null);
  return section;
}

async function respond(interaction, content) {
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply({ content }).catch(() => null);
  }
  return interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => null);
}

async function processVote(interaction, pollId, optionId) {
  const guildId = interaction.guildId;
  const userId = interaction.user?.id;
  if (!guildId || !userId || !interaction.guild) return true;

  const section = pollsManager.getSection(guildId);
  if (section.enabled === false) {
    await respond(interaction, 'Polls are currently disabled.');
    return true;
  }

  const poll = section.polls[pollId];
  if (!poll) {
    await respond(interaction, 'This poll no longer exists.');
    return true;
  }
  if (poll.status !== 'active') {
    await respond(interaction, 'This poll is closed.');
    return true;
  }

  const option = poll.options.find((item) => item.id === optionId);
  if (!option) {
    await respond(interaction, 'That poll option no longer exists.');
    return true;
  }

  const alreadyVoted = option.votes.includes(userId);
  let removedOtherVote = false;
  if (!poll.allowMultipleVotes && !alreadyVoted) {
    for (const candidate of poll.options) {
      if (candidate.id === option.id) continue;
      const before = candidate.votes.length;
      candidate.votes = candidate.votes.filter((idValue) => idValue !== userId);
      if (candidate.votes.length !== before) removedOtherVote = true;
    }
  }

  if (alreadyVoted) {
    option.votes = option.votes.filter((idValue) => idValue !== userId);
    section.analytics.removed = Number(section.analytics.removed || 0) + 1;
  } else {
    option.votes.push(userId);
    section.analytics.votes = Number(section.analytics.votes || 0) + 1;
    if (removedOtherVote) section.analytics.switched = Number(section.analytics.switched || 0) + 1;
  }

  poll.updatedAt = new Date().toISOString();
  section.polls[poll.id] = poll;
  pollsManager.saveSection(guildId, section, { actorId: userId });

  if (section.showResultsLive !== false) {
    await renderPoll(interaction.guild, poll).catch(() => null);
  }

  await respond(interaction, alreadyVoted
    ? `Removed your vote from **${option.label}**.`
    : removedOtherVote
      ? `Changed your vote to **${option.label}**.`
      : `Vote counted for **${option.label}**.`);
  return true;
}

async function vote(interaction) {
  const match = String(interaction.customId || '').match(/^poll_vote:([^:]+):([^:]+)$/);
  if (!match) return false;

  cleanupProcessedInteractions();
  const interactionId = String(interaction.id || '');
  if (interactionId && processedInteractions.has(interactionId)) {
    await respond(interaction, 'This vote interaction was already processed.');
    return true;
  }
  if (interactionId) processedInteractions.set(interactionId, Date.now());

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
  }

  const [, pollId, optionId] = match;
  const queueKey = `${interaction.guildId || 'unknown'}:${pollId}`;
  return queueVote(queueKey, () => processVote(interaction, pollId, optionId));
}

async function closeExpiredPollsForGuild(guild) {
  const section = pollsManager.getSection(guild.id);
  if (section.enabled === false) return { checked: 0, closed: 0, failed: [] };
  const autoCloseHours = Number(section.settings?.autoCloseHours || 0);
  if (!Number.isFinite(autoCloseHours) || autoCloseHours <= 0) return { checked: 0, closed: 0, failed: [] };

  let checked = 0;
  let closed = 0;
  const failed = [];
  const maxAgeMs = autoCloseHours * 60 * 60 * 1000;

  for (const poll of Object.values(section.polls || {})) {
    if (poll.status !== 'active' || !poll.messageId) continue;
    checked += 1;
    try {
      const message = await resolvePollMessage(guild, poll);
      if (!message) throw new Error('The deployed poll message is missing or inaccessible.');
      const deployedAt = Number(message.createdTimestamp || message.createdAt?.getTime?.() || 0);
      if (!deployedAt || Date.now() - deployedAt < maxAgeMs) continue;
      await setPollStatus(guild, poll.id, 'closed', { actorId: guild.members.me?.id || null, reason: 'auto_close' });
      closed += 1;
    } catch (error) {
      failed.push({ pollId: poll.id, error: error.message });
    }
  }
  return { checked, closed, failed };
}

async function runAutoClose(client) {
  const results = [];
  for (const guild of client.guilds.cache.values()) {
    results.push({ guildId: guild.id, ...(await closeExpiredPollsForGuild(guild)) });
  }
  return results;
}

async function startup(client) {
  if (!client?.guilds?.cache) throw new Error('Discord client is unavailable.');
  if (client[STARTUP_KEY]) return client[STARTUP_KEY];

  await runAutoClose(client);
  const timer = setInterval(() => {
    runAutoClose(client).catch((error) => console.warn(`[Polls] Auto-close scan failed: ${error.message}`));
  }, 60 * 1000);
  timer.unref?.();
  client[STARTUP_KEY] = { timer, startedAt: new Date().toISOString() };
  return client[STARTUP_KEY];
}

module.exports = {
  ...pollsManager,
  resolvePollMessage,
  renderPoll,
  deployPoll,
  setPollStatus,
  deletePoll,
  vote,
  closeExpiredPollsForGuild,
  runAutoClose,
  startup,
};
