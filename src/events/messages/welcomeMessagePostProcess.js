'use strict';

const welcomeManager = require('../../modules/welcome/welcome');

const MAX_TRACKED_MESSAGES = 1000;

function embedData(embed) {
  return embed?.toJSON ? embed.toJSON() : JSON.parse(JSON.stringify(embed || {}));
}

function searchableMessage(message) {
  return `${message.content || ''} ${JSON.stringify((message.embeds || []).map(embedData))}`;
}

function replacePlainMention(embed, username, userId) {
  const data = embedData(embed);
  const plain = `@${username}`;
  const clickable = `<@${userId}>`;
  const escaped = plain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let changed = false;

  const replace = (value) => {
    if (typeof value !== 'string' || !value.toLowerCase().includes(plain.toLowerCase())) return value;
    changed = true;
    return value.replace(new RegExp(escaped, 'gi'), clickable);
  };

  data.title = replace(data.title);
  data.description = replace(data.description);
  if (data.author) data.author.name = replace(data.author.name);
  if (data.footer) data.footer.text = replace(data.footer.text);
  if (Array.isArray(data.fields)) {
    data.fields = data.fields.map((field) => ({
      ...field,
      name: replace(field.name),
      value: replace(field.value),
    }));
  }

  return { data, changed };
}

function findMember(message) {
  const searchable = searchableMessage(message);
  const mentionId = searchable.match(/<@(\d{15,25})>/)?.[1];
  if (mentionId) return message.guild.members.cache.get(mentionId) || null;

  const lower = searchable.toLowerCase();
  return message.guild.members.cache.find((member) => {
    const username = String(member.user?.username || '').trim().toLowerCase();
    return username && lower.includes(`@${username}`);
  }) || null;
}

function currentAvatarUrl(message, member) {
  for (const embed of message.embeds || []) {
    const data = embedData(embed);
    const url = data.thumbnail?.url || data.image?.url || data.author?.icon_url || data.footer?.icon_url;
    if (url && /cdn\.discordapp\.com|media\.discordapp\.net/i.test(url)) return url;
  }
  return member.displayAvatarURL({ extension: 'png', size: 256 });
}

function saveTracking(message, member) {
  welcomeManager.updateWelcomeSection(message.guild.id, (section) => {
    const records = Array.isArray(section.avatarSyncMessages) ? section.avatarSyncMessages : [];
    const next = records
      .filter((record) => record?.userId !== member.id && record?.messageId !== message.id)
      .slice(-(MAX_TRACKED_MESSAGES - 1));

    next.push({
      userId: member.id,
      channelId: message.channel.id,
      messageId: message.id,
      avatarUrl: currentAvatarUrl(message, member),
      createdAt: new Date(message.createdTimestamp || Date.now()).toISOString(),
      updatedAt: new Date().toISOString(),
    });

    return { ...section, avatarSyncMessages: next, updatedAt: new Date().toISOString() };
  }, { action: 'welcome_message_postprocess_track' });
}

module.exports = {
  name: 'messageCreate',
  async execute(message) {
    if (!message?.guild?.id || !message.author?.bot) return;
    if (message.author.id !== message.client.user?.id) return;

    const config = welcomeManager.getWelcomeSection(message.guild.id);
    if (!config.channelId || message.channel.id !== config.channelId) return;
    if (!message.embeds?.length) return;

    const member = findMember(message);
    if (!member || member.user?.bot) return;

    let changed = false;
    const embeds = message.embeds.map((embed) => {
      const result = replacePlainMention(embed, member.user.username, member.id);
      changed ||= result.changed;
      return result.data;
    });

    if (changed) {
      await message.edit({ embeds }).catch((error) => {
        console.warn('[Welcome] Failed to make embedded username clickable:', error.message || error);
      });
    }

    saveTracking(message, member);
    console.info(`[Welcome] Post-processed and tracked message ${message.id} for ${member.id} in ${message.guild.id}.`);
  },
};
