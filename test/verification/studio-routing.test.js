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
