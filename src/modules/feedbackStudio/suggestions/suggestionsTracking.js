'use strict';

const { PermissionFlagsBits } = require('discord.js');
const suggestions = require('./suggestions');
const { isModuleEnabled } = require('../../../core/guild/guildManager');

const locks = new Map();
const lockKey = (guildId, suggestionId) => `${guildId}:${suggestionId}`;

async function withSuggestionLock(guildId, suggestionId, operation) {
  const key = lockKey(guildId, suggestionId);
  const previous = locks.get(key) || Promise.resolve();
  const current = previous.catch(() => null).then(operation);
  locks.set(key, current);
  try { return await current; }
  finally { if (locks.get(key) === current) locks.delete(key); }
}

function assertEnabled(guildId) {
  if (!guildId || !isModuleEnabled(guildId, 'suggestions')) throw new Error('Suggestions are disabled for this server.');
  return suggestions.getSection(guildId);
}

function isReviewer(member, section) {
  if (!member) return false;
  if (member.permissions?.has?.(PermissionFlagsBits.ManageGuild) || member.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  return (section.reviewerRoleIds || []).some((roleId) => member.roles?.cache?.has(roleId));
}

async function resolveSendableChannel(guild, channelId, label) {
  if (!guild || !channelId) throw new Error(`${label} is not configured.`);
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.send) throw new Error(`${label} is unavailable or not sendable.`);
  const permissions = guild.members.me && channel.permissionsFor?.(guild.members.me);
  if (permissions && ![PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks].every((permission) => permissions.has(permission))) {
    throw new Error(`Goliath lacks permission to post in the ${label.toLowerCase()}.`);
  }
  return channel;
}

async function submitSuggestion(interaction, panel) {
  const guildId = interaction?.guildId;
  const section = assertEnabled(guildId);
  if (!interaction?.guild || !interaction.user?.id) throw new Error('Server or member is unavailable.');
  const content = String(interaction.fields.getTextInputValue('content') || '').trim();
  if (content.length < 5 || content.length > 1800) throw new Error('Suggestion must be between 5 and 1800 characters.');
  const draft = suggestions.normalizeSuggestion({ content, authorId: interaction.user.id });
  return withSuggestionLock(guildId, draft.suggestionId, async () => {
    const fresh = assertEnabled(guildId);
    const targetId = fresh.requireReview !== false ? fresh.reviewChannelId || fresh.submitChannelId : fresh.submitChannelId;
    const channel = await resolveSendableChannel(interaction.guild, targetId, 'Suggestion channel');
    const message = await channel.send({ embeds: [panel.buildSuggestionEmbed(interaction.guild, draft, fresh)], components: panel.buildSuggestionRows(draft, fresh) });
    const saved = suggestions.saveSuggestion(guildId, { ...draft, channelId: message.channelId, messageId: message.id, reviewMessageId: fresh.requireReview !== false ? message.id : null }, interaction.guild);
    suggestions.incrementAnalytics(guildId, { submitted: 1 }, interaction.guild);
    return saved;
  });
}

async function refreshSuggestionMessage(guild, suggestionId, panel) {
  const section = assertEnabled(guild?.id);
  const suggestion = suggestions.getSuggestion(guild.id, suggestionId);
  if (!suggestion?.channelId || !suggestion.messageId) return null;
  const channel = guild.channels.cache.get(suggestion.channelId) || await guild.channels.fetch(suggestion.channelId).catch(() => null);
  const message = await channel?.messages?.fetch(suggestion.messageId).catch(() => null);
  if (!message?.editable) return null;
  await message.edit({ embeds: [panel.buildSuggestionEmbed(guild, suggestion, section)], components: panel.buildSuggestionRows(suggestion, section) });
  return suggestion;
}

async function vote(interaction, suggestionId, direction, panel) {
  if (!['up', 'down'].includes(direction)) throw new Error('Invalid vote direction.');
  const guildId = interaction?.guildId;
  const userId = interaction?.user?.id;
  if (!guildId || !userId || !suggestionId) throw new Error('Invalid suggestion vote.');
  return withSuggestionLock(guildId, suggestionId, async () => {
    const section = assertEnabled(guildId);
    if (section.voting === false) throw new Error('Voting is disabled.');
    const current = suggestions.getSuggestion(guildId, suggestionId);
    if (!current) throw new Error('Suggestion not found.');
    if (current.status !== 'pending') throw new Error('Voting is closed for this suggestion.');
    let added = false;
    const updated = suggestions.updateSuggestion(guildId, suggestionId, (item) => {
      const upVotes = new Set(item.upVotes || []);
      const downVotes = new Set(item.downVotes || []);
      if (direction === 'up') { downVotes.delete(userId); if (upVotes.has(userId)) upVotes.delete(userId); else { upVotes.add(userId); added = true; } }
      else { upVotes.delete(userId); if (downVotes.has(userId)) downVotes.delete(userId); else { downVotes.add(userId); added = true; } }
      return { ...item, upVotes: [...upVotes], downVotes: [...downVotes] };
    }, interaction.guild);
    if (added) suggestions.incrementAnalytics(guildId, direction === 'up' ? { votesUp: 1 } : { votesDown: 1 }, interaction.guild);
    await refreshSuggestionMessage(interaction.guild, suggestionId, panel);
    return updated;
  });
}

async function notifyAuthor(guild, suggestion) {
  if (!suggestion?.authorId) return false;
  const member = await guild.members.fetch(suggestion.authorId).catch(() => null);
  if (!member?.user) return false;
  const verdict = suggestion.status === 'approved' ? 'approved ✅' : 'denied ❌';
  const note = suggestion.reviewReason ? `\nDecision note: ${suggestion.reviewReason}` : '';
  await member.user.send(`Your suggestion in **${guild.name}** was **${verdict}**.${note}\nSuggestion ID: \`${suggestion.suggestionId}\``).catch(() => null);
  return true;
}

async function review(interaction, suggestionId, action, panel, reason = '') {
  if (!['approve', 'deny'].includes(action)) throw new Error('Invalid review action.');
  const guildId = interaction?.guildId;
  return withSuggestionLock(guildId, suggestionId, async () => {
    const section = assertEnabled(guildId);
    if (!isReviewer(interaction.member, section)) throw new Error('You do not have permission to review suggestions.');
    const current = suggestions.getSuggestion(guildId, suggestionId);
    if (!current) throw new Error('Suggestion not found.');
    if (current.status !== 'pending') throw new Error(`Suggestion is already ${current.status}.`);
    const status = action === 'approve' ? 'approved' : 'denied';
    const targetId = status === 'approved' ? section.approvedChannelId : section.deniedChannelId;
    const target = targetId
      ? await resolveSendableChannel(interaction.guild, targetId, `${status} suggestions channel`)
      : null;
    const reviewReason = String(reason || '').trim().slice(0, 500);
    const updated = suggestions.updateSuggestion(guildId, suggestionId, {
      status,
      reviewedBy: interaction.user.id,
      reviewedAt: new Date().toISOString(),
      reviewReason,
    }, interaction.guild);
    suggestions.incrementAnalytics(guildId, status === 'approved' ? { approved: 1 } : { denied: 1 }, interaction.guild);
    await refreshSuggestionMessage(interaction.guild, suggestionId, panel);
    if (target) await target.send({ embeds: [panel.buildSuggestionEmbed(interaction.guild, updated, section)] });
    await notifyAuthor(interaction.guild, updated);
    return updated;
  });
}

module.exports = {
  assertEnabled,
  isReviewer,
  resolveSendableChannel,
  submitSuggestion,
  refreshSuggestionMessage,
  vote,
  review,
  notifyAuthor,
};