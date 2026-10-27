'use strict';

const Discord = require('discord.js');
const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} = Discord;

const guildManager = require('../../guild/guildManager');
const { safeReply, ephemeralError } = require('../../../core/ui/interactionResponse');
const {
  COLORS,
  EMOJIS,
  baseEmbed,
  createEmbed,
  createPrimaryButton,
  createSecondaryButton,
  createDangerButton,
} = require('../../../core/ui/embeds');
const {
  db,
  getAllCases,
  getCaseCountForUser,
  getCasesForUser,
  getFilteredCases,
} = require('./storage');
const {
  formatCaseSummary,
  getStatusLabel,
  buildCaseFilterButtons,
  buildCasesPageButtons,
  getCaseAppeals,
  listAppeals,
} = require('./cases');
const { getWarningCountForUser, syncExpiredWarningsToCases } = require('./warns');
const { canUseModAction, getStaffDisplay, hasModPermission, fetchTarget } = require('./permissions');
const { getQuarantineState } = require('../../security/protection/quarantine');
const caseProceeding = require('./caseProceeding');
const verificationStore = require('../../../modules/securityStudio/verificationStore');

const DEFAULT_VIEW = 'actions';
const dashboardHistory = new Map();
const DASHBOARD_HISTORY_TTL = 30 * 60 * 1000;
function dashboardHistoryKey(interaction) {
  return [interaction.guild?.id, interaction.user?.id, interaction.message?.id || 'initial'].join(':');
}
function dashboardHistoryEntry(interaction) {
  const key = dashboardHistoryKey(interaction);
  const entry = dashboardHistory.get(key);
  if (entry && Date.now() - entry.updatedAt < DASHBOARD_HISTORY_TTL) return entry;
  dashboardHistory.delete(key);
  return null;
}
function rememberDashboard(interaction, state, back = false) {
  const key = dashboardHistoryKey(interaction);
  const existing = dashboardHistoryEntry(interaction);
  const entry = existing || { current: null, stack: [], updatedAt: 0 };
  if (!back && entry.current && JSON.stringify(entry.current) !== JSON.stringify(state)) {
    entry.stack.push(entry.current);
    if (entry.stack.length > 25) entry.stack.shift();
  }
  entry.current = state;
  entry.updatedAt = Date.now();
  dashboardHistory.set(key, entry);
  if (dashboardHistory.size > 500) {
    for (const [id, item] of dashboardHistory) if (Date.now() - item.updatedAt >= DASHBOARD_HISTORY_TTL) dashboardHistory.delete(id);
  }
}

const CASES_PER_PAGE = 5;
const VIEW_ALIASES = Object.freeze({ overview: 'actions', member: 'actions', warnings: 'cases' });
const ALLOWED_VIEWS = new Set(['actions', 'intelligence', 'cases', 'appeals', 'analytics']);
const ANALYTICS_WINDOWS = Object.freeze({ '7d': 7, '30d': 30, '90d': 90, all: null });
const ANALYTICS_WINDOW_LABELS = Object.freeze({ '7d': '7 Days', '30d': '30 Days', '90d': '90 Days', all: 'All Time' });
const DEFAULT_CASES_CONTEXT = Object.freeze({ view: 'cases', actionFilter: 'all', statusFilter: 'all', page: 0 });
const DEFAULT_ACTIONS_CONTEXT = Object.freeze({ view: 'actions', actionFilter: 'all', statusFilter: 'all', page: 0 });
const DEFAULT_ANALYTICS_CONTEXT = Object.freeze({ view: 'analytics', analyticsWindow: '30d', analyticsMode: 'overview', analyticsModeratorId: null, analyticsReturnTargetId: null });
const EXPORT_SCOPES = new Set(['all', 'user', 'moderator', 'case']);
const EXPORT_FORMATS = new Set(['json', 'csv']);
const EXPORT_INCLUDE_KEYS = new Set(['core', 'metadata', 'appeals', 'evidence', 'audit']);
const MAX_EXPORT_CASES = 10000;
const MAX_EXPORT_FILE_BYTES = 7 * 1024 * 1024;
const MAX_EXPORT_ATTACHMENTS = 10;

function canOpenModPanel(interaction) { return Boolean(interaction?.guild && interaction?.member && hasModPermission(interaction.member, interaction.guild)); }
function noAccessPayload() { return { content: '❌ You do not have permission to use the moderation panel.', flags: 64 }; }
function normalizeAnalyticsWindow(value) { return Object.prototype.hasOwnProperty.call(ANALYTICS_WINDOWS, value) ? value : '30d'; }
function normalizeView(value) { const aliased = VIEW_ALIASES[value] || value; return ALLOWED_VIEWS.has(aliased) ? aliased : DEFAULT_VIEW; }
function normalizeDashboardContext(context = {}) {
  return {
    view: normalizeView(context.view),
    actionFilter: context.actionFilter || 'all',
    statusFilter: context.statusFilter || 'all',
    page: Number(context.page) || 0,
    analyticsWindow: normalizeAnalyticsWindow(context.analyticsWindow),
    analyticsMode: context.analyticsMode === 'moderator' ? 'moderator' : 'overview',
    analyticsModeratorId: context.analyticsModeratorId ? String(context.analyticsModeratorId) : null,
    analyticsReturnTargetId: context.analyticsReturnTargetId ? String(context.analyticsReturnTargetId) : null,
    analyticsStaffPage: Math.max(0, Number(context.analyticsStaffPage) || 0),
    appealFilter: ['pending', 'resolved', 'all'].includes(context.appealFilter) ? context.appealFilter : 'pending',
  };
}
function getEmoji(key, fallback) { return EMOJIS?.[key] || fallback; }
function getCaseTime(modCase) { const value = new Date(modCase?.createdAt || modCase?.created_at || 0).getTime(); return Number.isFinite(value) ? value : 0; }
function getAuditTime(entry) { const value = new Date(entry?.created_at || entry?.createdAt || 0).getTime(); return Number.isFinite(value) ? value : 0; }
function percentage(part, total) { return total > 0 ? `${Math.round((part / total) * 100)}%` : '0%'; }
function increment(map, key, amount = 1) { if (key) map[key] = (map[key] || 0) + amount; }
function topEntries(map, limit = 5) { return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, limit); }
function timestamp(value, style = 'R') { const ms = Number(value); return Number.isFinite(ms) && ms > 0 ? `<t:${Math.floor(ms / 1000)}:${style}>` : 'Unknown'; }
function targetHasActiveTimeout(target) { return Number(target?.communicationDisabledUntilTimestamp || 0) > Date.now(); }
function targetIsQuarantined(guild, target) { return Boolean(guild?.id && target?.id && getQuarantineState(guild.id)?.users?.[target.id]); }
function formatActionBreakdown(counts = {}) {
  const primary = [
    `Warnings **${Number(counts.warn || 0)}**`,
    `Timeouts **${Number(counts.timeout || 0)}**`,
    `Kicks **${Number(counts.kick || 0)}**`,
    `Bans **${Number(counts.ban || 0)}**`,
  ].join(' • ');
  const reversals = [];
  if (Number(counts.unwarn || 0) > 0) reversals.push(`Warnings removed **${Number(counts.unwarn)}**`);
  if (Number(counts['remove-timeout'] || 0) > 0) reversals.push(`Timeouts cleared **${Number(counts['remove-timeout'])}**`);
  return reversals.length ? `${primary}\n${reversals.join(' • ')}` : primary;
}
function hasAny(member, guild, actions) { return actions.some((action) => canUseModAction(member, guild, action)); }
function canViewDashboardSection(member, guild, view) {
  const normalized = normalizeView(view);
  if (normalized === 'actions') return canUseModAction(member, guild, 'view_dashboard') || hasAny(member, guild, ['warn', 'timeout', 'remove_timeout', 'kick', 'quarantine', 'remove_quarantine', 'ban', 'remove_warning']);
  if (normalized === 'intelligence') return hasAny(member, guild, ['scan_run', 'scan_history', 'scan_compare', 'scan_suspects', 'scan_network', 'scan_notes', 'scan_watch', 'scan_links']);
  if (normalized === 'cases') return canUseModAction(member, guild, 'view_cases');
  if (normalized === 'appeals') return canUseModAction(member, guild, 'view_appeals');
  if (normalized === 'analytics') return canUseModAction(member, guild, 'view_analytics');
  return false;
}
function workspaceStats(guildId) {
  const cases = getAllCases(guildId) || [];
  const activeCases = cases.filter((entry) => String(entry.status || 'active') === 'active').length;
  let activeWarnings = 0;
  try { activeWarnings = Number(db.prepare('SELECT COUNT(*) AS count FROM warnings WHERE guild_id = ? AND (expires_at IS NULL OR expires_at > ?)').get(String(guildId), new Date().toISOString())?.count || 0); }
  catch { activeWarnings = cases.filter((entry) => entry.action === 'warn' && String(entry.status || 'active') === 'active').length; }
  let pendingAppeals = 0;
  for (const modCase of cases) for (const appeal of getCaseAppeals(modCase) || []) if ((appeal.status || 'pending') === 'pending') pendingAppeals += 1;
  const verificationSessions = verificationStore.getVerificationSection(guildId)?.sessions || {};
  const activeVerificationCases = Object.values(verificationSessions).filter(session => session?.state === 'quarantined').length;
  const countActions = (actions) => cases.filter(entry => actions.includes(String(entry.action || '').toLowerCase())).length;
  return { totalCases: cases.length, activeCases, activeVerificationCases, activeWarnings, pendingAppeals, timeouts: countActions(['timeout']), kicks: countActions(['kick']), bans: countActions(['ban']) };
}

function analyticsBounds(windowKey, nowMs = Date.now()) {
  const days = ANALYTICS_WINDOWS[normalizeAnalyticsWindow(windowKey)];
  if (!days) return { start: null, end: nowMs, previousStart: null, previousEnd: null };
  const span = days * 86400000;
  return { start: nowMs - span, end: nowMs, previousStart: nowMs - (span * 2), previousEnd: nowMs - span };
}
function inBounds(value, start, end) { return value > 0 && (start === null || value >= start) && value <= end; }
function getAuditRows(guildId, bounds) {
  try { return db.prepare('SELECT actor_id, event, created_at FROM case_audit WHERE guild_id = ? ORDER BY created_at DESC').all(String(guildId)).filter((row) => inBounds(getAuditTime(row), bounds.start, bounds.end)); }
  catch (error) { console.error('❌ Moderation analytics audit query failed:', error); return []; }
}
function flattenAppeals(cases) { const result = []; for (const modCase of cases) for (const appeal of getCaseAppeals(modCase) || []) result.push({ modCase, appeal }); return result; }
function getModerationAnalytics(guildId, windowKey = '30d') {
  const window = normalizeAnalyticsWindow(windowKey); const bounds = analyticsBounds(window); const allCases = getAllCases(guildId) || [];
  const cases = allCases.filter((modCase) => inBounds(getCaseTime(modCase), bounds.start, bounds.end));
  const previousCases = bounds.previousStart === null ? [] : allCases.filter((modCase) => inBounds(getCaseTime(modCase), bounds.previousStart, bounds.previousEnd));
  const actionCounts = {}; const statusCounts = {}; const moderatorCounts = {}; const userCounts = {};
  for (const modCase of cases) { increment(actionCounts, String(modCase.action || 'unknown')); increment(statusCounts, String(modCase.status || 'active')); increment(moderatorCounts, modCase.moderatorId); increment(userCounts, modCase.userId); }
  const appealRows = flattenAppeals(allCases).filter(({ appeal }) => inBounds(new Date(appeal.submittedAt || 0).getTime(), bounds.start, bounds.end));
  const appealCounts = { pending: 0, approved: 0, denied: 0 }; for (const { appeal } of appealRows) increment(appealCounts, appeal.status || 'pending');
  const resolvedAppeals = appealCounts.approved + appealCounts.denied; const auditRows = getAuditRows(guildId, bounds); const moderatorAuditCounts = {}; for (const row of auditRows) increment(moderatorAuditCounts, row.actor_id);
  const trendDays = Math.min(7, ANALYTICS_WINDOWS[window] || 7); const trend = [];
  for (let offset = trendDays - 1; offset >= 0; offset -= 1) { const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0); dayStart.setUTCDate(dayStart.getUTCDate() - offset); const start = dayStart.getTime(); const end = start + 86399999; trend.push({ label: dayStart.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' }), count: cases.filter((modCase) => inBounds(getCaseTime(modCase), start, end)).length }); }
  return { window, windowLabel: ANALYTICS_WINDOW_LABELS[window], totalCases: cases.length, previousCases: previousCases.length, change: previousCases.length ? Math.round(((cases.length - previousCases.length) / previousCases.length) * 100) : null, activeCases: statusCounts.active || 0, reversedCases: statusCounts.reversed || 0, expiredCases: statusCounts.expired || 0, actionCounts, uniqueUsers: Object.keys(userCounts).length, repeatOffenders: Object.values(userCounts).filter((count) => count > 1).length, topModerators: topEntries(moderatorCounts), topUsers: topEntries(userCounts), appealCounts, resolvedAppeals, appealApprovalRate: percentage(appealCounts.approved, resolvedAppeals), reversalRate: percentage(statusCounts.reversed || 0, cases.length), auditActions: auditRows.length, moderatorAuditCounts, trend, cases };
}
function getModeratorAnalytics(guildId, moderatorId, windowKey = '30d') {
  const analytics = getModerationAnalytics(guildId, windowKey); const cases = analytics.cases.filter((modCase) => String(modCase.moderatorId) === String(moderatorId));
  const actionCounts = {}; const statusCounts = {}; const affectedUsers = {}; for (const modCase of cases) { increment(actionCounts, String(modCase.action || 'unknown')); increment(statusCounts, String(modCase.status || 'active')); increment(affectedUsers, modCase.userId); }
  const appealCounts = { pending: 0, approved: 0, denied: 0 }; const bounds = analyticsBounds(analytics.window); for (const { appeal } of flattenAppeals(cases)) if (inBounds(new Date(appeal.submittedAt || 0).getTime(), bounds.start, bounds.end)) increment(appealCounts, appeal.status || 'pending');
  let auditRows = []; try { auditRows = db.prepare('SELECT event, created_at FROM case_audit WHERE guild_id = ? AND actor_id = ? ORDER BY created_at DESC').all(String(guildId), String(moderatorId)).filter((row) => inBounds(getAuditTime(row), bounds.start, bounds.end)); } catch (error) { console.error('❌ Moderator history audit query failed:', error); }
  const eventCounts = {}; for (const row of auditRows) increment(eventCounts, row.event || 'unknown'); const resolvedAppeals = appealCounts.approved + appealCounts.denied;
  return { ...analytics, moderatorId: String(moderatorId), moderatorCases: cases.length, moderatorActionCounts: actionCounts, moderatorStatusCounts: statusCounts, affectedUsers: Object.keys(affectedUsers).length, repeatTargets: Object.values(affectedUsers).filter((count) => count > 1).length, moderatorAppeals: appealCounts, moderatorAppealApprovalRate: percentage(appealCounts.approved, resolvedAppeals), moderatorReversalRate: percentage(statusCounts.reversed || 0, cases.length), moderatorAuditActions: auditRows.length, topAuditEvents: topEntries(eventCounts), recentCases: cases.slice().sort((a, b) => getCaseTime(b) - getCaseTime(a)).slice(0, 5) };
}

function parseJsonValue(value) { if (value === null || value === undefined || value === '') return null; try { return JSON.parse(value); } catch { return value; } }
function normalizeExportInclude(raw) { const tokens = String(raw || 'all').toLowerCase().split(/[\s,;]+/).map((value) => value.trim()).filter(Boolean); if (!tokens.length || tokens.includes('all')) return new Set(EXPORT_INCLUDE_KEYS); const invalid = tokens.filter((value) => !EXPORT_INCLUDE_KEYS.has(value)); if (invalid.length) return { error: `Unknown include option: ${invalid.join(', ')}` }; const include = new Set(tokens); include.add('core'); return include; }
function parseExportDate(raw, endOfDay = false) { const value = String(raw || '').trim(); if (!value) return null; const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value); const parsed = new Date(dateOnly && endOfDay ? `${value}T23:59:59.999Z` : dateOnly ? `${value}T00:00:00.000Z` : value); return Number.isFinite(parsed.getTime()) ? parsed.getTime() : NaN; }
function parseExportFilters(raw) { const filters = {}; const pattern = /(action|status|from|to):("[^"]*"|'[^']*'|\S+)/gi; let match; while ((match = pattern.exec(String(raw || '')))) { const key = match[1].toLowerCase(); const value = String(match[2] || '').replace(/^("|')|("|')$/g, '').trim(); if (value) filters[key] = value; } if (filters.from) { filters.fromMs = parseExportDate(filters.from, false); if (!Number.isFinite(filters.fromMs)) return { error: 'Export `from` date is invalid.' }; } if (filters.to) { filters.toMs = parseExportDate(filters.to, true); if (!Number.isFinite(filters.toMs)) return { error: 'Export `to` date is invalid.' }; } if (filters.fromMs && filters.toMs && filters.fromMs > filters.toMs) return { error: '`from` date must be before `to` date.' }; return { filters }; }
function buildExportModal(targetId = 'none') { const hasTarget = targetId && targetId !== 'none'; return new ModalBuilder().setCustomId(`mod_export_submit:${targetId || 'none'}`).setTitle('Export Moderation Data').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('scope').setLabel('Scope: all / user / moderator / case').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(12).setValue(hasTarget ? 'user' : 'all')), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reference').setLabel('User / moderator / case ID').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(20).setValue(hasTarget ? targetId : '')), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('filters').setLabel('Optional filters').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500).setPlaceholder('action:warn status:active from:2026-08-01 to:2026-08-29')), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('format').setLabel('Format: json / csv').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(4).setValue('json')), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('include').setLabel('Include: all or comma-separated sections').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(60).setPlaceholder('core,metadata,appeals,evidence,audit').setValue('all'))); }
function parseExportRequest(interaction) { const scope = String(interaction.fields.getTextInputValue('scope') || '').trim().toLowerCase(); const reference = String(interaction.fields.getTextInputValue('reference') || '').trim(); const format = String(interaction.fields.getTextInputValue('format') || '').trim().toLowerCase(); if (!EXPORT_SCOPES.has(scope)) return { error: 'Scope must be `all`, `user`, `moderator`, or `case`.' }; if (!EXPORT_FORMATS.has(format)) return { error: 'Format must be `json` or `csv`.' }; if (scope === 'case' && !/^\d{1,12}$/.test(reference)) return { error: 'Case scope requires a numeric Case ID.' }; if ((scope === 'user' || scope === 'moderator') && !/^\d{16,20}$/.test(reference)) return { error: `${scope} scope requires a valid Discord ID.` }; const parsedFilters = parseExportFilters(interaction.fields.getTextInputValue('filters')); if (parsedFilters.error) return parsedFilters; const include = normalizeExportInclude(interaction.fields.getTextInputValue('include')); if (include?.error) return include; return { scope, reference, format, filters: parsedFilters.filters, include }; }
function selectExportCases(guildId, request) { let cases = getAllCases(guildId) || []; if (request.scope === 'user') cases = cases.filter((entry) => String(entry.userId) === request.reference); if (request.scope === 'moderator') cases = cases.filter((entry) => String(entry.moderatorId) === request.reference); if (request.scope === 'case') cases = cases.filter((entry) => Number(entry.caseId) === Number(request.reference)); if (request.filters.action) cases = cases.filter((entry) => String(entry.action || '').toLowerCase() === request.filters.action.toLowerCase()); if (request.filters.status) cases = cases.filter((entry) => String(entry.status || 'active').toLowerCase() === request.filters.status.toLowerCase()); if (request.filters.fromMs) cases = cases.filter((entry) => getCaseTime(entry) >= request.filters.fromMs); if (request.filters.toMs) cases = cases.filter((entry) => getCaseTime(entry) <= request.filters.toMs); return cases.sort((a, b) => Number(a.caseId) - Number(b.caseId)); }
function exportAuditMap(guildId, caseIds) { const wanted = new Set(caseIds.map(Number)); const map = new Map(); if (!wanted.size) return map; try { const rows = db.prepare('SELECT * FROM case_audit WHERE guild_id = ? ORDER BY audit_id ASC').all(String(guildId)); for (const row of rows) { if (!wanted.has(Number(row.case_id))) continue; const value = { auditId: row.audit_id, actorId: row.actor_id || null, event: row.event, before: parseJsonValue(row.before_value), after: parseJsonValue(row.after_value), metadata: parseJsonValue(row.metadata) || {}, createdAt: row.created_at }; if (!map.has(Number(row.case_id))) map.set(Number(row.case_id), []); map.get(Number(row.case_id)).push(value); } } catch (error) { console.error('❌ Moderation export audit query failed:', error); } return map; }
function buildExportRecords(guildId, cases, include) { const auditMap = include.has('audit') ? exportAuditMap(guildId, cases.map((entry) => entry.caseId)) : new Map(); return cases.map((entry) => { const record = { caseId: entry.caseId, guildId: entry.guildId, userId: entry.userId, moderatorId: entry.moderatorId, action: entry.action, reason: entry.reason, status: entry.status || 'active', relatedCaseId: entry.relatedCaseId || null, note: entry.note || null, createdAt: entry.createdAt, updatedAt: entry.updatedAt || null }; if (include.has('metadata')) record.metadata = entry.metadata || {}; if (include.has('appeals')) record.appeals = getCaseAppeals(entry); if (include.has('evidence')) record.evidence = Array.isArray(entry?.metadata?.evidence) ? entry.metadata.evidence : []; if (include.has('audit')) record.audit = auditMap.get(Number(entry.caseId)) || []; return record; }); }
function csvEscape(value) { if (value === null || value === undefined) return ''; const text = typeof value === 'string' ? value : JSON.stringify(value); return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }
function exportCsvRows(records, include) { const columns = ['caseId', 'guildId', 'userId', 'moderatorId', 'action', 'status', 'reason', 'relatedCaseId', 'note', 'createdAt', 'updatedAt']; if (include.has('metadata')) columns.push('metadata'); if (include.has('appeals')) columns.push('appeals'); if (include.has('evidence')) columns.push('evidence'); if (include.has('audit')) columns.push('audit'); return { header: columns.join(','), rows: records.map((record) => columns.map((column) => csvEscape(record[column])).join(',')) }; }
function safeExportName(guildId, format, part, total) { const stamp = new Date().toISOString().replace(/[:.]/g, '-'); return `goliath-mod-export-${guildId}-${stamp}${total > 1 ? `-part-${part}` : ''}.${format}`; }
function makeExportAttachments(guildId, format, records, include, request) { const chunks = []; if (format === 'csv') { const { header, rows } = exportCsvRows(records, include); let current = `${header}\n`; for (const row of rows) { const next = `${row}\n`; if (Buffer.byteLength(next, 'utf8') > MAX_EXPORT_FILE_BYTES) return { error: 'A single export row exceeds the attachment size limit. Narrow the export scope.' }; if (Buffer.byteLength(current + next, 'utf8') > MAX_EXPORT_FILE_BYTES && current !== `${header}\n`) { chunks.push(current); current = `${header}\n${next}`; } else current += next; } chunks.push(current); } else { const header = { version: 1, generatedAt: new Date().toISOString(), guildId: String(guildId), request: { scope: request.scope, reference: request.reference || null, filters: request.filters, include: [...include] } }; let currentRecords = []; for (const record of records) { const candidate = JSON.stringify({ ...header, records: [...currentRecords, record] }, null, 2); if (Buffer.byteLength(JSON.stringify(record), 'utf8') > MAX_EXPORT_FILE_BYTES) return { error: 'A single case record exceeds the attachment size limit. Exclude audit/evidence or narrow the export.' }; if (Buffer.byteLength(candidate, 'utf8') > MAX_EXPORT_FILE_BYTES && currentRecords.length) { chunks.push(JSON.stringify({ ...header, records: currentRecords }, null, 2)); currentRecords = [record]; } else currentRecords.push(record); } chunks.push(JSON.stringify({ ...header, records: currentRecords }, null, 2)); } if (chunks.length > MAX_EXPORT_ATTACHMENTS) return { error: `Export requires ${chunks.length} attachments. Narrow the scope or exclude audit/evidence (maximum ${MAX_EXPORT_ATTACHMENTS}).` }; return { attachments: chunks.map((content, index) => new AttachmentBuilder(Buffer.from(content, 'utf8'), { name: safeExportName(guildId, format, index + 1, chunks.length) })) }; }
async function handleExportInteraction(interaction) { const id = String(interaction.customId || ''); if (interaction.isButton?.() && id.startsWith('mod_export_cases:')) { if (!canUseModAction(interaction.member, interaction.guild, 'export_cases')) return safeReply(interaction, ephemeralError('No permission to export moderation data.')); const [, targetId = 'none'] = id.split(':'); await interaction.showModal(buildExportModal(targetId)); return true; } if (interaction.isModalSubmit?.() && id.startsWith('mod_export_submit:')) { if (!canUseModAction(interaction.member, interaction.guild, 'export_cases')) return safeReply(interaction, ephemeralError('No permission to export moderation data.')); const request = parseExportRequest(interaction); if (request.error) return safeReply(interaction, ephemeralError(request.error)); const cases = selectExportCases(interaction.guild.id, request); if (!cases.length) return safeReply(interaction, ephemeralError('No moderation cases matched the export request.')); if (cases.length > MAX_EXPORT_CASES) return safeReply(interaction, ephemeralError(`Export matched ${cases.length} cases. Narrow the scope to ${MAX_EXPORT_CASES} cases or fewer.`)); // Export serialization can exceed Discord's initial response window.
    if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: 64 });
    const records = buildExportRecords(interaction.guild.id, cases, request.include); const generated = makeExportAttachments(interaction.guild.id, request.format, records, request.include, request); if (generated.error) return interaction.editReply(ephemeralError(generated.error)); return interaction.editReply({ content: `📤 Export ready • **${records.length}** case${records.length === 1 ? '' : 's'} • **${request.format.toUpperCase()}** • ${generated.attachments.length} attachment${generated.attachments.length === 1 ? '' : 's'}\nGenerated in memory only; no export file was persisted by Goliath.`, files: generated.attachments, flags: 64 }); } return false; }

function buttonRow(buttons) { return buttons.length ? new ActionRowBuilder().addComponents(buttons) : null; }
function buildDashboardNav(targetId, activeView, member, guild, context = {}) {
  const active = normalizeView(activeView);
  const id = targetId || 'none';
  const rows = [];
  const finalButtons = [];
  if (active === 'actions') {
    finalButtons.push(new ButtonBuilder().setCustomId(context.adminOrigin ? 'admin:home' : 'mod:close').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary));
    if (canUseModAction(member, guild, 'export_cases')) finalButtons.push(new ButtonBuilder().setCustomId(`mod_export_cases:${id}`).setLabel('📤 Export').setStyle(ButtonStyle.Secondary));
    if (canUseModAction(member, guild, 'view_analytics')) finalButtons.push(new ButtonBuilder().setCustomId(`mod_dashboard:${id}:analytics`).setLabel('📊 Analytics').setStyle(ButtonStyle.Secondary));
  } else if (active === 'analytics') {
    const returnId = context.analyticsReturnTargetId || 'none';
    finalButtons.push(new ButtonBuilder().setCustomId('mod_history_back').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary));
    finalButtons.push(new ButtonBuilder()
      .setCustomId(`mod_analytics_refresh:${context.analyticsWindow || '30d'}:${context.analyticsMode || 'overview'}:${context.analyticsModeratorId || 'none'}:${returnId}`)
      .setLabel('🔄 Refresh')
      .setStyle(ButtonStyle.Secondary));
    if (canUseModAction(member, guild, 'export_cases')) finalButtons.push(new ButtonBuilder().setCustomId(`mod_export_cases:${returnId}`).setLabel('📤 Export').setStyle(ButtonStyle.Secondary));
  } else {
    finalButtons.push(new ButtonBuilder().setCustomId('mod_history_back').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary));
    if (canUseModAction(member, guild, 'export_cases')) finalButtons.push(new ButtonBuilder().setCustomId(`mod_export_cases:${id}`).setLabel('📤 Export').setStyle(ButtonStyle.Secondary));
  }
  rows.push(new ActionRowBuilder().addComponents(finalButtons));
  return rows;
}
function buildUserSelectRow() { return new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId('mod_user_select').setPlaceholder('👤 Select a member to investigate or moderate').setMinValues(0).setMaxValues(1)); }
function actionPermissions(member, guild) { return { warn: canUseModAction(member, guild, 'warn'), timeout: canUseModAction(member, guild, 'timeout'), kick: canUseModAction(member, guild, 'kick'), quarantine: canUseModAction(member, guild, 'quarantine'), ban: canUseModAction(member, guild, 'ban'), removeWarning: canUseModAction(member, guild, 'remove_warning'), removeTimeout: canUseModAction(member, guild, 'remove_timeout'), removeQuarantine: canUseModAction(member, guild, 'remove_quarantine') }; }
function buildActionRows(target, stats, member, guild, context = {}) {
  const id = target?.id || 'none';
  const p = actionPermissions(member, guild);
  const disabled = !target;
  const quarantined = targetIsQuarantined(guild, target);
  const actions = [];
  if (p.warn) actions.push(createSecondaryButton(`mod_open_warn:${id}`, 'Warn', '⚠️').setDisabled(disabled));
  if (p.timeout) actions.push(createSecondaryButton(`mod_open_timeout:${id}`, 'Timeout', '⌛').setDisabled(disabled));
  if (p.quarantine) actions.push(createDangerButton(`mod_open_quarantine:${id}`, 'Investigate', '☢️').setDisabled(disabled || quarantined));
  if (p.kick) actions.push(createDangerButton(`mod_open_kick:${id}`, 'Kick', '🥾').setDisabled(disabled));
  if (p.ban) actions.push(createDangerButton(`mod_open_ban:${id}`, 'Ban', '🔨').setDisabled(disabled));
  const reversals = [];
  if (p.removeWarning) reversals.push(createSecondaryButton(`mod_remove_warning:${id}`, 'Clear Warn', '⚠️').setDisabled(disabled || Number(stats?.warningCount || 0) <= 0));
  if (p.removeTimeout) reversals.push(createSecondaryButton(`mod_remove_timeout:${id}`, 'Clear Timeout', '⌛').setDisabled(disabled || !targetHasActiveTimeout(target)));
  if (p.removeQuarantine) reversals.push(createSecondaryButton(`mod_remove_quarantine:${id}`, 'Clear Investigation', '🟠').setDisabled(disabled || !quarantined));
  const management = [];
  if (canViewDashboardSection(member, guild, 'cases')) {
    management.push(new ButtonBuilder().setCustomId(`mod_dashboard:${id}:cases`).setLabel('📁 Cases').setStyle(ButtonStyle.Secondary));
  }
  if (canViewDashboardSection(member, guild, 'appeals')) management.push(new ButtonBuilder().setCustomId('mod_dashboard:none:appeals').setLabel('⚖️ Appeals').setStyle(ButtonStyle.Secondary));
  if (canUseModAction(member, guild, 'view_cases')) management.push(new ButtonBuilder().setCustomId('mod_verification_cases').setLabel('🚨 Quarantines').setStyle(ButtonStyle.Secondary));
  const tools = [
    new ButtonBuilder().setCustomId(context.adminOrigin ? 'admin:home' : 'mod:close').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary),
  ];
  if (canViewDashboardSection(member, guild, 'intelligence')) tools.push(new ButtonBuilder().setCustomId(`mod_dashboard:${id}:intelligence`).setLabel('🧠 Intelligence').setStyle(ButtonStyle.Secondary).setDisabled(disabled));
  if (canViewDashboardSection(member, guild, 'analytics')) tools.push(new ButtonBuilder().setCustomId(`mod_dashboard:${id}:analytics`).setLabel('📊 Analytics').setStyle(ButtonStyle.Secondary));
  if (canUseModAction(member, guild, 'export_cases')) tools.push(new ButtonBuilder().setCustomId(`mod_export_cases:${id}`).setLabel('📤 Export').setStyle(ButtonStyle.Secondary));
  return [buttonRow(actions),buttonRow(reversals),buttonRow(management),buttonRow(tools)].filter(Boolean);
}
function buildIntelligenceRows(targetId, member, guild) {
  if (!targetId) return [];
  const id = targetId; const primary = [];
  if (canUseModAction(member, guild, 'scan_run')) primary.push(createPrimaryButton(`mod_member_scan:${id}`, 'Full Member Scan', '🔎'));
  if (canUseModAction(member, guild, 'scan_history')) primary.push(createSecondaryButton(`mod_scan_history:${id}:landing`, 'Scan History', '🕘'));
  return buttonRow(primary) ? [buttonRow(primary)] : [];
}
function validateDashboardComponents(components, view) {
  if (components.length > 5) throw new Error(`Moderation ${view} workspace produced ${components.length} component rows; Discord allows 5.`);
  for (const row of components) if (Array.isArray(row?.components) && row.components.length > 5) throw new Error(`Moderation ${view} workspace produced a row with ${row.components.length} components; Discord allows 5.`);
  return components;
}

function buildActionsEmbed(interaction, target, stats, staffDisplay) {
  const overall = workspaceStats(interaction.guild.id);
  if (!target) return baseEmbed(interaction.client, COLORS.PRIMARY)
    .setTitle('🛡️ Moderation Hub')
    .setDescription([
      '**Select a member** to view their profile and moderation actions.',
      '',
      `**Your Role:** ${staffDisplay}`,
      '',
      `**Cases:** ${overall.activeCases} › **Warns:** ${overall.activeWarnings} › **Timeouts:** ${overall.timeouts} › **Kicks:** ${overall.kicks} › **Bans:** ${overall.bans} › **Appeals:** ${overall.pendingAppeals} › **Quarantines:** ${overall.activeVerificationCases}`,
    ].join('\n'));

  const highestRole = target.roles?.highest && target.roles.highest.id !== interaction.guild.id ? `${target.roles.highest}` : 'No assigned role';
  const timeout = targetHasActiveTimeout(target) ? `Until ${timestamp(target.communicationDisabledUntilTimestamp, 'f')}` : 'None';
  const latest = stats?.latestCase;
  const latestLabel = latest
    ? `**#${latest.caseId}** • ${String(latest.action || 'Unknown').replace(/-/g, ' ')} • ${getStatusLabel(latest)}\n<t:${Math.floor(new Date(latest.createdAt || Date.now()).getTime() / 1000)}:R>`
    : 'No cases recorded';
  const embed = baseEmbed(interaction.client, COLORS.PRIMARY)
    .setTitle('🛡️ Moderation Hub')
    .setDescription([
      `**Member:** ${target.user}`,
      `**User ID:** \`${target.id}\``,
      `**Your Role:** ${staffDisplay}`,
      '',
      'Choose an action below or review this member’s history.',
    ].join('\n'))
    .addFields(
      { name: '👤 Member Profile', value: `**Joined:** ${timestamp(target.joinedTimestamp)}\n**Account Created:** ${timestamp(target.user?.createdTimestamp)}\n**Highest Role:** ${highestRole}`, inline: false },
      { name: '🛡️ Moderation Status', value: `**Warnings:** ${stats?.warningCount ?? 0}  •  **Timeout:** ${timeout}`, inline: false },
      { name: '📁 Case History', value: `**Total Cases:** ${stats?.caseCount ?? 0}\n**Most Recent:** ${latestLabel}`, inline: false },
    )
    .setFooter({ text: 'All actions require permission and hierarchy checks.' });
  const avatar = target.user?.displayAvatarURL?.({ size: 256 });
  if (avatar) embed.setThumbnail(avatar);
  return embed;
}
function buildIntelligenceEmbed(interaction, target, member, guild) { const capabilities = []; if (canUseModAction(member, guild, 'scan_suspects')) capabilities.push('Suspected-account correlation'); if (canUseModAction(member, guild, 'scan_network')) capabilities.push('Network reputation and cross-guild intelligence'); if (canUseModAction(member, guild, 'scan_links')) capabilities.push('Persistent link evidence'); if (canUseModAction(member, guild, 'scan_notes')) capabilities.push('Investigation notes'); if (canUseModAction(member, guild, 'scan_watch')) capabilities.push('Investigation watch and Watchlist state'); return baseEmbed(interaction.client, COLORS.PRIMARY).setTitle('🧠 Member Intelligence').setDescription([target ? `**Active Member:** ${target.user} • \`${target.id}\`` : '**No member selected.**', '', 'Run **Full Member Scan** to open the complete intelligence workspace. Scan History remains available separately for previous snapshots and account comparison.', '', capabilities.length ? `**Included Intelligence:**\n${capabilities.map((value) => `• ${value}`).join('\n')}` : 'Your authority profile provides basic scan access only.', '', 'Evidence controls are kept inside the scan workspace so Back always returns to the correct panel and no duplicate scan is recorded unless you explicitly choose Rescan.'].join('\n')); }
function buildCasesEmbed(target, cases = [], page = 0, totalPages = 1, actionFilter = 'all', statusFilter = 'all') { const description = cases.length ? cases.map((entry) => `**#${entry.caseId}** • ${String(entry.action || 'unknown').toUpperCase()} • ${getStatusLabel(entry)}\n${entry.reason || 'No reason provided'}\n<t:${Math.floor(getCaseTime(entry) / 1000)}:R>`).join('\n\n') : 'No cases found for this member.'; return createEmbed({ title: target?.user?.tag ? `📁 Cases • ${target.user.tag}` : '📁 Member Cases', description, color: COLORS.PRIMARY, footer: `Action: ${actionFilter} | Status: ${statusFilter} | Page ${page + 1}/${totalPages}` }); }
function getAppealsPage(guildId, filter = 'pending', page = 0) {
  const all = listAppeals(guildId, { status: 'all' });
  const pending = all.filter(({ appeal }) => (appeal.status || 'pending') === 'pending');
  const resolved = all.filter(({ appeal }) => ['approved', 'denied'].includes(appeal.status));
  const entries = filter === 'all' ? all : filter === 'resolved' ? resolved : pending;
  const totalPages = Math.max(1, Math.ceil(entries.length / 5));
  const currentPage = Math.max(0, Math.min(Number(page) || 0, totalPages - 1));
  return { all, pending, resolved, entries: entries.slice(currentPage * 5, (currentPage + 1) * 5), currentPage, totalPages };
}
function buildAppealsOverviewEmbed(guild, filter = 'pending', page = 0) {
  const data = getAppealsPage(guild.id, filter, page);
  const totalInView = filter === 'all' ? data.all.length : filter === 'resolved' ? data.resolved.length : data.pending.length;
  const viewLabel = filter === 'all' ? 'All Appeals' : filter === 'resolved' ? 'Resolved' : 'Pending Review';
  const embed = createEmbed({
    title: '⚖️ Moderation Appeals',
    description: [
      'Review submitted appeals, inspect their grounds and record a decision.',
      '',
      `**📥 Pending:** ${data.pending.length}   •   **✅ Resolved:** ${data.resolved.length}   •   **📋 Total:** ${data.all.length}`,
      `**Viewing:** ${viewLabel}`,
    ].join('\n'),
    color: COLORS.PRIMARY,
    footer: `${totalInView ? `Appeals ${data.currentPage * 5 + 1}–${data.currentPage * 5 + data.entries.length} of ${totalInView}` : 'No appeals in this view'}${data.totalPages > 1 ? ` • Page ${data.currentPage + 1}/${data.totalPages}` : ''}`,
  });
  if (!data.entries.length) {
    embed.addFields({ name: '📭 Nothing to Review', value: data.all.length ? 'No appeals match this filter.' : 'No appeals have been submitted yet.', inline: false });
  } else {
    for (const { case: modCase, appeal } of data.entries) {
      const status = appeal.status === 'approved' ? '✅ Approved' : appeal.status === 'denied' ? '❌ Denied' : '⏳ Pending';
      const rawTime = new Date(appeal.submittedAt || 0).getTime();
      const submitted = Number.isFinite(rawTime) && rawTime > 0 ? `<t:${Math.floor(rawTime / 1000)}:R>` : 'Unknown';
      const grounds = String(appeal.grounds || appeal.reason || appeal.message || 'No appeal grounds recorded').replace(/\s+/g, ' ').slice(0, 220);
      const outcome = appeal.status !== 'pending' && appeal.reviewNote ? `\n**Decision Note:** ${String(appeal.reviewNote).replace(/\s+/g, ' ').slice(0, 160)}` : '';
      embed.addFields({
        name: `📁 Case #${modCase.caseId}  •  ${String(modCase.action || 'case').toUpperCase()}  •  ${status}`,
        value: `**Member:** <@${modCase.userId}>\n**Submitted:** ${submitted}\n**Appeal:** ${grounds}${outcome}`,
        inline: false,
      });
    }
  }
  return embed;
}
function buildAnalyticsOverviewEmbed(guild, analytics) {
  const appeal = analytics.appealCounts;
  const topModerators = analytics.topModerators.slice(0, 3).map(([id, count], index) => `${index + 1}. <@${id}> — **${count}**`).join('\n');
  const topUsers = analytics.topUsers.slice(0, 3).map(([id, count], index) => `${index + 1}. <@${id}> — **${count}**`).join('\n');
  const recent = analytics.trend.slice(-7);
  const maximum = Math.max(1, ...recent.map((entry) => Number(entry.count) || 0));
  const trend = recent.length ? recent.map((entry) => {
    const count = Number(entry.count) || 0;
    const bar = count ? '▰'.repeat(Math.max(1, Math.round(count / maximum * 8))) : '—';
    return `\`${entry.label.padEnd(10, ' ')} ${bar.padEnd(8, ' ')} ${count}\``;
  }).join('\n') : 'No recent activity.';
  const comparison = analytics.change === null ? '' : `\nCompared with previous period: **${analytics.change >= 0 ? '+' : ''}${analytics.change}%**`;
  const fields = [
    { name: '📁 Total Cases', value: `**${analytics.totalCases}**\n${analytics.activeCases} active`, inline: true },
    { name: '👥 Members', value: `**${analytics.uniqueUsers}**\n${analytics.repeatOffenders} repeat`, inline: true },
    { name: '🧾 Audit Events', value: `**${analytics.auditActions}**\nrecorded`, inline: true },
    { name: '⚡ Moderation Actions', value: `Warnings **${Number(analytics.actionCounts.warn || 0)}**  •  Timeouts **${Number(analytics.actionCounts.timeout || 0)}**  •  Kicks **${Number(analytics.actionCounts.kick || 0)}**  •  Bans **${Number(analytics.actionCounts.ban || 0)}**`, inline: false },
    { name: '⚖️ Appeals', value: `Pending **${appeal.pending}**  •  Approved **${appeal.approved}**  •  Denied **${appeal.denied}**`, inline: false },
    { name: '↩️ Case Outcomes', value: `Closed **${analytics.reversedCases}**  •  Expired **${analytics.expiredCases}**  •  Closure rate **${analytics.reversalRate}**`, inline: false },
    { name: '📈 Recent Activity · Last 7 Days', value: trend.slice(0, 1024), inline: false }
  ];
  if (topModerators || topUsers) {
    fields.push(
      { name: '🏆 Top Moderators', value: topModerators || 'No activity', inline: true },
      { name: '👥 Frequent Members', value: topUsers || 'No activity', inline: true }
    );
  }
  return createEmbed({
    title: `📊 Moderation Analytics • ${analytics.windowLabel}`,
    description: `**${guild?.name || 'Server'}** • Server-wide overview${comparison}`,
    color: COLORS.PRIMARY,
    fields,
    footer: `Server-wide moderation • ${analytics.windowLabel.toLowerCase()}`
  });
}
function buildModeratorAnalyticsEmbed(guild, analytics) {
  const statuses = analytics.moderatorStatusCounts;
  const moderatorId = analytics.moderatorId;
  const moderatorName = guild?.members?.cache?.get(moderatorId)?.displayName
    || guild?.client?.users?.cache?.get(moderatorId)?.username;
  const memberLabel = moderatorName ? `**${moderatorName.replace(/([*_~`|])/g, '\\$1')}** • <@${moderatorId}>` : `<@${moderatorId}>`;
  const fields = [];
  if (analytics.moderatorCases === 0) {
    fields.push({ name: '📁 No Activity', value: 'No moderation actions recorded for this moderator during the selected period.', inline: false });
  } else {
    fields.push(
      { name: '📁 Cases Handled', value: `**${analytics.moderatorCases}**`, inline: true },
      { name: '👥 Members Moderated', value: `**${analytics.affectedUsers}**`, inline: true },
      { name: '✅ Closed', value: `**${statuses.reversed || 0}**`, inline: true },
      { name: '⚡ Actions Taken', value: `Warnings **${Number(analytics.moderatorActionCounts.warn || 0)}** • Timeouts **${Number(analytics.moderatorActionCounts.timeout || 0)}**\nKicks **${Number(analytics.moderatorActionCounts.kick || 0)}** • Bans **${Number(analytics.moderatorActionCounts.ban || 0)}**`, inline: false }
    );
    const recent = analytics.recentCases.slice(0, 5).map((entry) => {
      const when = getCaseTime(entry);
      return `**Case #${entry.caseId} • ${String(entry.action || 'unknown').toUpperCase()}** • ${getStatusLabel(entry)}\n<@${entry.userId}> • ${timestamp(when, 'f')}`;
    }).join('\n\n');
    fields.push({ name: '🕘 Recent Cases', value: recent.slice(0, 1024) || 'No recent cases in this period.', inline: false });
  }
  return createEmbed({
    title: '👤 Moderator History',
    description: `**Moderator:** ${memberLabel}\n**Server:** ${guild?.name || 'Server'}`,
    color: COLORS.PRIMARY,
    fields,
    footer: `Moderator activity • ${analytics.windowLabel.toLowerCase()}`
  });
}
// Historical moderation actors are sourced from recorded case actions, not Discord's
// unrestricted member selector. This also retains history for former moderators.
function getRecordedModerators(guildId) {
  const counts = new Map();
  for (const entry of getAllCases(guildId) || []) {
    const id = String(entry.moderatorId || '');
    if (!/^\d{16,20}$/.test(id)) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
function buildAnalyticsRows(guild, windowKey, mode = 'overview', moderatorId = null, currentUserId = null, returnTargetId = 'none', staffPage = 0) {
  const window = normalizeAnalyticsWindow(windowKey);
  const returnId = returnTargetId || 'none';
  const recorded = getRecordedModerators(guild.id);
  const pageCount = Math.max(1, Math.ceil(recorded.length / 25));
  const page = Math.min(Math.max(0, Number(staffPage) || 0), pageCount - 1);
  const windowButtons = Object.keys(ANALYTICS_WINDOWS).map((key) => new ButtonBuilder()
    .setCustomId(`mod_analytics_window:${key}:${mode}:${moderatorId || 'none'}:${returnId}`)
    .setLabel(ANALYTICS_WINDOW_LABELS[key])
    .setStyle(window === key ? ButtonStyle.Primary : ButtonStyle.Secondary));
  const ownHistory = mode === 'moderator' && moderatorId && currentUserId && String(moderatorId) === String(currentUserId);
  windowButtons.push(new ButtonBuilder()
    .setCustomId(ownHistory
      ? `mod_analytics_overview:${window}:${returnId}`
      : `mod_analytics_my:${window}:${currentUserId || 'none'}:${returnId}`)
    .setLabel(ownHistory ? '📊 Server' : '👤 History')
    .setStyle(ButtonStyle.Secondary));
  const rows = [];
  if (recorded.length) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`mod_analytics_staff_select:${window}:${returnId}:${page}`)
      .setPlaceholder(`Moderator history • ${recorded.length} recorded • ${page + 1}/${pageCount}`)
      .setMinValues(1).setMaxValues(1)
      .addOptions(recorded.slice(page * 25, page * 25 + 25).map(([id, count]) => {
        const name = guild.members.cache.get(id)?.displayName || guild.client.users.cache.get(id)?.username || id;
        return { label: String(name).slice(0, 100), value: id, description: `${count} recorded action${count === 1 ? '' : 's'} • ${id}`.slice(0, 100) };
      }));
    rows.push(new ActionRowBuilder().addComponents(menu));
    if (pageCount > 1) rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`mod_analytics_staff_page:${window}:${mode}:${moderatorId || 'none'}:${returnId}:${page - 1}`).setLabel('◀ Staff').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
      new ButtonBuilder().setCustomId(`mod_analytics_staff_page:${window}:${mode}:${moderatorId || 'none'}:${returnId}:${page + 1}`).setLabel('Staff ▶').setStyle(ButtonStyle.Secondary).setDisabled(page + 1 >= pageCount)
    ));
  }
  rows.push(new ActionRowBuilder().addComponents(windowButtons));
  return rows;
}
function buildTargetStats(guildId, target) { if (!target) return { warningCount: undefined, caseCount: undefined, lastCaseSummary: null }; const cases = getCasesForUser(guildId, target.id) || []; return { warningCount: getWarningCountForUser(guildId, target.id), caseCount: getCaseCountForUser(guildId, target.id), lastCaseSummary: cases[0] ? formatCaseSummary(cases[0]) : null, latestCase: cases[0] || null }; }
function getCasesPageData(guildId, targetId, options = {}) { const actionFilter = options.actionFilter || 'all'; const statusFilter = options.statusFilter || 'all'; const filters = {}; if (actionFilter !== 'all') filters.action = actionFilter; if (statusFilter !== 'all') filters.status = statusFilter; const allCases = getFilteredCases(guildId, targetId, filters) || []; const totalPages = Math.max(1, Math.ceil(allCases.length / CASES_PER_PAGE)); const page = Math.max(0, Math.min(Number(options.page) || 0, totalPages - 1)); return { actionFilter, statusFilter, page, totalPages, pageCases: allCases.slice(page * CASES_PER_PAGE, (page + 1) * CASES_PER_PAGE) }; }

async function buildDashboardPayload(discord, interaction, target, view = DEFAULT_VIEW, options = {}) {
  await syncExpiredWarningsToCases(interaction.guild.id);
  const context = normalizeDashboardContext({ ...options, view }); context.adminOrigin = options.adminOrigin === true || interaction.message?.components?.some((row) => row.components?.some((component) => component.customId === 'admin:home')); let safeView = context.view;
  if (!canViewDashboardSection(interaction.member, interaction.guild, safeView)) safeView = DEFAULT_VIEW;
  const targetId = target?.id || null; const stats = buildTargetStats(interaction.guild.id, target); const staff = getStaffDisplay(interaction.member, interaction.guild); const staffDisplay = staff.roleId ? `<@&${staff.roleId}>` : 'No configured moderation role';
  const embeds = []; const components = (safeView === 'analytics' || safeView === 'appeals') ? [] : [buildUserSelectRow()];
  if (safeView === 'actions') { embeds.push(buildActionsEmbed(interaction, target, stats, staffDisplay)); components.push(...buildActionRows(target, stats, interaction.member, interaction.guild, context)); }
  else if (safeView === 'intelligence') { embeds.push(buildIntelligenceEmbed(interaction, target, interaction.member, interaction.guild)); components.push(...buildIntelligenceRows(targetId, interaction.member, interaction.guild)); }
  else if (safeView === 'cases') {
    const guildId = interaction.guild.id, filter = ['all','warn','timeout','appeal','quarantine'].includes(context.actionFilter) ? context.actionFilter : 'all';
    const rawCases = (target ? getCasesForUser(guildId, target.id) : getAllCases(guildId)) || [];
    const sessions = verificationStore.getVerificationSection(guildId)?.sessions || {};
    const quarantines = Object.entries(sessions).filter(([id, session]) => session?.state === 'quarantined' && (!target || id === target.id));
    const appeals = listAppeals(guildId, { status: 'all' }).filter(({ case: entry }) => !target || String(entry?.userId || entry?.user_id || '') === target.id);
    const records = rawCases.map(entry => ({ type: String(entry.action || 'case').toLowerCase(), userId: String(entry.userId || entry.user_id || ''), reason: String(entry.reason || 'No reason provided'), caseId: entry.caseId, status: String(entry.status || 'active'), source: 'case' }))
      .concat(quarantines.map(([userId, session]) => ({ type: 'quarantine', userId, reason: 'Verification failed · ' + Number(session.failedAttempts || 0) + ' checks', status: 'active', channelId: session.quarantineChannelId, source: 'verification' })));
    const pendingAppeals = appeals.filter(({ appeal }) => (appeal?.status || 'pending') === 'pending').map(({ case: entry, appeal }) => ({ type: 'appeal', userId: String(entry?.userId || entry?.user_id || ''), caseId: entry?.caseId, reason: String(entry?.reason || 'Moderation appeal awaiting review'), status: 'pending' }));
    records.push(...pendingAppeals);
    const matches = records.filter(entry => filter === 'all' || (filter === 'warn' ? ['warn','warning'].includes(entry.type) : entry.type === filter));
    const active = filter === 'warn' || filter === 'timeout'
      ? matches
      : matches.filter(entry => ['active','pending','quarantined'].includes(entry.status));
    const pages = Math.max(1, Math.ceil(active.length / 8)), page = Math.max(0, Math.min(context.page, pages - 1));
    const shown = active.slice(page * 8, (page + 1) * 8);
    const title = filter === 'warn' ? '⚠️ Warnings · Review Centre' : filter === 'timeout' ? '⌛ Timeouts · Review Centre' : filter === 'appeal' ? '⚖️ Appeals · Review Centre' : filter === 'quarantine' ? '🚨 Quarantines · Review Centre' : '📂 Cases · Review Centre';
    const embed = new Discord.EmbedBuilder().setColor(0x5865F2).setTitle(title)
      .setDescription(target ? `👤 <@${target.id}> · Member records` : 'Review active cases, appeals and quarantines.')
      .addFields(
        { name: '📊 Overview', value: `⚠️ Warnings **${records.filter(e => ['warn','warning'].includes(e.type)).length}** · ⌛ Timeouts **${records.filter(e => e.type === 'timeout').length}** · ⚖️ Appeals **${appeals.length}** · 🚨 Quarantines **${quarantines.length}**`, inline: false },
        { name: `📋 ${filter === 'warn' || filter === 'timeout' ? 'History' : 'Active'} · ${filter === 'all' ? 'All types' : filter} · ${active.length} record(s)`, value: shown.length ? shown.map(e => `**${e.type.toUpperCase()}** · <@${e.userId}>${e.caseId ? ` · #${e.caseId}` : ''}\n${e.reason.slice(0, 110)}${e.channelId ? ` · <#${e.channelId}>` : ''}`).join('\n\n').slice(0, 1024) : (filter === 'warn' || filter === 'timeout' ? 'No matching records in this history.' : 'No matching active records.'), inline: false })
      .setFooter({ text: 'Staff only · Select a record to review' });
    embeds.push(embed);
    components.length = 0;
    components.push(new ActionRowBuilder().addComponents(new UserSelectMenuBuilder()
      .setCustomId('mod_cases_user_select').setPlaceholder(target ? '👤 Change member filter' : '🔎 Search cases by member')
      .setMinValues(1).setMaxValues(1)));
    components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
      .setCustomId('mod_cases_open_record').setPlaceholder(shown.length ? '📂 Open a case to review' : '📂 No matching records')
      .setDisabled(!shown.length)
      .addOptions(shown.length ? shown.map(e => ({
        label: `${e.type.toUpperCase()} · ${e.userId.slice(-6)} · ${e.status}`.slice(0, 100),
        description: e.reason.slice(0, 100),
        value: e.source === 'verification' ? `q:${e.userId}` : `c:${e.caseId}`
      })) : [{ label: 'No matching records', value: 'none' }])));
    components.push(new ActionRowBuilder().addComponents(...[['all','All'],['warn','Warnings'],['timeout','Timeouts'],['appeal','Appeals'],['quarantine','Quarantines']].map(([key,label]) =>
      new ButtonBuilder().setCustomId(`mod_cases_filter:${targetId || 'none'}:${key}`).setLabel(label).setStyle(filter === key ? ButtonStyle.Primary : ButtonStyle.Secondary))));
    const controls = [];
    if (pages > 1) controls.push(
      new ButtonBuilder().setCustomId(`mod_cases_page:${targetId || 'none'}:${filter}:${page - 1}`).setLabel('◀ Previous').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
      new ButtonBuilder().setCustomId(`mod_cases_page:${targetId || 'none'}:${filter}:${page + 1}`).setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(page === pages - 1));
    if (controls.length) components.push(new ActionRowBuilder().addComponents(controls));
  }
  else if (safeView === 'appeals') {
    const filter = ['pending', 'all', 'resolved'].includes(options.appealFilter) ? options.appealFilter : 'pending';
    const data = getAppealsPage(interaction.guild.id, filter, options.appealPage);
    embeds.push(buildAppealsOverviewEmbed(interaction.guild, filter, data.currentPage));
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('mod_appeals_select_filter')
        .setPlaceholder('⚖️ Filter appeals')
        .addOptions(
          { label: 'All Appeals', value: 'all', description: 'Every submitted appeal', emoji: '📋', default: filter === 'all' },
          { label: 'Pending Review', value: 'pending', description: 'Appeals awaiting a decision', emoji: '📥', default: filter === 'pending' },
          { label: 'Resolved', value: 'resolved', description: 'Approved and denied appeals', emoji: '✅', default: filter === 'resolved' }
        )
    ));
    if (data.entries.length) components.push(new ActionRowBuilder().addComponents(data.entries.map(({ case: modCase, appeal }) =>
      new ButtonBuilder().setCustomId(`mod_case_appeal_open:${modCase.caseId}:${appeal.id}`).setLabel(`${appeal.status === 'pending' ? '⚖️ Review' : '📁 View'} #${modCase.caseId}`).setStyle(appeal.status === 'pending' ? ButtonStyle.Success : ButtonStyle.Secondary)
    )));
    if (data.totalPages > 1) components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`mod_appeals_filter:${filter}:${data.currentPage - 1}`).setLabel('◀ Previous').setStyle(ButtonStyle.Secondary).setDisabled(data.currentPage === 0),
      new ButtonBuilder().setCustomId(`mod_appeals_filter:${filter}:${data.currentPage + 1}`).setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(data.currentPage + 1 >= data.totalPages)
    ));
  }
  else if (safeView === 'analytics') { const window = context.analyticsWindow; if (context.analyticsMode === 'moderator' && context.analyticsModeratorId) embeds.push(buildModeratorAnalyticsEmbed(interaction.guild, getModeratorAnalytics(interaction.guild.id, context.analyticsModeratorId, window), interaction.user?.id || null)); else embeds.push(buildAnalyticsOverviewEmbed(interaction.guild, getModerationAnalytics(interaction.guild.id, window))); components.push(...buildAnalyticsRows(interaction.guild, window, context.analyticsMode, context.analyticsModeratorId, interaction.user?.id || null, context.analyticsReturnTargetId || 'none', context.analyticsStaffPage)); }
  if (safeView !== 'actions') components.push(...buildDashboardNav(targetId, safeView, interaction.member, interaction.guild, context));
  return { embeds, components: validateDashboardComponents(components, safeView) };
}
async function renderDashboard(interaction, targetId, view = DEFAULT_VIEW, context = {}, back = false) {
  const requestedView = normalizeView(view);
  if (!canViewDashboardSection(interaction.member, interaction.guild, requestedView)) return safeReply(interaction, ephemeralError('That moderation workspace is not available to your authority profile.'));
  const target = targetId && targetId !== 'none' ? await fetchTarget(interaction.guild, targetId) : null;
  if (targetId && targetId !== 'none' && !target) return safeReply(interaction, ephemeralError('Could not find the selected member.'));
  const state = { targetId: targetId || 'none', view: requestedView, context: normalizeDashboardContext({ ...context, view: requestedView }) };
  if (!back && !dashboardHistoryEntry(interaction) && interaction.message) {
    const title = String(interaction.message.embeds?.[0]?.title || '');
    const inferredView = title.includes('Appeals') ? 'appeals' : title.includes('Analytics') ? 'analytics' : title.includes('Intelligence') ? 'intelligence' : title.includes('Cases') || title.includes('Warnings') ? 'cases' : 'actions';
    const inferredTarget = inferredView === 'actions' ? (interaction.message.components?.[0]?.components?.[0]?.data?.default_values?.[0]?.id || 'none') : 'none';
    rememberDashboard(interaction, { targetId: inferredTarget, view: inferredView, context: normalizeDashboardContext({ view: inferredView }) });
  }
  const payload = await buildDashboardPayload(Discord, interaction, target, requestedView, context);
  if (!interaction.deferred && !interaction.replied && interaction.isMessageComponent?.()) await interaction.deferUpdate();
  const result = await interaction.update(payload);
  rememberDashboard(interaction, state, back);
  return result;
}
async function refreshDashboard(discord, interaction, target, context = {}) { const safeContext = normalizeDashboardContext(context); const payload = await buildDashboardPayload(discord, interaction, target, safeContext.view, safeContext); try { if (interaction.message) { await interaction.message.edit(payload); return true; } if (interaction.replied || interaction.deferred) { await interaction.editReply(payload); return true; } await interaction.reply({ ...payload, flags: 64 }); return true; } catch (error) { console.error('❌ Failed to refresh moderation dashboard message:', error); return false; } }
async function refreshCasesDashboard(interaction, target) {
  if (!target) return false;
  const id = String(interaction?.customId || '');
  const returnsToActions = id.startsWith('mod_submit_warn:') || id.startsWith('mod_submit_timeout:');
  return refreshDashboard(Discord, interaction, target, returnsToActions ? DEFAULT_ACTIONS_CONTEXT : DEFAULT_CASES_CONTEXT);
}
async function handleDashboardNavigation(interaction) {
  const id = String(interaction.customId || '');
  // Case filters and pagination are controls within one workspace, not pages in Back history.
  if (id === 'mod_history_back' && dashboardHistoryEntry(interaction)?.current?.view === 'cases') {
    const entry = dashboardHistoryEntry(interaction);
    while (entry?.stack?.length && entry.stack[entry.stack.length - 1].view === 'cases') entry.stack.pop();
  }
  if (id === 'mod_history_back' || id === 'mod_dashboard:back:appeals') {
    const entry = dashboardHistoryEntry(interaction);
    const previous = entry?.stack?.length ? entry.stack[entry.stack.length - 1] : { targetId: 'none', view: 'actions', context: {} };
    const result = await renderDashboard(interaction, previous.targetId, previous.view, previous.context, true);
    if (entry?.stack?.length) entry.stack.pop();
    return result;
  }
  if (id === 'mod:overview') return renderDashboard(interaction, 'none', 'actions');
  if (id === 'mod_dashboard:back:appeals') return renderDashboard(interaction, 'none', 'actions');
  if (id.startsWith('mod_cases_filter:')) { const [, targetId, filter] = id.split(':'); return renderDashboard(interaction, targetId, 'cases', { actionFilter: filter }); }
  if (id.startsWith('mod_cases_page:')) { const [, targetId, filter, page] = id.split(':'); return renderDashboard(interaction, targetId, 'cases', { actionFilter: filter, page: Number(page) || 0 }); }
  if (id.startsWith('mod_appeals_filter:')) {
    if (!canUseModAction(interaction.member, interaction.guild, 'view_appeals')) return safeReply(interaction, ephemeralError('No permission to view appeals.'));
    const [, filter, pageRaw = '0'] = id.split(':');
    return renderDashboard(interaction, 'none', 'appeals', { appealFilter: ['all', 'resolved'].includes(filter) ? filter : 'pending', appealPage: Math.max(0, Number(pageRaw) || 0) });
  }
  if (id.startsWith('mod_analytics_') && !canViewDashboardSection(interaction.member, interaction.guild, 'analytics')) return safeReply(interaction, ephemeralError('No permission to view moderation analytics.'));
  if (id.startsWith('mod_analytics_staff_page:')) {
    const [, window, mode = 'overview', moderatorId = 'none', returnTargetId = 'none', page = '0'] = id.split(':');
    return renderDashboard(interaction, 'none', 'analytics', { analyticsWindow: window, analyticsMode: mode, analyticsModeratorId: moderatorId === 'none' ? null : moderatorId, analyticsReturnTargetId: returnTargetId === 'none' ? null : returnTargetId, analyticsStaffPage: Math.max(0, Number(page) || 0) });
  }
  if (id.startsWith('mod_analytics_window:')) { const [, window, mode = 'overview', moderatorId = 'none', returnTargetId = 'none'] = id.split(':'); return renderDashboard(interaction, 'none', 'analytics', { analyticsWindow: window, analyticsMode: mode, analyticsModeratorId: moderatorId === 'none' ? null : moderatorId, analyticsReturnTargetId: returnTargetId === 'none' ? null : returnTargetId }); }
  if (id.startsWith('mod_analytics_overview:')) { const [, window, returnTargetId = 'none'] = id.split(':'); return renderDashboard(interaction, 'none', 'analytics', { analyticsWindow: window, analyticsMode: 'overview', analyticsReturnTargetId: returnTargetId === 'none' ? null : returnTargetId }); }
  if (id.startsWith('mod_analytics_my:')) { const [, window, moderatorId, returnTargetId = 'none'] = id.split(':'); return renderDashboard(interaction, 'none', 'analytics', { analyticsWindow: window, analyticsMode: 'moderator', analyticsModeratorId: moderatorId, analyticsReturnTargetId: returnTargetId === 'none' ? null : returnTargetId }); }
  if (id.startsWith('mod_analytics_refresh:')) { const [, window, mode, moderatorId = 'none', returnTargetId = 'none'] = id.split(':'); return renderDashboard(interaction, 'none', 'analytics', { analyticsWindow: window, analyticsMode: mode, analyticsModeratorId: moderatorId === 'none' ? null : moderatorId, analyticsReturnTargetId: returnTargetId === 'none' ? null : returnTargetId }); }
  if (id.startsWith('mod_dashboard:') || id.startsWith('mod_refresh:')) { const [, targetId = 'none', requested = DEFAULT_VIEW] = id.split(':'); if (normalizeView(requested) === 'intelligence') return false; return renderDashboard(interaction, normalizeView(requested) === 'analytics' ? 'none' : targetId, requested, normalizeView(requested) === 'analytics' ? { ...DEFAULT_ANALYTICS_CONTEXT, analyticsReturnTargetId: targetId === 'none' ? null : targetId } : requested === 'warnings' ? { actionFilter: 'warn' } : {}); }
  if (id.startsWith('mod_filter_cases:') || id.startsWith('mod_case_page:')) { if (!canViewDashboardSection(interaction.member, interaction.guild, 'cases')) return safeReply(interaction, ephemeralError('No permission to view moderation cases.')); const [, targetId = 'none', actionFilter = 'all', statusFilter = 'all', page = '0'] = id.split(':'); return renderDashboard(interaction, targetId, 'cases', { actionFilter, statusFilter, page }); }
  return false;
}
async function handleAnalyticsStaffSelect(interaction) {
  if (!String(interaction.customId || '').startsWith('mod_analytics_staff_select:')) return false;
  if (!canUseModAction(interaction.member, interaction.guild, 'view_analytics')) return safeReply(interaction, ephemeralError('No permission to view moderation analytics.'));
  const [, window, returnTargetId = 'none', page = '0'] = String(interaction.customId).split(':');
  const moderatorId = String(interaction.values?.[0] || '');
  if (!getRecordedModerators(interaction.guild.id).some(([id]) => id === moderatorId)) return safeReply(interaction, ephemeralError('This moderator has no recorded moderation actions.'));
  return renderDashboard(interaction, 'none', 'analytics', { analyticsWindow: window, analyticsMode: 'moderator', analyticsModeratorId: moderatorId, analyticsReturnTargetId: returnTargetId === 'none' ? null : returnTargetId, analyticsStaffPage: Math.max(0, Number(page) || 0) });
}
async function handleUserSelectMenu(interaction) { if (String(interaction.customId || '').startsWith('mod_analytics_moderator_select:')) { if (!canUseModAction(interaction.member, interaction.guild, 'view_analytics')) return safeReply(interaction, ephemeralError('No permission to view moderation analytics.')); const [, window, returnTargetId = 'none'] = String(interaction.customId).split(':'); const moderatorId = interaction.values?.[0]; if (!moderatorId || !getRecordedModerators(interaction.guild.id).some(([id]) => id === String(moderatorId))) return safeReply(interaction, ephemeralError('This moderator has no recorded moderation actions.')); return renderDashboard(interaction, 'none', 'analytics', { analyticsWindow: window, analyticsMode: 'moderator', analyticsModeratorId: moderatorId, analyticsReturnTargetId: returnTargetId === 'none' ? null : returnTargetId }); } if (interaction.customId === 'mod_cases_user_select') { const selected = await fetchTarget(interaction.guild, interaction.values[0]); if (!selected) return safeReply(interaction, ephemeralError('Could not find that member.')); return renderDashboard(interaction, selected.id, 'cases'); } if (interaction.customId !== 'mod_user_select') return false; if (!interaction.values?.length) return renderDashboard(interaction, 'none', 'actions'); const target = await fetchTarget(interaction.guild, interaction.values[0]); if (!target) return safeReply(interaction, ephemeralError('Could not find that member.')); return renderDashboard(interaction, target.id, 'actions'); }
async function openExportModal(interaction, targetId = 'none') {
  if (!canUseModAction(interaction.member, interaction.guild, 'export_cases')) return safeReply(interaction, ephemeralError('No permission to export moderation data.'));
  await interaction.showModal(buildExportModal(targetId));
  return true;
}
async function openModPanel(interaction, options = {}) { if (!canOpenModPanel(interaction)) return interaction.deferred || interaction.replied ? interaction.editReply(noAccessPayload()) : interaction.reply(noAccessPayload()); const view = normalizeView(options.view || DEFAULT_VIEW); const target = options.target || null; const payload = await buildDashboardPayload(Discord, interaction, target, view, options); const finalPayload = { ...payload, flags: 64 }; return interaction.deferred || interaction.replied ? interaction.editReply(finalPayload) : interaction.reply(finalPayload); }

module.exports = {
  openModPanel,
  renderDashboard,
  openExportModal,
  refreshDashboard,
  refreshCasesDashboard,
  handleDashboardNavigation,
  handleUserSelectMenu,
  handleAnalyticsStaffSelect,
  handleExportInteraction,
  getModerationAnalytics,
  getModeratorAnalytics,
};
