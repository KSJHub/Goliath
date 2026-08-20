const fs = require('node:fs');
const path = require('node:path');
const { resolveBotMode, getRuntimePaths } = require('../config/runtimePaths');

/* ---------------- DIRECTORY HELPERS ---------------- */

function ensureDir(dirPath) {
  if (!dirPath) {
    throw new Error('ensureDir received invalid path');
  }

  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  return dirPath;
}

function validatePath(pathToCheck, label) {
  if (!fs.existsSync(pathToCheck)) {
    throw new Error(`Missing required path: ${label}`);
  }

  console.log(`✅ Path OK: ${label}`);
  return true;
}

function validateEnv(name) {
  const value = process.env[name];

  if (!value || !String(value).trim()) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  console.log(`✅ ENV OK: ${name}`);
  return true;
}

/* ---------------- SAFE MODULE LOADER ---------------- */

function safeLoad(label, loadFn, logger = console) {
  try {
    const result = loadFn();
    logger.log(`✅ ${label} loaded`);
    return { ok: true, label, result, error: null };
  } catch (error) {
    logger.error(`❌ ${label} failed to load`);
    logger.error(error);
    return { ok: false, label, result: null, error };
  }
}

/* ---------------- EVENT REGISTRATION ---------------- */

function registerEvents(client, options = {}) {
  const eventsPath = options.eventsPath || path.join(process.cwd(), 'src', 'events');
  const prepareInteraction = typeof options.prepareInteraction === 'function'
    ? options.prepareInteraction
    : async () => null;

  if (!fs.existsSync(eventsPath)) return { files: 0, groups: 0 };

  // Embed interactions import embedPanel directly, so install the shared media
  // runtime before event modules are required. This guarantees every consumer
  // sees the same initialized panel API (including buildMediaManagerPanel).
  try {
    require('../modules/messageStudio/embed/embed');
  } catch (error) {
    console.warn('⚠️ Embed Studio runtime initialization failed before event registration');
    console.warn(error?.stack || error?.message || error);
  }

  const files = [];
  const grouped = new Map();
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(full);
  });

  walk(eventsPath);
  files.sort((a, b) => a.localeCompare(b));

  for (const file of files) {
    try {
      const loaded = require(file);
      for (const handler of (Array.isArray(loaded) ? loaded : [loaded])) {
        if (!handler?.name || typeof handler.execute !== 'function') continue;
        const eventName = String(handler.name);
        const groupKey = `${eventName}:${handler.once === true ? 'once' : 'on'}`;
        if (!grouped.has(groupKey)) grouped.set(groupKey, { eventName, once: handler.once === true, handlers: [] });
        grouped.get(groupKey).handlers.push({ file, execute: handler.execute });
      }
    } catch (error) {
      console.warn(`⚠️ Event skipped: ${file}`);
      console.warn(error?.message || error);
    }
  }

  for (const { eventName, once, handlers } of grouped.values()) {
    const listener = async (...args) => {
      if (eventName === 'interactionCreate') await prepareInteraction(args[0]);
      for (const handler of handlers) {
        try { await handler.execute(...args, client); }
        catch (error) {
          console.error(`[Events] ${eventName} handler failed: ${handler.file}`);
          console.error(error?.stack || error?.message || error);
        }
      }
    };
    if (once) client.once(eventName, listener); else client.on(eventName, listener);
  }

  return { files: files.length, groups: grouped.size };
}

/* ---------------- GUILD STARTUP SYNC ---------------- */

function archiveStaleGuildFiles(client, botMode, logger = console) {
  const runtimePaths = getRuntimePaths(resolveBotMode(botMode || process.env.BOT_MODE || 'DEV'));
  const guildsDir = runtimePaths.guilds;
  if (!guildsDir || !fs.existsSync(guildsDir)) return { active: 0, archived: 0, skipped: 0 };

  const activeIds = new Set(
    [...(client?.guilds?.cache?.keys?.() || [])].map((id) => String(id)),
  );
  const candidates = fs.readdirSync(guildsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^\d{16,20}\.json$/.test(entry.name));
  const stale = candidates.filter((entry) => !activeIds.has(entry.name.replace(/\.json$/, '')));

  if (!stale.length) {
    logger.log(`[Guild Runtime] Active guild JSONs aligned: ${candidates.length}/${activeIds.size}.`);
    return { active: candidates.length, archived: 0, skipped: 0 };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archiveDir = ensureDir(path.join(guildsDir, 'archived', stamp));
  let archived = 0;
  let skipped = 0;

  for (const entry of stale) {
    const source = path.join(guildsDir, entry.name);
    const target = path.join(archiveDir, entry.name);
    try {
      fs.renameSync(source, target);
      archived += 1;
    } catch (error) {
      skipped += 1;
      logger.warn(`[Guild Runtime] Could not archive stale guild file ${entry.name}: ${error?.message || error}`);
    }
  }

  logger.log(`[Guild Runtime] Archived ${archived} stale guild JSON file(s); ${activeIds.size} live guild(s) remain.${skipped ? ` ${skipped} file(s) could not be moved.` : ''}`);
  return { active: activeIds.size, archived, skipped, archiveDir };
}

async function syncStartupGuilds(client, options = {}) {
  const enforceGuildAccess = typeof options.enforceGuildAccess === 'function'
    ? options.enforceGuildAccess
    : async () => true;
  const guildManager = options.guildManager || {};
  const resourceManager = options.resourceManager || {};
  const botMode = options.botMode;
  const config = options.config;

  const results = [];

  for (const guild of client?.guilds?.cache?.values?.() || []) {
    try {
      await enforceGuildAccess(guild, botMode, config);
      guildManager.syncGuildMeta?.(guild);
      await resourceManager.syncDiscordResources?.(guild);
      results.push({ guildId: guild.id, ok: true });
    } catch (error) {
      console.error(`Guild startup sync failed for ${guild?.id}:`, error?.message || error);
      results.push({ guildId: guild?.id || null, ok: false, error });
    }
  }

  try {
    archiveStaleGuildFiles(client, botMode, options.logger || console);
  } catch (error) {
    console.warn('[Guild Runtime] Stale guild archive pass failed:', error?.message || error);
  }

  return results;
}

/* ---------------- STARTUP TASKS ---------------- */

async function runStartupTask(label, fn, logger = console) {
  try {
    const result = await fn();
    logger.log(`✅ ${label} startup complete`);
    return { ok: true, label, result, error: null };
  } catch (error) {
    logger.error(`❌ ${label} startup failed`);
    logger.error(error?.stack || error?.message || error);
    return { ok: false, label, result: null, error };
  }
}

/* ---------------- MODE / RUNTIME ---------------- */

function normalizeModeValue(mode) {
  if (mode && typeof mode === 'object') {
    return mode.botMode || mode.mode || mode.runtimeMode || 'DEV';
  }

  return mode || 'DEV';
}

function bootstrapRuntime(mode = 'DEV') {
  const modeKey = resolveBotMode(mode);
  const runtimePaths = getRuntimePaths(modeKey);

  const paths = {
    root: runtimePaths.root,
    backups: runtimePaths.backups,
    data: runtimePaths.data,
    database: runtimePaths.database,
    guilds: runtimePaths.guilds,
    logs: runtimePaths.logs,
    security: runtimePaths.security,
  };

  const requiredDirectories = [
    paths.root,
    paths.backups,
    paths.data,
    paths.database,
    paths.guilds,
    paths.logs,
    paths.security,
  ];

  for (const dir of requiredDirectories) {
    ensureDir(dir);
  }

  console.log(`✅ Runtime folders ready: ${paths.root}`);

  return {
    mode: modeKey,
    ...paths,
  };
}

/* ---------------- BOOT VALIDATION ---------------- */

function runBootValidation(config = {}) {
  const { requiredPaths = [], requiredEnv = [] } = config;

  console.log('🩺 Running boot validation...');

  for (const item of requiredPaths) {
    validatePath(item.path, item.label);
  }

  for (const envName of requiredEnv) {
    validateEnv(envName);
  }

  console.log('✅ Boot validation complete.');
  return true;
}

/* ---------------- STARTUP FINGERPRINT ---------------- */

function getStartupFingerprint(mode, runtimePaths = {}) {
  const modeValue = normalizeModeValue(mode);

  return {
    botMode: String(modeValue || 'UNKNOWN').toUpperCase(),
    runtimeMode: runtimePaths.mode || 'unknown',
    runtimeRoot: runtimePaths.root || 'unknown',
    nodeVersion: process.version,
    platform: process.platform,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };
}

function printStartupFingerprint(mode, runtimePaths = {}) {
  const fingerprint = getStartupFingerprint(mode, runtimePaths);

  console.log('============================================================');
  console.log('🧠 Goliath Startup Fingerprint');
  console.log(`🧠 Bot Mode: ${fingerprint.botMode}`);
  console.log(`🧠 Runtime Mode: ${fingerprint.runtimeMode}`);
  console.log(`🧠 Runtime Root: ${fingerprint.runtimeRoot}`);
  console.log(`🧠 Node: ${fingerprint.nodeVersion}`);
  console.log(`🧠 Platform: ${fingerprint.platform}`);
  console.log(`🧠 PID: ${fingerprint.pid}`);
  console.log(`🧠 Started At: ${fingerprint.startedAt}`);
  console.log('============================================================');

  return fingerprint;
}

/* ---------------- EXPORTS ---------------- */

module.exports = {
  bootstrapRuntime,
  runBootValidation,
  safeLoad,
  registerEvents,
  archiveStaleGuildFiles,
  syncStartupGuilds,
  runStartupTask,
  printStartupFingerprint,
};
