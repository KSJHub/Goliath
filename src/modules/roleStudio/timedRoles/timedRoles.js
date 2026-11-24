'use strict';

const crypto = require('node:crypto');
const { PermissionFlagsBits } = require('discord.js');
const guildManager = require('../../../core/guild/guildManager');
const { replaceVars } = require('../../../core/guild/guildVariables');
const { getModuleSection, saveModuleSection, updateModuleSection } = require('../../../core/guild/moduleSectionManager');
const sentinelScheduler = require('../../../owner/sentinel/schedulerRegistry.js');

const SECTION = 'timedRoles';
const UNITS = Object.freeze(['minutes', 'hours', 'days', 'weeks', 'months', 'years']);
const MODES = Object.freeze(['keep_all', 'highest_only']);
const SCHEDULER_TICK_MS = 5 * 60 * 1000;
const SCHEDULER_ID = 'timedRoles:progression:global';
const now = () => new Date().toISOString();
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const cleanId = (value) => {
  const id = String(value || '').replace(/[<@&#!>]/g, '').trim();
  return /^\d{15,25}$/.test(id) ? id : null;
};
const cleanText = (value, max = 120) => String(value ?? '').trim().slice(0, max);
const createId = () => `tr_${crypto.randomUUID().slice(0, 8)}`;

function defaultSection() {
  return {
    settings: {
      includeBots: false,
      scanIntervalMinutes: 60,
      progressionMode: 'highest_only',
      announcePromotions: false,
      celebrationEmbed: true,
      celebrationGif: null,
      celebrationTitle: 'Milestone achieved!',
      celebrateRetroactive: false,
      announcementChannelId: null,
      announcementMessage: '🎉 Congratulations {member}! You have earned {role} after {duration} in the server.',
    },
    rules: {},
    analytics: {
      scans: 0,
      simulations: 0,
      membersChecked: 0,
      awarded: 0,
      removed: 0,
      announced: 0,
      skipped: 0,
      failed: 0,
      lastScanAt: null,
    },
    createdAt: now(),
    updatedAt: now(),
  };
}

function normalizeRule(rule = {}) {
  const value = Math.max(1, Math.floor(Number(rule.value || rule.durationValue || 1)));
  const requestedUnit = String(rule.unit || rule.durationUnit || 'days').toLowerCase();
  const unit = UNITS.includes(requestedUnit) ? requestedUnit : 'days';
  const roleId = cleanId(rule.roleId);
  const removeRoleIds = [...new Set((Array.isArray(rule.removeRoleIds) ? rule.removeRoleIds : []).map(cleanId).filter((id) => id && id !== roleId))];
  return {
    ruleId: cleanText(rule.ruleId || rule.id, 80) || createId(),
    enabled: rule.enabled !== false,
    name: cleanText(rule.name || 'Timed role milestone', 100),
    roleId,
    value,
    unit,
    removeRoleIds,
    celebration: rule.celebration && typeof rule.celebration === 'object' ? Object.fromEntries(Object.entries(rule.celebration).filter(([key,value]) => ['announcePromotions','announcementChannelId','announcementMessage','celebrationTitle','celebrationGif','celebrationEmbed','celebrationColor'].includes(key) && (typeof value === 'string' || typeof value === 'boolean' || value === null || Number.isInteger(value)))) : {},
    startMode: ['original', 'continuous', 'custom'].includes(rule.startMode) ? rule.startMode : 'original',
    customStartAt: typeof rule.customStartAt === 'string' && Number.isFinite(Date.parse(rule.customStartAt)) ? new Date(rule.customStartAt).toISOString() : null,
    createdBy: cleanId(rule.createdBy),
    createdAt: rule.createdAt || now(),
    updatedAt: now(),
    lastRunAt: rule.lastRunAt || null,
    lastAwarded: Math.max(0, Number(rule.lastAwarded || 0)),
    lastError: cleanText(rule.lastError, 500) || null,
  };
}

function normalizeSection(section = {}) {
  const base = defaultSection();
  const sourceRules = section.rules && typeof section.rules === 'object' ? section.rules : {};
  const settings = section.settings || {};
  const normalized = {
    ...base,
    ...clone(section),
    settings: {
      ...base.settings,
      ...settings,
      includeBots: settings.includeBots === true,
      scanIntervalMinutes: Math.max(5, Math.min(1440, Number(settings.scanIntervalMinutes || 60))),
      progressionMode: MODES.includes(settings.progressionMode) ? settings.progressionMode : 'highest_only',
      announcePromotions: settings.announcePromotions === true,
      announcementChannelId: cleanId(settings.announcementChannelId),
      announcementMessage: cleanText(settings.announcementMessage || base.settings.announcementMessage, 1000),
    },
    rules: Object.fromEntries(Object.entries(sourceRules).map(([id, rule]) => {
      const normalizedRule = normalizeRule({ ...rule, ruleId: rule.ruleId || id });
      return [normalizedRule.ruleId, normalizedRule];
    })),
    analytics: { ...base.analytics, ...(section.analytics || {}) },
    updatedAt: section.updatedAt || now(),
  };
  delete normalized.enabled;
  return normalized;
}

function getSection(guildId) { return normalizeSection(getModuleSection(guildId, SECTION, defaultSection())); }
function saveSection(guildId, section, meta = {}) { return normalizeSection(saveModuleSection(guildId, SECTION, normalizeSection(section), meta)); }
function updateSection(guildId, updater, meta = {}) {
  return normalizeSection(updateModuleSection(guildId, SECTION, (current) => {
    const normalized = normalizeSection(current);
    return normalizeSection(typeof updater === 'function' ? updater(clone(normalized)) : updater);
  }, defaultSection(), meta));
}
function listRules(guildId) { return Object.values(getSection(guildId).rules).sort((a, b) => durationRank(a) - durationRank(b)); }
function getRule(guildId, ruleId) { return getSection(guildId).rules[cleanText(ruleId, 80)] || null; }
function setEnabled(guildId, enabled, meta = {}) {
  guildManager.setModuleEnabled(guildId, SECTION, enabled === true, meta);
  return { ...getSection(guildId), enabled: guildManager.isModuleEnabled(guildId, SECTION) };
}
function appendAudit(section, type, details, meta = {}) {
  const entry = { id: createId(), at: now(), type, actorId: cleanId(meta.actorId), details };
  return { ...section, operationalAudit: [...(Array.isArray(section.operationalAudit) ? section.operationalAudit : []), entry] };
}
function recordAudit(guildId, type, details, meta = {}) {
  return updateSection(guildId, section => appendAudit(section, type, details, meta), meta);
}
function updateSettings(guildId, settings = {}, meta = {}) {
  return updateSection(guildId, (section) => appendAudit({ ...section, settings: { ...section.settings, ...settings }, updatedAt: now() }, 'settings_updated', { keys: Object.keys(settings) }, meta), meta);
}
function saveRule(guildId, input, meta = {}) {
  const normalized = normalizeRule(input);
  if (!normalized.roleId) throw new Error('A valid Discord role is required.');
  if (normalized.startMode === 'custom' && !normalized.customStartAt) throw new Error('A valid custom starting date is required.');
  return updateSection(guildId, section => {
    const previous = section.rules[normalized.ruleId];
    const next = { ...section, rules: { ...section.rules, [normalized.ruleId]: { ...previous, ...normalized } }, updatedAt: now() };
    const keys = Object.keys(normalized).filter(key => !['updatedAt','lastRunAt','lastAwarded','lastError'].includes(key) && JSON.stringify(previous?.[key]) !== JSON.stringify(normalized[key]));
    return keys.length ? appendAudit(next, previous ? 'milestone_updated' : 'milestone_created', { ruleId: normalized.ruleId, keys }, meta) : next;
  }, meta).rules[normalized.ruleId];
}
function removeRule(guildId, ruleId, meta = {}) {
  return updateSection(guildId, (section) => {
    const rules = { ...section.rules };
    delete rules[cleanText(ruleId, 80)];
    return appendAudit({ ...section, rules, updatedAt: now() }, 'milestone_deleted', { ruleId }, meta);
  }, meta);
}

function eligibleAt(joinedAt, rule) {
  if (!joinedAt) return null;
  const date = new Date(joinedAt);
  if (!Number.isFinite(date.getTime())) return null;
  const value = Number(rule.value || 1);
  if (rule.unit === 'minutes') date.setUTCMinutes(date.getUTCMinutes() + value);
  else if (rule.unit === 'hours') date.setUTCHours(date.getUTCHours() + value);
  else if (rule.unit === 'weeks') date.setUTCDate(date.getUTCDate() + (value * 7));
  else if (rule.unit === 'months') date.setUTCMonth(date.getUTCMonth() + value);
  else if (rule.unit === 'years') date.setUTCFullYear(date.getUTCFullYear() + value);
  else date.setUTCDate(date.getUTCDate() + value);
  return date;
}
function durationRank(rule) {
  const origin = new Date('2000-01-01T00:00:00.000Z');
  return eligibleAt(origin, rule)?.getTime() - origin.getTime() || 0;
}
function formatDuration(rule) {
  const value = Number(rule.value || 1);
  const unit = value === 1 ? String(rule.unit).replace(/s$/, '') : rule.unit;
  return `${value} ${unit}`;
}
function canManageRole(guild, role) {
  const me = guild?.members?.me;
  return Boolean(me && role && !role.managed && role.id !== guild.id && me.permissions.has(PermissionFlagsBits.ManageRoles) && me.roles.highest.position > role.position);
}
async function resolveRole(guild, roleId) { return guild.roles.cache.get(roleId) || guild.roles.fetch(roleId).catch(() => null); }

function setMemberMilestoneOverride(guildId, memberId, ruleId, input, meta = {}) {
  const id = cleanId(memberId);
  if (!id || !getRule(guildId, ruleId)) throw new Error('Invalid member or milestone.');
  const override = {};
  for (const key of ['startAt', 'dueAt']) {
    if (!input[key]) continue;
    const date = new Date(input[key]);
    if (!Number.isFinite(date.getTime())) throw new Error('Invalid milestone date.');
    override[key] = date.toISOString();
  }
  return updateSection(guildId, section => {
    const all = { ...section.memberOverrides };
    const member = { ...all[id] };
    if (Object.keys(override).length) member[ruleId] = { ...override, updatedAt: now(), updatedBy: cleanId(meta.actorId) };
    else delete member[ruleId];
    if (Object.keys(member).length) all[id] = member;
    else delete all[id];
    return appendAudit({ ...section, memberOverrides: all }, 'member_dates_updated', { memberId: id, ruleId, previous: section.memberOverrides?.[id]?.[ruleId] || null, next: override }, meta);
  }, meta);
}

function getMemberProgression(member, rules = listRules(member.guild.id)) {
  const record = guildManager.getGuildSection(member.guild.id, 'membershipRecords', {}).members?.[member.id];
  const joinedAt = record?.firstJoinedAt || member.joinedAt;
  const timestamp = Date.now();
  const overrides = getSection(member.guild.id).memberOverrides?.[member.id] || {};
  const entries = rules.filter(rule => rule.enabled).map(rule => {
    const start = rule.startMode === 'custom' ? rule.customStartAt
      : rule.startMode === 'continuous' ? member.joinedAt : joinedAt;
    const override = overrides[rule.ruleId];
    return { rule, date: override?.dueAt ? new Date(override.dueAt) : eligibleAt(override?.startAt || start, rule) };
  }).filter(entry => entry.date && Number.isFinite(entry.date.getTime()))
    .sort((a, b) => a.date - b.date || durationRank(a.rule) - durationRank(b.rule));
  const due = entries.filter(entry => entry.date.getTime() <= timestamp).map(entry => entry.rule);
  const upcoming = entries.filter(entry => entry.date.getTime() > timestamp);
  return {
    joinedAt: joinedAt && Number.isFinite(new Date(joinedAt).getTime()) ? new Date(joinedAt).toISOString() : null,
    due,
    dueAtByRule: Object.fromEntries(entries.map(entry => [entry.rule.ruleId, entry.date.toISOString()])),
    current: due.length ? due[due.length - 1] : null,
    next: upcoming[0]?.rule || null,
    nextAt: upcoming[0]?.date.toISOString() || null,
  };
}

async function announcePromotion(member, rule, role, settings) {
  if (!settings.announcePromotions || !settings.announcementChannelId) return false;
  const channel = member.guild.channels.cache.get(settings.announcementChannelId)
    || await member.guild.channels.fetch(settings.announcementChannelId).catch(() => null);
  if (!channel?.isTextBased?.() || typeof channel.send !== 'function') return false;
  const interaction = {
    guild: member.guild,
    guildId: member.guild.id,
    user: member.user,
    member,
    channel,
    channelId: channel.id,
  };
  const message = replaceVars(settings.announcementMessage, interaction, true, {
    '{member}': `<@${member.id}>`,
    '{role}': `<@&${role.id}>`,
    '{duration}': formatDuration(rule),
  });
  await channel.send({ content: message, allowedMentions: { users: [member.id], roles: [role.id] } });
  return true;
}

async function applyProgressionToMember(member, section = getSection(member.guild.id)) {
  if (!member?.joinedAt) return { status: 'skipped', awarded: [], removed: [], announced: 0 };
  if (member.user?.bot && section.settings.includeBots !== true) return { status: 'skipped', awarded: [], removed: [], announced: 0 };
  const rules = listRules(member.guild.id).filter((rule) => rule.enabled);
  const progression = getMemberProgression(member, rules);
  const targetRules = section.settings.progressionMode === 'keep_all'
    ? progression.due
    : (progression.current ? [progression.current] : []);
  const targetRoleIds = new Set(targetRules.map((rule) => rule.roleId));
  const milestoneRoleIds = new Set(rules.map((rule) => rule.roleId));
  const awarded = [];
  const removed = [];
  let announced = 0;

  for (const rule of targetRules) {
    const role = await resolveRole(member.guild, rule.roleId);
    if (!canManageRole(member.guild, role)) throw new Error(`Goliath cannot manage role ${rule.roleId}.`);
    if (!member.roles.cache.has(role.id)) {
      await member.roles.add(role, `Goliath tenure milestone: ${formatDuration(rule)}`);
      awarded.push(rule.roleId);
      if (await announcePromotion(member, rule, role, section.settings).catch(() => false)) announced += 1;
    }
    for (const cleanupRoleId of rule.removeRoleIds) {
      if (!member.roles.cache.has(cleanupRoleId)) continue;
      const cleanupRole = await resolveRole(member.guild, cleanupRoleId);
      if (!canManageRole(member.guild, cleanupRole)) continue;
      await member.roles.remove(cleanupRole, `Goliath tenure progression to ${role.name}`);
      removed.push(cleanupRoleId);
    }
  }

  if (section.settings.progressionMode === 'highest_only') {
    for (const roleId of milestoneRoleIds) {
      if (targetRoleIds.has(roleId) || !member.roles.cache.has(roleId)) continue;
      const role = await resolveRole(member.guild, roleId);
      if (!canManageRole(member.guild, role)) continue;
      await member.roles.remove(role, 'Goliath highest-only tenure progression');
      removed.push(roleId);
    }
  }

  return {
    status: awarded.length || removed.length ? 'changed' : 'noop',
    awarded,
    removed: [...new Set(removed)],
    announced,
    progression,
  };
}

async function applyRuleToMember(member, rule) {
  const section = getSection(member.guild.id);
  const dueAt = eligibleAt(member.joinedAt, rule);
  if (!dueAt || Date.now() < dueAt.getTime()) return { status: 'not_due', awarded: false, removed: [], dueAt: dueAt?.toISOString() || null };
  const role = await resolveRole(member.guild, rule.roleId);
  if (!canManageRole(member.guild, role)) throw new Error(`Goliath cannot manage role ${rule.roleId}.`);
  let awarded = false;
  if (!member.roles.cache.has(role.id)) {
    await member.roles.add(role, `Goliath timed role milestone: ${formatDuration(rule)}`);
    awarded = true;
    await announcePromotion(member, rule, role, section.settings).catch(() => false);
  }
  return { status: awarded ? 'changed' : 'noop', awarded, removed: [], dueAt: dueAt.toISOString() };
}

function addAnalytics(guildId, patch, meta = {}) {
  return updateSection(guildId, (section) => {
    const analytics = { ...section.analytics };
    for (const [key, value] of Object.entries(patch)) analytics[key] = typeof value === 'number' ? Number(analytics[key] || 0) + value : value;
    return { ...section, analytics, updatedAt: now() };
  }, meta).analytics;
}
function shouldScanGuild(guildId, timestamp = Date.now()) {
  if (!guildManager.isModuleEnabled(guildId, SECTION)) return false;
  const section = getSection(guildId);
  const lastScan = new Date(section.analytics.lastScanAt || 0).getTime();
  if (!Number.isFinite(lastScan) || lastScan <= 0) return true;
  return timestamp - lastScan >= section.settings.scanIntervalMinutes * 60 * 1000;
}

async function simulateGuild(guild) {
  const section = getSection(guild.id);
  const members = await guild.members.fetch();
  const result = { membersChecked: 0, awards: 0, removals: 0, unchanged: 0, failed: 0, changes: [] };
  const rules = listRules(guild.id).filter((rule) => rule.enabled);
  for (const member of members.values()) {
    if (member.user?.bot && section.settings.includeBots !== true) continue;
    result.membersChecked += 1;
    try {
      const progression = getMemberProgression(member, rules);
      const target = section.settings.progressionMode === 'keep_all' ? progression.due : (progression.current ? [progression.current] : []);
      const targetIds = new Set(target.map((rule) => rule.roleId));
      const add = target.filter((rule) => !member.roles.cache.has(rule.roleId));
      const remove = section.settings.progressionMode === 'highest_only'
        ? rules.filter((rule) => member.roles.cache.has(rule.roleId) && !targetIds.has(rule.roleId))
        : [];
      if (add.length || remove.length) {
        result.awards += add.length;
        result.removals += remove.length;
        result.changes.push({ memberId: member.id, add: add.map((rule) => rule.roleId), remove: remove.map((rule) => rule.roleId) });
      } else result.unchanged += 1;
    } catch {
      result.failed += 1;
    }
  }
  addAnalytics(guild.id, { simulations: 1 });
  return result;
}

async function scanGuild(guild, meta = {}) {
  if (!guildManager.isModuleEnabled(guild.id, SECTION)) return { guildId: guild.id, disabled: true, rules: 0, membersChecked: 0, awarded: 0, removed: 0, announced: 0, skipped: 0, failed: 0 };
  const section = getSection(guild.id);
  const rules = listRules(guild.id).filter((rule) => rule.enabled);
  if (!rules.length) return { guildId: guild.id, rules: 0, membersChecked: 0, awarded: 0, removed: 0, announced: 0, skipped: 0, failed: 0 };
  const members = await guild.members.fetch();
  const result = { guildId: guild.id, rules: rules.length, membersChecked: 0, awarded: 0, removed: 0, announced: 0, skipped: 0, failed: 0 };
  const ruleStats = new Map(rules.map((rule) => [rule.ruleId, { awarded: 0, error: null }]));
  for (const member of members.values()) {
    if (member.user?.bot && section.settings.includeBots !== true) continue;
    result.membersChecked += 1;
    try {
      const applied = await applyProgressionToMember(member, section);
      result.awarded += applied.awarded.length;
      result.removed += applied.removed.length;
      result.announced += applied.announced;
      if (applied.progression.current && applied.awarded.includes(applied.progression.current.roleId)) {
        ruleStats.get(applied.progression.current.ruleId).awarded += 1;
      }
      if (applied.status === 'noop' || applied.status === 'skipped') result.skipped += 1;
    } catch (error) {
      result.failed += 1;
      for (const stat of ruleStats.values()) stat.error ||= error.message;
    }
  }
  const scannedAt = now();
  for (const rule of rules) {
    const stats = ruleStats.get(rule.ruleId);
    saveRule(guild.id, { ...rule, lastRunAt: scannedAt, lastAwarded: stats.awarded, lastError: stats.error }, meta);
  }
  addAnalytics(guild.id, {
    scans: 1,
    membersChecked: result.membersChecked,
    awarded: result.awarded,
    removed: result.removed,
    announced: result.announced,
    skipped: result.skipped,
    failed: result.failed,
    lastScanAt: scannedAt,
  }, meta);
  return result;
}

async function startup(client) {
  if (client.__goliathTimedRolesStarted) return null;
  client.__goliathTimedRolesStarted = true;
  sentinelScheduler.register({
    id: SCHEDULER_ID,
    module: SECTION,
    component: 'progression-scan',
    intervalMs: SCHEDULER_TICK_MS,
    staleAfterMs: Math.max(SCHEDULER_TICK_MS * 3, 180_000),
  });
  const run = async (force = false) => {
    const timestamp = Date.now();
    let scannedGuilds = 0;
    let guildFailures = 0;
    let memberFailures = 0;
    try {
      for (const guild of client.guilds.cache.values()) {
        if (!force && !shouldScanGuild(guild.id, timestamp)) continue;
        try {
          const result = await scanGuild(guild, { actorId: client.user?.id });
          scannedGuilds += 1;
          memberFailures += Number(result?.failed || 0);
        } catch (error) {
          guildFailures += 1;
          console.warn(`[TimedRoles] ${guild.id}: ${error.message}`);
        }
      }
      if (guildFailures > 0) {
        sentinelScheduler.fail(SCHEDULER_ID, new Error(`${guildFailures} guild timed-role scan(s) failed.`), { scannedGuilds, guildFailures, memberFailures });
      } else {
        sentinelScheduler.beat(SCHEDULER_ID, { scannedGuilds, guildFailures, memberFailures });
      }
      return { scannedGuilds, guildFailures, memberFailures };
    } catch (error) {
      sentinelScheduler.fail(SCHEDULER_ID, error, { scannedGuilds, guildFailures, memberFailures });
      throw error;
    }
  };
  await run(true);
  const timer = setInterval(() => {
    run(false).catch((error) => console.warn(`[TimedRoles] Scheduler failed: ${error.message}`));
  }, SCHEDULER_TICK_MS);
  timer.unref?.();
  return timer;
}

module.exports = {
  SECTION,
  UNITS,
  MODES,
  getSection,
  listRules,
  getRule,
  setEnabled,
  updateSettings,
  updateSection,
  recordAudit,
  saveRule,
  removeRule,
  eligibleAt,
  durationRank,
  formatDuration,
  getMemberProgression,
  setMemberMilestoneOverride,
  applyRuleToMember,
  applyProgressionToMember,
  shouldScanGuild,
  simulateGuild,
  scanGuild,
  startup,
  exportConfiguration: getSection,
  reset: (guildId, meta = {}) => saveSection(guildId, defaultSection(), meta),
};