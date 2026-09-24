'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const {
  db,
  createCase,
  getCaseById,
  getCasesForUser,
  getAllCases,
  recordCaseAudit,
  emitCaseUpdated,
  claimProceedingOperationAtomic,
} = require('./storage');
const { canUseModAction } = require('./permissions');
const { executeEnginePunishment } = require('./punishments');
const { createWarningCaseAtomic } = require('./warns');
const { quarantineMember } = require('../../security/protection/quarantine');

const PROCEEDING_ACTION = 'case';
const SEVERITY = Object.freeze({
  1: 'Low',
  2: 'Medium',
  3: 'High',
  4: 'Severe',
  5: 'Critical',
});
const STAGES = Object.freeze({
  investigation: '🔎 Under Investigation',
  review: '📥 Awaiting Review',
  decided: '✅ Decision Recorded',
  published: '📜 Published',
  closed: '🔒 Closed',
});
const EVIDENCE_STATUS = Object.freeze({ draft: '🟡 Draft', verified: '🟢 Verified', rejected: '🔴 Rejected' });
const PROCEEDING_EXECUTION_LOCKS = new Set();
const PROCEEDING_EXECUTION_STALE_MS = 5 * 60 * 1000;

function now() { return new Date().toISOString(); }
function parseProceeding(modCase = {}) {
  const metadata = modCase.metadata && typeof modCase.metadata === 'object' ? modCase.metadata : {};
  const proceeding = metadata.proceeding && typeof metadata.proceeding === 'object' ? metadata.proceeding : {};
  return {
    stage: proceeding.stage || 'investigation',
    severity: Math.min(5, Math.max(1, Number(proceeding.severity) || 1)),
    title: String(proceeding.title || proceeding.allegations || modCase.reason || `Case #${modCase.caseId || '?'}`).replace(/\s+/g, ' ').trim().slice(0, 100),
    allegations: String(proceeding.allegations || modCase.reason || '').slice(0, 3000),
    leadModeratorId: proceeding.leadModeratorId || modCase.moderatorId || null,
    reviewingAdminId: proceeding.reviewingAdminId || null,
    evidence: Array.isArray(proceeding.evidence) ? proceeding.evidence : [],
    notes: Array.isArray(proceeding.notes) ? proceeding.notes : [],
    linkedCases: Array.isArray(proceeding.linkedCases) ? proceeding.linkedCases : [],
    recommendation: proceeding.recommendation || null,
    decision: proceeding.decision || null,
    publication: proceeding.publication || null,
    submittedForReviewAt: proceeding.submittedForReviewAt || null,
    submittedForReviewBy: proceeding.submittedForReviewBy || null,
    reviewClaimedAt: proceeding.reviewClaimedAt || null,
    closedAt: proceeding.closedAt || null,
    closedBy: proceeding.closedBy || null,
    closeReason: proceeding.closeReason || null,
    previousStage: proceeding.previousStage || null,
    decisionHistory: Array.isArray(proceeding.decisionHistory) ? proceeding.decisionHistory : [],
    publicationHistory: Array.isArray(proceeding.publicationHistory) ? proceeding.publicationHistory : [],
    sanctionReview: proceeding.sanctionReview && typeof proceeding.sanctionReview === 'object' ? proceeding.sanctionReview : null,
    sanctionExecution: proceeding.sanctionExecution && typeof proceeding.sanctionExecution === 'object' ? proceeding.sanctionExecution : null,
  };
}
function saveProceeding(guildId, caseId, proceeding, actorId, event, beforeProceeding = null) {
  const current = getCaseById(guildId, caseId);
  if (!current) return null;
  const metadata = { ...(current.metadata || {}), proceeding };
  const updatedAt = now();
  const result = db.prepare('UPDATE cases SET metadata = ?, updated_at = ? WHERE guild_id = ? AND case_id = ?')
    .run(JSON.stringify(metadata), updatedAt, String(guildId), Number(caseId));
  if (!result.changes) return null;
  const updated = getCaseById(guildId, caseId);
  recordCaseAudit({ guildId, caseId, actorId, event, before: beforeProceeding, after: proceeding, metadata: { proceeding: true } });
  emitCaseUpdated(guildId, updated);
  return updated;
}
function severityText(value) { const n = Math.min(5, Math.max(1, Number(value) || 1)); return SEVERITY[n]; }
function parseSeverityInput(value) {
  const raw = String(value || '').trim().toLowerCase();
  const aliases = { '1': 1, low: 1, '2': 2, medium: 2, moderate: 2, '3': 3, high: 3, '4': 4, severe: 4, '5': 5, critical: 5 };
  return aliases[raw] || null;
}
function stageText(stage) { return STAGES[stage] || STAGES.investigation; }
function discordTime(value, style = 'R') {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) && ms > 0 ? `<t:${Math.floor(ms / 1000)}:${style}>` : 'Unknown';
}
function row(...items) { return new ActionRowBuilder().addComponents(...items); }
function button(id, label, emoji, style = ButtonStyle.Secondary, disabled = false) {
  const item = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
  if (emoji) item.setEmoji(emoji);
  return item;
}
function modalInput(id, label, style = TextInputStyle.Paragraph, required = true, maxLength = 1000, placeholder = null, value = null) {
  const input = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setMaxLength(maxLength);
  if (placeholder) input.setPlaceholder(placeholder);
  if (value) input.setValue(String(value).slice(0, maxLength));
  return row(input);
}
function caseIsProceeding(modCase) { return Boolean(modCase && (modCase.action === PROCEEDING_ACTION || modCase.metadata?.proceeding)); }
function getProceedingAppeals(modCase = {}) { return Array.isArray(modCase?.metadata?.appeals) ? modCase.metadata.appeals.filter((appeal) => appeal && typeof appeal === 'object' && appeal.id) : []; }
function latestProceedingAppeal(modCase = {}) { return getProceedingAppeals(modCase).slice().sort((a, b) => String(b.submittedAt || '').localeCompare(String(a.submittedAt || '')))[0] || null; }
function appealStatusText(appeal) { if (!appeal) return 'No appeal submitted.'; return appeal.status === 'approved' ? '✅ Approved' : appeal.status === 'denied' ? '❌ Denied' : '⏳ Pending review'; }
function proceedingExecutionLockKey(guildId, caseId) { return `${guildId}:${caseId}`; }
function executionIsStale(execution) { if (!execution || execution.status !== 'executing') return false; const started = new Date(execution.startedAt || execution.claimedAt || 0).getTime(); return !Number.isFinite(started) || Date.now() - started > PROCEEDING_EXECUTION_STALE_MS; }
function getProceedingCases(guildId, userId = null) {
  const cases = userId ? getCasesForUser(guildId, userId) : getAllCases(guildId);
  return (cases || []).filter(caseIsProceeding);
}
function proceedingCounts(cases = []) {
  const counts = { investigation: 0, review: 0, decided: 0, published: 0, closed: 0 };
  for (const modCase of cases) counts[parseProceeding(modCase).stage] = (counts[parseProceeding(modCase).stage] || 0) + 1;
  return counts;
}
function cleanExcerpt(value, max = 220) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
function staffBackRow(targetId) { return row(button(`mod_proceeding_back:${targetId}`, 'Back', '⬅️')); }
function caseManagementNavigationRow(interaction, targetId) {
  return row(button(`mod_dashboard:${targetId}:actions`, 'Back', '⬅️'));
}
function caseFileBackRow(caseId) { return row(button(`mod_proceeding_file:${caseId}`, 'Back', '⬅️')); }
function canDeleteProceeding(interaction) { return canUseModAction(interaction.member, interaction.guild, 'proceeding_delete', interaction); }
function caseFileNavigationRow(interaction, modCase) {
  return row(button(`mod_proceeding_back:${modCase.userId}`, 'Back', '⬅️'));
}
function auditRows(guildId, caseId, limit = 25) {
  try { return db.prepare('SELECT actor_id, event, after_value, metadata, created_at FROM case_audit WHERE guild_id = ? AND case_id = ? ORDER BY audit_id DESC LIMIT ?').all(String(guildId), Number(caseId), Math.max(1, Math.min(50, Number(limit) || 25))); }
  catch { return []; }
}

function buildProceedingDashboard(interaction, target) {
  const cases = target ? getProceedingCases(interaction.guildId, target.id) : [];
  const counts = proceedingCounts(cases);
  const latest = cases.slice(0, 5);
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(target ? `📂 Case Management • ${target.displayName || target.user.globalName || target.user.username || target.user.tag}` : '📂 Case Management')
    .setDescription(target
      ? ['Build the internal case file here. Only a **published record** is visible to the member.', '', `**Subject:** ${target.user} • \`${target.id}\``].join('\n')
      : 'Select a member to open their case-management workspace.')
    .addFields(
      { name: '🔎 Investigating', value: `**${counts.investigation}**`, inline: true },
      { name: '⚖️ Review Queue', value: `**${counts.review}**`, inline: true },
      { name: '📜 Published', value: `**${counts.published}**`, inline: true },
      { name: 'Case Workflow', value: 'Investigation → Review → Decision → Published record → Appeal', inline: false },
    )
    .setFooter({ text: 'Private staff workspace • unpublished work is never shown to the member' })
    .setTimestamp();
  if (latest.length) embed.addFields({
    name: 'Recent Case Files',
    value: latest.map((entry) => {
      const proceeding = parseProceeding(entry);
      return `**${cleanExcerpt(proceeding.title, 78)}** • Case #${entry.caseId}\n${stageText(proceeding.stage)} • Severity **${severityText(proceeding.severity)}**`;
    }).join('\n\n').slice(0, 1024),
    inline: false,
  });

  const components = [];
  if (target) {
    if (cases.length) components.push(row(new StringSelectMenuBuilder()
      .setCustomId(`mod_proceeding_open:${target.id}`)
      .setPlaceholder('📂 Open a case file')
      .addOptions(cases.slice(0, 25).map((entry) => {
        const proceeding = parseProceeding(entry);
        const memberName = target.displayName || target.user?.globalName || target.user?.username || 'Unknown Member';
        const caseTitle = cleanExcerpt(proceeding.title || proceeding.allegations || entry.reason || 'Untitled Case', 42);
        return {
          label: cleanExcerpt(`${memberName} • ${target.id} • ${caseTitle}`, 100),
          description: cleanExcerpt(`Case #${entry.caseId} • ${stageText(proceeding.stage).replace(/^\S+\s/, '')} • Severity ${severityText(proceeding.severity)}`, 100),
          value: String(entry.caseId),
          emoji: proceeding.stage === 'published' ? '📜' : proceeding.stage === 'review' ? '⚖️' : '📂',
        };
      }))));
    const dashboardActions = [
    button(`mod_proceeding_new:${target.id}`, 'New Case', '➕', ButtonStyle.Primary, !canManageProceeding(interaction)),
    button(`mod_proceeding_review_queue:${target.id}`, 'Review Queue', '⚖️'),
    button(`mod_proceeding_published:${target.id}`, 'Published', '📜'),
  ];
  if (canUseModAction(interaction.member, interaction.guild, 'export_cases', interaction)) dashboardActions.push(button(`mod_export_cases:${target.id}`, 'Export', '📤'));
  components.push(row(...dashboardActions));
  components.push(caseManagementNavigationRow(interaction, target.id));
  }
  return { embed, components };
}

function buildCaseFile(interaction, modCase) {
  const proceeding = parseProceeding(modCase);
  const verified = proceeding.evidence.filter((item) => item.status === 'verified');
  const draft = proceeding.evidence.filter((item) => item.status === 'draft');
  const rejected = proceeding.evidence.filter((item) => item.status === 'rejected');
  const appeals = getProceedingAppeals(modCase);
  const latestAppeal = latestProceedingAppeal(modCase);
  const canManage = canManageProceeding(interaction);
  const reviewerAuthority = isJudge(interaction);
  const executionAction = String(proceeding.decision?.action || '');
  const canExecuteAction = Boolean(executionAction && executionAction !== 'no_action' && canUseModAction(interaction.member, interaction.guild, executionAction, interaction));
  const isAssignedReviewer = reviewerAuthority && proceeding.reviewingAdminId === interaction.user.id;
  const canDecide = isAssignedReviewer && ['review', 'decided'].includes(proceeding.stage);
  const isClosed = proceeding.stage === 'closed';

  const nextStep = (() => {
    if (isClosed) return 'This case is closed. Reopen it before making further changes.';
    if (modCase.status === 'reversed') return 'This published decision has been reversed. Its sanction cannot be executed again.';
    if (proceeding.stage === 'investigation') return 'Build the case file, verify the available material, then submit it for review.';
    if (proceeding.stage === 'review') return proceeding.reviewingAdminId
      ? `Review is assigned to <@${proceeding.reviewingAdminId}>. Verify evidence and record the decision.`
      : 'The case is waiting for an authorised reviewer to claim it from the Review Brief.';
    if (proceeding.stage === 'decided') {
      if (proceeding.decision?.action === 'ban' && proceeding.sanctionReview?.status !== 'approved') return 'A second administrator must approve the ban before the member record can be published.';
      return 'The decision is recorded. Check the member preview, then publish the official member record.';
    }
    if (proceeding.stage === 'published') {
      if (proceeding.decision?.action && proceeding.decision.action !== 'no_action' && proceeding.sanctionExecution?.status !== 'executed') return 'The member record is published. Execute the approved moderation action when ready.';
      return latestAppeal?.status === 'pending' ? 'A member appeal is waiting for review.' : 'The published case is active. Monitor appeals or close the case when complete.';
    }
    return 'Continue working through the case workflow.';
  })();

  const decisionSummary = proceeding.decision
    ? [
        `**Finding:** ${cleanExcerpt(proceeding.decision.finding, 180)}`,
        `**Action:** ${String(proceeding.decision.action || 'none').replaceAll('_', ' ')}`,
        `**Recorded by:** <@${proceeding.decision.decidedBy}> • ${discordTime(proceeding.decision.decidedAt)}`,
        proceeding.decision.action === 'ban' ? `**Second approval:** ${proceeding.sanctionReview?.status === 'approved' ? `✅ Approved by <@${proceeding.sanctionReview.approvedBy}>` : '⏳ Required'}` : null,
        proceeding.sanctionExecution ? `**Execution:** ${proceeding.sanctionExecution.status === 'executed' ? '✅ Completed' : proceeding.sanctionExecution.status === 'reversed' ? '↩️ Reversed' : proceeding.sanctionExecution.status === 'reversing' ? '⏳ Reversing after appeal' : proceeding.sanctionExecution.status === 'reversal_failed' ? '⚠️ Appeal remedy failed' : proceeding.sanctionExecution.status === 'executing' ? '⏳ In progress' : proceeding.sanctionExecution.status === 'failed' ? '❌ Failed' : '⏳ Pending'}` : (proceeding.decision.action !== 'no_action' ? '**Execution:** ⏳ Pending' : null),
      ].filter(Boolean).join('\n')
    : 'No decision has been recorded yet.';

  const recordSummary = proceeding.publication
    ? `✅ **Published** • Revision ${proceeding.publication.revision || 1}\nPublished by <@${proceeding.publication.publishedBy}> ${discordTime(proceeding.publication.publishedAt)}\n${cleanExcerpt(proceeding.publication.summary, 360)}`
    : '🔒 **Internal only** • Nothing from this case is currently visible to the member.';

  const appealSummary = latestAppeal
    ? `${appealStatusText(latestAppeal)} • ${discordTime(latestAppeal.submittedAt)}${latestAppeal.reviewedAt ? ` • reviewed ${discordTime(latestAppeal.reviewedAt)}` : ''}`
    : 'No appeal submitted.';

  const embed = new EmbedBuilder()
    .setColor(proceeding.stage === 'review' ? 0xFEE75C : proceeding.stage === 'published' ? 0x57F287 : proceeding.stage === 'closed' ? 0x747F8D : 0x5865F2)
    .setTitle(`📂 ${cleanExcerpt(proceeding.title, 72)} • Case #${modCase.caseId}`)
    .setDescription([
      `**${stageText(proceeding.stage)}** • Severity **${severityText(proceeding.severity)}**`,
      `**Subject:** <@${modCase.userId}> • \`${modCase.userId}\``,
      `**Case lead:** <@${proceeding.leadModeratorId}>`,
      '',
      `**Next step:** ${nextStep}`,
    ].join('\n'))
    .addFields(
      { name: '📋 Case Summary', value: cleanExcerpt(proceeding.allegations || modCase.reason || 'No case summary recorded.', 1024), inline: false },
      { name: '🗂️ Working File', value: [
        `**Evidence:** ✅ ${verified.length} verified • 🟡 ${draft.length} draft • 🔴 ${rejected.length} rejected`,
        `**Private notes:** ${proceeding.notes.length}`,
        `**Linked moderation records:** ${proceeding.linkedCases.length}`,
        `**Recommendation:** ${proceeding.recommendation?.reason ? cleanExcerpt(proceeding.recommendation.reason, 180) : 'Not set'}`,
      ].join('\n'), inline: false },
      { name: '✅ Review & Decision', value: decisionSummary.slice(0, 1024), inline: false },
      { name: '📜 Member Record', value: `${recordSummary}\n**Appeal:** ${appealSummary}`.slice(0, 1024), inline: false },
    )
    .setFooter({ text: 'Private staff case file • only verified, approved information may be published to the member' })
    .setTimestamp();

  const workspace = new StringSelectMenuBuilder()
    .setCustomId(`mod_proceeding_workspace:${modCase.caseId}`)
    .setPlaceholder('🗂️ Open case workspace')
    .addOptions(
      { label: 'Evidence', description: `${proceeding.evidence.length} item(s) • review sources and verification`, value: 'evidence', emoji: '🔎' },
      { label: 'Private Notes', description: `${proceeding.notes.length} note(s) • internal staff working notes`, value: 'notes', emoji: '📝' },
      { label: 'Timeline', description: 'Audit trail and case activity', value: 'timeline', emoji: '🕘' },
      { label: 'Review Brief', description: 'Reviewer summary, assignment and review controls', value: 'review', emoji: '📋' },
      { label: 'Member Preview', description: 'Exactly what the member can see', value: 'preview', emoji: '👁️' },
      { label: 'Record History', description: 'Decision and publication history', value: 'history', emoji: '📚' },
    );

  const workflowButtons = [
    button(`mod_proceeding_submit_review:${modCase.caseId}`, proceeding.stage === 'review' ? 'Pending' : 'Review', '📥', ButtonStyle.Primary, !canManage || proceeding.stage !== 'investigation'),
    button(`mod_proceeding_verify:${modCase.caseId}`, 'Verify', '✅', ButtonStyle.Secondary, !reviewerAuthority || !proceeding.evidence.length || isClosed),
    button(`mod_proceeding_decide:${modCase.caseId}`, 'Decide', '🧾', canDecide ? ButtonStyle.Primary : ButtonStyle.Secondary, !canDecide),
    button(`mod_proceeding_publish:${modCase.caseId}`, proceeding.publication ? 'Update' : 'Publish', '📜', ButtonStyle.Success, !canPublishProceeding(interaction) || !proceeding.decision || isClosed || (proceeding.decision?.action === 'ban' && proceeding.sanctionReview?.status !== 'approved')),
    button(`mod_proceeding_execute:${modCase.caseId}`, proceeding.sanctionExecution?.status === 'executed' ? 'Done' : proceeding.sanctionExecution?.status === 'reversed' ? 'Reversed' : proceeding.sanctionExecution?.status === 'reversing' ? 'Reversing' : proceeding.sanctionExecution?.status === 'reversal_failed' ? 'Appeal Failed' : proceeding.sanctionExecution?.status === 'executing' && !executionIsStale(proceeding.sanctionExecution) ? 'Running' : proceeding.sanctionExecution?.status === 'failed' || executionIsStale(proceeding.sanctionExecution) ? 'Retry' : 'Execute', '⚡', ButtonStyle.Danger, !reviewerAuthority || !canExecuteAction || isClosed || modCase.status === 'reversed' || proceeding.stage !== 'published' || !proceeding.decision || proceeding.decision.action === 'no_action' || ['executed', 'reversed', 'reversing', 'reversal_failed'].includes(proceeding.sanctionExecution?.status) || (proceeding.sanctionExecution?.status === 'executing' && !executionIsStale(proceeding.sanctionExecution)) || (proceeding.decision?.action === 'ban' && proceeding.sanctionReview?.status !== 'approved')),
  ];

  const controlButtons = [];
  if (proceeding.decision?.action === 'ban' && proceeding.sanctionReview?.status !== 'approved') {
    controlButtons.push(button(`mod_proceeding_approve_ban:${modCase.caseId}`, 'Approve Ban', '🛡️', ButtonStyle.Danger, !reviewerAuthority || proceeding.decision?.decidedBy === interaction.user.id));
  }
  if (appeals.length) controlButtons.push(button(`mod_case_appeal_history:${modCase.caseId}:0`, `Appeals (${appeals.length})`, '⚖️'));
  controlButtons.push(button('mod_case_appeal_queue:0', 'Appeals', '📥'));
  if (canDeleteProceeding(interaction)) controlButtons.push(button(`mod_proceeding_delete:${modCase.caseId}`, 'Delete Case', '🗑️', ButtonStyle.Danger));
  controlButtons.push(button(isClosed ? `mod_proceeding_reopen:${modCase.caseId}` : `mod_proceeding_close:${modCase.caseId}`, isClosed ? 'Reopen' : 'Close', isClosed ? '🔓' : '🔒', ButtonStyle.Secondary, !canCloseProceeding(interaction)));

  const components = [
    row(workspace),
    row(
      button(`mod_proceeding_evidence:${modCase.caseId}`, 'Evidence', '➕', ButtonStyle.Primary, !canManage || isClosed),
      button(`mod_proceeding_note:${modCase.caseId}`, 'Note', '📝', ButtonStyle.Secondary, !canManage || isClosed),
      button(`mod_proceeding_import:${modCase.caseId}`, 'Import', '🔗', ButtonStyle.Secondary, !canManage || isClosed),
      button(`mod_proceeding_severity:${modCase.caseId}`, 'Severity', '📊', ButtonStyle.Secondary, !canManage || isClosed),
      button(`mod_proceeding_recommend:${modCase.caseId}`, 'Recommend', '📋', ButtonStyle.Secondary, !canManage || isClosed),
    ),
    row(...workflowButtons),
    row(...controlButtons),
    caseFileNavigationRow(interaction, modCase),
  ];
  return { embeds: [embed], components };
}

function buildEvidencePage(interaction, modCase) {
  const proceeding = parseProceeding(modCase);
  const canManage = canManageProceeding(interaction) && proceeding.stage !== 'closed';
  const judgeAuthority = isJudge(interaction);
  const lines = proceeding.evidence.length ? proceeding.evidence.slice(-12).reverse().map((item) => {
    const verification = item.status === 'verified' ? `\nVerified by <@${item.verifiedBy}> ${discordTime(item.verifiedAt)}` : item.status === 'rejected' ? `\nRejected by <@${item.verifiedBy}> ${discordTime(item.verifiedAt)}` : '';
    return `${EVIDENCE_STATUS[item.status] || EVIDENCE_STATUS.draft} **${item.id} • ${cleanExcerpt(item.title, 90)}**\nSource: ${cleanExcerpt(item.source || 'Internal submission', 120)}\n${cleanExcerpt(item.details, 240)}${verification}`;
  }) : ['No evidence has been added to this case.'];
  const embed = new EmbedBuilder().setColor(0x5865F2).setTitle(`🔎 Evidence • Case #${modCase.caseId}`).setDescription(lines.join('\n\n').slice(0, 4000)).setFooter({ text: 'Draft evidence stays internal until an authorised admin verifies it' }).setTimestamp();
  return { embeds: [embed], components: [row(button(`mod_proceeding_evidence:${modCase.caseId}`, 'Add Evidence', '➕', ButtonStyle.Primary, !canManage), button(`mod_proceeding_verify:${modCase.caseId}`, 'Verify Evidence', '✅', ButtonStyle.Secondary, !judgeAuthority || !proceeding.evidence.length || proceeding.stage === 'closed')), caseFileBackRow(modCase.caseId)] };
}
function buildNotesPage(interaction, modCase) {
  const proceeding = parseProceeding(modCase);
  const canManage = canManageProceeding(interaction) && proceeding.stage !== 'closed';
  const lines = proceeding.notes.length ? proceeding.notes.slice(-15).reverse().map((item) => `**${item.id || 'Note'}** • <@${item.authorId}> • ${discordTime(item.createdAt)}\n${cleanExcerpt(item.text, 300)}`) : ['No private staff notes have been added.'];
  const embed = new EmbedBuilder().setColor(0x5865F2).setTitle(`📝 Case Notes • #${modCase.caseId}`).setDescription(lines.join('\n\n').slice(0, 4000)).setFooter({ text: 'Private staff paperwork • never published automatically' }).setTimestamp();
  return { embeds: [embed], components: [row(button(`mod_proceeding_note:${modCase.caseId}`, 'Add Case Note', '➕', ButtonStyle.Primary, !canManage)), caseFileBackRow(modCase.caseId)] };
}
function buildTimelinePage(interaction, modCase) {
  const rows = auditRows(interaction.guildId, modCase.caseId, 20);
  const lines = rows.length ? rows.map((entry) => `**${String(entry.event || 'case.updated').replace(/^case\.proceeding\./, '').replaceAll('_', ' ')}** • ${discordTime(entry.created_at)}\nActor: ${entry.actor_id ? `<@${entry.actor_id}>` : 'System'}`) : ['No case audit activity recorded yet.'];
  const embed = new EmbedBuilder().setColor(0x5865F2).setTitle(`🕘 Case Timeline • #${modCase.caseId}`).setDescription(lines.join('\n\n').slice(0, 4000)).setFooter({ text: 'Immutable case audit trail • newest activity first' }).setTimestamp();
  return { embeds: [embed], components: [caseFileBackRow(modCase.caseId)] };
}
function recommendationModal(caseId, proceeding) {
  return new ModalBuilder().setCustomId(`mod_proceeding_recommend_submit:${caseId}`).setTitle('Case Recommendation').addComponents(
    modalInput('recommendation', 'Recommended outcome / next step', TextInputStyle.Paragraph, true, 1200, 'Record the moderator recommendation for the reviewing admin.', proceeding.recommendation?.reason || ''),
  );
}

function buildReviewBriefPage(interaction, modCase) {
  const proceeding = parseProceeding(modCase);
  const verified = proceeding.evidence.filter((item) => item.status === 'verified');
  const draft = proceeding.evidence.filter((item) => item.status === 'draft');
  const recommendation = proceeding.recommendation?.reason || 'No moderator recommendation recorded.';
  const reviewer = proceeding.reviewingAdminId ? `<@${proceeding.reviewingAdminId}>${proceeding.reviewClaimedAt ? ` • claimed ${discordTime(proceeding.reviewClaimedAt)}` : ''}` : 'Unassigned';
  const readiness = [
    verified.length ? '✅ Verified evidence present' : '❌ No verified evidence',
    proceeding.recommendation ? '✅ Moderator recommendation recorded' : '⚠️ No recommendation',
    proceeding.stage === 'review' ? '✅ Submitted for review' : `⚠️ Current stage: ${stageText(proceeding.stage)}`,
    proceeding.reviewingAdminId ? '✅ Reviewer assigned' : '⚠️ Awaiting reviewer claim',
  ].join('\n');
  const embed = new EmbedBuilder()
    .setColor(0xFEE75C)
    .setTitle(`⚖️ Review Brief • Case #${modCase.caseId}`)
    .setDescription(`**Subject:** <@${modCase.userId}> • \`${modCase.userId}\`\n**Severity:** **${severityText(proceeding.severity)}**\n**Lead:** <@${proceeding.leadModeratorId}>\n**Decision by:** ${reviewer}`)
    .addFields(
      { name: '📋 Allegations', value: cleanExcerpt(proceeding.allegations || modCase.reason, 1024), inline: false },
      { name: '🔎 Evidence Position', value: `Verified **${verified.length}** • Draft **${draft.length}** • Rejected **${proceeding.evidence.filter((item) => item.status === 'rejected').length}**\n${verified.slice(0, 6).map((item) => `• **${item.id}** ${cleanExcerpt(item.title, 90)}`).join('\n') || 'No verified evidence.'}`, inline: false },
      { name: '📋 Moderator Recommendation', value: cleanExcerpt(recommendation, 1024), inline: false },
      { name: '✅ Decision Readiness', value: readiness, inline: false },
    )
    .setFooter({ text: 'An authorised reviewer must claim the case before recording a decision' })
    .setTimestamp();
  const judgeAuthority = isJudge(interaction);
  const assignedToOther = proceeding.reviewingAdminId && proceeding.reviewingAdminId !== interaction.user.id;
  const controls = [];
  if (proceeding.stage === 'review' && !proceeding.reviewingAdminId) controls.push(button(`mod_proceeding_claim_review:${modCase.caseId}`, 'Claim Review', '✋', ButtonStyle.Primary, !judgeAuthority));
  if (proceeding.stage === 'review' && proceeding.reviewingAdminId === interaction.user.id) {
    controls.push(button(`mod_proceeding_decide:${modCase.caseId}`, 'Record Decision', '⚖️', ButtonStyle.Danger, !verified.length));
    controls.push(button(`mod_proceeding_return:${modCase.caseId}`, 'Return for Work', '↩️', ButtonStyle.Secondary));
  }
  if (assignedToOther) controls.push(button(`mod_proceeding_claim_review:${modCase.caseId}`, 'Assigned to Another Reviewer', '🔒', ButtonStyle.Secondary, true));
  const components = [];
  if (controls.length) components.push(row(...controls.slice(0, 5)));
  components.push(caseFileBackRow(modCase.caseId));
  return { embeds: [embed], components };
}

function uniqueHistoryItems(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of items.filter(Boolean)) {
    const key = String(keyFn(item) || '');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function buildRecordHistoryPage(modCase) {
  const proceeding = parseProceeding(modCase);
  const decisions = uniqueHistoryItems(
    [...proceeding.decisionHistory, ...(proceeding.decision ? [proceeding.decision] : [])],
    (item) => `${item.decidedAt || ''}:${item.action || ''}:${item.finding || ''}`,
  );
  const publications = uniqueHistoryItems(
    [...proceeding.publicationHistory, ...(proceeding.publication ? [proceeding.publication] : [])],
    (item) => `${item.revision || ''}:${item.publishedAt || ''}:${item.summary || ''}`,
  );
  const appeals = getProceedingAppeals(modCase);
  const decisionLines = decisions.length ? decisions.slice(-8).reverse().map((item, index) => `**${index === 0 ? 'Current' : 'Prior'}** • ${item.action || 'no_action'} • ${cleanExcerpt(item.finding || 'No finding', 100)}\n<@${item.decidedBy || '0'}> • ${discordTime(item.decidedAt)}`) : ['No decision history recorded.'];
  const publicationLines = publications.length ? publications.slice(-8).reverse().map((item) => `**Revision ${item.revision || 1}** • ${discordTime(item.publishedAt)} • <@${item.publishedBy || '0'}>\n${cleanExcerpt(item.summary || '', 180)}`) : ['No publication history recorded.'];
  const appealLines = appeals.length ? appeals.slice(-8).reverse().map((appeal) => `**${appealStatusText(appeal)}** • ${discordTime(appeal.submittedAt)}\n${cleanExcerpt(appeal.grounds || '', 180)}${appeal.reviewNote ? `\nReview: ${cleanExcerpt(appeal.reviewNote, 140)}` : ''}${appeal.remedy?.detail ? `\nRemedy: ${cleanExcerpt(appeal.remedy.detail, 140)}` : ''}`) : ['No appeal history recorded.'];
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`📚 Official Record History • Case #${modCase.caseId}`)
    .setDescription('Decision, publication and appeal history for this case. Internal evidence and private staff notes are intentionally excluded.')
    .addFields(
      { name: '👨‍⚖️ Decision History', value: decisionLines.join('\n\n').slice(0, 1024), inline: false },
      { name: '📜 Publication Revisions', value: publicationLines.join('\n\n').slice(0, 1024), inline: false },
      { name: '⚖️ Appeal History', value: appealLines.join('\n\n').slice(0, 1024), inline: false },
    )
    .setFooter({ text: 'Case record history • newest entries first' })
    .setTimestamp();
  return { embeds: [embed], components: [caseFileBackRow(modCase.caseId)] };
}

function buildMemberPreviewPage(modCase) {
  const proceeding = parseProceeding(modCase);
  const decision = proceeding.decision || {};
  const published = proceeding.publication;
  const summary = published?.summary || 'No member-facing summary has been published yet. Use Publish Record to create one.';
  const embed = new EmbedBuilder()
    .setColor(0x57F287)
    .setTitle(`👁️ Member Preview • Case #${modCase.caseId}`)
    .setDescription('This preview intentionally excludes private notes, draft/rejected evidence, scan intelligence and staff deliberation.')
    .addFields(
      { name: 'Status', value: published ? `Published • Revision ${published.revision || 1}` : 'Not yet published', inline: true },
      { name: 'Severity', value: severityText(proceeding.severity), inline: true },
      { name: 'Finding', value: cleanExcerpt(decision.finding || 'No finding recorded.', 1024), inline: false },
      { name: 'Decision', value: cleanExcerpt(decision.action || 'No action recorded.', 1024), inline: false },
      { name: 'Official Summary', value: cleanExcerpt(summary, 1800), inline: false },
      { name: 'Appeal Status', value: (() => { const appeal = latestProceedingAppeal(modCase); return appeal ? `${appealStatusText(appeal)}${appeal.reviewedAt ? ` • reviewed ${discordTime(appeal.reviewedAt)}` : ''}` : 'No appeal submitted.'; })(), inline: false },
    )
    .setFooter({ text: 'Exact privacy boundary preview • staff-only material is omitted' })
    .setTimestamp();
  return { embeds: [embed], components: [caseFileBackRow(modCase.caseId)] };
}

function closeCaseModal(caseId) {
  return new ModalBuilder().setCustomId(`mod_proceeding_close_submit:${caseId}`).setTitle('Close Case').addComponents(
    modalInput('reason', 'Closure reason', TextInputStyle.Paragraph, true, 1000, 'Why is this case being closed?'),
  );
}

function newCaseModal(targetId) {
  return new ModalBuilder().setCustomId(`mod_case_new_submit:${targetId}`).setTitle('Open New Case').addComponents(
    modalInput('caseTitle', 'Case title / short summary', TextInputStyle.Short, true, 100, 'Example: Repeated harassment in #general'),
    modalInput('allegations', 'Allegations / details', TextInputStyle.Paragraph, true, 2000, 'Describe what happened, including context, dates, channels and users involved.'),
    modalInput('severity', 'Initial severity (Low–Critical)', TextInputStyle.Short, true, 8, 'Low, Medium, High, Severe, or Critical'),
    modalInput('recommendation', 'Recommended action (optional)', TextInputStyle.Paragraph, false, 800, 'What action or next step should the review team consider?'),
  );
}
function deleteCaseModal(caseId) {
  return new ModalBuilder().setCustomId(`mod_proceeding_delete_submit:${caseId}`).setTitle(`Delete Case #${caseId}`).addComponents(
    modalInput('confirmation', 'Type DELETE to confirm', TextInputStyle.Short, true, 6, 'DELETE'),
    modalInput('reason', 'Deletion reason', TextInputStyle.Paragraph, true, 500, 'Why is this case being permanently deleted?'),
  );
}
function evidenceModal(caseId) {
  return new ModalBuilder().setCustomId(`mod_proceeding_evidence_submit:${caseId}`).setTitle('Add Case Evidence').addComponents(
    modalInput('title', 'Evidence title', TextInputStyle.Short, true, 120, 'Message screenshot, scan result, moderator record…'),
    modalInput('source', 'Source / reference', TextInputStyle.Short, false, 300, 'Message URL, case number, upload reference…'),
    modalInput('details', 'Evidence details', TextInputStyle.Paragraph, true, 1800, 'What does this evidence establish?'),
  );
}
function noteModal(caseId) {
  return new ModalBuilder().setCustomId(`mod_proceeding_note_submit:${caseId}`).setTitle('Add Private Case Note').addComponents(
    modalInput('note', 'Private staff note', TextInputStyle.Paragraph, true, 1500, 'Internal working note. This is never published automatically.'),
  );
}
function severityModal(caseId, proceeding) {
  return new ModalBuilder().setCustomId(`mod_proceeding_severity_submit:${caseId}`).setTitle('Change Case Severity').addComponents(
    modalInput('severity', 'Severity (Low–Critical)', TextInputStyle.Short, true, 8, 'Low, Medium, High, Severe, or Critical', SEVERITY[proceeding.severity]),
    modalInput('reason', 'Reason for severity change', TextInputStyle.Paragraph, true, 1000, 'Explain why the case impact or risk level has changed.'),
  );
}
function verifyModal(caseId) {
  return new ModalBuilder().setCustomId(`mod_proceeding_verify_submit:${caseId}`).setTitle('Verify / Reject Evidence').addComponents(
    modalInput('evidenceId', 'Evidence ID', TextInputStyle.Short, true, 40, 'Example: E3'),
    modalInput('status', 'Status: verified or rejected', TextInputStyle.Short, true, 8, 'verified'),
    modalInput('reason', 'Verification note', TextInputStyle.Paragraph, true, 800, 'Why is this evidence verified or rejected?'),
  );
}
function decisionModal(caseId, proceeding) {
  return new ModalBuilder().setCustomId(`mod_proceeding_decide_submit:${caseId}`).setTitle('Record Case Decision').addComponents(
    modalInput('finding', 'Finding', TextInputStyle.Short, true, 120, 'Confirmed / Not substantiated / Partially confirmed'),
    modalInput('action', 'Decision action', TextInputStyle.Short, true, 30, 'warn / timeout / quarantine / kick / ban / no_action'),
    modalInput('reason', 'Decision rationale', TextInputStyle.Paragraph, true, 1800, 'Record the reasoning behind the final decision.'),
    modalInput('recommendation', 'Moderator recommendation (optional)', TextInputStyle.Paragraph, false, 800, proceeding.recommendation?.reason || ''),
  );
}
function sanctionExecutionModal(caseId, proceeding) {
  const action = String(proceeding.decision?.action || 'sanction');
  const hint = action === 'timeout' ? 'Example: 1h, 1d (max 28d)' : action === 'ban' ? 'Delete message days: 0-7' : action === 'warn' ? 'Strike weight: 1-5' : 'Leave blank for this action';
  return new ModalBuilder().setCustomId(`mod_proceeding_execute_submit:${caseId}`).setTitle(`Execute ${action}`.slice(0, 45)).addComponents(
    modalInput('confirmation', 'Type EXECUTE to confirm', TextInputStyle.Short, true, 7, 'EXECUTE'),
    modalInput('parameter', 'Action parameter', TextInputStyle.Short, ['timeout', 'ban', 'warn'].includes(action), 20, hint),
    modalInput('note', 'Execution note (optional)', TextInputStyle.Paragraph, false, 600, 'Optional operational note for the audit trail.'),
  );
}
function parseProceedingTimeout(value) {
  const match = String(value || '').trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*([smhdw])$/);
  if (!match) return null;
  const units = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
  const ms = Math.floor(Number(match[1]) * units[match[2]]);
  return Number.isFinite(ms) && ms > 0 && ms <= 28 * 86400000 ? ms : null;
}
function publishModal(caseId, proceeding) {
  return new ModalBuilder().setCustomId(`mod_proceeding_publish_submit:${caseId}`).setTitle(proceeding.publication ? 'Update Published Record' : 'Publish Member Record').addComponents(
    modalInput('summary', 'Verified member-facing summary', TextInputStyle.Paragraph, true, 1800, 'Only include verified information the member is permitted to see.', proceeding.publication?.summary || ''),
  );
}

async function updateCaseMessage(interaction, modCase) {
  const payload = buildCaseFile(interaction, modCase);
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  return interaction.update(payload);
}
async function openCase(interaction, caseId) {
  const modCase = getCaseById(interaction.guildId, caseId);
  if (!caseIsProceeding(modCase)) return false;
  await updateCaseMessage(interaction, modCase);
  return true;
}
function field(interaction, id) { try { return String(interaction.fields.getTextInputValue(id) || '').trim(); } catch { return ''; } }
function evidenceId(proceeding) { return `E${proceeding.evidence.length + 1}`; }
function canManageProceeding(interaction) { return canUseModAction(interaction.member, interaction.guild, 'proceeding_manage', interaction); }
function isJudge(interaction) { return canUseModAction(interaction.member, interaction.guild, 'proceeding_review', interaction); }
function canPublishProceeding(interaction) { return canUseModAction(interaction.member, interaction.guild, 'proceeding_publish', interaction); }
function canCloseProceeding(interaction) { return canUseModAction(interaction.member, interaction.guild, 'proceeding_close', interaction); }

async function handleProceedingInteraction(interaction) {
  const id = String(interaction.customId || '');
  if (!id.startsWith('mod_proceeding_')) return false;
  if (interaction.isStringSelectMenu?.()) {
    if (id.startsWith('mod_proceeding_open:')) return openCase(interaction, interaction.values?.[0]);
    if (id.startsWith('mod_proceeding_workspace:')) {
      const caseId = Number(id.split(':')[1]);
      const modCase = getCaseById(interaction.guildId, caseId);
      if (!caseIsProceeding(modCase)) return false;
      const section = String(interaction.values?.[0] || '');
      if (section === 'evidence') { await interaction.update(buildEvidencePage(interaction, modCase)); return true; }
      if (section === 'notes') { await interaction.update(buildNotesPage(interaction, modCase)); return true; }
      if (section === 'timeline') { await interaction.update(buildTimelinePage(interaction, modCase)); return true; }
      if (section === 'review') { await interaction.update(buildReviewBriefPage(interaction, modCase)); return true; }
      if (section === 'preview') { await interaction.update(buildMemberPreviewPage(modCase)); return true; }
      if (section === 'history') { await interaction.update(buildRecordHistoryPage(modCase)); return true; }
      return false;
    }
  }
  if (!interaction.isButton?.()) return false;
  const parts = id.split(':');
  const key = parts[0];
  const value = parts[1];
  if (key === 'mod_proceeding_new') { if (!canManageProceeding(interaction)) { await interaction.reply({ content: '❌ Case-management authority is required to open a case.', flags: 64 }); return true; } await interaction.showModal(newCaseModal(value)); return true; }
  if (key === 'mod_proceeding_back') {
    const target = await interaction.guild.members.fetch(value).catch(() => null);
    if (!target) return false;
    const built = buildProceedingDashboard(interaction, target);
    await interaction.update({ embeds: [built.embed], components: built.components });
    return true;
  }
  if (key === 'mod_proceeding_review_queue' || key === 'mod_proceeding_published') {
    const target = await interaction.guild.members.fetch(value).catch(() => null);
    const wanted = key === 'mod_proceeding_review_queue' ? 'review' : 'published';
    const all = wanted === 'review' ? getProceedingCases(interaction.guildId) : (target ? getProceedingCases(interaction.guildId, target.id) : []);
    const matches = all.filter((entry) => parseProceeding(entry).stage === wanted);
    const embed = new EmbedBuilder().setColor(0x5865F2).setTitle(wanted === 'review' ? '⚖️ Review Queue' : '📜 Published Records')
      .setDescription(matches.length ? matches.map((entry) => `**#${entry.caseId}** • Severity **${severityText(parseProceeding(entry).severity)}**\n${cleanExcerpt(parseProceeding(entry).allegations, 160)}`).join('\n\n') : `No ${wanted === 'review' ? 'cases awaiting review' : 'published records'} for this member.`);
    const components = [];
    if (matches.length) components.push(row(new StringSelectMenuBuilder().setCustomId(`mod_proceeding_open:${value}`).setPlaceholder('Open a case file').addOptions(matches.slice(0, 25).map((entry) => ({ label: `Case #${entry.caseId}`, description: cleanExcerpt(parseProceeding(entry).allegations, 80), value: String(entry.caseId), emoji: wanted === 'review' ? '⚖️' : '📜' })))));
    components.push(staffBackRow(value));
    await interaction.update({ embeds: [embed], components });
    return true;
  }
  const caseId = Number(value);
  const modCase = getCaseById(interaction.guildId, caseId);
  if (!caseIsProceeding(modCase)) return false;
  const proceeding = parseProceeding(modCase);
  if (key === 'mod_proceeding_file') { await updateCaseMessage(interaction, modCase); return true; }
  if (key === 'mod_proceeding_evidence_view') { await interaction.update(buildEvidencePage(interaction, modCase)); return true; }
  if (key === 'mod_proceeding_notes_view') { await interaction.update(buildNotesPage(interaction, modCase)); return true; }
  if (key === 'mod_proceeding_timeline') { await interaction.update(buildTimelinePage(interaction, modCase)); return true; }
  if (key === 'mod_proceeding_recommend') { if (!canManageProceeding(interaction) || proceeding.stage === 'closed') { await interaction.reply({ content: '❌ This case cannot be edited with your current authority or stage.', flags: 64 }); return true; } await interaction.showModal(recommendationModal(caseId, proceeding)); return true; }
  if (key === 'mod_proceeding_review_brief') { await interaction.update(buildReviewBriefPage(interaction, modCase)); return true; }
  if (key === 'mod_proceeding_preview') { await interaction.update(buildMemberPreviewPage(modCase)); return true; }
  if (key === 'mod_proceeding_record_history') { await interaction.update(buildRecordHistoryPage(modCase)); return true; }
  if (key === 'mod_proceeding_claim_review') {
    if (!isJudge(interaction) || proceeding.stage !== 'review') { await interaction.reply({ content: '❌ This review cannot be claimed.', flags: 64 }); return true; }
    if (proceeding.reviewingAdminId && proceeding.reviewingAdminId !== interaction.user.id) { await interaction.reply({ content: '❌ Another reviewer has already claimed this review.', flags: 64 }); return true; }
    const next = { ...proceeding, reviewingAdminId: interaction.user.id, reviewClaimedAt: now() };
    const updated = saveProceeding(interaction.guildId, caseId, next, interaction.user.id, 'case.proceeding.review_claimed', proceeding);
    await interaction.update(buildReviewBriefPage(interaction, updated));
    return true;
  }
  if (key === 'mod_proceeding_return') {
    if (!isJudge(interaction) || proceeding.reviewingAdminId !== interaction.user.id || proceeding.stage !== 'review') { await interaction.reply({ content: '❌ Only the assigned reviewer can return this case for more work.', flags: 64 }); return true; }
    const next = { ...proceeding, stage: 'investigation', reviewingAdminId: null, reviewClaimedAt: null, submittedForReviewAt: null, submittedForReviewBy: null, notes: [...proceeding.notes, { id: `N${proceeding.notes.length + 1}`, text: 'Reviewer returned the case to investigation for further work.', authorId: interaction.user.id, createdAt: now() }] };
    const updated = saveProceeding(interaction.guildId, caseId, next, interaction.user.id, 'case.proceeding.returned_to_investigation', proceeding);
    await updateCaseMessage(interaction, updated);
    return true;
  }
  if (key === 'mod_proceeding_approve_ban') {
    if (!isJudge(interaction) || proceeding.decision?.action !== 'ban') { await interaction.reply({ content: '❌ There is no ban decision awaiting approval.', flags: 64 }); return true; }
    if (proceeding.decision.decidedBy === interaction.user.id) { await interaction.reply({ content: '❌ The admin who recorded the decision cannot also approve the ban. A second admin must approve it.', flags: 64 }); return true; }
    if (proceeding.sanctionReview?.status === 'approved') { await interaction.reply({ content: '❌ This ban decision is already approved.', flags: 64 }); return true; }
    const next = { ...proceeding, sanctionReview: { ...(proceeding.sanctionReview || {}), required: true, status: 'approved', approvedBy: interaction.user.id, approvedAt: now() } };
    const updated = saveProceeding(interaction.guildId, caseId, next, interaction.user.id, 'case.proceeding.ban_approved', proceeding);
    await updateCaseMessage(interaction, updated);
    return true;
  }
  if (key === 'mod_proceeding_delete') {
    if (!canDeleteProceeding(interaction)) { await interaction.reply({ content: '❌ Case deletion authority is required.', flags: 64 }); return true; }
    await interaction.showModal(deleteCaseModal(caseId));
    return true;
  }
  if (key === 'mod_proceeding_close') { if (!canCloseProceeding(interaction)) { await interaction.reply({ content: '❌ Case closure authority is required.', flags: 64 }); return true; } await interaction.showModal(closeCaseModal(caseId)); return true; }
  if (key === 'mod_proceeding_reopen') { if (!canCloseProceeding(interaction)) { await interaction.reply({ content: '❌ Case closure authority is required.', flags: 64 }); return true; }
    if (proceeding.stage !== 'closed') { await interaction.reply({ content: '❌ This case cannot be reopened.', flags: 64 }); return true; }
    const next = { ...proceeding, stage: proceeding.previousStage || (proceeding.publication ? 'published' : proceeding.decision ? 'decided' : 'investigation'), previousStage: null, closedAt: null, closedBy: null, closeReason: null };
    const updated = saveProceeding(interaction.guildId, caseId, next, interaction.user.id, 'case.proceeding.reopened', proceeding);
    await updateCaseMessage(interaction, updated);
    return true;
  }
  if (key === 'mod_proceeding_evidence') { if (!canManageProceeding(interaction) || proceeding.stage === 'closed') { await interaction.reply({ content: '❌ This case cannot be edited with your current authority or stage.', flags: 64 }); return true; } await interaction.showModal(evidenceModal(caseId)); return true; }
  if (key === 'mod_proceeding_note') { if (!canManageProceeding(interaction) || proceeding.stage === 'closed') { await interaction.reply({ content: '❌ This case cannot be edited with your current authority or stage.', flags: 64 }); return true; } await interaction.showModal(noteModal(caseId)); return true; }
  if (key === 'mod_proceeding_severity') { if (!canManageProceeding(interaction) || proceeding.stage === 'closed') { await interaction.reply({ content: '❌ This case cannot be edited with your current authority or stage.', flags: 64 }); return true; } await interaction.showModal(severityModal(caseId, proceeding)); return true; }
  if (key === 'mod_proceeding_verify') { if (!isJudge(interaction)) return interaction.reply({ content: '❌ Admin authority is required to verify evidence.', flags: 64 }).then(() => true); await interaction.showModal(verifyModal(caseId)); return true; }
  if (key === 'mod_proceeding_decide') { if (!isJudge(interaction)) return interaction.reply({ content: '❌ Case-review authority is required to record a decision.', flags: 64 }).then(() => true); await interaction.showModal(decisionModal(caseId, proceeding)); return true; }
  if (key === 'mod_proceeding_publish') { if (!canPublishProceeding(interaction)) return interaction.reply({ content: '❌ Case-publishing authority is required to publish the member record.', flags: 64 }).then(() => true); await interaction.showModal(publishModal(caseId, proceeding)); return true; }
  if (key === 'mod_proceeding_execute') {
    const action = String(proceeding.decision?.action || '');
    if (!isJudge(interaction) || !action || action === 'no_action') { await interaction.reply({ content: '❌ There is no executable sanction.', flags: 64 }); return true; }
    if (proceeding.stage !== 'published' || !proceeding.publication) { await interaction.reply({ content: '❌ Publish the official member record before executing the sanction.', flags: 64 }); return true; }
    if (['executed', 'reversed', 'reversal_failed'].includes(proceeding.sanctionExecution?.status)) { await interaction.reply({ content: proceeding.sanctionExecution?.status === 'reversal_failed' ? '❌ This sanction is under an approved appeal with a failed reversal. Do not re-execute it; resolve the reversal failure instead.' : '❌ This sanction has already been finalised. Duplicate execution is blocked.', flags: 64 }); return true; }
    if (proceeding.sanctionExecution?.status === 'executing' && !executionIsStale(proceeding.sanctionExecution)) { await interaction.reply({ content: '❌ This sanction is already being executed by another reviewer.', flags: 64 }); return true; }
    if (action === 'ban' && proceeding.sanctionReview?.status !== 'approved') { await interaction.reply({ content: '❌ A second admin must approve this ban before execution.', flags: 64 }); return true; }
    if (!canUseModAction(interaction.member, interaction.guild, action, interaction)) { await interaction.reply({ content: `❌ You do not have authority to execute the ${action} sanction.`, flags: 64 }); return true; }
    await interaction.showModal(sanctionExecutionModal(caseId, proceeding)); return true;
  }
  if (key === 'mod_proceeding_import') {
    if (!canManageProceeding(interaction) || proceeding.stage === 'closed') { await interaction.reply({ content: '❌ Case-management authority is required to import records into an open case.', flags: 64 }); return true; }
    const before = proceeding;
    const related = getCasesForUser(interaction.guildId, modCase.userId).filter((entry) => entry.caseId !== caseId && !caseIsProceeding(entry));
    const linkedCases = [...new Set([...proceeding.linkedCases, ...related.map((entry) => entry.caseId)])].slice(-50);
    const importedEvidence = related.filter((entry) => !proceeding.evidence.some((e) => e.sourceCaseId === entry.caseId)).slice(0, 20).map((entry, index) => ({
      id: `R${proceeding.evidence.length + index + 1}`,
      title: `${String(entry.action || 'record').toUpperCase()} Case #${entry.caseId}`,
      source: `Moderation Case #${entry.caseId}`,
      details: `${entry.reason || 'No reason recorded'} • Status: ${entry.status || 'active'}`,
      sourceCaseId: entry.caseId,
      status: 'verified',
      addedBy: interaction.user.id,
      addedAt: now(),
      verifiedBy: interaction.user.id,
      verifiedAt: now(),
      verificationNote: 'Imported from Goliath moderation records.',
    }));
    const scanRows = db.prepare("SELECT after_value, created_at FROM case_audit WHERE guild_id = ? AND event = 'moderation.member_scan.completed' ORDER BY created_at DESC LIMIT 10").all(String(interaction.guildId));
    let scanEvidence = [];
    for (const scan of scanRows) {
      try {
        const data = JSON.parse(scan.after_value || '{}');
        if (String(data?.identity?.userId || data?.targetId || '') !== String(modCase.userId)) continue;
        scanEvidence = [{ id: `S${proceeding.evidence.length + importedEvidence.length + 1}`, title: 'Member Intelligence Scan', source: `Internal scan • ${scan.created_at}`, details: `Risk ${data?.risk?.score ?? 'unknown'} • Suspected matches ${(data?.suspectedMatches || []).length} • This scan remains draft until an admin verifies it.`, status: 'draft', addedBy: interaction.user.id, addedAt: now(), scanSnapshotAt: scan.created_at }];
        break;
      } catch {}
    }
    const next = { ...proceeding, linkedCases, evidence: [...proceeding.evidence, ...importedEvidence, ...scanEvidence] };
    const updated = saveProceeding(interaction.guildId, caseId, next, interaction.user.id, 'case.proceeding.records_imported', before);
    await updateCaseMessage(interaction, updated);
    return true;
  }
  if (key === 'mod_proceeding_submit_review') {
    if (!canManageProceeding(interaction) || proceeding.stage !== 'investigation') { await interaction.reply({ content: '❌ Only an authorised open investigation can be submitted for review.', flags: 64 }); return true; }
    if (!proceeding.evidence.some((item) => item.status === 'verified')) {
      await interaction.reply({ content: '❌ At least one verified evidence item is required before submitting this case for review.', flags: 64 });
      return true;
    }
    const next = { ...proceeding, stage: 'review', reviewingAdminId: null, reviewClaimedAt: null, submittedForReviewAt: now(), submittedForReviewBy: interaction.user.id };
    const updated = saveProceeding(interaction.guildId, caseId, next, interaction.user.id, 'case.proceeding.review_submitted', proceeding);
    await updateCaseMessage(interaction, updated);
    return true;
  }
  return false;
}

async function handleProceedingModal(interaction) {
  const id = String(interaction.customId || '');
  if (!(id.startsWith('mod_proceeding_') || id.startsWith('mod_case_new_submit:')) || !interaction.isModalSubmit?.()) return false;
  const [key, raw] = id.split(':');
  if (key === 'mod_case_new_submit') {
    if (!canManageProceeding(interaction)) { await interaction.reply({ content: '❌ Case-management authority is required to open a case.', flags: 64 }); return true; }
    const severity = parseSeverityInput(field(interaction, 'severity'));
    if (!severity) { await interaction.reply({ content: '❌ Severity must be Low, Medium, High, Severe, or Critical.', flags: 64 }); return true; }
    const caseTitle = field(interaction, 'caseTitle');
    const allegations = field(interaction, 'allegations');
    const recommendation = field(interaction, 'recommendation');
    const created = createCase({ guildId: interaction.guildId, userId: raw, moderatorId: interaction.user.id, action: PROCEEDING_ACTION, reason: allegations, metadata: { proceeding: { stage: 'investigation', severity, title: caseTitle, allegations, leadModeratorId: interaction.user.id, reviewingAdminId: null, evidence: [], notes: [], linkedCases: [], recommendation: recommendation ? { reason: recommendation, by: interaction.user.id, at: now() } : null, decision: null, publication: null } }, status: 'active', actorId: interaction.user.id });
    if (!created) { await interaction.reply({ content: '❌ Failed to create the case.', flags: 64 }); return true; }
    await interaction.update(buildCaseFile(interaction, created));
    return true;
  }
  const caseId = Number(raw);
  const modCase = getCaseById(interaction.guildId, caseId);
  if (!caseIsProceeding(modCase)) return false;
  const proceeding = parseProceeding(modCase);
  if (key === 'mod_proceeding_delete_submit') {
    if (!canDeleteProceeding(interaction)) { await interaction.reply({ content: '❌ Case deletion authority is required.', flags: 64 }); return true; }
    if (field(interaction, 'confirmation').toUpperCase() !== 'DELETE') { await interaction.reply({ content: '❌ Deletion cancelled. Type DELETE exactly to confirm.', flags: 64 }); return true; }
    const reason = field(interaction, 'reason');
    recordCaseAudit({ guildId: interaction.guildId, caseId, actorId: interaction.user.id, event: 'case.management.deleted', before: modCase, after: null, metadata: { permanent: true, reason } });
    const deleted = db.prepare('DELETE FROM cases WHERE guild_id = ? AND case_id = ?').run(String(interaction.guildId), Number(caseId));
    if (!deleted.changes) { await interaction.reply({ content: '❌ Case could not be deleted.', flags: 64 }); return true; }
    const target = await interaction.guild.members.fetch(modCase.userId).catch(() => null);
    if (!target) { await interaction.update({ content: `✅ Case #${caseId} permanently deleted.`, embeds: [], components: [] }); return true; }
    const built = buildProceedingDashboard(interaction, target);
    await interaction.update({ content: null, embeds: [built.embed], components: built.components });
    return true;
  }
  if (key === 'mod_proceeding_recommend_submit') {
    if (!canManageProceeding(interaction) || proceeding.stage === 'closed') { await interaction.reply({ content: '❌ This case cannot be edited with your current authority or stage.', flags: 64 }); return true; }
    const recommendation = { reason: field(interaction, 'recommendation'), by: interaction.user.id, at: now() };
    const next = { ...proceeding, recommendation };
    return updateCaseMessage(interaction, saveProceeding(interaction.guildId, caseId, next, interaction.user.id, 'case.proceeding.recommendation_updated', proceeding)).then(() => true);
  }
  if (key === 'mod_proceeding_evidence_submit') {
    if (!canManageProceeding(interaction) || proceeding.stage === 'closed') { await interaction.reply({ content: '❌ This case cannot be edited with your current authority or stage.', flags: 64 }); return true; }
    const item = { id: evidenceId(proceeding), title: field(interaction, 'title'), source: field(interaction, 'source') || null, details: field(interaction, 'details'), status: 'draft', addedBy: interaction.user.id, addedAt: now(), verifiedBy: null, verifiedAt: null, verificationNote: null };
    const next = { ...proceeding, evidence: [...proceeding.evidence, item] };
    return updateCaseMessage(interaction, saveProceeding(interaction.guildId, caseId, next, interaction.user.id, 'case.proceeding.evidence_added', proceeding)).then(() => true);
  }
  if (key === 'mod_proceeding_note_submit') {
    if (!canManageProceeding(interaction) || proceeding.stage === 'closed') { await interaction.reply({ content: '❌ This case cannot be edited with your current authority or stage.', flags: 64 }); return true; }
    const item = { id: `N${proceeding.notes.length + 1}`, text: field(interaction, 'note'), authorId: interaction.user.id, createdAt: now() };
    const next = { ...proceeding, notes: [...proceeding.notes, item] };
    return updateCaseMessage(interaction, saveProceeding(interaction.guildId, caseId, next, interaction.user.id, 'case.proceeding.note_added', proceeding)).then(() => true);
  }
  if (key === 'mod_proceeding_severity_submit') {
    if (!canManageProceeding(interaction) || proceeding.stage === 'closed') { await interaction.reply({ content: '❌ This case cannot be edited with your current authority or stage.', flags: 64 }); return true; }
    const severity = parseSeverityInput(field(interaction, 'severity'));
    if (!severity) { await interaction.reply({ content: '❌ Severity must be Low, Medium, High, Severe, or Critical.', flags: 64 }); return true; }
    const next = { ...proceeding, severity, notes: [...proceeding.notes, { id: `N${proceeding.notes.length + 1}`, text: `Severity changed from ${proceeding.severity}/5 to ${severity}/5. Reason: ${field(interaction, 'reason')}`, authorId: interaction.user.id, createdAt: now() }] };
    return updateCaseMessage(interaction, saveProceeding(interaction.guildId, caseId, next, interaction.user.id, 'case.proceeding.severity_changed', proceeding)).then(() => true);
  }
  if (key === 'mod_proceeding_verify_submit') {
    if (!isJudge(interaction)) { await interaction.reply({ content: '❌ Admin authority is required to verify evidence.', flags: 64 }); return true; }
    const wantedId = field(interaction, 'evidenceId').toUpperCase();
    const status = field(interaction, 'status').toLowerCase();
    if (!['verified', 'rejected'].includes(status)) { await interaction.reply({ content: '❌ Evidence status must be `verified` or `rejected`.', flags: 64 }); return true; }
    const index = proceeding.evidence.findIndex((item) => String(item.id).toUpperCase() === wantedId);
    if (index < 0) { await interaction.reply({ content: `❌ Evidence ${wantedId} was not found in this case.`, flags: 64 }); return true; }
    const evidence = [...proceeding.evidence];
    evidence[index] = { ...evidence[index], status, verifiedBy: interaction.user.id, verifiedAt: now(), verificationNote: field(interaction, 'reason') };
    const next = { ...proceeding, evidence };
    return updateCaseMessage(interaction, saveProceeding(interaction.guildId, caseId, next, interaction.user.id, `case.proceeding.evidence_${status}`, proceeding)).then(() => true);
  }
  if (key === 'mod_proceeding_close_submit') { if (!canCloseProceeding(interaction)) { await interaction.reply({ content: '❌ Case closure authority is required.', flags: 64 }); return true; }
    if (proceeding.stage === 'closed') { await interaction.reply({ content: '❌ This case is already closed.', flags: 64 }); return true; }
    const next = { ...proceeding, previousStage: proceeding.stage, stage: 'closed', closedAt: now(), closedBy: interaction.user.id, closeReason: field(interaction, 'reason') };
    const updated = saveProceeding(interaction.guildId, caseId, next, interaction.user.id, 'case.proceeding.closed', proceeding);
    await updateCaseMessage(interaction, updated);
    return true;
  }
  if (key === 'mod_proceeding_decide_submit') {
    if (!isJudge(interaction)) { await interaction.reply({ content: '❌ Admin authority is required to record a decision.', flags: 64 }); return true; }
    if (proceeding.stage !== 'review' || proceeding.reviewingAdminId !== interaction.user.id) { await interaction.reply({ content: '❌ Claim this case from the Review Brief before recording a decision.', flags: 64 }); return true; }
    const action = field(interaction, 'action').toLowerCase();
    const allowed = new Set(['warn', 'timeout', 'quarantine', 'kick', 'ban', 'no_action']);
    if (!allowed.has(action)) { await interaction.reply({ content: '❌ Decision action must be warn, timeout, quarantine, kick, ban, or no_action.', flags: 64 }); return true; }
    const decision = { finding: field(interaction, 'finding'), action, reason: field(interaction, 'reason'), decidedBy: interaction.user.id, decidedAt: now() };
    const recommendationText = field(interaction, 'recommendation');
    const decisionHistory = proceeding.decision ? [...proceeding.decisionHistory, proceeding.decision].slice(-20) : proceeding.decisionHistory;
    const sanctionReview = action === 'ban'
      ? { required: true, status: 'pending', requestedBy: interaction.user.id, requestedAt: now(), approvedBy: null, approvedAt: null }
      : null;
    const next = { ...proceeding, stage: 'decided', reviewingAdminId: interaction.user.id, decision, decisionHistory, sanctionReview, recommendation: recommendationText ? { reason: recommendationText, by: interaction.user.id, at: now() } : proceeding.recommendation };
    const updated = saveProceeding(interaction.guildId, caseId, next, interaction.user.id, 'case.proceeding.decision_recorded', proceeding);
    await updateCaseMessage(interaction, updated);
    return true;
  }
  if (key === 'mod_proceeding_execute_submit') {
    const action = String(proceeding.decision?.action || '');
    if (!isJudge(interaction) || !action || action === 'no_action') { await interaction.reply({ content: '❌ There is no executable sanction.', flags: 64 }); return true; }
    if (proceeding.stage !== 'published' || !proceeding.publication) { await interaction.reply({ content: '❌ The official member record must be published first.', flags: 64 }); return true; }
    if (proceeding.sanctionExecution?.status === 'executed') { await interaction.reply({ content: '❌ Duplicate execution blocked: this sanction has already been executed.', flags: 64 }); return true; }
    if (action === 'ban' && proceeding.sanctionReview?.status !== 'approved') { await interaction.reply({ content: '❌ Second-admin ban approval is still required.', flags: 64 }); return true; }
    if (!canUseModAction(interaction.member, interaction.guild, action, interaction)) { await interaction.reply({ content: `❌ You do not have authority to execute the ${action} sanction.`, flags: 64 }); return true; }
    if (field(interaction, 'confirmation').toUpperCase() !== 'EXECUTE') { await interaction.reply({ content: '❌ Execution cancelled. Type EXECUTE exactly to confirm.', flags: 64 }); return true; }
    const parameter = field(interaction, 'parameter');
    const note = field(interaction, 'note');
    const strikeWeight = action === 'warn' ? Number(parameter) : null;
    const durationMs = action === 'timeout' ? parseProceedingTimeout(parameter) : null;
    const deleteDays = action === 'ban' ? Number(parameter) : null;
    if (action === 'warn' && (!Number.isInteger(strikeWeight) || strikeWeight < 1 || strikeWeight > 5)) { await interaction.reply({ content: '❌ Warning strike weight must be a whole number from 1 to 5.', flags: 64 }); return true; }
    if (action === 'timeout' && !durationMs) { await interaction.reply({ content: '❌ Invalid timeout duration. Use values such as 10m, 1h or 1d; maximum 28 days.', flags: 64 }); return true; }
    if (action === 'ban' && (!Number.isInteger(deleteDays) || deleteDays < 0 || deleteDays > 7)) { await interaction.reply({ content: '❌ Ban delete-message days must be a whole number from 0 to 7.', flags: 64 }); return true; }
    if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: 64 });
    const lockKey = proceedingExecutionLockKey(interaction.guildId, caseId);
    if (PROCEEDING_EXECUTION_LOCKS.has(lockKey)) { await interaction.editReply({ content: '❌ This sanction is already being executed. Duplicate execution is blocked.' }); return true; }
    if (proceeding.sanctionExecution?.status === 'executing' && !executionIsStale(proceeding.sanctionExecution)) { await interaction.editReply({ content: '❌ This sanction is already being executed by another reviewer.' }); return true; }
    PROCEEDING_EXECUTION_LOCKS.add(lockKey);
    const executionStarted = now();
    const operationId = `proceeding_exec_${caseId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const claimedExecution = { status: 'executing', operationId, action, claimedBy: interaction.user.id, claimedAt: executionStarted, startedAt: executionStarted, executedBy: interaction.user.id, executedAt: null, linkedCaseId: null, note: note || null, error: null };
    const atomicClaim = claimProceedingOperationAtomic(interaction.guildId, caseId, { mode: 'execution', claim: claimedExecution, staleMs: PROCEEDING_EXECUTION_STALE_MS });
    const claimed = atomicClaim?.case || null;
    if (!atomicClaim?.ok || !claimed) {
      PROCEEDING_EXECUTION_LOCKS.delete(lockKey);
      const message = atomicClaim?.reason === 'busy'
        ? '❌ This sanction is already being executed by another Goliath process.'
        : atomicClaim?.reason === 'finalized'
          ? '❌ This sanction was already finalised before this execution claim completed.'
          : '❌ Failed to claim the sanction execution lock. No punishment was applied.';
      await interaction.editReply({ content: message });
      return true;
    }
    recordCaseAudit({ guildId: interaction.guildId, caseId, actorId: interaction.user.id, event: 'case.proceeding.sanction_execution_claimed', before: atomicClaim.previous || proceeding.sanctionExecution || null, after: claimedExecution, metadata: { proceeding: true, atomic: true, operationId } });
    const target = await interaction.guild.members.fetch(modCase.userId).catch(() => null);
    if (!target && action !== 'ban') {
      const failed = { ...claimedExecution, status: 'failed', executedAt: now(), error: 'Member is not currently available in this server.' };
      saveProceeding(interaction.guildId, caseId, { ...proceeding, sanctionExecution: failed }, interaction.user.id, 'case.proceeding.sanction_failed', claimedExecution);
      PROCEEDING_EXECUTION_LOCKS.delete(lockKey);
      await interaction.editReply({ content: '❌ The member is not currently available in this server, so this action cannot be executed from Case Management.' }); return true;
    }
    try {
      let linkedCaseId = null;
      let resultSummary = null;
      const reason = `Case #${caseId}: ${proceeding.decision.reason || proceeding.decision.finding || 'Case decision'}`.slice(0, 500);
      if (action === 'warn') {
        const created = createWarningCaseAtomic({ guildId: interaction.guildId, userId: target.id, moderatorId: interaction.user.id, reason, strikeWeight, metadata: { sourceProceedingCaseId: caseId, proceedingOrdered: true }, actorId: interaction.user.id });
        linkedCaseId = created?.modCase?.caseId || null;
        resultSummary = `Warning recorded with strike weight ${strikeWeight}.`;
      } else if (action === 'quarantine') {
        const result = await quarantineMember(interaction.guild, target, { reason, quarantinedBy: interaction.user.id });
        if (!result?.success) throw new Error(result?.error || result?.reason || 'Quarantine failed.');
        const linked = createCase({ guildId: interaction.guildId, userId: target.id, moderatorId: interaction.user.id, action: 'quarantine', reason, metadata: { sourceProceedingCaseId: caseId, proceedingOrdered: true, quarantineResult: result }, status: 'active', actorId: interaction.user.id });
        linkedCaseId = linked?.caseId || null;
        resultSummary = result.dryRun ? 'Quarantine dry-run completed.' : 'Member quarantined.';
      } else if (action === 'ban' && !target) {
        await interaction.guild.members.ban(modCase.userId, {
          deleteMessageSeconds: deleteDays * 24 * 60 * 60,
          reason,
        });
        const linked = createCase({
          guildId: interaction.guildId,
          userId: modCase.userId,
          moderatorId: interaction.user.id,
          action: 'ban',
          reason,
          metadata: {
            sourceProceedingCaseId: caseId,
            proceedingOrdered: true,
            deleteDays,
            executedWithoutMember: true,
          },
          status: 'active',
          actorId: interaction.user.id,
        });
        linkedCaseId = linked?.caseId || null;
        resultSummary = 'ban applied successfully to a user who was no longer in the server.';
      } else {
        const metadata = { sourceProceedingCaseId: caseId, proceedingOrdered: true };
        if (action === 'timeout') {
          metadata.durationRaw = parameter;
          metadata.durationMs = durationMs;
        }
        if (action === 'ban') metadata.deleteDays = deleteDays;
        const result = await executeEnginePunishment(interaction, target, action, reason, metadata, { logAction: `Proceeding ${action}`, targetId: modCase.userId });
        linkedCaseId = result?.modCase?.caseId || null;
        resultSummary = `${action} applied successfully.`;
      }
      const sanctionExecution = { ...claimedExecution, status: 'executed', action, executedBy: interaction.user.id, executedAt: now(), startedAt: executionStarted, linkedCaseId, note: note || null, result: resultSummary, error: null };
      const next = { ...proceeding, sanctionExecution, linkedCases: linkedCaseId ? [...new Set([...proceeding.linkedCases, linkedCaseId])] : proceeding.linkedCases };
      const updated = saveProceeding(interaction.guildId, caseId, next, interaction.user.id, 'case.proceeding.sanction_executed', proceeding);
      PROCEEDING_EXECUTION_LOCKS.delete(lockKey);
      await updateCaseMessage(interaction, updated);
      return true;
    } catch (error) {
      const sanctionExecution = { ...claimedExecution, status: 'failed', action, executedBy: interaction.user.id, executedAt: now(), startedAt: executionStarted, linkedCaseId: null, note: note || null, error: String(error?.message || error || 'Unknown sanction execution failure').slice(0, 500) };
      const next = { ...proceeding, sanctionExecution };
      const updated = saveProceeding(interaction.guildId, caseId, next, interaction.user.id, 'case.proceeding.sanction_failed', proceeding);
      PROCEEDING_EXECUTION_LOCKS.delete(lockKey);
      await updateCaseMessage(interaction, updated);
      return true;
    }
  }
  if (key === 'mod_proceeding_publish_submit') {
    if (!canPublishProceeding(interaction)) { await interaction.reply({ content: '❌ Case publishing authority is required to publish a record.', flags: 64 }); return true; }
    if (!proceeding.decision) { await interaction.reply({ content: '❌ Record a decision before publishing the member record.', flags: 64 }); return true; }
    if (proceeding.decision.action === 'ban' && proceeding.sanctionReview?.status !== 'approved') { await interaction.reply({ content: '❌ Ban decisions require approval from a second admin before the member record can be published.', flags: 64 }); return true; }
    const summary = field(interaction, 'summary');
    const previousRevision = Number(proceeding.publication?.revision || 0);
    const publicationHistory = proceeding.publication ? [...proceeding.publicationHistory, proceeding.publication].slice(-20) : proceeding.publicationHistory;
    const publication = { revision: previousRevision + 1, summary, publishedBy: interaction.user.id, publishedAt: proceeding.publication?.publishedAt || now(), updatedAt: now(), verifiedEvidenceIds: proceeding.evidence.filter((item) => item.status === 'verified').map((item) => item.id) };
    const next = { ...proceeding, stage: 'published', publication, publicationHistory };
    const updated = saveProceeding(interaction.guildId, caseId, next, interaction.user.id, previousRevision ? 'case.proceeding.publication_updated' : 'case.proceeding.published', proceeding);
    await updateCaseMessage(interaction, updated);
    return true;
  }
  return false;
}

function buildUserPublishedCasesPanel(interaction) {
  const cases = getProceedingCases(interaction.guildId, interaction.user.id).filter((entry) => parseProceeding(entry).stage === 'published' && parseProceeding(entry).publication);
  const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('📁 My Published Cases')
    .setDescription(cases.length
      ? ['These are the official records staff have published to you. Internal staff notes, drafts and rejected evidence are not shown.', '', ...cases.slice(0, 10).map((entry) => {
        const proceeding = parseProceeding(entry); const pub = proceeding.publication; const decision = proceeding.decision || {};
        const appeals = Array.isArray(entry.metadata?.appeals) ? entry.metadata.appeals : [];
        const latestAppeal = appeals.slice().sort((a, b) => String(b.submittedAt || '').localeCompare(String(a.submittedAt || '')))[0];
        const appealLine = latestAppeal ? `\n**Appeal:** ${latestAppeal.status === 'pending' ? '⏳ Pending' : latestAppeal.status === 'approved' ? '✅ Approved' : '❌ Denied'}` : '';
        return `**Case #${entry.caseId}** • Severity **${severityText(proceeding.severity)}** • Revision **${pub.revision || 1}**\n**Finding:** ${decision.finding || 'Recorded'}\n**Decision:** ${decision.action || 'No action'}${appealLine}\n${cleanExcerpt(pub.summary, 350)}\nPublished ${discordTime(pub.updatedAt || pub.publishedAt)}`;
      })].join('\n\n')
      : 'No proceeding case records have been published to you.')
    .setFooter({ text: 'Only verified, published information is visible here' })
    .setTimestamp();
  return {
    embeds: [embed],
    components: [
      row(button('user:module:appeals', 'Appeals', '📝', ButtonStyle.Primary), button('user:home', 'User Panel', '🏠')),
      row(button('user:category:account', 'Back', '⬅️')),
    ],
  };
}

module.exports = {
  PROCEEDING_ACTION,
  stageText,
  severityText,
  parseProceeding,
  caseIsProceeding,
  getProceedingCases,
  buildProceedingDashboard,
  buildCaseFile,
  buildUserPublishedCasesPanel,
  handleProceedingInteraction,
  handleProceedingModal,
};
