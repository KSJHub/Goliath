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
const { installImageAlignment, installInteraction: installImageAlignmentInteraction, applyAlignmentMap } = require('./embedImageAlignment');
const { installAlignmentPreview } = require('./embedAlignmentPreview');

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
function installAlignmentSessionView(targetPanel) {
  if (!targetPanel || targetPanel.__alignmentSessionViewInstalled || typeof targetPanel.getSession !== 'function') return targetPanel;
  const originalGetSession = targetPanel.getSession.bind(targetPanel);
  targetPanel.getSession = (interaction) => {
    const state = originalGetSession(interaction);
    const map = state?.mediaAlignment && typeof state.mediaAlignment === 'object' ? state.mediaAlignment : {};
    return { ...state, media: applyAlignmentMap(state.media, map) };
  };
  targetPanel.__alignmentSessionViewInstalled = true;
  return targetPanel;
}
function installAlignmentDeliveryBridge(targetRenderer, targetPanel) {
  if (!targetRenderer || targetRenderer.__alignmentDeliveryBridgeInstalled || typeof targetRenderer.buildEmbedPayload !== 'function') return targetRenderer;
  const originalBuildEmbedPayload = targetRenderer.buildEmbedPayload.bind(targetRenderer);
  targetRenderer.buildEmbedPayload = async (options = {}) => {
    let map = options?.mediaAlignment && typeof options.mediaAlignment === 'object' ? options.mediaAlignment : null;
    if (!map && options?.interaction && typeof targetPanel?.getSession === 'function') {
      const state = targetPanel.getSession(options.interaction);
      map = state?.mediaAlignment && typeof state.mediaAlignment === 'object' ? state.mediaAlignment : {};
    }
    map = map || {};
    return originalBuildEmbedPayload({ ...options, media: applyAlignmentMap(options.media || {}, map), mediaAlignment: map });
  };
  targetRenderer.__alignmentDeliveryBridgeInstalled = true;
  return targetRenderer;
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
installAlignmentSessionView(panel);
installImageAlignment(panel, null);
installAlignmentDeliveryBridge(renderer, panel);
const interactions = require('./embedInteractions');
installImageAlignmentInteraction(panel, interactions);
installAlignmentPreview(panel, interactions);
installGraphicHeaders(panel, media, interactions);
const rawHandleInteraction = interactions.handleInteraction.bind(interactions);
async function deliveryReply(interaction, content) {
  const payload = { content, flags: 64 };
  try {
    if (interaction?.deferred || interaction?.replied) return await interaction.followUp(payload);
    return await interaction.reply(payload);
  } catch { return true; }
}
async function migrateLegacyUpdate(interaction, state) {
  if (!interaction?.guild) return false;
  let deploymentKey;
  let deployment;
  try {
    deploymentKey = deployments.getDeploymentKeyFromState(state);
    deployment = deployments.getEmbedDeployment(interaction.guild.id, deploymentKey);
  } catch { return false; }
  if (!deployment?.channelId || !deployment?.messageId) return false;
  const channel = interaction.guild.channels.cache.get(deployment.channelId) || await interaction.guild.channels.fetch(deployment.channelId).catch(() => null);
  if (!channel || typeof channel.messages?.fetch !== 'function') return false;
  const message = await channel.messages.fetch(deployment.messageId).catch(() => null);
  if (!message || message.flags?.has?.(MessageFlags.IsComponentsV2)) return false;

  const report = typeof panel.getReadinessReport === 'function' ? panel.getReadinessReport(interaction) : { ready: true };
  if (!report?.ready) return false;

  try {
    const payload = await renderer.buildEmbedPayload({
      embeds: panel.buildPreviewEmbeds(state, interaction),
      actionRows: panel.buttonRows(state, interaction),
      allowUserPing: Boolean(state.allowUserPing),
      userId: interaction.user?.id || null,
      ephemeral: false,
      media: state.media,
      mediaAlignment: state.mediaAlignment || {},
      interaction,
    });
    payload.allowedMentions = panel.allowedMentions(state, interaction);

    // Legacy Discord messages may still contain embeds/content. Components V2
    // cannot coexist with either, so explicitly clear both while migrating.
    await message.edit({ ...payload, content: null, embeds: [] });

    deployments.saveEmbedDeployment(interaction.guild.id, deploymentKey, {
      ...deployment,
      channelId: channel.id,
      messageId: message.id,
      lastUpdatedBy: interaction.user?.id || deployment.lastUpdatedBy,
    });

    await deliveryReply(interaction, '✅ Existing embed updated and migrated to Components V2.');
    return true;
  } catch (error) {
    console.error('[Embed] Legacy Components V2 migration failed:', error);
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
    if (permissionFailure) {
      await deliveryReply(interaction, permissionFailure);
      return true;
    }
    if (customId === 'embed:update-existing' && await migrateLegacyUpdate(interaction, state)) return true;
    return rawHandleInteraction(interaction);
  })();
  deliveryLocks.set(lockKey, run);
  try { return await run; }
  finally { if (deliveryLocks.get(lockKey) === run) deliveryLocks.delete(lockKey); }
}
interactions.handleInteraction = handleInteraction;
const validation = require('./embedValidation');
const health = require('./embedHealth');
function getOverview(guildId) {
  const allTemplates = templates.listTemplates(guildId) || {};
  const allDeployments = Object.values(deployments.getAllEmbedDeployments(guildId) || {});
  return { enabled: true, templates: { total: Object.keys(allTemplates).length }, deployments: { total: allDeployments.length, active: allDeployments.filter((item) => !item.status || item.status === 'active').length, unavailable: allDeployments.filter((item) => item.status && item.status !== 'active').length } };
}
module.exports = { getOverview, buildHealthReport: health.buildHealthReport, repairAll: health.repairAll, handleInteraction, installMediaRuntime, installMediaBoundary: installMediaRuntime, mediaStateApi, templates, deployments, panel, media, interactions, tracking: deployments, validation, health };
