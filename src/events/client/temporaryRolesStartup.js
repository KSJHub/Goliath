'use strict';

const { Events } = require('discord.js');
const temporaryRoles = require('../../modules/rolestudio/temporaryRoles');

const SCAN_INTERVAL_MS = 60 * 60 * 1000;
const installed = Symbol.for('goliath.roleStudio.temporaryRolesScanner');

async function scanAllGuilds(client) {
  for (const guild of client.guilds.cache.values()) {
    await temporaryRoles.scanExpired(guild).catch((error) => {
      console.error(`[TemporaryRoles] Expiry scan failed for ${guild.id}:`, error?.stack || error?.message || error);
    });
  }
}

module.exports = {
  name: Events.ClientReady,
  async execute(client) {
    if (client[installed]) return;
    Object.defineProperty(client, installed, { value: true });
    await scanAllGuilds(client);
    const timer = setInterval(() => scanAllGuilds(client), SCAN_INTERVAL_MS);
    timer.unref?.();
  },
};