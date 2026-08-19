'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

const router = read('src/owner/auditIntelligence/auditRouter.js');
const events = read('src/owner/auditIntelligence/auditEvents.js');
const intelligence = read('src/owner/auditIntelligence/auditIntelligence.js');
const store = read('src/owner/auditIntelligence/auditStore.js');
const embeds = read('src/owner/auditIntelligence/auditEmbeds.js');
const userIntelligence = read('src/owner/auditIntelligence/userIntelligence.js');
const ready = read('src/events/client/ready.js');

const auditSources = { router, events, intelligence, store, embeds, userIntelligence, ready };

function assertPatterns(source, patterns, label) {
  for (const pattern of patterns) {
    assert.match(source, pattern, `${label} must preserve contract ${pattern}`);
  }
}

test('Audit Intelligence source files are real implementations', () => {
  for (const [name, source] of Object.entries(auditSources)) {
    const trimmed = source.trim();
    assert.ok(trimmed.length > 100, `${name} must contain a real implementation`);
    assert.notEqual(trimmed, 'PLACEHOLDER', `${name} must not be a placeholder`);
    assert.doesNotMatch(source, /^\s*PLACEHOLDER\s*;?\s*$/m, `${name} must not contain a standalone placeholder stub`);
  }
});

test('audit capture persists before delivery', () => {
  const storeAt = intelligence.indexOf('auditStore.appendEvent(event)');
  const deliverAt = intelligence.indexOf('auditRouter.deliver(client, guild, event)');
  assert.ok(storeAt >= 0, 'capture must persist the event');
  assert.ok(deliverAt > storeAt, 'delivery must happen after persistence');
});

test('audit routing preserves configuration, owner isolation and repair contracts', () => {
  assertPatterns(router, [
    /guildConfig\.enabled === false/,
    /monitoring\[monitorKeyForEvent\(event\)\] !== false/,
    /routes\[key\] \|\| routes\.default/,
    /sourceGuild\.id === getOwnerAuditGuildId\(\)/,
    /async function repairManagedChannelPermissions/,
    /async function repairStructure/,
    /async function repairHealth/,
    /ensureReportRoutes\(client, sourceGuild\)/,
  ], 'audit router');
});

test('Command Center exposes health repair and routing controls', () => {
  assertPatterns(events, [
    /owner:commandcenter:health:repair/,
    /auditRouter\.repairHealth\(client\)/,
    /owner:commandcenter:routing/,
    /owner:commandcenter:intelligence/,
  ], 'Command Center');
});

test('remote probe storage keeps explicit lifecycle and ownership metadata', () => {
  assertPatterns(store, [
    /status: 'pending'/,
    /status: 'claimed'/,
    /status: 'completed'/,
    /status: 'failed'/,
    /status: 'expired'/,
    /claimedAt/,
    /claimedBy/,
    /failedAt/,
    /failedBy/,
  ], 'live probe store');
});

test('remote probe processor claims before execution and completes after execution', () => {
  const claimAt = ready.indexOf('auditStore.claimLiveProbeRequest');
  const executeAt = ready.indexOf('auditRouter.runLocalEndToEndProbe');
  const completeAt = ready.indexOf('auditStore.completeLiveProbeRequest');
  assert.ok(claimAt >= 0, 'processor must claim requests');
  assert.ok(executeAt > claimAt, 'processor must claim before executing');
  assert.ok(completeAt > executeAt, 'processor must complete after executing');
  assertPatterns(ready, [
    /function liveProbeClaimOwnedBy/,
    /liveProbeClaimOwnedBy\(requestId, mode\)/,
    /auditStore\.failLiveProbeRequest/,
  ], 'live probe processor');
});

test('remote probe router keeps distinct terminal outcomes', () => {
  assertPatterns(router, [
    /status === 'completed'/,
    /status === 'failed'/,
    /status === 'expired'/,
    /reason: 'remote-failed'/,
    /reason: 'expired'/,
    /reason: 'remote-timeout'/,
    /lifecycleStatus/,
  ], 'live probe router');
});

test('user intelligence report keeps all major structured summaries', () => {
  assertPatterns(userIntelligence, [
    /function buildDeepSummary\(stored, liveGuilds\)/,
    /function buildIdentitySummary\(stored, liveUser, liveGuilds\)/,
    /function buildAccountMembershipSummary\(stored, liveUser, liveGuilds, reconciledGuilds\)/,
    /function buildEvidenceSummary\(stored, liveGuilds, reconciledGuilds\)/,
    /function buildModerationSummary\(stored\)/,
    /function buildRoleSummary\(stored, liveGuilds\)/,
    /function buildVoiceSummary\(stored, liveGuilds\)/,
    /function reconcileGuildPresence\(stored, liveGuilds\)/,
    /deep: buildDeepSummary\(stored, liveGuilds\)/,
    /identity: buildIdentitySummary\(stored, liveUser, liveGuilds\)/,
    /accountMembership: buildAccountMembershipSummary\(stored, liveUser, liveGuilds, reconciledGuilds\)/,
    /evidenceSummary: buildEvidenceSummary\(stored, liveGuilds, reconciledGuilds\)/,
    /moderation: buildModerationSummary\(stored\)/,
    /roles: buildRoleSummary\(stored, liveGuilds\)/,
    /voice: buildVoiceSummary\(stored, liveGuilds\)/,
  ], 'user intelligence');
});

test('user intelligence controls expose every supported section by stable custom id', () => {
  for (const section of ['deep', 'identity', 'account', 'evidence', 'guilds', 'moderation', 'roles', 'voice', 'timeline', 'actions']) {
    assert.match(embeds, new RegExp(`owner:audit:${section}`), `missing owner:audit:${section} control`);
    assert.match(events, new RegExp(`['\"]${section}['\"]`), `missing ${section} interaction route`);
  }
});

test('user intelligence renderer keeps semantic section routing', () => {
  for (const section of ['deep', 'identity', 'account', 'evidence', 'guilds', 'moderation', 'roles', 'voice', 'actions']) {
    assert.match(embeds, new RegExp(`section === ['\"]${section}['\"]`), `missing ${section} renderer`);
  }
  assertPatterns(embeds, [
    /Environment Coverage/,
    /Guild Presence/,
    /Activity Totals/,
    /Moderation Overview/,
    /Role Change Overview/,
    /Voice Activity Overview/,
    /Evidence Policy/,
    /Membership Overview/,
  ], 'user intelligence embeds');
});

test('reconciled guild presence distinguishes current, former and historical-only state', () => {
  assertPatterns(userIntelligence, [
    /storedCurrentMember: guild\.currentMember/,
    /currentMember: Boolean\(live\) \? true : guild\.currentMember === false \? false : null/,
    /presenceSource: live \? 'live' : guild\.currentMember === false \? 'stored-leave' : 'stored-history'/,
    /presenceSource: 'live'/,
    /const reconciledGuilds = reconcileGuildPresence\(stored, liveGuilds\)/,
  ], 'guild presence reconciliation');
});

test('cross-mode intelligence keeps merge, ranking and match-evidence contracts', () => {
  assertPatterns(store, [
    /function getUserAcrossModes\(userId\)/,
    /function searchUsersAcrossModes\(query, options = \{\}\)/,
    /function mergeUniqueArray\(target, source, keyFn, limit = HISTORY_LIMIT\)/,
    /merged\.names = mergeUniqueArray/,
    /merged\.guilds = mergeGuildMembership/,
    /merged\.recentEvents = mergeUniqueArray/,
    /function identityMatchScore\(value, candidate\)/,
    /matchedOn: entry\.matchedOn/,
    /matchedValue: entry\.matchedValue/,
  ], 'cross-mode intelligence');
});

test('Discord result selection preserves match evidence', () => {
  assertPatterns(events, [
    /function intelligenceMatchKindLabel\(kind\)/,
    /function intelligenceMatchEvidence\(match\)/,
    /matchedOn: entry\.matchedOn \|\| null/,
    /matchedValue: entry\.matchedValue \?\? null/,
    /owner:commandcenter:intelligence:result/,
  ], 'intelligence result selection');
});
