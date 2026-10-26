'use strict';

const Discord = require('discord.js');
const { db } = require('./storage');
const { safeReply, safeUpdate } = require('../../../core/ui/interactionResponse');
const sentinel = require('../../../owner/sentinel');

const WATCH_STATES = Object.freeze({
  clear: { label: 'Clear', emoji: '✅', severity: 0, risk: 0 },
  watchlisted: { label: 'Watchlisted', emoji: '👁️', severity: 1, risk: 8 },
  restricted: { label: 'Restricted', emoji: '⚠️', severity: 2, risk: 18 },
  blacklisted: { label: 'Blacklisted', emoji: '⛔', severity: 3, risk: 32 },
});

function now() { return new Date().toISOString(); }
function json(value, fallback = {}) {
  if (value && typeof value === 'object') return value;
  if (!value) return fallback;
  try { return JSON.parse(value) || fallback; } catch { return fallback; }
}
function stringify(value) {
  try { return JSON.stringify(value ?? null); } catch { return JSON.stringify(null); }
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value) || 0)); }
function discordTime(value, style = 'R') {
  const ms = value instanceof Date ? value.getTime() : new Date(value || 0).getTime();
  return Number.isFinite(ms) && ms > 0 ? `<t:${Math.floor(ms / 1000)}:${style}>` : 'Unknown';
}
function listRoleIds(member) {
  if (!member?.roles?.cache) return [];
  return [...member.roles.cache.values()].filter((role) => role.id !== member.guild.id).sort((a, b) => b.position - a.position).map((role) => String(role.id));
}
function keyPermissions(member) {
  const elevated = new Set(['Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels', 'ManageMessages', 'ModerateMembers', 'KickMembers', 'BanMembers']);
  return (member?.permissions?.toArray?.() || []).filter((name) => elevated.has(name));
}

function ensureSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS member_intelligence_profiles (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT,
      global_name TEXT,
      display_name TEXT,
      avatar_hash TEXT,
      roles_json TEXT,
      permissions_json TEXT,
      present INTEGER NOT NULL DEFAULT 1,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      last_joined_at TEXT,
      last_left_at TEXT,
      join_count INTEGER NOT NULL DEFAULT 0,
      leave_count INTEGER NOT NULL DEFAULT 0,
      timeout_until TEXT,
      boosting_since TEXT,
      screening_pending INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS member_intelligence_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      event TEXT NOT NULL,
      before_value TEXT,
      after_value TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS member_intelligence_watchlist (
      user_id TEXT PRIMARY KEY,
      state TEXT NOT NULL DEFAULT 'clear',
      severity INTEGER NOT NULL DEFAULT 0,
      category TEXT,
      reason TEXT,
      evidence_json TEXT,
      source_guild_id TEXT,
      actor_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      review_at TEXT,
      expires_at TEXT
    );
    CREATE TABLE IF NOT EXISTS member_intelligence_watch_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      source_guild_id TEXT,
      actor_id TEXT,
      before_state TEXT,
      after_state TEXT NOT NULL,
      reason TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS member_intelligence_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      linked_user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      verification_ref TEXT,
      verified_by TEXT,
      verified_at TEXT NOT NULL,
      metadata TEXT,
      UNIQUE(user_id, linked_user_id, provider)
    );
    CREATE TABLE IF NOT EXISTS member_intelligence_reputation (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      event_type TEXT NOT NULL,
      source_name TEXT,
      source_guild_id TEXT,
      reason TEXT,
      evidence_ref TEXT,
      confidence TEXT NOT NULL DEFAULT 'reported',
      actor_id TEXT,
      created_at TEXT NOT NULL,
      reversed_at TEXT,
      metadata TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_member_intel_events_user_created ON member_intelligence_events(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_member_intel_events_guild_user ON member_intelligence_events(guild_id, user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_member_intel_profiles_user ON member_intelligence_profiles(user_id, last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS idx_member_intel_watch_state ON member_intelligence_watchlist(state, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_member_intel_links_user ON member_intelligence_links(user_id, verified_at DESC);
    CREATE INDEX IF NOT EXISTS idx_member_intel_reputation_user ON member_intelligence_reputation(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_member_intel_reputation_source ON member_intelligence_reputation(source_type, event_type, created_at DESC);
  `);
}
ensureSchema();

function insertEvent(guildId, userId, event, before = null, after = null, metadata = {}) {
  if (!guildId || !userId || !event) return null;
  const result = db.prepare('INSERT INTO member_intelligence_events (guild_id, user_id, event, before_value, after_value, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(String(guildId), String(userId), String(event).slice(0, 120), stringify(before), stringify(after), stringify(metadata), now());
  return Number(result.lastInsertRowid);
}

function snapshotMember(member) {
  if (!member?.guild?.id || !member?.user?.id) return null;
  return {
    guildId: String(member.guild.id),
    guildName: member.guild.name || String(member.guild.id),
    userId: String(member.user.id),
    username: member.user.username || null,
    globalName: member.user.globalName || null,
    displayName: member.displayName || member.user.globalName || member.user.username || null,
    avatarHash: member.user.avatar || null,
    roles: listRoleIds(member),
    permissions: keyPermissions(member),
    joinedAt: member.joinedAt?.toISOString?.() || null,
    timeoutUntil: member.communicationDisabledUntil?.toISOString?.() || null,
    boostingSince: member.premiumSince?.toISOString?.() || null,
    screeningPending: Boolean(member.pending),
  };
}

function upsertProfile(snapshot, event = 'observed') {
  if (!snapshot?.guildId || !snapshot?.userId) return null;
  const existing = db.prepare('SELECT * FROM member_intelligence_profiles WHERE guild_id = ? AND user_id = ?').get(snapshot.guildId, snapshot.userId);
  const timestamp = now();
  const isJoin = event === 'join';
  const isLeave = event === 'leave' || event === 'kick' || event === 'ban' || event === 'prune';
  db.prepare(`
    INSERT INTO member_intelligence_profiles (
      guild_id,user_id,username,global_name,display_name,avatar_hash,roles_json,permissions_json,present,
      first_seen_at,last_seen_at,last_joined_at,last_left_at,join_count,leave_count,timeout_until,boosting_since,screening_pending
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(guild_id,user_id) DO UPDATE SET
      username=excluded.username, global_name=excluded.global_name, display_name=excluded.display_name,
      avatar_hash=excluded.avatar_hash, roles_json=excluded.roles_json, permissions_json=excluded.permissions_json,
      present=excluded.present, last_seen_at=excluded.last_seen_at,
      last_joined_at=COALESCE(excluded.last_joined_at,member_intelligence_profiles.last_joined_at),
      last_left_at=COALESCE(excluded.last_left_at,member_intelligence_profiles.last_left_at),
      join_count=member_intelligence_profiles.join_count + ?, leave_count=member_intelligence_profiles.leave_count + ?,
      timeout_until=excluded.timeout_until, boosting_since=excluded.boosting_since, screening_pending=excluded.screening_pending
  `).run(
    snapshot.guildId, snapshot.userId, snapshot.username, snapshot.globalName, snapshot.displayName, snapshot.avatarHash,
    stringify(snapshot.roles), stringify(snapshot.permissions), isLeave ? 0 : 1,
    existing?.first_seen_at || timestamp, timestamp, isJoin ? timestamp : null, isLeave ? timestamp : null,
    isJoin ? 1 : 0, isLeave ? 1 : 0, snapshot.timeoutUntil, snapshot.boostingSince, snapshot.screeningPending ? 1 : 0,
    isJoin ? 1 : 0, isLeave ? 1 : 0
  );
  return db.prepare('SELECT * FROM member_intelligence_profiles WHERE guild_id = ? AND user_id = ?').get(snapshot.guildId, snapshot.userId);
}

function observeJoin(member) {
  const after = snapshotMember(member);
  if (!after) return false;
  upsertProfile(after, 'join');
  insertEvent(after.guildId, after.userId, 'member.join', null, after, { source: 'discord_event' });
  return true;
}
function observeLeave(member, removalType = 'leave') {
  const before = snapshotMember(member);
  if (!before) return false;
  upsertProfile(before, removalType);
  insertEvent(before.guildId, before.userId, `member.${removalType}`, before, null, { source: 'discord_event' });
  return true;
}
function observeUpdate(oldMember, newMember) {
  const before = snapshotMember(oldMember);
  const after = snapshotMember(newMember);
  if (!after) return false;
  upsertProfile(after, 'update');
  const changes = [];
  const compare = (key, label) => { if (stringify(before?.[key]) !== stringify(after?.[key])) changes.push(label); };
  compare('username', 'username'); compare('globalName', 'global_name'); compare('displayName', 'display_name');
  compare('avatarHash', 'avatar'); compare('roles', 'roles'); compare('permissions', 'permissions');
  compare('timeoutUntil', 'timeout'); compare('boostingSince', 'boosting'); compare('screeningPending', 'screening');
  if (!changes.length) return false;
  insertEvent(after.guildId, after.userId, 'member.update', before, after, { source: 'discord_event', changes });
  return true;
}
function observeUserUpdate(client, oldUser, newUser) {
  if (!client?.guilds?.cache || !newUser?.id) return 0;
  let count = 0;
  for (const guild of client.guilds.cache.values()) {
    const member = guild.members?.cache?.get?.(newUser.id);
    if (!member) continue;
    const snapshot = snapshotMember(member);
    if (!snapshot) continue;
    const before = { username: oldUser?.username || null, globalName: oldUser?.globalName || null, avatarHash: oldUser?.avatar || null };
    const after = { username: newUser.username || null, globalName: newUser.globalName || null, avatarHash: newUser.avatar || null };
    if (stringify(before) === stringify(after)) continue;
    upsertProfile(snapshot, 'update');
    insertEvent(guild.id, newUser.id, 'user.identity.update', before, after, { source: 'discord_event' });
    count += 1;
  }
  return count;
}
function observeScan(member) {
  const snapshot = snapshotMember(member);
  if (!snapshot) return false;
  upsertProfile(snapshot, 'scan');
  const latest = db.prepare("SELECT after_value FROM member_intelligence_events WHERE guild_id = ? AND user_id = ? AND event = 'member.scan.observed' ORDER BY id DESC LIMIT 1").get(snapshot.guildId, snapshot.userId);
  const previous = json(latest?.after_value, null);
  if (!previous || stringify(previous) !== stringify(snapshot)) insertEvent(snapshot.guildId, snapshot.userId, 'member.scan.observed', previous, snapshot, { source: 'member_scan' });
  return true;
}

function mapProfile(row) {
  if (!row) return null;
  return {
    guildId: row.guild_id, userId: row.user_id, username: row.username, globalName: row.global_name, displayName: row.display_name,
    avatarHash: row.avatar_hash, roles: json(row.roles_json, []), permissions: json(row.permissions_json, []), present: Boolean(row.present),
    firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at, lastJoinedAt: row.last_joined_at, lastLeftAt: row.last_left_at,
    joinCount: Number(row.join_count || 0), leaveCount: Number(row.leave_count || 0), timeoutUntil: row.timeout_until,
    boostingSince: row.boosting_since, screeningPending: Boolean(row.screening_pending),
  };
}
function getGuildHistory(userId) {
  return db.prepare('SELECT * FROM member_intelligence_profiles WHERE user_id = ? ORDER BY last_seen_at DESC').all(String(userId)).map(mapProfile);
}
function getIdentityHistory(userId, limit = 100) {
  const rows = db.prepare("SELECT guild_id,event,before_value,after_value,created_at FROM member_intelligence_events WHERE user_id = ? AND event IN ('user.identity.update','member.update','member.scan.observed','member.join') ORDER BY id DESC LIMIT ?").all(String(userId), clamp(limit, 1, 250));
  const names = new Set(); const globals = new Set(); const displays = new Set(); const avatars = new Set();
  for (const row of rows) {
    for (const state of [json(row.before_value, {}), json(row.after_value, {})]) {
      if (state.username) names.add(String(state.username));
      if (state.globalName) globals.add(String(state.globalName));
      if (state.displayName) displays.add(String(state.displayName));
      if (state.avatarHash) avatars.add(String(state.avatarHash));
    }
  }
  return { usernames: [...names], globalNames: [...globals], displayNames: [...displays], avatarHashes: [...avatars], events: rows };
}

function mapWatch(row) {
  if (!row) return { userId: null, state: 'clear', severity: 0, category: null, reason: null, evidence: [], sourceGuildId: null, actorId: null, createdAt: null, updatedAt: null, reviewAt: null, expiresAt: null };
  return { userId: row.user_id, state: WATCH_STATES[row.state] ? row.state : 'clear', severity: Number(row.severity || 0), category: row.category || null, reason: row.reason || null, evidence: json(row.evidence_json, []), sourceGuildId: row.source_guild_id || null, actorId: row.actor_id || null, createdAt: row.created_at, updatedAt: row.updated_at, reviewAt: row.review_at || null, expiresAt: row.expires_at || null };
}
function getWatchlist(userId) {
  const row = db.prepare('SELECT * FROM member_intelligence_watchlist WHERE user_id = ?').get(String(userId));
  const watch = mapWatch(row);
  if (watch.expiresAt && new Date(watch.expiresAt).getTime() <= Date.now() && watch.state !== 'clear') return { ...watch, state: 'clear', expired: true };
  return watch;
}
function setWatchlist({ userId, state, category = null, reason, evidence = [], sourceGuildId = null, actorId = null, reviewAt = null, expiresAt = null }) {
  const normalizedState = WATCH_STATES[state] ? state : 'clear';
  const before = getWatchlist(userId);
  const stamp = now();
  const config = WATCH_STATES[normalizedState];
  db.prepare(`INSERT INTO member_intelligence_watchlist (user_id,state,severity,category,reason,evidence_json,source_guild_id,actor_id,created_at,updated_at,review_at,expires_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET state=excluded.state,severity=excluded.severity,category=excluded.category,reason=excluded.reason,evidence_json=excluded.evidence_json,source_guild_id=excluded.source_guild_id,actor_id=excluded.actor_id,updated_at=excluded.updated_at,review_at=excluded.review_at,expires_at=excluded.expires_at`)
    .run(String(userId), normalizedState, config.severity, category || null, String(reason || '').slice(0, 1000), stringify(Array.isArray(evidence) ? evidence : []), sourceGuildId ? String(sourceGuildId) : null, actorId ? String(actorId) : null, before.createdAt || stamp, stamp, reviewAt || null, expiresAt || null);
  db.prepare('INSERT INTO member_intelligence_watch_audit (user_id,source_guild_id,actor_id,before_state,after_state,reason,metadata,created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(String(userId), sourceGuildId ? String(sourceGuildId) : null, actorId ? String(actorId) : null, before.state || 'clear', normalizedState, String(reason || '').slice(0, 1000), stringify({ category, evidence, reviewAt, expiresAt }), stamp);
  return { before, after: getWatchlist(userId) };
}
function getWatchAudit(userId, limit = 10) {
  return db.prepare('SELECT * FROM member_intelligence_watch_audit WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(String(userId), clamp(limit, 1, 50));
}
function getConfirmedLinks(userId) {
  return db.prepare('SELECT * FROM member_intelligence_links WHERE user_id = ? OR linked_user_id = ? ORDER BY verified_at DESC').all(String(userId), String(userId)).map((row) => ({
    id: row.id, userId: row.user_id, linkedUserId: row.linked_user_id, provider: row.provider, verificationRef: row.verification_ref || null,
    verifiedBy: row.verified_by || null, verifiedAt: row.verified_at, metadata: json(row.metadata, {}),
  }));
}
function addConfirmedLink({ userId, linkedUserId, provider, verificationRef = null, verifiedBy = null, metadata = {} }) {
  if (!userId || !linkedUserId || !provider || String(userId) === String(linkedUserId)) throw new Error('Invalid confirmed-link record.');
  db.prepare(`INSERT INTO member_intelligence_links (user_id,linked_user_id,provider,verification_ref,verified_by,verified_at,metadata) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(user_id,linked_user_id,provider) DO UPDATE SET verification_ref=excluded.verification_ref,verified_by=excluded.verified_by,verified_at=excluded.verified_at,metadata=excluded.metadata`)
    .run(String(userId), String(linkedUserId), String(provider).slice(0, 80), verificationRef ? String(verificationRef).slice(0, 200) : null, verifiedBy ? String(verifiedBy) : null, now(), stringify(metadata));
  return getConfirmedLinks(userId);
}

const REPUTATION_SOURCE_TYPES = Object.freeze({
  verified_external: { label: 'Verified External', confidence: 'verified' },
  submitted: { label: 'Evidence Submitted', confidence: 'submitted' },
  unverified: { label: 'Reported / Unverified', confidence: 'reported' },
});
const REPUTATION_EVENT_TYPES = new Set(['ban', 'blacklist', 'kick', 'timeout', 'warning', 'report', 'other']);
function getReputationRecords(userId, limit = 100) {
  return db.prepare('SELECT * FROM member_intelligence_reputation WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(String(userId), clamp(limit, 1, 250)).map((row) => ({
    id: Number(row.id), userId: row.user_id, sourceType: row.source_type, eventType: row.event_type,
    sourceName: row.source_name || null, sourceGuildId: row.source_guild_id || null, reason: row.reason || null,
    evidenceRef: row.evidence_ref || null, confidence: row.confidence || 'reported', actorId: row.actor_id || null,
    createdAt: row.created_at, reversedAt: row.reversed_at || null, metadata: json(row.metadata, {}),
  }));
}
function summarizeReputation(records = []) {
  const active = records.filter((record) => !record.reversedAt);
  const count = (sourceType) => active.filter((record) => record.sourceType === sourceType).length;
  return {
    total: active.length,
    verifiedExternal: count('verified_external'), submitted: count('submitted'), unverified: count('unverified'),
    verifiedExternalBans: active.filter((record) => record.sourceType === 'verified_external' && record.eventType === 'ban').length,
    verifiedExternalBlacklists: active.filter((record) => record.sourceType === 'verified_external' && record.eventType === 'blacklist').length,
  };
}
function addReputationRecord({ userId, sourceType, eventType, sourceName = null, sourceGuildId = null, reason, evidenceRef = null, actorId = null, metadata = {} }) {
  const normalizedSource = REPUTATION_SOURCE_TYPES[sourceType] ? sourceType : 'unverified';
  const normalizedEvent = REPUTATION_EVENT_TYPES.has(String(eventType || '').toLowerCase()) ? String(eventType).toLowerCase() : 'other';
  const normalizedEvidence = String(evidenceRef || '').trim().slice(0, 500) || null;
  if (normalizedSource === 'verified_external' && !normalizedEvidence) throw new Error('Verified external intelligence requires a traceable evidence/reference value.');
  const normalizedReason = String(reason || '').trim().slice(0, 1500);
  if (!normalizedReason) throw new Error('A reason or evidence summary is required.');
  const cfg = REPUTATION_SOURCE_TYPES[normalizedSource];
  const result = db.prepare('INSERT INTO member_intelligence_reputation (user_id,source_type,event_type,source_name,source_guild_id,reason,evidence_ref,confidence,actor_id,created_at,reversed_at,metadata) VALUES (?,?,?,?,?,?,?,?,?,?,NULL,?)')
    .run(String(userId), normalizedSource, normalizedEvent, String(sourceName || '').trim().slice(0, 120) || null, sourceGuildId ? String(sourceGuildId) : null, normalizedReason, normalizedEvidence, cfg.confidence, actorId ? String(actorId) : null, now(), stringify(metadata));
  return getReputationRecords(userId, 250).find((record) => record.id === Number(result.lastInsertRowid)) || null;
}

function getAllCases(userId) {
  return db.prepare('SELECT * FROM cases WHERE user_id = ? ORDER BY created_at DESC').all(String(userId)).map((row) => ({
    guildId: row.guild_id, caseId: Number(row.case_id), moderatorId: row.moderator_id, action: row.action, reason: row.reason || null,
    status: row.status || 'active', metadata: json(row.metadata, {}), createdAt: row.created_at, updatedAt: row.updated_at || null,
  }));
}
function casesInWindow(cases, days) {
  if (!Number.isFinite(days)) return cases;
  const cutoff = Date.now() - (days * 86400000);
  return cases.filter((entry) => new Date(entry.createdAt || 0).getTime() >= cutoff);
}
function summarizeWindow(cases, days) {
  const selected = casesInWindow(cases, days);
  const counts = { warn: 0, timeout: 0, kick: 0, ban: 0, other: 0 };
  const moderators = new Set(); const reasons = new Map();
  let reversed = 0; let appeals = 0; let evidence = 0;
  for (const item of selected) {
    if (Object.prototype.hasOwnProperty.call(counts, item.action)) counts[item.action] += 1; else counts.other += 1;
    if (item.moderatorId) moderators.add(String(item.moderatorId));
    if (item.status === 'reversed') reversed += 1;
    const meta = item.metadata || {};
    appeals += Array.isArray(meta.appeals) ? meta.appeals.length : 0;
    evidence += Array.isArray(meta.evidence) ? meta.evidence.filter((entry) => !entry?.removedAt).length : 0;
    const reasonKey = String(item.reason || '').trim().toLowerCase();
    if (reasonKey) reasons.set(reasonKey, Number(reasons.get(reasonKey) || 0) + 1);
  }
  const topReason = [...reasons.entries()].sort((a, b) => b[1] - a[1])[0] || null;
  return { days, total: selected.length, counts, uniqueModerators: moderators.size, reversed, appeals, evidence, topReason: topReason ? { reason: topReason[0], count: topReason[1] } : null };
}
function getBehavior(userId) {
  const cases = getAllCases(userId);
  const windows = { d7: summarizeWindow(cases, 7), d30: summarizeWindow(cases, 30), d90: summarizeWindow(cases, 90), all: summarizeWindow(cases, Infinity) };
  const recent30 = windows.d30.total; const prior30 = cases.filter((entry) => { const ms = new Date(entry.createdAt || 0).getTime(); const end = Date.now() - 30 * 86400000; const start = Date.now() - 60 * 86400000; return ms >= start && ms < end; }).length;
  const trend = recent30 > prior30 ? 'increasing' : recent30 < prior30 ? 'decreasing' : 'stable';
  const escalation = cases.slice().reverse().map((entry) => entry.action).filter((action) => ['warn', 'timeout', 'kick', 'ban'].includes(action));
  return { cases, windows, trend, prior30, escalation: escalation.slice(-8) };
}
function getNetworkModeration(userId, currentGuildId) {
  const cases = getAllCases(userId);
  const byGuild = new Map();
  for (const item of cases) {
    const current = byGuild.get(item.guildId) || { guildId: item.guildId, cases: 0, warnings: 0, timeouts: 0, kicks: 0, bans: 0, active: 0, reversed: 0, latestAt: null };
    current.cases += 1;
    if (item.action === 'warn') current.warnings += 1;
    if (item.action === 'timeout') current.timeouts += 1;
    if (item.action === 'kick') current.kicks += 1;
    if (item.action === 'ban') current.bans += 1;
    if (item.status === 'active') current.active += 1;
    if (item.status === 'reversed') current.reversed += 1;
    if (!current.latestAt || String(item.createdAt) > String(current.latestAt)) current.latestAt = item.createdAt;
    byGuild.set(item.guildId, current);
  }
  const rows = [...byGuild.values()].sort((a, b) => String(b.latestAt || '').localeCompare(String(a.latestAt || '')));
  const outside = rows.filter((row) => String(row.guildId) !== String(currentGuildId));
  return {
    guildCount: outside.length, caseCount: outside.reduce((n, row) => n + row.cases, 0), banCount: outside.reduce((n, row) => n + row.bans, 0),
    timeoutCount: outside.reduce((n, row) => n + row.timeouts, 0), warningCount: outside.reduce((n, row) => n + row.warnings, 0), rows: outside,
  };
}
function calculateRisk({ localSummary = {}, network = {}, watch = {}, behavior = {}, reputation = {} }) {
  const reasons = [];
  let score = 0;
  const add = (points, reason) => { if (points > 0) { score += points; reasons.push({ points, reason }); } };
  add(Math.min(15, Number(localSummary.warningCount || 0) * 4), `${localSummary.warningCount || 0} active warning(s)`);
  add(Math.min(15, Number(localSummary.activeCases || 0) * 5), `${localSummary.activeCases || 0} active case(s)`);
  add(Math.min(15, Number(localSummary.timeouts || 0) * 4), `${localSummary.timeouts || 0} timeout case(s)`);
  add(Math.min(20, Number(localSummary.bans || 0) * 10), `${localSummary.bans || 0} local ban case(s)`);
  add(Math.min(18, Number(network.caseCount || 0) * 3), `${network.caseCount || 0} case(s) in other Goliath guilds`);
  add(Math.min(20, Number(network.banCount || 0) * 10), `${network.banCount || 0} ban(s) in other Goliath guilds`);
  add(Math.min(20, Number(reputation.verifiedExternalBans || 0) * 8), `${reputation.verifiedExternalBans || 0} verified external ban record(s)`);
  add(Math.min(20, Number(reputation.verifiedExternalBlacklists || 0) * 10), `${reputation.verifiedExternalBlacklists || 0} verified external blacklist record(s)`);
  const watchCfg = WATCH_STATES[watch.state] || WATCH_STATES.clear;
  add(watchCfg.risk, `${watchCfg.label} by Goliath intelligence`);
  if (behavior?.trend === 'increasing' && Number(behavior?.windows?.d30?.total || 0) >= 2) add(6, 'moderation activity is increasing over the last 30 days');
  score = Math.min(100, score);
  const label = score >= 70 ? '🔴 High' : score >= 40 ? '🟠 Elevated' : score >= 20 ? '🟡 Moderate' : '🟢 Low';
  return { score, label, reasons };
}

async function buildContext(client, target, localSummary = {}) {
  observeScan(target);
  const userId = String(target.id);
  const guildId = String(target.guild.id);
  const watch = getWatchlist(userId);
  const guildHistory = getGuildHistory(userId);
  const identity = getIdentityHistory(userId);
  const behavior = getBehavior(userId);
  const network = getNetworkModeration(userId, guildId);
  const confirmedLinks = getConfirmedLinks(userId);
  const reputationRecords = getReputationRecords(userId);
  const reputation = summarizeReputation(reputationRecords);
  let auditReport = null;
  try {
    const auditUserIntelligence = require('../../../owner/auditIntelligence/userIntelligence');
    if (typeof auditUserIntelligence.buildReport === 'function') auditReport = await auditUserIntelligence.buildReport(client, userId);
  } catch (error) {
    console.warn('[Member Intelligence] Audit Intelligence report unavailable:', error?.message || error);
  }
  if (auditReport?.guilds?.length) {
    for (const guild of auditReport.guilds) {
      if (!guild?.guildId || guildHistory.some((entry) => String(entry.guildId) === String(guild.guildId))) continue;
      guildHistory.push({ guildId: String(guild.guildId), userId, username: null, globalName: null, displayName: null, avatarHash: null, roles: [], permissions: [], present: guild.currentMember === true, firstSeenAt: guild.firstObservedAt || null, lastSeenAt: guild.lastObservedAt || null, lastJoinedAt: null, lastLeftAt: null, joinCount: Number(guild.joinCount || 0), leaveCount: Number(guild.leaveCount || 0), timeoutUntil: null, boostingSince: null, screeningPending: false, source: 'audit_intelligence' });
    }
  }
  const risk = calculateRisk({ localSummary, network, watch, behavior, reputation });
  return { userId, guildId, watch, guildHistory, identity, behavior, network, confirmedLinks, reputationRecords, reputation, auditReport, risk };
}

function setOrReplaceField(embed, name, value, inline = false) {
  const fields = [...(embed?.data?.fields || [])];
  const index = fields.findIndex((field) => field.name === name);
  const next = { name, value: String(value || 'None').slice(0, 1024), inline };
  if (index >= 0) fields[index] = next; else fields.push(next);
  embed.setFields(fields);
}
function removeField(embed, name) {
  const fields = [...(embed?.data?.fields || [])].filter((field) => field.name !== name);
  embed.setFields(fields);
}
function watchLine(watch) {
  const cfg = WATCH_STATES[watch?.state] || WATCH_STATES.clear;
  if (watch?.state === 'clear') return `${cfg.emoji} **${cfg.label}**`;
  return `${cfg.emoji} **${cfg.label}**${watch.category ? ` • ${watch.category}` : ''}${watch.reason ? `\n${String(watch.reason).slice(0, 220)}` : ''}`;
}
function contextSummary(context) {
  const history = context.guildHistory || [];
  const current = history.filter((item) => item.present).length;
  const former = history.filter((item) => item.present === false).length;
  const network = context.network || {};
  const reputation = context.reputation || {};
  return [
    `Observed Guilds: **${history.length}** • Current: **${current}** • Former: **${former}**`,
    `Goliath Cases: **${network.caseCount || 0}** • Bans: **${network.banCount || 0}** • Timeouts: **${network.timeoutCount || 0}**`,
    `External Verified: **${reputation.verifiedExternal || 0}** • Submitted: **${reputation.submitted || 0}** • Reports: **${reputation.unverified || 0}**`,
    `Goliath Watchlist: ${watchLine(context.watch)}`,
  ].join('\n');
}
function behaviorSummary(behavior) {
  const d7 = behavior?.windows?.d7 || {}; const d30 = behavior?.windows?.d30 || {}; const d90 = behavior?.windows?.d90 || {};
  return [
    `7d: **${d7.total || 0}** cases • 30d: **${d30.total || 0}** • 90d: **${d90.total || 0}**`,
    `30d trend: **${String(behavior?.trend || 'stable').toUpperCase()}** vs ${behavior?.prior30 || 0} in the previous 30d`,
    behavior?.escalation?.length ? `Recent sequence: ${behavior.escalation.join(' → ')}` : 'Recent sequence: None',
  ].join('\n');
}

async function decorateScan(interaction, target, report) {
  const localSummary = {
    warningCount: 0,
    activeCases: report?.cases?.filter?.((entry) => String(entry.status || 'active') === 'active').length || 0,
    timeouts: report?.cases?.filter?.((entry) => entry.action === 'timeout').length || 0,
    bans: report?.cases?.filter?.((entry) => entry.action === 'ban').length || 0,
  };
  try {
    const warningRow = db.prepare('SELECT COUNT(*) AS count FROM warnings WHERE guild_id = ? AND user_id = ?').get(String(interaction.guild.id), String(target.id));
    localSummary.warningCount = Number(warningRow?.count || 0);
  } catch {}

  const context = await buildContext(interaction.client, target, localSummary);
  report.intelligenceContext = context;
  report.risk = context.risk;

  for (const field of [
    '🪪 Identity & History',
    '🏠 Membership & Access',
    '⚖️ Moderation & Risk',
    '🕘 Recent Cases',
    '👁️ Investigation Intelligence',
    '⚖️ Moderation Overview',
    '🧠 Intelligence Summary',
    '🌐 Network Reputation',
    '📊 Behaviour Pattern',
    '🔗 Verified Identity Links',
  ]) removeField(report.embed, field);

  const history = context.guildHistory || [];
  const currentGuilds = history.filter((item) => item.present).length;
  const formerGuilds = history.filter((item) => item.present === false).length;
  const reputation = context.reputation || {};
  const behavior = context.behavior || {};
  const roles = [...(target.roles?.cache?.values?.() || [])]
    .filter((role) => role.id !== interaction.guild.id)
    .sort((a, b) => b.position - a.position);
  const elevated = target.permissions?.toArray?.().filter((name) => ['Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels', 'ManageMessages', 'ModerateMembers', 'KickMembers', 'BanMembers'].includes(name)) || [];
  const latestCase = report.cases?.[0] || null;
  const watchState = context.watch?.state || 'clear';
  const watchConfig = WATCH_STATES[watchState] || WATCH_STATES.clear;
  const investigationWatch = report.investigation?.watched ? 'On' : 'Off';

  report.embed
    .setTitle(`🧠 Member Intelligence • ${target.user.tag}`)
    .setDescription([
      `**Target:** ${target.user} • ID **${target.id}**`,
      'Evidence-led member overview for authorised management. Key intelligence and investigation state are summarised below.',
    ].join('\n\n'))
    .setFooter({ text: `Scanned by ${interaction.user?.tag || interaction.user?.username || interaction.user?.id || 'Unknown'} • Evidence-based intelligence` });

  const riskLines = [
    `Risk **${context.risk.score}/100 • ${context.risk.label}**`,
    `Watchlist **${watchConfig.emoji} ${watchConfig.label}** • Active Cases **${localSummary.activeCases}** • Warnings **${localSummary.warningCount}**`,
  ];
  if (context.risk.reasons?.length) {
    riskLines.push(`Risk factors ${context.risk.reasons.slice(0, 4).map((item) => `**+${item.points}** ${item.reason}`).join(' • ')}`);
  } else {
    riskLines.push('**No verified risk factors**');
  }
  setOrReplaceField(report.embed, '🚦 Status & Risk', riskLines.join('\n'));

  const identity = context.identity || {};
  const currentIdentityValues = new Set([
    target.user.username,
    target.user.globalName,
    target.displayName,
  ].filter(Boolean).map((value) => String(value)));
  const knownIdentityValues = new Set([
    ...(identity.usernames || []),
    ...(identity.globalNames || []),
    ...(identity.displayNames || []),
  ].filter(Boolean).map((value) => String(value)));
  const previousIdentityValues = [...knownIdentityValues].filter((value) => !currentIdentityValues.has(value));
  const identityChanges = (Array.isArray(identity.events) ? identity.events : []).filter((event) => {
    if (event.event === 'user.identity.update') return true;
    if (event.event !== 'member.update' && event.event !== 'member.scan.observed') return false;
    const before = json(event.before_value, {});
    const after = json(event.after_value, {});
    const hasBeforeIdentity = before.username || before.globalName || before.displayName;
    const hasAfterIdentity = after.username || after.globalName || after.displayName;
    if (!hasBeforeIdentity || !hasAfterIdentity) return false;
    return before.username !== after.username || before.globalName !== after.globalName || before.displayName !== after.displayName;
  });
  const identityChangeCount = Math.max(previousIdentityValues.length, identityChanges.length);
  const latestIdentityChange = identityChanges[0]?.created_at || null;
  const identityStatus = identityChangeCount
    ? `**${identityChangeCount} change${identityChangeCount === 1 ? '' : 's'}**${latestIdentityChange ? ` • Last ${discordTime(latestIdentityChange, 'R')}` : ''}`
    : '**No recorded changes**';

  setOrReplaceField(report.embed, '👤 Member', [
    `Username **${target.user.username}** • Display **${target.displayName || target.user.username}**`,
    `Created ${discordTime(target.user.createdAt || target.user.createdTimestamp, 'F')} • Joined ${discordTime(target.joinedAt || target.joinedTimestamp, 'F')}`,
    `Roles **${roles.length}** • Elevated permissions **${elevated.length ? elevated.join(', ') : 'None'}**`,
    `Timeout **${target.communicationDisabledUntilTimestamp ? discordTime(target.communicationDisabledUntilTimestamp, 'R') : 'None'}**`,
    `Identity: ${identityStatus}`,
  ].join('\n'));

  setOrReplaceField(report.embed, '⚖️ Moderation', [
    `Cases **${report.cases?.length || 0}** • Warnings **${localSummary.warningCount}** • Timeouts **${localSummary.timeouts}** • Bans **${localSummary.bans}**`,
    latestCase
      ? `Latest: **#${latestCase.caseId} • ${latestCase.action} • ${latestCase.status || 'active'}** — ${String(latestCase.reason || 'No reason').slice(0, 180)}`
      : 'Latest: **No recorded moderation cases**',
  ].join('\n'));

  const investigationLines = [
    `Watch **${report.investigation?.watched ? '🟢' : '⚪'} ${investigationWatch}** • Notes **${report.investigation?.notes?.length || 0}**`,
    `Correlations **${report.persistentLinks?.length || 0}** • Verified Links **${context.confirmedLinks?.length || 0}**`,
  ];
  if (report.suspects?.length) investigationLines.push(`Suspected accounts **${report.suspects.length} match(es)** — open evidence/history before drawing a conclusion.`);
  setOrReplaceField(report.embed, '🔎 Investigation', investigationLines.join('\n'));

  const behaviourTrend = String(behavior.trend || 'stable').toLowerCase();
  const behaviourLabel = behaviourTrend ? `${behaviourTrend.charAt(0).toUpperCase()}${behaviourTrend.slice(1)}` : 'Stable';
  const behaviourIcon = behaviourTrend === 'increasing' ? '🟠' : '🟢';
  const externalCount = Number(reputation.verifiedExternal || 0) + Number(reputation.submitted || 0) + Number(reputation.unverified || 0);
  const networkLines = [
    `Guilds **${history.length} observed • ${currentGuilds} current • ${formerGuilds} former**`,
    `Cross-guild Cases **${context.network?.caseCount || 0}** • External Records **${externalCount}**`,
  ];
  if (externalCount > 0) {
    networkLines.push(`External **${reputation.verifiedExternal || 0} verified • ${reputation.submitted || 0} submitted • ${reputation.unverified || 0} unverified**`);
  }
  networkLines.push(`Behaviour **${behaviourIcon} ${behaviourLabel} • ${behavior.windows?.d30?.total || 0} cases / 30d**`);
  setOrReplaceField(report.embed, '🌐 Network & Behaviour', networkLines.join('\n'));

  const components = [
    new Discord.ActionRowBuilder().addComponents(
      new Discord.UserSelectMenuBuilder()
        .setCustomId('mod_scan_user_select')
        .setPlaceholder('👤 Select another member to investigate')
        .setMinValues(1)
        .setMaxValues(1)
    ),
  ];
  const primary = [
    new Discord.ButtonBuilder().setCustomId(`mod_member_scan:${target.id}`).setLabel('Rescan').setEmoji('🔄').setStyle(Discord.ButtonStyle.Primary),
  ];
  if (report.access?.history) primary.push(new Discord.ButtonBuilder().setCustomId(`mod_scan_history:${target.id}`).setLabel('History').setEmoji('🕘').setStyle(Discord.ButtonStyle.Secondary));
  primary.push(
    new Discord.ButtonBuilder().setCustomId(`mod_intel_guilds:${target.id}`).setLabel('Network').setEmoji('🌐').setStyle(Discord.ButtonStyle.Secondary),
  );
  components.push(new Discord.ActionRowBuilder().addComponents(...primary));

  const evidence = [];
  if (report.access?.links) evidence.push(new Discord.ButtonBuilder().setCustomId(`mod_scan_links:${target.id}`).setLabel(`Correlations (${report.persistentLinks?.length || 0})`.slice(0, 80)).setEmoji('🔗').setStyle(Discord.ButtonStyle.Secondary));
  if (report.access?.notes) evidence.push(new Discord.ButtonBuilder().setCustomId(`mod_scan_note:${target.id}`).setLabel('Notes').setEmoji('📝').setStyle(Discord.ButtonStyle.Secondary));
  if (report.access?.watch) evidence.push(new Discord.ButtonBuilder()
    .setCustomId(`mod_scan_watch:${target.id}`)
    .setLabel(report.investigation?.watched ? 'Watch On' : 'Watch Off')
    .setEmoji('👁️')
    .setStyle(report.investigation?.watched ? Discord.ButtonStyle.Danger : Discord.ButtonStyle.Secondary));
  evidence.push(new Discord.ButtonBuilder()
    .setCustomId(`mod_intel_watchlist:${target.id}`)
    .setLabel('Watchlist')
    .setEmoji('🛡️')
    .setStyle(watchState === 'blacklisted' ? Discord.ButtonStyle.Danger : Discord.ButtonStyle.Secondary));
  if (evidence.length) {
    const investigationRow = evidence.slice(0, 3);
    components.push(new Discord.ActionRowBuilder().addComponents(...investigationRow));
  }

  const finalRow = [];
  if (evidence[3]) finalRow.push(evidence[3]);
  finalRow.push(new Discord.ButtonBuilder().setCustomId(`mod_dashboard:${target.id}:actions`).setLabel('Back').setEmoji('⬅️').setStyle(Discord.ButtonStyle.Secondary));
  if (report.access?.cases) finalRow.push(new Discord.ButtonBuilder().setCustomId(`mod_export_cases:${target.id}`).setLabel('Export').setEmoji('📤').setStyle(Discord.ButtonStyle.Secondary));
  components.push(new Discord.ActionRowBuilder().addComponents(...finalRow));
  report.components = components;
  return report;
}

function backRow(targetId) {
  return new Discord.ActionRowBuilder().addComponents(
    new Discord.ButtonBuilder().setCustomId(`mod_scan_view:${targetId}`).setLabel('⬅️ Back to Scan').setStyle(Discord.ButtonStyle.Secondary)
  );
}
async function resolveTarget(interaction, targetId) {
  return interaction.guild?.members?.cache?.get?.(targetId) || await interaction.guild?.members?.fetch?.(targetId).catch(() => null);
}
async function contextFor(interaction, targetId) {
  const target = await resolveTarget(interaction, targetId);
  if (!target) return { target: null, context: null };
  return { target, context: await buildContext(interaction.client, target, {}) };
}
function guildHistoryEmbed(target, context, client) {
  const guildRows = (context.guildHistory || []).slice(0, 12).map((item) => {
    const guild = client?.guilds?.cache?.get?.(item.guildId);
    const name = guild?.name || context.auditReport?.guilds?.find?.((entry) => String(entry.guildId) === String(item.guildId))?.guildName || `Guild ${item.guildId}`;
    const status = item.present ? '🟢 Current' : '⚪ Former';
    const mod = context.network?.rows?.find?.((entry) => String(entry.guildId) === String(item.guildId));
    return `**${name}** • ${status}\nFirst ${discordTime(item.firstSeenAt)} • Last ${discordTime(item.lastSeenAt)}${mod ? `\nCases **${mod.cases}** • Bans **${mod.bans}** • Timeouts **${mod.timeouts}**` : ''}`;
  });
  const externalRows = (context.reputationRecords || []).filter((record) => !record.reversedAt).slice(0, 10).map((record) => {
    const cfg = REPUTATION_SOURCE_TYPES[record.sourceType] || REPUTATION_SOURCE_TYPES.unverified;
    const source = record.sourceName || (record.sourceGuildId ? `Guild ${record.sourceGuildId}` : 'External source');
    const evidence = record.evidenceRef ? ` • Ref: ${record.evidenceRef}` : '';
    return `**${cfg.label} • ${String(record.eventType || 'other').toUpperCase()}**\n${source} • ${discordTime(record.createdAt)}${evidence}\n${String(record.reason || 'No summary').slice(0, 300)}`;
  });
  const rep = context.reputation || {};
  const sections = [
    `**Summary**\nObserved guilds **${context.guildHistory?.length || 0}** • Cross-guild cases **${context.network?.caseCount || 0}** • Network bans **${context.network?.banCount || 0}**\nExternal verified **${rep.verifiedExternal || 0}** • Submitted **${rep.submitted || 0}** • Unverified reports **${rep.unverified || 0}**`,
    `**Goliath-Observed Guild History**\n${guildRows.length ? guildRows.join('\n\n') : 'No stored Goliath guild-presence history yet.'}`,
    `**External / Submitted Intelligence**\n${externalRows.length ? externalRows.join('\n\n') : 'No external or submitted reputation records are stored.'}`,
  ];
  return new Discord.EmbedBuilder().setColor(0x5865F2).setTitle(`🌐 Network Reputation • ${target.user.tag}`).setDescription(sections.join('\n\n').slice(0, 4000)).setFooter({ text: 'Verified, submitted and unverified information are kept separate. No external report automatically blacklists a member.' }).setTimestamp();
}
function reputationRows(targetId, canManage = false) {
  const components = [];
  if (canManage) components.push(new Discord.ButtonBuilder().setCustomId(`mod_intel_reputation_add:${targetId}`).setLabel('Add External Record').setEmoji('➕').setStyle(Discord.ButtonStyle.Secondary));
  components.push(new Discord.ButtonBuilder().setCustomId(`mod_scan_view:${targetId}`).setLabel('⬅️ Back to Scan').setStyle(Discord.ButtonStyle.Secondary));
  return new Discord.ActionRowBuilder().addComponents(...components);
}
function reputationModal(targetId) {
  return new Discord.ModalBuilder().setCustomId(`mod_intel_reputation_submit:${targetId}`).setTitle('Add Network Reputation Record').addComponents(
    new Discord.ActionRowBuilder().addComponents(new Discord.TextInputBuilder().setCustomId('source_type').setLabel('Source class').setStyle(Discord.TextInputStyle.Short).setRequired(true).setPlaceholder('verified_external | submitted | unverified')),
    new Discord.ActionRowBuilder().addComponents(new Discord.TextInputBuilder().setCustomId('event_type').setLabel('Event').setStyle(Discord.TextInputStyle.Short).setRequired(true).setPlaceholder('ban | blacklist | kick | timeout | warning | report')),
    new Discord.ActionRowBuilder().addComponents(new Discord.TextInputBuilder().setCustomId('source_name').setLabel('Server / source name').setStyle(Discord.TextInputStyle.Short).setRequired(true).setMaxLength(120)),
    new Discord.ActionRowBuilder().addComponents(new Discord.TextInputBuilder().setCustomId('reason').setLabel('Reason / evidence summary').setStyle(Discord.TextInputStyle.Paragraph).setRequired(true).setMaxLength(1500)),
    new Discord.ActionRowBuilder().addComponents(new Discord.TextInputBuilder().setCustomId('evidence_ref').setLabel('Evidence / reference').setStyle(Discord.TextInputStyle.Short).setRequired(false).setMaxLength(500).setPlaceholder('Required for verified_external')),
  );
}
function riskEmbed(target, context) {
  return new Discord.EmbedBuilder().setColor(context.risk.score >= 70 ? 0xED4245 : context.risk.score >= 40 ? 0xF0A202 : 0x5865F2).setTitle(`📈 Risk Breakdown • ${target.user.tag}`).setDescription(`**${context.risk.score}/100 • ${context.risk.label}**\n\n${context.risk.reasons.length ? context.risk.reasons.map((item) => `**+${item.points}** • ${item.reason}`).join('\n') : 'No verified moderation-risk factors currently contribute to this score.'}\n\nHeuristic suspected-account correlation does **not** add risk unless it becomes verified evidence.`).setTimestamp();
}
function identityEmbed(target, context) {
  const identity = context.identity || {};
  const lines = [
    `**Current:** \`${target.user.username}\` • ${target.user.globalName || 'No global name'} • ${target.displayName}`,
    '',
    `**Known usernames (${identity.usernames?.length || 0})**\n${identity.usernames?.length ? identity.usernames.slice(0, 20).map((name) => `\`${name}\``).join(' • ') : 'None recorded.'}`,
    `**Known global/display names**\n${[...(identity.globalNames || []), ...(identity.displayNames || [])].length ? [...new Set([...(identity.globalNames || []), ...(identity.displayNames || [])])].slice(0, 20).map((name) => `\`${name}\``).join(' • ') : 'None recorded.'}`,
    `**Avatar history:** ${identity.avatarHashes?.length || 0} distinct stored hash(es)`,
  ];
  return new Discord.EmbedBuilder().setColor(0x5865F2).setTitle(`🪪 Identity History • ${target.user.tag}`).setDescription(lines.join('\n\n').slice(0, 4000)).setFooter({ text: 'Built from observations Goliath legitimately captured.' }).setTimestamp();
}
function behaviorEmbed(target, context) {
  const b = context.behavior; const lines = [];
  for (const [label, window] of [['7 Days', b.windows.d7], ['30 Days', b.windows.d30], ['90 Days', b.windows.d90], ['All Time', b.windows.all]]) {
    lines.push(`**${label}** • ${window.total} case(s)\nWarn ${window.counts.warn} • Timeout ${window.counts.timeout} • Kick ${window.counts.kick} • Ban ${window.counts.ban} • Moderators ${window.uniqueModerators} • Closed ${window.reversed} • Appeals ${window.appeals}`);
  }
  lines.push(`**Activity Trend:** ${String(b.trend).toUpperCase()} • last 30d ${b.windows.d30.total} vs previous 30d ${b.prior30}`);
  return new Discord.EmbedBuilder().setColor(0x5865F2).setTitle(`📊 Moderation Behaviour • ${target.user.tag}`).setDescription(lines.join('\n\n').slice(0, 4000)).setTimestamp();
}
function watchlistEmbed(target, context) {
  const watch = context.watch; const cfg = WATCH_STATES[watch.state] || WATCH_STATES.clear; const audit = getWatchAudit(target.id, 5);
  const history = audit.length ? audit.map((row) => `• ${String(row.before_state || 'clear')} → **${row.after_state}** • ${discordTime(row.created_at)} • ${row.reason || 'No reason'}`).join('\n') : 'No watchlist changes recorded.';
  return new Discord.EmbedBuilder().setColor(watch.state === 'blacklisted' ? 0xED4245 : watch.state === 'restricted' ? 0xF0A202 : 0x5865F2).setTitle(`🛡️ Goliath Watchlist • ${target.user.tag}`).setDescription([
    `**Status:** ${cfg.emoji} **${cfg.label}**`,
    `**Category:** ${watch.category || 'None'}`,
    `**Reason:** ${watch.reason || 'No active watchlist reason.'}`,
    `**Updated:** ${watch.updatedAt ? discordTime(watch.updatedAt) : 'Never'}`,
    `**Review:** ${watch.reviewAt ? discordTime(watch.reviewAt) : 'Not scheduled'}`,
    `**Expires:** ${watch.expiresAt ? discordTime(watch.expiresAt) : 'No expiry'}`,
    '',
    '**Recent History**', history,
  ].join('\n').slice(0, 4000)).setFooter({ text: 'Watchlist states are evidence-led Goliath records, not Discord-wide enforcement data.' }).setTimestamp();
}
function watchlistRows(targetId, canManage = false) {
  const rows = [];
  if (canManage) rows.push(new Discord.ActionRowBuilder().addComponents(
    new Discord.ButtonBuilder().setCustomId(`mod_intel_watch_set:${targetId}:watchlisted`).setLabel('Watchlist').setEmoji('👁️').setStyle(Discord.ButtonStyle.Secondary),
    new Discord.ButtonBuilder().setCustomId(`mod_intel_watch_set:${targetId}:restricted`).setLabel('Restrict').setEmoji('⚠️').setStyle(Discord.ButtonStyle.Secondary),
    new Discord.ButtonBuilder().setCustomId(`mod_intel_watch_set:${targetId}:blacklisted`).setLabel('Blacklist').setEmoji('⛔').setStyle(Discord.ButtonStyle.Danger),
    new Discord.ButtonBuilder().setCustomId(`mod_intel_watch_set:${targetId}:clear`).setLabel('Clear').setEmoji('✅').setStyle(Discord.ButtonStyle.Secondary),
  ));
  rows.push(backRow(targetId));
  return rows;
}
function watchModal(targetId, state) {
  const cfg = WATCH_STATES[state] || WATCH_STATES.clear;
  return new Discord.ModalBuilder().setCustomId(`mod_intel_watch_submit:${targetId}:${state}`).setTitle(`${cfg.label} Member`).addComponents(
    new Discord.ActionRowBuilder().addComponents(new Discord.TextInputBuilder().setCustomId('reason').setLabel('Reason / decision basis').setStyle(Discord.TextInputStyle.Paragraph).setMinLength(2).setMaxLength(1000).setRequired(true)),
    new Discord.ActionRowBuilder().addComponents(new Discord.TextInputBuilder().setCustomId('category').setLabel('Category').setStyle(Discord.TextInputStyle.Short).setMaxLength(80).setRequired(false).setPlaceholder('Safety, abuse, fraud, evasion, other...')),
    new Discord.ActionRowBuilder().addComponents(new Discord.TextInputBuilder().setCustomId('review_days').setLabel('Review in days (optional)').setStyle(Discord.TextInputStyle.Short).setMaxLength(4).setRequired(false).setPlaceholder('30')),
  );
}
async function reportWatchChange(interaction, targetId, change) {
  const event = change.after.state === 'clear' ? 'moderation.intelligence.watchlist.cleared' : 'moderation.intelligence.watchlist.updated';
  try {
    const { recordModerationSystemEvent } = require('./permissions');
    recordModerationSystemEvent({ interaction, event, action: 'intelligence_watchlist', targetId, reason: change.after.reason, before: change.before, after: change.after, metadata: { category: change.after.category, severity: change.after.severity } });
  } catch (error) { console.warn('[Member Intelligence] moderation audit failed:', error?.message || error); }
  try {
    if (change.after.state === 'blacklisted' || change.after.state === 'restricted' || change.before.state === 'blacklisted') {
      await sentinel.report(interaction.client, { module: 'moderation-intelligence', component: 'watchlist', severity: change.after.state === 'blacklisted' ? 'warning' : 'info', title: `Member intelligence ${change.after.state}`, summary: `User ${targetId}: ${change.before.state} → ${change.after.state}. ${change.after.reason || ''}`.slice(0, 1000), metadata: { guildId: interaction.guild?.id || null, actorId: interaction.user?.id || null, targetId, before: change.before.state, after: change.after.state } });
    }
  } catch (error) { console.warn('[Member Intelligence] Sentinel report failed:', error?.message || error); }
}

async function handleInteraction(interaction, { ensureCapability, canCapability } = {}) {
  const id = String(interaction?.customId || '');
  if (!id.startsWith('mod_intel_')) return false;
  const parts = id.split(':'); const action = parts[0]; const targetId = parts[1];
  if (!targetId) return false;
  const target = await resolveTarget(interaction, targetId);
  if (!target) { await safeReply(interaction, { content: '❌ Could not find that member in this server.', flags: 64 }); return true; }
  const need = async (capability, message) => typeof ensureCapability === 'function' ? ensureCapability(interaction, capability, message) : true;

  if (action === 'mod_intel_watch_set') {
    if (!(await need('scan_watch', '❌ You do not have permission to manage intelligence watchlist status.'))) return true;
    const state = parts[2]; if (!WATCH_STATES[state]) return true;
    await interaction.showModal(watchModal(targetId, state)); return true;
  }
  if (action === 'mod_intel_watch_submit' && interaction.isModalSubmit?.()) {
    if (!(await need('scan_watch', '❌ You do not have permission to manage intelligence watchlist status.'))) return true;
    const state = parts[2]; if (!WATCH_STATES[state]) return true;
    const reason = String(interaction.fields.getTextInputValue('reason') || '').trim();
    const category = String(interaction.fields.getTextInputValue('category') || '').trim() || null;
    const reviewRaw = String(interaction.fields.getTextInputValue('review_days') || '').trim();
    const reviewDays = reviewRaw ? clamp(Number(reviewRaw), 1, 3650) : null;
    const reviewAt = reviewDays ? new Date(Date.now() + reviewDays * 86400000).toISOString() : null;
    const change = setWatchlist({ userId: targetId, state, category, reason, sourceGuildId: interaction.guild.id, actorId: interaction.user.id, reviewAt });
    await reportWatchChange(interaction, targetId, change);
    const context = await buildContext(interaction.client, target, {});
    await safeUpdate(interaction, { content: null, embeds: [watchlistEmbed(target, context)], components: watchlistRows(targetId, true) });
    return true;
  }

  if (action === 'mod_intel_watchlist') {
    if (!(await need('scan_network', '❌ You do not have permission to view Goliath intelligence.'))) return true;
    const canManage = typeof canCapability === 'function' ? Boolean(canCapability(interaction, 'scan_watch')) : false;
    const context = await buildContext(interaction.client, target, {});
    await safeUpdate(interaction, { content: null, embeds: [watchlistEmbed(target, context)], components: watchlistRows(targetId, canManage) }); return true;
  }
  if (action === 'mod_intel_reputation_add') {
    if (!(await need('scan_links', '❌ You do not have permission to add external intelligence records.'))) return true;
    await interaction.showModal(reputationModal(targetId)); return true;
  }
  if (action === 'mod_intel_reputation_submit' && interaction.isModalSubmit?.()) {
    if (!(await need('scan_links', '❌ You do not have permission to add external intelligence records.'))) return true;
    try {
      const record = addReputationRecord({
        userId: targetId,
        sourceType: String(interaction.fields.getTextInputValue('source_type') || '').trim().toLowerCase(),
        eventType: String(interaction.fields.getTextInputValue('event_type') || '').trim().toLowerCase(),
        sourceName: String(interaction.fields.getTextInputValue('source_name') || '').trim(),
        reason: String(interaction.fields.getTextInputValue('reason') || '').trim(),
        evidenceRef: String(interaction.fields.getTextInputValue('evidence_ref') || '').trim() || null,
        sourceGuildId: interaction.guild.id,
        actorId: interaction.user.id,
        metadata: { enteredFromGuildId: interaction.guild.id },
      });
      try {
        const { recordModerationSystemEvent } = require('./permissions');
        recordModerationSystemEvent({ interaction, event: 'moderation.intelligence.reputation.added', action: 'intelligence_reputation', targetId, reason: record?.reason || null, after: record });
      } catch {}
      if (record?.sourceType === 'verified_external' && ['ban', 'blacklist'].includes(record.eventType)) {
        await sentinel.report(interaction.client, { module: 'moderation-intelligence', component: 'network-reputation', severity: 'warning', title: `Verified external ${record.eventType} record added`, summary: `User ${targetId} • ${record.sourceName || 'External source'} • ${record.reason || ''}`.slice(0, 1000), metadata: { guildId: interaction.guild.id, actorId: interaction.user.id, targetId, recordId: record.id, sourceType: record.sourceType, eventType: record.eventType } }).catch(() => null);
      }
      const context = await buildContext(interaction.client, target, {});
      await safeUpdate(interaction, { content: null, embeds: [guildHistoryEmbed(target, context, interaction.client)], components: [reputationRows(targetId, true)] });
    } catch (error) {
      await safeReply(interaction, { content: `❌ ${String(error?.message || error).slice(0, 1500)}`, flags: 64 });
    }
    return true;
  }
  if (action === 'mod_intel_guilds') {
    if (!(await need('scan_network', '❌ You do not have permission to view cross-guild intelligence.'))) return true;
    const canManage = typeof canCapability === 'function' ? Boolean(canCapability(interaction, 'scan_links')) : false;
    const context = await buildContext(interaction.client, target, {});
    await safeUpdate(interaction, { content: null, embeds: [guildHistoryEmbed(target, context, interaction.client)], components: [reputationRows(targetId, canManage)] }); return true;
  }
  if (action === 'mod_intel_risk') {
    if (!(await need('scan_network', '❌ You do not have permission to view intelligence risk details.'))) return true;
    const context = await buildContext(interaction.client, target, {});
    await safeUpdate(interaction, { content: null, embeds: [riskEmbed(target, context)], components: [backRow(targetId)] }); return true;
  }
  if (action === 'mod_intel_identity') {
    if (!(await need('scan_history', '❌ You do not have permission to view identity history.'))) return true;
    const context = await buildContext(interaction.client, target, {});
    await safeUpdate(interaction, { content: null, embeds: [identityEmbed(target, context)], components: [backRow(targetId)] }); return true;
  }
  if (action === 'mod_intel_behavior') {
    if (!(await need('scan_network', '❌ You do not have permission to view moderation behaviour intelligence.'))) return true;
    const context = await buildContext(interaction.client, target, {});
    await safeUpdate(interaction, { content: null, embeds: [behaviorEmbed(target, context)], components: [backRow(targetId)] }); return true;
  }
  return false;
}

module.exports = {
  WATCH_STATES,
  observeJoin,
  observeLeave,
  observeUpdate,
  observeUserUpdate,
  observeScan,
  getGuildHistory,
  getIdentityHistory,
  getWatchlist,
  setWatchlist,
  getWatchAudit,
  getConfirmedLinks,
  addConfirmedLink,
  getReputationRecords,
  addReputationRecord,
  summarizeReputation,
  getBehavior,
  getNetworkModeration,
  calculateRisk,
  buildContext,
  decorateScan,
  handleInteraction,
};
