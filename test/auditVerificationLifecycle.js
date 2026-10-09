'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

function read(path) {
  assert(fs.existsSync(path), `Missing required Verification file: ${path}`);
  return fs.readFileSync(path, 'utf8');
}

function contains(source, token, label) {
  assert(source.includes(token), `Verification contract missing: ${label}`);
}

const flow = read('./src/modules/securityStudio/verificationFlowContinuation.js');
const quarantine = read('./src/modules/securityStudio/verificationQuarantine.js');
const lifecycle = read('./src/events/members/verificationLifecycle.js');
const risk = read('./src/core/administration/mod/verificationRiskBridge.js');
const store = read('./src/modules/securityStudio/verificationStore.js');
const manager = read('./src/modules/securityStudio/verificationManager.js');
const panel = read('./src/modules/securityStudio/verificationPanel.js');
const memberIntelligence = read('./src/events/members/memberIntelligence.js');
const challengeRuntime = read('./src/modules/securityStudio/verificationChallengeRuntime.js');
const challengeInteractions = read('./src/modules/securityStudio/verificationChallengeInteractions.js');

// Guard the security handoff and challenge recovery against regressions.
contains(manager, 'pendingSecurity:true', 'manager delegates security checks to continuation');
contains(manager, 'Verification starting roles could not be confirmed.', 'block security flow if starting roles fail');
const verifyingStateWrite = "setSession(gid,uid,{state:'verifying',startedAt:verificationStore.getSession(gid,uid)?.startedAt||now()});";
const startingRolesConfirmed = "if(!confirmed||!verifying.every(role=>confirmed.roles.cache.has(role.id))||pending.some(role=>confirmed.roles.cache.has(role.id)))";
assert(manager.indexOf(verifyingStateWrite) > manager.indexOf(startingRolesConfirmed), 'Verifying state must be persisted after starting role confirmation.');
contains(flow, 'if(!confirmed||![...verified,...auto].every', 'fail closed when completion member fetch fails');
contains(manager, 'pending.some(role=>confirmed.roles.cache.has(role.id))', 'confirm pending roles removed before security flow');
contains(flow, 'challengeRuntime.startStep(g.id,m.id,step,s)', 'challenge reuse validated by runtime');
assert(!flow.includes("active?.status==='pending'?{ok:true,pending:true"), 'Continuation must not bypass challenge runtime validation.');
contains(challengeRuntime, "reason: 'security_configuration_changed'", 'reject outdated security challenges');
contains(challengeRuntime, 'verificationChallenges.expire(guildId, userId, active.challengeId)', 'expire old challenge before restarting');
contains(challengeRuntime, 'active = verificationChallenges.active(guildId, userId)', 'refresh challenge after expiry');
contains(challengeInteractions, 'session.securityConfigRevision', 'reject stale member challenge interactions');
contains(manager, 'Quarantine role transition could not be confirmed.', 'verify quarantine roles before state change');
contains(manager, "roles.length!==roleIds(s,'quarantine').length", 'reject missing configured quarantine roles');
contains(manager, 'm.guild.members.fetch({user:m.id,force:true})', 'confirm quarantine against fresh Discord member state');
assert((manager.match(/m\.guild\.members\.fetch\(\{user:m\.id,force:true\}\)/g)||[]).length>=2, 'Quarantine and bypass completion must independently confirm fresh Discord roles.');
contains(panel, 'finalNav()]};}', 'consistent Verification navigation');


for (const state of ['new', 'pending', 'verifying', 'verified', 'quarantined', 'review', 'rejected']) {
  contains(store, `'${state}'`, `persistent lifecycle state ${state}`);
}

for (const method of ['captcha', 'minigame', 'account_age', 'discord_screening', 'bot_protection', 'staff_approval', 'one_time_challenge', 'risk_based', 'rejoin_history']) {
  contains(flow, method, `security method ${method}`);
}

contains(flow, 'maximumFailedAttempts', 'configurable failed-attempt limit');
contains(flow, 'quarantineVerificationMember', 'failure-to-quarantine transition');
contains(flow, 'requiredSecurity', 'dynamic required-security planning');
contains(flow, 'raidPressure', 'raid-pressure security planning');
contains(quarantine, "new Set(['release', 'reject', 'escalate'])", 'quarantine resolution actions');
contains(quarantine, 'escalateToModHub', 'Mod Hub escalation');
contains(quarantine, 'reconcileModerationRelease', 'Mod Hub release reconciliation');
contains(lifecycle, "name:'guildMemberAdd'", 'join lifecycle handler');
contains(lifecycle, "name:'guildMemberUpdate'", 'screening/role lifecycle handler');
contains(lifecycle, "name:'guildMemberRemove'", 'leave/reset lifecycle handler');
contains(lifecycle, 'applyRaidPressure', 'anti-raid join-pressure evaluation');
contains(risk, 'resolveRequiredSecurity', 'Member Intelligence security bridge');
contains(risk, 'rejoinHistory', 'rejoin security elevation');
contains(risk, 'staffApproval', 'high-attention staff approval elevation');
contains(manager, 'discord_screening', 'screening health validation');
contains(manager, 'risk_based', 'risk health validation');
contains(manager, 'quarantine', 'quarantine health validation');

// The canonical Verification admin surface must be the rehauled module.
for (const section of ['roles', 'security', 'intelligence', 'flow', 'messages', 'logs', 'settings']) {
  contains(panel, `'${section}'`, `admin section ${section}`);
  contains(panel, `admin:verification:page:${section}`, `admin navigation ${section}`);
}
contains(panel, "emb('🛡️ Verification'", 'Verification home title');
assert(!panel.includes('Front Door'), 'Legacy Front Door wording must not appear in Verification panel');
contains(panel, 'Verification · Security', 'Security control page');
contains(panel, 'NEW MEMBER → PENDING → VERIFYING → VERIFIED → SERVER', 'canonical member journey');
contains(panel, 'admin:verification:security:', 'stackable security controls');
contains(panel, 'admin:verification:intelligence:', 'integrated intelligence controls');
contains(panel, 'admin:verification:flowSecurity', 'security flow selection');
contains(panel, 'Verification · Logs', 'Verification logging page');

assert(!panel.includes('Verification · Overview'), 'Legacy Verification Overview must not be reachable from the canonical panel.');
assert(!panel.includes('admin:verification:page:workflow'), 'Legacy Workflow page must not remain in the canonical panel.');
assert(!panel.includes('admin:verification:page:requirements'), 'Legacy Requirements page must not remain in the canonical panel.');
assert(!panel.includes('admin:verification:page:panel'), 'Legacy Panels page must not remain in the canonical panel.');
assert(!memberIntelligence.includes('verificationIntelligenceExtension'), 'Member Intelligence must not monkey-patch the Verification admin UI.');
assert(!fs.existsSync('./src/modules/securityStudio/verificationIntelligenceExtension.js'), 'Legacy Verification UI compatibility extension must be removed.');

const forbiddenGenerationPattern = new RegExp('\\b' + 'v' + '[23]' + '\\b', 'i');
assert(!forbiddenGenerationPattern.test([flow, quarantine, lifecycle, risk, store, manager, panel].join('\n')), 'Verification source contains forbidden numbered-generation naming.');

console.log('Verification lifecycle and admin-surface contract audit passed.');
