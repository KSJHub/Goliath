'use strict';

const { Events } = require('discord.js');
const observatory = require('../../owner/auditIntelligence/guildObservatory');

const RESCAN_INTERVAL_MS = 15 * 60 * 1000;

async function scanAll(client, reason) {
  const destinationId = String(require('../../owner/auditIntelligence/auditStore').getConfig().commandCenter?.guildId || '');
  const guilds = [...client.guilds.cache.values()].filter((guild) => guild.id !== destinationId);
  let ok = 0;
  for (const guild of guilds) {
    try {
      const result = await observatory.scanGuild(guild, { auditLimit: 100, reason });
      if (result?.ok) ok += 1;
    } catch (error) {
      console.warn(`[GuildObservatory] ${reason} scan failed for ${guild.id}:`, error?.message || error);
    }
  }
  console.log(`[GuildObservatory] ${reason} scan complete: ${ok}/${guilds.length} guild(s).`);
}

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    observatory.wire(client);
    await scanAll(client, 'startup-baseline');
    const timer = setInterval(() => { void scanAll(client, 'scheduled-baseline'); }, RESCAN_INTERVAL_MS);
    timer.unref?.();
    console.log(`[GuildObservatory] ${String(process.env.BOT_MODE || 'DEV').toUpperCase()} collector online • persistent baseline every 15 minutes.`);
  },
};
