'use strict';

const fs = require('node:fs');
const path = require('node:path');
const fetch = require('node-fetch');
const emojiProcessor = require('../../../core/mediaTools/emojiMaker/emojiProcessor');

const API_URL = 'https://emoji.gg/api';
const MAX_BYTES = 256 * 1024;
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const CORE_ASSET_DIR = path.join(__dirname, 'assets');
const SUPPORTED_CORE_ASSET_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

const CORE_FILENAME_PATTERNS = Object.freeze({
  activision: /\b(?:actiid|activid|activision)\b/,
  blizzard: /\bblizzard\b/,
  discord: /\bdiscord\b/,
  epic: /\bepic\b/,
  facebook: /\b(?:facebook|fb)\b/,
  instagram: /\b(?:instagram|insta)\b/,
  kick: /\bkick\b/,
  nintendo: /\b(?:nintendo|nswitch|switch)\b/,
  pc: /\bpc\b/,
  playstation: /\b(?:playstation|ps)\b/,
  snapchat: /\b(?:snapchat|snap)\b/,
  steam: /\bsteam\b/,
  tiktok: /\btik\s*tok\b/,
  twitch: /\btwitch\b/,
  whatsapp: /\bwhats\s*app\b/,
  x: /\b(?:twitter|x)\b/,
  xbox: /\bxbox\b/,
  youtube: /\b(?:youtube|yt)\b/,
});

async function requestJson(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'KSJHub-Goliath/1.0 (+https://github.com/KSJHub/Goliath)',
      Accept: 'application/json',
    },
    timeout: 15000,
  });
  if (!response.ok) throw new Error(`Emoji.gg request failed (${response.status})`);
  return response.json();
}

async function fetchCatalogue() {
  const data = await requestJson(API_URL);
  return Array.isArray(data) ? data : [];
}

function normaliseId(value) { return String(value || '').trim().replace(/[^0-9]/g, ''); }

async function findById(id) {
  const wanted = normaliseId(id);
  if (!wanted) return null;
  const catalogue = await fetchCatalogue();
  return catalogue.find((entry) => String(entry.id) === wanted) || null;
}

async function search(query, limit = 25) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return [];
  const catalogue = await fetchCatalogue();
  return catalogue
    .filter((entry) => [entry.title, entry.slug, entry.category, entry.id].filter(Boolean).join(' ').toLowerCase().includes(needle))
    .slice(0, Math.max(1, Math.min(Number(limit) || 25, 25)));
}

function assetUrl(entry) { return entry ? (entry.image || entry.url || entry.src || null) : null; }

async function downloadAsset(url, options = {}) {
  if (!url || !/^https?:\/\//i.test(url)) throw new Error('Invalid emoji asset URL.');
  const maxBytes = Math.max(MAX_BYTES, Math.min(MAX_SOURCE_BYTES, Number(options.maxBytes) || MAX_BYTES));
  const response = await fetch(url, { headers: { 'User-Agent': 'KSJHub-Goliath/1.0' }, timeout: 15000 });
  if (!response.ok) throw new Error(`Emoji download failed (${response.status})`);
  const contentLength = Number(response.headers.get('content-length')) || 0;
  if (contentLength > maxBytes) throw new Error(`Emoji source is too large (${contentLength} bytes; max ${maxBytes}).`);
  const buffer = await response.buffer();
  if (!buffer.length) throw new Error('Emoji asset was empty.');
  if (buffer.length > maxBytes) throw new Error(`Emoji source is too large (${buffer.length} bytes; max ${maxBytes}).`);
  return buffer;
}

async function prepareDownloadedAsset(url, options = {}) {
  const source = await downloadAsset(url, { maxBytes: options.maxSourceBytes || MAX_SOURCE_BYTES });
  const prepared = await emojiProcessor.prepareEmojiBuffer(source, {
    size: options.size || 512,
    padding: options.padding ?? 32,
    maxBytes: MAX_BYTES,
  });
  if (prepared.buffer.length > MAX_BYTES) throw new Error(`Processed emoji is too large (${prepared.buffer.length} bytes; Discord limit ${MAX_BYTES}).`);
  return prepared;
}

function normaliseCoreFilename(filename) {
  return path.basename(String(filename || ''), path.extname(String(filename || '')))
    .toLowerCase().replace(/[_-]+/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function listCoreAssetFiles() {
  if (!fs.existsSync(CORE_ASSET_DIR)) return [];
  return fs.readdirSync(CORE_ASSET_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && SUPPORTED_CORE_ASSET_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => ({ name: entry.name, path: path.join(CORE_ASSET_DIR, entry.name), normalised: normaliseCoreFilename(entry.name) }));
}

function coreAssetForAlias(alias, files = listCoreAssetFiles()) {
  const wanted = String(alias || '').trim().toLowerCase();
  if (!wanted) return null;
  const exact = files.find((entry) => entry.normalised === wanted);
  if (exact) return exact;
  const pattern = CORE_FILENAME_PATTERNS[wanted];
  return pattern ? (files.find((entry) => pattern.test(entry.normalised)) || null) : null;
}

async function syncCoreAssets(client, aliases = [], prefix = 'goliath_') {
  const manager = client?.application?.emojis;
  if (!manager) throw new Error('Discord application emoji manager is unavailable.');
  const catalog = [...new Set((aliases || []).map((value) => String(value || '').trim().toLowerCase()).filter(Boolean))];
  const files = listCoreAssetFiles();
  const bank = await manager.fetch();
  const byName = new Map([...bank.values()].filter((emoji) => emoji?.name).map((emoji) => [String(emoji.name).toLowerCase(), emoji]));
  const result = { assetDirectory: CORE_ASSET_DIR, assetDirectoryPresent: fs.existsSync(CORE_ASSET_DIR), sourceFiles: files.length, expected: catalog.length, alreadyInstalled: 0, created: [], missingAssets: [], failed: [] };

  for (const alias of catalog) {
    const discordName = `${String(prefix || 'goliath_')}${alias}`.slice(0, 32).toLowerCase();
    const existing = byName.get(discordName);
    if (existing) { result.alreadyInstalled += 1; continue; }
    const asset = coreAssetForAlias(alias, files);
    if (!asset) { result.missingAssets.push(alias); continue; }
    try {
      const source = fs.readFileSync(asset.path);
      const prepared = await emojiProcessor.prepareEmojiBuffer(source, { size: 512, padding: 32, maxBytes: MAX_BYTES });
      if (prepared.buffer.length > MAX_BYTES) throw new Error(`processed image is ${prepared.buffer.length} bytes; Discord limit is ${MAX_BYTES}`);
      const created = await manager.create({ attachment: prepared.buffer, name: discordName });
      byName.set(discordName, created);
      result.created.push({ alias, emojiId: String(created.id), source: asset.name });
    } catch (error) {
      result.failed.push({ alias, source: asset.name, error: String(error?.message || error) });
    }
  }

  result.installed = result.alreadyInstalled + result.created.length;
  result.healthy = result.installed === result.expected && result.failed.length === 0;
  return result;
}

module.exports = {
  API_URL,
  MAX_BYTES,
  MAX_SOURCE_BYTES,
  CORE_ASSET_DIR,
  fetchCatalogue,
  findById,
  search,
  assetUrl,
  downloadAsset,
  prepareDownloadedAsset,
  listCoreAssetFiles,
  coreAssetForAlias,
  syncCoreAssets,
};
