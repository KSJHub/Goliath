const { Events } = require('discord.js');
const terminal = require('../../core/logging/terminalLogger').createLogger('bot');
const levelingTracking = require('../../modules/communityStudio/leveling/levelingTracking');
const { startupTranslation } = require('../../modules/utilityStudio/translation/translationStartup');
const scheduleStartup = require('../../modules/utilityStudio/schedule/scheduleStartup');
const auditStore = require('../../owner/auditIntelligence/auditStore');
const auditRouter = require('../../owner/auditIntelligence/auditRouter');
const sentinelSchedulers = require('../../owner/sentinel/schedulerRegistry');

const {
  restoreLockdownReminders,
} = require('../../core/security/lockdownSystem');

const {
  startBackupWorker,
} = require('../../core/security/backup/backupWorker');

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
    ...(result && typeof result === 'object' ? result : { started: false, reason: 'invalid-result' }),
    requestId: String(request?.id || ''),
    guildId: String(request?.guildId || ''),
    targetMode: String(request?.targetMode || '').toUpperCase() || null,
    requestedFrom: request?.requestedFrom ? String(request.requestedFrom).toUpperCase() : null,
    collectorMode: String(mode || '').toUpperCase() || null,
    claimedAt: request?.claimedAt || null,
    startedAt: new Date(startedAt).toISOString(),
    completedAt: new Date(completedAt).toISOString(),
    durationMs: Math.max(0, completedAt - startedAt),
  };
}

async function processAuditLiveProbeRequests(client) {
  const mode = auditStore.runtimeMode?.() || String(client?.botMode || process.env.BOT_MODE || 'DEV').toUpperCase();
  const requests = auditStore.getPendingLiveProbeRequests?.(mode) || [];
  if (!requests.length) return 0;
  let processed = 0;

  for (const request of requests) {
    const requestId = String(request?.id || '');
    if (!requestId || auditLiveProbeInFlight.has(requestId)) continue;

    const claimed = auditStore.claimLiveProbeRequest?.(requestId, mode);
    if (!claimed) continue;

    auditLiveProbeInFlight.add(requestId);
    const startedAt = Date.now();
    try {
      const current = liveProbeClaimOwnedBy(requestId, mode);
      if (!current) {
        terminal.warn(`Audit live probe request ${requestId} lost or expired its ${mode} claim before execution; skipping.`);
        continue;
      }

      const guildId = String(current.guildId || '');
      const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);

      if (!liveProbeClaimOwnedBy(requestId, mode)) {
        terminal.warn(`Audit live probe request ${requestId} lost or expired its ${mode} claim while resolving guild ${guildId}; skipping.`);
        continue;
      }

      const result = guild
        ? await auditRouter.runLocalEndToEndProbe(client, guild)
        : { started: false, reason: 'registry-only' };
      const completedAt = Date.now();
      const completion = liveProbeCompletionResult(current, mode, result, startedAt, completedAt);

      const fresh = liveProbeClaimOwnedBy(requestId, mode);
      if (!fresh) {
        terminal.warn(`Audit live probe request ${requestId} could not be completed because the ${mode} claim is no longer active.`);
        continue;
      }

      const completed = auditStore.completeLiveProbeRequest?.(requestId, completion, mode);
      if (!completed) {
        terminal.warn(`Audit live probe request ${requestId} completion was rejected because ${mode} no longer owns the claim.`);
        continue;
      }

      processed += 1;
      terminal.info(`Audit live probe request ${requestId} completed by ${mode} for guild ${guildId} in ${completion.durationMs}ms: ${completion.started ? 'started' : completion.reason || 'not-started'}${current.requestedFrom ? ` (requested from ${current.requestedFrom})` : ''}`);
    } catch (error) {
      const completedAt = Date.now();
      const current = auditStore.getLiveProbeRequest?.(requestId) || claimed;
      const failure = liveProbeCompletionResult(current, mode, { started: false, reason: 'create-failed', error: String(error?.message || error).slice(0, 500) }, startedAt, completedAt);
      const fresh = liveProbeClaimOwnedBy(requestId, mode);
      if (fresh) auditStore.failLiveProbeRequest?.(requestId, failure, mode);
      terminal.error(`Audit live probe request ${requestId} failed in ${mode} after ${failure.durationMs}ms: ${error?.message || error}`);
    } finally {
      auditLiveProbeInFlight.delete(requestId);
    }
  }
  return processed;
}

function startAuditLiveProbeProcessor(client) {
  const schedulerId = sentinelSchedulers.register({
    module: 'auditIntelligence',
    component: 'live-probe-processor',
    intervalMs: AUDIT_LIVE_PROBE_POLL_MS,
    staleAfterMs: 15_000,
    environment: auditStore.runtimeMode?.() || String(client?.botMode || process.env.BOT_MODE || 'DEV').toUpperCase(),
  });

  const run = async (phase = 'scheduled') => {
    try {
      const processed = await processAuditLiveProbeRequests(client);
      sentinelSchedulers.beat(schedulerId, {
        phase,
        processed,
        inFlight: auditLiveProbeInFlight.size,
      });
    } catch (error) {
      sentinelSchedulers.fail(schedulerId, error, {
        phase,
        inFlight: auditLiveProbeInFlight.size,
      });
      terminal.error(`Audit live probe ${phase} processing failed: ${error?.message || error}`);
    }
  };

  run('startup');
  const timer = setInterval(() => run('scheduled'), AUDIT_LIVE_PROBE_POLL_MS);
  timer.unref?.();
  return timer;
}

async function restoreAuditReportFeeds(client) {
  const mode = String(client?.botMode || process.env.BOT_MODE || 'DEV').trim().toUpperCase();
  const result = { mode, total: 0, restored: 0, failed: 0, unavailable: 0 };
  if (mode !== 'DEV') return result;

  const config = auditStore.getConfig();
  if (config.autoProvision === false || !config.commandCenter?.guildId) return result;

  const configuredGuilds = config.guilds && typeof config.guilds === 'object' ? config.guilds : {};
  const commandCenterGuildId = String(config.commandCenter.guildId);
  const registry = auditStore.getGuildRegistry?.() || [];

  for (const guildId of Object.keys(configuredGuilds)) {
    if (!guildId || String(guildId) === commandCenterGuildId) continue;
    result.total += 1;
    const liveGuild = client.guilds.cache.get(String(guildId)) || null;
    const registryGuild = registry.find((entry) => String(entry?.guildId || '') === String(guildId)) || null;
    const sourceGuild = liveGuild || (registryGuild ? { id: String(guildId), name: registryGuild.name || String(guildId) } : null);
    if (!sourceGuild) {
      result.unavailable += 1;
      terminal.warn(`Audit report feed restore skipped for unavailable guild ${guildId}.`);
      continue;
    }

    try {
      const restored = await auditRouter.ensureReportRoutes(client, sourceGuild);
      if (restored) result.restored += 1;
      else result.failed += 1;
    } catch (error) {
      result.failed += 1;
      terminal.error(`Failed to restore Audit Intelligence report feeds for ${sourceGuild.name || guildId}: ${error?.message || error}`);
    }
  }

  if (result.restored > 0) terminal.info(`Audit Intelligence report feeds restored for ${result.restored} configured guild(s).`);
  return result;
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

    await refreshAuditGuildRegistry(client);
    client.on(Events.GuildCreate, () => refreshAuditGuildRegistry(client, 'guild joined'));
    client.on(Events.GuildDelete, () => refreshAuditGuildRegistry(client, 'guild left'));
    startAuditGuildRegistryRefresh(client);
    startAuditLiveProbeProcessor(client);

    const auditRestore = await restoreAuditReportFeeds(client);
    await sendAuditStartupSummary(client, auditRestore);

    restoreLockdownReminders(client);
    startBackupWorker();
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
