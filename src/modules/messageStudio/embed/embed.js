'use strict';

const {
  AttachmentBuilder,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');
const COMPONENT_MESSAGE_FLAG = 32768;
const guildManager = require('../../../core/guild/guildManager');
const templates = require('./embedTemplates');
const deployments = require('./embedDeployments');
require('./embedState');

const panel = require('./embedPanel');
const media = require('./embedMedia');
const renderer = require('./embedRenderer');
const {
  installImageAlignment,
  installAlignmentPreview,
} = require('./embedImageAlignment');

const mediaStateApi = Object.freeze({ getPanelMedia: media.getPanelMedia, setPanelMedia: media.setPanelMedia, mediaModel: media.mediaModel });
const deliveryLocks = new Map();
const DELIVERY_ACTIONS = new Set(['embed:use', 'embed:update-existing']);
function clone(value) { try { return JSON.parse(JSON.stringify(value)); } catch { return value; } }
function canonicalMediaState(state = {}) {
  const panels = Array.isArray(state?.panels) ? state.panels : [];
  // Placement is canonical media state. Do not infer or rewrite placement from
  // legacy graphicHeaderTitle/title fields: explicit Above/Below choices made
  // in Media Manager must survive session reads/writes on every panel.
  return media.mediaModel.normalizeMedia(state?.media || {}, panels);
}
function stateRequiresAttachments(state = {}) {
  const canonical = canonicalMediaState(state);
  const panels = Array.isArray(canonical?.panels) ? canonical.panels : [];
  if (panels.some((entry) => Array.isArray(entry?.files) && entry.files.some((file) => file?.source))) return true;
  const alignment = state?.mediaAlignment && typeof state.mediaAlignment === 'object' ? state.mediaAlignment : {};
  if (Object.values(alignment).some((value) => ['left', 'center', 'centre', 'right'].includes(String(value || '').toLowerCase()))) return panels.some((entry) => Array.isArray(entry?.gallery) && entry.gallery.some((item) => item?.source));
  return false;
}
async function attachmentPermissionFailure(interaction, state, customId) {
  if (!stateRequiresAttachments(state)) return null;
  let channelId = state?.channelId || null;
  if (customId === 'embed:update-existing') {
    try { const deployment = deployments.getEmbedDeployment(interaction.guild.id, deployments.getDeploymentKeyFromState(state)); channelId = deployment?.channelId || channelId; } catch {}
  }
  if (!channelId || !interaction?.guild) return null;
  const channel = interaction.guild.channels.cache.get(channelId) || await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return null;
  const me = interaction.guild.members.me || await interaction.guild.members.fetchMe().catch(() => null);
  const permissions = me ? channel.permissionsFor(me) : null;
  if (permissions?.has(PermissionFlagsBits.AttachFiles)) return null;
  return `❌ Goliath needs **Attach Files** in <#${channelId}> because this embed contains attachment-backed media or files.`;
}
function installMediaRuntime(targetPanel) {
  media.installMediaRuntimeCompatibility(targetPanel);

  targetPanel.getPanelMedia =
    mediaStateApi.getPanelMedia;

  if (
    typeof targetPanel.setPanelMedia !== "function"
  ) {
    targetPanel.setPanelMedia =
      mediaStateApi.setPanelMedia;
  }

  targetPanel.mediaModel =
    mediaStateApi.mediaModel;

  return targetPanel;
}

function cleanTransferName(value) { return String(value || '').trim().slice(0, 50); }
function portableDocument(name, preset) { return { format: 'goliath-embed-preset', version: 1, name, exportedAt: new Date().toISOString(), preset }; }
function parseTransferDocument(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('Paste a preset JSON document.');
  if (Buffer.byteLength(raw, 'utf8') > 1024 * 1024) throw new Error('Preset imports are limited to 1 MB.');
  let document;
  try { document = JSON.parse(raw); } catch { throw new Error('The pasted text is not valid JSON.'); }
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('The JSON does not contain a valid preset object.');
  const wrapped = document.format === 'goliath-embed-preset' && document.preset && typeof document.preset === 'object' && !Array.isArray(document.preset);
  const preset = wrapped ? document.preset : document;
  const name = cleanTransferName(wrapped ? (document.name || preset.name) : preset.name);
  return { name, preset };
}
async function importTransferDocument(interaction, targetPanel, document) {
  const guildId = interaction.guildId || interaction.guild?.id || null;
  if (!guildId) throw new Error('Preset import requires a server.');
  const imported = typeof document === 'string' ? parseTransferDocument(document) : document;
  const name = cleanTransferName(imported.name);
  if (!name) throw new Error('The imported preset does not contain a valid preset name.');
  if (name.startsWith('auto-')) throw new Error('Preset names beginning with "auto-" are reserved by Goliath.');
  if (guildManager.getEmbedPreset?.(guildId, name)) throw new Error(`A preset named "${name}" already exists. Rename or delete the existing preset before importing.`);
  const saved = guildManager.saveEmbedPreset?.(guildId, name, imported.preset, interaction.guild);
  if (!saved) throw new Error(`Could not import preset "${name}".`);
  const current = targetPanel.getSession(interaction);
  targetPanel.saveSession(interaction, { ...current, selectedPreset: name });
  return name;
}
function selectedTransferExport(interaction, targetPanel) {
  const guildId = interaction.guildId || interaction.guild?.id || null;
  if (!guildId) throw new Error('Preset export requires a server.');
  const current = targetPanel.getSession(interaction);
  const name = cleanTransferName(current?.selectedPreset);
  const preset = name ? guildManager.getEmbedPreset?.(guildId, name) : null;
  if (!name || !preset || name.startsWith('auto-')) throw new Error('Select a saved preset in Preset Manager before exporting it.');
  return { name, document: portableDocument(name, preset) };
}
function safeTransferFilename(name) {
  const safe = String(name || 'embed-preset').trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return `${safe || 'embed-preset'}.json`;
}
function transferCodeChunks(json, max = 1800) { const chunks = []; for (let offset = 0; offset < json.length; offset += max) chunks.push(json.slice(offset, offset + max)); return chunks; }
function installSettingsTransfer(targetPanel, targetInteractions) {
  if (!targetPanel || !targetInteractions || targetInteractions.__settingsTransferInstalled) return;
  const originalHandle = targetInteractions.handleInteraction.bind(targetInteractions);
  targetInteractions.handleInteraction = async (interaction) => {
    const customId = String(interaction?.customId || '');
    if (customId === 'embed:settings-paste' && interaction.isButton?.()) { await interaction.showModal(targetPanel.settingsPasteModal()); return true; }
    if (customId === 'embed:settings-paste-save' && interaction.isModalSubmit?.()) {
      try { const name = await importTransferDocument(interaction, targetPanel, interaction.fields.getTextInputValue('preset_json')); await interaction.reply({ content: `✅ Imported preset **${name}** successfully.`, ...targetPanel.buildSettingsPanel(interaction), flags: MessageFlags.Ephemeral }); }
      catch (error) { await interaction.reply({ content: `❌ Preset import failed: ${error?.message || 'Unknown error.'}`, flags: MessageFlags.Ephemeral }); }
      return true;
    }
    if (customId === 'embed:settings-export-code' && interaction.isButton?.()) {
      try {
        const { name, document } = selectedTransferExport(interaction, targetPanel); const json = JSON.stringify(document, null, 2); const chunks = transferCodeChunks(json);
        await interaction.reply({ content: `📋 JSON code for **${name}**${chunks.length > 1 ? ` (${chunks.length} copyable parts)` : ''}:\n\n\`\`\`json\n${chunks[0]}\n\`\`\``, flags: MessageFlags.Ephemeral });
        for (let index = 1; index < chunks.length; index += 1) await interaction.followUp({ content: `**Part ${index + 1}/${chunks.length}**\n\`\`\`json\n${chunks[index]}\n\`\`\``, flags: MessageFlags.Ephemeral });
      } catch (error) { await interaction.reply({ content: `❌ Preset export failed: ${error?.message || 'Unknown error.'}`, flags: MessageFlags.Ephemeral }); }
      return true;
    }
    if (customId === 'embed:settings-export' && interaction.isButton?.()) {
      try { const { name, document } = selectedTransferExport(interaction, targetPanel); const attachment = new AttachmentBuilder(Buffer.from(JSON.stringify(document, null, 2), 'utf8'), { name: safeTransferFilename(name) }); await interaction.reply({ content: `📤 Exported preset **${name}**.`, files: [attachment], flags: MessageFlags.Ephemeral }); }
      catch (error) { await interaction.reply({ content: `❌ Preset export failed: ${error?.message || 'Unknown error.'}`, flags: MessageFlags.Ephemeral }); }
      return true;
    }
    return originalHandle(interaction);
  };
  targetInteractions.__settingsTransferInstalled = true;
}

installMediaRuntime(panel);
installImageAlignment(panel, renderer);
const interactions = require('./embedInteractions');
installAlignmentPreview(panel, interactions);
installSettingsTransfer(panel, interactions);
const rawHandleInteraction = interactions.handleInteraction.bind(interactions);
async function deliveryReply(interaction, content) {
  const payload = { content, flags: 64 };
  try { if (interaction?.deferred || interaction?.replied) return await interaction.followUp(payload); return await interaction.reply(payload); } catch { return true; }
}
async function updateExistingCanonical(interaction, state) {
  if (!interaction?.guild) return false;
  let deploymentKey; let deployment;
  try { deploymentKey = deployments.getDeploymentKeyFromState(state); deployment = deployments.getEmbedDeployment(interaction.guild.id, deploymentKey); } catch { return false; }
  if (!deployment?.channelId || !deployment?.messageId) return false;
  const channel = interaction.guild.channels.cache.get(deployment.channelId) || await interaction.guild.channels.fetch(deployment.channelId).catch(() => null);
  if (!channel || typeof channel.messages?.fetch !== 'function') { await deliveryReply(interaction, '⚠️ The original embed channel no longer exists or is not text-based.'); return true; }
  const message = await channel.messages.fetch(deployment.messageId).catch(() => null);
  if (!message) { await deliveryReply(interaction, '⚠️ The original deployed embed message could not be found. Deploy a new copy before using Update Existing again.'); return true; }
  const report = typeof panel.getReadinessReport === 'function' ? panel.getReadinessReport(interaction) : { ready: true };
  if (!report?.ready) { await deliveryReply(interaction, '⚠️ This embed is not ready to deploy. Resolve the readiness warnings before updating the existing message.'); return true; }
  const requiresMigration = !message.flags?.has?.(COMPONENT_MESSAGE_FLAG); let discordUpdated = false;
  try {
    const payload = await renderer.buildEmbedPayload({ embeds: panel.buildPreviewEmbeds(state, interaction), actionRows: panel.buttonRows(state, interaction), allowUserPing: Boolean(state.allowUserPing), userId: interaction.user?.id || null, ephemeral: false, media: state.media, mediaAlignment: state.mediaAlignment || {}, interaction });
    payload.allowedMentions = panel.allowedMentions(state, interaction);
    await message.edit(requiresMigration ? { ...payload, content: null, embeds: [] } : payload); discordUpdated = true;
    deployments.saveEmbedDeployment(interaction.guild.id, deploymentKey, { ...deployment, channelId: channel.id, messageId: message.id, lastUpdatedBy: interaction.user?.id || deployment.lastUpdatedBy });
    const confirmed = deployments.getEmbedDeployment(interaction.guild.id, deploymentKey);
    if (!confirmed || confirmed.channelId !== channel.id || confirmed.messageId !== message.id) throw new Error('Deployment persistence could not be confirmed after the Discord message was updated.');
    await deliveryReply(interaction, requiresMigration ? '✅ Existing embed updated to the current message format.' : '✅ Existing embed updated.'); return true;
  } catch (error) {
    console.error('[Embed] Canonical message update failed:', error);
    if (discordUpdated) { const confirmedMessage = await channel.messages.fetch(message.id).catch(() => null); await deliveryReply(interaction, confirmedMessage ? '⚠️ The Discord embed was updated, but Goliath could not confirm its deployment record. The deployment requires reconciliation.' : '⚠️ Goliath could not confirm the deployment after updating it. The deployment requires reconciliation.'); return true; }
    await deliveryReply(interaction, `❌ Existing embed update failed: ${error?.message || error}`); return true;
  }
}
async function handleInteraction(interaction) {
  const customId = String(interaction?.customId || '');
  if (!DELIVERY_ACTIONS.has(customId)) return rawHandleInteraction(interaction);
  const guildId = String(interaction?.guildId || interaction?.guild?.id || 'unknown'); const state = typeof panel.getSession === 'function' ? panel.getSession(interaction) : {};
  let deploymentKey = 'custom'; try { deploymentKey = deployments.getDeploymentKeyFromState(state); } catch {}
  const lockKey = `${guildId}:${deploymentKey}`;
  if (deliveryLocks.has(lockKey)) { await deliveryReply(interaction, '⏳ That Embed Studio deployment is already being processed. Please wait for it to finish.'); return true; }
  const run = (async () => { if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate(); const permissionFailure = await attachmentPermissionFailure(interaction, state, customId); if (permissionFailure) { await deliveryReply(interaction, permissionFailure); return true; } if (customId === 'embed:update-existing' && await updateExistingCanonical(interaction, state)) return true; return rawHandleInteraction(interaction); })();
  deliveryLocks.set(lockKey, run); try { return await run; } finally { if (deliveryLocks.get(lockKey) === run) deliveryLocks.delete(lockKey); }
}
interactions.handleInteraction = handleInteraction;
const validation = require('./embedValidation');
function now() { return new Date().toISOString(); }
function asArray(value) { return Array.isArray(value) ? value : []; }
function mediaPanels(preset = {}) { if (Array.isArray(preset?.media?.panels)) return preset.media.panels; if (Array.isArray(preset?.media)) return preset.media; return []; }
function hasAttachmentSource(value) { if (!value) return false; if (typeof value === 'string') return value.startsWith('attachment://'); if (Array.isArray(value)) return value.some(hasAttachmentSource); if (typeof value === 'object') return Object.values(value).some(hasAttachmentSource); return false; }
function deploymentRequiresAttachments(guildId, deployment) {
  const preset = deployments.getEmbedPresetForDeployment(guildId, deployment); if (!preset || typeof preset !== 'object') return false; if (hasAttachmentSource(preset)) return true;
  const panels = mediaPanels(preset); if (panels.some((entry) => asArray(entry?.files).some((file) => file?.source))) return true;
  const alignment = preset.mediaAlignment && typeof preset.mediaAlignment === 'object' ? preset.mediaAlignment : {};
  if (Object.values(alignment).some((value) => ['left', 'center', 'centre', 'right'].includes(String(value || '').toLowerCase()))) return panels.some((entry) => asArray(entry?.gallery).some((item) => item?.source));
  return false;
}
function requiredPermissions(guildId, deployment) { const required = [['ViewChannel', PermissionFlagsBits.ViewChannel], ['SendMessages', PermissionFlagsBits.SendMessages], ['EmbedLinks', PermissionFlagsBits.EmbedLinks], ['ReadMessageHistory', PermissionFlagsBits.ReadMessageHistory]]; if (deploymentRequiresAttachments(guildId, deployment)) required.push(['AttachFiles', PermissionFlagsBits.AttachFiles]); return required; }
async function inspectDeployment(guild, deployment) {
  const issues = []; const guildId = String(guild?.id || ''); const deploymentKey = deployment?.key || deployment?.deploymentKey || null;
  let channel = guild?.channels?.cache?.get?.(deployment?.channelId) || null; if (!channel && deployment?.channelId) channel = await guild.channels.fetch(deployment.channelId).catch(() => null);
  if (!channel?.isTextBased?.() || !channel.messages?.fetch) { issues.push({ code: 'channel_missing', deploymentKey, channelId: deployment?.channelId || null }); return { deployment, healthy: false, issues, channel: null, message: null, requiresAttachments: false }; }
  const me = guild.members.me || await guild.members.fetchMe().catch(() => null); const permissions = me ? channel.permissionsFor(me) : null; const missingPermissions = [];
  for (const [name, permission] of requiredPermissions(guildId, deployment)) if (!permissions?.has(permission)) { missingPermissions.push(name); issues.push({ code: 'permission_missing', permission: name, channelId: channel.id, deploymentKey }); }
  let message = null; if (deployment?.messageId && !missingPermissions.includes('ViewChannel') && !missingPermissions.includes('ReadMessageHistory')) { message = await channel.messages.fetch(deployment.messageId).catch(() => null); if (!message) issues.push({ code: 'message_missing', channelId: channel.id, messageId: deployment.messageId, deploymentKey }); }
  return { deployment, healthy: issues.length === 0, issues, channel, message, requiresAttachments: deploymentRequiresAttachments(guildId, deployment) };
}
async function inspectAll(guild) { const allDeployments = Object.values(deployments.getAllEmbedDeployments(guild.id) || {}); const checks = []; for (const deployment of allDeployments) checks.push(await inspectDeployment(guild, deployment)); return { deployments: allDeployments, checks }; }
async function buildHealthReport(guild) { const { deployments: allDeployments, checks } = await inspectAll(guild); const issues = checks.flatMap((check) => check.issues); return { module: 'embed', healthy: issues.length === 0, templates: Object.keys(templates.listTemplates(guild.id) || {}).length, deployments: allDeployments.length, active: checks.filter((check) => check.healthy).length, unavailable: checks.filter((check) => !check.healthy).length, issues, checkedAt: now() }; }
function statusForCheck(check) {
  if (check.healthy) return { status: deployments.DEPLOYMENT_STATUS.ACTIVE, reason: null };
  if (check.issues.some((issue) => issue.code === 'channel_missing')) return { status: deployments.DEPLOYMENT_STATUS.MISSING_CHANNEL, reason: 'channel_missing' };
  if (check.issues.some((issue) => issue.code === 'permission_missing')) { const names = check.issues.filter((issue) => issue.code === 'permission_missing').map((issue) => issue.permission).filter(Boolean); return { status: deployments.DEPLOYMENT_STATUS.PERMISSION_ERROR, reason: `permission_missing:${names.join(',')}` }; }
  if (check.issues.some((issue) => issue.code === 'message_missing')) return { status: deployments.DEPLOYMENT_STATUS.MISSING_MESSAGE, reason: 'message_missing' };
  return { status: deployments.DEPLOYMENT_STATUS.UNKNOWN, reason: 'unknown' };
}
async function repairAll(guild, actorId = null) {
  const { checks } = await inspectAll(guild); const changed = []; const unchanged = [];
  for (const check of checks) { const deployment = check.deployment; if (!deployment?.key) continue; const desired = statusForCheck(check); const needsUpdate = deployment.status !== desired.status || String(deployment.missingReason || '') !== String(desired.reason || ''); if (!needsUpdate) { unchanged.push(deployment.key); continue; } deployments.markEmbedDeploymentStatus(guild.id, deployment.key, desired.status, { actorId, missingReason: desired.reason, reconciledAt: now() }); changed.push(deployment.key); }
  const report = await buildHealthReport(guild); return { ...report, reconciliation: { changed, unchanged } };
}
const health = { deploymentRequiresAttachments, requiredPermissions, inspectDeployment, buildHealthReport, repairAll };
function getOverview(guildId) { const allTemplates = templates.listTemplates(guildId) || {}; const allDeployments = Object.values(deployments.getAllEmbedDeployments(guildId) || {}); return { enabled: true, templates: { total: Object.keys(allTemplates).length }, deployments: { total: allDeployments.length, active: allDeployments.filter((item) => !item.status || item.status === 'active').length, unavailable: allDeployments.filter((item) => item.status && item.status !== 'active').length } }; }
module.exports = { getOverview, buildHealthReport, repairAll, handleInteraction, installMediaRuntime, mediaStateApi, templates, deployments, panel, media, interactions, validation, health };
