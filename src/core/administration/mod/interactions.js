'use strict';

const Discord = require('discord.js');
const { safeReply, safeUpdate } = require('../../../core/ui/interactionResponse');
const { db, getCaseById, getCasesForUser, updateCaseStatus, recordCaseAudit } = require('./storage');
const {
  fetchTarget,
  ensurePanelAccess,
  ensureActionAccess,
  requireModeratableTarget,
  recordModerationSystemEvent,
  canUseModAction,
  resolveAuthorityPermission,
} = require('./permissions');
const { buildPunishmentModal, buildBulkModal, submitPunishmentRequest, submitBulkModal, createConfirmation, executePendingAction } = require('./punishments');
const { getWarningCountForUser, syncExpiredWarningsToCases, showWarningModal, showRemoveWarningModal, submitWarningModal, submitRemoveWarningRequest } = require('./warns');
const { openCaseTool, handleCaseAction, submitCaseModal, handleExternalAppealInteraction } = require('./cases');
const { openCaseSearch, handleCaseSearchAction, handleCaseSearchSelect, handleCaseSearchModal } = require('./caseSearch');
const memberIntelligence = require('./intelligence');
const caseProceeding = require('./caseProceeding');
const quarantineInteractions = require('./quarantineInteractions');
const { quarantineMember, restoreQuarantinedMember, getQuarantineState } = require('../../security/protection/quarantine');
const {
  renderDashboard,
  openExportModal,
  refreshDashboard,
  refreshCasesDashboard,
  handleDashboardNavigation,
  handleUserSelectMenu,
  handleExportInteraction,
} = require('./panel');

const PUNISHMENT_ACTIONS = new Set(['timeout', 'kick', 'ban']);
const BULK_ACTIONS = new Set(['warn', 'timeout', 'kick', 'ban']);
const OPEN_ACTIONS = new Set(['warn', ...PUNISHMENT_ACTIONS]);
const CONFIRM_LOCKS = new Set();
function isModCustomId(customId) { const id = String(customId || ''); return id.startsWith('mod_') || id.startsWith('mod:'); }
function isExternalAppealCustomId(customId) { const id = String(customId || ''); return id === 'mod_appeal_lookup' || id === 'mod_appeal_lookup_submit' || id.startsWith('mod_appeal_external:') || id.startsWith('mod_appeal_external_submit:'); }
function getTargetIdFromCustomId(customId) { return String(customId || '').split(':')[1] || 'none'; }
function getPrefixedAction(customId, prefix, allowedActions) { const id = String(customId || '').split(':')[0]; if (!id.startsWith(prefix)) return null; const action = id.slice(prefix.length); return allowedActions.has(action) ? action : null; }
function getPunishmentSubmitAction(customId) { return getPrefixedAction(customId, 'mod_submit_', PUNISHMENT_ACTIONS); }
function getBulkAction(customId) { return getPrefixedAction(customId, 'mod_submit_bulk_', BULK_ACTIONS) || getPrefixedAction(customId, 'mod_bulk_', BULK_ACTIONS); }
function parseConfirmActionContext(customId) { const parts = String(customId || '').split(':'); const requestedPage = Number(parts[5]); return { token: parts[1] || null, context: { view: parts[2] || 'overview', actionFilter: parts[3] || 'all', statusFilter: parts[4] || 'all', page: Number.isFinite(requestedPage) ? Math.max(0, Math.trunc(requestedPage)) : 0 } }; }
function fieldValue(i, key) { try { return String(i.fields?.getTextInputValue?.(key) || '').trim(); } catch { return ''; } }
function auditFailure(i, event, action, targetId, reason, metadata = {}) { return recordModerationSystemEvent({ interaction: i, event, action, targetId, reason, metadata }); }
function scanTimestamp(ms) {
  const value = Number(ms);
  return Number.isFinite(value) && value > 0 ? `<t:${Math.floor(value / 1000)}:F> • <t:${Math.floor(value / 1000)}:R>` : 'Unknown';
}
function normalizeIdentity(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function parseJson(value, fallback = {}) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try { return JSON.parse(value) || fallback; } catch { return fallback; }
}
function parseCaseMetadata(modCase) {
  return parseJson(modCase?.metadata, {});
}
function canScanCapability(i, action, fallbackAction = 'view_case_detail') {
  const authority = resolveAuthorityPermission(i?.member, i?.guild, action, i);
  if (authority?.handled) return authority.allowed;
  return canUseModAction(i?.member, i?.guild, fallbackAction, i);
}
async function ensureScanCapability(i, action, deniedMessage, fallbackAction = 'view_case_detail') {
  const authority = resolveAuthorityPermission(i?.member, i?.guild, action, i);
  if (authority?.handled) {
    if (authority.allowed) return true;
    recordModerationSystemEvent({ interaction: i, event: 'moderation.action.denied', action, reason: deniedMessage, metadata: { authorityPermission: authority.permissionKey, authoritySource: authority.source } });
    await safeReply(i, { content: deniedMessage, flags: 64 });
    return false;
  }
  return ensureActionAccess(i, fallbackAction, deniedMessage);
}
function investigationAuditRows(guildId, targetId, limit = 200) {
  try {
    const rows = db.prepare("SELECT audit_id, actor_id, event, after_value, metadata, created_at FROM case_audit WHERE guild_id = ? AND event IN ('moderation.member_scan.note_added','moderation.member_scan.watch_updated') ORDER BY created_at DESC LIMIT ?").all(String(guildId), Math.max(1, Math.min(500, Number(limit) || 200)));
    return rows.filter((row) => String(parseJson(row.metadata, {}).targetId || '') === String(targetId));
  } catch (error) {
    console.error('❌ Member investigation state query failed:', error);
    return [];
  }
}
function getInvestigationState(guildId, targetId) {
  const rows = investigationAuditRows(guildId, targetId);
  const notes = [];
  let watch = null;
  for (const row of rows) {
    const after = parseJson(row.after_value, {});
    if (row.event === 'moderation.member_scan.watch_updated' && watch === null) {
      watch = { enabled: Boolean(after.enabled), reason: after.reason || null, actorId: row.actor_id || null, at: row.created_at || null };
    }
    if (row.event === 'moderation.member_scan.note_added' && after.note) {
      notes.push({ note: String(after.note), actorId: row.actor_id || null, at: row.created_at || null });
    }
  }
  return { watched: Boolean(watch?.enabled), watch, notes: notes.slice(0, 10) };
}
function aggregateSuspectedEvidence(guildId, targetId) {
  const matches = new Map();
  for (const row of scanAuditRows(guildId, targetId, 100)) {
    const after = parseJson(row.after_value, {});
    for (const match of Array.isArray(after.suspectedMatches) ? after.suspectedMatches : []) {
      if (!match?.userId) continue;
      const key = String(match.userId);
      const current = matches.get(key) || { userId: key, appearances: 0, maxScore: 0, signals: new Set(), firstSeen: row.created_at || null, lastSeen: row.created_at || null };
      current.appearances += 1;
      current.maxScore = Math.max(current.maxScore, Number(match.score) || 0);
      for (const signal of Array.isArray(match.signals) ? match.signals : []) current.signals.add(String(signal));
      current.firstSeen = current.firstSeen || row.created_at || null;
      current.lastSeen = row.created_at || current.lastSeen;
      matches.set(key, current);
    }
  }
  return [...matches.values()]
    .map((entry) => ({ ...entry, signals: [...entry.signals] }))
    .sort((a, b) => (b.appearances - a.appearances) || (b.maxScore - a.maxScore))
    .slice(0, 10);
}
function scanAuditRows(guildId, targetId, limit = 25) {
  try {
    const rows = db.prepare("SELECT audit_id, actor_id, after_value, metadata, created_at FROM case_audit WHERE guild_id = ? AND event = 'moderation.member_scan.completed' ORDER BY created_at DESC LIMIT ?").all(String(guildId), Math.max(1, Math.min(100, Number(limit) || 25)));
    return rows.filter((row) => String(parseJson(row.metadata, {}).targetId || '') === String(targetId));
  } catch (error) {
    console.error('❌ Member scan history query failed:', error);
    return [];
  }
}
function historicalIdentitySnapshot(guildId, targetId) {
  const names = new Set();
  const globals = new Set();
  const displays = new Set();
  const avatars = new Set();
  const rows = scanAuditRows(guildId, targetId, 100);
  for (const row of rows) {
    const identity = parseJson(row.after_value, {}).identity || {};
    if (identity.username) names.add(String(identity.username));
    if (identity.globalName) globals.add(String(identity.globalName));
    if (identity.displayName) displays.add(String(identity.displayName));
    if (identity.avatarHash) avatars.add(String(identity.avatarHash));
  }
  return { names: [...names], globals: [...globals], displays: [...displays], avatars: [...avatars], scanCount: rows.length };
}
function getCrossGuildModeration(userId, currentGuildId) {
  try {
    const rows = db.prepare('SELECT guild_id, COUNT(*) AS case_count, MAX(created_at) AS last_case_at FROM cases WHERE user_id = ? GROUP BY guild_id ORDER BY last_case_at DESC').all(String(userId));
    const outside = rows.filter((row) => String(row.guild_id) !== String(currentGuildId));
    return {
      guildCount: outside.length,
      caseCount: outside.reduce((total, row) => total + Number(row.case_count || 0), 0),
      rows: outside.slice(0, 5),
    };
  } catch (error) {
    console.error('❌ Cross-guild moderation intelligence query failed:', error);
    return { guildCount: 0, caseCount: 0, rows: [] };
  }
}
function compareIdentitySignals(primary, candidate) {
  if (!primary?.user || !candidate?.user || primary.id === candidate.id) return { score: 0, signals: [] };
  const signals = [];
  let score = 0;
  const primaryUsername = normalizeIdentity(primary.user.username);
  const candidateUsername = normalizeIdentity(candidate.user.username);
  const primaryGlobal = normalizeIdentity(primary.user.globalName || primary.displayName);
  const candidateGlobal = normalizeIdentity(candidate.user.globalName || candidate.displayName);
  if (primary.user.avatar && candidate.user.avatar && primary.user.avatar === candidate.user.avatar) { score += 45; signals.push('same custom avatar hash'); }
  if (primaryUsername && candidateUsername === primaryUsername) { score += 30; signals.push('same normalized username'); }
  else if (primaryUsername && candidateUsername && (candidateUsername.includes(primaryUsername) || primaryUsername.includes(candidateUsername)) && Math.min(candidateUsername.length, primaryUsername.length) >= 5) { score += 12; signals.push('similar username'); }
  if (primaryGlobal && candidateGlobal && primaryGlobal === candidateGlobal) { score += 20; signals.push('same display/global name'); }
  const createdDelta = Math.abs((candidate.user.createdTimestamp || 0) - (primary.user.createdTimestamp || 0));
  if (createdDelta && createdDelta <= 86400000) { score += 10; signals.push('accounts created within 24h'); }
  const joinedDelta = Math.abs((candidate.joinedTimestamp || 0) - (primary.joinedTimestamp || 0));
  if (joinedDelta && joinedDelta <= 86400000) { score += 10; signals.push('joined server within 24h'); }
  return { score: Math.min(95, score), signals };
}
function buildSuspectedAccounts(guild, target) {
  const candidates = [];
  for (const member of guild.members.cache.values()) {
    if (!member?.user || member.id === target.id || member.user.bot) continue;
    const result = compareIdentitySignals(target, member);
    if (result.score >= 35) candidates.push({ member, ...result });
  }
  return candidates.sort((a, b) => b.score - a.score).slice(0, 5);
}
function moderationSummary(guildId, userId) {
  const cases = getCasesForUser(guildId, userId) || [];
  const warningCount = getWarningCountForUser(guildId, userId);
  const activeCases = cases.filter((entry) => String(entry.status || 'active') === 'active').length;
  const bans = cases.filter((entry) => entry.action === 'ban').length;
  const timeouts = cases.filter((entry) => entry.action === 'timeout').length;
  const appeals = cases.reduce((total, entry) => total + (Array.isArray(parseCaseMetadata(entry).appeals) ? parseCaseMetadata(entry).appeals.length : 0), 0);
  const evidence = cases.reduce((total, entry) => total + (Array.isArray(parseCaseMetadata(entry).evidence) ? parseCaseMetadata(entry).evidence.filter((item) => !item?.removedAt).length : 0), 0);
  return { cases, warningCount, activeCases, bans, timeouts, appeals, evidence };
}
function calculateModerationRisk(summary, crossGuild) {
  const reasons = [];
  let score = 0;
  const warnings = Math.min(20, Math.max(0, Number(summary.warningCount) || 0) * 4);
  const active = Math.min(20, Math.max(0, Number(summary.activeCases) || 0) * 5);
  const bans = Math.min(25, Math.max(0, Number(summary.bans) || 0) * 10);
  const timeouts = Math.min(15, Math.max(0, Number(summary.timeouts) || 0) * 4);
  const network = Math.min(20, Math.max(0, Number(crossGuild?.caseCount) || 0) * 4);
  if (warnings) { score += warnings; reasons.push(`${summary.warningCount} active warning(s)`); }
  if (active) { score += active; reasons.push(`${summary.activeCases} active moderation case(s)`); }
  if (bans) { score += bans; reasons.push(`${summary.bans} ban case(s)`); }
  if (timeouts) { score += timeouts; reasons.push(`${summary.timeouts} timeout case(s)`); }
  if (network) { score += network; reasons.push(`${crossGuild.caseCount} case(s) for the same Discord ID in other Goliath guilds`); }
  score = Math.min(100, score);
  const label = score >= 70 ? '🔴 High' : score >= 40 ? '🟠 Elevated' : score >= 20 ? '🟡 Moderate' : '🟢 Low';
  return { score, label, reasons };
}
function buildInvestigationNoteModal(targetId) {
  return new Discord.ModalBuilder().setCustomId(`mod_scan_note_submit:${targetId}`).setTitle('Add Investigation Note').addComponents(
    new Discord.ActionRowBuilder().addComponents(
      new Discord.TextInputBuilder().setCustomId('note').setLabel('Investigation note').setStyle(Discord.TextInputStyle.Paragraph).setRequired(true).setMinLength(2).setMaxLength(1000).setPlaceholder('Record relevant context, observations, or why this account needs review.')
    )
  );
}
function buildQuarantineModal(targetId) {
  return new Discord.ModalBuilder().setCustomId(`mod_submit_quarantine:${targetId}`).setTitle('Quarantine Member').addComponents(
    new Discord.ActionRowBuilder().addComponents(
      new Discord.TextInputBuilder().setCustomId('reason').setLabel('Reason').setStyle(Discord.TextInputStyle.Paragraph).setRequired(true).setMinLength(2).setMaxLength(500).setPlaceholder('Why is this member being quarantined?')
    )
  );
}
function buildMemberScanPayload(i, target) {
  const access = {
    history: canScanCapability(i, 'scan_history'),
    suspects: canScanCapability(i, 'scan_suspects'),
    network: canScanCapability(i, 'scan_network'),
    notes: canScanCapability(i, 'scan_notes'),
    watch: canScanCapability(i, 'scan_watch'),
    links: canScanCapability(i, 'scan_links'),
    cases: canUseModAction(i?.member, i?.guild, 'view_cases', i),
  };
  const summary = moderationSummary(i.guild.id, target.id);
  const { cases, warningCount, activeCases, bans, timeouts, appeals, evidence } = summary;
  const roles = [...target.roles.cache.values()].filter((role) => role.id !== i.guild.id).sort((a, b) => b.position - a.position);
  const keyPermissions = target.permissions.toArray().filter((name) => ['Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels', 'ManageMessages', 'ModerateMembers', 'KickMembers', 'BanMembers'].includes(name));
  const flags = target.user.flags?.toArray?.() || [];
  const suspects = access.suspects ? buildSuspectedAccounts(i.guild, target) : [];
  const history = access.history ? historicalIdentitySnapshot(i.guild.id, target.id) : { names: [], globals: [], displays: [], avatars: [], scanCount: 0 };
  const crossGuild = access.network ? getCrossGuildModeration(target.id, i.guild.id) : { guildCount: 0, caseCount: 0, rows: [] };
  const investigation = (access.notes || access.watch) ? getInvestigationState(i.guild.id, target.id) : { watched: false, watch: null, notes: [] };
  const persistentLinks = access.links ? aggregateSuspectedEvidence(i.guild.id, target.id) : [];
  const risk = calculateModerationRisk(summary, crossGuild);
  const historicalNames = [...new Set([...history.names, ...history.globals, ...history.displays])].filter((name) => name && name !== target.user.username && name !== target.user.globalName && name !== target.displayName);
  const suspectText = suspects.length
    ? suspects.map(({ member, score, signals }) => `${score >= 70 ? '🔴 **STRONG MATCH**' : '🟠 **POSSIBLE MATCH**'} — ${member.user} • **${score}%**\n${signals.map((signal) => `• ${signal}`).join('\n')}`).join('\n\n')
    : '⚪ **NO LINK FOUND** — No evidence-based suspected account match in the current guild cache.';
  const recent = cases.slice(0, 3).map((entry) => `#${entry.caseId} • ${entry.action} • ${entry.status || 'active'} • ${(entry.reason || 'No reason').slice(0, 120)}`).join('\n') || 'No recorded moderation cases.';
  const scanId = `scan_${Date.now().toString(36)}_${target.id.slice(-6)}`;
  const identityLines = [
    'Username: ' + String(target.user.username) + ' • Global: ' + String(target.user.globalName || 'None'),
    'Display: ' + String(target.displayName || target.user.username) + ' • Bot: ' + (target.user.bot ? 'Yes' : 'No'),
    'Created: ' + scanTimestamp(target.user.createdTimestamp),
  ];
  if (access.history) identityLines.push(historicalNames.length
    ? 'Previous: ' + historicalNames.slice(0, 8).join(' • ') + ' • ' + history.scanCount + ' prior scan(s)'
    : 'History: No identity changes captured • ' + history.scanCount + ' prior scan(s)');

  const membershipLines = [
    'Joined: ' + scanTimestamp(target.joinedTimestamp),
    'Boosting: ' + (target.premiumSinceTimestamp ? scanTimestamp(target.premiumSinceTimestamp) : 'No') + ' • Screening: ' + (target.pending ? 'Pending' : 'Complete'),
    'Timeout: ' + (target.communicationDisabledUntilTimestamp ? scanTimestamp(target.communicationDisabledUntilTimestamp) : 'None'),
    'Roles (' + roles.length + '): ' + ((roles.slice(0, 5).map((role) => String(role)).join(', ') || 'None').slice(0, 320)) + (roles.length > 5 ? ` • +${roles.length - 5} more` : ''),
    'Elevated permissions: ' + (keyPermissions.length ? keyPermissions.join(', ') : 'None'),
    'Account flags: ' + (flags.length ? flags.join(', ') : 'None'),
  ];

  const moderationLines = [
    'Warnings: **' + warningCount + '** • Cases: **' + cases.length + '** (' + activeCases + ' active) • Appeals: **' + appeals + '**',
    'Timeouts: **' + timeouts + '** • Bans: **' + bans + '** • Evidence: **' + evidence + '**',
    'Risk: **' + risk.score + '/100 • ' + risk.label + '**',
  ];
  if (risk.reasons.length) moderationLines.push(risk.reasons.map((reason) => '• ' + reason).join('\n'));
  moderationLines.push('Risk uses only intelligence this viewer is authorized to access.');

  const investigationLines = [];
  if (access.watch) investigationLines.push('Watch: **' + (investigation.watched ? 'ON' : 'OFF') + '**' + (investigation.watch?.reason ? ' • ' + investigation.watch.reason : ''));
  if (access.notes) investigationLines.push('Notes: **' + investigation.notes.length + '**' + (investigation.notes[0] ? ' • Latest: ' + investigation.notes[0].note.slice(0, 240) : ''));
  if (access.network) investigationLines.push(crossGuild.guildCount
    ? 'Network: **' + crossGuild.caseCount + '** case(s) across **' + crossGuild.guildCount + '** other Goliath guild(s)'
    : 'Network: No cases for this Discord ID in other Goliath guilds.');
  if (access.suspects) investigationLines.push('Suspected accounts: ' + (suspects.length ? '**' + suspects.length + ' match(es)**\n' + suspectText.slice(0, 500) : '**None found**'));
  if (access.links) investigationLines.push('Confirmed links: ' + (persistentLinks.length ? '**' + persistentLinks.length + ' evidence record(s)**' : 'None'));

  const fields = [
    { name: '🪪 Identity & History', value: identityLines.join('\n').slice(0, 1024), inline: false },
    { name: '🏠 Membership & Access', value: membershipLines.join('\n').slice(0, 1024), inline: false },
    { name: '⚖️ Moderation & Risk', value: moderationLines.join('\n').slice(0, 1024), inline: false },
    { name: '🕘 Recent Cases', value: recent.slice(0, 1024), inline: false },
  ];
  if (investigationLines.length) fields.push({ name: '👁️ Investigation Intelligence', value: investigationLines.join('\n').slice(0, 1024), inline: false });

  const sources = ['Discord API', 'guild member cache', 'Goliath moderation cases', 'warnings', 'case metadata', 'appeals', 'evidence'];
  if (access.history) sources.push('scan history');
  if (access.network) sources.push('same-ID cross-guild case intelligence');
  if (access.links) sources.push('persistent scan correlation');
  if (access.notes || access.watch) sources.push('investigation state');
  if (access.suspects) sources.push('heuristic guild correlation');
  // Data-source provenance remains in the scan audit metadata rather than consuming viewer space.

  const embed = new Discord.EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`🔎 Member Intelligence Scan • ${target.user.tag}`)
    .setDescription([
      `**Scan ID:** \`${scanId}\``,
      `**Target:** ${target.user} (\`${target.id}\`)`,
      '',
      'Evidence-led overview for authorized management. Use the drill-down controls for full history, reputation and risk evidence.',
    ].join('\n'))
    .addFields(fields)
    .setFooter({ text: `Scanned by ${i.user?.tag || i.user?.username || i.user?.id || 'Unknown'} • evidence-based intelligence` })
    .setTimestamp();

  const primaryButtons = [
    new Discord.ButtonBuilder().setCustomId(`mod_member_scan:${target.id}`).setLabel('Rescan').setEmoji('🔄').setStyle(Discord.ButtonStyle.Primary),
  ];
  if (access.history) primaryButtons.push(new Discord.ButtonBuilder().setCustomId(`mod_scan_history:${target.id}`).setLabel('History').setEmoji('🕘').setStyle(Discord.ButtonStyle.Secondary));
  const components = [new Discord.ActionRowBuilder().addComponents(...primaryButtons)];
  const intelligenceButtons = [];
  if (access.links) intelligenceButtons.push(new Discord.ButtonBuilder().setCustomId(`mod_scan_links:${target.id}`).setLabel(`Correlations (${persistentLinks.length})`.slice(0, 80)).setEmoji('🔗').setStyle(Discord.ButtonStyle.Secondary));
  if (access.notes) intelligenceButtons.push(new Discord.ButtonBuilder().setCustomId(`mod_scan_note:${target.id}`).setLabel('Notes').setEmoji('📝').setStyle(Discord.ButtonStyle.Secondary));
  if (access.watch) intelligenceButtons.push(new Discord.ButtonBuilder().setCustomId(`mod_scan_watch:${target.id}`).setLabel(investigation.watched ? 'Remove Watch' : 'Watch Status').setEmoji('👁️').setStyle(investigation.watched ? Discord.ButtonStyle.Danger : Discord.ButtonStyle.Secondary));
  if (intelligenceButtons.length) components.push(new Discord.ActionRowBuilder().addComponents(...intelligenceButtons));
  const navButtons = [new Discord.ButtonBuilder().setCustomId(`mod_dashboard:${target.id}:intelligence`).setLabel('⬅️ Back').setStyle(Discord.ButtonStyle.Secondary)];
  if (access.cases) navButtons.push(new Discord.ButtonBuilder().setCustomId(`mod_export_cases:${target.id}`).setLabel('📤 Export').setStyle(Discord.ButtonStyle.Secondary));
  components.push(new Discord.ActionRowBuilder().addComponents(...navButtons));
  return { scanId, cases, suspects, history, crossGuild, investigation, persistentLinks, risk, access, embed, components };
}
function buildScanHistoryPayload(i, target, origin = 'scan') {
  const rows = scanAuditRows(i.guild.id, target.id, 25);
  const historyText = rows.length ? rows.slice(0, 10).map((row) => {
    const after = parseJson(row.after_value, {});
    const identity = after.identity || {};
    const ts = new Date(row.created_at || 0).getTime();
    const when = Number.isFinite(ts) && ts > 0 ? `<t:${Math.floor(ts / 1000)}:R>` : String(row.created_at || 'Unknown time');
    const suspected = Array.isArray(after.suspectedMatches) ? after.suspectedMatches.length : Number(after.suspectedCount || 0);
    return `• ${when} • scan \`${after.scanId || row.audit_id}\` • ${identity.username || target.user.username} • ${after.caseCount || 0} case(s) • ${suspected} suspected match(es)`;
  }).join('\n') : 'No previous Goliath Member Scan audit records exist for this member yet.';
  const identity = historicalIdentitySnapshot(i.guild.id, target.id);
  const embed = new Discord.EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`🕘 Member Scan History • ${target.user.tag}`)
    .setDescription(`**Target:** ${target.user} (\`${target.id}\`)\n\n${historyText.slice(0, 3500)}`)
    .addFields(
      { name: 'Captured Usernames', value: identity.names.length ? identity.names.slice(0, 20).map((value) => `\`${value}\``).join(' • ') : 'None captured yet.', inline: false },
      { name: 'Captured Global / Display Names', value: [...new Set([...identity.globals, ...identity.displays])].length ? [...new Set([...identity.globals, ...identity.displays])].slice(0, 20).map((value) => `\`${value}\``).join(' • ') : 'None captured yet.', inline: false },
      { name: 'Captured Avatar Hashes', value: identity.avatars.length ? `${identity.avatars.length} distinct custom avatar hash(es) recorded across scans.` : 'No custom avatar hashes captured yet.', inline: false },
    )
    .setFooter({ text: 'History is built only from Goliath scan audit snapshots.' })
    .setTimestamp();
  const components = [];
  const canManageHistory = rows.length && canScanCapability(i, 'scan_notes', 'add_case_note');
  if (canManageHistory) {
    const select = new Discord.StringSelectMenuBuilder()
      .setCustomId(`mod_scan_delete_select:${target.id}:${origin}`)
      .setPlaceholder('🗑️ Select a scan to delete')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(rows.slice(0, 10).map((row) => {
        const after = parseJson(row.after_value, {});
        const identityRow = after.identity || {};
        return {
          label: `Scan ${String(after.scanId || row.audit_id).slice(0, 70)}`,
          description: `${identityRow.username || target.user.username} • ${after.caseCount || 0} case(s)`.slice(0, 100),
          value: String(row.audit_id),
        };
      }));
    components.push(new Discord.ActionRowBuilder().addComponents(select));
  }
  const buttons = [];
  if (origin === 'landing') buttons.push(new Discord.ButtonBuilder().setCustomId(`mod_dashboard:${target.id}:intelligence`).setLabel('⬅️ Back to Intelligence').setStyle(Discord.ButtonStyle.Secondary));
  else if (canScanCapability(i, 'scan_run')) buttons.push(new Discord.ButtonBuilder().setCustomId(`mod_scan_view:${target.id}`).setLabel('⬅️ Back to Scan').setStyle(Discord.ButtonStyle.Secondary));
  if (canScanCapability(i, 'scan_compare')) buttons.push(new Discord.ButtonBuilder().setCustomId(`mod_scan_history_compare:${target.id}:${origin}`).setLabel('Compare Account').setEmoji('🧬').setStyle(Discord.ButtonStyle.Secondary));
  if (canManageHistory) buttons.push(new Discord.ButtonBuilder().setCustomId(`mod_scan_clear_history:${target.id}:${origin}`).setLabel('Clear History').setEmoji('🧹').setStyle(Discord.ButtonStyle.Danger));
  if (buttons.length) components.push(new Discord.ActionRowBuilder().addComponents(...buttons));
  return { embed, components };
}
function buildComparisonPayload(i, primary, secondary, origin = 'scan') {
  const correlation = compareIdentitySignals(primary, secondary);
  const left = moderationSummary(i.guild.id, primary.id);
  const right = moderationSummary(i.guild.id, secondary.id);
  const label = correlation.score >= 70 ? '🔴 STRONG MATCH' : correlation.score >= 35 ? '🟠 POSSIBLE MATCH' : '⚪ LOW CORRELATION';
  const deltaCreated = Math.abs((primary.user.createdTimestamp || 0) - (secondary.user.createdTimestamp || 0));
  const deltaJoined = Math.abs((primary.joinedTimestamp || 0) - (secondary.joinedTimestamp || 0));
  const embed = new Discord.EmbedBuilder()
    .setColor(correlation.score >= 70 ? 0xED4245 : correlation.score >= 35 ? 0xFEE75C : 0x5865F2)
    .setTitle('🧬 Goliath Account Comparison')
    .setDescription([
      `${primary.user} (\`${primary.id}\`)`,
      'vs',
      `${secondary.user} (\`${secondary.id}\`)`,
      '',
      `**Correlation:** ${label} • **${correlation.score}%**`,
      'This score is an investigation aid, not proof that both Discord accounts belong to the same person.',
    ].join('\n'))
    .addFields(
      { name: '🔎 Correlation Signals', value: correlation.signals.length ? correlation.signals.map((signal) => `• ${signal}`).join('\n') : 'No meaningful identity correlation signals detected.', inline: false },
      { name: `🪪 ${primary.user.username}`, value: [`Global: ${primary.user.globalName || 'None'}`, `Display: ${primary.displayName}`, `Created: ${scanTimestamp(primary.user.createdTimestamp)}`, `Joined: ${scanTimestamp(primary.joinedTimestamp)}`, `Warnings: ${left.warningCount} • Cases: ${left.cases.length} • Bans: ${left.bans}`].join('\n'), inline: true },
      { name: `🪪 ${secondary.user.username}`, value: [`Global: ${secondary.user.globalName || 'None'}`, `Display: ${secondary.displayName}`, `Created: ${scanTimestamp(secondary.user.createdTimestamp)}`, `Joined: ${scanTimestamp(secondary.joinedTimestamp)}`, `Warnings: ${right.warningCount} • Cases: ${right.cases.length} • Bans: ${right.bans}`].join('\n'), inline: true },
      { name: '⏱️ Timeline Difference', value: [`Account creation gap: **${Math.round(deltaCreated / 3600000)}h**`, `Guild join gap: **${Math.round(deltaJoined / 3600000)}h**`].join('\n'), inline: false },
    )
    .setFooter({ text: 'Evidence-based comparison • no private Discord data is exposed to bots' })
    .setTimestamp();
  const buttons = [
    new Discord.ButtonBuilder().setCustomId(`mod_scan_history:${primary.id}:${origin}`).setLabel('⬅️ Back to Scan History').setStyle(Discord.ButtonStyle.Secondary),
  ];
  return { correlation, embed, components: [new Discord.ActionRowBuilder().addComponents(...buttons)] };
}
async function runMemberScan(i, targetId, { record = true } = {}) {
  const allowed = await ensureScanCapability(i, 'scan_run', '❌ You do not have permission to run a member intelligence scan.');
  if (!allowed) return true;
  if (!i.deferred && !i.replied && i.isMessageComponent?.()) await i.deferUpdate();
  const target = await fetchTarget(i.guild, targetId);
  if (!target) return safeReply(i, { content: '❌ Could not find that member in this server.', flags: 64 });
  const report = buildMemberScanPayload(i, target);
  await memberIntelligence.decorateScan(i, target, report);
  if (record) recordModerationSystemEvent({
    interaction: i,
    event: 'moderation.member_scan.completed',
    action: 'member_scan',
    targetId: target.id,
    after: {
      scanId: report.scanId,
      caseCount: report.cases.length,
      suspectedCount: report.suspects.length,
      suspectedMatches: report.suspects.map((entry) => ({ userId: entry.member.id, score: entry.score, signals: entry.signals })),
      identity: {
        username: target.user.username || null,
        globalName: target.user.globalName || null,
        displayName: target.displayName || null,
        avatarHash: target.user.avatar || null,
        accountCreatedAt: target.user.createdTimestamp || null,
        joinedAt: target.joinedTimestamp || null,
      },
      network: { otherGuildCount: report.crossGuild.guildCount, otherGuildCaseCount: report.crossGuild.caseCount },
      risk: report.risk,
      investigation: { watched: report.investigation.watched, noteCount: report.investigation.notes.length },
      persistentLinkEvidence: report.persistentLinks.map((entry) => ({ userId: entry.userId, appearances: entry.appearances, maxScore: entry.maxScore, signals: entry.signals })),
      visibleCapabilities: report.access,
    },
    metadata: { dataSources: ['discord_api', 'guild_cache', 'moderation_cases', 'warnings', 'case_metadata', 'appeals', 'evidence', ...(report.access.history ? ['scan_history'] : []), ...(report.access.network ? ['cross_guild_same_id_cases'] : []), ...(report.access.links ? ['persistent_scan_correlation'] : []), ...((report.access.notes || report.access.watch) ? ['investigation_state'] : []), ...(report.access.suspects ? ['heuristic_guild_correlation'] : [])] },
  });
  return safeUpdate(i, { content: null, embeds: [report.embed], components: report.components });
}
async function showMemberScanHistory(i, targetId, origin = 'scan') {
  const allowed = await ensureScanCapability(i, 'scan_history', '❌ You do not have permission to view member scan history.');
  if (!allowed) return true;
  const target = await fetchTarget(i.guild, targetId);
  if (!target) return safeReply(i, { content: '❌ Could not find that member in this server.', flags: 64 });
  const payload = buildScanHistoryPayload(i, target, origin);
  recordModerationSystemEvent({ interaction: i, event: 'moderation.member_scan.history_viewed', action: 'member_scan_history', targetId: target.id });
  return safeUpdate(i, { content: null, embeds: [payload.embed], components: payload.components });
}
async function showScanDeleteConfirmation(i, targetId, auditId, origin = 'scan') {
  const allowed = await ensureScanCapability(i, 'scan_notes', '❌ You do not have permission to delete intelligence scan snapshots.', 'add_case_note');
  if (!allowed) return true;
  const row = db.prepare("SELECT audit_id, after_value, metadata FROM case_audit WHERE guild_id = ? AND audit_id = ? AND event = 'moderation.member_scan.completed' LIMIT 1").get(String(i.guild.id), String(auditId));
  if (!row || String(parseJson(row.metadata, {}).targetId || '') !== String(targetId)) return safeUpdate(i, { content: '❌ That scan snapshot no longer exists.', embeds: [], components: [] });
  const after = parseJson(row.after_value, {});
  const label = after.scanId || row.audit_id;
  const components = [new Discord.ActionRowBuilder().addComponents(
    new Discord.ButtonBuilder().setCustomId(`mod_scan_delete_confirm:${targetId}:${row.audit_id}:${origin}`).setLabel('Delete Scan').setEmoji('🗑️').setStyle(Discord.ButtonStyle.Danger),
    new Discord.ButtonBuilder().setCustomId(`mod_scan_history:${targetId}:${origin}`).setLabel('Cancel').setStyle(Discord.ButtonStyle.Secondary),
  )];
  return safeUpdate(i, { content: `⚠️ Delete scan snapshot \`${String(label).slice(0, 80)}\`? This removes only the stored scan snapshot, not cases, warnings, evidence, notes, watchlist records or other audit history.`, embeds: [], components });
}

async function deleteScanSnapshot(i, targetId, auditId, origin = 'scan') {
  const allowed = await ensureScanCapability(i, 'scan_notes', '❌ You do not have permission to delete intelligence scan snapshots.', 'add_case_note');
  if (!allowed) return true;
  const row = db.prepare("SELECT audit_id, metadata FROM case_audit WHERE guild_id = ? AND audit_id = ? AND event = 'moderation.member_scan.completed' LIMIT 1").get(String(i.guild.id), String(auditId));
  if (!row || String(parseJson(row.metadata, {}).targetId || '') !== String(targetId)) return safeUpdate(i, { content: '❌ That scan snapshot no longer exists.', embeds: [], components: [] });
  db.prepare("DELETE FROM case_audit WHERE guild_id = ? AND audit_id = ? AND event = 'moderation.member_scan.completed'").run(String(i.guild.id), String(auditId));
  recordModerationSystemEvent({ interaction: i, event: 'moderation.member_scan.snapshot_deleted', action: 'member_scan_history_delete', targetId, metadata: { deletedAuditId: String(auditId) } });
  return showMemberScanHistory(i, targetId, origin);
}

async function showClearScanHistoryConfirmation(i, targetId, origin = 'scan') {
  const allowed = await ensureScanCapability(i, 'scan_notes', '❌ You do not have permission to clear intelligence scan history.', 'add_case_note');
  if (!allowed) return true;
  const count = scanAuditRows(i.guild.id, targetId, 100).length;
  if (!count) return showMemberScanHistory(i, targetId, origin);
  const components = [new Discord.ActionRowBuilder().addComponents(
    new Discord.ButtonBuilder().setCustomId(`mod_scan_clear_history_confirm:${targetId}:${origin}`).setLabel('Clear All Scan History').setEmoji('🧹').setStyle(Discord.ButtonStyle.Danger),
    new Discord.ButtonBuilder().setCustomId(`mod_scan_history:${targetId}:${origin}`).setLabel('Cancel').setStyle(Discord.ButtonStyle.Secondary),
  )];
  return safeUpdate(i, { content: `⚠️ Clear all **${count}** stored Member Intelligence scan snapshot(s) for <@${targetId}>? Cases, warnings, evidence, notes, watchlist records and other moderation audit events will be retained.`, embeds: [], components });
}

async function clearScanHistory(i, targetId, origin = 'scan') {
  const allowed = await ensureScanCapability(i, 'scan_notes', '❌ You do not have permission to clear intelligence scan history.', 'add_case_note');
  if (!allowed) return true;
  const rows = db.prepare("SELECT audit_id, metadata FROM case_audit WHERE guild_id = ? AND event = 'moderation.member_scan.completed'").all(String(i.guild.id));
  const ids = rows.filter((row) => String(parseJson(row.metadata, {}).targetId || '') === String(targetId)).map((row) => String(row.audit_id));
  const remove = db.prepare("DELETE FROM case_audit WHERE guild_id = ? AND audit_id = ? AND event = 'moderation.member_scan.completed'");
  const tx = db.transaction((auditIds) => { for (const auditId of auditIds) remove.run(String(i.guild.id), auditId); });
  tx(ids);
  recordModerationSystemEvent({ interaction: i, event: 'moderation.member_scan.history_cleared', action: 'member_scan_history_clear', targetId, metadata: { deletedSnapshots: ids.length } });
  return showMemberScanHistory(i, targetId, origin);
}

async function handleMemberScanStringSelect(i) {
  const id = String(i.customId || '');
  if (!id.startsWith('mod_scan_delete_select:')) return false;
  const parts = id.split(':');
  const targetId = parts[1];
  const origin = parts[2] || 'scan';
  const auditId = i.values?.[0];
  if (!targetId || !auditId) return safeUpdate(i, { content: '❌ Select a scan snapshot to delete.', embeds: [], components: [] });
  return showScanDeleteConfirmation(i, targetId, auditId, origin);
}

async function runMemberComparison(i, primaryId, secondaryId, origin = 'scan') {
  const allowed = await ensureScanCapability(i, 'scan_compare', '❌ You do not have permission to compare member intelligence.');
  if (!allowed) return true;
  if (!primaryId || !secondaryId || String(primaryId) === String(secondaryId)) return safeReply(i, { content: '❌ Select a different member to compare against.', flags: 64 });
  if (!i.deferred && !i.replied && i.isMessageComponent?.()) await i.deferUpdate();
  const [primary, secondary] = await Promise.all([fetchTarget(i.guild, primaryId), fetchTarget(i.guild, secondaryId)]);
  if (!primary || !secondary) return safeReply(i, { content: '❌ One of those members could not be found in this server.', flags: 64 });
  const payload = buildComparisonPayload(i, primary, secondary, origin);
  recordModerationSystemEvent({ interaction: i, event: 'moderation.member_scan.compared', action: 'member_compare', targetId: primary.id, after: { comparedUserId: secondary.id, score: payload.correlation.score, signals: payload.correlation.signals } });
  return safeUpdate(i, { content: null, embeds: [payload.embed], components: payload.components });
}
async function showPersistentLinkEvidence(i, targetId) {
  const allowed = await ensureScanCapability(i, 'scan_links', '❌ You do not have permission to view persistent link evidence.');
  if (!allowed) return true;
  const target = await fetchTarget(i.guild, targetId);
  if (!target) return safeReply(i, { content: '❌ Could not find that member in this server.', flags: 64 });
  const evidence = aggregateSuspectedEvidence(i.guild.id, target.id);
  const text = evidence.length ? evidence.map((entry) => {
  const member = i.guild.members.cache.get(entry.userId);
  const label = entry.maxScore >= 70 ? '🔴 Strong historical correlation' : '🟠 Possible historical correlation';
  const firstSeen = entry.firstSeen ? scanTimestamp(new Date(entry.firstSeen).getTime()) : 'Unknown';
  const lastSeen = entry.lastSeen ? scanTimestamp(new Date(entry.lastSeen).getTime()) : 'Unknown';
  return [
    `${label} — ${member ? member.user : `<@${entry.userId}>`} (\`${entry.userId}\`)`,
    `Scans **${entry.appearances}** • Highest score **${entry.maxScore}%**`,
    `First seen ${firstSeen}`,
    `Last seen ${lastSeen}`,
    entry.signals.length ? `Signals\n${entry.signals.slice(0, 8).map((signal) => `• ${signal}`).join('\n')}` : 'Signals • None recorded',
  ].join('\n');
}).join('\n\n') : [
  '**No persistent account correlations identified.**',
  '',
  'Correlations appear here only when the same suspected-account relationship is observed across multiple Goliath scans.',
  'A heuristic match alone is **not proof** that two Discord accounts share an owner.',
].join('\n');
const embed = new Discord.EmbedBuilder()
  .setColor(evidence.length ? 0x5865F2 : 0x57F287)
  .setTitle(`🔗 Correlation Evidence • ${target.user.tag}`)
  .setDescription(text.slice(0, 3800))
  .setFooter({ text: evidence.length ? 'Historical correlation only • review scan history before drawing conclusions' : 'No repeated correlation signals recorded' })
  .setTimestamp();
  recordModerationSystemEvent({ interaction: i, event: 'moderation.member_scan.link_evidence_viewed', action: 'member_scan_links', targetId: target.id, after: { matchCount: evidence.length } });
  const components = canScanCapability(i, 'scan_run') ? [new Discord.ActionRowBuilder().addComponents(new Discord.ButtonBuilder().setCustomId(`mod_scan_view:${target.id}`).setLabel('Back to Scan').setEmoji('🔎').setStyle(Discord.ButtonStyle.Primary))] : [];
  return safeUpdate(i, { content: null, embeds: [embed], components });
}
async function showInvestigationWatch(i, targetId) {
  const allowed = await ensureScanCapability(i, 'scan_watch', '❌ You do not have permission to view investigation watch state.');
  if (!allowed) return true;
  const target = await fetchTarget(i.guild, targetId);
  if (!target) return safeReply(i, { content: '❌ Could not find that member in this server.', flags: 64 });
  const state = getInvestigationState(i.guild.id, target.id);
  const embed = new Discord.EmbedBuilder()
    .setColor(state.watched ? 0xF0A202 : 0x5865F2)
    .setTitle(`👁️ Investigation Watch • ${target.user.tag}`)
    .setDescription([
      `**Status:** ${state.watched ? '🟠 ON' : '⚪ OFF'}`,
      state.watch?.reason ? `**Reason:** ${state.watch.reason}` : '**Reason:** No active investigation watch reason.',
      state.watch?.at ? `**Updated:** ${scanTimestamp(new Date(state.watch.at).getTime())}` : '**Updated:** Never',
      '',
      'Investigation Watch is a management review flag. It is separate from the persistent Goliath Watchlist state.',
    ].join('\n'))
    .setTimestamp();
  const buttons = [
    new Discord.ButtonBuilder().setCustomId(`mod_scan_watch_toggle:${target.id}`).setLabel(state.watched ? 'Remove Investigation Watch' : 'Enable Investigation Watch').setEmoji('👁️').setStyle(state.watched ? Discord.ButtonStyle.Danger : Discord.ButtonStyle.Primary),
    new Discord.ButtonBuilder().setCustomId(`mod_scan_view:${target.id}`).setLabel('⬅️ Back to Scan').setStyle(Discord.ButtonStyle.Secondary),
  ];
  return safeUpdate(i, { content: null, embeds: [embed], components: [new Discord.ActionRowBuilder().addComponents(...buttons)] });
}
async function toggleMemberWatch(i, targetId) {
  const allowed = await ensureScanCapability(i, 'scan_watch', '❌ You do not have permission to change investigation watch state.');
  if (!allowed) return true;
  const target = await fetchTarget(i.guild, targetId);
  if (!target) return safeReply(i, { content: '❌ Could not find that member in this server.', flags: 64 });
  const state = getInvestigationState(i.guild.id, target.id);
  const enabled = !state.watched;
  recordModerationSystemEvent({ interaction: i, event: 'moderation.member_scan.watch_updated', action: 'member_watch', targetId: target.id, before: { enabled: state.watched }, after: { enabled, reason: enabled ? 'Manual management investigation watch.' : 'Removed from manual management investigation watch.' } });
  return showInvestigationWatch(i, target.id);
}
async function submitInvestigationNote(i) {
  const id = String(i.customId || '');
  if (!id.startsWith('mod_scan_note_submit:')) return false;
  const targetId = id.split(':')[1];
  const allowed = await ensureScanCapability(i, 'scan_notes', '❌ You do not have permission to add investigation notes.', 'add_case_note');
  if (!allowed) return true;
  const note = fieldValue(i, 'note').slice(0, 1000);
  if (!note) return safeReply(i, { content: '❌ Investigation note cannot be empty.', flags: 64 });
  const target = await fetchTarget(i.guild, targetId);
  if (!target) return safeReply(i, { content: '❌ Could not find that member in this server.', flags: 64 });
  recordModerationSystemEvent({ interaction: i, event: 'moderation.member_scan.note_added', action: 'member_scan_note', targetId: target.id, after: { note } });
  if (canScanCapability(i, 'scan_run')) return runMemberScan(i, target.id, { record: false });
  return safeReply(i, { content: `✅ Investigation note added for ${target.user}.`, flags: 64 });
}
async function handleMemberScanSelect(i) {
  if (i.customId === 'mod_scan_user_select') {
    const targetId = i.values?.[0];
    if (!targetId) return safeReply(i, { content: '❌ No member selected.', flags: 64 });
    return runMemberScan(i, targetId);
  }
  if (String(i.customId || '').startsWith('mod_scan_history_compare_select:')) {
    const parts = String(i.customId).split(':');
    const primaryId = parts[1];
    const origin = parts[2] || 'scan';
    const secondaryId = i.values?.[0];
    if (!secondaryId) return safeReply(i, { content: '❌ No comparison member selected.', flags: 64 });
    return runMemberComparison(i, primaryId, secondaryId, origin);
  }
  return false;
}
async function handleMemberScanButton(i) {
  const id = String(i.customId || '');
  if (id.startsWith('mod_dashboard:')) {
    const [, targetId = 'none', requested = 'actions'] = id.split(':');
    if (requested === 'intelligence' && targetId !== 'none') return runMemberScan(i, targetId, { record: false });
  }
  if (id.startsWith('mod_dashboard:') || id.startsWith('mod_refresh:')) {
    const [, targetId = 'none', requested = 'actions'] = id.split(':');
    if (requested === 'intelligence') {
      if (targetId && targetId !== 'none') return runMemberScan(i, targetId, { record: false });
      const allowed = await ensureScanCapability(i, 'scan_run', '❌ You do not have permission to run a member intelligence scan.');
      if (!allowed) return true;
      const select = new Discord.UserSelectMenuBuilder().setCustomId('mod_scan_user_select').setPlaceholder('👤 Select a member to investigate').setMinValues(1).setMaxValues(1);
      const back = new Discord.ButtonBuilder().setCustomId('mod_dashboard:none:actions').setLabel('⬅️ Back').setStyle(Discord.ButtonStyle.Secondary);
      return safeUpdate(i, { content: '🧠 **Member Intelligence** — select a server member to open the unified intelligence workspace.', embeds: [], components: [new Discord.ActionRowBuilder().addComponents(select), new Discord.ActionRowBuilder().addComponents(back)] });
    }
  }
  if (id === 'mod_select_user' || id === 'mod_member_scan') {
    const allowed = await ensureScanCapability(i, 'scan_run', '❌ You do not have permission to run a member intelligence scan.');
    if (!allowed) return true;
    const select = new Discord.UserSelectMenuBuilder().setCustomId('mod_scan_user_select').setPlaceholder('🔎 Select a member to scan').setMinValues(1).setMaxValues(1);
    return safeUpdate(i, { content: '🔎 **Goliath Member Scan** — select a server member to run a permission-filtered intelligence report.', embeds: [], components: [new Discord.ActionRowBuilder().addComponents(select)] });
  }
  if (id.startsWith('mod_member_scan:')) return runMemberScan(i, id.split(':')[1], { record: true });
  if (id.startsWith('mod_scan_view:')) return runMemberScan(i, id.split(':')[1], { record: false });
  if (id.startsWith('mod_scan_history:')) { const parts = id.split(':'); return showMemberScanHistory(i, parts[1], parts[2] || 'scan'); }
  if (id.startsWith('mod_scan_delete_confirm:')) { const parts = id.split(':'); return deleteScanSnapshot(i, parts[1], parts[2], parts[3] || 'scan'); }
  if (id.startsWith('mod_scan_clear_history_confirm:')) { const parts = id.split(':'); return clearScanHistory(i, parts[1], parts[2] || 'scan'); }
  if (id.startsWith('mod_scan_clear_history:')) { const parts = id.split(':'); return showClearScanHistoryConfirmation(i, parts[1], parts[2] || 'scan'); }
  if (id.startsWith('mod_scan_links:')) return showPersistentLinkEvidence(i, id.split(':')[1]);
  const intelligenceHandled = await memberIntelligence.handleInteraction(i, { ensureCapability: ensureScanCapability, canCapability: canScanCapability });
  if (intelligenceHandled) return true;
  if (id.startsWith('mod_scan_watch_toggle:')) return toggleMemberWatch(i, id.split(':')[1]);
  if (id.startsWith('mod_scan_watch:')) return showInvestigationWatch(i, id.split(':')[1]);
  if (id.startsWith('mod_scan_note:')) {
    const targetId = id.split(':')[1];
    const allowed = await ensureScanCapability(i, 'scan_notes', '❌ You do not have permission to add investigation notes.', 'add_case_note');
    if (!allowed) return true;
    await i.showModal(buildInvestigationNoteModal(targetId));
    return true;
  }
  if (id.startsWith('mod_scan_history_compare:')) {
    const parts = id.split(':');
    const primaryId = parts[1];
    const origin = parts[2] || 'scan';
    const allowed = await ensureScanCapability(i, 'scan_compare', '❌ You do not have permission to compare member intelligence.');
    if (!allowed) return true;
    const select = new Discord.UserSelectMenuBuilder().setCustomId(`mod_scan_history_compare_select:${primaryId}:${origin}`).setPlaceholder('🧬 Select another member to compare').setMinValues(1).setMaxValues(1);
    const back = new Discord.ButtonBuilder().setCustomId(`mod_scan_history:${primaryId}:${origin}`).setLabel('⬅️ Back to Scan History').setStyle(Discord.ButtonStyle.Secondary);
    return safeUpdate(i, {
      content: `🧬 **Compare Accounts** — select another server member to compare against <@${primaryId}>.`,
      embeds: [],
      components: [new Discord.ActionRowBuilder().addComponents(select), new Discord.ActionRowBuilder().addComponents(back)],
    });
  }
  return false;
}

async function showPunishmentModal(i, action, targetId) { if (!PUNISHMENT_ACTIONS.has(action)) return false; const target = await requireModeratableTarget(i, targetId, action); if (!target) return true; await i.showModal(buildPunishmentModal(action, target.id)); return true; }
async function requestRemoveTimeout(i, targetId) { const target = await requireModeratableTarget(i, targetId, 'remove_timeout'); if (!target) return true; return createConfirmation(i, target.id, 'remove-timeout', {}, `✅ Remove timeout from **${target.user.tag}**?`); }
async function showQuarantineModal(i, targetId) {
  const target = await requireModeratableTarget(i, targetId, 'quarantine');
  if (!target) return true;
  if (getQuarantineState(i.guild.id)?.users?.[target.id]) return safeReply(i, { content: `⚠️ **${target.user.tag}** is already quarantined.`, flags: 64 });
  await i.showModal(buildQuarantineModal(target.id));
  return true;
}
async function removeQuarantine(i, targetId) {
  const target = await requireModeratableTarget(i, targetId, 'remove_quarantine');
  if (!target) return true;
  if (!getQuarantineState(i.guild.id)?.users?.[target.id]) return safeReply(i, { content: `⚠️ **${target.user.tag}** is not currently quarantined.`, flags: 64 });
  const result = await restoreQuarantinedMember(i.guild, target, { reason: `Quarantine removed by ${i.user?.tag || i.user?.id || 'moderator'}` });
  recordModerationSystemEvent({ interaction: i, event: result.success ? 'moderation.quarantine.removed' : 'moderation.quarantine.remove_failed', action: 'remove_quarantine', targetId: target.id, after: result });
  if (!result.success) return safeReply(i, { content: `❌ Failed to remove quarantine from **${target.user.tag}**: ${result.error || result.reason || 'Unknown error'}`, flags: 64 });
  await safeReply(i, { content: `🔓 Quarantine removed from **${target.user.tag}** • restored **${result.restoredRoles || 0}** role(s).`, flags: 64 });
  await refreshDashboard(Discord, i, target, { view: 'actions' });
  return true;
}
async function routeActionRequest(i, action, targetId) { if (action === 'warn') return showWarningModal(i, targetId); if (action === 'quarantine') return showQuarantineModal(i, targetId); if (action === 'remove-warning') return showRemoveWarningModal(i, targetId); if (action === 'remove-timeout') return requestRemoveTimeout(i, targetId); if (PUNISHMENT_ACTIONS.has(action)) return showPunishmentModal(i, action, targetId); return false; }
async function handleOpenActionButton(i) { const action = getPrefixedAction(i.customId, 'mod_open_', OPEN_ACTIONS); if (!action) return false; return routeActionRequest(i, action, getTargetIdFromCustomId(i.customId)); }
async function handleCaseToolButton(i) { const caseResult = await openCaseTool(i); if (caseResult) return caseResult; const searchResult = await handleCaseSearchAction(i); if (searchResult) return searchResult; const id = String(i.customId || ''); const targetId = getTargetIdFromCustomId(id); if (id.startsWith('mod_remove_warning:')) return routeActionRequest(i, 'remove-warning', targetId); if (id.startsWith('mod_remove_timeout:')) return routeActionRequest(i, 'remove-timeout', targetId); if (id.startsWith('mod_remove_quarantine:')) return removeQuarantine(i, targetId); return false; }
async function handleBulkButton(i) {
  if (!String(i.customId || '').startsWith('mod_bulk_')) return false;
  const action = getBulkAction(i.customId); if (!action) return false;
  const allowed = await ensureActionAccess(i, `bulk_${action}`, `❌ No permission to use bulk ${action}.`); if (!allowed) return true;
  await i.showModal(buildBulkModal(action)); return true;
}
async function handleConfirmButton(i) {
  if (!i.customId.startsWith('mod_confirm_action:')) return false;
  const { token, context } = parseConfirmActionContext(i.customId);
  if (!token) return false;
  const lockKey = `${i.guild?.id || 'none'}:${token}`;
  if (CONFIRM_LOCKS.has(lockKey)) {
    recordModerationSystemEvent({ interaction: i, event: 'moderation.confirmation.duplicate_blocked', metadata: { tokenPresent: true } });
    return safeReply(i, { content: '⏳ That moderation action is already being processed.', flags: 64 });
  }
  CONFIRM_LOCKS.add(lockKey);
  try {
    if (!i.deferred && !i.replied && i.isMessageComponent?.()) await i.deferUpdate();
    const result = await executePendingAction(Discord, i, token, context);
    recordModerationSystemEvent({ interaction: i, event: 'moderation.confirmation.processed', metadata: { tokenPresent: true, handled: Boolean(result) } });
    return result;
  } finally {
    CONFIRM_LOCKS.delete(lockKey);
  }
}
async function handleCancelButton(i) {
  const id = String(i.customId || '');
  if (!id.startsWith('mod_cancel_action')) return false;
  const parts = id.split(':');
  const targetId = parts[1] || 'none';
  const requestedPage = Number(parts[5]);
  const context = {
    view: parts[2] || 'actions',
    actionFilter: parts[3] || 'all',
    statusFilter: parts[4] || 'all',
    page: Number.isFinite(requestedPage) ? Math.max(0, Math.trunc(requestedPage)) : 0,
  };
  const token = parts[6] && parts[6] !== 'legacy' ? parts[6] : null;
  let removed = 0;
  if (i.guild?.id && i.user?.id) {
    removed = token
      ? db.prepare('DELETE FROM pending_actions WHERE guild_id = ? AND moderator_id = ? AND token = ?').run(String(i.guild.id), String(i.user.id), String(token)).changes
      : db.prepare('DELETE FROM pending_actions WHERE guild_id = ? AND moderator_id = ?').run(String(i.guild.id), String(i.user.id)).changes;
  }
  recordModerationSystemEvent({ interaction: i, event: 'moderation.action.cancelled', targetId: targetId === 'none' ? null : targetId, metadata: { pendingActionsRemoved: removed, scopedToToken: Boolean(token), returnView: context.view } });
  if (i.message && typeof i.update === 'function') {
    await i.update({ content: '❌ Cancelled — no moderation action was applied.', embeds: [], components: [] });
    const target = targetId !== 'none' ? await fetchTarget(i.guild, targetId) : null;
    await refreshDashboard(Discord, i, target, target ? context : { view: 'member', actionFilter: 'all', statusFilter: 'all', page: 0 });
    return true;
  }
  return safeReply(i, { content: '❌ Cancelled — no moderation action was applied.', flags: 64 });
}
async function handleBulkModal(i) {
  if (!String(i.customId || '').startsWith('mod_submit_bulk_')) return false;
  const action = getBulkAction(i.customId); if (!action) return false;
  const allowed = await ensureActionAccess(i, `bulk_${action}`, `❌ No permission to use bulk ${action}.`); if (!allowed) return true;
  if (!i.deferred && !i.replied) await i.deferReply({ flags: 64 });
  recordModerationSystemEvent({ interaction: i, event: 'moderation.bulk.requested', action, metadata: { operation: fieldValue(i, 'operation') || action } });
  return submitBulkModal(i, action);
}
async function handleActionModal(i) {
  const id = String(i.customId || ''); const targetId = getTargetIdFromCustomId(id);
  if (id.startsWith('mod_submit_quarantine:')) {
    const target = await requireModeratableTarget(i, targetId, 'quarantine');
    if (!target) return true;
    const reason = fieldValue(i, 'reason');
    const result = await quarantineMember(i.guild, target, { reason, quarantinedBy: i.user?.id || null });
    recordModerationSystemEvent({ interaction: i, event: result.success ? 'moderation.quarantine.applied' : 'moderation.quarantine.failed', action: 'quarantine', targetId: target.id, reason, after: result });
    if (!result.success) return safeReply(i, { content: `❌ Failed to quarantine **${target.user.tag}**: ${result.error || result.reason || 'Unknown error'}`, flags: 64 });
    await safeReply(i, { content: result.dryRun ? `🧪 Quarantine dry-run completed for **${target.user.tag}**.` : `🚫 **${target.user.tag}** has been quarantined.`, flags: 64 });
    await refreshDashboard(Discord, i, target, { view: 'actions' });
    return true;
  }
  if (id.startsWith('mod_submit_warn:')) {
    const result = await submitWarningModal(i, targetId, refreshCasesDashboard);
    if (!result?.ok) auditFailure(i, 'moderation.action.failed', 'warn', targetId, result?.error?.message || result?.error || 'Warning submission failed.');
    return result || true;
  }
  if (id.startsWith('mod_submit_remove_warning:')) return submitRemoveWarningRequest(i, targetId, createConfirmation);
  const action = getPunishmentSubmitAction(id); if (!action) return false;
  const target = await requireModeratableTarget(i, targetId, action); if (!target) return true;
  const result = await submitPunishmentRequest(i, target, action);
  if (!result?.ok) auditFailure(i, 'moderation.action.failed', action, targetId, result?.error?.message || result?.error || `${action} submission failed.`);
  if (action === 'timeout' && result?.ok) await refreshCasesDashboard(i, target);
  return true;
}
async function hardenAppealDecisionResult(i, result) {
  const match = String(i.customId || '').match(/^mod_submit_case_appeal_decision:(\d+):([^:]+):(approved|denied)$/);
  if (!match || match[3] !== 'approved' || !i.guild?.id) return result;
  const caseId = Number(match[1]);
  const appealId = match[2];
  let modCase = getCaseById(i.guild.id, caseId);
  if (!modCase) return result;
  const appeal = Array.isArray(modCase.metadata?.appeals) ? modCase.metadata.appeals.find((entry) => String(entry?.id) === appealId) : null;
  const remedy = appeal?.remedy || null;
  if (remedy?.ok === false && modCase.status === 'reversed') {
    modCase = updateCaseStatus(i.guild.id, caseId, 'active', i.user?.id || null) || modCase;
    recordCaseAudit({ guildId: i.guild.id, caseId, actorId: i.user?.id || null, event: 'case.appeal.remedy.status_restored', before: 'reversed', after: 'active', metadata: { appealId, remedyAction: remedy.action || null, reason: remedy.detail || 'Approved appeal remedy failed.' } });
    recordModerationSystemEvent({ interaction: i, event: 'moderation.appeal.remedy.failed', action: remedy.action || modCase.action, targetId: modCase.userId, reason: remedy.detail || 'Approved appeal remedy failed.', metadata: { caseId, appealId, caseStatusRestored: true } });
  }
  if (modCase.action === 'warn' && remedy?.ok === true) {
    const existing = db.prepare('SELECT audit_id FROM case_audit WHERE guild_id = ? AND case_id = ? AND event = ? LIMIT 1').get(String(i.guild.id), caseId, 'case.strike.removed');
    if (!existing) {
      const strikeWeight = Math.max(1, Math.min(5, Number(modCase.metadata?.strikeWeight) || 1));
      recordCaseAudit({ guildId: i.guild.id, caseId, actorId: i.user?.id || null, event: 'case.strike.removed', before: strikeWeight, after: 0, metadata: { strikeWeight, appealId, appealRemedy: true } });
    }
  }
  return result;
}
async function handleCaseModal(i) {
  const result = await submitCaseModal(i, { fetchTarget, refreshCasesDashboard });
  return hardenAppealDecisionResult(i, result);
}
async function routeHandlers(i, handlers) { for (const handler of handlers) { const result = await handler(i); if (result) return result; } return false; }
async function routeButtonsAndSelects(i) {
  const denied = ensurePanelAccess(i); if (denied) return denied;
  if (i.isUserSelectMenu?.()) {
    const scan = await handleMemberScanSelect(i);
    if (scan) return scan;
    return handleUserSelectMenu(i);
  }
  if (i.isStringSelectMenu?.()) return routeHandlers(i, [caseProceeding.handleProceedingInteraction, handleMemberScanStringSelect, handleCaseSearchSelect]);
  if (!i.isButton?.()) return false;
  return routeHandlers(i, [handleExportInteraction, handleConfirmButton, caseProceeding.handleProceedingInteraction, value => handleCaseAction(value, { fetchTarget, createConfirmation }), handleMemberScanButton, handleDashboardNavigation, handleCancelButton, handleBulkButton, handleOpenActionButton, handleCaseToolButton]);
}
async function routeModModal(i) {
  if (!i?.customId?.startsWith('mod_')) return false;
  const denied = ensurePanelAccess(i); if (denied) return denied;
  await syncExpiredWarningsToCases(i.guild.id);
  const proceedingResult = await caseProceeding.handleProceedingModal(i);
  if (proceedingResult) return proceedingResult;
  if (String(i.customId).startsWith('mod_export_submit:')) {
    const result = await handleExportInteraction(i);
    if (result) {
      recordModerationSystemEvent({ interaction: i, event: 'moderation.export.requested', action: 'export_cases', metadata: {
        scope: fieldValue(i, 'scope'), reference: fieldValue(i, 'reference') || null, format: fieldValue(i, 'format'), include: fieldValue(i, 'include'), filters: fieldValue(i, 'filters').slice(0, 500),
      } });
      return result;
    }
  }
  return routeHandlers(i, [
    value => memberIntelligence.handleInteraction(value, { ensureCapability: ensureScanCapability, canCapability: canScanCapability }),
    submitInvestigationNote,
    handleExportInteraction,
    handleCaseSearchModal,
    handleCaseModal,
    handleBulkModal,
    handleActionModal,
  ]);
}
async function handleModInteraction(i) {
  if (!i?.customId || !isModCustomId(i.customId)) return false;
  if (i.customId.startsWith('nav|')) return false;
  try {
    const quarantineId = String(i.customId || '');
    if (
      quarantineId.startsWith('mod_open_quarantine:')
      || quarantineId.startsWith('mod_quarantine_investigation:')
      || quarantineId.startsWith('mod_quarantine_security:')
      || quarantineId.startsWith('mod_remove_quarantine:')
      || quarantineId.startsWith('mod_submit_quarantine_investigation:')
      || quarantineId.startsWith('mod_submit_quarantine_security:')
      || quarantineId.startsWith('mod_submit_quarantine:')
      || quarantineId.startsWith('mod_invroom_note:')
      || quarantineId.startsWith('mod_invroom_note_submit:')
      || quarantineId.startsWith('mod_invroom_access:')
      || quarantineId.startsWith('mod_invroom_access_channel:')
      || quarantineId.startsWith('mod_invroom_access_allow:')
      || quarantineId.startsWith('mod_invroom_access_remove:')
      || quarantineId.startsWith('mod_invroom_access_clear:')
    ) {
      const handledQuarantine = await quarantineInteractions.handleQuarantineInteraction(i);
      if (handledQuarantine) return true;
    }
    if (isExternalAppealCustomId(i.customId)) return await handleExternalAppealInteraction(i);
    if (i.isModalSubmit?.()) return await routeModModal(i);
    const handled = await routeButtonsAndSelects(i);
    if (!handled) recordModerationSystemEvent({ interaction: i, event: 'moderation.interaction.unhandled', metadata: { interactionType: i.componentType || null } });
    return handled;
  } catch (error) {
    console.error('❌ Moderation interaction failed:', error);
    auditFailure(i, 'moderation.interaction.failed', null, getTargetIdFromCustomId(i.customId), error?.message || error, { stack: String(error?.stack || '').slice(0, 1500) });
    await safeReply(i, { content: '❌ That moderation action failed safely. No further action was taken.', flags: 64 }).catch(() => null);
    return true;
  }
}
module.exports = { handleModInteraction };