'use strict';

const {
  AttachmentBuilder,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');
const fetch = require('node-fetch');
const path = require('node:path');
const sharp = require('sharp');
const { getCachedAsset, saveCachedAsset, ensureAssetCached } = require('./embedMedia');
const { replaceVars } = require('./embedPanel');
const emojis = require('../../utilityStudio/emojis/emojis');
const emojiPayload = require('../../utilityStudio/emojis/emojiPayload');

const CANVAS_WIDTH = 520;
const PORTRAIT_WIDTH = 320;
const PORTRAIT_SHIFT_RIGHT = 0;
const SINGLE_IMAGE_CANVAS_WIDTH = 900;
const SINGLE_IMAGE_VISIBLE_WIDTH = 520;
const GALLERY_IMAGE_WIDTHS = Object.freeze({
  small: 320,
  medium: 420,
  large: SINGLE_IMAGE_VISIBLE_WIDTH,
});

function galleryImageWidth(item) {
  const size = String(item?.size || 'large').toLowerCase();
  return GALLERY_IMAGE_WIDTHS[size] || SINGLE_IMAGE_VISIBLE_WIDTH;
}
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8000;
const STATIC_RASTER_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/avif', 'image/svg+xml']);
const NATIVE_IMAGE_TYPES = new Set(['image/gif']);
const LEGACY_TARGET_WIDTH = 520;
const LEGACY_PORTRAIT_VISIBLE_WIDTH = 520;
const LEGACY_PORTRAIT_RIGHT_INSET = 0;
const VALID_ALIGNMENTS = new Set(['left', 'center', 'right']);

function isHttpsUrl(value) { try { return new URL(String(value || '')).protocol === 'https:'; } catch { return false; } }
function resolveSource(value, interaction) { const resolved = interaction ? replaceVars(String(value || ''), interaction) : String(value || ''); return String(resolved || '').trim(); }
function interactionGuildId(interaction) { return String(interaction?.guildId || interaction?.guild?.id || 'global').trim() || 'global'; }
function contentTypeBase(value) { return String(value || '').toLowerCase().split(';')[0].trim(); }
function expectedTypeOk(contentType, expected = 'media') {
  const type = contentTypeBase(contentType); if (!type) return true;
  if (expected === 'thumbnail' || expected === 'image') return type.startsWith('image/');
  if (expected === 'video') return type.startsWith('video/');
  if (expected === 'media') return type.startsWith('image/') || type.startsWith('video/');
  return true;
}
function nativeImageShouldPassThrough(contentType) { const type = contentTypeBase(contentType); return NATIVE_IMAGE_TYPES.has(type) || (type.startsWith('image/') && !STATIC_RASTER_TYPES.has(type)); }
function cachedAssetFor(guildId, url) { return getCachedAsset(guildId || 'global', url) || (guildId !== 'global' ? getCachedAsset('global', url) : null); }
async function probeRemoteSource(url, expected = 'media', guildId = 'global') {
  if (!isHttpsUrl(url)) throw new Error(`Media source must resolve to a valid HTTPS URL: ${String(url || '').slice(0, 160)}`);
  const cached = cachedAssetFor(guildId, url);
  if (cached?.buffer) {
    const cachedType = cached.meta?.contentType || '';
    if (!expectedTypeOk(cachedType, expected)) throw new Error(`Media source returned ${cachedType || 'an unsupported type'} (expected=${expected}, branch=cache, source=${String(url).slice(0, 180)}).`);
    return { ok: true, contentType: cachedType, bytes: cached.buffer.length, cached: true };
  }
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS); timer.unref?.();
  try {
    let response = await fetch(url, { method: 'HEAD', signal: controller.signal, redirect: 'follow' });
    if (response.status === 405 || response.status === 403) response = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' }, signal: controller.signal, redirect: 'follow' });
    if (!response.ok && response.status !== 206) throw new Error(`Media source returned HTTP ${response.status}.`);
    const contentType = String(response.headers.get('content-type') || ''); const declared = Number(response.headers.get('content-length') || 0);
    if (!expectedTypeOk(contentType, expected)) throw new Error(`Media source returned ${contentType || 'an unsupported type'} (expected=${expected}, branch=network, source=${String(url).slice(0, 180)}).`);
    if (declared > MAX_SOURCE_BYTES && !nativeImageShouldPassThrough(contentType)) throw new Error(`Media source exceeds the ${Math.floor(MAX_SOURCE_BYTES / 1024 / 1024)} MB processing limit.`);
    return { ok: true, contentType, bytes: declared || null, cached: false, nativePassThrough: nativeImageShouldPassThrough(contentType) };
  } finally { clearTimeout(timer); }
}
async function fetchImage(url) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS); timer.unref?.();
  try {
    const response = await fetch(url, { signal: controller.signal }); if (!response.ok) throw new Error(`Image fetch failed with HTTP ${response.status}`);
    const contentType = String(response.headers.get('content-type') || '').toLowerCase(); if (contentType && !contentType.startsWith('image/')) throw new Error(`Media URL returned ${contentType}`);
    const declared = Number(response.headers.get('content-length') || 0); if (declared > MAX_SOURCE_BYTES) throw new Error('Media exceeds 8 MB limit.');
    const buffer = await response.buffer(); if (buffer.length > MAX_SOURCE_BYTES) throw new Error('Media exceeds 8 MB limit.'); return { buffer, contentType };
  } finally { clearTimeout(timer); }
}
async function sourceImage(url, guildId = 'global') {
  const cached = cachedAssetFor(guildId, url); if (cached?.buffer) return { buffer: cached.buffer, contentType: cached.meta?.contentType || '' };
  const remote = await fetchImage(url); saveCachedAsset(guildId, url, remote.buffer, { contentType: remote.contentType }); return remote;
}
async function makeCenteredPortrait(buffer) {
  const source = sharp(buffer, { failOn: 'warning' }); const meta = await source.metadata(); const width = Number(meta.width || 0); const height = Number(meta.height || 0); if (!width || !height) return null;
  const targetVisibleWidth = Math.min(width, SINGLE_IMAGE_VISIBLE_WIDTH); const visible = await source.resize({ width: targetVisibleWidth, withoutEnlargement: true, fit: 'inside' }).ensureAlpha().png().toBuffer();
  const visibleMeta = await sharp(visible).metadata(); const visibleWidth = Number(visibleMeta.width || targetVisibleWidth); const visibleHeight = Number(visibleMeta.height || height); const left = Math.floor((SINGLE_IMAGE_CANVAS_WIDTH - visibleWidth) / 2);
  return sharp({ create: { width: SINGLE_IMAGE_CANVAS_WIDTH, height: visibleHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: visible, left, top: 0 }]).png().toBuffer();
}
function cleanFooter(text) { return String(text || '').replace(/\u200B/g, '').trim(); }
function panelText(data) { const blocks = []; if (data.author?.name) blocks.push(`-# ${data.author.name}`); if (data.title) blocks.push(`**${data.title}**`); if (data.description) blocks.push(String(data.description)); for (const field of Array.isArray(data.fields) ? data.fields : []) if (field?.name && field?.value) blocks.push(`**${field.name}**\n${field.value}`); return blocks.join('\n\n').trim(); }
function footerText(data) { const bits = []; const footer = cleanFooter(data.footer?.text); if (footer) bits.push(footer); if (data.timestamp) { const unix = Math.floor(new Date(data.timestamp).getTime() / 1000); if (Number.isFinite(unix)) bits.push(`• Today at <t:${unix}:t>`); } return bits.length ? `-# ${bits.join(' · ')}` : ''; }
function panelMedia(mediaState, index) { return Array.isArray(mediaState?.panels) ? (mediaState.panels[index] || null) : null; }
function itemPlacement(item) { return String(item?.placement || '').toLowerCase() === 'above' ? 'above' : 'below'; }
function galleryAlignment(item) { const value = String(item?.alignment || 'left').toLowerCase(); return value === 'center' || value === 'right' ? value : 'left'; }
function applyMediaAlignmentMap(mediaState, alignmentMap = {}) {
  const media = mediaState && typeof mediaState === 'object' ? JSON.parse(JSON.stringify(mediaState)) : {}; const panels = Array.isArray(media.panels) ? media.panels : [];
  for (let panelIndex = 0; panelIndex < panels.length; panelIndex += 1) { const gallery = Array.isArray(panels[panelIndex]?.gallery) ? panels[panelIndex].gallery : []; for (let itemIndex = 0; itemIndex < gallery.length; itemIndex += 1) { const current = String(gallery[itemIndex]?.alignment || '').toLowerCase(); if (VALID_ALIGNMENTS.has(current)) continue; const key = `${panelIndex}:${itemIndex}`; const mapped = String(alignmentMap?.[key] || '').toLowerCase(); gallery[itemIndex].alignment = VALID_ALIGNMENTS.has(mapped) ? mapped : 'left'; } }
  return media;
}
async function alignedGalleryAttachment(source, alignment, panelIndex, itemIndex, guildId = 'global', visibleWidth = SINGLE_IMAGE_VISIBLE_WIDTH) {
  let cached = cachedAssetFor(guildId, source);
  if (!cached?.buffer) cached = await ensureAssetCached(guildId, source);
  if (!cached?.buffer) return null;
  const type = contentTypeBase(cached.meta?.contentType || cached.contentType || ''); if (type && !STATIC_RASTER_TYPES.has(type)) return null;
  const trimmed = await sharp(cached.buffer, { failOn: 'warning' }).ensureAlpha().trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const visible = await sharp(trimmed, { failOn: 'warning' }).resize({ width: visibleWidth, height: visibleWidth, fit: 'inside', withoutEnlargement: false }).ensureAlpha().png().toBuffer();
  const meta = await sharp(visible).metadata();
  const width = Number(meta.width || visibleWidth);
  const height = Number(meta.height || visibleWidth);
  const canvasWidth = SINGLE_IMAGE_CANVAS_WIDTH;
  const canvasHeight = SINGLE_IMAGE_VISIBLE_WIDTH;
  const left = alignment === 'right'
    ? Math.max(0, canvasWidth - width)
    : alignment === 'center'
      ? Math.max(0, Math.floor((canvasWidth - width) / 2))
      : 0;
  const top = Math.max(0, Math.floor((canvasHeight - height) / 2));

  const output = await sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  }).composite([{ input: visible, left, top }]).png().toBuffer();

  const name = `embed-panel-${panelIndex + 1}-media-${itemIndex + 1}.png`;
  return {
    attachment: new AttachmentBuilder(output, { name }),
    url: `attachment://${name}`
  };
}
async function removeConnectedCornerBackground(input, tolerance = 42) {
  const { data, info } = await sharp(input, { failOn: 'warning' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  if (!width || !height || channels < 4) return input;

  const pixelCount = width * height;
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let head = 0;
  let tail = 0;

  const cornerIndexes = [
    0,
    width - 1,
    (height - 1) * width,
    pixelCount - 1
  ];

  const colours = cornerIndexes
    .map((index) => {
      const offset = index * channels;
      return {
        r: data[offset],
        g: data[offset + 1],
        b: data[offset + 2],
        a: data[offset + 3]
      };
    })
    .filter((c) => c.a > 0);

  if (!colours.length) return input;

  const threshold = tolerance * tolerance * 3;
  const matchesBackground = (index) => {
    const offset = index * channels;
    if (data[offset + 3] === 0) return true;

    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];

    return colours.some((c) => {
      const dr = r - c.r;
      const dg = g - c.g;
      const db = b - c.b;
      return (dr * dr) + (dg * dg) + (db * db) <= threshold;
    });
  };

  const enqueue = (index) => {
    if (index < 0 || index >= pixelCount || visited[index]) return;
    if (!matchesBackground(index)) return;
    visited[index] = 1;
    queue[tail++] = index;
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }

  while (head < tail) {
    const index = queue[head++];
    const offset = index * channels;
    data[offset + 3] = 0;

    const x = index % width;
    const y = Math.floor(index / width);

    if (x > 0) enqueue(index - 1);
    if (x < width - 1) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y < height - 1) enqueue(index + width);
  }

  return sharp(data, {
    raw: { width, height, channels }
  }).png().toBuffer();
}

async function plainGalleryAttachment(source, panelIndex, itemIndex, guildId = 'global', visibleWidth = SINGLE_IMAGE_VISIBLE_WIDTH) {
  let cached = cachedAssetFor(guildId, source);
  if (!cached?.buffer) cached = await ensureAssetCached(guildId, source);
  if (!cached?.buffer) return null;

  const type = contentTypeBase(cached.meta?.contentType || cached.contentType || '');
  if (type && !STATIC_RASTER_TYPES.has(type)) return null;

  const transparent = await removeConnectedCornerBackground(cached.buffer);
  const visible = await sharp(transparent, { failOn: 'warning' })
    .ensureAlpha()
    .resize({
      width: visibleWidth,
      withoutEnlargement: true,
      fit: 'inside'
    })
    .png()
    .toBuffer();

  const name = `embed-panel-${panelIndex + 1}-media-${itemIndex + 1}.png`;
  return {
    attachment: new AttachmentBuilder(visible, { name }),
    url: `attachment://${name}`
  };
}
async function galleryItems(media, interaction, placement = null, payloadFiles = null, panelIndex = 0) {
  return [];
}

async function buildEmbedPayload(options = {}) {
  const { embeds = [], actionRows = [], allowUserPing = false, userId = null, ephemeral = false, interaction = null } = options;
  const mediaState = applyMediaAlignmentMap(options.media || null, options.mediaAlignment || {});
  const files = [];
  const outputEmbeds = [];
  const resolvedEmbeds = await resolveApplicationEmojiShortcodes(embeds, interaction);
  const client = interaction?.client || null;
  const guildId = interactionGuildId(interaction);
  const resolvedActionRows = client && guildId !== 'global' ? await emojiPayload.resolveComponents(client, guildId, actionRows, 'embed') : actionRows;
  await validateApplicationEmojiUsage(resolvedEmbeds, resolvedActionRows, interaction);

  for (let index = 0; index < resolvedEmbeds.length; index += 1) {
    const sourceEmbed = resolvedEmbeds[index];
    const data = typeof sourceEmbed?.toJSON === 'function' ? sourceEmbed.toJSON() : sourceEmbed;
    if (!data || typeof data !== 'object') continue;
    const hasPanelMediaState = Array.isArray(mediaState?.panels) && index < mediaState.panels.length;
    const media = panelMedia(mediaState, index);
    const targetEmbed = sourceEmbed instanceof EmbedBuilder ? EmbedBuilder.from(sourceEmbed) : EmbedBuilder.from(data);
    const thumbSource = resolveSource(hasPanelMediaState ? media?.thumbnail?.source : data.thumbnail?.url, interaction);
    if (thumbSource) { await probeRemoteSource(thumbSource, 'thumbnail', guildId); if (isHttpsUrl(thumbSource)) targetEmbed.setThumbnail(thumbSource); }

    if (hasPanelMediaState) {
      const gallery = Array.isArray(media?.gallery) ? media.gallery.slice(0, 10) : [];
      const above = [];
      const below = [];
      for (let itemIndex = 0; itemIndex < gallery.length; itemIndex += 1) {
        const item = gallery[itemIndex];
        const source = resolveSource(item?.source, interaction);
        if (!source) continue;
        const probe = await probeRemoteSource(source, 'media', guildId);
        const type = String(item?.type || 'auto').toLowerCase();
        const isImage = type !== 'video' && !nativeImageShouldPassThrough(probe.contentType);
        if (!isImage) continue;
        const prepared = await plainGalleryAttachment(source, index, itemIndex, guildId, galleryImageWidth(item));
        if (!prepared) continue;
        files.push(prepared.attachment);
        const imageEmbed = new EmbedBuilder();
        if (Number.isInteger(data.color)) imageEmbed.setColor(data.color);
        imageEmbed.setImage(prepared.url);
        (itemPlacement(item) === 'above' ? above : below).push(imageEmbed);
      }
      for (const imageEmbed of above) outputEmbeds.push(imageEmbed);
      outputEmbeds.push(targetEmbed);
      for (const imageEmbed of below) outputEmbeds.push(imageEmbed);
    } else {
      outputEmbeds.push(targetEmbed);
    }
  }

  const payload = { embeds: outputEmbeds.slice(0, 10), components: [...(resolvedActionRows || [])], files };
  if (allowUserPing && userId) payload.content = `<@${userId}>`;
  if (ephemeral) payload.flags = MessageFlags.Ephemeral;
  return payload;
}

async function resolveApplicationEmojiShortcodes(embeds, interaction) { return embeds || []; }
async function validateApplicationEmojiUsage() { return true; }

module.exports = {
  buildEmbedPayload,
  makeCenteredPortrait,
  applyMediaAlignmentMap,
};
