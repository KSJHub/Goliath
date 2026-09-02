'use strict';

const { Events } = require('discord.js');
const scheduleStartup = require('../../modules/utilityStudio/schedule/scheduleStartup');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    await scheduleStartup.startup(client);
  },
};
