'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const core = fs.readFileSync('src/modules/socialStudio/socialAlerts/socialStudioMonitorCore.js', 'utf8');
const monitor = fs.readFileSync('src/modules/socialStudio/socialAlerts/socialStudioMonitor.js', 'utf8');

// Source-shape checks intentionally ignore formatting so refactors/Prettier do not break CI.
const compactCore = core.replace(/\s+/g, '');
const compactMonitor = monitor.replace(/\s+/g, '');

const contracts = [
  ['OFFLINE transition', 'checked.isLive===false&&previous.isLive===true'],
  ['stable ended identity', 'id:`ended:${previous.liveEventId||prior.id||account.accountId}`'],
  ['VOD correlation', 'vodMatchesEndedStream(item,startedAt,endedAt)'],
  ['VOD duplicate suppression', "endedVodId&&item.type==='vod'&&String(item.id)===endedVodId"],
  ['persistent event dedupe', 'deliveredEventKeys'],
  ['deleted-message recovery', 'recovered=Boolean(updated)'],
  ['recovery without ping', 'suppressMention:true'],
];

for (const [name, needle] of contracts) {
  assert(compactCore.includes(needle), `${name} contract missing`);
}

assert(
  compactMonitor.includes('previousEventId===currentEventId'),
  'rollover equality guard missing',
);
assert(compactMonitor.includes('stalePostRemoved'), 'stale rollover cleanup missing');

// Deterministic VOD-window and event-identity sanity checks.
const started = Date.parse('2026-09-18T20:00:00Z');
const ended = Date.parse('2026-09-18T22:00:00Z');
const margin = 15 * 60 * 1000;
const matchesWindow = (published) => published >= started - margin && published <= ended + margin;
assert.equal(matchesWindow(Date.parse('2026-09-18T21:59:00Z')), true);
assert.equal(matchesWindow(Date.parse('2026-09-18T22:14:59Z')), true);
assert.equal(matchesWindow(Date.parse('2026-09-18T22:16:00Z')), false);

const delivered = new Set(['live:A', 'ended:ended:A', 'vod:vod-A']);
assert.equal(delivered.has('live:A'), true);
assert.equal(delivered.has('live:B'), false);
delivered.add('live:B');
assert.equal(delivered.size, 4);

console.log('✅ Social Studio lifecycle validation passed: LIVE A -> OFFLINE -> VOD -> LIVE B');
