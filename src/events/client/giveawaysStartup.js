'use strict';

const { Events } = require('discord.js');
const giveawaysManager = require('../../modules/communityStudio/giveaways/giveawaysManager');

module.exports = {
  name: Events.ClientReady,
  async execute(client) {
    giveawaysManager.startGiveawayScheduler(client);
  },
};
