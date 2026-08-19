'use strict';

const { Events } = require('discord.js');
const sentinel = require('../../owner/sentinel/index.js');
const consoleBridge = require('../../owner/sentinel/consoleBridge.js');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    consoleBridge.install(client, sentinel);
  },
};
