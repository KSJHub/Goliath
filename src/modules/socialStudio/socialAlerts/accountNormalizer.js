'use strict';

const PLATFORM_HOSTS = {
  twitch: ['twitch.tv', 'www.twitch.tv', 'm.twitch.tv'],
  youtube: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'],
  tiktok: ['tiktok.com', 'www.tiktok.com', 'm.tiktok.com'],
  kick: ['kick.com', 'www.kick.com'],
  facebook: ['facebook.com', 'www.facebook.com', 'fb.com', 'www.fb.com'],
  instagram: ['instagram.com', 'www.instagram.com'],
  x: ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'],
};

function cleanRaw(value) {
  return String(value || '').trim();
}

function parseUrl(value) {
  const raw = cleanRaw(value);
  if (!raw) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(candidate);
  } catch {
    return null;
  }
}

function cleanHandle(value) {
  return cleanRaw(value)
    .replace(/^@+/, '')
    .replace(/[?#].*$/, '')
    .replace(/^\/+|\/+$/g, '')
    .trim();
}

function firstUsefulSegment(pathname, ignored = []) {
  const ignoredSet = new Set(ignored.map((value) => String(value).toLowerCase()));
  return String(pathname || '')
    .split('/')
    .map((value) => cleanHandle(value))
    .find((value) => value && !ignoredSet.has(value.toLowerCase())) || '';
}

function isKnownPlatformUrl(parsed) {
  return Boolean(parsed) && Object.values(PLATFORM_HOSTS).flat().includes(parsed.hostname.toLowerCase());
}

function extractUsername(platform, rawValue) {
  const raw = cleanRaw(rawValue);
  const parsed = parseUrl(raw);

  if (!parsed || !isKnownPlatformUrl(parsed)) {
    return cleanHandle(raw.replace(/^https?:\/\//i, ''));
  }

  const segments = parsed.pathname.split('/').filter(Boolean).map(cleanHandle);

  switch (platform) {
    case 'twitch':
      return firstUsefulSegment(parsed.pathname, ['directory', 'downloads', 'jobs', 'moderator', 'p', 'settings', 'videos']);
    case 'tiktok':
      return cleanHandle((segments.find((value) => value.startsWith('@')) || segments[0] || '').replace(/^@/, ''));
    case 'youtube': {
      const handle = segments.find((value) => value.startsWith('@'));
      if (handle) return cleanHandle(handle);
      const channelIndex = segments.findIndex((value) => ['channel', 'c', 'user'].includes(value.toLowerCase()));
      return cleanHandle(channelIndex >= 0 ? segments[channelIndex + 1] : segments[0]);
    }
    case 'kick':
      return firstUsefulSegment(parsed.pathname, ['categories', 'search']);
    case 'instagram':
      return firstUsefulSegment(parsed.pathname, ['accounts', 'explore', 'reel', 'reels', 'p', 'stories']);
    case 'facebook':
      return firstUsefulSegment(parsed.pathname, ['people', 'profile.php', 'watch', 'gaming']);
    case 'x':
      return firstUsefulSegment(parsed.pathname, ['home', 'explore', 'notifications', 'messages', 'i']);
    default:
      return cleanHandle(segments[0] || raw);
  }
}

function classifyInput(platform, rawValue) {
  const raw = cleanRaw(rawValue);
  const parsed = parseUrl(raw);
  const fromUrl = isKnownPlatformUrl(parsed);
  const extracted = extractUsername(platform, raw);

  if (platform === 'youtube' && /^UC[\w-]{20,}$/.test(extracted)) {
    return { inputType: 'channel_id', username: extracted, externalId: extracted, sourceUrl: fromUrl ? parsed.toString() : null };
  }

  if (platform === 'twitch' && /^\d{4,20}$/.test(extracted)) {
    return { inputType: 'channel_id', username: '', externalId: extracted, sourceUrl: fromUrl ? parsed.toString() : null };
  }

  if (platform === 'tiktok' && /^\d{6,30}$/.test(extracted)) {
    return { inputType: 'channel_id', username: '', externalId: extracted, sourceUrl: fromUrl ? parsed.toString() : null };
  }

  return {
    inputType: fromUrl ? 'url' : 'username',
    username: extracted,
    externalId: null,
    sourceUrl: fromUrl ? parsed.toString() : null,
  };
}

function buildProfileUrl(platform, username, externalId = null) {
  const value = cleanRaw(username);
  const encoded = encodeURIComponent(value);
  switch (platform) {
    case 'twitch': return value ? `https://www.twitch.tv/${encoded}` : '';
    case 'youtube': {
      const channelId = cleanRaw(externalId || (value.startsWith('UC') ? value : ''));
      return channelId
        ? `https://www.youtube.com/channel/${encodeURIComponent(channelId)}`
        : value ? `https://www.youtube.com/@${encoded.replace(/^%40/i, '')}` : '';
    }
    case 'tiktok': return value ? `https://www.tiktok.com/@${encoded.replace(/^%40/i, '')}` : '';
    case 'kick': return value ? `https://kick.com/${encoded}` : '';
    case 'facebook': return value ? `https://www.facebook.com/${encoded}` : '';
    case 'instagram': return value ? `https://www.instagram.com/${encoded}` : '';
    case 'x': return value ? `https://x.com/${encoded}` : '';
    default: return '';
  }
}

function normalizeAccountInput(platform, value) {
  const classified = classifyInput(platform, value);
  if (!classified.username && !classified.externalId) {
    throw new Error(`${platform} account username, channel ID or URL is required.`);
  }

  const identity = classified.externalId || classified.username;
  return {
    username: classified.username || identity,
    normalizedUsername: classified.username ? classified.username.toLowerCase() : '',
    externalId: classified.externalId || null,
    inputType: classified.inputType,
    profileUrl: classified.sourceUrl || buildProfileUrl(platform, classified.username, classified.externalId),
    sourceInput: cleanRaw(value),
    canonicalIdentity: String(identity || '').toLowerCase(),
  };
}

function migrateAccount(account = {}) {
  const source = account.sourceInput || account.profileUrl || account.externalId || account.username || '';
  const normalized = normalizeAccountInput(account.platform, source);
  return {
    ...account,
    username: normalized.username,
    normalizedUsername: normalized.normalizedUsername,
    externalId: account.externalId || normalized.externalId || null,
    inputType: account.inputType || normalized.inputType,
    profileUrl: account.profileUrl || normalized.profileUrl,
    canonicalIdentity: normalized.canonicalIdentity,
  };
}

module.exports = {
  normalizeAccountInput,
  migrateAccount,
};
