'use strict';

const emojiApi = require('./emojisApi');
const emojiStore = require('./emojisStore');
const studioService = require('./emojiStudioService');

const MAX_APPLICATION_EMOJIS = 2000;
const MAX_CORE_EMOJIS = 18;
const MAX_STUDIO_EMOJIS = MAX_APPLICATION_EMOJIS - MAX_CORE_EMOJIS;
const CORE_EMOJI_PREFIX = 'goliath_';
const CORE_EMOJI_ALIASES = Object.freeze([
  'activision', 'blizzard', 'discord', 'epic', 'facebook', 'instagram', 'kick', 'nintendo', 'pc',
  'playstation', 'snapchat', 'steam', 'tiktok', 'twitch', 'whatsapp', 'x', 'xbox', 'youtube',
]);
const CORE_EMOJI_ALIAS_SET = new Set(CORE_EMOJI_ALIASES);

function requireEmojiManager(client) {
  const manager = client?.application?.emojis;
  if (!manager) throw new Error('Discord application emoji manager is unavailable.');
  return manager;
}

function cleanEmojiName(value, fallback = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32) || fallback;
}

function isCoreEmojiName(name) { return String(name || '').toLowerCase().startsWith(CORE_EMOJI_PREFIX); }
function isCoreEmoji(emoji) { return Boolean(emoji?.name && isCoreEmojiName(emoji.name)); }
function coreAlias(name) {
  const clean = String(name || '').toLowerCase();
  return isCoreEmojiName(clean) ? clean.slice(CORE_EMOJI_PREFIX.length) : clean;
}
function isApprovedCoreAlias(value) { return CORE_EMOJI_ALIAS_SET.has(cleanEmojiName(value)); }
function coreArtifactName(kind, alias) { return `${CORE_EMOJI_PREFIX}${kind === 'backup' ? 'b' : 'r'}_${alias}`.slice(0, 32); }

function componentPayload(emoji) {
  if (!emoji?.id || !emoji?.name) return null;
  return { id: String(emoji.id), name: String(emoji.name), animated: Boolean(emoji.animated) };
}

function serialise(emoji) {
  const core = isCoreEmoji(emoji);
  return {
    id: String(emoji.id),
    name: String(emoji.name),
    alias: core ? coreAlias(emoji.name) : String(emoji.name),
    core,
    animated: Boolean(emoji.animated),
    url: emoji.imageURL?.({ extension: 'webp', size: 128 }) || emoji.url || null,
    mention: emoji.toString(),
    component: componentPayload(emoji),
  };
}

function buildCoreIntegrity(core = []) {
  const byAlias = new Map();
  const rogue = [];
  for (const emoji of core) {
    const alias = String(emoji?.alias || '').toLowerCase();
    if (!CORE_EMOJI_ALIAS_SET.has(alias)) { rogue.push(emoji); continue; }
    const group = byAlias.get(alias) || [];
    group.push(emoji);
    byAlias.set(alias, group);
  }
  const duplicates = [...byAlias.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([alias, entries]) => ({ alias, emojiIds: entries.map((entry) => String(entry.id)) }));
  return { healthy: rogue.length === 0 && duplicates.length === 0, rogue, duplicates, approvedInstalled: [...byAlias.keys()].length };
}

async function recoverCoreArtifacts(client) {
  const manager = requireEmojiManager(client);
  const bank = await manager.fetch();
  const byName = new Map([...bank.values()].filter((emoji) => emoji?.name).map((emoji) => [String(emoji.name).toLowerCase(), emoji]));
  const actions = [];
  for (const alias of CORE_EMOJI_ALIASES) {
    const targetName = `${CORE_EMOJI_PREFIX}${alias}`;
    const backupName = coreArtifactName('backup', alias);
    const replacementName = coreArtifactName('replacement', alias);
    const target = byName.get(targetName) || null;
    const backup = byName.get(backupName) || null;
    const replacement = byName.get(replacementName) || null;
    if (target) {
      if (backup) { await manager.delete(backup.id); actions.push({ alias, action: 'deleted_stale_backup', emojiId: String(backup.id) }); }
      if (replacement) { await manager.delete(replacement.id); actions.push({ alias, action: 'deleted_stale_replacement', emojiId: String(replacement.id) }); }
      continue;
    }
    if (backup) {
      const restored = await manager.edit(backup.id, { name: targetName });
      actions.push({ alias, action: 'restored_backup', emojiId: String(restored.id) });
      if (replacement) { await manager.delete(replacement.id); actions.push({ alias, action: 'deleted_unfinished_replacement', emojiId: String(replacement.id) }); }
      continue;
    }
    if (replacement) {
      const completed = await manager.edit(replacement.id, { name: targetName });
      actions.push({ alias, action: 'completed_replacement', emojiId: String(completed.id) });
    }
  }
  return actions;
}

async function replaceCoreEmoji(client, alias, attachment) {
  const cleanAlias = cleanEmojiName(alias);
  if (!CORE_EMOJI_ALIAS_SET.has(cleanAlias)) throw new Error('That is not an approved Goliath Core emoji.');
  if (!attachment) throw new Error('A replacement emoji image is required.');

  const manager = requireEmojiManager(client);
  await recoverCoreArtifacts(client);

  const bank = await manager.fetch();
  const targetName = `${CORE_EMOJI_PREFIX}${cleanAlias}`;
  const backupName = coreArtifactName('backup', cleanAlias);
  const replacementName = coreArtifactName('replacement', cleanAlias);
  const current = [...bank.values()].find((emoji) => String(emoji?.name || '').toLowerCase() === targetName);
  if (!current) throw new Error(`Core emoji :${cleanAlias}: is not currently installed.`);

  let backup = null;
  let replacement = null;
  try {
    backup = await manager.edit(current.id, { name: backupName });
    replacement = await manager.create({ attachment, name: replacementName });
    const installed = await manager.edit(replacement.id, { name: targetName });
    try {
      await manager.delete(backup.id);
    } catch (cleanupError) {
      console.warn(`[Emoji Core] Replacement succeeded but backup cleanup failed for ${cleanAlias}:`, cleanupError?.message || cleanupError);
    }
    return { alias: cleanAlias, previousEmojiId: String(current.id), emoji: serialise(installed) };
  } catch (error) {
    try { if (replacement?.id) await manager.delete(replacement.id); } catch (_) {}
    try { if (backup?.id) await manager.edit(backup.id, { name: targetName }); } catch (_) {}
    throw error;
  }
}

async function listBank(client) {
  const bank = await requireEmojiManager(client).fetch();
  return [...bank.values()].map(serialise).sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

async function overview(client, guildId) {
  const coreRecovery = await recoverCoreArtifacts(client);
  const bank = await listBank(client);
  const core = bank.filter((emoji) => emoji.core);
  const studio = bank.filter((emoji) => !emoji.core);
  const coreIntegrity = buildCoreIntegrity(core);
  const installedCoreByAlias = new Map();
  for (const emoji of core) {
    const alias = String(emoji.alias || '').toLowerCase();
    if (!CORE_EMOJI_ALIAS_SET.has(alias) || installedCoreByAlias.has(alias)) continue;
    installedCoreByAlias.set(alias, emoji);
  }
  const missingCore = CORE_EMOJI_ALIASES.filter((alias) => !installedCoreByAlias.has(alias));
  const coreStatus = CORE_EMOJI_ALIASES.map((alias, index) => {
    const emoji = installedCoreByAlias.get(alias) || null;
    return { slot: index + 1, alias, installed: Boolean(emoji), emoji, id: emoji?.id || null, mention: emoji?.mention || null, animated: Boolean(emoji?.animated) };
  });
  let section = emojiStore.getSection(guildId);
  const validStudioIds = new Set(studio.map((emoji) => String(emoji.id)));
  const favourites = section.favourites.filter((id) => validStudioIds.has(String(id)));
  const aliases = Object.fromEntries(Object.entries(section.aliases).filter(([, id]) => validStudioIds.has(String(id))));
  const tags = Object.fromEntries(Object.entries(section.tags).filter(([id]) => validStudioIds.has(String(id))));
  if (favourites.length !== section.favourites.length || Object.keys(aliases).length !== Object.keys(section.aliases).length || Object.keys(tags).length !== Object.keys(section.tags).length) {
    section = emojiStore.saveSection(guildId, { favourites, aliases, tags });
  }
  const effectiveIds = studioService.effectiveFavouriteIds(section);
  const decorated = studioService.decorateCatalog(bank, guildId);
  const health = studioService.healthReport(bank, guildId);
  const usage = studioService.aggregateUsage(bank);
  const forecast = studioService.capacityForecast(bank);
  return {
    enabled: section.enabled,
    capacity: { used: bank.length, max: MAX_APPLICATION_EMOJIS, remaining: Math.max(0, MAX_APPLICATION_EMOJIS - bank.length) },
    coreCapacity: { used: core.length, max: MAX_CORE_EMOJIS, remaining: Math.max(0, MAX_CORE_EMOJIS - core.length) },
    studioCapacity: { used: studio.length, max: MAX_STUDIO_EMOJIS, remaining: Math.max(0, MAX_STUDIO_EMOJIS - studio.length) },
    guildCapacity: { used: effectiveIds.size, max: emojiStore.MAX_GUILD_EMOJIS, remaining: Math.max(0, emojiStore.MAX_GUILD_EMOJIS - effectiveIds.size) },
    bank,
    catalog: decorated,
    core,
    coreCatalog: CORE_EMOJI_ALIASES,
    coreStatus,
    coreIntegrity,
    coreRecovery,
    missingCore,
    studio,
    favourites: section.favourites,
    effectiveFavourites: [...effectiveIds],
    aliases: section.aliases,
    tags: section.tags,
    packs: section.packs,
    recent: section.recent,
    usage,
    policies: section.policies,
    temporary: section.temporary,
    health,
    forecast,
  };
}

async function createStudioEmoji(client, attachment, requestedName) {
  if (!attachment) throw new Error('An emoji image is required.');
  const manager = requireEmojiManager(client);
  const bank = await manager.fetch();
  const studioCount = [...bank.values()].filter((emoji) => !isCoreEmoji(emoji)).length;
  if (bank.size >= MAX_APPLICATION_EMOJIS) throw new Error('Emoji Studio application emoji pool is full (2,000/2,000).');
  if (studioCount >= MAX_STUDIO_EMOJIS) throw new Error(`Emoji Studio pool is full (${MAX_STUDIO_EMOJIS}/${MAX_STUDIO_EMOJIS}); ${MAX_CORE_EMOJIS} slots are reserved for Goliath Core.`);
  const name = cleanEmojiName(requestedName, `emoji_${Date.now().toString(36)}`);
  if (isCoreEmojiName(name)) throw new Error(`Names beginning with ${CORE_EMOJI_PREFIX} are reserved for Goliath Core emojis.`);
  const duplicate = [...bank.values()].find((emoji) => String(emoji.name).toLowerCase() === name);
  if (duplicate) return { emoji: serialise(duplicate), created: false };
  const created = await manager.create({ attachment, name });
  return { emoji: serialise(created), created: true };
}

async function importFromUrl(client, imageUrl, requestedName = null) {
  const prepared = await emojiApi.prepareDownloadedAsset(String(imageUrl || '').trim());
  let fallback = requestedName;
  if (!fallback) {
    try {
      const pathname = new URL(String(imageUrl)).pathname;
      fallback = pathname.split('/').pop()?.replace(/\.[a-z0-9]+$/i, '') || null;
    } catch (_) { /* URL validation is handled by the downloader */ }
  }
  const result = await createStudioEmoji(client, prepared.buffer, fallback);
  return { ...result, processed: prepared.processed === true, animated: prepared.animated === true };
}

async function importFromEmojiGG(client, emojiGgId, requestedName = null) {
  const source = await emojiApi.findById(emojiGgId);
  if (!source) throw new Error('Emoji.gg emoji was not found.');
  const url = emojiApi.assetUrl(source);
  if (!url) throw new Error('Emoji.gg did not provide an image URL for this emoji.');
  const prepared = await emojiApi.prepareDownloadedAsset(url);
  const rawName = requestedName || source.title || source.slug || `emoji_${source.id}`;
  const result = await createStudioEmoji(client, prepared.buffer, rawName);
  return { ...result, sourceId: String(source.id), processed: prepared.processed === true, animated: prepared.animated === true };
}

async function removeFromBank(client, emojiId) {
  const manager = requireEmojiManager(client);
  const emoji = await manager.fetch(String(emojiId));
  if (!emoji) throw new Error('Application emoji was not found.');
  if (isCoreEmoji(emoji)) throw new Error('Goliath Core emojis are immutable and repo-managed only.');
  const bank = await listBank(client);
  const dependency = studioService.dependencyReport(bank, emojiId);
  if (dependency.total > 0) throw new Error(`This emoji has ${dependency.total} active dependency reference(s). Remove those references before deleting it.`);
  await manager.delete(emoji.id);
  return true;
}

async function renameInBank(client, emojiId, name) {
  const manager = requireEmojiManager(client);
  const existing = await manager.fetch(String(emojiId));
  if (!existing) throw new Error('Application emoji was not found.');
  if (isCoreEmoji(existing)) throw new Error('Goliath Core emojis are immutable and repo-managed only.');
  const clean = cleanEmojiName(name);
  if (!clean) throw new Error('Emoji name is required.');
  if (isCoreEmojiName(clean)) throw new Error(`Names beginning with ${CORE_EMOJI_PREFIX} are reserved for Goliath Core emojis.`);
  const edited = await manager.edit(String(emojiId), { name: clean });
  return serialise(edited);
}

function render(emoji, fallback = '') {
  if (!emoji?.id || !emoji?.name) return fallback;
  return `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`;
}

function findByReference(bank, reference, aliases = {}) {
  const wanted = String(reference || '').trim();
  if (!wanted) return null;
  if (/^\d{16,20}$/.test(wanted)) return bank.get(wanted) || null;
  const mentionMatch = wanted.match(/^<a?:([^:>]+):(\d{16,20})>$/);
  if (mentionMatch) return bank.get(mentionMatch[2]) || null;
  const name = wanted.replace(/^:+|:+$/g, '').toLowerCase();
  const aliasId = aliases?.[name];
  if (aliasId && bank.has(String(aliasId))) return bank.get(String(aliasId));
  return [...bank.values()].find((entry) => {
    const entryName = String(entry.name || '').toLowerCase();
    return entryName === name || (isCoreEmojiName(entryName) && coreAlias(entryName) === name);
  }) || null;
}

async function resolveGuildEmoji(client, guildId, reference, context = 'unknown') {
  const section = emojiStore.getSection(guildId);
  const bank = await requireEmojiManager(client).fetch();
  const emoji = findByReference(bank, reference, section.aliases);
  if (!emoji) return null;
  if (isCoreEmoji(emoji)) {
    if (!CORE_EMOJI_ALIAS_SET.has(coreAlias(emoji.name))) return null;
    emojiStore.recordUsage(guildId, emoji.id, context);
    return serialise(emoji);
  }
  if (!section.enabled) return null;
  const selected = studioService.effectiveFavouriteIds(section);
  if (!selected.has(String(emoji.id)) || !studioService.policyAllows(section, emoji.id, context)) return null;
  emojiStore.recordUsage(guildId, emoji.id, context);
  return serialise(emoji);
}

async function allowedGuildEmojis(client, guildId, context = 'unknown') {
  const section = emojiStore.getSection(guildId);
  const bank = await requireEmojiManager(client).fetch();
  const selected = studioService.effectiveFavouriteIds(section);
  const allowed = new Map();
  for (const emoji of bank.values()) {
    if (!emoji?.name) continue;
    const name = String(emoji.name).toLowerCase();
    if (isCoreEmoji(emoji)) {
      const alias = coreAlias(name);
      if (!CORE_EMOJI_ALIAS_SET.has(alias)) continue;
      allowed.set(name, emoji);
      allowed.set(alias, emoji);
      continue;
    }
    if (!section.enabled || !selected.has(String(emoji.id)) || !studioService.policyAllows(section, emoji.id, context)) continue;
    allowed.set(name, emoji);
    for (const [alias, id] of Object.entries(section.aliases)) if (String(id) === String(emoji.id)) allowed.set(alias.toLowerCase(), emoji);
  }
  return allowed;
}

function replaceShortcodes(value, allowedByName, onUse = null) {
  const text = String(value || '');
  if (!text || !allowedByName?.size) return text;
  return text.replace(/:([a-zA-Z0-9_\-]{2,32}):/g, (match, name, offset, source) => {
    const prefix = source.slice(Math.max(0, offset - 2), offset);
    if (prefix.endsWith('<') || prefix === '<a') return match;
    const emoji = allowedByName.get(String(name).toLowerCase());
    if (!emoji) return match;
    if (typeof onUse === 'function') onUse(emoji, name);
    return render(emoji, match);
  });
}

function usageRecorder(guildId, context) {
  const counts = new Map();
  return {
    onUse(emoji) { counts.set(String(emoji.id), (counts.get(String(emoji.id)) || 0) + 1); },
    flush() { for (const [id, count] of counts) emojiStore.recordUsage(guildId, id, context, count); },
  };
}

async function resolveText(client, guildId, value, context = 'text') {
  if (value == null) return value;
  const allowed = await allowedGuildEmojis(client, guildId, context);
  const recorder = usageRecorder(guildId, context);
  const result = replaceShortcodes(value, allowed, recorder.onUse);
  recorder.flush();
  return result;
}

function resolveDataWithAllowed(data, allowed, recorder) {
  if (!data || typeof data !== 'object') return data;
  const resolved = { ...data };
  if (data.title != null) resolved.title = replaceShortcodes(data.title, allowed, recorder.onUse);
  if (data.description != null) resolved.description = replaceShortcodes(data.description, allowed, recorder.onUse);
  if (data.author && typeof data.author === 'object') resolved.author = { ...data.author, name: replaceShortcodes(data.author.name, allowed, recorder.onUse) };
  if (data.footer && typeof data.footer === 'object') resolved.footer = { ...data.footer, text: replaceShortcodes(data.footer.text, allowed, recorder.onUse) };
  if (Array.isArray(data.fields)) resolved.fields = data.fields.map((field) => ({ ...field, name: replaceShortcodes(field?.name, allowed, recorder.onUse), value: replaceShortcodes(field?.value, allowed, recorder.onUse) }));
  return resolved;
}

async function resolveEmbedData(client, guildId, embed, context = 'embed') {
  const data = typeof embed?.toJSON === 'function' ? embed.toJSON() : embed;
  const allowed = await allowedGuildEmojis(client, guildId, context);
  if (!allowed.size) return data;
  const recorder = usageRecorder(guildId, context);
  const resolved = resolveDataWithAllowed(data, allowed, recorder);
  recorder.flush();
  return resolved;
}

async function resolveEmbeds(client, guildId, embeds = [], context = 'embed') {
  const allowed = await allowedGuildEmojis(client, guildId, context);
  if (!allowed.size) return embeds;
  const recorder = usageRecorder(guildId, context);
  const resolved = (embeds || []).map((embed) => resolveDataWithAllowed(typeof embed?.toJSON === 'function' ? embed.toJSON() : embed, allowed, recorder));
  recorder.flush();
  return resolved;
}

async function renderForGuild(client, guildId, reference, fallback = '', context = 'render') {
  const emoji = await resolveGuildEmoji(client, guildId, reference, context);
  return render(emoji, fallback);
}

async function componentEmojiForGuild(client, guildId, reference, context = 'component') {
  const emoji = await resolveGuildEmoji(client, guildId, reference, context);
  return componentPayload(emoji);
}

async function catalog(client, guildId, query = '', options = {}) { return studioService.searchCatalog(await listBank(client), guildId, query, options); }
async function picker(client, guildId, query = '', context = 'picker') { return studioService.pickerData(await listBank(client), guildId, query, context); }
async function suggest(client, guildId, query = '', context = 'editor', limit = 25) { return studioService.shortcodeSuggestions(await listBank(client), guildId, query, context, limit); }
async function dependencies(client, emojiId) { return studioService.dependencyReport(await listBank(client), emojiId); }
async function analytics(client) { return studioService.aggregateUsage(await listBank(client)); }
async function cleanupCandidates(client, unusedDays = 90) { return studioService.cleanupCandidates(await listBank(client), unusedDays); }
async function duplicates(client) { return studioService.duplicateGroups(await listBank(client)); }
async function health(client, guildId) { return studioService.healthReport(await listBank(client), guildId); }
async function forecast(client) { return studioService.capacityForecast(await listBank(client)); }
function exportGuildConfig(guildId) { return studioService.exportGuildConfig(guildId); }
function importGuildConfig(guildId, config, meta = {}) { return studioService.importGuildConfig(guildId, config, meta); }

async function processExpiredTemporary(client, guildId) {
  const expired = studioService.expiredTemporaryEntries(guildId);
  const results = [];
  for (const entry of expired) {
    const dependency = await dependencies(client, entry.emojiId);
    if (entry.removeWhenUnused && dependency.total === 0) {
      try { await removeFromBank(client, entry.emojiId); results.push({ ...entry, action: 'deleted' }); }
      catch (error) { results.push({ ...entry, action: 'failed', error: error.message }); }
    } else {
      emojiStore.setFavourite(guildId, entry.emojiId, false, { action: 'emoji_temporary_expired' });
      results.push({ ...entry, action: 'deselected', dependencies: dependency.total });
    }
    emojiStore.clearTemporary(guildId, entry.emojiId, { action: 'emoji_temporary_expired' });
  }
  return results;
}

module.exports = {
  MAX_APPLICATION_EMOJIS,
  MAX_CORE_EMOJIS,
  MAX_STUDIO_EMOJIS,
  CORE_EMOJI_PREFIX,
  CORE_EMOJI_ALIASES,
  CORE_PREFIX: CORE_EMOJI_PREFIX,
  CORE_ALIASES: CORE_EMOJI_ALIASES,
  isCoreEmojiName,
  isCoreEmoji,
  coreAlias,
  isApprovedCoreAlias,
  recoverCoreArtifacts,
  replaceCoreEmoji,
  listBank,
  overview,
  createStudioEmoji,
  importFromUrl,
  importFromEmojiGG,
  removeFromBank,
  renameInBank,
  render,
  resolveGuildEmoji,
  allowedGuildEmojis,
  replaceShortcodes,
  resolveText,
  resolveEmbedData,
  resolveEmbeds,
  renderForGuild,
  componentEmojiForGuild,
  componentPayload,
  serialise,
  catalog,
  picker,
  suggest,
  dependencies,
  analytics,
  cleanupCandidates,
  duplicates,
  health,
  forecast,
  exportGuildConfig,
  importGuildConfig,
  processExpiredTemporary,
  BUILTIN_PACKS: studioService.BUILTIN_PACKS,
};