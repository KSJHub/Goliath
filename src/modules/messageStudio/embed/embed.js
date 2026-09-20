'use strict';

const templates = require('./embedTemplates');
const deployments = require('./embedDeployments');
// embedState owns durable session persistence natively. Keep persistence at the
// canonical state boundary so lexical/destructured consumers cannot bypass it.
require('./embedState');

const panel = require('./embedPanel');
const media = require('./embedMedia');
const renderer = require('./embedRenderer');
const { installMediaManagerBase } = require('./embedMediaManagerBase');
const { installClassicSingleImagePayload } = require('./embedClassicSingleImage');
const { installGraphicHeaders } = require('./embedGraphicHeaders');
const { installImageAlignment, installInteraction: installImageAlignmentInteraction, applyAlignmentMap } = require('./embedImageAlignment');
const { installAlignmentPreview } = require('./embedAlignmentPreview');
const { installFinalImageAlignment } = require('./embedFinalImageAlignment');

const mediaStateApi = Object.freeze({ getPanelMedia: media.getPanelMedia, setPanelMedia: media.setPanelMedia, mediaModel: media.mediaModel });
function clone(value) { try { return JSON.parse(JSON.stringify(value)); } catch { return value; } }
function mediaWeight(value) {
  const panels = Array.isArray(value?.panels) ? value.panels : [];
  return panels.reduce((total, entry) => total + (entry?.thumbnail?.source ? 1 : 0) + (Array.isArray(entry?.gallery) ? entry.gallery.filter((item) => item?.source).length : 0) + (Array.isArray(entry?.files) ? entry.files.filter((item) => item?.source).length : 0), 0);
}
function canonicalMediaState(state = {}) {
  const panels = Array.isArray(state?.panels) ? state.panels : [];
  const fromV2 = media.mediaModel.normalizeMediaV2(state?.mediaV2 || {}, panels);
  const fromStored = media.mediaModel.normalizeMediaV2(state?.media || {}, panels);
  let canonical = mediaWeight(fromV2) >= mediaWeight(fromStored) ? fromV2 : fromStored;
  canonical = media.mediaModel.normalizeMediaV2(canonical, panels);
  canonical.panels = canonical.panels.map((entry, index) => {
    const panelData = panels[index] || {};
    if (!panelData?.graphicHeaderTitle || String(panelData?.title || '').trim()) return entry;
    if (!Array.isArray(entry?.gallery) || !entry.gallery.length) return entry;
    if (entry.gallery.some((item) => item?.placement === 'above')) return entry;
    return { ...entry, gallery: entry.gallery.map((item, itemIndex) => ({ ...item, placement: itemIndex === 0 ? 'above' : 'below' })) };
  });
  return canonical;
}
function installCanonicalMediaSessions(targetPanel) {
  if (!targetPanel || targetPanel.__canonicalMediaSessionsInstalled) return targetPanel;
  if (typeof targetPanel.getSession === 'function') {
    const originalGetSession = targetPanel.getSession.bind(targetPanel);
    targetPanel.getSession = (interaction) => { const state = originalGetSession(interaction); const canonical = canonicalMediaState(state); return { ...state, media: clone(canonical), mediaV2: clone(canonical) }; };
  }
  if (typeof targetPanel.saveSession === 'function') {
    const originalSaveSession = targetPanel.saveSession.bind(targetPanel);
    targetPanel.saveSession = (interaction, state) => { const canonical = canonicalMediaState(state); return originalSaveSession(interaction, { ...state, media: clone(canonical), mediaV2: clone(canonical) }); };
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
    return { ...state, media: applyAlignmentMap(state.media, map), mediaV2: applyAlignmentMap(state.mediaV2, map) };
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
    const sourceMedia = options.media || options.mediaV2 || {};
    const alignedMedia = applyAlignmentMap(sourceMedia, map);
    return originalBuildEmbedPayload({ ...options, media: alignedMedia, mediaV2: alignedMedia, mediaAlignment: map });
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
  targetPanel.setPanelMedia = mediaStateApi.setPanelMedia;
  targetPanel.mediaModel = mediaStateApi.mediaModel;
  return targetPanel;
}
installMediaRuntime(panel);
installAlignmentSessionView(panel);
installClassicSingleImagePayload(renderer);
installImageAlignment(panel, renderer);
installAlignmentDeliveryBridge(renderer, panel);
// Last renderer wrapper: rebuild the outgoing attachment from Goliath's cached
// source after all other media transforms. This makes the saved alignment the
// final authority for Test, Use Embed and Update Existing.
installFinalImageAlignment(renderer);
const interactions = require('./embedInteractions');
installImageAlignmentInteraction(panel, interactions);
installAlignmentPreview(panel, interactions);
installGraphicHeaders(panel, media, interactions);
const validation = require('./embedValidation');
function getOverview(guildId) {
  const allTemplates = templates.listTemplates(guildId) || {};
  const allDeployments = Object.values(deployments.getAllEmbedDeployments(guildId) || {});
  return { enabled: true, templates: { total: Object.keys(allTemplates).length }, deployments: { total: allDeployments.length, active: allDeployments.filter((item) => !item.status || item.status === 'active').length, unavailable: allDeployments.filter((item) => item.status && item.status !== 'active').length } };
}
module.exports = { getOverview, buildHealthReport: validation.buildHealthReport, repairAll: validation.repairAll, handleInteraction: interactions.handleInteraction, installMediaRuntime, installMediaBoundary: installMediaRuntime, mediaStateApi, templates, deployments, panel, media, interactions, tracking: deployments, validation, health: validation };
