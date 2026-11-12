'use strict';
const assert = require('node:assert/strict');
const { parseBlueprint, toBlueprint, planBlueprint } = require('../src/owner/dev/goliathBlueprint');

const guildId = '123456789012345678';
const categoryId = '223456789012345678';
const channelId = '323456789012345678';
const otherId = '423456789012345678';
const audit = {
  environment: 'DEV', timestamp: '2026-11-12T01:00:00.000Z',
  guild: { id: guildId, name: 'Test Discord' }, channels: [
    { id: categoryId, name: 'Community', type: 4, parentId: null },
    { id: channelId, name: 'general', type: 0, parentId: categoryId },
    { id: otherId, name: 'archive', type: 0, parentId: null }
  ]
};
const original = JSON.stringify(audit);
const starter = toBlueprint(audit);
assert.equal(planBlueprint(audit, starter).operationCount, 0);
const changed = structuredClone(starter);
changed.categories[0].name = 'Social';
changed.categories[0].channels[0].name = 'chat';
changed.categories[0].channels.push({ name: 'guides', type: 'text' });
changed.categories.push({ name: 'Voice', channels: [{ name: 'General Voice', type: 'voice' }] });
const preview = planBlueprint(audit, changed);
assert.equal(preview.executable, false);
assert.equal(preview.readOnly, true);
assert.deepEqual(preview.operations.map(entry => entry.kind),
  ['rename_category', 'edit_channel', 'create_channel', 'create_category', 'create_channel']);
assert.equal(preview.untouchedCount, 1);
assert.equal(JSON.stringify(audit), original, 'Audit must never be mutated by preview');
assert.throws(() => parseBlueprint({ categories: [{ name: 'x', channels: [{ name: 'bad', type: 'invalid' }] }] }));
assert.throws(() => parseBlueprint({ categories: [{ name: 'bad\ncategory', channels: [] }] }));
assert.throws(() => parseBlueprint({ categories: [{ name: 'x', channels: [{ id: categoryId, name: 'c', type: 'text' }] , id: categoryId }] }));
assert.throws(() => planBlueprint(audit, { categories: [{ id: '999999999999999999', name: 'missing', channels: [] }] }));
assert.throws(() => planBlueprint(audit, { categories: [{ name: 'Community', channels: [
  { id: channelId, name: 'a', type: 'text' },
  { id: channelId, name: 'b', type: 'text' }] }] }));
assert.throws(() => parseBlueprint({ categories: Array.from({ length: 41 }, (_, i) => ({ name: 'Category ' + i, channels: [] })) }));
assert.throws(() => parseBlueprint({ categories: [{ name: 'General', channels: [
  { name: 'chat', type: 'text' }, { name: 'CHAT', type: 'text' }
] }] }), /Duplicate channel/);
assert.throws(() => parseBlueprint({ categories: [{ name: 'Oversized', channels:
  Array.from({ length: 51 }, (_, i) => ({ name: 'channel-' + i, type: 'text' }))
}] }), /50 planned channels/);
const crowded = {
  ...audit,
  channels: [...audit.channels,
    ...Array.from({ length: 497 }, (_, i) => ({
      id: String(500000000000000000n + BigInt(i)), name: 'existing-' + i, type: 0, parentId: null
    }))]
};
assert.throws(() => planBlueprint(crowded, { categories: [{ name: 'Extra', channels: [] }] }),
  /500-channel guild limit/);
// Saved draft contracts use an isolated temporary file, never live runtime data.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../src/owner/dev/goliathDraftStore');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goliath-ai-drafts-'));
const tempFile = path.join(tempDir, 'drafts.json');
const oldMode = process.env.BOT_MODE;
try {
  process.env.BOT_MODE = 'DEV';
  const fingerprint = 'a'.repeat(64);
  const draft = store.saveDraft({
    environment: 'DEV', guildId, guildName: audit.guild.name,
    ownerId: guildId, title: 'Initial rebuild', blueprint: changed,
    auditDigest: fingerprint, basedOnAudit: audit.timestamp
  }, tempFile);
  assert.equal(draft.review.status, 'draft');
  assert.equal(draft.executable, false);
  assert.equal(store.listDrafts(tempFile).length, 1);
  assert.equal(store.loadDraft(draft.id, tempFile).blueprint.categories.length, 2);
  assert.throws(() => store.reviewDraft({
    id: draft.id, ownerId: guildId, currentAuditDigest: 'b'.repeat(64)
  }, tempFile), /server changed/i);
  const reviewed = store.reviewDraft({
    id: draft.id, ownerId: guildId, currentAuditDigest: fingerprint
  }, tempFile);
  assert.equal(reviewed.review.status, 'reviewed');
  assert.equal(reviewed.review.checkedBy, guildId);
  assert.equal(reviewed.executable, false);
  assert.equal(store.deleteDraft(draft.id, tempFile), true);
  assert.equal(store.listDrafts(tempFile).length, 0);
  assert.equal(store.deleteDraft(draft.id, tempFile), false);
  process.env.BOT_MODE = 'PRODUCTION';
  assert.throws(() => store.saveDraft({
    environment: 'PRODUCTION', guildId, ownerId: guildId,
    title: 'Must fail', blueprint: changed, auditDigest: fingerprint, basedOnAudit: audit.timestamp
  }, tempFile), /DEV-only/);
} finally {
  if (oldMode === undefined) delete process.env.BOT_MODE; else process.env.BOT_MODE = oldMode;
  fs.rmSync(tempDir, { recursive: true, force: true });
}

const { evaluateReadiness } = require('../src/owner/dev/goliathExecutionReadiness');
const readyAudit = { ...audit, roles: [] };
const readyDraft = {
  id: '00000000-0000-4000-8000-000000000001',
  environment: 'DEV', guildId, guildName: audit.guild.name,
  auditDigest: 'a'.repeat(64), review: { status: 'reviewed', checkedBy: guildId }
};
const report = evaluateReadiness({
  draft: readyDraft, audit: readyAudit, preview, currentDigest: 'a'.repeat(64)
});
assert.equal(report.canExecute, false);
assert.equal(report.executable, false);
assert.equal(report.operationCount, preview.operations.length);
assert.equal(report.checks.find(item => item.key === 'fresh_audit').state, 'passed');
assert(report.blockers.includes('backup'));
assert(report.blockers.includes('execution_engine'));
assert(report.operations.every(item => item.executable === false && item.needsOwnerApproval === true));
const staleReadiness = evaluateReadiness({
  draft: readyDraft, audit: readyAudit, preview, currentDigest: 'b'.repeat(64)
});
assert.equal(staleReadiness.checks.find(item => item.key === 'fresh_audit').state, 'blocked');
assert.equal(staleReadiness.canExecute, false);
const wrongGuild = evaluateReadiness({
  draft: { ...readyDraft, guildId: otherId }, audit: readyAudit, preview,
  currentDigest: 'a'.repeat(64)
});
assert.equal(wrongGuild.checks.find(item => item.key === 'owner_scope').state, 'blocked');
assert.equal(wrongGuild.canExecute, false);
assert.throws(() => evaluateReadiness({ draft: readyDraft, audit: readyAudit, preview: null,
  currentDigest: 'a'.repeat(64) }), /required/);

console.log('Goliath AI blueprint and saved-draft and readiness contracts passed.');
