'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { getModuleSection, saveModuleSection, updateModuleSection } = require('../../core/guild/moduleSectionManager');

const SECTION = 'invites';
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const MAX_AGE_OPTIONS = new Set([0, 1800, 3600, 21600, 43200, 86400, 604800, 2592000]);
const MAX_USES_OPTIONS = new Set([0, 1, 5, 10, 25, 50, 100]);
const inviteCache = new Map();

const now = () => new Date().toISOString();
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const cleanId = (value) => {
  const id = String(value || '').replace(/[<@&#!>]/g, '').trim();
  return /^\d{15,25}$/.test(id) ? id : null;
};
const normalizeRoleIds = (value) => [...new Set((Array.isArray(value) ? value : []).map(cleanId).filter(Boolean))].slice(0, 25);

function defaults() {
  return {
    enabled: false,
    settings: {
      trackingEnabled: true,
      autoRepair: true,
      removeOnLeave: true,
      ignoreBots: true,
      logChannelId: null,
      rewardRoles: [],
      officialInvite: { channelId: null, code: null, roleIds: [] },
      memberInviteTemplate: {
        enabled: true,
        channelId: null,
        roleIds: [],
        maxAge: 0,
        maxUses: 0,
        temporary: false,
        autoReplaceMissing: true,
        dmTitle: '🔗 Your personal invite for {server}',
        dmMessage: 'Share this link with friends. Every valid join counts towards your Invite Studio score.\n\n{invite}',
      },
      publicPanel: {
        channelId: null,
        messageId: null,
        title: '🌍 Join Our Community',
        description: 'Use our official server invite below, or create your own personal link to compete on the leaderboard.',
        color: '#5865F2',
        footer: 'Leaderboard refreshes automatically every 2 hours',
        buttonLabel: 'Join Server',
        leaderboardLimit: 10,
        lastRefreshedAt: null,
      },
    },
    inviteLinks: {}, inviters: {}, members: {}, history: [],
    analytics: {
      joins: 0, leaves: 0, tracked: 0, unknown: 0, official: 0, fake: 0,
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
    roleIds: normalizeRoleIds(item.roleIds),
    maxAge: MAX_AGE_OPTIONS.has(maxAge) ? maxAge : 0,
    maxUses: MAX_USES_OPTIONS.has(maxUses) ? maxUses : 0,
    temporary: item.temporary === true,
    personal: item.personal === true,
    official: item.official === true,
    enabled: item.enabled !== false,
    uses: Math.max(0, Number(item.uses || 0)),
    expiresAt: item.expiresAt || null,
    createdAt: item.createdAt || now(),
    updatedAt: item.updatedAt || now(),
  };
}

function normalize(section = {}) {
  const base = defaults();
  const settings = section.settings || section;
  const officialInvite = settings.officialInvite || {};
  const memberTemplate = settings.memberInviteTemplate || {};
  const publicPanel = settings.publicPanel || {};
  const inviteLinks = {};
  for (const [code, link] of Object.entries(section.inviteLinks || {})) {
    const normalized = normalizeInviteLink(link, code);
    if (normalized.code) inviteLinks[normalized.code] = normalized;
  }
  return {
    ...base,
    ...clone(section),
    enabled: section.enabled === true,
    settings: {
      ...base.settings,
      ...settings,
      trackingEnabled: settings.trackingEnabled !== false,
      autoRepair: settings.autoRepair !== false,
      removeOnLeave: settings.removeOnLeave !== false,
      ignoreBots: settings.ignoreBots !== false,
      logChannelId: cleanId(settings.logChannelId),
      rewardRoles: (Array.isArray(settings.rewardRoles) ? settings.rewardRoles : []).map(normalizeReward).filter((item) => item.roleId).sort((a, b) => a.invites - b.invites),
      officialInvite: {
        ...base.settings.officialInvite,
        ...officialInvite,
        channelId: cleanId(officialInvite.channelId || settings.managedInviteChannelId || settings.channelId),
        code: clean(officialInvite.code || settings.managedInviteCode || settings.inviteCode, 100) || null,
        roleIds: normalizeRoleIds(officialInvite.roleIds),
      },
      memberInviteTemplate: {
        ...base.settings.memberInviteTemplate,
        ...memberTemplate,
        enabled: memberTemplate.enabled !== false,
        channelId: cleanId(memberTemplate.channelId),
        roleIds: normalizeRoleIds(memberTemplate.roleIds),
        maxAge: MAX_AGE_OPTIONS.has(Number(memberTemplate.maxAge)) ? Number(memberTemplate.maxAge) : 0,
        maxUses: MAX_USES_OPTIONS.has(Number(memberTemplate.maxUses)) ? Number(memberTemplate.maxUses) : 0,
        temporary: memberTemplate.temporary === true,
        autoReplaceMissing: memberTemplate.autoReplaceMissing !== false,
        dmTitle: clean(memberTemplate.dmTitle || base.settings.memberInviteTemplate.dmTitle, 256),
        dmMessage: clean(memberTemplate.dmMessage || base.settings.memberInviteTemplate.dmMessage, 3500),
      },
      publicPanel: {
        ...base.settings.publicPanel,
        ...publicPanel,
        channelId: cleanId(publicPanel.channelId),
        messageId: cleanId(publicPanel.messageId),
        title: clean(publicPanel.title || base.settings.publicPanel.title, 256),
        description: clean(publicPanel.description || base.settings.publicPanel.description, 4000),
        color: /^#[0-9a-f]{6}$/i.test(String(publicPanel.color || '')) ? publicPanel.color : base.settings.publicPanel.color,
        footer: clean(publicPanel.footer || base.settings.publicPanel.footer, 2048),
        buttonLabel: clean(publicPanel.buttonLabel || base.settings.publicPanel.buttonLabel, 80),
        leaderboardLimit: Math.max(3, Math.min(25, Number(publicPanel.leaderboardLimit || 10))),
        lastRefreshedAt: publicPanel.lastRefreshedAt || null,
      },
    },
    inviteLinks,
    inviters: section.inviters && typeof section.inviters === 'object' ? clone(section.inviters) : {},
    members: section.members && typeof section.members === 'object' ? clone(section.members) : {},
    history: (Array.isArray(section.history) ? section.history : []).slice(-1000),
    analytics: { ...base.analytics, ...(section.analytics || {}) },
    createdAt: section.createdAt || base.createdAt,
    updatedAt: now(),
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
async function syncGuild(guild, meta = {}) { const snapshot = await fetchInviteSnapshot(guild); inviteCache.set(guild.id, snapshot); updateSection(guild.id, (section) => { const inviteLinks = { ...section.inviteLinks }; for (const [code, invite] of snapshot.entries()) if (inviteLinks[code]) inviteLinks[code] = normalizeInviteLink({ ...inviteLinks[code], uses: invite.uses, expiresAt: invite.expiresAt }, code); return { ...section, inviteLinks, analytics: { ...section.analytics, lastSyncAt: now() } }; }, meta); return snapshot; }
async function resolveUsedInvite(guild) { const before = inviteCache.get(guild.id) || new Map(); const after = await fetchInviteSnapshot(guild); inviteCache.set(guild.id, after); const candidates = []; for (const [code, invite] of after.entries()) { const delta = invite.uses - Number(before.get(code)?.uses || 0); if (delta > 0) candidates.push({ ...invite, delta }); } candidates.sort((a, b) => b.delta - a.delta); return candidates[0] || null; }
function inviterStats(section, inviterId) { const current = section.inviters[inviterId] || {}; return { inviterId, total: Math.max(0, Number(current.total || 0)), active: Math.max(0, Number(current.active || 0)), left: Math.max(0, Number(current.left || 0)), fake: Math.max(0, Number(current.fake || 0)), bonus: Number(current.bonus || 0), rewards: Array.isArray(current.rewards) ? current.rewards : [], lastInviteAt: current.lastInviteAt || null }; }

async function validateRoles(guild, roleIds) {
  const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
  if (!me) throw new Error('Goliath could not resolve its server member record.');
  if (roleIds.length && !me.permissions.has(PermissionFlagsBits.ManageRoles)) throw new Error('Goliath needs Manage Roles before invite roles can be assigned.');
  for (const roleId of roleIds) {
    const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
    if (!role) throw new Error(`Selected role ${roleId} no longer exists.`);
    if (role.managed) throw new Error(`Goliath cannot assign the managed role ${role.name}.`);
    if (me.roles.highest.position <= role.position) throw new Error(`Move the Goliath role above ${role.name}.`);
  }
  return me;
}

async function createInviteLink(guild, options = {}, meta = {}) {
  const channelId = cleanId(options.channelId);
  const channel = channelId ? (guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null)) : null;
  if (!channel?.createInvite) throw new Error('Select a text channel where Goliath can create invites.');
  const roleIds = normalizeRoleIds(options.roleIds);
  const me = await validateRoles(guild, roleIds);
  const permissions = channel.permissionsFor(me);
  if (!permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions.has(PermissionFlagsBits.CreateInstantInvite)) throw new Error(`Goliath needs View Channel and Create Invite in ${channel}.`);
  const maxAge = MAX_AGE_OPTIONS.has(Number(options.maxAge)) ? Number(options.maxAge) : 0;
  const maxUses = MAX_USES_OPTIONS.has(Number(options.maxUses)) ? Number(options.maxUses) : 0;
  const personal = options.personal === true;
  const official = options.official === true;
  if (!personal && !official) {
    const duplicate = listInviteLinks(guild.id).find((link) => !link.personal && !link.official && link.channelId === channelId && link.maxAge === maxAge && link.maxUses === maxUses && link.temporary === (options.temporary === true) && JSON.stringify([...link.roleIds].sort()) === JSON.stringify([...roleIds].sort()));
    if (duplicate) { const live = await guild.invites.fetch(duplicate.code).catch(() => null); if (live) return { invite: live, record: duplicate, created: false }; }
  }
  const invite = await channel.createInvite({ maxAge, maxUses, temporary: options.temporary === true, unique: true, reason: official ? 'Goliath official Invite Studio link' : personal ? `Goliath personal invite for ${options.inviterId}` : 'Goliath Invite Studio link' });
  const record = normalizeInviteLink({ code: invite.code, channelId: channel.id, inviterId: personal ? cleanId(options.inviterId) : null, roleIds, maxAge, maxUses, temporary: options.temporary === true, personal, official, uses: invite.uses || 0, expiresAt: invite.expiresAt?.toISOString?.() || null });
  updateSection(guild.id, (section) => ({ ...section, inviteLinks: { ...section.inviteLinks, [record.code]: record } }), meta);
  addHistory(guild.id, { type: official ? 'official_link_created' : personal ? 'personal_link_created' : 'link_created', inviteCode: record.code, inviterId: record.inviterId }, meta);
  addAnalytics(guild.id, { linksCreated: 1 }, meta);
  await syncGuild(guild, meta).catch(() => null);
  return { invite, record, created: true };
}

async function deleteInviteLink(guild, code, meta = {}) { const safeCode = clean(code, 100); const fetched = await guild.invites.fetch(safeCode).catch(() => null); if (fetched) await fetched.delete('Deleted from Goliath Invite Studio'); updateSection(guild.id, (section) => { const inviteLinks = { ...section.inviteLinks }; delete inviteLinks[safeCode]; return { ...section, inviteLinks }; }, meta); return true; }
function listInviteLinks(guildId) { return Object.values(getSection(guildId).inviteLinks).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))); }
function listAdminInviteLinks(guildId) { return listInviteLinks(guildId).filter((link) => !link.personal && !link.official); }
function findPersonalInvite(guildId, userId) { const id = cleanId(userId); return id ? listInviteLinks(guildId).find((link) => link.personal && link.enabled && link.inviterId === id) || null : null; }

async function createPersonalInvite(guild, userId, _channelId = null, meta = {}) {
  const id = cleanId(userId);
  if (!id) throw new Error('A valid member is required.');
  const template = getSection(guild.id).settings.memberInviteTemplate;
  if (!template.enabled) throw new Error('Member invite creation is disabled by management.');
  if (!template.channelId) throw new Error('Management must configure the member invite channel first.');
  const existing = findPersonalInvite(guild.id, id);
  if (existing) {
    const live = await guild.invites.fetch(existing.code).catch(() => null);
    if (live) return { invite: live, record: existing, created: false };
    if (!template.autoReplaceMissing) throw new Error('Your saved invite no longer exists. Ask management to replace it.');
    updateSection(guild.id, (section) => { const inviteLinks = { ...section.inviteLinks }; delete inviteLinks[existing.code]; return { ...section, inviteLinks }; }, meta);
  }
  return createInviteLink(guild, { channelId: template.channelId, maxAge: template.maxAge, maxUses: template.maxUses, temporary: template.temporary, roleIds: template.roleIds, inviterId: id, personal: true }, { ...meta, actorId: id });
}
async function deletePersonalInvite(guild, userId, meta = {}) { const record = findPersonalInvite(guild.id, userId); if (!record) return false; await deleteInviteLink(guild, record.code, meta); return true; }

async function ensureOfficialInvite(guild, meta = {}) {
  const section = getSection(guild.id);
  const config = section.settings.officialInvite;
  if (!config.channelId) throw new Error('Select the official invite channel first.');
  if (config.code) { const live = await guild.invites.fetch(config.code).catch(() => null); if (live) return { invite: live, created: false }; }
  const result = await createInviteLink(guild, { channelId: config.channelId, maxAge: 0, maxUses: 0, temporary: false, roleIds: config.roleIds, official: true }, meta);
  updateSettings(guild.id, { officialInvite: { ...config, code: result.invite.code } }, meta);
  return { invite: result.invite, created: true };
}

async function applyInviteRoles(member, inviteCode, meta = {}) { const link = getSection(member.guild.id).inviteLinks[inviteCode]; if (!link?.enabled || !link.roleIds.length) return { granted: [], failed: [] }; const granted = []; const failed = []; for (const roleId of link.roleIds) { const role = member.guild.roles.cache.get(roleId) || await member.guild.roles.fetch(roleId).catch(() => null); if (!role || role.managed || member.guild.members.me.roles.highest.position <= role.position) { failed.push(roleId); continue; } try { await member.roles.add(role, `Goliath invite role via ${inviteCode}`); granted.push(roleId); } catch { failed.push(roleId); } } addAnalytics(member.guild.id, { inviteRolesGranted: granted.length, inviteRoleFailures: failed.length }, meta); return { granted, failed }; }
async function applyRewards(guild, inviterId, meta = {}) { const section = getSection(guild.id); const stats = inviterStats(section, inviterId); const member = await guild.members.fetch(inviterId).catch(() => null); if (!member) return []; const granted = []; for (const reward of section.settings.rewardRoles) { if (stats.active + stats.bonus < reward.invites || stats.rewards.includes(reward.roleId)) continue; const role = guild.roles.cache.get(reward.roleId) || await guild.roles.fetch(reward.roleId).catch(() => null); if (!role || role.managed || guild.members.me.roles.highest.position <= role.position) continue; await member.roles.add(role, `Goliath invite reward: ${reward.invites} invites`); stats.rewards.push(reward.roleId); granted.push(reward.roleId); } if (granted.length) updateSection(guild.id, (current) => ({ ...current, inviters: { ...current.inviters, [inviterId]: stats } }), meta); return granted; }

async function trackJoin(member, meta = {}) {
  const guild = member.guild;
  const section = getSection(guild.id);
  if (!section.enabled || !section.settings.trackingEnabled || (member.user.bot && section.settings.ignoreBots)) return null;
  let used = null;
  try { used = await resolveUsedInvite(guild); } catch { addAnalytics(guild.id, { failures: 1 }, meta); }
  const managedRecord = used?.code ? section.inviteLinks[used.code] : null;
  const official = managedRecord?.official === true || used?.code === section.settings.officialInvite.code;
  const inviterId = !official && managedRecord?.personal ? cleanId(managedRecord.inviterId) : null;
  const fake = Boolean(member.user.createdTimestamp && Date.now() - member.user.createdTimestamp < 86400000);
  const attribution = official ? 'official' : inviterId ? 'invite' : 'unknown';
  updateSection(guild.id, (current) => { const inviters = { ...current.inviters }; if (inviterId) { const stats = inviterStats(current, inviterId); stats.total += 1; stats.active += 1; if (fake) stats.fake += 1; stats.lastInviteAt = now(); inviters[inviterId] = stats; } return { ...current, inviters, members: { ...current.members, [member.id]: { memberId: member.id, inviterId, inviteCode: used?.code || null, attribution, fake, joinedAt: now(), leftAt: null, grantedRoleIds: [] } } }; }, meta);
  const roleResult = used?.code ? await applyInviteRoles(member, used.code, meta) : { granted: [], failed: [] };
  updateSection(guild.id, (current) => ({ ...current, members: { ...current.members, [member.id]: { ...current.members[member.id], grantedRoleIds: roleResult.granted } } }), meta);
  addAnalytics(guild.id, { joins: 1, tracked: inviterId ? 1 : 0, official: official ? 1 : 0, unknown: !official && !inviterId ? 1 : 0, fake: fake ? 1 : 0, lastJoinAt: now() }, meta);
  const rewards = inviterId ? await applyRewards(guild, inviterId, meta) : [];
  return { inviterId, inviteCode: used?.code || null, attribution, fake, rewards, inviteRoles: roleResult };
}
async function trackLeave(member, meta = {}) { const section = getSection(member.guild.id); const record = section.members[member.id]; if (!record || record.leftAt) return null; updateSection(member.guild.id, (current) => { const inviters = { ...current.inviters }; if (record.inviterId && current.settings.removeOnLeave) { const stats = inviterStats(current, record.inviterId); stats.active = Math.max(0, stats.active - 1); stats.left += 1; inviters[record.inviterId] = stats; } return { ...current, inviters, members: { ...current.members, [member.id]: { ...record, leftAt: now() } } }; }, meta); addAnalytics(member.guild.id, { leaves: 1, lastLeaveAt: now() }, meta); return record; }
function leaderboard(guildId, limit = 25) { const section = getSection(guildId); const personalOwners = new Set(listInviteLinks(guildId).filter((link) => link.personal).map((link) => link.inviterId)); return Object.values(section.inviters).filter((entry) => personalOwners.has(entry.inviterId)).map((entry) => ({ ...entry, score: Number(entry.active || 0) + Number(entry.bonus || 0) })).sort((a, b) => b.score - a.score || b.total - a.total).slice(0, Math.max(1, Math.min(100, Number(limit || 25)))); }
function setBonus(guildId, inviterId, bonus, meta = {}) { const id = cleanId(inviterId); if (!id) throw new Error('A valid inviter is required.'); return updateSection(guildId, (section) => { const stats = inviterStats(section, id); stats.bonus = Math.max(-100000, Math.min(100000, Number(bonus || 0))); return { ...section, inviters: { ...section.inviters, [id]: stats } }; }, meta).inviters[id]; }
async function buildHealth(guild) { const section = getSection(guild.id); const issues = []; const warnings = []; const me = guild.members.me; if (!me?.permissions.has(PermissionFlagsBits.CreateInstantInvite)) issues.push({ code: 'create_invite_missing' }); if (section.settings.memberInviteTemplate.roleIds.length && !me?.permissions.has(PermissionFlagsBits.ManageRoles)) issues.push({ code: 'manage_roles_missing' }); if (!section.settings.officialInvite.channelId) warnings.push({ code: 'official_invite_channel_missing' }); if (!section.settings.memberInviteTemplate.channelId) warnings.push({ code: 'member_invite_channel_missing' }); return { module: SECTION, healthy: issues.length === 0, enabled: section.enabled, issues, warnings, checkedAt: now() }; }
async function repair(guild, meta = {}) { await syncGuild(guild, meta).catch(() => null); if (getSection(guild.id).settings.officialInvite.channelId) await ensureOfficialInvite(guild, meta).catch(() => null); return buildHealth(guild); }
async function startup(client) { if (client.__goliathInvitesStarted) return; client.__goliathInvitesStarted = true; const panels = require('./invitesPublicPanels'); for (const guild of client.guilds.cache.values()) { await syncGuild(guild, { action: 'invites_startup_sync' }).catch(() => null); panels.startAutoRefresh(guild, TWO_HOURS_MS); } }

module.exports = { SECTION, TWO_HOURS_MS, defaults, getSection, setEnabled, updateSettings, addHistory, syncGuild, trackJoin, trackLeave, leaderboard, setBonus, createInviteLink, deleteInviteLink, listInviteLinks, listAdminInviteLinks, findPersonalInvite, createPersonalInvite, deletePersonalInvite, ensureOfficialInvite, buildHealth, repair, startup, applyInviteRoles, exportConfiguration: getSection, reset: (guildId, meta = {}) => saveSection(guildId, defaults(), meta) };
