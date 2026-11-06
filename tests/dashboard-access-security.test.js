'use strict';

// Isolated access-control regression tests: no Discord connection or database writes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const USER = '123456789012345678';
const GUILD = '234567890123456789';
const OTHER = '345678901234567890';
const flags = { Administrator: 1, ManageGuild: 2, ModerateMembers: 4, KickMembers: 8, BanMembers: 16 };

function loadMiddleware(permissions, options = {}) {
  const file = path.join(__dirname, '..', 'src/server/middleware/dashboardAccess.js');
  const code = fs.readFileSync(file, 'utf8');
  const guild = {
    id: GUILD, ownerId: '456789012345678901',
    members: { fetch: async () => options.revoked ? null : ({
      user: { id: USER }, permissions: { has: (flag) => Boolean(options.nativeFlags?.includes(flag)) }
    }) }
  };
  const client = { guilds: { cache: new Map([[GUILD, guild]]) } };
  const module = { exports: {} };
  const context = { module, exports: module.exports, console, require: (name) => {
    if (name === 'discord.js') return { PermissionFlagsBits: flags };
    if (name.endsWith('/security/protection/core')) return { isBotOwner: () => false };
    if (name.endsWith('/administration/admin/panel')) return {
      getAuthorityContext: () => ({ source: 'configured', highestTier: 'moderator', permissions: new Set(permissions) })
    };
    throw new Error('Unexpected dependency: ' + name);
  } };
  vm.runInNewContext(code, context, { filename: file });
  return { ...module.exports, client };
}

async function request(permissions, base, options = {}) {
  const { requireDashboardAccess, client } = loadMiddleware(permissions, options);
  const req = {
    client, session: { user: { id: USER } }, method: 'GET',
    path: '/' + (options.guildId || GUILD), query: {}, body: {}
  };
  const response = { statusCode: 200, headers: {},
    set(key, value) { this.headers[key] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
  let nextCalled = false;
  await requireDashboardAccess(base)(req, response, () => { nextCalled = true; });
  return { status: response.statusCode, nextCalled };
}

test('case route needs case-view and a staff dashboard entry permission', async () => {
  assert.equal((await request(['mod.panel.view', 'mod.cases.view'], '/api/cases')).nextCalled, true);
  assert.equal((await request(['mod.panel.view'], '/api/cases')).status, 403);
  assert.equal((await request(['mod.cases.view'], '/api/cases')).status, 403);
});

test('moderation panel remains independently permissioned', async () => {
  assert.equal((await request(['mod.panel.view'], '/api/moderation')).nextCalled, true);
  assert.equal((await request(['admin.dashboard.view', 'mod.cases.view'], '/api/moderation')).status, 403);
});

test('revoked membership and cross-guild access are denied', async () => {
  assert.equal((await request(['mod.panel.view', 'mod.cases.view'], '/api/cases', { revoked: true })).status, 403);
  assert.equal((await request(['mod.panel.view', 'mod.cases.view'], '/api/cases', { guildId: OTHER })).status, 403);
});

test('birthday dashboard needs dashboard access; export has an additional route-level permission check', async () => {
  assert.equal((await request(['admin.dashboard.view'], '/api/modules')).nextCalled, true);
  assert.equal((await request(['mod.panel.view'], '/api/modules')).status, 403);
  const birthdays = fs.readFileSync(path.join(__dirname, '..', 'src/server/routes/modules/communityStudio/birthdays.js'), 'utf8');
  assert.match(birthdays, /admin\\.birthdays\\.export/);
  assert.match(birthdays, /year: canViewYear \\? item\\.member\\.year : null/);
  assert.match(birthdays, /members: Object\\.fromEntries/);
  assert.match(birthdays, /saved: visibleSaved/);
});
