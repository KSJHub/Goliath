'use strict';

const { AttachmentBuilder } = require('discord.js');
const sharp = require('sharp');
const mediaStore = require('./embedMedia');

const CANVAS_WIDTH = 600;
const VISIBLE_WIDTH = 320;
const PANEL_BG = { r: 19, g: 20, b: 22, alpha: 1 };
const VALID = new Set(['left', 'center', 'right']);

function nameOf(file, fallback) {
  return String(file?.name || file?.data?.name || `embed-panel-${fallback + 1}.png`);
}
function panelIndex(file, fallback) {
  const match = nameOf(file, fallback).match(/^embed-panel-(\d+)\.png$/i);
  return match ? Math.max(0, Number(match[1]) - 1) : fallback;
}
function alignmentOf(item) {
  const value = String(item?.alignment || 'left').toLowerCase();
  return VALID.has(value) ? value : 'left';
}
async function alignedAttachment(item, name) {
  const cached = await mediaStore.ensureAssetCached('global', String(item.source || ''));
  if (!cached?.buffer) return null;
  const trimmed = await sharp(cached.buffer, { failOn: 'warning' })
    .ensureAlpha()
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer();
  const visible = await sharp(trimmed, { failOn: 'warning' })
    .resize({ width: VISIBLE_WIDTH, height: VISIBLE_WIDTH, fit: 'inside', withoutEnlargement: false })
    .ensureAlpha().png().toBuffer();
  const meta = await sharp(visible).metadata();
  const width = Number(meta.width || VISIBLE_WIDTH);
  const height = Number(meta.height || VISIBLE_WIDTH);
  const alignment = alignmentOf(item);
  const left = alignment === 'right'
    ? Math.max(0, CANVAS_WIDTH - width)
    : alignment === 'center'
      ? Math.max(0, Math.floor((CANVAS_WIDTH - width) / 2))
      : 0;
  const output = await sharp({ create: { width: CANVAS_WIDTH, height, channels: 4, background: PANEL_BG } })
    .composite([{ input: visible, left, top: 0 }]).png().toBuffer();
  return new AttachmentBuilder(output, { name });
}

function installFinalImageAlignment(renderer) {
  if (!renderer || renderer.__finalImageAlignmentInstalled || typeof renderer.buildEmbedPayload !== 'function') return renderer;
  const original = renderer.buildEmbedPayload.bind(renderer);
  renderer.buildEmbedPayload = async (options = {}) => {
    const payload = await original(options);
    const media = options.media || options.mediaV2 || {};
    if (!Array.isArray(payload?.files) || !payload.files.length) return payload;
    payload.files = await Promise.all(payload.files.map(async (file, fallback) => {
      const index = panelIndex(file, fallback);
      const item = media?.panels?.[index]?.gallery?.[0];
      if (!item?.source || item?.type === 'video' || item?.spoiler === true || String(item?.placement || 'below').toLowerCase() === 'above') return file;
      try {
        return await alignedAttachment(item, nameOf(file, fallback)) || file;
      } catch (error) {
        console.warn(`[Embed Renderer] Final alignment enforcement failed for panel ${index + 1}:`, error?.message || error);
        return file;
      }
    }));
    return payload;
  };
  renderer.__finalImageAlignmentInstalled = true;
  console.log('[Embed Renderer] Final Left/Centre/Right alignment enforcement installed.');
  return renderer;
}

module.exports = { installFinalImageAlignment };
