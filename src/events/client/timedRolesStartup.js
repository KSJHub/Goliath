'use strict';

const { Events } = require('discord.js');
const timedRoles = require('../../modules/roleStudio/timedRoles/timedRoles');

module.exports = {
  name: Events.ClientReady,
  async execute(client) {
    await timedRoles.startup(client);
  },
};