'use strict';

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { Events } = require('discord.js');

const emojiApi = require('../../modules/utilityStudio/emojis/emojisApi');
const emojis = require('../../modules/utilityStudio/emojis/emojis');
const emojiProcessor = require('../../core/mediaTools/emojiMaker/emojiProcessor');

const TARGET_ALIAS = 'discord';
const REQUEST_OPTIONS = {
  headers: { 'User-Agent': 'KSJHub-Goliath/1.0' },
  timeout: 15000,
};

function canonicalPath(alias) {
  return path.join(
    process.cwd(),
    'src',
    'modules',
    'utilityStudio',
    'emojis',
    'assets',
    `${alias}.png`,
  );
}

async function downloadEmoji(emoji) {
  // Application emoji CDN rendering is the source of truth for what Discord
  // currently displays. Fetch at the same working size used for comparison.
  const url = emoji?.imageURL?.({ extension: 'png', size: 128 }) || emoji?.url;
  if (!url) return null;
  const response = await fetch(url, REQUEST_OPTIONS);
  if (!response.ok) throw new Error(`emoji download failed (${response.status})`);
  return response.buffer();
}

async function normalizedPixels(buffer) {
  let sharp = null;
  try { sharp = require('sharp'); } catch (_) {}
  if (!sharp) return null;

  return sharp(buffer)
    .ensureAlpha()
    .resize(64, 64, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .raw()
    .toBuffer();
}

function meanPixelDifference(left, right) {
  if (!left || !right || left.length !== right.length) return Number.POSITIVE_INFINITY;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference += Math.abs(left[index] - right[index]);
  }
  return difference / left.length;
}

async function isCanonicalArtwork(current, canonical) {
  const [currentPixels, canonicalPixels] = await Promise.all([
    normalizedPixels(current),
    normalizedPixels(canonical),
  ]);

  // Sharp is part of Goliath's emoji processing path. If it is unavailable we
  // cannot safely compare artwork, so do not perform a destructive replacement.
  if (!currentPixels || !canonicalPixels) return false;

  // CDN re-encoding/resizing can change exact bytes and a small number of
  // pixels. A tiny mean-channel difference still represents the same artwork.
  return meanPixelDifference(currentPixels, canonicalPixels) <= 2;
}

async function repairDiscordArtwork(client) {
  const manager = client?.application?.emojis;
  if (!manager) return { repaired: false, reason: 'manager-unavailable' };

  await emojis.recoverCoreArtifacts(client);
  const bank = await manager.fetch();
  const targetName = `${emojis.CORE_EMOJI_PREFIX}${TARGET_ALIAS}`;
  const target = [...bank.values()].find(
    (emoji) => String(emoji?.name || '').toLowerCase() === targetName,
  );
  if (!target) return { repaired: false, reason: 'discord-core-emoji-missing' };

  const sourcePath = canonicalPath(TARGET_ALIAS);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Canonical Core asset is missing: ${sourcePath}`);
  }

  const [currentArtwork, canonicalArtwork] = await Promise.all([
    downloadEmoji(target),
    fs.promises.readFile(sourcePath),
  ]);
  if (!currentArtwork) return { repaired: false, reason: 'discord-image-unavailable' };

  if (await isCanonicalArtwork(currentArtwork, canonicalArtwork)) {
    return { repaired: false, reason: 'already-canonical' };
  }

  // The alias is fixed and the repository asset is authoritative. If the
  // installed :discord: artwork differs, repair that exact slot regardless of
  // which incorrect image was uploaded previously.
  const prepared = await emojiProcessor.prepareEmojiBuffer(canonicalArtwork, {
    size: 512,
    padding: 32,
    maxBytes: emojiApi.MAX_BYTES,
  });

  const result = await emojis.replaceCoreEmoji(client, TARGET_ALIAS, prepared.buffer);
  return { repaired: true, result };
}

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    try {
      const outcome = await repairDiscordArtwork(client);
      if (outcome.repaired) {
        console.log('[Emoji Core] Repaired noncanonical :discord: artwork from the canonical repo asset.');
      } else {
        console.log(`[Emoji Core] Discord artwork check: ${outcome.reason}.`);
      }
    } catch (error) {
      console.error('[Emoji Core] Automatic Discord artwork repair failed:', error?.message || error);
    }
  },
};
