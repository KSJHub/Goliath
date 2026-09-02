'use strict';

const templates = require('./embedTemplates');
const deployments = require('./embedDeployments');
const panel = require('./embedPanel');
const media = require('./embedMedia');
const renderer = require('./embedRenderer');
const { installMediaManagerBase } = require('./embedMediaManagerBase');
const { installClassicSingleImagePayload } = require('./embedClassicSingleImage');

const mediaStateApi = Object.freeze({
  getPanelMedia: media.getPanelMedia,
  setPanelMedia: media.setPanelMedia,
  mediaModel: media.mediaModel,
});

function installMediaRuntime(targetPanel) {
  media.installStateCompatibility(targetPanel);
  media.installPersistentMediaCompatibility(targetPanel);
  media.installStorageNormalization(targetPanel);
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
installClassicSingleImagePayload(renderer);

const interactions = require('./embedInteractions');
const validation = require('./embedValidation');

function getOverview(guildId) {
  const allTemplates = templates.listTemplates(guildId) || {};
  const allDeployments = Object.values(deployments.getAllEmbedDeployments(guildId) || {});

  return {
    enabled: true,
    templates: {
      total: Object.keys(allTemplates).length,
    },
    deployments: {
      total: allDeployments.length,
      active: allDeployments.filter(
        (item) => !item.status || item.status === 'active',
      ).length,
      unavailable: allDeployments.filter(
        (item) => item.status && item.status !== 'active',
      ).length,
    },
  };
}

module.exports = {
  getOverview,
  buildHealthReport: validation.buildHealthReport,
  repairAll: validation.repairAll,
  handleInteraction: interactions.handleInteraction,
  installMediaRuntime,

  // Backwards compatibility for any external imports
  installMediaBoundary: installMediaRuntime,

  mediaStateApi,
  templates,
  deployments,
  panel,
  media,
  interactions,
  tracking: deployments,
  validation,
  health: validation,
};
