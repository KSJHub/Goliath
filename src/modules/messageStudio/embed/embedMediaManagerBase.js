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

  /*
   * mediaV2 is authoritative once a panel has a media slot.  The legacy
   * panel.image field exists only for backwards compatibility.  The original
   * setPanelMedia() normalizer could use that legacy value as a fallback while
   * clearing a gallery, immediately resurrecting the image that had just been
   * removed.  Keep writes panel-local and normalize the requested media with
   * no legacy fallback; saveMediaState() will mirror the resulting first item
   * (or an empty string) back to the legacy panel afterwards.
   */
  if (!panel.__panelLocalMediaWritePatched && typeof panel.setPanelMedia === 'function') {
    panel.setPanelMedia = (stateValue = {}, index, mediaValue = {}) => {
      const panels = Array.isArray(stateValue?.panels) ? stateValue.panels : [];
      const existing = stateValue?.mediaV2 || stateValue?.media || {};
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
        mediaV2: {
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
      const authoritative = stateValue.mediaV2 || stateValue.media || null;
      if (!authoritative) return originalSaveSession(interaction, stateValue);
      const mediaV2 = typeof media.clone === 'function' ? media.clone(authoritative) : JSON.parse(JSON.stringify(authoritative));
      const legacyMedia = typeof media.clone === 'function' ? media.clone(mediaV2) : JSON.parse(JSON.stringify(mediaV2));
      return originalSaveSession(interaction, { ...stateValue, media: legacyMedia, mediaV2 });
    };
    panel.__mediaSessionMirrorPatched = true;
  }

  panel.buildMediaManagerPanel = (interaction, who = 'Unknown User') => {
    const state = panel.getSession(interaction);
    const panelMedia = media.getPanelMedia(state);

    /*
     * Selection is a UI cursor, not media content. If media exists but the
     * cursor is missing/stale (for example after reopening the manager), use
     * the nearest valid item immediately so controls never appear disabled for
     * visible media. Interaction handlers persist explicit user selections.
     */
    const requestedGalleryIndex = Number.isInteger(state.selectedMediaIndex)
      ? state.selectedMediaIndex
      : null;
    const galleryIndex = panelMedia.gallery.length
      ? Math.max(0, Math.min(requestedGalleryIndex ?? 0, panelMedia.gallery.length - 1))
      : null;

    const requestedFileIndex = Number.isInteger(state.selectedFileIndex)
      ? state.selectedFileIndex
      : null;
    const fileIndex = panelMedia.files.length
      ? Math.max(0, Math.min(requestedFileIndex ?? 0, panelMedia.files.length - 1))
      : null;

    const selectedMedia =
      galleryIndex == null
        ? null
        : panelMedia.gallery[galleryIndex];

    const aboveCount =
      panelMedia.gallery.filter((item) => item?.placement === 'above').length;

    const belowCount =
      panelMedia.gallery.length - aboveCount;

    const placementLabel = (item) =>
      item?.placement === 'above'
        ? '⬆️ Above Content'
        : '⬇️ Below Content';

    const rows = [];

    /*
     * ROW 1 — MEDIA SELECTOR
     */
    if (panelMedia.gallery.length) {
      rows.push(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('embed:media-gallery-select')
            .setPlaceholder('🎞️ Select media item')
            .addOptions(
              panelMedia.gallery.slice(0, 25).map((item, index) => ({
                label: `${index + 1}. ${panel.trim(
                  item.alt || sourceLabel(item.source, 'Media item'),
                  80
                )}`,
                value: String(index),
                description: panel.trim(
                  `${item.type || 'auto'} • ${
                    item.placement === 'above'
                      ? 'Above Content'
                      : 'Below Content'
                  }${item.spoiler ? ' • spoiler' : ''}`,
                  100
                ),
                default: galleryIndex === index,
              }))
            )
        )
      );
    }

    /*
     * ROW 2 — MEDIA CRUD / ORDER
     */
    rows.push(
      new ActionRowBuilder().addComponents(
        mediaButton(
          'embed:media-gallery-add',
          `➕ Add Media (${panelMedia.gallery.length}/${media.mediaModel.MAX_GALLERY_ITEMS})`,
          ButtonStyle.Success,
          panelMedia.gallery.length >= media.mediaModel.MAX_GALLERY_ITEMS
        ),
        mediaButton(
          'embed:media-gallery-edit',
          '✏️ Edit',
          ButtonStyle.Primary,
          galleryIndex == null
        ),
        mediaButton(
          'embed:media-gallery-remove',
          '🗑️ Remove',
          ButtonStyle.Danger,
          galleryIndex == null
        ),
        mediaButton(
          'embed:media-gallery-up',
          '⬆️ Up',
          ButtonStyle.Secondary,
          galleryIndex == null || galleryIndex <= 0
        ),
        mediaButton(
          'embed:media-gallery-down',
          '⬇️ Down',
          ButtonStyle.Secondary,
          galleryIndex == null ||
            galleryIndex >= panelMedia.gallery.length - 1
        )
      )
    );

    /*
     * ROW 3 — PLACEMENT / OPTIONS
     */
    rows.push(
      new ActionRowBuilder().addComponents(
        mediaButton(
          'embed:media-placement:above',
          '⬆️ Above Content',
          selectedMedia?.placement === 'above'
            ? ButtonStyle.Success
            : ButtonStyle.Secondary,
          galleryIndex == null
        ),
        mediaButton(
          'embed:media-placement:below',
          '⬇️ Below Content',
          selectedMedia?.placement === 'below'
            ? ButtonStyle.Success
            : ButtonStyle.Secondary,
          galleryIndex == null
        ),
        mediaButton(
          'embed:media-options',
          '⚙️ Options',
          ButtonStyle.Secondary,
          galleryIndex == null
        ),
        mediaButton(
          'embed:media-upload',
          '📤 Upload',
          ButtonStyle.Success
        )
      )
    );

    /*
     * ROW 4 — SECONDARY MEDIA
     *
     * Keep files accessible without allowing them to consume an extra
     * action row and push navigation beyond Discord's five-row limit.
     */
    rows.push(
      new ActionRowBuilder().addComponents(
        mediaButton(
          'embed:media-thumbnail',
          panelMedia.thumbnail?.source
            ? '🖼️ Thumbnail ✓'
            : '🖼️ Thumbnail',
          ButtonStyle.Primary
        ),
        mediaButton(
          'embed:media-file-add',
          `📎 Add File (${panelMedia.files.length}/${media.mediaModel.MAX_FILES})`,
          ButtonStyle.Success,
          panelMedia.files.length >= media.mediaModel.MAX_FILES
        ),
        mediaButton(
          'embed:file-options',
          '⚙️ File Options',
          ButtonStyle.Secondary,
          fileIndex == null
        )
      )
    );

    /*
     * ROW 5 — NAVIGATION / HELP
     */
    rows.push(
      new ActionRowBuilder().addComponents(
        mediaButton('embed:builder', '⬅️ Back'),
        mediaButton('embed:helpers', '📖 Variables')
      )
    );

    const summary = [
      `Editing panel **${state.selectedPanelIndex + 1}/${state.panels.length}**`,
      '',
      `⬆️ **Above Content** — ${aboveCount}`,
      `⬇️ **Below Content** — ${belowCount}`,
      `🖼️ **Thumbnail** — ${panelMedia.thumbnail?.source ? 'Configured' : 'Not set'}`,
      `📎 **Files** — ${panelMedia.files.length}/${media.mediaModel.MAX_FILES}`,
      '',
      'Images, animated GIFs and supported videos can be placed independently above or below the panel content.',
    ];

    if (selectedMedia) {
      summary.push(
        '',
        `**Selected media:** ${sourceLabel(
          selectedMedia.alt || selectedMedia.source,
          `Item ${galleryIndex + 1}`
        )}`,
        `**Placement:** ${placementLabel(selectedMedia)}`,
        `**Type:** ${selectedMedia.type || 'auto'}`,
        `**Spoiler:** ${selectedMedia.spoiler ? 'On' : 'Off'}`
      );
    } else if (
      !panelMedia.thumbnail?.source &&
      !panelMedia.gallery.length &&
      !panelMedia.files.length
    ) {
      summary.push(
        '',
        'No media configured for this panel. Media on other panels is unaffected.'
      );
    }

    return {
      embeds: [
        panel.simplePanel(
          '🖼️ Media Manager',
          summary.join('\n'),
          state,
          who
        ),
      ],
      components: rows,
    };
  };

  panel.buildMediaManager = panel.buildMediaManagerPanel;
  panel.__mediaManagerBaseInstalled = true;
  return panel;
}

module.exports = { installMediaManagerBase };
