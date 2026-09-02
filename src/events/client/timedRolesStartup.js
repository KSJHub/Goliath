'use strict';

const { Events } = require('discord.js');
require('../../modules/roleStudio/timedRoles/timedRolesCompat');
const timedRoles = require('../../modules/roleStudio/timedRoles/timedRolesService');

module.exports = {
  name: Events.ClientReady,
  async execute(client) {
    await timedRoles.startup(client);
  },
};
