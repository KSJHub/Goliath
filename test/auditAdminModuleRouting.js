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
    modules.includes('admin:studio:') && modules.includes('studio.key') && modules.includes('module.route'),
    `Dynamic Studio navigation generator missing for ${entry.key} (${entry.studio})`
  );
}

assert(router.includes("callHandler(moduleAdminPanels,'handleModuleAdminInteraction',interaction)"), 'Generic module router is not wired into InteractionCreate');
assert(router.indexOf("callHandler(moduleAdminPanels,'handleModuleAdminInteraction',interaction)") < router.indexOf("callHandler(adminPanel,'handleAdminNavigation',interaction)"), 'Generic module router must run before general admin navigation');

for (const entry of entries.filter((entry) => entry.route.startsWith('admin:module:'))) {
  assert(modules.includes("id.match(/^admin:module:"), `Generic route parser missing for ${entry.key}`);
}

const dedicated = {
  birthdays: 'handleBirthdayInteraction', giveaways: 'handleGiveawaysAdminInteraction', invites: 'handleInviteStudioInteraction', leveling: 'handleLevelingInteraction', polls: 'handlePollsInteraction',
  faq: 'handleFaqInteraction', forms: 'handleFormsAdminInteraction', suggestions: 'handleSuggestionsAdminInteraction', tickets: 'handleTicketInteraction',
  goodbye: 'handleGoodbyeInteraction', embed: 'handleEmbedInteraction', starboard: 'handleStarboardAdminInteraction', sticky: 'handleStickyAdminInteraction', welcome: 'handleWelcomeInteraction',
  autoRoles: 'handleAutoRolesInteraction', reactionRoles: 'handleReactionRolesAdminInteraction', temporaryRoles: 'handleTemporaryRolesInteraction', timedRoles: 'handleTimedRolesInteraction',
  verification: 'handleVerificationAdminInteraction', social: 'handleInteraction', privateRooms: 'handleAdminInteraction', schedule: 'handleScheduleAdminInteraction', stats: 'handleStatsAdminInteraction', tempVoice: 'handleTempVoiceInteraction',
};

for (const entry of entries.filter((entry) => !entry.route.startsWith('admin:module:'))) {
  if (entry.key === 'translation') continue;
  const method = dedicated[entry.key];
  assert(method, `No dedicated routing contract declared for ${entry.key} (${entry.route})`);
  assert(router.includes(method), `InteractionCreate does not wire ${entry.key} through ${method}`);
}

assert(verification.includes("id!=='admin:verification'&&!id.startsWith('admin:verification:')"), 'Verification handler does not accept the admin:verification root route');
assert(verification.includes("if(id==='admin:verification'){await respond(i,buildVerificationAdminPanel(i.guild,user,'home',st));return true;}"), 'Verification root route does not open the Verification panel');

const unsafeGuard = /if\(startsWith\(interaction,'admin:[^']+'\)\)\{await callHandler\([^;]+;return;\}/g;
assert.deepEqual(router.match(unsafeGuard) || [], [], 'Found an admin prefix guard that swallows an unhandled interaction');

// Social Studio must route both its admin root and every social:* child interaction through the current panel before compatibility fallback.
const socialDispatch = "if((startsWith(interaction,'admin:social')||startsWith(interaction,'social:'))&&await callHandler(socialAdminPanel,'handleInteraction',interaction))return;";
const socialCompat = "if(startsWith(interaction,'social:creator:')){await callHandler(socialCreatorActionCompat,'handleCreatorInteraction',interaction);return;}";
assert(router.includes(socialDispatch), 'Social Studio root + child namespace is not wired to its current handler');
assert(router.includes(socialCompat), 'Social Studio creator compatibility fallback is missing');
assert(router.indexOf(socialDispatch) < router.indexOf(socialCompat), 'Social Studio current handler must run before creator compatibility fallback');

const requiredRouterContracts = [
  ["startsWith(interaction,'admin:autoRoles')", 'Auto Roles root'],
  ["startsWith(interaction,'admin:temporaryRoles')", 'Temporary Roles root'],
  ["startsWith(interaction,'admin:timedRoles')", 'Timed Roles root'],
  ["startsWith(interaction,'admin:welcome')", 'Welcome root'],
  ["startsWith(interaction,'admin:goodbye')", 'Goodbye root'],
  ["startsWith(interaction,'admin:reactionRoles')", 'Reaction Roles root'],
  ["startsWith(interaction,'admin:schedule')", 'Schedule root'],
  ["startsWith(interaction,'schedule:rsvp:')", 'Schedule RSVP child'],
  ["startsWith(interaction,'admin:birthdays')", 'Birthdays root'],
  ["startsWith(interaction,'birthdays:user:')", 'Birthdays user child'],
  ["startsWith(interaction,'admin:invites')", 'Invites root'],
  ["startsWith(interaction,'invites:')", 'Invites child'],
];
for (const [needle, label] of requiredRouterContracts) assert(router.includes(needle), `${label} routing contract is missing`);

// Every studio/module namespace advertised by the central router must remain represented in its routing source.
const prefixBlock = router.match(/const MODULE_STUDIO_PREFIXES = \[([\s\S]*?)\n\];/);
assert(prefixBlock, 'MODULE_STUDIO_PREFIXES could not be parsed');
const advertisedPrefixes = [...prefixBlock[1].matchAll(/'([^']+)'/g)].map((match) => match[1]).filter((value) => value.includes(':'));
assert(advertisedPrefixes.length >= 40, `Expected deep module namespace coverage, found only ${advertisedPrefixes.length} prefixes`);
for (const prefix of advertisedPrefixes) assert(router.includes(prefix), `Advertised module interaction namespace disappeared: ${prefix}`);

console.log(`✅ Admin module routing audit passed: ${entries.length} modules across ${new Set(entries.map((entry) => entry.studio)).size} studios; root and child routing contracts guarded.`);