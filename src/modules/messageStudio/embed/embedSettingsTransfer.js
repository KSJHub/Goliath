'use strict';

const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  TextInputStyle,
} = require('discord.js');
const guildManager = require('../../../core/guild/guildManager');

function cleanName(value) {
  return String(value || '').trim().slice(0, 50);
}

function portableDocument(name, preset) {
  return {
    format: 'goliath-embed-preset',
    version: 1,
    name,
    exportedAt: new Date().toISOString(),
    preset,
  };
}

function parseDocument(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('Paste a preset JSON document.');
  if (Buffer.byteLength(raw, 'utf8') > 1024 * 1024) throw new Error('Preset imports are limited to 1 MB.');
  let document;
  try { document = JSON.parse(raw); }
  catch { throw new Error('The pasted text is not valid JSON.'); }
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('The JSON does not contain a valid preset object.');
  const wrapped = document.format === 'goliath-embed-preset' && document.preset && typeof document.preset === 'object' && !Array.isArray(document.preset);
  const preset = wrapped ? document.preset : document;
  const name = cleanName(wrapped ? (document.name || preset.name) : preset.name);
  return { name, preset };
}

async function importDocument(interaction, panel, document) {
  const guildId = interaction.guildId || interaction.guild?.id || null;
  if (!guildId) throw new Error('Preset import requires a server.');
  const imported = typeof document === 'string' ? parseDocument(document) : document;
  const name = cleanName(imported.name);
  if (!name) throw new Error('The imported preset does not contain a valid preset name.');
  if (name.startsWith('auto-')) throw new Error('Preset names beginning with "auto-" are reserved by Goliath.');
  if (guildManager.getEmbedPreset?.(guildId, name)) throw new Error(`A preset named "${name}" already exists. Rename or delete the existing preset before importing.`);
  const saved = guildManager.saveEmbedPreset?.(guildId, name, imported.preset, interaction.guild);
  if (!saved) throw new Error(`Could not import preset "${name}".`);
  const current = panel.getSession(interaction);
  panel.saveSession(interaction, { ...current, selectedPreset: name });
  return name;
}

function selectedExport(interaction, panel) {
  const guildId = interaction.guildId || interaction.guild?.id || null;
  if (!guildId) throw new Error('Preset export requires a server.');
  const current = panel.getSession(interaction);
  const name = cleanName(current?.selectedPreset);
  const preset = name ? guildManager.getEmbedPreset?.(guildId, name) : null;
  if (!name || !preset || name.startsWith('auto-')) throw new Error('Select a saved preset in Preset Manager before exporting it.');
  return { name, document: portableDocument(name, preset) };
}

function safeFilename(name) {
  const safe = String(name || 'embed-preset').trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return `${safe || 'embed-preset'}.json`;
}

function codeChunks(json, max = 1800) {
  const chunks = [];
  for (let offset = 0; offset < json.length; offset += max) chunks.push(json.slice(offset, offset + max));
  return chunks;
}

function installSettingsTransfer(panel, interactions) {
  if (!panel || !interactions || interactions.__settingsTransferInstalled) return;

  const originalImportModal = panel.settingsImportModal;
  panel.settingsImportModal = () => originalImportModal();
  panel.settingsPasteModal = () => panel.modal('embed:settings-paste-save', 'Paste Embed Preset JSON', [
    panel.input('preset_json', 'Preset JSON code', TextInputStyle.Paragraph, '', true, 4000),
  ]);

  panel.buildSettingsPanel = (interaction) => {
    const state = panel.getSession(interaction);
    const description = [
      'Manage Embed Builder settings and move saved presets between Goliath servers.',
      '',
      '### 📥 Import Preset',
      '**Upload JSON** — upload an exported `.json` preset file.',
      '**Paste JSON** — paste portable preset JSON code directly.',
      '',
      '### 📤 Export Preset',
      '**JSON File** — download the selected saved preset as a portable `.json` file.',
      '**JSON Code** — display the selected preset as copyable JSON code.',
      '',
      'Select the preset you want to export in **Preset Manager** first.',
    ].join('\n');
    return {
      embeds: [panel.simplePanel('⚙️ Embed Settings', description, state, panel.memberName(interaction))],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('embed:settings-import').setLabel('Upload JSON').setEmoji('📁').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('embed:settings-paste').setLabel('Paste JSON').setEmoji('📋').setStyle(ButtonStyle.Primary),
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('embed:settings-export').setLabel('JSON File').setEmoji('📁').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('embed:settings-export-code').setLabel('JSON Code').setEmoji('📋').setStyle(ButtonStyle.Secondary),
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('embed:builder').setLabel('Back').setEmoji('⬅️').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('embed:helpers').setLabel('Variables').setEmoji('📖').setStyle(ButtonStyle.Secondary),
        ),
      ],
    };
  };

  const originalHandle = interactions.handleInteraction.bind(interactions);
  interactions.handleInteraction = async (interaction) => {
    const customId = String(interaction?.customId || '');
    if (customId === 'embed:settings-paste' && interaction.isButton?.()) {
      await interaction.showModal(panel.settingsPasteModal());
      return true;
    }
    if (customId === 'embed:settings-paste-save' && interaction.isModalSubmit?.()) {
      try {
        const name = await importDocument(interaction, panel, interaction.fields.getTextInputValue('preset_json'));
        await interaction.reply({ content: `✅ Imported preset **${name}** successfully.`, ...panel.buildSettingsPanel(interaction), flags: MessageFlags.Ephemeral });
      } catch (error) {
        await interaction.reply({ content: `❌ Preset import failed: ${error?.message || 'Unknown error.'}`, flags: MessageFlags.Ephemeral });
      }
      return true;
    }
    if (customId === 'embed:settings-export-code' && interaction.isButton?.()) {
      try {
        const { name, document } = selectedExport(interaction, panel);
        const json = JSON.stringify(document, null, 2);
        const chunks = codeChunks(json);
        await interaction.reply({ content: `📋 JSON code for **${name}**${chunks.length > 1 ? ` (${chunks.length} copyable parts)` : ''}:\n\n\`\`\`json\n${chunks[0]}\n\`\`\``, flags: MessageFlags.Ephemeral });
        for (let index = 1; index < chunks.length; index += 1) {
          await interaction.followUp({ content: `**Part ${index + 1}/${chunks.length}**\n\`\`\`json\n${chunks[index]}\n\`\`\``, flags: MessageFlags.Ephemeral });
        }
      } catch (error) {
        await interaction.reply({ content: `❌ Preset export failed: ${error?.message || 'Unknown error.'}`, flags: MessageFlags.Ephemeral });
      }
      return true;
    }
    if (customId === 'embed:settings-export' && interaction.isButton?.()) {
      try {
        const { name, document } = selectedExport(interaction, panel);
        const attachment = new AttachmentBuilder(Buffer.from(JSON.stringify(document, null, 2), 'utf8'), { name: safeFilename(name) });
        await interaction.reply({ content: `📤 Exported preset **${name}**.`, files: [attachment], flags: MessageFlags.Ephemeral });
      } catch (error) {
        await interaction.reply({ content: `❌ Preset export failed: ${error?.message || 'Unknown error.'}`, flags: MessageFlags.Ephemeral });
      }
      return true;
    }
    return originalHandle(interaction);
  };

  interactions.__settingsTransferInstalled = true;
}

module.exports = { installSettingsTransfer, parseDocument, importDocument, portableDocument };
