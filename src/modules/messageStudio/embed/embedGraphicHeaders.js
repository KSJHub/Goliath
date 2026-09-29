'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

function selectedPanel(state) {
  const panels = Array.isArray(state?.panels) ? state.panels : [];
  return panels[Math.max(0, Number(state?.selectedPanelIndex) || 0)] || {};
}

function selectedMediaIndex(state, panelMedia) {
  const index = Number(state?.selectedMediaIndex);
  return Number.isInteger(index) && index >= 0 && index < (panelMedia?.gallery?.length || 0) ? index : null;
}

function graphicHeaderIndex(panelMedia) {
  const gallery = Array.isArray(panelMedia?.gallery) ? panelMedia.gallery : [];
  const index = gallery.findIndex((item) => String(item?.placement || '').toLowerCase() === 'above');
  return index >= 0 ? index : null;
}

function headerMode(state, media) {
  const panelData = selectedPanel(state);
  const panelMedia = media.getPanelMedia(state, state?.selectedPanelIndex || 0);
  if (graphicHeaderIndex(panelMedia) == null) return 'text';
  return String(panelData.title || '').trim() ? 'both' : 'graphic';
}

function modeLabel(mode) {
  if (mode === 'graphic') return 'Header: Graphic';
  if (mode === 'both') return 'Header: Graphic + Text';
  return 'Header: Text';
}

function componentId(component) {
  return component?.data?.custom_id || component?.customId || component?.custom_id || null;
}

function headerButton(mode, disabled = false) {
  return new ButtonBuilder()
    .setCustomId('embed:graphic-header-cycle')
    .setLabel(modeLabel(mode))
    .setEmoji(mode === 'text' ? '📝' : '🖼️')
    .setStyle(mode === 'graphic' ? ButtonStyle.Success : mode === 'both' ? ButtonStyle.Primary : ButtonStyle.Secondary)
    .setDisabled(disabled);
}

function sourceLabel(value, fallback = 'Media item') {
  const text = String(value || '').trim();
  if (!text) return fallback;
  try {
    const url = new URL(text);
    return decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || fallback).slice(0, 80);
  } catch { return text.slice(0, 80); }
}

function normalizeHeaderPlacements(gallery, headerIndex = null) {
  return (Array.isArray(gallery) ? gallery : []).map((item, index) => ({
    ...item,
    placement: headerIndex != null && index === headerIndex ? 'above' : 'below',
  }));
}

function installGraphicHeaders(panel, media, interactions) {
  if (!panel || !media || !interactions || panel.__graphicHeadersInstalled) return;

  const originalHandleInteraction = interactions.handleInteraction.bind(interactions);
  interactions.handleInteraction = async (interaction) => {
    const customId = String(interaction?.customId || '');
    if (customId !== 'embed:graphic-header-cycle') return originalHandleInteraction(interaction);

    const state = panel.getSession(interaction);
    const panelIndex = Math.max(0, Number(state.selectedPanelIndex) || 0);
    const panelData = selectedPanel(state);
    const panelMedia = media.getPanelMedia(state, panelIndex);
    const mediaIndex = selectedMediaIndex(state, panelMedia);
    if (mediaIndex == null) {
      await interaction.update(panel.buildMediaManagerPanel(interaction, panel.memberName(interaction)));
      return true;
    }

    const currentMode = headerMode(state, media);
    const activeIndex = graphicHeaderIndex(panelMedia);
    let gallery = panelMedia.gallery.map((item) => ({ ...item }));
    let patch = {};

    if (currentMode === 'text') {
      // Selecting a new header atomically demotes any previous header. There can
      // only be one graphic header per panel.
      gallery = normalizeHeaderPlacements(gallery, mediaIndex);
      patch = { graphicHeaderTitle: String(panelData.title || panelData.graphicHeaderTitle || ''), title: '' };
    } else if (currentMode === 'graphic') {
      // If the user selected a different gallery item while Graphic mode is
      // active, switch the header to that item without losing the saved title.
      if (activeIndex !== mediaIndex) gallery = normalizeHeaderPlacements(gallery, mediaIndex);
      patch = { title: String(panelData.graphicHeaderTitle || ''), graphicHeaderTitle: String(panelData.graphicHeaderTitle || '') };
    } else {
      // Graphic + Text -> Text. Demote the actual active header, regardless of
      // which gallery item is currently selected.
      gallery = normalizeHeaderPlacements(gallery, null);
      patch = { title: String(panelData.title || panelData.graphicHeaderTitle || ''), graphicHeaderTitle: String(panelData.graphicHeaderTitle || panelData.title || '') };
    }

    let next = panel.saveSelected(state, patch);
    next = media.setPanelMedia(next, panelIndex, { ...panelMedia, gallery });
    panel.saveSession(interaction, { ...next, hasUnsavedChanges: true });
    await interaction.update(panel.buildMediaManagerPanel(interaction, panel.memberName(interaction)));
    return true;
  };

  panel.__graphicHeadersInstalled = true;
}

module.exports = {
  installGraphicHeaders,
  headerMode,
  graphicHeaderIndex,
  normalizeHeaderPlacements,
};
