'use strict';

const { AuditLogEvent, PermissionFlagsBits } = require('discord.js');

const securitySystem = require('./system');
const guildManager = require('../../guild/guildManager');
const { enableLockdown, getLockdownState, getLockdownModeFromSeverity } = require('./lockdown');
const { validateBotHierarchy, hasDangerousPermissions } = require('./system');
const { quarantineMember: quarantineSystemMember } = require('./quarantine');
const schedulerRegistry = require('../../../owner/sentinel/schedulerRegistry');

const {
  SEVERITY,
  INCIDENT_TYPES,
  logIncident,
  calculateIncidentSeverity,
} = securitySystem;

const QUARANTINE_ROLE_NAME = 'Goliath Quarantine';
const CLEANUP_INTERVAL_MS = 60_000;
const CLEANUP_SCHEDULER_ID = 'security:anti-nuke-bucket-cleanup:global';

const DEFAULT_CONFIG = {
  enabled: true,
  thresholds: {
    channelDelete: { maxActions: 3, windowMs: 30_000 },
    roleDelete: { maxActions: 3, windowMs: 30_000 },
  },
  lockdown: {
    enabled: true,
    reason: 'Goliath Anti-Nuke emergency lockdown triggered.',
  },
  quarantine: {
    enabled: true,
    roleName: QUARANTINE_ROLE_NAME,
    reason: 'Goliath Anti-Nuke quarantine triggered.',
  },
  ownerAlerts: { enabled: true },
  backups: { beforeIncident: true, afterIncident: true },
  trustedUserIds: [],
  trustedRoleIds: [],
  ignoreBots: false,
};

const actionBuckets = new Map();

schedulerRegistry.register({
  id: CLEANUP_SCHEDULER_ID,
  module: 'security',
  component: 'anti-nuke-bucket-cleanup',
  intervalMs: CLEANUP_INTERVAL_MS,
  details: { buckets: actionBuckets.size },
});

const cleanupTimer = setInterval(() => {
  try {
    const now = Date.now();
    let removed = 0;
    for (const [key, timestamps] of actionBuckets.entries()) {
      const fresh = timestamps.filter((timestamp) => now - timestamp < CLEANUP_INTERVAL_MS);
      if (fresh.length) actionBuckets.set(key, fresh);
      else {
        actionBuckets.delete(key);
        removed += 1;
      }
    }
    schedulerRegistry.beat(CLEANUP_SCHEDULER_ID, {
      buckets: actionBuckets.size,
      removed,
    });
  } catch (error) {
    schedulerRegistry.fail(CLEANUP_SCHEDULER_ID, error, { buckets: actionBuckets.size });
    console.error('[AntiNuke] Action bucket cleanup failed:', error);
  }
}, CLEANUP_INTERVAL_MS);
cleanupTimer.unref?.();

function getAntiNukeConfig(guildId) {
  const saved = guildManager.getGuildSection(guildId, 'antiNuke', {});
  return {
    ...DEFAULT_CONFIG,
    ...saved,
    thresholds: {
      ...DEFAULT_CONFIG.thresholds,
      ...(saved.thresholds || {}),
      channelDelete: {
        ...DEFAULT_CONFIG.thresholds.channelDelete,
        ...(saved.thresholds?.channelDelete || {}),
      },
      roleDelete: {
        ...DEFAULT_CONFIG.thresholds.roleDelete,
        ...(saved.thresholds?.roleDelete || {}),
      },
    },
    lockdown: { ...DEFAULT_CONFIG.lockdown, ...(saved.lockdown || {}) },
    quarantine: { ...DEFAULT_CONFIG.quarantine, ...(saved.quarantine || {}) },
    ownerAlerts: { ...DEFAULT_CONFIG.ownerAlerts, ...(saved.ownerAlerts || {}) },
    backups: { ...DEFAULT_CONFIG.backups, ...(saved.backups || {}) },
    trustedUserIds: Array.isArray(saved.trustedUserIds) ? saved.trustedUserIds.map(String) : [],
    trustedRoleIds: Array.isArray(saved.trustedRoleIds) ? saved.trustedRoleIds.map(String) : [],
    ignoreBots: Boolean(saved.ignoreBots),
  };
}

function addAction(guildId, userId, actionType, windowMs) {
  const key = `${guildId}:${userId || 'unknown'}:${actionType}`;
  const now = Date.now();
  const fresh = (actionBuckets.get(key) || []).filter((timestamp) => now - timestamp <= windowMs);
  fresh.push(now);
  actionBuckets.set(key, fresh);
  return fresh.length;
}

function isTrustedMember(member, config) {
  if (!member) return false;
  if (config.trustedUserIds.includes(member.id)) return true;
  const trustedRoleMatch = member.roles.cache.some((role) => config.trustedRoleIds.includes(role.id));
  return trustedRoleMatch && hasDangerousPermissions(member);
}

async function fetchAuditExecutor(guild, auditType) {
  try {
    const logs = await guild.fetchAuditLogs({ type: auditType, limit: 1 });
    const entry = logs.entries.first();
    if (!entry) return null;
    if (Date.now() - entry.createdTimestamp > 8_000) return null;
    return {
      id: entry.executor?.id || null,
      tag: entry.executor?.tag || null,
      bot: Boolean(entry.executor?.bot),
      entry,
    };
  } catch (error) {
    console.error('[AntiNuke] Failed to fetch audit executor:', error);
    return null;
  }
}

async function createEmergencyBackup(guild, reason, stage) {
  try {
    const { createServerBackup } = require('../restoreBackup/backup');
    if (typeof createServerBackup !== 'function') return null;
    return await createServerBackup(guild, {
      createdBy: 'Goliath Anti-Nuke',
      reason,
      stage,
      emergency: true,
      type: 'security_emergency',
    });
  } catch (error) {
    console.error('[AntiNuke] Emergency backup failed:', error);
    return null;
  }
}

async function alertOwner(guild, incident) {
  try {
    const owner = await guild.fetchOwner().catch(() => null);
    if (!owner) return false;
    await owner.send([
      '🚨 **Goliath Anti-Nuke Alert**',
      `Server: **${guild.name}**`,
      `Incident: \`${incident.type}\``,
      `Severity: \`${incident.severity}\``,
      `Actor: ${incident.actorTag || 'Unknown'} (${incident.actorId || 'unknown'})`,
      `Action: ${incident.actionTaken || 'Logged only'}`,
    ].join('\n'));
    return true;
  } catch (error) {
    console.error('[AntiNuke] Owner alert failed:', error);
    return false;
  }
}

async function emergencyLockdown(guild, reason) {
  if (!guild) return false;
  const current = getLockdownState(guild.id);
  if (current.active) return false;

  const result = await enableLockdown(guild, {
    reason: reason || 'Goliath Anti-Nuke emergency lockdown triggered.',
    enabledBy: 'anti_nuke',
    enabledByTag: 'Goliath Anti-Nuke',
    severity: SEVERITY.CRITICAL,
    lockdownMode: 'emergency',
    durationMs: 1000 * 60 * 60,
  });

  if (!result?.success) return false;

  await logIncident(guild, {
    type: INCIDENT_TYPES.EMERGENCY_LOCKDOWN,
    severity: SEVERITY.CRITICAL,
    reason,
    actionTaken: 'Emergency lockdown panic protection enabled.',
    metadata: { source: 'anti_nuke', protectedChannels: result.locked || 0 },
  });

  return true;
}

async function quarantineMember(guild, member, config = {}, reason = '') {
  if (!guild || !member) return { success: false, reason: 'Missing guild or member.' };
  if (member.id === guild.ownerId) return { success: false, reason: 'Cannot quarantine the server owner.' };

  return quarantineSystemMember(guild, member, {
    reason: reason || config.quarantine?.reason || 'Goliath Anti-Nuke quarantine triggered.',
    quarantinedBy: 'anti_nuke',
    durationMs: config.durationMs || 1000 * 60 * 60,
  });
}

function analyseIncident(type, metadata = {}) {
  if (typeof calculateIncidentSeverity === 'function') {
    return calculateIncidentSeverity(type, metadata);
  }
  return { severity: SEVERITY.HIGH, score: 0, recommendedActions: [] };
}

function getDangerousRolePermissions(role) {
  const dangerousFlags = [
    PermissionFlagsBits.Administrator,
    PermissionFlagsBits.ManageGuild,
    PermissionFlagsBits.ManageRoles,
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.BanMembers,
    PermissionFlagsBits.KickMembers,
    PermissionFlagsBits.ManageWebhooks,
  ];
  return dangerousFlags.filter((flag) => role.permissions.has(flag));
}

async function handleDeleteEvent({ guild, target, actionType, auditType, incidentType, massIncidentType }) {
  if (!guild) return null;
  const config = getAntiNukeConfig(guild.id);
  if (!config.enabled) return null;

  const hierarchy = validateBotHierarchy(guild);
  if (!hierarchy.valid) {
    console.warn(`[AntiNuke] Blocked protection system in ${guild.name}: ${hierarchy.reason}`);
    return null;
  }

  const executor = await fetchAuditExecutor(guild, auditType);
  if (!executor?.id) return null;
  if (config.ignoreBots && executor.bot) return null;

  const member = await guild.members.fetch(executor.id).catch(() => null);
  if (isTrustedMember(member, config)) return null;

  const threshold = actionType === 'channelDelete' ? config.thresholds.channelDelete : config.thresholds.roleDelete;
  const count = addAction(guild.id, executor.id, actionType, threshold.windowMs);

  const normalIncident = await logIncident(guild, {
    type: incidentType,
    severity: SEVERITY.MEDIUM,
    actorId: executor.id,
    actorTag: executor.tag,
    targetId: target?.id || null,
    targetName: target?.name || target?.username || null,
    targetType: actionType,
    reason: `${actionType} detected.`,
    metadata: { actionCount: count, threshold: threshold.maxActions, windowMs: threshold.windowMs },
  });

  if (count < threshold.maxActions) return normalIncident;

  const incidentAnalysis = analyseIncident(massIncidentType, {
    actionCount: count,
    threshold: threshold.maxActions,
    actorIsBot: executor.bot || false,
    actorTrusted: false,
  });

  let beforeBackup = null;
  let afterBackup = null;
  let lockdownTriggered = false;
  let quarantineResult = { success: false, reason: 'Quarantine not attempted.' };

  if (config.backups.beforeIncident) {
    beforeBackup = await createEmergencyBackup(guild, `Before anti-nuke response: ${massIncidentType}`, 'before_incident_response');
  }

  const lockdownProfile = getLockdownModeFromSeverity(incidentAnalysis.severity);
  if (config.lockdown.enabled) {
    const lockdownResult = await enableLockdown(guild, {
      reason: config.lockdown.reason,
      enabledBy: 'anti_nuke',
      enabledByTag: 'Goliath Anti-Nuke',
      severity: incidentAnalysis.severity,
      lockdownMode: lockdownProfile.mode,
      slowmodeSeconds: lockdownProfile.slowmodeSeconds,
      lockText: lockdownProfile.lockText,
      lockVoice: lockdownProfile.lockVoice,
      lockThreads: lockdownProfile.lockThreads,
      lockCommands: lockdownProfile.lockCommands,
    });
    lockdownTriggered = Boolean(lockdownResult?.success);
  }

  if (config.quarantine.enabled && member) {
    quarantineResult = await quarantineMember(guild, member, config, `Mass ${actionType} detected.`);
  }

  const massIncident = await logIncident(guild, {
    type: massIncidentType,
    severity: incidentAnalysis.severity,
    actorId: executor.id,
    actorTag: executor.tag,
    targetId: target?.id || null,
    targetName: target?.name || null,
    targetType: actionType,
    reason: `Mass ${actionType} detected.`,
    actionTaken: [
      lockdownTriggered ? 'Emergency lockdown triggered.' : 'Lockdown not applied.',
      quarantineResult.success ? 'Attacker quarantined.' : `Quarantine failed/skipped: ${quarantineResult.reason || quarantineResult.error}`,
    ].join(' '),
    metadata: {
      actionCount: count,
      threshold: threshold.maxActions,
      windowMs: threshold.windowMs,
      beforeBackupCreated: Boolean(beforeBackup),
      lockdownTriggered,
      lockdownMode: lockdownProfile.mode,
      lockdownSeverity: incidentAnalysis.severity,
      quarantine: quarantineResult,
      severityScore: incidentAnalysis.score,
      recommendedActions: incidentAnalysis.recommendedActions,
    },
  });

  if (config.ownerAlerts.enabled) await alertOwner(guild, massIncident);

  if (config.backups.afterIncident) {
    afterBackup = await createEmergencyBackup(guild, `After anti-nuke response: ${massIncidentType}`, 'after_incident_response');
  }

  if (afterBackup) {
    await logIncident(guild, {
      type: INCIDENT_TYPES.BACKUP_CREATED,
      severity: SEVERITY.HIGH,
      reason: 'Emergency after-incident backup created.',
      actionTaken: 'Backup created after anti-nuke response.',
      metadata: { backupId: afterBackup.backupId || null, backupCreatedAt: afterBackup.createdAt || null, relatedIncidentId: massIncident.id },
    });
  }

  return massIncident;
}

async function handleChannelDelete(channel) {
  return handleDeleteEvent({ guild: channel.guild, target: channel, actionType: 'channelDelete', auditType: AuditLogEvent.ChannelDelete, incidentType: INCIDENT_TYPES.CHANNEL_DELETE, massIncidentType: INCIDENT_TYPES.MASS_CHANNEL_DELETE });
}

async function handleRoleDelete(role) {
  return handleDeleteEvent({ guild: role.guild, target: role, actionType: 'roleDelete', auditType: AuditLogEvent.RoleDelete, incidentType: INCIDENT_TYPES.ROLE_DELETE, massIncidentType: INCIDENT_TYPES.MASS_ROLE_DELETE });
}

async function handleRoleCreate(role) {
  const guild = role.guild;
  if (!guild) return null;
  const config = getAntiNukeConfig(guild.id);
  if (!config.enabled) return null;
  const hierarchy = validateBotHierarchy(guild);
  if (!hierarchy.valid) return null;
  const executor = await fetchAuditExecutor(guild, AuditLogEvent.RoleCreate);
  if (!executor?.id) return null;
  if (config.ignoreBots && executor.bot) return null;
  const member = await guild.members.fetch(executor.id).catch(() => null);
  if (isTrustedMember(member, config)) return null;
  const dangerous = getDangerousRolePermissions(role);
  if (!dangerous.length) return null;
  const incidentAnalysis = analyseIncident(INCIDENT_TYPES.DANGEROUS_ROLE_CREATE || 'dangerous_role_create', { dangerousPermissionCount: dangerous.length });
  if (config.backups.beforeIncident) await createEmergencyBackup(guild, 'Security escalation detected.', 'security_escalation');
  const incident = await logIncident(guild, { type: INCIDENT_TYPES.DANGEROUS_ROLE_CREATE || 'dangerous_role_create', severity: incidentAnalysis.severity, actorId: executor.id, actorTag: executor.tag, targetId: role.id, targetName: role.name, targetType: 'role', reason: 'Dangerous role created.', actionTaken: 'Role creation flagged as suspicious.', metadata: { dangerousPermissionCount: dangerous.length } });
  if (config.quarantine.enabled && member) await quarantineMember(guild, member, config, 'Dangerous role creation detected.');
  return incident;
}

async function handleRoleUpdate(oldRole, newRole) {
  const guild = newRole.guild;
  if (!guild) return null;
  const config = getAntiNukeConfig(guild.id);
  if (!config.enabled) return null;
  const hierarchy = validateBotHierarchy(guild);
  if (!hierarchy.valid) return null;
  const executor = await fetchAuditExecutor(guild, AuditLogEvent.RoleUpdate);
  if (!executor?.id) return null;
  if (config.ignoreBots && executor.bot) return null;
  const member = await guild.members.fetch(executor.id).catch(() => null);
  if (isTrustedMember(member, config)) return null;
  const addedDangerous = getDangerousRolePermissions(newRole).filter((flag) => !oldRole.permissions.has(flag));
  if (!addedDangerous.length) return null;
  const incidentAnalysis = analyseIncident(INCIDENT_TYPES.DANGEROUS_ROLE_PERMISSION_ADDED || 'dangerous_role_permission_added', { addedPermissionCount: addedDangerous.length });
  if (config.backups.beforeIncident) await createEmergencyBackup(guild, 'Security escalation detected.', 'security_escalation');
  const incident = await logIncident(guild, { type: INCIDENT_TYPES.DANGEROUS_ROLE_PERMISSION_ADDED || 'dangerous_role_permission_added', severity: incidentAnalysis.severity, actorId: executor.id, actorTag: executor.tag, targetId: newRole.id, targetName: newRole.name, targetType: 'role', reason: 'Dangerous permissions were added to an existing role.', actionTaken: 'Role permission escalation flagged.', metadata: { roleId: newRole.id, roleName: newRole.name, addedPermissionCount: addedDangerous.length } });
  if (config.quarantine.enabled && member) await quarantineMember(guild, member, config, 'Dangerous role permission escalation detected.');
  return incident;
}

async function handleWebhookCreate(webhook) {
  const guild = webhook.guild;
  if (!guild) return null;
  const config = getAntiNukeConfig(guild.id);
  if (!config.enabled) return null;
  const hierarchy = validateBotHierarchy(guild);
  if (!hierarchy.valid) return null;
  const executor = await fetchAuditExecutor(guild, AuditLogEvent.WebhookCreate);
  if (!executor?.id) return null;
  if (config.ignoreBots && executor.bot) return null;
  const member = await guild.members.fetch(executor.id).catch(() => null);
  if (isTrustedMember(member, config)) return null;
  if (config.backups.beforeIncident) await createEmergencyBackup(guild, 'Security escalation detected.', 'security_escalation');
  const incident = await logIncident(guild, { type: INCIDENT_TYPES.WEBHOOK_CREATE || 'webhook_create', severity: SEVERITY.HIGH, actorId: executor.id, actorTag: executor.tag, targetId: webhook.id, targetName: webhook.name, targetType: 'webhook', reason: 'Webhook creation detected.', actionTaken: 'Webhook flagged for monitoring.' });
  if (config.quarantine.enabled && member) await quarantineMember(guild, member, config, 'Suspicious webhook creation detected.');
  return incident;
}

async function handleWebhookDelete(webhook) {
  const guild = webhook.guild;
  if (!guild) return null;
  const config = getAntiNukeConfig(guild.id);
  if (!config.enabled) return null;
  const hierarchy = validateBotHierarchy(guild);
  if (!hierarchy.valid) return null;
  const executor = await fetchAuditExecutor(guild, AuditLogEvent.WebhookDelete);
  if (!executor?.id) return null;
  if (config.ignoreBots && executor.bot) return null;
  const member = await guild.members.fetch(executor.id).catch(() => null);
  if (isTrustedMember(member, config)) return null;
  if (config.backups.beforeIncident) await createEmergencyBackup(guild, 'Security escalation detected.', 'security_escalation');
  const incidentAnalysis = analyseIncident(INCIDENT_TYPES.WEBHOOK_DELETE || 'webhook_delete', {});
  const incident = await logIncident(guild, { type: INCIDENT_TYPES.WEBHOOK_DELETE || 'webhook_delete', severity: incidentAnalysis.severity, actorId: executor.id, actorTag: executor.tag, targetId: webhook.id, targetName: webhook.name, targetType: 'webhook', reason: 'Webhook deletion detected.', actionTaken: 'Webhook deletion flagged as suspicious.' });
  if (config.quarantine.enabled && member) await quarantineMember(guild, member, config, 'Suspicious webhook deletion detected.');
  return incident;
}

async function handleWebhookUpdate(channel) {
  if (!channel?.guild) return null;
  const guild = channel.guild;
  const config = getAntiNukeConfig(guild.id);
  if (!config.enabled) return null;
  const hierarchy = validateBotHierarchy(guild);
  if (!hierarchy.valid) return null;
  const auditTypes = [AuditLogEvent.WebhookCreate, AuditLogEvent.WebhookUpdate, AuditLogEvent.WebhookDelete];
  let executor = null;
  for (const auditType of auditTypes) {
    executor = await fetchAuditExecutor(guild, auditType);
    if (executor?.id) break;
  }
  if (!executor?.id) return null;
  if (config.ignoreBots && executor.bot) return null;
  const member = await guild.members.fetch(executor.id).catch(() => null);
  if (isTrustedMember(member, config)) return null;
  let quarantineResult = { success: false, reason: 'Quarantine not attempted.' };
  if (config.quarantine.enabled && member) quarantineResult = await quarantineMember(guild, member, config, 'Suspicious webhook activity detected.');
  const incidentAnalysis = analyseIncident(INCIDENT_TYPES.SUSPICIOUS_WEBHOOK_ACTIVITY || INCIDENT_TYPES.WEBHOOK_UPDATE || 'suspicious_webhook_activity', {});
  const incident = await logIncident(guild, { type: INCIDENT_TYPES.SUSPICIOUS_WEBHOOK_ACTIVITY || INCIDENT_TYPES.WEBHOOK_UPDATE || 'suspicious_webhook_activity', severity: incidentAnalysis.severity, actorId: executor.id, actorTag: executor.tag, targetId: channel.id, targetName: channel.name, targetType: 'webhook_channel', reason: `Webhook activity detected in #${channel.name}.`, actionTaken: quarantineResult.success ? 'Executor quarantined automatically.' : `Quarantine failed/skipped: ${quarantineResult.reason || quarantineResult.error}`, metadata: { channelId: channel.id, channelName: channel.name, auditAction: executor.entry?.action || null, quarantine: quarantineResult } });
  await alertOwner(guild, incident);
  return incident;
}

module.exports = {
  DEFAULT_CONFIG,
  QUARANTINE_ROLE_NAME,
  getAntiNukeConfig,
  handleChannelDelete,
  handleRoleDelete,
  handleWebhookCreate,
  handleWebhookDelete,
  handleWebhookUpdate,
  handleRoleCreate,
  handleRoleUpdate,
  emergencyLockdown,
  quarantineMember,
  alertOwner,
  createEmergencyBackup,
};
