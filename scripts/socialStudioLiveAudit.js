'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const monitor = require('../src/modules/socialStudio/socialAlerts/socialStudioMonitor');
const providers = require('../src/modules/socialStudio/socialAlerts/socialStudioProviders');

const allowed = [600000, 900000, 1200000, 1800000, 2700000, 3600000];
assert.deepEqual([...monitor.LIVE_REFRESH_INTERVALS], allowed, 'LIVE refresh choices must remain 10/15/20/30/45/60 minutes.');
assert.equal(monitor.liveRefreshMs({}), 600000, 'LIVE refresh must default to 10 minutes.');
assert.equal(monitor.liveRefreshMs({ liveMessageRefreshMs: 300000 }), 600000, 'LIVE refresh must never accept the old 5 minute cadence.');
assert.equal(monitor.liveRefreshMs({ liveMessageRefreshMs: 1200000 }), 1200000, '20 minute LIVE refresh must be accepted.');
assert.equal(monitor.liveRefreshEnabled({ liveMessageRefreshEnabled: false }), false, 'Refresh Off must be respected.');
assert.equal(monitor.liveRefreshEnabled({}), true, 'Refresh defaults to On.');

const projected = monitor.projectGuildConfig({
  modules: {
    social: {
      settings: { liveMessageRefreshEnabled: false, liveMessageRefreshMs: 300000 },
      accounts: {
        a1: {
          accountId: 'a1',
          platform: 'kick',
          username: 'creator',
          enabled: true,
          alertTypes: ['live'],
          state: {
            isLive: true,
            liveEventId: 'room-1',
            lastLiveMessageId: 'message-1',
            lastLiveMessageChannelId: 'channel-1',
          },
        },
      },
      creators: {},
      history: [],
    },
  },
});
assert.equal(projected.modules.social.settings.liveMessageRefreshEnabled, false, 'Projected runtime settings must preserve Refresh Off.');
assert.equal(projected.modules.social.settings.liveMessageRefreshMs, 600000, 'Projected runtime settings must normalize invalid/legacy refresh rates to 10 minutes.');
assert(projected.modules.social.accounts.a1.alertTypes.includes('ended'), 'A tracked LIVE alert must retain synthetic ended handling so LIVE→OFFLINE cleanup/edit always runs.');

const baseEvent = {
  type: 'live',
  category: 'Call of Duty',
  viewerCount: 1234,
  startedAt: new Date(Date.now() - 3600000).toISOString(),
  language: 'en',
};
const livePlatforms = ['kick', 'twitch', 'youtube', 'tiktok', 'facebook'];
for (const platform of livePlatforms) {
  const fields = monitor.buildLiveFields({
    account: { platform, username: 'creator', state: { peakViewers: 1500 } },
    event: baseEvent,
    vars: { viewers: '1,234', peakViewers: '1,500' },
    liveStatus: 'LIVE',
    durationText: '1h',
    started: '<t:1:R>',
    ended: '',
  });
  const names = fields.map((field) => field.name);
  if (platform !== 'tiktok') assert.equal(names[0], '🎮 Game', `${platform} must begin with the Game field.`);
  const label = { kick: 'Kick', twitch: 'Twitch', youtube: 'YouTube', tiktok: 'TikTok', facebook: 'Facebook' }[platform];
  assert(names.some((name) => name.includes(label)), `${platform} must expose its platform field.`);
  assert(names.includes('👥 Viewers'), `${platform} must expose viewers when supplied.`);
  assert(names.includes('🕐 Started'), `${platform} must expose start time when supplied.`);
  assert(names.includes('⏱️ Live For'), `${platform} must expose live duration when supplied.`);
  assert(names.includes('🌐 Language'), `${platform} must expose language when supplied.`);
}

const offlineFields = monitor.buildLiveFields({
  account: { platform: 'kick', username: 'creator', state: { peakViewers: 1500 } },
  event: { ...baseEvent, type: 'ended' },
  vars: { peakViewers: '1,500' },
  liveStatus: 'OFFLINE',
  durationText: '2h 5m',
  started: '<t:1:R>',
  ended: '<t:2:R>',
});
const offlineNames = offlineFields.map((field) => field.name);
assert(offlineNames.includes('📈 Peak Viewers'), 'OFFLINE card must expose peak viewers.');
assert(offlineNames.includes('⏱️ Streamed For'), 'OFFLINE card must expose total stream duration.');
assert(offlineNames.includes('⚫ Ended'), 'OFFLINE card must expose ended time.');

for (const platform of livePlatforms) {
  const info = providers.providerInfo(platform);
  assert((info.supportedAlertTypes || []).includes('live'), `${platform} must remain registered as a LIVE provider.`);
}
for (const platform of ['instagram', 'x']) {
  const info = providers.providerInfo(platform);
  assert(!(info.supportedAlertTypes || []).includes('live'), `${platform} must not advertise LIVE until its provider really implements it.`);
}

const corePath = path.join(__dirname, '../src/modules/socialStudio/socialAlerts/socialStudioMonitorCore.js');
const coreSource = fs.readFileSync(corePath, 'utf8');
assert(!coreSource.includes('KICK_LIVE_MESSAGE_REFRESH_MS'), 'Legacy Kick-only refresh constant must not return.');
assert(coreSource.includes('settings.liveMessageRefreshEnabled === false'), 'Core must explicitly respect Refresh Off.');
assert(coreSource.includes('liveMessageUpdateDue(account, previous, checked, config.settings)'), 'Core refresh decisions must receive persisted guild settings.');
assert(coreSource.includes('updateLiveAlert(client, guildId, config, account, checked.event, previous)'), 'LIVE refresh must edit the tracked message rather than repost it.');

console.log('✅ Social Studio LIVE contract audit passed.');
