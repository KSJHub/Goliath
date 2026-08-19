'use strict';

const {
  clean,
  handle,
  request,
  oauthClientToken,
  unavailable,
  result,
} = require('./shared');

async function checkTwitch(account) {
  if (!process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET) return unavailable('twitch', 'Set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET.', 'configuration_required');
  const token = await oauthClientToken('twitch', 'https://id.twitch.tv/oauth2/token', process.env.TWITCH_CLIENT_ID, process.env.TWITCH_CLIENT_SECRET);
  const identifier = clean(account.externalId || handle(account));
  if (!identifier) return unavailable('twitch', 'Twitch username, channel ID or URL could not be resolved.');
  const byId = /^\d{4,20}$/.test(identifier);
  const headers = { Authorization: `Bearer ${token}`, 'Client-Id': process.env.TWITCH_CLIENT_ID };
  const userQuery = byId ? `id=${encodeURIComponent(identifier)}` : `login=${encodeURIComponent(identifier)}`;
  const { json: userJson } = await request(`https://api.twitch.tv/helix/users?${userQuery}`, { headers });
  const user = userJson?.data?.[0];
  if (!user?.id) return unavailable('twitch', 'Twitch channel could not be resolved.');

  const [streamRes, videoRes, clipRes] = await Promise.all([
    request(`https://api.twitch.tv/helix/streams?user_id=${encodeURIComponent(user.id)}`, { headers }),
    request(`https://api.twitch.tv/helix/videos?user_id=${encodeURIComponent(user.id)}&first=5&type=archive`, { headers }).catch(() => ({ json: null })),
    request(`https://api.twitch.tv/helix/clips?broadcaster_id=${encodeURIComponent(user.id)}&first=1`, { headers }).catch(() => ({ json: null })),
  ]);

  const stream = streamRes.json?.data?.[0] || null;
  const videos = Array.isArray(videoRes.json?.data) ? videoRes.json.data : [];
  const streamStartedAt = stream?.started_at ? new Date(stream.started_at).getTime() : null;
  const previousVideo = streamStartedAt
    ? videos.find((item) => {
      const created = new Date(item?.published_at || item?.created_at || 0).getTime();
      return item?.id && Number.isFinite(created) && created < streamStartedAt;
    })
    : null;
  const video = stream ? previousVideo || null : videos[0] || null;
  const clip = clipRes.json?.data?.[0] || null;
  const channelUrl = `https://www.twitch.tv/${encodeURIComponent(user.login)}`;
  const contentItems = [];

  if (!stream && video?.id) contentItems.push({
    type: 'vod', id: String(video.id), title: video.title || `${user.display_name || user.login} VOD`, url: video.url || `${channelUrl}/videos`,
    thumbnail: clean(video.thumbnail_url).replace('%{width}', '1280').replace('%{height}', '720'), duration: video.duration || null,
    viewCount: video.view_count, publishedAt: video.published_at || video.created_at || null,
    category: account.state?.lastLiveEvent?.category || account.state?.lastLiveEvent?.game || null,
  });
  if (clip?.id) contentItems.push({
    type: 'clip', id: String(clip.id), title: clip.title || `${user.display_name || user.login} clip`, url: clip.url,
    thumbnail: clip.thumbnail_url || null, viewCount: clip.view_count, publishedAt: clip.created_at || null, duration: clip.duration || null,
  });

  return result('twitch', {
    isLive: Boolean(stream), externalId: String(user.id), resolvedUsername: user.login, url: channelUrl, avatar: user.profile_image_url || null,
    contentItems, latestContent: contentItems[0] || null,
    event: stream ? {
      type: 'live', id: String(stream.id), title: stream.title || `${user.display_name || user.login} is live`, url: channelUrl,
      thumbnail: clean(stream.thumbnail_url).replace('{width}', '1280').replace('{height}', '720'), viewerCount: stream.viewer_count,
      startedAt: stream.started_at, category: stream.game_name, language: stream.language,
      previousVod: video?.id ? {
        id: String(video.id),
        title: video.title || `${user.display_name || user.login} previous VOD`,
        url: video.url || `${channelUrl}/videos`,
        thumbnail: clean(video.thumbnail_url).replace('%{width}', '1280').replace('%{height}', '720'),
        duration: video.duration || null,
        viewCount: video.view_count,
        publishedAt: video.published_at || video.created_at || null,
      } : null,
    } : null,
  });
}

function isConfigured() {
  return Boolean(
    process.env.TWITCH_CLIENT_ID
    && process.env.TWITCH_CLIENT_SECRET
  );
}

module.exports = {
  id: 'twitch',
  label: 'Twitch',
  alertTypes: ['live', 'vod', 'clip'],
  isConfigured,
  check: checkTwitch,
};
