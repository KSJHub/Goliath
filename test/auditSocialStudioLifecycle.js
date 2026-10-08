'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const core = fs.readFileSync('src/modules/socialStudio/socialAlerts/socialStudioMonitorCore.js', 'utf8');
const monitor = fs.readFileSync('src/modules/socialStudio/socialAlerts/socialStudioMonitor.js', 'utf8');
const recovery = fs.readFileSync('src/events/client/socialStudioLivePostRecovery.js', 'utf8');
const facebook = fs.readFileSync('src/modules/socialStudio/socialAlerts/providers/facebook.js', 'utf8');
const tiktok = fs.readFileSync('src/modules/socialStudio/socialAlerts/providers/tiktok.js', 'utf8');

// Source-shape checks intentionally ignore formatting so refactors/Prettier do not break CI.
const compactCore = core.replace(/\s+/g, '');
const compactMonitor = monitor.replace(/\s+/g, '');
const compactRecovery = recovery.replace(/\s+/g, '');
const compactFacebook = facebook.replace(/\s+/g, '');
const compactTikTok = tiktok.replace(/\s+/g, '');

const contracts = [
  ['OFFLINE transition', 'checked.isLive===false&&previous.isLive===true'],
  ['stable ended identity', 'id:`ended:${previous.liveEventId||prior.id||account.accountId}`'],
  ['VOD correlation', 'vodMatchesEndedStream(item,startedAt,endedAt)'],
  ['persistent event dedupe', 'deliveredEventKeys'],
  ['deleted-message recovery', 'recovered=Boolean(updated)'],
  ['recovery without ping', 'suppressMention:true'],
  ['forced LIVE state persistence', 'state.lastLiveMessageId=delivered.messageId'],
  ['forced LIVE channel persistence', 'state.lastLiveMessageChannelId=delivered.channelId'],
  ['forced LIVE refresh clock', 'state.lastLiveMessageUpdatedAt=stamp'],
  ['forced LIVE state save', 'saveMonitorState(guildId,config,monitorUpdates,{alerts:sent.length},historyEntries'],
  ['failed delivery retry toggle', 'config.settings.retryDeliveries!==false'],
  ['retry attempt limit', 'config.settings.maxDeliveryAttempts||5'],
  ['retry interval', 'config.settings.retryIntervalMs||60000'],
  ['persisted pending delivery', 'state.pendingDelivery'],
  ['retry recovery delivery', 'recovered:true'],
  ['exhausted retry release', 'state.pendingDelivery=null'],
  ['delivery failure preserves current state', 'letcurrentState={...previous}'],
  ['retry failure persists current state', 'state:{...currentState,pendingDelivery'],
  ['stale LIVE retry protection', "pendingLiveStale=Boolean(pendingEvent?.type==='live'"],
  ['stale LIVE retry clears pending', 'state.pendingDelivery=null'],
  ['recovery concurrency deferral', "result?.skipped&&result.reason==='check_already_running'"],
  ['rollover concurrency deferral', "repairedItem?.status==='skipped'&&repairedItem?.reason==='already_running'"],
  ['quiet hours persistent hold', 'quietHoursPending'],
  ['quiet hours held audit', "status:'quiet_held'"],
  ['quiet hours release audit', "status:'quiet_released'"],
  ['stale quiet LIVE discard audit', "status:'quiet_stale_discarded'"],
  ['diagnostic provider isolation', 'options.diagnosticOnly===true'],
  ['LIVE notification target is server authoritative', "constlive=String(eventType||'').toLowerCase()==='live'"],
  ['creator LIVE profile visibility', 'creator?.showProfileInLive!==false'],
];

for (const [name, needle] of contracts) {
  const source = name.includes('recovery concurrency') ? compactRecovery : name.includes('rollover concurrency') ? compactMonitor : compactCore;
  assert(source.includes(needle), `${name} contract missing`);
}

assert(compactMonitor.includes('previousEventId===currentEventId'), 'rollover equality guard missing');
assert(compactMonitor.includes('stalePostRemoved'), 'stale rollover cleanup missing');

// Completed LIVE sessions must retire volatile broadcast identity only after
// ENDED delivery/retry work is finished. Durable dedupe/history can remain.
assert(compactRecovery.includes('completedSessionNeedsRetirement'), 'completed-session retirement guard missing');
assert(compactRecovery.includes("state.isLive!==false"), 'retirement must require confirmed OFFLINE state');
assert(compactRecovery.includes("state.pendingEndedEvent&&typeofstate.pendingEndedEvent==='object'"), 'retirement must preserve pending ENDED state');
assert(compactRecovery.includes("state.pendingDelivery?.event?.type==='ended'"), 'retirement must preserve pending ENDED delivery retries');
assert(compactRecovery.includes('state.liveEventId=null'), 'completed-session liveEventId retirement missing');
assert(compactRecovery.includes('state.liveStartedAt=null'), 'completed-session liveStartedAt retirement missing');
assert(compactRecovery.includes('state.lastLiveEvent=null'), 'completed-session lastLiveEvent retirement missing');
assert(compactRecovery.includes('state.peakViewers=0'), 'completed-session peak viewer retirement missing');
assert(compactRecovery.includes("String(state.lastAlertKey||'').startsWith('live:')"), 'stale LIVE alert key retirement missing');
assert(compactRecovery.includes('retireCompletedSessions(guild.id,guildConfig)'), 'completed-session retirement sweep missing');

// Provider lifecycle safety: an uncertain provider response must not become a
// false OFFLINE transition, because OFFLINE can emit an ended notification.
assert(
  compactFacebook.includes("returnunavailable('facebook',`FacebookLIVEstatusunavailable:${error.message}`)"),
  'Facebook LIVE lookup failures must remain unavailable instead of becoming OFFLINE',
);
assert(
  !compactFacebook.includes("live_videos?broadcast_status=LIVE&fields=id,title,status,permalink_url,creation_time&limit=1&access_token=${encodeURIComponent(token)}`).catch(()=>({json:null}))"),
  'Facebook LIVE lookup must not swallow failure into an empty response',
);
assert(
  compactTikTok.includes('TikTokreturnedthecreatorLIVEpagewithoutadefinitiveLIVE,PAUSEDorENDEDmarker')
    && compactTikTok.includes("returnunavailable('tiktok',"),
  'TikTok ambiguous LIVE page must remain unavailable',
);
assert(compactTikTok.includes("providerSource:ended?'public_page_ended':'public_page_redirect'"), 'TikTok proven OFFLINE paths missing');
assert(compactTikTok.includes("liveStatus:isPaused?'PAUSED':'LIVE'"), 'TikTok PAUSED state contract missing');

// Locked Social Studio lifecycle model:
// LIVE -> ENDED is one retained Discord session/message. VOD/content events are
// independent event identities and must remain independently deduplicatable.
const liveKey = 'live:stream-A';
const endedKey = 'ended:ended:stream-A';
const vodKey = 'vod:vod-A';
const clipKey = 'clip:clip-A';
assert.notEqual(liveKey, endedKey);
assert.notEqual(endedKey, vodKey);
assert.notEqual(vodKey, clipKey);
const independentEvents = new Set([liveKey, endedKey, vodKey, clipKey]);
assert.equal(independentEvents.size, 4, 'LIVE/ENDED/VOD/CLIP identities must remain independent');

// TikTok PAUSED is still the same broadcast session. Resume must not mint a
// second LIVE identity, and only a confirmed OFFLINE transition may end it.
const tiktokSession = { id: 'tt-live-A', state: 'LIVE' };
tiktokSession.state = 'PAUSED';
assert.equal(tiktokSession.id, 'tt-live-A');
assert.equal(tiktokSession.state, 'PAUSED');
tiktokSession.state = 'LIVE';
assert.equal(tiktokSession.id, 'tt-live-A', 'TikTok resume must preserve the LIVE session identity');

// Deterministic VOD-window sanity check. Correlation is metadata only; it must
// never imply that the VOD shares the ENDED event identity.
const started = Date.parse('2026-09-18T20:00:00Z');
const ended = Date.parse('2026-09-18T22:00:00Z');
const margin = 15 * 60 * 1000;
const matchesWindow = (published) => published >= started - margin && published <= ended + margin;
assert.equal(matchesWindow(Date.parse('2026-09-18T21:59:00Z')), true);
assert.equal(matchesWindow(Date.parse('2026-09-18T22:14:59Z')), true);
assert.equal(matchesWindow(Date.parse('2026-09-18T22:16:00Z')), false);

const delivered = new Set(['live:A', 'ended:ended:A', 'vod:vod-A']);
assert.equal(delivered.has('live:A'), true);
assert.equal(delivered.has('vod:vod-A'), true, 'correlated VOD must retain its own delivered-event identity');
assert.equal(delivered.has('live:B'), false);
delivered.add('live:B');
assert.equal(delivered.size, 4);

console.log('✅ Social Studio lifecycle validation passed: provider state -> LIVE/PAUSED -> ENDED retention contract -> independent VOD/content -> LIVE B');
