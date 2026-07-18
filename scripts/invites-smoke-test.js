'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

function pass(label) { console.log(`✅ ${label}`); }
function test(label, fn) {
  try { fn(); pass(label); }
  catch (error) { console.error(`❌ ${label}`); throw error; }
}

console.log('\nInvite Studio Smoke Test');
console.log('========================');

const invites = require(path.join(root, 'src/modules/invites/invites'));
const defaults = invites.defaults();

test('Canonical defaults are valid', () => {
  assert.equal(defaults.enabled, false);
  assert.equal(defaults.settings.trackingEnabled, true);
  assert.equal(defaults.settings.removeOnLeave, true);
  assert.equal(defaults.settings.ignoreBots, true);
  assert.equal(defaults.settings.memberInviteTemplate.enabled, true);
  assert.equal(defaults.settings.memberInviteTemplate.autoReplaceMissing, true);
  assert.deepEqual(defaults.settings.rewardRoles, []);
  assert.deepEqual(defaults.inviteLinks, {});
  assert.deepEqual(defaults.inviters, {});
  assert.deepEqual(defaults.members, {});
  assert.deepEqual(defaults.history, []);
});

test('Runtime exports the current lifecycle contract', () => {
  for (const name of [
    'getSection', 'setEnabled', 'updateSettings', 'addHistory', 'syncGuild',
    'trackJoin', 'trackLeave', 'leaderboard', 'setBonus', 'createInviteLink',
    'deleteInviteLink', 'listInviteLinks', 'listAdminInviteLinks',
    'findPersonalInvite', 'createPersonalInvite', 'deletePersonalInvite',
    'ensureOfficialInvite', 'buildHealth', 'repair', 'startup',
    'applyInviteRoles', 'exportConfiguration', 'reset',
  ]) assert.equal(typeof invites[name], 'function', `Missing export: ${name}`);
});

test('Invite Studio remains self-contained', () => {
  assert.equal(exists('src/commands/admin/invites.js'), false);
  assert.equal(exists('src/modules/invites/invitesPanel.js'), false);
  assert.equal(exists('src/core/admin/functions/invitesAdminPanel.js'), false);
  assert.equal(exists('src/modules/invites/invitesAdminPanel.js'), true);
  assert.equal(exists('src/modules/invites/invitesMigration.js'), true);
  assert.equal(exists('src/modules/invites/invitesPublicPanels.js'), true);
  assert.equal(exists('src/modules/invites/invitesMemberProfiles.js'), true);
});

const route = read('src/modules/invites/invitesRoute.js');
test('API exposes only supported Invite Studio operations', () => {
  for (const token of [
    "router.get('/:guildId'", "router.patch('/:guildId/enabled'", "router.patch('/:guildId/settings'",
    "router.post('/:guildId/sync'", "router.get('/:guildId/links'", "router.post('/:guildId/links'",
    "router.delete('/:guildId/links/:code'", "router.get('/:guildId/leaderboard'",
    "router.patch('/:guildId/inviters/:userId/bonus'", "router.get('/:guildId/history'",
    "router.get('/:guildId/health'", "router.post('/:guildId/repair'",
    "router.get('/:guildId/export'", "router.post('/:guildId/reset'",
  ]) assert.ok(route.includes(token), `Missing route: ${token}`);
  assert.equal(route.includes('managed-invite'), false, 'Obsolete managed-invite route remains');
  assert.equal(route.includes('createManagedInvite'), false, 'Route calls removed createManagedInvite export');
  assert.equal(route.includes('validateManagedInvite'), false, 'Route calls removed validateManagedInvite export');
});

const panelSource = read('src/modules/invites/invitesAdminPanel.js');
test('Admin panel exposes current official, member, public and maintenance controls', () => {
  for (const token of [
    'invites:goliath', 'invites:official-settings', 'invites:official-channel',
    'invites:official-create', 'invites:official-delete', 'invites:public-config',
    'invites:member-settings', 'invites:member-channel', 'invites:member-autoreplace',
    'invites:panel-deploy', 'invites:invite-manager', 'invites:health', 'invites:repair',
    'invites:leaderboard-reset-arm', 'invites:default-panel',
  ]) assert.ok(panelSource.includes(token), `Missing panel control: ${token}`);
});

test('Invite Studio overview payload serializes for Discord', () => {
  const originalGetSection = invites.getSection;
  const originalListInviteLinks = invites.listInviteLinks;
  invites.getSection = () => ({ ...defaults, settings: { ...defaults.settings }, analytics: { ...defaults.analytics } });
  invites.listInviteLinks = () => [];
  try {
    delete require.cache[require.resolve(path.join(root, 'src/modules/invites/invitesAdminPanel'))];
    const panel = require(path.join(root, 'src/modules/invites/invitesAdminPanel'));
    const payload = panel.buildInviteStudioPayload({ guildId: '123456789012345678', channelId: '123456789012345679', user: { id: '123456789012345680' } });
    assert.equal(payload.embeds.length, 1);
    assert.ok(payload.components.length >= 1 && payload.components.length <= 5);
    for (const embed of payload.embeds) assert.doesNotThrow(() => embed.toJSON());
    for (const componentRow of payload.components) {
      const json = componentRow.toJSON();
      assert.ok(Array.isArray(json.components));
      assert.ok(json.components.length >= 1 && json.components.length <= 5);
    }
  } finally {
    invites.getSection = originalGetSection;
    invites.listInviteLinks = originalListInviteLinks;
    delete require.cache[require.resolve(path.join(root, 'src/modules/invites/invitesAdminPanel'))];
  }
});

test('Migration module exports its complete contract', () => {
  const migration = require(path.join(root, 'src/modules/invites/invitesMigration'));
  assert.equal(typeof migration.migratePersonalInvites, 'function');
  assert.equal(typeof migration.retireLegacyIfReplacementUsed, 'function');
  assert.equal(typeof migration.installAdminPanelExtension, 'function');
});

test('Migration flow preserves scores, DMs owners and retires legacy links after replacement use', () => {
  const source = read('src/modules/invites/invitesMigration.js');
  for (const token of [
    'personalInviteMigrations', 'Migrate Personal Links', 'created.invite.url',
    'leaderboard score has been preserved', 'previous link will continue working',
    'retireLegacyIfReplacementUsed', 'deleteInviteLink', 'personal_legacy_links_retired',
  ]) assert.ok(source.includes(token), `Missing migration behaviour: ${token}`);
});

test('Member profile uses the canonical personal invite lookup and serializes', () => {
  const originalGetSection = invites.getSection;
  const originalLeaderboard = invites.leaderboard;
  const originalFindPersonalInvite = invites.findPersonalInvite;
  invites.getSection = () => ({ ...defaults, enabled: true, inviters: { '123456789012345680': { inviterId: '123456789012345680', total: 12, active: 10, left: 2, bonus: 0 } } });
  invites.leaderboard = () => [{ inviterId: '123456789012345680', score: 10, total: 12, active: 10, left: 2, bonus: 0 }];
  invites.findPersonalInvite = () => ({ code: 'personal123', inviterId: '123456789012345680', personal: true, enabled: true });
  try {
    delete require.cache[require.resolve(path.join(root, 'src/modules/invites/invitesMemberProfiles'))];
    const profiles = require(path.join(root, 'src/modules/invites/invitesMemberProfiles'));
    const guild = { id: '123456789012345678', name: 'Test Guild' };
    const user = { id: '123456789012345680', username: 'Tester', displayName: 'Tester', displayAvatarURL: () => null };
    const payload = profiles.profilePayload(guild, user);
    assert.doesNotThrow(() => payload.embeds[0].toJSON());
    const profileButtons = payload.components[0].toJSON().components;
    assert.equal(profileButtons.length, 1);
    assert.equal(profileButtons[0].custom_id, 'invites:member-personal');
    assert.equal(profileButtons[0].label, 'Resend My Link');
    assert.notEqual(profileButtons[0].disabled, true);
    assert.ok(payload.embeds[0].toJSON().fields.some((field) => field.value.includes('personal123')));
  } finally {
    invites.getSection = originalGetSection;
    invites.leaderboard = originalLeaderboard;
    invites.findPersonalInvite = originalFindPersonalInvite;
    delete require.cache[require.resolve(path.join(root, 'src/modules/invites/invitesMemberProfiles'))];
  }
});

const publicPanels = read('src/modules/invites/invitesPublicPanels.js');
test('Member controls are private and DM fallback does not expose links publicly', () => {
  assert.ok(publicPanels.includes("if (!section.enabled)"), 'Disabled-module guard is missing');
  assert.ok(publicPanels.includes('let dmSent = true'), 'DM delivery state is missing');
  assert.ok(publicPanels.includes('dmSent = false'), 'DM failure state is missing');
  assert.ok(publicPanels.includes('content: dmSent'), 'DM success/fallback branch is missing');
  assert.ok(publicPanels.includes('I could not DM you'), 'Ephemeral DM fallback is missing');
  assert.ok(publicPanels.includes('flags: MessageFlags.Ephemeral'), 'Member responses are not ephemeral');
});

const dashboard = read('src/dashboard/js/pages/modules/Invites.jsx');
test('Dashboard exposes all current Invite Studio workspaces', () => {
  for (const token of [
    'Invite Links', 'Analytics', 'Rewards', 'Join History', 'Health', 'Settings',
    'Create invite link', 'Roles (optional)', 'Grant temporary membership', 'navigator.clipboard.writeText',
  ]) assert.ok(dashboard.includes(token), `Missing dashboard feature: ${token}`);
});

test('Runtime events cover invite lifecycle and migration cleanup', () => {
  const events = read('src/events/invites/inviteLogs.js');
  for (const token of ['ClientReady', 'InviteCreate', 'InviteDelete', 'GuildMemberAdd', 'GuildMemberRemove']) assert.ok(events.includes(token), `Missing lifecycle event: ${token}`);
  assert.ok(events.includes('queueLeaderboardRefresh'), 'Leaderboard refresh is not wired to joins and leaves');
  assert.ok(events.includes('notifyInviteUsed'), 'Inviter notification is not wired to joins');
  assert.ok(events.includes('retireLegacyIfReplacementUsed'), 'Replacement-use cleanup is not wired to joins');
});

test('Invite Studio is visible and safely reachable through the live Admin Hub', () => {
  const modules = read('src/core/admin/functions/moduleAdminPanels.js');
  const interactions = read('src/events/interactions/interactionCreate.js');
  assert.ok(modules.includes("['admin:invites'"), 'Invite Studio button is absent from the paginated module list');
  assert.ok(interactions.includes("interaction.customId === 'admin:invites'"), 'Invite Studio entry button is not handled');
  assert.ok(interactions.includes('await interaction.deferUpdate()'), 'Invite Studio entry is not acknowledged before building the panel');
  assert.ok(interactions.includes('buildInviteStudioPayload'), 'Invite Studio entry does not build its dedicated panel');
  assert.ok(interactions.includes("startsWith(interaction, 'invites:')"), 'Invite Studio child controls are not handled');
});

console.log('\n✅ Invite Studio payload, routing, migration, profiles and lifecycle smoke tests passed.');
console.log('ℹ️ Discord invite creation, joins, DMs and role assignment still require development-guild acceptance testing.');