'use strict';

const fs = require('node:fs');

const { TOOL_PRESETS } = require('../mediaConfig');

function optionalSharp() {
  try {
    return require('sharp');
  } catch {
    return null;
  }
}

function normalizeSize(value, fallback) {
  const size = Number(value);
  if (!Number.isFinite(size)) return fallback;
  return Math.min(512, Math.max(32, Math.round(size)));
}

function getEmojiProcessorStatus() {
  const available = Boolean(optionalSharp());
  return {
    key: 'sharp',
    label: 'Sharp',
    available,
    requiredFor: ['emoji resizing', 'role icon resizing', 'PNG/WebP export', 'edge sharpening'],
    warning: available ? null : 'Sharp is not installed. Emoji Maker will save the original upload as a fallback.',
  };
}

async function createEmoji({ inputPath, outputPath, options = {} }) {
  const sharp = optionalSharp();
  const preset = String(options.preset || 'emoji');
  const size = normalizeSize(
    options.size,
    preset === 'roleIcon' ? TOOL_PRESETS.emoji.roleIconSize : TOOL_PRESETS.emoji.defaultSize,
  );
  const format = String(options.format || 'png').toLowerCase() === 'webp' ? 'webp' : 'png';

  if (!sharp) {
    fs.copyFileSync(inputPath, outputPath);
    return {
      outputPath,
      fallback: true,
      warning: 'Sharp is not installed. Original file was saved instead of resized.',
    };
  }

  let pipeline = sharp(inputPath, { animated: true })
    .resize(size, size, { fit: 'cover' })
    .sharpen();

  if (format === 'webp') {
    pipeline = pipeline.webp({ quality: 90 });
  } else {
    pipeline = pipeline.png({ compressionLevel: 9 });
  }

  await pipeline.toFile(outputPath);
  return { outputPath, fallback: false, size, format };
}

module.exports = {
  createEmoji,
  getEmojiProcessorStatus,
};
