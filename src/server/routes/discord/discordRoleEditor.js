const express = require('express');
const { PermissionFlagsBits, PermissionsBitField } = require('discord.js');

const { syncDiscordResources } = require('../../../core/guild/discordResourceManager');

const router = express.Router();

function isAuthenticated(req) {
  return Boolean(req.session?.user);
}

function getDiscordClient(req) {
  return req.client || req.app?.get?.('goliath.client') || req.app?.locals?.client || global.client || global.discordClient || null;
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

function serialiseRoles(guild) {
  return [...(guild.roles.cache?.values?.() || [])]
    .filter((role) => role.id !== guild.id)
    .map(serialiseRole)
    .filter(Boolean)
    .sort((a, b) => (b.position || 0) - (a.position || 0));
}

function cleanRoleName(value) {
  const name = String(value || '').trim().slice(0, 80);
  if (name.length < 2) throw new Error('Role name must be at least 2 characters.');
  if (name === '@everyone') throw new Error('@everyone cannot be edited.');
  return name;
}

function cleanRoleColor(value) {
  const color = String(value || '').trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error('Role colour must be a valid hex value.');
  return color;
}

function cleanRolePermissions(value) {
  const selected = Array.isArray(value) ? value : [];
  const allowed = selected.filter((name) => typeof name === 'string' && PermissionFlagsBits[name]);
  return new PermissionsBitField(allowed.map((name) => PermissionFlagsBits[name]));
}

function botCanManageRoles(guild) {
  const me = guild.members.me;
  return Boolean(me?.permissions?.has?.(PermissionFlagsBits.ManageRoles));
}

function assertEditableRole(guild, role) {
  const me = guild.members.me;
  const botHighestPosition = me?.roles?.highest?.position ?? 0;
  if (!role) throw new Error('Role was not found in Discord.');
  if (role.id === guild.id) throw new Error('@everyone cannot be edited from Goliath.');
  if (role.managed) throw new Error('Managed integration roles cannot be edited from Goliath.');
  if (role.id === me?.roles?.botRole?.id) throw new Error('Goliath cannot edit its own bot role.');
  if (role.position >= botHighestPosition) throw new Error('This role is at or above Goliath’s highest role. Move the Goliath bot role higher in Discord first.');
}

function buildRolePatch(body = {}) {
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(body, 'name')) patch.name = cleanRoleName(body.name);
  if (Object.prototype.hasOwnProperty.call(body, 'color')) patch.color = cleanRoleColor(body.color);
  if (Object.prototype.hasOwnProperty.call(body, 'hoist')) patch.hoist = body.hoist === true;
  if (Object.prototype.hasOwnProperty.call(body, 'mentionable')) patch.mentionable = body.mentionable === true;
  if (Object.prototype.hasOwnProperty.call(body, 'permissions')) patch.permissions = cleanRolePermissions(body.permissions);
  return patch;
}

router.patch('/:guildId/roles/:roleId', async (req, res) => {
  try {
    if (!isAuthenticated(req)) return res.status(401).json({ error: 'Not authenticated' });
    const guild = await fetchGuild(req, req.params.guildId);
    if (!guild) return res.status(404).json({ error: 'Guild is not available to the bot.' });
    if (!botCanManageRoles(guild)) return res.status(403).json({ error: 'Goliath needs Manage Roles to edit guild roles.' });

    const role = guild.roles.cache.get(String(req.params.roleId));
    assertEditableRole(guild, role);
    const patch = buildRolePatch(req.body);
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'No role changes were provided.' });

    const updatedRole = await role.edit(patch, 'Goliath dashboard role editor');
    await syncDiscordResources(guild).catch(() => null);
    return res.json({ success: true, role: serialiseRole(updatedRole), roles: serialiseRoles(guild) });
  } catch (error) {
    console.error('Failed to edit Discord role:', error);
    return res.status(400).json({ success: false, error: error.message || 'Failed to edit Discord role.' });
  }
});

router.delete('/:guildId/roles/:roleId', async (req, res) => {
  try {
    if (!isAuthenticated(req)) return res.status(401).json({ error: 'Not authenticated' });
    const guild = await fetchGuild(req, req.params.guildId);
    if (!guild) return res.status(404).json({ error: 'Guild is not available to the bot.' });
    if (!botCanManageRoles(guild)) return res.status(403).json({ error: 'Goliath needs Manage Roles to delete guild roles.' });

    const role = guild.roles.cache.get(String(req.params.roleId));
    assertEditableRole(guild, role);
    const deletedRole = serialiseRole(role);
    await role.delete('Goliath dashboard role editor');
    await syncDiscordResources(guild).catch(() => null);
    return res.json({ success: true, deletedRole, roles: serialiseRoles(guild) });
  } catch (error) {
    console.error('Failed to delete Discord role:', error);
    return res.status(400).json({ success: false, error: error.message || 'Failed to delete Discord role.' });
  }
});

module.exports = router;
