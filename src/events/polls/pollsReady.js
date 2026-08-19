'use strict';

const { Events } = require('discord.js');
const guildManager = require('../../core/guild/guildManager');
const pollsTracking = require('../../modules/communityStudio/polls/pollsTracking');

async function runPollStartupRecovery(client) {
  await pollsTracking.startup(client);

  for (const guild of client.guilds.cache.values()) {
    if (!guildManager.isModuleEnabled(guild.id, 'polls')) continue;

    try {
      const result = await pollsTracking.repair(guild, {
        actorId: client.user?.id || null,
        reason: 'startup_recovery',
      });

      if (result.failed.length) {
        console.warn(`[Polls] Startup recovery failed for ${result.failed.length} poll(s) in guild ${guild.id}.`);
      }
    } catch (error) {
      console.warn(`[Polls] Startup recovery failed for guild ${guild.id}: ${error.message}`);
    }
  }
}

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    await runPollStartupRecovery(client);
  },
};