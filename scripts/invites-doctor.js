'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const failures = [];
const checks = [];

function read(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }
function exists(file) { return fs.existsSync(path.join(root, file)); }
function check(label, condition, detail = '') {
  checks.push({ label, ok: Boolean(condition), detail });
  if (!condition) failures.push(`${label}${detail ? `: ${detail}` : ''}`);
}
function file(filePath, exports = []) {
  const full = path.join(root, filePath);
  check(filePath, fs.existsSync(full), 'missing');
  if (!fs.existsSync(full) || !exports.length || !filePath.endsWith('.js')) return;
  try {
    delete require.cache[require.resolve(full)];
    const loaded = require(full);
    check(`${filePath} exports`, exports.every((name) => loaded?.[name] !== undefined), exports.filter((name) => loaded?.[name] === undefined).join(', '));
  } catch (error) { check(`${filePath} loads`, false, error.message); }
}

file('src/modules/invites/invites.js', [
  'defaults', 'getSection', 'setEnabled', 'updateSettings', 'addHistory', 'syncGuild',
  'trackJoin', 'trackLeave', 'leaderboard', 'setBonus', 'createInviteLink',
  'deleteInviteLink', 'listInviteLinks', 'listAdminInviteLinks', 'findPersonalInvite',
  'createPersonalInvite', 'deletePersonalInvite', 'ensureOfficialInvite', 'buildHealth',
  'repair', 'startup', 'applyInviteRoles', 'exportConfiguration', 'reset',
]);
file('src/modules/invites/invitesRoute.js');
file('src/modules/invites/invitesAdminPanel.js', ['buildInviteStudioPayload', 'handleInviteStudioInteraction']);
file('src/modules/invites/invitesMigration.js', ['migratePersonalInvites', 'retireLegacyIfReplacementUsed', 'installAdminPanelExtension']);
file('src/modules/invites/invitesPublicPanels.js', [
  'panelConfig', 'savePanelConfig', 'buildPublicPayload', 'deployPublicPanel',
  'refreshPublicPanel', 'refreshLeaderboard', 'queueLeaderboardRefresh',
  'startAutoRefresh', 'handleMemberInteraction',
]);
file('src/modules/invites/invitesMemberProfiles.js', ['ACHIEVEMENTS', 'statsFor', 'profilePayload', 'handleProfileInteraction', 'notifyInviteUsed']);
file('src/events/invites/inviteLogs.js');
file('src/dashboard/js/pages/modules/Invites.jsx');
file('scripts/invites-smoke-test.js');
file('docs/modules/invites.md');

check('Invite slash command removed', !exists('src/commands/admin/invites.js'));
check('Standalone Invite Discord panel removed', !exists('src/modules/invites/invitesPanel.js'));
check('Invite admin panel removed from shared core folder', !exists('src/core/admin/functions/invitesAdminPanel.js'));

const runtime = read('src/modules/invites/invites.js');
for (const token of [
  'inviteLinks', 'roleIds', 'createInviteLink', 'applyInviteRoles', 'temporary',
  'maxAge', 'maxUses', 'trackJoin', 'trackLeave', 'buildHealth', 'repair',
  'findPersonalInvite', 'createPersonalInvite', 'deletePersonalInvite', 'personal',
  'officialInvite', 'memberInviteTemplate',
]) check(`Invite runtime ${token}`, runtime.includes(token));

const route = read('src/modules/invites/invitesRoute.js');
for (const token of [
  "router.get('/:guildId'", "router.patch('/:guildId/enabled'", "router.patch('/:guildId/settings'",
  "router.post('/:guildId/sync'", "router.get('/:guildId/links'", "router.post('/:guildId/links'",
  "router.delete('/:guildId/links/:code'", "router.get('/:guildId/leaderboard'",
  "router.patch('/:guildId/inviters/:userId/bonus'", "router.get('/:guildId/history'",
  "router.get('/:guildId/health'", "router.post('/:guildId/repair'",
  "router.get('/:guildId/export'", "router.post('/:guildId/reset'",
]) check(`Invite API ${token}`, route.includes(token));
check('Obsolete managed invite API removed', !route.includes('managed-invite') && !route.includes('createManagedInvite') && !route.includes('validateManagedInvite'));

const panel = read('src/modules/invites/invitesAdminPanel.js');
for (const token of [
  'invites:goliath', 'invites:official-settings', 'invites:official-channel',
  'invites:official-create', 'invites:official-delete', 'invites:public-config',
  'invites:member-settings', 'invites:member-channel', 'invites:member-autoreplace',
  'invites:panel-deploy', 'invites:invite-manager', 'invites:health', 'invites:repair',
  'invites:leaderboard-reset-arm', 'invites:default-panel',
]) check(`Invite panel ${token}`, panel.includes(token));

const migration = read('src/modules/invites/invitesMigration.js');
for (const token of [
  'invites:migrate-personal', 'Migrate Personal Links', 'personalInviteMigrations',
  'migratePersonalInvites', 'retireLegacyIfReplacementUsed',
  'leaderboard score has been preserved', 'previous link will continue working',
]) check(`Invite migration ${token}`, migration.includes(token));

const publicPanels = read('src/modules/invites/invitesPublicPanels.js');
for (const token of [
  'publicPanel', 'messageId', 'Official Server Invite', 'Create My Link', 'My Profile',
  'Update Leaderboard', 'interaction.user.send', 'createPersonalInvite',
  'queueLeaderboardRefresh', 'message.edit', 'I could not DM you',
]) check(`Invite public panels ${token}`, publicPanels.includes(token));

const profiles = read('src/modules/invites/invitesMemberProfiles.js');
for (const token of ['First Friend', 'Recruiter', 'Community Builder', 'Diamond Recruiter', 'Legend', 'Invite Profile', 'notifyInviteUsed']) check(`Invite profiles ${token}`, profiles.includes(token));

const modulePanels = read('src/core/admin/functions/moduleAdminPanels.js');
check('Invite Studio listed in live paginated Modules panel', modulePanels.includes("['admin:invites'") && modulePanels.includes('Invite Studio'));
check('Invite Studio marked as external module route', modulePanels.includes("'admin:invites'"));

const interactions = read('src/events/interactions/interactionCreate.js');
check('Invite panel imported from module folder', interactions.includes('../../modules/invites/invitesAdminPanel'));
check('Invite Studio entry button handled', interactions.includes("interaction.customId === 'admin:invites'"));
check('Invite Studio child interactions handled', interactions.includes("startsWith(interaction, 'invites:')"));
check('No standalone Invite interaction registration', !interactions.includes('invitesPanel'));

const dashboard = read('src/dashboard/js/pages/modules/Invites.jsx');
for (const token of ['Create invite link', 'Roles (optional)', 'Grant temporary membership', '/links']) check(`Invite dashboard ${token}`, dashboard.includes(token));
for (const section of ['Invite Links', 'Analytics', 'Rewards', 'Join History', 'Health', 'Settings']) check(`Invite workspace ${section}`, dashboard.includes(section));
check('Invite links are default workspace tab', dashboard.includes("useState('links')"));
check('Invite link copy action exists', dashboard.includes('navigator.clipboard.writeText'));
check('Invite link table includes channel and temporary status', dashboard.includes('channelName(channels, link.channelId)') && dashboard.includes("link.temporary ? 'Yes' : 'No'"));

const eventSource = read('src/events/invites/inviteLogs.js');
for (const token of ['ClientReady', 'InviteCreate', 'InviteDelete', 'GuildMemberAdd', 'GuildMemberRemove']) check(`Invite event ${token}`, eventSource.includes(token));
check('Leaderboard refresh is wired to invite lifecycle', eventSource.includes('queueLeaderboardRefresh'));
check('Inviter DM notification is wired to invite use', eventSource.includes('notifyInviteUsed'));
check('Migration retirement is wired to replacement use', eventSource.includes('retireLegacyIfReplacementUsed'));

const registry = read('src/dashboard/js/shared/moduleRegistry.js');
check('Dashboard module registered', registry.includes("key: 'invites'") && registry.includes("route: '/invites'"));
const layout = read('src/dashboard/js/ui/layout.js');
check('Dashboard route registered', layout.includes("path: '/invites'") && layout.includes('component: Invites'));
const manifest = require(path.join(root, 'src/core/modules/moduleManifest'));
check('Manifest entry exists', Boolean(manifest.moduleManifest?.invites));
check('Invite Studio is complete', manifest.moduleManifest?.invites?.maturity === 'complete');
for (const capability of ['guildStorage', 'runtime', 'adminPanel', 'dashboard', 'api', 'health', 'startupRecovery', 'export', 'reset', 'doctor', 'documentation']) check(`Invite Studio capability ${capability}`, manifest.moduleManifest?.invites?.capabilities?.[capability] === true);
const server = read('server.js');
check('Invite API imported', server.includes('./src/modules/invites/invitesRoute'));
check('Invite API mounted', server.includes("['/api/invites', invitesRoutes]") || server.includes("app.use('/api/invites'"));
const packageJson = JSON.parse(read('package.json'));
check('Invite smoke test script registered', packageJson.scripts?.['test:invites']?.includes('invites-smoke-test.js'));
check('Invite smoke test runs in Doctor', packageJson.scripts?.doctor?.includes('invites-smoke-test.js'));

console.log('\nInvite Studio Doctor');
console.log('====================');
for (const item of checks) console.log(`${item.ok ? '✅' : '❌'} ${item.label}${!item.ok && item.detail ? ` — ${item.detail}` : ''}`);
if (failures.length) {
  console.error(`\n❌ Invite Studio Doctor failed with ${failures.length} issue(s).`);
  process.exit(1);
}
console.log('\n✅ Invite Studio complete acceptance contract passed.');
