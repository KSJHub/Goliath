'use strict';

const {
  clean,
  handle,
  request,
  oauthClientToken,
  unavailable,
  result,
} = require('./shared');

function first(value, ...fallbacks) {
  if (value !== undefined && value !== null && value !== '') return value;
  for (const fallback of fallbacks) {
    if (fallback !== undefined && fallback !== null && fallback !== '') return fallback;
  }
  return null;
}

async function checkKick(account) {
  if (!process.env.KICK_CLIENT_ID || !process.env.KICK_CLIENT_SECRET) {
    return unavailable('kick', 'Set KICK_CLIENT_ID and KICK_CLIENT_SECRET.', 'configuration_required');
  }

  const token = await oauthClientToken(
    'kick',
    'https://id.kick.com/oauth/token',
    process.env.KICK_CLIENT_ID,
    process.env.KICK_CLIENT_SECRET,
  );

  const username = handle(account);
  if (!username) return unavailable('kick', 'Kick username or channel URL could not be resolved.');

  const headers = { Authorization: `Bearer ${token}` };
  const { json: channelJson } = await request(
    `https://api.kick.com/public/v1/channels?slug=${encodeURIComponent(username)}`,
    { headers },
  );

  const channel = Array.isArray(channelJson?.data) ? channelJson.data[0] : channelJson?.data;
  if (!channel) return unavailable('kick', 'Kick channel could not be resolved.');

  const broadcasterId = channel.broadcaster_user_id || channel.user_id || channel.id;
  const resolvedUsername = clean(channel.slug || username);
  const channelUrl = `https://kick.com/${encodeURIComponent(resolvedUsername || username)}`;
  const streamFromChannel = channel.stream && typeof channel.stream === 'object' ? channel.stream : null;
  let stream = streamFromChannel?.is_live ? streamFromChannel : null;

  if (!stream && broadcasterId) {
    const { json: liveJson } = await request(
      `https://api.kick.com/public/v1/livestreams?broadcaster_user_id=${encodeURIComponent(broadcasterId)}`,
      { headers },
    );
    stream = Array.isArray(liveJson?.data) ? liveJson.data[0] : liveJson?.data;
  }

  const avatar = first(
    stream?.profile_picture,
    channel.profile_picture,
    stream?.channel?.profile_picture,
  );

  if (!stream) {
    return result('kick', {
      isLive: false,
      externalId: String(broadcasterId || ''),
      resolvedUsername,
      url: channelUrl,
      avatar,
    });
  }

  const startedAt = first(
    stream.started_at,
    stream.start_time,
    streamFromChannel?.started_at,
    streamFromChannel?.start_time,
  );
  const viewerCount = first(stream.viewer_count, streamFromChannel?.viewer_count);
  const language = first(stream.language, stream.lang_iso, streamFromChannel?.language, streamFromChannel?.lang_iso);
  const hasMatureContent = first(
    stream.has_mature_content,
    stream.is_mature,
    streamFromChannel?.has_mature_content,
    streamFromChannel?.is_mature,
  );
  const customTags = Array.isArray(stream.custom_tags)
    ? stream.custom_tags
    : Array.isArray(channel.custom_tags)
      ? channel.custom_tags
      : [];
  const category = first(stream.category?.name, channel.category?.name);
  const thumbnail = first(
    stream.thumbnail,
    stream.thumbnail_url,
    streamFromChannel?.thumbnail,
    streamFromChannel?.thumbnail_url,
    stream.channel?.profile_picture,
  );

  return result('kick', {
    isLive: true,
    externalId: String(broadcasterId || ''),
    resolvedUsername: clean(stream.slug || resolvedUsername || username),
    url: channelUrl,
    avatar,
    event: {
      type: 'live',
      id: String(stream.id || `kick-live:${broadcasterId}`),
      title: stream.stream_title || stream.title || channel.stream_title || `${resolvedUsername || username} is live`,
      url: channelUrl,
      thumbnail,
      viewerCount,
      startedAt,
      category,
      language: language || null,
      hasMatureContent: hasMatureContent === true,
      customTags: customTags.slice(0, 10),
      kickUsername: clean(stream.slug || resolvedUsername || username),
    },
  });
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
