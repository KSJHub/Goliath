'use strict';

const crypto = require('crypto');
const path = require('path');
const fetch = require('node-fetch');
const guildManager = require('../../../core/guild/guildManager');
const emojiStore = require('./emojisStore');

const BUILTIN_PACKS = Object.freeze({
  gaming: { name: 'Gaming', tags: ['gaming', 'game', 'pc', 'playstation', 'xbox', 'nintendo', 'steam', 'epic', 'activision', 'blizzard'] },
  socials: { name: 'Socials', tags: ['social', 'discord', 'facebook', 'instagram', 'kick', 'snapchat', 'tiktok', 'twitch', 'whatsapp', 'x', 'youtube'] },
  reactions: { name: 'Reactions', tags: ['reaction', 'react', 'emoji', 'meme', 'heart', 'check', 'cross'] },
  moderation: { name: 'Moderation', tags: ['moderation', 'mod', 'warning', 'ban', 'mute', 'ticket', 'report'] },
  events: { name: 'Events', tags: ['event', 'giveaway', 'party', 'celebration', 'birthday', 'winner'] },
  seasonal: { name: 'Seasonal', tags: ['seasonal', 'christmas', 'xmas', 'halloween', 'easter', 'newyear'] },
});

const CATEGORY_RULES = [
  ['Gaming', /\b(pc|playstation|ps|xbox|nintendo|switch|steam|epic|activision|blizzard|gaming|game)\b/i],
  ['Social', /\b(discord|facebook|instagram|kick|snapchat|tiktok|twitch|whatsapp|twitter|youtube|social)\b/i],
  ['Moderation', /\b(mod|moderation|warn|warning|ban|mute|timeout|ticket|report)\b/i],
  ['Events', /\b(event|giveaway|party|birthday|celebration|winner)\b/i],
  ['Seasonal', /\b(christmas|xmas|halloween|easter|newyear|seasonal)\b/i],
  ['Reaction', /\b(reaction|react|meme|lol|love|heart|yes|no|check|cross)\b/i],
];

function nowIso() { return new Date().toISOString(); }
function asMillis(value) { const parsed = Date.parse(String(value || '')); return Number.isFinite(parsed) ? parsed : null; }
function isActiveWindow(startAt, endAt, now = Date.now()) {
  const start = asMillis(startAt);
  const end = asMillis(endAt);
  if (start != null && now < start) return false;
  if (end != null && now > end) return false;
  return true;
}

function inferCategory(emoji, customTags = []) {
  const haystack = `${emoji?.name || ''} ${emoji?.alias || ''} ${(customTags || []).join(' ')}`;
  for (const [category, pattern] of CATEGORY_RULES) if (pattern.test(haystack)) return category;
  return 'General';
}

function inferredTags(emoji) {
  const source = `${emoji?.name || ''} ${emoji?.alias || ''}`.toLowerCase();
  const tags = new Set();
  for (const [, pattern] of CATEGORY_RULES) {
    const match = source.match(pattern);
    if (match?.[1]) tags.add(String(match[1]).toLowerCase());
  }
  if (emoji?.animated) tags.add('animated');
  else tags.add('static');
  return [...tags];
}

function activePackEmojiIds(section, now = Date.now()) {
  const ids = new Set();
  for (const pack of Object.values(section?.packs || {})) {
    if (!pack?.enabled || !isActiveWindow(pack.startAt, pack.endAt, now)) continue;
    for (const id of pack.emojiIds || []) ids.add(String(id));
  }
  return ids;
}

function effectiveFavouriteIds(section, now = Date.now()) {
  const ids = new Set();
  for (const id of section?.favourites || []) {
    if (ids.size >= emojiStore.MAX_GUILD_EMOJIS) break;
    ids.add(String(id));
  }
  for (const id of activePackEmojiIds(section, now)) {
    if (ids.size >= emojiStore.MAX_GUILD_EMOJIS) break;
    ids.add(id);
  }
  return ids;
}

function policyAllows(section, emojiId, context = 'unknown') {
  const key = emojiStore.cleanKey(context, 60) || 'unknown';
  const id = String(emojiId);
  const allow = section?.policies?.moduleAllow?.[key];
  const block = section?.policies?.moduleBlock?.[key];
  if (Array.isArray(block) && block.includes(id)) return false;
  if (Array.isArray(allow) && allow.length && !allow.includes(id)) return false;
  return true;
}

function decorateCatalog(bank, guildId) {
  const section = emojiStore.getSection(guildId);
  const effective = effectiveFavouriteIds(section);
  const aliasesById = new Map();
  for (const [alias, id] of Object.entries(section.aliases || {})) {
    const list = aliasesById.get(String(id)) || [];
    list.push(alias);
    aliasesById.set(String(id), list);
  }
  return (bank || []).map((emoji) => {
    const customTags = section.tags?.[String(emoji.id)] || [];
    const tags = [...new Set([...inferredTags(emoji), ...customTags])];
    return {
      ...emoji,
      aliases: aliasesById.get(String(emoji.id)) || [],
      tags,
      category: inferCategory(emoji, tags),
      selected: emoji.core === true || effective.has(String(emoji.id)),
      recentAt: section.recent.find((entry) => entry.id === String(emoji.id))?.at || null,
      usage: section.usage?.[String(emoji.id)] || { count: 0, lastUsedAt: null, contexts: {} },
      temporary: section.temporary?.[String(emoji.id)] || null,
    };
  });
}

function searchCatalog(bank, guildId, query = '', options = {}) {
  const clean = String(query || '').trim().toLowerCase();
  const category = String(options.category || '').trim().toLowerCase();
  const tag = String(options.tag || '').trim().toLowerCase();
  return decorateCatalog(bank, guildId)
    .filter((emoji) => {
      if (category && String(emoji.category).toLowerCase() !== category) return false;
      if (tag && !emoji.tags.includes(tag)) return false;
      if (!clean) return true;
      return [emoji.name, emoji.alias, emoji.category, ...(emoji.aliases || []), ...(emoji.tags || [])]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(clean));
    })
    .sort((a, b) => (b.usage?.count || 0) - (a.usage?.count || 0) || String(a.name).localeCompare(String(b.name)));
}

function pickerData(bank, guildId, query = '', context = 'unknown') {
  const section = emojiStore.getSection(guildId);
  const catalog = searchCatalog(bank, guildId, query)
    .filter((emoji) => emoji.core || (section.enabled && emoji.selected))
    .filter((emoji) => emoji.core || policyAllows(section, emoji.id, context));
  const recentIds = new Set(section.recent.map((entry) => entry.id));
  return {
    core: catalog.filter((emoji) => emoji.core),
    studio: catalog.filter((emoji) => !emoji.core),
    recent: catalog.filter((emoji) => recentIds.has(String(emoji.id))).slice(0, 25),
    favourites: catalog.filter((emoji) => !emoji.core && section.favourites.includes(String(emoji.id))),
  };
}

function shortcodeSuggestions(bank, guildId, query = '', context = 'unknown', limit = 25) {
  const picker = pickerData(bank, guildId, query, context);
  const combined = [...picker.core, ...picker.recent, ...picker.studio];
  const seen = new Set();
  const output = [];
  for (const emoji of combined) {
    const names = emoji.core ? [emoji.alias] : [emoji.name, ...(emoji.aliases || [])];
    for (const name of names) {
      const key = String(name || '').toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      output.push({ name: key, shortcode: `:${key}:`, emojiId: String(emoji.id), core: emoji.core === true, category: emoji.category, tags: emoji.tags });
      if (output.length >= Math.max(1, Math.min(100, Number(limit) || 25))) return output;
    }
  }
  return output;
}

function materialiseBuiltinPack(bank, guildId, packKey, options = {}) {
  const key = emojiStore.cleanKey(packKey, 40);
  const definition = BUILTIN_PACKS[key];
  if (!definition) throw new Error(`Unknown built-in Emoji Studio pack: ${packKey}`);
  const wanted = new Set(definition.tags.map((tag) => String(tag).toLowerCase()));
  const matches = decorateCatalog(bank, guildId)
    .filter((emoji) => !emoji.core)
    .filter((emoji) => emoji.tags.some((tag) => wanted.has(String(tag).toLowerCase())) || wanted.has(String(emoji.category || '').toLowerCase()))
    .slice(0, emojiStore.MAX_GUILD_EMOJIS)
    .map((emoji) => String(emoji.id));
  return {
    key,
    pack: {
      name: definition.name,
      emojiIds: matches,
      tags: definition.tags,
      enabled: options.enabled !== false,
      startAt: options.startAt || null,
      endAt: options.endAt || null,
      temporary: options.temporary === true,
    },
  };
}

function packStatus(bank, guildId) {
  const section = emojiStore.getSection(guildId);
  const catalog = decorateCatalog(bank, guildId);
  const statuses = [];
  for (const [key, definition] of Object.entries(BUILTIN_PACKS)) {
    const current = section.packs[key] || null;
    const materialised = materialiseBuiltinPack(bank, guildId, key, { enabled: current?.enabled === true, startAt: current?.startAt, endAt: current?.endAt, temporary: current?.temporary });
    statuses.push({ key, name: definition.name, builtIn: true, available: materialised.pack.emojiIds.length, enabled: current?.enabled === true, active: current?.enabled === true && isActiveWindow(current.startAt, current.endAt), startAt: current?.startAt || null, endAt: current?.endAt || null });
  }
  for (const [key, pack] of Object.entries(section.packs)) {
    if (BUILTIN_PACKS[key]) continue;
    statuses.push({ key, name: pack.name, builtIn: false, available: (pack.emojiIds || []).filter((id) => catalog.some((emoji) => String(emoji.id) === String(id))).length, enabled: pack.enabled === true, active: pack.enabled === true && isActiveWindow(pack.startAt, pack.endAt), startAt: pack.startAt, endAt: pack.endAt });
  }
  return statuses;
}

function collectShortcodePaths(value, names, pathParts = [], output = []) {
  if (pathParts[0] === 'modules' && pathParts[1] === 'emojis') return output;
  if (typeof value === 'string') {
    for (const name of names) if (value.toLowerCase().includes(`:${String(name).toLowerCase()}:`)) output.push(pathParts.join('.') || '<root>');
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectShortcodePaths(entry, names, [...pathParts, String(index)], output));
    return output;
  }
  if (value && typeof value === 'object') for (const [key, entry] of Object.entries(value)) collectShortcodePaths(entry, names, [...pathParts, key], output);
  return output;
}

function dependencyReport(bank, emojiId) {
  const target = (bank || []).find((emoji) => String(emoji.id) === String(emojiId));
  if (!target) return { emojiId: String(emojiId), found: false, dependencies: [], total: 0 };
  const dependencies = [];
  const files = typeof guildManager.listGuildFiles === 'function' ? guildManager.listGuildFiles() : [];
  for (const file of files) {
    const guildId = path.basename(file, '.json');
    if (!/^\d{16,20}$/.test(guildId)) continue;
    const section = emojiStore.getSection(guildId);
    const aliases = Object.entries(section.aliases || {}).filter(([, id]) => String(id) === String(emojiId)).map(([alias]) => alias);
    const names = [...new Set([target.alias, target.name, ...aliases].filter(Boolean))];
    const data = guildManager.getGuildData(guildId);
    const paths = [...new Set(collectShortcodePaths(data, names))];
    const selected = section.favourites.includes(String(emojiId)) || activePackEmojiIds(section).has(String(emojiId));
    const packs = Object.entries(section.packs || {}).filter(([, pack]) => (pack.emojiIds || []).includes(String(emojiId))).map(([key]) => key);
    if (paths.length || selected || aliases.length || packs.length) dependencies.push({ guildId, paths, selected, aliases, packs });
  }
  return { emojiId: String(emojiId), found: true, emoji: target, dependencies, total: dependencies.reduce((sum, entry) => sum + entry.paths.length + (entry.selected ? 1 : 0) + entry.aliases.length + entry.packs.length, 0) };
}

function aggregateUsage(bank) {
  const totals = new Map((bank || []).map((emoji) => [String(emoji.id), { emoji, count: 0, lastUsedAt: null, contexts: {} }]));
  const files = typeof guildManager.listGuildFiles === 'function' ? guildManager.listGuildFiles() : [];
  for (const file of files) {
    const guildId = path.basename(file, '.json');
    if (!/^\d{16,20}$/.test(guildId)) continue;
    const usage = emojiStore.getSection(guildId).usage || {};
    for (const [id, entry] of Object.entries(usage)) {
      if (!totals.has(id)) continue;
      const target = totals.get(id);
      target.count += Number(entry.count) || 0;
      if (!target.lastUsedAt || (entry.lastUsedAt && Date.parse(entry.lastUsedAt) > Date.parse(target.lastUsedAt))) target.lastUsedAt = entry.lastUsedAt || target.lastUsedAt;
      for (const [context, count] of Object.entries(entry.contexts || {})) target.contexts[context] = (target.contexts[context] || 0) + (Number(count) || 0);
    }
  }
  return [...totals.values()].sort((a, b) => b.count - a.count || String(a.emoji?.name).localeCompare(String(b.emoji?.name)));
}

function cleanupCandidates(bank, unusedDays = 90) {
  const cutoff = Date.now() - Math.max(1, Number(unusedDays) || 90) * 86400000;
  return aggregateUsage(bank)
    .filter((entry) => entry.emoji && !entry.emoji.core)
    .filter((entry) => !entry.lastUsedAt || Date.parse(entry.lastUsedAt) < cutoff)
    .map((entry) => {
      const dependencies = dependencyReport(bank, entry.emoji.id);
      return { ...entry, unusedDays: entry.lastUsedAt ? Math.floor((Date.now() - Date.parse(entry.lastUsedAt)) / 86400000) : null, dependencies: dependencies.total };
    })
    .sort((a, b) => a.dependencies - b.dependencies || a.count - b.count);
}

async function imageHash(emoji) {
  if (!emoji?.url) return null;
  const response = await fetch(emoji.url, { headers: { 'User-Agent': 'KSJHub-Goliath/1.0' }, timeout: 15000 });
  if (!response.ok) return null;
  const buffer = await response.buffer();
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function duplicateGroups(bank) {
  const candidates = (bank || []).filter((entry) => !entry.core);
  const groups = new Map();
  let cursor = 0;

  const worker = async () => {
    while (cursor < candidates.length) {
      const emoji = candidates[cursor++];
      try {
        const hash = await imageHash(emoji);
        if (!hash) continue;
        const list = groups.get(hash) || [];
        list.push(emoji);
        groups.set(hash, list);
      } catch (_) { /* one failed CDN request does not fail the audit */ }
    }
  };

  const concurrency = Math.min(8, candidates.length);
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return [...groups.entries()].filter(([, entries]) => entries.length > 1).map(([hash, entries]) => ({ hash, entries }));
}

function capacityForecast(bank, dailyGrowth = null) {
  const used = (bank || []).length;
  const max = 2000;
  const growth = Number.isFinite(Number(dailyGrowth)) && Number(dailyGrowth) > 0 ? Number(dailyGrowth) : 0;
  return { used, max, remaining: Math.max(0, max - used), dailyGrowth: growth, estimatedDaysToFull: growth > 0 ? Math.ceil(Math.max(0, max - used) / growth) : null };
}

function exportGuildConfig(guildId) {
  const section = emojiStore.getSection(guildId);
  return { version: 1, exportedAt: nowIso(), sourceGuildId: String(guildId), favourites: section.favourites, aliases: section.aliases, tags: section.tags, packs: section.packs, temporary: section.temporary, policies: section.policies, cleanup: section.cleanup };
}

function importGuildConfig(guildId, payload, meta = {}) {
  const source = payload && typeof payload === 'object' ? payload : {};
  return emojiStore.saveSection(guildId, { favourites: source.favourites || [], aliases: source.aliases || {}, tags: source.tags || {}, packs: source.packs || {}, temporary: source.temporary || {}, policies: source.policies || {}, cleanup: source.cleanup || {} }, meta);
}

function expiredTemporaryEntries(guildId, now = Date.now()) {
  const section = emojiStore.getSection(guildId);
  return Object.entries(section.temporary || {})
    .filter(([, entry]) => asMillis(entry.expiresAt) != null && asMillis(entry.expiresAt) <= now)
    .map(([emojiId, entry]) => ({ emojiId, ...entry }));
}

function healthReport(bank, guildId) {
  const section = emojiStore.getSection(guildId);
  const ids = new Set((bank || []).map((emoji) => String(emoji.id)));
  const brokenFavourites = section.favourites.filter((id) => !ids.has(id));
  const brokenAliases = Object.entries(section.aliases).filter(([, id]) => !ids.has(String(id))).map(([alias, id]) => ({ alias, id }));
  const brokenPackEntries = [];
  for (const [packKey, pack] of Object.entries(section.packs || {})) for (const id of pack.emojiIds || []) if (!ids.has(String(id))) brokenPackEntries.push({ packKey, emojiId: id });
  const forecast = capacityForecast(bank);
  return {
    healthy: brokenFavourites.length === 0 && brokenAliases.length === 0 && brokenPackEntries.length === 0 && forecast.remaining > 0,
    brokenFavourites,
    brokenAliases,
    brokenPackEntries,
    capacity: forecast,
    expiredTemporary: expiredTemporaryEntries(guildId),
  };
}

module.exports = {
  BUILTIN_PACKS,
  inferCategory,
  inferredTags,
  isActiveWindow,
  activePackEmojiIds,
  effectiveFavouriteIds,
  policyAllows,
  decorateCatalog,
  searchCatalog,
  pickerData,
  shortcodeSuggestions,
  materialiseBuiltinPack,
  packStatus,
  dependencyReport,
  aggregateUsage,
  cleanupCandidates,
  duplicateGroups,
  capacityForecast,
  exportGuildConfig,
  importGuildConfig,
  expiredTemporaryEntries,
  healthReport,
};
