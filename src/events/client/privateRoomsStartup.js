'use strict';

const { Events } = require('discord.js');
const privateRooms = require('../../modules/utilityStudio/privateRooms/privateRooms');

module.exports = {
  name: Events.ClientReady,
  async execute(client) {
    await privateRooms.startup(client);
  },
};