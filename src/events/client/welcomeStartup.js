'use strict';

const { Events } = require('discord.js');
const { startupWelcome } = require('../../modules/welcome');

module.exports = {
  name: Events.ClientReady,
  async execute(client) {
    await startupWelcome(client);
  },
};