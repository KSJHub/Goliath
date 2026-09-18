'use strict';

const { ButtonBuilder, ButtonStyle } = require('discord.js');

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

      // The Media Manager already uses five rows. Add the header control to the
      // existing media-actions row so the UI stays within Discord's row limit.
      const row = Array.isArray(payload?.components) ? payload.components[3] : null;
      if (row?.addComponents) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId('embed:graphic-header-cycle')
            .setLabel(modeLabel(mode))
            .setStyle(mode === 'graphic' ? ButtonStyle.Success : mode === 'both' ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setDisabled(index == null),
        );
      }

      const embed = payload?.embeds?.[0];
      if (embed?.data?.description != null) {
        const hint = index == null
          ? '\n\n🪧 **Graphic Header** — select a gallery image/GIF first.'
          : `\n\n🪧 **Graphic Header** — ${mode === 'text' ? 'Text title' : mode === 'graphic' ? 'Graphic replaces the text title' : 'Graphic plus text title'}. Click the header button to cycle modes.`;
        embed.setDescription(`${embed.data.description}${hint}`.slice(0, 4096));
      }
      return payload;
    };
    panel.buildMediaManager = panel.buildMediaManagerPanel;
  }

  const originalHandleInteraction = interactions.handleInteraction.bind(interactions);
  interactions.handleInteraction = async (interaction) => {
    const customId = String(interaction?.customId || '');
    if (customId !== 'embed:graphic-header-cycle') {
      return originalHandleInteraction(interaction);
    }

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
      // Text -> Graphic: move the selected GIF/image above content and preserve
      // the title so it can be restored by the next mode.
      gallery[mediaIndex].placement = 'above';
      patch = {
        graphicHeaderTitle: String(panelData.title || panelData.graphicHeaderTitle || ''),
        title: '',
      };
    } else if (currentMode === 'graphic') {
      // Graphic -> Graphic + Text.
      patch = {
        title: String(panelData.graphicHeaderTitle || ''),
        graphicHeaderTitle: String(panelData.graphicHeaderTitle || ''),
      };
    } else {
      // Graphic + Text -> Text: restore the title and return the selected media
      // to normal below-content gallery placement.
      gallery[mediaIndex].placement = 'below';
      patch = {
        title: String(panelData.title || panelData.graphicHeaderTitle || ''),
        graphicHeaderTitle: String(panelData.graphicHeaderTitle || panelData.title || ''),
      };
    }

    let next = panel.saveSelected(state, patch);
    next = media.setPanelMedia(next, panelIndex, { ...panelMedia, gallery });
    next = panel.saveSession(interaction, { ...next, hasUnsavedChanges: true });

    await interaction.update(panel.buildMediaManagerPanel(interaction, panel.memberName(interaction)));
    return true;
  };

  panel.__graphicHeadersInstalled = true;
}

module.exports = {
  installGraphicHeaders,
  headerMode,
};
