'use strict';

const { Events } = require('discord.js');
const observatory = require('../../owner/auditIntelligence/guildObservatory');
const auditStore = require('../../owner/auditIntelligence/auditStore');
const audit = require('../../owner/auditIntelligence/auditIntelligence');
const sentinelScheduler = require('../../owner/sentinel/schedulerRegistry');

const RESCAN_INTERVAL_MS = 15 * 60 * 1000;
const SCHEDULER_ID = 'auditIntelligence:guild-observatory:global';

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

async function recordScanAction(client, details) {
  const startup = details.reason === 'startup-baseline';
  if (!startup && details.failed < 1) return;
  await audit.captureGoliathAction(client, {
    type: startup ? 'goliath.scheduler.guild_observatory.startup' : 'goliath.scheduler.guild_observatory.failure',
    category: 'goliath',
    action: 'execute',
    system: 'Audit Intelligence',
    result: details.failed > 0 ? 'Partial / Failed' : 'Success',
    summary: details.failed > 0
      ? `Guild Observatory ${details.reason} scanned ${details.scanned}/${details.localGuilds} local monitored guild(s); ${details.failed} scan(s) failed.`
      : `Guild Observatory startup baseline scanned ${details.scanned}/${details.localGuilds} local monitored guild(s); ${details.remoteGuilds} registered guild(s) are monitored by other collectors.`,
    metadata: { schedulerId: SCHEDULER_ID, ...details },
  }).catch((error) => console.warn('[GuildObservatory] Could not record scheduler audit action:', error?.message || error));
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
  const details = { reason, collector: runtimeMode(), localGuilds: local.length, scanned: ok, remoteGuilds: remote.length, registeredGuilds: known.length, failed };
  if (failed > 0) sentinelScheduler.fail(SCHEDULER_ID, new Error(`${failed} Guild Observatory scan(s) failed.`), details);
  else sentinelScheduler.beat(SCHEDULER_ID, details);
  await recordScanAction(client, details);
  console.log(`[GuildObservatory] ${reason}: local monitored guilds ${local.length} • scanned ${ok} • remote registered guilds ${remote.length} • total registered ${known.length}${failed ? ` • failed ${failed}` : ''} • collector ${runtimeMode()}.`);
  return details;
}

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    observatory.wire(client);
    auditStore.publishGuildRegistry?.(client);
    sentinelScheduler.register({ id: SCHEDULER_ID, module: 'auditIntelligence', component: 'guild-observatory', intervalMs: RESCAN_INTERVAL_MS, staleAfterMs: Math.max(RESCAN_INTERVAL_MS * 3, 45 * 60 * 1000), environment: runtimeMode(), details: { scope: 'registered-guilds' } });
    await scanAll(client, 'startup-baseline');
    const timer = setInterval(() => {
      scanAll(client, 'scheduled-baseline').catch((error) => {
        sentinelScheduler.fail(SCHEDULER_ID, error, { phase: 'scheduled-baseline', collector: runtimeMode() });
        console.warn('[GuildObservatory] scheduled baseline cycle failed:', error?.stack || error?.message || error);
      });
    }, RESCAN_INTERVAL_MS);
    timer.unref?.();
    console.log(`[GuildObservatory] ${runtimeMode()} collector online • persistent baseline every 15 minutes.`);
  },
};
