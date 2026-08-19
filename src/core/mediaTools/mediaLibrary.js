'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { MEDIA_ROOT } = require('./mediaConfig');

function assertGuildId(guildId) {
  const clean = String(guildId || '').trim();
  if (!/^\d{15,25}$/.test(clean)) throw new Error('Invalid guild ID.');
  return clean;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function getGuildMediaRoot(guildId) {
  const cleanGuildId = assertGuildId(guildId);
  return ensureDir(path.join(MEDIA_ROOT, cleanGuildId, 'media'));
}

function getToolDir(guildId, tool, bucket = 'outputs') {
  const cleanTool = String(tool || '').replace(/[^a-zA-Z0-9_-]/g, '');
  const cleanBucket = String(bucket || 'outputs').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!cleanTool) throw new Error('Invalid media tool.');
  return ensureDir(path.join(getGuildMediaRoot(guildId), cleanTool, cleanBucket));
}

function getLibraryPath(guildId) {
  return path.join(getGuildMediaRoot(guildId), 'library.json');
}

function readLibrary(guildId) {
  const libraryPath = getLibraryPath(guildId);
  if (!fs.existsSync(libraryPath)) return { guildId: assertGuildId(guildId), assets: [] };

  try {
    const parsed = JSON.parse(fs.readFileSync(libraryPath, 'utf8'));
    return {
      guildId: assertGuildId(guildId),
      assets: Array.isArray(parsed.assets) ? parsed.assets : [],
    };
  } catch {
    return { guildId: assertGuildId(guildId), assets: [] };
  }
}

function writeLibrary(guildId, library) {
  const payload = {
    guildId: assertGuildId(guildId),
    updatedAt: new Date().toISOString(),
    assets: Array.isArray(library.assets) ? library.assets.slice(0, 250) : [],
  };
  fs.writeFileSync(getLibraryPath(guildId), JSON.stringify(payload, null, 2));
  return payload;
}

function addAsset(guildId, asset) {
  const library = readLibrary(guildId);
  const cleanGuildId = assertGuildId(guildId);
  const nextAsset = {
    ...asset,
    id: asset?.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    guildId: cleanGuildId,
    createdAt: asset?.createdAt || new Date().toISOString(),
  };

  const assets = [nextAsset, ...library.assets.filter((item) => item.id !== nextAsset.id)];
  return { asset: nextAsset, library: writeLibrary(guildId, { assets }) };
}

function removeAsset(guildId, assetId) {
  const library = readLibrary(guildId);
  const asset = library.assets.find((item) => item.id === assetId) || null;
  const assets = library.assets.filter((item) => item.id !== assetId);
  return { asset, library: writeLibrary(guildId, { assets }) };
}

function findAsset(guildId, assetId) {
  return readLibrary(guildId).assets.find((asset) => asset.id === assetId) || null;
}

module.exports = {
  assertGuildId,
  ensureDir,
  getGuildMediaRoot,
  getToolDir,
  readLibrary,
  writeLibrary,
  addAsset,
  removeAsset,
  findAsset,
};
