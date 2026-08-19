'use strict';

const { Events } = require('discord.js');
const statsStartup = require('../../modules/utilityStudio/stats/statsStartup');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    await statsStartup.startup(client);
  },
};
