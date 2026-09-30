'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const VALID_ALIGNMENTS = new Set(['left', 'center', 'right']);

function clone(value) { try { return JSON.parse(JSON.stringify(value)); } catch { return value; } }
function alignmentOf(item) { const value = String(item?.alignment || '').toLowerCase(); return VALID_ALIGNMENTS.has(value) ? value : 'left'; }
function alignmentKey(panelIndex, itemIndex) { return `${Math.max(0, Number(panelIndex) || 0)}:${Math.max(0, Number(itemIndex) || 0)}`; }
function componentId(component) { return component?.data?.custom_id || component?.customId || component?.custom_id || null; }
function alignmentMap(state = {}) { const source = state?.mediaAlignment && typeof state.mediaAlignment === 'object' ? state.mediaAlignment : {}; return { ...source }; }

function applyAlignmentMap(mediaState, map = {}, { legacyOverride = true } = {}) {
  const media = clone(mediaState || {});
  const panels = Array.isArray(media?.panels) ? media.panels : [];
  panels.forEach((panelMedia, panelIndex) => {
    const gallery = Array.isArray(panelMedia?.gallery) ? panelMedia.gallery : [];
    gallery.forEach((item, itemIndex) => {
      const current = String(item?.alignment || '').toLowerCase();
      const mapped = String(map[alignmentKey(panelIndex, itemIndex)] || '').toLowerCase();
      if (legacyOverride && VALID_ALIGNMENTS.has(mapped)) item.alignment = mapped;
      else item.alignment = VALID_ALIGNMENTS.has(current) ? current : (VALID_ALIGNMENTS.has(mapped) ? mapped : 'left');
    });
  });
  return media;
}

function mapFromMedia(mediaState = {}) {
  const map = {};
  const panels = Array.isArray(mediaState?.panels) ? mediaState.panels : [];
  panels.forEach((panelMedia, panelIndex) => {
    const gallery = Array.isArray(panelMedia?.gallery) ? panelMedia.gallery : [];
    gallery.forEach((item, itemIndex) => { map[alignmentKey(panelIndex, itemIndex)] = alignmentOf(item); });
  });
  return map;
}

function canonicalizeState(state = {}, migrateLegacy = false) {
  const media = applyAlignmentMap(state.media || {}, alignmentMap(state), { legacyOverride: migrateLegacy });
  return { ...state, media, mediaAlignment: mapFromMedia(media) };
}

function installPersistence(panel) {
  if (!panel || panel.__imageAlignmentPersistenceInstalled) return;
  if (typeof panel.presetData === 'function') {
    const originalPresetData = panel.presetData.bind(panel);
    panel.presetData = (state) => {
      const canonical = canonicalizeState(state, false);
      return { ...originalPresetData(canonical), media: canonical.media, mediaAlignment: canonical.mediaAlignment };
    };
  }
  if (typeof panel.applyPreset === 'function') {
    const originalApplyPreset = panel.applyPreset.bind(panel);
    panel.applyPreset = (interaction, name, preset = {}) => {
      const migratedPreset = canonicalizeState(preset, true);
      const result = originalApplyPreset(interaction, name, migratedPreset);
      const canonical = canonicalizeState(result, false);
      return typeof panel.saveSession === 'function' ? panel.saveSession(interaction, canonical) : canonical;
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

function selectedItem(panel, interaction) {
  const state = panel.getSession(interaction);
  const panelIndex = Math.max(0, Number(state?.selectedPanelIndex) || 0);
  const panelMedia = panel.getPanelMedia(state, panelIndex);
  const gallery = Array.isArray(panelMedia?.gallery) ? panelMedia.gallery : [];
  const itemIndex = Number.isInteger(state?.selectedMediaIndex) ? state.selectedMediaIndex : (gallery.length ? 0 : null);
  if (itemIndex == null || !gallery[itemIndex]) return null;
  return { state, panelIndex, panelMedia, gallery, itemIndex, item: gallery[itemIndex] };
}
function selectedAlignment(panel, interaction) { const selected = selectedItem(panel, interaction); return selected ? alignmentOf(selected.item) : null; }

function installUi(panel) {
  if (!panel || panel.__imageAlignmentUiInstalled) return;
  if (typeof panel.buildMediaManagerPanel === 'function') {
    const originalManager = panel.buildMediaManagerPanel.bind(panel);
    panel.buildMediaManagerPanel = (interaction, ...args) => {
      const payload = originalManager(interaction, ...args); const alignment = selectedAlignment(panel, interaction); if (!alignment) return payload;
      const rows = Array.isArray(payload?.components) ? payload.components : []; const buttons = alignmentButtons(alignment);
      const placementRow = rows.find((row) => { const ids = Array.isArray(row?.components) ? row.components.map(componentId) : []; return ids.some((id) => id === 'embed:media-placement:above' || id === 'embed:media-above') && ids.some((id) => id === 'embed:media-placement:below' || id === 'embed:media-below'); });
      if (placementRow && Array.isArray(placementRow.components) && placementRow.components.length <= 2) { placementRow.addComponents(...buttons); return payload; }
      const labelledPlacementRow = rows.find((row) => { const components = Array.isArray(row?.components) ? row.components : []; const labels = components.map((component) => String(component?.data?.label || component?.label || '')); return labels.some((label) => label.includes('Above Content')) && labels.some((label) => label.includes('Below Content')); });
      if (labelledPlacementRow && Array.isArray(labelledPlacementRow.components) && labelledPlacementRow.components.length <= 2) { labelledPlacementRow.addComponents(...buttons); return payload; }
      if (rows.length < 5) { const backIndex = rows.findIndex((row) => Array.isArray(row?.components) && row.components.some((c) => componentId(c) === 'embed:media-back')); const optionsBackIndex = rows.findIndex((row) => Array.isArray(row?.components) && row.components.some((c) => componentId(c) === 'embed:media-options-back')); const insertAt = backIndex >= 0 ? backIndex : optionsBackIndex >= 0 ? optionsBackIndex : rows.length; rows.splice(insertAt, 0, new ActionRowBuilder().addComponents(...buttons)); }
      return payload;
    };
  }
  if (typeof panel.buildMediaOptionsPanel === 'function') {
    const originalOptions = panel.buildMediaOptionsPanel.bind(panel);
    panel.buildMediaOptionsPanel = (interaction, ...args) => {
      const payload = originalOptions(interaction, ...args); const alignment = selectedAlignment(panel, interaction); if (!alignment) return payload;
      const embed = payload?.embeds?.[0]; if (embed?.data?.description != null) embed.setDescription(`${embed.data.description}\n**Image alignment:** ${alignment === 'center' ? 'Centre' : alignment[0].toUpperCase() + alignment.slice(1)}`.slice(0, 4096));
      return payload;
    };
  }
  panel.__imageAlignmentUiInstalled = true;
}

function installInteraction(panel, interactions) {
  if (!panel || !interactions || interactions.__imageAlignmentInteractionInstalled) return;
  const original = interactions.handleInteraction.bind(interactions);
  interactions.handleInteraction = async (interaction) => {
    const customId = String(interaction?.customId || ''); if (!customId.startsWith('embed:media-align:')) return original(interaction);
    const alignment = customId.split(':').pop(); if (!VALID_ALIGNMENTS.has(alignment)) return true;
    const selected = selectedItem(panel, interaction);
    if (!selected) { await interaction.update(panel.buildMediaManagerPanel(interaction, panel.memberName(interaction))); return true; }
    const nextGallery = selected.gallery.map((item, index) => index === selected.itemIndex ? { ...item, alignment } : item);
    const nextPanelMedia = { ...selected.panelMedia, gallery: nextGallery };
    const nextState = panel.setPanelMedia(selected.state, selected.panelIndex, nextPanelMedia);
    const canonical = canonicalizeState({ ...nextState, hasUnsavedChanges: true }, false);
    panel.saveSession(interaction, canonical);
    await interaction.update(panel.buildMediaManagerPanel(interaction, panel.memberName(interaction)));
    return true;
  };
  interactions.__imageAlignmentInteractionInstalled = true;
}

function installImageAlignment(panel, renderer, interactions = null) {
  installPersistence(panel);
  installUi(panel);
  if (interactions) installInteraction(panel, interactions);
}

module.exports = { installImageAlignment, installInteraction, applyAlignmentMap, alignmentOf, mapFromMedia, canonicalizeState };
