const express = require('express');
const path = require('path');

const router = express.Router();

const { readJsonSafe } = require('../../core/guild/fileStore');
const notifications = require('../../core/notifications/notificationStore');

const CASES_PATH = path.join(__dirname, '..', 'data', 'modCaseDetails.json');
const DISCORD_API = 'https://discord.com/api/v10';

const BOT_PROFILE_CACHE_TTL_MS = 1000 * 60 * 5;
const GUILD_STATS_CACHE_TTL_MS = 15_000;

let cachedBotProfile = null;
let cachedBotProfileExpiresAt = 0;

const guildStatsCache = new Map();

function notifyRuntime(guildId, payload = {}, options = {}) {
  if (!guildId) return null;
  try {
    return notifications.addNotificationOnce(guildId, {
      source: 'runtime',
      route: '/overview',
      ...payload,
    }, options);
  } catch (error) {
    console.warn('[StatusRoute] notification skipped:', error.message || error);
    return null;
  }
}

function evaluateRuntimeNotifications(guildId, statusPayload = {}) {
  if (!guildId) return;
  const latency = Number(statusPayload.latencyMs ?? statusPayload.botLatencyMs ?? 0);
  const guildMissing = statusPayload.guild && statusPayload.guild.connected === false;

  if (!statusPayload.botOnline) {
    notifyRuntime(guildId, {
      level: 'danger',
      title: 'Bot runtime offline',
      message: statusPayload.error || 'Goliath bot is currently reporting offline.',
      metadata: { botOnline: false, error: statusPayload.error || null },
    }, { fingerprint: 'runtime:bot-offline', windowMs: 10 * 60_000 });
  }

  if (statusPayload.error) {
    notifyRuntime(guildId, {
      level: 'warning',
      title: 'Runtime status warning',
      message: statusPayload.error,
      metadata: { error: statusPayload.error },
    }, { fingerprint: `runtime:error:${statusPayload.error}`, windowMs: 10 * 60_000 });
  }

  if (guildMissing) {
    notifyRuntime(guildId, {
      level: 'warning',
      title: 'Guild connection missing',
      message: 'The selected guild could not be confirmed from runtime status.',
      metadata: { guildId },
    }, { fingerprint: `runtime:guild-missing:${guildId}`, windowMs: 15 * 60_000 });
  }

  if (latency >= 300) {
    notifyRuntime(guildId, {
      level: 'warning',
      title: 'High bot latency',
      message: `Discord websocket latency is ${latency}ms.`,
      metadata: { latencyMs: latency },
    }, { fingerprint: 'runtime:high-latency', windowMs: 15 * 60_000 });
  }
}

function getBotToken() {
  return String(
    process.env.DISCORD_TOKEN ||
      process.env.TOKEN ||
      process.env.DISCORD_BOT_TOKEN ||
      ''
  ).trim();
}

function requireBotToken() {
  const token = getBotToken();

  if (!token) {
    throw new Error(
      'Missing bot token. Set DISCORD_TOKEN, TOKEN, or DISCORD_BOT_TOKEN in env.'
    );
  }

  return token;
}

function getDiscordClient(req) {
  return (
    req.app?.locals?.client ||
    req.app?.locals?.discordClient ||
    req.app?.get?.('client') ||
    req.client ||
    null
  );
}

function emptyBotProfile() {
  return {
    id: null,
    username: 'Goliath',
    name: 'Goliath',
    tag: null,
    avatar: null,
    avatarUrl: '',
    avatarURL: '',
    online: false,
    latencyMs: null,
  };
}

function buildDiscordAvatarUrl(id, avatar) {
  if (!id || !avatar) return '';

  const ext = String(avatar).startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${id}/${avatar}.${ext}?size=256`;
}

function buildGuildIconUrl(id, icon) {
  if (!id || !icon) return '';

  const ext = String(icon).startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/icons/${id}/${icon}.${ext}?size=256`;
}

function getCached(cache, key) {
  const cached = cache.get(key);

  if (!cached) return null;

  if (Date.now() > cached.expiresAt) {
    cache.delete(key);
    return null;
  }

  return cached.data;
}

function setCached(cache, key, data, ttlMs) {
  cache.set(key, {
    data,
    expiresAt: Date.now() + ttlMs,
  });
}

async function discordBotRequest(pathname) {
  const token = requireBotToken();

  const response = await fetch(`${DISCORD_API}${pathname}`, {
    headers: {
      Authorization: `Bot ${token}`,
      Accept: 'application/json',
    },
  });

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(
      `Discord API failed ${response.status} ${response.statusText}: ${
        typeof data === 'string' ? data : JSON.stringify(data)
      }`
    );
  }

  return data;
}

function buildBotProfileFromClient(client) {
  const bot = client?.user;

  if (!bot) return null;

  const avatarUrl = buildDiscordAvatarUrl(bot.id, bot.avatar);

  return {
    id: bot.id,
    username: bot.username,
    name: bot.globalName || bot.username || 'Goliath',
    tag: bot.tag || bot.username,
    avatar: bot.avatar || null,
    avatarUrl,
    avatarURL: avatarUrl,
    online: Boolean(client?.isReady?.() || client?.readyAt),
    latencyMs: Number.isFinite(client?.ws?.ping) ? client.ws.ping : null,
  };
}

async function fetchBotProfile(req) {
  const clientProfile = buildBotProfileFromClient(getDiscordClient(req));

  if (clientProfile) {
    return clientProfile;
  }

  const now = Date.now();

  if (cachedBotProfile && now < cachedBotProfileExpiresAt) {
    return cachedBotProfile;
  }

  const bot = await discordBotRequest('/users/@me');
  const avatarUrl = buildDiscordAvatarUrl(bot.id, bot.avatar);

  const tag =
    bot.discriminator && bot.discriminator !== '0'
      ? `${bot.username}#${bot.discriminator}`
      : bot.username;

  cachedBotProfile = {
    id: bot.id,
    username: bot.username,
    name: bot.global_name || bot.username || 'Goliath',
    tag,
    avatar: bot.avatar || null,
    avatarUrl,
    avatarURL: avatarUrl,
    online: true,
    latencyMs: null,
  };

  cachedBotProfileExpiresAt = now + BOT_PROFILE_CACHE_TTL_MS;
  return cachedBotProfile;
}

async function fetchGuildStats(req, guildId) {
  const cached = getCached(guildStatsCache, guildId);
  if (cached) return cached;

  const client = getDiscordClient(req);
  const guild = client?.guilds?.cache?.get(guildId) || await client?.guilds?.fetch?.(guildId).catch(() => null);

  if (!guild) {
    const missing = { connected: false, id: guildId };
    setCached(guildStatsCache, guildId, missing, GUILD_STATS_CACHE_TTL_MS);
    return missing;
  }

  const data = {
    connected: true,
    id: guild.id,
    name: guild.name,
    iconUrl: guild.iconURL?.({ extension: 'png', size: 256 }) || buildGuildIconUrl(guild.id, guild.icon),
    memberCount: guild.memberCount || 0,
    channels: guild.channels?.cache?.size || 0,
    roles: guild.roles?.cache?.size || 0,
  };

  setCached(guildStatsCache, guildId, data, GUILD_STATS_CACHE_TTL_MS);
  return data;
}

router.get('/bot', async (req, res) => {
  try {
    const bot = await fetchBotProfile(req);
    return res.json({ success: true, bot, ...bot });
  } catch (error) {
    return res.status(503).json({ success: false, error: error.message, bot: emptyBotProfile() });
  }
});

router.get('/overview', async (req, res) => {
  try {
    const guildId = String(req.query.guildId || req.session?.guildId || req.session?.selectedGuildId || '').trim();
    const bot = await fetchBotProfile(req).catch(() => emptyBotProfile());
    const guild = guildId ? await fetchGuildStats(req, guildId) : null;
    const payload = {
      success: true,
      botOnline: Boolean(bot.online),
      botLatencyMs: bot.latencyMs,
      latencyMs: bot.latencyMs,
      bot,
      guild,
      cases: readJsonSafe(CASES_PATH, []),
      updatedAt: new Date().toISOString(),
    };
    evaluateRuntimeNotifications(guildId, payload);
    return res.json(payload);
  } catch (error) {
    return res.status(500).json({ success: false, botOnline: false, error: error.message });
  }
});

module.exports = router;
