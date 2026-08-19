'use strict';

const tokenCache = new Map();
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36 GoliathSocialStudio/1.0';

function clean(value) { return String(value || '').trim(); }

function handle(account) { return clean(account.normalizedUsername || account.username).replace(/^@+/, '').replace(/^https?:\/\//i, '').split(/[/?#]/)[0]; }

function profileUrl(account) { return clean(account.profileUrl || account.url || account.username); }

async function request(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { redirect: 'follow', ...options, signal: controller.signal, headers: { 'User-Agent': UA, Accept: 'application/json,text/html;q=0.9,*/*;q=0.8', ...(options.headers || {}) } });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { }
    if (!response.ok) {
      const message = json?.message || json?.error?.message || json?.error_description || text.slice(0, 250) || `${response.status} ${response.statusText}`;
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return { response, text, json };
  } finally { clearTimeout(timer); }
}

async function oauthClientToken(cacheKey, url, clientId, clientSecret) {
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60000) return cached.token;
  const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' });
  const { json } = await request(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!json?.access_token) throw new Error(`${cacheKey} did not return an access token.`);
  tokenCache.set(cacheKey, { token: json.access_token, expiresAt: Date.now() + Math.max(300, Number(json.expires_in || 3600)) * 1000 });
  return json.access_token;
}

function unavailable(platform, reason, status = 'unavailable') {
  return { platform, status, isLive: null, checkedAt: new Date().toISOString(), reason, providerSource: 'official_api' };
}

function result(platform, values = {}) {
  return { platform, status: values.isLive === true ? 'live' : values.status || 'offline', isLive: values.isLive === true, checkedAt: new Date().toISOString(), providerSource: values.providerSource || 'official_api', contentItems: Array.isArray(values.contentItems) ? values.contentItems : [], ...values };
}

function youtubeThumbnail(snippet = {}) {
  return snippet.thumbnails?.maxres?.url || snippet.thumbnails?.standard?.url || snippet.thumbnails?.high?.url || snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || null;
}

function validProviderDate(ms) {
  const value = Number(ms);
  const earliest = Date.UTC(2020, 0, 1);
  const latest = Date.now() + 24 * 60 * 60 * 1000;
  return Number.isFinite(value) && value >= earliest && value <= latest;
}

function isoFromProviderEpoch(value) {
  if (value === undefined || value === null || value === '' || Number(value) <= 0) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const ms = numeric < 1000000000000 ? numeric * 1000 : numeric;
  return validProviderDate(ms) ? new Date(ms).toISOString() : null;
}

module.exports = {
  clean,
  handle,
  profileUrl,
  request,
  oauthClientToken,
  unavailable,
  result,
  youtubeThumbnail,
  validProviderDate,
  isoFromProviderEpoch,
};
