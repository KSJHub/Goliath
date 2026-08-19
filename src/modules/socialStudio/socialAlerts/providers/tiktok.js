'use strict';

const https = require('node:https');
const nodeFetch = require('node-fetch');
const {
  clean,
  handle,
  request,
  unavailable,
  result,
  isoFromProviderEpoch,
} = require('./shared');

const TIKTOK_IPV4_AGENT = new https.Agent({ keepAlive: true, family: 4 });
const TIKTOK_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36 GoliathSocialStudio/1.0';
const RETRYABLE_CONNECT_CODES = new Set(['UND_ERR_CONNECT_TIMEOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'ETIMEDOUT']);
const PAUSE_BOOLEAN_KEYS = ['isPaused', 'is_paused', 'paused', 'livePaused', 'live_paused'];
const PAUSE_STATUS_KEYS = ['liveStatus', 'live_status', 'playbackStatus', 'playback_status', 'streamStatus', 'stream_status', 'playerStatus', 'player_status'];

function networkErrorCode(error) {
  let current = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (current.code) return String(current.code);
    current = current.cause;
  }
  return '';
}

async function ipv4Request(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await nodeFetch(url, {
      redirect: 'follow',
      ...options,
      signal: controller.signal,
      agent: TIKTOK_IPV4_AGENT,
      headers: {
        'User-Agent': TIKTOK_UA,
        Accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
        ...(options.headers || {}),
      },
    });
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
  } finally {
    clearTimeout(timer);
  }
}

async function tiktokRequest(url, options = {}, timeoutMs = 10000) {
  try {
    return await request(url, options, timeoutMs);
  } catch (error) {
    const code = networkErrorCode(error);
    if (!RETRYABLE_CONNECT_CODES.has(code)) throw error;
    console.warn(`[TikTok] ${code} reaching TikTok; retrying over IPv4.`);
    return ipv4Request(url, options, timeoutMs);
  }
}

function tiktokUsername(account) {
  const direct = handle(account);
  if (direct && !/^\d{6,30}$/.test(direct)) return direct;
  const candidates = [account.sourceInput, account.profileUrl, account.url]
    .map(clean)
    .filter(Boolean);
  for (const value of candidates) {
    const match = value.match(/tiktok\.com\/@([^/?#]+)/i);
    if (match?.[1]) return decodeURIComponent(match[1]).replace(/^@+/, '');
    if (!/^https?:\/\//i.test(value) && !/^\d{6,30}$/.test(value)) return value.replace(/^@+/, '').split(/[/?#]/)[0];
  }
  return '';
}

function pausedValue(value) {
  if (value === true || value === 1) return true;
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'paused' || normalized === 'pause';
}

function explicitPausedState(...sources) {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const key of PAUSE_BOOLEAN_KEYS) {
      if (pausedValue(source[key])) return true;
    }
    for (const key of PAUSE_STATUS_KEYS) {
      const value = String(source[key] ?? '').trim().toLowerCase();
      if (value === 'paused' || value === 'pause' || value.includes('paused')) return true;
    }
  }
  return false;
}

function htmlPausedState(body) {
  if (!body) return false;
  const explicitBoolean = /"(?:isPaused|is_paused|paused|livePaused|live_paused)"\s*:\s*(?:true|1|"true"|"1")/i.test(body);
  const explicitStatus = /"(?:liveStatus|live_status|playbackStatus|playback_status|streamStatus|stream_status|playerStatus|player_status)"\s*:\s*"[^"]*paused[^"]*"/i.test(body);
  const humanMarker = /\b(?:LIVE|stream|broadcast)\s+(?:is\s+|has\s+been\s+)?paused\b|\bhost\s+(?:has\s+)?paused\s+(?:the\s+)?LIVE\b/i.test(body);
  return explicitBoolean || explicitStatus || humanMarker;
}

function tiktokApiResult(json, fallbackUsername, fallbackId, source) {
  const user = json?.data?.user && typeof json.data.user === 'object' ? json.data.user : {};
  const liveRoom = json?.data?.liveRoom && typeof json.data.liveRoom === 'object' ? json.data.liveRoom : {};
  const rawStatus = liveRoom.status ?? user.status;
  if (rawStatus === undefined || rawStatus === null) return null;

  const roomId = clean(liveRoom.roomId || liveRoom.room_id || user.roomId || user.room_id);
  const resolvedUsername = clean(user.uniqueId || user.unique_id || liveRoom.owner?.uniqueId || liveRoom.owner?.unique_id || fallbackUsername);
  const resolvedUserId = clean(user.id || user.userId || user.user_id || liveRoom.owner?.id || liveRoom.owner?.userId || fallbackId);
  const hasRoomId = /^[1-9]\d*$/.test(roomId);
  const isPaused = hasRoomId && explicitPausedState(liveRoom, user, liveRoom.streamData, liveRoom.stream_data);
  const isLive = hasRoomId && (Number(rawStatus) === 2 || isPaused);
  if (!isLive) return null;

  const resolvedProfile = resolvedUsername ? `https://www.tiktok.com/@${encodeURIComponent(resolvedUsername)}` : '';
  const resolvedLiveUrl = resolvedProfile ? `${resolvedProfile}/live` : '';
  const cover = liveRoom.cover?.url_list?.[0] || liveRoom.cover?.urlList?.[0] || liveRoom.coverUrl || liveRoom.cover_url || null;
  const avatar = user.avatarLarger || user.avatarMedium || user.avatarThumb || liveRoom.owner?.avatarLarger || null;
  const rawViewerCount = liveRoom.user_count ?? liveRoom.userCount ?? liveRoom.viewer_count ?? liveRoom.viewerCount;
  const viewerCount = Number(rawViewerCount);
  const startedAt = isoFromProviderEpoch(liveRoom.start_time || liveRoom.startTime);

  return result('tiktok', {
    isLive: true,
    providerSource: source,
    confidence: 'high',
    externalId: resolvedUserId || undefined,
    resolvedUsername: resolvedUsername || undefined,
    url: resolvedProfile || undefined,
    avatar,
    event: {
      type: 'live',
      id: roomId || `tiktok-live:${resolvedUsername || resolvedUserId || fallbackUsername || fallbackId}`,
      title: clean(liveRoom.title) || `${resolvedUsername || fallbackUsername || 'Creator'} is LIVE on TikTok`,
      url: resolvedLiveUrl || 'https://www.tiktok.com/live',
      thumbnail: cover || avatar || null,
      viewerCount: Number.isFinite(viewerCount) && viewerCount > 0 ? viewerCount : null,
      startedAt,
      liveStatus: isPaused ? 'PAUSED' : 'LIVE',
      paused: isPaused,
    },
  });
}

async function tiktokApiLookup({ username = '', userId = '' }) {
  const lookup = username ? `uniqueId=${encodeURIComponent(username)}` : `userId=${encodeURIComponent(userId)}`;
  const referer = username ? `https://www.tiktok.com/@${encodeURIComponent(username)}/live` : '';
  const { json } = await tiktokRequest(`https://www.tiktok.com/api-live/user/room/?aid=1988&sourceType=54&${lookup}`, {
    headers: { Accept: 'application/json,text/plain,*/*', ...(referer ? { Referer: referer } : {}) },
  }, 10000);
  return json;
}

async function checkTikTok(account) {
  const username = tiktokUsername(account);
  const userId = /^\d{6,30}$/.test(clean(account.externalId)) ? clean(account.externalId) : '';
  if (!username && !userId) return unavailable('tiktok', 'TikTok username, channel ID or URL could not be resolved.');

  const errors = [];

  if (username) {
    try {
      const json = await tiktokApiLookup({ username });
      const resolved = tiktokApiResult(json, username, userId, 'tiktok_api_live_username');
      if (resolved) return resolved;
    } catch (error) { errors.push(`username API: ${error.message}`); }
  }

  if (userId) {
    try {
      const json = await tiktokApiLookup({ userId });
      const resolved = tiktokApiResult(json, username, userId, 'tiktok_api_live_id');
      if (resolved) return resolved;
    } catch (error) { errors.push(`ID API: ${error.message}`); }
  }

  if (!username) {
    return unavailable('tiktok', `TikTok account has only a numeric ID and could not be resolved${errors.length ? `: ${errors.join('; ')}` : '.'}`);
  }

  const profile = `https://www.tiktok.com/@${encodeURIComponent(username)}`;
  const liveUrl = `${profile}/live`;
  try {
    const { response, text } = await tiktokRequest(liveUrl, { headers: { Accept: 'text/html,application/xhtml+xml' } }, 12000);
    const finalUrl = response.url || liveUrl;
    const body = text.slice(0, 2000000);
    const sigiMatch = body.match(/<script[^>]+id=["']SIGI_STATE["'][^>]*>([\s\S]*?)<\/script>/i);
    if (sigiMatch?.[1]) {
      try {
        const sigi = JSON.parse(sigiMatch[1]);
        const liveInfo = sigi?.LiveRoom?.liveRoomUserInfo || {};
        const sigiUser = liveInfo.user && typeof liveInfo.user === 'object' ? liveInfo.user : {};
        const sigiRoom = liveInfo.liveRoom && typeof liveInfo.liveRoom === 'object' ? liveInfo.liveRoom : {};
        const sigiUsername = clean(sigiUser.uniqueId || sigiUser.unique_id);
        const sigiRoomId = clean(sigiUser.roomId || sigiUser.room_id || sigiRoom.roomId || sigiRoom.room_id);
        const sigiStatus = sigiRoom.status ?? sigiUser.status;
        const usernameMatches = sigiUsername && sigiUsername.toLowerCase() === username.toLowerCase();
        const hasSigiRoom = /^[1-9]\d*$/.test(sigiRoomId);
        const sigiPaused = hasSigiRoom && explicitPausedState(sigiRoom, sigiUser, sigiRoom.streamData, sigiRoom.stream_data);
        if (usernameMatches && hasSigiRoom && (Number(sigiStatus) === 2 || sigiPaused)) {
          const avatar = sigiUser.avatarLarger || sigiUser.avatarMedium || sigiUser.avatarThumb || null;
          const cover = sigiRoom.coverUrl || sigiRoom.squareCoverImg || avatar || null;
          const rawViewerCount = sigiRoom.liveRoomStats?.userCount ?? sigiRoom.userCount ?? sigiRoom.viewerCount;
          const viewerCount = Number(rawViewerCount);
          return result('tiktok', {
            isLive: true,
            providerSource: 'public_page_sigi',
            confidence: 'high',
            externalId: clean(sigiUser.id || sigiUser.userId || sigiUser.user_id || userId) || undefined,
            url: profile,
            avatar,
            resolvedUsername: sigiUsername,
            event: {
              type: 'live',
              id: sigiRoomId,
              title: clean(sigiRoom.title) || `${sigiUsername} is LIVE on TikTok`,
              url: liveUrl,
              thumbnail: cover,
              viewerCount: Number.isFinite(viewerCount) && viewerCount > 0 ? viewerCount : null,
              startedAt: isoFromProviderEpoch(sigiRoom.startTime || sigiRoom.start_time),
              liveStatus: sigiPaused ? 'PAUSED' : 'LIVE',
              paused: sigiPaused,
            },
          });
        }
      } catch (sigiError) {
        errors.push(`SIGI_STATE: ${sigiError.message}`);
      }
    }
    const ended = /LIVE\s+has\s+ended|live\s+(?:has\s+)?ended|room\s+(?:has\s+)?ended|stream\s+(?:has\s+)?ended/i.test(body);
    const hasRoom = /"roomId"\s*:\s*"?[1-9]\d*/i.test(body) || /"room_id"\s*:\s*"?[1-9]\d*/i.test(body);
    const directLiveStatus = /"status"\s*:\s*2\b/.test(body) || /"isLive"\s*:\s*true/i.test(body);
    const escapedUsername = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const creatorMarker = new RegExp(`(?:uniqueId|unique_id|author|nickname)[^\\n]{0,200}${escapedUsername}`, 'i').test(body);
    const onOwnLiveUrl = /\/live(?:[?#]|$)/i.test(finalUrl) && finalUrl.toLowerCase().includes(`@${username.toLowerCase()}`);
    const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
    const ogTitle = body.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] || '';
    const ogImage = body.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] || '';
    const pageTitle = clean(ogTitle || title).replace(/\s*-\s*TikTok\s+LIVE.*$/i, '');
    const titleSaysLive = title.toLowerCase().includes(`@${username.toLowerCase()}`) && /\bis\s+LIVE\s*-\s*TikTok\s+LIVE\b/i.test(title);
    const pauseMarker = htmlPausedState(body);
    const isPaused = !ended && onOwnLiveUrl && pauseMarker && (creatorMarker || title.toLowerCase().includes(`@${username.toLowerCase()}`));
    const isLive = !ended && onOwnLiveUrl && (isPaused || titleSaysLive || (hasRoom && directLiveStatus && creatorMarker));

    if (isLive) return result('tiktok', {
      isLive: true,
      providerSource: isPaused ? 'public_page_paused' : 'public_page',
      confidence: 'high',
      externalId: userId || undefined,
      url: profile,
      resolvedUsername: username,
      event: {
        type: 'live',
        id: `tiktok-live:${username}`,
        title: pageTitle || `${username} is LIVE on TikTok`,
        url: liveUrl,
        thumbnail: ogImage || null,
        liveStatus: isPaused ? 'PAUSED' : 'LIVE',
        paused: isPaused,
      },
    });

    const redirectedAwayFromLive = !onOwnLiveUrl && finalUrl.toLowerCase().includes(`@${username.toLowerCase()}`);
    if (ended || redirectedAwayFromLive) return result('tiktok', {
      isLive: false,
      providerSource: ended ? 'public_page_ended' : 'public_page_redirect',
      confidence: 'high',
      externalId: userId || undefined,
      url: profile,
      resolvedUsername: username,
      event: null,
    });

    const context = onOwnLiveUrl
      ? 'TikTok returned the creator LIVE page without a definitive LIVE, PAUSED or ENDED marker'
      : 'TikTok LIVE status could not be proven';
    return unavailable('tiktok', `${context}${errors.length ? ` after ${errors.join('; ')}` : ''}.`);
  } catch (pageError) {
    errors.push(`page: ${pageError.message}`);
    return unavailable('tiktok', `TikTok LIVE check unavailable: ${errors.join('; ')}`);
  }
}

function isConfigured() {
  return true;
}

module.exports = {
  id: 'tiktok',
  label: 'TikTok',
  alertTypes: ['live'],
  isConfigured,
  check: checkTikTok,
};
