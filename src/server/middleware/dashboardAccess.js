'use strict';

const { PermissionFlagsBits } = require('discord.js');
const security = require('../../core/security/protection/core');

const MEMBER_PORTAL = '/appeals';
const ID = /^\d{16,20}$/;

async function resolveGuildAccess(client, userId, guildId) {
  const denied = { allowed: false, admin: false, permissions: [] };
  if (!ID.test(String(userId || '')) || !ID.test(String(guildId || ''))) return denied;
  const guild = client?.guilds?.cache?.get(String(guildId));
  if (!guild) return denied;
  if (security.isBotOwner(userId)) return { allowed: true, admin: true, permissions: ['*'] };
  // Force a member refresh: revoked roles must not survive in the dashboard session.
  const member = await guild.members.fetch({ user: String(userId), force: true }).catch(() => null);
  if (!member) return denied;
  if (String(guild.ownerId) === String(userId)) return { allowed: true, admin: true, permissions: ['*'] };
  const authority = require('../../core/administration/admin/panel');
  const context = authority.getAuthorityContext({ guild, member, user: member.user });
  if (context.source === 'configured') {
    const staff = ['administrator', 'moderator', 'juniorModerator'].includes(context.highestTier);
    const permissions = [...context.permissions];
    return { allowed: staff && (permissions.includes('admin.dashboard.view') || permissions.includes('mod.panel.view')), admin: staff && context.highestTier === 'administrator', permissions };
  }
  const admin = member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild);
  const mod = [PermissionFlagsBits.ModerateMembers, PermissionFlagsBits.KickMembers, PermissionFlagsBits.BanMembers].some((flag) => member.permissions.has(flag));
  return { allowed: admin || mod, admin, permissions: admin ? ['*'] : ['mod.panel.view', 'mod.cases.view'] };
}

async function listDashboardGuilds(client, userId) {
  const guilds = [];
  for (const guild of client?.guilds?.cache?.values?.() || []) {
    const access = await resolveGuildAccess(client, userId, guild.id);
    if (access.allowed) guilds.push({ id: guild.id, name: guild.name, iconUrl: guild.iconURL?.({ size: 128 }) || null, dashboardAccess: access });
  }
  return guilds;
}

function isMemberEndpoint(base, req) {
  if (!['/api/cases', '/api/moderation'].includes(base)) return false;
  const path = req.path.replace(/\/+$/, '');
  return (req.method === 'GET' && ['/member/me', '/appeals/me'].includes(path)) ||
    (req.method === 'POST' && /^\/appeals\/\d{16,20}\/\d{1,12}$/.test(path));
}

function requiredPermission(base) {
  if (base === '/api/config/automod') return 'admin.automod.manage';
  if (base === '/api/config/logs') return 'admin.logs.manage';
  if (['/api/security', '/api/restore'].includes(base)) return 'admin.security.manage';
  if (['/api/cases', '/api/moderation'].includes(base)) return 'mod.panel.view';
  if (['/api/notifications', '/api/activity', '/api/discord', '/api/resources', '/api/status'].includes(base)) return null;
  return 'admin.dashboard.view';
}

function requireDashboardAccess(base) {
  return async (req, res, next) => {
    if (isMemberEndpoint(base, req)) return next(); // These routes enforce session ownership themselves.
    if (!req.session?.user?.id) return res.status(401).json({ error: 'Authentication required.' });
    res.set('Cache-Control', 'no-store');
    const userId = req.session.user.id;
    if (base.startsWith('/api/owner')) {
      return security.isBotOwner(userId) ? next() : res.status(403).json({ error: 'Owner access required.', redirect: MEMBER_PORTAL });
    }
    try {
      // Guild discovery itself is filtered below; it never grants API access.
      if (base === '/api/discord' && req.method === 'GET' && req.path === '/guilds') return next();
      const pathGuild = req.path.split('/').find((part) => ID.test(part));
      const explicitGuilds = [req.query?.guildId, req.query?.guild, req.body?.guildId, req.body?.guild].filter((value) => value !== undefined);
      if (explicitGuilds.some((value) => !ID.test(String(value)))) return res.status(400).json({ error: 'Invalid guild ID.' });
      const guildIds = [...new Set([pathGuild, ...explicitGuilds].filter(Boolean).map(String))];
      if (!guildIds.length) {
        if (security.isBotOwner(userId)) return next();
        // Only the status summary is global for staff. Unknown unscoped APIs fail closed.
        if (base === '/api/status' && (await listDashboardGuilds(req.client, userId)).length) return next();
        return res.status(403).json({ error: 'Server staff access required.', redirect: MEMBER_PORTAL });
      }
      for (const guildId of guildIds) {
        const access = await resolveGuildAccess(req.client, userId, guildId);
        const permission = requiredPermission(base);
        const resourceWrite = ['/api/discord', '/api/resources'].includes(base) && !['GET', 'HEAD'].includes(req.method);
        if (!access.allowed || (resourceWrite && !access.admin) || (permission && !access.permissions.includes('*') && !access.permissions.includes(permission))) {
          return res.status(403).json({ error: 'You do not have access to this server tool.', redirect: MEMBER_PORTAL });
        }
        req.dashboardAccess = access;
      }
      return next();
    } catch (error) {
      console.error('[Dashboard Access] Permission check failed:', error?.message);
      return res.status(503).json({ error: 'Unable to verify server access.' });
    }
  };
}

module.exports = { MEMBER_PORTAL, resolveGuildAccess, listDashboardGuilds, requireDashboardAccess };
