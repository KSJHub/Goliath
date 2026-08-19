'use strict';

const {
  clean,
  handle,
  request,
  unavailable,
  result,
} = require('./shared');

async function checkInstagram(account) {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  const businessId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  if (!token || !businessId) return unavailable('instagram', 'Set INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_BUSINESS_ACCOUNT_ID.', 'configuration_required');
  const username = handle(account);
  const version = process.env.FACEBOOK_GRAPH_VERSION || 'v23.0';
  try {
    const fields = `business_discovery.username(${username}){id,username,profile_picture_url,media.limit(1){id,caption,media_type,media_url,permalink,thumbnail_url,timestamp}}`;
    const { json } = await request(`https://graph.facebook.com/${version}/${encodeURIComponent(businessId)}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`);
    const discovery = json?.business_discovery;
    if (!discovery?.id) return unavailable('instagram', 'Instagram account could not be resolved through Business Discovery.');
    const media = discovery.media?.data?.[0];
    const latestContent = media ? { type: media.media_type === 'REELS' ? 'short' : 'post', id: media.id, title: clean(media.caption || `New Instagram ${media.media_type || 'post'}`).slice(0, 180), url: media.permalink || `https://www.instagram.com/${username}/`, thumbnail: media.thumbnail_url || media.media_url, publishedAt: media.timestamp } : null;
    return result('instagram', { isLive: false, status: 'ok', externalId: discovery.id, latestContent, contentItems: latestContent ? [latestContent] : [], url: `https://www.instagram.com/${username}/`, avatar: discovery.profile_picture_url });
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
