'use strict';

const { Events } = require('discord.js');
const stats = require('../../modules/utilityStudio/stats/stats');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    await stats.startup(client);
  },
};
