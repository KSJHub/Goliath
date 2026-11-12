'use strict';

// Pre-execution checklist only. Never calls Discord APIs, applies changes or creates backups.
const { createHash } = require('node:crypto');

// Stable offline transaction preview. Fingerprints identify a proposal but are NOT approvals.
function buildTransactionManifest({ draft, audit, preview, currentDigest }) {
  if (!draft || !audit?.guild?.id || !Array.isArray(preview?.operations) ||
      preview.operations.length > 350 || draft.environment !== audit.environment ||
      String(draft.guildId) !== String(audit.guild.id) ||
      preview.environment !== audit.environment ||
      String(preview.guild?.id) !== String(audit.guild.id) ||
      !/^[a-f0-9]{64}$/.test(String(currentDigest || '')) ||
      draft.auditDigest !== currentDigest) {
    return {
      readOnly: true, executable: false, canExecute: false, unavailable: true,
      reason: 'The plan, operation list, guild scope or audit fingerprint is invalid or stale.',
      entries: [], operationCount: 0, warnings: []
    };
  }
  const supportedKinds = new Set(['create_category', 'create_channel', 'rename_category', 'edit_channel']);
  const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const creates = new Map();
  const warnings = [];
  const entries = preview.operations.map((operation, index) => {
    const sequence = index + 1;
    const prior = operation.before ?? null;
    const proposed = operation.after ?? null;
    const kind = String(operation.kind || '');
    const issues = [];
    const dependsOn = [];
    if (!supportedKinds.has(kind) || operation.executable !== false)
      issues.push('Unsupported or non-read-only operation in preview.');
    if ((kind === 'edit_channel' || kind === 'rename_category') && !operation.target?.id)
      issues.push('Existing Discord object ID is missing.');
    if ((kind === 'edit_channel' || kind === 'rename_category') &&
        (!prior || typeof prior !== 'object' || !Object.keys(prior).length))
      issues.push('Original fields are missing.');
    if (kind === 'create_channel' && proposed?.parentId == null && proposed?.parentName) {
      const parentSequence = creates.get(proposed.parentName);
      if (parentSequence) dependsOn.push(parentSequence);
      else issues.push('Proposed parent category cannot be resolved from earlier operations.');
    }
    if (kind === 'create_category') {
      if (creates.has(proposed?.name)) issues.push('Duplicate new category name.');
      else creates.set(proposed?.name, sequence);
    }
    if ((kind === 'create_channel' || kind === 'create_category') &&
        (!proposed?.name || !Number.isInteger(proposed.type)))
      issues.push('New object name or Discord type is missing.');
    if (issues.length) warnings.push('Operation ' + sequence + ': ' + issues.join(' '));
    return {
      sequence, kind, target: operation.target ?? null,
      before: prior, proposed,
      dependsOn, issues,
      operationFingerprint: digest({
        draftId: draft.id, environment: draft.environment, guildId: draft.guildId,
        auditDigest: currentDigest, sequence, kind, target: operation.target ?? null,
        before: prior, proposed, dependsOn
      }),
      authorised: false, executable: false
    };
  });
  const fingerprint = digest({
    draftId: draft.id, environment: draft.environment, guildId: draft.guildId,
    auditDigest: currentDigest, blueprint: draft.blueprint,
    entries: entries.map(item => item.operationFingerprint)
  });
  return {
    readOnly: true, executable: false, canExecute: false, unavailable: false,
    draftId: draft.id, environment: draft.environment, guildId: draft.guildId,
    auditDigest: currentDigest, fingerprint, entries,
    operationCount: entries.length, warnings,
    requiresFreshAudit: true, requiresSeparateExecutionApproval: true,
    notice: 'Deterministic dry-run manifest only. No Discord changes, backup or execution authorisation occurred.'
  };
}

// Recovery planning describes prerequisites only; it never performs a reverse action.
const RECOVERY_KIND = Object.freeze({
  rename_category: 'restore_original_name',
  edit_channel: 'restore_original_fields',
  create_channel: 'manual_review_new_channel',
  create_category: 'manual_review_new_category'
});
function buildRecoveryPlan({ draft, audit, preview, currentDigest }) {
  if (!draft || !audit?.guild?.id || !Array.isArray(preview?.operations) ||
      draft.environment !== audit.environment || String(draft.guildId) !== String(audit.guild.id) ||
      preview.environment !== audit.environment ||
      String(preview.guild?.id) !== String(audit.guild.id) ||
      typeof currentDigest !== 'string' || !/^[a-f0-9]{64}$/.test(currentDigest)) {
    throw new Error('Recovery plan requires an exact scoped guild and valid fresh audit identity.');
  }
  const stale = draft.auditDigest !== currentDigest;
  const items = preview.operations.map((operation, index) => {
    const kind = operation.kind;
    const target = operation.target || {};
    const before = operation.before ?? null;
    const after = operation.after ?? null;
    const supported = Object.hasOwn(RECOVERY_KIND, kind);
    const needsOriginalFields = kind === 'rename_category' || kind === 'edit_channel';
    const originalFieldsAvailable = !needsOriginalFields ||
      (before && typeof before === 'object' && Object.keys(before).length > 0);
    const issues = [];
    if (!supported) issues.push('Unknown operation type; rollback definition is unavailable.');
    if (needsOriginalFields && !originalFieldsAvailable)
      issues.push('Original fields are missing; a compensating edit cannot be described safely.');
    if (kind === 'create_category' || kind === 'create_channel')
      issues.push('Deletion is not an automatic rollback: new messages or configuration could be lost.');
    if (kind === 'edit_channel' && after?.parentId !== undefined)
      issues.push('Reparenting may change inherited channel permissions and access.');
    if (kind === 'create_channel' && !after?.parentId && after?.parentName)
      issues.push('Parent category is referenced by name; generated Discord ID must be recorded after creation.');
    return {
      sequence: index + 1, kind, target, before, proposed: after,
      recoveryType: supported ? RECOVERY_KIND[kind] : 'undefined',
      recoveryDescription: needsOriginalFields
        ? 'A future operator must verify the current target and restore captured original fields.'
        : 'A future operator must inspect the newly created object and decide whether to retain it.',
      issues, automaticRollbackSupported: false, verified: false, executable: false
    };
  });
  return {
    readOnly: true, executable: false, canRollback: false,
    environment: draft.environment, guildId: draft.guildId, draftId: draft.id,
    savedAuditDigest: draft.auditDigest, currentAuditDigest: currentDigest,
    stale, generatedAt: new Date().toISOString(),
    recoveryOrder: 'reverse-of-completed-operations-after-manual-review',
    items, operationCount: items.length,
    backupVerification: 'not-performed', rollbackTested: false,
    requiredBeforeExecution: [
      'Verified restorable backup from the exact environment and guild',
      'Capture the IDs and original fields of every affected Discord object',
      'Explicit time-limited execution authorisation independent of review acknowledgements',
      'Tested compensating actions and irreversible-data-loss warnings',
      'Fresh guild and bot permission checks immediately before every write'
    ],
    notice: 'Recovery analysis only: no backup, restoration, execution, or automated rollback was performed.'
  };
}

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
  // A cross-guild or malformed snapshot must produce a BLOCKED diagnostic,
  // not crash the readiness endpoint or generate a recovery proposal.
  const transactionManifest = buildTransactionManifest({ draft, audit, preview, currentDigest });
  const recoveryPlan = sameTarget && /^[a-f0-9]{64}$/.test(String(currentDigest || ''))
    ? buildRecoveryPlan({ draft, audit, preview, currentDigest })
    : {
        readOnly: true, executable: false, canRollback: false,
        rollbackTested: false, unavailable: true,
        environment: draft.environment, guildId: draft.guildId,
        draftId: draft.id, stale: true, items: [], operationCount: 0,
        requiredBeforeExecution: [],
        notice: 'Recovery planning blocked: guild scope or audit fingerprint is invalid.'
      };
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
    recoveryPlan, transactionManifest,
    checks, blockers: checks.filter(item => item.state !== 'passed').map(item => item.key),
    notice: 'Diagnostic checklist only. No approval, backup or Discord write has occurred.'
  };
}
module.exports = { evaluateReadiness, buildRecoveryPlan, buildTransactionManifest };
