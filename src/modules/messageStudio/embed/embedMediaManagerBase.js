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

function installMediaManagerBase(panel, media) {
  if (!panel || !media || typeof panel.buildMediaManagerPanel === 'function') return panel;

  panel.buildMediaManagerPanel = (interaction, who = 'Unknown User') => {
    const state = panel.getSession(interaction);
    const panelMedia = media.getPanelMedia(state);
    const galleryIndex = Number.isInteger(state.selectedMediaIndex) && state.selectedMediaIndex < panelMedia.gallery.length
      ? state.selectedMediaIndex
      : null;
    const fileIndex = Number.isInteger(state.selectedFileIndex) && state.selectedFileIndex < panelMedia.files.length
      ? state.selectedFileIndex
      : null;
    const rows = [];

    if (panelMedia.gallery.length) {
      rows.push(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('embed:media-gallery-select')
          .setPlaceholder('🖼️ Select gallery item')
          .addOptions(panelMedia.gallery.slice(0, 25).map((item, index) => ({
            label: `${index + 1}. ${panel.trim(item.alt || sourceLabel(item.source, 'Media item'), 90)}`,
            value: String(index),
            description: panel.trim(`${item.type || 'auto'}${item.spoiler ? ' • spoiler' : ''} • ${item.source || ''}`, 100),
            default: galleryIndex === index,
          }))),
      ));
    }

    rows.push(new ActionRowBuilder().addComponents(
      mediaButton('embed:media-gallery-add', `➕ Add Media (${panelMedia.gallery.length}/${media.mediaModel.MAX_GALLERY_ITEMS})`, ButtonStyle.Success, panelMedia.gallery.length >= media.mediaModel.MAX_GALLERY_ITEMS),
      mediaButton('embed:media-gallery-edit', '✏️ Edit Media', ButtonStyle.Primary, galleryIndex == null),
      mediaButton('embed:media-gallery-remove', '🗑️ Remove Media', ButtonStyle.Danger, galleryIndex == null),
      mediaButton('embed:media-gallery-up', '⬆️ Up', ButtonStyle.Secondary, galleryIndex == null || galleryIndex <= 0),
      mediaButton('embed:media-gallery-down', '⬇️ Down', ButtonStyle.Secondary, galleryIndex == null || galleryIndex >= panelMedia.gallery.length - 1),
    ));

    if (panelMedia.files.length) {
      rows.push(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('embed:media-file-select')
          .setPlaceholder('📎 Select attached file')
          .addOptions(panelMedia.files.slice(0, 25).map((item, index) => ({
            label: `${index + 1}. ${panel.trim(item.name || sourceLabel(item.source, 'File'), 90)}`,
            value: String(index),
            description: panel.trim(item.description || item.source || 'Attached file', 100),
            default: fileIndex === index,
          }))),
      ));
    }

    rows.push(new ActionRowBuilder().addComponents(
      mediaButton('embed:media-file-add', `📎 Add File (${panelMedia.files.length}/${media.mediaModel.MAX_FILES})`, ButtonStyle.Success, panelMedia.files.length >= media.mediaModel.MAX_FILES),
      mediaButton('embed:media-file-edit', '✏️ Edit File', ButtonStyle.Secondary, fileIndex == null),
      mediaButton('embed:media-file-remove', '🗑️ Remove File', ButtonStyle.Danger, fileIndex == null),
      mediaButton('embed:file-options', '⚙️ File Options', ButtonStyle.Secondary, fileIndex == null),
    ));

    rows.push(new ActionRowBuilder().addComponents(
      mediaButton('embed:media-thumbnail', panelMedia.thumbnail?.source ? '🖼️ Thumbnail ✓' : '🖼️ Thumbnail', ButtonStyle.Primary),
      mediaButton('embed:media-upload', '📤 Upload Media', ButtonStyle.Success),
      mediaButton('embed:media-options', '⚙️ Media Options', ButtonStyle.Secondary, galleryIndex == null),
    ));

    rows.push(new ActionRowBuilder().addComponents(
      mediaButton('embed:builder', '⬅️ Builder'),
      mediaButton('embed:helpers', '📖 Variables'),
    ));

    const selectedMedia = galleryIndex == null ? null : panelMedia.gallery[galleryIndex];
    const selectedFile = fileIndex == null ? null : panelMedia.files[fileIndex];
    const summary = [
      `Editing panel **${state.selectedPanelIndex + 1}/${state.panels.length}**`,
      '',
      `🖼️ **Thumbnail** — ${panelMedia.thumbnail?.source ? 'Configured' : 'Not set'}`,
      `🎞️ **Gallery** — ${panelMedia.gallery.length}/${media.mediaModel.MAX_GALLERY_ITEMS}`,
      `📎 **Files** — ${panelMedia.files.length}/${media.mediaModel.MAX_FILES}`,
    ];

    if (selectedMedia) {
      summary.push('', `**Selected media:** ${sourceLabel(selectedMedia.alt || selectedMedia.source, `Item ${galleryIndex + 1}`)}`);
    } else if (selectedFile) {
      summary.push('', `**Selected file:** ${sourceLabel(selectedFile.name || selectedFile.source, `File ${fileIndex + 1}`)}`);
    } else if (!panelMedia.thumbnail?.source && !panelMedia.gallery.length && !panelMedia.files.length) {
      summary.push('', 'No media configured yet. Use **Add Media**, **Upload Media**, or **Thumbnail** to begin.');
    }

    return {
      embeds: [panel.simplePanel(
        '🖼️ Media Manager',
        summary.join('\n'),
        state,
        who,
      )],
      components: rows.slice(0, 5),
    };
  };

  panel.buildMediaManager = panel.buildMediaManagerPanel;
  panel.__mediaManagerBaseInstalled = true;
  return panel;
}

module.exports = { installMediaManagerBase };
