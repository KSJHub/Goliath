'use strict';

const { Events } = require('discord.js');
const { startupAutoRoles } = require('../../modules/autoroles');

module.exports = {
  name: Events.ClientReady,
  async execute(client) {
    await startupAutoRoles(client);
  },
};