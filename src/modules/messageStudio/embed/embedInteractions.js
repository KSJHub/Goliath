'use strict';

const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  PermissionsBitField,
  TextInputStyle,
} = require('discord.js');
const panel = require('./embedPanel');
const media = require('./embedMedia');
const guildManager = require('../../../core/guild/guildManager');
const {
  validateChannelAccess,
  canManageRole,
} = require('../../../core/security/protection/permissions');
const {
  EMBED_BUTTON_ACTIONS,
  EMBED_ROLE_BUTTON_ACTIONS,
  normalizeEmbedButtonAction,
  parseEmbedButtonActionIndex,
  legacyEmbedButtonActionFromId,
  resolveEmbedButtonDeployment,
  applyEmbedRoleMutation,
  saveEmbedDeployment,
  getEmbedDeployment,
  getDeploymentKeyFromState,
} = require('./embedDeployments');
const { buildEmbedPayload } = require('./embedRenderer');

// Embed interactions can be loaded directly by the runtime dispatcher as well as
// through embed.js. Always install the canonical Media Manager onto the shared
// panel before any media interaction handler can execute.
media.installStateCompatibility(panel);
media.installPersistentMediaCompatibility(panel);
media.installStorageNormalization(panel);
media.installUploadModals(panel);
media.installMediaManagerUi(panel);
media.installThumbnailUi(panel);
if (typeof panel.getPanelMedia !== 'function') panel.getPanelMedia = media.getPanelMedia;
if (typeof panel.setPanelMedia !== 'function') panel.setPanelMedia = media.setPanelMedia;
panel.mediaModel = media.mediaModel;

const DANGEROUS_ROLE_PERMISSIONS = [
  PermissionsBitField.Flags.Administrator,
  PermissionsBitField.Flags.ManageGuild,
  PermissionsBitField.Flags.ManageRoles,
  PermissionsBitField.Flags.ManageChannels,
  PermissionsBitField.Flags.ManageWebhooks,
  PermissionsBitField.Flags.BanMembers,
  PermissionsBitField.Flags.KickMembers,
  PermissionsBitField.Flags.ModerateMembers,
];
const pendingPresetSaves = new Map();

function resolved(value, interaction) {
  try { return interaction ? panel.replaceVars(String(value || ''), interaction) : String(value || ''); }
  catch { return String(value || ''); }
}
function resolveButton(interaction) {
  const index = parseEmbedButtonActionIndex(interaction.customId);
  if (!Number.isInteger(index) || index < 0 || index >= panel.MAX_BUTTONS) return { index, button: null, deployment: null };
  const { deployment, buttons } = resolveEmbedButtonDeployment(interaction.guildId, interaction.message?.id);
  return { index, button: buttons[index] || null, deployment };
}
async function ephemeral(interaction, payload) {
  const body = typeof payload === 'string' ? { content: payload } : payload;
  if (interaction.deferred || interaction.replied) return interaction.followUp({ ...body, flags: MessageFlags.Ephemeral });
  return interaction.reply({ ...body, flags: MessageFlags.Ephemeral });
}
async function roleIsSafe(roleId, guild) {
  if (!roleId || !guild) return { ok: false, reason: 'Role not found.', role: null };
  const manageable = await canManageRole(guild, roleId);
  if (!manageable.ok) return { ok: false, reason: manageable.message || 'Goliath cannot manage that role.', role: null };
  const role = guild.roles?.cache?.get?.(manageable.roleId) || null;
  if (!role) return { ok: false, reason: 'Role not found.', role: null };
  if (DANGEROUS_ROLE_PERMISSIONS.some((permission) => role.permissions.has(permission))) return { ok: false, reason: 'Self-service buttons cannot manage privileged moderation or administration roles.', role: null };
  return { ok: true, role };
}
async function executeRoleAction(interaction, action, value) {
  const roleId = String(resolved(value, interaction) || '').match(/\d{15,25}/)?.[0] || null;
  if (!roleId) return ephemeral(interaction, '❌ This button does not have a valid role configured.');
  const safe = await roleIsSafe(roleId, interaction.guild);
  if (!safe.ok) return ephemeral(interaction, `❌ ${safe.reason}`);
  const role = safe.role;
  const member = interaction.member?.roles?.cache ? interaction.member : await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) return ephemeral(interaction, '❌ Your server member record could not be loaded.');
  const result = await applyEmbedRoleMutation(member, role, action, interaction.user.tag || interaction.user.id);
  if (result.outcome === 'already-has-role') return ephemeral(interaction, `ℹ️ You already have **${role.name}**.`);
  if (result.outcome === 'missing-role') return ephemeral(interaction, `ℹ️ You do not have **${role.name}**.`);
  return ephemeral(interaction, `${result.outcome === 'removed' ? '✅ Removed' : '✅ Added'} **${role.name}**.`);
}
async function handleButtonAction(interaction) {
  if (!interaction?.isButton?.()) return false;
  const id = String(interaction.customId || '');
  if (!id.startsWith('embed:action:') && !id.startsWith('embed-action:')) return false;
  const { button } = resolveButton(interaction);
  const action = normalizeEmbedButtonAction(button?.action || legacyEmbedButtonActionFromId(id));
  const value = button?.actionValue ?? button?.value ?? '';
  if (!action || action === 'custom' || action === 'none') { await ephemeral(interaction, 'ℹ️ This button does not have an action configured yet.'); return true; }
  if (action === 'reply' || action === 'message') { await ephemeral(interaction, resolved(value || 'Button pressed.', interaction).slice(0, 2000) || 'Button pressed.'); return true; }
  if (EMBED_ROLE_BUTTON_ACTIONS.has(action)) { await executeRoleAction(interaction, action, value); return true; }
  if (action === 'user-info') { const member = interaction.member; const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('👤 Your Server Info').setDescription([`**User:** <@${interaction.user.id}>`, `**User ID:** \`${interaction.user.id}\``, `**Joined:** ${member?.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>` : 'Unknown'}`, `**Roles:** ${member?.roles?.cache ? Math.max(0, member.roles.cache.size - 1) : 'Unknown'}`].join('\n')); await ephemeral(interaction, { embeds: [embed] }); return true; }
  if (action === 'server-info') { const guild = interaction.guild; const embed = new EmbedBuilder().setColor(0x5865F2).setTitle(`🏠 ${guild?.name || 'Server'}`).setDescription([`**Members:** ${guild?.memberCount ?? 'Unknown'}`, `**Server ID:** \`${guild?.id || 'Unknown'}\``, `**Created:** ${guild?.createdTimestamp ? `<t:${Math.floor(guild.createdTimestamp / 1000)}:F>` : 'Unknown'}`].join('\n')); if (guild?.iconURL?.()) embed.setThumbnail(guild.iconURL({ size: 256 })); await ephemeral(interaction, { embeds: [embed] }); return true; }
  await ephemeral(interaction, `⚠️ The action \`${action}\` is not registered.`);
  return true;
}

const DELIVERY_ACTIONS = new Set(['embed:test-send', 'embed:use', 'embed:update-existing']);

function who(i) { return panel.memberName(i); }
function isTextBasedChannel(channel) {
  if (!channel) return false;
  if (typeof channel.isTextBased === 'function') return channel.isTextBased();
  if (typeof channel.isTextBased === 'boolean') return channel.isTextBased;
  return Boolean(channel.send && channel.messages);
}
function saveAppearance(i, state, patch) {
  const next = panel.saveSelected(state, patch);
  return panel.saveSession(i, { ...next, hasUnsavedChanges: true });
}
function saveThumbnailState(i, state, thumbnail) {
  const panelIndex = state.selectedPanelIndex || 0;
  let next = panel.setPanelMedia(state, panelIndex, {
    ...panel.getPanelMedia(state, panelIndex),
    thumbnail: panel.mediaModel.normalizeThumbnail(thumbnail),
  });
  const current = panel.getPanelMedia(next, panelIndex);
  next = panel.saveSelected(next, { thumbnail: current.thumbnail?.source || '' });
  return panel.saveSession(i, { ...next, hasUnsavedChanges: true });
}
function saveMediaState(i, state, mediaValue, extra = {}) {
  const index = state.selectedPanelIndex || 0;
  let next = panel.setPanelMedia(state, index, mediaValue);
  const current = panel.getPanelMedia(next, index);
  next = panel.saveSelected(next, {
    image: current.gallery?.[0]?.source || '',
    thumbnail: current.thumbnail?.source || ''
  });
  next = { ...next, ...extra, hasUnsavedChanges: true };
  return panel.saveSession(i, next);
}
async function updateContent(i) { await i.update(panel.buildContentManagerPanel(i)); return true; }
async function updateAppearance(i) { await i.update(panel.buildAppearancePanel(i)); return true; }
async function updateIcon(i, kind) { await i.update(panel.buildAppearanceIconPanel(i, kind)); return true; }
async function updateThumbnailPanel(i) { await i.update(panel.buildThumbnailOptionsPanel(i)); return true; }
async function updateMediaPanel(i) { await i.update(panel.buildMediaManagerPanel(i, who(i))); return true; }
async function updateFileOptions(i) { await i.update(panel.buildFileOptionsPanel(i)); return true; }
async function replyMediaPanel(i) { await i.reply({ ...panel.buildMediaManagerPanel(i, who(i)), flags: 64 }); return true; }
function validKind(kind) { return kind === 'author' || kind === 'footer'; }
function iconField(kind) { return kind === 'author' ? 'authorIcon' : 'footerIcon'; }
function uploadType(attachment) {
  const type = String(attachment?.contentType || '').toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  return 'file';
}
async function cacheUploadedAttachment(attachment) {
  if (!attachment?.url) return;
  try { await media.ensureAssetCached('global', attachment.url); }
  catch (error) { console.warn('[Embed Media] upload persistence failed:', attachment?.name || attachment?.url, error?.message || error); }
}
function validMediaAlignment(value) {
  const alignment = String(value || '').toLowerCase();
  return ['left', 'center', 'right'].includes(alignment) ? alignment : null;
}
function selectedMediaContext(state, panelMedia) {
  const gallery = Array.isArray(panelMedia?.gallery) ? panelMedia.gallery : [];
  if (!gallery.length) return null;
  const raw = state?.selectedMediaIndex;
  const index = raw == null || raw === '' || !Number.isInteger(Number(raw)) ? 0 : Number(raw);
  const selectedIndex = index >= 0 && index < gallery.length ? index : 0;
  return { index: selectedIndex, item: gallery[selectedIndex] };
}
function graphicHeaderIndex(panelMedia) {
  const gallery = Array.isArray(panelMedia?.gallery) ? panelMedia.gallery : [];
  const index = gallery.findIndex((item) => String(item?.placement || '').toLowerCase() === 'above');
  return index >= 0 ? index : null;
}
function graphicHeaderMode(state, panelMedia) {
  if (graphicHeaderIndex(panelMedia) == null) return 'text';
  const panelData = Array.isArray(state?.panels) ? state.panels[Math.max(0, Number(state?.selectedPanelIndex) || 0)] || {} : {};
  return String(panelData.title || '').trim() ? 'both' : 'graphic';
}
function normalizeGraphicHeaderPlacements(gallery, headerIndex = null) {
  return (Array.isArray(gallery) ? gallery : []).map((item, index) => ({ ...item, placement: headerIndex != null && index === headerIndex ? 'above' : 'below' }));
}

async function buildPayload(state, interaction, ephemeral = false) {
  return buildEmbedPayload({
    embeds: panel.buildPreviewEmbeds(state, interaction),
    actionRows: panel.buttonRows(state, interaction),
    allowUserPing: Boolean(state.allowUserPing),
    userId: interaction.user?.id || null,
    ephemeral,
    // media is the canonical placement-aware model. Prefer it so a stale
    // legacy media alias cannot demote a Graphic Header into a bottom image.
    media: state.media,
    mediaAlignment: state.mediaAlignment || {},
    interaction,
  });
}

function selectedFieldIndex(state) {
  const fields = Array.isArray(state.fields) ? state.fields : [];
  return Number.isInteger(state.selectedFieldIndex) && state.fields[state.selectedFieldIndex] ? state.selectedFieldIndex : null;
}
function saveFields(i, state, fields, selectedIndex = state.selectedFieldIndex, extra = {}) {
  let next = panel.saveSelected(state, { fields });
  next = { ...next, selectedFieldIndex: selectedIndex, fieldLayout: extra.fieldLayout || next.fieldLayout || 'auto', hasUnsavedChanges: true };
  return panel.saveSession(i, next);
}
async function updateFields(i) { await i.update(panel.buildFieldsManagerPanel(i)); return true; }
async function replyFields(i) { await i.reply({ ...panel.buildFieldsManagerPanel(i), flags: 64 }); return true; }

function selectedButtonIndex(state) {
  const buttons = Array.isArray(state.buttons) ? state.buttons : [];
  return Number.isInteger(state.selectedButtonIndex) && buttons[state.selectedButtonIndex] ? state.selectedButtonIndex : null;
}
function saveButtons(i, state, buttons, selectedIndex = state.selectedButtonIndex) {
  let next = panel.saveSelected(state, { buttons });
  next = { ...next, selectedButtonIndex: selectedIndex, hasUnsavedChanges: true };
  return panel.saveSession(i, next);
}
async function updateButtons(i) { await i.update(panel.buildButtonsManagerPanel(i)); return true; }
async function updateButtonOptions(i) { await i.update(panel.buildButtonOptionsPanel(i)); return true; }
async function replyButtons(i) { await i.reply({ ...panel.buildButtonsManagerPanel(i), flags: 64 }); return true; }
async function replyButtonOptions(i) { await i.reply({ ...panel.buildButtonOptionsPanel(i), flags: 64 }); return true; }
function validUrlOrVariable(value) {
  const raw = String(value || '').trim();
  if (!raw) return true;
  if (/\{[a-zA-Z0-9_]+\}/.test(raw)) return true;
  try { const url = new URL(raw); return ['http:', 'https:'].includes(url.protocol); } catch { return false; }
}
function roleAction(action) { return ['toggle-role', 'add-role', 'remove-role'].includes(String(action || '').toLowerCase()); }
function manualRow(value) {
  if (value === 'auto' || value == null || value === '') return null;
  const row = Number(value);
  return Number.isInteger(row) && row >= 0 && row < panel.MAX_DEPLOYED_BUTTON_ROWS ? row : null;
}
function safePresetExportFilename(name) {
  const safe = String(name || 'embed-preset')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  return `${safe || 'embed-preset'}.json`;
}

async function fetchPresetImportJson(attachment) {
  if (!attachment?.url) {
    throw new Error('The uploaded preset file could not be read.');
  }

  const filename = String(attachment.name || '').toLowerCase();
  const contentType = String(attachment.contentType || '').toLowerCase();

  if (
    filename &&
    !filename.endsWith('.json') &&
    contentType &&
    !contentType.includes('json')
  ) {
    throw new Error('Upload a JSON preset file.');
  }

  const response = await fetch(attachment.url);

  if (!response.ok) {
    throw new Error(`Could not download the uploaded preset file (${response.status}).`);
  }

  const text = await response.text();

  if (!text.trim()) {
    throw new Error('The uploaded preset file is empty.');
  }

  if (Buffer.byteLength(text, 'utf8') > 1024 * 1024) {
    throw new Error('Preset imports are limited to 1 MB.');
  }

  let parsed;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('The uploaded file is not valid JSON.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('The uploaded JSON does not contain a valid preset object.');
  }

  return parsed;
}

function normalizePortablePresetDocument(document) {
  const wrapped =
    document?.format === 'goliath-embed-preset' &&
    document?.preset &&
    typeof document.preset === 'object' &&
    !Array.isArray(document.preset);

  const preset = wrapped ? document.preset : document;

  const rawName =
    wrapped
      ? document.name || preset.name
      : preset.name;

  return {
    name: cleanPresetName(rawName),
    preset,
  };
}

function presetInteractionKey(interaction) {
  return `${interaction?.guildId || interaction?.guild?.id || 'global'}:${interaction?.user?.id || 'system'}`;
}
function cleanPresetName(value) {
  return String(value || '').trim().slice(0, 50);
}
function presetNameModal(customId, title, label, value = '') {
  return panel.modal(customId, title, [
    panel.input('name', label, TextInputStyle.Short, cleanPresetName(value), true, 50),
  ]);
}
function setGuildPresetDefault(guildId, templateKey, presetName, guild) {
  try {
    guildManager.setEmbedDefault(guildId, templateKey, presetName, guild);
    return true;
  } catch (error) {
    console.warn('[Embed Presets] Failed to set default preset:', error?.message || error);
    return false;
  }
}
async function handlePresetInteraction(i) {
  const customId = String(i?.customId || '');

  if (!customId.startsWith('embed:preset-')) {
    return false;
  }

  const guildId =
    i?.guildId ||
    i?.guild?.id ||
    null;

  if (!guildId) {
    await i.reply({
      content: 'This preset action requires a server.',
      flags: 64,
    });
    return true;
  }

  let state = panel.getSession(i);

  const getPreset = (name) =>
    name
      ? guildManager.getEmbedPreset?.(guildId, name) || null
      : null;

  const getSelected = () => {
    const name =
      panel.getSession(i)?.selectedPreset ||
      null;

    return {
      name,
      preset: getPreset(name),
    };
  };

  /*
   * SELECT
   *
   * Selection is management-only.
   * It must never silently overwrite the editor.
   */
  if (
    i.isStringSelectMenu?.() &&
    customId === 'embed:preset-select'
  ) {
    const presetName =
      String(i.values?.[0] || '').trim();

    const preset = getPreset(presetName);

    if (!preset || presetName.startsWith('auto-')) {
      await i.reply({
        content: 'That preset is no longer available.',
        flags: 64,
      });
      return true;
    }

    panel.saveSession(i, {
      ...state,
      selectedPreset: presetName,
    });

    await i.update(
      panel.buildPresetsPanel(i)
    );

    return true;
  }

  /*
   * LOAD
   */
  if (
    i.isButton?.() &&
    customId === 'embed:preset-load'
  ) {
    const { name, preset } = getSelected();


    if (!name || !preset) {
      await i.reply({
        content: 'Select a valid preset first.',
        flags: 64,
      });
      return true;
    }

    /*
     * applyPreset() establishes the selected saved preset as the
     * editor's clean baseline. Media/alignment compatibility wrappers
     * may normalize and re-save that state, but loading itself must
     * never make the editor dirty.
     */
    panel.applyPreset(i, name, preset);

    await i.update(
      panel.buildEditorPanel(
        i,
        panel.memberName(i)
      )
    );

    return true;
  }

  /*
   * SAVE CURRENT
   */
  if (
    i.isButton?.() &&
    customId === 'embed:preset-save'
  ) {
    state = panel.getSession(i);

    await i.showModal(
      panel.presetModal(state)
    );

    return true;
  }

  /*
   * NEW EMBED
   *
   * Clear working state and selected preset.
   */
  if (
    i.isButton?.() &&
    customId === 'embed:preset-new'
  ) {
    panel.resetSession(i);

    const fresh =
      panel.getSession(i);

    panel.saveSession(i, {
      ...fresh,
      selectedPreset: null,
    });

    await i.update(
      panel.buildEditorPanel(
        i,
        panel.memberName(i)
      )
    );

    return true;
  }

  /*
   * RENAME
   */
  if (
    i.isButton?.() &&
    customId === 'embed:preset-rename'
  ) {
    const { name, preset } = getSelected();

    if (!name || !preset) {
      await i.reply({
        content: 'Select a valid preset first.',
        flags: 64,
      });
      return true;
    }

    await i.showModal(
      presetNameModal(
        'embed:preset-rename-modal',
        'Rename Embed Preset',
        'New preset name',
        name
      )
    );

    return true;
  }

  /*
   * DUPLICATE
   */
  if (
    i.isButton?.() &&
    customId === 'embed:preset-duplicate'
  ) {
    const { name, preset } = getSelected();

    if (!name || !preset) {
      await i.reply({
        content: 'Select a valid preset first.',
        flags: 64,
      });
      return true;
    }

    await i.showModal(
      presetNameModal(
        'embed:preset-duplicate-modal',
        'Duplicate Embed Preset',
        'Copy name',
        `${name} Copy`
      )
    );

    return true;
  }

  /*
   * DELETE
   */
  if (
    i.isButton?.() &&
    customId === 'embed:preset-delete'
  ) {
    const { name, preset } = getSelected();

    if (!name || !preset) {
      await i.reply({
        content: 'Select a valid preset first.',
        flags: 64,
      });
      return true;
    }

    if (name.startsWith('auto-')) {
      await i.reply({
        content: 'Internal deployment presets cannot be deleted here.',
        flags: 64,
      });
      return true;
    }

    const defaults =
      guildManager.getEmbedDefaults?.(guildId) ||
      {};

    const presetTemplate =
      preset.template ||
      state.template ||
      'custom';

    /*
     * Clear its default assignment first if necessary.
     */
    if (defaults[presetTemplate] === name) {
      guildManager.clearEmbedDefault?.(
        guildId,
        presetTemplate,
        i.guild
      );
    }


    const deleted =
      guildManager.deleteEmbedPreset?.(
        guildId,
        name,
        i.guild
      );


    if (!deleted) {
      await i.reply({
        content: `Could not delete preset "${name}".`,
        flags: 64,
      });
      return true;
    }

    state = panel.getSession(i);

    panel.saveSession(i, {
      ...state,
      selectedPreset: null,
    });

    console.log(
      `[Embed Presets] Deleted "${name}" from guild ${guildId}`
    );

    await i.update(
      panel.buildPresetsPanel(i)
    );

    return true;
  }

  /*
   * SET DEFAULT
   */
  if (
    i.isButton?.() &&
    customId === 'embed:preset-default'
  ) {
    const { name, preset } = getSelected();

    if (!name || !preset) {
      await i.reply({
        content: 'Select a valid preset first.',
        flags: 64,
      });
      return true;
    }

    const template =
      preset.template ||
      state.template ||
      'custom';


    const saved =
      guildManager.setEmbedDefault?.(
        guildId,
        template,
        name,
        i.guild
      );


    if (!saved) {
      await i.reply({
        content: 'Could not set that preset as the default.',
        flags: 64,
      });
      return true;
    }

    await i.update(
      panel.buildPresetsPanel(i)
    );

    return true;
  }

  /*
   * CLEAR DEFAULT
   */
  if (
    i.isButton?.() &&
    customId === 'embed:preset-clear-default'
  ) {
    const { name, preset } = getSelected();

    if (!name || !preset) {
      await i.reply({
        content: 'Select a valid preset first.',
        flags: 64,
      });
      return true;
    }

    const template =
      preset.template ||
      state.template ||
      'custom';

    guildManager.clearEmbedDefault?.(
      guildId,
      template,
      i.guild
    );

    await i.update(
      panel.buildPresetsPanel(i)
    );

    return true;
  }

  /*
   * SAVE MODAL
   */
  if (
    i.isModalSubmit?.() &&
    customId === 'embed:preset-save-modal'
  ) {
    const name =
      cleanPresetName(
        i.fields.getTextInputValue('name')
      );

    if (!name) {
      await i.reply({
        content: 'Enter a preset name.',
        flags: 64,
      });
      return true;
    }

    if (name.startsWith('auto-')) {
      await i.reply({        content: 'Preset names beginning with "auto-" are reserved by Goliath.',
        flags: 64,
      });
      return true;
    }

    state = panel.getSession(i);

    const preset =
      panel.presetData(state);

    // Finish media persistence before the preset is committed. Discord upload
    // URLs can expire; the cached asset is the durable source used after reload.
    try {
      await media.persistPresetMedia(guildId, preset);
    } catch (error) {
      console.warn('[Embed Presets] Media persistence failed before save:', error?.message || error);
    }

    const saved =
      guildManager.saveEmbedPreset?.(
        guildId,
        name,
        preset,
        i.guild
      );

    if (!saved) {
      await i.reply({
        content: `Could not save preset "${name}".`,
        flags: 64,
      });
      return true;
    }

    panel.saveSession(i, {
      ...state,
      selectedPreset: name,
      hasUnsavedChanges: false,
    });

    await i.update(
      panel.buildPresetsPanel(i)
    );

    return true;
  }

  /*
   * RENAME MODAL
   */
  if (
    i.isModalSubmit?.() &&
    customId === 'embed:preset-rename-modal'
  ) {
    state = panel.getSession(i);

    const current =
      state?.selectedPreset ||
      null;

    const nextName =
      cleanPresetName(
        i.fields.getTextInputValue('name')
      );

    if (!current || !nextName) {
      await i.reply({
        content: 'Select a preset and enter a valid new name.',
        flags: 64,
      });
      return true;
    }

    if (nextName.startsWith('auto-')) {
      await i.reply({
        content: 'Preset names beginning with "auto-" are reserved by Goliath.',
        flags: 64,
      });
      return true;
    }

    if (current === nextName) {
      await i.update(
        panel.buildPresetsPanel(i)
      );
      return true;
    }

    const preset =
      getPreset(current);

    if (!preset) {
      await i.reply({
        content: 'The selected preset no longer exists.',
        flags: 64,
      });
      return true;
    }

    const collision =
      getPreset(nextName);

    if (collision) {
      await i.reply({
        content: `A preset named "${nextName}" already exists.`,
        flags: 64,
      });
      return true;
    }

    const defaults =
      guildManager.getEmbedDefaults?.(guildId) ||
      {};

    const template =
      preset.template ||
      state.template ||
      'custom';

    const wasDefault =
      defaults[template] === current;

    const saved =
      guildManager.saveEmbedPreset?.(
        guildId,
        nextName,
        preset,
        i.guild
      );

    if (!saved) {
      await i.reply({
        content: 'Could not save the renamed preset.',
        flags: 64,
      });
      return true;
    }

    /*
     * If this preset is the template default, move the default
     * BEFORE removing the old preset.
     *
     * This prevents the guild from ever being left with a default
     * pointing at a preset that no longer exists.
     */
    if (wasDefault) {
      try {
        guildManager.setEmbedDefault(
          guildId,
          template,
          nextName,
          i.guild
        );
      } catch (error) {
        /*
         * Roll back the newly-created preset.
         * The original preset and original default remain untouched.
         */
        guildManager.deleteEmbedPreset?.(
          guildId,
          nextName,
          i.guild
        );

        console.warn(
          '[Embed Presets] Rename default migration failed:',
          error?.message || error
        );

        await i.reply({
          content: 'Rename failed while moving the default assignment. No changes were kept.',
          flags: 64,
        });

        return true;
      }
    }

    const deleted =
      guildManager.deleteEmbedPreset?.(
        guildId,
        current,
        i.guild
      );

    if (!deleted) {
      /*
       * Roll back the new preset.
       */
      guildManager.deleteEmbedPreset?.(
        guildId,
        nextName,
        i.guild
      );

      /*
       * If the default was moved, restore it to the original preset.
       */
      if (wasDefault) {
        try {
          guildManager.setEmbedDefault(
            guildId,
            template,
            current,
            i.guild
          );
        } catch (error) {
          console.error(
            '[Embed Presets] Rename rollback could not restore default:',
            error?.message || error
          );
        }
      }

      await i.reply({
        content: 'Rename failed while removing the old preset. The rename was rolled back.',
        flags: 64,
      });

      return true;
    }

    panel.saveSession(i, {
      ...state,
      selectedPreset: nextName,
    });

    await i.update(
      panel.buildPresetsPanel(i)
    );

    return true;
  }

  /*
   * DUPLICATE MODAL
   */
  if (
    i.isModalSubmit?.() &&
    customId === 'embed:preset-duplicate-modal'
  ) {
    state = panel.getSession(i);

    const current =
      state?.selectedPreset ||
      null;

    const copyName =
      cleanPresetName(
        i.fields.getTextInputValue('name')
      );

    if (!current || !copyName) {
      await i.reply({
        content: 'Select a preset and enter a valid copy name.',
        flags: 64,
      });
      return true;
    }

    if (copyName.startsWith('auto-')) {
      await i.reply({
        content: 'Preset names beginning with "auto-" are reserved by Goliath.',
        flags: 64,
      });
      return true;
    }

    if (getPreset(copyName)) {
      await i.reply({
        content: `A preset named "${copyName}" already exists.`,
        flags: 64,
      });
      return true;
    }

    const preset =
      getPreset(current);

    if (!preset) {
      await i.reply({
        content: 'The selected preset no longer exists.',
        flags: 64,
      });
      return true;
    }

    const saved =
      guildManager.saveEmbedPreset?.(
        guildId,
        copyName,
        preset,
        i.guild
      );

    if (!saved) {
      await i.reply({
        content: 'Could not duplicate that preset.',
        flags: 64,
      });
      return true;
    }

    panel.saveSession(i, {
      ...state,
      selectedPreset: copyName,
    });

    await i.update(
      panel.buildPresetsPanel(i)
    );

    return true;
  }

  /*
   * Any embed:preset-* interaction reaching here is an error.
   * Do NOT fall through into the legacy preset implementation.
   */
  console.warn(
    `[Embed Presets] Unhandled preset interaction: ${customId}`
  );

  if (!i.replied && !i.deferred) {
    await i.reply({
      content: 'That preset action is not currently available.',
      flags: 64,
    });
  }

  return true;
}
async function handleBuilderInteractions(i) {
  const customId = String(i.customId || '');
  const state = panel.getSession(i);

  // Compatibility bridge for Embed Studio panels created before the canonical
  // Media Options editor replaced the retired Header Type cycle. Discord can
  // keep those component IDs alive in an already-posted interaction panel.
  // Never recreate the retired UI: acknowledge the stale control by routing
  // the user directly into the current Media Manager.
  if (i.isButton?.() && customId === 'embed:header-type-cycle') {
    await i.update(panel.buildMediaManagerPanel(i, who(i)));
    return true;
  }
  const fields = Array.isArray(state.fields) ? [...state.fields] : [];
  const fieldIndex = selectedFieldIndex(state);
  const buttons = Array.isArray(state.buttons) ? [...state.buttons] : [];
  const buttonIndex = selectedButtonIndex(state);

  if (i.isButton?.()) {

    if (customId === 'embed:appearance-back') return updateAppearance(i);
    if (customId === 'embed:appearance-details') { await i.showModal(panel.appearanceDetailsModal(state)); return true; }
    if (customId === 'embed:appearance-author-icon') return updateIcon(i, 'author');
    if (customId === 'embed:appearance-footer-icon') return updateIcon(i, 'footer');
    if (customId.startsWith('embed:appearance-icon-url:')) { const kind = customId.split(':').pop(); if (!validKind(kind)) return true; await i.showModal(panel.appearanceIconUrlModal(kind, state)); return true; }
    if (customId.startsWith('embed:appearance-icon-upload:')) { const kind = customId.split(':').pop(); if (!validKind(kind)) return true; await i.showModal(panel.appearanceIconUploadModal(kind)); return true; }
    if (customId.startsWith('embed:appearance-icon-clear:')) { const kind = customId.split(':').pop(); if (!validKind(kind)) return true; saveAppearance(i, state, { [iconField(kind)]: '' }); return updateIcon(i, kind); }
    if (customId === 'embed:media-thumbnail') return updateThumbnailPanel(i);
    if (customId === 'embed:thumbnail-back') { await i.update(panel.buildMediaManagerPanel(i, who(i))); return true; }
    if (customId === 'embed:thumbnail-edit') { await i.showModal(panel.thumbnailModal(state)); return true; }
    if (customId === 'embed:thumbnail-upload') { await i.showModal(panel.thumbnailUploadModal()); return true; }
    if (customId === 'embed:thumbnail-clear') { saveThumbnailState(i, state, { source: '', alt: '' }); return updateThumbnailPanel(i); }

    if (customId === 'embed:fields') return updateFields(i);
    if (customId === 'embed:field-manager-add') { if (fields.length >= panel.MAX_EMBED_FIELDS) { await i.reply({ content: `Maximum of ${panel.MAX_EMBED_FIELDS} fields reached.`, flags: 64 }); return true; } await i.showModal(panel.fieldEditorModal(state)); return true; }
    if (customId === 'embed:field-manager-edit') { if (fieldIndex == null) { await i.reply({ content: 'Select a field first.', flags: 64 }); return true; } await i.showModal(panel.fieldEditorModal(state, fieldIndex)); return true; }
    if (customId === 'embed:field-manager-inline') { if (fieldIndex == null) return updateFields(i); fields[fieldIndex] = { ...fields[fieldIndex], inline: !Boolean(fields[fieldIndex].inline) }; saveFields(i, state, fields, fieldIndex); return updateFields(i); }
    if (customId === 'embed:field-manager-remove') { if (fieldIndex == null) return updateFields(i); fields.splice(fieldIndex, 1); saveFields(i, state, fields, fields.length ? Math.min(fieldIndex, fields.length - 1) : null); return updateFields(i); }
    if (customId === 'embed:field-manager-up' || customId === 'embed:field-manager-down') { if (fieldIndex == null) return updateFields(i); const target = fieldIndex + (customId.endsWith('up') ? -1 : 1); if (target < 0 || target >= fields.length) return updateFields(i); [fields[fieldIndex], fields[target]] = [fields[target], fields[fieldIndex]]; saveFields(i, state, fields, target); return updateFields(i); }

    if (customId === 'embed:buttons') return updateButtons(i);
    if (customId === 'embed:button-manager-add') { if (buttons.length >= panel.MAX_EMBED_BUTTONS) { await i.reply({ content: `Maximum of ${panel.MAX_EMBED_BUTTONS} buttons reached.`, flags: 64 }); return true; } await i.showModal(panel.buttonEditorModal(state)); return true; }
    if (customId === 'embed:button-manager-edit') { if (buttonIndex == null) { await i.reply({ content: 'Select a button first.', flags: 64 }); return true; } await i.showModal(panel.buttonEditorModal(state, buttonIndex)); return true; }
    if (customId === 'embed:button-manager-options') { if (buttonIndex == null) { await i.reply({ content: 'Select a button first.', flags: 64 }); return true; } return updateButtonOptions(i); }
    if (customId === 'embed:button-options-back') return updateButtons(i);
    if (customId === 'embed:button-reply-edit') { if (buttonIndex == null || String(buttons[buttonIndex]?.action || '').toLowerCase() !== 'reply') return updateButtonOptions(i); await i.showModal(panel.buttonReplyModal(state)); return true; }
    if (customId.startsWith('embed:button-style:')) { if (buttonIndex == null) return updateButtons(i); const style = customId.split(':').pop(); if (!['primary', 'secondary', 'success', 'danger'].includes(style)) return true; buttons[buttonIndex] = { ...buttons[buttonIndex], style }; saveButtons(i, state, buttons, buttonIndex); return updateButtonOptions(i); }
    if (customId === 'embed:button-manager-remove') { if (buttonIndex == null) return updateButtons(i); buttons.splice(buttonIndex, 1); saveButtons(i, state, buttons, buttons.length ? Math.min(buttonIndex, buttons.length - 1) : null); return updateButtons(i); }
    if (customId === 'embed:button-manager-up' || customId === 'embed:button-manager-down') { if (buttonIndex == null) return updateButtons(i); const target = buttonIndex + (customId.endsWith('up') ? -1 : 1); if (target < 0 || target >= buttons.length) return updateButtons(i); [buttons[buttonIndex], buttons[target]] = [buttons[target], buttons[buttonIndex]]; saveButtons(i, state, buttons, target); return updateButtons(i); }
  }

  if (i.isStringSelectMenu?.()) {
    if (customId === 'embed:field-manager-select') { panel.saveSession(i, { ...state, selectedFieldIndex: Math.max(0, Number(i.values?.[0]) || 0) }); return updateFields(i); }
    if (customId === 'embed:field-manager-layout') { const layout = String(i.values?.[0] || 'auto'); if (!['auto', '1', '2', '3'].includes(layout)) return true; panel.saveSession(i, { ...state, fieldLayout: layout, hasUnsavedChanges: true }); return updateFields(i); }
    if (customId === 'embed:button-manager-select') { panel.saveSession(i, { ...state, selectedButtonIndex: Math.max(0, Number(i.values?.[0]) || 0) }); return updateButtons(i); }
    if (customId === 'embed:button-action-select') { if (buttonIndex == null) return updateButtons(i); const action = String(i.values?.[0] || 'none').toLowerCase(); if (action !== 'none' && !EMBED_BUTTON_ACTIONS.includes(action)) return true; const existing = buttons[buttonIndex] || {}; buttons[buttonIndex] = action === 'none' ? { ...existing, action: '', actionValue: '' } : { ...existing, url: '', action, actionValue: '' }; saveButtons(i, state, buttons, buttonIndex); return updateButtonOptions(i); }
    if (customId === 'embed:button-row-select') { if (buttonIndex == null) return updateButtons(i); const raw = String(i.values?.[0] || 'auto'); const row = manualRow(raw); if (raw !== 'auto' && row == null) return true; if (row != null) { const assigned = buttons.filter((button, idx) => idx !== buttonIndex && manualRow(button?.row) === row).length; if (assigned >= panel.MAX_BUTTONS_PER_ROW) { await i.reply({ content: `⚠️ Row ${row + 1} already has ${panel.MAX_BUTTONS_PER_ROW} explicitly placed buttons. Choose another row or Auto placement.`, flags: 64 }); return true; } } buttons[buttonIndex] = { ...buttons[buttonIndex], row: row == null ? null : row }; saveButtons(i, state, buttons, buttonIndex); return updateButtonOptions(i); }
  }

  if (i.isRoleSelectMenu?.() && customId === 'embed:button-action-role') { if (buttonIndex == null || !roleAction(buttons[buttonIndex]?.action)) return updateButtonOptions(i); const roleId = String(i.values?.[0] || ''); const role = i.guild?.roles?.cache?.get?.(roleId) || (await i.guild?.roles?.fetch?.(roleId).catch(() => null)); if (!role || role.id === i.guildId || role.managed) { await i.reply({ content: '⚠️ Select a normal server role. Managed/integration roles and @everyone cannot be used.', flags: 64 }); return true; } buttons[buttonIndex] = { ...buttons[buttonIndex], actionValue: role.id }; saveButtons(i, state, buttons, buttonIndex); return updateButtonOptions(i); }

  if (i.isModalSubmit?.() && customId.startsWith('embed:appearance-details-save:')) { saveAppearance(i, state, { authorName: i.fields.getTextInputValue('authorName'), authorUrl: i.fields.getTextInputValue('authorUrl'), footer: i.fields.getTextInputValue('footer') }); await i.reply({ ...panel.buildContentManagerPanel(i), flags: 64 }); return true; }
  if (i.isModalSubmit?.() && customId.startsWith('embed:appearance-icon-url-save:')) { const kind = customId.split(':')[3]; if (!validKind(kind)) return true; saveAppearance(i, state, { [iconField(kind)]: i.fields.getTextInputValue('source') }); await i.reply({ ...panel.buildAppearanceIconPanel(i, kind), flags: 64 }); return true; }
  if (i.isModalSubmit?.() && customId.startsWith('embed:appearance-icon-upload-save:')) { const kind = customId.split(':').pop(); if (!validKind(kind)) return true; const uploaded = i.fields.getUploadedFiles('icon_file', true); const attachment = [...(uploaded?.values?.() || [])][0]; if (!attachment) { await i.reply({ content: 'No icon was uploaded.', flags: 64 }); return true; } const contentType = String(attachment.contentType || '').toLowerCase(); if (contentType && !contentType.startsWith('image/')) { await i.reply({ content: '⚠️ Author and footer icons must be image files.', flags: 64 }); return true; } try { await media.ensureAssetCached('global', attachment.url); } catch (error) { console.warn('[Embed Media] appearance icon persistence failed:', attachment?.name || attachment?.url, error?.message || error); } saveAppearance(i, state, { [iconField(kind)]: attachment.url }); await i.reply({ content: `✅ ${kind === 'author' ? 'Author' : 'Footer'} icon uploaded.`, ...panel.buildAppearanceIconPanel(i, kind), flags: 64 }); return true; }
  if (i.isModalSubmit?.() && customId === 'embed:thumbnail-upload-save') { const uploaded = i.fields.getUploadedFiles('thumbnail_file', true); const attachment = [...(uploaded?.values?.() || [])][0]; if (!attachment) { await i.reply({ content: 'No thumbnail was uploaded.', flags: 64 }); return true; } const contentType = String(attachment.contentType || '').toLowerCase(); if (contentType && !contentType.startsWith('image/')) { await i.reply({ content: '⚠️ Thumbnails must be image files.', flags: 64 }); return true; } try { await media.ensureAssetCached('global', attachment.url); } catch (error) { console.warn('[Embed Media] thumbnail persistence failed:', attachment?.name || attachment?.url, error?.message || error); } saveThumbnailState(i, state, { source: attachment.url, alt: attachment.description || attachment.name || '' }); await i.reply({ content: '✅ Thumbnail uploaded.', ...panel.buildThumbnailOptionsPanel(i), flags: 64 }); return true; }

  if (i.isModalSubmit?.() && (customId === 'embed:field-manager-save-new' || customId.startsWith('embed:field-manager-save:'))) { const name = String(i.fields.getTextInputValue('name') || '').trim(); const value = String(i.fields.getTextInputValue('value') || '').trim(); if (!name || !value) { await i.reply({ content: 'Field name and content are required.', flags: 64 }); return true; } const editingIndex = customId === 'embed:field-manager-save-new' ? null : Number(customId.split(':').pop()); let nextFieldIndex; if (editingIndex == null) { if (fields.length >= panel.MAX_EMBED_FIELDS) { await i.reply({ content: `Maximum of ${panel.MAX_EMBED_FIELDS} fields reached.`, flags: 64 }); return true; } fields.push({ name: name.slice(0, 256), value: value.slice(0, 1024), inline: false }); nextFieldIndex = fields.length - 1; } else { const existing = fields[editingIndex] || { inline: false }; fields[editingIndex] = { ...existing, name: name.slice(0, 256), value: value.slice(0, 1024), inline: Boolean(existing.inline) }; nextFieldIndex = editingIndex; } saveFields(i, state, fields, nextFieldIndex); return replyFields(i); }
  if (i.isModalSubmit?.() && (customId === 'embed:button-manager-save-new' || customId.startsWith('embed:button-manager-save:'))) { const label = String(i.fields.getTextInputValue('label') || '').trim().slice(0, 80); const emoji = String(i.fields.getTextInputValue('emoji') || '').trim().slice(0, 100); const url = String(i.fields.getTextInputValue('url') || '').trim(); if (!label) { await i.reply({ content: 'A button label is required.', flags: 64 }); return true; } if (!validUrlOrVariable(url)) { await i.reply({ content: 'Button links must be HTTP/HTTPS URLs or a URL-producing Embed Studio variable.', flags: 64 }); return true; } const editingIndex = customId === 'embed:button-manager-save-new' ? null : Number(customId.split(':').pop()); const existing = Number.isInteger(editingIndex) ? (buttons[editingIndex] || {}) : {}; const entry = { ...existing, label, emoji, url, ...(url ? { action: '', actionValue: '' } : {}), style: ['primary', 'secondary', 'success', 'danger'].includes(String(existing.style || '').toLowerCase()) ? String(existing.style).toLowerCase() : 'primary' }; let nextButtonIndex; if (editingIndex == null) { if (buttons.length >= panel.MAX_EMBED_BUTTONS) { await i.reply({ content: `Maximum of ${panel.MAX_EMBED_BUTTONS} buttons reached.`, flags: 64 }); return true; } buttons.push({ ...entry, action: '', actionValue: '', row: null }); nextButtonIndex = buttons.length - 1; } else { buttons[editingIndex] = entry; nextButtonIndex = editingIndex; } saveButtons(i, state, buttons, nextButtonIndex); return replyButtons(i); }
  if (i.isModalSubmit?.() && customId === 'embed:button-reply-save') { if (buttonIndex == null || String(buttons[buttonIndex]?.action || '').toLowerCase() !== 'reply') { await i.reply({ content: 'Select a Reply action button first.', flags: 64 }); return true; } const replyText = String(i.fields.getTextInputValue('replyText') || '').trim().slice(0, 1000); if (!replyText) { await i.reply({ content: 'Reply text is required.', flags: 64 }); return true; } buttons[buttonIndex] = { ...buttons[buttonIndex], actionValue: replyText }; saveButtons(i, state, buttons, buttonIndex); return replyButtonOptions(i); }

  return handleCoreInteraction(i);
}

async function handleCoreInteraction(i) {
  const customId = String(i.customId || '');
  const state = panel.getSession(i);

  if (customId === 'embed:settings' && i.isButton?.()) {
    await i.update(panel.buildSettingsPanel(i));
    return true;
  }

  if (customId === 'embed:settings-import' && i.isButton?.()) {
    await i.showModal(panel.settingsImportModal());
    return true;
  }

  if (customId === 'embed:settings-export' && i.isButton?.()) {
    const guildId = i.guildId || i.guild?.id || null;

    if (!guildId) {
      await i.reply({
        content: 'Preset export requires a server.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const current = panel.getSession(i);
    const name = cleanPresetName(current?.selectedPreset);
    const preset = name
      ? guildManager.getEmbedPreset?.(guildId, name)
      : null;

    if (!name || !preset || name.startsWith('auto-')) {
      await i.reply({
        content: 'Select a saved preset in Preset Manager before exporting it.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const portable = {
      format: 'goliath-embed-preset',
      version: 1,
      name,
      exportedAt: new Date().toISOString(),
      preset,
    };

    const attachment = new AttachmentBuilder(
      Buffer.from(JSON.stringify(portable, null, 2), 'utf8'),
      { name: safePresetExportFilename(name) }
    );

    await i.reply({
      content: `📤 Exported preset **${name}**.`,
      files: [attachment],
      flags: MessageFlags.Ephemeral,
    });

    return true;
  }

  if (
    i.isModalSubmit?.() &&
    customId === 'embed:settings-import-save'
  ) {
    const guildId = i.guildId || i.guild?.id || null;

    if (!guildId) {
      await i.reply({
        content: 'Preset import requires a server.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const uploaded = i.fields.getUploadedFiles('preset_file', true);
    const attachment = [...(uploaded?.values?.() || [])][0];

    if (!attachment) {
      await i.reply({
        content: 'Upload a preset JSON file.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    try {
      const document = await fetchPresetImportJson(attachment);
      const imported = normalizePortablePresetDocument(document);
      const name = imported.name;

      if (!name) {
        await i.reply({
          content: 'The imported preset does not contain a valid preset name.',
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }

      if (name.startsWith('auto-')) {
        await i.reply({
          content: 'Preset names beginning with "auto-" are reserved by Goliath.',
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }

      if (guildManager.getEmbedPreset?.(guildId, name)) {
        await i.reply({
          content: `A preset named "${name}" already exists. Rename or delete the existing preset before importing this file.`,
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }

      const saved = guildManager.saveEmbedPreset?.(
        guildId,
        name,
        imported.preset,
        i.guild
      );

      if (!saved) {
        await i.reply({
          content: `Could not import preset "${name}".`,
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }

      const current = panel.getSession(i);

      panel.saveSession(i, {
        ...current,
        selectedPreset: name,
      });

      await i.reply({
        content: `✅ Imported preset **${name}** successfully.`,
        ...panel.buildSettingsPanel(i),
        flags: MessageFlags.Ephemeral,
      });

      return true;
    } catch (error) {
      console.warn(
        '[Embed Presets] Import failed:',
        error?.message || error
      );

      await i.reply({
        content: `❌ Preset import failed: ${error?.message || 'Unknown error.'}`,
        flags: MessageFlags.Ephemeral,
      });

      return true;
    }
  }

  if (customId === 'embed:edit-images' && i.isButton?.()) return updateMediaPanel(i);
  if (i.isStringSelectMenu?.() && customId === 'embed:media-gallery-select') { panel.saveSession(i, { ...state, selectedMediaIndex: Number(i.values[0]) }); return updateMediaPanel(i); }
  if (i.isStringSelectMenu?.() && customId === 'embed:media-file-select') { panel.saveSession(i, { ...state, selectedFileIndex: Number(i.values[0]) }); return updateMediaPanel(i); }

  if (i.isButton?.()) {
    const panelMedia = panel.getPanelMedia(state);
    const requestedGalleryIndex = Number.isInteger(state.selectedMediaIndex) ? state.selectedMediaIndex : null;
    const galleryIndex = panelMedia.gallery.length ? Math.max(0, Math.min(requestedGalleryIndex ?? 0, panelMedia.gallery.length - 1)) : null;
    const requestedFileIndex = Number.isInteger(state.selectedFileIndex) ? state.selectedFileIndex : null;
    const fileIndex = panelMedia.files.length ? Math.max(0, Math.min(requestedFileIndex ?? 0, panelMedia.files.length - 1)) : null;
    if (customId === 'embed:media-add') {
      if (
        panelMedia.gallery.length >= panel.mediaModel.MAX_GALLERY_ITEMS &&
        panelMedia.files.length >= panel.mediaModel.MAX_FILES
      ) {
        await i.reply({
          content: 'Both the gallery media and attached file limits have been reached.',
          flags: 64,
        });
        return true;
      }

      await i.showModal(panel.mediaAddModal());
      return true;
    }
    if (customId === 'embed:media-gallery-edit') {
      if (galleryIndex == null || !panelMedia.gallery[galleryIndex]) {
        await i.reply({ content: 'Select a media item first.', flags: 64 });
        return true;
      }
      await i.showModal(panel.galleryItemModal(state, galleryIndex));
      return true;
    }
    if (customId === 'embed:media-type:cycle') {
      if (galleryIndex == null || !panelMedia.gallery[galleryIndex]) return updateMediaPanel(i);

      const cycle = ['auto', 'text', 'gif', 'image'];
      const current = String(
        panelMedia.gallery[galleryIndex].headerType || 'auto'
      ).toLowerCase();

      const currentIndex = cycle.indexOf(current);
      const headerType = cycle[
        currentIndex < 0
          ? 0
          : (currentIndex + 1) % cycle.length
      ];

      const gallery = panelMedia.gallery.map((item, index) =>
        index === galleryIndex
          ? panel.mediaModel.normalizeGalleryItem({
              ...item,
              headerType,
            })
          : panel.mediaModel.normalizeGalleryItem(item)
      );

      const savedState = saveMediaState(
        i,
        state,
        { ...panelMedia, gallery },
        { selectedMediaIndex: galleryIndex }
      );

      await i.update(
        panel.buildMediaManagerPanel(
          i,
          who(i),
          savedState
        )
      );

      return true;
    }
    if (customId.startsWith('embed:media-spoiler:')) { if (galleryIndex == null || !panelMedia.gallery[galleryIndex]) return updateMediaPanel(i); const gallery = [...panelMedia.gallery]; gallery[galleryIndex] = panel.mediaModel.normalizeGalleryItem({ ...gallery[galleryIndex], spoiler: customId.endsWith(':on') }); saveMediaState(i, state, { ...panelMedia, gallery }, { selectedMediaIndex: galleryIndex }); return updateMediaPanel(i); }
    if (customId.startsWith('embed:media-placement:')) {
      if (galleryIndex == null || !panelMedia.gallery[galleryIndex]) return updateMediaPanel(i);
      const placement = customId.split(':').pop();
      if (!['above', 'below'].includes(placement)) return true;
      const panelIndex = Math.max(0, Number(state.selectedPanelIndex) || 0);
      const panelData = Array.isArray(state.panels) ? state.panels[panelIndex] || {} : {};
      const gallery = panelMedia.gallery.map((item, index) => index === galleryIndex
        ? panel.mediaModel.normalizeGalleryItem({ ...item, placement })
        : { ...item });
      let next = panel.setPanelMedia(state, panelIndex, { ...panelMedia, gallery });
      const panels = Array.isArray(next?.panels) ? next.panels.map((entry) => ({ ...entry })) : [];
      if (panels[panelIndex]) {
        const nextPanel = panels[panelIndex];
        nextPanel.image = gallery[0]?.source || '';
        if (placement === 'below' && !gallery.some((item) => item?.placement === 'above')) {
          if (!String(nextPanel.title || '').trim() && String(nextPanel.graphicHeaderTitle || '').trim()) nextPanel.title = String(nextPanel.graphicHeaderTitle);
          nextPanel.graphicHeaderTitle = '';
        }
      }
      panel.saveSession(i, { ...next, panels, selectedPanelIndex: panelIndex, selectedMediaIndex: galleryIndex, hasUnsavedChanges: true });
      const committed = panel.getSession(i);
      const committedMedia = panel.getPanelMedia(committed, panelIndex);
      const committedItem = committedMedia?.gallery?.[galleryIndex];
      if (committedItem && committedItem.placement !== placement) {
        const repairedGallery = committedMedia.gallery.map((item, index) => index === galleryIndex
          ? panel.mediaModel.normalizeGalleryItem({ ...item, placement })
          : { ...item });
        panel.saveSession(i, { ...panel.setPanelMedia(committed, panelIndex, { ...committedMedia, gallery: repairedGallery }), selectedPanelIndex: panelIndex, selectedMediaIndex: galleryIndex, hasUnsavedChanges: true });
      }
      await i.update(panel.buildMediaManagerPanel(i, panel.memberName(i), panel.getSession(i)));
      return true;
    }
    if (customId === 'embed:media-duplicate') { if (galleryIndex == null || !panelMedia.gallery[galleryIndex]) return updateMediaPanel(i); if (panelMedia.gallery.length >= panel.mediaModel.MAX_GALLERY_ITEMS) { await i.reply({ content: `Maximum of ${panel.mediaModel.MAX_GALLERY_ITEMS} gallery items reached.`, flags: 64 }); return true; } const gallery = [...panelMedia.gallery]; const duplicate = panel.mediaModel.normalizeGalleryItem({ ...gallery[galleryIndex] }); gallery.splice(galleryIndex + 1, 0, duplicate); saveMediaState(i, state, { ...panelMedia, gallery }, { selectedMediaIndex: galleryIndex + 1 }); return updateMediaPanel(i); }
    if (customId === 'embed:file-options') { if (fileIndex == null || !panelMedia.files[fileIndex]) { await i.reply({ content: 'Select an attached file first.', flags: 64 }); return true; } return updateFileOptions(i); }
    if (customId === 'embed:file-options-back') return updateMediaPanel(i);
    if (customId.startsWith('embed:file-spoiler:')) { if (fileIndex == null || !panelMedia.files[fileIndex]) return updateMediaPanel(i); const files = [...panelMedia.files]; files[fileIndex] = panel.mediaModel.normalizeFile({ ...files[fileIndex], spoiler: customId.endsWith(':on') }); saveMediaState(i, state, { ...panelMedia, files }, { selectedFileIndex: fileIndex }); return updateFileOptions(i); }
    if (customId === 'embed:media-gallery-add') { if (panelMedia.gallery.length >= panel.mediaModel.MAX_GALLERY_ITEMS) { await i.reply({ content: `Maximum of ${panel.mediaModel.MAX_GALLERY_ITEMS} gallery items reached.`, flags: 64 }); return true; } await i.showModal(panel.galleryItemModal(state)); return true; }
    if (customId === 'embed:media-gallery-remove') { if (galleryIndex == null || !panelMedia.gallery[galleryIndex]) return updateMediaPanel(i); const gallery = [...panelMedia.gallery]; gallery.splice(galleryIndex, 1); saveMediaState(i, state, { ...panelMedia, gallery }, { selectedMediaIndex: null }); return updateMediaPanel(i); }
    if (customId === 'embed:media-gallery-up' || customId === 'embed:media-gallery-down') { if (galleryIndex == null || !panelMedia.gallery[galleryIndex]) return updateMediaPanel(i); const target = galleryIndex + (customId.endsWith('up') ? -1 : 1); if (target < 0 || target >= panelMedia.gallery.length) return updateMediaPanel(i); const gallery = [...panelMedia.gallery]; [gallery[galleryIndex], gallery[target]] = [gallery[target], gallery[galleryIndex]]; saveMediaState(i, state, { ...panelMedia, gallery }, { selectedMediaIndex: target }); return updateMediaPanel(i); }
    if (customId === 'embed:media-file-add') { if (panelMedia.files.length >= panel.mediaModel.MAX_FILES) { await i.reply({ content: `Maximum of ${panel.mediaModel.MAX_FILES} files reached.`, flags: 64 }); return true; } await i.showModal(panel.fileItemModal(state)); return true; }
    if (customId === 'embed:media-file-edit') { if (fileIndex == null || !panelMedia.files[fileIndex]) { await i.reply({ content: 'Select a file first.', flags: 64 }); return true; } await i.showModal(panel.fileItemModal(state, fileIndex)); return true; }
    if (customId === 'embed:media-file-remove') { if (fileIndex == null || !panelMedia.files[fileIndex]) return updateMediaPanel(i); const files = [...panelMedia.files]; files.splice(fileIndex, 1); saveMediaState(i, state, { ...panelMedia, files }, { selectedFileIndex: null }); return updateMediaPanel(i); }
  }

  if (i.isModalSubmit?.() && customId === 'embed:media-add-save') {
    const panelMedia = panel.getPanelMedia(state);
    const gallery = [...panelMedia.gallery];
    const files = [...panelMedia.files];

    const source = String(i.fields.getTextInputValue('source') || '').trim();
    const displayName = String(i.fields.getTextInputValue('display_name') || '').trim();
    const description = String(i.fields.getTextInputValue('description') || '').trim();

    const uploaded = i.fields.getUploadedFiles('media_files', false);
    const attachments = [...(uploaded?.values?.() || [])];

    if (!source && !attachments.length) {
      await i.reply({
        content: '⚠️ Add a Source URL / Variable or upload at least one file.',
        flags: 64,
      });
      return true;
    }

    let addedGallery = 0;
    let addedFiles = 0;
    let skipped = 0;

    /*
     * URL/variable sources may not be resolvable at edit time.
     * Preserve Embed Studio's auto media handling for dynamic sources.
     * Uploaded Discord attachments provide MIME information immediately
     * and can therefore be classified here.
     */
    if (source) {
      if (gallery.length < panel.mediaModel.MAX_GALLERY_ITEMS) {
        gallery.push(
          panel.mediaModel.normalizeGalleryItem({
            source,
            alt: displayName || description,
            type: 'auto',
          })
        );
        addedGallery += 1;
      } else if (files.length < panel.mediaModel.MAX_FILES) {
        files.push(
          panel.mediaModel.normalizeFile({
            source,
            name: displayName,
            description,
            spoiler: false,
          })
        );
        addedFiles += 1;
      } else {
        skipped += 1;
      }
    }

    for (const attachment of attachments) {
      await cacheUploadedAttachment(attachment);
      const kind = uploadType(attachment);

      if (
        (kind === 'image' || kind === 'video') &&
        gallery.length < panel.mediaModel.MAX_GALLERY_ITEMS
      ) {
        gallery.push(
          panel.mediaModel.normalizeGalleryItem({
            source: attachment.url,
            alt: displayName || attachment.description || attachment.name || description,
            type: kind,
          })
        );

        addedGallery += 1;
        continue;
      }

      if (files.length < panel.mediaModel.MAX_FILES) {
        files.push(
          panel.mediaModel.normalizeFile({
            source: attachment.url,
            name: displayName || attachment.name || '',
            description,
            spoiler: Boolean(attachment.spoiler),
          })
        );

        addedFiles += 1;
      } else {
        skipped += 1;
      }
    }

    if (!addedGallery && !addedFiles) {
      await i.reply({
        content: '⚠️ Nothing could be added because the applicable media/file limits have been reached.',
        flags: 64,
      });
      return true;
    }

    const savedState = saveMediaState(
      i,
      state,
      { ...panelMedia, gallery, files },
      {
        selectedMediaIndex: addedGallery
          ? gallery.length - 1
          : state.selectedMediaIndex,
        selectedFileIndex: addedFiles
          ? files.length - 1
          : state.selectedFileIndex,
      }
    );

    await i.reply({
      content:
        `✅ Added ${addedGallery} gallery media item(s) and ${addedFiles} attached file(s).` +
        (skipped
          ? ` ${skipped} item(s) were skipped because the panel limits were reached.`
          : ''),
      ...panel.buildMediaManagerPanel(i, who(i), savedState),
      flags: 64,
    });

    return true;
  }

  if (i.isModalSubmit?.() && customId.startsWith('embed:media-thumbnail-save:')) { const panelMedia = panel.getPanelMedia(state); panelMedia.thumbnail = panel.mediaModel.normalizeThumbnail({ source: i.fields.getTextInputValue('source'), alt: i.fields.getTextInputValue('alt') }); saveMediaState(i, state, panelMedia); return replyMediaPanel(i); }


  if (i.isModalSubmit?.() && (customId === 'embed:media-gallery-save-new' || customId.startsWith('embed:media-gallery-save:'))) { const panelMedia = panel.getPanelMedia(state); const editingIndex = customId === 'embed:media-gallery-save-new' ? null : Number(customId.split(':').pop()); const existing = Number.isInteger(editingIndex) ? (panelMedia.gallery[editingIndex] || {}) : {}; const entry = panel.mediaModel.normalizeGalleryItem({ source: i.fields.getTextInputValue('source'), alt: i.fields.getTextInputValue('alt'), type: existing.type, headerType: existing.headerType, spoiler: existing.spoiler, placement: existing.placement, alignment: existing.alignment, size: existing.size }); if (!entry.source) { await i.reply({ content: 'A media URL or variable is required.', flags: 64 }); return true; } const gallery = [...panelMedia.gallery]; let selectedMediaIndex; if (editingIndex == null) { if (gallery.length >= panel.mediaModel.MAX_GALLERY_ITEMS) { await i.reply({ content: 'Maximum gallery item limit reached.', flags: 64 }); return true; } gallery.push(entry); selectedMediaIndex = gallery.length - 1; } else { gallery[editingIndex] = entry; selectedMediaIndex = editingIndex; } saveMediaState(i, state, { ...panelMedia, gallery }, { selectedMediaIndex }); return replyMediaPanel(i); }
  if (i.isModalSubmit?.() && (customId === 'embed:media-file-save-new' || customId.startsWith('embed:media-file-save:'))) { const panelMedia = panel.getPanelMedia(state); const editingIndex = customId === 'embed:media-file-save-new' ? null : Number(customId.split(':').pop()); const existing = Number.isInteger(editingIndex) ? (panelMedia.files[editingIndex] || {}) : {}; const entry = panel.mediaModel.normalizeFile({ source: i.fields.getTextInputValue('source'), name: i.fields.getTextInputValue('name'), description: i.fields.getTextInputValue('description'), spoiler: existing.spoiler === true }); if (!entry.source) { await i.reply({ content: 'A file URL or variable is required.', flags: 64 }); return true; } const files = [...panelMedia.files]; let selectedFileIndex; if (editingIndex == null) { if (files.length >= panel.mediaModel.MAX_FILES) { await i.reply({ content: 'Maximum file limit reached.', flags: 64 }); return true; } files.push(entry); selectedFileIndex = files.length - 1; } else { files[editingIndex] = entry; selectedFileIndex = editingIndex; } saveMediaState(i, state, { ...panelMedia, files }, { selectedFileIndex }); return replyMediaPanel(i); }

  if (customId === 'embed:test-send') { try { const payload = await buildPayload(state, i, true); payload.allowedMentions = panel.allowedMentions(state, i); await i.reply(payload); } catch (error) { console.error('[Embed] test payload failed:', error); await i.reply({ content: `❌ Embed test failed: ${error?.message || error}`, flags: 64 }); } return true; }

  if (customId === 'embed:use') {
    const channel =
      i.guild.channels.cache.get(state.channelId) ||
      await i.guild.channels.fetch(state.channelId).catch(() => null);

    if (!isTextBasedChannel(channel)) {
      await i.reply({
        content: 'Invalid channel.',
        flags: 64,
      });
      return true;
    }

    const access = await validateChannelAccess(
      i.guild,
      channel.id,
      [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
      ],
      { scope: 'embed.deploy' }
    );

    if (!access.ok) {
      await i.reply({
        content: panel.trim(access.message, 1800),
        flags: 64,
      });
      return true;
    }

    let sent = null;

    try {
      const payload = await buildPayload(state, i, false);
      payload.allowedMentions = panel.allowedMentions(state, i);

      sent = await channel.send(payload);

      const presetName = `auto-${state.template || 'custom'}`;
      const deploymentKey = getDeploymentKeyFromState({
        ...state,
        selectedPreset: presetName,
      });

      guildManager.saveEmbedPreset(
        i.guild.id,
        presetName,
        panel.presetData(state),
        i.guild
      );

      const defaultSaved = setGuildPresetDefault(
        i.guild.id,
        state.template,
        presetName,
        i.guild
      );

      if (!defaultSaved) {
        throw new Error(
          'Preset default assignment failed after the Discord message was created.'
        );
      }

      saveEmbedDeployment(i.guild.id, deploymentKey, {
        channelId: channel.id,
        messageId: sent.id,
        template: state.template,
        preset: presetName,
        createdBy: i.user.id,
        lastUpdatedBy: i.user.id,
      });

      const confirmed = getEmbedDeployment(i.guild.id, deploymentKey);

      if (
        !confirmed ||
        confirmed.channelId !== channel.id ||
        confirmed.messageId !== sent.id
      ) {
        throw new Error(
          'Deployment persistence could not be confirmed after the Discord message was created.'
        );
      }

      panel.clearUnsaved(i, {
        ...state,
        selectedPreset: presetName,
      });

      await i.reply({
        content: `✅ Embed posted to <#${state.channelId}> and saved as active`,
        flags: 64,
      });
    } catch (error) {
      if (sent) {
        let rollbackSucceeded = false;

        try {
          await sent.delete();
          rollbackSucceeded = true;
        } catch (rollbackError) {
          console.error(
            '[Embed] Failed to roll back Discord message after deployment persistence failure:',
            {
              guildId: i.guild.id,
              channelId: channel.id,
              messageId: sent.id,
              rollbackError,
            }
          );
        }

        console.error(
          '[Embed] Embed deployment failed after Discord message creation:',
          {
            guildId: i.guild.id,
            channelId: channel.id,
            messageId: sent.id,
            rollbackSucceeded,
            error,
          }
        );

        await i.reply({
          content: rollbackSucceeded
            ? '❌ The embed could not be fully saved by Goliath. The Discord message was rolled back and the editor remains unsaved.'
            : `🚨 The embed could not be fully saved by Goliath, and the Discord message could not be rolled back. Message ID: ${sent.id}. The editor remains unsaved and this deployment requires reconciliation.`,
          flags: 64,
        });
      } else {
        await i.reply({
          content: panel.embedOperationError(error, channel.id, 'send'),
          flags: 64,
        });
      }
    }

    return true;
  }

  return handleLegacyInteraction(i);
}

async function legacyReplyOrUpdate(i, payload) {
  const safePayload = { ...payload, flags: 64 };
  if (i.isModalSubmit?.()) {
    if (typeof i.update === 'function') return i.update(payload);
    if (i.deferred || i.replied) return i.editReply(safePayload);
    return i.reply(safePayload);
  }
  return i.update(payload);
}

async function handleLegacyInteraction(i) {
  const customId = String(i.customId || '');
  if (customId !== 'admin:embed' && !customId.startsWith('embed:')) return false;
  const name = panel.memberName(i);
  const state = panel.getSession(i);

  if (customId === 'admin:embed') { await i.update(panel.buildEditorPanel(i, name)); return true; }

  if (i.isStringSelectMenu?.()) {
    if (customId === 'embed:template') { panel.applyTemplate(i, i.values[0]); await legacyReplyOrUpdate(i, panel.buildEditorPanel(i, name)); return true; }
    if (customId === 'embed:color') {
      const value = i.values[0];
      if (value === panel.CUSTOM_HEX_VALUE) { await i.showModal(panel.colorModal(state)); return true; }
      panel.markUnsaved(i, panel.saveSelected(state, { color: value })); await legacyReplyOrUpdate(i, panel.buildEditorPanel(i, name)); return true;
    }
    if (customId === 'embed:builder-color') {
      const value = i.values[0];

      if (value === panel.CUSTOM_HEX_VALUE) {
        await i.showModal(panel.colorModal(state));
        return true;
      }

      panel.markUnsaved(
        i,
        panel.saveSelected(state, {
          color: value,
        })
      );

      await legacyReplyOrUpdate(
        i,
        panel.buildPanelColourPanel(i, name)
      );

      return true;
    }
    if (customId === 'embed:panel-select') { const current = panel.getSession(i); panel.saveSession(i, { ...current, selectedPanelIndex: Number(i.values[0]), selectedFieldIndex: null }); await legacyReplyOrUpdate(i, panel.buildEditorPanel(i, name)); return true; }
    if (customId === 'embed:field-layout') { panel.markUnsaved(i, { ...state, fieldLayout: i.values[0] }); await legacyReplyOrUpdate(i, panel.buildFieldsPanel(i, name)); return true; }
    if (customId === 'embed:field-select') { panel.saveSession(i, { ...state, selectedFieldIndex: Number(i.values[0]) }); await legacyReplyOrUpdate(i, panel.buildFieldsPanel(i, name)); return true; }
    if (customId === 'embed:button-select') { panel.saveSession(i, { ...state, selectedButtonIndex: Number(i.values[0]) }); await legacyReplyOrUpdate(i, panel.buildButtonsPanel(i, name)); return true; }
  }

  if (i.isChannelSelectMenu?.() && customId === 'embed:channel') { panel.markUnsaved(i, { ...state, channelId: i.values[0] }); await legacyReplyOrUpdate(i, panel.buildEditorPanel(i, name)); return true; }

  if (i.isButton?.()) {
    if (customId === 'embed:editor' || customId === 'embed:back') { await i.update(panel.buildEditorPanel(i, name)); return true; }
    if (customId === 'embed:builder') { await i.update(panel.buildBuilderPanel(i, name)); return true; }
    if (customId === 'embed:panel-colour') { await i.update(panel.buildPanelColourPanel(i, name)); return true; }
    if (customId === 'embed:presets') { await i.update(panel.buildPresetsPanel(i, name)); return true; }
    if (customId === 'embed:panels') { await i.update(panel.buildPanelsPanel(i, name)); return true; }
    if (customId === 'embed:helpers') { await i.update(panel.buildHelpersPanel(i)); return true; }
    if (customId === 'embed:edit-content') return updateContent(i);
    if (customId === 'embed:content-back') return updateContent(i);
    if (customId === 'embed:content-edit-text') { await i.showModal(panel.contentModal(state)); return true; }
    if (customId === 'embed:content-details') { await i.showModal(panel.appearanceDetailsModal(state)); return true; }
    if (customId === 'embed:content-author-icon') return updateIcon(i, 'author');
    if (customId === 'embed:content-footer-icon') return updateIcon(i, 'footer');
    if (customId === 'embed:toggle-ping') { panel.markUnsaved(i, { ...state, allowUserPing: !state.allowUserPing }); await i.update(panel.buildBuilderPanel(i, name)); return true; }
    if (customId === 'embed:toggle-timestamp') { panel.markUnsaved(i, { ...state, showTimestamp: !state.showTimestamp }); await i.update(panel.buildBuilderPanel(i, name)); return true; }
    if (customId === 'embed:reset') {
      await i.update(panel.buildResetConfirmationPanel(i, name));
      return true;
    }

    if (customId === 'embed:reset-confirm') {
      panel.resetSession(i);
      await i.update(panel.buildEditorPanel(i, name));
      return true;
    }
    if (customId === 'embed:panel-add') {
      if (state.panels.length >= panel.MAX_PANELS) { await i.reply({ content: 'Maximum panel limit reached.', flags: 64 }); return true; }
      const panels = [...state.panels, panel.basePanel({ title: `Panel ${state.panels.length + 1}`, description: 'Add content here.', color: state.color })]; panel.markUnsaved(i, { ...state, panels, selectedPanelIndex: panels.length - 1, selectedFieldIndex: null }); await i.update(panel.buildPanelsPanel(i, name)); return true;
    }
    if (customId === 'embed:panel-duplicate') {
      if (state.panels.length >= panel.MAX_PANELS) { await i.reply({ content: 'Maximum panel limit reached.', flags: 64 }); return true; }
      const panels = [...state.panels]; panels.splice(state.selectedPanelIndex + 1, 0, panel.clone(state.panels[state.selectedPanelIndex])); panel.markUnsaved(i, { ...state, panels, selectedPanelIndex: state.selectedPanelIndex + 1, selectedFieldIndex: null }); await i.update(panel.buildPanelsPanel(i, name)); return true;
    }
    if (customId === 'embed:panel-remove') {
      if (state.panels.length <= 1) { await i.reply({ content: 'You need at least one panel.', flags: 64 }); return true; }
      const panels = [...state.panels]; panels.splice(state.selectedPanelIndex, 1); panel.markUnsaved(i, { ...state, panels, selectedPanelIndex: Math.max(0, state.selectedPanelIndex - 1), selectedFieldIndex: null }); await i.update(panel.buildPanelsPanel(i, name)); return true;
    }
    if (customId === 'embed:panel-up' || customId === 'embed:panel-down') { const delta = customId.endsWith('up') ? -1 : 1; const target = state.selectedPanelIndex + delta; if (target < 0 || target >= state.panels.length) return true; const panels = [...state.panels]; [panels[state.selectedPanelIndex], panels[target]] = [panels[target], panels[state.selectedPanelIndex]]; panel.markUnsaved(i, { ...state, panels, selectedPanelIndex: target }); await i.update(panel.buildPanelsPanel(i, name)); return true; }
    if (customId === 'embed:field-add') { await i.showModal(panel.fieldModal(state)); return true; }
    if (customId === 'embed:field-edit') { if (!Number.isInteger(state.selectedFieldIndex)) { await i.reply({ content: 'Select a field first.', flags: 64 }); return true; } await i.showModal(panel.fieldModal(state, state.selectedFieldIndex)); return true; }
    if (customId === 'embed:field-remove-selected') { const fields = [...(state.fields || [])]; if (Number.isInteger(state.selectedFieldIndex)) fields.splice(state.selectedFieldIndex, 1); panel.markUnsaved(i, panel.saveSelected({ ...state, selectedFieldIndex: null }, { fields })); await i.update(panel.buildFieldsPanel(i, name)); return true; }
    if (customId === 'embed:button-add') { await i.showModal(panel.buttonModal(state)); return true; }
    if (customId === 'embed:button-edit') { if (!Number.isInteger(state.selectedButtonIndex)) { await i.reply({ content: 'Select a button first.', flags: 64 }); return true; } await i.showModal(panel.buttonModal(state, state.selectedButtonIndex)); return true; }
    if (customId === 'embed:button-remove-selected') { const buttons = [...(state.buttons || [])]; if (Number.isInteger(state.selectedButtonIndex)) buttons.splice(state.selectedButtonIndex, 1); panel.markUnsaved(i, { ...state, buttons, selectedButtonIndex: null }); await i.update(panel.buildButtonsPanel(i, name)); return true; }
    if (customId === 'embed:button-move-up' || customId === 'embed:button-move-down') { const delta = customId.endsWith('up') ? -1 : 1; const target = state.selectedButtonIndex + delta; if (!Number.isInteger(state.selectedButtonIndex) || target < 0 || target >= (state.buttons || []).length) return true; const buttons = [...state.buttons]; [buttons[state.selectedButtonIndex], buttons[target]] = [buttons[target], buttons[state.selectedButtonIndex]]; panel.markUnsaved(i, { ...state, buttons, selectedButtonIndex: target }); await i.update(panel.buildButtonsPanel(i, name)); return true; }

  }

  if (i.isModalSubmit?.()) {
    if (customId === 'embed:save-color') { const hex = i.fields.getTextInputValue('hex'); if (!panel.validHex(hex)) { await i.reply({ content: 'Invalid HEX.', flags: 64 }); return true; } panel.markUnsaved(i, panel.saveSelected(state, { color: panel.normHex(hex) })); await i.reply({ ...panel.buildEditorPanel(i, name), flags: 64 }); return true; }
    if (customId.startsWith('embed:save-content:')) { panel.markUnsaved(i, panel.saveSelected(state, { title: i.fields.getTextInputValue('title'), description: i.fields.getTextInputValue('description') })); await i.reply({ ...panel.buildContentManagerPanel(i), flags: 64 }); return true; }
    if (customId.startsWith('embed:save-media:')) { panel.markUnsaved(i, panel.saveSelected(state, { authorIcon: i.fields.getTextInputValue('authorIcon'), thumbnail: i.fields.getTextInputValue('thumbnail'), image: i.fields.getTextInputValue('image'), authorUrl: i.fields.getTextInputValue('authorUrl'), footerIcon: i.fields.getTextInputValue('footerIcon') })); await i.reply({ ...panel.buildBuilderPanel(i, name), flags: 64 }); return true; }
    if (customId === 'embed:field-save-new' || customId.startsWith('embed:field-save:')) { const fields = [...(state.fields || [])]; const field = { name: i.fields.getTextInputValue('name'), value: i.fields.getTextInputValue('value'), inline: /^y(es)?$/i.test(i.fields.getTextInputValue('layout')) }; if (customId === 'embed:field-save-new') fields.push(field); else fields[Number(customId.split(':').pop())] = field; panel.markUnsaved(i, panel.saveSelected(state, { fields })); await i.reply({ ...panel.buildFieldsPanel(i, name), flags: 64 }); return true; }
    if (customId === 'embed:button-save-new' || customId.startsWith('embed:button-save:')) { const buttons = [...(state.buttons || [])]; const entry = { label: i.fields.getTextInputValue('label'), emoji: i.fields.getTextInputValue('emoji'), style: i.fields.getTextInputValue('style'), url: i.fields.getTextInputValue('url') }; if (customId === 'embed:button-save-new') buttons.push(entry); else buttons[Number(customId.split(':').pop())] = entry; panel.markUnsaved(i, { ...state, buttons }); await i.reply({ ...panel.buildButtonsPanel(i, name), flags: 64 }); return true; }
  }

  return false;
}

async function showReadiness(interaction) {
  const payload = panel.buildReadinessPanel(interaction);
  if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
  else if (interaction.isButton?.() || interaction.isStringSelectMenu?.() || interaction.isRoleSelectMenu?.()) await interaction.update(payload);
  else await interaction.reply({ ...payload, flags: 64 });
  return true;
}
async function updateWith(interaction, payload) { if (interaction.deferred || interaction.replied) await interaction.editReply(payload); else await interaction.update(payload); return true; }
function selectState(interaction, patch = {}) { const state = panel.getSession(interaction); return panel.saveSession(interaction, { ...state, ...patch }); }
async function routeReadinessFix(interaction) {
  const report = panel.getReadinessReport(interaction); const target = panel.getReadinessFixTarget(report); const state = panel.getSession(interaction);
  if (target.type === 'channel') return updateWith(interaction, panel.buildEditorPanel(interaction, panel.memberName?.(interaction)));
  if (target.type === 'button') { const buttons = Array.isArray(state.buttons) ? state.buttons : []; const selectedButtonIndex = Number.isInteger(target.index) && buttons[target.index] ? target.index : (buttons.length ? 0 : null); selectState(interaction, { selectedButtonIndex }); return updateWith(interaction, panel.buildButtonsManagerPanel(interaction)); }
  if (target.type === 'field') { const panels = Array.isArray(state.panels) ? state.panels : []; const panelIndex = Math.max(0, Math.min(Number(target.panelIndex) || 0, Math.max(0, panels.length - 1))); const fields = Array.isArray(panels[panelIndex]?.fields) ? panels[panelIndex].fields : []; const selectedFieldIndex = Number.isInteger(target.fieldIndex) && fields[target.fieldIndex] ? target.fieldIndex : (fields.length ? 0 : null); selectState(interaction, { selectedPanelIndex: panelIndex, selectedFieldIndex }); return updateWith(interaction, panel.buildFieldsManagerPanel(interaction)); }
  if (target.type === 'media') { const panels = Array.isArray(state.panels) ? state.panels : []; const panelIndex = Math.max(0, Math.min(Number(target.panelIndex) || 0, Math.max(0, panels.length - 1))); selectState(interaction, { selectedPanelIndex: panelIndex }); return updateWith(interaction, panel.buildMediaManagerPanel(interaction)); }
  if (target.type === 'panel') { const panels = Array.isArray(state.panels) ? state.panels : []; const panelIndex = Math.max(0, Math.min(Number(target.panelIndex) || 0, Math.max(0, panels.length - 1))); selectState(interaction, { selectedPanelIndex: panelIndex }); return updateWith(interaction, panel.buildBuilderPanel(interaction, panel.memberName?.(interaction))); }
  if (target.type === 'variables' && typeof panel.buildHelpersPanel === 'function') return updateWith(interaction, panel.buildHelpersPanel(interaction, panel.memberName?.(interaction)));
  return updateWith(interaction, panel.buildBuilderPanel(interaction, panel.memberName?.(interaction)));
}

async function handleInteraction(interaction) {
  const customId = String(interaction.customId || '');

  if (await handlePresetInteraction(interaction)) return true;
  if (interaction.isStringSelectMenu?.() && customId === 'embed:builder-panel-select') { const state = panel.getSession(interaction); const index = Math.max(0, Math.min(Number(interaction.values?.[0]) || 0, Math.max(0, (state.panels?.length || 1) - 1))); panel.saveSession(interaction, { ...state, selectedPanelIndex: index, selectedFieldIndex: null }); await interaction.update(panel.buildBuilderPanel(interaction, panel.memberName(interaction))); return true; }
  if (interaction.isButton?.() && customId === 'embed:actions') { await interaction.update(panel.buildActionsPanel(interaction)); return true; }
  if ((customId === 'embed:readiness' || customId === 'embed:readiness-refresh') && interaction.isButton?.()) return showReadiness(interaction);
  if (customId === 'embed:readiness-fix' && interaction.isButton?.()) return routeReadinessFix(interaction);
  if (DELIVERY_ACTIONS.has(customId)) { const report = panel.getReadinessReport(interaction); if (!report.ready) { const payload = panel.buildReadinessPanel(interaction); const prefix = '❌ This embed is not ready to send. Fix the issues below first.'; payload.embeds[0].setDescription(`${prefix}\n\n${payload.embeds[0].data.description || ''}`.slice(0, 4096)); if (interaction.deferred || interaction.replied) await interaction.editReply(payload); else await interaction.reply({ ...payload, flags: 64 }); return true; } }
  if (await handleButtonAction(interaction)) return true;
  return handleBuilderInteractions(interaction);
}

module.exports = { handleInteraction, handleButtonAction, graphicHeaderIndex, normalizeGraphicHeaderPlacements };