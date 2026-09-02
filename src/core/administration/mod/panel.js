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
} = require('./cases');
const { getWarningCountForUser, syncExpiredWarningsToCases } = require('./warns');
const { canUseModAction, getStaffDisplay, hasModPermission, fetchTarget } = require('./permissions');

const DEFAULT_VIEW = 'actions';
const CASES_PER_PAGE = 5;
const VIEW_ALIASES = Object.freeze({ overview: 'actions', member: 'actions' });
const ALLOWED_VIEWS = new Set(['actions', 'intelligence', 'cases', 'analytics']);
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
  if (normalized === 'actions') return canUseModAction(member, guild, 'view_dashboard') || hasAny(member, guild, ['warn', 'timeout', 'remove_timeout', 'kick', 'ban', 'remove_warning']);
  if (normalized === 'intelligence') return hasAny(member, guild, ['scan_run', 'scan_history', 'scan_compare', 'scan_suspects', 'scan_network', 'scan_notes', 'scan_watch', 'scan_links']);
  if (normalized === 'cases') return canUseModAction(member, guild, 'view_cases');
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
  return { totalCases: cases.length, activeCases, activeWarnings, pendingAppeals };
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
  for (let offset = trendDays - 1; offset >= 0; offset -= 1) { const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0); dayStart.setUTCDate(dayStart.getUTCDate() - offset); const start = dayStart.getTime(); const end = start + 86399999; trend.push({ label: dayStart.toISOString().slice(5, 10), count: cases.filter((modCase) => inBounds(getCaseTime(modCase), start, end)).length }); }
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
async function handleExportInteraction(interaction) { const id = String(interaction.customId || ''); if (interaction.isButton?.() && id.startsWith('mod_export_cases:')) { if (!canUseModAction(interaction.member, interaction.guild, 'export_cases')) return safeReply(interaction, ephemeralError('No permission to export moderation data.')); const [, targetId = 'none'] = id.split(':'); await interaction.showModal(buildExportModal(targetId)); return true; } if (interaction.isModalSubmit?.() && id.startsWith('mod_export_submit:')) { if (!canUseModAction(interaction.member, interaction.guild, 'export_cases')) return safeReply(interaction, ephemeralError('No permission to export moderation data.')); const request = parseExportRequest(interaction); if (request.error) return safeReply(interaction, ephemeralError(request.error)); const cases = selectExportCases(interaction.guild.id, request); if (!cases.length) return safeReply(interaction, ephemeralError('No moderation cases matched the export request.')); if (cases.length > MAX_EXPORT_CASES) return safeReply(interaction, ephemeralError(`Export matched ${cases.length} cases. Narrow the scope to ${MAX_EXPORT_CASES} cases or fewer.`)); const records = buildExportRecords(interaction.guild.id, cases, request.include); const generated = makeExportAttachments(interaction.guild.id, request.format, records, request.include, request); if (generated.error) return safeReply(interaction, ephemeralError(generated.error)); return safeReply(interaction, { content: `📤 Export ready • **${records.length}** case${records.length === 1 ? '' : 's'} • **${request.format.toUpperCase()}** • ${generated.attachments.length} attachment${generated.attachments.length === 1 ? '' : 's'}\nGenerated in memory only; no export file was persisted by Goliath.`, files: generated.attachments, flags: 64 }); } return false; }

function buttonRow(buttons) { return buttons.length ? new ActionRowBuilder().addComponents(buttons) : null; }
function buildDashboardNav(targetId, activeView, member, guild, context = {}) {
  const active = normalizeView(activeView);
  const id = targetId || 'none';
  const rows = [];
  const finalButtons = [];
  if (active === 'actions') {
    finalButtons.push(new ButtonBuilder().setCustomId('admin:home').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary));
    if (canUseModAction(member, guild, 'export_cases')) finalButtons.push(new ButtonBuilder().setCustomId(`mod_export_cases:${id}`).setLabel('📤 Export').setStyle(ButtonStyle.Secondary));
    if (canUseModAction(member, guild, 'view_analytics')) finalButtons.push(new ButtonBuilder().setCustomId(`mod_dashboard:${id}:analytics`).setLabel('📊 Analytics').setStyle(ButtonStyle.Secondary));
  } else if (active === 'analytics') {
    const returnId = context.analyticsReturnTargetId || 'none';
    finalButtons.push(new ButtonBuilder().setCustomId(`mod_dashboard:${returnId}:actions`).setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary));
    if (canUseModAction(member, guild, 'export_cases')) finalButtons.push(new ButtonBuilder().setCustomId(`mod_export_cases:${returnId}`).setLabel('📤 Export').setStyle(ButtonStyle.Secondary));
    finalButtons.push(new ButtonBuilder()
      .setCustomId(`mod_analytics_refresh:${context.analyticsWindow || '30d'}:${context.analyticsMode || 'overview'}:${context.analyticsModeratorId || 'none'}:${returnId}`)
      .setLabel('🔄 Refresh')
      .setStyle(ButtonStyle.Secondary));
  } else {
    finalButtons.push(new ButtonBuilder().setCustomId(`mod_dashboard:${id}:actions`).setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary));
    if (canUseModAction(member, guild, 'export_cases')) finalButtons.push(new ButtonBuilder().setCustomId(`mod_export_cases:${id}`).setLabel('📤 Export').setStyle(ButtonStyle.Secondary));
  }
  rows.push(new ActionRowBuilder().addComponents(finalButtons));
  return rows;
}
function buildUserSelectRow() { return new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId('mod_user_select').setPlaceholder('👤 Select a member to investigate or moderate').setMinValues(1).setMaxValues(1)); }
function actionPermissions(member, guild) { return { warn: canUseModAction(member, guild, 'warn'), timeout: canUseModAction(member, guild, 'timeout'), kick: canUseModAction(member, guild, 'kick'), ban: canUseModAction(member, guild, 'ban'), removeWarning: canUseModAction(member, guild, 'remove_warning'), removeTimeout: canUseModAction(member, guild, 'remove_timeout') }; }
function buildActionRows(target, stats, member, guild) {
  const id = target?.id || 'none';
  const p = actionPermissions(member, guild);
  const disabled = !target;
  const row1 = [];
  if (canViewDashboardSection(member, guild, 'intelligence')) row1.push(new ButtonBuilder().setCustomId(`mod_dashboard:${id}:intelligence`).setLabel('🧠 Intelligence').setStyle(ButtonStyle.Secondary).setDisabled(disabled));
  if (canViewDashboardSection(member, guild, 'cases')) row1.push(new ButtonBuilder().setCustomId(`mod_dashboard:${id}:cases`).setLabel('📁 Cases').setStyle(ButtonStyle.Secondary).setDisabled(disabled));
  if (p.timeout) row1.push(createSecondaryButton(`mod_open_timeout:${id}`, 'Timeout', getEmoji('TIMEOUT', '⏳')).setDisabled(disabled));
  if (p.warn) row1.push(createSecondaryButton(`mod_open_warn:${id}`, 'Warn', getEmoji('WARNING', '⚠️')).setDisabled(disabled));
  const row2 = [];
  if (p.kick) row2.push(createDangerButton(`mod_open_kick:${id}`, 'Kick', getEmoji('KICK', '👢')).setDisabled(disabled));
  if (p.ban) row2.push(createDangerButton(`mod_open_ban:${id}`, 'Ban', getEmoji('BAN', '🔨')).setDisabled(disabled));
  if (p.removeTimeout) row2.push(createSecondaryButton(`mod_remove_timeout:${id}`, 'Clear Timeout', getEmoji('SUCCESS', '✅')).setDisabled(disabled || !targetHasActiveTimeout(target)));
  if (p.removeWarning) row2.push(createSecondaryButton(`mod_remove_warning:${id}`, 'Remove Warn', getEmoji('DELETE', '🗑️')).setDisabled(disabled || Number(stats?.warningCount || 0) <= 0));
  return [buttonRow(row1), buttonRow(row2)].filter(Boolean);
}
function buildIntelligenceRows(targetId, member, guild) {
  if (!targetId) return [];
  const id = targetId; const rows = []; const first = [];
  if (canUseModAction(member, guild, 'scan_run')) first.push(createPrimaryButton(`mod_member_scan:${id}`, 'Full Member Scan', '🔎'));
  if (canUseModAction(member, guild, 'scan_history')) first.push(createSecondaryButton(`mod_scan_history:${id}`, 'Scan History', '📜'));
  if (canUseModAction(member, guild, 'scan_compare')) first.push(createSecondaryButton(`mod_scan_compare:${id}`, 'Compare Member', '⚖️'));
  const second = [];
  if (canUseModAction(member, guild, 'scan_links')) second.push(createSecondaryButton(`mod_scan_links:${id}`, 'Link Evidence', '🔗'));
  if (canUseModAction(member, guild, 'scan_notes')) second.push(createSecondaryButton(`mod_scan_note:${id}`, 'Add Note', '📝'));
  if (canUseModAction(member, guild, 'scan_watch')) second.push(createSecondaryButton(`mod_scan_watch:${id}`, 'Watch Status', '👁️'));
  for (const row of [buttonRow(first), buttonRow(second)]) if (row) rows.push(row);
  return rows;
}
function validateDashboardComponents(components, view) {
  if (components.length > 5) throw new Error(`Moderation ${view} workspace produced ${components.length} component rows; Discord allows 5.`);
  for (const row of components) if (Array.isArray(row?.components) && row.components.length > 5) throw new Error(`Moderation ${view} workspace produced a row with ${row.components.length} components; Discord allows 5.`);
  return components;
}

function buildActionsEmbed(interaction, target, stats, staffDisplay) {
  const overall = workspaceStats(interaction.guild.id);
  if (!target) return baseEmbed(interaction.client, COLORS.PRIMARY)
    .setTitle('🛡️ Goliath Moderation')
    .setDescription([
      'Select a member, then choose an action or open their moderation records.',
      '',
      `**Authority:** ${staffDisplay}`,
    ].join('\n'))
    .addFields(
      { name: 'Open Cases', value: `**${overall.activeCases}**`, inline: true },
      { name: 'Active Warnings', value: `**${overall.activeWarnings}**`, inline: true },
      { name: 'Pending Appeals', value: `**${overall.pendingAppeals}**`, inline: true },
    );

  const highestRole = target.roles?.highest && target.roles.highest.id !== interaction.guild.id ? `${target.roles.highest}` : 'No elevated role';
  const timeout = targetHasActiveTimeout(target) ? `Active until ${timestamp(target.communicationDisabledUntilTimestamp, 'f')}` : 'None';
  const embed = baseEmbed(interaction.client, COLORS.PRIMARY)
    .setTitle(`🛡️ Moderation Workspace • ${target.user?.tag || target.user?.username || target.id}`)
    .setDescription([
      `**Active Member:** ${target.user}`,
      `**Authority:** ${staffDisplay}`,
      '',
      'Choose an action below, or open Intelligence and Cases for this member.',
    ].join('\n'))
    .addFields(
      { name: 'Identity', value: `**Discord ID:** \`${target.id}\`\n**Account Created:** ${timestamp(target.user?.createdTimestamp)}\n**Joined Server:** ${timestamp(target.joinedTimestamp)}`, inline: false },
      { name: 'Server Position', value: `**Highest Role:** ${highestRole}\n**Timeout:** ${timeout}`, inline: true },
      { name: 'Moderation', value: `**Warnings:** ${stats?.warningCount ?? 0}\n**Cases:** ${stats?.caseCount ?? 0}`, inline: true },
      { name: 'Latest Case', value: stats?.lastCaseSummary || 'No cases found.', inline: false },
      { name: 'Safety', value: 'Authority, Discord hierarchy, target safety and confirmation requirements are rechecked when an action is submitted.', inline: false },
    );
  const avatar = target.user?.displayAvatarURL?.({ size: 256 });
  if (avatar) embed.setThumbnail(avatar);
  return embed;
}
function buildIntelligenceEmbed(interaction, target, member, guild) { const capabilities = []; if (canUseModAction(member, guild, 'scan_suspects')) capabilities.push('Suspected-account correlation'); if (canUseModAction(member, guild, 'scan_network')) capabilities.push('Goliath network intelligence'); if (canUseModAction(member, guild, 'scan_links')) capabilities.push('Persistent link evidence'); if (canUseModAction(member, guild, 'scan_notes')) capabilities.push('Investigation notes'); if (canUseModAction(member, guild, 'scan_watch')) capabilities.push('Watch status'); return baseEmbed(interaction.client, COLORS.PRIMARY).setTitle('🧠 Member Intelligence').setDescription([target ? `**Active Member:** ${target.user} • \`${target.id}\`` : '**No member selected.**', '', 'Run Goliath Intelligence Scan to assemble the information this viewer is authorized to access.', '', capabilities.length ? `**Available Intelligence:**\n${capabilities.map((value) => `• ${value}`).join('\n')}` : 'Your authority profile provides basic scan access only.', '', 'Correlation results are evidence-led and never presented as confirmed identity unless Goliath has verified evidence.'].join('\n')); }
function buildCasesEmbed(target, cases = [], page = 0, totalPages = 1, actionFilter = 'all', statusFilter = 'all') { const description = cases.length ? cases.map((entry) => `**#${entry.caseId}** • ${String(entry.action || 'unknown').toUpperCase()} • ${getStatusLabel(entry)}\n${entry.reason || 'No reason provided'}\n<t:${Math.floor(getCaseTime(entry) / 1000)}:R>`).join('\n\n') : 'No cases found for this member.'; return createEmbed({ title: target?.user?.tag ? `📁 Cases • ${target.user.tag}` : '📁 Member Cases', description, color: COLORS.PRIMARY, footer: `Action: ${actionFilter} | Status: ${statusFilter} | Page ${page + 1}/${totalPages}` }); }
function buildAnalyticsOverviewEmbed(guild, analytics) {
  const topModerators = analytics.topModerators.length
    ? analytics.topModerators.map(([id, count], index) => `${index + 1}. <@${id}> — **${count}**`).join('\n')
    : 'No moderator activity in this period.';
  const topUsers = analytics.topUsers.length
    ? analytics.topUsers.map(([id, count], index) => `${index + 1}. <@${id}> — **${count}**`).join('\n')
    : 'No moderated members in this period.';
  const trend = analytics.trend.length
    ? analytics.trend.map((entry) => `**${entry.label}** — ${entry.count}`).join('\n')
    : 'No moderation activity in the recent trend window.';
  const appeal = analytics.appealCounts;
  const comparison = analytics.change === null
    ? 'Previous period: no baseline available.'
    : `Previous period: **${analytics.change >= 0 ? '+' : ''}${analytics.change}%** change in cases.`;
  return createEmbed({
    title: `📊 Moderation Analytics • ${analytics.windowLabel}`,
    description: `**Server:** ${guild?.name || 'Server'}\n${comparison}`,
    color: COLORS.PRIMARY,
    fields: [
      { name: '📁 Cases', value: `**${analytics.totalCases} total** • ${analytics.activeCases} active • ${analytics.reversedCases} reversed • ${analytics.expiredCases} expired`, inline: false },
      { name: '⚡ Actions', value: formatActionBreakdown(analytics.actionCounts), inline: false },
      { name: '👥 Members', value: `Unique **${analytics.uniqueUsers}**\nRepeat **${analytics.repeatOffenders}**`, inline: true },
      { name: '↩️ Reversal Rate', value: `**${analytics.reversalRate}**`, inline: true },
      { name: '🧾 Audit Activity', value: `**${analytics.auditActions}** events`, inline: true },
      { name: '⚖️ Appeals', value: `**${appeal.pending} pending** • ${appeal.approved} approved • ${appeal.denied} denied\nApproval rate **${analytics.appealApprovalRate}**`, inline: false },
      { name: '🏆 Top Moderators', value: topModerators.slice(0, 1024), inline: true },
      { name: '👥 Frequent Members', value: topUsers.slice(0, 1024), inline: true },
      { name: '📈 Recent Activity', value: trend.slice(0, 1024), inline: false },
    ],
    footer: `Moderation activity • ${analytics.windowLabel.toLowerCase()} view`,
  });
}
function buildModeratorAnalyticsEmbed(guild, analytics) {
  const appeals = analytics.moderatorAppeals;
  const recentCases = analytics.recentCases.length
    ? analytics.recentCases.map((entry) => `**#${entry.caseId}** • ${String(entry.action || 'unknown').toUpperCase()} • ${entry.status || 'active'} • <@${entry.userId}>`).join('\n')
    : 'No cases in this period.';
  const auditEvents = analytics.topAuditEvents.length
    ? analytics.topAuditEvents.map(([event, count]) => `${String(event).replace(/^case\./, '')}: **${count}**`).join('\n')
    : 'No audited activity.';
  return createEmbed({
    title: `👤 Moderator Analytics • ${analytics.windowLabel}`,
    description: `**Moderator:** <@${analytics.moderatorId}>\n**Server:** ${guild?.name || 'Server'}`,
    color: COLORS.PRIMARY,
    fields: [
      { name: '📁 Case Activity', value: `**${analytics.moderatorCases} cases** • ${analytics.affectedUsers} members • ${analytics.repeatTargets} repeat targets`, inline: false },
      { name: '⚡ Actions', value: formatActionBreakdown(analytics.moderatorActionCounts), inline: false },
      { name: '↩️ Outcomes', value: `Active **${analytics.moderatorStatusCounts.active || 0}** • Reversed **${analytics.moderatorStatusCounts.reversed || 0}** • Expired **${analytics.moderatorStatusCounts.expired || 0}**\nReversal rate **${analytics.moderatorReversalRate}**`, inline: false },
      { name: '⚖️ Appeals', value: `**${appeals.pending} pending** • ${appeals.approved} approved • ${appeals.denied} denied\nApproval rate **${analytics.moderatorAppealApprovalRate}**`, inline: false },
      { name: '🧾 Audit Activity', value: `**${analytics.moderatorAuditActions}** events`, inline: true },
      { name: 'Top Audit Events', value: auditEvents.slice(0, 1024), inline: true },
      { name: 'Recent Cases', value: recentCases.slice(0, 1024), inline: false },
    ],
    footer: `Moderator activity • ${analytics.windowLabel.toLowerCase()} view`,
  });
}
function buildAnalyticsRows(windowKey, mode = 'overview', moderatorId = null, currentUserId = null, returnTargetId = 'none') {
  const window = normalizeAnalyticsWindow(windowKey);
  const returnId = returnTargetId || 'none';
  const viewButtons = [];
  if (mode === 'moderator') {
    viewButtons.push(new ButtonBuilder()
      .setCustomId(`mod_analytics_overview:${window}:${returnId}`)
      .setLabel('📊 Server')
      .setStyle(ButtonStyle.Secondary));
  }
  if (!(mode === 'moderator' && moderatorId && currentUserId && String(moderatorId) === String(currentUserId))) {
    viewButtons.push(new ButtonBuilder()
      .setCustomId(`mod_analytics_my:${window}:${currentUserId || 'none'}:${returnId}`)
      .setLabel('👤 My History')
      .setStyle(ButtonStyle.Secondary));
  }
  viewButtons.push(new ButtonBuilder()
    .setCustomId('mod_case_appeal_queue:0')
    .setLabel('⚖️ Appeal Queue')
    .setStyle(ButtonStyle.Secondary));
  return [
    new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(`mod_analytics_moderator_select:${window}:${returnId}`)
        .setPlaceholder('👤 Select moderator for history')
        .setMinValues(1)
        .setMaxValues(1)
    ),
    new ActionRowBuilder().addComponents(
      Object.keys(ANALYTICS_WINDOWS).map((key) => new ButtonBuilder()
        .setCustomId(`mod_analytics_window:${key}:${mode}:${moderatorId || 'none'}:${returnId}`)
        .setLabel(ANALYTICS_WINDOW_LABELS[key])
        .setStyle(window === key ? ButtonStyle.Primary : ButtonStyle.Secondary))
    ),
    new ActionRowBuilder().addComponents(viewButtons),
  ];
}
function buildTargetStats(guildId, target) { if (!target) return { warningCount: undefined, caseCount: undefined, lastCaseSummary: null }; const cases = getCasesForUser(guildId, target.id) || []; return { warningCount: getWarningCountForUser(guildId, target.id), caseCount: getCaseCountForUser(guildId, target.id), lastCaseSummary: cases[0] ? formatCaseSummary(cases[0]) : null }; }
function getCasesPageData(guildId, targetId, options = {}) { const actionFilter = options.actionFilter || 'all'; const statusFilter = options.statusFilter || 'all'; const filters = {}; if (actionFilter !== 'all') filters.action = actionFilter; if (statusFilter !== 'all') filters.status = statusFilter; const allCases = getFilteredCases(guildId, targetId, filters) || []; const totalPages = Math.max(1, Math.ceil(allCases.length / CASES_PER_PAGE)); const page = Math.max(0, Math.min(Number(options.page) || 0, totalPages - 1)); return { actionFilter, statusFilter, page, totalPages, pageCases: allCases.slice(page * CASES_PER_PAGE, (page + 1) * CASES_PER_PAGE) }; }

async function buildDashboardPayload(discord, interaction, target, view = DEFAULT_VIEW, options = {}) {
  await syncExpiredWarningsToCases(interaction.guild.id);
  const context = normalizeDashboardContext({ ...options, view }); let safeView = context.view;
  if (!canViewDashboardSection(interaction.member, interaction.guild, safeView)) safeView = DEFAULT_VIEW;
  const targetId = target?.id || null; const stats = buildTargetStats(interaction.guild.id, target); const staff = getStaffDisplay(interaction.member, interaction.guild); const staffDisplay = `${staff.badge} ${staff.label} • ${interaction.member}`;
  const embeds = []; const components = safeView === 'analytics' ? [] : [buildUserSelectRow()];
  if (safeView === 'actions') { embeds.push(buildActionsEmbed(interaction, target, stats, staffDisplay)); components.push(...buildActionRows(target, stats, interaction.member, interaction.guild)); }
  else if (safeView === 'intelligence') { embeds.push(buildIntelligenceEmbed(interaction, target, interaction.member, interaction.guild)); components.push(...buildIntelligenceRows(targetId, interaction.member, interaction.guild)); }
  else if (safeView === 'cases') { if (!target) { embeds.push(baseEmbed(interaction.client, COLORS.PRIMARY).setTitle('📁 Member Cases').setDescription('Select a member to open their case workspace.')); } else { const pageData = getCasesPageData(interaction.guild.id, target.id, context); embeds.push(buildCasesEmbed(target, pageData.pageCases, pageData.page, pageData.totalPages, pageData.actionFilter, pageData.statusFilter)); components.push(...buildCasesPageButtons(target.id, pageData.page, pageData.totalPages, pageData.actionFilter, pageData.statusFilter), ...buildCaseFilterButtons(target.id, pageData.actionFilter, pageData.statusFilter, pageData.page)); } }
  else if (safeView === 'analytics') { const window = context.analyticsWindow; if (context.analyticsMode === 'moderator' && context.analyticsModeratorId) embeds.push(buildModeratorAnalyticsEmbed(interaction.guild, getModeratorAnalytics(interaction.guild.id, context.analyticsModeratorId, window))); else embeds.push(buildAnalyticsOverviewEmbed(interaction.guild, getModerationAnalytics(interaction.guild.id, window))); components.push(...buildAnalyticsRows(window, context.analyticsMode, context.analyticsModeratorId, interaction.user?.id || null, context.analyticsReturnTargetId || 'none')); }
  components.push(...buildDashboardNav(targetId, safeView, interaction.member, interaction.guild, context));
  return { embeds, components: validateDashboardComponents(components, safeView) };
}
async function renderDashboard(interaction, targetId, view = DEFAULT_VIEW, context = {}) { const requestedView = normalizeView(view); if (!canViewDashboardSection(interaction.member, interaction.guild, requestedView)) return safeReply(interaction, ephemeralError('That moderation workspace is not available to your authority profile.')); const target = targetId && targetId !== 'none' ? await fetchTarget(interaction.guild, targetId) : null; if (targetId && targetId !== 'none' && !target) return safeReply(interaction, ephemeralError('Could not find the selected member.')); await interaction.update(await buildDashboardPayload(Discord, interaction, target, requestedView, context)); return true; }
async function refreshDashboard(discord, interaction, target, context = {}) { const safeContext = normalizeDashboardContext(context); const payload = await buildDashboardPayload(discord, interaction, target, safeContext.view, safeContext); try { if (interaction.message) { await interaction.message.edit(payload); return true; } if (interaction.replied || interaction.deferred) { await interaction.editReply(payload); return true; } await interaction.reply({ ...payload, flags: 64 }); return true; } catch (error) { console.error('❌ Failed to refresh moderation dashboard message:', error); return false; } }
async function refreshCasesDashboard(interaction, target) {
  if (!target) return false;
  const id = String(interaction?.customId || '');
  const returnsToActions = id.startsWith('mod_submit_warn:') || id.startsWith('mod_submit_timeout:');
  return refreshDashboard(Discord, interaction, target, returnsToActions ? DEFAULT_ACTIONS_CONTEXT : DEFAULT_CASES_CONTEXT);
}
async function handleDashboardNavigation(interaction) {
  const id = String(interaction.customId || '');
  if (id === 'mod:overview') return renderDashboard(interaction, 'none', 'actions');
  if (id.startsWith('mod_analytics_') && !canViewDashboardSection(interaction.member, interaction.guild, 'analytics')) return safeReply(interaction, ephemeralError('No permission to view moderation analytics.'));
  if (id.startsWith('mod_analytics_window:')) { const [, window, mode = 'overview', moderatorId = 'none', returnTargetId = 'none'] = id.split(':'); return renderDashboard(interaction, 'none', 'analytics', { analyticsWindow: window, analyticsMode: mode, analyticsModeratorId: moderatorId === 'none' ? null : moderatorId, analyticsReturnTargetId: returnTargetId === 'none' ? null : returnTargetId }); }
  if (id.startsWith('mod_analytics_overview:')) { const [, window, returnTargetId = 'none'] = id.split(':'); return renderDashboard(interaction, 'none', 'analytics', { analyticsWindow: window, analyticsMode: 'overview', analyticsReturnTargetId: returnTargetId === 'none' ? null : returnTargetId }); }
  if (id.startsWith('mod_analytics_my:')) { const [, window, moderatorId, returnTargetId = 'none'] = id.split(':'); return renderDashboard(interaction, 'none', 'analytics', { analyticsWindow: window, analyticsMode: 'moderator', analyticsModeratorId: moderatorId, analyticsReturnTargetId: returnTargetId === 'none' ? null : returnTargetId }); }
  if (id.startsWith('mod_analytics_refresh:')) { const [, window, mode, moderatorId = 'none', returnTargetId = 'none'] = id.split(':'); return renderDashboard(interaction, 'none', 'analytics', { analyticsWindow: window, analyticsMode: mode, analyticsModeratorId: moderatorId === 'none' ? null : moderatorId, analyticsReturnTargetId: returnTargetId === 'none' ? null : returnTargetId }); }
  if (id.startsWith('mod_dashboard:') || id.startsWith('mod_refresh:')) { const [, targetId = 'none', requested = DEFAULT_VIEW] = id.split(':'); return renderDashboard(interaction, normalizeView(requested) === 'analytics' ? 'none' : targetId, requested, normalizeView(requested) === 'analytics' ? { ...DEFAULT_ANALYTICS_CONTEXT, analyticsReturnTargetId: targetId === 'none' ? null : targetId } : {}); }
  if (id.startsWith('mod_filter_cases:') || id.startsWith('mod_case_page:')) { if (!canViewDashboardSection(interaction.member, interaction.guild, 'cases')) return safeReply(interaction, ephemeralError('No permission to view moderation cases.')); const [, targetId = 'none', actionFilter = 'all', statusFilter = 'all', page = '0'] = id.split(':'); return renderDashboard(interaction, targetId, 'cases', { actionFilter, statusFilter, page }); }
  return false;
}
async function handleUserSelectMenu(interaction) { if (String(interaction.customId || '').startsWith('mod_analytics_moderator_select:')) { if (!canUseModAction(interaction.member, interaction.guild, 'view_analytics')) return safeReply(interaction, ephemeralError('No permission to view moderation analytics.')); const [, window, returnTargetId = 'none'] = String(interaction.customId).split(':'); const moderatorId = interaction.values?.[0]; if (!moderatorId) return safeReply(interaction, ephemeralError('No moderator selected.')); return renderDashboard(interaction, 'none', 'analytics', { analyticsWindow: window, analyticsMode: 'moderator', analyticsModeratorId: moderatorId, analyticsReturnTargetId: returnTargetId === 'none' ? null : returnTargetId }); } if (interaction.customId !== 'mod_user_select') return false; const target = await fetchTarget(interaction.guild, interaction.values[0]); if (!target) return safeReply(interaction, ephemeralError('Could not find that member.')); return renderDashboard(interaction, target.id, 'actions'); }
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
  handleExportInteraction,
  getModerationAnalytics,
  getModeratorAnalytics,
};
