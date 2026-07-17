'use strict';

// src/modules/starboard/starboardManager.js

const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const starboardStore = require('./starboardStore');
const { isModuleEnabled, setModuleEnabled } = require('../../core/guild/guildManager');

const IMAGE_EXTENSION_PATTERN = /\.(png|jpe?g|gif|webp)(\?.*)?$/i;
const messageLocks = new Map();

function canManageStarboard(member) {
  return Boolean(
    member?.permissions?.has(PermissionFlagsBits.ManageGuild) ||
    member?.permissions?.has(PermissionFlagsBits.ManageMessages)
  );
}

function normalizeEmojiToken(value) {
  return String(value || '').trim();
}

function emojiMatches(expected, reactionEmoji) {
  const wanted = normalizeEmojiToken(expected || '⭐');
  const emojiId = reactionEmoji?.id || null;
  const emojiName = reactionEmoji?.name || null;

  if (!wanted || !emojiName) return false;

  const customEmojiForms = emojiId && emojiName
    ? new Set([
        emojiId,
        emojiName,
        `<:${emojiName}:${emojiId}>`,
        `<a:${emojiName}:${emojiId}>`,
      ])
    : new Set([emojiName]);

  if (customEmojiForms.has(wanted)) return true;
  return Boolean(emojiId && wanted.includes(`:${emojiId}>`));
}

function buildMessageUrl(guildId, channelId, messageId) {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

function isImageAttachment(attachment) {
  return Boolean(
    attachment?.url &&
    (
      attachment.contentType?.startsWith?.('image/') ||
      IMAGE_EXTENSION_PATTERN.test(attachment.url)
    )
  );
}

function buildStarboardEmbed(message, starCount, section = {}) {
  const content = message.content || '*No text content*';
  const firstAttachment = message.attachments?.find?.(isImageAttachment) || message.attachments?.first?.();
  const emoji = section.emoji || '⭐';

  const embed = new EmbedBuilder()
    .setColor('#facc15')
    .setAuthor({
      name: message.author?.tag || message.author?.username || 'Unknown User',
      iconURL: message.author?.displayAvatarURL?.() || undefined,
    })
    .setDescription(content.slice(0, 3500))
    .addFields({
      name: 'Original Message',
      value: `[Jump to message](${buildMessageUrl(message.guild.id, message.channel.id, message.id)})`,
    })
    .setFooter({ text: `${emoji} ${starCount} star${starCount === 1 ? '' : 's'}` })
    .setTimestamp(message.createdAt || new Date());

  if (isImageAttachment(firstAttachment)) embed.setImage(firstAttachment.url);
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

  if (reaction.partial) {
    const fetched = await reaction.fetch().catch((error) => {
      console.warn('[Starboard] Failed to fetch partial reaction:', error?.message || error);
      return null;
    });
    if (!fetched) return null;
  }

  if (reaction.message?.partial) {
    const fetched = await reaction.message.fetch().catch((error) => {
      console.warn('[Starboard] Failed to fetch partial message:', error?.message || error);
      return null;
    });
    if (!fetched) return null;
  }

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
    await message.guild.channels.fetch(channelId).catch((error) => {
      console.warn(`[Starboard] Failed to fetch channel ${channelId}:`, error?.message || error);
      return null;
    });

  if (!channel?.send || !channel?.messages?.fetch) return null;

  const me = message.guild.members.me;
  const permissions = me && channel.permissionsFor?.(me);
  if (!permissions) return null;

  const requiredPermissions = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.ReadMessageHistory,
  ];

  return requiredPermissions.every((permission) => permissions.has(permission)) ? channel : null;
}

function buildStarboardMessageContent(message, section, starCount) {
  const emoji = section.emoji || '⭐';
  return `${emoji} **${starCount}** <#${message.channel.id}>`;
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

async function upsertStarboardPost(message, section, starUserIds) {
  const starboardChannel = await resolveStarboardChannel(message, section);
  if (!starboardChannel) {
    console.warn(`[Starboard] Destination channel unavailable for guild ${message.guild.id}.`);
    return null;
  }

  const existing = starboardStore.getPost(message.guild.id, message.id);
  const embed = buildStarboardEmbed(message, starUserIds.length, section);
  const content = buildStarboardMessageContent(message, section, starUserIds.length);

  if (existing?.starboardMessageId) {
    const starboardMessage = await starboardChannel.messages.fetch(existing.starboardMessageId).catch(() => null);
    if (starboardMessage?.editable) {
      const edited = await starboardMessage.edit({ content, embeds: [embed] }).catch((error) => {
        console.error(`[Starboard] Failed to update post ${existing.starboardMessageId}:`, error?.message || error);
        return null;
      });

      if (edited) {
        return starboardStore.savePost(message.guild.id, {
          ...existing,
          starUserIds,
          channelId: message.channel.id,
          authorId: message.author?.id,
        });
      }
      return null;
    }
  }

  const sent = await starboardChannel.send({ content, embeds: [embed] }).catch((error) => {
    console.error(`[Starboard] Failed to create post for ${message.id}:`, error?.message || error);
    return null;
  });

  if (!sent) return null;
  return starboardStore.savePost(message.guild.id, buildPostPayload(message, sent, starUserIds));
}

async function removeStarboardPost(message, section) {
  const existing = starboardStore.getPost(message.guild.id, message.id);
  if (!existing?.starboardMessageId) return null;

  const starboardChannel = await resolveStarboardChannel(message, section);
  if (!starboardChannel) return null;

  const starboardMessage = await starboardChannel.messages.fetch(existing.starboardMessageId).catch(() => null);
  if (starboardMessage) {
    if (!starboardMessage.deletable) return null;
    const deleted = await starboardMessage.delete().then(() => true).catch((error) => {
      console.error(`[Starboard] Failed to delete post ${existing.starboardMessageId}:`, error?.message || error);
      return false;
    });
    if (!deleted) return null;
  }

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

async function processStarReaction(reaction, user, removing = false) {
  if (user?.bot) return null;

  const message = await fetchMessageFromReaction(reaction);
  const guild = message?.guild;
  if (!guild?.id || !message?.id || !moduleEnabled(guild.id)) return null;

  return withMessageLock(guild.id, message.id, async () => {
    if (!moduleEnabled(guild.id)) return null;

    const section = starboardStore.getStarboardSection(guild.id);
    if (section.enabled === false || !section.channelId) return null;
    if (!emojiMatches(section.emoji, reaction.emoji)) return null;
    if (!section.allowBotMessages && message.author?.bot) return null;
    if (message.channel?.id === section.channelId) return null;

    const existing = starboardStore.getPost(guild.id, message.id);
    if (removing && !existing) return null;

    const starUserIds = await getStarUsers(reaction, message, section);
    const threshold = Math.max(1, Number(section.threshold) || 1);

    if (starUserIds.length < threshold) {
      return existing ? removeStarboardPost(message, section) : null;
    }

    return upsertStarboardPost(message, section, starUserIds);
  });
}

async function handleStarReactionAdd(reaction, user) {
  return processStarReaction(reaction, user, false);
}

async function handleStarReactionRemove(reaction, user) {
  return processStarReaction(reaction, user, true);
}

function configureStarboard(guildId, input = {}) {
  if (!guildId) throw new Error('A guild ID is required.');

  const hasEnabledInput = Object.prototype.hasOwnProperty.call(input, 'enabled');
  const requestedEnabled = hasEnabledInput ? input.enabled === true : undefined;
  const currentlyEnabled = moduleEnabled(guildId);

  if (!currentlyEnabled && requestedEnabled !== true) {
    throw new Error('Starboard module is disabled for this server.');
  }

  if (hasEnabledInput) setModuleEnabled(guildId, 'starboard', requestedEnabled);

  return starboardStore.updateStarboardSection(guildId, (section) => ({
    ...section,
    enabled: hasEnabledInput ? requestedEnabled : section.enabled,
    channelId: input.channelId ?? section.channelId,
    threshold: input.threshold ?? section.threshold,
    emoji: input.emoji ?? section.emoji,
    allowBotMessages: input.allowBotMessages ?? section.allowBotMessages,
    allowSelfStar: input.allowSelfStar ?? section.allowSelfStar,
    updatedAt: starboardStore.now(),
  }));
}

module.exports = {
  canManageStarboard,
  buildStarboardEmbed,
  configureStarboard,
  handleStarReactionAdd,
  handleStarReactionRemove,
};