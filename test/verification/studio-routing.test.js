'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

const interactionCreate = read('src/events/interactions/interactionCreate.js');
const moduleAdminPanels = read('src/core/admin/functions/moduleAdminPanels.js');
const giveawaysAdminPanel = read('src/modules/communityStudio/giveaways/giveawaysAdminPanel.js');
const privateRoomsPanel = read('src/modules/utilityStudio/privateRooms/privateRoomsPanel.js');
const birthdaysPanel = read('src/modules/communityStudio/birthdays/birthdaysPanel.js');
const birthdaysViews = read('src/modules/communityStudio/birthdays/birthdaysViews.js');

test('Community Studio keeps Birthdays and Giveaways entry routes', () => {
  assert.match(moduleAdminPanels, /key: 'birthdays', studio: 'communityStudio', route: 'admin:birthdays'/);
  assert.match(moduleAdminPanels, /key: 'giveaways', studio: 'communityStudio', route: 'admin:giveaways'/);
});

test('Utility Studio keeps Private Rooms entry route', () => {
  assert.match(moduleAdminPanels, /key: 'privateRooms', studio: 'utilityStudio', route: 'admin:privateRooms'/);
  assert.match(moduleAdminPanels, /'polls', 'privateRooms', 'reactionRoles'/);
});

test('Giveaways admin panel returns directly to Community Studio', () => {
  assert.match(giveawaysAdminPanel, /admin:studio:communityStudio/);
  assert.match(giveawaysAdminPanel, /handleGiveawaysAdminInteraction/);
});

test('central interaction router owns Giveaways, Birthdays and Private Rooms routing', () => {
  assert.match(interactionCreate, /giveawaysInteractionHandler/);
  assert.match(interactionCreate, /birthdaysPanel/);
  assert.match(interactionCreate, /privateRoomsPanel/);
  assert.match(interactionCreate, /customId\.startsWith\('admin:birthdays'\)/);
  assert.match(interactionCreate, /customId\.startsWith\('admin:privateRooms'\)/);
});

test('Private Rooms admin panel returns directly to Utility Studio', () => {
  assert.match(privateRoomsPanel, /admin:studio:utilityStudio/);
  assert.match(privateRoomsPanel, /handleAdminInteraction/);
});

test('Birthdays admin panel keeps a Community Studio return route', () => {
  assert.match(birthdaysViews, /admin:studio:communityStudio/);
  assert.match(birthdaysPanel, /handleAdmin/);
});

test('Birthday user panel does not expose admin-only settings', () => {
  const userPayloadSource = birthdaysViews.match(/function userPayload\(interaction\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(userPayloadSource, /Your Birthday/);
  assert.doesNotMatch(userPayloadSource, /Role:/);
  assert.doesNotMatch(userPayloadSource, /Channel:/);
  assert.doesNotMatch(userPayloadSource, /announcementTime/);
  assert.doesNotMatch(userPayloadSource, /timezone/);
  assert.doesNotMatch(userPayloadSource, /Server birthday timezone/);
});

test('Birthday settings panel keeps module toggle and data tools layout', () => {
  assert.match(birthdaysPanel, /admin:birthdays:enable/);
  assert.match(birthdaysPanel, /admin:birthdays:disable/);
  assert.match(birthdaysPanel, /setModuleEnabled\(interaction\.guild\.id, 'birthdays'/);
  assert.match(birthdaysViews, /button\(`admin:birthdays:\$\{enabled \? 'disable' : 'enable'\}`/);
  assert.match(birthdaysViews, /button\('admin:birthdays:import', '📥 Import'\), button\('admin:birthdays:export', '📤 Export'\)/);
  assert.match(birthdaysViews, /row\(button\('admin:birthdays', '⬅️ Back'\)\)/);
});

test('Birthday user action buttons stay routed', () => {
  assert.match(interactionCreate, /customId\.startsWith\('birthdays:user:'\)/);
  assert.match(birthdaysPanel, /id === 'birthdays:user:open'/);
  assert.match(birthdaysPanel, /id === 'birthdays:user:set'/);
  assert.match(birthdaysPanel, /showModal\(birthdayModal\(record\)\)/);
  assert.match(birthdaysPanel, /id === 'birthdays:user:privacy'/);
  assert.match(birthdaysPanel, /id === 'birthdays:user:remove'/);
  assert.match(birthdaysPanel, /id === 'birthdays:user:upcoming'/);
});
