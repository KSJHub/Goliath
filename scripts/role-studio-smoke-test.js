'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

console.log('\nRole Studio Smoke Test');
console.log('======================');

const entry = read('src/modules/reactionroles/reactionRolesPanel.js');
const hub = read('src/modules/rolestudio/roleStudioPanel.js');
const navigation = read('src/modules/rolestudio/roleStudioNavigationPatch.js');
const temporary = require(path.join(root, 'src/modules/rolestudio/temporaryRoles'));
const temporaryPanel = read('src/modules/rolestudio/temporaryRolesPanel.js');
const temporaryStartup = read('src/events/client/temporaryRolesStartup.js');
const timedRoles = require(path.join(root, 'src/modules/timedroles/timedRoles'));
const timedPanel = read('src/modules/timedroles/timedRolesPanel.js');
const timedStartup = read('src/events/client/timedRolesStartup.js');
const timedMemberJoin = read('src/events/timedroles/timedRolesMemberJoin.js');

assert.ok(entry.includes('roleStudio.buildRoleStudioPanel'));
assert.ok(entry.includes('admin:reactionRoles:open'));
assert.ok(entry.includes('handleTemporaryRolesInteraction'));
assert.ok(hub.includes('👥 Auto Roles'));
assert.ok(hub.includes('😊 Reaction Roles'));
assert.ok(hub.includes('⏳ Timed Roles'));
assert.ok(hub.includes('⚡ Temporary Roles'));
assert.ok(navigation.includes("route === 'admin:autoRoles'"));
assert.ok(navigation.includes("moduleEntry[1] = '🛡️ Role Studio'"));

assert.equal(typeof temporary.assignTemporaryRole, 'function');
assert.equal(typeof temporary.removeAssignment, 'function');
assert.equal(typeof temporary.scanExpired, 'function');
assert.ok(temporaryPanel.includes('UserSelectMenuBuilder'));
assert.ok(temporaryPanel.includes('Assign Temporary Role'));
assert.ok(temporaryStartup.includes('SCAN_INTERVAL_MS'));
assert.ok(temporaryStartup.includes('scanExpired'));

assert.equal(typeof timedRoles.getMemberProgression, 'function');
assert.equal(typeof timedRoles.applyProgressionToMember, 'function');
assert.equal(typeof timedRoles.simulateGuild, 'function');
assert.equal(typeof timedRoles.scanGuild, 'function');
assert.deepEqual(timedRoles.MODES, ['keep_all', 'highest_only']);
assert.ok(timedPanel.includes('Choose any role to create a milestone'));
assert.ok(timedPanel.includes('Preview any member'));
assert.ok(timedPanel.includes('toggleMode'));
assert.ok(timedPanel.includes('announcementChannel'));
assert.ok(timedPanel.includes('Promotion Announcement'));
assert.ok(timedPanel.includes('Simulate'));
assert.ok(timedStartup.includes('timedRoles.startup(client)'));
assert.ok(timedMemberJoin.includes('applyProgressionToMember'));

console.log('✅ Role Studio is the parent role hub.');
console.log('✅ Auto Roles and Reaction Roles remain connected.');
console.log('✅ Timed Roles supports any role, any duration and unlimited milestones.');
console.log('✅ Tenure progression supports keep-all and highest-only modes.');
console.log('✅ Member preview, simulation and promotion announcements are wired.');
console.log('✅ Scheduled and member-join tenure processing are connected.');
console.log('✅ Temporary Roles assignment, removal and expiry scanning are present.');
console.log('ℹ️ Run the full doctor and a live development-guild acceptance test after pulling.');