'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const session = require('express-session');

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;

function sessionExpiry(sessionData, now = Date.now()) {
  const cookie = sessionData?.cookie || {};
  if (cookie.expires) {
    const expiresAt = new Date(cookie.expires).getTime();
    if (Number.isFinite(expiresAt)) return expiresAt;
  }
  if (Number.isFinite(Number(cookie.maxAge))) return now + Number(cookie.maxAge);
  return now + DEFAULT_TTL_MS;
}

class SQLiteSessionStore extends session.Store {
  constructor(options = {}) {
    super();
    if (!options.dbPath) throw new Error('SQLiteSessionStore requires dbPath');

    this.dbPath = path.resolve(options.dbPath);
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS dashboard_sessions (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expire INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_dashboard_sessions_expire
        ON dashboard_sessions(expire);
    `);

    this.statements = {
      get: this.db.prepare('SELECT sess, expire FROM dashboard_sessions WHERE sid = ?'),
      set: this.db.prepare(`
        INSERT INTO dashboard_sessions (sid, sess, expire)
        VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire
      `),
      destroy: this.db.prepare('DELETE FROM dashboard_sessions WHERE sid = ?'),
      touch: this.db.prepare('UPDATE dashboard_sessions SET expire = ? WHERE sid = ?'),
      clear: this.db.prepare('DELETE FROM dashboard_sessions'),
      length: this.db.prepare('SELECT COUNT(*) AS count FROM dashboard_sessions WHERE expire > ?'),
      all: this.db.prepare('SELECT sess FROM dashboard_sessions WHERE expire > ?'),
      cleanup: this.db.prepare('DELETE FROM dashboard_sessions WHERE expire <= ?'),
    };

    this.cleanup();
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref?.();
  }

  cleanup(now = Date.now()) {
    try {
      this.statements.cleanup.run(now);
    } catch (error) {
      console.warn(`[SessionStore] Cleanup failed: ${error?.message || error}`);
    }
  }

  get(sid, callback) {
    try {
      const row = this.statements.get.get(sid);
      if (!row || row.expire <= Date.now()) {
        if (row) this.statements.destroy.run(sid);
        callback?.(null, null);
        return;
      }
      callback?.(null, JSON.parse(row.sess));
    } catch (error) {
      callback?.(error);
    }
  }

  set(sid, sessionData, callback) {
    try {
      this.statements.set.run(sid, JSON.stringify(sessionData), sessionExpiry(sessionData));
      callback?.(null);
    } catch (error) {
      callback?.(error);
    }
  }

  destroy(sid, callback) {
    try {
      this.statements.destroy.run(sid);
      callback?.(null);
    } catch (error) {
      callback?.(error);
    }
  }

  touch(sid, sessionData, callback) {
    try {
      this.statements.touch.run(sessionExpiry(sessionData), sid);
      callback?.(null);
    } catch (error) {
      callback?.(error);
    }
  }

  clear(callback) {
    try {
      this.statements.clear.run();
      callback?.(null);
    } catch (error) {
      callback?.(error);
    }
  }

  length(callback) {
    try {
      const row = this.statements.length.get(Date.now());
      callback?.(null, Number(row?.count || 0));
    } catch (error) {
      callback?.(error);
    }
  }

  all(callback) {
    try {
      const sessions = this.statements.all.all(Date.now()).map((row) => JSON.parse(row.sess));
      callback?.(null, sessions);
    } catch (error) {
      callback?.(error);
    }
  }

  close() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = null;
    this.db?.close();
  }
}

function createSQLiteSessionStore(runtimePaths) {
  if (!runtimePaths?.database) throw new Error('Runtime database path is unavailable');
  return new SQLiteSessionStore({
    dbPath: path.join(runtimePaths.database, 'sessions.sqlite'),
  });
}

module.exports = {
  SQLiteSessionStore,
  createSQLiteSessionStore,
  sessionExpiry,
};
