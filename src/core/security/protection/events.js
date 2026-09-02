'use strict';

const schedulerRegistry = require('../../../owner/sentinel/schedulerRegistry');

const SEVERITY = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
};

const INCIDENT_TYPES = {
  CHANNEL_DELETE: 'channel_delete',
  ROLE_DELETE: 'role_delete',
  MASS_CHANNEL_DELETE: 'mass_channel_delete',
  MASS_ROLE_DELETE: 'mass_role_delete',
  LOCKDOWN_ENABLED: 'lockdown_enabled',
  LOCKDOWN_DISABLED: 'lockdown_disabled',
  LOCKDOWN_RECOVERY_RESTORED: 'lockdown_recovery_restored',
  EMERGENCY_LOCKDOWN: 'emergency_lockdown',
  MEMBER_QUARANTINED: 'member_quarantined',
  DANGEROUS_ROLE_PERMISSION_ADDED: 'dangerous_role_permission_added',
  DANGEROUS_ROLE_PERMISSION_REMOVED: 'dangerous_role_permission_removed',
  DANGEROUS_ROLE_CREATE: 'dangerous_role_create',
  WEBHOOK_UPDATE: 'webhook_update',
  WEBHOOK_CREATE: 'webhook_create',
  WEBHOOK_DELETE: 'webhook_delete',
  SUSPICIOUS_WEBHOOK_ACTIVITY: 'suspicious_webhook_activity',
  OWNER_ESCALATION: 'owner_escalation',
  BACKUP_CREATED: 'backup_created',
  RESTORE_ACTION: 'restore_action',
  SUSPICIOUS_ADMIN_ACTION: 'suspicious_admin_action',
};

function getRecommendedIncidentActions(score, type, metadata = {}) {
  const actions = [];
  if (score >= 25) actions.push('Log incident');
  if (score >= 50) actions.push('Notify guild owner');
  if (score >= 60) actions.push('Create emergency backup');
  if (score >= 70) actions.push('Quarantine actor');
  if (score >= 80) actions.push('Enable emergency lockdown');
  if (String(type).includes('webhook')) actions.push('Review webhooks');
  if (metadata.dangerousPermissionCount > 0) actions.push('Review dangerous permissions');
  return [...new Set(actions)];
}

function calculateIncidentSeverity(type, metadata = {}) {
  const incidentType = String(type || '');
  let score = 0;
  if (incidentType.includes('mass')) score += 40;
  if (incidentType.includes('delete')) score += 25;
  if (incidentType.includes('webhook')) score += 20;
  if (incidentType.includes('dangerous_role')) score += 30;
  if (incidentType.includes('lockdown')) score += 50;
  score += Number(metadata.actionCount || 0) * 10;
  score += Number(metadata.dangerousPermissionCount || 0) * 15;
  if (metadata.actorIsBot) score += 10;
  if (metadata.actorTrusted === false) score += 15;
  if (metadata.rollbackAvailable === false) score += 20;
  let severity = SEVERITY.LOW;
  if (score >= 80) severity = SEVERITY.CRITICAL;
  else if (score >= 50) severity = SEVERITY.HIGH;
  else if (score >= 25) severity = SEVERITY.MEDIUM;
  return {
    score,
    severity,
    recommendedActions: getRecommendedIncidentActions(score, incidentType, metadata),
  };
}

const ACTION_BUCKET_CLEANUP_MS = 60_000;
const ACTION_BUCKET_SCHEDULER_ID = 'security:protection-event-bucket-cleanup:global';
const actionBuckets = new Map();

schedulerRegistry.register({
  id: ACTION_BUCKET_SCHEDULER_ID,
  module: 'security',
  component: 'protection-event-bucket-cleanup',
  intervalMs: ACTION_BUCKET_CLEANUP_MS,
  staleAfterMs: ACTION_BUCKET_CLEANUP_MS * 3,
});

const cleanupTimer = setInterval(() => {
  try {
    const now = Date.now();
    const before = actionBuckets.size;
    for (const [key, timestamps] of actionBuckets.entries()) {
      const fresh = timestamps.filter((timestamp) => now - timestamp < ACTION_BUCKET_CLEANUP_MS);
      if (fresh.length) actionBuckets.set(key, fresh);
      else actionBuckets.delete(key);
    }
    schedulerRegistry.beat(ACTION_BUCKET_SCHEDULER_ID, {
      bucketsBefore: before,
      bucketsAfter: actionBuckets.size,
      bucketsRemoved: Math.max(0, before - actionBuckets.size),
    });
  } catch (error) {
    schedulerRegistry.fail(ACTION_BUCKET_SCHEDULER_ID, error, { buckets: actionBuckets.size });
    console.warn('[SecurityEvents] Action bucket cleanup failed:', error?.message || error);
  }
}, ACTION_BUCKET_CLEANUP_MS);
cleanupTimer.unref?.();

function bucketKey(guildId, userId, actionType) {
  return `${guildId}:${userId}:${actionType}`;
}

function addAction(guildId, userId, actionType, windowMs) {
  const key = bucketKey(guildId, userId, actionType);
  const now = Date.now();
  const existing = actionBuckets.get(key) || [];
  const fresh = existing.filter((timestamp) => now - timestamp <= windowMs);
  fresh.push(now);
  actionBuckets.set(key, fresh);
  return fresh.length;
}

async function fetchAuditExecutor(guild, auditType) {
  try {
    const logs = await guild.fetchAuditLogs({ type: auditType, limit: 1 });
    const entry = logs.entries.first();
    if (!entry) return null;
    if (Date.now() - entry.createdTimestamp >= 8000) return null;
    return {
      id: entry.executor?.id || null,
      tag: entry.executor?.tag || null,
      bot: Boolean(entry.executor?.bot),
      entry,
    };
  } catch {
    return null;
  }
}

module.exports = {
  SEVERITY,
  INCIDENT_TYPES,
  calculateIncidentSeverity,
  getRecommendedIncidentActions,
  addAction,
  fetchAuditExecutor,
};
