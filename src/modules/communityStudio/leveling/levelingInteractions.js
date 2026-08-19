'use strict';

const leveling = require('./leveling');
const panel = require('./levelingPanel');
const tracking = require('./levelingTracking');
const { setModuleEnabled, getGuildFilePath } = require('../../../core/guild/guildManager');
const { getModuleSection } = require('../../../core/guild/moduleSectionManager');
const { createBackup } = require('../../../core/guild/fileStore');

const memberName = (interaction) => interaction.member?.displayName
  || interaction.user?.displayName
  || interaction.user?.username
  || 'Unknown User';

async function safeUpdate(interaction, payload) {
  if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
  else await interaction.update(payload);
  return true;
}

function numberField(interaction, id, { min = 0, max = Number.MAX_SAFE_INTEGER, integer = false } = {}) {
  const raw = interaction.fields.getTextInputValue(id).trim();
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${id} must be a valid number.`);
  const normalized = integer ? Math.round(value) : value;
  if (normalized < min || normalized > max) throw new Error(`${id} must be between ${min} and ${max}.`);
  return normalized;
}

function optionalField(interaction, id) {
  try {
    return interaction.fields.getTextInputValue(id).trim();
  } catch {
    return '';
  }
}

function refreshVoiceTracking(interaction) {
  try {
    tracking.refreshGuildVoiceSessions(interaction.guild);
  } catch (error) {
    console.error('[Leveling] Failed to refresh voice XP sessions:', error?.stack || error?.message || error);
  }
}

function createMaintenanceBackup(guildId, action) {
  const filePath = getGuildFilePath(guildId);
  return createBackup(filePath, `leveling-${String(action || 'maintenance').replace(/[^a-z0-9_-]/gi, '-')}`);
}

function appendMaintenanceLog(guildId, actorId, action, summary, backupPath = null) {
  const createdAt = new Date().toISOString();
  leveling.updateSection(guildId, (current) => ({
    ...current,
    maintenanceLog: [
      ...(Array.isArray(current.maintenanceLog) ? current.maintenanceLog : []),
      {
        maintenanceId: `${Date.now()}_${actorId}_${action}`,
        actorId,
        action,
        summary: String(summary || 'Completed.').slice(0, 1000),
        backupPath: backupPath || null,
        createdAt,
      },
    ].slice(-100),
    updatedAt: createdAt,
  }), { actorId, action: `leveling_maintenance_log_${action}` });
}

function expectedRewardIds(section, level) {
  const earned = tracking.earnedRewards(section, level);
  if (!earned.length) return new Set();
  if (section.removePreviousLevelRoles === true) return new Set([String(earned[earned.length - 1].roleId)]);
  return new Set(earned.map((reward) => String(reward.roleId)));
}

function isValidDiscordId(value) {
  return /^\d{15,25}$/.test(String(value || '').replace(/[<@&#!>]/g, '').trim());
}

function isInvalidNonNegativeNumber(value) {
  const number = Number(value);
  return !Number.isFinite(number) || number < 0;
}

function scanIntegrity(guild) {
  const raw = getModuleSection(guild.id, leveling.MODULE_KEY, leveling.defaults()) || {};
  const section = leveling.getSection(guild.id);
  const details = [];
  const addDetail = (text) => { if (details.length < 20) details.push(text); };
  let levelMismatch = 0;
  let duplicateUsers = 0;
  let invalidUserIds = 0;
  let invalidXpRecords = 0;
  let roleSyncIssues = 0;
  let invalidMultiplierSources = 0;
  let expiredMultiplier = 0;
  let multiplierIssues = 0;
  let analyticsIssues = 0;

  const rawIdsByBucket = { users: new Set(), pausedUsers: new Set() };
  for (const bucket of ['users', 'pausedUsers']) {
    const records = raw?.[bucket] && typeof raw[bucket] === 'object' && !Array.isArray(raw[bucket]) ? raw[bucket] : {};
    for (const [key, recordValue] of Object.entries(records)) {
      const record = recordValue && typeof recordValue === 'object' ? recordValue : {};
      const candidateId = record.userId || record.id || key;
      if (!isValidDiscordId(candidateId)) {
        invalidUserIds += 1;
        addDetail(`${bucket} contains an invalid Discord user ID at key \`${String(key).slice(0, 60)}\`.`);
        continue;
      }
      const userId = String(candidateId).replace(/[<@&#!>]/g, '').trim();
      rawIdsByBucket[bucket].add(userId);

      const badFields = ['xp', 'level', 'messages', 'voiceMinutes']
        .filter((field) => record[field] != null && isInvalidNonNegativeNumber(record[field]));
      if (badFields.length) {
        invalidXpRecords += 1;
        addDetail(`<@${userId}> has invalid ${badFields.join(', ')} value${badFields.length === 1 ? '' : 's'} in ${bucket}.`);
      }
    }
  }

  for (const userId of rawIdsByBucket.users) {
    if (rawIdsByBucket.pausedUsers.has(userId)) {
      duplicateUsers += 1;
      addDetail(`<@${userId}> exists in both active and paused Leveling records.`);
    }
  }

  for (const bucket of ['users', 'pausedUsers']) {
    for (const user of Object.values(section[bucket] || {})) {
      const expectedLevel = leveling.levelForXp(user.xp);
      if (Number(user.level || 0) !== expectedLevel) {
        levelMismatch += 1;
        addDetail(`<@${user.userId}> level ${user.level} should be ${expectedLevel} from ${Number(user.xp || 0).toLocaleString()} XP.`);
      }
    }
  }

  const missingRewards = leveling.getMissingLevelRewards(guild);
  for (const reward of missingRewards) addDetail(`Level ${reward.level} reward role ${reward.roleId} no longer exists.`);

  const allRewardIds = new Set((section.levelRewards || []).map((reward) => String(reward.roleId)));
  const combinedUsers = [
    ...Object.values(section.users || {}),
    ...Object.values(section.pausedUsers || {}),
  ];
  for (const user of combinedUsers) {
    const member = guild.members?.cache?.get?.(user.userId);
    if (!member?.roles?.cache || !allRewardIds.size) continue;
    const expected = expectedRewardIds(section, user.level);
    const actual = new Set([...member.roles.cache.keys()].filter((roleId) => allRewardIds.has(String(roleId))).map(String));
    const missing = [...expected].filter((roleId) => !actual.has(roleId));
    const extra = [...actual].filter((roleId) => !expected.has(roleId));
    if (missing.length || extra.length) {
      roleSyncIssues += 1;
      addDetail(`<@${user.userId}> reward roles need sync${missing.length ? ` · ${missing.length} missing` : ''}${extra.length ? ` · ${extra.length} extra` : ''}.`);
    }
  }

  const rawMultiplier = raw?.multiplier && typeof raw.multiplier === 'object' ? raw.multiplier : {};
  const rawValue = Number(rawMultiplier.value ?? 1);
  if (!Number.isFinite(rawValue) || rawValue < 1 || rawValue > 100) {
    multiplierIssues += 1;
    addDetail('XP multiplier value is invalid and will be normalized to a safe value.');
  }
  const validSources = new Set(Object.keys(section.xpSources || {}));
  const configuredSources = Array.isArray(rawMultiplier.sourceIds) ? rawMultiplier.sourceIds : [];
  invalidMultiplierSources = configuredSources.filter((sourceId) => !validSources.has(String(sourceId))).length;
  if (invalidMultiplierSources) {
    multiplierIssues += invalidMultiplierSources;
    addDetail(`${invalidMultiplierSources} multiplier source reference(s) no longer exist.`);
  }

  const parseDate = (value) => {
    if (!value) return null;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : NaN;
  };
  const startsAt = parseDate(rawMultiplier.startsAt);
  const endsAt = parseDate(rawMultiplier.endsAt);
  if (Number.isNaN(startsAt)) {
    multiplierIssues += 1;
    addDetail('XP multiplier start time is malformed.');
  }
  if (Number.isNaN(endsAt)) {
    multiplierIssues += 1;
    addDetail('XP multiplier end time is malformed.');
  }
  if (Number.isFinite(startsAt) && Number.isFinite(endsAt) && endsAt <= startsAt) {
    multiplierIssues += 1;
    addDetail('XP multiplier end time is not later than its start time.');
  }
  if (rawMultiplier.enabled === true && Number.isFinite(endsAt) && endsAt <= Date.now()) {
    expiredMultiplier = 1;
    multiplierIssues += 1;
    addDetail('An expired XP multiplier is still stored as enabled and can be cleaned up.');
  }

  const rawAnalytics = raw?.analytics && typeof raw.analytics === 'object' ? raw.analytics : {};
  for (const field of ['messagesTracked', 'voiceMinutesTracked', 'xpAwarded', 'levelUps']) {
    if (rawAnalytics[field] != null && isInvalidNonNegativeNumber(rawAnalytics[field])) {
      analyticsIssues += 1;
      addDetail(`Analytics field \`${field}\` contains an invalid value.`);
    }
  }
  const rawBySource = rawAnalytics.xpBySource && typeof rawAnalytics.xpBySource === 'object' && !Array.isArray(rawAnalytics.xpBySource)
    ? rawAnalytics.xpBySource
    : {};
  for (const [sourceId, amount] of Object.entries(rawBySource)) {
    if (isInvalidNonNegativeNumber(amount)) {
      analyticsIssues += 1;
      addDetail(`XP analytics source \`${String(sourceId).slice(0, 50)}\` contains an invalid value.`);
    }
  }

  const issueCount = levelMismatch
    + duplicateUsers
    + invalidUserIds
    + invalidXpRecords
    + missingRewards.length
    + roleSyncIssues
    + multiplierIssues
    + analyticsIssues;

  return {
    issueCount,
    levelMismatch,
    duplicateUsers,
    invalidUserIds,
    invalidXpRecords,
    missingRewards: missingRewards.length,
    roleSyncIssues,
    invalidMultiplierSources,
    expiredMultiplier,
    multiplierIssues,
    analyticsIssues,
    details,
  };
}

async function syncAllRewardRoles(guild) {
  const section = leveling.getSection(guild.id);
  const records = [
    ...Object.values(section.users || {}),
    ...Object.values(section.pausedUsers || {}),
  ];
  let synced = 0;
  let skipped = 0;
  for (const user of records) {
    const member = guild.members?.cache?.get?.(user.userId)
      || await guild.members?.fetch?.(user.userId).catch(() => null);
    if (!member) {
      skipped += 1;
      continue;
    }
    await syncManualRewardRoles(guild, user.userId, user.level);
    synced += 1;
  }
  return { synced, skipped };
}

async function recalculateAllLevels(guild, actorId) {
  const backupPath = createMaintenanceBackup(guild.id, 'recalculate-levels');
  let changed = 0;
  const createdAt = new Date().toISOString();
  leveling.updateSection(guild.id, (current) => {
    const next = { ...current };
    for (const bucket of ['users', 'pausedUsers']) {
      next[bucket] = { ...(current[bucket] || {}) };
      for (const [userId, record] of Object.entries(current[bucket] || {})) {
        const expectedLevel = leveling.levelForXp(record.xp);
        if (Number(record.level || 0) === expectedLevel) continue;
        changed += 1;
        next[bucket][userId] = leveling.normalizeUser({
          ...record,
          level: expectedLevel,
          history: leveling.appendHistory(record.history, {
            type: 'maintenance',
            source: 'recalculate',
            delta: 0,
            beforeXp: record.xp,
            afterXp: record.xp,
            beforeLevel: record.level,
            afterLevel: expectedLevel,
            actorId,
            reason: 'Bulk level recalculation from stored XP.',
            createdAt,
          }),
          updatedAt: createdAt,
        });
      }
    }
    return { ...next, updatedAt: createdAt };
  }, { actorId, action: 'leveling_maintenance_recalculate_levels' });
  const roleResult = await syncAllRewardRoles(guild);
  appendMaintenanceLog(guild.id, actorId, 'recalculate_levels', `Recalculated ${changed} member level(s). Reward roles synced for ${roleResult.synced}; ${roleResult.skipped} unavailable member(s) skipped.`, backupPath);
  return { changed, ...roleResult, backupPath };
}

async function rebuildRewardRoles(guild, actorId) {
  const backupPath = createMaintenanceBackup(guild.id, 'rebuild-reward-roles');
  const result = await syncAllRewardRoles(guild);
  appendMaintenanceLog(guild.id, actorId, 'rebuild_reward_roles', `Reward roles rebuilt for ${result.synced} member(s); ${result.skipped} unavailable member(s) skipped.`, backupPath);
  return { ...result, backupPath };
}

function rebuildLeaderboard(guild, actorId) {
  const backupPath = createMaintenanceBackup(guild.id, 'rebuild-leaderboard');
  const count = leveling.getLeaderboard(guild.id, 500, { includePaused: true, sortBy: 'xp' }).length;
  leveling.updateSection(guild.id, (current) => ({
    ...current,
    users: Object.fromEntries(Object.entries(current.users || {}).map(([id, user]) => [id, leveling.normalizeUser(user)])),
    pausedUsers: Object.fromEntries(Object.entries(current.pausedUsers || {}).map(([id, user]) => [id, leveling.normalizeUser(user)])),
    updatedAt: new Date().toISOString(),
  }), { actorId, action: 'leveling_maintenance_rebuild_leaderboard' });
  appendMaintenanceLog(guild.id, actorId, 'rebuild_leaderboard', `Validated and rebuilt the derived leaderboard from ${count} Leveling record(s).`, backupPath);
  return { count, backupPath };
}

async function repairIntegrity(guild, actorId) {
  const before = scanIntegrity(guild);
  const backupPath = createMaintenanceBackup(guild.id, 'integrity-repair');
  const createdAt = new Date().toISOString();
  const missingRoleIds = new Set(leveling.getMissingLevelRewards(guild).map((reward) => String(reward.roleId)));

  leveling.updateSection(guild.id, (current) => {
    const users = { ...(current.users || {}) };
    const pausedUsers = { ...(current.pausedUsers || {}) };

    for (const userId of Object.keys(users)) {
      if (!pausedUsers[userId]) continue;
      const active = users[userId];
      const paused = pausedUsers[userId];
      const winner = Number(paused.xp || 0) >= Number(active.xp || 0) ? paused : active;
      pausedUsers[userId] = leveling.normalizeUser({
        ...winner,
        userId,
        messages: Math.max(Number(active.messages || 0), Number(paused.messages || 0)),
        voiceMinutes: Math.max(Number(active.voiceMinutes || 0), Number(paused.voiceMinutes || 0)),
        updatedAt: createdAt,
      });
      delete users[userId];
    }

    for (const bucket of [users, pausedUsers]) {
      for (const [userId, record] of Object.entries(bucket)) {
        const expectedLevel = leveling.levelForXp(record.xp);
        bucket[userId] = leveling.normalizeUser({ ...record, userId, level: expectedLevel, updatedAt: createdAt });
      }
    }

    const validSources = new Set(Object.keys(current.xpSources || {}));
    const multiplier = { ...(current.multiplier || {}) };
    multiplier.sourceIds = (Array.isArray(multiplier.sourceIds) ? multiplier.sourceIds : []).filter((sourceId) => validSources.has(String(sourceId)));
    const endsAt = multiplier.endsAt ? new Date(multiplier.endsAt).getTime() : null;
    if (multiplier.enabled && Number.isFinite(endsAt) && endsAt <= Date.now()) {
      multiplier.enabled = false;
      multiplier.value = 1;
      multiplier.name = null;
      multiplier.sourceIds = [];
      multiplier.startsAt = null;
      multiplier.endsAt = null;
    }

    const levelRewards = (current.levelRewards || []).filter((reward) => !missingRoleIds.has(String(reward.roleId)));
    return {
      ...current,
      users,
      pausedUsers,
      multiplier,
      levelRewards,
      levelRoleIds: levelRewards.map((reward) => reward.roleId),
      updatedAt: createdAt,
    };
  }, { actorId, action: 'leveling_maintenance_integrity_repair' });

  const roleResult = await syncAllRewardRoles(guild);
  const after = scanIntegrity(guild);
  appendMaintenanceLog(
    guild.id,
    actorId,
    'integrity_repair',
    `Integrity repair completed: ${before.issueCount} issue(s) before, ${after.issueCount} remaining. Reward roles synced for ${roleResult.synced}; ${roleResult.skipped} unavailable member(s) skipped.`,
    backupPath,
  );
  return { before, after, roleResult, backupPath };
}

function applyManualProgressChange(guildId, userId, action, value, reason, actorId) {
  const createdAt = new Date().toISOString();
  let result = null;
  leveling.updateSection(guildId, (current) => {
    const paused = Boolean(current.pausedUsers?.[userId]);
    const bucket = paused ? 'pausedUsers' : 'users';
    const otherBucket = paused ? 'users' : 'pausedUsers';
    const existing = current[bucket]?.[userId]
      || current[otherBucket]?.[userId]
      || leveling.normalizeUser({ userId });
    const before = {
      xp: Math.max(0, Number(existing.xp || 0)),
      level: Math.max(0, Number(existing.level || 0)),
      messages: Math.max(0, Number(existing.messages || 0)),
      voiceMinutes: Math.max(0, Number(existing.voiceMinutes || 0)),
    };

    let nextXp = before.xp;
    let nextMessages = before.messages;
    let nextVoiceMinutes = before.voiceMinutes;
    let clearActivity = false;

    if (action === 'add') nextXp = before.xp + Math.max(0, Number(value || 0));
    else if (action === 'remove') nextXp = Math.max(0, before.xp - Math.max(0, Number(value || 0)));
    else if (action === 'setxp') nextXp = Math.max(0, Number(value || 0));
    else if (action === 'setlevel') nextXp = leveling.xpForLevel(Math.max(0, Number(value || 0)));
    else if (action === 'reset') {
      nextXp = 0;
      nextMessages = 0;
      nextVoiceMinutes = 0;
      clearActivity = true;
    } else throw new Error(`Unsupported XP management action: ${action}`);

    const nextLevel = leveling.levelForXp(nextXp);
    const history = leveling.appendHistory(existing.history, {
      type: action === 'reset' ? 'reset' : 'manual',
      source: leveling.XP_SOURCES.MANUAL,
      delta: nextXp - before.xp,
      beforeXp: before.xp,
      afterXp: nextXp,
      beforeLevel: before.level,
      afterLevel: nextLevel,
      actorId,
      reason,
      createdAt,
    });
    const updatedUser = leveling.normalizeUser({
      ...existing,
      userId,
      xp: nextXp,
      level: nextLevel,
      messages: nextMessages,
      voiceMinutes: nextVoiceMinutes,
      lastMessageXpAt: clearActivity ? null : existing.lastMessageXpAt,
      lastVoiceXpAt: clearActivity ? null : existing.lastVoiceXpAt,
      lastXpAt: clearActivity ? null : createdAt,
      lastXpSource: clearActivity ? null : leveling.XP_SOURCES.MANUAL,
      history,
      updatedAt: createdAt,
    });

    const users = { ...(current.users || {}) };
    const pausedUsers = { ...(current.pausedUsers || {}) };
    if (paused) {
      pausedUsers[userId] = updatedUser;
      delete users[userId];
    } else {
      users[userId] = updatedUser;
      delete pausedUsers[userId];
    }

    const auditEntry = {
      auditId: `${Date.now()}_${actorId}_${userId}`,
      action,
      userId,
      actorId,
      reason: String(reason || '').slice(0, 500),
      value: Number.isFinite(Number(value)) ? Number(value) : null,
      before,
      after: {
        xp: updatedUser.xp,
        level: updatedUser.level,
        messages: updatedUser.messages,
        voiceMinutes: updatedUser.voiceMinutes,
      },
      createdAt,
    };

    const auditLog = [...(Array.isArray(current.auditLog) ? current.auditLog : []), auditEntry].slice(-200);
    const manualAward = action === 'add' ? Math.max(0, updatedUser.xp - before.xp) : 0;
    const analytics = {
      ...(current.analytics || {}),
      xpAwarded: Number(current.analytics?.xpAwarded || 0) + manualAward,
      xpBySource: {
        ...(current.analytics?.xpBySource || {}),
        [leveling.XP_SOURCES.MANUAL]: Number(current.analytics?.xpBySource?.[leveling.XP_SOURCES.MANUAL] || 0) + manualAward,
      },
    };

    result = { user: updatedUser, before, after: auditEntry.after, paused, auditEntry };
    return { ...current, users, pausedUsers, auditLog, analytics, updatedAt: createdAt };
  }, { actorId, action: `leveling_manual_${action}` });
  return result;
}

async function syncManualRewardRoles(guild, userId, newLevel) {
  const member = guild?.members?.cache?.get?.(userId)
    || await guild?.members?.fetch?.(userId).catch(() => null);
  if (!member?.roles?.cache) return false;
  const section = leveling.getSection(guild.id);
  const earned = tracking.earnedRewards(section, newLevel);
  const earnedIds = expectedRewardIds(section, newLevel);
  const allRewardIds = new Set((section.levelRewards || []).map((reward) => String(reward.roleId)));
  const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);

  if (botMember?.roles?.highest && member.roles?.remove) {
    const removeRoles = [...member.roles.cache.values()]
      .filter((role) => allRewardIds.has(String(role.id)) && !earnedIds.has(String(role.id)))
      .filter((role) => !role.managed && role.position < botMember.roles.highest.position);
    if (removeRoles.length) {
      await member.roles.remove(removeRoles, `Goliath leveling sync to level ${newLevel}`).catch(() => null);
    }
  }

  if (earned.length) await tracking.assignLevelRole(member, section, newLevel).catch(() => null);
  return true;
}

async function handleLevelingInteraction(interaction) {
  const customId = String(interaction?.customId || '');
  if (!customId.startsWith('admin:leveling')) return false;
  const displayName = memberName(interaction);

  try {
    if (customId === 'admin:leveling') {
      return safeUpdate(interaction, panel.buildLevelingPanel(interaction.guild, displayName));
    }
    if (customId === 'admin:leveling:xpmanage') {
      return safeUpdate(interaction, panel.buildXpManagerPanel(interaction.guild, displayName));
    }
    if (customId === 'admin:leveling:xpmanage:audit') {
      return safeUpdate(interaction, panel.buildXpAuditPanel(interaction.guild, displayName));
    }
    if (customId === 'admin:leveling:maintenance') {
      return safeUpdate(interaction, panel.buildMaintenancePanel(interaction.guild, displayName));
    }
    if (customId === 'admin:leveling:maintenance:scan') {
      const report = scanIntegrity(interaction.guild);
      return safeUpdate(interaction, panel.buildMaintenancePanel(interaction.guild, displayName, report));
    }
    if (customId === 'admin:leveling:maintenance:preview') {
      const report = scanIntegrity(interaction.guild);
      return safeUpdate(interaction, panel.buildIntegrityPreviewPanel(interaction.guild, displayName, report));
    }
    if (customId === 'admin:leveling:maintenance:log') {
      return safeUpdate(interaction, panel.buildMaintenanceLogPanel(interaction.guild, displayName));
    }
    if (customId === 'admin:leveling:maintenance:recalculate') {
      if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();
      const result = await recalculateAllLevels(interaction.guild, interaction.user.id);
      await interaction.followUp({ content: `✅ Recalculated **${result.changed}** level record(s) and synced rewards for **${result.synced}** member(s). A pre-task backup was created.`, flags: 64 }).catch(() => null);
      return safeUpdate(interaction, panel.buildMaintenancePanel(interaction.guild, displayName, scanIntegrity(interaction.guild)));
    }
    if (customId === 'admin:leveling:maintenance:rewards') {
      if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();
      const result = await rebuildRewardRoles(interaction.guild, interaction.user.id);
      await interaction.followUp({ content: `✅ Rebuilt reward roles for **${result.synced}** member(s); **${result.skipped}** unavailable member(s) skipped. A pre-task backup was created.`, flags: 64 }).catch(() => null);
      return safeUpdate(interaction, panel.buildMaintenancePanel(interaction.guild, displayName, scanIntegrity(interaction.guild)));
    }
    if (customId === 'admin:leveling:maintenance:leaderboard') {
      const result = rebuildLeaderboard(interaction.guild, interaction.user.id);
      if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();
      await interaction.followUp({ content: `✅ Rebuilt and validated the derived leaderboard from **${result.count}** Leveling record(s). A pre-task backup was created.`, flags: 64 }).catch(() => null);
      return safeUpdate(interaction, panel.buildMaintenancePanel(interaction.guild, displayName, scanIntegrity(interaction.guild)));
    }
    if (customId === 'admin:leveling:maintenance:repair') {
      if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();
      const result = await repairIntegrity(interaction.guild, interaction.user.id);
      await interaction.followUp({ content: `🩹 Integrity repair complete: **${result.before.issueCount}** issue(s) before, **${result.after.issueCount}** remaining. A pre-repair backup was created.`, flags: 64 }).catch(() => null);
      return safeUpdate(interaction, panel.buildIntegrityPreviewPanel(interaction.guild, displayName, result.after));
    }
    if (interaction.isUserSelectMenu?.() && customId === 'admin:leveling:xpmanage:select') {
      const userId = String(interaction.values?.[0] || '');
      if (!/^\d{15,25}$/.test(userId)) throw new Error('Select a valid Discord member.');
      return safeUpdate(interaction, panel.buildXpMemberPanel(interaction.guild, userId, displayName));
    }
    const xpMemberMatch = customId.match(/^admin:leveling:xpmanage:member:(\d{15,25})$/);
    if (xpMemberMatch) {
      return safeUpdate(interaction, panel.buildXpMemberPanel(interaction.guild, xpMemberMatch[1], displayName));
    }
    const xpHistoryMatch = customId.match(/^admin:leveling:xpmanage:history:(\d{15,25})$/);
    if (xpHistoryMatch) {
      return safeUpdate(interaction, panel.buildMemberXpHistoryPanel(interaction.guild, xpHistoryMatch[1], displayName));
    }
    const xpActionMatch = customId.match(/^admin:leveling:xpmanage:(add|remove|setxp|setlevel|reset):(\d{15,25})$/);
    if (xpActionMatch && interaction.isButton?.()) {
      const action = xpActionMatch[1];
      const userId = xpActionMatch[2];
      const user = leveling.getUser(interaction.guildId, userId) || leveling.normalizeUser({ userId });
      await interaction.showModal(panel.buildXpActionModal(action, userId, user));
      return true;
    }
    const xpSubmitMatch = customId.match(/^admin:leveling:xpmanage:(add|remove|setxp|setlevel|reset):submit:(\d{15,25})$/);
    if (xpSubmitMatch && interaction.isModalSubmit?.()) {
      const action = xpSubmitMatch[1];
      const userId = xpSubmitMatch[2];
      const reason = interaction.fields.getTextInputValue('reason').trim();
      if (reason.length < 3) throw new Error('A reason of at least 3 characters is required.');

      let value = 0;
      if (action === 'reset') {
        const confirmation = interaction.fields.getTextInputValue('value').trim().toUpperCase();
        if (confirmation !== 'RESET') throw new Error('Type RESET exactly to confirm the member reset.');
      } else if (action === 'setlevel') {
        value = numberField(interaction, 'value', { min: 0, max: 100000, integer: true });
      } else if (action === 'setxp') {
        value = numberField(interaction, 'value', { min: 0, max: Number.MAX_SAFE_INTEGER, integer: true });
      } else {
        value = numberField(interaction, 'value', { min: 1, max: Number.MAX_SAFE_INTEGER, integer: true });
      }

      const result = applyManualProgressChange(
        interaction.guildId,
        userId,
        action,
        value,
        reason,
        interaction.user.id,
      );
      await syncManualRewardRoles(interaction.guild, userId, result.user.level);
      if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();
      await interaction.followUp({
        content: `✅ Updated <@${userId}>: **${result.before.xp.toLocaleString()} XP / Lv ${result.before.level}** → **${result.after.xp.toLocaleString()} XP / Lv ${result.after.level}**.`,
        flags: 64,
      }).catch(() => null);
      return safeUpdate(interaction, panel.buildXpMemberPanel(interaction.guild, userId, displayName));
    }
    if (customId === 'admin:leveling:multiplier') {
      return safeUpdate(interaction, panel.buildMultiplierManagerPanel(interaction.guild, displayName));
    }
    if (customId === 'admin:leveling:leaderboard') {
      return safeUpdate(interaction, panel.buildLeaderboardPanel(interaction.guild, displayName, 0, 'xp'));
    }
    const leaderboardMatch = customId.match(/^admin:leveling:leaderboard:(xp|level|messages|voice):(\d+)$/);
    if (leaderboardMatch) {
      return safeUpdate(interaction, panel.buildLeaderboardPanel(
        interaction.guild,
        displayName,
        Number(leaderboardMatch[2]),
        leaderboardMatch[1],
      ));
    }
    if (customId === 'admin:leveling:trackingRules') {
      return safeUpdate(interaction, panel.buildTrackingRulesPanel(interaction.guild, displayName));
    }
    if (customId === 'admin:leveling:ranks') {
      return safeUpdate(interaction, panel.buildRankRewardsPanel(interaction.guild, displayName));
    }
    if (customId === 'admin:leveling:ranks:add') {
      return safeUpdate(interaction, panel.buildAddRewardsPanel(interaction.guild, displayName));
    }
    if (customId === 'admin:leveling:ranks:manage') {
      return safeUpdate(interaction, panel.buildManageRewardsPanel(interaction.guild, displayName));
    }
    if (customId === 'admin:leveling:ranks:preview') {
      return safeUpdate(interaction, panel.buildRewardsPreviewPanel(interaction.guild, displayName));
    }
    const rewardViewMatch = customId.match(/^admin:leveling:ranks:view:(\d+)$/);
    if (rewardViewMatch) {
      return safeUpdate(interaction, panel.buildRewardDetailPanel(interaction.guild, Number(rewardViewMatch[1]), displayName));
    }
    const rewardDeleteMatch = customId.match(/^admin:leveling:ranks:delete:(\d+)$/);
    if (rewardDeleteMatch) {
      return safeUpdate(interaction, panel.buildDeleteRewardConfirmPanel(interaction.guild, Number(rewardDeleteMatch[1]), displayName));
    }
    const rewardEditMatch = customId.match(/^admin:leveling:ranks:edit:(\d+)$/);
    if (rewardEditMatch && interaction.isButton?.()) {
      const reward = leveling.getLevelRewards(interaction.guildId)
        .find((entry) => Number(entry.level) === Number(rewardEditMatch[1]));
      if (!reward) throw new Error('That level reward no longer exists.');
      await interaction.showModal(panel.buildEditRewardModal(reward));
      return true;
    }
    if (customId === 'admin:leveling:configureMessage' && interaction.isButton?.()) {
      await interaction.showModal(panel.buildMessageXpModal(leveling.getSection(interaction.guildId)));
      return true;
    }
    if (customId === 'admin:leveling:configureVoice' && interaction.isButton?.()) {
      await interaction.showModal(panel.buildVoiceXpModal(leveling.getSection(interaction.guildId)));
      return true;
    }
    if (customId === 'admin:leveling:configureMultiplier' && interaction.isButton?.()) {
      await interaction.showModal(panel.buildMultiplierModal(leveling.getSection(interaction.guildId)));
      return true;
    }
    if (customId === 'admin:leveling:configureRankLevels' && interaction.isButton?.()) {
      await interaction.showModal(panel.buildRankLevelsModal(leveling.getSection(interaction.guildId)));
      return true;
    }

    const save = (updater) => leveling.updateSection(interaction.guildId, updater, {
      actorId: interaction.user.id,
      action: customId,
    });

    if (interaction.isRoleSelectMenu?.() && customId === 'admin:leveling:ranks:add:roles') {
      const roleIds = [...new Set(interaction.values || [])];
      if (!roleIds.length) throw new Error('Select at least one reward role.');
      await interaction.showModal(panel.buildAddRewardLevelsModal(roleIds));
      return true;
    }

    const addLevelsMatch = customId.match(/^admin:leveling:ranks:add:levels:([0-9.]+)$/);
    if (interaction.isModalSubmit?.() && addLevelsMatch) {
      const roleIds = addLevelsMatch[1].split('.').filter(Boolean);
      const levels = interaction.fields.getTextInputValue('levels')
        .split(',')
        .map((entry) => Number(entry.trim()))
        .filter((value) => Number.isFinite(value))
        .map((value) => Math.round(value));
      if (levels.length !== roleIds.length) throw new Error(`Enter exactly ${roleIds.length} level value(s).`);
      if (levels.some((level) => level < 1 || level > 100000)) throw new Error('Reward levels must be between 1 and 100000.');
      if (new Set(levels).size !== levels.length) throw new Error('Each selected reward must use a unique level.');
      const existingLevels = new Set(leveling.getLevelRewards(interaction.guildId).map((reward) => Number(reward.level)));
      const conflicts = levels.filter((level) => existingLevels.has(level));
      if (conflicts.length) throw new Error(`Reward level(s) already exist: ${conflicts.join(', ')}`);
      leveling.addLevelRewards(interaction.guildId, roleIds.map((roleId, index) => ({
        roleId,
        level: levels[index],
      })), { actorId: interaction.user.id, action: customId });
      return safeUpdate(interaction, panel.buildRankRewardsPanel(interaction.guild, displayName));
    }

    if (interaction.isStringSelectMenu?.() && customId === 'admin:leveling:ranks:select') {
      const level = Number(interaction.values?.[0]);
      return safeUpdate(interaction, panel.buildRewardDetailPanel(interaction.guild, level, displayName));
    }

    const editSubmitMatch = customId.match(/^admin:leveling:ranks:edit:(\d+):submit$/);
    if (interaction.isModalSubmit?.() && editSubmitMatch) {
      const oldLevel = Number(editSubmitMatch[1]);
      const level = numberField(interaction, 'level', { min: 1, max: 100000, integer: true });
      const roleId = interaction.fields.getTextInputValue('roleId').replace(/[<@&>]/g, '').trim();
      const label = optionalField(interaction, 'label');
      if (!/^\d{15,25}$/.test(roleId)) throw new Error('roleId must be a valid Discord role ID.');
      const conflict = leveling.getLevelRewards(interaction.guildId)
        .some((reward) => Number(reward.level) === level && Number(reward.level) !== oldLevel);
      if (conflict) throw new Error(`A reward already exists at level ${level}.`);
      leveling.updateLevelReward(interaction.guildId, oldLevel, { level, roleId, label }, {
        actorId: interaction.user.id,
        action: customId,
      });
      return safeUpdate(interaction, panel.buildRewardDetailPanel(interaction.guild, level, displayName));
    }

    const deleteConfirmMatch = customId.match(/^admin:leveling:ranks:delete:(\d+):confirm$/);
    if (deleteConfirmMatch) {
      leveling.deleteLevelReward(interaction.guildId, Number(deleteConfirmMatch[1]), {
        actorId: interaction.user.id,
        action: customId,
      });
      return safeUpdate(interaction, panel.buildManageRewardsPanel(interaction.guild, displayName));
    }

    if (customId === 'admin:leveling:ranks:behaviour') {
      const current = leveling.getRewardBehaviour(interaction.guildId);
      const next = current === leveling.REWARD_BEHAVIOURS.HIGHEST_ONLY
        ? leveling.REWARD_BEHAVIOURS.STACK
        : leveling.REWARD_BEHAVIOURS.HIGHEST_ONLY;
      leveling.setRewardBehaviour(interaction.guildId, next, {
        actorId: interaction.user.id,
        action: customId,
      });
      return safeUpdate(interaction, panel.buildRankRewardsPanel(interaction.guild, displayName));
    }

    if (customId === 'admin:leveling:ranks:repair') {
      const backupPath = createMaintenanceBackup(interaction.guildId, 'repair-missing-rewards');
      const result = leveling.repairMissingLevelRewards(interaction.guild, {
        actorId: interaction.user.id,
        action: customId,
      });
      appendMaintenanceLog(interaction.guildId, interaction.user.id, 'repair_missing_rewards', `Removed ${result.removed} missing reward mapping(s).`, backupPath);
      if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();
      await interaction.followUp({
        content: result.removed
          ? `🩹 Removed ${result.removed} missing reward mapping${result.removed === 1 ? '' : 's'}. A backup was created first.`
          : '✅ No missing level reward roles were found.',
        flags: 64,
      }).catch(() => null);
      return safeUpdate(interaction, panel.buildRankRewardsPanel(interaction.guild, displayName));
    }

    if (interaction.isModalSubmit?.() && customId === 'admin:leveling:configureMessage:submit') {
      const amount = numberField(interaction, 'amount', { min: 1, max: 100000, integer: true });
      const cooldownSeconds = numberField(interaction, 'cooldown', { min: 0, max: 86400, integer: true });
      const description = optionalField(interaction, 'description');
      leveling.setXpSource(interaction.guildId, 'message', {
        amount,
        cooldownSeconds,
        description: description || 'Earn XP for eligible server messages.',
      }, { actorId: interaction.user.id, action: customId });
    } else if (interaction.isModalSubmit?.() && customId === 'admin:leveling:configureVoice:submit') {
      const amount = numberField(interaction, 'amount', { min: 1, max: 100000, integer: true });
      const intervalMinutes = numberField(interaction, 'interval', { min: 1, max: 1440, integer: true });
      const description = optionalField(interaction, 'description');
      leveling.setXpSource(interaction.guildId, 'voice', {
        amount,
        intervalMinutes,
        description: description || 'Earn XP for eligible time spent in voice channels.',
      }, { actorId: interaction.user.id, action: customId });
      refreshVoiceTracking(interaction);
    } else if (interaction.isModalSubmit?.() && customId === 'admin:leveling:configureMultiplier:submit') {
      const name = interaction.fields.getTextInputValue('name').trim();
      const value = numberField(interaction, 'value', { min: 1.01, max: 100 });
      const startDelayMinutes = numberField(interaction, 'startDelay', { min: 0, max: 525600, integer: true });
      const durationMinutes = numberField(interaction, 'duration', { min: 1, max: 525600, integer: true });
      const rawSources = interaction.fields.getTextInputValue('sources').trim();
      const sourceIds = /^all$/i.test(rawSources)
        ? []
        : [...new Set(rawSources.split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean))];
      const validSources = new Set(Object.keys(leveling.getSection(interaction.guildId).xpSources));
      const invalid = sourceIds.filter((sourceId) => !validSources.has(sourceId));
      if (invalid.length) throw new Error(`Unknown XP source(s): ${invalid.join(', ')}`);
      const startsAt = new Date(Date.now() + startDelayMinutes * 60000);
      const endsAt = new Date(startsAt.getTime() + durationMinutes * 60000);
      leveling.setMultiplier(interaction.guildId, {
        enabled: true,
        name: name || 'XP Event',
        value,
        sourceIds,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      }, { actorId: interaction.user.id, action: customId });
      return safeUpdate(interaction, panel.buildMultiplierManagerPanel(interaction.guild, displayName));
    } else if (interaction.isModalSubmit?.() && customId === 'admin:leveling:configureRankLevels:submit') {
      const section = leveling.getSection(interaction.guildId);
      const roles = section.levelRewards.map((reward) => reward.roleId);
      const levels = interaction.fields.getTextInputValue('levels')
        .split(',')
        .map((entry) => Number(entry.trim()))
        .filter((value) => Number.isFinite(value))
        .map((value) => Math.round(value));
      if (!roles.length) throw new Error('Choose at least one rank reward role first.');
      if (levels.length !== roles.length) throw new Error(`Enter exactly ${roles.length} level value(s), one for each selected role.`);
      if (levels.some((level) => level < 1 || level > 100000)) throw new Error('Rank levels must be between 1 and 100000.');
      if (new Set(levels).size !== levels.length) throw new Error('Each rank reward must use a unique level.');
      leveling.setLevelRewards(interaction.guildId, roles.map((roleId, index) => ({
        roleId,
        level: levels[index],
      })), { actorId: interaction.user.id, action: customId });
      return safeUpdate(interaction, panel.buildRankRewardsPanel(interaction.guild, displayName));
    } else if (interaction.isChannelSelectMenu?.() && customId === 'admin:leveling:announceChannel') {
      save((section) => ({ ...section, announceChannelId: interaction.values?.[0] || null }));
    } else if (interaction.isRoleSelectMenu?.() && customId === 'admin:leveling:managerRoles') {
      save((section) => ({ ...section, managerRoleIds: [...new Set(interaction.values || [])] }));
    } else if (interaction.isChannelSelectMenu?.() && customId === 'admin:leveling:ignoredChannels') {
      save((section) => ({ ...section, ignoredChannelIds: [...new Set(interaction.values || [])] }));
      refreshVoiceTracking(interaction);
      return safeUpdate(interaction, panel.buildTrackingRulesPanel(interaction.guild, displayName));
    } else if (interaction.isRoleSelectMenu?.() && customId === 'admin:leveling:ignoredRoles') {
      save((section) => ({ ...section, ignoredRoleIds: [...new Set(interaction.values || [])] }));
      refreshVoiceTracking(interaction);
      return safeUpdate(interaction, panel.buildTrackingRulesPanel(interaction.guild, displayName));
    } else if (interaction.isRoleSelectMenu?.() && customId === 'admin:leveling:levelRoles') {
      const selected = [...new Set(interaction.values || [])];
      const current = leveling.getSection(interaction.guildId).levelRewards;
      leveling.setLevelRewards(interaction.guildId, selected.map((roleId, index) => ({
        level: current[index]?.level || index + 1,
        roleId,
      })), {
        actorId: interaction.user.id,
        action: customId,
      });
      return safeUpdate(interaction, panel.buildRankRewardsPanel(interaction.guild, displayName));
    } else if (customId === 'admin:leveling:enable') {
      setModuleEnabled(interaction.guildId, 'leveling', true, { actorId: interaction.user.id, action: customId });
      refreshVoiceTracking(interaction);
    } else if (customId === 'admin:leveling:disable') {
      setModuleEnabled(interaction.guildId, 'leveling', false, { actorId: interaction.user.id, action: customId });
      refreshVoiceTracking(interaction);
    } else if (customId === 'admin:leveling:toggleMessages') {
      const current = leveling.getSection(interaction.guildId).xpSources.message;
      leveling.setXpSource(interaction.guildId, 'message', { enabled: !current.enabled }, { actorId: interaction.user.id, action: customId });
    } else if (customId === 'admin:leveling:toggleVoice') {
      const current = leveling.getSection(interaction.guildId).xpSources.voice;
      leveling.setXpSource(interaction.guildId, 'voice', { enabled: !current.enabled }, { actorId: interaction.user.id, action: customId });
      refreshVoiceTracking(interaction);
    } else if (customId === 'admin:leveling:toggleAnnounce') {
      save((section) => ({ ...section, announceLevelUps: !section.announceLevelUps }));
    } else if (customId === 'admin:leveling:toggleRemovePrevious') {
      const next = leveling.getRewardBehaviour(interaction.guildId) === leveling.REWARD_BEHAVIOURS.HIGHEST_ONLY
        ? leveling.REWARD_BEHAVIOURS.STACK
        : leveling.REWARD_BEHAVIOURS.HIGHEST_ONLY;
      leveling.setRewardBehaviour(interaction.guildId, next, { actorId: interaction.user.id, action: customId });
      return safeUpdate(interaction, panel.buildRankRewardsPanel(interaction.guild, displayName));
    } else if (customId === 'admin:leveling:stopMultiplier') {
      leveling.clearMultiplier(interaction.guildId, { actorId: interaction.user.id, action: customId });
      return safeUpdate(interaction, panel.buildMultiplierManagerPanel(interaction.guild, displayName));
    } else {
      return false;
    }

    return safeUpdate(interaction, panel.buildLevelingPanel(interaction.guild, displayName));
  } catch (error) {
    const payload = { content: `❌ Leveling setup failed: ${error.message}`, flags: 64 };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => null);
    else await interaction.reply(payload).catch(() => null);
    return true;
  }
}

module.exports = {
  handleLevelingInteraction,
  scanIntegrity,
  recalculateAllLevels,
  rebuildRewardRoles,
  rebuildLeaderboard,
  repairIntegrity,
};
