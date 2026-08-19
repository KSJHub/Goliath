'use strict';

const { Events } = require('discord.js');
const sentinel = require('../../owner/sentinel/index.js');
const schedulerMonitor = require('../../owner/sentinel/schedulerMonitor.js');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    await sentinel.start(client);
    schedulerMonitor.start(client, sentinel);
  },
};
