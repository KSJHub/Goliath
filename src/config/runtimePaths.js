const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_DATA_ROOT = path.join(PROJECT_ROOT, 'src', 'runtime');

function resolveBotMode(botMode = process.env.BOT_MODE) {
  const rawMode = botMode && typeof botMode === 'object'
    ? botMode.botMode || botMode.mode || botMode.runtimeMode || 'DEV'
    : botMode;
  const mode = String(rawMode || 'DEV').trim().toUpperCase();

  if (mode === 'PRODUCTION' || mode === 'PROD') return 'production';
  if (mode === 'BETA') return 'beta';
  return 'dev';
}

/*
 * Runtime data is intentionally deployment-local.
 *
 * VPS layout:
 *   /home/goliath/dev/src/runtime/dev
 *   /home/goliath/beta/src/runtime/beta
 *   /home/goliath/production/src/runtime/production
 *
 * Local installs follow the same PROJECT_ROOT/src/runtime/<mode> layout.
 * Do not move guild/runtime data to a shared parent GoliathData directory.
 */
function getRuntimeRoot(botMode = process.env.BOT_MODE) {
  return path.join(DEFAULT_DATA_ROOT, resolveBotMode(botMode));
}

/* ---------------- PATHS ---------------- */

function getRuntimePaths(botMode = process.env.BOT_MODE) {
  const root = getRuntimeRoot(botMode);

  return {
    root,

    /* Core Storage */

    data: path.join(root, 'data'),
    logs: path.join(root, 'logs'),
    backups: path.join(root, 'backups'),
    database: path.join(root, 'database'),
    guilds: path.join(root, 'guilds'),
    cache: path.join(root, 'cache'),
    temp: path.join(root, 'temp'),

    /* Specific Systems */

    security: path.join(root, 'security'),
    incidents: path.join(root, 'incidents'),
    recovery: path.join(root, 'recovery'),
    translation: path.join(root, 'translation'),

    /* Log Categories */

    commandLogs: path.join(root, 'logs', 'commands'),
    moderationLogs: path.join(root, 'logs', 'moderation'),
    securityLogs: path.join(root, 'logs', 'security'),
    crashLogs: path.join(root, 'logs', 'crash'),
  };
}

/* ---------------- ENSURE ---------------- */

function ensureRuntimePaths(botMode = process.env.BOT_MODE) {
  const runtimePaths = getRuntimePaths(botMode);

  for (const folderPath of Object.values(runtimePaths)) {
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, {
        recursive: true,
      });
    }
  }

  return runtimePaths;
}

/* ---------------- HELPERS ---------------- */

function resolveRuntimePath(
  botMode,
  ...segments
) {
  return path.join(
    getRuntimeRoot(botMode),
    ...segments
  );
}

module.exports = {
  PROJECT_ROOT,
  DEFAULT_DATA_ROOT,
  resolveBotMode,
  getRuntimeRoot,
  getRuntimePaths,
  ensureRuntimePaths,
  resolveRuntimePath,
};
