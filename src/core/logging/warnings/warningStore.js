const db = require('../stores/moderationStore');

function mapWarning(row) {
  if (!row) return null;

  return {
    id: row.id,
    guildId: row.guild_id,
    userId: row.user_id,
    moderatorId: row.moderator_id,
    reason: row.reason,
    caseId: row.case_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

function addWarning({
  guildId,
  userId,
  moderatorId,
  reason = 'No reason provided',
  caseId,
  expiresAt = null,
}) {
  const normalizedCaseId = Number(caseId);
  if (!Number.isInteger(normalizedCaseId) || normalizedCaseId <= 0) {
    throw new Error('Warning case ID must be a positive integer.');
  }

  const createdAt = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO warnings (
      guild_id, user_id, moderator_id, reason, case_id, created_at, expires_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    guildId,
    userId,
    moderatorId,
    reason,
    normalizedCaseId,
    createdAt,
    expiresAt
  );

  return getWarningById(result.lastInsertRowid);
}

function getWarningById(id) {
  const stmt = db.prepare(`
    SELECT * FROM warnings
    WHERE id = ?
  `);

  return mapWarning(stmt.get(Number(id)));
}

function purgeExpiredWarnings(guildId) {
  const nowIso = new Date().toISOString();

  const expiredStmt = db.prepare(`
    SELECT * FROM warnings
    WHERE guild_id = ?
      AND expires_at IS NOT NULL
      AND expires_at <= ?
  `);

  const expired = expiredStmt.all(guildId, nowIso).map(mapWarning);

  const deleteStmt = db.prepare(`
    DELETE FROM warnings
    WHERE guild_id = ?
      AND expires_at IS NOT NULL
      AND expires_at <= ?
  `);

  deleteStmt.run(guildId, nowIso);

  return expired;
}

function getWarningsForUser(guildId, userId) {
  purgeExpiredWarnings(guildId);

  const stmt = db.prepare(`
    SELECT * FROM warnings
    WHERE guild_id = ? AND user_id = ?
    ORDER BY datetime(created_at) DESC
  `);

  return stmt.all(guildId, userId).map(mapWarning);
}

function getWarningCountForUser(guildId, userId) {
  purgeExpiredWarnings(guildId);

  const stmt = db.prepare(`
    SELECT COUNT(*) AS count
    FROM warnings
    WHERE guild_id = ? AND user_id = ?
  `);

  return stmt.get(guildId, userId).count;
}

function getWarningByCaseId(guildId, caseId) {
  purgeExpiredWarnings(guildId);

  const stmt = db.prepare(`
    SELECT * FROM warnings
    WHERE guild_id = ? AND case_id = ?
  `);

  return mapWarning(stmt.get(guildId, Number(caseId)));
}

function deleteWarningByCaseId(guildId, caseId) {
  purgeExpiredWarnings(guildId);

  const stmt = db.prepare(`
    DELETE FROM warnings
    WHERE guild_id = ? AND case_id = ?
  `);

  const result = stmt.run(guildId, Number(caseId));
  return result.changes > 0;
}

module.exports = {
  addWarning,
  getWarningById,
  getWarningsForUser,
  getWarningCountForUser,
  getWarningByCaseId,
  deleteWarningByCaseId,
  purgeExpiredWarnings,
};
