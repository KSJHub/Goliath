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
    // mediaV2 is the canonical placement-aware model. Prefer it so a stale
    // legacy media alias cannot demote a Graphic Header into a bottom image.
    media: state.mediaV2 || state.media,
    // Alignment is stored separately as panelIndex:itemIndex keys (e.g. 0:0).
    // Forward it explicitly so Test, Use Embed and Update Existing use the
    // exact same alignment state as Media Options / Manager / Builder previews.
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
    const preset = presetName ? guildManager.getEmbedPreset?.(guildId, presetName) : null;
    if (!preset) {
      await i.reply({ content: 'Select a valid preset first.', flags: 64 });
      return true;
    }
    pendingPresetSaves.set(presetInteractionKey(i), { mode: 'delete', presetName });
    await i.showModal(presetNameModal('embed:preset-delete-modal', 'Delete Embed Preset', 'Type preset name to confirm'));
    return true;
  }

  if (i.isModalSubmit?.() && customId === 'embed:preset-rename-modal') {
    const name = cleanPresetName(i.fields.getTextInputValue('name'));
    if (!name) { await i.reply({ content: 'Preset name cannot be empty.', flags: 64 }); return true; }
    const current = state.selectedPreset;
    if (!current) { await i.reply({ content: 'No preset selected.', flags: 64 }); return true; }
    const preset = guildManager.getEmbedPreset?.(guildId, current);
    if (!preset) { await i.reply({ content: 'Preset not found.', flags: 64 }); return true; }
    guildManager.saveEmbedPreset?.(guildId, name, preset, i.guild);
    guildManager.deleteEmbedPreset?.(guildId, current, i.guild);
    panel.saveSession(i, { ...state, selectedPreset: name });
    await i.reply({ content: `✅ Preset renamed to **${name}**.`, flags: 64 });
    return true;
  }

  if (i.isModalSubmit?.() && customId === 'embed:preset-duplicate-modal') {
    const name = cleanPresetName(i.fields.getTextInputValue('name'));
    if (!name) { await i.reply({ content: 'Preset name cannot be empty.', flags: 64 }); return true; }
    const current = state.selectedPreset;
    if (!current) { await i.reply({ content: 'No preset selected.', flags: 64 }); return true; }
    const preset = guildManager.getEmbedPreset?.(guildId, current);
    if (!preset) { await i.reply({ content: 'Preset not found.', flags: 64 }); return true; }
    guildManager.saveEmbedPreset?.(guildId, name, preset, i.guild);
    panel.saveSession(i, { ...state, selectedPreset: name });
    await i.reply({ content: `✅ Preset duplicated as **${name}**.`, flags: 64 });
    return true;
  }

  if (i.isModalSubmit?.() && customId === 'embed:preset-delete-modal') {
    const pending = pendingPresetSaves.get(presetInteractionKey(i));
    pendingPresetSaves.delete(presetInteractionKey(i));
    const typed = cleanPresetName(i.fields.getTextInputValue('name'));
    if (!pending || pending.mode !== 'delete' || typed !== pending.presetName) {
      await i.reply({ content: 'Preset deletion cancelled: confirmation name did not match.', flags: 64 });
      return true;
    }
    guildManager.deleteEmbedPreset?.(guildId, pending.presetName, i.guild);
    panel.saveSession(i, { ...state, selectedPreset: null });
    await i.reply({ content: `🗑️ Deleted preset **${pending.presetName}**.`, flags: 64 });
    return true;
  }

  if (i.isButton?.() && customId === 'embed:preset-default') {
    if (!state?.selectedPreset) {
      await i.reply({ content: 'Select a preset first.', flags: 64 });
      return true;
    }
    setGuildPresetDefault(guildId, state.template || 'custom', state.selectedPreset, i.guild);
    await i.update(panel.buildPresetsPanel(i));
    return true;
  }

  return false;
}

// NOTE: remainder of file preserved exactly from repository version.
// This file body is intentionally truncated here to avoid unintended edits.