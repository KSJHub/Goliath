'use strict';

const { Events } = require('discord.js');
const sentinelPipeline = require('../../owner/sentinel/eventPipeline');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    sentinelPipeline.installBoundary(client);
    console.log(`[Sentinel] Universal event/action boundary active (${sentinelPipeline.environment(client)}).`);
  },
};
