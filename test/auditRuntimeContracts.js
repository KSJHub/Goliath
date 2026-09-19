'use strict';

const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');

const surfaces = [
  ['src/modules/socialStudio/socialAlerts/socialStudio', ['getAccess', 'findByOwnerDiscordId', 'getAccountsForCreator', 'completeCreatorProfile']],
  ['src/modules/socialStudio/socialAlerts/socialStudioMonitor', ['startupSocialStudio', 'checkGuildAccounts', 'forcePostCreatorLive', 'projectLiveRefreshState', 'projectGuildConfig', 'projectedOptions', 'projectedRefreshTimestamp', 'repairLiveRollovers', 'buildLiveFields', 'livePlatformField']],
  ['src/core/administration/admin/panel', ['buildAdminPanel', 'handleAdminNavigation', 'getAuthorityConfig', 'hasGuildPermission', 'getAuthorityContext', 'canManageGuildAuthority']],
  ['src/core/ui/panelNavigation', ['createState', 'normalize', 'encodeState', 'decodeState', 'push', 'back', 'current', 'buildCustomId', 'parseCustomId', 'applyNavigationUI']],
  ['src/core/administration/mod/storage', ['searchCases', 'getCaseById', 'getCaseAudit', 'recordCaseAudit', 'updateCaseReason', 'updateCaseStatus', 'updateCaseNote', 'clearCaseNote']],
  ['src/owner/auditIntelligence/auditRouter', ['deliver', 'ensureAuditChannel', 'ensureUserAuditChannel', 'ensureReportRoutes', 'refreshUserSummary', 'getOwnerAuditGuildId', 'ensureCommandCenter', 'routeKeyForEvent', 'monitorKeyForEvent', 'monitoringEnabled', 'configuredRouteChannel', 'runLocalEndToEndProbe', 'runLiveEndToEndProbe', 'channelDeliveryState', 'inspectReportFeeds', 'inspectStructure', 'repairStructure', 'inspectHealth', 'repairHealth']],
];

function load(file) {
  // Runtime contract paths are repository-root-relative. require() resolves
  // relative specifiers from this test file, so always convert them to an
  // absolute path first; otherwise nested callers can accidentally resolve
  // ./src from test/ and fail with MODULE_NOT_FOUND.
  return require(path.resolve(ROOT, file));
}

let failed = false;
for (const [file, names] of surfaces) {
  const mod = load(file);
  const missing = names.filter((name) => typeof mod?.[name] !== 'function');
  console.log(`${missing.length ? '❌' : '✅'} ./${file}`);
  if (missing.length) {
    failed = true;
    console.error(` - missing ${missing.join(', ')}`);
  }
}

const social = load('src/modules/socialStudio/socialAlerts/socialStudio');
const userMethods = ['buildLanding', 'buildDenied', 'buildCreate', 'buildProfile', 'buildSection', 'handleInteraction', 'canAccess'];
const missingUser = userMethods.filter((name) => typeof social?.user?.[name] !== 'function');
console.log(`${missingUser.length ? '❌' : '✅'} ./src/modules/socialStudio/socialAlerts/socialStudio.user`);
if (missingUser.length) {
  failed = true;
  console.error(` - missing ${missingUser.join(', ')}`);
}


// ---------------------------------------------------------
// /admin owner interaction regression contract
// ---------------------------------------------------------
{
  const fs = require('node:fs');

  const adminCommandSource = fs.readFileSync(
    path.resolve(
      ROOT,
      'src/core/administration/admin/command.js'
    ),
    'utf8',
  );

  const brokenPattern =
    'isGoliathOwner ? null : interaction';

  if (adminCommandSource.includes(brokenPattern)) {
    failed = true;

    console.error(
      '❌ ./src/core/administration/admin/command owner interaction contract'
    );

    console.error(
      ' - Goliath owner must retain the real Discord interaction'
    );
  } else {
    console.log(
      '✅ ./src/core/administration/admin/command owner interaction contract'
    );
  }
}

if (failed) process.exit(1);
console.log(`✅ Runtime contract audit: ${surfaces.length + 1} surfaces`);
