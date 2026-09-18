'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

function selectedPanel(state) {
  const panels = Array.isArray(state?.panels) ? state.panels : [];
  return panels[Math.max(0, Number(state?.selectedPanelIndex) || 0)] || {};
}

function selectedMediaIndex(state, panelMedia) {
  const index = Number(state?.selectedMediaIndex);
  return Number.isInteger(index) && index >= 0 && index < (panelMedia?.gallery?.length || 0)
    ? index
    : null;
}

function headerMode(state, media) {
  const panelData = selectedPanel(state);
  const panelMedia = media.getPanelMedia(state, state?.selectedPanelIndex || 0);
  const index = selectedMediaIndex(state, panelMedia);
  if (index == null) return 'text';
  const above = panelMedia.gallery[index]?.placement === 'above';
  const titleVisible = Boolean(String(panelData.title || '').trim());
  if (!above) return 'text';
  return titleVisible ? 'both' : 'graphic';
}

function modeLabel(mode) {
  if (mode === 'graphic') return '🖼️ Header: Graphic';
  if (mode === 'both') return '🖼️ Header: Graphic + Text';
  return '📝 Header: Text';
}

function componentId(component) {
  return component?.data?.custom_id || component?.customId || component?.custom_id || null;
}

function headerButton(mode, disabled = false) {
  return new ButtonBuilder()
    .setCustomId('embed:graphic-header-cycle')
    .setLabel(modeLabel(mode))
    .setStyle(mode === 'graphic' ? ButtonStyle.Success : mode === 'both' ? ButtonStyle.Primary : ButtonStyle.Secondary)
    .setDisabled(disabled);
}

function installGraphicHeaders(panel, media, interactions) {
  if (!panel || !media || !interactions || panel.__graphicHeadersInstalled) return;

  const originalBuildMediaManagerPanel = panel.buildMediaManagerPanel?.bind(panel);
  if (originalBuildMediaManagerPanel) {
    panel.buildMediaManagerPanel = (interaction, who = 'Unknown User') => {
      const payload = originalBuildMediaManagerPanel(interaction, who);
      const state = panel.getSession(interaction);
      const panelMedia = media.getPanelMedia(state, state.selectedPanelIndex || 0);
      const index = selectedMediaIndex(state, panelMedia);
      const mode = headerMode(state, media);
      const rows = Array.isArray(payload?.components) ? payload.components : [];

      // Locate the media-actions row by component ID instead of relying on a
      // fixed row index. Media Manager can insert/remove select rows depending
      // on whether gallery/files exist, so positional assumptions are unsafe.
      let mediaRow = rows.find((row) => Array.isArray(row?.components)
        && row.components.some((component) => componentId(component) === 'embed:media-options'));

      if (mediaRow?.addComponents && (mediaRow.components?.length || 0) < 5) {
        mediaRow.addComponents(headerButton(mode, index == null));
      } else if (rows.length < 5) {
        rows.push(new ActionRowBuilder().addComponents(headerButton(mode, index == null)));
      } else {
        // Five Discord rows are already occupied. Keep the control visible by
        // placing it in the media-actions row and dropping only the redundant
        // base placement shortcut if one exists.
        mediaRow = mediaRow || rows.find((row) => Array.isArray(row?.components)
          && row.components.some((component) => String(componentId(component) || '').startsWith('embed:media-placement:')));
        if (mediaRow?.components) {
          const withoutLegacyHeader = mediaRow.components.filter((component) => !String(componentId(component) || '').startsWith('embed:media-placement:'));
          if (withoutLegacyHeader.length < 5) {
            mediaRow.components = withoutLegacyHeader;
            mediaRow.addComponents(headerButton(mode, index == null));
          }
        }
      }

      const embed = payload?.embeds?.[0];
      if (embed?.data?.description != null) {
        const hint = index == null
          ? '\n\n🪧 **Graphic Header** — select a gallery image/GIF first.'
          : `\n\n🪧 **Graphic Header** — ${mode === 'text' ? 'Text title' : mode === 'graphic' ? 'Graphic replaces the text title' : 'Graphic plus text title'}. Use the Header button to cycle modes.`;
        embed.setDescription(`${embed.data.description}${hint}`.slice(0, 4096));
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
    const gallery = panelMedia.gallery.map((item) => ({ ...item }));
    let patch = {};

    if (currentMode === 'text') {
      gallery[mediaIndex].placement = 'above';
      patch = {
        graphicHeaderTitle: String(panelData.title || panelData.graphicHeaderTitle || ''),
        title: '',
      };
    } else if (currentMode === 'graphic') {
      patch = {
        title: String(panelData.graphicHeaderTitle || ''),
        graphicHeaderTitle: String(panelData.graphicHeaderTitle || ''),
      };
    } else {
      gallery[mediaIndex].placement = 'below';
      patch = {
        title: String(panelData.title || panelData.graphicHeaderTitle || ''),
        graphicHeaderTitle: String(panelData.graphicHeaderTitle || panelData.title || ''),
      };
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
};
