'use strict';

const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const templates = require('./embedTemplates');
const deployments = require('./embedDeployments');
require('./embedState');

const panel = require('./embedPanel');
const media = require('./embedMedia');
const renderer = require('./embedRenderer');
const { installMediaManagerBase } = require('./embedMediaManagerBase');
const { installGraphicHeaders } = require('./embedGraphicHeaders');
const { installImageAlignment, installInteraction: installImageAlignmentInteraction, installAlignmentPreview } = require('./embedImageAlignment');
const { installSettingsTransfer } = require('./embedSettingsTransfer');

const mediaStateApi = Object.freeze({ getPanelMedia: media.getPanelMedia, setPanelMedia: media.setPanelMedia, mediaModel: media.mediaModel });
const deliveryLocks = new Map();
const DELIVERY_ACTIONS = new Set(['embed:use', 'embed:update-existing']);
function clone(value) { try { return JSON.parse(JSON.stringify(value)); } catch { return value; } }
function canonicalMediaState(state = {}) {
  const panels = Array.isArray(state?.panels) ? state.panels : [];
  let canonical = media.mediaModel.normalizeMedia(state?.media || {}, panels);
  canonical.panels = canonical.panels.map((entry, index) => {
    const panelData = panels[index] || {};
    if (!panelData?.graphicHeaderTitle || String(panelData?.title || '').trim()) return entry;
    if (!Array.isArray(entry?.gallery) || !entry.gallery.length) return entry;
    if (entry.gallery.some((item) => item?.placement === 'above')) return entry;
    return { ...entry, gallery: entry.gallery.map((item, itemIndex) => ({ ...item, placement: itemIndex === 0 ? 'above' : 'below' })) };
  });
  return canonical;
}
function stateRequiresAttachments(state = {}) {
  const canonical = canonicalMediaState(state);
  const panels = Array.isArray(canonical?.panels) ? canonical.panels : [];
  if (panels.some((entry) => Array.isArray(entry?.files) && entry.files.some((file) => file?.source))) return true;
  const alignment = state?.mediaAlignment && typeof state.mediaAlignment === 'object' ? state.mediaAlignment : {};
  if (Object.values(alignment).some((value) => ['left', 'center', 'centre', 'right'].includes(String(value || '').toLowerCase()))) {
    return panels.some((entry) => Array.isArray(entry?.gallery) && entry.gallery.some((item) => item?.source));
  }
  return false;
}
async function attachmentPermissionFailure(interaction, state, customId) {
  if (!stateRequiresAttachments(state)) return null;
  let channelId = state?.channelId || null;
  if (customId === 'embed:update-existing') {
    try {
      const deployment = deployments.getEmbedDeployment(interaction.guild.id, deployments.getDeploymentKeyFromState(state));
      channelId = deployment?.channelId || channelId;
    } catch {}
  }
  if (!channelId || !interaction?.guild) return null;
  const channel = interaction.guild.channels.cache.get(channelId) || await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return null;
  const me = interaction.guild.members.me || await interaction.guild.members.fetchMe().catch(() => null);
  const permissions = me ? channel.permissionsFor(me) : null;
  if (permissions?.has(PermissionFlagsBits.AttachFiles)) return null;
  return `❌ Goliath needs **Attach Files** in <#${channelId}> because this embed contains attachment-backed media or files.`;
}
function installCanonicalMediaSessions(targetPanel) {
  if (!targetPanel || targetPanel.__canonicalMediaSessionsInstalled) return targetPanel;
  if (typeof targetPanel.getSession === 'function') {
    const originalGetSession = targetPanel.getSession.bind(targetPanel);
    targetPanel.getSession = (interaction) => { const state = originalGetSession(interaction); const canonical = canonicalMediaState(state); return { ...state, media: clone(canonical) }; };
  }
  if (typeof targetPanel.saveSession === 'function') {
    const originalSaveSession = targetPanel.saveSession.bind(targetPanel);
    targetPanel.saveSession = (interaction, state) => { const canonical = canonicalMediaState(state); return originalSaveSession(interaction, { ...state, media: clone(canonical) }); };
  }
  targetPanel.__canonicalMediaSessionsInstalled = true;
  return targetPanel;
}
function installMediaRuntime(targetPanel) {
  media.installStateCompatibility(targetPanel);
  media.installPersistentMediaCompatibility(targetPanel);
  media.installStorageNormalization(targetPanel);
  installCanonicalMediaSessions(targetPanel);
  media.installUploadModals(targetPanel);
  installMediaManagerBase(targetPanel, media);
  media.installMediaOptionsUi(targetPanel);
  media.installMediaManagerUi(targetPanel);
  media.installThumbnailUi(targetPanel);
  targetPanel.getPanelMedia = mediaStateApi.getPanelMedia;
  if (typeof targetPanel.setPanelMedia !== 'function') targetPanel.setPanelMedia = mediaStateApi.setPanelMedia;
  targetPanel.mediaModel = mediaStateApi.mediaModel;
  return targetPanel;
}
installMediaRuntime(panel);
installImageAlignment(panel, renderer);
const interactions = require('./embedInteractions');
installImageAlignmentInteraction(panel, interactions);
installAlignmentPreview(panel, interactions);
installGraphicHeaders(panel, media, interactions);
installSettingsTransfer(panel, interactions);
const rawHandleInteraction = interactions.handleInteraction.bind(interactions);
async function deliveryReply(interaction, content) {
  const payload = { content, flags: 64 };
  try {
    if (interaction?.deferred || interaction?.replied) return await interaction.followUp(payload);
    return await interaction.reply(payload);
  } catch { return true; }
}
async function updateExistingCanonical(interaction, state) {
  if (!interaction?.guild) return false;
  let deploymentKey;
  let deployment;
  try {
    deploymentKey = deployments.getDeploymentKeyFromState(state);
    deployment = deployments.getEmbedDeployment(interaction.guild.id, deploymentKey);
  } catch { return false; }
  if (!deployment?.channelId || !deployment?.messageId) return false;
  const channel = interaction.guild.channels.cache.get(deployment.channelId) || await interaction.guild.channels.fetch(deployment.channelId).catch(() => null);
  if (!channel || typeof channel.messages?.fetch !== 'function') {
    await deliveryReply(interaction, '⚠️ The original embed channel no longer exists or is not text-based.');
    return true;
  }
  const message = await channel.messages.fetch(deployment.messageId).catch(() => null);
  if (!message) {
    await deliveryReply(interaction, '⚠️ The original deployed embed message could not be found. Deploy a new copy before using Update Existing again.');
    return true;
  }
  const report = typeof panel.getReadinessReport === 'function' ? panel.getReadinessReport(interaction) : { ready: true };
  if (!report?.ready) {
    await deliveryReply(interaction, '⚠️ This embed is not ready to deploy. Resolve the readiness warnings before updating the existing message.');
    return true;
  }
  const requiresMigration = !message.flags?.has?.(MessageFlags.IsComponentsV2);
  let discordUpdated = false;
  try {
    const payload = await renderer.buildEmbedPayload({ embeds: panel.buildPreviewEmbeds(state, interaction), actionRows: panel.buttonRows(state, interaction), allowUserPing: Boolean(state.allowUserPing), userId: interaction.user?.id || null, ephemeral: false, media: state.media, mediaAlignment: state.mediaAlignment || {}, interaction });
    payload.allowedMentions = panel.allowedMentions(state, interaction);
    await message.edit(requiresMigration ? { ...payload, content: null, embeds: [] } : payload);
    discordUpdated = true;
    deployments.saveEmbedDeployment(interaction.guild.id, deploymentKey, { ...deployment, channelId: channel.id, messageId: message.id, lastUpdatedBy: interaction.user?.id || deployment.lastUpdatedBy });
    const confirmed = deployments.getEmbedDeployment(interaction.guild.id, deploymentKey);
    if (!confirmed || confirmed.channelId !== channel.id || confirmed.messageId !== message.id) throw new Error('Deployment persistence could not be confirmed after the Discord message was updated.');
    await deliveryReply(interaction, requiresMigration ? '✅ Existing embed updated to the current message format.' : '✅ Existing embed updated.');
    return true;
  } catch (error) {
    console.error('[Embed] Canonical message update failed:', error);
    if (discordUpdated) {
      const confirmedMessage = await channel.messages.fetch(message.id).catch(() => null);
      await deliveryReply(interaction, confirmedMessage ? '⚠️ The Discord embed was updated, but Goliath could not confirm its deployment record. The deployment requires reconciliation.' : '⚠️ Goliath could not confirm the deployment after updating it. The deployment requires reconciliation.');
      return true;
    }
    await deliveryReply(interaction, `❌ Existing embed update failed: ${error?.message || error}`);
    return true;
  }
}
async function handleInteraction(interaction) {
  const customId = String(interaction?.customId || '');
  if (!DELIVERY_ACTIONS.has(customId)) return rawHandleInteraction(interaction);
  const guildId = String(interaction?.guildId || interaction?.guild?.id || 'unknown');
  const state = typeof panel.getSession === 'function' ? panel.getSession(interaction) : {};
  let deploymentKey = 'custom';
  try { deploymentKey = deployments.getDeploymentKeyFromState(state); } catch {}
  const lockKey = `${guildId}:${deploymentKey}`;
  if (deliveryLocks.has(lockKey)) {
    await deliveryReply(interaction, '⏳ That Embed Studio deployment is already being processed. Please wait for it to finish.');
    return true;
  }
  const run = (async () => {
    const permissionFailure = await attachmentPermissionFailure(interaction, state, customId);
    if (permissionFailure) { await deliveryReply(interaction, permissionFailure); return true; }
    if (customId === 'embed:update-existing' && await updateExistingCanonical(interaction, state)) return true;
    return rawHandleInteraction(interaction);
  })();
  deliveryLocks.set(lockKey, run);
  try { return await run; }
  finally { if (deliveryLocks.get(lockKey) === run) deliveryLocks.delete(lockKey); }
}
interactions.handleInteraction = handleInteraction;
const validation = require('./embedValidation');

function now() { return new Date().toISOString(); }
function asArray(value) { return Array.isArray(value) ? value : []; }
function mediaPanels(preset = {}) { if (Array.isArray(preset?.media?.panels)) return preset.media.panels; if (Array.isArray(preset?.media)) return preset.media; return []; }
function hasAttachmentSource(value) { if (!value) return false; if (typeof value === 'string') return value.startsWith('attachment://'); if (Array.isArray(value)) return value.some(hasAttachmentSource); if (typeof value === 'object') return Object.values(value).some(hasAttachmentSource); return false; }
function deploymentRequiresAttachments(guildId, deployment) {
  const preset = deployments.getEmbedPresetForDeployment(guildId, deployment);
  if (!preset || typeof preset !== 'object') return false;
  if (hasAttachmentSource(preset)) return true;
  const panels = mediaPanels(preset);
  if (panels.some((entry) => asArray(entry?.files).some((file) => file?.source))) return true;
  const alignment = preset.mediaAlignment && typeof preset.mediaAlignment === 'object' ? preset.mediaAlignment : {};
  if (Object.values(alignment).some((value) => ['left', 'center', 'centre', 'right'].includes(String(value || '').toLowerCase()))) return panels.some((entry) => asArray(entry?.gallery).some((item) => item?.source));
  return false;
}
function requiredPermissions(guildId, deployment) {
  const required = [['ViewChannel', PermissionFlagsBits.ViewChannel], ['SendMessages', PermissionFlagsBits.SendMessages], ['EmbedLinks', PermissionFlagsBits.EmbedLinks], ['ReadMessageHistory', PermissionFlagsBits.ReadMessageHistory]];
  if (deploymentRequiresAttachments(guildId, deployment)) required.push(['AttachFiles', PermissionFlagsBits.AttachFiles]);
  return required;
}
async function inspectDeployment(guild, deployment) {
  const issues = [];
  const guildId = String(guild?.id || '');
  const deploymentKey = deployment?.key || deployment?.deploymentKey || null;
  let channel = guild?.channels?.cache?.get?.(deployment?.channelId) || null;
  if (!channel && deployment?.channelId) channel = await guild.channels.fetch(deployment.channelId).catch(() => null);
  if (!channel?.isTextBased?.() || !channel.messages?.fetch) { issues.push({ code: 'channel_missing', deploymentKey, channelId: deployment?.channelId || null }); return { deployment, healthy: false, issues, channel: null, message: null, requiresAttachments: false }; }
  const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
  const permissions = me ? channel.permissionsFor(me) : null;
  const missingPermissions = [];
  for (const [name, permission] of requiredPermissions(guildId, deployment)) if (!permissions?.has(permission)) { missingPermissions.push(name); issues.push({ code: 'permission_missing', permission: name, channelId: channel.id, deploymentKey }); }
  let message = null;
  if (deployment?.messageId && !missingPermissions.includes('ViewChannel') && !missingPermissions.includes('ReadMessageHistory')) { message = await channel.messages.fetch(deployment.messageId).catch(() => null); if (!message) issues.push({ code: 'message_missing', channelId: channel.id, messageId: deployment.messageId, deploymentKey }); }
  return { deployment, healthy: issues.length === 0, issues, channel, message, requiresAttachments: deploymentRequiresAttachments(guildId, deployment) };
}
async function inspectAll(guild) { const allDeployments = Object.values(deployments.getAllEmbedDeployments(guild.id) || {}); const checks = []; for (const deployment of allDeployments) checks.push(await inspectDeployment(guild, deployment)); return { deployments: allDeployments, checks }; }
async function buildHealthReport(guild) {
  const { deployments: allDeployments, checks } = await inspectAll(guild);
  const issues = checks.flatMap((check) => check.issues);
  return { module: 'embed', healthy: issues.length === 0, templates: Object.keys(templates.listTemplates(guild.id) || {}).length, deployments: allDeployments.length, active: checks.filter((check) => check.healthy).length, unavailable: checks.filter((check) => !check.healthy).length, issues, checkedAt: now() };
}
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
function getOverview(guildId) {
  const allTemplates = templates.listTemplates(guildId) || {};
  const allDeployments = Object.values(deployments.getAllEmbedDeployments(guildId) || {});
  return { enabled: true, templates: { total: Object.keys(allTemplates).length }, deployments: { total: allDeployments.length, active: allDeployments.filter((item) => !item.status || item.status === 'active').length, unavailable: allDeployments.filter((item) => item.status && item.status !== 'active').length } };
}
module.exports = { getOverview, buildHealthReport, repairAll, handleInteraction, installMediaRuntime, mediaStateApi, templates, deployments, panel, media, interactions, validation, health };
