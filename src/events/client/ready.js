const { Events } = require('discord.js');
const terminal = require('../../core/logging/terminalLogger').createLogger('bot');
const levelingTracking = require('../../modules/communityStudio/leveling/levelingTracking');
const { startupTranslation } = require('../../modules/utilityStudio/translation/translationStartup');
const scheduleStartup = require('../../modules/utilityStudio/schedule/scheduleStartup');
const emojis = require('../../modules/utilityStudio/emojis/emojis');
const auditStore = require('../../owner/auditIntelligence/auditStore');
const auditRouter = require('../../owner/auditIntelligence/auditRouter');
const sentinelSchedulers = require('../../owner/sentinel/schedulerRegistry');

const {
  restoreLockdownReminders,
} = require('../../core/security/protection/lockdown');

const {
  startBackupWorker,
} = require('../../core/security/restoreBackup/scheduler');

const {
  startStatusRotation,
} = require('../../runtime/statusRotation');

const AUDIT_REGISTRY_REFRESH_MS = 5 * 60 * 1000;
const AUDIT_LIVE_PROBE_POLL_MS = 1000;
const auditLiveProbeInFlight = new Set();

function getEnvList(name) {
  const value = process.env[name];

  if (!value) return [];

  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function publishAuditGuildRegistry(client, reason = 'startup') {
  try {
    const registry = auditStore.publishGuildRegistry(client);
    if (registry) terminal.info(`Audit guild registry published: ${registry.guilds.length} guild(s) for ${registry.environment} (${reason})`);
    return registry;
  } catch (error) {
    terminal.error(`Failed to publish Audit Intelligence guild registry (${reason}): ${error?.message || error}`);
    return null;
  }
}

async function refreshAuditGuildRegistry(client, reason = 'startup') {
  try {
    await client.guilds.fetch();
  } catch (error) {
    terminal.warn(`Audit guild registry cache refresh failed (${reason}): ${error?.message || error}`);
  }
  return publishAuditGuildRegistry(client, reason);
}

function startAuditGuildRegistryRefresh(client) {
  const schedulerId = sentinelSchedulers.register({
    module: 'auditIntelligence',
    component: 'guild-registry-refresh',
    intervalMs: AUDIT_REGISTRY_REFRESH_MS,
    staleAfterMs: AUDIT_REGISTRY_REFRESH_MS * 3,
    environment: auditStore.runtimeMode?.() || String(client?.botMode || process.env.BOT_MODE || 'DEV').toUpperCase(),
  });

  const run = async () => {
    try {
      const registry = await refreshAuditGuildRegistry(client, 'scheduled refresh');
      if (!registry) throw new Error('Audit guild registry refresh returned no registry.');
      sentinelSchedulers.beat(schedulerId, {
        guilds: Array.isArray(registry.guilds) ? registry.guilds.length : 0,
        environment: registry.environment || null,
      });
    } catch (error) {
      sentinelSchedulers.fail(schedulerId, error);
      terminal.error(`Audit guild registry scheduled refresh failed: ${error?.message || error}`);
    }
  };

  const timer = setInterval(run, AUDIT_REGISTRY_REFRESH_MS);
  timer.unref?.();
  return timer;
}

function liveProbeExpired(request, now = Date.now()) {
  const expiresAt = Date.parse(request?.expiresAt || '') || 0;
  return Boolean(expiresAt && expiresAt <= now);
}

function liveProbeClaimOwnedBy(requestId, mode) {
  const current = auditStore.getLiveProbeRequest?.(requestId);
  if (!current || current.status !== 'claimed') return null;
  if (String(current.claimedBy || '').toUpperCase() !== String(mode || '').toUpperCase()) return null;
  if (String(current.targetMode || '').toUpperCase() !== String(mode || '').toUpperCase()) return null;
  if (liveProbeExpired(current)) return null;
  return current;
}

function liveProbeCompletionResult(request, mode, result, startedAt, completedAt = Date.now()) {
  return {
    ok: true,
    mode,
    kind: request.kind || 'guild_registry',
    command: request.command || null,
    guildId: request.guildId || null,
    startedAt: new Date(startedAt).toISOString(),
    completedAt: new Date(completedAt).toISOString(),
    durationMs: Math.max(0, completedAt - startedAt),
    result: result || null,
  };
}

async function executeAuditLiveProbe(client, request, mode) {
  const kind = String(request?.kind || 'guild_registry').trim().toLowerCase();
  const startedAt = Date.now();
  let result;

  if (kind === 'guild_registry') {
    const registry = await refreshAuditGuildRegistry(client, `live probe ${request.id}`);
    if (!registry) throw new Error('Live guild registry probe returned no registry.');
    result = {
      environment: registry.environment || mode,
      guildCount: Array.isArray(registry.guilds) ? registry.guilds.length : 0,
      guildIds: Array.isArray(registry.guilds) ? registry.guilds.map((guild) => guild.id) : [],
    };
  } else if (kind === 'guild_fetch') {
    const guildId = String(request.guildId || '').trim();
    if (!guildId) throw new Error('Live guild fetch probe is missing guildId.');
    const guild = await client.guilds.fetch(guildId);
    result = { guildId: guild.id, guildName: guild.name || null, available: true };
  } else if (kind === 'command') {
    const command = String(request.command || '').trim();
    if (!command) throw new Error('Live command probe is missing command.');
    if (command !== 'ping') throw new Error(`Unsupported live probe command: ${command}`);
    result = { command, pong: true, websocketPingMs: Number(client.ws?.ping || 0) };
  } else {
    throw new Error(`Unsupported live probe kind: ${kind}`);
  }

  return liveProbeCompletionResult(request, mode, result, startedAt);
}

function startAuditLiveProbeProcessor(client) {
  const mode = String(client?.botMode || process.env.BOT_MODE || 'DEV').toUpperCase();
  const schedulerId = sentinelSchedulers.register({
    module: 'auditIntelligence',
    component: 'live-probe-processor',
    intervalMs: AUDIT_LIVE_PROBE_POLL_MS,
    staleAfterMs: Math.max(AUDIT_LIVE_PROBE_POLL_MS * 10, 15_000),
    environment: mode,
  });

  const run = async () => {
    try {
      const pending = auditStore.listLiveProbeRequests?.({ targetMode: mode, status: 'pending' }) || [];
      for (const request of pending) {
        if (!request?.id || auditLiveProbeInFlight.has(request.id)) continue;
        if (liveProbeExpired(request)) {
          auditStore.expireLiveProbeRequest?.(request.id, { reason: 'Request expired before it could be claimed.' });
          continue;
        }
        const claimed = auditStore.claimLiveProbeRequest?.(request.id, { claimedBy: mode });
        if (!claimed || claimed.status !== 'claimed') continue;
        auditLiveProbeInFlight.add(request.id);
        try {
          if (!liveProbeClaimOwnedBy(request.id, mode)) continue;
          const result = await executeAuditLiveProbe(client, claimed, mode);
          if (liveProbeClaimOwnedBy(request.id, mode)) auditStore.completeLiveProbeRequest?.(request.id, result);
        } catch (error) {
          if (liveProbeClaimOwnedBy(request.id, mode)) {
            auditStore.failLiveProbeRequest?.(request.id, {
              ok: false,
              mode,
              error: String(error?.message || error),
              completedAt: new Date().toISOString(),
            });
          }
        } finally {
          auditLiveProbeInFlight.delete(request.id);
        }
      }
      sentinelSchedulers.beat(schedulerId, { mode, pending: pending.length, inFlight: auditLiveProbeInFlight.size });
    } catch (error) {
      sentinelSchedulers.fail(schedulerId, error, { mode });
      terminal.error(`Audit live probe processor failed: ${error?.message || error}`);
    }
  };

  const timer = setInterval(run, AUDIT_LIVE_PROBE_POLL_MS);
  timer.unref?.();
  return timer;
}

async function restoreAuditReportFeeds(client) {
  const registry = auditStore.getGuildRegistry?.() || null;
  const guildIds = Array.isArray(registry?.guilds) ? registry.guilds.map((guild) => guild.id) : [];
  const results = { mode: String(client?.botMode || process.env.BOT_MODE || 'DEV').toUpperCase(), total: guildIds.length, restored: 0, failed: 0, unavailable: 0 };
  for (const guildId of guildIds) {
    const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) { results.unavailable += 1; continue; }
    try {
      await auditRouter.ensureGuildReportFeeds(client, guild);
      results.restored += 1;
    } catch (error) {
      results.failed += 1;
      terminal.error(`Failed to restore Audit Intelligence report feeds for ${guildId}: ${error?.message || error}`);
    }
  }
  return results;
}

async function sendAuditStartupSummary(client, restoreResult) {
  if (!restoreResult || restoreResult.mode !== 'DEV' || restoreResult.total < 1) return false;
  try {
    const context = await auditRouter.ensureCommandCenter(client);
    if (!context?.channel?.isTextBased?.()) return false;
    const healthy = restoreResult.failed === 0 && restoreResult.unavailable === 0;
    const content = [
      `${healthy ? '🟢' : '🟠'} **Goliath Audit Intelligence Online**`,
      '',
      `**Report feeds checked:** ${restoreResult.total}`,
      `**Restored / ready:** ${restoreResult.restored}`,
      `**Failed:** ${restoreResult.failed}`,
      `**Source guilds unavailable:** ${restoreResult.unavailable}`,
      '',
      healthy
        ? 'Live reporting is ready. Use **Routing → Send Test Report** to verify any individual feed.'
        : 'One or more feeds need attention. Use **Routing → Create / Repair Report Channels** and **Send Test Report** to verify them.',
    ].join('\n');
    await context.channel.send({ content, allowedMentions: { parse: [] } });
    return true;
  } catch (error) {
    terminal.error(`Failed to send Audit Intelligence startup summary: ${error?.message || error}`);
    return false;
  }
}

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    terminal.success(`Logged in as ${client.user?.tag || 'Unknown bot'}`);

    const devGuildIds = getEnvList('DEV_GUILD_IDS');
    const betaGuildIds = getEnvList('BETA_GUILD_IDS');
    const prodGuildIds = getEnvList('PRODUCTION_GUILD_IDS');

    terminal.info(`Guilds cached: ${client.guilds.cache.size}`);

    if (client.botMode === 'DEV' && devGuildIds.length) {
      terminal.info(`DEV guild scope: ${devGuildIds.join(', ')}`);
    }

    if (client.botMode === 'BETA' && betaGuildIds.length) {
      terminal.info(`BETA guild scope: ${betaGuildIds.join(', ')}`);
    }

    if (client.botMode === 'PRODUCTION' && prodGuildIds.length) {
      terminal.info(`PRODUCTION guild scope: ${prodGuildIds.join(', ')}`);
    }

    try {
      const recovered = await emojis.recoverCoreArtifacts(client);
      if (recovered.length > 0) terminal.info(`Goliath Core emoji recovery repaired ${recovered.length} interrupted replacement artifact(s).`);
    } catch (error) {
      terminal.error(`Failed to recover Goliath Core emoji replacement artifacts: ${error?.message || error}`);
    }

    await refreshAuditGuildRegistry(client);
    client.on(Events.GuildCreate, () => refreshAuditGuildRegistry(client, 'guild joined'));
    client.on(Events.GuildDelete, () => refreshAuditGuildRegistry(client, 'guild left'));
    startAuditGuildRegistryRefresh(client);
    startAuditLiveProbeProcessor(client);

    const auditRestore = await restoreAuditReportFeeds(client);
    await sendAuditStartupSummary(client, auditRestore);

    restoreLockdownReminders(client);
    startBackupWorker({ client });
    startStatusRotation(client);

    try {
      await startupTranslation(client);
    } catch (error) {
      terminal.error(`Failed to recover Translation threads: ${error?.message || error}`);
    }

    try {
      await scheduleStartup.startup(client);
      terminal.info('Schedule processor started: startup recovery + 60-second processing interval.');
    } catch (error) {
      terminal.error(`Failed to start Schedule processor: ${error?.message || error}`);
    }

    try {
      const voiceSessions = levelingTracking.bootstrapVoiceSessions(client);
      if (voiceSessions > 0) terminal.info(`Leveling voice XP sessions resumed: ${voiceSessions}`);
    } catch (error) {
      terminal.error(`Failed to resume Leveling voice XP sessions: ${error?.message || error}`);
    }
  },
};