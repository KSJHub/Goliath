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

async function prepareEmojiBuffer(input, options = {}) {
  const source = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
  if (!source.length) throw new Error('Emoji image buffer is empty.');

  const sharp = optionalSharp();
  if (!sharp) {
    return {
      buffer: source,
      processed: false,
      animated: false,
      warning: 'Sharp is not installed; the original image was returned unchanged.',
    };
  }

  const size = normalizeSize(options.size, 512);
  const padding = Math.min(Math.floor(size / 4), Math.max(0, Math.round(Number(options.padding ?? 32))));
  const contentSize = Math.max(32, size - (padding * 2));
  const maxBytes = Math.max(0, Math.round(Number(options.maxBytes ?? 262144)));
  const metadata = await sharp(source, { animated: true }).metadata();
  const animated = Number(metadata.pages || 1) > 1;

  // Preserve animated uploads rather than flattening them into a static PNG.
  if (animated) {
    return {
      buffer: source,
      processed: false,
      animated: true,
      size: metadata.width || null,
      format: metadata.format || null,
      warning: 'Animated emoji was preserved unchanged so animation is not lost.',
    };
  }

  const transparent = { r: 0, g: 0, b: 0, alpha: 0 };
  const trimmed = await sharp(source)
    .ensureAlpha()
    .trim({ background: transparent })
    .png()
    .toBuffer();

  // Prefer the full 512x512 transparent canvas. If PNG complexity pushes the
  // payload over Discord's application-emoji byte limit, progressively reduce
  // the artwork footprint while keeping the canvas centred and transparent.
  const scales = [1, 0.92, 0.84, 0.76, 0.68, 0.60, 0.52, 0.44];
  let buffer = null;
  let finalContentSize = contentSize;
  for (const scale of scales) {
    finalContentSize = Math.max(32, Math.floor(contentSize * scale));
    const left = Math.floor((size - finalContentSize) / 2);
    const right = size - finalContentSize - left;
    buffer = await sharp(trimmed)
      .resize(finalContentSize, finalContentSize, {
        fit: 'contain',
        background: transparent,
        withoutEnlargement: false,
      })
      .extend({ top: left, bottom: right, left, right, background: transparent })
      .png({ compressionLevel: 9, adaptiveFiltering: true, palette: true, quality: 100, colours: 256, dither: 0.8 })
      .toBuffer();
    if (!maxBytes || buffer.length <= maxBytes) break;
  }

  if (maxBytes && buffer.length > maxBytes) {
    throw new Error(`processed image is ${buffer.length} bytes after adaptive compression; Discord limit is ${maxBytes}`);
  }

  return {
    buffer,
    processed: true,
    animated: false,
    size,
    contentSize: finalContentSize,
    padding: Math.floor((size - finalContentSize) / 2),
    format: 'png',
    bytes: buffer.length,
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
  prepareEmojiBuffer,
  getEmojiProcessorStatus,
};
