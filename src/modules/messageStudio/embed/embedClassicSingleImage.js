'use strict';

const { AttachmentBuilder } = require('discord.js');
const fetch = require('node-fetch');
const net = require('node:net');
const sharp = require('sharp');

const CANVAS_WIDTH = 600;
const VISIBLE_WIDTH = 320;
const PANEL_BG = { r: 19, g: 20, b: 22, alpha: 1 };
const FETCH_TIMEOUT_MS = 8000;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

function hasAdvancedMedia(mediaState) {
  const panels = Array.isArray(mediaState?.panels) ? mediaState.panels : [];
  return panels.some((media) => {
    const gallery = Array.isArray(media?.gallery) ? media.gallery : [];
    const first = gallery[0] || {};
    const files = Array.isArray(media?.files) ? media.files : [];
    return gallery.length > 1
      || first.type === 'video'
      || first.spoiler === true
      || Boolean(first.alt)
      || Boolean(media?.thumbnail?.alt)
      || files.length > 0;
  });
}

function panelSource(mediaState, panelIndex) {
  const panels = Array.isArray(mediaState?.panels) ? mediaState.panels : [];
  return String(panels[panelIndex]?.gallery?.[0]?.source || '').trim();
}

function attachmentName(file, fallbackIndex) {
  return String(file?.name || file?.data?.name || `embed-panel-${fallbackIndex + 1}.png`).trim();
}

function panelIndexFromAttachment(file, fallbackIndex) {
  const match = attachmentName(file, fallbackIndex).match(/^embed-panel-(\d+)\.png$/i);
  return match ? Math.max(0, Number(match[1]) - 1) : fallbackIndex;
}

function isPrivateIpv4(hostname) {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || a === 0;
}

function isPrivateIpv6(hostname) {
  const normalized = hostname.toLowerCase();
  return normalized === '::1'
    || normalized === '::'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('fe8')
    || normalized.startsWith('fe9')
    || normalized.startsWith('fea')
    || normalized.startsWith('feb');
}

function validateSourceUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ''));
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  const hostname = parsed.hostname.toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) return null;
  const ipVersion = net.isIP(hostname);
  if ((ipVersion === 4 && isPrivateIpv4(hostname)) || (ipVersion === 6 && isPrivateIpv6(hostname))) return null;
  return parsed.toString();
}

async function fetchSourceBuffer(url) {
  const safeUrl = validateSourceUrl(url);
  if (!safeUrl) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  timer.unref?.();
  try {
    const response = await fetch(safeUrl, { signal: controller.signal, redirect: 'error' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const type = String(response.headers.get('content-type') || '').toLowerCase();
    if (type && !type.startsWith('image/')) throw new Error(`Unsupported type ${type}`);
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > MAX_SOURCE_BYTES) throw new Error('Image exceeds 8 MB.');
    const buffer = await response.buffer();
    if (buffer.length > MAX_SOURCE_BYTES) throw new Error('Image exceeds 8 MB.');
    return buffer;
  } finally {
    clearTimeout(timer);
  }
}

async function buildCenteredGalleryAttachment(sourceUrl, name) {
  const sourceBuffer = await fetchSourceBuffer(sourceUrl);
  if (!sourceBuffer) return null;

  // Center the visible artwork, not the source file's outer bounds. Uploaded
  // PNGs often contain unequal transparent padding, which makes a mathematically
  // centered source rectangle still look visibly off-center in Discord.
  const trimmed = await sharp(sourceBuffer, { failOn: 'warning' })
    .ensureAlpha()
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const meta = await sharp(trimmed).metadata();
  const width = Number(meta.width || 0);
  const height = Number(meta.height || 0);
  if (!width || !height) return null;

  const visible = await sharp(trimmed, { failOn: 'warning' })
    .resize({
      width: VISIBLE_WIDTH,
      height: VISIBLE_WIDTH,
      fit: 'inside',
      withoutEnlargement: false,
    })
    .ensureAlpha()
    .png()
    .toBuffer();

  const visibleMeta = await sharp(visible).metadata();
  const visibleWidth = Number(visibleMeta.width || VISIBLE_WIDTH);
  const visibleHeight = Number(visibleMeta.height || VISIBLE_WIDTH);
  const left = Math.floor((CANVAS_WIDTH - visibleWidth) / 2);

  const centered = await sharp({
    create: {
      width: CANVAS_WIDTH,
      height: visibleHeight,
      channels: 4,
      background: PANEL_BG,
    },
  })
    .composite([{ input: visible, left, top: 0 }])
    .png()
    .toBuffer();

  return new AttachmentBuilder(centered, { name });
}

function installClassicSingleImagePayload(renderer) {
  if (!renderer || renderer.__classicSingleImagePayloadInstalled) return renderer;
  if (typeof renderer.buildEmbedPayload !== 'function') return renderer;

  const originalBuildEmbedPayload = renderer.buildEmbedPayload.bind(renderer);

  renderer.buildEmbedPayload = async function centeredMediaManagerGallery(options = {}) {
    const mediaState = options.media || options.mediaV2 || null;
    const payload = await originalBuildEmbedPayload(options);

    // Media Manager single-image gallery path only. Rebuild the attachment from
    // the stored gallery source rather than trying to mutate AttachmentBuilder
    // internals. The Components V2 container stays untouched/full width.
    if (!hasAdvancedMedia(mediaState) && Array.isArray(payload?.files) && payload.files.length) {
      payload.files = await Promise.all(payload.files.map(async (file, fallbackIndex) => {
        const panelIndex = panelIndexFromAttachment(file, fallbackIndex);
        const sourceUrl = panelSource(mediaState, panelIndex);
        if (!sourceUrl) return file;
        try {
          return await buildCenteredGalleryAttachment(
            sourceUrl,
            attachmentName(file, fallbackIndex),
          ) || file;
        } catch (error) {
          console.warn(`[Embed Renderer] Media gallery centering failed for panel ${panelIndex + 1}:`, error?.message || error);
          return file;
        }
      }));
    }

    return payload;
  };

  renderer.__classicSingleImagePayloadInstalled = true;
  console.log('[Embed Renderer] Media Manager visible-artwork centering installed.');
  return renderer;
}

module.exports = { installClassicSingleImagePayload };
