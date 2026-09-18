'use strict';

const evidenceStore = require('../../owner/auditIntelligence/messageEvidenceStore');

const WARNING_RATIO = 0.80;
const CRITICAL_RATIO = 0.95;

async function buildHealthReport() {
  let cleanup = null;
  try {
    cleanup = evidenceStore.maybeCleanup();
  } catch (error) {
    return {
      healthy: false,
      status: 'cleanup-failed',
      summary: 'Message evidence housekeeping failed.',
      issues: [String(error?.message || error).slice(0, 500)],
    };
  }

  const stats = evidenceStore.storageStats();
  const fileRatio = stats.maxFiles ? stats.files / stats.maxFiles : 0;
  const byteRatio = stats.maxBytes ? stats.bytes / stats.maxBytes : 0;
  const ratio = Math.max(fileRatio, byteRatio);
  const cleanupFailures = cleanup?.failures?.length || stats.lastCleanupResult?.failures?.length || 0;
  const issues = [];

  if (cleanupFailures) issues.push(`${cleanupFailures} evidence cleanup operation(s) failed.`);
  if (ratio >= CRITICAL_RATIO) issues.push('Evidence storage is at or above 95% of its configured safety ceiling.');
  else if (ratio >= WARNING_RATIO) issues.push('Evidence storage is at or above 80% of its configured safety ceiling.');

  return {
    healthy: issues.length === 0,
    ok: issues.length === 0,
    status: ratio >= CRITICAL_RATIO ? 'critical' : ratio >= WARNING_RATIO ? 'warning' : 'healthy',
    summary: `${stats.files} evidence file(s) · ${stats.megabytes} MB · retention ${stats.retentionDays} day(s)`,
    issues,
    storage: stats,
    cleanup,
  };
}

module.exports = { buildHealthReport };
