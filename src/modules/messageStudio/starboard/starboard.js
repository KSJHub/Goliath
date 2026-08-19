'use strict';

const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const starboardStore = require('./starboardStore');
const emojis = require('../../utilityStudio/emojis/emojis');
const { isModuleEnabled, setModuleEnabled } = require('../../../core/guild/guildManager');

const IMAGE_EXTENSION_PATTERN = /\.(png|jpe?g|gif|webp)(\?.*)?$/i;
const messageLocks = new Map();

function normalizeEmojiToken(value) {
  return String(value || '').trim();
}

function emojiMatches(expected, reactionEmoji) {
  const wanted = normalizeEmojiToken(expected || '⭐');
  const emojiId = reactionEmoji?.id || null;
  const emojiName = reactionEmoji?.name || null;
  if (!wanted || !emojiName) return false;

  const forms = emojiId
    ? new Set([emojiId, emojiName, `<:${emojiName}:${emojiId}>`, `<a:${emojiName}:${emojiId}>`])
    : new Set([emojiName]);

  return forms.has(wanted) || Boolean(emojiId && wanted.includes(`:${emojiId}>`));
}

function buildMessageUrl(guildId, channelId, messageId) {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

function isImageAttachment(attachment) {
  return Boolean(
    attachment?.url &&
    (attachment.contentType?.startsWith?.('image/') || IMAGE_EXTENSION_PATTERN.test(attachment.url))
  );
}

function buildStarboardEmbed(message, starCount, section = {}) {
  const attachment = message.attachments?.find?.(isImageAttachment) || message.attachments?.first?.();
  const emoji = section.emoji || '⭐';
  const embed = new EmbedBuilder()
    .setColor('#facc15')
    .setAuthor({
      name: message.author?.tag || message.author?.username || 'Unknown User',
      iconURL: message.author?.displayAvatarURL?.() || undefined,
    })
    .setDescription((message.content || '*No text content*').slice(0, 3500))
    .addFields({
      name: 'Original Message',
      value: `[Jump to message](${buildMessageUrl(message.guild.id, message.channel.id, message.id)})`,
    })
    .setFooter({ text: `${emoji} ${starCount} star${starCount === 1 ? '' : 's'}` })
    .setTimestamp(message.createdAt || new Date());

  if (isImageAttachment(attachment)) embed.setImage(attachment.url);
  return embed;
}

function moduleEnabled(guildId) {
  if (!guildId) return false;
  try {
    return isModuleEnabled(guildId, 'starboard') === true;
  } catch (error) {
    console.error(`[Starboard] Failed to read module state for ${guildId}:`, error?.message || error);
    return false;
  }
}

async function fetchMessageFromReaction(reaction) {
  if (!reaction) return null;
  if (reaction.partial && !await reaction.fetch().catch(() => null)) return null;
  if (reaction.message?.partial && !await reaction.message.fetch().catch(() => null)) return null;
  return reaction.message || null;
}

async function getStarUsers(reaction, message, section) {
  const users = await reaction.users.fetch().catch((error) => {
    console.warn(`[Starboard] Failed to fetch reaction users for ${message?.id || 'unknown'}:`, error?.message || error);
    return null;
  });
  if (!users) return [];

  return [...new Set(
    [...users.values()]
      .filter((user) => !user.bot)
      .filter((user) => section.allowSelfStar || user.id !== message.author?.id)
      .map((user) => user.id)
  )];
}

async function resolveStarboardChannel(message, section) {
  const channelId = section?.channelId;
  if (!message?.guild?.channels || !channelId) return null;

  const channel = message.guild.channels.cache.get(channelId) ||
    await message.guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.send || !channel?.messages?.fetch) return null;

  const me = message.guild.members.me;
  const permissions = me && channel.permissionsFor?.(me);
  if (!permissions) return null;

  const required = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.ReadMessageHistory,
  ];
  return required.every((permission) => permissions.has(permission)) ? channel : null;
}

function buildPostPayload(message, starboardMessage, starUserIds) {
  return {
    messageId: message.id,
    channelId: message.channel.id,
    authorId: message.author?.id,
    starboardMessageId: starboardMessage?.id,
    starUserIds,
  };
}

async function resolveStarboardPayload(message, payload = {}) {
  return {
    ...payload,
    content: payload.content == null
      ? payload.content
      : await emojis.resolveText(message.guild.client, message.guild.id, payload.content),
    embeds: await emojis.resolveEmbeds(message.guild.client, message.guild.id, payload.embeds || []),
  };
}

async function upsertStarboardPost(message, section, starUserIds) {
  const channel = await resolveStarboardChannel(message, section);
  if (!channel) return null;

  const existing = starboardStore.getPost(message.guild.id, message.id);
  const payload = await resolveStarboardPayload(message, {
    content: `${section.emoji || '⭐'} **${starUserIds.length}** <#${message.channel.id}>`,
    embeds: [buildStarboardEmbed(message, starUserIds.length, section)],
  });

  if (existing?.starboardMessageId) {
    const current = await channel.messages.fetch(existing.starboardMessageId).catch(() => null);
    if (current?.editable) {
      const edited = await current.edit(payload).catch((error) => {
        console.error(`[Starboard] Failed to update post ${existing.starboardMessageId}:`, error?.message || error);
        return null;
      });
      if (edited) {
        return starboardStore.savePost(message.guild.id, {
          ...existing,
          channelId: message.channel.id,
          authorId: message.author?.id,
          starUserIds,
        });
      }
      return null;
    }
  }

  const sent = await channel.send(payload).catch((error) => {
    console.error(`[Starboard] Failed to create post for ${message.id}:`, error?.message || error);
    return null;
  });
  return sent ? starboardStore.savePost(message.guild.id, buildPostPayload(message, sent, starUserIds)) : null;
}

async function removeStarboardPost(message, section) {
  const existing = starboardStore.getPost(message.guild.id, message.id);
  if (!existing?.starboardMessageId) return null;

  const channel = await resolveStarboardChannel(message, section);
  if (!channel) return null;
  const current = await channel.messages.fetch(existing.starboardMessageId).catch(() => null);
  if (current && (!current.deletable || !await current.delete().then(() => true).catch(() => false))) return null;

  starboardStore.deletePost(message.guild.id, message.id);
  return existing;
}

async function withMessageLock(guildId, messageId, operation) {
  const key = `${guildId}:${messageId}`;
  const previous = messageLocks.get(key);
  if (previous) await previous.catch(() => null);

  const current = Promise.resolve().then(operation);
  messageLocks.set(key, current);
  try {
    return await current;
  } finally {
    if (messageLocks.get(key) === current) messageLocks.delete(key);
  }
}

async function processStarReaction(reaction, user, removing) {
  if (user?.bot) return null;
  const message = await fetchMessageFromReaction(reaction);
  const guild = message?.guild;
  if (!guild?.id || !message?.id || !moduleEnabled(guild.id)) return null;

  return withMessageLock(guild.id, message.id, async () => {
    if (!moduleEnabled(guild.id)) return null;
    const section = starboardStore.getStarboardSection(guild.id);
    if (!section.channelId || !emojiMatches(section.emoji, reaction.emoji)) return null;
    if (!section.allowBotMessages && message.author?.bot) return null;
    if (message.channel?.id === section.channelId) return null;

    const existing = starboardStore.getPost(guild.id, message.id);
    if (removing && !existing) return null;
    const starUserIds = await getStarUsers(reaction, message, section);
    const threshold = Math.max(1, Number(section.threshold) || 1);
    return starUserIds.length < threshold
      ? (existing ? removeStarboardPost(message, section) : null)
      : upsertStarboardPost(message, section, starUserIds);
  });
}

function configureStarboard(guildId, input = {}) {
  if (!guildId) throw new Error('A guild ID is required.');
  const hasEnabled = Object.prototype.hasOwnProperty.call(input, 'enabled');
  if (hasEnabled) setModuleEnabled(guildId, 'starboard', input.enabled === true);

  return starboardStore.updateStarboardSection(guildId, (section) => ({
    ...section,
    channelId: input.channelId ?? section.channelId,
    threshold: input.threshold ?? section.threshold,
    emoji: input.emoji ?? section.emoji,
    allowBotMessages: input.allowBotMessages ?? section.allowBotMessages,
    allowSelfStar: input.allowSelfStar ?? section.allowSelfStar,
    requireUniqueUsers: input.requireUniqueUsers ?? section.requireUniqueUsers,
    updatedAt: starboardStore.now(),
  }));
}

module.exports = {
  buildStarboardEmbed,
  configureStarboard,
  handleStarReactionAdd: (reaction, user) => processStarReaction(reaction, user, false),
  handleStarReactionRemove: (reaction, user) => processStarReaction(reaction, user, true),
};
