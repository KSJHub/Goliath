'use strict';

const surfaces = [
  ['./src/modules/socialStudio/socialAlerts/socialStudio', ['getAccess', 'findByOwnerDiscordId', 'getAccountsForCreator', 'completeCreatorProfile']],
  ['./src/modules/socialStudio/socialAlerts/socialStudioMonitor', ['startupSocialStudio', 'checkGuildAccounts', 'forcePostCreatorLive', 'projectLiveRefreshState', 'projectGuildConfig', 'projectedOptions', 'projectedRefreshTimestamp', 'repairLiveRollovers', 'buildLiveFields', 'livePlatformField']],
  ['./src/core/administration/mod/storage', ['searchCases', 'getCaseById', 'getCaseAudit', 'recordCaseAudit', 'updateCaseReason', 'updateCaseStatus', 'updateCaseNote', 'clearCaseNote']],
  ['./src/owner/auditIntelligence/auditRouter', ['deliver', 'ensureAuditChannel', 'ensureUserAuditChannel', 'ensureReportRoutes', 'refreshUserSummary', 'getOwnerAuditGuildId', 'ensureCommandCenter', 'routeKeyForEvent', 'monitorKeyForEvent', 'monitoringEnabled', 'configuredRouteChannel', 'runLocalEndToEndProbe', 'runLiveEndToEndProbe', 'channelDeliveryState', 'inspectReportFeeds', 'inspectStructure', 'repairStructure', 'inspectHealth', 'repairHealth']],
];

let failed = false;
for (const [file, names] of surfaces) {
  const mod = require(file);
  const missing = names.filter((name) => typeof mod?.[name] !== 'function');
  console.log(`${missing.length ? '❌' : '✅'} ${file}`);
  if (missing.length) {
    failed = true;
    console.error(` - missing ${missing.join(', ')}`);
  }
}

const social = require('../src/modules/socialStudio/socialAlerts/socialStudio');
const userMethods = ['buildLanding', 'buildDenied', 'buildCreate', 'buildProfile', 'buildSection', 'handleInteraction', 'canAccess'];
const missingUser = userMethods.filter((name) => typeof social?.user?.[name] !== 'function');
console.log(`${missingUser.length ? '❌' : '✅'} ./src/modules/socialStudio/socialAlerts/socialStudio.user`);
if (missingUser.length) {
  failed = true;
  console.error(` - missing ${missingUser.join(', ')}`);
}

if (failed) process.exit(1);
console.log(`✅ Runtime contract audit: ${surfaces.length + 1} surfaces`);
