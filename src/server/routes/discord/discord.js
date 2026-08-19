const fetch = global.fetch;
const express = require('express');
const { ChannelType, PermissionFlagsBits, PermissionsBitField } = require('discord.js');

const {
  getDiscordResources,
  syncDiscordResources,
} = require('../../../core/guild/discordResourceManager');
const { resolveToken, getRequiredTokenEnvName } = require('../../../config/tokenResolver');

const router = express.Router();

const DISCORD_API = 'https://discord.com/api/v10';
const GUILD_CACHE_TTL_MS = 15 * 1000;
const ADMINISTRATOR_PERMISSION = BigInt(0x8);
const MANAGE_GUILD_PERMISSION = BigInt(0x20);

const guildCache = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getBotToken() {
  return String(resolveToken() || '').trim();
}

function requireBotToken() {
  const token = getBotToken();
  if (!token) throw new Error(`Missing bot token. Set ${getRequiredTokenEnvName()} in the active mode env.`);
  return token;
}

function getBotMode() {
  return String(process.env.BOT_MODE || process.env.NODE_ENV || 'production').trim().toUpperCase();
}

function getOwnerIds() {
  return [process.env.OWNER_IDS, process.env.OWNER_ID, process.env.BOT_OWNER_ID]
    .filter(Boolean)
    .flatMap((value) => String(value).split(',').map((id) => id.trim()).filter(Boolean));
}

function isBotOwnerUser(userId) {
  return getOwnerIds().includes(String(userId));
}

function getConfiguredDevGuildIds() {
  return [process.env.DEV_GUILD_ID, process.env.MAIN_GUILD_ID, process.env.GUILD_ID]
    .filter(Boolean)
    .flatMap((value) => String(value).split(',').map((item) => item.trim()).filter(Boolean));
}

function isConfiguredDevGuild(guildId) {
  return getBotMode() === 'DEV' && getConfiguredDevGuildIds().includes(String(guildId));
}

function getCache(cache, cacheKey) {
  const cached = cache.get(cacheKey);
  if (!cached) return null;
  if (Date.now() > cached.expiresAt) {
    cache.delete(cacheKey);
    return null;
  }
  return cached.data;
}

function setCache(cache, cacheKey, data, ttlMs) {
  cache.set(cacheKey, { data, expiresAt: Date.now() + ttlMs });
}

function hasManageGuildPermission(guild) {
  if (guild?.owner) return true;
  try {
    const permissions = BigInt(guild?.permissions || 0);
    return (permissions & ADMINISTRATOR_PERMISSION) === ADMINISTRATOR_PERMISSION || (permissions & MANAGE_GUILD_PERMISSION) === MANAGE_GUILD_PERMISSION;
  } catch {
    return false;
  }
}

function canAccessGuild(guild, botGuildIds, userId) {
  const guildId = String(guild?.id || '');
  if (!guildId) return false;
  if (!botGuildIds.has(guildId)) return false;
  if (isBotOwnerUser(userId)) return true;
  if (hasManageGuildPermission(guild)) return true;
  return isConfiguredDevGuild(guildId);
}

function buildGuildIconUrl(guild) {
  if (!guild?.id || !guild?.icon) return null;
  const ext = String(guild.icon).startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.${ext}?size=256`;
}

function getSessionAccessToken(req) {
  return req.session?.accessToken || req.session?.discordAccessToken || req.session?.access_token || req.session?.token || '';
}

function isAuthenticated(req) {
  return Boolean(req.session?.user);
}

function getDiscordClient(req) {
  return req.client || req.app?.get?.('goliath.client') || req.app?.locals?.client || req.app?.locals?.discordClient || global.client || global.discordClient || null;
}

function getClientGuilds(req) {
  const client = getDiscordClient(req);
  if (!client?.guilds?.cache) return [];
  return [...client.guilds.cache.values()].map((guild) => ({ id: guild.id, name: guild.name, icon: guild.icon || null }));
}

async function fetchJson(url, options = {}, retryCount = 0) {
  const response = await fetch(url, options);
  if (response.status === 429) {
    let retryAfterMs = 1000;
    try {
      const data = await response.json();
      const retryAfter = Number(data?.retry_after);
      if (!Number.isNaN(retryAfter)) retryAfterMs = retryAfter * 1000;
    } catch {}
    if (retryCount < 3) {
      await sleep(retryAfterMs + 150);
      return fetchJson(url, options, retryCount + 1);
    }
    throw new Error('Discord rate limit exceeded');
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Request failed ${response.status}: ${text}`);
  }
  return response.json();
}

async function fetchUserGuilds(accessToken) {
  return fetchJson(`${DISCORD_API}/users/@me/guilds`, { headers: { Authorization: `Bearer ${accessToken}` } });
}

async function fetchBotGuilds(req) {
  const clientGuilds = getClientGuilds(req);
  if (clientGuilds.length > 0) return clientGuilds;
  return fetchJson(`${DISCORD_API}/users/@me/guilds`, { headers: { Authorization: `Bot ${requireBotToken()}` } });
}

function buildGuildPayload(guild) {
  const iconUrl = buildGuildIconUrl(guild);
  return { id: guild.id, name: guild.name, icon: guild.icon || null, iconUrl, iconURL: iconUrl, owner: Boolean(guild.owner), permissions: guild.permissions };
}

function readCache(guildId, extra = {}) {
  return { ...getDiscordResources(guildId), ...extra };
}

function readList(guildId, key) {
  const resources = readCache(guildId);
  return Array.isArray(resources[key]) ? resources[key] : [];
}

function serialiseRole(role) {
  if (!role?.id || !role?.name) return null;
  return {
    id: role.id,
    name: role.name,
    position: role.position || 0,
    color: role.hexColor || '#000000',
    hoist: role.hoist === true,
    mentionable: role.mentionable === true,
    managed: role.managed === true,
    permissions: role.permissions?.toArray?.() || [],
  };
}

function serialiseChannel(channel) {
  if (!channel?.id || !channel?.name) return null;
  return {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    parentId: channel.parentId || null,
    position: Number.isFinite(channel.rawPosition) ? channel.rawPosition : Number.isFinite(channel.position) ? channel.position : 0,
  };
}

function buildLiveResources(guild) {
  const allChannels = [...(guild.channels.cache?.values?.() || [])]
    .map(serialiseChannel)
    .filter(Boolean)
    .sort((a, b) => {
      const pos = (a.position || 0) - (b.position || 0);
      return pos || String(a.name).localeCompare(String(b.name));
    });

  return {
    lastSync: new Date().toISOString(),
    guild: { id: guild.id, name: guild.name, iconUrl: guild.iconURL?.({ extension: 'png', size: 128 }) || null },
    channels: allChannels.filter((channel) => channel.type !== ChannelType.GuildCategory),
    categories: allChannels.filter((channel) => channel.type === ChannelType.GuildCategory),
    roles: [...(guild.roles.cache?.values?.() || [])]
      .filter((role) => role.id !== guild.id)
      .map(serialiseRole)
      .filter(Boolean)
      .sort((a, b) => (b.position || 0) - (a.position || 0)),
    emojis: [...(guild.emojis.cache?.values?.() || [])]
      .map((emoji) => ({ id: emoji.id, name: emoji.name, animated: emoji.animated === true }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name))),
  };
}

async function fetchGuild(req, guildId) {
  const client = getDiscordClient(req);
  if (!client?.guilds) return null;
  const id = String(guildId || '').trim();
  const cachedGuild = client.guilds.cache?.get(id);
  if (cachedGuild) return cachedGuild;
  if (client.isReady && !client.isReady()) return null;
  if (typeof client.guilds.fetch !== 'function') return null;
  return client.guilds.fetch(id).catch(() => null);
}

async function getLiveOrCachedResources(req, guildId) {
  const guild = await fetchGuild(req, guildId);
  if (!guild) return readCache(guildId, { warning: 'Discord client or guild unavailable. Returned cached resources.' });
  const synced = await syncDiscordResources(guild).catch((error) => { console.error('Failed to sync Discord resources:', error); return null; });
  if (synced && Array.isArray(synced.channels) && synced.channels.length) return synced;
  return buildLiveResources(guild);
}

function cleanRoleName(value) {
  const name = String(value || '').trim().slice(0, 80);
  if (name.length < 2) throw new Error('Role name must be at least 2 characters.');
  if (name === '@everyone') throw new Error('@everyone cannot be created or replaced.');
  return name;
}

function cleanRoleColor(value) {
  const color = String(value || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : undefined;
}

function botCanManageRoles(guild) {
  const me = guild.members.me;
  return Boolean(me?.permissions?.has?.(PermissionFlagsBits.ManageRoles));
}

function cleanRolePermissions(value) {
  const selected = Array.isArray(value) ? value : [];
  const allowed = selected.filter((name) => typeof name === 'string' && PermissionFlagsBits[name]);
  return new PermissionsBitField(allowed.map((name) => PermissionFlagsBits[name]));
}

function describeRole(role, reason = '') {
  return {
    id: role?.id || '',
    managed: role?.managed === true,
    name: role?.name || 'Unknown role',
    position: Number.isFinite(role?.position) ? role.position : 0,
    reason,
  };
}

function buildRolePositionPlan(guild, requestedRoleIds = []) {
  const me = guild.members.me;
  const botHighest = me?.roles?.highest || null;
  const botHighestPosition = botHighest?.position ?? 0;
  const roleMap = new Map(guild.roles.cache.map((role) => [role.id, role]));
  const requestedIds = [...new Set(requestedRoleIds.map(String).filter(Boolean))];
  const editableRoles = [];
  const skippedRoles = [];

  requestedIds.forEach((id) => {
    const role = roleMap.get(id);
    if (!role) {
      skippedRoles.push({ id, managed: false, name: 'Unknown role', position: 0, reason: 'Role no longer exists in Discord cache.' });
      return;
    }
    if (role.id === guild.id) {
      skippedRoles.push(describeRole(role, '@everyone cannot be moved.'));
      return;
    }
    if (role.managed) {
      skippedRoles.push(describeRole(role, 'Managed integration/bot roles cannot be moved.'));
      return;
    }
    if (role.id === me?.roles?.botRole?.id) {
      skippedRoles.push(describeRole(role, 'Goliath cannot move its own bot role.'));
      return;
    }
    if (role.position >= botHighestPosition) {
      skippedRoles.push(describeRole(role, 'Role is at or above Goliath’s highest role. Move the Goliath bot role higher in Discord.'));
      return;
    }
    editableRoles.push(role);
  });

  const editableIds = new Set(editableRoles.map((role) => role.id));
  const currentEditable = [...guild.roles.cache.values()]
    .filter((role) => role.id !== guild.id && !role.managed && role.id !== me?.roles?.botRole?.id && role.position < botHighestPosition)
    .sort((a, b) => b.position - a.position);
  const remaining = currentEditable.filter((role) => !editableIds.has(role.id));
  const mergedTopDown = [...editableRoles, ...remaining];
  const availablePositions = currentEditable.map((role) => role.position).sort((a, b) => b - a);
  const positions = mergedTopDown
    .map((role, index) => ({ role, position: availablePositions[index] }))
    .filter((item) => Number.isFinite(item.position) && item.role.position !== item.position);

  const diagnostics = {
    appliedRoles: positions.map(({ role, position }) => ({ id: role.id, name: role.name, previousPosition: role.position, requestedPosition: position })),
    bot: {
      highestRoleId: botHighest?.id || null,
      highestRoleName: botHighest?.name || null,
      highestRolePosition: botHighestPosition,
      id: me?.id || null,
      manageableRoleCount: currentEditable.length,
    },
    editableRoles: editableRoles.map((role) => describeRole(role)),
    payload: positions.map(({ role, position }) => ({ id: role.id, name: role.name, position })),
    requestedRoleIds: requestedIds,
    skippedRoles,
  };

  return { diagnostics, positions };
}

router.get('/guilds', async (req, res) => {
  try {
    const accessToken = getSessionAccessToken(req);
    if (!req.session?.user || !accessToken) return res.status(401).json({ error: 'Not authenticated' });
    const userId = req.session.user.id;
    const cacheKey = `guilds:${userId}`;
    const cachedGuilds = getCache(guildCache, cacheKey);
    if (cachedGuilds) return res.json(cachedGuilds);
    const [userGuilds, botGuilds] = await Promise.all([fetchUserGuilds(accessToken), fetchBotGuilds(req)]);
    const botGuildIds = new Set(Array.isArray(botGuilds) ? botGuilds.map((guild) => String(guild.id)) : []);
    if (isBotOwnerUser(userId)) {
      const ownerGuilds = Array.isArray(botGuilds) ? botGuilds.map(buildGuildPayload).sort((a, b) => a.name.localeCompare(b.name)) : [];
      setCache(guildCache, cacheKey, ownerGuilds, GUILD_CACHE_TTL_MS);
      return res.json(ownerGuilds);
    }
    const mutualGuilds = Array.isArray(userGuilds) ? userGuilds.filter((guild) => canAccessGuild(guild, botGuildIds, userId)).map(buildGuildPayload).sort((a, b) => a.name.localeCompare(b.name)) : [];
    setCache(guildCache, cacheKey, mutualGuilds, GUILD_CACHE_TTL_MS);
    return res.json(mutualGuilds);
  } catch (error) {
    console.error('❌ Failed to fetch guilds:', error);
    return res.status(500).json({ error: 'Failed to fetch guilds' });
  }
});

router.get('/:guildId/resources', async (req, res) => {
  try {
    if (!isAuthenticated(req)) return res.status(401).json({ error: 'Not authenticated' });
    return res.json(await getLiveOrCachedResources(req, req.params.guildId));
  } catch (error) {
    console.error('Failed to read Discord resources:', error);
    return res.json(readCache(req.params.guildId, { warning: 'Resource cache unavailable' }));
  }
});

router.post('/:guildId/resources/sync', async (req, res) => {
  try {
    if (!isAuthenticated(req)) return res.status(401).json({ error: 'Not authenticated' });
    return res.json(await getLiveOrCachedResources(req, req.params.guildId));
  } catch (error) {
    console.error('Failed to sync Discord resources:', error);
    return res.json(readCache(req.params.guildId, { warning: 'Live Discord sync failed. Returned cached resources.' }));
  }
});

router.get('/:guildId/channels', async (req, res) => {
  try {
    if (!isAuthenticated(req)) return res.status(401).json({ error: 'Not authenticated' });
    const resources = await getLiveOrCachedResources(req, req.params.guildId);
    return res.json(Array.isArray(resources.channels) ? resources.channels : []);
  } catch (error) {
    console.error('Failed to read Discord channels:', error);
    return res.json(readList(req.params.guildId, 'channels'));
  }
});

router.get('/:guildId/categories', async (req, res) => {
  try {
    if (!isAuthenticated(req)) return res.status(401).json({ error: 'Not authenticated' });
    const resources = await getLiveOrCachedResources(req, req.params.guildId);
    return res.json(Array.isArray(resources.categories) ? resources.categories : []);
  } catch (error) {
    console.error('Failed to read Discord categories:', error);
    return res.json(readList(req.params.guildId, 'categories'));
  }
});

router.get('/:guildId/roles', async (req, res) => {
  try {
    if (!isAuthenticated(req)) return res.status(401).json({ error: 'Not authenticated' });
    const resources = await getLiveOrCachedResources(req, req.params.guildId);
    return res.json(Array.isArray(resources.roles) ? resources.roles : []);
  } catch (error) {
    console.error('Failed to read Discord roles:', error);
    return res.json(readList(req.params.guildId, 'roles'));
  }
});

router.post('/:guildId/roles', async (req, res) => {
  try {
    if (!isAuthenticated(req)) return res.status(401).json({ error: 'Not authenticated' });
    const guild = await fetchGuild(req, req.params.guildId);
    if (!guild) return res.status(404).json({ error: 'Guild is not available to the bot.' });
    if (!botCanManageRoles(guild)) return res.status(403).json({ error: 'Goliath needs Manage Roles to create guild roles.' });

    const role = await guild.roles.create({
      name: cleanRoleName(req.body?.name),
      color: cleanRoleColor(req.body?.color),
      hoist: req.body?.hoist === true,
      mentionable: req.body?.mentionable === true,
      permissions: cleanRolePermissions(req.body?.permissions),
      reason: 'Goliath dashboard role creation',
    });

    await syncDiscordResources(guild).catch(() => null);
    return res.status(201).json({ success: true, role: serialiseRole(role) });
  } catch (error) {
    console.error('Failed to create Discord role:', error);
    return res.status(400).json({ success: false, error: error.message || 'Failed to create Discord role.' });
  }
});

router.patch('/:guildId/roles/order', async (req, res) => {
  try {
    if (!isAuthenticated(req)) return res.status(401).json({ error: 'Not authenticated' });
    const guild = await fetchGuild(req, req.params.guildId);
    if (!guild) return res.status(404).json({ error: 'Guild is not available to the bot.' });
    if (!botCanManageRoles(guild)) return res.status(403).json({ error: 'Goliath needs Manage Roles to reorder guild roles.' });

    const roleIds = Array.isArray(req.body?.roleIds) ? req.body.roleIds.map(String).filter(Boolean) : [];
    const { diagnostics, positions } = buildRolePositionPlan(guild, roleIds);
    if (!positions.length) {
      return res.status(400).json({
        success: false,
        diagnostics,
        error: 'No Discord role positions changed. Goliath can only move unmanaged roles below its own highest role.',
      });
    }

    console.info('Goliath role hierarchy sync payload:', {
      guildId: guild.id,
      payload: diagnostics.payload,
      skipped: diagnostics.skippedRoles,
    });

    await guild.roles.setPositions(positions, 'Goliath dashboard role reorder');
    await guild.roles.fetch().catch(() => null);
    const resources = await syncDiscordResources(guild).catch(() => buildLiveResources(guild));
    const roles = Array.isArray(resources.roles) ? resources.roles : buildLiveResources(guild).roles;
    return res.json({
      success: true,
      diagnostics: {
        ...diagnostics,
        refreshedOrder: roles.map((role) => ({ id: role.id, name: role.name, position: role.position })),
      },
      roles,
    });
  } catch (error) {
    console.error('Failed to reorder Discord roles:', error);
    return res.status(400).json({ success: false, error: error.message || 'Failed to reorder Discord roles.' });
  }
});

router.get('/:guildId/emojis', async (req, res) => {
  try {
    if (!isAuthenticated(req)) return res.status(401).json({ error: 'Not authenticated' });
    const resources = await getLiveOrCachedResources(req, req.params.guildId);
    return res.json(Array.isArray(resources.emojis) ? resources.emojis : []);
  } catch (error) {
    console.error('Failed to read Discord emojis:', error);
    return res.json(readList(req.params.guildId, 'emojis'));
  }
});

module.exports = router;
