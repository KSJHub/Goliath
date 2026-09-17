'use strict';

const { Events } = require('discord.js');
const observatory = require('../../owner/auditIntelligence/guildObservatory');
const auditStore = require('../../owner/auditIntelligence/auditStore');

const RESCAN_INTERVAL_MS = 15 * 60 * 1000;

function runtimeMode() {
  const mode = String(auditStore.runtimeMode?.() || process.env.BOT_MODE || 'DEV').toUpperCase();
  return mode === 'PROD' ? 'PRODUCTION' : mode;
}

function knownGuilds(client) {
  const destinationId = String(auditStore.getConfig().commandCenter?.guildId || '');
  const merged = new Map();
  for (const item of auditStore.getGuildRegistry?.() || []) {
    const guildId = String(item?.guildId || '').trim();
    if (!guildId || guildId === destinationId) continue;
    merged.set(guildId, { guildId, name: item?.name || guildId, environments: Object.keys(item?.environments || {}), local: client.guilds.cache.has(guildId) });
  }
  for (const guild of client.guilds.cache.values()) {
    if (guild.id === destinationId) continue;
    const current = merged.get(guild.id) || { environments: [] };
    merged.set(guild.id, { ...current, guildId: guild.id, name: guild.name, environments: current.environments?.length ? current.environments : [runtimeMode()], local: true });
  }
  return [...merged.values()];
}

async function scanAll(client, reason) {
  const known = knownGuilds(client);
  const local = known.filter((item) => item.local);
  const remote = known.filter((item) => !item.local);
  let ok = 0;
  let failed = 0;
  for (const item of local) {
    const guild = client.guilds.cache.get(item.guildId);
    if (!guild) continue;
    try {
      const result = await observatory.scanGuild(guild, { auditLimit: 100, reason });
      if (result?.ok) ok += 1; else failed += 1;
    } catch (error) {
      failed += 1;
      console.warn(`[GuildObservatory] ${reason} scan failed for ${item.name} (${item.guildId}):`, error?.message || error);
    }
  }
  console.log(`[GuildObservatory] ${reason} coverage: local ${ok}/${local.length} scanned • remote ${remote.length} known • total ${known.length} known${failed ? ` • ${failed} failed` : ''} • collector ${runtimeMode()}.`);
}

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    observatory.wire(client);
    auditStore.publishGuildRegistry?.(client);
    await scanAll(client, 'startup-baseline');
    const timer = setInterval(() => { void scanAll(client, 'scheduled-baseline'); }, RESCAN_INTERVAL_MS);
    timer.unref?.();
    console.log(`[GuildObservatory] ${runtimeMode()} collector online • persistent baseline every 15 minutes.`);
  },
};
