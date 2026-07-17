'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { getModuleSection, saveModuleSection, updateModuleSection } = require('../../core/guild/moduleSectionManager');

const SECTION = 'invites';
const now = () => new Date().toISOString();
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const cleanId = (value) => { const id = String(value || '').replace(/[<@&#!>]/g, '').trim(); return /^\d{15,25}$/.test(id) ? id : null; };
const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const inviteCache = new Map();

const MAX_AGE_OPTIONS = new Set([0, 1800, 3600, 21600, 43200, 86400, 604800, 2592000]);
const MAX_USES_OPTIONS = new Set([0, 1, 5, 10, 25, 50, 100]);

function defaults() {
  return {
    enabled: false,
    settings: {
      trackingEnabled: true,
      autoRepair: true,
      managedInviteEnabled: false,
      managedInviteChannelId: null,
      managedInviteCode: null,
      logChannelId: null,
      removeOnLeave: true,
      ignoreBots: true,
      rewardRoles: [],
    },
    inviteLinks: {}, inviters: {}, members: {}, history: [],
    analytics: {
      joins: 0, leaves: 0, tracked: 0, unknown: 0, vanity: 0, fake: 0,
      rewardsGranted: 0, inviteRolesGranted: 0, inviteRoleFailures: 0,
      linksCreated: 0, failures: 0, lastJoinAt: null, lastLeaveAt: null, lastSyncAt: null,
    },
    createdAt: now(), updatedAt: now(),
  };
}

function normalizeReward(item = {}) {
  return { roleId: cleanId(item.roleId), invites: Math.max(1, Math.min(100000, Math.floor(Number(item.invites || item.requiredInvites || 1)))) };
}

function normalizeInviteLink(item = {}, code = null) {
  const maxAge = Number(item.maxAge || 0);
  const maxUses = Number(item.maxUses || 0);
  return {
    code: clean(item.code || code, 100) || null,
    channelId: cleanId(item.channelId),
    inviterId: cleanId(item.inviterId),
    roleIds: [...new Set((Array.isArray(item.roleIds) ? item.roleIds : []).map(cleanId).filter(Boolean))].slice(0, 25),
    maxAge: MAX_AGE_OPTIONS.has(maxAge) ? maxAge : 0,
    maxUses: MAX_USES_OPTIONS.has(maxUses) ? maxUses : 0,
    temporary: item.temporary === true,
    personal: item.personal === true,
    enabled: item.enabled !== false,
    uses: Math.max(0, Number(item.uses || 0)),
    expiresAt: item.expiresAt || null,
    createdAt: item.createdAt || now(), updatedAt: item.updatedAt || now(),
  };
}

function normalize(section = {}) {
  const base = defaults();
  const settings = section.settings || section;
  const inviteLinks = {};
  for (const [code, link] of Object.entries(section.inviteLinks || {})) {
    const normalized = normalizeInviteLink(link, code);
    if (normalized.code) inviteLinks[normalized.code] = normalized;
  }
  return {
    ...base, ...clone(section), enabled: section.enabled === true,
    settings: {
      ...base.settings, ...settings,
      trackingEnabled: settings.trackingEnabled !== false,
      autoRepair: settings.autoRepair !== false,
      managedInviteEnabled: settings.managedInviteEnabled === true || Boolean(settings.inviteCode),
      managedInviteChannelId: cleanId(settings.managedInviteChannelId || settings.channelId),
      managedInviteCode: clean(settings.managedInviteCode || settings.inviteCode, 100) || null,
      logChannelId: cleanId(settings.logChannelId),
      removeOnLeave: settings.removeOnLeave !== false,
      ignoreBots: settings.ignoreBots !== false,
      rewardRoles: (Array.isArray(settings.rewardRoles) ? settings.rewardRoles : []).map(normalizeReward).filter((item) => item.roleId).sort((a, b) => a.invites - b.invites),
    },
    inviteLinks,
    inviters: section.inviters && typeof section.inviters === 'object' ? clone(section.inviters) : {},
    members: section.members && typeof section.members === 'object' ? clone(section.members) : {},
    history: (Array.isArray(section.history) ? section.history : []).slice(-1000),
    analytics: { ...base.analytics, ...(section.analytics || {}) },
    createdAt: section.createdAt || base.createdAt, updatedAt: section.updatedAt || now(),
  };
}

function getSection(guildId) { return normalize(getModuleSection(guildId, SECTION, defaults())); }
function saveSection(guildId, section, meta = {}) { return normalize(saveModuleSection(guildId, SECTION, normalize(section), meta)); }
function updateSection(guildId, updater, meta = {}) { return normalize(updateModuleSection(guildId, SECTION, (current) => { const normalized = normalize(current); return normalize(typeof updater === 'function' ? updater(clone(normalized)) : updater); }, defaults(), meta)); }
function setEnabled(guildId, enabled, meta = {}) { return updateSection(guildId, (section) => ({ ...section, enabled: enabled === true }), meta); }
function updateSettings(guildId, patch = {}, meta = {}) { return updateSection(guildId, (section) => ({ ...section, settings: { ...section.settings, ...patch } }), meta); }
function addHistory(guildId, entry, meta = {}) { return updateSection(guildId, (section) => ({ ...section, history: [...section.history, { id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, at: now(), ...entry }].slice(-1000) }), meta); }
function addAnalytics(guildId, patch, meta = {}) { return updateSection(guildId, (section) => { const analytics = { ...section.analytics }; for (const [key, value] of Object.entries(patch)) analytics[key] = typeof value === 'number' ? Number(analytics[key] || 0) + value : value; return { ...section, analytics }; }, meta).analytics; }

async function fetchInviteSnapshot(guild) {
  const map = new Map();
  const fetched = await guild.invites.fetch();
  for (const invite of fetched.values()) map.set(invite.code, { code: invite.code, uses: Number(invite.uses || 0), inviterId: invite.inviter?.id || null, channelId: invite.channelId || null, maxUses: invite.maxUses || 0, expiresAt: invite.expiresAt?.toISOString?.() || null, temporary: invite.temporary === true });
  return map;
}
async function syncGuild(guild, meta = {}) { const snapshot = await fetchInviteSnapshot(guild); inviteCache.set(guild.id, snapshot); updateSection(guild.id, (section) => { const inviteLinks = { ...section.inviteLinks }; for (const [code, invite] of snapshot.entries()) if (inviteLinks[code]) inviteLinks[code] = normalizeInviteLink({ ...inviteLinks[code], uses: invite.uses, expiresAt: invite.expiresAt, updatedAt: now() }, code); return { ...section, inviteLinks, analytics: { ...section.analytics, lastSyncAt: now() } }; }, meta); return snapshot; }
async function resolveUsedInvite(guild) { const before = inviteCache.get(guild.id) || new Map(); const after = await fetchInviteSnapshot(guild); inviteCache.set(guild.id, after); const candidates = []; for (const [code, invite] of after.entries()) { const delta = invite.uses - Number(before.get(code)?.uses || 0); if (delta > 0) candidates.push({ ...invite, delta }); } candidates.sort((a, b) => b.delta - a.delta); return candidates[0] || null; }
function inviterStats(section, inviterId) { const current = section.inviters[inviterId] || {}; return { inviterId, total: Math.max(0, Number(current.total || 0)), active: Math.max(0, Number(current.active || 0)), left: Math.max(0, Number(current.left || 0)), fake: Math.max(0, Number(current.fake || 0)), bonus: Number(current.bonus || 0), rewards: Array.isArray(current.rewards) ? current.rewards : [], lastInviteAt: current.lastInviteAt || null }; }

async function applyRewards(guild, inviterId, meta = {}) { const section = getSection(guild.id); const stats = inviterStats(section, inviterId); const member = await guild.members.fetch(inviterId).catch(() => null); if (!member) return []; const granted = []; for (const reward of section.settings.rewardRoles) { if (stats.active + stats.bonus < reward.invites || stats.rewards.includes(reward.roleId)) continue; const role = guild.roles.cache.get(reward.roleId) || await guild.roles.fetch(reward.roleId).catch(() => null); if (!role || role.managed || guild.members.me.roles.highest.position <= role.position) continue; await member.roles.add(role, `Goliath invite reward: ${reward.invites} invites`); stats.rewards.push(reward.roleId); granted.push(reward.roleId); } if (granted.length) { updateSection(guild.id, (current) => ({ ...current, inviters: { ...current.inviters, [inviterId]: stats } }), meta); addAnalytics(guild.id, { rewardsGranted: granted.length }, meta); } return granted; }
async function applyInviteRoles(member, inviteCode, meta = {}) { const section = getSection(member.guild.id); const link = section.inviteLinks[inviteCode]; if (!link?.enabled || !link.roleIds.length) return { granted: [], failed: [] }; const granted = []; const failed = []; for (const roleId of link.roleIds) { const role = member.guild.roles.cache.get(roleId) || await member.guild.roles.fetch(roleId).catch(() => null); if (!role || role.managed || member.guild.members.me.roles.highest.position <= role.position) { failed.push(roleId); continue; } try { await member.roles.add(role, `Goliath invite role via ${inviteCode}`); granted.push(roleId); } catch { failed.push(roleId); } } if (granted.length || failed.length) { addHistory(member.guild.id, { type: 'invite_roles', memberId: member.id, inviteCode, roleIds: link.roleIds, grantedRoleIds: granted, failedRoleIds: failed }, meta); addAnalytics(member.guild.id, { inviteRolesGranted: granted.length, inviteRoleFailures: failed.length }, meta); } return { granted, failed }; }

async function trackJoin(member, meta = {}) { const guild = member.guild; const section = getSection(guild.id); if (!section.enabled || !section.settings.trackingEnabled || (member.user.bot && section.settings.ignoreBots)) return null; let used = null; try { used = await resolveUsedInvite(guild); } catch { addAnalytics(guild.id, { failures: 1 }, meta); } const managedRecord = used?.code ? section.inviteLinks[used.code] : null; const inviterId = cleanId(managedRecord?.inviterId || used?.inviterId); const fake = Boolean(member.user.createdTimestamp && Date.now() - member.user.createdTimestamp < 86400000); const attribution = inviterId ? 'invite' : 'unknown'; updateSection(guild.id, (current) => { const inviters = { ...current.inviters }; if (inviterId) { const stats = inviterStats(current, inviterId); stats.total += 1; stats.active += 1; if (fake) stats.fake += 1; stats.lastInviteAt = now(); inviters[inviterId] = stats; } const inviteLinks = { ...current.inviteLinks }; if (used?.code && inviteLinks[used.code]) inviteLinks[used.code] = normalizeInviteLink({ ...inviteLinks[used.code], uses: used.uses, updatedAt: now() }, used.code); return { ...current, inviters, inviteLinks, members: { ...current.members, [member.id]: { memberId: member.id, inviterId, inviteCode: used?.code || null, attribution, fake, joinedAt: now(), leftAt: null, grantedRoleIds: [] } } }; }, meta); const roleResult = used?.code ? await applyInviteRoles(member, used.code, meta) : { granted: [], failed: [] }; updateSection(guild.id, (current) => ({ ...current, members: { ...current.members, [member.id]: { ...current.members[member.id], grantedRoleIds: roleResult.granted } } }), meta); addHistory(guild.id, { type: 'join', memberId: member.id, inviterId, inviteCode: used?.code || null, attribution, fake, grantedRoleIds: roleResult.granted }, meta); addAnalytics(guild.id, { joins: 1, tracked: inviterId ? 1 : 0, unknown: inviterId ? 0 : 1, fake: fake ? 1 : 0, lastJoinAt: now() }, meta); const rewards = inviterId ? await applyRewards(guild, inviterId, meta) : []; return { inviterId, inviteCode: used?.code || null, attribution, fake, rewards, inviteRoles: roleResult }; }
async function trackLeave(member, meta = {}) { const section = getSection(member.guild.id); const record = section.members[member.id]; if (!record || record.leftAt) return null; updateSection(member.guild.id, (current) => { const inviters = { ...current.inviters }; if (record.inviterId && current.settings.removeOnLeave) { const stats = inviterStats(current, record.inviterId); stats.active = Math.max(0, stats.active - 1); stats.left += 1; inviters[record.inviterId] = stats; } return { ...current, inviters, members: { ...current.members, [member.id]: { ...record, leftAt: now() } } }; }, meta); addHistory(member.guild.id, { type: 'leave', memberId: member.id, inviterId: record.inviterId, inviteCode: record.inviteCode }, meta); addAnalytics(member.guild.id, { leaves: 1, lastLeaveAt: now() }, meta); return record; }
function leaderboard(guildId, limit = 25) { const section = getSection(guildId); return Object.values(section.inviters).map((entry) => ({ ...entry, score: Number(entry.active || 0) + Number(entry.bonus || 0) })).sort((a, b) => b.score - a.score || b.total - a.total).slice(0, Math.max(1, Math.min(100, Number(limit || 25)))); }
function setBonus(guildId, inviterId, bonus, meta = {}) { const id = cleanId(inviterId); if (!id) throw new Error('A valid inviter is required.'); return updateSection(guildId, (section) => { const stats = inviterStats(section, id); stats.bonus = Math.max(-100000, Math.min(100000, Number(bonus || 0))); return { ...section, inviters: { ...section.inviters, [id]: stats } }; }, meta).inviters[id]; }

async function createInviteLink(guild, options = {}, meta = {}) {
  const channelId = cleanId(options.channelId);
  const channel = channelId ? (guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null)) : null;
  if (!channel?.createInvite) throw new Error('Select a text channel where Goliath can create invites.');
  const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
  if (!me) throw new Error('Goliath could not resolve its server member record. Restart the bot and try again.');
  const channelPermissions = channel.permissionsFor(me);
  if (!channelPermissions?.has(PermissionFlagsBits.ViewChannel)) throw new Error(`Goliath cannot view ${channel}. Allow View Channel for the bot role.`);
  if (!channelPermissions.has(PermissionFlagsBits.CreateInstantInvite)) throw new Error(`Goliath cannot create invites in ${channel}. Allow Create Invite for the bot role in that channel.`);
  const roleIds = [...new Set((Array.isArray(options.roleIds) ? options.roleIds : []).map(cleanId).filter(Boolean))].slice(0, 25);
  if (roleIds.length && !me.permissions.has(PermissionFlagsBits.ManageRoles)) throw new Error('Goliath needs Manage Roles before an invite can assign roles.');
  for (const roleId of roleIds) {
    const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
    if (!role) throw new Error(`Selected role ${roleId} no longer exists.`);
    if (role.managed) throw new Error(`Goliath cannot assign the managed role ${role.name}.`);
    if (me.roles.highest.position <= role.position) throw new Error(`Goliath cannot assign ${role.name}. Move the Goliath bot role above it and try again.`);
  }
  const maxAge = MAX_AGE_OPTIONS.has(Number(options.maxAge)) ? Number(options.maxAge) : 0;
  const maxUses = MAX_USES_OPTIONS.has(Number(options.maxUses)) ? Number(options.maxUses) : 0;
  const temporary = options.temporary === true;
  let invite;
  try {
    invite = await channel.createInvite({ maxAge, maxUses, temporary, unique: true, reason: `Goliath Invite Studio link created by ${meta.actorId || 'administrator'}` });
  } catch (error) {
    addAnalytics(guild.id, { failures: 1 }, meta);
    if (error?.code === 50013) throw new Error(`Discord denied invite creation in ${channel}. Check the bot's Create Invite permission and channel overrides.`);
    throw new Error(`Discord could not create the invite: ${clean(error?.message || error, 300)}`);
  }
  const record = normalizeInviteLink({ code: invite.code, channelId: channel.id, inviterId: cleanId(options.inviterId) || invite.inviter?.id || meta.actorId, roleIds, maxAge, maxUses, temporary, personal: options.personal === true, uses: invite.uses || 0, expiresAt: invite.expiresAt?.toISOString?.() || null, enabled: true });
  updateSection(guild.id, (section) => ({ ...section, inviteLinks: { ...section.inviteLinks, [invite.code]: record } }), meta);
  addHistory(guild.id, { type: options.personal === true ? 'personal_link_created' : 'link_created', inviteCode: invite.code, channelId: channel.id, inviterId: record.inviterId, roleIds, maxAge, maxUses, temporary }, meta);
  addAnalytics(guild.id, { linksCreated: 1 }, meta);
  await syncGuild(guild, meta);
  return { invite, record };
}

async function deleteInviteLink(guild, code, meta = {}) { const safeCode = clean(code, 100); const fetched = await guild.invites.fetch(safeCode).catch(() => null); if (fetched) await fetched.delete('Deleted from Goliath Invite Studio'); updateSection(guild.id, (section) => { const inviteLinks = { ...section.inviteLinks }; delete inviteLinks[safeCode]; return { ...section, inviteLinks }; }, meta); addHistory(guild.id, { type: 'link_deleted', inviteCode: safeCode }, meta); await syncGuild(guild, meta).catch(() => null); return true; }
function listInviteLinks(guildId) { return Object.values(getSection(guildId).inviteLinks).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))); }
function findPersonalInvite(guildId, userId) { const id = cleanId(userId); return id ? listInviteLinks(guildId).find((link) => link.personal && link.enabled && link.inviterId === id) || null : null; }
async function createPersonalInvite(guild, userId, channelId, meta = {}) {
  const id = cleanId(userId);
  if (!id) throw new Error('A valid member is required.');
  const existing = findPersonalInvite(guild.id, id);
  if (existing) {
    const live = await guild.invites.fetch(existing.code).catch(() => null);
    if (!live) throw new Error('Your saved invite no longer exists in Discord. Delete it from the public panel before creating a replacement.');
    return { invite: live, record: existing, created: false };
  }
  const result = await createInviteLink(guild, { channelId, maxAge: 0, maxUses: 0, temporary: false, roleIds: [], inviterId: id, personal: true }, { ...meta, actorId: id });
  return { ...result, created: true };
}
async function deletePersonalInvite(guild, userId, meta = {}) {
  const record = findPersonalInvite(guild.id, userId);
  if (!record) return false;
  await deleteInviteLink(guild, record.code, { ...meta, actorId: cleanId(userId), action: 'personal_invite_deleted' });
  return true;
}
async function createManagedInvite(guild, channelId, meta = {}) { const section = getSection(guild.id); const id = cleanId(channelId || section.settings.managedInviteChannelId); const result = await createInviteLink(guild, { channelId: id, maxAge: 0, maxUses: 0, temporary: false, roleIds: [] }, meta); updateSettings(guild.id, { managedInviteEnabled: true, managedInviteChannelId: id, managedInviteCode: result.invite.code }, meta); return result.invite; }
async function validateManagedInvite(guild, meta = {}) { const section = getSection(guild.id); if (!section.settings.managedInviteEnabled) return { valid: false, reason: 'disabled' }; const fetched = await guild.invites.fetch(); const existing = fetched.get(section.settings.managedInviteCode); if (existing) return { valid: true, invite: existing }; if (!section.settings.autoRepair) return { valid: false, reason: 'missing' }; const invite = await createManagedInvite(guild, section.settings.managedInviteChannelId, meta); return { valid: true, repaired: true, invite }; }
async function buildHealth(guild) { const section = getSection(guild.id); const issues = []; const warnings = []; const me = guild.members.me; if (!me?.permissions.has(PermissionFlagsBits.ManageGuild)) issues.push({ code: 'manage_guild_missing' }); if (!me?.permissions.has(PermissionFlagsBits.CreateInstantInvite)) issues.push({ code: 'create_invite_missing' }); if (Object.values(section.inviteLinks).some((link) => link.roleIds.length) && !me?.permissions.has(PermissionFlagsBits.ManageRoles)) issues.push({ code: 'manage_roles_missing' }); for (const link of Object.values(section.inviteLinks)) for (const roleId of link.roleIds) { const role = guild.roles.cache.get(roleId); if (!role) warnings.push({ code: 'invite_role_missing', inviteCode: link.code, roleId }); else if (role.managed || me.roles.highest.position <= role.position) issues.push({ code: 'invite_role_unassignable', inviteCode: link.code, roleId }); } if (section.settings.logChannelId) { const channel = guild.channels.cache.get(section.settings.logChannelId) || await guild.channels.fetch(section.settings.logChannelId).catch(() => null); if (!channel?.send) issues.push({ code: 'log_channel_unavailable', channelId: section.settings.logChannelId }); } if (section.settings.managedInviteEnabled) { const result = await validateManagedInvite(guild).catch((error) => ({ valid: false, reason: error.message })); if (!result.valid) warnings.push({ code: 'managed_invite_invalid', reason: result.reason }); } return { module: SECTION, healthy: issues.length === 0, enabled: section.enabled, inviters: Object.keys(section.inviters).length, members: Object.keys(section.members).length, inviteLinks: Object.keys(section.inviteLinks).length, issues, warnings, checkedAt: now() }; }
async function repair(guild, meta = {}) { await syncGuild(guild, meta).catch(() => null); const section = getSection(guild.id); if (section.settings.managedInviteEnabled) await validateManagedInvite(guild, meta).catch(() => null); return buildHealth(guild); }
async function startup(client) { if (client.__goliathInvitesStarted) return; client.__goliathInvitesStarted = true; for (const guild of client.guilds.cache.values()) await syncGuild(guild, { action: 'invites_startup_sync' }).catch(() => null); }

module.exports = { SECTION, defaults, getSection, setEnabled, updateSettings, addHistory, syncGuild, trackJoin, trackLeave, leaderboard, setBonus, createInviteLink, deleteInviteLink, listInviteLinks, findPersonalInvite, createPersonalInvite, deletePersonalInvite, createManagedInvite, validateManagedInvite, buildHealth, repair, startup, applyInviteRoles, exportConfiguration: getSection, reset: (guildId, meta = {}) => saveSection(guildId, defaults(), meta) };
