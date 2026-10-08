'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const core = fs.readFileSync(
  'src/modules/socialStudio/socialAlerts/socialStudioMonitorCore.js',
  'utf8'
);

const monitor = fs.readFileSync(
  'src/modules/socialStudio/socialAlerts/socialStudioMonitor.js',
  'utf8'
);

const kick = fs.readFileSync(
  'src/modules/socialStudio/socialAlerts/providers/kick.js',
  'utf8'
);

const compactCore = core.replace(/\s+/g, '');

/*
 * LIVE presentation contract.
 *
 * Test semantic presentation behaviour rather than depending on the
 * byte representation of decorative emoji.
 */

assert(
  core.includes('creator?.avatarUrl') &&
    core.includes('account.avatarUrl') &&
    core.includes('event.avatarUrl'),
  'LIVE avatar fallbacks missing'
);

assert(
  core.includes(
    'account.profileUrl || account.url || event.profileUrl || vars.url'
  ),
  'LIVE profile URL fallback missing'
);

assert(
  compactCore.includes('author.url=profileUrl'),
  'LIVE author must be clickable'
);

assert(
  compactCore.includes('embed.setThumbnail(authorIcon)'),
  'LIVE creator thumbnail missing'
);

assert(
  core.includes('LIVE NOW'),
  'LIVE NOW headline missing'
);

assert(
  core.includes('PAUSED'),
  'PAUSED headline missing'
);

assert(
  core.includes('Watch Live'),
  'Watch Live action missing'
);

assert(
  core.includes('OFFLINE'),
  'OFFLINE presentation missing'
);

/*
 * TikTok uses status transitions rather than the normal timed LIVE
 * refresh while the same broadcast remains active.
 */

assert(
  compactCore.includes("platform==='tiktok'") ||
    compactCore.includes('platform==="tiktok"'),
  'TikTok LIVE refresh exception missing'
);

assert(
  compactCore.includes('previous.lastLiveEvent?.liveStatus') &&
    (
      compactCore.includes('checked.event?.liveStatus') ||
      compactCore.includes('checked.event.liveStatus')
    ),
  'TikTok refresh exception must compare LIVE/PAUSED status'
);

assert(
  compactCore.includes('returnbefore!==current'),
  'TikTok refresh exception must update only on status transition'
);

assert(
  compactCore.includes('sameActiveBroadcast'),
  'LIVE presentation must preserve same-broadcast lifecycle handling'
);

/*
 * Kick presentation/provider integration must remain available.
 */

assert(
  kick.includes('kick') ||
    kick.includes('Kick'),
  'Kick provider presentation contract missing'
);

assert(
  core.includes('liveMessageUpdateDue'),
  'LIVE message refresh integration missing'
);

console.log(
  '✅ Social Studio LIVE presentation audit passed.'
);
