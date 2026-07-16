'use strict';

const KICK_AUTH_URL = 'https://id.kick.com/oauth/token';
const KICK_API_URL = 'https://api.kick.com/public/v1';

let cachedToken = null;
let cachedTokenExpiresAt = 0;

function getConfig() {
  return {
    clientId: String(process.env.KICK_CLIENT_ID || '').trim(),
    clientSecret: String(process.env.KICK_CLIENT_SECRET || '').trim(),
  };
}

function isConfigured() {
  const config = getConfig();
  return Boolean(config.clientId && config.clientSecret);
}

function normalizeSlug(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw
    .replace(/^https?:\/\/(www\.)?kick\.com\//i, '')
    .replace(/^@/, '')
    .split(/[/?#]/)[0]
    .trim()
    .toLowerCase()
    .slice(0, 25);
}

async function fetchJson(url, options = {}) {
  const startedAt = Date.now();
  const response = await fetch(url, options);
  const body = await response.text();
  let data = null;
  try { data = body ? JSON.parse(body) : null; }
  catch { data = body || null; }

  if (!response.ok) {
    const message = data?.message || data?.error_description || data?.error || response.statusText || 'Kick request failed';
    const error = new Error(`${message} (${response.status})`);
    error.status = response.status;
    throw error;
  }

  return { data, responseTimeMs: Date.now() - startedAt };
}

async function getAccessToken() {
  const config = getConfig();
  if (!config.clientId || !config.clientSecret) return null;
  if (cachedToken && Date.now() < cachedTokenExpiresAt) return cachedToken;

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'client_credentials',
    scope: 'channel:read',
  });
  const result = await fetchJson(KICK_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  cachedToken = result.data?.access_token || null;
  const expiresIn = Math.max(60, Number(result.data?.expires_in || 3600) - 120);
  cachedTokenExpiresAt = Date.now() + expiresIn * 1000;
  return cachedToken;
}

async function kickApi(path, params = {}) {
  const token = await getAccessToken();
  if (!token) throw new Error('Kick provider is missing global Goliath credentials.');
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) value.forEach((item) => query.append(key, String(item)));
    else if (value !== undefined && value !== null && value !== '') query.append(key, String(value));
  }
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return fetchJson(`${KICK_API_URL}${path}${suffix}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
}

async function checkAccount(account = {}) {
  const slug = normalizeSlug(account.username || account.url || account.externalId);
  const checkedAt = new Date().toISOString();
  if (!isConfigured()) {
    return { success: false, status: 'not_configured', providerStatus: 'not_configured', platform: 'kick', accountId: account.accountId, username: slug, checkedAt, error: 'Kick provider is missing KICK_CLIENT_ID or KICK_CLIENT_SECRET.' };
  }
  if (!slug) {
    return { success: false, status: 'error', providerStatus: 'error', platform: 'kick', accountId: account.accountId, checkedAt, error: 'Kick username or profile URL is missing.' };
  }

  try {
    const result = await kickApi('/channels', { slug });
    const channel = result.data?.data?.[0] || null;
    if (!channel) {
      return { success: false, status: 'error', providerStatus: 'error', platform: 'kick', accountId: account.accountId, username: slug, checkedAt, responseTimeMs: result.responseTimeMs, error: `Kick channel not found: ${slug}` };
    }

    const stream = channel.stream || null;
    const isLive = stream?.is_live === true;
    const startedAt = stream?.start_time && !String(stream.start_time).startsWith('0001-') ? stream.start_time : null;
    const broadcasterId = String(channel.broadcaster_user_id || channel.id || '');
    const contentId = isLive ? `kick:${broadcasterId}:${startedAt || stream?.thumbnail || channel.stream_title || 'live'}` : null;

    return {
      success: true,
      status: 'ready',
      providerStatus: 'ready',
      platform: 'kick',
      accountId: account.accountId,
      username: channel.slug || slug,
      externalId: broadcasterId,
      displayName: account.displayName || channel.slug || slug,
      checkedAt,
      responseTimeMs: result.responseTimeMs,
      alertType: 'live',
      isLive,
      contentId,
      title: channel.stream_title || '',
      gameName: channel.category?.name || '',
      viewerCount: Number(stream?.viewer_count || 0),
      thumbnailUrl: stream?.thumbnail || channel.thumbnail || '',
      publishedAt: startedAt,
      url: `https://kick.com/${channel.slug || slug}`,
      raw: {
        broadcasterUserId: channel.broadcaster_user_id || null,
        channelId: channel.id || null,
        startedAt,
        language: stream?.language || null,
        mature: stream?.is_mature === true,
      },
    };
  } catch (error) {
    if (error.status === 401) {
      cachedToken = null;
      cachedTokenExpiresAt = 0;
    }
    return { success: false, status: 'error', providerStatus: 'error', platform: 'kick', accountId: account.accountId, username: slug, checkedAt, error: error.message || 'Kick provider check failed.' };
  }
}

module.exports = {
  id: 'kick',
  label: 'Kick',
  implemented: true,
  isConfigured,
  normalizeSlug,
  checkAccount,
};