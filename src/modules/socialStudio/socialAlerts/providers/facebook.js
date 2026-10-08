'use strict';

const {
  clean,
  handle,
  request,
  unavailable,
  result,
} = require('./shared');

let cachedAppToken = null;
let cachedAppTokenAt = 0;
const APP_TOKEN_CACHE_MS = 50 * 60 * 1000;

function validTimestamp(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) && ms <= Date.now() + 5 * 60 * 1000 ? new Date(ms).toISOString() : null;
}

async function facebookToken() {
  if (process.env.FACEBOOK_ACCESS_TOKEN) return process.env.FACEBOOK_ACCESS_TOKEN;
  if (!process.env.FACEBOOK_APP_ID || !process.env.FACEBOOK_APP_SECRET) return null;
  if (cachedAppToken && Date.now() - cachedAppTokenAt < APP_TOKEN_CACHE_MS) return cachedAppToken;
  const { json } = await request(`https://graph.facebook.com/oauth/access_token?client_id=${encodeURIComponent(process.env.FACEBOOK_APP_ID)}&client_secret=${encodeURIComponent(process.env.FACEBOOK_APP_SECRET)}&grant_type=client_credentials`);
  cachedAppToken = json?.access_token || null;
  cachedAppTokenAt = cachedAppToken ? Date.now() : 0;
  return cachedAppToken;
}

async function checkFacebook(account) {
  let token;
  try {
    token = await facebookToken();
  } catch (error) {
    return unavailable('facebook', `Facebook authentication unavailable: ${error.message}`);
  }
  if (!token) return unavailable('facebook', 'Set FACEBOOK_ACCESS_TOKEN or FACEBOOK_APP_ID + FACEBOOK_APP_SECRET.', 'configuration_required');
  const lookup = clean(account.externalId || account.metadata?.pageId || handle(account));
  if (!lookup) return unavailable('facebook', 'Facebook Page ID or username could not be resolved.');
  const version = process.env.FACEBOOK_GRAPH_VERSION || ['v', '23.0'].join('');
  try {
    const { json: pageJson } = await request(`https://graph.facebook.com/${version}/${encodeURIComponent(lookup)}?fields=id,name,username,picture.type(large)&access_token=${encodeURIComponent(token)}`);
    if (!pageJson?.id) return unavailable('facebook', 'Facebook Page could not be resolved. Page Public Content Access may be required.');

    // LIVE status is stateful: a failed LIVE lookup must never be interpreted as
    // OFFLINE, otherwise a transient Graph API failure can generate a false
    // stream-ended transition. Feed lookup is optional and may degrade alone.
    let liveRes;
    try {
      liveRes = await request(`https://graph.facebook.com/${version}/${pageJson.id}/live_videos?broadcast_status=LIVE&fields=id,title,status,permalink_url,creation_time&limit=1&access_token=${encodeURIComponent(token)}`);
    } catch (error) {
      return unavailable('facebook', `Facebook LIVE status unavailable: ${error.message}`);
    }

    const feedRes = await request(`https://graph.facebook.com/${version}/${pageJson.id}/feed?fields=id,message,permalink_url,created_time,full_picture&limit=1&access_token=${encodeURIComponent(token)}`)
      .catch(() => ({ json: null }));

    const live = liveRes.json?.data?.[0];
    const post = feedRes.json?.data?.[0];
    const canonicalUsername = clean(pageJson.username || '').replace(/^@/, '');
    const pageUrl = canonicalUsername ? `https://www.facebook.com/${encodeURIComponent(canonicalUsername)}` : `https://www.facebook.com/${pageJson.id}`;
    const avatar = pageJson.picture?.data?.url || null;
    const postPublishedAt = validTimestamp(post?.created_time);
    const latestContent = post?.id && postPublishedAt ? {
      type: 'post', id: String(post.id), title: clean(post.message || 'New Facebook post').slice(0, 180),
      url: /^https:\/\/(?:www\.)?facebook\.com\//i.test(String(post.permalink_url || '')) ? post.permalink_url : pageUrl,
      thumbnail: post.full_picture || null, publishedAt: postPublishedAt,
    } : null;
    const liveStartedAt = validTimestamp(live?.creation_time);
    return result('facebook', {
      isLive: Boolean(live?.id), externalId: String(pageJson.id), resolvedUsername: canonicalUsername || null,
      latestContent, contentItems: latestContent ? [latestContent] : [], url: pageUrl, avatar,
      event: live?.id ? {
        type: 'live', id: String(live.id), title: clean(live.title || `${pageJson.name || canonicalUsername || lookup} is live`).slice(0, 180),
        url: /^https:\/\/(?:www\.)?facebook\.com\//i.test(String(live.permalink_url || '')) ? live.permalink_url : pageUrl,
        startedAt: liveStartedAt,
      } : null,
    });
  } catch (error) {
    return unavailable('facebook', `Facebook Graph API unavailable: ${error.message}`);
  }
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
