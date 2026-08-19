'use strict';

const voiceLog = require('../../core/logging/voice/voiceLog');
const tempVoice = require('../../modules/utilityStudio/tempVoice/tempVoice');
const tempVoiceStore = require('../../modules/utilityStudio/tempVoice/tempVoiceStore');
const statsManager = require('../../modules/utilityStudio/stats/statsManager');
const levelingTracking = require('../../modules/communityStudio/leveling/levelingTracking');

async function runHandler(label, handler, oldState, newState, client) {
  try {
    await handler(oldState, newState, client);
  } catch (error) {
    console.error(`[VoiceStateUpdate] ${label} handler failed:`, error?.stack || error?.message || error);
  }
}

module.exports = {
  name: 'voiceStateUpdate',

  async execute(oldState, newState, client) {
    await runHandler('Voice Logs', voiceLog.handleVoiceStateUpdate, oldState, newState, client);

    const guildId = newState?.guild?.id || oldState?.guild?.id || null;
    if (guildId && tempVoiceStore.isEnabled(guildId)) {
      await runHandler('Temp Voice', tempVoice.handleVoiceStateUpdate, oldState, newState, client);
    }

    await runHandler('Stats', statsManager.handleVoiceStateUpdate, oldState, newState, client);
    await runHandler('Leveling', levelingTracking.handleVoiceStateUpdate, oldState, newState, client);
  },
};
