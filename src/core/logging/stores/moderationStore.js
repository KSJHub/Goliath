const fs = require('node:fs');
const path = require('node:path');
const { resolveRuntimePath } = require('../../../config/runtimePaths');
const Database = require('better-sqlite3');

const dataDir = resolveRuntimePath(
  process.env.BOT_MODE,
  'database'
);

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, {
    recursive: true,
  });
}

const dbPath = path.join(
  dataDir,
  'moderation.sqlite'
);

const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS cases (
    case_id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    moderator_id TEXT NOT NULL,
    action TEXT NOT NULL,
    reason TEXT,
    metadata TEXT,
    status TEXT DEFAULT 'active',
    related_case_id INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS warnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    moderator_id TEXT NOT NULL,
    reason TEXT,
    case_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT
  );

  CREATE TABLE IF NOT EXISTS pending_actions (
    token TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    moderator_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    type TEXT NOT NULL,
    payload TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_cases_guild_user
    ON cases(guild_id, user_id);

  CREATE INDEX IF NOT EXISTS idx_cases_guild_case
    ON cases(guild_id, case_id);

  CREATE INDEX IF NOT EXISTS idx_warnings_guild_user
    ON warnings(guild_id, user_id);

  CREATE INDEX IF NOT EXISTS idx_warnings_guild_case
    ON warnings(guild_id, case_id);

  CREATE INDEX IF NOT EXISTS idx_pending_guild_token
    ON pending_actions(guild_id, token);
`);

module.exports = db;
