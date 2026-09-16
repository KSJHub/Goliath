'use strict';

const { Events } = require('discord.js');
const observatory = require('../../owner/auditIntelligence/guildObservatory');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    observatory.wire(client);
    console.log(`[GuildObservatory] ${String(process.env.BOT_MODE || 'DEV').toUpperCase()} collector online.`);
  },
};
