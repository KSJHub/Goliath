'use strict';

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
} = require('discord.js');

const suggestionsStore = require('./suggestionsStore');
const { isModuleEnabled } = require('../../core/guild/guildManager');

const suggestionLocks = new Map();

function lockKey(guildId, suggestionId) {
  return `${guildId}:${suggestionId}`;
}

async function withSuggestionLock(guildId, suggestionId, operation) {
  const key = lockKey(guildId, suggestionId);
  const previous = suggestionLocks.get(key) || Promise.resolve();
  const current = previous.catch(() => null).then(operation);
  suggestionLocks.set(key, current);
  try {
    return await current;
  } finally {
    if (suggestionLocks.get(key) === current) suggestionLocks.delete(key);
  }
}

function assertEnabled(guildId) {
  if (!guildId || !isModuleEnabled(guildId, 'suggestions')) {
    throw new Error('Suggestions are disabled for this server.');
  }
  const section = suggestionsStore.getSection(guildId);
  if (section.enabled === false) throw new Error('Suggestions are disabled.');
  return section;
}

function isReviewer(member, section) {
  if (!member) return false;
  if (member.permissions?.has?.(PermissionFlagsBits.ManageGuild) || member.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  return (section.reviewerRoleIds || []).some((roleId) => member.roles?.cache?.has(roleId));
}

function buildSuggestionEmbed(guild, suggestion, section) {
  const author = section.anonymous ? 'Anonymous' : `<@${suggestion.authorId}>`;
  const statusEmoji = suggestion.status === 'approved' ? '✅' : suggestion.status === 'denied' ? '❌' : '💡';
  return new EmbedBuilder()
    .setColor(suggestion.status === 'approved' ? 0x57f287 : suggestion.status === 'denied' ? 0xed4245 : 0x5865f2)
    .setTitle(`${statusEmoji} Suggestion`)
    .setDescription(suggestion.content || '_No content_')
    .addFields(
      { name: 'Author', value: author, inline: true },
      { name: 'Status', value: suggestion.status, inline: true },
      { name: 'Votes', value: `👍 ${suggestion.upVotes.length}  👎 ${suggestion.downVotes.length}`, inline: true }
    )
    .setFooter({ text: `Suggestion ID: ${suggestion.suggestionId}` })
    .setTimestamp(new Date(suggestion.createdAt || Date.now()));
}

function buildSuggestionRows(suggestion, section) {
  const rows = [];
  if (section.voting !== false && suggestion.status === 'pending') {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`suggestions:vote:${suggestion.suggestionId}:up`).setLabel(`👍 ${suggestion.upVotes.length}`).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`suggestions:vote:${suggestion.suggestionId}:down`).setLabel(`👎 ${suggestion.downVotes.length}`).setStyle(ButtonStyle.Secondary)
    ));
  }
  if (section.requireReview !== false && suggestion.status === 'pending') {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`suggestions:review:${suggestion.suggestionId}:approve`).setLabel('Approve').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`suggestions:review:${suggestion.suggestionId}:deny`).setLabel('Deny').setStyle(ButtonStyle.Danger)
    ));
  }
  return rows;
}

function buildSubmitPanelPayload(guildId) {
  const section = assertEnabled(guildId);
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('💡 Submit a Suggestion')
        .setDescription('Click the button below to send a suggestion to the server team.')
        .setFooter({ text: 'Goliath Suggestions' })
        .setTimestamp(),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('suggestions:submit')
          .setLabel(section.anonymous ? 'Submit Anonymous Suggestion' : 'Submit Suggestion')
          .setStyle(ButtonStyle.Primary)
      ),
    ],
  };
}

function buildSubmitModal() {
  return new ModalBuilder()
    .setCustomId('suggestions:modal:submit')
    .setTitle('Submit Suggestion')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('content')
          .setLabel('Your suggestion')
          .setStyle(TextInputStyle.Paragraph)
          .setMinLength(5)
          .setMaxLength(1800)
          .setRequired(true)
      )
    );
}

async function resolveSendableChannel(guild, channelId, label) {
  if (!guild || !channelId) throw new Error(`${label} is not configured.`);
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.send) throw new Error(`${label} is unavailable or not sendable.`);
  const me = guild.members.me;
  const permissions = me && channel.permissionsFor?.(me);
  if (permissions && ![
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
  ].every((permission) => permissions.has(permission))) {
    throw new Error(`Goliath lacks permission to post in the ${label.toLowerCase()}.`);
  }
  return channel;
}

async function submitSuggestion(interaction) {
  const guildId = interaction?.guildId;
  const guild = interaction?.guild;
  const section = assertEnabled(guildId);
  if (!guild || !interaction.user?.id) throw new Error('Server or member is unavailable.');

  const content = String(interaction.fields.getTextInputValue('content') || '').trim();
  if (content.length < 5 || content.length > 1800) throw new Error('Suggestion must be between 5 and 1800 characters.');

  const draft = suggestionsStore.normalizeSuggestion({ content, authorId: interaction.user.id });
  return withSuggestionLock(guildId, draft.suggestionId, async () => {
    const freshSection = assertEnabled(guildId);
    const targetChannelId = freshSection.requireReview !== false
      ? freshSection.reviewChannelId || freshSection.submitChannelId
      : freshSection.submitChannelId;
    const targetChannel = await resolveSendableChannel(guild, targetChannelId, 'Suggestion channel');
    const message = await targetChannel.send({
      embeds: [buildSuggestionEmbed(guild, draft, freshSection)],
      components: buildSuggestionRows(draft, freshSection),
    }).catch((error) => {
      console.error(`[Suggestions] Failed to post suggestion ${draft.suggestionId} in ${guildId}:`, error);
      return null;
    });
    if (!message) throw new Error('The suggestion could not be posted. Nothing was saved.');

    const saved = suggestionsStore.saveSuggestion(guildId, {
      ...draft,
      channelId: message.channelId,
      messageId: message.id,
      reviewMessageId: freshSection.requireReview !== false ? message.id : null,
    }, guild);
    suggestionsStore.incrementAnalytics(guildId, { submitted: 1 }, guild);
    return saved;
  });
}

async function refreshSuggestionMessage(guild, suggestionId) {
  const section = assertEnabled(guild?.id);
  const suggestion = suggestionsStore.getSuggestion(guild.id, suggestionId);
  if (!suggestion?.channelId || !suggestion.messageId) return null;
  const channel = guild.channels.cache.get(suggestion.channelId) || await guild.channels.fetch(suggestion.channelId).catch(() => null);
  const message = await channel?.messages?.fetch(suggestion.messageId).catch(() => null);
  if (!message?.editable) return null;
  const edited = await message.edit({
    embeds: [buildSuggestionEmbed(guild, suggestion, section)],
    components: buildSuggestionRows(suggestion, section),
  }).catch((error) => {
    console.error(`[Suggestions] Failed to refresh ${suggestionId} in ${guild.id}:`, error);
    return null;
  });
  return edited ? suggestion : null;
}

async function vote(interaction, suggestionId, direction) {
  if (!['up', 'down'].includes(direction)) throw new Error('Invalid vote direction.');
  const guildId = interaction?.guildId;
  const userId = interaction?.user?.id;
  if (!guildId || !userId || !suggestionId) throw new Error('Invalid suggestion vote.');

  return withSuggestionLock(guildId, suggestionId, async () => {
    const section = assertEnabled(guildId);
    if (section.voting === false) throw new Error('Voting is disabled.');
    const current = suggestionsStore.getSuggestion(guildId, suggestionId);
    if (!current) throw new Error('Suggestion not found.');
    if (current.status !== 'pending') throw new Error('Voting is closed for this suggestion.');

    let added = false;
    const updated = suggestionsStore.updateSuggestion(guildId, suggestionId, (suggestion) => {
      const upVotes = new Set(suggestion.upVotes || []);
      const downVotes = new Set(suggestion.downVotes || []);
      if (direction === 'up') {
        downVotes.delete(userId);
        if (upVotes.has(userId)) upVotes.delete(userId); else { upVotes.add(userId); added = true; }
      } else {
        upVotes.delete(userId);
        if (downVotes.has(userId)) downVotes.delete(userId); else { downVotes.add(userId); added = true; }
      }
      return { ...suggestion, upVotes: [...upVotes], downVotes: [...downVotes] };
    }, interaction.guild);
    if (!updated) throw new Error('Suggestion could not be updated.');
    if (added) suggestionsStore.incrementAnalytics(guildId, direction === 'up' ? { votesUp: 1 } : { votesDown: 1 }, interaction.guild);
    await refreshSuggestionMessage(interaction.guild, suggestionId);
    return updated;
  });
}

async function review(interaction, suggestionId, action) {
  if (!['approve', 'deny'].includes(action)) throw new Error('Invalid review action.');
  const guildId = interaction?.guildId;
  if (!guildId || !suggestionId) throw new Error('Invalid suggestion review.');

  return withSuggestionLock(guildId, suggestionId, async () => {
    const section = assertEnabled(guildId);
    if (!isReviewer(interaction.member, section)) throw new Error('You do not have permission to review suggestions.');
    const current = suggestionsStore.getSuggestion(guildId, suggestionId);
    if (!current) throw new Error('Suggestion not found.');
    if (current.status !== 'pending') throw new Error(`Suggestion is already ${current.status}.`);

    const status = action === 'approve' ? 'approved' : 'denied';
    const updated = suggestionsStore.updateSuggestion(guildId, suggestionId, {
      status,
      reviewedBy: interaction.user.id,
      reviewedAt: new Date().toISOString(),
    }, interaction.guild);
    if (!updated) throw new Error('Suggestion could not be updated.');

    suggestionsStore.incrementAnalytics(guildId, status === 'approved' ? { approved: 1 } : { denied: 1 }, interaction.guild);
    await refreshSuggestionMessage(interaction.guild, suggestionId);

    const targetId = status === 'approved' ? section.approvedChannelId : section.deniedChannelId;
    if (targetId) {
      const target = await resolveSendableChannel(interaction.guild, targetId, `${status} suggestions channel`);
      await target.send({ embeds: [buildSuggestionEmbed(interaction.guild, updated, section)] }).catch((error) => {
        console.error(`[Suggestions] Failed to publish ${status} suggestion ${suggestionId}:`, error);
      });
    }
    return updated;
  });
}

async function deploySubmitPanel(guild) {
  const section = assertEnabled(guild?.id);
  if (!section.submitChannelId) throw new Error('Choose a submit channel first.');
  const channel = await resolveSendableChannel(guild, section.submitChannelId, 'Submit channel');
  return channel.send(buildSubmitPanelPayload(guild.id));
}

module.exports = {
  isReviewer,
  buildSuggestionEmbed,
  buildSuggestionRows,
  buildSubmitPanelPayload,
  buildSubmitModal,
  submitSuggestion,
  vote,
  review,
  deploySubmitPanel,
};