'use strict';

// src/core/guild/discordResourceManager.js

const {
  getGuildSection,
  updateGuildSection,
} = require('./guildManager');

const DISCORD_RESOURCE_FALLBACK = Object.freeze({
  lastSync: null,
  guild: null,
  channels: [],
  categories: [],
  roles: [],
  emojis: [],
});

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value, maxLength = 500) {
  return String(value || '').trim().slice(0, maxLength);
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nonNegativeInteger(value, fallback = 0) {
  return Math.max(0, Math.trunc(finiteNumber(value, fallback)));
}

function toArray(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return [...collection.values()];
  if (collection.cache && typeof collection.cache.values === 'function') return [...collection.cache.values()];
  return [];
}

function sortByPositionThenName(a, b) {
  const positionA = finiteNumber(a.position);
  const positionB = finiteNumber(b.position);

  if (positionA !== positionB) return positionA - positionB;
  return String(a.name || '').localeCompare(String(b.name || ''));
}

function normalizeGuild(guild) {
  if (!guild) return null;

  return {
    id: guild.id,
    name: cleanString(guild.name, 120),
    icon: guild.icon || null,
    banner: guild.banner || null,
    description: cleanString(guild.description, 500) || null,
    ownerId: guild.ownerId || null,
    memberCount: nonNegativeInteger(guild.memberCount),
    preferredLocale: guild.preferredLocale || null,
    premiumTier: nonNegativeInteger(guild.premiumTier),
  };
}

function normalizeChannel(channel) {
  return {
    id: channel.id,
    name: cleanString(channel.name, 120),
    type: channel.type,
    parentId: channel.parentId || null,
    position: finiteNumber(channel.rawPosition ?? channel.position ?? 0),
    manageable: Boolean(channel.manageable),
    viewable: channel.viewable !== false,
  };
}

function normalizeRole(role) {
  return {
    id: role.id,
    name: cleanString(role.name, 120),
    color: role.hexColor || null,
    position: finiteNumber(role.rawPosition ?? role.position ?? 0),
    managed: Boolean(role.managed),
    mentionable: Boolean(role.mentionable),
    hoist: Boolean(role.hoist),
  };
}

function normalizeEmoji(emoji) {
  return {
    id: emoji.id,
    name: cleanString(emoji.name, 120),
    animated: Boolean(emoji.animated),
    available: emoji.available !== false,
    managed: Boolean(emoji.managed),
    requiresColons: emoji.requiresColons !== false,
  };
}

function buildDiscordResourceSnapshot(guild) {
  const channels = toArray(guild?.channels?.cache)
    .map(normalizeChannel)
    .sort(sortByPositionThenName);

  const categories = channels
    .filter((channel) => channel.type === 4)
    .sort(sortByPositionThenName);

  const textAndVoiceChannels = channels
    .filter((channel) => channel.type !== 4)
    .sort(sortByPositionThenName);

  const roles = toArray(guild?.roles?.cache)
    .map(normalizeRole)
    .sort(sortByPositionThenName);

  const emojis = toArray(guild?.emojis?.cache)
    .map(normalizeEmoji)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

  return {
    lastSync: new Date().toISOString(),
    guild: normalizeGuild(guild),
    channels: textAndVoiceChannels,
    categories,
    roles,
    emojis,
  };
}

function normalizeDiscordResourceSection(section = {}) {
  const source = isPlainObject(section) ? section : {};

  return {
    ...clone(DISCORD_RESOURCE_FALLBACK),
    ...clone(source),
    guild: isPlainObject(source.guild) ? clone(source.guild) : null,
    channels: Array.isArray(source.channels) ? clone(source.channels) : [],
    categories: Array.isArray(source.categories) ? clone(source.categories) : [],
    roles: Array.isArray(source.roles) ? clone(source.roles) : [],
    emojis: Array.isArray(source.emojis) ? clone(source.emojis) : [],
  };
}

function getDiscordResources(guildId) {
  return normalizeDiscordResourceSection(
    getGuildSection(guildId, 'discord', DISCORD_RESOURCE_FALLBACK)
  );
}

function saveDiscordResources(guildId, resources = {}, guildOrMeta = {}) {
  const nextResources = normalizeDiscordResourceSection(resources);

  return normalizeDiscordResourceSection(
    updateGuildSection(
      guildId,
      'discord',
      () => nextResources,
      DISCORD_RESOURCE_FALLBACK,
      guildOrMeta
    )
  );
}

async function syncDiscordResources(guild) {
  if (!guild?.id) {
    throw new Error('Cannot sync Discord resources without a guild.');
  }

  if (typeof guild.fetch === 'function') {
    await guild.fetch();
  }

  if (typeof guild.channels?.fetch === 'function') {
    await guild.channels.fetch();
  }

  if (typeof guild.roles?.fetch === 'function') {
    await guild.roles.fetch();
  }

  if (typeof guild.emojis?.fetch === 'function') {
    await guild.emojis.fetch();
  }

  const snapshot = buildDiscordResourceSnapshot(guild);
  return saveDiscordResources(guild.id, snapshot, guild);
}

module.exports = {
  getDiscordResources,
  syncDiscordResources,
};
