const { ActionRowBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { navigationButton, emojiButton } = require('../../../core/guild/goliathNavigation');
const { EMOJIS } = require('../../../core/ui/emojis');
const stickyStore = require('./stickyStore');

function buildStickyStatusEmbed(guildId, channelId) {
  const moduleEnabled = stickyStore.isEnabled(guildId);
  const sticky = stickyStore.getChannelSticky(guildId, channelId);

  if (!sticky) {
    return new EmbedBuilder()
      .setColor(moduleEnabled ? '#f59e0b' : '#ef4444')
      .setTitle('Sticky Messages')
      .setDescription(moduleEnabled
        ? 'No sticky message is configured for this channel. Use **Set Sticky** to create one.'
        : 'Sticky Messages is disabled for this server. Enable the module before creating or reposting sticky messages.')
      .addFields({ name: 'Module', value: moduleEnabled ? 'Enabled' : 'Disabled', inline: true })
      .setFooter({ text: 'Sticky messages repost at the bottom of the channel after normal chat activity.' });
  }

  const channelEnabled = sticky.enabled !== false;
  const active = moduleEnabled && channelEnabled;
  const state = !moduleEnabled
    ? 'Module disabled'
    : channelEnabled
      ? 'Sticky message is active.'
      : 'Sticky message is paused.';

  return new EmbedBuilder()
    .setColor(active ? '#22c55e' : '#ef4444')
    .setTitle('Sticky Messages')
    .setDescription(state)
    .addFields(
      { name: 'Module', value: moduleEnabled ? 'Enabled' : 'Disabled', inline: true },
      { name: 'Channel Sticky', value: channelEnabled ? 'Enabled' : 'Paused', inline: true },
      { name: 'Type', value: sticky.type || 'text', inline: true },
      { name: 'Repost Every', value: `${sticky.repostEvery ?? 10} messages`, inline: true },
      { name: 'Cooldown', value: `${sticky.cooldownSeconds ?? 60}s`, inline: true },
      { name: 'Content', value: String(sticky.content || 'No content set.').slice(0, 1000), inline: false },
      { name: 'Last Message ID', value: sticky.lastMessageId || 'Not posted yet', inline: false }
    )
    .setTimestamp(new Date(sticky.updatedAt || Date.now()));
}

function buildStickyMenuRows(channelId) {
  return [
    new ActionRowBuilder().addComponents(
      navigationButton(`sticky:setup:${channelId}`, 'Set Sticky', ButtonStyle.Primary),
      navigationButton(`sticky:repost:${channelId}`, 'Repost Now', ButtonStyle.Secondary),
      navigationButton(`sticky:pause:${channelId}`, 'Pause', ButtonStyle.Secondary),
      navigationButton(`sticky:resume:${channelId}`, 'Resume', ButtonStyle.Success),
      navigationButton(`sticky:delete:${channelId}`, 'Delete', ButtonStyle.Danger),
    ),
    new ActionRowBuilder().addComponents(
      emojiButton('admin:back', 'Back', EMOJIS.BACK, ButtonStyle.Secondary),
    ),
  ];
}

module.exports = {
  buildStickyStatusEmbed,
  buildStickyMenuRows,
};