'use strict';

const fs = require('fs');
const fetch = require('node-fetch');

const emojiApi = require('../../modules/utilityStudio/emojis/emojisApi');
const emojis = require('../../modules/utilityStudio/emojis/emojis');

const REQUEST_OPTIONS = {
  headers: { 'User-Agent': 'KSJHub-Goliath/1.0' },
  timeout: 15000,
};

async function downloadEmoji(emoji) {
  const url = emoji?.imageURL?.({ extension: 'png', size: 128 }) || emoji?.url;
  if (!url) return null;

  const response = await fetch(url, REQUEST_OPTIONS);
  if (!response.ok) {
    throw new Error(`emoji download failed (${response.status})`);
  }

  return response.buffer();
}

async function normalizedPixels(buffer) {
  let sharp = null;
  try {
    sharp = require('sharp');
  } catch (_) {}

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
  if (!left || !right || left.length !== right.length) {
    return Number.POSITIVE_INFINITY;
  }

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

  if (!currentPixels || !canonicalPixels) return false;

  return meanPixelDifference(currentPixels, canonicalPixels) <= 2;
}

async function repairCoreArtwork(client) {
  const manager = client?.application?.emojis;

  if (!manager) {
    return {
      checked: 0,
      repaired: [],
      unchanged: [],
      missing: [],
      failed: [],
    };
  }

  await emojis.recoverCoreArtifacts(client);

  const files = emojiApi.listCoreAssetFiles();
  let bank = await manager.fetch();

  const result = {
    checked: 0,
    repaired: [],
    unchanged: [],
    missing: [],
    failed: [],
  };

  for (const alias of emojis.CORE_EMOJI_ALIASES) {
    result.checked += 1;

    try {
      const targetName = `${emojis.CORE_EMOJI_PREFIX}${alias}`.toLowerCase();

      const target = [...bank.values()].find(
        (emoji) => String(emoji?.name || '').toLowerCase() === targetName,
      );

      if (!target) {
        result.missing.push(alias);
        continue;
      }

      const asset = emojiApi.coreAssetForAlias(alias, files);

      if (!asset || !fs.existsSync(asset.path)) {
        result.missing.push(alias);
        continue;
      }

      const [currentArtwork, canonicalArtwork] = await Promise.all([
        downloadEmoji(target),
        fs.promises.readFile(asset.path),
      ]);

      if (!currentArtwork) {
        throw new Error('installed emoji artwork could not be downloaded');
      }

      if (await isCanonicalArtwork(currentArtwork, canonicalArtwork)) {
        result.unchanged.push(alias);
        continue;
      }

      const replacement = await emojis.replaceCoreEmoji(
        client,
        alias,
        canonicalArtwork,
      );

      result.repaired.push({
        alias,
        previousEmojiId: replacement.previousEmojiId,
        emojiId: replacement.emoji.id,
      });

      // replaceCoreEmoji changes the application emoji bank, so refresh before
      // checking the next alias.
      bank = await manager.fetch();
    } catch (error) {
      result.failed.push({
        alias,
        error: String(error?.message || error),
      });
    }
  }

  return result;
}

module.exports = {
  repairCoreArtwork,
};
