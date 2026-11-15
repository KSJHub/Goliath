'use strict';
const { EMOJIS } = require('../../../core/guild/goliathNavigation');

const { EmbedBuilder } = require('discord.js');
const { db } = require('./storage');
const intelligence = require('./intelligence');
const { recordModerationSystemEvent } = require('./permissions');

const DECISIONS = Object.freeze({
  clear: { label: 'CLEAR', emoji: EMOJIS.ACTIVE, rank: 0, color: 0x57F287 },
  review: { label: 'REVIEW', emoji: EMOJIS.SEVERITY_HIGH, rank: 1, color: 0xF0A202 },
  high: { label: 'HIGH ATTENTION', emoji: EMOJIS.OWNER_RED, rank: 2, color: 0xED4245 },
});

function now() { return new Date().toISOString(); }
function json(value, fallback = {}) { if (value && typeof value === 'object') return value; try { return JSON.parse(value || '') || fallback; } catch { return fallback; } }

function ensureSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS member_intelligence_decisions (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      decision TEXT NOT NULL DEFAULT 'clear',
      risk_score INTEGER NOT NULL DEFAULT 0,
      watch_state TEXT NOT NULL DEFAULT 'clear',
      network_cases INTEGER NOT NULL DEFAULT 0,
      network_bans INTEGER NOT NULL DEFAULT 0,
      external_records INTEGER NOT NULL DEFAULT 0,
      suspect_score INTEGER NOT NULL DEFAULT 0,
      reasons_json TEXT,
      trigger TEXT,
      scan_id TEXT,
      reviewed_by TEXT,
      reviewed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_member_intel_decision_status ON member_intelligence_decisions(guild_id, decision, updated_at DESC);
  `);
}
ensureSchema();

function normalizeDecision(value) { return DECISIONS[value] ? value : 'clear'; }
function externalCount(context = {}) {
  const rep = context.reputation || {};
  return Number(rep.verifiedExternal || 0) + Number(rep.submitted || 0) + Number(rep.unverified || 0);
}

function classify(context = {}, suspects = []) {
  const riskScore = Math.max(0, Math.min(100, Number(context.risk?.score || 0)));
  const watchState = String(context.watch?.state || 'clear').toLowerCase();
  const suspectScore = suspects.reduce((max, entry) => Math.max(max, Number(entry?.score || 0)), 0);
  const reasons = [];
  let decision = 'clear';

  if (riskScore >= 20) { decision = 'review'; reasons.push(`risk score ${riskScore}/100`); }
  if (suspectScore >= 35) { decision = 'review'; reasons.push(`account correlation ${suspectScore}%`); }
  if (watchState === 'watchlisted') { decision = 'review'; reasons.push('member is watchlisted'); }
  if (Number(context.network?.caseCount || 0) > 0) { decision = 'review'; reasons.push('cross-guild moderation history'); }

  if (riskScore >= 70) { decision = 'high'; reasons.push('high verified risk score'); }
  if (suspectScore >= 70) { decision = 'high'; reasons.push('strong historical/account correlation'); }
  if (watchState === 'restricted' || watchState === 'blacklisted') { decision = 'high'; reasons.push(`watch state ${watchState}`); }
  if (Number(context.network?.banCount || 0) > 0 && riskScore >= 40) { decision = 'high'; reasons.push('cross-guild ban history with elevated risk'); }

  const currentGuild = (context.guildHistory || []).find((entry) => String(entry.guildId || '') === String(context.guild?.id || ''));
  const joins = Number(currentGuild?.joinCount || 0);
  if (joins >= 3 && decision === 'clear') { decision = 'review'; reasons.push(`${joins} recorded joins/rejoins`); }
  if (joins >= 5 && riskScore >= 40) { decision = 'high'; reasons.push('repeated rejoins with elevated risk'); }

  return {
    decision,
    riskScore,
    watchState,
    suspectScore,
    networkCases: Number(context.network?.caseCount || 0),
    networkBans: Number(context.network?.banCount || 0),
    externalRecords: externalCount(context),
    reasons: [...new Set(reasons)],
  };
}

function mapRow(row) {
  if (!row) return null;
  return {
    guildId: row.guild_id,
    userId: row.user_id,
    decision: normalizeDecision(row.decision),
    riskScore: Number(row.risk_score || 0),
    watchState: row.watch_state || 'clear',
    networkCases: Number(row.network_cases || 0),
    networkBans: Number(row.network_bans || 0),
    externalRecords: Number(row.external_records || 0),
    suspectScore: Number(row.suspect_score || 0),
    reasons: json(row.reasons_json, []),
    trigger: row.trigger || null,
    scanId: row.scan_id || null,
    reviewedBy: row.reviewed_by || null,
    reviewedAt: row.reviewed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getDecision(guildId, userId) {
  return mapRow(db.prepare('SELECT * FROM member_intelligence_decisions WHERE guild_id = ? AND user_id = ?').get(String(guildId), String(userId)));
}

function saveDecision(guildId, userId, assessment, { trigger = 'scan', scanId = null, reviewedBy = null, reviewedAt = null } = {}) {
  const stamp = now();
  const existing = getDecision(guildId, userId);
  db.prepare(`
    INSERT INTO member_intelligence_decisions (
      guild_id,user_id,decision,risk_score,watch_state,network_cases,network_bans,external_records,suspect_score,reasons_json,trigger,scan_id,reviewed_by,reviewed_at,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(guild_id,user_id) DO UPDATE SET
      decision=excluded.decision,risk_score=excluded.risk_score,watch_state=excluded.watch_state,
      network_cases=excluded.network_cases,network_bans=excluded.network_bans,external_records=excluded.external_records,
      suspect_score=excluded.suspect_score,reasons_json=excluded.reasons_json,trigger=excluded.trigger,scan_id=excluded.scan_id,
      reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at,updated_at=excluded.updated_at
  `).run(
    String(guildId), String(userId), normalizeDecision(assessment.decision), Number(assessment.riskScore || 0), assessment.watchState || 'clear',
    Number(assessment.networkCases || 0), Number(assessment.networkBans || 0), Number(assessment.externalRecords || 0), Number(assessment.suspectScore || 0),
    JSON.stringify(assessment.reasons || []), String(trigger || 'scan'), scanId ? String(scanId) : null, reviewedBy ? String(reviewedBy) : null,
    reviewedAt || null, existing?.createdAt || stamp, stamp
  );
  return getDecision(guildId, userId);
}

function markClear(guildId, userId, actorId, reason = 'Reviewed by staff and marked clear.') {
  const before = getDecision(guildId, userId);
  const assessment = {
    decision: 'clear', riskScore: before?.riskScore || 0, watchState: before?.watchState || 'clear',
    networkCases: before?.networkCases || 0, networkBans: before?.networkBans || 0,
    externalRecords: before?.externalRecords || 0, suspectScore: before?.suspectScore || 0, reasons: [reason],
  };
  const after = saveDecision(guildId, userId, assessment, { trigger: 'staff_clear', reviewedBy: actorId, reviewedAt: now() });
  recordModerationSystemEvent({ guildId, actorId, event: 'moderation.intelligence.decision_cleared', action: 'member_intelligence_clear', targetId: userId, reason, before, after });
  return { before, after };
}

function sameEvidence(before, assessment) {
  return Boolean(before
    && Number(before.riskScore || 0) === Number(assessment.riskScore || 0)
    && String(before.watchState || 'clear') === String(assessment.watchState || 'clear')
    && Number(before.networkCases || 0) === Number(assessment.networkCases || 0)
    && Number(before.networkBans || 0) === Number(assessment.networkBans || 0)
    && Number(before.externalRecords || 0) === Number(assessment.externalRecords || 0)
    && Number(before.suspectScore || 0) === Number(assessment.suspectScore || 0));
}

function meaningfulChange(before, after) {
  if (!before) return { changed: true, reasons: ['initial assessment'] };
  const reasons = [];
  const beforeRank = DECISIONS[normalizeDecision(before.decision)].rank;
  const afterRank = DECISIONS[normalizeDecision(after.decision)].rank;
  if (afterRank > beforeRank) reasons.push(`decision escalated ${DECISIONS[normalizeDecision(before.decision)].label} → ${DECISIONS[normalizeDecision(after.decision)].label}`);
  if (Math.abs(Number(after.riskScore || 0) - Number(before.riskScore || 0)) >= 20) reasons.push(`risk changed ${before.riskScore} → ${after.riskScore}`);
  if (String(after.watchState) !== String(before.watchState)) reasons.push(`watch state changed ${before.watchState} → ${after.watchState}`);
  if (Number(after.networkCases || 0) > Number(before.networkCases || 0)) reasons.push('new cross-guild case intelligence');
  if (Number(after.networkBans || 0) > Number(before.networkBans || 0)) reasons.push('new cross-guild ban intelligence');
  if (Number(after.externalRecords || 0) > Number(before.externalRecords || 0)) reasons.push('new external reputation intelligence');
  if (Number(after.suspectScore || 0) >= 70 && Number(before.suspectScore || 0) < 70) reasons.push('account correlation became strong');
  return { changed: reasons.length > 0, reasons };
}

async function evaluateMember(member, local, suspects = [], { trigger = 'continuous', scanId = null } = {}) {
  const context = await intelligence.buildContext(member.client, member, local || {});
  let assessment = classify({ ...context, guild: member.guild }, suspects);
  const before = getDecision(member.guild.id, member.id);
  if (before?.trigger === 'staff_clear' && sameEvidence(before, assessment)) {
    assessment = { ...assessment, decision: 'clear', reasons: before.reasons || ['Reviewed by staff and marked clear.'] };
    const after = saveDecision(member.guild.id, member.id, assessment, {
      trigger: 'staff_clear',
      scanId: before.scanId,
      reviewedBy: before.reviewedBy,
      reviewedAt: before.reviewedAt,
    });
    return { context, assessment, before, after, change: { changed: false, reasons: [] } };
  }
  const after = saveDecision(member.guild.id, member.id, assessment, { trigger, scanId });
  return { context, assessment, before, after, change: meaningfulChange(before, after) };
}

function buildChangeEmbed(member, result, trigger) {
  const config = DECISIONS[result.after.decision];
  const changeText = result.change.reasons.length ? result.change.reasons.map((item) => `• ${item}`).join('\n') : 'No material escalation.';
  const riskFactors = Array.isArray(result.context?.risk?.reasons) && result.context.risk.reasons.length
    ? result.context.risk.reasons.slice(0, 6).map((item) => `**+${Number(item.points || 0)}** • ${item.reason}`).join('\n')
    : 'No verified moderation-risk factors currently contribute to this score.';
  const decisionReasons = Array.isArray(result.assessment?.reasons) && result.assessment.reasons.length
    ? result.assessment.reasons.slice(0, 5).map((item) => `• ${item}`).join('\n')
    : 'No attention threshold reached.';

  return new EmbedBuilder()
    .setColor(config.color)
    .setTitle(`🧠 Intelligence Change • ${member.user.tag || member.user.username}`)
    .setDescription(`${config.emoji} **${config.label}** • Risk **${result.after.riskScore}/100**\n\n${changeText}`)
    .addFields(
      { name: 'Why this score?', value: riskFactors.slice(0, 1024), inline: false },
      { name: 'Why this decision?', value: decisionReasons.slice(0, 1024), inline: false },
      { name: 'Watch State', value: String(result.after.watchState || 'clear').toUpperCase(), inline: true },
      { name: 'Network Cases', value: String(result.after.networkCases || 0), inline: true },
      { name: 'Correlation', value: `${result.after.suspectScore || 0}%`, inline: true },
    )
    .setFooter({ text: `Continuous Member Intelligence • ${trigger}` })
    .setTimestamp();
}

module.exports = {
  DECISIONS,
  classify,
  getDecision,
  saveDecision,
  markClear,
  meaningfulChange,
  evaluateMember,
  buildChangeEmbed,
};
