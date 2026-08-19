'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { SQLiteSessionStore } = require('../../src/server/session/sqliteSessionStore');

function callStore(store, method, ...args) {
  return new Promise((resolve, reject) => {
    store[method](...args, (error, value) => {
      if (error) reject(error);
      else resolve(value);
    });
  });
}

test('dashboard sessions persist in SQLite and support lifecycle operations', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goliath-session-'));
  const dbPath = path.join(tempDir, 'sessions.sqlite');
  const store = new SQLiteSessionStore({ dbPath });

  t.after(() => {
    store.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const sessionData = {
    cookie: { maxAge: 60_000 },
    user: { id: '123' },
  };

  await callStore(store, 'set', 'session-1', sessionData);
  assert.equal(fs.existsSync(dbPath), true);

  const loaded = await callStore(store, 'get', 'session-1');
  assert.deepEqual(loaded.user, { id: '123' });

  assert.equal(await callStore(store, 'length'), 1);
  assert.equal((await callStore(store, 'all')).length, 1);

  await callStore(store, 'touch', 'session-1', sessionData);
  await callStore(store, 'destroy', 'session-1');
  assert.equal(await callStore(store, 'get', 'session-1'), null);
});

test('production server uses persistent sessions and refuses the development secret fallback', () => {
  const serverSource = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');

  assert.match(serverSource, /createSQLiteSessionStore/);
  assert.match(serverSource, /store:\s*sessionStore/);
  assert.match(serverSource, /SESSION_SECRET or DASHBOARD_SESSION_SECRET is required when NODE_ENV=production/);
  assert.match(serverSource, /configuredSessionSecret \|\| 'goliath-dev-session-secret'/);
});
