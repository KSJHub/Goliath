'use strict';

const tempVoiceRuntime = require('./tempVoiceManager');
const tempVoiceStore = require('./tempVoiceStore');
const tempVoicePanel = require('./tempVoicePanel');
const tempVoiceHealth = require('./tempVoiceHealth');

module.exports = {
  ...tempVoiceRuntime,
  store: tempVoiceStore,
  panel: tempVoicePanel,
  health: tempVoiceHealth,
  getConfig: tempVoiceStore.getTempVoiceSection,
  getHubs: tempVoiceStore.getHubs,
  getHub: tempVoiceStore.getHub,
  getTempChannel: tempVoiceStore.getTempChannel,
  buildHealth: tempVoiceHealth.buildHealth,
  repair: tempVoiceHealth.repair,
};
