'use strict';

const polls = require('./polls');
const pollsManager = require('./pollsManager');

function pollPayload(poll) {
  return {
    embeds: [pollsManager.buildPollEmbed(poll)],
    components: poll.status === 'active' ? pollsManager.buildPollComponents(poll) : [],
  };
}

async function buildHealth(guild) {
  if (!guild) throw new Error('Guild is required.');
  const section = pollsManager.getSection(guild.id);
  const issues = [];
  const activePolls = Object.values(section.polls || {}).filter((poll) => poll.status === 'active');

  const defaultChannelId = section.settings?.defaultChannelId || section.defaultChannelId || null;
  if (defaultChannelId) {
    const channel = guild.channels.cache.get(defaultChannelId)
      || await guild.channels.fetch(defaultChannelId).catch(() => null);
    if (!channel?.send) issues.push({ code: 'default_channel_missing', severity: 'warning', channelId: defaultChannelId });
  }

  for (const poll of activePolls) {
    if (!poll.channelId || !poll.messageId) {
      issues.push({ code: 'active_poll_not_deployed', severity: 'error', pollId: poll.id });
      continue;
    }
    const message = await polls.resolvePollMessage(guild, poll);
    if (!message) issues.push({ code: 'poll_message_missing', severity: 'error', pollId: poll.id, channelId: poll.channelId, messageId: poll.messageId });
  }

  return {
    module: 'polls',
    guildId: guild.id,
    healthy: issues.length === 0,
    checkedAt: new Date().toISOString(),
    enabled: section.enabled !== false,
    totalPolls: Object.keys(section.polls || {}).length,
    activePolls: activePolls.length,
    issues,
  };
}

async function repair(guild, meta = {}) {
  if (!guild) throw new Error('Guild is required.');
  const section = pollsManager.getSection(guild.id);
  const repaired = [];
  const failed = [];

  for (const poll of Object.values(section.polls || {})) {
    if (poll.status !== 'active') continue;
    try {
      const existing = await polls.resolvePollMessage(guild, poll);
      if (existing?.edit) {
        await existing.edit(pollPayload(poll));
        repaired.push({ pollId: poll.id, action: 'refreshed' });
        continue;
      }

      const targetChannelId = poll.channelId || section.settings?.defaultChannelId || section.defaultChannelId || null;
      if (!targetChannelId) throw new Error('No channel is available for redeployment.');
      const result = await polls.deployPoll(guild, poll.id, targetChannelId, meta);
      repaired.push({ pollId: poll.id, action: result.redeployed ? 'refreshed' : 'redeployed', messageId: result.messageId });
    } catch (error) {
      failed.push({ pollId: poll.id, error: error.message });
    }
  }

  const health = await buildHealth(guild);
  return { repaired, failed, health };
}

function exportConfig(guildId) {
  return {
    module: 'polls',
    exportedAt: new Date().toISOString(),
    guildId: String(guildId),
    config: pollsManager.getSection(guildId),
  };
}

async function reset(guild, meta = {}) {
  if (!guild) throw new Error('Guild is required.');
  const section = pollsManager.getSection(guild.id);
  const removedMessages = [];

  for (const poll of Object.values(section.polls || {})) {
    const message = await polls.resolvePollMessage(guild, poll);
    if (message?.delete) {
      const deleted = await message.delete().then(() => true).catch(() => false);
      if (deleted) removedMessages.push(poll.messageId);
    }
  }

  const config = pollsManager.saveSection(guild.id, pollsManager.DEFAULT_POLLS, meta);
  return { config, removedMessages };
}

module.exports = {
  buildHealth,
  repair,
  exportConfig,
  reset,
};
