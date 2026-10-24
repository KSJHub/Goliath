'use strict';

// Exercise the APIs affected by dependency overrides without live credentials or guild data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { Readable } = require('node:stream');
const Database = require('better-sqlite3');
const fetch = require('node-fetch');
const { google } = require('googleapis');

async function main() {
  const lock = require('../package-lock.json');
  for (const [name, entry] of Object.entries(lock.packages)) {
    assert(!entry.deprecated, `Deprecated dependency remains: ${name}`);
    assert(!name.endsWith('/prebuild-install'), 'Legacy SQLite installer remains');
  }
  const googleFetchPath = require.resolve('node-fetch', { paths: [path.dirname(require.resolve('gaxios'))] });
  const googleFetch = await import(require('node:url').pathToFileURL(googleFetchPath).href);
  const blobFromPath = require.resolve('fetch-blob/from.js', { paths: [path.dirname(googleFetchPath)] });
  const { fileFromSync } = await import(require('node:url').pathToFileURL(blobFromPath).href);
  const domPath = require.resolve('node-domexception', { paths: [path.dirname(blobFromPath)] });
  assert.equal(require(domPath), globalThis.DOMException);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'goliath-dependency-'));
  const databasePath = path.join(directory, 'existing.sqlite');
  let db;
  let server;
  try {
    db = new Database(databasePath);
    db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');
    db.prepare('INSERT INTO settings VALUES (?, ?)').run('preserved', 'yes');
    db.close();
    db = new Database(databasePath);
    assert.equal(db.prepare('SELECT value FROM settings WHERE key = ?').get('preserved').value, 'yes');
    assert.throws(db.transaction(() => { db.prepare('UPDATE settings SET value = ?').run('no'); throw Error('rollback'); }), /rollback/);
    assert.equal(db.prepare('SELECT value FROM settings').get().value, 'yes');
    const backupPath = path.join(directory, 'backup.sqlite');
    await db.backup(backupPath);
    const backup = new Database(backupPath, { readonly: true });
    try { assert.equal(backup.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); }
    finally { backup.close(); }
    const filePath = path.join(directory, 'fixture.txt');
    fs.writeFileSync(filePath, 'fixture');
    const file = fileFromSync(filePath);
    assert.equal(await file.text(), 'fixture');
    fs.appendFileSync(filePath, 'changed');
    await assert.rejects(file.text(), error => error instanceof DOMException && error.name === 'NotReadableError');

    server = http.createServer(async (request, response) => {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname === '/slow') return; // Closed by the client timeout, below.
      if (url.pathname === '/redirect') { response.writeHead(302, { Location: '/bytes' }); response.end(); return; }
      if (url.pathname === '/bytes' || url.searchParams.get('alt') === 'media') { response.end('fixture'); return; }
      if (request.method === 'POST') {
        let body = '';
        for await (const chunk of request) body += chunk;
        assert(body.includes('fixture'), 'Drive streaming upload lost the source body');
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ id: 'uploaded' }));
        return;
      }
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ files: [{ id: 'folder', name: 'guilds' }] }));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const root = `http://127.0.0.1:${server.address().port}`;
    const agent = new http.Agent({ lookup: (hostname, options, callback) => {
      assert.equal(hostname, 'goliath.invalid');
      if (options?.all) callback(null, [{ address: '127.0.0.1', family: 4 }]);
      else callback(null, '127.0.0.1', 4);
    } });
    try {
      const pinned = await fetch(root.replace('127.0.0.1', 'goliath.invalid') + '/bytes', { agent });
      assert.equal((await pinned.buffer()).toString(), 'fixture');
    } finally { agent.destroy(); }
    assert.equal((await fetch(root + '/redirect', { redirect: 'manual' })).status, 302);
    assert.equal(await (await fetch(root + '/redirect')).text(), 'fixture');
    await assert.rejects(fetch(root + '/slow', { timeout: 30 }), error => error.type === 'request-timeout');
    const controller = new AbortController();
    const pending = fetch(root + '/slow', { signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, error => error.name === 'AbortError');
    assert.equal(await (await googleFetch.default(root + '/bytes')).text(), 'fixture');

    const drive = google.drive({ version: 'v3', rootUrl: root + '/', retry: false, timeout: 2000,
      fetchImplementation: (url, options) => {
        // The SDK rewrites media uploads after rootUrl; redirect its transport to the fixture too.
        const target = new URL(url);
        assert([root, 'https://www.googleapis.com'].includes(target.origin));
        return googleFetch.default(root + target.pathname + target.search, { ...options, agent: undefined });
      }
    });
    assert.equal((await drive.files.list({ fields: 'files(id,name)' })).data.files[0].id, 'folder');
    const upload = await drive.files.create({ requestBody: { name: 'fixture' }, media: { mimeType: 'text/plain', body: Readable.from(['fixture']) }, fields: 'id' });
    assert.equal(upload.data.id, 'uploaded');
    const download = await drive.files.get({ fileId: 'uploaded', alt: 'media' }, { responseType: 'stream' });
    let downloaded = '';
    for await (const chunk of download.data) downloaded += chunk;
    assert.equal(downloaded, 'fixture');
    console.log('✅ Dependency runtime audit: SQLite persistence/rollback/backup, native DOMException, pinned-agent downloads, redirects, timeouts, aborts and Drive list/upload/download');
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (db?.open) db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
