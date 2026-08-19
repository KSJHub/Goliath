'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const events = fs.readFileSync(path.join(ROOT, 'src/owner/auditIntelligence/auditEvents.js'), 'utf8');
const embeds = fs.readFileSync(path.join(ROOT, 'src/owner/auditIntelligence/auditEmbeds.js'), 'utf8');
const userIntelligence = fs.readFileSync(path.join(ROOT, 'src/owner/auditIntelligence/userIntelligence.js'), 'utf8');

test('Evidence Summary is built from factual observed state only', () => {
  assert.match(userIntelligence, /function buildEvidenceSummary\(stored, liveGuilds, reconciledGuilds\)/);
  assert.match(userIntelligence, /evidenceSummary: buildEvidenceSummary\(stored, liveGuilds, reconciledGuilds\)/);
  assert.match(userIntelligence, /moderationEvents:/);
  assert.match(userIntelligence, /moderationWithoutAttributedActor:/);
  assert.match(userIntelligence, /activeTimeouts:/);
  assert.match(userIntelligence, /pendingScreening:/);
  assert.match(userIntelligence, /observedJoins:/);
  assert.match(userIntelligence, /observedLeaves:/);
  assert.match(userIntelligence, /knownGuilds:/);
  assert.match(userIntelligence, /currentGuilds:/);
  assert.match(userIntelligence, /formerGuilds:/);
  assert.match(userIntelligence, /observedIdentityValues:/);
  assert.match(userIntelligence, /does not calculate a behavioural or risk score/);
});

test('Evidence Summary is exposed and routed in User Intelligence', () => {
  assert.match(embeds, /owner:audit:evidence/);
  assert.match(embeds, /setLabel\('Evidence Summary'\)/);
  assert.match(embeds, /section === 'evidence'/);
  assert.match(embeds, /Evidence Policy/);
  assert.match(embeds, /Moderation Evidence/);
  assert.match(embeds, /Live Restrictions/);
  assert.match(embeds, /Active Timeouts/);
  assert.match(embeds, /Pending Membership Screening/);
  assert.match(embeds, /Membership Evidence/);
  assert.match(embeds, /Identity Evidence/);
  assert.match(embeds, /No behavioural or risk score is calculated/);
  assert.match(events, /\['deep', 'identity', 'account', 'evidence', 'guilds', 'moderation', 'roles', 'voice', 'timeline', 'actions'\]/);
});
