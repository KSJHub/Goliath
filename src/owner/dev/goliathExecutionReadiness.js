'use strict';

// Pre-execution checklist only. Never calls Discord APIs, applies changes or creates backups.
// A reviewed draft is NOT an authorisation to execute.
function evaluateReadiness({ draft, audit, currentDigest, preview, botCapabilities = null, backupEvidence = null }) {
  if (!draft || !audit || !preview || !Array.isArray(preview.operations)) {
    throw new Error('A saved draft, verified audit and fresh preview are required.');
  }
  const sameTarget = draft.environment === audit.environment &&
    String(draft.guildId) === String(audit.guild?.id);
  const snapshotMatches = typeof currentDigest === 'string' &&
    currentDigest.length === 64 && currentDigest === draft.auditDigest;
  const reviewed = draft.review?.status === 'reviewed';
  const operations = preview.operations.map((operation, index) => ({
    sequence: index + 1,
    kind: operation.kind,
    target: operation.target,
    before: operation.before ?? null,
    proposed: operation.after ?? null,
    needsOwnerApproval: true,
    needsRollbackStrategy: true,
    executable: false
  }));
  const checks = [
    { key: 'owner_scope', label: 'Owner identity and target', state: sameTarget ? 'passed' : 'blocked',
      detail: sameTarget ? 'Environment and guild IDs match the stored draft.' : 'Saved draft and audit target differ.' },
    { key: 'fresh_audit', label: 'Current Discord snapshot', state: snapshotMatches ? 'passed' : 'blocked',
      detail: snapshotMatches ? 'Saved fingerprint matches the freshly fetched guild structure.' : 'Guild state changed or audit fingerprint is missing.' },
    { key: 'owner_review', label: 'Developer reviewed plan', state: reviewed ? 'passed' : 'blocked',
      detail: reviewed ? 'Draft was marked reviewed. This is not execution approval.' : 'Draft has not been reviewed.' },
    { key: 'bot_permissions', label: 'Bot permission and hierarchy validation', state: 'pending',
      detail: !botCapabilities?.permissionsVerified ? 'Bot permission evidence is unavailable or mismatched.' :
        botCapabilities.counts?.blocked ? botCapabilities.counts.blocked + ' operations are blocked by preflight checks.' :
        botCapabilities.counts?.unknown ? botCapabilities.counts.unknown + ' operations still have unknown capabilities.' :
        'Read-only channel permission preflight found no obvious blockers; role hierarchy, Discord API failures and runtime changes still require revalidation.' },
    { key: 'backup', label: 'Verified restore point', state: 'pending',
      detail: backupEvidence?.status === 'candidate-found'
        ? 'Existing backup candidate found, but integrity and rollback must still be verified before execution.'
        : backupEvidence?.status === 'none-found'
          ? 'No matching backup candidate was found in recent backup history.'
          : 'Backup evidence is unavailable; no integrity check or rollback proof is attached.' },
    { key: 'per_operation_approval', label: 'Explicit approval of each operation', state: 'pending',
      detail: 'No signed, time-limited and guild-scoped operation approvals exist yet.' },
    { key: 'rollback', label: 'Rollback and failure recovery', state: 'pending',
      detail: 'No tested rollback procedure is linked to this plan.' },
    { key: 'execution_engine', label: 'Discord execution engine', state: 'disabled',
      detail: 'No Discord mutation executor is enabled in Goliath AI.' }
  ];
  return {
    readOnly: true, executable: false, canExecute: false,
    environment: draft.environment, guildId: draft.guildId, guildName: draft.guildName,
    draftId: draft.id, auditDigest: currentDigest, savedAuditDigest: draft.auditDigest,
    generatedAt: new Date().toISOString(), operationCount: operations.length, operations,
    backupEvidence: backupEvidence || { status: 'unavailable', candidates: [], checkedAt: null },
    checks, blockers: checks.filter(item => item.state !== 'passed').map(item => item.key),
    notice: 'Diagnostic checklist only. No approval, backup or Discord write has occurred.'
  };
}
module.exports = { evaluateReadiness };
