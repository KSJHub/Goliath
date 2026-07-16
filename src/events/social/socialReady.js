'use strict';

const { Events } = require('discord.js');
const social = require('../../modules/social/social');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    await social.startup(client);
  },
};
