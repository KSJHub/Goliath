'use strict';

const fs = require('fs');
const path = require('path');
const { AuditLogEvent, PermissionFlagsBits } = require('discord.js');
const { PROJECT_ROOT } = require('../../config/runtimePaths');

const SHARED_ROOT = path.dirname(PROJECT_ROOT);
const REQUEST_FILE = path.join(SHARED_ROOT, '.goliath-observatory-requests.json');
const SNAPSHOT_DIR = path.join(SHARED_ROOT, '.goliath-observatory');
const REQUEST_TTL_MS = 60 * 1000;
const HISTORY_LIMIT = 30;

function mode() {
  const value = String(process.env.BOT_MODE || 'DEV').trim().toUpperCase();
  if (value === 'PROD' || value === 'PRODUCTION') return 'PRODUCTION';
  if (value === 'BETA') return 'BETA';
  return 'DEV';
}
function ensure(dir) { fs.mkdirSync(dir, { recursive: true }); return dir; }
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, value) { ensure(path.dirname(file)); const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); fs.renameSync(tmp, file); }
function snapshotFile(guildId) { return path.join(ensure(SNAPSHOT_DIR), `${String(guildId)}.json`); }
function requests() { return readJson(REQUEST_FILE, []); }
function saveRequests(items) { writeJson(REQUEST_FILE, Array.isArray(items) ? items.slice(-50) : []); }
function collectionValues(cache) { return cache?.values ? [...cache.values()] : []; }
function perms(value) { try { return value?.bitfield?.toString?.() || String(value || '0'); } catch { return '0'; } }
function overwriteState(overwrite) { return { id: overwrite.id, type: overwrite.type, allow: perms(overwrite.allow), deny: perms(overwrite.deny) }; }
function roleState(role) { return { id: role.id, name: role.name, position: role.position, color: role.hexColor, hoist: role.hoist, managed: role.managed, mentionable: role.mentionable, permissions: perms(role.permissions) }; }
function channelState(channel) { return { id: channel.id, name: channel.name, type: channel.type, parentId: channel.parentId || null, position: channel.rawPosition ?? channel.position ?? null, topic: channel.topic || null, nsfw: Boolean(channel.nsfw), rateLimitPerUser: channel.rateLimitPerUser ?? null, permissionOverwrites: collectionValues(channel.permissionOverwrites?.cache).map(overwriteState) }; }
function memberState(member) { return { id: member.id, username: member.user?.username || null, displayName: member.displayName || null, bot: Boolean(member.user?.bot), joinedAt: member.joinedAt?.toISOString?.() || null, roles: collectionValues(member.roles?.cache).filter((role) => role.id !== member.guild.id).map((role) => role.id), pending: Boolean(member.pending), communicationDisabledUntil: member.communicationDisabledUntil?.toISOString?.() || null }; }
function auditEntryState(entry) { return { id: entry.id, action: entry.action, actionType: entry.actionType || null, executorId: entry.executorId || entry.executor?.id || null, executorTag: entry.executor?.tag || entry.executor?.username || null, targetId: entry.targetId || entry.target?.id || null, targetType: entry.targetType || null, reason: entry.reason || null, createdAt: entry.createdAt?.toISOString?.() || null, changes: Array.isArray(entry.changes) ? entry.changes : [] }; }
function diffIds(before = [], after = []) { const a = new Set(before.map((x) => x.id)); const b = new Set(after.map((x) => x.id)); return { added: after.filter((x) => !a.has(x.id)).map((x) => x.id), removed: before.filter((x) => !b.has(x.id)).map((x) => x.id), changed: after.filter((x) => a.has(x.id) && JSON.stringify(before.find((y) => y.id === x.id)) !== JSON.stringify(x)).map((x) => x.id) }; }
function buildDiff(previous, current) {
  if (!previous) return { baseline: true, roles: {}, channels: {}, members: {}, bans: {}, automod: {}, emojis: {}, stickers: {} };
  return {
    baseline: false,
    guildChanged: JSON.stringify(previous.guild) !== JSON.stringify(current.guild),
    roles: diffIds(previous.roles, current.roles), channels: diffIds(previous.channels, current.channels), members: diffIds(previous.members, current.members), bans: diffIds(previous.bans, current.bans), automod: diffIds(previous.automod, current.automod), emojis: diffIds(previous.emojis, current.emojis), stickers: diffIds(previous.stickers, current.stickers),
  };
}
async function scanGuild(guild, options = {}) {
  if (!guild?.id) return { ok: false, reason: 'invalid-guild' };
  const started = Date.now();
  const errors = [];
  await guild.fetch().catch((e) => errors.push(`guild:${e.message}`));
  await guild.roles.fetch().catch((e) => errors.push(`roles:${e.message}`));
  await guild.channels.fetch().catch((e) => errors.push(`channels:${e.message}`));
  await guild.members.fetch().catch((e) => errors.push(`members:${e.message}`));
  await guild.emojis.fetch().catch((e) => errors.push(`emojis:${e.message}`));
  await guild.stickers.fetch().catch((e) => errors.push(`stickers:${e.message}`));
  let bans = []; let invites = []; let automod = []; let auditLogs = [];
  if (guild.members.me?.permissions?.has(PermissionFlagsBits.BanMembers)) bans = collectionValues(await guild.bans.fetch().catch((e) => { errors.push(`bans:${e.message}`); return null; })).map((ban) => ({ id: ban.user.id, username: ban.user.username, reason: ban.reason || null }));
  if (guild.members.me?.permissions?.has(PermissionFlagsBits.ManageGuild)) invites = collectionValues(await guild.invites.fetch().catch((e) => { errors.push(`invites:${e.message}`); return null; })).map((invite) => ({ code: invite.code, channelId: invite.channelId || null, inviterId: invite.inviterId || invite.inviter?.id || null, uses: invite.uses ?? null, maxUses: invite.maxUses ?? null, expiresAt: invite.expiresAt?.toISOString?.() || null }));
  if (guild.members.me?.permissions?.has(PermissionFlagsBits.ManageGuild)) automod = collectionValues(await guild.autoModerationRules.fetch().catch((e) => { errors.push(`automod:${e.message}`); return null; })).map((rule) => ({ id: rule.id, name: rule.name, enabled: rule.enabled, creatorId: rule.creatorId || null, eventType: rule.eventType, triggerType: rule.triggerType, actions: rule.actions || [], exemptRoleIds: [...(rule.exemptRoles?.keys?.() || [])], exemptChannelIds: [...(rule.exemptChannels?.keys?.() || [])] }));
  if (guild.members.me?.permissions?.has(PermissionFlagsBits.ViewAuditLog)) {
    const logs = await guild.fetchAuditLogs({ limit: Math.min(100, Math.max(1, Number(options.auditLimit || 100))) }).catch((e) => { errors.push(`audit:${e.message}`); return null; });
    auditLogs = collectionValues(logs?.entries).map(auditEntryState);
  }
  const current = {
    version: 1, guildId: guild.id, guildName: guild.name, collectorMode: mode(), scannedAt: new Date().toISOString(), durationMs: Date.now() - started,
    guild: { id: guild.id, name: guild.name, ownerId: guild.ownerId, memberCount: guild.memberCount, verificationLevel: guild.verificationLevel, explicitContentFilter: guild.explicitContentFilter, preferredLocale: guild.preferredLocale, afkChannelId: guild.afkChannelId || null, systemChannelId: guild.systemChannelId || null, rulesChannelId: guild.rulesChannelId || null, publicUpdatesChannelId: guild.publicUpdatesChannelId || null, premiumTier: guild.premiumTier, premiumSubscriptionCount: guild.premiumSubscriptionCount || 0 },
    roles: collectionValues(guild.roles.cache).map(roleState), channels: collectionValues(guild.channels.cache).map(channelState), members: collectionValues(guild.members.cache).map(memberState), bans, invites,
    emojis: collectionValues(guild.emojis.cache).map((x) => ({ id: x.id, name: x.name, animated: Boolean(x.animated), managed: Boolean(x.managed) })), stickers: collectionValues(guild.stickers.cache).map((x) => ({ id: x.id, name: x.name, description: x.description || null, tags: x.tags || null })), automod, auditLogs, errors,
  };
  const file = snapshotFile(guild.id); const stored = readJson(file, { latest: null, history: [] });
  current.diff = buildDiff(stored.latest, current);
  const history = [...(Array.isArray(stored.history) ? stored.history : []), current].slice(-HISTORY_LIMIT);
  writeJson(file, { latest: current, history });
  return { ok: true, ...current, counts: { members: current.members.length, bots: current.members.filter((x) => x.bot).length, roles: current.roles.length, channels: current.channels.length, bans: current.bans.length, invites: current.invites.length, emojis: current.emojis.length, stickers: current.stickers.length, automod: current.automod.length, auditLogs: current.auditLogs.length } };
}
function getLatest(guildId) { return readJson(snapshotFile(guildId), { latest: null }).latest || null; }
function getHistory(guildId, limit = 10) { const data = readJson(snapshotFile(guildId), { history: [] }); return (data.history || []).slice(-Math.max(1, Number(limit || 10))); }
function createRequest(guildId, targetMode, requestedBy) {
  const now = Date.now(); const request = { id: `OBS-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, guildId: String(guildId), targetMode: String(targetMode || '').toUpperCase(), requestedBy: requestedBy ? String(requestedBy) : null, requestedAt: new Date(now).toISOString(), expiresAt: new Date(now + REQUEST_TTL_MS).toISOString(), status: 'pending', result: null };
  saveRequests([...requests().filter((x) => Date.parse(x.expiresAt || '') > now || ['completed', 'failed'].includes(x.status)), request]); return request;
}
function getRequest(id) { return requests().find((x) => x.id === String(id)) || null; }
async function processRequests(client) {
  const currentMode = mode(); const now = Date.now(); let items = requests(); let changed = false;
  for (const request of items) {
    if (request.status !== 'pending' || request.targetMode !== currentMode) continue;
    if (Date.parse(request.expiresAt || '') <= now) { request.status = 'expired'; changed = true; continue; }
    const guild = client.guilds.cache.get(request.guildId);
    request.status = 'claimed'; request.claimedAt = new Date().toISOString(); request.claimedBy = currentMode; changed = true; saveRequests(items);
    try { request.result = guild ? await scanGuild(guild) : { ok: false, reason: 'guild-not-live', guildId: request.guildId, collectorMode: currentMode }; request.status = request.result.ok ? 'completed' : 'failed'; }
    catch (error) { request.result = { ok: false, reason: 'scan-error', error: error.message, guildId: request.guildId, collectorMode: currentMode }; request.status = 'failed'; }
    request.completedAt = new Date().toISOString(); changed = true;
  }
  if (changed) saveRequests(items);
}
function wire(client) {
  if (!client || client.__goliathObservatoryWired) return false; client.__goliathObservatoryWired = true;
  const tick = () => processRequests(client).catch((e) => console.warn('[GuildObservatory]', e?.stack || e));
  const timer = setInterval(tick, 1000); timer.unref?.(); setTimeout(tick, 1500).unref?.(); return true;
}
async function requestScan(client, guildId, targetMode, requestedBy, timeoutMs = 15000) {
  const guild = client.guilds.cache.get(String(guildId)); if (guild) return scanGuild(guild);
  const request = createRequest(guildId, targetMode, requestedBy); const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const current = getRequest(request.id); if (['completed', 'failed', 'expired'].includes(current?.status)) return { ...(current.result || { ok: false, reason: current.status }), requestId: request.id, lifecycleStatus: current.status, remote: true }; await new Promise((resolve) => setTimeout(resolve, 500)); }
  return { ok: false, reason: 'remote-timeout', requestId: request.id, remote: true, collectorMode: targetMode };
}
module.exports = { scanGuild, requestScan, processRequests, wire, getLatest, getHistory, createRequest, getRequest };
