'use strict';

const guildManager = require('../../core/guild/guildManager');

const PRESETS_DIR = null;

const presetCache = new Map();

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function normalizeGuildId(guildId) {
  const id = String(guildId || '').trim();

  if (!/^\d{16,20}$/.test(id)) {
    throw new Error(`Invalid guild ID: ${guildId}`);
  }

  return id;
}

function sanitizePresetName(name) {
  const safeName = String(name || '').trim();

  if (!safeName) {
    throw new Error('Preset name is required.');
  }

  return safeName
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .slice(0, 50);
}

function stripMeta(data = {}) {
  const cloned = clone(data);
  delete cloned.updatedAt;
  return cloned;
}

function loadPresets(guildId, options = {}) {
  const safeGuildId = normalizeGuildId(guildId);

  if (!options.forceReload && presetCache.has(safeGuildId)) {
    return clone(presetCache.get(safeGuildId));
  }

  const presets = guildManager.getEmbedPresets(safeGuildId) || {};
  presetCache.set(safeGuildId, clone(presets));

  return clone(presets);
}

function savePresets(guildId, data = {}) {
  const safeGuildId = normalizeGuildId(guildId);
  const presets = data && typeof data === 'object' && !Array.isArray(data) ? data : {};

  const nextData = {
    ...clone(presets),
    updatedAt: new Date().toISOString(),
  };

  guildManager.saveGuildSection(safeGuildId, 'embedPresets', nextData);
  presetCache.set(safeGuildId, clone(nextData));

  return clone(nextData);
}

function savePreset(guildId, name, embedData = {}) {
  const presetName = sanitizePresetName(name);
  const savedPreset = guildManager.saveEmbedPreset(guildId, presetName, embedData);
  presetCache.delete(normalizeGuildId(guildId));
  return clone(savedPreset);
}

function getPreset(guildId, name) {
  const presetName = sanitizePresetName(name);
  const preset = guildManager.getEmbedPreset(guildId, presetName);
  return preset && typeof preset === 'object' ? clone(preset) : null;
}

function getAllPresets(guildId) {
  return stripMeta(loadPresets(guildId));
}

function deletePreset(guildId, name) {
  const presetName = sanitizePresetName(name);
  const deleted = guildManager.deleteEmbedPreset(guildId, presetName);
  presetCache.delete(normalizeGuildId(guildId));
  return deleted;
}

function renamePreset(guildId, oldName, newName) {
  const currentName = sanitizePresetName(oldName);
  const nextName = sanitizePresetName(newName);
  const presets = stripMeta(loadPresets(guildId));

  if (!presets[currentName]) return null;
  if (presets[nextName]) throw new Error(`Preset "${nextName}" already exists.`);

  presets[nextName] = {
    ...clone(presets[currentName]),
    name: nextName,
    updatedAt: new Date().toISOString(),
  };

  delete presets[currentName];
  const saved = savePresets(guildId, presets);
  return clone(saved[nextName]);
}

function duplicatePreset(guildId, sourceName, duplicateName) {
  const sourcePresetName = sanitizePresetName(sourceName);
  const newPresetName = sanitizePresetName(duplicateName);
  const presets = stripMeta(loadPresets(guildId));

  if (!presets[sourcePresetName]) return null;
  if (presets[newPresetName]) throw new Error(`Preset "${newPresetName}" already exists.`);

  presets[newPresetName] = {
    ...clone(presets[sourcePresetName]),
    name: newPresetName,
    updatedAt: new Date().toISOString(),
  };

  const saved = savePresets(guildId, presets);
  return clone(saved[newPresetName]);
}

function reloadPresets(guildId) {
  const safeGuildId = normalizeGuildId(guildId);
  presetCache.delete(safeGuildId);

  if (typeof guildManager.reloadGuild === 'function') {
    guildManager.reloadGuild(safeGuildId);
  }

  return loadPresets(safeGuildId, { forceReload: true });
}

function clearPresetCache(guildId = null) {
  if (guildId) {
    presetCache.delete(normalizeGuildId(guildId));
    return;
  }

  presetCache.clear();
}

module.exports = {
  PRESETS_DIR,

  loadPresets,
  savePresets,

  savePreset,
  getPreset,
  getAllPresets,
  deletePreset,
  renamePreset,
  duplicatePreset,

  reloadPresets,
  clearPresetCache,
};
