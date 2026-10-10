'use strict';

const { AuditLogEvent, PermissionFlagsBits } = require('discord.js');
const securitySystem = require('./system');
const { buildSecurityIncidentNotice } = require('../../ui/systemNotices');
const guildManager = require('../../guild/guildManager');
const { enableLockdown, getLockdownState, getLockdownModeFromSeverity } = require('./lockdown');
const { validateBotHierarchy } = require('./system');
const { quarantineMember: quarantineSystemMember } = require('./quarantine');
const { disableInvites, freezeRoles } = require('./emergencyControls');
const schedulerRegistry = require('../../../owner/sentinel/schedulerRegistry');

const { SEVERITY, INCIDENT_TYPES, logIncident, calculateIncidentSeverity } = securitySystem;
const QUARANTINE_ROLE_NAME = 'Goliath Quarantine';
const CLEANUP_INTERVAL_MS = 60_000;
const CLEANUP_SCHEDULER_ID = 'security:anti-nuke-bucket-cleanup:global';
const DEFAULT_RESPONSE_DURATION_MS = 60 * 60 * 1000;

const DEFAULT_CONFIG = {
  enabled: true,
  thresholds: {
    channelDelete: { maxActions: 3, windowMs: 30_000 },
    roleDelete: { maxActions: 3, windowMs: 30_000 },
  },
  lockdown: { enabled: true, reason: 'Goliath Anti-Nuke emergency lockdown triggered.', durationMs: DEFAULT_RESPONSE_DURATION_MS },
  quarantine: { enabled: true, roleName: QUARANTINE_ROLE_NAME, reason: 'Goliath Anti-Nuke quarantine triggered.', durationMs: DEFAULT_RESPONSE_DURATION_MS },
  emergencyControls: { enabled: true, disableInvites: true, freezeRoles: true, durationMs: DEFAULT_RESPONSE_DURATION_MS },
  ownerAlerts: { enabled: true },
  backups: { beforeIncident: true, afterIncident: true },
  trustedUserIds: [],
  trustedRoleIds: [],
  ignoreBots: false,
};

const actionBuckets = new Map();
schedulerRegistry.register({ id: CLEANUP_SCHEDULER_ID, module: 'security', component: 'anti-nuke-bucket-cleanup', intervalMs: CLEANUP_INTERVAL_MS, staleAfterMs: CLEANUP_INTERVAL_MS * 3 });
const cleanupTimer = setInterval(() => {
  try {
    const now = Date.now();
    for (const [key, timestamps] of actionBuckets) {
      const fresh = timestamps.filter((timestamp) => now - timestamp < CLEANUP_INTERVAL_MS);
      if (fresh.length) actionBuckets.set(key, fresh); else actionBuckets.delete(key);
    }
    schedulerRegistry.beat(CLEANUP_SCHEDULER_ID, { buckets: actionBuckets.size });
  } catch (error) {
    schedulerRegistry.fail(CLEANUP_SCHEDULER_ID, error, { buckets: actionBuckets.size });
  }
}, CLEANUP_INTERVAL_MS);
cleanupTimer.unref?.();

function normalizeThreshold(value, fallback) {
  const maxActions = Number(value?.maxActions);
  const windowMs = Number(value?.windowMs);
  return {
    maxActions: Number.isFinite(maxActions) ? Math.max(1, Math.min(100, Math.trunc(maxActions))) : fallback.maxActions,
    windowMs: Number.isFinite(windowMs) ? Math.max(1000, Math.min(3_600_000, Math.trunc(windowMs))) : fallback.windowMs,
  };
}
function normalizeDuration(value, fallback = DEFAULT_RESPONSE_DURATION_MS) {
  const duration = Number(value);
  return Number.isFinite(duration) && duration > 0 ? Math.max(60_000, Math.min(604_800_000, Math.trunc(duration))) : fallback;
}
function getAntiNukeConfig(guildId) {
  const saved = guildManager.getGuildSection(guildId, 'antiNuke', {}) || {};
  return {
    ...DEFAULT_CONFIG,
    ...saved,
    thresholds: {
      channelDelete: normalizeThreshold(saved.thresholds?.channelDelete, DEFAULT_CONFIG.thresholds.channelDelete),
      roleDelete: normalizeThreshold(saved.thresholds?.roleDelete, DEFAULT_CONFIG.thresholds.roleDelete),
    },
    lockdown: { ...DEFAULT_CONFIG.lockdown, ...(saved.lockdown || {}), durationMs: normalizeDuration(saved.lockdown?.durationMs, DEFAULT_CONFIG.lockdown.durationMs) },
    quarantine: { ...DEFAULT_CONFIG.quarantine, ...(saved.quarantine || {}), durationMs: normalizeDuration(saved.quarantine?.durationMs || saved.durationMs, DEFAULT_CONFIG.quarantine.durationMs) },
    emergencyControls: { ...DEFAULT_CONFIG.emergencyControls, ...(saved.emergencyControls || {}), durationMs: normalizeDuration(saved.emergencyControls?.durationMs, DEFAULT_CONFIG.emergencyControls.durationMs) },
    ownerAlerts: { ...DEFAULT_CONFIG.ownerAlerts, ...(saved.ownerAlerts || {}) },
    backups: { ...DEFAULT_CONFIG.backups, ...(saved.backups || {}) },
    trustedUserIds: Array.isArray(saved.trustedUserIds) ? [...new Set(saved.trustedUserIds.map(String))] : [],
    trustedRoleIds: Array.isArray(saved.trustedRoleIds) ? [...new Set(saved.trustedRoleIds.map(String))] : [],
    ignoreBots: Boolean(saved.ignoreBots),
  };
}
function addAction(guildId, userId, actionType, windowMs) {
  const key = `${guildId}:${userId || 'unknown'}:${actionType}`;
  const now = Date.now();
  const fresh = (actionBuckets.get(key) || []).filter((timestamp) => now - timestamp <= windowMs);
  fresh.push(now); actionBuckets.set(key, fresh); return fresh.length;
}
function isTrustedMember(member, config) {
  if (!member) return false;
  if (member.id === member.guild?.ownerId) return true;
  if (member.id === member.guild?.members?.me?.id) return true;
  if (config.trustedUserIds.includes(String(member.id))) return true;
  return member.roles.cache.some((role) => config.trustedRoleIds.includes(String(role.id)));
}
function responseCapability(guild) {
  const result = validateBotHierarchy(guild);
  if (!result.valid) console.warn(`[AntiNuke] Detection remains active but response capability is degraded in ${guild?.name || guild?.id}: ${result.reason}`);
  return result;
}
async function fetchAuditExecutor(guild, auditType) {
  try {
    const logs = await guild.fetchAuditLogs({ type: auditType, limit: 1 });
    const entry = logs.entries.first();
    if (!entry || Date.now() - entry.createdTimestamp > 8_000) return null;
    return { id: entry.executor?.id || null, tag: entry.executor?.tag || null, bot: Boolean(entry.executor?.bot), entry };
  } catch (error) {
    console.warn('[AntiNuke] Failed to fetch audit executor:', error?.message || error); return null;
  }
}
async function createEmergencyBackup(guild, reason, stage) {
  try {
    const {
      createServerBackup,
      createBackupSummary,
    } = require('../restoreBackup/backup');

    if (typeof createServerBackup !== 'function') {
      return null;
    }

    // The full backup must remain in the dedicated backup file only.
    //
    // Never return/persist the complete backup object in Security incident
    // history. A full backup contains guildConfig, which itself contains
    // Security incident history. Persisting that object inside an incident
    // therefore creates recursive historical snapshots and exponential
    // guild-config growth.
    const backup = await createServerBackup(guild, {
      createdBy: 'Goliath Anti-Nuke',
      reason,
      stage,
      emergency: true,
      type: 'security_emergency',
    });

    if (!backup) {
      return null;
    }

    if (typeof createBackupSummary === 'function') {
      return createBackupSummary(backup);
    }

    // Defensive fallback: retain only lightweight reference metadata.
    return {
      backupId: backup.backupId || null,
      type: backup.type || backup.backupType || 'security_emergency',
      backupType: backup.backupType || backup.type || 'security_emergency',
      version: backup.version || null,
      createdAt: backup.createdAt || null,
      createdBy: backup.createdBy || null,
      reason: backup.reason || reason || null,
      environment: backup.environment || null,
      guildId: backup.guild?.id || guild?.id || null,
      guildName: backup.guild?.name || guild?.name || null,
      integrity: backup.integrity || null,
    };
  } catch (error) {
    console.error(
      '[AntiNuke] Emergency backup failed:',
      error?.stack || error?.message || error
    );

    return null;
  }
}
async function alertOwner(guild, incident) {
  try {
    const owner = await guild.fetchOwner().catch(() => null);
    if (!owner) return false;

    await owner.send(buildSecurityIncidentNotice({
      guild,
      owner,
      incident,
    }));

    return true;
  } catch (error) {
    console.error('[AntiNuke] Owner alert failed:', error); return false;
  }
}
async function emergencyLockdown(guild, reason) {
  if (!guild || getLockdownState(guild.id).active) return false;
  const config = getAntiNukeConfig(guild.id);
  const result = await enableLockdown(guild, { reason: reason || config.lockdown.reason, enabledBy: 'anti_nuke', enabledByTag: 'Goliath Anti-Nuke', severity: SEVERITY.CRITICAL, lockdownMode: 'emergency', durationMs: config.lockdown.durationMs });
  if (!result?.success) return false;
  await logIncident(guild, { type: INCIDENT_TYPES.EMERGENCY_LOCKDOWN, severity: SEVERITY.CRITICAL, reason, actionTaken: 'Emergency lockdown panic protection enabled.', metadata: { source: 'anti_nuke', protectedChannels: result.locked || 0, expiresAt: result.expiresAt || null } });
  return true;
}
async function quarantineMember(guild, member, config = {}, reason = '') {
  if (!guild || !member) return { success: false, reason: 'Missing guild or member.' };
  if (member.id === guild.ownerId) return { success: false, reason: 'Cannot quarantine the server owner.' };
  return quarantineSystemMember(guild, member, { reason: reason || config.quarantine?.reason || DEFAULT_CONFIG.quarantine.reason, quarantinedBy: 'anti_nuke', source: 'anti_nuke', roleName: config.quarantine?.roleName || QUARANTINE_ROLE_NAME, durationMs: normalizeDuration(config.quarantine?.durationMs || config.durationMs) });
}
function analyseIncident(type, metadata = {}) {
  return typeof calculateIncidentSeverity === 'function' ? calculateIncidentSeverity(type, metadata) : { severity: SEVERITY.HIGH, score: 0, recommendedActions: [] };
}
function getDangerousRolePermissions(role) {
  const flags = [PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.BanMembers, PermissionFlagsBits.KickMembers, PermissionFlagsBits.ManageWebhooks];
  return flags.filter((flag) => role.permissions.has(flag));
}
async function resolveExecutor(guild, auditType, config) {
  const executor = await fetchAuditExecutor(guild, auditType);
  if (!executor?.id || (config.ignoreBots && executor.bot)) return null;
  const member = await guild.members.fetch(executor.id).catch(() => null);
  if (isTrustedMember(member, config)) return null;
  return { executor, member };
}
async function maybeQuarantine(guild, member, config, reason) {
  if (!config.quarantine.enabled) return { success: false, reason: 'Quarantine is disabled.' };
  if (!member) return { success: false, reason: 'Executor member is unavailable.' };
  return quarantineMember(guild, member, config, reason);
}
async function maybeAlertOwner(guild, config, incident) {
  if (config.ownerAlerts.enabled) return alertOwner(guild, incident);
  return false;
}
function severityAtLeast(severity, minimum) {
  const order = { low: 0, medium: 1, high: 2, critical: 3 };
  return (order[String(severity || 'low').toLowerCase()] || 0) >= (order[String(minimum || 'low').toLowerCase()] || 0);
}
function actionSummary(result) {
  if (!result) return 'not attempted';
  if (result.success) return 'success';
  return `failed/skipped: ${result.reason || result.error || 'unknown'}`;
}

async function executeResponsePolicy({ guild, config, member, executor, analysis, incidentType, reason, target = null, targetType = null, metadata = {} }) {
  const severity = analysis?.severity || SEVERITY.LOW;
  const high = severityAtLeast(severity, SEVERITY.HIGH);
  const critical = severityAtLeast(severity, SEVERITY.CRITICAL);
  const response = {
    policy: severity,
    beforeBackup: null,
    quarantine: null,
    lockdown: null,
    invites: null,
    roles: null,
    ownerAlerted: false,
    afterBackup: null,
  };

  if (high && config.backups.beforeIncident) {
    response.beforeBackup = await createEmergencyBackup(guild, `Before automatic ${severity} response: ${incidentType}`, 'before_incident_response');
  }

  if (high) {
    response.quarantine = await maybeQuarantine(guild, member, config, reason);
  }

  if (critical) {
    const profile = getLockdownModeFromSeverity(severity);
    response.lockdown = config.lockdown.enabled
      ? await enableLockdown(guild, {
        reason: config.lockdown.reason,
        enabledBy: 'anti_nuke',
        enabledByTag: 'Goliath Anti-Nuke',
        severity,
        lockdownMode: profile.mode,
        slowmodeSeconds: profile.slowmodeSeconds,
        lockText: profile.lockText,
        lockVoice: profile.lockVoice,
        lockThreads: profile.lockThreads,
        lockCommands: profile.lockCommands,
        durationMs: config.lockdown.durationMs,
      })
      : { success: false, reason: 'Lockdown is disabled.' };

    if (config.emergencyControls.enabled && config.emergencyControls.disableInvites) {
      response.invites = await disableInvites(guild, {
        reason: `Critical Anti-Nuke response: ${reason}`,
        durationMs: config.emergencyControls.durationMs,
        trustedRoleIds: config.trustedRoleIds,
      });
    }
    if (config.emergencyControls.enabled && config.emergencyControls.freezeRoles) {
      response.roles = await freezeRoles(guild, {
        reason: `Critical Anti-Nuke response: ${reason}`,
        durationMs: config.emergencyControls.durationMs,
        trustedRoleIds: config.trustedRoleIds,
      });
    }
  }

  const actions = [];
  if (response.beforeBackup) actions.push('backup-before=created');
  if (response.quarantine) actions.push(`security-isolation=${actionSummary(response.quarantine)}`);
  if (response.lockdown) actions.push(`lockdown=${actionSummary(response.lockdown)}`);
  if (response.invites) actions.push(`invite-freeze=${actionSummary(response.invites)}`);
  if (response.roles) actions.push(`role-freeze=${actionSummary(response.roles)}`);
  if (!actions.length) actions.push(severity === SEVERITY.MEDIUM ? 'owner alert + monitoring' : 'logged + monitoring');

  const incident = await logIncident(guild, {
    type: incidentType,
    severity,
    actorId: executor?.id || null,
    actorTag: executor?.tag || null,
    targetId: target?.id || null,
    targetName: target?.name || null,
    targetType,
    reason,
    actionTaken: actions.join('; '),
    metadata: {
      ...metadata,
      severityScore: analysis?.score || 0,
      recommendedActions: analysis?.recommendedActions || [],
      automaticResponse: response,
    },
  });

  if (severityAtLeast(severity, SEVERITY.MEDIUM)) {
    response.ownerAlerted = await maybeAlertOwner(guild, config, incident);
  }

  if (critical && config.backups.afterIncident) {
    response.afterBackup = await createEmergencyBackup(guild, `After automatic critical response: ${incidentType}`, 'after_incident_response');
    if (response.afterBackup) {
      await logIncident(guild, {
        type: INCIDENT_TYPES.BACKUP_CREATED,
        severity: SEVERITY.HIGH,
        reason: 'Emergency after-incident backup created.',
        actionTaken: 'Backup created after automatic critical response.',
        metadata: { backupId: response.afterBackup.backupId || null, backupCreatedAt: response.afterBackup.createdAt || null, relatedIncidentId: incident.id },
      });
    }
  }
  return incident;
}

async function handleDeleteEvent({ guild, target, actionType, auditType, incidentType, massIncidentType }) {
  if (!guild?.id || !guildManager.isModuleEnabled(guild.id, 'security')) return null;
  const config = getAntiNukeConfig(guild.id);
  if (!config.enabled) return null;
  const capability = responseCapability(guild);
  const resolved = await resolveExecutor(guild, auditType, config);
  if (!resolved) return null;
  const { executor, member } = resolved;
  const threshold = actionType === 'channelDelete' ? config.thresholds.channelDelete : config.thresholds.roleDelete;
  const count = addAction(guild.id, executor.id, actionType, threshold.windowMs);

  if (count < threshold.maxActions) {
    return logIncident(guild, {
      type: incidentType,
      severity: SEVERITY.MEDIUM,
      actorId: executor.id,
      actorTag: executor.tag,
      targetId: target?.id || null,
      targetName: target?.name || null,
      targetType: actionType,
      reason: `${actionType} detected.`,
      actionTaken: 'Logged and monitoring action threshold.',
      metadata: { actionCount: count, threshold: threshold.maxActions, windowMs: threshold.windowMs, responseCapability: capability },
    });
  }

  const analysis = analyseIncident(massIncidentType, { actionCount: count, threshold: threshold.maxActions, actorIsBot: executor.bot, actorTrusted: false });
  return executeResponsePolicy({
    guild, config, member, executor, analysis, incidentType: massIncidentType,
    reason: `Mass ${actionType} detected.`, target, targetType: actionType,
    metadata: { actionCount: count, threshold: threshold.maxActions, windowMs: threshold.windowMs, responseCapability: capability },
  });
}

async function handleChannelDelete(channel) { return handleDeleteEvent({ guild: channel.guild, target: channel, actionType: 'channelDelete', auditType: AuditLogEvent.ChannelDelete, incidentType: INCIDENT_TYPES.CHANNEL_DELETE, massIncidentType: INCIDENT_TYPES.MASS_CHANNEL_DELETE }); }
async function handleRoleDelete(role) { return handleDeleteEvent({ guild: role.guild, target: role, actionType: 'roleDelete', auditType: AuditLogEvent.RoleDelete, incidentType: INCIDENT_TYPES.ROLE_DELETE, massIncidentType: INCIDENT_TYPES.MASS_ROLE_DELETE }); }

async function handleRoleCreate(role) {
  const guild = role?.guild; if (!guild?.id || !guildManager.isModuleEnabled(guild.id, 'security')) return null;
  const config = getAntiNukeConfig(guild.id); if (!config.enabled) return null;
  const capability = responseCapability(guild);
  const resolved = await resolveExecutor(guild, AuditLogEvent.RoleCreate, config); if (!resolved) return null;
  const dangerous = getDangerousRolePermissions(role); if (!dangerous.length) return null;
  const incidentType = INCIDENT_TYPES.DANGEROUS_ROLE_CREATE || 'dangerous_role_create';
  const analysis = analyseIncident(incidentType, { dangerousPermissionCount: dangerous.length, actorIsBot: resolved.executor.bot, actorTrusted: false });
  return executeResponsePolicy({ guild, config, member: resolved.member, executor: resolved.executor, analysis, incidentType, reason: 'Dangerous role created.', target: role, targetType: 'role', metadata: { dangerousPermissionCount: dangerous.length, responseCapability: capability } });
}

async function handleRoleUpdate(oldRole, newRole) {
  const guild = newRole?.guild; if (!guild?.id || !guildManager.isModuleEnabled(guild.id, 'security')) return null;
  const config = getAntiNukeConfig(guild.id); if (!config.enabled) return null;
  const capability = responseCapability(guild);
  const resolved = await resolveExecutor(guild, AuditLogEvent.RoleUpdate, config); if (!resolved) return null;
  const added = getDangerousRolePermissions(newRole).filter((flag) => !oldRole.permissions.has(flag)); if (!added.length) return null;
  const incidentType = INCIDENT_TYPES.DANGEROUS_ROLE_PERMISSION_ADDED || 'dangerous_role_permission_added';
  const analysis = analyseIncident(incidentType, { dangerousPermissionCount: added.length, actorIsBot: resolved.executor.bot, actorTrusted: false });
  return executeResponsePolicy({ guild, config, member: resolved.member, executor: resolved.executor, analysis, incidentType, reason: 'Dangerous permissions were added to an existing role.', target: newRole, targetType: 'role', metadata: { addedPermissionCount: added.length, responseCapability: capability } });
}

async function handleWebhookCreate(webhook) { return handleWebhookObject(webhook, AuditLogEvent.WebhookCreate, INCIDENT_TYPES.WEBHOOK_CREATE || 'webhook_create', 'Webhook creation detected.'); }
async function handleWebhookDelete(webhook) { return handleWebhookObject(webhook, AuditLogEvent.WebhookDelete, INCIDENT_TYPES.WEBHOOK_DELETE || 'webhook_delete', 'Webhook deletion detected.'); }
async function handleWebhookObject(webhook, auditType, incidentType, reason) {
  const guild = webhook?.guild; if (!guild?.id || !guildManager.isModuleEnabled(guild.id, 'security')) return null;
  const config = getAntiNukeConfig(guild.id); if (!config.enabled) return null;
  const capability = responseCapability(guild);
  const resolved = await resolveExecutor(guild, auditType, config); if (!resolved) return null;
  const analysis = analyseIncident(incidentType, { actionCount: 1, actorIsBot: resolved.executor.bot, actorTrusted: false });
  return executeResponsePolicy({ guild, config, member: resolved.member, executor: resolved.executor, analysis, incidentType, reason, target: webhook, targetType: 'webhook', metadata: { responseCapability: capability } });
}

async function handleWebhookUpdate(channel) {
  const guild = channel?.guild; if (!guild?.id || !guildManager.isModuleEnabled(guild.id, 'security')) return null;
  const config = getAntiNukeConfig(guild.id); if (!config.enabled) return null;
  const capability = responseCapability(guild);
  let resolved = null;
  for (const auditType of [AuditLogEvent.WebhookCreate, AuditLogEvent.WebhookUpdate, AuditLogEvent.WebhookDelete]) {
    resolved = await resolveExecutor(guild, auditType, config); if (resolved) break;
  }
  if (!resolved) return null;
  const incidentType = INCIDENT_TYPES.SUSPICIOUS_WEBHOOK_ACTIVITY || INCIDENT_TYPES.WEBHOOK_UPDATE || 'suspicious_webhook_activity';
  const analysis = analyseIncident(incidentType, { actionCount: 1, actorIsBot: resolved.executor.bot, actorTrusted: false });
  return executeResponsePolicy({ guild, config, member: resolved.member, executor: resolved.executor, analysis, incidentType, reason: `Webhook activity detected in #${channel.name}.`, target: channel, targetType: 'webhook_channel', metadata: { auditAction: resolved.executor.entry?.action || null, responseCapability: capability } });
}

module.exports = {
  DEFAULT_CONFIG,
  QUARANTINE_ROLE_NAME,
  DEFAULT_RESPONSE_DURATION_MS,
  getAntiNukeConfig,
  executeResponsePolicy,
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
