'use strict';

const guildManager = require('../../../core/guild/guildManager');

const MAX_GUILD_EMOJIS = 100;
const MAX_ALIASES = 200;
const MAX_PACKS = 50;
const MAX_RECENT = 25;
const MAX_USAGE_CONTEXTS = 50;
const USAGE_FLUSH_MS = 2000;
const pendingUsage = new Map();

function uniqueIds(values, max = Number.MAX_SAFE_INTEGER) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter((value) => /^\d{16,20}$/.test(value)))].slice(0, max);
}

function cleanKey(value, max = 32) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_\-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, max);
}

function cleanLabel(value, max = 80) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function cleanIso(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normaliseAliases(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output = {};
  for (const [rawAlias, rawId] of Object.entries(value)) {
    const alias = cleanKey(rawAlias);
    const id = String(rawId || '').trim();
    if (!alias || !/^\d{16,20}$/.test(id) || Object.keys(output).length >= MAX_ALIASES) continue;
    output[alias] = id;
  }
  return output;
}

function normaliseTagMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output = {};
  for (const [rawId, rawTags] of Object.entries(value)) {
    const id = String(rawId || '').trim();
    if (!/^\d{16,20}$/.test(id)) continue;
    const tags = [...new Set((Array.isArray(rawTags) ? rawTags : []).map((tag) => cleanKey(tag, 24)).filter(Boolean))].slice(0, 20);
    if (tags.length) output[id] = tags;
  }
  return output;
}

function normalisePacks(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output = {};
  for (const [rawKey, rawPack] of Object.entries(value)) {
    if (!rawPack || typeof rawPack !== 'object' || Array.isArray(rawPack) || Object.keys(output).length >= MAX_PACKS) continue;
    const key = cleanKey(rawKey, 40);
    if (!key) continue;
    output[key] = {
      name: cleanLabel(rawPack.name || key, 80) || key,
      emojiIds: uniqueIds(rawPack.emojiIds, MAX_GUILD_EMOJIS),
      tags: [...new Set((Array.isArray(rawPack.tags) ? rawPack.tags : []).map((tag) => cleanKey(tag, 24)).filter(Boolean))].slice(0, 20),
      enabled: rawPack.enabled === true,
      startAt: cleanIso(rawPack.startAt),
      endAt: cleanIso(rawPack.endAt),
      temporary: rawPack.temporary === true,
    };
  }
  return output;
}

function normaliseRecent(value) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => ({
      id: String(entry?.id || '').trim(),
      at: cleanIso(entry?.at) || new Date(0).toISOString(),
    }))
    .filter((entry) => /^\d{16,20}$/.test(entry.id))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .filter((entry, index, all) => all.findIndex((candidate) => candidate.id === entry.id) === index)
    .slice(0, MAX_RECENT);
}

function normaliseUsage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output = {};
  for (const [rawId, rawEntry] of Object.entries(value)) {
    const id = String(rawId || '').trim();
    if (!/^\d{16,20}$/.test(id) || !rawEntry || typeof rawEntry !== 'object') continue;
    const contexts = {};
    const rawContexts = rawEntry.contexts && typeof rawEntry.contexts === 'object' ? rawEntry.contexts : {};
    for (const [rawContext, rawCount] of Object.entries(rawContexts).slice(0, MAX_USAGE_CONTEXTS)) {
      const context = cleanKey(rawContext, 60);
      const count = Math.max(0, Number(rawCount) || 0);
      if (context && count) contexts[context] = count;
    }
    output[id] = {
      count: Math.max(0, Number(rawEntry.count) || 0),
      lastUsedAt: cleanIso(rawEntry.lastUsedAt),
      contexts,
    };
  }
  return output;
}

function normaliseTemporary(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output = {};
  for (const [rawId, rawEntry] of Object.entries(value)) {
    const id = String(rawId || '').trim();
    if (!/^\d{16,20}$/.test(id)) continue;
    const expiresAt = cleanIso(rawEntry?.expiresAt || rawEntry);
    if (!expiresAt) continue;
    output[id] = { expiresAt, removeWhenUnused: rawEntry?.removeWhenUnused !== false };
  }
  return output;
}

function normalisePolicies(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const moduleAllow = {};
  const moduleBlock = {};
  for (const [target, destination] of [['moduleAllow', moduleAllow], ['moduleBlock', moduleBlock]]) {
    const raw = source[target] && typeof source[target] === 'object' ? source[target] : {};
    for (const [moduleName, ids] of Object.entries(raw)) {
      const key = cleanKey(moduleName, 60);
      if (key) destination[key] = uniqueIds(ids, 500);
    }
  }
  return { moduleAllow, moduleBlock };
}

function getSection(guildId) {
  const modules = guildManager.getGuildSection(guildId, 'modules', {});
  const section = modules.emojis && typeof modules.emojis === 'object' ? modules.emojis : {};
  return {
    enabled: section.enabled === true,
    favourites: uniqueIds(section.favourites, MAX_GUILD_EMOJIS),
    aliases: normaliseAliases(section.aliases),
    tags: normaliseTagMap(section.tags),
    packs: normalisePacks(section.packs),
    recent: normaliseRecent(section.recent),
    usage: normaliseUsage(section.usage),
    temporary: normaliseTemporary(section.temporary),
    policies: normalisePolicies(section.policies),
    cleanup: {
      unusedDays: Math.max(1, Math.min(3650, Number(section.cleanup?.unusedDays) || 90)),
      protectDependencies: section.cleanup?.protectDependencies !== false,
    },
  };
}

function saveSection(guildId, patch = {}, guildOrMeta = {}) {
  const current = getSection(guildId);
  const next = {
    ...current,
    ...patch,
    favourites: uniqueIds(patch.favourites ?? current.favourites, MAX_GUILD_EMOJIS),
    aliases: normaliseAliases(patch.aliases ?? current.aliases),
    tags: normaliseTagMap(patch.tags ?? current.tags),
    packs: normalisePacks(patch.packs ?? current.packs),
    recent: normaliseRecent(patch.recent ?? current.recent),
    usage: normaliseUsage(patch.usage ?? current.usage),
    temporary: normaliseTemporary(patch.temporary ?? current.temporary),
    policies: normalisePolicies(patch.policies ?? current.policies),
    cleanup: {
      unusedDays: Math.max(1, Math.min(3650, Number((patch.cleanup ?? current.cleanup)?.unusedDays) || 90)),
      protectDependencies: (patch.cleanup ?? current.cleanup)?.protectDependencies !== false,
    },
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

function setAlias(guildId, alias, emojiId, guildOrMeta = {}) {
  const key = cleanKey(alias);
  const id = String(emojiId || '').trim();
  if (!key) throw new Error('Emoji alias is required.');
  if (!/^\d{16,20}$/.test(id)) throw new Error('Invalid application emoji ID.');
  const current = getSection(guildId);
  return saveSection(guildId, { aliases: { ...current.aliases, [key]: id } }, guildOrMeta);
}

function removeAlias(guildId, alias, guildOrMeta = {}) {
  const key = cleanKey(alias);
  const current = getSection(guildId);
  const aliases = { ...current.aliases };
  delete aliases[key];
  return saveSection(guildId, { aliases }, guildOrMeta);
}

function setTags(guildId, emojiId, tags, guildOrMeta = {}) {
  const id = String(emojiId || '').trim();
  if (!/^\d{16,20}$/.test(id)) throw new Error('Invalid application emoji ID.');
  const current = getSection(guildId);
  const nextTags = { ...current.tags };
  const cleanTags = [...new Set((Array.isArray(tags) ? tags : []).map((tag) => cleanKey(tag, 24)).filter(Boolean))].slice(0, 20);
  if (cleanTags.length) nextTags[id] = cleanTags;
  else delete nextTags[id];
  return saveSection(guildId, { tags: nextTags }, guildOrMeta);
}

function savePack(guildId, packKey, pack, guildOrMeta = {}) {
  const key = cleanKey(packKey, 40);
  if (!key) throw new Error('Pack key is required.');
  const current = getSection(guildId);
  return saveSection(guildId, { packs: { ...current.packs, [key]: { ...(current.packs[key] || {}), ...pack } } }, guildOrMeta);
}

function deletePack(guildId, packKey, guildOrMeta = {}) {
  const key = cleanKey(packKey, 40);
  const current = getSection(guildId);
  const packs = { ...current.packs };
  delete packs[key];
  return saveSection(guildId, { packs }, guildOrMeta);
}

function flushUsage(guildId) {
  const guildKey = String(guildId);
  const queued = pendingUsage.get(guildKey);
  if (!queued) return;

  try {
    const current = getSection(guildId);
    const usage = { ...current.usage };
    const recentIds = new Set();
    const recent = [];

    for (const [id, entry] of queued.entries) {
      const previous = usage[id] || { count: 0, lastUsedAt: null, contexts: {} };
      const contexts = { ...previous.contexts };
      for (const [context, count] of Object.entries(entry.contexts)) contexts[context] = (contexts[context] || 0) + count;
      usage[id] = {
        count: previous.count + entry.count,
        lastUsedAt: entry.lastUsedAt,
        contexts,
      };
      recent.push({ id, at: entry.lastUsedAt });
      recentIds.add(id);
    }

    saveSection(guildId, {
      usage,
      recent: [...recent, ...current.recent.filter((entry) => !recentIds.has(entry.id))],
    });
    pendingUsage.delete(guildKey);
  } catch (error) {
    console.warn(`[Emoji Studio] Usage flush failed for ${guildId}: ${error?.message || error}`);
    queued.timer = setTimeout(() => flushUsage(guildKey), USAGE_FLUSH_MS);
    queued.timer.unref?.();
  }
}

function recordUsage(guildId, emojiId, context = 'unknown', count = 1) {
  const id = String(emojiId || '').trim();
  if (!/^\d{16,20}$/.test(id)) return;

  const guildKey = String(guildId);
  const contextKey = cleanKey(context, 60) || 'unknown';
  const increment = Math.max(1, Number(count) || 1);
  const at = new Date().toISOString();
  let queued = pendingUsage.get(guildKey);

  if (!queued) {
    queued = { entries: new Map(), timer: null };
    queued.timer = setTimeout(() => flushUsage(guildKey), USAGE_FLUSH_MS);
    queued.timer.unref?.();
    pendingUsage.set(guildKey, queued);
  }

  const entry = queued.entries.get(id) || { count: 0, lastUsedAt: at, contexts: {} };
  entry.count += increment;
  entry.lastUsedAt = at;
  entry.contexts[contextKey] = (entry.contexts[contextKey] || 0) + increment;
  queued.entries.set(id, entry);
}

function setTemporary(guildId, emojiId, expiresAt, removeWhenUnused = true, guildOrMeta = {}) {
  const id = String(emojiId || '').trim();
  if (!/^\d{16,20}$/.test(id)) throw new Error('Invalid application emoji ID.');
  const iso = cleanIso(expiresAt);
  if (!iso) throw new Error('A valid temporary emoji expiry is required.');
  const current = getSection(guildId);
  return saveSection(guildId, { temporary: { ...current.temporary, [id]: { expiresAt: iso, removeWhenUnused: removeWhenUnused !== false } } }, guildOrMeta);
}

function clearTemporary(guildId, emojiId, guildOrMeta = {}) {
  const id = String(emojiId || '').trim();
  const current = getSection(guildId);
  const temporary = { ...current.temporary };
  delete temporary[id];
  return saveSection(guildId, { temporary }, guildOrMeta);
}

module.exports = {
  MAX_GUILD_EMOJIS,
  getSection,
  saveSection,
  setFavourite,
  setAlias,
  removeAlias,
  setTags,
  savePack,
  deletePack,
  recordUsage,
  setTemporary,
  clearTemporary,
  cleanKey,
};
