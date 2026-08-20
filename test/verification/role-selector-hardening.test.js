'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

const core = read('src/modules/roleStudio/roleSelector/roleSelector.js');
const service = read('src/modules/roleStudio/roleSelector/roleSelectorService.js');
const locks = read('src/modules/roleStudio/roleSelector/roleSelectorLocks.js');
const health = read('src/modules/roleStudio/roleSelector/roleSelectorHealth.js');
const panel = read('src/modules/roleStudio/roleSelector/roleSelectorPanel.js');
const route = read('src/server/routes/modules/roleStudio/roleSelector.js');
const startup = read('src/events/client/roleSelectorStartup.js');
const memberSync = read('src/events/members/roleSelectorSync.js');
const roleSync = read('src/events/roles/roleSelectorSync.js');
const contracts = read('src/owner/sentinel/moduleContracts.js');
const dashboard = read('src/dashboard/js/pages/modules/RoleSelector.jsx');

test('Role Selector core member mutations enforce module enabled state', () => {
  for (const functionName of ['ensureStandardOptionRole', 'ensureColourRole', 'applyStandardSelection', 'applyColourSelection', 'clearSelection']) {
    const block = core.match(new RegExp(`(?:async )?function ${functionName}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0] || '';
    assert.match(block, /assertModuleEnabled\(guild\.id\)/, `${functionName} must enforce the global module switch`);
  }
});

test('Role Selector hierarchy sync rejects unsafe anchors', () => {
  assert.match(core, /anchor\.managed \|\| anchor\.position >= me\.roles\.highest\.position/);
  assert.match(core, /reason: 'anchor_unmanageable'/);
});

test('Hardened service verifies final Discord state and records failures', () => {
  assert.match(service, /async function convergeGroupRoles\(/);
  assert.match(service, /Discord did not converge to the requested Role Selector state/);
  assert.match(service, /withMutationLock\(guild\.id/);
  assert.match(service, /failed: Number\(current\.analytics\?\.failed \|\| 0\) \+ 1/);
  assert.match(service, /fetchFreshMember/);
});

test('Hardened service protects stable group and option identity', () => {
  assert.match(service, /Colours is reserved for the built-in selector/);
  assert.match(service, /uniqueGroupId/);
  assert.match(service, /retiredGroupIds/);
  assert.match(service, /retiredOptionIds/);
  assert.match(service, /stabilizeOptions/);
  assert.match(service, /existing\[index\]/);
});

test('Hardened service prevents duplicate role bindings and unusable overflow', () => {
  assert.match(service, /already bound to another Role Selector option/);
  assert.match(service, /MAX_COMPONENT_OPTIONS = 25/);
  assert.match(service, /isGroupMemberUsable/);
  assert.match(service, /normalizePaletteInput/);
  assert.match(service, /seenHex/);
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

test('Role Selector health validates deployment and hardening wraps repair', () => {
  assert.match(health, /deployment\.messageId/);
  assert.match(health, /fetchDeploymentMessage/);
  assert.match(health, /The deployed Role Selector message no longer exists\./);
  assert.match(health, /memberSelections/);
  assert.match(health, /anchorIsUnsafe/);
  assert.match(locks, /health\.repair = async function hardenedRepair/);
  assert.match(locks, /reconcileAllMembers/);
  assert.match(locks, /countManagedRoleReferences/);
});

test('Role Selector health exposes acceptance readiness', () => {
  assert.match(health, /async function buildAcceptanceReadiness\(/);
  for (const key of ['module_enabled', 'manage_roles', 'anchor_valid', 'colour_group', 'custom_group', 'deployment_channel', 'deployment_message']) assert.match(health, new RegExp(key));
  assert.match(health, /acceptance,/);
});

test('Discord admin Role Selector controls use central security enforcement', () => {
  assert.match(panel, /const adminControl = id\.startsWith\('admin:roleSelector'\) \|\| id\.startsWith\('admin:colourRoles'\)/);
  assert.match(panel, /security\.enforceInteractionSecurity\(interaction, \{ level: 'admin', guildOnly: true \}\)/);
});

test('Discord member launcher hides unusable groups', () => {
  assert.match(panel, /filter\(roleSelector\.isGroupMemberUsable\)/);
  assert.match(panel, /!roleSelector\.isGroupMemberUsable\(group\)/);
});

test('Discord Role Selector admin UI exposes acceptance readiness', () => {
  assert.match(panel, /\*\*Acceptance:\*\*/);
  assert.match(panel, /health\.acceptance\?\.ready/);
  assert.match(panel, /Acceptance: \*\*/);
  assert.match(panel, /failedChecks/);
  assert.match(panel, /No acceptance blockers detected/);
});

test('Discord modal and palette component limits are explicit', () => {
  assert.match(panel, /setMaxLength\(8\)/);
  assert.match(panel, /setMaxLength\(100\)/);
  assert.match(panel, /setMaxLength\(20\)/);
  assert.match(panel, /setMaxLength\(7\)/);
  assert.match(panel, /setMaxLength\(60\)/);
  assert.match(panel, /slice\(0, 25\)/);
});

test('Discord deployment is serialized and ownership checked', () => {
  assert.match(panel, /withDeploymentLock/);
  assert.match(panel, /ownedByGoliath/);
  assert.match(panel, /message_not_owned/);
  assert.match(panel, /role_selector_deployment_not_owned/);
});

test('Divider lifecycle tracks Goliath ownership', () => {
  assert.match(service, /anchorManaged/);
  assert.match(service, /setAnchorRole/);
  assert.match(panel, /setAnchorRole\(interaction\.guild, divider\.id, \{ managed: true/);
  assert.match(panel, /setAnchorRole\(interaction\.guild, interaction\.values\?\.\[0\] \|\| null, \{ managed: false/);
});

test('Dashboard Role Selector routes require authenticated guild management access', () => {
  assert.match(route, /req\.session\?\.user\?\.id/);
  assert.match(route, /PermissionFlagsBits\.Administrator/);
  assert.match(route, /PermissionFlagsBits\.ManageGuild/);
  assert.match(route, /router\.use\('\/:guildId', requireRoleSelectorGuildAccess\)/);
  assert.doesNotMatch(route, /req\.body\?\.actorId/);
});

test('Dashboard group and colour saves use hardened lifecycle service', () => {
  assert.match(route, /roleSelector\.saveGroupSafe/);
  assert.match(route, /roleSelector\.setAnchorRole/);
  assert.match(route, /withDeploymentLock/);
  assert.match(route, /ownedByGoliath/);
});

test('Dashboard channel changes retire old deployment and clear old message id', () => {
  assert.match(route, /deploymentChannelChanged/);
  assert.match(route, /panel\.retireDeployment\(g, before\.deployment\)/);
  assert.match(route, /messageId: deploymentChannelChanged \? null/);
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
  assert.match(panel, /retireDeploymentUnlocked/);
});

test('Role Selector scheduled maintenance uses hardened coordinator', () => {
  assert.match(startup, /isModuleEnabled\(guild\.id, roleSelector\.MODULE\)/);
  assert.match(startup, /roleSelector\.runMaintenance\(guild\)/);
  assert.match(startup, /INTERVAL_MS = 60 \* 60 \* 1000/);
  assert.match(service, /async function runMaintenance\(guild\)/);
  assert.match(service, /syncManagedAppearanceUnlocked/);
  assert.match(service, /cleanupUnused\(guild\)/);
});

test('Role Selector reconciles manual member and Discord role changes', () => {
  assert.match(memberSync, /guildMemberUpdate/);
  assert.match(memberSync, /reconcileMemberFromDiscord/);
  assert.match(memberSync, /guildMemberRemove/);
  assert.match(memberSync, /handleMemberRemove/);
  assert.match(roleSync, /roleUpdate/);
  assert.match(roleSync, /handleRoleUpdate/);
  assert.match(roleSync, /roleDelete/);
  assert.match(roleSync, /handleRoleDelete/);
});

test('Retired managed roles are drained before cleanup', () => {
  assert.match(locks, /async function drainRetiredManagedRoles/);
  assert.match(locks, /member\.roles\.remove/);
  assert.match(locks, /retiredManagedRoles/);
});

test('Sentinel contract describes Role Selector as scheduled', () => {
  assert.match(contracts, /roleSelector: \{ class: 'scheduled', signals: \['runtime', 'interaction', 'scheduler', 'persistence', 'discord-write'\] \}/);
});