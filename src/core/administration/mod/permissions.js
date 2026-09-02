const { PermissionFlagsBits } = require('discord.js');
const security = require('../../security/protection/core');
const { safeReply, ephemeralError } = require('../../../core/ui/interactionResponse');

const STAFF_LEVELS = { NONE: 'none', HELPER: 'helper', JUNIOR_MOD: 'junior_mod', MOD: 'mod', ADMIN: 'admin', OWNER: 'owner' };
const STAFF_LEVEL_RANKS = { [STAFF_LEVELS.NONE]: 0, [STAFF_LEVELS.HELPER]: 1, [STAFF_LEVELS.JUNIOR_MOD]: 2, [STAFF_LEVELS.MOD]: 3, [STAFF_LEVELS.ADMIN]: 4, [STAFF_LEVELS.OWNER]: 5 };
const STAFF_LEVEL_LABELS = { [STAFF_LEVELS.NONE]: 'No Access', [STAFF_LEVELS.HELPER]: 'Helper', [STAFF_LEVELS.JUNIOR_MOD]: 'Junior Mod', [STAFF_LEVELS.MOD]: 'Moderator', [STAFF_LEVELS.ADMIN]: 'Admin', [STAFF_LEVELS.OWNER]: 'Owner' };
const STAFF_BADGES = { [STAFF_LEVELS.NONE]: '🚫', [STAFF_LEVELS.HELPER]: '🪪', [STAFF_LEVELS.JUNIOR_MOD]: '🗝️', [STAFF_LEVELS.MOD]: '🔐', [STAFF_LEVELS.ADMIN]: '🔏', [STAFF_LEVELS.OWNER]: '👑' };

const ACTION_REQUIREMENTS = {
  view_dashboard: STAFF_LEVELS.JUNIOR_MOD,
  view_cases: STAFF_LEVELS.JUNIOR_MOD,
  view_case_detail: STAFF_LEVELS.JUNIOR_MOD,
  search_cases: STAFF_LEVELS.JUNIOR_MOD,
  view_analytics: STAFF_LEVELS.JUNIOR_MOD,
  view_appeals: STAFF_LEVELS.MOD,
  decide_appeals: STAFF_LEVELS.ADMIN,
  manage_evidence: STAFF_LEVELS.ADMIN,
  scan_run: STAFF_LEVELS.JUNIOR_MOD,
  scan_history: STAFF_LEVELS.JUNIOR_MOD,
  scan_compare: STAFF_LEVELS.JUNIOR_MOD,
  scan_suspects: STAFF_LEVELS.MOD,
  scan_network: STAFF_LEVELS.MOD,
  scan_notes: STAFF_LEVELS.MOD,
  scan_watch: STAFF_LEVELS.MOD,
  scan_links: STAFF_LEVELS.ADMIN,
  warn: STAFF_LEVELS.JUNIOR_MOD,
  add_case_note: STAFF_LEVELS.JUNIOR_MOD,
  timeout: STAFF_LEVELS.JUNIOR_MOD,
  remove_timeout: STAFF_LEVELS.JUNIOR_MOD,
  kick: STAFF_LEVELS.MOD,
  ban: STAFF_LEVELS.ADMIN,
  remove_warning: STAFF_LEVELS.ADMIN,
  edit_case: STAFF_LEVELS.ADMIN,
  export_cases: STAFF_LEVELS.ADMIN,
  bulk_warn: STAFF_LEVELS.ADMIN,
  bulk_timeout: STAFF_LEVELS.ADMIN,
  bulk_remove_timeout: STAFF_LEVELS.ADMIN,
  bulk_remove_warning: STAFF_LEVELS.ADMIN,
  bulk_kick: STAFF_LEVELS.ADMIN,
  bulk_ban: STAFF_LEVELS.OWNER,
};

const ACTION_DISCORD_PERMISSIONS = {
  timeout: PermissionFlagsBits.ModerateMembers,
  remove_timeout: PermissionFlagsBits.ModerateMembers,
  kick: PermissionFlagsBits.KickMembers,
  ban: PermissionFlagsBits.BanMembers,
  bulk_timeout: PermissionFlagsBits.ModerateMembers,
  bulk_remove_timeout: PermissionFlagsBits.ModerateMembers,
  bulk_kick: PermissionFlagsBits.KickMembers,
  bulk_ban: PermissionFlagsBits.BanMembers,
};

const ACTION_AUTHORITY_PERMISSIONS = Object.freeze({
  view_dashboard: { key: 'mod.panel.view' },
  view_cases: { key: 'mod.cases.view' },
  view_case_detail: { key: 'mod.cases.view' },
  search_cases: { key: 'mod.cases.search', fallback: 'mod.cases.view' },
  view_analytics: { key: 'mod.analytics.view', fallback: 'mod.cases.view' },
  view_appeals: { key: 'mod.appeals.view', fallback: 'mod.cases.view' },
  decide_appeals: { key: 'mod.appeals.decide', fallback: 'mod.cases.manage' },
  manage_evidence: { key: 'mod.evidence.manage', fallback: 'mod.cases.manage' },
  warn: { key: 'mod.warn' },
  timeout: { key: 'mod.timeout' },
  remove_timeout: { key: 'mod.timeout.remove' },
  kick: { key: 'mod.kick' },
  ban: { key: 'mod.ban' },
  remove_warning: { key: 'mod.cases.manage' },
  add_case_note: { key: 'mod.cases.manage' },
  edit_case: { key: 'mod.cases.manage' },
  export_cases: { key: 'mod.cases.export', fallback: 'mod.cases.view' },
  bulk_warn: { key: 'mod.bulk' },
  bulk_timeout: { key: 'mod.bulk' },
  bulk_remove_timeout: { key: 'mod.bulk' },
  bulk_remove_warning: { key: 'mod.bulk' },
  bulk_kick: { key: 'mod.bulk' },
  bulk_ban: { key: 'mod.bulk' },
  scan_run: { key: 'mod.scan.run', fallback: 'mod.cases.view' },
  scan_history: { key: 'mod.scan.history', fallback: 'mod.cases.view' },
  scan_compare: { key: 'mod.scan.compare', fallback: 'mod.cases.view' },
  scan_suspects: { key: 'mod.scan.suspectedAccounts', fallback: 'mod.analytics.view' },
  scan_network: { key: 'mod.scan.network', fallback: 'mod.analytics.view' },
  scan_notes: { key: 'mod.scan.notes', fallback: 'mod.cases.manage' },
  scan_watch: { key: 'mod.scan.watch', fallback: 'mod.cases.manage' },
  scan_links: { key: 'mod.scan.links', fallback: 'mod.evidence.manage' },
});

const DOCTOR_INDEXES = Object.freeze([
  'CREATE INDEX IF NOT EXISTS idx_cases_guild_moderator ON cases(guild_id, moderator_id, case_id DESC)',
  'CREATE INDEX IF NOT EXISTS idx_cases_guild_action_status ON cases(guild_id, action, status, case_id DESC)',
  'CREATE INDEX IF NOT EXISTS idx_cases_guild_created ON cases(guild_id, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_warnings_guild_expires ON warnings(guild_id, expires_at)',
  'CREATE INDEX IF NOT EXISTS idx_pending_expires ON pending_actions(expires_at)',
  'CREATE INDEX IF NOT EXISTS idx_audit_guild_event_created ON case_audit(guild_id, event, created_at DESC)',
]);
let doctorResult = null;
let doctorScheduled = false;

function getModerationDb() {
  try { return require('./storage').db || null; }
  catch (error) { console.error('❌ Moderation DB unavailable:', error); return null; }
}
function safeJson(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value.slice(0, 4000);
  try { return JSON.stringify(value).slice(0, 4000); }
  catch { return String(value).slice(0, 4000); }
}
function recordModerationSystemEvent({ interaction = null, guildId = null, actorId = null, event, action = null, targetId = null, reason = null, before = null, after = null, metadata = {} } = {}) {
  if (!event) return null;
  const db = getModerationDb();
  if (!db) return null;
  const resolvedGuildId = String(guildId || interaction?.guild?.id || 'system');
  const resolvedActorId = actorId || interaction?.user?.id || null;
  const detail = { action, targetId: targetId ? String(targetId) : null, reason: reason ? String(reason).slice(0, 500) : null, customId: interaction?.customId ? String(interaction.customId).slice(0, 120) : null, ...metadata };
  try {
    const createdAt = new Date().toISOString();
    const result = db.prepare('INSERT INTO case_audit (guild_id, case_id, actor_id, event, before_value, after_value, metadata, created_at) VALUES (?, 0, ?, ?, ?, ?, ?, ?)').run(
      resolvedGuildId,
      resolvedActorId ? String(resolvedActorId) : null,
      String(event).slice(0, 120),
      safeJson(before),
      safeJson(after),
      JSON.stringify(detail),
      createdAt
    );
    return { auditId: Number(result.lastInsertRowid), guildId: resolvedGuildId, caseId: 0, actorId: resolvedActorId, event, createdAt };
  } catch (error) {
    console.error(`❌ Failed to record moderation system event ${event}:`, error);
    return null;
  }
}
function runModerationDoctor({ record = true } = {}) {
  const db = getModerationDb();
  if (!db) return { ok: false, checkedAt: new Date().toISOString(), errors: ['moderation database unavailable'], warnings: [] };
  const checkedAt = new Date().toISOString();
  const checks = {};
  const errors = [];
  const warnings = [];
  try {
    for (const sql of DOCTOR_INDEXES) db.exec(sql);
    checks.integrity = String(db.pragma('quick_check', { simple: true }) || 'unknown');
    if (checks.integrity !== 'ok') errors.push(`SQLite quick_check: ${checks.integrity}`);
    const requiredTables = ['cases', 'warnings', 'pending_actions', 'case_audit'];
    const present = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
    checks.tables = requiredTables.filter((name) => present.has(name));
    for (const table of requiredTables) if (!present.has(table)) errors.push(`Missing table: ${table}`);
    const expired = db.prepare('DELETE FROM pending_actions WHERE expires_at <= ?').run(checkedAt).changes;
    checks.expiredPendingPurged = expired;
    checks.pendingActions = db.prepare('SELECT COUNT(*) AS count FROM pending_actions').get().count;
    checks.orphanWarnings = db.prepare('SELECT COUNT(*) AS count FROM warnings w LEFT JOIN cases c ON c.guild_id = w.guild_id AND c.case_id = w.case_id WHERE c.case_id IS NULL').get().count;
    checks.activeWarningCasesMissingStrike = db.prepare("SELECT COUNT(*) AS count FROM cases c LEFT JOIN warnings w ON w.guild_id = c.guild_id AND w.case_id = c.case_id WHERE c.action = 'warn' AND c.status = 'active' AND w.id IS NULL").get().count;
    checks.warningRowsOnNonWarningCases = db.prepare("SELECT COUNT(*) AS count FROM warnings w JOIN cases c ON c.guild_id = w.guild_id AND w.case_id = c.case_id WHERE c.action <> 'warn'").get().count;
    checks.invalidStatuses = db.prepare("SELECT COUNT(*) AS count FROM cases WHERE status NOT IN ('active','reversed','expired') OR status IS NULL").get().count;
    checks.systemAuditRows = db.prepare('SELECT COUNT(*) AS count FROM case_audit WHERE case_id = 0').get().count;
    checks.indexCount = db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('cases','warnings','pending_actions','case_audit')").get().count;
    if (checks.orphanWarnings) warnings.push(`${checks.orphanWarnings} warning record(s) reference missing cases`);
    if (checks.activeWarningCasesMissingStrike) warnings.push(`${checks.activeWarningCasesMissingStrike} active warning case(s) have no strike row`);
    if (checks.warningRowsOnNonWarningCases) warnings.push(`${checks.warningRowsOnNonWarningCases} warning row(s) reference non-warning cases`);
    if (checks.invalidStatuses) warnings.push(`${checks.invalidStatuses} case(s) use unexpected status values`);
  } catch (error) {
    errors.push(String(error?.message || error));
  }
  doctorResult = { ok: errors.length === 0, checkedAt, checks, warnings, errors };
  if (record) recordModerationSystemEvent({ guildId: 'system', actorId: null, event: doctorResult.ok ? 'moderation.doctor.passed' : 'moderation.doctor.failed', after: doctorResult, metadata: { source: 'startup' } });
  return doctorResult;
}
function getModerationDoctorStatus() { return doctorResult || runModerationDoctor({ record: false }); }
function scheduleModerationDoctor() {
  if (doctorScheduled) return;
  doctorScheduled = true;
  setImmediate(() => {
    try { runModerationDoctor({ record: true }); }
    catch (error) { console.error('❌ Moderation doctor failed:', error); }
  });
}
scheduleModerationDoctor();

function getId(memberOrUserId) { return typeof memberOrUserId === 'string' ? memberOrUserId : memberOrUserId?.id; }
function isGuildOwner(memberOrUserId, guildOwnerId) { const id = getId(memberOrUserId); return Boolean(id && guildOwnerId && String(id) === String(guildOwnerId)); }
function hasPermission(member, permission) { return Boolean(member?.permissions?.has(permission)); }
function legacyHasModPermission(member) { return security.isBotOwner(getId(member)) || hasPermission(member, PermissionFlagsBits.ModerateMembers) || hasPermission(member, PermissionFlagsBits.KickMembers) || hasPermission(member, PermissionFlagsBits.BanMembers) || hasPermission(member, PermissionFlagsBits.Administrator); }
function buildAuthorityInteraction(member, guild, interaction = null) {
  if (interaction) return interaction;
  return { guild, member, user: member?.user || (member?.id ? { id: member.id } : null), customId: null };
}
function getAuthorityPanel() {
  try { return require('../admin/panel'); }
  catch (error) { console.error('❌ Goliath authority resolver unavailable:', error); return null; }
}
function resolveActionFromInteraction(action, interaction) {
  if (action !== 'view_case_detail') return action;
  const id = String(interaction?.customId || '');
  if (id === 'mod_select_user' || id === 'mod_member_scan' || id.startsWith('mod_member_scan:') || id === 'mod_scan_user_select') return 'scan_run';
  if (id.startsWith('mod_scan_history:')) return 'scan_history';
  if (id.startsWith('mod_scan_compare:') || id.startsWith('mod_scan_compare_select:')) return 'scan_compare';
  if (id.startsWith('mod_scan_note:') || id.startsWith('mod_scan_note_submit:')) return 'scan_notes';
  if (id.startsWith('mod_scan_watch:')) return 'scan_watch';
  if (id.startsWith('mod_scan_links:')) return 'scan_links';
  return action;
}
function resolveAuthorityPermission(member, guild, action, interaction = null) {
  if (!member || !guild) return null;
  const panel = getAuthorityPanel();
  if (!panel?.getAuthorityContext || !panel?.hasGuildPermission) return null;
  const authorityInteraction = buildAuthorityInteraction(member, guild, interaction);
  const context = panel.getAuthorityContext(authorityInteraction);
  if (!context || context.source === 'legacy' || context.source === 'none') return null;
  const resolvedAction = resolveActionFromInteraction(action, authorityInteraction);
  const mapping = ACTION_AUTHORITY_PERMISSIONS[resolvedAction];
  if (!mapping) return null;
  const catalog = Array.isArray(panel.GUILD_PERMISSION_CATALOG) ? panel.GUILD_PERMISSION_CATALOG : [];
  const primaryExists = catalog.some((entry) => entry?.key === mapping.key);
  const permissionKey = primaryExists ? mapping.key : mapping.fallback || mapping.key;
  return {
    handled: true,
    allowed: panel.hasGuildPermission(authorityInteraction, permissionKey),
    permissionKey,
    action: resolvedAction,
    source: context.source,
  };
}
function hasModPermission(member, guild = member?.guild) {
  if (security.isBotOwner(getId(member))) return true;
  if (guild) {
    const authority = resolveAuthorityPermission(member, guild, 'view_dashboard');
    if (authority?.handled) return authority.allowed;
  }
  return legacyHasModPermission(member);
}
function getStaffLevel(member, guild) {
  if (!member || !guild) return STAFF_LEVELS.NONE;
  if (security.isBotOwner(getId(member)) || isGuildOwner(member, guild.ownerId)) return STAFF_LEVELS.OWNER;
  if (hasPermission(member, PermissionFlagsBits.Administrator) || hasPermission(member, PermissionFlagsBits.BanMembers)) return STAFF_LEVELS.ADMIN;
  if (hasPermission(member, PermissionFlagsBits.KickMembers)) return STAFF_LEVELS.MOD;
  if (hasPermission(member, PermissionFlagsBits.ModerateMembers)) return STAFF_LEVELS.JUNIOR_MOD;
  return STAFF_LEVELS.NONE;
}
function getStaffLevelRank(level) { return STAFF_LEVEL_RANKS[level] ?? STAFF_LEVEL_RANKS[STAFF_LEVELS.NONE]; }
function getRequiredStaffLevel(action) { return ACTION_REQUIREMENTS[action] || STAFF_LEVELS.OWNER; }
function getStaffLevelLabel(level) { return STAFF_LEVEL_LABELS[level] || 'Unknown'; }
function getStaffBadge(level) { return STAFF_BADGES[level] || '❔'; }
function getStaffDisplay(member, guild) {
  if (!member || !guild) return { level: STAFF_LEVELS.NONE, label: STAFF_LEVEL_LABELS[STAFF_LEVELS.NONE], badge: STAFF_BADGES[STAFF_LEVELS.NONE] };
  if (security.isBotOwner(getId(member))) return { level: STAFF_LEVELS.OWNER, label: 'Goliath Owner', badge: '👑' };
  if (isGuildOwner(member, guild.ownerId)) return { level: STAFF_LEVELS.OWNER, label: 'Guild Owner', badge: '🏆' };
  const level = getStaffLevel(member, guild);
  return { level, label: getStaffLevelLabel(level), badge: getStaffBadge(level) };
}
function hasNativeActionPermission(member, guild, action) {
  if (!member || !guild) return false;
  if (security.isBotOwner(getId(member)) || isGuildOwner(member, guild.ownerId)) return true;
  const requiredPermission = ACTION_DISCORD_PERMISSIONS[action];
  return !requiredPermission || hasPermission(member, requiredPermission);
}
function canUseModAction(member, guild, action, interaction = null) {
  const authority = resolveAuthorityPermission(member, guild, action, interaction);
  if (authority?.handled) return authority.allowed;
  const staffLevel = getStaffLevel(member, guild);
  const requiredLevel = getRequiredStaffLevel(action);
  return getStaffLevelRank(staffLevel) >= getStaffLevelRank(requiredLevel) && hasNativeActionPermission(member, guild, action);
}
function getModActionDeniedMessage(action) { return `❌ You do not have permission to use this action. Required level: ${getStaffLevelLabel(getRequiredStaffLevel(action))}.`; }
function getHighestRolePosition(member) { return member?.roles?.highest?.position ?? 0; }
function canActOnTarget(actorMember, targetMember, guildOwnerId) {
  if (!actorMember || !targetMember || isGuildOwner(targetMember, guildOwnerId) || actorMember.id === targetMember.id) return false;
  if (security.isBotOwner(getId(actorMember)) || isGuildOwner(actorMember, guildOwnerId)) return true;
  return getHighestRolePosition(actorMember) > getHighestRolePosition(targetMember);
}
function canBotActOnTarget(botMember, targetMember) { return Boolean(botMember && targetMember && getHighestRolePosition(botMember) > getHighestRolePosition(targetMember)); }
function getHierarchySummary(actorMember, botMember, targetMember, guildOwnerId) {
  if (!targetMember) return { ok: false, actorCanAct: false, botCanAct: false, reason: '❌ Target not found.' };
  if (isGuildOwner(targetMember, guildOwnerId)) return { ok: false, actorCanAct: false, botCanAct: false, reason: '❌ Cannot moderate the server owner.' };
  if (actorMember?.id === targetMember.id) return { ok: false, actorCanAct: false, botCanAct: false, reason: '❌ You cannot moderate yourself.' };
  const actorCanAct = canActOnTarget(actorMember, targetMember, guildOwnerId);
  const botCanAct = canBotActOnTarget(botMember, targetMember);
  if (!actorCanAct) return { ok: false, actorCanAct, botCanAct, reason: '❌ You cannot act on this target due to role hierarchy.' };
  if (!botCanAct) return { ok: false, actorCanAct, botCanAct, reason: '❌ Bot cannot act on this target due to role hierarchy.' };
  return { ok: true, actorCanAct, botCanAct, reason: null };
}
function checkHierarchy(interaction, target) {
  if (!interaction?.guild || !interaction?.member) return '❌ Invalid interaction context.';
  const summary = getHierarchySummary(interaction.member, interaction.guild.members.me, target, interaction.guild.ownerId);
  return summary.ok ? null : summary.reason;
}
function checkHierarchyForBulk(actorMember, botMember, guildOwnerId, targetMember, actorUserId) {
  if (!targetMember) return 'User not found.';
  if (targetMember.id === actorUserId) return 'Cannot target yourself.';
  const summary = getHierarchySummary(actorMember, botMember, targetMember, guildOwnerId);
  return summary.ok ? null : String(summary.reason || 'Hierarchy check failed.').replace(/^❌\s*/, '');
}
async function fetchTarget(guild, userId) {
  const id = String(userId || '').trim();
  if (!guild || !/^\d{16,20}$/.test(id)) return null;
  return guild.members.fetch(id).catch(() => guild.members.cache.get(id) || null);
}
function ensurePanelAccess(interaction) {
  if (canUseModAction(interaction?.member, interaction?.guild, 'view_dashboard', interaction)) return null;
  recordModerationSystemEvent({ interaction, event: 'moderation.access.denied', action: 'view_dashboard', reason: 'No moderation panel permission.' });
  return safeReply(interaction, ephemeralError('No permission to use moderation panel.'));
}
async function ensureActionAccess(interaction, action, deniedMessage = null) {
  if (canUseModAction(interaction?.member, interaction?.guild, action, interaction)) return true;
  const resolvedAction = resolveActionFromInteraction(action, interaction);
  const authority = resolveAuthorityPermission(interaction?.member, interaction?.guild, action, interaction);
  recordModerationSystemEvent({ interaction, event: 'moderation.action.denied', action: resolvedAction, reason: deniedMessage || getModActionDeniedMessage(action), metadata: { requiredLevel: getRequiredStaffLevel(action), staffLevel: getStaffLevel(interaction?.member, interaction?.guild), authorityPermission: authority?.permissionKey || null, authoritySource: authority?.source || 'legacy' } });
  await safeReply(interaction, { content: deniedMessage || getModActionDeniedMessage(action), flags: 64 });
  return false;
}
async function requireSelectedTarget(interaction, targetId) {
  if (!targetId || targetId === 'none') {
    recordModerationSystemEvent({ interaction, event: 'moderation.target.invalid', targetId, reason: 'No user selected.' });
    await safeReply(interaction, ephemeralError('No user selected.'));
    return null;
  }
  const target = await fetchTarget(interaction?.guild, targetId);
  if (!target) {
    recordModerationSystemEvent({ interaction, event: 'moderation.target.not_found', targetId, reason: 'Could not find target member.' });
    await safeReply(interaction, ephemeralError('Could not find that user.'));
    return null;
  }
  return target;
}
async function requireModeratableTarget(interaction, targetId, action) {
  const allowed = await ensureActionAccess(interaction, action);
  if (!allowed) return null;
  const target = await requireSelectedTarget(interaction, targetId);
  if (!target) return null;
  const hierarchyError = checkHierarchy(interaction, target);
  if (hierarchyError) {
    recordModerationSystemEvent({ interaction, event: 'moderation.hierarchy.denied', action, targetId: target.id, reason: String(hierarchyError).replace(/^❌\s*/, '') });
    await safeReply(interaction, ephemeralError(String(hierarchyError).replace(/^❌\s*/, '')));
    return null;
  }
  return target;
}

module.exports = {
  ACTION_AUTHORITY_PERMISSIONS,
  hasModPermission,
  getStaffDisplay,
  canUseModAction,
  getModActionDeniedMessage,
  resolveAuthorityPermission,
  checkHierarchy,
  checkHierarchyForBulk,
  fetchTarget,
  ensurePanelAccess,
  ensureActionAccess,
  requireModeratableTarget,
  recordModerationSystemEvent,
  runModerationDoctor,
  getModerationDoctorStatus,
};
