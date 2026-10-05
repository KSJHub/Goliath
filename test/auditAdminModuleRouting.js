'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const modules = fs.readFileSync('src/core/administration/admin/modules.js', 'utf8');
const router = fs.readFileSync('src/events/interactions/interactionCreate.js', 'utf8');
const verification = fs.readFileSync('src/modules/securityStudio/verificationPanel.js', 'utf8');

const catalogBlock = modules.match(/const MODULE_CATALOG = \[([\s\S]*?)\n\];/);
assert(catalogBlock, 'MODULE_CATALOG could not be parsed');

const entries = [...catalogBlock[1].matchAll(/\{ key: '([^']+)', studio: '([^']+)', route: '([^']+)'/g)]
  .map(([, key, studio, route]) => ({ key, studio, route }));

assert(entries.length >= 25, `Expected full module catalog, found only ${entries.length} entries`);
assert.equal(new Set(entries.map((entry) => entry.key)).size, entries.length, 'Duplicate module keys found');
assert.equal(new Set(entries.map((entry) => entry.route)).size, entries.length, 'Duplicate module routes found');

for (const entry of entries) {
  assert(modules.includes(entry.route), `Catalog route missing from module panels: ${entry.route}`);
  assert(
      modules.includes('admin:studio:') &&
        modules.includes('studio.key') &&
        modules.includes('module.route'),
      `Dynamic Studio navigation generator missing for ${entry.key} (${entry.studio})`
    );
}

// Generic modules must be consumed by the generic module router.
assert(router.includes("callHandler(moduleAdminPanels,'handleModuleAdminInteraction',interaction)"), 'Generic module router is not wired into InteractionCreate');
assert(router.indexOf("callHandler(moduleAdminPanels,'handleModuleAdminInteraction',interaction)") < router.indexOf("callHandler(adminPanel,'handleAdminNavigation',interaction)"), 'Generic module router must run before general admin navigation');

for (const entry of entries.filter((entry) => entry.route.startsWith('admin:module:'))) {
  assert(modules.includes("id.match(/^admin:module:"), `Generic route parser missing for ${entry.key}`);
}

// Dedicated root routes. Each must have a real dispatch path before generic fallback.
const dedicated = {
  birthdays: 'handleBirthdayInteraction',
  giveaways: 'handleGiveawaysAdminInteraction',
  invites: 'handleInviteStudioInteraction',
  leveling: 'handleLevelingInteraction',
  polls: 'handlePollsInteraction',
  faq: 'handleFaqInteraction',
  forms: 'handleFormsAdminInteraction',
  suggestions: 'handleSuggestionsAdminInteraction',
  tickets: 'handleTicketInteraction',
  goodbye: 'handleGoodbyeInteraction',
  embed: 'handleEmbedInteraction',
  starboard: 'handleStarboardAdminInteraction',
  sticky: 'handleStickyAdminInteraction',
  welcome: 'handleWelcomeInteraction',
  autoRoles: 'handleAutoRolesInteraction',
  reactionRoles: 'handleReactionRolesAdminInteraction',
  temporaryRoles: 'handleTemporaryRolesInteraction',
  timedRoles: 'handleTimedRolesInteraction',
  verification: 'handleVerificationAdminInteraction',
  social: 'handleInteraction',
  privateRooms: 'handleAdminInteraction',
  schedule: 'handleScheduleAdminInteraction',
  stats: 'handleStatsAdminInteraction',
  tempVoice: 'handleTempVoiceInteraction',
};

for (const entry of entries.filter((entry) => !entry.route.startsWith('admin:module:'))) {
  if (entry.key === 'translation') continue; // generic registry route is resolved by admin navigation/config surface.
  const method = dedicated[entry.key];
  assert(method, `No dedicated routing contract declared for ${entry.key} (${entry.route})`);
  assert(router.includes(method), `InteractionCreate does not wire ${entry.key} through ${method}`);
}

// Root Verification previously timed out because only admin:verification:* was accepted.
assert(
  verification.includes("id!=='admin:verification'&&!id.startsWith('admin:verification:')"),
  'Verification handler does not accept the admin:verification root route'
);
assert(
  verification.includes("if(id==='admin:verification'){await respond(i,buildVerificationAdminPanel(i.guild,user,'home',st));return true;}"),
  'Verification root route does not open the Front Door panel'
);

// Prefix guards must only stop routing when the target handler actually handled the interaction.
const unsafeGuard = /if\(startsWith\(interaction,'admin:[^']+'\)\)\{await callHandler\([^;]+;return;\}/g;
assert.deepEqual(router.match(unsafeGuard) || [], [], 'Found an admin prefix guard that swallows an unhandled interaction');

assert(router.includes("startsWith(interaction,'admin:social')&&await callHandler(socialAdminPanel,'handleInteraction',interaction)"), 'Social Studio root is not wired to its current handler');
assert(router.includes("startsWith(interaction,'admin:autoRoles')&&await callHandler(autorolesPanel,'handleAutoRolesInteraction',interaction)"), 'Auto Roles root can be swallowed');
assert(router.includes("startsWith(interaction,'admin:temporaryRoles')&&await callHandler(temporaryRolesPanel,'handleTemporaryRolesInteraction',interaction)"), 'Temporary Roles root can be swallowed');
assert(router.includes("startsWith(interaction,'admin:timedRoles')&&await callHandler(timedRolesPanel,'handleTimedRolesInteraction',interaction)"), 'Timed Roles root can be swallowed');
assert(router.includes("startsWith(interaction,'admin:welcome')&&await callHandler(welcomePanel,'handleWelcomeInteraction',interaction)"), 'Welcome root can be swallowed');
assert(router.includes("startsWith(interaction,'admin:goodbye')&&await callHandler(goodbyePanel,'handleGoodbyeInteraction',interaction)"), 'Goodbye root can be swallowed');
assert(router.includes("startsWith(interaction,'admin:reactionRoles')&&await callHandler(reactionRolesAdminPanel,'handleReactionRolesAdminInteraction',interaction)"), 'Reaction Roles root can be swallowed');
assert(router.includes("startsWith(interaction,'admin:schedule')&&await callHandler(schedulePanel,'handleScheduleAdminInteraction',interaction)"), 'Schedule root can be swallowed');

console.log(`✅ Admin module routing audit passed: ${entries.length} modules across ${new Set(entries.map((entry) => entry.studio)).size} studios.`);