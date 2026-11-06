'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const USER = '123456789012345678';
const GUILD = '234567890123456789';
const MEMBER = '345678901234567890';

function birthdayRouter(canExport) {
  const routes = new Map();
  const express = { Router: () => ({
    get: (route, handler) => routes.set('GET ' + route, handler),
    put: (route, handler) => routes.set('PUT ' + route, handler),
    patch: () => {}, post: () => {}, delete: () => {}
  }) };
  const birthday = { userId: MEMBER, month: 7, day: 14, year: 1991, listPublic: true, announce: true, showAge: false };
  const section = { members: { [MEMBER]: birthday }, analytics: {}, settings: {} };
  const modules = {
    express,
    '../../../../core/guild/guildManager': { isModuleEnabled: () => true },
    '../../../../modules/communityStudio/birthdays/birthdays': {
      getSection: () => section,
      listUpcoming: () => [{ member: birthday, daysUntil: 5, next: '2027-07-14' }],
      buildHealth: async () => ({}),
      setBirthday: () => birthday,
      exportData: () => ({ birthdays: section })
    },
    '../../../../core/security/protection/permissions': {
      validateRoleSelection: () => ({}), isGoliathPermissionError: () => false
    },
    '../../../middleware/dashboardAccess': {
      resolveGuildAccess: async () => ({ allowed: true, permissions: canExport ? ['admin.dashboard.view', 'admin.birthdays.export'] : ['admin.dashboard.view'] })
    }
  };
  const filename = path.join(__dirname, '..', 'src/server/routes/modules/communityStudio/birthdays.js');
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, console,
    require: (name) => {
      if (!Object.hasOwn(modules, name)) throw new Error('Unexpected import: ' + name);
      return modules[name];
    }
  }, { filename });
  return routes;
}

async function call(routes, method, route) {
  const req = {
    params: { guildId: GUILD, userId: MEMBER },
    session: { user: { id: USER } },
    client: { guilds: { cache: new Map() } },
    body: { birthday: { month: 7, day: 14, year: 1991 } }
  };
  const res = {
    code: 200, headers: {},
    status(code) { this.code = code; return this; },
    json(value) { this.body = value; return this; },
    set(name, value) { this.headers[name] = value; return this; },
    setHeader(name, value) { this.headers[name] = value; return this; },
    send(value) { this.body = value; return this; }
  };
  await routes.get(method + ' ' + route)(req, res);
  return res;
}

test('birthday overview redacts years in every returned collection', async () => {
  const response = await call(birthdayRouter(false), 'GET', '/:guildId/overview');
  assert.equal(response.code, 200);
  assert.equal(response.body.config.members[MEMBER].year, null);
  assert.equal(response.body.overview.members[0].year, null);
  assert.equal(response.body.overview.upcoming[0].year, null);
});

test('birthday overview includes years when explicitly authorised', async () => {
  const response = await call(birthdayRouter(true), 'GET', '/:guildId/overview');
  assert.equal(response.body.config.members[MEMBER].year, 1991);
  assert.equal(response.body.overview.members[0].year, 1991);
  assert.equal(response.body.overview.upcoming[0].year, 1991);
});

test('birthday update response does not leak the saved birth year', async () => {
  const response = await call(birthdayRouter(false), 'PUT', '/:guildId/members/:userId');
  assert.equal(response.code, 200);
  assert.equal(response.body.saved.year, null);
});

test('birthday export rejects users without the export permission', async () => {
  const response = await call(birthdayRouter(false), 'GET', '/:guildId/export');
  assert.equal(response.code, 403);
});

test('birthday export allows users with the export permission', async () => {
  const response = await call(birthdayRouter(true), 'GET', '/:guildId/export');
  assert.equal(response.code, 200);
  assert.equal(JSON.parse(response.body).birthdays.members[MEMBER].year, 1991);
});
