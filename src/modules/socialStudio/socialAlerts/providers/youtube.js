'use strict';

const {
  handle,
  request,
  unavailable,
  result,
  youtubeThumbnail,
} = require('./shared');

async function youtubeChannel(account, key) {
  const username = handle(account);
  const suppliedId = clean(account.externalId || account.metadata?.channelId || (/^UC[\w-]{20,}$/.test(username) ? username : ''));
  const query = suppliedId ? `id=${encodeURIComponent(suppliedId)}` : `forHandle=${encodeURIComponent(username.replace(/^@/, ''))}`;
  const { json } = await request(`https://www.googleapis.com/youtube/v3/channels?part=id,snippet,contentDetails&${query}&key=${encodeURIComponent(key)}`);
  return json?.items?.[0] || null;
}

function isoSeconds(value) {
  const match = String(value || '').match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  return match ? Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0) : null;
}

async function checkYouTube(account) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return unavailable('youtube', 'Set YOUTUBE_API_KEY.', 'configuration_required');
  const channel = await youtubeChannel(account, key);
  if (!channel?.id) return unavailable('youtube', 'YouTube username, channel ID or URL could not be resolved.');

  const liveReq = request(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&eventType=live&channelId=${encodeURIComponent(channel.id)}&maxResults=1&key=${encodeURIComponent(key)}`);
  const uploadsId = channel.contentDetails?.relatedPlaylists?.uploads;
  const uploadReq = uploadsId ? request(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${encodeURIComponent(uploadsId)}&maxResults=5&key=${encodeURIComponent(key)}`) : Promise.resolve({ json: null });
  const [{ json: liveJson }, { json: uploadJson }] = await Promise.all([liveReq, uploadReq]);
  const live = liveJson?.items?.[0] || null;
  const uploadItems = Array.isArray(uploadJson?.items) ? uploadJson.items : [];
  const videoIds = uploadItems.map((item) => item.contentDetails?.videoId).filter(Boolean).slice(0, 5);
  let detailsById = new Map();

  if (videoIds.length) {
    try {
      const { json: detailsJson } = await request(`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,liveStreamingDetails,statistics&id=${encodeURIComponent(videoIds.join(','))}&key=${encodeURIComponent(key)}`);
      detailsById = new Map((detailsJson?.items || []).map((video) => [video.id, video]));
    } catch { }
  }

  const contentItems = [];
  for (const item of uploadItems) {
    const id = item.contentDetails?.videoId;
    if (!id || id === live?.id?.videoId) continue;
    const details = detailsById.get(id) || {};
    const snippet = details.snippet || item.snippet || {};
    const seconds = isoSeconds(details.contentDetails?.duration);
    let type = 'upload';
    if (seconds !== null && seconds <= 60) type = 'short';
    else if (details.liveStreamingDetails?.actualStartTime || details.liveStreamingDetails?.actualEndTime) type = 'vod';
    contentItems.push({
      type, id, title: snippet.title || 'New YouTube video', url: `https://www.youtube.com/watch?v=${id}`,
      thumbnail: youtubeThumbnail(snippet), publishedAt: item.contentDetails?.videoPublishedAt || snippet.publishedAt || null,
      durationSeconds: seconds, viewCount: details.statistics?.viewCount ? Number(details.statistics.viewCount) : null,
      startedAt: details.liveStreamingDetails?.actualStartTime || null, endedAt: details.liveStreamingDetails?.actualEndTime || null,
    });
  }

  const channelUrl = `https://www.youtube.com/channel/${channel.id}`;
  return result('youtube', {
    isLive: Boolean(live?.id?.videoId), externalId: channel.id, resolvedUsername: channel.snippet?.customUrl?.replace(/^@/, '') || handle(account),
    url: channelUrl, avatar: youtubeThumbnail({ thumbnails: channel.snippet?.thumbnails || {} }), contentItems, latestContent: contentItems[0] || null,
    event: live?.id?.videoId ? {
      type: 'live', id: live.id.videoId, title: live.snippet?.title || 'YouTube LIVE', url: `https://www.youtube.com/watch?v=${live.id.videoId}`,
      thumbnail: youtubeThumbnail(live.snippet), startedAt: live.snippet?.publishedAt || null, category: null,
    } : null,
  });
}

function isConfigured() {
  return Boolean(process.env.YOUTUBE_API_KEY);
}

module.exports = {
  id: 'youtube',
  label: 'YouTube',
  alertTypes: ['live', 'vod', 'upload', 'short'],
  isConfigured,
  check: checkYouTube,
};
