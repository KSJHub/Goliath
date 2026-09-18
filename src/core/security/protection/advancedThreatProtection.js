'use strict';

const { AuditLogEvent, PermissionFlagsBits } = require('discord.js');
const guildManager = require('../../guild/guildManager');
const securitySystem = require('./system');
const antiNuke = require('./antiNuke');
const { disableInvites, freezeRoles } = require('./emergencyControls');

const SESSION_WINDOW_MS = 60_000;
const MAX_SESSION_EVENTS = 25;
const sessions = new Map();

const EVENT_RULES = new Map([
  [AuditLogEvent.MemberBanAdd, { type: 'member_ban', weight: 35, targetType: 'member' }],
  [AuditLogEvent.MemberKick, { type: 'member_kick', weight: 30, targetType: 'member' }],
  [AuditLogEvent.BotAdd, { type: 'bot_add', weight: 70, targetType: 'bot' }],
  [AuditLogEvent.MemberRoleUpdate, { type: 'member_role_update', weight: 25, targetType: 'member' }],
  [AuditLogEvent.GuildUpdate, { type: 'guild_update', weight: 45, targetType: 'guild' }],
  [AuditLogEvent.IntegrationCreate, { type: 'integration_create', weight: 45, targetType: 'integration' }],
  [AuditLogEvent.IntegrationUpdate, { type: 'integration_update', weight: 40, targetType: 'integration' }],
  [AuditLogEvent.IntegrationDelete, { type: 'integration_delete', weight: 50, targetType: 'integration' }],
  [AuditLogEvent.ChannelCreate, { type: 'channel_create', weight: 15, targetType: 'channel', correlationOnly: true }],
  [AuditLogEvent.ChannelDelete, { type: 'channel_delete', weight: 25, targetType: 'channel', correlationOnly: true }],
  [AuditLogEvent.RoleCreate, { type: 'role_create', weight: 15, targetType: 'role', correlationOnly: true }],
  [AuditLogEvent.RoleDelete, { type: 'role_delete', weight: 25, targetType: 'role', correlationOnly: true }],
  [AuditLogEvent.RoleUpdate, { type: 'role_update', weight: 20, targetType: 'role', correlationOnly: true }],
  [AuditLogEvent.ChannelOverwriteCreate, { type: 'channel_overwrite_create', weight: 35, targetType: 'channel' }],
  [AuditLogEvent.ChannelOverwriteUpdate, { type: 'channel_overwrite_update', weight: 40, targetType: 'channel' }],
  [AuditLogEvent.ChannelOverwriteDelete, { type: 'channel_overwrite_delete', weight: 45, targetType: 'channel' }],
  [AuditLogEvent.MemberPrune, { type: 'member_prune', weight: 80, targetType: 'guild' }],
  [AuditLogEvent.InviteDelete, { type: 'invite_delete', weight: 25, targetType: 'invite' }],
  [AuditLogEvent.AutoModerationRuleCreate, { type: 'automod_rule_create', weight: 30, targetType: 'automod_rule' }],
  [AuditLogEvent.AutoModerationRuleUpdate, { type: 'automod_rule_update', weight: 35, targetType: 'automod_rule' }],
  [AuditLogEvent.AutoModerationRuleDelete, { type: 'automod_rule_delete', weight: 45, targetType: 'automod_rule' }],
].filter(([action]) => action !== undefined));

function sessionKey(guildId, actorId) {
  return `${guildId}:${actorId}`;
}

function cleanIdArray(value) {
  return Array.isArray(value)
    ? [...new Set(value.map((id) => String(id || '').trim()).filter((id) => /^\d{15,25}$/.test(id)))]
    : [];
}

function getProtectedAssets(guild) {
  const saved = guildManager.getGuildSection(guild.id, 'antiNuke', {}) || {};
  const protectedAssets = saved.protectedAssets && typeof saved.protectedAssets === 'object'
    ? saved.protectedAssets
    : {};
  const roleIds = new Set(cleanIdArray(protectedAssets.roleIds));
  const channelIds = new Set(cleanIdArray(protectedAssets.channelIds));
  const botRoleId = guild.members?.me?.roles?.botRole?.id;
  if (botRoleId) roleIds.add(String(botRoleId));
  return {
    enabled: protectedAssets.enabled !== false,
    roleIds,
    channelIds,
    roleIdList: [...roleIds],
    channelIdList: [...channelIds],
  };
}

function isTrusted(member, guild, config) {
  if (!member) return false;
  if (member.id === guild.ownerId || member.id === guild.members?.me?.id) return true;
  if ((config.trustedUserIds || []).map(String).includes(String(member.id))) return true;
  const trustedRoles = new Set((config.trustedRoleIds || []).map(String));
  return member.roles?.cache?.some((role) => trustedRoles.has(String(role.id))) || false;
}

function getTargetId(entry) {
  return String(entry?.targetId || entry?.target?.id || '').trim() || null;
}

function protectedTargetBonus(guild, entry, rule) {
  const assets = getProtectedAssets(guild);
  if (!assets.enabled) return { bonus: 0, protectedAsset: false, protectedAssetType: null };
  const targetId = getTargetId(entry);
  if (!targetId) return { bonus: 0, protectedAsset: false, protectedAssetType: null };
  if (rule.targetType === 'role' && assets.roleIds.has(targetId)) {
    return { bonus: 55, protectedAsset: true, protectedAssetType: 'role' };
  }
  if (rule.targetType === 'channel' && assets.channelIds.has(targetId)) {
    return { bonus: 55, protectedAsset: true, protectedAssetType: 'channel' };
  }
  return { bonus: 0, protectedAsset: false, protectedAssetType: null };
}

function dangerousPermissionCount(role) {
  if (!role?.permissions?.has) return 0;
  const dangerous = [
    PermissionFlagsBits.Administrator,
    PermissionFlagsBits.ManageGuild,
    PermissionFlagsBits.ManageRoles,
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.BanMembers,
    PermissionFlagsBits.KickMembers,
    PermissionFlagsBits.ManageWebhooks,
  ];
  return dangerous.filter((flag) => role.permissions.has(flag)).length;
}

async function memberRoleGrantBonus(guild, entry) {
  if (entry.action !== AuditLogEvent.MemberRoleUpdate) return { bonus: 0, dangerousRoles: [] };
  const additions = [];
  for (const change of entry.changes || []) {
    if (change?.key !== '$add' || !Array.isArray(change.new)) continue;
    for (const value of change.new) {
      if (value?.id) additions.push(String(value.id));
    }
  }
  const dangerousRoles = [];
  for (const roleId of additions) {
    const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
    const count = dangerousPermissionCount(role);
    if (count > 0) dangerousRoles.push({ roleId, roleName: role?.name || null, dangerousPermissionCount: count });
  }
  if (!dangerousRoles.length) return { bonus: 0, dangerousRoles: [] };
  const permissionCount = dangerousRoles.reduce((sum, role) => sum + role.dangerousPermissionCount, 0);
  return { bonus: Math.min(80, 45 + permissionCount * 8), dangerousRoles };
}

function pruneSession(session, now = Date.now()) {
  const events = (session?.events || []).filter((event) => now - event.at <= SESSION_WINDOW_MS).slice(-MAX_SESSION_EVENTS);
  return {
    id: session?.id || `threat_${now}_${Math.random().toString(36).slice(2, 8)}`,
    startedAt: events[0]?.at || now,
    updatedAt: events[events.length - 1]?.at || now,
    events,
  };
}

function recordThreatEvent(guildId, actorId, event) {
  const key = sessionKey(guildId, actorId);
  const current = pruneSession(sessions.get(key));
  current.events.push(event);
  current.events = current.events.filter((item) => event.at - item.at <= SESSION_WINDOW_MS).slice(-MAX_SESSION_EVENTS);
  current.startedAt = current.events[0]?.at || event.at;
  current.updatedAt = event.at;
  sessions.set(key, current);
  const totalScore = current.events.reduce((sum, item) => sum + Number(item.weight || 0), 0);
  const distinctTypes = new Set(current.events.map((item) => item.type)).size;
  return { ...current, totalScore, distinctTypes };
}

function severityFromScore(score) {
  if (score >= 100) return securitySystem.SEVERITY.CRITICAL;
  if (score >= 70) return securitySystem.SEVERITY.HIGH;
  if (score >= 40) return securitySystem.SEVERITY.MEDIUM;
  return securitySystem.SEVERITY.LOW;
}

function sanitizeChanges(changes = []) {
  return (Array.isArray(changes) ? changes : []).slice(0, 20).map((change) => ({
    key: change?.key || null,
    old: change?.old ?? null,
    new: change?.new ?? null,
  }));
}

function persistIncidentPackage(guild, payload) {
  const security = guildManager.getSecurityConfig(guild.id) || {};
  const existing = Array.isArray(security.incidentPackages) ? security.incidentPackages : [];
  const packageData = {
    packageId: payload.packageId || `pkg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    guildId: guild.id,
    guildName: guild.name,
    ...payload,
    createdAt: payload.createdAt || new Date().toISOString(),
  };
  guildManager.updateSecurityConfig(guild.id, (current = {}) => ({
    ...current,
    incidentPackages: [packageData, ...(Array.isArray(current.incidentPackages) ? current.incidentPackages : [])].slice(0, 100),
  }), guild);
  return packageData;
}

async function runResponse({ guild, config, member, executor, severity, reason }) {
  const response = {
    beforeBackup: null,
    isolation: null,
    lockdown: null,
    inviteFreeze: null,
    roleFreeze: null,
    ownerAlerted: false,
    afterBackup: null,
  };

  const high = severity === securitySystem.SEVERITY.HIGH || severity === securitySystem.SEVERITY.CRITICAL;
  const critical = severity === securitySystem.SEVERITY.CRITICAL;

  if (high && config.backups?.beforeIncident !== false) {
    response.beforeBackup = await antiNuke.createEmergencyBackup(guild, `Before correlated ${severity} threat response`, 'before_correlated_threat_response');
  }
  if (high && member) {
    response.isolation = await antiNuke.quarantineMember(guild, member, config, reason);
  }
  if (critical) {
    response.lockdown = await antiNuke.emergencyLockdown(guild, reason);
    if (config.emergencyControls?.enabled !== false && config.emergencyControls?.disableInvites !== false) {
      response.inviteFreeze = await disableInvites(guild, {
        reason,
        durationMs: config.emergencyControls?.durationMs,
        trustedRoleIds: config.trustedRoleIds,
      });
    }
    if (config.emergencyControls?.enabled !== false && config.emergencyControls?.freezeRoles !== false) {
      response.roleFreeze = await freezeRoles(guild, {
        reason,
        durationMs: config.emergencyControls?.durationMs,
        trustedRoleIds: config.trustedRoleIds,
      });
    }
  }
  return response;
}

async function handleAuditLogEntry(entry, guild) {
  if (!entry || !guild || !guildManager.isModuleEnabled(guild.id, 'security')) return null;
  const rule = EVENT_RULES.get(entry.action);
  if (!rule) return null;

  const config = antiNuke.getAntiNukeConfig(guild.id);
  if (config.enabled === false) return null;

  const actorId = String(entry.executorId || entry.executor?.id || '').trim();
  if (!actorId) return null;
  const member = await guild.members.fetch(actorId).catch(() => null);
  if (isTrusted(member, guild, config)) return null;
  if (config.ignoreBots && entry.executor?.bot) return null;

  const protectedResult = protectedTargetBonus(guild, entry, rule);
  const roleGrant = await memberRoleGrantBonus(guild, entry);
  const eventWeight = rule.weight + protectedResult.bonus + roleGrant.bonus;
  const targetId = getTargetId(entry);
  const now = Date.now();
  const session = recordThreatEvent(guild.id, actorId, {
    at: now,
    type: rule.type,
    action: entry.action,
    targetId,
    targetType: rule.targetType,
    weight: eventWeight,
    protectedAsset: protectedResult.protectedAsset,
  });

  let score = session.totalScore;
  if (session.distinctTypes >= 2) score += 20;
  if (session.distinctTypes >= 3) score += 20;
  const severity = severityFromScore(score);

  const correlationTriggered = session.distinctTypes >= 2 || protectedResult.protectedAsset || severity === securitySystem.SEVERITY.CRITICAL;
  if (rule.correlationOnly && !correlationTriggered) return { recorded: true, sessionId: session.id, score, severity };

  const reason = protectedResult.protectedAsset
    ? `Protected ${protectedResult.protectedAssetType} security event detected: ${rule.type}.`
    : `Suspicious security event detected: ${rule.type}.`;

  const response = await runResponse({ guild, config, member, executor: entry.executor, severity, reason });
  const packageData = persistIncidentPackage(guild, {
    sessionId: session.id,
    actorId,
    actorTag: entry.executor?.tag || entry.executor?.username || null,
    severity,
    threatScore: score,
    distinctEventTypes: session.distinctTypes,
    auditEvidence: {
      auditEntryId: entry.id || null,
      action: entry.action,
      reason: entry.reason || null,
      targetId,
      targetType: rule.targetType,
      changes: sanitizeChanges(entry.changes),
    },
    protectedAsset: protectedResult,
    dangerousRoleGrants: roleGrant.dangerousRoles,
    sessionEvents: session.events,
    response,
  });

  const actionParts = [];
  if (response.beforeBackup) actionParts.push('backup created');
  if (response.isolation) actionParts.push(response.isolation.success ? 'actor isolated' : 'actor isolation attempted');
  if (response.lockdown) actionParts.push('lockdown triggered');
  if (response.inviteFreeze) actionParts.push('invite freeze triggered');
  if (response.roleFreeze) actionParts.push('role freeze triggered');
  if (!actionParts.length) actionParts.push('logged and correlated');

  const incident = await securitySystem.logIncident(guild, {
    type: `advanced_${rule.type}`,
    severity,
    actorId,
    actorTag: entry.executor?.tag || entry.executor?.username || null,
    targetId,
    targetName: entry.target?.name || entry.target?.username || null,
    targetType: rule.targetType,
    reason,
    actionTaken: actionParts.join('; '),
    metadata: {
      threatScore: score,
      sessionId: session.id,
      packageId: packageData.packageId,
      distinctEventTypes: session.distinctTypes,
      protectedAsset: protectedResult,
      dangerousRoleGrants: roleGrant.dangerousRoles,
      response,
    },
  });

  if (severity === securitySystem.SEVERITY.MEDIUM || severity === securitySystem.SEVERITY.HIGH || severity === securitySystem.SEVERITY.CRITICAL) {
    response.ownerAlerted = await antiNuke.alertOwner(guild, incident);
  }
  if (severity === securitySystem.SEVERITY.CRITICAL && config.backups?.afterIncident !== false) {
    response.afterBackup = await antiNuke.createEmergencyBackup(guild, `After correlated critical threat response: ${rule.type}`, 'after_correlated_threat_response');
  }

  return { incident, package: packageData, response, score, severity };
}

function getThreatSession(guildId, actorId) {
  const session = pruneSession(sessions.get(sessionKey(guildId, actorId)));
  const totalScore = session.events.reduce((sum, event) => sum + Number(event.weight || 0), 0);
  return { ...session, totalScore, distinctTypes: new Set(session.events.map((event) => event.type)).size };
}

module.exports = {
  SESSION_WINDOW_MS,
  getProtectedAssets,
  getThreatSession,
  handleAuditLogEntry,
  persistIncidentPackage,
};
