'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');

function mediaButton(id, label, style = ButtonStyle.Secondary, disabled = false) {
  return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
}

function sourceLabel(value, fallback = 'Not set') {
  const text = String(value || '').trim();
  if (!text) return fallback;
  try {
    const url = new URL(text);
    const name = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || 'Media');
    return name.length > 42 ? `${name.slice(0, 39)}...` : name;
  } catch {
    return text.length > 42 ? `${text.slice(0, 39)}...` : text;
  }
}

function clone(value, fallback = null) {
  try { return JSON.parse(JSON.stringify(value ?? fallback)); } catch { return fallback; }
}

function installMediaManagerBase(panel, media) {
  if (!panel || !media || typeof panel.buildMediaManagerPanel === 'function') return panel;

  if (!panel.__panelLocalMediaWritePatched && typeof panel.setPanelMedia === 'function') {
    panel.setPanelMedia = (stateValue = {}, index, mediaValue = {}) => {
      const panels = Array.isArray(stateValue?.panels) ? stateValue.panels : [];
      const existing = stateValue?.media || {};
      const existingPanels = Array.isArray(existing?.panels) ? existing.panels : [];
      const length = Math.max(panels.length, existingPanels.length, 1);
      const selected = Math.max(0, Math.min(Number(index) || 0, length - 1));
      const mediaPanels = [];

      for (let n = 0; n < length; n += 1) {
        if (n === selected) {
          mediaPanels.push(media.mediaModel.normalizePanelMedia(mediaValue, {}));
          continue;
        }
        if (existingPanels[n]) {
          mediaPanels.push(media.mediaModel.normalizePanelMedia(existingPanels[n], {}));
          continue;
        }
        mediaPanels.push(media.mediaModel.normalizePanelMedia({}, panels[n] || {}));
      }

      return {
        ...stateValue,
        media: {
          version: media.mediaModel.MEDIA_SCHEMA_VERSION,
          panels: mediaPanels,
        },
      };
    };
    panel.__panelLocalMediaWritePatched = true;
  }

  if (!panel.__mediaSessionMirrorPatched && typeof panel.saveSession === 'function') {
    const originalSaveSession = panel.saveSession.bind(panel);
    panel.saveSession = (interaction, stateValue) => {
      if (!stateValue || typeof stateValue !== 'object') return originalSaveSession(interaction, stateValue);
      const authoritative = stateValue.media || null;
      if (!authoritative) return originalSaveSession(interaction, stateValue);
      const canonicalMedia = typeof media.clone === 'function' ? media.clone(authoritative) : clone(authoritative, {});
      const alignmentMap = stateValue.mediaAlignment && typeof stateValue.mediaAlignment === 'object'
        ? stateValue.mediaAlignment
        : {};
      const mediaPanels = Array.isArray(canonicalMedia?.panels) ? canonicalMedia.panels : [];
      for (let panelIndex = 0; panelIndex < mediaPanels.length; panelIndex += 1) {
        const gallery = Array.isArray(mediaPanels[panelIndex]?.gallery) ? mediaPanels[panelIndex].gallery : [];
        for (let itemIndex = 0; itemIndex < gallery.length; itemIndex += 1) {
          const key = `${panelIndex}:${itemIndex}`;
          const mapped = String(alignmentMap[key] || gallery[itemIndex]?.alignment || 'left').toLowerCase();
          gallery[itemIndex].alignment = ['left', 'center', 'right'].includes(mapped) ? mapped : 'left';
        }
      }
      const storedMedia = typeof media.clone === 'function' ? media.clone(canonicalMedia) : clone(canonicalMedia, {});
      return originalSaveSession(interaction, { ...stateValue, media: storedMedia });
    };
    panel.__mediaSessionMirrorPatched = true;
  }

  panel.buildMediaManagerPanel = (interaction, who = 'Unknown User', stateOverride = null) => {
    const state = stateOverride && typeof stateOverride === 'object'
      ? stateOverride
      : panel.getSession(interaction);
    const panelMedia = media.getPanelMedia(state);
    const requestedGalleryIndex = Number.isInteger(state.selectedMediaIndex) ? state.selectedMediaIndex : null;
    const galleryIndex = panelMedia.gallery.length ? Math.max(0, Math.min(requestedGalleryIndex ?? 0, panelMedia.gallery.length - 1)) : null;
    const selectedMedia = galleryIndex == null ? null : panelMedia.gallery[galleryIndex];
    const aboveCount = panelMedia.gallery.filter((item) => item?.placement === 'above').length;
    const belowCount = panelMedia.gallery.length - aboveCount;
    const placementLabel = (item) => item?.placement === 'above' ? '⬆️ Above Content' : '⬇️ Below Content';
    const rows = [];

    if (panelMedia.gallery.length) {
      rows.push(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId('embed:media-gallery-select').setPlaceholder('🎞️ Select media item').addOptions(
          panelMedia.gallery.slice(0, 25).map((item, index) => ({
            label: `${index + 1}. ${panel.trim(item.alt || sourceLabel(item.source, 'Media item'), 80)}`,
            value: String(index),
            description: panel.trim(`${item.type || 'auto'} • ${item.placement === 'above' ? 'Above Content' : 'Below Content'}${item.spoiler ? ' • spoiler' : ''}`, 100),
            default: galleryIndex === index,
          }))
        )
      ));
    }

    rows.push(new ActionRowBuilder().addComponents(
      mediaButton('embed:media-add', '➕ Add Media / File', ButtonStyle.Success, panelMedia.gallery.length >= media.mediaModel.MAX_GALLERY_ITEMS && panelMedia.files.length >= media.mediaModel.MAX_FILES),
      mediaButton('embed:media-gallery-edit', '✏️ Edit', ButtonStyle.Primary, galleryIndex == null),
      mediaButton('embed:media-gallery-remove', '🗑️ Remove', ButtonStyle.Danger, galleryIndex == null),
      mediaButton('embed:media-gallery-up', '⬆️ Up', ButtonStyle.Secondary, galleryIndex == null || galleryIndex <= 0),
      mediaButton('embed:media-gallery-down', '⬇️ Down', ButtonStyle.Secondary, galleryIndex == null || galleryIndex >= panelMedia.gallery.length - 1)
    ));

    rows.push(new ActionRowBuilder().addComponents(
      mediaButton('embed:media-placement:above', '⬆️ Above Content', selectedMedia?.placement === 'above' ? ButtonStyle.Success : ButtonStyle.Secondary, galleryIndex == null),
      mediaButton('embed:media-placement:below', '⬇️ Below Content', selectedMedia?.placement === 'below' ? ButtonStyle.Success : ButtonStyle.Secondary, galleryIndex == null),
      mediaButton('embed:media-thumbnail', panelMedia.thumbnail?.source ? '🖼️ Thumbnail ✓' : '🖼️ Thumbnail', ButtonStyle.Primary)
    ));

    const alignmentMap = state?.mediaAlignment && typeof state.mediaAlignment === 'object' ? state.mediaAlignment : {};
    const alignmentKey = galleryIndex == null ? null : `${Math.max(0, Number(state.selectedPanelIndex) || 0)}:${galleryIndex}`;
    const rawAlignment = String(alignmentMap[alignmentKey] || selectedMedia?.alignment || 'left').toLowerCase();
    const selectedAlignment = ['left', 'center', 'right'].includes(rawAlignment) ? rawAlignment : 'left';
    const alignmentLabel = selectedAlignment === 'center' ? '↔️ Centre' : selectedAlignment === 'right' ? '➡️ Right' : '⬅️ Left';

    rows.push(new ActionRowBuilder().addComponents(
      mediaButton('embed:media-align:left', '⬅️ Left', selectedAlignment === 'left' ? ButtonStyle.Primary : ButtonStyle.Secondary, galleryIndex == null),
      mediaButton('embed:media-align:center', '↔️ Centre', selectedAlignment === 'center' ? ButtonStyle.Primary : ButtonStyle.Secondary, galleryIndex == null),
      mediaButton('embed:media-align:right', '➡️ Right', selectedAlignment === 'right' ? ButtonStyle.Primary : ButtonStyle.Secondary, galleryIndex == null)
    ));

    rows.push(new ActionRowBuilder().addComponents(
      mediaButton('embed:builder', '⬅️ Back'),
      mediaButton('embed:settings', '⚙️ Settings'),
      mediaButton('embed:helpers', '📖 Variables')
    ));

    const summary = [
      `Editing panel **${state.selectedPanelIndex + 1}/${state.panels.length}**`, '',
      `⬆️ **Above Content** — ${aboveCount}`,
      `⬇️ **Below Content** — ${belowCount}`,
      `🖼️ **Thumbnail** — ${panelMedia.thumbnail?.source ? 'Configured' : 'Not set'}`,
      `📎 **Files** — ${panelMedia.files.length}/${media.mediaModel.MAX_FILES}`, '',
      'Images, animated GIFs and supported videos can be placed independently above or below the panel content.',
    ];

    if (selectedMedia) {
      summary.push('',
        `**Selected media:** ${sourceLabel(selectedMedia.alt || selectedMedia.source, `Item ${galleryIndex + 1}`)}`,
        `**Placement:** ${placementLabel(selectedMedia)}`,
        `**Alignment:** ${alignmentLabel}`,
        `**Type:** ${selectedMedia.type || 'auto'}`,
        `**Spoiler:** ${selectedMedia.spoiler ? 'On' : 'Off'}`
      );
    } else if (!panelMedia.thumbnail?.source && !panelMedia.gallery.length && !panelMedia.files.length) {
      summary.push('', 'No media configured for this panel. Media on other panels is unaffected.');
    }

    return {
      embeds: [panel.simplePanel('🖼️ Media Manager', summary.join('\n'), state, who)],
      components: rows,
    };
  };

  panel.buildMediaManager = panel.buildMediaManagerPanel;
  panel.__mediaManagerBaseInstalled = true;
  return panel;
}

module.exports = { installMediaManagerBase };
