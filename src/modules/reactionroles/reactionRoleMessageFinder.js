'use strict';

const cleanId = (value) => {
  const id = String(value || '').replace(/[<@&#!>]/g, '').trim();
  return /^\d{15,25}$/.test(id) ? id : null;
};

const cleanText = (value, max = 200) => String(value ?? '').trim().slice(0, max);

function serializeEmbed(embed) {
  if (!embed) return null;
  const data = embed.toJSON?.() || embed.data || embed;
  return {
    title: cleanText(data.title, 256),
    description: cleanText(data.description, 2000),
    url: data.url || null,
    color: Number.isFinite(data.color) ? data.color : null,
    author: data.author ? {
      name: cleanText(data.author.name, 256),
      iconURL: data.author.icon_url || data.author.iconURL || null,
    } : null,
    footer: data.footer ? {
      text: cleanText(data.footer.text, 512),
      iconURL: data.footer.icon_url || data.footer.iconURL || null,
    } : null,
    thumbnailURL: data.thumbnail?.url || data.thumbnailURL || null,
    imageURL: data.image?.url || data.imageURL || null,
    fields: Array.isArray(data.fields)
      ? data.fields.slice(0, 12).map((field) => ({
        name: cleanText(field.name, 256),
        value: cleanText(field.value, 1000),
        inline: field.inline === true,
      }))
      : [],
  };
}

function serializeMessage(message) {
  const embeds = (message.embeds || []).slice(0, 3).map(serializeEmbed).filter(Boolean);
  const reactions = [...(message.reactions?.cache?.values?.() || [])].slice(0, 20).map((reaction) => ({
    emoji: reaction.emoji?.toString?.() || reaction.emoji?.name || reaction.emoji?.id || '❔',
    count: Number(reaction.count || 0),
    me: reaction.me === true,
  }));
  return {
    id: message.id,
    channelId: message.channelId,
    channelName: message.channel?.name || null,
    authorId: message.author?.id || null,
    authorName: message.member?.displayName || message.author?.globalName || message.author?.username || 'Unknown',
    authorAvatar: message.author?.displayAvatarURL?.({ extension: 'png', size: 128 }) || null,
    bot: message.author?.bot === true,
    pinned: message.pinned === true,
    createdAt: message.createdAt?.toISOString?.() || null,
    editedAt: message.editedAt?.toISOString?.() || null,
    content: cleanText(message.content, 2000),
    hasEmbeds: embeds.length > 0,
    embedCount: message.embeds?.length || 0,
    embedTitle: embeds[0]?.title || '',
    embedDescription: embeds[0]?.description || '',
    embeds,
    reactions,
    reactionCount: reactions.reduce((total, reaction) => total + reaction.count, 0),
    jumpUrl: message.url,
  };
}

function messageMatches(message, options) {
  if (options.authorId && message.author?.id !== options.authorId) return false;
  if (options.botsOnly && message.author?.bot !== true) return false;
  if (options.embedsOnly && !message.embeds?.length) return false;
  if (options.pinnedOnly && message.pinned !== true) return false;
  if (!options.query) return true;
  const haystack = [
    message.content,
    message.author?.username,
    message.author?.globalName,
    message.member?.displayName,
    ...(message.embeds || []).flatMap((embed) => [embed.title, embed.description, ...(embed.fields || []).flatMap((field) => [field.name, field.value])]),
  ].filter(Boolean).join('\n').toLowerCase();
  return haystack.includes(options.query.toLowerCase());
}

async function fetchChannelMessages(channel, options) {
  if (!channel?.messages?.fetch || !channel.isTextBased?.()) return [];
  const collected = [];
  let before;
  const target = Math.min(Math.max(Number(options.scanLimit || 100), 1), 500);
  while (collected.length < target) {
    const batch = await channel.messages.fetch({ limit: Math.min(100, target - collected.length), before }).catch(() => null);
    if (!batch?.size) break;
    collected.push(...batch.values());
    before = batch.last()?.id;
    if (batch.size < 100) break;
  }
  return collected;
}

async function searchGuildMessages(guild, input = {}) {
  if (!guild?.channels) throw new Error('Guild is required.');
  const options = {
    channelId: cleanId(input.channelId),
    messageId: cleanId(input.messageId),
    authorId: cleanId(input.authorId),
    query: cleanText(input.query, 200),
    botsOnly: input.botsOnly === true || input.botsOnly === 'true',
    embedsOnly: input.embedsOnly === true || input.embedsOnly === 'true',
    pinnedOnly: input.pinnedOnly === true || input.pinnedOnly === 'true',
    scanLimit: Math.min(Math.max(Number(input.scanLimit || 100), 1), 500),
    resultLimit: Math.min(Math.max(Number(input.resultLimit || 25), 1), 100),
  };

  if (options.messageId) {
    const channels = options.channelId
      ? [guild.channels.cache.get(options.channelId) || await guild.channels.fetch(options.channelId).catch(() => null)]
      : [...guild.channels.cache.values()].filter((channel) => channel?.messages?.fetch);
    for (const channel of channels.filter(Boolean)) {
      const message = await channel.messages.fetch(options.messageId).catch(() => null);
      if (message && messageMatches(message, options)) return { messages: [serializeMessage(message)], scannedChannels: 1, exact: true };
    }
    return { messages: [], scannedChannels: channels.length, exact: true };
  }

  const channels = options.channelId
    ? [guild.channels.cache.get(options.channelId) || await guild.channels.fetch(options.channelId).catch(() => null)]
    : [...guild.channels.cache.values()].filter((channel) => channel?.messages?.fetch && channel.isTextBased?.());

  const found = [];
  let scannedChannels = 0;
  for (const channel of channels.filter(Boolean)) {
    scannedChannels += 1;
    const messages = await fetchChannelMessages(channel, options);
    for (const message of messages) {
      if (messageMatches(message, options)) found.push(message);
    }
  }

  found.sort((a, b) => Number(b.createdTimestamp || 0) - Number(a.createdTimestamp || 0));
  return {
    messages: found.slice(0, options.resultLimit).map(serializeMessage),
    scannedChannels,
    exact: false,
  };
}

module.exports = { searchGuildMessages, serializeMessage };