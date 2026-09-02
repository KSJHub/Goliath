'use strict';

const {
  ActionRowBuilder,
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
const { buildEmbedPayload, prepareEmbedMedia } = require('./embedRenderer');

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
  next = panel.saveSelected(next, { image: current.gallery?.[0]?.source || '', thumbnail: current.thumbnail?.source || '' });
  return panel.saveSession(i, { ...next, ...extra, hasUnsavedChanges: true });
}
async function updateAppearance(i) { await i.update(panel.buildAppearancePanel(i)); return true; }
async function updateIcon(i, kind) { await i.update(panel.buildAppearanceIconPanel(i, kind)); return true; }
async function updateThumbnailPanel(i) { await i.update(panel.buildThumbnailOptionsPanel(i)); return true; }
async function updateMediaPanel(i) { await i.update(panel.buildMediaManagerPanel(i, who(i))); return true; }
async function updateMediaOptions(i) { await i.update(panel.buildMediaOptionsPanel(i)); return true; }
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
async function buildPayload(state, interaction, ephemeral = false) {
  return buildEmbedPayload({
    embeds: panel.buildPreviewEmbeds(state, interaction),
    actionRows: panel.buttonRows(state, interaction),
    allowUserPing: Boolean(state.allowUserPing),
    userId: interaction.user?.id || null,
    ephemeral,
    media: state.media || state.mediaV2,
    interaction,
  });
}

function selectedFieldIndex(state) {
  const fields = Array.isArray(state.fields) ? state.fields : [];
  return Number.isInteger(state.selectedFieldIndex) && fields[state.selectedFieldIndex] ? state.selectedFieldIndex : null;
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
  if (!customId.startsWith('embed:preset-')) return false;
  const guildId = i?.guildId || i?.guild?.id || null;
  const state = panel.getSession(i);

  if (i.isStringSelectMenu?.() && customId === 'embed:preset-select') {
    const presetName = String(i.values?.[0] || '');
    const presets = guildManager.getEmbedPresets?.(guildId) || {};
    if (!presets[presetName]) {
      await i.reply({ content: 'Preset not found.', flags: 64 });
      return true;
    }
    panel.saveSession(i, { ...state, selectedPreset: presetName });
    await i.update(panel.buildPresetsPanel(i));
    return true;
  }

  if (i.isButton?.() && customId === 'embed:preset-load') {
    const presetName = state?.selectedPreset || null;
    const preset = presetName ? guildManager.getEmbedPreset?.(guildId, presetName) : null;
    if (!preset) {
      await i.reply({ content: 'Select a valid preset first.', flags: 64 });
      return true;
    }
    panel.applyPreset(i, presetName, preset);
    panel.clearUnsaved(i, panel.getSession(i));
    await i.update(panel.buildEditorPanel(i, panel.memberName(i)));
    return true;
  }

  if (i.isButton?.() && customId === 'embed:preset-save') {
    await i.showModal(panel.presetModal(state));
    return true;
  }

  if (i.isButton?.() && customId === 'embed:preset-new') {
    panel.resetSession(i);
    await i.update(panel.buildEditorPanel(i, panel.memberName(i)));
    return true;
  }

  if (i.isButton?.() && customId === 'embed:preset-rename') {
    if (!state?.selectedPreset) {
      await i.reply({ content: 'Select a preset first.', flags: 64 });
      return true;
    }
    await i.showModal(presetNameModal('embed:preset-rename-modal', 'Rename Embed Preset', 'New preset name', state.selectedPreset));
    return true;
  }

  if (i.isButton?.() && customId === 'embed:preset-duplicate') {
    if (!state?.selectedPreset) {
      await i.reply({ content: 'Select a preset first.', flags: 64 });
      return true;
    }
    await i.showModal(presetNameModal('embed:preset-duplicate-modal', 'Duplicate Embed Preset', 'Copy name', `${state.selectedPreset} Copy`));
    return true;
  }

  if (i.isButton?.() && customId === 'embed:preset-delete') {
    const presetName = state?.selectedPreset || null;
    if (!presetName) {
      await i.reply({ content: 'Select a preset first.', flags: 64 });
      return true;
    }
    const defaults = guildManager.getEmbedDefaults?.(guildId) || {};
    const templateKey = state.template || 'custom';
    if (typeof guildManager.deleteEmbedPreset === 'function') {
      guildManager.deleteEmbedPreset(guildId, presetName, i.guild);
    } else {
      const presets = guildManager.getEmbedPresets?.(guildId) || {};
      delete presets[presetName];
      guildManager.replaceGuildSection?.(guildId, 'embedPresets', presets, i.guild);
    }
    if (defaults[templateKey] === presetName && typeof guildManager.clearEmbedDefault === 'function') {
      guildManager.clearEmbedDefault(guildId, templateKey, i.guild);
    }
    panel.clearUnsaved(i, { ...state, selectedPreset: null });
    await i.update(panel.buildPresetsPanel(i));
    return true;
  }

  if (i.isButton?.() && customId === 'embed:preset-default') {
    const presetName = state?.selectedPreset || null;
    if (!presetName) {
      await i.reply({ content: 'Select a preset first.', flags: 64 });
      return true;
    }
    const ok = setGuildPresetDefault(guildId, state.template || 'custom', presetName, i.guild);
    if (!ok) {
      await i.reply({ content: '❌ Could not set default preset.', flags: 64 });
      return true;
    }
    await i.update(panel.buildPresetsPanel(i));
    return true;
  }

  if (i.isModalSubmit?.() && customId === 'embed:preset-rename-modal') {
    const oldName = state?.selectedPreset || null;
    const newName = cleanPresetName(i.fields.getTextInputValue('name'));
    const presets = guildManager.getEmbedPresets?.(guildId) || {};
    if (!oldName || !presets[oldName]) {
      await i.reply({ content: 'The selected preset no longer exists.', flags: 64 });
      return true;
    }
    if (!newName) {
      await i.reply({ content: 'A preset name is required.', flags: 64 });
      return true;
    }
    if (newName !== oldName && presets[newName]) {
      await i.reply({ content: `A preset named **${newName}** already exists.`, flags: 64 });
      return true;
    }
    if (newName !== oldName) {
      guildManager.saveEmbedPreset(guildId, newName, { ...presets[oldName], name: newName }, i.guild);
      guildManager.deleteEmbedPreset?.(guildId, oldName, i.guild);
      const defaults = guildManager.getEmbedDefaults?.(guildId) || {};
      for (const [templateKey, defaultPreset] of Object.entries(defaults)) {
        if (defaultPreset === oldName) setGuildPresetDefault(guildId, templateKey, newName, i.guild);
      }
    }
    panel.saveSession(i, { ...state, selectedPreset: newName });
    await i.reply({ content: `✅ Renamed preset to **${newName}**.`, ...panel.buildPresetsPanel(i), flags: 64 });
    return true;
  }

  if (i.isModalSubmit?.() && customId === 'embed:preset-duplicate-modal') {
    const sourceName = state?.selectedPreset || null;
    const newName = cleanPresetName(i.fields.getTextInputValue('name'));
    const presets = guildManager.getEmbedPresets?.(guildId) || {};
    if (!sourceName || !presets[sourceName]) {
      await i.reply({ content: 'The selected preset no longer exists.', flags: 64 });
      return true;
    }
    if (!newName) {
      await i.reply({ content: 'A preset name is required.', flags: 64 });
      return true;
    }
    if (presets[newName]) {
      await i.reply({ content: `A preset named **${newName}** already exists.`, flags: 64 });
      return true;
    }
    guildManager.saveEmbedPreset(guildId, newName, { ...presets[sourceName], name: newName }, i.guild);
    panel.saveSession(i, { ...state, selectedPreset: newName });
    await i.reply({ content: `✅ Duplicated as **${newName}**.`, ...panel.buildPresetsPanel(i), flags: 64 });
    return true;
  }

  if (i.isModalSubmit?.() && customId === 'embed:preset-save-modal') {
    const name = cleanPresetName(i.fields.getTextInputValue('name'));
    if (!name) {
      await i.reply({ content: 'Name required.', flags: 64 });
      return true;
    }
    const presets = guildManager.getEmbedPresets?.(guildId) || {};
    if (presets[name]) {
      pendingPresetSaves.set(presetInteractionKey(i), { name, data: panel.presetData(state) });
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('embed:preset-overwrite-confirm').setLabel('✅ Overwrite').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('embed:preset-overwrite-cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      );
      await i.reply({ content: `⚠️ **${name}** already exists. Overwrite it?`, components: [row], flags: 64 });
      return true;
    }
    guildManager.saveEmbedPreset(guildId, name, panel.presetData(state), i.guild);
    panel.clearUnsaved(i, { ...state, selectedPreset: name });
    await i.reply({ ...panel.buildPresetsPanel(i), flags: 64 });
    return true;
  }

  if (i.isButton?.() && customId === 'embed:preset-overwrite-confirm') {
    const pending = pendingPresetSaves.get(presetInteractionKey(i));
    if (!pending) {
      await i.update({ content: 'This overwrite request has expired.', components: [] });
      return true;
    }
    guildManager.saveEmbedPreset(guildId, pending.name, pending.data, i.guild);
    pendingPresetSaves.delete(presetInteractionKey(i));
    panel.clearUnsaved(i, { ...state, selectedPreset: pending.name });
    await i.update({ content: `✅ Overwrote **${pending.name}**.`, ...panel.buildPresetsPanel(i) });
    return true;
  }

  if (i.isButton?.() && customId === 'embed:preset-overwrite-cancel') {
    pendingPresetSaves.delete(presetInteractionKey(i));
    await i.update({ content: 'Overwrite cancelled.', components: [] });
    return true;
  }

  return false;
}

async function handleBuilderInteractions(i) {
  const customId = String(i.customId || '');
  const state = panel.getSession(i);
  const fields = Array.isArray(state.fields) ? [...state.fields] : [];
  const fieldIndex = selectedFieldIndex(state);
  const buttons = Array.isArray(state.buttons) ? [...state.buttons] : [];
  const buttonIndex = selectedButtonIndex(state);

  if (i.isButton?.()) {
    if (customId === 'embed:edit-media') return updateAppearance(i);
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

  if (i.isModalSubmit?.() && customId.startsWith('embed:appearance-details-save:')) { saveAppearance(i, state, { authorName: i.fields.getTextInputValue('authorName'), authorUrl: i.fields.getTextInputValue('authorUrl'), footer: i.fields.getTextInputValue('footer') }); await i.reply({ ...panel.buildAppearancePanel(i), flags: 64 }); return true; }
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

  if (customId === 'embed:edit-images' && i.isButton?.()) return updateMediaPanel(i);
  if (i.isStringSelectMenu?.() && customId === 'embed:media-gallery-select') { panel.saveSession(i, { ...state, selectedMediaIndex: Number(i.values[0]) }); return updateMediaPanel(i); }
  if (i.isStringSelectMenu?.() && customId === 'embed:media-file-select') { panel.saveSession(i, { ...state, selectedFileIndex: Number(i.values[0]) }); return updateMediaPanel(i); }

  if (i.isButton?.()) {
    const panelMedia = panel.getPanelMedia(state);
    const galleryIndex = Number.isInteger(state.selectedMediaIndex) ? state.selectedMediaIndex : null;
    const fileIndex = Number.isInteger(state.selectedFileIndex) ? state.selectedFileIndex : null;
    if (customId === 'embed:media-upload') { await i.showModal(panel.mediaUploadModal()); return true; }
    if (customId === 'embed:media-options') { if (galleryIndex == null || !panelMedia.gallery[galleryIndex]) { await i.reply({ content: 'Select a gallery item first.', flags: 64 }); return true; } return updateMediaOptions(i); }
    if (customId === 'embed:media-options-back') return updateMediaPanel(i);
    if (customId.startsWith('embed:media-type:')) { if (galleryIndex == null || !panelMedia.gallery[galleryIndex]) return updateMediaPanel(i); const type = customId.split(':').pop(); if (!['auto', 'image', 'video'].includes(type)) return true; const gallery = [...panelMedia.gallery]; gallery[galleryIndex] = panel.mediaModel.normalizeGalleryItem({ ...gallery[galleryIndex], type }); saveMediaState(i, state, { ...panelMedia, gallery }, { selectedMediaIndex: galleryIndex }); return updateMediaOptions(i); }
    if (customId.startsWith('embed:media-spoiler:')) { if (galleryIndex == null || !panelMedia.gallery[galleryIndex]) return updateMediaPanel(i); const gallery = [...panelMedia.gallery]; gallery[galleryIndex] = panel.mediaModel.normalizeGalleryItem({ ...gallery[galleryIndex], spoiler: customId.endsWith(':on') }); saveMediaState(i, state, { ...panelMedia, gallery }, { selectedMediaIndex: galleryIndex }); return updateMediaOptions(i); }
    if (customId === 'embed:file-options') { if (fileIndex == null || !panelMedia.files[fileIndex]) { await i.reply({ content: 'Select an attached file first.', flags: 64 }); return true; } return updateFileOptions(i); }
    if (customId === 'embed:file-options-back') return updateMediaPanel(i);
    if (customId.startsWith('embed:file-spoiler:')) { if (fileIndex == null || !panelMedia.files[fileIndex]) return updateMediaPanel(i); const files = [...panelMedia.files]; files[fileIndex] = panel.mediaModel.normalizeFile({ ...files[fileIndex], spoiler: customId.endsWith(':on') }); saveMediaState(i, state, { ...panelMedia, files }, { selectedFileIndex: fileIndex }); return updateFileOptions(i); }
    if (customId === 'embed:media-gallery-add') { if (panelMedia.gallery.length >= panel.mediaModel.MAX_GALLERY_ITEMS) { await i.reply({ content: `Maximum of ${panel.mediaModel.MAX_GALLERY_ITEMS} gallery items reached.`, flags: 64 }); return true; } await i.showModal(panel.galleryItemModal(state)); return true; }
    if (customId === 'embed:media-gallery-edit') { if (galleryIndex == null || !panelMedia.gallery[galleryIndex]) { await i.reply({ content: 'Select a gallery item first.', flags: 64 }); return true; } await i.showModal(panel.galleryItemModal(state, galleryIndex)); return true; }
    if (customId === 'embed:media-gallery-remove') { if (galleryIndex == null || !panelMedia.gallery[galleryIndex]) return updateMediaPanel(i); const gallery = [...panelMedia.gallery]; gallery.splice(galleryIndex, 1); saveMediaState(i, state, { ...panelMedia, gallery }, { selectedMediaIndex: null }); return updateMediaPanel(i); }
    if (customId === 'embed:media-gallery-up' || customId === 'embed:media-gallery-down') { if (galleryIndex == null || !panelMedia.gallery[galleryIndex]) return updateMediaPanel(i); const target = galleryIndex + (customId.endsWith('up') ? -1 : 1); if (target < 0 || target >= panelMedia.gallery.length) return updateMediaPanel(i); const gallery = [...panelMedia.gallery]; [gallery[galleryIndex], gallery[target]] = [gallery[target], gallery[galleryIndex]]; saveMediaState(i, state, { ...panelMedia, gallery }, { selectedMediaIndex: target }); return updateMediaPanel(i); }
    if (customId === 'embed:media-file-add') { if (panelMedia.files.length >= panel.mediaModel.MAX_FILES) { await i.reply({ content: `Maximum of ${panel.mediaModel.MAX_FILES} files reached.`, flags: 64 }); return true; } await i.showModal(panel.fileItemModal(state)); return true; }
    if (customId === 'embed:media-file-edit') { if (fileIndex == null || !panelMedia.files[fileIndex]) { await i.reply({ content: 'Select a file first.', flags: 64 }); return true; } await i.showModal(panel.fileItemModal(state, fileIndex)); return true; }
    if (customId === 'embed:media-file-remove') { if (fileIndex == null || !panelMedia.files[fileIndex]) return updateMediaPanel(i); const files = [...panelMedia.files]; files.splice(fileIndex, 1); saveMediaState(i, state, { ...panelMedia, files }, { selectedFileIndex: null }); return updateMediaPanel(i); }
  }

  if (i.isModalSubmit?.() && customId === 'embed:media-upload-save') {
    const uploaded = i.fields.getUploadedFiles('media_files', true); const attachments = [...(uploaded?.values?.() || [])];
    if (!attachments.length) { await i.reply({ content: 'No files were uploaded.', flags: 64 }); return true; }
    const panelMedia = panel.getPanelMedia(state), gallery = [...panelMedia.gallery], files = [...panelMedia.files]; let addedGallery = 0, addedFiles = 0, skipped = 0;
    for (const attachment of attachments) { await cacheUploadedAttachment(attachment); const kind = uploadType(attachment); if ((kind === 'image' || kind === 'video') && gallery.length < panel.mediaModel.MAX_GALLERY_ITEMS) { gallery.push(panel.mediaModel.normalizeGalleryItem({ source: attachment.url, alt: attachment.description || attachment.name || '', type: kind, spoiler: Boolean(attachment.spoiler) })); addedGallery += 1; } else if (files.length < panel.mediaModel.MAX_FILES) { files.push(panel.mediaModel.normalizeFile({ source: attachment.url, name: attachment.name || '', description: attachment.description || '', spoiler: Boolean(attachment.spoiler) })); addedFiles += 1; } else skipped += 1; }
    saveMediaState(i, state, { ...panelMedia, gallery, files }, { selectedMediaIndex: addedGallery ? gallery.length - 1 : state.selectedMediaIndex, selectedFileIndex: addedFiles ? files.length - 1 : state.selectedFileIndex });
    await i.reply({ content: `✅ Added ${addedGallery} gallery media item(s) and ${addedFiles} attached file(s).${skipped ? ` ${skipped} item(s) were skipped because the panel limits were reached.` : ''}`, ...panel.buildMediaManagerPanel(i, who(i)), flags: 64 }); return true;
  }
  if (i.isModalSubmit?.() && customId.startsWith('embed:save-content-clean:')) { panel.markUnsaved(i, panel.saveSelected(state, { title: i.fields.getTextInputValue('title'), description: i.fields.getTextInputValue('description') })); await i.reply({ ...panel.buildBuilderPanel(i, who(i)), flags: 64 }); return true; }
  if (i.isModalSubmit?.() && customId.startsWith('embed:media-thumbnail-save:')) { const panelMedia = panel.getPanelMedia(state); panelMedia.thumbnail = panel.mediaModel.normalizeThumbnail({ source: i.fields.getTextInputValue('source'), alt: i.fields.getTextInputValue('alt') }); saveMediaState(i, state, panelMedia); return replyMediaPanel(i); }
  if (i.isModalSubmit?.() && (customId === 'embed:media-gallery-save-new' || customId.startsWith('embed:media-gallery-save:'))) { const panelMedia = panel.getPanelMedia(state); const editingIndex = customId === 'embed:media-gallery-save-new' ? null : Number(customId.split(':').pop()); const existing = Number.isInteger(editingIndex) ? (panelMedia.gallery[editingIndex] || {}) : {}; const entry = panel.mediaModel.normalizeGalleryItem({ source: i.fields.getTextInputValue('source'), alt: i.fields.getTextInputValue('alt'), type: existing.type || 'auto', spoiler: existing.spoiler === true }); if (!entry.source) { await i.reply({ content: 'A media URL or variable is required.', flags: 64 }); return true; } const gallery = [...panelMedia.gallery]; let selectedMediaIndex; if (editingIndex == null) { if (gallery.length >= panel.mediaModel.MAX_GALLERY_ITEMS) { await i.reply({ content: 'Maximum gallery item limit reached.', flags: 64 }); return true; } gallery.push(entry); selectedMediaIndex = gallery.length - 1; } else { gallery[editingIndex] = entry; selectedMediaIndex = editingIndex; } saveMediaState(i, state, { ...panelMedia, gallery }, { selectedMediaIndex }); return replyMediaPanel(i); }
  if (i.isModalSubmit?.() && (customId === 'embed:media-file-save-new' || customId.startsWith('embed:media-file-save:'))) { const panelMedia = panel.getPanelMedia(state); const editingIndex = customId === 'embed:media-file-save-new' ? null : Number(customId.split(':').pop()); const existing = Number.isInteger(editingIndex) ? (panelMedia.files[editingIndex] || {}) : {}; const entry = panel.mediaModel.normalizeFile({ source: i.fields.getTextInputValue('source'), name: i.fields.getTextInputValue('name'), description: i.fields.getTextInputValue('description'), spoiler: existing.spoiler === true }); if (!entry.source) { await i.reply({ content: 'A file URL or variable is required.', flags: 64 }); return true; } const files = [...panelMedia.files]; let selectedFileIndex; if (editingIndex == null) { if (files.length >= panel.mediaModel.MAX_FILES) { await i.reply({ content: 'Maximum file limit reached.', flags: 64 }); return true; } files.push(entry); selectedFileIndex = files.length - 1; } else { files[editingIndex] = entry; selectedFileIndex = editingIndex; } saveMediaState(i, state, { ...panelMedia, files }, { selectedFileIndex }); return replyMediaPanel(i); }

  if (customId === 'embed:test-send') { try { const payload = await buildPayload(state, i, true); payload.allowedMentions = panel.allowedMentions(state, i); await i.reply(payload); } catch (error) { console.error('[Embed] test payload failed:', error); await i.reply({ content: `❌ Embed test failed: ${error?.message || error}`, flags: 64 }); } return true; }
  if (customId === 'embed:update-existing') {
    const deployment = getEmbedDeployment(i.guild.id, getDeploymentKeyFromState(state));
    if (!deployment) return handleLegacyInteraction(i);
    const channel = i.guild.channels.cache.get(deployment.channelId) || await i.guild.channels.fetch(deployment.channelId).catch(() => null);
    if (!isTextBasedChannel(channel)) { await i.reply({ content: '⚠️ The original embed channel no longer exists or is not text-based.', flags: 64 }); return true; }
    const access = await validateChannelAccess(i.guild, channel.id, [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks], { scope: 'embed.update' });
    if (!access.ok) { await i.reply({ content: panel.trim(access.message, 1800), flags: 64 }); return true; }
    const message = await channel.messages.fetch(deployment.messageId).catch(() => null);
    if (!message || !message.flags?.has?.(MessageFlags.IsComponentsV2)) return handleLegacyInteraction(i);
    try { const payload = await buildPayload(state, i, false); payload.allowedMentions = panel.allowedMentions(state, i); await message.edit(payload); saveEmbedDeployment(i.guild.id, getDeploymentKeyFromState(state), { ...deployment, lastUpdatedBy: i.user.id }); await i.reply({ content: '✅ Existing embed updated.', flags: 64 }); }
    catch (error) { await i.reply({ content: panel.embedOperationError(error, channel.id, 'update'), flags: 64 }); }
    return true;
  }
  if (customId === 'embed:use') {
    const channel = i.guild.channels.cache.get(state.channelId) || await i.guild.channels.fetch(state.channelId).catch(() => null);
    if (!isTextBasedChannel(channel)) { await i.reply({ content: 'Invalid channel.', flags: 64 }); return true; }
    const access = await validateChannelAccess(i.guild, channel.id, [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks], { scope: 'embed.deploy' });
    if (!access.ok) { await i.reply({ content: panel.trim(access.message, 1800), flags: 64 }); return true; }
    try { const payload = await buildPayload(state, i, false); payload.allowedMentions = panel.allowedMentions(state, i); const sent = await channel.send(payload); const presetName = `auto-${state.template || 'custom'}`; guildManager.saveEmbedPreset(i.guild.id, presetName, panel.presetData(state), i.guild); saveEmbedDeployment(i.guild.id, getDeploymentKeyFromState({ ...state, selectedPreset: presetName }), { channelId: channel.id, messageId: sent.id, template: state.template, preset: presetName, createdBy: i.user.id, lastUpdatedBy: i.user.id }); const ok = setGuildPresetDefault(i.guild.id, state.template, presetName, i.guild); panel.clearUnsaved(i, { ...state, selectedPreset: presetName }); await i.reply({ content: ok ? `✅ Embed posted to <#${state.channelId}> and saved as active` : '⚠️ Preset saved, but default assignment failed.', flags: 64 }); }
    catch (error) { await i.reply({ content: panel.embedOperationError(error, channel.id, 'send'), flags: 64 }); }
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
    if (customId === 'embed:panel-select') { const current = panel.getSession(i); panel.saveSession(i, { ...current, selectedPanelIndex: Number(i.values[0]), selectedFieldIndex: null }); await legacyReplyOrUpdate(i, panel.buildEditorPanel(i, name)); return true; }
    if (customId === 'embed:field-layout') { panel.markUnsaved(i, { ...state, fieldLayout: i.values[0] }); await legacyReplyOrUpdate(i, panel.buildFieldsPanel(i, name)); return true; }
    if (customId === 'embed:field-select') { panel.saveSession(i, { ...state, selectedFieldIndex: Number(i.values[0]) }); await legacyReplyOrUpdate(i, panel.buildFieldsPanel(i, name)); return true; }
    if (customId === 'embed:button-select') { panel.saveSession(i, { ...state, selectedButtonIndex: Number(i.values[0]) }); await legacyReplyOrUpdate(i, panel.buildButtonsPanel(i, name)); return true; }
    if (customId === 'embed:preset-select') {
      const presetName = i.values[0]; const presets = typeof guildManager.getEmbedPresets === 'function' ? guildManager.getEmbedPresets(i.guild.id) || {} : {}; const preset = presets[presetName];
      if (!preset) { await i.reply({ content: 'Preset not found.', flags: 64 }); return true; }
      panel.applyPreset(i, presetName, preset); await legacyReplyOrUpdate(i, panel.buildEditorPanel(i, name)); return true;
    }
  }

  if (i.isChannelSelectMenu?.() && customId === 'embed:channel') { panel.markUnsaved(i, { ...state, channelId: i.values[0] }); await legacyReplyOrUpdate(i, panel.buildEditorPanel(i, name)); return true; }

  if (i.isButton?.()) {
    if (customId === 'embed:editor' || customId === 'embed:back') { await i.update(panel.buildEditorPanel(i, name)); return true; }
    if (customId === 'embed:builder') { await i.update(panel.buildBuilderPanel(i, name)); return true; }
    if (customId === 'embed:presets') { await i.update(panel.buildPresetsPanel(i, name)); return true; }
    if (customId === 'embed:panels') { await i.update(panel.buildPanelsPanel(i, name)); return true; }
    if (customId === 'embed:helpers') { await i.update(panel.buildHelpersPanel(name)); return true; }
    if (customId === 'embed:edit-content') { await i.showModal(panel.contentModal(state)); return true; }
    if (customId === 'embed:toggle-ping') { panel.markUnsaved(i, { ...state, allowUserPing: !state.allowUserPing }); await i.update(panel.buildBuilderPanel(i, name)); return true; }
    if (customId === 'embed:toggle-timestamp') { panel.markUnsaved(i, { ...state, showTimestamp: !state.showTimestamp }); await i.update(panel.buildBuilderPanel(i, name)); return true; }
    if (customId === 'embed:reset') { panel.resetSession(i); await i.update(panel.buildEditorPanel(i, name)); return true; }
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
    if (customId === 'embed:preset-save') { await i.showModal(panel.presetModal(state)); return true; }
    if (customId === 'embed:preset-delete') {
      const presetName = state.selectedPreset; if (!presetName) { await i.reply({ content: 'Select a preset first.', flags: 64 }); return true; }
      const presets = typeof guildManager.getEmbedPresets === 'function' ? guildManager.getEmbedPresets(i.guild.id) || {} : {}; delete presets[presetName]; if (typeof guildManager.replaceGuildSection === 'function') guildManager.replaceGuildSection(i.guild.id, 'embedPresets', presets); panel.clearUnsaved(i, { ...state, selectedPreset: null }); await i.update(panel.buildPresetsPanel(i, name)); return true;
    }
    if (customId === 'embed:update-existing') {
      const deployment = getEmbedDeployment(i.guild.id, getDeploymentKeyFromState(state));
      if (!deployment) { await i.reply({ content: '⚠️ No deployed embed found. Use the embed first.', flags: 64 }); return true; }
      const channel = i.guild.channels.cache.get(deployment.channelId) || await i.guild.channels.fetch(deployment.channelId).catch(() => null);
      if (!isTextBasedChannel(channel)) { await i.reply({ content: '⚠️ The original embed channel no longer exists or is not text-based.', flags: 64 }); return true; }
      const access = await validateChannelAccess(i.guild, channel.id, [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks], { scope: 'embed.update' });
      if (!access.ok) { await i.reply({ content: panel.trim(access.message, 1800), flags: 64 }); return true; }
      try { const rendered = await prepareEmbedMedia(panel.buildPreviewEmbeds(state, i)); const message = await channel.messages.fetch(deployment.messageId); await message.edit({ content: state.allowUserPing ? `<@${i.user.id}>` : '', embeds: rendered.embeds, files: rendered.files, components: panel.buttonRows(state), allowedMentions: panel.allowedMentions(state, i) }); await i.reply({ content: '✅ Existing embed updated.', flags: 64 }); }
      catch (error) { console.error('Failed to update legacy embed:', error); const detail = error?.code ? panel.embedOperationError(error, channel.id, 'update') : `❌ The embed could not be built: ${panel.discordErrorDetail(error)}`; await i.reply({ content: detail, flags: 64 }); }
      return true;
    }
  }

  if (i.isModalSubmit?.()) {
    if (customId === 'embed:preset-save-modal') { const presetName = i.fields.getTextInputValue('name').trim(); if (!presetName) { await i.reply({ content: 'Name required.', flags: 64 }); return true; } guildManager.saveEmbedPreset(i.guild.id, presetName, panel.presetData(state), i.guild); panel.clearUnsaved(i, { ...state, selectedPreset: presetName }); await i.reply({ ...panel.buildPresetsPanel(i, name), flags: 64 }); return true; }
    if (customId === 'embed:save-color') { const hex = i.fields.getTextInputValue('hex'); if (!panel.validHex(hex)) { await i.reply({ content: 'Invalid HEX.', flags: 64 }); return true; } panel.markUnsaved(i, panel.saveSelected(state, { color: panel.normHex(hex) })); await i.reply({ ...panel.buildEditorPanel(i, name), flags: 64 }); return true; }
    if (customId.startsWith('embed:save-content:')) { panel.markUnsaved(i, panel.saveSelected(state, { title: i.fields.getTextInputValue('title'), description: i.fields.getTextInputValue('description'), authorName: i.fields.getTextInputValue('authorName'), footer: i.fields.getTextInputValue('footer') })); await i.reply({ ...panel.buildBuilderPanel(i, name), flags: 64 }); return true; }
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

module.exports = { handleInteraction, handleButtonAction };
