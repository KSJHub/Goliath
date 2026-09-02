'use strict';

const dns = require('node:dns').promises;
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const path = require('node:path');
const fetch = require('node-fetch');
const emojiProcessor = require('../../../core/mediaTools/emojiMaker/emojiProcessor');

const API_URL = 'https://emoji.gg/api';
const MAX_BYTES = 256 * 1024;
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const CATALOGUE_CACHE_MS = 60 * 1000;
const CORE_ASSET_DIR = path.join(__dirname, 'assets');
const SUPPORTED_CORE_ASSET_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

let catalogueCache = { expiresAt: 0, data: null, pending: null };

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

function isPrivateIpv4(address) {
  const parts = String(address).split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224;
}

function isPrivateIpv6(address) {
  const value = String(address || '').toLowerCase().split('%')[0];
  if (!value || value === '::' || value === '::1') return true;
  if (value.startsWith('fc') || value.startsWith('fd') || /^fe[89ab]/.test(value)) return true;
  if (value.startsWith('::ffff:')) {
    const mapped = value.slice(7);
    return net.isIP(mapped) === 4 ? isPrivateIpv4(mapped) : true;
  }
  return false;
}

function isPrivateAddress(address) {
  const family = net.isIP(String(address || ''));
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return true;
}

async function validateRemoteUrl(rawUrl) {
  let parsed;
  try { parsed = new URL(String(rawUrl || '').trim()); }
  catch { throw new Error('Invalid emoji asset URL.'); }

  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Emoji links must use http or https.');
  if (parsed.username || parsed.password) throw new Error('Emoji links cannot contain credentials.');
  if (parsed.port && !['80', '443'].includes(parsed.port)) throw new Error('Emoji links can only use standard web ports.');

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('Emoji links cannot target local network hosts.');
  }

  let addresses;
  if (net.isIP(hostname)) {
    addresses = [{ address: hostname, family: net.isIP(hostname) }];
  } else {
    try { addresses = await dns.lookup(hostname, { all: true, verbatim: true }); }
    catch { throw new Error('Emoji link hostname could not be resolved.'); }
  }

  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error('Emoji links cannot target private, loopback, link-local, or reserved network addresses.');
  }

  return { parsed, addresses };
}

function pinnedAgent(parsed, addresses) {
  const selected = addresses[0];
  const Agent = parsed.protocol === 'https:' ? https.Agent : http.Agent;
  return new Agent({
    lookup(hostname, options, callback) {
      callback(null, selected.address, selected.family);
    },
  });
}

async function safeFetch(rawUrl, options = {}, redirects = 0) {
  if (redirects > MAX_REDIRECTS) throw new Error(`Emoji download exceeded ${MAX_REDIRECTS} redirects.`);
  const { parsed, addresses } = await validateRemoteUrl(rawUrl);
  const response = await fetch(parsed.toString(), {
    ...options,
    redirect: 'manual',
    agent: pinnedAgent(parsed, addresses),
  });

  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get('location');
    if (!location) throw new Error(`Emoji download redirect (${response.status}) did not include a destination.`);
    const nextUrl = new URL(location, parsed).toString();
    return safeFetch(nextUrl, options, redirects + 1);
  }

  return response;
}

async function requestJson(url) {
  const response = await safeFetch(url, {
    headers: {
      'User-Agent': 'KSJHub-Goliath/1.0 (+https://github.com/KSJHub/Goliath)',
      Accept: 'application/json',
    },
    timeout: 15000,
  });
  if (!response.ok) throw new Error(`Emoji.gg request failed (${response.status})`);
  return response.json();
}

async function fetchCatalogue(options = {}) {
  const now = Date.now();
  if (!options.force && Array.isArray(catalogueCache.data) && catalogueCache.expiresAt > now) return catalogueCache.data;
  if (!options.force && catalogueCache.pending) return catalogueCache.pending;

  const pending = requestJson(API_URL)
    .then((data) => {
      const catalogue = Array.isArray(data) ? data : [];
      catalogueCache = { data: catalogue, expiresAt: Date.now() + CATALOGUE_CACHE_MS, pending: null };
      return catalogue;
    })
    .catch((error) => {
      catalogueCache.pending = null;
      throw error;
    });
  catalogueCache.pending = pending;
  return pending;
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
  const maxBytes = Math.max(MAX_BYTES, Math.min(MAX_SOURCE_BYTES, Number(options.maxBytes) || MAX_BYTES));
  const response = await safeFetch(url, { headers: { 'User-Agent': 'KSJHub-Goliath/1.0' }, timeout: 15000 });
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
  CATALOGUE_CACHE_MS,
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
  validateRemoteUrl,
};
