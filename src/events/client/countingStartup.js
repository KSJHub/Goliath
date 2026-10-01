'use strict';

const { Events } = require('discord.js');
const counting = require('../../modules/communityStudio/counting/counting');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    counting.registerProtectionEvents(client);
  },
};
