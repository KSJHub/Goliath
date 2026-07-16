'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const checks = [
  ['src/modules/social/social.js', ['startup', 'diagnostics', 'delivery', 'creators', 'simulator', 'queue', 'history']],
  ['src/modules/social/socialPanel.js', ['buildSocialAdminPanel', 'handleSocialAdminInteraction']],
  ['src/modules/social/socialCreatorPanel.js', ['buildCreatorHubPanel', 'handleSocialCreatorInteraction']],
  ['src/modules/social/socialRoute.js', []],
  ['src/modules/social/socialCreatorRoute.js', []],
  ['src/modules/social/socialHealth.js', ['buildHealth', 'repair', 'exportConfig', 'reset']],
  ['src/modules/social/socialDiagnostics.js', ['buildDiagnostics', 'providerDiagnostics', 'creatorDiagnostics']],
  ['src/modules/social/socialDelivery.js', ['buildEmbed', 'deliver']],
  ['src/modules/social/socialCreators.js', ['list', 'save', 'linkAccount', 'unlinkAccount', 'rebuild']],
  ['src/modules/social/socialSimulator.js', ['build', 'simulate']],
  ['src/modules/social/socialScheduler.js', ['runSocialCheck', 'startSocialScheduler', 'handleProviderResult']],
  ['src/modules/social/socialQueue.js', ['list', 'processGuild', 'start']],
  ['src/modules/social/socialHistory.js', ['list', 'record', 'summary']],
  ['src/modules/social/providers/twitchProvider.js', ['checkAccount']],
  ['src/modules/social/providers/youtubeProvider.js', ['checkAccount', 'resolveChannel']],
  ['src/modules/social/providers/kickProvider.js', ['checkAccount', 'normalizeSlug', 'isConfigured']],
  ['src/modules/social/providers/xProvider.js', ['checkAccount', 'normalizeUsername', 'isConfigured']],
  ['src/commands/admin/socialhub.js', ['data', 'execute']],
  ['src/dashboard/js/pages/modules/Social.jsx', []],
  ['docs/modules/social-alerts.md', []],
];

const errors = [];
console.log('\nSocial Studio doctor');
console.log('====================');

for (const [relativePath, exports] of checks) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) {
    errors.push(`${relativePath}: missing file`);
    console.log(`❌ ${relativePath}`);
    continue;
  }
  if (!relativePath.endsWith('.js') || !exports.length) {
    console.log(`✅ ${relativePath}`);
    continue;
  }
  try {
    delete require.cache[require.resolve(fullPath)];
    const loaded = require(fullPath);
    const missing = exports.filter((name) => loaded?.[name] === undefined);
    if (missing.length) {
      errors.push(`${relativePath}: missing export(s) ${missing.join(', ')}`);
      console.log(`❌ ${relativePath}`);
    } else {
      console.log(`✅ ${relativePath}`);
    }
  } catch (error) {
    errors.push(`${relativePath}: failed to load - ${error.message}`);
    console.log(`❌ ${relativePath}`);
  }
}

function requireText(relativePath, requiredValues) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  for (const required of requiredValues) {
    if (!source.includes(required)) errors.push(`${relativePath}: missing ${required}`);
  }
}

requireText('src/modules/social/socialRoute.js', ['socialCreatorRoute', "router.use('/:guildId/creator-hub'"]);
requireText('src/events/interactions/interactionCreate.js', ['socialPanel', 'socialCreatorPanel']);
requireText('src/modules/social/providerRegistry.js', [
  'AUTHORIZATION_REQUIRED',
  'zeroCredentialSupported',
  'twitchProvider',
  'youtubeProvider',
  'kickProvider',
  'xProvider',
]);
requireText('src/core/modules/moduleManifest.js', [
  "name: 'Social Studio'",
  'maturity: MODULE_MATURITY.COMPLETE',
]);
requireText('src/dashboard/js/shared/moduleRegistry.js', [
  "name: 'Social Studio'",
  'status: MODULE_STATUSES.live',
]);
requireText('docs/modules/social-alerts.md', [
  'Completion state',
  'Social Studio v1 is complete',
  'authorization_required',
]);

if (errors.length) {
  console.error(`\nSocial Studio doctor failed (${errors.length} issue${errors.length === 1 ? '' : 's'}):`);
  for (const error of errors) console.error(` - ${error}`);
  process.exitCode = 1;
} else {
  console.log('\n✅ Social Studio doctor passed.');
  console.log('✅ Supported production providers: Twitch, YouTube, Kick, X.');
  console.log('✅ TikTok and Instagram are intentionally excluded from v1 zero-credential monitoring.');
}
