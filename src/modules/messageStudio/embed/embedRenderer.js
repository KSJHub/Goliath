'use strict';

const {
  AttachmentBuilder,
  ContainerBuilder,
  FileBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} = require('discord.js');
const fetch = require('node-fetch');
const path = require('node:path');
const sharp = require('sharp');
const { getCachedAsset, saveCachedAsset, ensureAssetCached } = require('./embedMedia');
const { replaceVars } = require('./embedPanel');
const emojiStore = require('../../utilityStudio/emojis/emojisStore');

const CANVAS_WIDTH = 600;
const PORTRAIT_WIDTH = 320;
const PORTRAIT_SHIFT_RIGHT = 0;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8000;
const PANEL_BG = { r: 19, g: 20, b: 22, alpha: 1 };
const STATIC_RASTER_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg']);
const NATIVE_IMAGE_TYPES = new Set(['image/gif', 'image/webp', 'image/avif', 'image/svg+xml']);

const LEGACY_TARGET_WIDTH = 299;
const LEGACY_PORTRAIT_VISIBLE_WIDTH = 212;
const LEGACY_PORTRAIT_RIGHT_INSET = 0;

function isHttpsUrl(value) {
  try { return new URL(String(value || '')).protocol === 'https:'; } catch { return false; }
}
function resolveSource(value, interaction) {
  const resolved = interaction ? replaceVars(String(value || ''), interaction) : String(value || '');
  return String(resolved || '').trim();
}
function contentTypeBase(value) {
  return String(value || '').toLowerCase().split(';')[0].trim();
}
function expectedTypeOk(contentType, expected = 'media') {
  const type = contentTypeBase(contentType);
  if (!type) return true;
  if (expected === 'thumbnail') return type.startsWith('image/');
  if (expected === 'image') return type.startsWith('image/');
  if (expected === 'video') return type.startsWith('video/');
  if (expected === 'media') return type.startsWith('image/') || type.startsWith('video/');
  return true;
}
async function probeRemoteSource(url, expected = 'media') {
  if (!isHttpsUrl(url)) throw new Error(`Media source must resolve to a valid HTTPS URL: ${String(url || '').slice(0, 160)}`);
  const cached = getCachedAsset('global', url);
  if (cached?.buffer) {
    const cachedType = cached.meta?.contentType || '';
    if (!expectedTypeOk(cachedType, expected)) throw new Error(`Media source returned ${cachedType || 'an unsupported type'}.`);
    return { ok: true, contentType: cachedType, bytes: cached.buffer.length, cached: true };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  timer.unref?.();
  try {
    let response = await fetch(url, { method: 'HEAD', signal: controller.signal, redirect: 'follow' });
    if (response.status === 405 || response.status === 403) {
      response = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' }, signal: controller.signal, redirect: 'follow' });
    }
    if (!response.ok && response.status !== 206) throw new Error(`Media source returned HTTP ${response.status}.`);
    const contentType = String(response.headers.get('content-type') || '');
    const declared = Number(response.headers.get('content-length') || 0);
    if (!expectedTypeOk(contentType, expected)) throw new Error(`Media source returned ${contentType || 'an unsupported type'}.`);
    if (declared > MAX_SOURCE_BYTES) throw new Error(`Media source exceeds the ${Math.floor(MAX_SOURCE_BYTES / 1024 / 1024)} MB processing limit.`);
    return { ok: true, contentType, bytes: declared || null, cached: false };
  } finally { clearTimeout(timer); }
}
async function fetchImage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  timer.unref?.();
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Image fetch failed with HTTP ${response.status}`);
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (contentType && !contentType.startsWith('image/')) throw new Error(`Media URL returned ${contentType}`);
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > MAX_SOURCE_BYTES) throw new Error('Media exceeds 8 MB limit.');
    const buffer = await response.buffer();
    if (buffer.length > MAX_SOURCE_BYTES) throw new Error('Media exceeds 8 MB limit.');
    return { buffer, contentType };
  } finally { clearTimeout(timer); }
}
async function sourceImage(url, guildId = 'global') {
  const cached = getCachedAsset(guildId, url);
  if (cached?.buffer) return { buffer: cached.buffer, contentType: cached.meta?.contentType || '' };
  const remote = await fetchImage(url);
  saveCachedAsset(guildId, url, remote.buffer, { contentType: remote.contentType });
  return remote;
}
function circleMaskSvg(size) {
  const radius = size / 2;
  return Buffer.from(`<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg"><circle cx="${radius}" cy="${radius}" r="${radius}" fill="white"/></svg>`);
}
async function makeCenteredPortrait(buffer) {
  const meta = await sharp(buffer, { failOn: 'warning' }).metadata();
  const width = Number(meta.width || 0), height = Number(meta.height || 0);
  if (!width || !height) return null;
  if ((width / height) > 1.25) return sharp(buffer, { failOn: 'warning' }).resize({ width: CANVAS_WIDTH, withoutEnlargement: false }).png().toBuffer();
  const portrait = await sharp(buffer, { failOn: 'warning' }).resize(PORTRAIT_WIDTH, PORTRAIT_WIDTH, { fit: 'cover', position: 'centre', withoutEnlargement: false }).ensureAlpha().composite([{ input: circleMaskSvg(PORTRAIT_WIDTH), blend: 'dest-in' }]).png().toBuffer();
  const naturalLeft = Math.floor((CANVAS_WIDTH - PORTRAIT_WIDTH) / 2);
  const left = Math.min(CANVAS_WIDTH - PORTRAIT_WIDTH, Math.max(0, naturalLeft + PORTRAIT_SHIFT_RIGHT));
  return sharp({ create: { width: CANVAS_WIDTH, height: PORTRAIT_WIDTH, channels: 4, background: PANEL_BG } }).composite([{ input: portrait, left, top: 0 }]).png().toBuffer();
}
function cleanFooter(text) { return String(text || '').replace(/\u200B/g, '').trim(); }
function panelText(data) {
  const blocks = [];
  if (data.author?.name) blocks.push(`-# ${data.author.name}`);
  if (data.title) blocks.push(`**${data.title}**`);
  if (data.description) blocks.push(String(data.description));
  for (const field of Array.isArray(data.fields) ? data.fields : []) if (field?.name && field?.value) blocks.push(`**${field.name}**\n${field.value}`);
  return blocks.join('\n\n').trim();
}
function footerText(data) {
  const bits = [];
  const footer = cleanFooter(data.footer?.text);
  if (footer) bits.push(footer);
  if (data.timestamp) {
    const unix = Math.floor(new Date(data.timestamp).getTime() / 1000);
    if (Number.isFinite(unix)) bits.push(`• Today at <t:${unix}:t>`);
  }
  return bits.length ? `-# ${bits.join(' · ')}` : '';
}
function panelMedia(mediaState, index) { return Array.isArray(mediaState?.panels) ? (mediaState.panels[index] || null) : null; }
function isEnhancedMedia(media) {
  if (!media) return false;
  const gallery = Array.isArray(media.gallery) ? media.gallery : [];
  const first = gallery[0] || {};
  return gallery.length > 1 || Boolean(first.alt) || first.spoiler === true || first.type === 'video' || Boolean(media.thumbnail?.alt) || (Array.isArray(media.files) && media.files.length > 0);
}
async function galleryItems(media, interaction) {
  const output = [];
  for (const item of (Array.isArray(media?.gallery) ? media.gallery : []).slice(0, 10)) {
    const source = resolveSource(item?.source, interaction);
    if (!source) continue;
    const expected = item?.type === 'image' ? 'image' : item?.type === 'video' ? 'video' : 'media';
    await probeRemoteSource(source, expected);
    const builder = new MediaGalleryItemBuilder().setURL(source).setSpoiler(item?.spoiler === true);
    if (item?.alt) builder.setDescription(String(item.alt).slice(0, 1024));
    output.push(builder);
  }
  return output;
}
function safeFilename(name, fallback) {
  const base = String(name || fallback || 'file').trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return (base || fallback || 'file').slice(0, 120);
}
function sourceFilename(source, fallback) {
  try { const parsed = new URL(source); return decodeURIComponent(path.basename(parsed.pathname || '')) || fallback; } catch { return fallback; }
}
async function addMediaFiles(container, media, interaction, payloadFiles, panelIndex) {
  const entries = (Array.isArray(media?.files) ? media.files : []).slice(0, 10);
  for (let fileIndex = 0; fileIndex < entries.length; fileIndex += 1) {
    const entry = entries[fileIndex];
    const source = resolveSource(entry?.source, interaction);
    if (!isHttpsUrl(source)) throw new Error(`Attached file source must resolve to a valid HTTPS URL: ${String(source || '').slice(0, 160)}`);
    try {
      const cached = await ensureAssetCached('global', source);
      if (!cached?.buffer) throw new Error('File could not be downloaded.');
      const originalName = entry?.name || sourceFilename(source, `file-${fileIndex + 1}`);
      const name = safeFilename(`p${panelIndex + 1}-${fileIndex + 1}-${originalName}`, `p${panelIndex + 1}-file-${fileIndex + 1}`);
      const attachment = new AttachmentBuilder(cached.buffer, { name });
      if (entry?.description) attachment.setDescription(String(entry.description).slice(0, 1024));
      if (entry?.spoiler) attachment.setSpoiler(true);
      payloadFiles.push(attachment);
      container.addFileComponents(new FileBuilder().setURL(`attachment://${name}`).setSpoiler(entry?.spoiler === true));
    } catch (error) { throw new Error(`Attached file "${entry?.name || sourceFilename(source, 'file')}" could not be prepared: ${error?.message || error}`); }
  }
}
function nativeImageShouldPassThrough(contentType) {
  const type = contentTypeBase(contentType);
  return NATIVE_IMAGE_TYPES.has(type) || (type.startsWith('image/') && !STATIC_RASTER_TYPES.has(type));
}
async function addLegacyImage(container, imageUrl, files, index) {
  if (!isHttpsUrl(imageUrl)) return;
  const probe = await probeRemoteSource(imageUrl, 'image');
  if (nativeImageShouldPassThrough(probe.contentType)) {
    container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(imageUrl)));
    return;
  }
  const source = await sourceImage(imageUrl);
  if (nativeImageShouldPassThrough(source.contentType)) {
    container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(imageUrl)));
    return;
  }
  const centered = await makeCenteredPortrait(source.buffer);
  if (centered) {
    const name = `embed-panel-${index + 1}.png`;
    files.push(new AttachmentBuilder(centered, { name }));
    container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${name}`)));
  }
}

function componentEmojiIds(actionRows = []) {
  const ids = new Set();
  for (const row of actionRows || []) {
    const data = typeof row?.toJSON === 'function' ? row.toJSON() : row;
    for (const component of Array.isArray(data?.components) ? data.components : []) {
      const id = String(component?.emoji?.id || '').trim();
      if (/^\d{16,20}$/.test(id)) ids.add(id);
    }
  }
  return [...ids];
}

function textEmojiIds(embeds = []) {
  const ids = new Set();
  const scan = (value) => {
    const text = String(value || '');
    for (const match of text.matchAll(/<a?:[a-zA-Z0-9_]+:(\d{16,20})>/g)) ids.add(match[1]);
  };
  for (const embed of embeds || []) {
    const data = typeof embed?.toJSON === 'function' ? embed.toJSON() : embed;
    if (!data || typeof data !== 'object') continue;
    scan(data.title);
    scan(data.description);
    scan(data.author?.name);
    scan(data.footer?.text);
    for (const field of Array.isArray(data.fields) ? data.fields : []) {
      scan(field?.name);
      scan(field?.value);
    }
  }
  return [...ids];
}

function replaceEmojiShortcodes(value, allowedByName) {
  const text = String(value || '');
  if (!text || !allowedByName?.size) return text;
  return text.replace(/:([a-zA-Z0-9_]{2,32}):/g, (match, name, offset, source) => {
    const prefix = source.slice(Math.max(0, offset - 2), offset);
    if (prefix.endsWith('<') || prefix === '<a') return match;
    const emoji = allowedByName.get(name);
    if (!emoji) return match;
    return `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`;
  });
}

async function resolveApplicationEmojiShortcodes(embeds = [], interaction = null) {
  const manager = interaction?.client?.application?.emojis;
  const guildId = String(interaction?.guildId || interaction?.guild?.id || '').trim();
  if (!manager || !guildId) return embeds;

  const section = emojiStore.getSection(guildId);
  if (!section.enabled || !section.favourites.length) return embeds;

  let bank = manager.cache;
  if (!bank?.size) bank = await manager.fetch();
  const selected = new Set(section.favourites.map(String));
  const allowedByName = new Map();
  for (const emoji of bank.values()) {
    if (!selected.has(String(emoji.id)) || !emoji.name) continue;
    allowedByName.set(String(emoji.name), emoji);
  }
  if (!allowedByName.size) return embeds;

  return (embeds || []).map((embed) => {
    const data = typeof embed?.toJSON === 'function' ? embed.toJSON() : embed;
    if (!data || typeof data !== 'object') return embed;
    const resolved = { ...data };
    if (data.title != null) resolved.title = replaceEmojiShortcodes(data.title, allowedByName);
    if (data.description != null) resolved.description = replaceEmojiShortcodes(data.description, allowedByName);
    if (data.author && typeof data.author === 'object') {
      resolved.author = { ...data.author, name: replaceEmojiShortcodes(data.author.name, allowedByName) };
    }
    if (data.footer && typeof data.footer === 'object') {
      resolved.footer = { ...data.footer, text: replaceEmojiShortcodes(data.footer.text, allowedByName) };
    }
    if (Array.isArray(data.fields)) {
      resolved.fields = data.fields.map((field) => ({
        ...field,
        name: replaceEmojiShortcodes(field?.name, allowedByName),
        value: replaceEmojiShortcodes(field?.value, allowedByName),
      }));
    }
    return resolved;
  });
}

async function validateApplicationEmojiUsage(embeds = [], actionRows = [], interaction = null) {
  const usedIds = [...new Set([...componentEmojiIds(actionRows), ...textEmojiIds(embeds)])];
  if (!usedIds.length) return true;

  const manager = interaction?.client?.application?.emojis;
  const guildId = String(interaction?.guildId || interaction?.guild?.id || '').trim();
  if (!manager || !guildId) return true;

  let bank = manager.cache;
  if (!bank?.size) bank = await manager.fetch();
  const applicationIds = new Set([...bank.values()].map((emoji) => String(emoji.id)));
  const usedApplicationIds = usedIds.filter((id) => applicationIds.has(id));
  if (!usedApplicationIds.length) return true;

  const section = emojiStore.getSection(guildId);
  if (!section.enabled) throw new Error('Emoji Bank must be enabled before a Goliath application emoji can be deployed.');

  const selected = new Set(section.favourites.map(String));
  const blocked = usedApplicationIds.filter((id) => !selected.has(id));
  if (!blocked.length) return true;

  const names = blocked.map((id) => bank.get(id)?.name ? `:${bank.get(id).name}:` : id);
  throw new Error(`Goliath application emoji not selected for this guild: ${names.join(', ')}. Select it in Emoji Bank first.`);
}

async function buildEmbedPayload(options = {}) {
  const { embeds = [], actionRows = [], allowUserPing = false, userId = null, ephemeral = false, interaction = null } = options;
  const mediaState = options.media || options.mediaV2 || null;
  const components = [];
  const files = [];
  const resolvedEmbeds = await resolveApplicationEmojiShortcodes(embeds, interaction);
  await validateApplicationEmojiUsage(resolvedEmbeds, actionRows, interaction);
  if (allowUserPing && userId) components.push(new TextDisplayBuilder().setContent(`<@${userId}>`));
  for (let index = 0; index < resolvedEmbeds.length; index += 1) {
    const embed = resolvedEmbeds[index];
    const data = typeof embed?.toJSON === 'function' ? embed.toJSON() : embed;
    if (!data || typeof data !== 'object') continue;
    const media = panelMedia(mediaState, index);
    const container = new ContainerBuilder();
    if (Number.isInteger(data.color)) container.setAccentColor(data.color);
    const text = panelText(data);
    const thumbSource = resolveSource(media?.thumbnail?.source || data.thumbnail?.url, interaction);
    if (thumbSource) await probeRemoteSource(thumbSource, 'thumbnail');
    if (text && isHttpsUrl(thumbSource)) {
      const thumbnail = new ThumbnailBuilder().setURL(thumbSource);
      if (media?.thumbnail?.alt) thumbnail.setDescription(String(media.thumbnail.alt).slice(0, 1024));
      container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(text)).setThumbnailAccessory(thumbnail));
    } else if (text) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
    const enhanced = isEnhancedMedia(media);
    const items = enhanced ? await galleryItems(media, interaction) : [];
    if (items.length) container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(...items));
    else {
      const imageUrl = resolveSource(media?.gallery?.[0]?.source || data.image?.url, interaction);
      if (isHttpsUrl(imageUrl)) {
        try { await addLegacyImage(container, imageUrl, files, index); }
        catch (error) { throw new Error(`Panel ${index + 1} image could not be prepared: ${error?.message || error}`); }
      }
    }
    if (media?.files?.length) await addMediaFiles(container, media, interaction, files, index);
    const footer = footerText(data);
    if (footer) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(footer));
    components.push(container);
  }
  for (const row of actionRows || []) components.push(row);
  let flags = MessageFlags.IsComponentsV2;
  if (ephemeral) flags |= MessageFlags.Ephemeral;
  return { components, files, flags };
}

async function centerOnLegacyEmbedCanvas(buffer) {
  const input = sharp(buffer, { failOn: 'warning' });
  const metadata = await input.metadata();
  const width = Number(metadata.width || 0), height = Number(metadata.height || 0);
  if (!width || !height) return null;
  const aspect = width / height;
  if (aspect > 1.25) return sharp(buffer, { failOn: 'warning' }).resize({ width: LEGACY_TARGET_WIDTH, withoutEnlargement: false }).png().toBuffer();
  const visibleWidth = Math.min(LEGACY_PORTRAIT_VISIBLE_WIDTH, LEGACY_TARGET_WIDTH);
  const resized = await sharp(buffer, { failOn: 'warning' }).resize({ width: visibleWidth, withoutEnlargement: false }).ensureAlpha().png().toBuffer();
  const resizedMeta = await sharp(resized).metadata();
  const renderedWidth = Number(resizedMeta.width || visibleWidth);
  const right = Math.min(LEGACY_PORTRAIT_RIGHT_INSET, Math.max(0, LEGACY_TARGET_WIDTH - renderedWidth));
  const left = Math.max(0, LEGACY_TARGET_WIDTH - renderedWidth - right);
  return sharp(resized).extend({ top: 0, bottom: 0, left, right, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
}

async function prepareEmbedMedia(embeds = [], options = {}) {
  const files = [];
  const output = Array.isArray(embeds) ? embeds : [];
  const guildId = options.guildId || 'global';
  for (let index = 0; index < output.length; index += 1) {
    const embed = output[index];
    if (!embed || typeof embed.toJSON !== 'function' || typeof embed.setImage !== 'function') continue;
    const imageUrl = embed.toJSON()?.image?.url;
    if (!imageUrl || !isHttpsUrl(imageUrl)) continue;
    try {
      const source = await sourceImage(imageUrl, guildId);
      const processed = await centerOnLegacyEmbedCanvas(source.buffer);
      if (!processed) continue;
      const name = `embed-panel-${index + 1}-large.png`;
      files.push(new AttachmentBuilder(processed, { name }));
      embed.setImage(`attachment://${name}`);
    } catch (error) { console.warn(`[EmbedMedia] panel ${index + 1}: media normalization failed:`, error?.message || error); }
  }
  return { embeds: output, files };
}

module.exports = {
  CANVAS_WIDTH,
  PORTRAIT_WIDTH,
  PORTRAIT_SHIFT_RIGHT,
  PANEL_BG,
  LEGACY_TARGET_WIDTH,
  LEGACY_PORTRAIT_VISIBLE_WIDTH,
  buildEmbedPayload,
  prepareEmbedMedia,
  probeRemoteSource,
};
