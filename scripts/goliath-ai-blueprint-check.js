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
console.log('Goliath AI blueprint dry-run contracts passed.');
