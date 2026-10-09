'use strict';

const { PermissionFlagsBits } = require('discord.js');
const guildManager = require('../../../core/guild/guildManager');
const { getModuleSection, saveModuleSection, updateModuleSection } = require('../../../core/guild/moduleSectionManager');

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
    settings: {
      trackingEnabled: true,
      autoRepair: true,
      removeOnLeave: true,
      ignoreBots: true,
      logChannelId: null,
      rewardRoles: [],
      officialInvite: { channelId: null, code: null, roleIds: [], maxAge: 0, maxUses: 0, linkType: 'standard', vanityCode: null },
      memberInviteTemplate: {
        enabled: true,
        channelId: null,
        roleIds: [],
        maxAge: 0,
        maxUses: 0,
        temporary: false,
        autoReplaceMissing: true,
        dmTitle: '💎 Your Personal Invite to {server}',
        dmMessage: "Hey {user}! 👋\\n\\nYour very own invitation to **{server}** is ready!\\n\\nInvite your friends, grow our community and earn your place on the referral leaderboard. Every eligible referral brings you one step closer to the top! 🏆\\n\\n**Share your link, bring your friends and let the competition begin! 💎**",
      },
      publicPanel: {
        channelId: null,
        messageId: null,
        title: "💎 Invite & Climb the Leaderboard",
        description: "💎 **Your invites. Your referrals. Your place on the leaderboard.**\n\nBring your friends into the server using your own personal invite link. Every eligible referral counts towards your score and helps you climb the rankings.\n\n🏆 **Share your link, build your referrals and compete for the top spot!**",
        color: '#5865F2',
        footer: "💎 Goliath Invites • Every Referral Counts • Leaderboard updates every 2 hours",
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
  const normalized = {
    ...base,
    ...clone(section),
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
        linkType: officialInvite.linkType === 'vanity' ? 'vanity' : 'standard',
        vanityCode: clean(officialInvite.vanityCode, 100) || null,
        maxAge: 0,
        maxUses: 0,
      },
      memberInviteTemplate: {
        ...base.settings.memberInviteTemplate,
        ...memberTemplate,
        enabled: memberTemplate.enabled !== false,
        channelId: cleanId(memberTemplate.channelId),
        roleIds: normalizeRoleIds(memberTemplate.roleIds),
        maxAge: 0,
        maxUses: 0,
        channelId: null,
        roleIds: [],
        roleIdsOverride: null,
        limitsOverride: null,
        temporary: false,
        autoReplaceMissing: memberTemplate.autoReplaceMissing !== false,
        dmTitle: clean(memberTemplate.dmTitle === "🔗 Your personal invite for {server}" ? base.settings.memberInviteTemplate.dmTitle : (memberTemplate.dmTitle || base.settings.memberInviteTemplate.dmTitle), 256),
        dmMessage: clean(memberTemplate.dmMessage === "Share this link with friends. Every valid join counts towards your Invite Studio score.\\n\\n{invite}" ? base.settings.memberInviteTemplate.dmMessage : (memberTemplate.dmMessage || base.settings.memberInviteTemplate.dmMessage), 3500),
      },
      publicPanel: {
        ...base.settings.publicPanel,
        ...publicPanel,
        channelId: cleanId(publicPanel.channelId),
        messageId: cleanId(publicPanel.messageId),
        title: clean(publicPanel.title === "🌍 Join Our Community" ? base.settings.publicPanel.title : (publicPanel.title || base.settings.publicPanel.title), 256),
        description: clean((publicPanel.description === "Use our official server invite below, or create your own personal link to compete on the leaderboard." ? base.settings.publicPanel.description : (publicPanel.description || base.settings.publicPanel.description)).replace(/\\\\n/g, '\\n'), 4000),
        color: /^#[0-9a-f]{6}$/i.test(String(publicPanel.color || '')) ? publicPanel.color : base.settings.publicPanel.color,
        footer: clean(publicPanel.footer === "Leaderboard refreshes automatically every 2 hours" ? base.settings.publicPanel.footer : (publicPanel.footer || base.settings.publicPanel.footer), 2048),
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
  delete normalized.enabled;
  return normalized;
}

function getSection(guildId) { return normalize(getModuleSection(guildId, SECTION, defaults())); }
function saveSection(guildId, section, meta = {}) { return normalize(saveModuleSection(guildId, SECTION, normalize(section), meta)); }
function updateSection(guildId, updater, meta = {}) { return normalize(updateModuleSection(guildId, SECTION, (current) => { const normalized = normalize(current); return normalize(typeof updater === 'function' ? updater(clone(normalized)) : updater); }, defaults(), meta)); }
function setEnabled(guildId, enabled, meta = {}) { guildManager.setModuleEnabled(guildId, SECTION, enabled === true, meta); return { ...getSection(guildId), enabled: guildManager.isModuleEnabled(guildId, SECTION) }; }
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
  const maxAge = 0;
  const maxUses = 0;
  const personal = options.personal === true;
  const official = options.official === true;
  if (!personal && !official) {
    const duplicate = listInviteLinks(guild.id).find((link) => !link.personal && !link.official && link.channelId === channelId && link.maxAge === maxAge && link.maxUses === maxUses && link.temporary === (options.temporary === true) && JSON.stringify([...link.roleIds].sort()) === JSON.stringify([...roleIds].sort()));
    if (duplicate) { const live = await guild.invites.fetch(duplicate.code).catch(() => null); if (live) return { invite: live, record: duplicate, created: false }; }
  }
  const invite = await channel.createInvite({ maxAge, maxUses, temporary: false, unique: true, reason: official ? 'Goliath official Invite Studio link' : personal ? `Goliath personal invite for ${options.inviterId}` : 'Goliath Invite Studio link' });
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
  const destinationId = getSection(guild.id).settings.officialInvite.channelId;
  if (!destinationId) throw new Error('Management must configure the official invite destination first.');
  const existing = findPersonalInvite(guild.id, id);
  if (existing) {
    const live = await guild.invites.fetch(existing.code).catch(() => null);
    if (live) return { invite: live, record: existing, created: false };
    if (!template.autoReplaceMissing) throw new Error('Your saved invite no longer exists. Ask management to replace it.');
    updateSection(guild.id, (section) => { const inviteLinks = { ...section.inviteLinks }; delete inviteLinks[existing.code]; return { ...section, inviteLinks }; }, meta);
  }
  const official = getSection(guild.id).settings.officialInvite;
  return createInviteLink(guild, { channelId: destinationId, maxAge: 0, maxUses: 0, temporary: false, roleIds: official.roleIds, inviterId: id, personal: true }, { ...meta, actorId: id });
}
async function deletePersonalInvite(guild, userId, meta = {}) { const record = findPersonalInvite(guild.id, userId); if (!record) return false; await deleteInviteLink(guild, record.code, meta); return true; }

async function ensureOfficialInvite(guild, meta = {}, regenerate = false) {
  const section = getSection(guild.id);
  const config = section.settings.officialInvite;
  if (!config.channelId) throw new Error('Select the official invite channel first.');
  const previous = config.code ? await guild.invites.fetch(config.code).catch(() => null) : null;
  const saved = config.code ? section.inviteLinks[config.code] : null;
  const sameConfig = previous && saved && saved.channelId === config.channelId &&
    saved.maxAge === 0 && saved.maxUses === 0 &&
    JSON.stringify([...saved.roleIds].sort()) === JSON.stringify([...config.roleIds].sort());
  if (sameConfig && !regenerate) return { invite: previous, created: false };
  const result = await createInviteLink(guild, { channelId: config.channelId, maxAge: 0, maxUses: 0, temporary: false, roleIds: config.roleIds, official: true }, meta);
  updateSettings(guild.id, { officialInvite: { ...config, code: result.invite.code } }, meta);
  if (config.code && config.code !== result.invite.code) {
    if (previous) await previous.delete('Goliath official invite replaced').catch(() => null);
    updateSection(guild.id, (current) => {
      const inviteLinks = { ...current.inviteLinks };
      delete inviteLinks[config.code];
      return { ...current, inviteLinks };
    }, meta);
  }
  return { invite: result.invite, created: true };
}

async function applyInviteRoles(member, inviteCode, meta = {}) { const link = getSection(member.guild.id).inviteLinks[inviteCode]; if (!link?.enabled || !link.roleIds.length) return { granted: [], failed: [] }; const granted = []; const failed = []; for (const roleId of link.roleIds) { const role = member.guild.roles.cache.get(roleId) || await member.guild.roles.fetch(roleId).catch(() => null); if (!role || role.managed || member.guild.members.me.roles.highest.position <= role.position) { failed.push(roleId); continue; } try { await member.roles.add(role, `Goliath invite role via ${inviteCode}`); granted.push(roleId); } catch { failed.push(roleId); } } addAnalytics(member.guild.id, { inviteRolesGranted: granted.length, inviteRoleFailures: failed.length }, meta); return { granted, failed }; }
async function applyRewards(guild, inviterId, meta = {}) { const section = getSection(guild.id); const stats = inviterStats(section, inviterId); const member = await guild.members.fetch(inviterId).catch(() => null); if (!member) return []; const granted = []; for (const reward of section.settings.rewardRoles) { if (stats.active + stats.bonus < reward.invites || stats.rewards.includes(reward.roleId)) continue; const role = guild.roles.cache.get(reward.roleId) || await guild.roles.fetch(reward.roleId).catch(() => null); if (!role || role.managed || guild.members.me.roles.highest.position <= role.position) continue; await member.roles.add(role, `Goliath invite reward: ${reward.invites} invites`); stats.rewards.push(reward.roleId); granted.push(reward.roleId); } if (granted.length) updateSection(guild.id, (current) => ({ ...current, inviters: { ...current.inviters, [inviterId]: stats } }), meta); return granted; }

async function trackJoin(member, meta = {}) {
  const guild = member.guild;
  if (!guildManager.isModuleEnabled(guild.id, SECTION)) return null;
  const section = getSection(guild.id);
  if (!section.settings.trackingEnabled || (member.user.bot && section.settings.ignoreBots)) return null;
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
async function getVanityStatus(guild) {
  try {
    const data = await guild.fetchVanityData();
    return { available: Boolean(data?.code), code: data?.code || null, verified: true,
      status: data?.code ? 'active' : 'unavailable',
      detail: data?.code ? `Vanity URL active: discord.gg/${data.code}` : 'No vanity URL is currently configured or available for this guild.' };
  } catch (error) {
    const code = Number(error?.code || error?.rawError?.code || 0);
    const forbidden = code === 50013 || code === 50001 || Number(error?.status) === 403;
    return { available: false, code: null, verified: false,
      status: forbidden ? 'permission' : 'unknown',
      detail: forbidden ? 'Discord denied access to vanity information. Check the bot permissions and guild eligibility.' : 'Discord vanity verification is temporarily unavailable. Try checking again.' };
  }
}
async function syncVanityStatus(guild) {
  const status = await getVanityStatus(guild);
  if (status.verified) {
    const section = getSection(guild.id);
    const config = section.settings.officialInvite;
    if (config.vanityCode !== status.code) {
      updateSettings(guild.id, { officialInvite: { ...config, vanityCode: status.code } }, { action: 'invite_vanity_status_sync' });
    }
  }
  return status;
}
function officialDisplayUrl(guildId) {
  const config = getSection(guildId).settings.officialInvite;
  if (config.linkType === 'vanity' && config.vanityCode) return `https://discord.gg/${config.vanityCode}`;
  return config.code ? `https://discord.gg/${config.code}` : null;
}
async function buildHealth(guild) {
  const section = getSection(guild.id);
  const settings = section.settings;
  const issues = [];
  const warnings = [];
  const checks = [];
  const enabled = guildManager.isModuleEnabled(guild.id, SECTION);
  const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
  const check = (name, status, detail, code) => {
    checks.push({ name, status, detail });
    if (status === 'issue') issues.push({ code, detail });
    if (status === 'warning') warnings.push({ code, detail });
  };
  const channel = settings.officialInvite.channelId
    ? await guild.channels.fetch(settings.officialInvite.channelId).catch(() => null)
    : null;
  const channelPerms = channel && me ? channel.permissionsFor(me) : null;
  const canInvite = Boolean(channel?.createInvite && channelPerms?.has(PermissionFlagsBits.CreateInstantInvite));
  const officialCode = settings.officialInvite.code;
  if (!channel) check('Destination Channel', 'warning', 'Select a valid invite destination channel.', 'destination_missing');
  else check('Destination Channel', canInvite ? 'healthy' : 'issue',
    canInvite ? 'Channel accessible; invite creation permitted.' : 'Missing Create Invite permission or channel access.', 'destination_permissions');
  if (!officialCode) check('Official Invite', 'warning', 'No official invite configured.', 'official_missing');
  else {
    try {
      const live = await guild.invites.fetch(officialCode);
      check('Official Invite', live ? 'healthy' : 'issue', live ? 'Verified with Discord.' : 'Invite not found.', 'official_invalid');
    } catch {
      check('Official Invite', 'warning', 'Could not verify with Discord; validity unknown.', 'official_unverified');
    }
  }
  if (settings.officialInvite.linkType === 'vanity') {
    const vanity = await getVanityStatus(guild);
    check('Vanity Invite', !vanity.verified ? 'warning' : vanity.available ? 'healthy' : 'warning',
      !vanity.verified ? 'Vanity status could not be verified; standard invite fallback remains available.' : vanity.available ? `Custom invite available: discord.gg/${vanity.code}` : 'Custom invite unavailable; standard invite fallback is used.', 'vanity_status');
  }
  const roleIds = settings.officialInvite.roleIds || [];
  if (!roleIds.length) check('Join Roles', 'healthy', 'No automatic join roles configured.');
  else {
    const missing = roleIds.filter((id) => !guild.roles.cache.has(id));
    const manageable = Boolean(me?.permissions.has(PermissionFlagsBits.ManageRoles));
    const blocked = roleIds.filter((id) => {
      const role = guild.roles.cache.get(id);
      return role && (role.managed || !me || me.roles.highest.position <= role.position);
    });
    check('Join Roles', missing.length || blocked.length || !manageable ? 'issue' : 'healthy',
      missing.length || blocked.length || !manageable ? `${missing.length} missing, ${blocked.length} unassignable; Manage Roles: ${manageable ? 'yes' : 'no'}.` : `${roleIds.length} role(s) assignable.`, 'join_roles_unassignable');
  }
  const personal = Object.values(section.inviteLinks || {}).filter((link) => link.personal);
  const invalid = personal.filter((link) => !link.code || !link.inviterId || link.channelId !== settings.officialInvite.channelId || Number(link.maxAge || 0) !== 0 || Number(link.maxUses || 0) !== 0);
  check('Member Invites', invalid.length ? 'warning' : 'healthy',
    `${personal.length} recorded personal links; ${invalid.length} configuration inconsistencies. New requests: ${settings.memberInviteTemplate.enabled ? 'on' : 'off'}.`, 'member_link_mismatch');
  const stats = Object.values(section.inviters || {});
  const malformed = stats.filter((record) => !Number.isFinite(Number(record.active || 0)) || !Number.isFinite(Number(record.total || 0)));
  check('Referral Tracking', malformed.length ? 'warning' : settings.trackingEnabled ? 'healthy' : 'warning',
    malformed.length ? `${malformed.length} invalid member statistic record(s).` : `Tracking ${settings.trackingEnabled ? 'enabled' : 'disabled'}; ${Number(section.analytics?.tracked || 0)} tracked joins.`, 'tracking_attention');
  const panel = settings.publicPanel;
  if (!panel.channelId || !panel.messageId) check('Public Panel', 'warning', 'No published panel recorded.', 'panel_not_deployed');
  else {
    const panelChannel = await guild.channels.fetch(panel.channelId).catch(() => null);
    const perms = panelChannel && me ? panelChannel.permissionsFor(me) : null;
    if (!panelChannel?.messages || !perms?.has(PermissionFlagsBits.ViewChannel) || !perms.has(PermissionFlagsBits.SendMessages) || !perms.has(PermissionFlagsBits.EmbedLinks)) {
      check('Public Panel', 'issue', 'Channel unavailable or missing View/Send/Embed permissions.', 'panel_permissions');
    } else {
      const message = await panelChannel.messages.fetch(panel.messageId).catch(() => null);
      check('Public Panel', message ? 'healthy' : 'warning',
        message ? 'Published message verified; channel permissions available.' : 'Saved message could not be verified.', 'panel_unverified');
    }
  }
  return { module: SECTION, healthy: issues.length === 0, enabled, issues, warnings, checks, checkedAt: now() };
}
async function repair(guild, meta = {}) {
  await syncGuild(guild, meta).catch(() => null);
  // Never silently replace an existing permanent official invite.
  const official = getSection(guild.id).settings.officialInvite;
  if (official.channelId && !official.code) await ensureOfficialInvite(guild, meta).catch(() => null);
  return buildHealth(guild);
}
async function startup(client) { if (client.__goliathInvitesStarted) return; client.__goliathInvitesStarted = true; const panels = require('./invitesPublicPanels'); for (const guild of client.guilds.cache.values()) { if (!guildManager.isModuleEnabled(guild.id, SECTION)) continue; await syncGuild(guild, { action: 'invites_startup_sync' }).catch(() => null); panels.startAutoRefresh(guild, TWO_HOURS_MS); } }

module.exports = { SECTION, TWO_HOURS_MS, defaults, getSection, setEnabled, updateSettings, addHistory, syncGuild, trackJoin, trackLeave, leaderboard, setBonus, createInviteLink, deleteInviteLink, listInviteLinks, listAdminInviteLinks, findPersonalInvite, createPersonalInvite, deletePersonalInvite, ensureOfficialInvite, getVanityStatus, syncVanityStatus, officialDisplayUrl, buildHealth, repair, startup, applyInviteRoles, exportConfiguration: getSection, reset: (guildId, meta = {}) => saveSection(guildId, defaults(), meta) };
