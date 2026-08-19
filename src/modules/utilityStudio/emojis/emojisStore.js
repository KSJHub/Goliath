'use strict';

const guildManager = require('../../../core/guild/guildManager');

const MAX_GUILD_EMOJIS = 100;

function uniqueIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter((value) => /^\d{16,20}$/.test(value)))];
}

function getSection(guildId) {
  const modules = guildManager.getGuildSection(guildId, 'modules', {});
  const section = modules.emojis && typeof modules.emojis === 'object' ? modules.emojis : {};
  return {
    enabled: section.enabled === true,
    favourites: uniqueIds(section.favourites).slice(0, MAX_GUILD_EMOJIS),
  };
}

function saveSection(guildId, patch = {}, guildOrMeta = {}) {
  const current = getSection(guildId);
  const next = {
    ...current,
    ...patch,
    favourites: uniqueIds(patch.favourites ?? current.favourites).slice(0, MAX_GUILD_EMOJIS),
  };

  guildManager.updateGuildSection(guildId, 'modules', (modules) => ({
    ...modules,
    emojis: next,
  }), {}, guildOrMeta);

  return next;
}

function setFavourite(guildId, emojiId, selected, guildOrMeta = {}) {
  const id = String(emojiId || '').trim();
  if (!/^\d{16,20}$/.test(id)) throw new Error('Invalid application emoji ID.');
  const current = getSection(guildId);
  const favourites = new Set(current.favourites);
  if (selected) {
    if (!favourites.has(id) && favourites.size >= MAX_GUILD_EMOJIS) throw new Error(`This server already has ${MAX_GUILD_EMOJIS} selected Goliath emojis.`);
    favourites.add(id);
  } else {
    favourites.delete(id);
  }
  return saveSection(guildId, { favourites: [...favourites] }, guildOrMeta);
}

module.exports = { MAX_GUILD_EMOJIS, getSection, saveSection, setFavourite };
