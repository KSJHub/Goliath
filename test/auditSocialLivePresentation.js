'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const core = fs.readFileSync('src/modules/socialStudio/socialAlerts/socialStudioMonitorCore.js', 'utf8');
const monitor = fs.readFileSync('src/modules/socialStudio/socialAlerts/socialStudioMonitor.js', 'utf8');
const kick = fs.readFileSync('src/modules/socialStudio/socialAlerts/providers/kick.js', 'utf8');
const compactCore = core.replace(/\s+/g, '');

assert(core.includes('creator?.avatarUrl') && core.includes('account.avatarUrl') && core.includes('event.avatarUrl'), 'LIVE avatar fallbacks missing');
assert(core.includes('account.profileUrl || account.url || event.profileUrl || vars.url'), 'LIVE profile URL fallback missing');
assert(core.includes('author.url=profileUrl'), 'LIVE author must be clickable');
assert(core.includes('embed.setThumbnail(authorIcon)'), 'LIVE creator thumbnail missing');
assert(core.includes("🔴 **LIVE NOW**"), 'LIVE NOW headline missing');
assert(core.includes("▶️ **[Watch Live]"), 'Watch Live action missing');
assert(core.includes("🔴 **LIVE**"), 'LIVE action status missing');
assert(monitor.includes('embed.setThumbnail(avatar)'), 'refresh must retain creator thumbnail');
assert(monitor.includes('author.url = profileUrl'), 'refresh must retain clickable author');
assert(monitor.includes('event.profileImageUrl') && monitor.includes('account.profileImageUrl'), 'refresh avatar fallbacks missing');
assert(kick.includes('/public/v1/livestreams?broadcaster_user_id='), 'Kick LIVE must hydrate from livestream endpoint');
assert(kick.includes('livestream?.profile_picture'), 'Kick LIVE avatar must prefer livestream profile picture');
assert(kick.includes('profileUrl: channelUrl') && kick.includes('avatar,'), 'Kick LIVE event must carry profile presentation metadata');

// TikTok follows the shared LIVE/ENDED presentation contract but cannot use the
// normal timed thumbnail/data refresh. Only a LIVE <-> PAUSED status change may
// request an edit of the existing message; it remains the same broadcast.
assert(
  compactCore.includes("String(account?.platform||'').toLowerCase()==='tiktok'"),
  'TikTok must have an explicit LIVE refresh exception',
);
assert(
  compactCore.includes("previous.lastLiveEvent?.liveStatus") && compactCore.includes("checked.event.liveStatus"),
  'TikTok refresh exception must compare LIVE/PAUSED status on the same session',
);
assert(
  compactCore.includes('returnbefore!==current'),
  'TikTok must refresh only when LIVE/PAUSED state changes, not on the normal timer',
);

console.log('✅ Social Studio LIVE presentation parity audit passed.');
