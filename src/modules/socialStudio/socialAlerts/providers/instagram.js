'use strict';

const {
  clean,
  handle,
  request,
  unavailable,
  result,
} = require('./shared');

function validPublishedAt(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) && ms <= Date.now() + 5 * 60 * 1000 ? new Date(ms).toISOString() : null;
}

async function checkInstagram(account) {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  const businessId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  if (!token || !businessId) return unavailable('instagram', 'Set INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_BUSINESS_ACCOUNT_ID.', 'configuration_required');
  const username = handle(account).replace(/^@+/, '').trim();
  if (!username || !/^[a-z0-9._]{1,30}$/i.test(username)) return unavailable('instagram', 'Instagram username is missing or invalid.', 'configuration_required');
  const version = process.env.FACEBOOK_GRAPH_VERSION || 'v23.0';
  try {
    const fields = `business_discovery.username(${username}){id,username,profile_picture_url,media.limit(1){id,caption,media_type,media_url,permalink,thumbnail_url,timestamp}}`;
    const { json } = await request(`https://graph.facebook.com/${version}/${encodeURIComponent(businessId)}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`);
    const discovery = json?.business_discovery;
    if (!discovery?.id) return unavailable('instagram', 'Instagram account could not be resolved through Business Discovery.');
    const resolvedUsername = clean(discovery.username || username, 100).replace(/^@+/, '');
    const profileUrl = `https://www.instagram.com/${encodeURIComponent(resolvedUsername)}/`;
    const media = discovery.media?.data?.[0];
    const mediaId = clean(media?.id, 200);
    const mediaType = clean(media?.media_type, 30).toUpperCase();
    const publishedAt = validPublishedAt(media?.timestamp);
    const supportedMedia = new Set(['IMAGE', 'VIDEO', 'CAROUSEL_ALBUM', 'REELS']);
    const latestContent = mediaId && publishedAt && supportedMedia.has(mediaType) ? {
      type: mediaType === 'REELS' ? 'short' : 'post',
      id: mediaId,
      title: clean(media.caption || `New Instagram ${mediaType.toLowerCase()}`).slice(0, 180),
      url: /^https:\/\/www\.instagram\.com\//i.test(String(media.permalink || '')) ? media.permalink : profileUrl,
      thumbnail: media.thumbnail_url || media.media_url || null,
      publishedAt,
    } : null;
    return result('instagram', { isLive: false, status: 'ok', externalId: String(discovery.id), resolvedUsername, latestContent, contentItems: latestContent ? [latestContent] : [], url: profileUrl, avatar: discovery.profile_picture_url || null });
  } catch (error) { return unavailable('instagram', `Instagram Graph API unavailable: ${error.message}`); }
}

function isConfigured() {
  return Boolean(
    process.env.INSTAGRAM_ACCESS_TOKEN
    && process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID
  );
}

module.exports = {
  id: 'instagram',
  label: 'Instagram',
  alertTypes: ['post', 'short'],
  isConfigured,
  check: checkInstagram,
};
