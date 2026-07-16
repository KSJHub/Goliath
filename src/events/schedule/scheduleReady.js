'use strict';

const { Events } = require('discord.js');
const schedule = require('../../modules/schedule/schedule');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    await schedule.startup(client);
  },
};
