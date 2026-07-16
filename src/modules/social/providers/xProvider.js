'use strict';

// src/modules/social/providers/xProvider.js

const X_API_URL = 'https://api.x.com/2';
const X_TOKEN_URL = 'https://api.x.com/oauth2/token';

let cachedBearerToken = null;

function getConfig() {
  return {
    bearerToken: String(process.env.X_BEARER_TOKEN || '').trim(),
    apiKey: String(process.env.X_API_KEY || process.env.X_CLIENT_ID || '').trim(),
    apiKeySecret: String(process.env.X_API_KEY_SECRET || process.env.X_CLIENT_SECRET || '').trim(),
  };
}

function isConfigured() {
  const config = getConfig();
  return Boolean(config.bearerToken || (config.apiKey && config.apiKeySecret));
}

function normalizeUsername(value) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\/(www\.)?(x\.com|twitter\.com)\//i, '')
    .replace(/^@/, '')
    .split(/[/?#]/)[0]
    .replace(/[^A-Za-z0-9_]/g, '')
    .slice(0, 15);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; }
  catch { data = null; }

  if (!response.ok) {
    const detail = data?.detail || data?.title || data?.errors?.[0]?.message || data?.errors?.[0]?.detail || response.statusText || 'X API request failed';
    throw new Error(`${detail} (${response.status})`);
  }
  return data;
}

async function getBearerToken() {
  const config = getConfig();
  if (config.bearerToken) return config.bearerToken;
  if (cachedBearerToken) return cachedBearerToken;
  if (!config.apiKey || !config.apiKeySecret) return null;

  const credentials = Buffer.from(`${encodeURIComponent(config.apiKey)}:${encodeURIComponent(config.apiKeySecret)}`).toString('base64');
  const payload = await fetchJson(X_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    },
    body: 'grant_type=client_credentials',
  });

  if (String(payload?.token_type || '').toLowerCase() !== 'bearer' || !payload?.access_token) {
    throw new Error('X did not return a valid app-only bearer token.');
  }
  cachedBearerToken = payload.access_token;
  return cachedBearerToken;
}

async function xApi(path, params = {}) {
  const token = await getBearerToken();
  if (!token) throw new Error('X provider is missing global Goliath credentials.');
  const query = new URLSearchParams(params);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return fetchJson(`${X_API_URL}${path}${suffix}`, { headers: { Authorization: `Bearer ${token}` } });
}

function mediaMap(includes = {}) {
  return new Map((includes.media || []).map((item) => [item.media_key, item]));
}

async function checkAccount(account = {}) {
  const username = normalizeUsername(account.username || account.url || account.externalId);
  const checkedAt = new Date().toISOString();
  const startedAt = Date.now();

  if (!isConfigured()) {
    return { success: false, status: 'not_configured', providerStatus: 'not_configured', platform: 'x', accountId: account.accountId, username, checkedAt, error: 'X provider is missing X_BEARER_TOKEN or X_API_KEY and X_API_KEY_SECRET.' };
  }
  if (!username) {
    return { success: false, status: 'error', providerStatus: 'error', platform: 'x', accountId: account.accountId, checkedAt, error: 'X username is missing or invalid.' };
  }

  try {
    const userPayload = await xApi(`/users/by/username/${encodeURIComponent(username)}`, {
      'user.fields': 'name,username,protected,profile_image_url,most_recent_tweet_id',
    });
    const user = userPayload?.data;
    if (!user) throw new Error(`X user not found: ${username}`);
    if (user.protected) {
      return {
        success: true,
        status: 'ready',
        providerStatus: 'ready',
        platform: 'x',
        accountId: account.accountId,
        username,
        externalId: user.id,
        displayName: user.name || account.displayName || username,
        checkedAt,
        responseTimeMs: Date.now() - startedAt,
        alertType: 'post',
        hasAlert: false,
        isLive: false,
        protected: true,
      };
    }

    const timeline = await xApi(`/users/${encodeURIComponent(user.id)}/tweets`, {
      max_results: '5',
      exclude: 'retweets,replies',
      'tweet.fields': 'created_at,attachments,entities,public_metrics',
      expansions: 'attachments.media_keys',
      'media.fields': 'media_key,type,url,preview_image_url,width,height',
    });
    const post = timeline?.data?.[0] || null;
    const media = mediaMap(timeline?.includes || {});
    const firstMediaKey = post?.attachments?.media_keys?.[0];
    const firstMedia = firstMediaKey ? media.get(firstMediaKey) : null;

    return {
      success: true,
      status: 'ready',
      providerStatus: 'ready',
      platform: 'x',
      accountId: account.accountId,
      username,
      externalId: user.id,
      displayName: user.name || account.displayName || username,
      checkedAt,
      responseTimeMs: Date.now() - startedAt,
      alertType: 'post',
      hasAlert: Boolean(post?.id),
      isLive: false,
      contentId: post?.id || null,
      title: post?.text ? String(post.text).slice(0, 256) : '',
      description: post?.text || '',
      publishedAt: post?.created_at || null,
      thumbnailUrl: firstMedia?.url || firstMedia?.preview_image_url || user.profile_image_url || '',
      url: post?.id ? `https://x.com/${username}/status/${post.id}` : `https://x.com/${username}`,
      raw: {
        protected: false,
        mostRecentPostId: user.most_recent_tweet_id || post?.id || null,
        publicMetrics: post?.public_metrics || null,
        mediaType: firstMedia?.type || null,
      },
    };
  } catch (error) {
    cachedBearerToken = /401|invalid|expired/i.test(error.message) ? null : cachedBearerToken;
    return { success: false, status: 'error', providerStatus: 'error', platform: 'x', accountId: account.accountId, username, checkedAt, responseTimeMs: Date.now() - startedAt, error: error.message || 'X provider check failed.' };
  }
}

module.exports = {
  id: 'x',
  label: 'X',
  implemented: true,
  isConfigured,
  normalizeUsername,
  checkAccount,
};
