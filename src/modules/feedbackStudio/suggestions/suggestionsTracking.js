'use strict';

const { PermissionFlagsBits } = require('discord.js');
const suggestions = require('./suggestions');
const emojis = require('../../utilityStudio/emojis/emojis');
const emojiPayload = require('../../utilityStudio/emojis/emojiPayload');
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
  if (!guildId || !isModuleEnabled(guildId, 'suggestions')) throw new Error('Suggestions are currently paused for this server.');
  return suggestions.getSection(guildId);
}

function isReviewer(member, section) {
  if (!member) return false;
  if (member.permissions?.has?.(PermissionFlagsBits.ManageGuild) || member.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  return (section.reviewerRoleIds || []).some((roleId) => member.roles?.cache?.has(roleId));
}

async function resolveSendableChannel(guild, channelId, label, options = {}) {
  if (!guild || !channelId) throw new Error(`${label} is not set.`);
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.send) throw new Error(`${label} is unavailable.`);
  const permissions = guild.members.me && channel.permissionsFor?.(guild.members.me);
  const required = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
  if (options.requireHistory === true) required.push(PermissionFlagsBits.ReadMessageHistory);
  if (permissions && !required.every((permission) => permissions.has(permission))) {
    throw new Error(`Goliath needs permission to view and post in the ${label.toLowerCase()}.`);
  }
  return channel;
}

async function resolveSuggestionPayload(guild, payload = {}) {
  return emojiPayload.resolveMessagePayload(guild.client, guild.id, payload, 'suggestions');
}

async function fetchMessage(guild, channelId, messageId) {
  if (!guild || !channelId || !messageId) return null;
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  return channel?.messages?.fetch ? channel.messages.fetch(messageId).catch(() => null) : null;
}

async function writeAuditLog(guild, suggestion, event, panel) {
  if (!guild?.id || !suggestion) return false;
  const section = suggestions.getSection(guild.id);
  if (!section.logChannelId) return false;
  try {
    const channel = await resolveSendableChannel(guild, section.logChannelId, 'suggestions audit log channel');
    const payload = await resolveSuggestionPayload(guild, { embeds: [panel.buildAuditLogEmbed(guild, suggestion, event)] });
    await channel.send(payload);
    return true;
  } catch (error) {
    console.warn(`[Suggestions] Failed to write audit log for ${suggestion.reference || suggestion.suggestionId}:`, error.message || error);
    return false;
  }
}

async function submitSuggestion(interaction, panel) {
  const guildId = interaction?.guildId;
  if (!interaction?.guild || !interaction.user?.id) throw new Error('The server or member could not be found.');
  const initial = assertEnabled(guildId);

  const title = String(interaction.fields.getTextInputValue('title') || '').trim();
  const content = String(interaction.fields.getTextInputValue('content') || '').trim();
  if (title.length < 3 || title.length > 100) throw new Error('Your suggestion name must be between 3 and 100 characters.');
  if (content.length < 5 || content.length > 1800) throw new Error('Your suggestion details must be between 5 and 1800 characters.');
  if (!initial.submitChannelId) throw new Error('The public suggestions channel has not been set up yet.');
  if (initial.requireReview !== false && !initial.reviewChannelId) throw new Error('The management discussion channel has not been set up yet.');
  if (initial.requireReview !== false && initial.reviewChannelId === initial.submitChannelId) {
    throw new Error('The management discussion channel must be different from the public suggestions channel.');
  }

  let suggestionId = suggestions.createId('sg');
  while (suggestions.getSuggestion(guildId, suggestionId)) suggestionId = suggestions.createId('sg');

  return withSuggestionLock(guildId, suggestionId, async () => {
    const fresh = assertEnabled(guildId);
    const publicChannel = await resolveSendableChannel(interaction.guild, fresh.submitChannelId, 'public suggestions channel', { requireHistory: true });
    const reviewChannel = fresh.requireReview !== false
      ? await resolveSendableChannel(interaction.guild, fresh.reviewChannelId, 'team discussion channel', { requireHistory: true })
      : null;

    const draft = suggestions.normalizeSuggestion({
      suggestionId,
      title,
      content,
      authorId: interaction.user.id,
      anonymous: fresh.anonymous === true,
      status: 'pending',
      votePaused: false,
    });

    const publicPayload = await resolveSuggestionPayload(
      interaction.guild,
      panel.buildSuggestionMessagePayload(interaction.guild, draft, fresh, true, true),
    );
    const publicMessage = await publicChannel.send(publicPayload);
    let reviewMessage = null;

    try {
      const linkedDraft = suggestions.normalizeSuggestion({
        ...draft,
        channelId: publicMessage.channelId,
        messageId: publicMessage.id,
      });
      if (reviewChannel) {
        const managementPayload = await resolveSuggestionPayload(
          interaction.guild,
          panel.buildManagementPayload(interaction.guild, linkedDraft, fresh),
        );
        reviewMessage = await reviewChannel.send(managementPayload);
      }

      const saved = suggestions.saveSuggestion(guildId, {
        ...linkedDraft,
        reviewChannelId: reviewMessage?.channelId || null,
        reviewMessageId: reviewMessage?.id || null,
      }, interaction.guild);
      const submittedEvent = saved.history?.[saved.history.length - 1] || {
        type: 'submitted',
        actorId: interaction.user.id,
        at: saved.createdAt,
        toStatus: 'pending',
      };
      await writeAuditLog(interaction.guild, saved, submittedEvent, panel);
      return saved;
    } catch (error) {
      await reviewMessage?.delete?.().catch(() => null);
      await publicMessage.delete().catch(() => null);
      throw error;
    }
  });
}

async function refreshSuggestionMessage(guild, suggestionId, panel) {
  if (!guild?.id) return null;
  const section = suggestions.getSection(guild.id);
  const suggestion = suggestions.getSuggestion(guild.id, suggestionId);
  if (!suggestion?.channelId || !suggestion.messageId) return null;
  const message = await fetchMessage(guild, suggestion.channelId, suggestion.messageId);
  if (!message?.editable) return null;
  const enabled = isModuleEnabled(guild.id, 'suggestions');
  const payload = await resolveSuggestionPayload(
    guild,
    panel.buildSuggestionMessagePayload(guild, suggestion, section, enabled, true),
  );
  await message.edit(payload);
  return suggestion;
}

async function refreshReviewMessage(guild, suggestionId, panel) {
  if (!guild?.id) return null;
  const section = suggestions.getSection(guild.id);
  const suggestion = suggestions.getSuggestion(guild.id, suggestionId);
  if (!suggestion?.reviewChannelId || !suggestion.reviewMessageId) return null;
  const message = await fetchMessage(guild, suggestion.reviewChannelId, suggestion.reviewMessageId);
  if (!message?.editable) return null;
  const payload = await resolveSuggestionPayload(guild, panel.buildManagementPayload(guild, suggestion, section));
  await message.edit(payload);
  return suggestion;
}

async function bestEffortRefresh(guild, suggestionId, panel) {
  let publicResult = null;
  try { publicResult = await refreshSuggestionMessage(guild, suggestionId, panel); }
  catch (error) { console.warn(`[Suggestions] Failed to refresh public suggestion ${suggestionId}:`, error.message || error); }
  try { await refreshReviewMessage(guild, suggestionId, panel); }
  catch (error) { console.warn(`[Suggestions] Failed to refresh management suggestion ${suggestionId}:`, error.message || error); }
  return publicResult;
}

async function refreshPendingSuggestions(guild, panel) {
  if (!guild?.id) return 0;
  const section = suggestions.getSection(guild.id);
  const activeIds = Object.values(section.suggestions || {})
    .filter((item) => ['pending', 'discussing', 'approved'].includes(item?.status) && item.suggestionId)
    .map((item) => item.suggestionId);
  for (const suggestionId of activeIds) await bestEffortRefresh(guild, suggestionId, panel);
  return activeIds.length;
}

async function vote(interaction, suggestionId, direction, panel) {
  if (!['up', 'down'].includes(direction)) throw new Error('That vote option is unavailable.');
  const guildId = interaction?.guildId;
  const userId = interaction?.user?.id;
  const id = suggestions.cleanSuggestionId(suggestionId);
  if (!guildId || !userId || !id) throw new Error('That suggestion vote is no longer available.');

  return withSuggestionLock(guildId, id, async () => {
    const section = assertEnabled(guildId);
    if (section.voting === false) throw new Error('Community voting is currently turned off.');
    const current = suggestions.getSuggestion(guildId, id);
    if (!current) throw new Error('That suggestion could not be found.');
    if (current.status === 'discussing' || current.votePaused) throw new Error('Voting is paused while the management team discusses this suggestion.');
    if (current.status !== 'pending') throw new Error('Voting has closed for this suggestion.');

    const updated = suggestions.updateSuggestion(guildId, id, (item) => {
      const upVotes = new Set(item.upVotes || []);
      const downVotes = new Set(item.downVotes || []);
      if (direction === 'up') {
        downVotes.delete(userId);
        if (upVotes.has(userId)) upVotes.delete(userId);
        else upVotes.add(userId);
      } else {
        upVotes.delete(userId);
        if (downVotes.has(userId)) downVotes.delete(userId);
        else downVotes.add(userId);
      }
      return { ...item, upVotes: [...upVotes], downVotes: [...downVotes] };
    }, interaction.guild);

    if (!updated) throw new Error('Your vote could not be saved.');
    await bestEffortRefresh(interaction.guild, id, panel);
    return updated;
  });
}

function quotePreview(suggestion, maxLength = 500) {
  const text = String(suggestion?.content || '').trim().slice(0, maxLength);
  const body = text ? `> ${text.replace(/\n/g, '\n> ')}` : '> Your suggestion';
  return `**${suggestion?.title || 'Your suggestion'}**\n${body}`;
}

async function notifyAuthor(guild, suggestion) {
  if (!guild || !suggestion?.authorId) return false;
  const member = await guild.members.fetch(suggestion.authorId).catch(() => null);
  if (!member?.user) return false;

  let headline = `💡 **The team has updated your suggestion in ${guild.name}.**`;
  let decision = `${statusLabelForDm(suggestion.status)} Your suggestion status has changed.`;
  if (suggestion.status === 'approved') {
    headline = `💡 **Your suggestion in ${guild.name} was approved!**`;
    decision = '✅ The management team has approved it to move forward.';
  } else if (suggestion.status === 'implemented') {
    headline = `🚀 **Your suggestion in ${guild.name} has been implemented!**`;
    decision = '🚀 The management team has marked the suggestion as completed.';
  } else if (suggestion.status === 'denied') {
    headline = `💡 **The team has reviewed your suggestion in ${guild.name}.**`;
    decision = '❌ The management team has decided not to move forward with it.';
  }

  const response = suggestion.status === 'implemented'
    ? suggestion.implementationNote || suggestion.reviewReason
    : suggestion.reviewReason;
  const note = response ? `\n\n**Team response**\n${response}` : '';
  const privacy = suggestion.anonymous === true ? '\n\n🔒 You shared this suggestion anonymously on the public board.' : '';
  const content = await emojis.resolveText(
    guild.client,
    guild.id,
    `${headline}\n\n${quotePreview(suggestion)}\n\n${decision}${note}${privacy}\n\nYou can also see its latest status in **My Suggestions**.`,
  );
  return member.user.send(content).then(() => true).catch(() => false);
}

function statusLabelForDm(status) {
  if (status === 'discussing') return '💬';
  if (status === 'implemented') return '🚀';
  if (status === 'approved') return '✅';
  if (status === 'denied') return '❌';
  return '💡';
}

async function publishReviewedSuggestion(guild, targetId, label, updated, section, panel) {
  if (!targetId) return true;
  try {
    const target = await resolveSendableChannel(guild, targetId, label);
    const payload = await resolveSuggestionPayload(
      guild,
      panel.buildSuggestionMessagePayload(guild, updated, section, true, false),
    );
    await target.send(payload);
    return true;
  } catch (error) {
    console.warn(`[Suggestions] Failed to publish ${updated.reference || updated.suggestionId} to ${label}:`, error.message || error);
    return false;
  }
}

async function ensureDiscussionThread(guild, suggestion) {
  if (!suggestion?.reviewChannelId || !suggestion.reviewMessageId || suggestion.discussionThreadId) return suggestion?.discussionThreadId || null;
  const message = await fetchMessage(guild, suggestion.reviewChannelId, suggestion.reviewMessageId);
  if (!message?.startThread) return null;
  try {
    const thread = await message.startThread({
      name: `${suggestion.reference} · ${String(suggestion.title || 'Suggestion').slice(0, 70)}`,
      autoArchiveDuration: 1440,
      reason: `Team discussion for ${suggestion.reference}`,
    });
    return thread?.id || null;
  } catch (error) {
    console.warn(`[Suggestions] Could not create a discussion thread for ${suggestion.reference}:`, error.message || error);
    return null;
  }
}

async function manage(interaction, suggestionId, action, panel, reason = '') {
  const allowed = ['discuss', 'resume', 'approve', 'deny', 'implemented'];
  if (!allowed.includes(action)) throw new Error('That management action is unavailable.');
  const guildId = interaction?.guildId;
  const managerId = interaction?.user?.id;
  const id = suggestions.cleanSuggestionId(suggestionId);
  if (!guildId || !interaction?.guild || !managerId || !id) throw new Error('That suggestion action is no longer available.');

  return withSuggestionLock(guildId, id, async () => {
    const section = assertEnabled(guildId);
    if (!isReviewer(interaction.member, section)) throw new Error('You are not part of the suggestions management team.');
    const current = suggestions.getSuggestion(guildId, id);
    if (!current) throw new Error('That suggestion could not be found.');

    const note = String(reason || '').trim().slice(0, 500);
    let fromStatus = current.status;
    let toStatus = current.status;
    let eventType = action;
    let patch = {};

    if (action === 'discuss') {
      if (current.status !== 'pending') throw new Error('Only an open suggestion can be moved into team discussion.');
      toStatus = 'discussing';
      eventType = 'discussion_started';
      patch = {
        status: 'discussing',
        votePaused: true,
        discussionStartedBy: managerId,
        discussionStartedAt: new Date().toISOString(),
      };
    } else if (action === 'resume') {
      if (current.status !== 'discussing') throw new Error('Only a suggestion under discussion can be reopened for voting.');
      toStatus = 'pending';
      eventType = 'voting_resumed';
      patch = { status: 'pending', votePaused: false };
    } else if (action === 'approve') {
      if (!['pending', 'discussing'].includes(current.status)) throw new Error('Only an open or discussed suggestion can be approved.');
      toStatus = 'approved';
      eventType = 'approved';
      patch = {
        status: 'approved',
        votePaused: true,
        reviewedBy: managerId,
        reviewedAt: new Date().toISOString(),
        reviewReason: note,
      };
    } else if (action === 'deny') {
      if (!['pending', 'discussing'].includes(current.status)) throw new Error('Only an open or discussed suggestion can be declined.');
      if (note.length < 3) throw new Error('Please give the member a clear reason for declining the suggestion.');
      toStatus = 'denied';
      eventType = 'denied';
      patch = {
        status: 'denied',
        votePaused: true,
        reviewedBy: managerId,
        reviewedAt: new Date().toISOString(),
        reviewReason: note,
      };
    } else if (action === 'implemented') {
      if (current.status !== 'approved') throw new Error('A suggestion must be approved before it can be marked as implemented.');
      if (note.length < 3) throw new Error('Please describe what was implemented.');
      toStatus = 'implemented';
      eventType = 'implemented';
      patch = {
        status: 'implemented',
        votePaused: true,
        implementedBy: managerId,
        implementedAt: new Date().toISOString(),
        implementationNote: note,
      };
    }

    const event = {
      type: eventType,
      actorId: managerId,
      at: new Date().toISOString(),
      fromStatus,
      toStatus,
      note,
    };
    let updated = suggestions.updateSuggestion(guildId, id, (item) => ({
      ...item,
      ...patch,
      history: suggestions.appendHistory(item.history, event),
    }), interaction.guild);
    if (!updated) throw new Error('The suggestion could not be updated.');

    if (action === 'discuss') {
      const threadId = await ensureDiscussionThread(interaction.guild, updated);
      if (threadId) {
        updated = suggestions.updateSuggestion(guildId, id, { discussionThreadId: threadId }, interaction.guild) || updated;
      }
    }

    await bestEffortRefresh(interaction.guild, id, panel);
    const freshSection = suggestions.getSection(guildId);

    if (action === 'approve') {
      await publishReviewedSuggestion(interaction.guild, freshSection.approvedChannelId, 'approved suggestions channel', updated, freshSection, panel);
      await notifyAuthor(interaction.guild, updated);
    } else if (action === 'deny') {
      await publishReviewedSuggestion(interaction.guild, freshSection.deniedChannelId, 'declined suggestions channel', updated, freshSection, panel);
      await notifyAuthor(interaction.guild, updated);
    } else if (action === 'implemented') {
      await publishReviewedSuggestion(interaction.guild, freshSection.approvedChannelId, 'approved suggestions channel', updated, freshSection, panel);
      await notifyAuthor(interaction.guild, updated);
    }

    await writeAuditLog(interaction.guild, updated, event, panel);
    return updated;
  });
}

async function review(interaction, suggestionId, action, panel, reason = '') {
  return manage(interaction, suggestionId, action === 'approve' ? 'approve' : 'deny', panel, reason);
}

module.exports = {
  assertEnabled,
  isReviewer,
  resolveSendableChannel,
  submitSuggestion,
  refreshSuggestionMessage,
  refreshReviewMessage,
  refreshPendingSuggestions,
  vote,
  manage,
  review,
  notifyAuthor,
  writeAuditLog,
};
