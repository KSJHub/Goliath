'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const fetch = require('node-fetch');
const net = require('node:net');
const sharp = require('sharp');

const CANVAS_WIDTH = 600;
const VISIBLE_WIDTH = 320;
const PANEL_BG = { r: 19, g: 20, b: 22, alpha: 1 };
const FETCH_TIMEOUT_MS = 8000;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const VALID_ALIGNMENTS = new Set(['left', 'center', 'right']);

function clone(value) { try { return JSON.parse(JSON.stringify(value)); } catch { return value; } }
function alignmentOf(item) { return VALID_ALIGNMENTS.has(String(item?.alignment || '').toLowerCase()) ? String(item.alignment).toLowerCase() : 'left'; }
function alignmentKey(panelIndex, itemIndex) { return `${Math.max(0, Number(panelIndex) || 0)}:${Math.max(0, Number(itemIndex) || 0)}`; }
function componentId(component) { return component?.data?.custom_id || component?.customId || component?.custom_id || null; }

function alignmentMap(state = {}) {
  const source = state?.mediaAlignment && typeof state.mediaAlignment === 'object' ? state.mediaAlignment : {};
  return { ...source };
}

function applyAlignmentMap(mediaState, map = {}) {
  const media = clone(mediaState || {});
  const panels = Array.isArray(media?.panels) ? media.panels : [];
  panels.forEach((panelMedia, panelIndex) => {
    const gallery = Array.isArray(panelMedia?.gallery) ? panelMedia.gallery : [];
    gallery.forEach((item, itemIndex) => {
      const stored = String(map[alignmentKey(panelIndex, itemIndex)] || item?.alignment || '').toLowerCase();
      item.alignment = VALID_ALIGNMENTS.has(stored) ? stored : 'left';
    });
  });
  return media;
}

function installPersistence(panel) {
  if (!panel || panel.__imageAlignmentPersistenceInstalled) return;
  if (typeof panel.presetData === 'function') {
    const originalPresetData = panel.presetData.bind(panel);
    panel.presetData = (state) => ({ ...originalPresetData(state), mediaAlignment: alignmentMap(state) });
  }
  if (typeof panel.applyPreset === 'function') {
    const originalApplyPreset = panel.applyPreset.bind(panel);
    panel.applyPreset = (interaction, name, preset = {}) => {
      const result = originalApplyPreset(interaction, name, preset);
      const next = { ...result, mediaAlignment: alignmentMap(preset) };
      return typeof panel.saveSession === 'function' ? panel.saveSession(interaction, next) : next;
    };
  }
  panel.__imageAlignmentPersistenceInstalled = true;
}

function alignmentButtons(alignment) {
  return [
    new ButtonBuilder().setCustomId('embed:media-align:left').setLabel('⬅️ Left').setStyle(alignment === 'left' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('embed:media-align:center').setLabel('↔️ Centre').setStyle(alignment === 'center' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('embed:media-align:right').setLabel('➡️ Right').setStyle(alignment === 'right' ? ButtonStyle.Primary : ButtonStyle.Secondary),
  ];
}

function installUi(panel) {
  if (!panel || panel.__imageAlignmentUiInstalled || typeof panel.buildMediaOptionsPanel !== 'function') return;
  const original = panel.buildMediaOptionsPanel.bind(panel);
  panel.buildMediaOptionsPanel = (interaction) => {
    const payload = original(interaction);
    const state = panel.getSession(interaction);
    const panelIndex = Math.max(0, Number(state?.selectedPanelIndex) || 0);
    const itemIndex = Number.isInteger(state?.selectedMediaIndex) ? state.selectedMediaIndex : null;
    if (itemIndex == null) return payload;
    const map = alignmentMap(state);
    const alignment = VALID_ALIGNMENTS.has(String(map[alignmentKey(panelIndex, itemIndex)] || '').toLowerCase())
      ? String(map[alignmentKey(panelIndex, itemIndex)]).toLowerCase() : 'left';
    const rows = Array.isArray(payload?.components) ? payload.components : [];
    const duplicateRow = rows.find((row) => Array.isArray(row?.components) && row.components.some((c) => componentId(c) === 'embed:media-duplicate'));
    const backRow = rows.find((row) => Array.isArray(row?.components) && row.components.some((c) => componentId(c) === 'embed:media-options-back'));
    if (duplicateRow) {
      const duplicate = duplicateRow.components.find((c) => componentId(c) === 'embed:media-duplicate');
      duplicateRow.components = [];
      duplicateRow.addComponents(...alignmentButtons(alignment));
      if (duplicate && backRow && (backRow.components?.length || 0) < 5) backRow.addComponents(duplicate);
    }
    const embed = payload?.embeds?.[0];
    if (embed?.data?.description != null) embed.setDescription(`${embed.data.description}\n**Image alignment:** ${alignment === 'center' ? 'Centre' : alignment[0].toUpperCase() + alignment.slice(1)}`.slice(0, 4096));
    return payload;
  };
  panel.__imageAlignmentUiInstalled = true;
}

function installInteraction(panel, interactions) {
  if (!panel || !interactions || interactions.__imageAlignmentInteractionInstalled) return;
  const original = interactions.handleInteraction.bind(interactions);
  interactions.handleInteraction = async (interaction) => {
    const customId = String(interaction?.customId || '');
    if (!customId.startsWith('embed:media-align:')) return original(interaction);
    const alignment = customId.split(':').pop();
    if (!VALID_ALIGNMENTS.has(alignment)) return true;
    const state = panel.getSession(interaction);
    const panelIndex = Math.max(0, Number(state?.selectedPanelIndex) || 0);
    const itemIndex = Number.isInteger(state?.selectedMediaIndex) ? state.selectedMediaIndex : null;
    const panelMedia = panel.getPanelMedia(state, panelIndex);
    if (itemIndex == null || !panelMedia?.gallery?.[itemIndex]) { await interaction.update(panel.buildMediaManagerPanel(interaction, panel.memberName(interaction))); return true; }
    const map = alignmentMap(state);
    map[alignmentKey(panelIndex, itemIndex)] = alignment;
    panel.saveSession(interaction, { ...state, mediaAlignment: map, hasUnsavedChanges: true });
    await interaction.update(panel.buildMediaOptionsPanel(interaction));
    return true;
  };
  interactions.__imageAlignmentInteractionInstalled = true;
}

function isPrivateIpv4(hostname) { const p = hostname.split('.').map(Number); if (p.length !== 4 || p.some((n) => !Number.isInteger(n))) return false; const [a, b] = p; return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168); }
function isPrivateIpv6(hostname) { const h = hostname.toLowerCase(); return h === '::1' || h === '::' || h.startsWith('fc') || h.startsWith('fd') || /^fe[89ab]/.test(h); }
function safeUrl(value) { try { const u = new URL(String(value || '')); const h = u.hostname.toLowerCase(); const v = net.isIP(h); if (u.protocol !== 'https:' || !h || h === 'localhost' || h.endsWith('.localhost') || (v === 4 && isPrivateIpv4(h)) || (v === 6 && isPrivateIpv6(h))) return null; return u.toString(); } catch { return null; } }
async function fetchImage(url) {
  const target = safeUrl(url); if (!target) return null;
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS); timer.unref?.();
  try { const response = await fetch(target, { signal: controller.signal, redirect: 'error' }); if (!response.ok) return null; const type = String(response.headers.get('content-type') || '').toLowerCase(); if (type && !type.startsWith('image/')) return null; const declared = Number(response.headers.get('content-length') || 0); if (declared > MAX_SOURCE_BYTES) return null; const buffer = await response.buffer(); return buffer.length <= MAX_SOURCE_BYTES ? buffer : null; } finally { clearTimeout(timer); }
}
async function alignedAttachment(source, alignment, name) {
  const input = await fetchImage(source); if (!input) return null;
  const trimmed = await sharp(input, { failOn: 'warning' }).ensureAlpha().trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const visible = await sharp(trimmed, { failOn: 'warning' }).resize({ width: VISIBLE_WIDTH, height: VISIBLE_WIDTH, fit: 'inside', withoutEnlargement: false }).ensureAlpha().png().toBuffer();
  const meta = await sharp(visible).metadata(); const width = Number(meta.width || VISIBLE_WIDTH); const height = Number(meta.height || VISIBLE_WIDTH);
  const left = alignment === 'right' ? CANVAS_WIDTH - width : alignment === 'center' ? Math.floor((CANVAS_WIDTH - width) / 2) : 0;
  const output = await sharp({ create: { width: CANVAS_WIDTH, height, channels: 4, background: PANEL_BG } }).composite([{ input: visible, left, top: 0 }]).png().toBuffer();
  return new AttachmentBuilder(output, { name });
}
function attachmentName(file, index) { return String(file?.name || file?.data?.name || `embed-panel-${index + 1}.png`); }
function panelIndexFromAttachment(file, fallback) { const m = attachmentName(file, fallback).match(/^embed-panel-(\d+)\.png$/i); return m ? Math.max(0, Number(m[1]) - 1) : fallback; }

function installRenderer(renderer) {
  if (!renderer || renderer.__imageAlignmentRendererInstalled || typeof renderer.buildEmbedPayload !== 'function') return;
  const original = renderer.buildEmbedPayload.bind(renderer);
  renderer.buildEmbedPayload = async (options = {}) => {
    const map = options.mediaAlignment || {};
    const media = applyAlignmentMap(options.media || options.mediaV2 || {}, map);
    const payload = await original({ ...options, media, mediaV2: media });
    if (!Array.isArray(payload?.files) || !payload.files.length) return payload;
    payload.files = await Promise.all(payload.files.map(async (file, fallbackIndex) => {
      const panelIndex = panelIndexFromAttachment(file, fallbackIndex);
      const item = media?.panels?.[panelIndex]?.gallery?.[0];
      if (!item?.source || item?.placement === 'above' || item?.type === 'video' || item?.spoiler) return file;
      const alignment = alignmentOf(item);
      if (alignment === 'center') return file;
      try { return await alignedAttachment(item.source, alignment, attachmentName(file, fallbackIndex)) || file; }
      catch (error) { console.warn(`[Embed Renderer] Image alignment failed for panel ${panelIndex + 1}:`, error?.message || error); return file; }
    }));
    return payload;
  };
  renderer.__imageAlignmentRendererInstalled = true;
}

function installImageAlignment(panel, renderer, interactions = null) { installPersistence(panel); installUi(panel); installRenderer(renderer); if (interactions) installInteraction(panel, interactions); }

module.exports = { installImageAlignment, installInteraction, applyAlignmentMap, alignmentOf };
