'use strict';

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
const RECOVERY_SETTLE_MS = 250;

const auditLiveProbeInFlight = new Set();

const runtimeState = {
  auditRegistryTimer: null,
  auditLiveProbeTimer: null,
  auditGuildListenersInstalled: false,
  recoveryStarted: false,
  recoveryCompleted: false,
};

/* -------------------------------------------------------------------------- */
/* Utilities                                                                  */
/* -------------------------------------------------------------------------- */

function getEnvList(name) {
  const value = process.env[name];

  if (!value) return [];

  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function runtimeMode(client) {
  return String(
    client?.botMode ||
    process.env.BOT_MODE ||
    'DEV'
  ).toUpperCase();
}

function sleep(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

async function runRecoveryStage(name, task) {
  const startedAt = Date.now();

  terminal.info(`[READY STAGE] Starting ${name}`);

  try {
    const result = await task();

    terminal.info(
      `[READY STAGE] Completed ${name} in ${Date.now() - startedAt}ms`
    );

    return {
      ok: true,
      result,
    };
  } catch (error) {
    terminal.error(
      `[READY STAGE] ${name} failed: ${error?.message || error}`
    );

    return {
      ok: false,
      error,
      result: null,
    };
  } finally {
    /*
     * Do not force GC here. Normal V8 collection should remain in control.
     * This short yield prevents the recovery queue from immediately piling
     * another expensive operation onto the same event-loop turn.
     */
    await sleep(RECOVERY_SETTLE_MS);
  }
}

/* -------------------------------------------------------------------------- */
/* Audit Intelligence guild registry                                          */
/* -------------------------------------------------------------------------- */

function publishAuditGuildRegistry(client, reason = 'startup') {
  try {
    const registry = auditStore.publishGuildRegistry(client);

    if (registry) {
      terminal.info(
        `Audit guild registry published: ` +
        `${registry.guilds.length} guild(s) for ` +
        `${registry.environment} (${reason})`
      );
    }

    return registry;
  } catch (error) {
    terminal.error(
      `Failed to publish Audit Intelligence guild registry ` +
      `(${reason}): ${error?.message || error}`
    );

    return null;
  }
}

async function refreshAuditGuildRegistry(
  client,
  reason = 'scheduled refresh',
  options = {}
) {
  const fetchRemote = options.fetchRemote !== false;

  if (fetchRemote) {
    try {
      await client.guilds.fetch();
    } catch (error) {
      terminal.warn(
        `Audit guild registry remote refresh unavailable; using cached registry ` +
        `(${reason}): ${error?.message || error}`
      );
    }
  }

  return publishAuditGuildRegistry(client, reason);
}

function startAuditGuildRegistryRefresh(client) {
  if (runtimeState.auditRegistryTimer) {
    return runtimeState.auditRegistryTimer;
  }

  const schedulerId = sentinelSchedulers.register({
    module: 'auditIntelligence',
    component: 'guild-registry-refresh',
    intervalMs: AUDIT_REGISTRY_REFRESH_MS,
    staleAfterMs: AUDIT_REGISTRY_REFRESH_MS * 3,
    environment:
      auditStore.runtimeMode?.() ||
      runtimeMode(client),
  });

  let running = false;

  const run = async () => {
    if (running) return;

    running = true;

    try {
      const registry = await refreshAuditGuildRegistry(
        client,
        'scheduled refresh',
        { fetchRemote: true }
      );

      if (!registry) {
        throw new Error(
          'Audit guild registry refresh returned no registry.'
        );
      }

      sentinelSchedulers.beat(schedulerId, {
        guilds: Array.isArray(registry.guilds)
          ? registry.guilds.length
          : 0,
        environment: registry.environment || null,
      });
    } catch (error) {
      sentinelSchedulers.fail(schedulerId, error);

      terminal.error(
        `Audit guild registry scheduled refresh failed: ` +
        `${error?.message || error}`
      );
    } finally {
      running = false;
    }
  };

  runtimeState.auditRegistryTimer = setInterval(
    run,
    AUDIT_REGISTRY_REFRESH_MS
  );

  runtimeState.auditRegistryTimer.unref?.();

  return runtimeState.auditRegistryTimer;
}

function installAuditGuildListeners(client) {
  if (runtimeState.auditGuildListenersInstalled) return;

  runtimeState.auditGuildListenersInstalled = true;

  client.on(Events.GuildCreate, () => {
    publishAuditGuildRegistry(client, 'guild joined');
  });

  client.on(Events.GuildDelete, () => {
    publishAuditGuildRegistry(client, 'guild left');
  });
}

/* -------------------------------------------------------------------------- */
/* Audit Intelligence live probes                                             */
/* -------------------------------------------------------------------------- */

function liveProbeExpired(request, now = Date.now()) {
  const expiresAt = Date.parse(request?.expiresAt || '') || 0;

  return Boolean(expiresAt && expiresAt <= now);
}

function liveProbeClaimOwnedBy(requestId, mode) {
  const current = auditStore.getLiveProbeRequest?.(requestId);

  if (!current || current.status !== 'claimed') return null;

  if (
    String(current.claimedBy || '').toUpperCase() !==
    String(mode || '').toUpperCase()
  ) {
    return null;
  }

  if (
    String(current.targetMode || '').toUpperCase() !==
    String(mode || '').toUpperCase()
  ) {
    return null;
  }

  if (liveProbeExpired(current)) return null;

  return current;
}

function liveProbeCompletionResult(
  request,
  mode,
  result,
  startedAt,
  completedAt = Date.now()
) {
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
  const kind = String(
    request?.kind || 'guild_registry'
  ).trim().toLowerCase();

  const startedAt = Date.now();

  let result;

  if (kind === 'guild_registry') {
    const registry = await refreshAuditGuildRegistry(
      client,
      `live probe ${request.id}`,
      { fetchRemote: true }
    );

    if (!registry) {
      throw new Error(
        'Live guild registry probe returned no registry.'
      );
    }

    result = {
      environment: registry.environment || mode,
      guildCount: Array.isArray(registry.guilds)
        ? registry.guilds.length
        : 0,
      guildIds: Array.isArray(registry.guilds)
        ? registry.guilds.map((guild) => guild.id)
        : [],
    };
  } else if (kind === 'guild_fetch') {
    const guildId = String(request.guildId || '').trim();

    if (!guildId) {
      throw new Error(
        'Live guild fetch probe is missing guildId.'
      );
    }

    const guild = await client.guilds.fetch(guildId);

    result = {
      guildId: guild.id,
      guildName: guild.name || null,
      available: true,
    };
  } else if (kind === 'command') {
    const command = String(request.command || '').trim();

    if (!command) {
      throw new Error(
        'Live command probe is missing command.'
      );
    }

    if (command !== 'ping') {
      throw new Error(
        `Unsupported live probe command: ${command}`
      );
    }

    result = {
      command,
      pong: true,
      websocketPingMs: Number(client.ws?.ping || 0),
    };
  } else {
    throw new Error(
      `Unsupported live probe kind: ${kind}`
    );
  }

  return liveProbeCompletionResult(
    request,
    mode,
    result,
    startedAt
  );
}

function startAuditLiveProbeProcessor(client) {
  if (runtimeState.auditLiveProbeTimer) {
    return runtimeState.auditLiveProbeTimer;
  }

  const mode = runtimeMode(client);

  const schedulerId = sentinelSchedulers.register({
    module: 'auditIntelligence',
    component: 'live-probe-processor',
    intervalMs: AUDIT_LIVE_PROBE_POLL_MS,
    staleAfterMs: Math.max(
      AUDIT_LIVE_PROBE_POLL_MS * 10,
      15_000
    ),
    environment: mode,
  });

  let running = false;

  const run = async () => {
    if (running) return;

    running = true;

    try {
      const pending =
        auditStore.listLiveProbeRequests?.({
          targetMode: mode,
          status: 'pending',
        }) || [];

      for (const request of pending) {
        if (
          !request?.id ||
          auditLiveProbeInFlight.has(request.id)
        ) {
          continue;
        }

        if (liveProbeExpired(request)) {
          auditStore.expireLiveProbeRequest?.(
            request.id,
            {
              reason:
                'Request expired before it could be claimed.',
            }
          );

          continue;
        }

        const claimed =
          auditStore.claimLiveProbeRequest?.(
            request.id,
            { claimedBy: mode }
          );

        if (!claimed || claimed.status !== 'claimed') {
          continue;
        }

        auditLiveProbeInFlight.add(request.id);

        try {
          if (
            !liveProbeClaimOwnedBy(request.id, mode)
          ) {
            continue;
          }

          const result =
            await executeAuditLiveProbe(
              client,
              claimed,
              mode
            );

          if (
            liveProbeClaimOwnedBy(request.id, mode)
          ) {
            auditStore.completeLiveProbeRequest?.(
              request.id,
              result
            );
          }
        } catch (error) {
          if (
            liveProbeClaimOwnedBy(request.id, mode)
          ) {
            auditStore.failLiveProbeRequest?.(
              request.id,
              {
                ok: false,
                mode,
                error: String(
                  error?.message || error
                ),
                completedAt:
                  new Date().toISOString(),
              }
            );
          }
        } finally {
          auditLiveProbeInFlight.delete(request.id);
        }
      }

      sentinelSchedulers.beat(
        schedulerId,
        {
          mode,
          pending: pending.length,
          inFlight: auditLiveProbeInFlight.size,
        }
      );
    } catch (error) {
      sentinelSchedulers.fail(
        schedulerId,
        error,
        { mode }
      );

      terminal.error(
        `Audit live probe processor failed: ` +
        `${error?.message || error}`
      );
    } finally {
      running = false;
    }
  };

  runtimeState.auditLiveProbeTimer = setInterval(
    run,
    AUDIT_LIVE_PROBE_POLL_MS
  );

  runtimeState.auditLiveProbeTimer.unref?.();

  return runtimeState.auditLiveProbeTimer;
}

/* -------------------------------------------------------------------------- */
/* Audit report-feed recovery                                                 */
/* -------------------------------------------------------------------------- */

async function restoreAuditReportFeeds(client) {
  const registry =
    auditStore.getGuildRegistry?.() || null;

  const guildIds =
    Array.isArray(registry?.guilds)
      ? registry.guilds
          .map((guild) => guild.id)
          .filter(Boolean)
      : [];

  const results = {
    mode: runtimeMode(client),
    total: guildIds.length,
    restored: 0,
    failed: 0,
    unavailable: 0,
  };

  for (const guildId of guildIds) {
    /*
     * ClientReady should already have the active guild cache.
     * Only fall back to REST when the registry contains a guild
     * that is genuinely absent from cache.
     */
    let guild = client.guilds.cache.get(guildId);

    if (!guild) {
      guild = await client.guilds
        .fetch(guildId)
        .catch(() => null);
    }

    if (!guild) {
      results.unavailable += 1;
      continue;
    }

    try {
      await auditRouter.ensureGuildReportFeeds(
        client,
        guild
      );

      results.restored += 1;
    } catch (error) {
      results.failed += 1;

      terminal.error(
        `Failed to restore Audit Intelligence ` +
        `report feeds for ${guildId}: ` +
        `${error?.message || error}`
      );
    }

    /*
     * Yield between guilds so large report-feed work cannot
     * monopolise one continuous startup burst.
     */
    await sleep(RECOVERY_SETTLE_MS);
  }

  return results;
}

async function sendAuditStartupSummary(
  client,
  restoreResult
) {
  if (
    !restoreResult ||
    restoreResult.mode !== 'DEV' ||
    restoreResult.total < 1
  ) {
    return false;
  }

  try {
    const context =
      await auditRouter.ensureCommandCenter(client);

    if (!context?.channel?.isTextBased?.()) {
      return false;
    }

    const healthy =
      restoreResult.failed === 0 &&
      restoreResult.unavailable === 0;

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

    await context.channel.send({
      content,
      allowedMentions: {
        parse: [],
      },
    });

    return true;
  } catch (error) {
    terminal.error(
      `Failed to send Audit Intelligence startup summary: ` +
      `${error?.message || error}`
    );

    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Controlled startup recovery                                                */
/* -------------------------------------------------------------------------- */

async function runControlledRecovery(client) {
  if (
    runtimeState.recoveryStarted ||
    runtimeState.recoveryCompleted
  ) {
    return;
  }

  runtimeState.recoveryStarted = true;

  terminal.info(
    'Controlled startup recovery beginning.'
  );

  try {
    await runRecoveryStage(
      'Goliath Core emoji recovery',
      async () => {
        const recovered =
          await emojis.recoverCoreArtifacts(client);

        if (
          Array.isArray(recovered) &&
          recovered.length > 0
        ) {
          terminal.info(
            `Goliath Core emoji recovery repaired ` +
            `${recovered.length} interrupted ` +
            `replacement artifact(s).`
          );
        }

        return recovered;
      }
    );

    /*
     * Initial publication uses the ClientReady cache.
     * Do NOT perform a complete Discord REST guild fetch here.
     */
    await runRecoveryStage(
      'Audit guild registry publication',
      async () => {
        const registry =
          publishAuditGuildRegistry(
            client,
            'startup cache'
          );

        if (!registry) {
          throw new Error(
            'Audit guild registry publication returned no registry.'
          );
        }

        return registry;
      }
    );

    const auditRestoreStage =
      await runRecoveryStage(
        'Audit report feed recovery',
        () => restoreAuditReportFeeds(client)
      );

    if (auditRestoreStage.ok) {
      await runRecoveryStage(
        'Audit startup summary',
        () =>
          sendAuditStartupSummary(
            client,
            auditRestoreStage.result
          )
      );
    }

    await runRecoveryStage(
      'Translation recovery',
      () => startupTranslation(client)
    );

    await runRecoveryStage(
      'Schedule startup',
      async () => {
        await scheduleStartup.startup(client);

        terminal.info(
          'Schedule processor started: startup recovery + ' +
          '60-second processing interval.'
        );
      }
    );

    await runRecoveryStage(
      'Leveling voice session recovery',
      async () => {
        const voiceSessions =
          levelingTracking.bootstrapVoiceSessions(
            client
          );

        if (voiceSessions > 0) {
          terminal.info(
            `Leveling voice XP sessions resumed: ` +
            `${voiceSessions}`
          );
        }

        return voiceSessions;
      }
    );

    runtimeState.recoveryCompleted = true;

    terminal.success(
      'Controlled startup recovery complete.'
    );

  } finally {
    runtimeState.recoveryStarted = false;
  }
}

function startControlledRecovery(client) {
  /*
   * Detach recovery from the ClientReady handler.
   * Rejections are consumed here so an individual recovery
   * failure can never become an unhandled rejection.
   */
  setImmediate(() => {
    runControlledRecovery(client).catch((error) => {
      terminal.error(
        `Controlled startup recovery failed: ` +
        `${error?.stack || error?.message || error}`
      );
    });
  });
}

/* -------------------------------------------------------------------------- */
/* ClientReady                                                                */
/* -------------------------------------------------------------------------- */

module.exports = {
  name: Events.ClientReady,
  once: true,

  async execute(client) {
    terminal.success(
      `Logged in as ${client.user?.tag || 'Unknown bot'}`
    );

    const mode = runtimeMode(client);

    const devGuildIds =
      getEnvList('DEV_GUILD_IDS');

    const betaGuildIds =
      getEnvList('BETA_GUILD_IDS');

    const prodGuildIds =
      getEnvList('PRODUCTION_GUILD_IDS');

    terminal.info(
      `Guilds cached: ${client.guilds.cache.size}`
    );

    if (mode === 'DEV' && devGuildIds.length) {
      terminal.info(
        `DEV guild scope: ${devGuildIds.join(', ')}`
      );
    }

    if (mode === 'BETA' && betaGuildIds.length) {
      terminal.info(
        `BETA guild scope: ${betaGuildIds.join(', ')}`
      );
    }

    if (
      mode === 'PRODUCTION' &&
      prodGuildIds.length
    ) {
      terminal.info(
        `PRODUCTION guild scope: ` +
        `${prodGuildIds.join(', ')}`
      );
    }

    /*
     * Lightweight infrastructure is installed immediately.
     * None of these should perform the heavyweight recovery
     * transaction that previously blocked ClientReady.
     */
    installAuditGuildListeners(client);
    startAuditGuildRegistryRefresh(client);
    startAuditLiveProbeProcessor(client);

    try {
      restoreLockdownReminders(client);
    } catch (error) {
      terminal.error(
        `Failed to restore lockdown reminders: ` +
        `${error?.message || error}`
      );
    }

    try {
      startBackupWorker({ client });
    } catch (error) {
      terminal.error(
        `Failed to start backup worker: ` +
        `${error?.message || error}`
      );
    }

    try {
      startStatusRotation(client);
    } catch (error) {
      terminal.error(
        `Failed to start status rotation: ` +
        `${error?.message || error}`
      );
    }

    /*
     * Heavy recovery now runs as a controlled sequential queue
     * outside the blocking ClientReady handler.
     */
    startControlledRecovery(client);

    terminal.success(
      'ClientReady bootstrap complete; controlled recovery queued.'
    );
  },
};
