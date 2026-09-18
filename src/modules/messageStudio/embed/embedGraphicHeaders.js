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

  const originalBuildMediaManagerPanel = panel.buildMediaManagerPanel?.bind(panel);
  if (originalBuildMediaManagerPanel) {
    panel.buildMediaManagerPanel = (interaction, who = 'Unknown User') => {
      const payload = originalBuildMediaManagerPanel(interaction, who);
      const state = panel.getSession(interaction);
      const panelMedia = media.getPanelMedia(state, state.selectedPanelIndex || 0);
      const selectedIndex = selectedMediaIndex(state, panelMedia);
      const activeIndex = graphicHeaderIndex(panelMedia);
      const mode = headerMode(state, media);
      const rows = Array.isArray(payload?.components) ? payload.components : [];

      // Replace the old placement shortcut with the three-state header control.
      // This keeps the Media Manager within Discord's 5x5 component limits and
      // avoids two controls fighting over the same placement state.
      let mediaRow = rows.find((row) => Array.isArray(row?.components)
        && row.components.some((component) => componentId(component) === 'embed:media-options'));
      if (mediaRow?.components) {
        mediaRow.components = mediaRow.components.filter((component) => !String(componentId(component) || '').startsWith('embed:media-placement:'));
        if (mediaRow.components.length < 5) mediaRow.addComponents(headerButton(mode, selectedIndex == null));
      } else if (rows.length < 5) {
        rows.push(new ActionRowBuilder().addComponents(headerButton(mode, selectedIndex == null)));
      }

      const embed = payload?.embeds?.[0];
      if (embed?.data?.description != null) {
        const active = activeIndex == null ? null : panelMedia.gallery[activeIndex];
        const activeName = active ? sourceLabel(active.alt || active.source, `Item ${activeIndex + 1}`) : null;
        const selectedIsActive = selectedIndex != null && selectedIndex === activeIndex;
        const lines = activeName
          ? [`🪧 **Graphic Header** — ${activeName}`, `**Mode:** ${mode === 'graphic' ? 'Graphic only' : mode === 'both' ? 'Graphic + Text' : 'Text only'}${selectedIsActive ? ' • selected' : ''}`]
          : ['🪧 **Graphic Header** — none selected.', selectedIndex == null ? 'Select a gallery image/GIF to enable the Header control.' : 'Press **Header: Text** to use the selected media as the graphic header.'];
        embed.setDescription(`${embed.data.description}\n\n${lines.join('\n')}`.slice(0, 4096));
      }
      return { ...payload, components: rows.slice(0, 5) };
    };
    panel.buildMediaManager = panel.buildMediaManagerPanel;
  }

  const originalBuildMediaOptionsPanel = panel.buildMediaOptionsPanel?.bind(panel);
  if (originalBuildMediaOptionsPanel) {
    panel.buildMediaOptionsPanel = (interaction) => {
      const payload = originalBuildMediaOptionsPanel(interaction);
      const state = panel.getSession(interaction);
      const panelMedia = media.getPanelMedia(state, state.selectedPanelIndex || 0);
      const index = selectedMediaIndex(state, panelMedia);
      const mode = headerMode(state, media);
      const rows = Array.isArray(payload?.components) ? payload.components : [];
      const backRow = rows.find((row) => Array.isArray(row?.components)
        && row.components.some((component) => componentId(component) === 'embed:media-options-back'));
      if (backRow?.addComponents && (backRow.components?.length || 0) < 5) backRow.addComponents(headerButton(mode, index == null));
      return { ...payload, components: rows.slice(0, 5) };
    };
  }

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
