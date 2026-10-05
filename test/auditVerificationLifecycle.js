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

assert(!/\b(?:v2|v3)\b/i.test([flow, quarantine, lifecycle, risk, store, manager].join('\n')), 'Verification source contains forbidden numbered-generation naming.');

console.log('✅ Verification lifecycle contract audit passed.');
