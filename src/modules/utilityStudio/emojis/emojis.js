'use strict';

const emojiApi = require('./emojisApi');
const emojiStore = require('./emojisStore');

const MAX_APPLICATION_EMOJIS = 2000;
const MAX_CORE_EMOJIS = 40;
const MAX_STUDIO_EMOJIS = MAX_APPLICATION_EMOJIS - MAX_CORE_EMOJIS;
const CORE_EMOJI_PREFIX = 'goliath_';
const CORE_EMOJI_ALIASES = Object.freeze([
  'success', 'error', 'warning', 'info', 'yes', 'no',
  'home', 'settings', 'back', 'next', 'close', 'search', 'edit', 'delete', 'save',
  'user', 'role', 'channel', 'ticket', 'link', 'heart', 'star',
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

function isCoreEmojiName(name) {
  return String(name || '').toLowerCase().startsWith(CORE_EMOJI_PREFIX);
}

function isCoreEmoji(emoji) {
  return Boolean(emoji?.name && isCoreEmojiName(emoji.name));
}

function coreAlias(name) {
  const clean = String(name || '').toLowerCase();
  return isCoreEmojiName(clean) ? clean.slice(CORE_EMOJI_PREFIX.length) : clean;
}

function isApprovedCoreAlias(value) {
  return CORE_EMOJI_ALIAS_SET.has(cleanEmojiName(value));
}

function coreArtifactName(kind, alias) {
  const marker = kind === 'backup' ? 'b' : 'r';
  return `${CORE_EMOJI_PREFIX}${marker}_${alias}`.slice(0, 32);
}

function componentPayload(emoji) {
  if (!emoji?.id || !emoji?.name) return null;
  return {
    id: String(emoji.id),
    name: String(emoji.name),
    animated: Boolean(emoji.animated),
  };
}

function serialise(emoji) {
  const core = isCoreEmoji(emoji);
  return {
    id: emoji.id,
    name: emoji.name,
    alias: core ? coreAlias(emoji.name) : emoji.name,
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
    if (!CORE_EMOJI_ALIAS_SET.has(alias)) {
      rogue.push(emoji);
      continue;
    }
    const group = byAlias.get(alias) || [];
    group.push(emoji);
    byAlias.set(alias, group);
  }

  const duplicates = [...byAlias.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([alias, entries]) => ({ alias, emojiIds: entries.map((entry) => String(entry.id)) }));

  return {
    healthy: rogue.length === 0 && duplicates.length === 0,
    rogue,
    duplicates,
    approvedInstalled: [...byAlias.keys()].length,
  };
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
      if (backup) {
        await manager.delete(backup.id);
        actions.push({ alias, action: 'deleted_stale_backup', emojiId: String(backup.id) });
      }
      if (replacement) {
        await manager.delete(replacement.id);
        actions.push({ alias, action: 'deleted_stale_replacement', emojiId: String(replacement.id) });
      }
      continue;
    }

    if (backup) {
      const restored = await manager.edit(backup.id, { name: targetName });
      actions.push({ alias, action: 'restored_backup', emojiId: String(restored.id) });
      if (replacement) {
        await manager.delete(replacement.id);
        actions.push({ alias, action: 'deleted_unfinished_replacement', emojiId: String(replacement.id) });
      }
      continue;
    }

    if (replacement) {
      const completed = await manager.edit(replacement.id, { name: targetName });
      actions.push({ alias, action: 'completed_replacement', emojiId: String(completed.id) });
    }
  }

  return actions;
}

async function listBank(client) {
  const emojis = await requireEmojiManager(client).fetch();
  return [...emojis.values()].map(serialise).sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

async function overview(client, guildId) {
  const coreRecovery = await recoverCoreArtifacts(client);
  const bank = await listBank(client);
  const core = bank.filter((emoji) => emoji.core === true);
  const studio = bank.filter((emoji) => emoji.core !== true);
  const coreIntegrity = buildCoreIntegrity(core);
  const installedCoreByAlias = new Map();
  for (const emoji of core) {
    const alias = String(emoji.alias || '').toLowerCase();
    if (!CORE_EMOJI_ALIAS_SET.has(alias) || installedCoreByAlias.has(alias)) continue;
    installedCoreByAlias.set(alias, emoji);
  }
  const installedCoreAliases = new Set(installedCoreByAlias.keys());
  const missingCore = CORE_EMOJI_ALIASES.filter((alias) => !installedCoreAliases.has(alias));
  const coreStatus = CORE_EMOJI_ALIASES.map((alias, index) => {
    const emoji = installedCoreByAlias.get(alias) || null;
    return {
      slot: index + 1,
      alias,
      installed: Boolean(emoji),
      emoji,
      id: emoji?.id || null,
      mention: emoji?.mention || null,
      animated: Boolean(emoji?.animated),
    };
  });
  const section = emojiStore.getSection(guildId);
  const validStudioIds = new Set(studio.map((emoji) => emoji.id));
  const favourites = section.favourites.filter((id) => validStudioIds.has(id));
  if (favourites.length !== section.favourites.length) emojiStore.saveSection(guildId, { favourites });
  return {
    enabled: section.enabled,
    capacity: {
      used: bank.length,
      max: MAX_APPLICATION_EMOJIS,
      remaining: Math.max(0, MAX_APPLICATION_EMOJIS - bank.length),
    },
    coreCapacity: {
      used: core.length,
      max: MAX_CORE_EMOJIS,
      remaining: Math.max(0, MAX_CORE_EMOJIS - core.length),
    },
    studioCapacity: {
      used: studio.length,
      max: MAX_STUDIO_EMOJIS,
      remaining: Math.max(0, MAX_STUDIO_EMOJIS - studio.length),
    },
    guildCapacity: {
      used: favourites.length,
      max: emojiStore.MAX_GUILD_EMOJIS,
      remaining: Math.max(0, emojiStore.MAX_GUILD_EMOJIS - favourites.length),
    },
    bank,
    core,
    coreCatalog: CORE_EMOJI_ALIASES,
    coreStatus,
    coreIntegrity,
    coreRecovery,
    missingCore,
    studio,
    favourites,
  };
}

async function createCoreEmoji(client, attachment, requestedName) {
  if (!attachment) throw new Error('A Core emoji image is required.');
  const manager = requireEmojiManager(client);
  const bank = await manager.fetch();
  const coreCount = [...bank.values()].filter(isCoreEmoji).length;
  if (bank.size >= MAX_APPLICATION_EMOJIS) throw new Error('Goliath application emoji pool is full (2,000/2,000).');
  if (coreCount >= MAX_CORE_EMOJIS) throw new Error(`Goliath Core emoji set is full (${MAX_CORE_EMOJIS}/${MAX_CORE_EMOJIS}).`);

  const alias = cleanEmojiName(requestedName);
  if (!alias) throw new Error('Core emoji name is required.');
  if (!CORE_EMOJI_ALIAS_SET.has(alias)) {
    throw new Error(`Unknown Goliath Core emoji alias: ${alias}. Use one of the locked Core catalog names.`);
  }
  const name = `${CORE_EMOJI_PREFIX}${alias}`;
  const duplicate = [...bank.values()].find((emoji) => String(emoji.name).toLowerCase() === name);
  if (duplicate) return { emoji: serialise(duplicate), created: false };

  const created = await manager.create({ attachment, name });
  return { emoji: serialise(created), created: true };
}

async function replaceCoreEmoji(client, emojiId, attachment) {
  if (!attachment) throw new Error('A replacement Core emoji image is required.');
  const manager = requireEmojiManager(client);
  const existing = await manager.fetch(String(emojiId));
  if (!existing || !isCoreEmoji(existing)) throw new Error('That application emoji is not part of Goliath Core.');
  const alias = coreAlias(existing.name);
  if (!CORE_EMOJI_ALIAS_SET.has(alias)) throw new Error('That Goliath Core emoji uses an unapproved alias and cannot be replaced automatically.');

  const bank = await manager.fetch();
  if (bank.size >= MAX_APPLICATION_EMOJIS) throw new Error('Goliath application emoji pool is full; free one application emoji slot before replacing a Core emoji.');

  const targetName = `${CORE_EMOJI_PREFIX}${alias}`;
  const temporaryName = coreArtifactName('replacement', alias);
  const backupName = coreArtifactName('backup', alias);
  let created = null;
  let originalStaged = false;

  const staleTemporary = [...bank.values()].find((emoji) => String(emoji.name).toLowerCase() === temporaryName);
  const staleBackup = [...bank.values()].find((emoji) => String(emoji.name).toLowerCase() === backupName);
  if (staleTemporary || staleBackup) {
    throw new Error(`Core emoji :${alias}: has an unfinished replacement state. Open Goliath Core once to run automatic recovery, then try again.`);
  }

  try {
    created = await manager.create({ attachment, name: temporaryName });
    await manager.edit(existing.id, { name: backupName });
    originalStaged = true;

    try {
      const renamed = await manager.edit(created.id, { name: targetName });
      await manager.delete(existing.id);
      return {
        emoji: serialise(renamed),
        replaced: serialise(existing),
      };
    } catch (swapError) {
      let restoreError = null;
      if (originalStaged) {
        try { await manager.edit(existing.id, { name: targetName }); }
        catch (error) { restoreError = error; }
      }
      if (created?.id) {
        try { await manager.delete(created.id); } catch (_) { /* best-effort cleanup */ }
      }
      if (restoreError) {
        const error = new Error(`Core emoji replacement failed and automatic rollback could not restore :${alias}:. ${swapError?.message || 'Replacement failed.'}`);
        error.cause = restoreError;
        throw error;
      }
      throw swapError;
    }
  } catch (error) {
    if (!originalStaged && created?.id) {
      try { await manager.delete(created.id); } catch (_) { /* best-effort cleanup */ }
    }
    throw error;
  }
}

async function importFromEmojiGG(client, emojiGgId, requestedName = null) {
  const manager = requireEmojiManager(client);
  const bank = await manager.fetch();
  const studioCount = [...bank.values()].filter((emoji) => !isCoreEmoji(emoji)).length;
  if (bank.size >= MAX_APPLICATION_EMOJIS) throw new Error('Emoji Studio application emoji pool is full (2,000/2,000).');
  if (studioCount >= MAX_STUDIO_EMOJIS) {
    throw new Error(`Emoji Studio pool is full (${MAX_STUDIO_EMOJIS}/${MAX_STUDIO_EMOJIS}); ${MAX_CORE_EMOJIS} slots are reserved for Goliath Core emojis.`);
  }

  const source = await emojiApi.findById(emojiGgId);
  if (!source) throw new Error('Emoji.gg emoji was not found.');
  const url = emojiApi.assetUrl(source);
  if (!url) throw new Error('Emoji.gg did not provide an image URL for this emoji.');
  const attachment = await emojiApi.downloadAsset(url);
  const rawName = requestedName || source.title || source.slug || `emoji_${source.id}`;
  const name = cleanEmojiName(rawName, `emoji_${String(source.id).slice(-8)}`);
  if (isCoreEmojiName(name)) throw new Error(`Names beginning with ${CORE_EMOJI_PREFIX} are reserved for Goliath Core emojis.`);

  const duplicate = [...bank.values()].find((emoji) => emoji.name === name);
  if (duplicate) return { emoji: serialise(duplicate), created: false, sourceId: String(source.id) };

  const created = await manager.create({ attachment, name });
  return { emoji: serialise(created), created: true, sourceId: String(source.id) };
}

async function removeFromBank(client, emojiId, options = {}) {
  const manager = requireEmojiManager(client);
  const emoji = await manager.fetch(String(emojiId));
  if (!emoji) throw new Error('Application emoji was not found.');
  if (isCoreEmoji(emoji) && options.allowCore !== true) throw new Error('Goliath Core emojis are protected from normal Emoji Studio deletion.');
  await manager.delete(emoji.id);
  return true;
}

async function renameInBank(client, emojiId, name, options = {}) {
  const manager = requireEmojiManager(client);
  const existing = await manager.fetch(String(emojiId));
  if (!existing) throw new Error('Application emoji was not found.');
  if (isCoreEmoji(existing) && options.allowCore !== true) throw new Error('Goliath Core emojis are protected from normal Emoji Studio renaming.');

  const clean = cleanEmojiName(name);
  if (!clean) throw new Error('Emoji name is required.');
  if (isCoreEmoji(existing) && options.allowCore === true) {
    const alias = isCoreEmojiName(clean) ? coreAlias(clean) : clean;
    if (!CORE_EMOJI_ALIAS_SET.has(alias)) throw new Error(`Unknown Goliath Core emoji alias: ${alias}.`);
    const targetName = `${CORE_EMOJI_PREFIX}${alias}`;
    const bank = await manager.fetch();
    const collision = [...bank.values()].find((emoji) => String(emoji.id) !== String(existing.id) && String(emoji.name).toLowerCase() === targetName);
    if (collision) throw new Error(`Goliath Core alias :${alias}: is already installed.`);
    const edited = await manager.edit(String(emojiId), { name: targetName });
    return serialise(edited);
  }
  if (isCoreEmojiName(clean) && options.allowCore !== true) throw new Error(`Names beginning with ${CORE_EMOJI_PREFIX} are reserved for Goliath Core emojis.`);
  const edited = await manager.edit(String(emojiId), { name: clean });
  return serialise(edited);
}

function render(emoji, fallback = '') {
  if (!emoji?.id || !emoji?.name) return fallback;
  return `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`;
}

function findByReference(bank, reference) {
  const wanted = String(reference || '').trim();
  if (!wanted) return null;

  if (/^\d{16,20}$/.test(wanted)) return bank.get(wanted) || null;

  const mentionMatch = wanted.match(/^<a?:([^:>]+):(\d{16,20})>$/);
  if (mentionMatch) return bank.get(mentionMatch[2]) || null;

  const name = wanted.replace(/^:+|:+$/g, '').toLowerCase();
  return [...bank.values()].find((entry) => {
    const entryName = String(entry.name || '').toLowerCase();
    return entryName === name || (isCoreEmojiName(entryName) && coreAlias(entryName) === name);
  }) || null;
}

async function resolveGuildEmoji(client, guildId, reference) {
  const section = emojiStore.getSection(guildId);
  const bank = await requireEmojiManager(client).fetch();
  const emoji = findByReference(bank, reference);
  if (!emoji) return null;
  if (isCoreEmoji(emoji)) {
    if (!CORE_EMOJI_ALIAS_SET.has(coreAlias(emoji.name))) return null;
    return serialise(emoji);
  }
  if (!section.enabled) return null;

  const favourites = new Set(section.favourites.map(String));
  if (!favourites.has(String(emoji.id))) return null;
  return serialise(emoji);
}

async function allowedGuildEmojis(client, guildId) {
  const section = emojiStore.getSection(guildId);
  const bank = await requireEmojiManager(client).fetch();
  const selected = new Set(section.favourites.map(String));
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
    if (section.enabled && selected.has(String(emoji.id))) allowed.set(name, emoji);
  }
  return allowed;
}

function replaceShortcodes(value, allowedByName) {
  const text = String(value || '');
  if (!text || !allowedByName?.size) return text;
  return text.replace(/:([a-zA-Z0-9_]{2,32}):/g, (match, name, offset, source) => {
    const prefix = source.slice(Math.max(0, offset - 2), offset);
    if (prefix.endsWith('<') || prefix === '<a') return match;
    const emoji = allowedByName.get(String(name).toLowerCase());
    return emoji ? render(emoji, match) : match;
  });
}

async function resolveText(client, guildId, value) {
  if (value == null) return value;
  const allowed = await allowedGuildEmojis(client, guildId);
  return replaceShortcodes(value, allowed);
}

async function resolveEmbedData(client, guildId, embed) {
  const data = typeof embed?.toJSON === 'function' ? embed.toJSON() : embed;
  if (!data || typeof data !== 'object') return embed;
  const allowed = await allowedGuildEmojis(client, guildId);
  if (!allowed.size) return data;

  const resolved = { ...data };
  if (data.title != null) resolved.title = replaceShortcodes(data.title, allowed);
  if (data.description != null) resolved.description = replaceShortcodes(data.description, allowed);
  if (data.author && typeof data.author === 'object') resolved.author = { ...data.author, name: replaceShortcodes(data.author.name, allowed) };
  if (data.footer && typeof data.footer === 'object') resolved.footer = { ...data.footer, text: replaceShortcodes(data.footer.text, allowed) };
  if (Array.isArray(data.fields)) {
    resolved.fields = data.fields.map((field) => ({
      ...field,
      name: replaceShortcodes(field?.name, allowed),
      value: replaceShortcodes(field?.value, allowed),
    }));
  }
  return resolved;
}

async function resolveEmbeds(client, guildId, embeds = []) {
  const allowed = await allowedGuildEmojis(client, guildId);
  if (!allowed.size) return embeds;
  return (embeds || []).map((embed) => {
    const data = typeof embed?.toJSON === 'function' ? embed.toJSON() : embed;
    if (!data || typeof data !== 'object') return embed;
    const resolved = { ...data };
    if (data.title != null) resolved.title = replaceShortcodes(data.title, allowed);
    if (data.description != null) resolved.description = replaceShortcodes(data.description, allowed);
    if (data.author && typeof data.author === 'object') resolved.author = { ...data.author, name: replaceShortcodes(data.author.name, allowed) };
    if (data.footer && typeof data.footer === 'object') resolved.footer = { ...data.footer, text: replaceShortcodes(data.footer.text, allowed) };
    if (Array.isArray(data.fields)) {
      resolved.fields = data.fields.map((field) => ({
        ...field,
        name: replaceShortcodes(field?.name, allowed),
        value: replaceShortcodes(field?.value, allowed),
      }));
    }
    return resolved;
  });
}

async function renderForGuild(client, guildId, reference, fallback = '') {
  const emoji = await resolveGuildEmoji(client, guildId, reference);
  return render(emoji, fallback);
}

async function componentEmojiForGuild(client, guildId, reference) {
  const emoji = await resolveGuildEmoji(client, guildId, reference);
  return componentPayload(emoji);
}

module.exports = {
  MAX_APPLICATION_EMOJIS,
  MAX_CORE_EMOJIS,
  MAX_STUDIO_EMOJIS,
  CORE_EMOJI_PREFIX,
  CORE_EMOJI_ALIASES,
  isCoreEmojiName,
  isCoreEmoji,
  coreAlias,
  isApprovedCoreAlias,
  recoverCoreArtifacts,
  listBank,
  overview,
  createCoreEmoji,
  replaceCoreEmoji,
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
};
