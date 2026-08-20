'use strict';

const { Events } = require('discord.js');
const tempVoiceManager = require('../../modules/utilityStudio/tempVoice/tempVoiceManager');
const tempVoiceStore = require('../../modules/utilityStudio/tempVoice/tempVoiceStore');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    let guildsChecked = 0;
    let missingPruned = 0;
    let emptyCleaned = 0;

    for (const guild of client.guilds.cache.values()) {
      if (!tempVoiceStore.isEnabled(guild.id)) continue;
      guildsChecked += 1;

      const section = tempVoiceStore.getTempVoiceSection(guild.id);
      for (const tempChannel of Object.values(section.channels || {})) {
        const channel = guild.channels.cache.get(tempChannel.channelId)
          || await guild.channels.fetch(tempChannel.channelId).catch(() => null);

        if (!channel) {
          tempVoiceStore.deleteTempChannel(guild.id, tempChannel.channelId, { action: 'temp_voice_startup_prune_missing' });
          missingPruned += 1;
          continue;
        }

        if (section.settings?.deleteWhenEmpty !== false && (channel.members?.size || 0) === 0) {
          const cleaned = await tempVoiceManager.cleanupTempChannel({ guild, channel });
          if (cleaned) emptyCleaned += 1;
        }
      }
    }

    console.log(`[TempVoice] Startup recovery complete: ${guildsChecked} enabled guild(s), ${missingPruned} missing record(s) pruned, ${emptyCleaned} empty channel(s) cleaned.`);
  },
};
