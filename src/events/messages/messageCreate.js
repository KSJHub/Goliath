'use strict';

const { Events } = require('discord.js');
const { handleStickyMessage } = require('../../modules/messageStudio/sticky/stickyManager');
const translationThreadManager = require('../../modules/utilityStudio/translation/translationThreadManager');
const statsManager = require('../../modules/utilityStudio/stats/statsManager');
const levelingTracking = require('../../modules/communityStudio/leveling/levelingTracking');
const emojis = require('../../modules/utilityStudio/emojis/emojis');
const guildManager = require('../../core/guild/guildManager');
const { handleAutoMod } = require('../../core/administration/automod/events');

const EMOJI_SHORTCODE_PATTERN = /:([a-zA-Z0-9_\-]{2,32}):/;

async function runHandler(label, handler, ...args) {
  try {
    return await handler(...args);
  } catch (error) {
    console.error(`[MessageCreate] ${label} handler failed:`, error?.stack || error?.message || error);
    return null;
  }
}

function hasUserMedia(message) {
  return Boolean(
    message?.attachments?.size
    || message?.stickers?.size
    || message?.embeds?.length,
  );
}

async function postResolvedEmojiMessage(message, resolved, { deleteSource = true } = {}) {
  await message.channel.send({
    content: resolved,
    allowedMentions: { parse: [] },
  });

  if (deleteSource && !hasUserMedia(message)) {
    await message.delete().catch(() => null);
  }
}

async function handleEmojiMessage(message, client) {
  const source = String(message.content || '');
  if (!source) return false;

  const legacyMatch = source.match(/^\/e\s+message\s+([\s\S]+)$/i);
  if (legacyMatch) {
    const text = String(legacyMatch[1] || '').trim();
    if (!text) return false;

    const resolved = await emojis.resolveText(
      client,
      message.guild.id,
      text,
      'member_typed_emoji_message',
    );

    if (resolved === text) {
      await message.reply({
        content: 'No available Emoji Studio shortcodes were found. Try `:discord:`, `:youtube:` or `:twitch:`.',
        allowedMentions: { parse: [], repliedUser: false },
      });
      return true;
    }

    await postResolvedEmojiMessage(message, resolved);
    return true;
  }

  // Fast-path ordinary messages so we do not fetch the application emoji bank
  // unless the message actually contains something shaped like a shortcode.
  if (!EMOJI_SHORTCODE_PATTERN.test(source)) return false;

  const resolved = await emojis.resolveText(
    client,
    message.guild.id,
    source,
    'member_message_auto_convert',
  );

  // Unknown/unavailable shortcodes remain untouched and normal message
  // processing continues.
  if (resolved === source) return false;

  // Discord bots cannot edit another member's message. Repost the resolved
  // content and remove the source when it is safe to do so. Messages carrying
  // attachments, stickers or embeds are preserved to avoid deleting media.
  await postResolvedEmojiMessage(message, resolved, { deleteSource: !hasUserMedia(message) });
  return true;
}

module.exports = {
  name: Events.MessageCreate,

  async execute(message, client) {
    if (!message.guild || !message.member || message.author?.bot) return;

    const autoModHandled = await runHandler('AutoMod', handleAutoMod, message);
    if (autoModHandled) return;

    const emojiMessageHandled = await runHandler('EmojiMessage', handleEmojiMessage, message, client);
    if (emojiMessageHandled) return;

    await runHandler('Stats', statsManager.handleMessageCreate, message);
    await runHandler('Leveling', levelingTracking.handleMessageCreate, message);

    if (message.content && guildManager.isModuleEnabled(message.guild.id, 'translation')) {
      await runHandler('Translation', translationThreadManager.handleMessageCreate, message, client);
    }

    await runHandler('Sticky', handleStickyMessage, message, client);
  },
};
