'use strict';

const {
  clean,
  handle,
  request,
  oauthClientToken,
  unavailable,
  result,
} = require('./shared');

async function checkKick(account) {
  if (!process.env.KICK_CLIENT_ID || !process.env.KICK_CLIENT_SECRET) return unavailable('kick', 'Set KICK_CLIENT_ID and KICK_CLIENT_SECRET.', 'configuration_required');
  const token = await oauthClientToken('kick', 'https://id.kick.com/oauth/token', process.env.KICK_CLIENT_ID, process.env.KICK_CLIENT_SECRET);
  const username = handle(account);
  const headers = { Authorization: `Bearer ${token}` };
  const { json: channelJson } = await request(`https://api.kick.com/public/v1/channels?slug=${encodeURIComponent(username)}`, { headers });
  const channel = Array.isArray(channelJson?.data) ? channelJson.data[0] : channelJson?.data;
  if (!channel) return unavailable('kick', 'Kick channel could not be resolved.');
  const broadcasterId = channel.broadcaster_user_id || channel.user_id || channel.id;
  const streamFromChannel = channel.stream;
  let stream = streamFromChannel?.is_live ? streamFromChannel : null;
  if (!stream && broadcasterId) {
    const { json: liveJson } = await request(`https://api.kick.com/public/v1/livestreams?broadcaster_user_id=${encodeURIComponent(broadcasterId)}`, { headers });
    stream = Array.isArray(liveJson?.data) ? liveJson.data[0] : liveJson?.data;
  }
  if (!stream) return result('kick', { isLive: false, externalId: String(broadcasterId || ''), url: `https://kick.com/${encodeURIComponent(username)}` });
  return result('kick', { isLive: true, externalId: String(broadcasterId || ''), event: { type: 'live', id: String(stream.id || `kick-live:${broadcasterId}`), title: stream.stream_title || stream.title || channel.stream_title || `${username} is live`, url: `https://kick.com/${encodeURIComponent(username)}`, thumbnail: stream.thumbnail || stream.thumbnail_url || stream.channel?.profile_picture, viewerCount: stream.viewer_count, startedAt: stream.started_at, category: stream.category?.name || channel.category?.name } });
}

function isConfigured() {
  return Boolean(
    process.env.KICK_CLIENT_ID
    && process.env.KICK_CLIENT_SECRET
  );
}

module.exports = {
  id: 'kick',
  label: 'Kick',
  alertTypes: ['live'],
  isConfigured,
  check: checkKick,
};
