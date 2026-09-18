'use strict';

const {
  clean,
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

async function videoDetails(ids, key) {
  const list = [...new Set((ids || []).filter(Boolean))];
  if (!list.length) return new Map();
  try {
    const { json } = await request(`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,liveStreamingDetails,statistics&id=${encodeURIComponent(list.join(','))}&key=${encodeURIComponent(key)}`);
    return new Map((json?.items || []).map((video) => [video.id, video]));
  } catch {
    return new Map();
  }
}

async function categoryName(categoryId, key) {
  if (!categoryId) return null;
  try {
    const { json } = await request(`https://www.googleapis.com/youtube/v3/videoCategories?part=snippet&id=${encodeURIComponent(categoryId)}&key=${encodeURIComponent(key)}`);
    return clean(json?.items?.[0]?.snippet?.title) || null;
  } catch {
    return null;
  }
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
  const liveId = live?.id?.videoId || null;
  const uploadItems = Array.isArray(uploadJson?.items) ? uploadJson.items : [];
  const uploadIds = uploadItems.map((item) => item.contentDetails?.videoId).filter(Boolean).slice(0, 5);
  const detailsById = await videoDetails([liveId, ...uploadIds], key);

  const contentItems = [];
  for (const item of uploadItems) {
    const id = item.contentDetails?.videoId;
    if (!id || id === liveId) continue;
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

  const liveDetails = liveId ? detailsById.get(liveId) || {} : {};
  const liveSnippet = liveDetails.snippet || live?.snippet || {};
  const liveStreaming = liveDetails.liveStreamingDetails || {};
  const liveCategory = liveId ? await categoryName(liveSnippet.categoryId, key) : null;
  const channelUrl = `https://www.youtube.com/channel/${channel.id}`;

  return result('youtube', {
    isLive: Boolean(liveId), externalId: channel.id, resolvedUsername: channel.snippet?.customUrl?.replace(/^@/, '') || handle(account),
    url: channelUrl, avatar: youtubeThumbnail({ thumbnails: channel.snippet?.thumbnails || {} }), contentItems, latestContent: contentItems[0] || null,
    event: liveId ? {
      type: 'live', id: liveId, title: liveSnippet.title || 'YouTube LIVE', url: `https://www.youtube.com/watch?v=${liveId}`,
      thumbnail: youtubeThumbnail(liveSnippet),
      startedAt: liveStreaming.actualStartTime || live?.snippet?.publishedAt || null,
      category: liveCategory,
      language: liveSnippet.defaultAudioLanguage || liveSnippet.defaultLanguage || null,
      viewerCount: liveStreaming.concurrentViewers ? Number(liveStreaming.concurrentViewers) : null,
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
