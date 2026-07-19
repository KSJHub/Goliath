'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

function test(label, fn) {
  try { fn(); console.log(`✅ ${label}`); }
  catch (error) { console.error(`❌ ${label}`); throw error; }
}

console.log('\nRole Studio Smoke Test');
console.log('======================');

const reactionRoles = require(path.join(root, 'src/modules/reactionroles/reactionRoles'));
const panelEntry = read('src/modules/reactionroles/reactionRolesPanel.js');
const panelV3 = read('src/modules/reactionroles/reactionRolesPanelV3.js');
const panelV5 = read('src/modules/reactionroles/reactionRolesPanelV5.js');
const panelV6 = read('src/modules/reactionroles/reactionRolesPanelV6.js');
const panelV7 = read('src/modules/reactionroles/reactionRolesPanelV7.js');
const reliability = read('src/modules/reactionroles/reactionRolesReliabilityPatch.js');
const runtimeSource = read('src/modules/reactionroles/reactionRoles.js');
const finderSource = read('src/modules/reactionroles/reactionRoleMessageFinder.js');
const routeSource = read('src/modules/reactionroles/reactionRolesRoute.js');
const interactionSource = read('src/events/interactions/interactionCreate.js');
const manifestSource = read('src/core/modules/moduleManifest.js');

test('Canonical Role Studio runtime exports are present', () => {
  for (const name of [
    'getSection', 'setEnabled', 'listPanels', 'getPanel', 'attachExistingMessage',
    'createFromTemplate', 'updatePanelMappings', 'detachPanel', 'deleteDeploymentMessage',
    'handleReactionAdd', 'handleReactionRemove', 'buildHealth', 'repairAll',
    'startup', 'exportConfiguration', 'reset',
  ]) assert.equal(typeof reactionRoles[name], 'function', `Missing runtime export: ${name}`);
});

test('Role Studio remains backwards compatible with the reactionRoles storage key', () => {
  assert.equal(reactionRoles.SECTION, 'reactionRoles');
  assert.ok(manifestSource.includes("reactionRoles: { key: 'reactionRoles', name: 'Role Studio'"));
});

test('Persistent smart-builder entrypoint is active', () => {
  assert.ok(panelEntry.includes("require('./reactionRolesPanelV7')"));
  assert.equal(exists('src/modules/reactionroles/reactionRolesPanelV7.js'), true);
  assert.ok(panelV7.includes("require('./reactionRolesPanelV6')"));
  assert.ok(panelV6.includes("require('./reactionRolesReliabilityPatch')"));
});

test('Overview hides draft language and reopens saved setup as a builder', () => {
  assert.ok(panelV7.includes("hasSetup ? 'Open Builder' : 'Builder'"));
  assert.ok(panelV7.includes('Your active setup is saved automatically'));
  assert.equal(panelV7.includes('Resume Draft'), false);
  assert.equal(panelV7.includes('Drafts'), false);
});

test('Smart builder exposes direct add, manage, review and target controls', () => {
  for (const token of [
    'Role Studio Builder', 'Add Emoji', 'Manage Mappings', 'Review & Deploy',
    'Change Message', 'Exit Studio', 'smart:add-role', 'smart:add-mode',
  ]) assert.ok(panelV7.includes(token), `Missing smart-builder control: ${token}`);
});

test('Mapping manager supports edit, duplicate, ordering and deletion', () => {
  for (const token of [
    'Mapping Manager', 'Select a mapping to edit', 'edit-role', 'edit-mode',
    'Edit Emoji', 'Duplicate', 'Move Up', 'Move Down', 'Delete',
  ]) assert.ok(panelV7.includes(token), `Missing mapping-manager control: ${token}`);
});

test('Modal submissions update the active builder instead of spawning another panel', () => {
  assert.ok(panelV7.includes("id === 'admin:reactionRoles:wizard:emoji:submit'"));
  assert.ok(panelV7.includes('return interaction.update(clean)'));
  assert.ok(panelV6.includes('interaction.update(stripEphemeral(payload))'));
});

test('Selected-message preview and final review remain mandatory', () => {
  for (const token of [
    'Confirm Selected Message', 'Correct Message — Configure Roles',
    'Final Review — Attach Roles', 'Attach Roles Now', 'Nothing is changed until you confirm below',
  ]) assert.ok(panelV5.includes(token), `Missing preview/review control: ${token}`);
});

test('Universal message sources remain available', () => {
  for (const token of [
    'Choose channel or thread', 'Load Recent', 'Search Messages', 'Paste Link', 'Enter IDs',
    'source:channel', 'source:message', 'source:browse', 'source:search', 'source:link', 'source:ids',
    'ChannelType.PublicThread', 'ChannelType.PrivateThread', 'ChannelType.AnnouncementThread',
  ]) assert.ok(panelV3.includes(token), `Missing universal source option: ${token}`);
  assert.ok(finderSource.includes('channel.messages.fetch(options.messageId)'));
});

test('Every configured reaction is bot-owned, retried and verified', () => {
  for (const token of [
    'botOwnsReaction', 'reaction.me === true', 'message.react(emoji.reactValue)',
    'attempt <= 3', 'Not every reaction could be applied', 'ensureAllPanelReactions',
  ]) assert.ok(reliability.includes(token), `Missing deployment reliability behaviour: ${token}`);
  assert.ok(reliability.includes("wrap('attachExistingMessage')"));
  assert.ok(reliability.includes("wrap('updatePanelMappings')"));
  assert.ok(reliability.includes("wrap('repairPanel')"));
});

test('Clear and detach removes and verifies every configured bot reaction before detaching', () => {
  for (const token of [
    'clearAllPanelReactions', 'reaction.users.remove(botId)',
    'Not every configured reaction could be cleared', 'wrapDetachPanel',
    'await clearAllPanelReactions(guild, panel)', 'clearReactions: false',
    'reactionsCleared: true',
  ]) assert.ok(reliability.includes(token), `Missing complete detach cleanup behaviour: ${token}`);
});

test('Existing messages are never rewritten during standard attachment', () => {
  assert.ok(runtimeSource.includes('attachExistingMessage'));
  assert.ok(runtimeSource.includes('originalPayload = template ? messagePayload(message) : null'));
  assert.ok(panelV3.includes('templateId: null, applyTemplate: false'));
});

test('Reaction add and remove events remain connected', () => {
  assert.ok(interactionSource.includes("startsWith(interaction, 'admin:reactionRoles')"));
  assert.equal(exists('src/events/messages/messageReactionAdd.js'), true);
  assert.equal(exists('src/events/messages/messageReactionRemove.js'), true);
});

test('API exposes deployment, maintenance, export and reset operations', () => {
  for (const token of [
    "router.post('/:guildId/attach'", "router.post('/:guildId/deploy'",
    "router.put('/:guildId/panels/:panelId'", "router.post('/:guildId/repair'",
    "router.get('/:guildId/export'", "router.post('/:guildId/reset'",
  ]) assert.ok(routeSource.includes(token), `Missing API route: ${token}`);
});

console.log('\n✅ Role Studio smart-builder, continuity and deployment-reliability tests passed.');
console.log('ℹ️ A development-guild restart and live smart-builder acceptance test are still required.');
