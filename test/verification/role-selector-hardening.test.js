'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

const core = read('src/modules/roleStudio/roleSelector/roleSelector.js');
const health = read('src/modules/roleStudio/roleSelector/roleSelectorHealth.js');
const panel = read('src/modules/roleStudio/roleSelector/roleSelectorPanel.js');
const route = read('src/server/routes/modules/roleStudio/roleSelector.js');
const startup = read('src/events/client/roleSelectorStartup.js');
const contracts = read('src/owner/sentinel/moduleContracts.js');
const dashboard = read('src/dashboard/js/pages/modules/RoleSelector.jsx');

test('Role Selector core member mutations enforce module enabled state', () => {
  for (const functionName of [
    'ensureStandardOptionRole',
    'ensureColourRole',
    'applyStandardSelection',
    'applyColourSelection',
    'clearSelection',
  ]) {
    const block = core.match(new RegExp(`(?:async )?function ${functionName}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0] || '';
    assert.match(block, /assertModuleEnabled\(guild\.id\)/, `${functionName} must enforce the global module switch`);
  }
});

test('Role Selector hierarchy sync rejects unsafe anchors', () => {
  assert.match(core, /anchor\.managed \|\| anchor\.position >= me\.roles\.highest\.position/);
  assert.match(core, /reason: 'anchor_unmanageable'/);
});

test('Managed group deletion preserves unresolved Goliath roles', () => {
  assert.match(core, /unresolvedRoles/);
  assert.match(core, /reason: 'unmanageable'/);
  assert.match(core, /reason: 'delete_failed'/);
  assert.match(core, /unresolved: unresolvedRoles\.length/);
  assert.match(panel, /if \(result\.unresolved\)/);
  assert.match(route, /if \(result\.unresolved\)/);
  assert.match(route, /res\.status\(409\)/);
});

test('Role Selector health validates deployment message and repairs stale state', () => {
  assert.match(health, /deployment\.messageId/);
  assert.match(health, /fetchDeploymentMessage/);
  assert.match(health, /The deployed Role Selector message no longer exists\./);
  assert.match(health, /memberSelections/);
  assert.match(health, /anchorIsUnsafe/);
});

test('Role Selector health exposes acceptance readiness', () => {
  assert.match(health, /async function buildAcceptanceReadiness\(/);
  assert.match(health, /module_enabled/);
  assert.match(health, /manage_roles/);
  assert.match(health, /anchor_valid/);
  assert.match(health, /colour_group/);
  assert.match(health, /custom_group/);
  assert.match(health, /deployment_channel/);
  assert.match(health, /deployment_message/);
  assert.match(health, /acceptance,/);
});

test('Discord admin Role Selector controls use central security enforcement', () => {
  assert.match(panel, /const adminControl = id\.startsWith\('admin:roleSelector'\) \|\| id\.startsWith\('admin:colourRoles'\)/);
  assert.match(panel, /security\.enforceInteractionSecurity\(interaction, \{ level: 'admin', guildOnly: true \}\)/);
});

test('Discord Role Selector admin UI exposes acceptance readiness', () => {
  assert.match(panel, /\*\*Acceptance:\*\*/);
  assert.match(panel, /health\.acceptance\?\.ready/);
  assert.match(panel, /Acceptance: \*\*/);
  assert.match(panel, /failedChecks/);
  assert.match(panel, /No acceptance blockers detected/);
});

test('Dashboard Role Selector routes require authenticated guild management access', () => {
  assert.match(route, /req\.session\?\.user\?\.id/);
  assert.match(route, /PermissionFlagsBits\.Administrator/);
  assert.match(route, /PermissionFlagsBits\.ManageGuild/);
  assert.match(route, /router\.use\('\/:guildId', requireRoleSelectorGuildAccess\)/);
  assert.doesNotMatch(route, /req\.body\?\.actorId/);
});

test('Dashboard channel changes retire old deployment and clear old message id', () => {
  assert.match(route, /deploymentChannelChanged/);
  assert.match(route, /panel\.retireDeployment\(g, before\.deployment\)/);
  assert.match(route, /messageId: null/);
});

test('Dashboard Role Selector deploy resolves configured emoji shortcodes', () => {
  assert.match(route, /const emojis = require\('\.\.\/\.\.\/\.\.\/\.\.\/modules\/utilityStudio\/emojis\/emojis'\)/);
  assert.match(route, /async function resolveDashboardMemberPayload\(/);
  assert.match(route, /emojis\.allowedGuildEmojis/);
  assert.match(route, /emojis\.componentPayload/);
  assert.match(route, /await resolveDashboardMemberPayload\(g, panel\.memberLauncherPayload\(g\)\)/);
});

test('Role Selector dashboard renders acceptance readiness checks', () => {
  assert.match(dashboard, /const acceptance = health\.acceptance/);
  assert.match(dashboard, /Health & Acceptance/);
  assert.match(dashboard, /Acceptance Ready/);
  assert.match(dashboard, /acceptance\.checks/);
});

test('Role Selector deployment supports disabled and retired panel states', () => {
  assert.match(panel, /function memberDisabledPayload\(/);
  assert.match(panel, /components: \[\]/);
  assert.match(panel, /async function retireDeployment\(/);
  assert.match(panel, /await message\.edit\(memberDisabledPayload\(\)\)/);
});

test('Role Selector scheduled maintenance respects the module switch', () => {
  assert.match(startup, /isModuleEnabled\(guild\.id, roleSelector\.MODULE\)/);
  assert.match(startup, /syncManagedRoleAppearance\(guild\)/);
  assert.match(startup, /syncManagedRoleHierarchy\(guild\)/);
  assert.match(startup, /cleanupUnused\(guild\)/);
  assert.match(startup, /INTERVAL_MS = 60 \* 60 \* 1000/);
});

test('Sentinel contract describes Role Selector as scheduled', () => {
  assert.match(contracts, /roleSelector: \{ class: 'scheduled', signals: \['runtime', 'interaction', 'scheduler', 'persistence', 'discord-write'\] \}/);
});
