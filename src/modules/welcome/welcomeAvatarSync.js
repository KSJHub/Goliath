'use strict';

const MAX_TRACKED_MESSAGES = 1000;
const MAX_RECORD_AGE_MS = 365 * 24 * 60 * 60 * 1000;

function cleanRecords(value) {
  const cutoff = Date.now() - MAX_RECORD_AGE_MS;
  const records = Array.isArray(value) ? value : [];
  return records
    .filter((record) => record && record.userId && record.channelId && record.messageId)
    .filter((record) => !record.createdAt || Date.parse(record.createdAt) >= cutoff)
    .slice(-MAX_TRACKED_MESSAGES);
}

function normalizeUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return `${url.hostname}${url.pathname}`.toLowerCase();
  } catch {
    return String(value || '').split('?')[0].toLowerCase();
  }
}

function isTrackedAvatarUrl(url, userId, previousAvatarUrl) {
  const normalized = normalizeUrl(url);
  if (!normalized) return false;
  if (previousAvatarUrl && normalized === normalizeUrl(previousAvatarUrl)) return true;
  return normalized.includes(`/avatars/${userId}/`)
    || normalized.includes(`/users/${userId}/avatars/`)
    || normalized.includes(`/guilds/`) && normalized.includes(`/users/${userId}/avatars/`);
}

function replaceAvatarUrls(embed, userId, previousAvatarUrl, nextAvatarUrl) {
  const data = embed?.toJSON ? embed.toJSON() : JSON.parse(JSON.stringify(embed || {}));
  let changed = false;

  const replace = (container, key) => {
    const current = container?.[key];
    if (!current || !isTrackedAvatarUrl(current, userId, previousAvatarUrl)) return;
    container[key] = nextAvatarUrl;
    changed = true;
  };

  replace(data.thumbnail, 'url');
  replace(data.image, 'url');
  replace(data.author, 'icon_url');
  replace(data.footer, 'icon_url');

  return { data, changed };
}

function replaceNoPingMentions(embed, member) {
  const data = embed?.toJSON ? embed.toJSON() : JSON.parse(JSON.stringify(embed || {}));
  const username = String(member?.user?.username || '').trim();
  const userId = member?.user?.id;
  if (!username || !userId) return { data, changed: false };

  const plainMention = `@${username}`;
  const clickableMention = `<@${userId}>`;
  let changed = false;

  const replaceText = (value) => {
    if (typeof value !== 'string' || !value.includes(plainMention)) return value;
    changed = true;
    return value.split(plainMention).join(clickableMention);
  };

  data.title = replaceText(data.title);
  data.description = replaceText(data.description);
  if (data.author) data.author.name = replaceText(data.author.name);
  if (data.footer) data.footer.text = replaceText(data.footer.text);
  if (Array.isArray(data.fields)) {
    data.fields = data.fields.map((field) => ({
      ...field,
      name: replaceText(field.name),
      value: replaceText(field.value),
    }));
  }

  return { data, changed };
}

function getRecords(welcomeManager, guildId) {
  const config = welcomeManager.getWelcomeSection(guildId);
  return cleanRecords(config.avatarSyncMessages);
}

function saveRecords(welcomeManager, guildId, records, action) {
  return welcomeManager.updateWelcomeSection(guildId, (section) => ({
    ...section,
    avatarSyncMessages: cleanRecords(records),
    updatedAt: new Date().toISOString(),
  }), { action });
}

async function trackLatestWelcomeMessage(member, welcomeManager, sentAfter = Date.now() - 15000) {
  if (!member?.guild?.id || !member?.user?.id) return null;

  const config = welcomeManager.getWelcomeSection(member.guild.id);
  if (!config.channelId) return null;

  const channel = await welcomeManager.resolveWelcomeChannel(member.guild, config.channelId);
  if (!channel?.messages?.fetch) return null;

  const records = getRecords(welcomeManager, member.guild.id);
  const claimedIds = new Set(records.map((record) => record.messageId));
  const messages = await channel.messages.fetch({ limit: 10 }).catch(() => null);
  if (!messages?.size) return null;

  const botId = member.client?.user?.id;
  const candidates = [...messages.values()]
    .filter((message) => message.author?.id === botId)
    .filter((message) => message.createdTimestamp >= sentAfter - 5000)
    .filter((message) => !claimedIds.has(message.id))
    .map((message) => {
      const searchable = `${message.content || ''} ${JSON.stringify(message.embeds?.map((embed) => embed.toJSON?.() || embed) || [])}`;
      return {
        message,
        score: searchable.includes(member.user.id) ? 2 : 1,
      };
    })
    .sort((a, b) => b.score - a.score || b.message.createdTimestamp - a.message.createdTimestamp);

  const selected = candidates[0]?.message;
  if (!selected) return null;

  let mentionChanged = false;
  const mentionEmbeds = selected.embeds.map((embed) => {
    const result = replaceNoPingMentions(embed, member);
    mentionChanged ||= result.changed;
    return result.data;
  });

  if (mentionChanged) {
    await selected.edit({ embeds: mentionEmbeds }).catch((error) => {
      console.warn('[Welcome] Failed to convert welcome username to clickable mention:', error.message || error);
    });
  }

  const nextRecords = records.filter((record) => record.userId !== member.user.id);
  nextRecords.push({
    userId: member.user.id,
    channelId: channel.id,
    messageId: selected.id,
    avatarUrl: member.displayAvatarURL({ extension: 'png', size: 256 }),
    createdAt: new Date(selected.createdTimestamp || Date.now()).toISOString(),
    updatedAt: new Date().toISOString(),
  });

  saveRecords(welcomeManager, member.guild.id, nextRecords, 'welcome_avatar_sync_track');
  return selected.id;
}

async function syncTrackedWelcomeForGuild(guild, userId, nextAvatarUrl, welcomeManager) {
  if (!guild?.id || !userId || !nextAvatarUrl) return { updated: 0, removed: 0 };

  const records = getRecords(welcomeManager, guild.id);
  const record = records.find((item) => item.userId === userId);
  if (!record) return { updated: 0, removed: 0 };

  if (normalizeUrl(record.avatarUrl) === normalizeUrl(nextAvatarUrl)) {
    return { updated: 0, removed: 0 };
  }

  const channel = guild.channels.cache.get(record.channelId)
    || await guild.channels.fetch(record.channelId).catch(() => null);
  if (!channel?.messages?.fetch) {
    saveRecords(welcomeManager, guild.id, records.filter((item) => item !== record), 'welcome_avatar_sync_cleanup');
    return { updated: 0, removed: 1 };
  }

  const message = await channel.messages.fetch(record.messageId).catch(() => null);
  if (!message) {
    saveRecords(welcomeManager, guild.id, records.filter((item) => item !== record), 'welcome_avatar_sync_cleanup');
    return { updated: 0, removed: 1 };
  }

  let changed = false;
  const embeds = message.embeds.map((embed) => {
    const result = replaceAvatarUrls(embed, userId, record.avatarUrl, nextAvatarUrl);
    changed ||= result.changed;
    return result.data;
  });

  if (!changed) {
    return { updated: 0, removed: 0 };
  }

  const edited = await message.edit({ embeds }).then(() => true).catch((error) => {
    console.warn('[Welcome] Failed to sync updated avatar:', error.message || error);
    return false;
  });

  if (!edited) return { updated: 0, removed: 0 };

  const nextRecords = records.map((item) => item === record
    ? { ...item, avatarUrl: nextAvatarUrl, updatedAt: new Date().toISOString() }
    : item);
  saveRecords(welcomeManager, guild.id, nextRecords, 'welcome_avatar_sync_update');

  return { updated: 1, removed: 0 };
}

async function handleUserAvatarUpdate(oldUser, newUser, welcomeManager) {
  if (!oldUser || !newUser || oldUser.avatar === newUser.avatar) return { updated: 0, removed: 0 };

  let updated = 0;
  let removed = 0;

  for (const guild of newUser.client.guilds.cache.values()) {
    const member = guild.members.cache.get(newUser.id)
      || await guild.members.fetch(newUser.id).catch(() => null);
    if (!member) continue;

    const nextAvatarUrl = member.displayAvatarURL({ extension: 'png', size: 256 });
    const result = await syncTrackedWelcomeForGuild(guild, newUser.id, nextAvatarUrl, welcomeManager);
    updated += result.updated;
    removed += result.removed;
  }

  return { updated, removed };
}

async function handleGuildMemberAvatarUpdate(oldMember, newMember, welcomeManager) {
  if (!oldMember?.guild?.id || !newMember?.guild?.id || !newMember?.user?.id) {
    return { updated: 0, removed: 0 };
  }

  const oldAvatarUrl = oldMember.displayAvatarURL?.({ extension: 'png', size: 256 }) || '';
  const nextAvatarUrl = newMember.displayAvatarURL?.({ extension: 'png', size: 256 }) || '';
  if (!nextAvatarUrl || normalizeUrl(oldAvatarUrl) === normalizeUrl(nextAvatarUrl)) {
    return { updated: 0, removed: 0 };
  }

  return syncTrackedWelcomeForGuild(
    newMember.guild,
    newMember.user.id,
    nextAvatarUrl,
    welcomeManager
  );
}

module.exports = {
  trackLatestWelcomeMessage,
  handleUserAvatarUpdate,
  handleGuildMemberAvatarUpdate,
  syncTrackedWelcomeForGuild,
  replaceAvatarUrls,
  replaceNoPingMentions,
};
