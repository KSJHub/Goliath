'use strict';

const guildManager = require('../guild/guildManager');

const DEFAULT_PREFIX = guildManager.DEFAULT_GENERAL_SETTINGS.prefix;
const MIN_PREFIX_LENGTH = 1;
const MAX_PREFIX_LENGTH = 5;

function normalizePrefix(value, fallback = DEFAULT_PREFIX) {
  const raw = String(value ?? '').trim();
  const prefix = raw || fallback;

  if (/\s/.test(prefix)) {
    throw new Error('Prefix cannot contain spaces.');
  }

  if (prefix.length < MIN_PREFIX_LENGTH || prefix.length > MAX_PREFIX_LENGTH) {
    throw new Error(`Prefix must be ${MIN_PREFIX_LENGTH}-${MAX_PREFIX_LENGTH} characters.`);
  }

  if (/^[A-Za-z0-9]$/.test(prefix)) {
    throw new Error('Prefix must use a symbol or more than one character.');
  }

  return prefix;
}

function getGeneralSettings(guildId) {
  return guildManager.getGuildSection(
    guildId,
    'generalSettings',
    guildManager.DEFAULT_GENERAL_SETTINGS
  );
}

function getGuildPrefix(guildId) {
  const storedPrefix = String(getGeneralSettings(guildId).prefix || '').trim();

  try {
    return normalizePrefix(storedPrefix, DEFAULT_PREFIX);
  } catch {
    return DEFAULT_PREFIX;
  }
}

function setGuildPrefix(guildId, prefix, guildOrMeta = {}) {
  const safePrefix = normalizePrefix(prefix);

  guildManager.updateGuildSection(
    guildId,
    'generalSettings',
    (settings = {}) => ({
      ...settings,
      prefix: safePrefix,
    }),
    guildManager.DEFAULT_GENERAL_SETTINGS,
    guildOrMeta
  );

  return safePrefix;
}

function resetGuildPrefix(guildId, guildOrMeta = {}) {
  return setGuildPrefix(guildId, DEFAULT_PREFIX, guildOrMeta);
}

function getMentionPrefixes(client) {
  if (!client?.user?.id) return [];
  return [`<@${client.user.id}>`, `<@!${client.user.id}>`];
}

function getPrefixInfo(guildId) {
  const prefix = getGuildPrefix(guildId);

  return {
    prefix,
    defaultPrefix: DEFAULT_PREFIX,
    isDefault: prefix === DEFAULT_PREFIX,
  };
}

module.exports = {
  DEFAULT_PREFIX,
  normalizePrefix,
  getGuildPrefix,
  setGuildPrefix,
  resetGuildPrefix,
  getMentionPrefixes,
  getPrefixInfo,
};
