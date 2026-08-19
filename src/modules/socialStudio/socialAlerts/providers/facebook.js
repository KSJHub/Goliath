'use strict';

const {
  clean,
  handle,
  request,
  unavailable,
  result,
} = require('./shared');

async function facebookToken() {
  if (process.env.FACEBOOK_ACCESS_TOKEN) return process.env.FACEBOOK_ACCESS_TOKEN;
  if (!process.env.FACEBOOK_APP_ID || !process.env.FACEBOOK_APP_SECRET) return null;
  const { json } = await request(`https://graph.facebook.com/oauth/access_token?client_id=${encodeURIComponent(process.env.FACEBOOK_APP_ID)}&client_secret=${encodeURIComponent(process.env.FACEBOOK_APP_SECRET)}&grant_type=client_credentials`);
  return json?.access_token || null;
}

async function checkFacebook(account) {
  const token = await facebookToken();
  if (!token) return unavailable('facebook', 'Set FACEBOOK_ACCESS_TOKEN or FACEBOOK_APP_ID + FACEBOOK_APP_SECRET.', 'configuration_required');
  const lookup = clean(account.externalId || account.metadata?.pageId || handle(account));
  const version = process.env.FACEBOOK_GRAPH_VERSION || 'v23.0';
  try {
    const { json: pageJson } = await request(`https://graph.facebook.com/${version}/${encodeURIComponent(lookup)}?fields=id,name,picture&access_token=${encodeURIComponent(token)}`);
    if (!pageJson?.id) return unavailable('facebook', 'Facebook Page could not be resolved. Page Public Content Access may be required.');
    const [liveRes, feedRes] = await Promise.all([
      request(`https://graph.facebook.com/${version}/${pageJson.id}/live_videos?broadcast_status=LIVE&fields=id,title,status,permalink_url,creation_time&limit=1&access_token=${encodeURIComponent(token)}`).catch(() => ({ json: null })),
      request(`https://graph.facebook.com/${version}/${pageJson.id}/feed?fields=id,message,permalink_url,created_time,full_picture&limit=1&access_token=${encodeURIComponent(token)}`).catch(() => ({ json: null })),
    ]);
    const live = liveRes.json?.data?.[0];
    const post = feedRes.json?.data?.[0];
    const latestContent = post ? { type: 'post', id: post.id, title: clean(post.message || 'New Facebook post').slice(0, 180), url: post.permalink_url || `https://www.facebook.com/${pageJson.id}`, thumbnail: post.full_picture, publishedAt: post.created_time } : null;
    return result('facebook', { isLive: Boolean(live), externalId: pageJson.id, latestContent, contentItems: latestContent ? [latestContent] : [], event: live ? { type: 'live', id: live.id, title: live.title || `${pageJson.name || lookup} is live`, url: live.permalink_url || `https://www.facebook.com/${pageJson.id}`, startedAt: live.creation_time } : null, url: `https://www.facebook.com/${pageJson.id}` });
  } catch (error) { return unavailable('facebook', `Facebook Graph API unavailable: ${error.message}`); }
}

function isConfigured() {
  return Boolean(
    process.env.FACEBOOK_ACCESS_TOKEN
    || (
      process.env.FACEBOOK_APP_ID
      && process.env.FACEBOOK_APP_SECRET
    )
  );
}

module.exports = {
  id: 'facebook',
  label: 'Facebook',
  alertTypes: ['live', 'post'],
  isConfigured,
  check: checkFacebook,
};
