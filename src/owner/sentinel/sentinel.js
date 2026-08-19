'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const guildManager = require('../../core/guild/guildManager');
const terminal = require('../../core/logging/terminalLogger').createLogger('sentinel');
const { PROJECT_ROOT, ensureRuntimePaths } = require('../../config/runtimePaths');
const coverage = require('./coverage.js');
const store = require('./incidentStore.js');
const notifier = require('./notifier.js');
const {
  HEALTH_TICK_MS,
  DEEP_SCAN_MS,
  HEARTBEAT_STALE_MS,
  SOCIAL_STALE_MULTIPLIER,
  SOCIAL_MIN_STALE_MS,
  REPORT_HOUR_UTC,
} = require('./constants.js');

let timer = null;
let clientRef = null;
let startedAt = 0;
let lastDeepScanAt = 0;
let processHooksInstalled = false;
const adapterCache = new Map();

const mode = (client) => String(client?.botMode || process.env.BOT_MODE || 'DEV').toUpperCase();
const cleanError = (error) => String(error?.stack || error?.message || error || 'Unknown error').slice(0, 3500);

function expectedGuildIds(client) {
  return String(process.env[`${mode(client)}_GUILD_IDS`] || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function sentinelEnv(name, legacyName, fallback = null) {
  const value = process.env[name] ?? process.env[legacyName];
  return value === undefined || value === null || value === '' ? fallback : value;
}

function sharedDir() {
  return sentinelEnv(
    'GOLIATH_SENTINEL_SHARED_DIR',
    'GOLIATH_HEALTH_SHARED_DIR',
    path.resolve(PROJECT_ROOT, '..', '.goliath-sentinel')
  );
}

function writeSharedHeartbeat(client, snapshot) {
  try {
    const dir = sharedDir();
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, `${mode(client).toLowerCase()}.json`);
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2));
    fs.renameSync(tmp, target);
    return true;
  } catch (error) {
    terminal.warn(`Sentinel shared heartbeat write failed: ${error?.message || error}`);
    return false;
  }
}

async function report(client, input) {
  const { incident, opened } = store.openIncident({ environment: mode(client), ...input });
  if (notifier.shouldRemind(incident, opened)) await notifier.send(client, incident, 'open');
  return incident;
}

async function recover(client, input, details = {}) {
  const incident = store.resolveIncident({ environment: mode(client), ...input }, details);
  if (incident) await notifier.send(client, incident, 'resolved');
  return incident;
}

function guildConfig(guildId) {
  try {
    return guildManager.reloadGuild(guildId) || {};
  } catch {
    return {};
  }
}

async function checkGuildAccess(client) {
  const expected = expectedGuildIds(client);
  const ids = expected.length ? expected : [...client.guilds.cache.keys()];
  for (const guildId of ids) {
    const guild = client.guilds.cache.get(guildId);
    const key = { guildId, module: 'runtime', component: 'guild-access', code: 'guild-unavailable' };
    if (!guild) {
      await report(client, {
        ...key,
        severity: 'critical',
        message: 'Expected guild is not available to this Goliath instance.',
      });
    } else {
      await recover(client, key, { guild: guild.name });
    }
  }
}

async function checkSocial(client, guild, config) {
  const social = config?.modules?.social;
  if (!social || social.enabled === false) return;

  const interval = Math.max(60_000, Number(social.settings?.checkIntervalMs || 300_000));
  const staleAfter = Math.max(SOCIAL_MIN_STALE_MS, interval * SOCIAL_STALE_MULTIPLIER);

  for (const account of Object.values(social.accounts || {})) {
    if (!account || account.enabled === false) continue;
    const creator = Object.values(social.creators || {}).find(
      (item) => Array.isArray(item?.accountIds) && item.accountIds.includes(account.accountId)
    );
    if (creator?.enabled === false) continue;

    const lastChecked = Date.parse(account.state?.lastCheckedAt || '') || 0;
    const age = lastChecked ? Date.now() - lastChecked : Infinity;
    const base = {
      guildId: guild.id,
      guildName: guild.name,
      module: 'social',
      component: `${account.platform || 'unknown'}:${account.username || account.externalId || account.accountId}`,
      code: 'account-check-stale',
    };

    if (age > staleAfter) {
      await report(client, {
        ...base,
        severity: age > staleAfter * 2 ? 'critical' : 'error',
        message: 'Social account monitoring is stale and is no longer checking at the configured cadence.',
        details: {
          accountId: account.accountId,
          platform: account.platform,
          expectedIntervalMs: interval,
          staleAfterMs: staleAfter,
          lastCheckedAt: account.state?.lastCheckedAt || null,
          lastCheckStatus: account.state?.lastCheckStatus || null,
          lastError: account.state?.lastError || null,
        },
      });
    } else {
      await recover(client, base, {
        lastCheckedAt: account.state?.lastCheckedAt,
        lastCheckStatus: account.state?.lastCheckStatus,
      });
    }

    const deliveryBase = {
      ...base,
      code: 'delivery-failed',
      component: `${base.component}:delivery`,
    };
    if (account.state?.lastDeliveryError) {
      await report(client, {
        ...deliveryBase,
        severity: 'error',
        message: 'Social alert delivery has a recorded failure.',
        details: {
          accountId: account.accountId,
          error: account.state.lastDeliveryError,
          lastAlertChannelId: account.state.lastAlertChannelId || null,
        },
      });
    } else {
      await recover(client, deliveryBase, { accountId: account.accountId });
    }
  }
}

function adapterModuleKey(adapter) {
  const name = path.basename(adapter.file).replace(/Health\.js$/i, '');
  return ({ scheduledWelcome: 'welcome' })[name] || name;
}

function loadAdapter(adapter) {
  if (adapterCache.has(adapter.file)) return adapterCache.get(adapter.file);
  try {
    const loaded = require(adapter.file);
    adapterCache.set(adapter.file, loaded);
    return loaded;
  } catch (error) {
    const failed = { loadError: error };
    adapterCache.set(adapter.file, failed);
    return failed;
  }
}

function reportLooksUnhealthy(result) {
  return Boolean(
    result &&
      typeof result === 'object' &&
      (
        result.healthy === false ||
        result.ok === false ||
        Number(result.failed || result.failures || 0) > 0 ||
        (Array.isArray(result.issues) && result.issues.length > 0)
      )
  );
}

async function runHealthAdapters(client, guild, config) {
  for (const adapter of coverage.healthAdapters()) {
    const moduleKey = adapterModuleKey(adapter);
    if (config?.modules?.[moduleKey]?.enabled === false) continue;

    const loaded = loadAdapter(adapter);
    const base = {
      guildId: guild.id,
      guildName: guild.name,
      module: moduleKey,
      component: adapter.relative,
      code: 'health-adapter-failed',
    };

    if (loaded?.loadError) {
      await report(client, {
        ...base,
        severity: 'error',
        message: 'Module health adapter could not be loaded.',
        details: { error: cleanError(loaded.loadError) },
      });
      continue;
    }

    if (typeof loaded?.buildHealthReport !== 'function') continue;

    try {
      const result = await loaded.buildHealthReport(guild);
      if (reportLooksUnhealthy(result)) {
        await report(client, {
          ...base,
          severity: 'warning',
          message: 'Module health adapter reports an unhealthy state.',
          details: {
            summary: result.summary || result.status || null,
            issues: Array.isArray(result.issues) ? result.issues.slice(0, 5) : undefined,
          },
        });
      } else {
        await recover(client, base, { healthy: true });
      }
    } catch (error) {
      await report(client, {
        ...base,
        severity: 'error',
        message: 'Module health adapter threw while checking guild health.',
        details: { error: cleanError(error) },
      });
    }
  }
}

async function checkCoverage(client) {
  const current = coverage.coverageReport();
  const base = {
    module: 'sentinel',
    component: 'coverage',
    code: 'future-module-unregistered',
  };

  if (current.futureUnregistered.length) {
    await report(client, {
      ...base,
      severity: 'critical',
      message: 'New module folders exist outside the locked Goliath Sentinel module contracts.',
      details: { modules: current.futureUnregistered },
    });
  } else {
    await recover(client, base, {
      coveredModules: current.currentModules.length,
      healthAdapters: current.adapterFiles.length,
    });
  }
  return current;
}

async function checkPersistence(client) {
  const paths = ensureRuntimePaths(process.env.BOT_MODE);
  const probe = path.join(paths.temp, `.sentinel-write-${process.pid}.tmp`);
  const base = {
    module: 'runtime',
    component: 'persistence',
    code: 'runtime-write-failed',
  };

  try {
    fs.writeFileSync(probe, `${Date.now()}\n`);
    fs.readFileSync(probe, 'utf8');
    fs.unlinkSync(probe);
    await recover(client, base, { writable: true });
  } catch (error) {
    try {
      if (fs.existsSync(probe)) fs.unlinkSync(probe);
    } catch {}
    await report(client, {
      ...base,
      severity: 'critical',
      message: 'Goliath runtime storage failed a write/read verification probe.',
      details: { runtimeRoot: paths.root, error: cleanError(error) },
    });
  }
}

async function checkOtherHeartbeats(client) {
  const crossEnv = String(
    sentinelEnv('GOLIATH_SENTINEL_CROSS_ENV', 'GOLIATH_HEALTH_CROSS_ENV', 'true')
  ).toLowerCase();
  if (crossEnv === 'false' || Date.now() - startedAt < HEARTBEAT_STALE_MS * 2) return;

  const dir = sharedDir();
  for (const environment of ['DEV', 'BETA', 'PRODUCTION']) {
    if (environment === mode(client)) continue;
    const file = path.join(dir, `${environment.toLowerCase()}.json`);
    const base = {
      module: 'runtime',
      component: `cross-env:${environment}`,
      code: 'environment-heartbeat-stale',
    };
    let heartbeat = null;
    try {
      heartbeat = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {}
    const age = heartbeat?.at ? Date.now() - Date.parse(heartbeat.at) : Infinity;
    if (age > HEARTBEAT_STALE_MS) {
      await report(client, {
        ...base,
        severity: 'critical',
        message: `${environment} has stopped publishing a healthy Goliath Sentinel heartbeat.`,
        details: { lastHeartbeatAt: heartbeat?.at || null, observer: mode(client) },
      });
    } else {
      await recover(client, base, { lastHeartbeatAt: heartbeat.at, observer: mode(client) });
    }
  }
}

function summarySnapshot(client, coverageReport) {
  const memory = process.memoryUsage();
  return {
    at: new Date().toISOString(),
    environment: mode(client),
    pid: process.pid,
    uptimeSeconds: Math.floor(process.uptime()),
    node: process.version,
    host: os.hostname(),
    guildsCached: client.guilds.cache.size,
    expectedGuilds: expectedGuildIds(client).length || client.guilds.cache.size,
    memoryMb: Math.round(memory.rss / 1024 / 1024),
    modulesCovered: coverageReport?.currentModules?.length || 0,
    healthAdapters: coverageReport?.adapterFiles?.length || 0,
  };
}

async function maybeSendReport(client) {
  const now = new Date();
  if (now.getUTCHours() !== REPORT_HOUR_UTC) return;
  const dayKey = `daily:${now.toISOString().slice(0, 10)}`;
  const snapshot = store.snapshot();
  if (snapshot.reports?.[dayKey]) return;

  const open = Object.values(snapshot.incidents || {}).filter((item) => item.status === 'open');
  const critical = open.filter((item) => item.severity === 'critical').length;
  await notifier.send(
    client,
    {
      id: `REPORT-${mode(client)}-${now.toISOString().slice(0, 10)}`,
      environment: mode(client),
      severity: critical ? 'error' : 'info',
      module: 'sentinel',
      component: 'daily-report',
      message: `${client.guilds.cache.size} guild(s) monitored · ${open.length} open incident(s) · ${critical} critical.`,
      occurrences: 1,
      details: {
        uptime: `${Math.floor(process.uptime() / 3600)}h`,
        memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        openIncidentIds: open.slice(0, 8).map((item) => item.id).join(', ') || 'none',
      },
    },
    'open'
  );
  store.markReport(dayKey);
}

async function cycle(client) {
  const deep = Date.now() - lastDeepScanAt >= DEEP_SCAN_MS;
  const coverageReport = deep ? await checkCoverage(client) : coverage.coverageReport();
  await checkGuildAccess(client);
  for (const guild of client.guilds.cache.values()) {
    const config = guildConfig(guild.id);
    await checkSocial(client, guild, config);
    if (deep) await runHealthAdapters(client, guild, config);
  }
  if (deep) {
    await checkPersistence(client);
    lastDeepScanAt = Date.now();
  }
  const snapshot = summarySnapshot(client, coverageReport);
  store.recordHeartbeat(snapshot);
  writeSharedHeartbeat(client, snapshot);
  await checkOtherHeartbeats(client);
  await maybeSendReport(client);
  return snapshot;
}

function installProcessHooks(client) {
  if (processHooksInstalled) return;
  processHooksInstalled = true;
  process.on('uncaughtExceptionMonitor', (error, origin) =>
    report(client, {
      module: 'runtime',
      component: 'process',
      code: 'uncaught-exception',
      severity: 'critical',
      message: 'An uncaught exception reached the Node.js process.',
      details: { origin, error: cleanError(error) },
    }).catch(() => null)
  );
  client.on('error', (error) =>
    report(client, {
      module: 'discord',
      component: 'client',
      code: 'discord-client-error',
      severity: 'error',
      message: 'Discord client emitted an error.',
      details: { error: cleanError(error) },
    }).catch(() => null)
  );
  client.on('shardError', (error, shardId) =>
    report(client, {
      module: 'discord',
      component: `shard:${shardId}`,
      code: 'discord-shard-error',
      severity: 'critical',
      message: 'Discord gateway shard emitted an error.',
      details: { error: cleanError(error) },
    }).catch(() => null)
  );
}

async function start(client) {
  if (!client || timer) return false;
  clientRef = client;
  startedAt = Date.now();
  installProcessHooks(client);
  try {
    const snapshot = await cycle(client);
    terminal.success(
      `Goliath Sentinel started for ${snapshot.environment}: ${snapshot.guildsCached} guild(s), ${snapshot.modulesCovered} module contracts, ${snapshot.healthAdapters} health adapter(s).`
    );
  } catch (error) {
    terminal.error(`Goliath Sentinel initial cycle failed: ${error?.stack || error?.message || error}`);
  }
  timer = setInterval(
    () => cycle(client).catch((error) =>
      terminal.error(`Goliath Sentinel cycle failed: ${error?.stack || error?.message || error}`)
    ),
    HEALTH_TICK_MS
  );
  timer.unref?.();
  return true;
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  clientRef = null;
}

function status() {
  return {
    running: Boolean(timer),
    environment: mode(clientRef),
    startedAt: startedAt ? new Date(startedAt).toISOString() : null,
    incidents: store.snapshot(),
    coverage: coverage.coverageReport(),
  };
}

module.exports = { start, stop, cycle, status, report, recover };
