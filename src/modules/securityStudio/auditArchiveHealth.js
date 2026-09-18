'use strict';

const archiveStore = require('../../owner/auditIntelligence/auditArchiveStore');

const WARNING_RATIO = 0.80;
const CRITICAL_RATIO = 0.95;

async function buildHealthReport() {
  let cleanup = null;
  try { cleanup = archiveStore.maybeCleanup(); }
  catch (error) { return { healthy: false, ok: false, status: 'cleanup-failed', summary: 'Audit archive housekeeping failed.', issues: [String(error?.message || error).slice(0, 500)] }; }

  const stats = archiveStore.storageStats();
  const ratio = stats.maxBytes ? stats.bytes / stats.maxBytes : 0;
  const failures = cleanup?.failures?.length || stats.lastCleanupResult?.failures?.length || 0;
  const issues = [];
  if (failures) issues.push(`${failures} audit archive cleanup operation(s) failed.`);
  if (ratio >= CRITICAL_RATIO) issues.push('Audit event archives are at or above 95% of their configured safety ceiling.');
  else if (ratio >= WARNING_RATIO) issues.push('Audit event archives are at or above 80% of their configured safety ceiling.');

  return { healthy: issues.length === 0, ok: issues.length === 0, status: ratio >= CRITICAL_RATIO ? 'critical' : ratio >= WARNING_RATIO ? 'warning' : 'healthy', summary: `${stats.files} monthly audit archive(s) · ${stats.megabytes} MB · retention ${stats.retentionMonths} month(s)`, issues, storage: stats, cleanup };
}

module.exports = { buildHealthReport };
