'use strict';

const fetch = require('node-fetch');

const API_ROOT = 'https://www.googleapis.com/youtube/v3';

function now() { return new Date().toISOString(); }
function clean(value, max = 500) { return String(value || '').trim().slice(0, max); }
function apiKey() { return clean(process.env.YOUTUBE_API_KEY, 500); }
function isoDurationSeconds(value = '') {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(value));
  if (!match) return 0;
  return Number(match[1] || 0) * 86400 + Number(match[2] || 0) * 3600 + Number(match[3] || 0) * 60 + Number(match[4] || 0);
}
function identifier(account = {}) {
  const raw = clean(account.externalId || account.username || account.url, 500);
  if (!raw) return { type: 'none', value: '' };
  const channelMatch = raw.match(/(?:youtube\.com\/channel\/)?(UC[\w-]{20,})/i);
  if (channelMatch) return { type: 'id', value: channelMatch[1] };
  const handleMatch = raw.match(/(?:youtube\.com\/@|^@?)([\w.-]{3,})/i);
  return { type: 'handle', value: handleMatch?.[1] || raw.replace(/^@/, '') };
}
async function request(resource, params) {
  const key = apiKey();
  if (!key) throw new Error('YouTube provider is missing the global YOUTUBE_API_KEY.');
  const query = new URLSearchParams({ ...params, key });
  const started = Date.now();
  const response = await fetch(`${API_ROOT}/${resource}?${query.toString()}`, { headers: { Accept: 'application/json' }, timeout: 15000 });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `YouTube API returned ${response.status}.`);
  return { data, responseTimeMs: Date.now() - started };
}
async function resolveChannel(account) {
  const ref = identifier(account);
  if (ref.type === 'none') throw new Error('Enter a YouTube handle, channel ID, or public channel URL.');
  const params = { part: 'id,snippet,contentDetails', maxResults: '1' };
  params[ref.type === 'id' ? 'id' : 'forHandle'] = ref.value;
  let result = await request('channels', params);
  if (!result.data.items?.length && ref.type === 'handle') {
    result = await request('channels', { part: 'id,snippet,contentDetails', forUsername: ref.value, maxResults: '1' });
  }
  const channel = result.data.items?.[0];
  if (!channel) throw new Error(`YouTube channel '${ref.value}' could not be resolved.`);
  return { channel, responseTimeMs: result.responseTimeMs };
}
async function checkAccount(account = {}) {
  const checkedAt = now();
  try {
    const resolved = await resolveChannel(account);
    const uploadsPlaylistId = resolved.channel.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylistId) throw new Error('YouTube uploads playlist is unavailable for this channel.');
    const playlistResult = await request('playlistItems', { part: 'snippet,contentDetails', playlistId: uploadsPlaylistId, maxResults: '1' });
    const item = playlistResult.data.items?.[0];
    if (!item?.contentDetails?.videoId) {
      return { success: true, status: 'ready', providerStatus: 'ready', platform: 'youtube', externalId: resolved.channel.id, displayName: resolved.channel.snippet?.title || account.displayName, checkedAt, responseTimeMs: resolved.responseTimeMs + playlistResult.responseTimeMs, hasAlert: false };
    }
    const videoId = item.contentDetails.videoId;
    const videoResult = await request('videos', { part: 'snippet,contentDetails,liveStreamingDetails,status', id: videoId, maxResults: '1' });
    const video = videoResult.data.items?.[0] || {};
    const durationSeconds = isoDurationSeconds(video.contentDetails?.duration);
    const isLive = video.snippet?.liveBroadcastContent === 'live' || Boolean(video.liveStreamingDetails?.actualStartTime && !video.liveStreamingDetails?.actualEndTime);
    const isShort = !isLive && durationSeconds > 0 && durationSeconds <= 180;
    const alertType = isLive ? 'live' : isShort ? 'short' : 'upload';
    const publishedAt = video.snippet?.publishedAt || item.contentDetails?.videoPublishedAt || item.snippet?.publishedAt || checkedAt;
    return {
      success: true,
      status: 'ready',
      providerStatus: 'ready',
      platform: 'youtube',
      externalId: resolved.channel.id,
      displayName: resolved.channel.snippet?.title || account.displayName,
      checkedAt,
      responseTimeMs: resolved.responseTimeMs + playlistResult.responseTimeMs + videoResult.responseTimeMs,
      hasAlert: true,
      isLive,
      alertType,
      contentId: videoId,
      title: video.snippet?.title || item.snippet?.title || 'New YouTube content',
      description: video.snippet?.description || item.snippet?.description || '',
      url: `https://www.youtube.com/watch?v=${videoId}`,
      thumbnailUrl: video.snippet?.thumbnails?.maxres?.url || video.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.high?.url || null,
      publishedAt,
      durationSeconds,
      duration: video.contentDetails?.duration || null,
      liveStreamingDetails: video.liveStreamingDetails || null,
    };
  } catch (error) {
    return { success: false, status: apiKey() ? 'error' : 'not_configured', providerStatus: apiKey() ? 'error' : 'not_configured', platform: 'youtube', accountId: account.accountId, username: account.username, checkedAt, error: error.message };
  }
}

module.exports = { id: 'youtube', label: 'YouTube', implemented: true, supportedAlertTypes: ['upload', 'short', 'live'], requiredEnv: ['YOUTUBE_API_KEY'], checkAccount, resolveChannel, isoDurationSeconds };