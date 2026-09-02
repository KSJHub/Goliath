'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { resolveBotMode, resolveRuntimePath } = require('../../../config/runtimePaths');

const VALID_BACKUP_TYPES = new Set([
  'scheduled',
  'runtime',
  'rollback',
  'integrity',
  'sync',
]);

const HASH_ALGORITHM = 'sha256';
const INTEGRITY_VERSION = '1A_INTEGRITY_SYSTEM';

function normalizeJson(data) {
  return JSON.stringify(data, null, 2);
}

function ensureFileExists(filePath, label = 'File') {
  if (!filePath) throw new Error(`${label} path is required`);
  if (!fs.existsSync(filePath)) throw new Error(`${label} not found: ${filePath}`);
  return true;
}

function readJsonFileSafe(filePath, corruptedReason) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return { success: true, data: JSON.parse(raw), raw };
  } catch (error) {
    return { success: false, reason: corruptedReason, error: error.message };
  }
}

function normaliseEnvironment(environment) {
  return resolveBotMode(environment).toUpperCase();
}

function getBackupRoot(environment) {
  return resolveRuntimePath(environment, 'backups');
}

function getGuildBackupRoot({ environment, guildId }) {
  if (!guildId) throw new Error('getGuildBackupRoot requires guildId');
  return path.join(getBackupRoot(environment), String(guildId));
}

function getBackupDir({ environment, guildId, backupType }) {
  if (!VALID_BACKUP_TYPES.has(backupType)) {
    throw new Error(`Invalid backup type: ${backupType}`);
  }

  return path.join(getGuildBackupRoot({ environment, guildId }), backupType);
}

function ensureBackupDir({ environment, guildId, backupType }) {
  const directory = getBackupDir({ environment, guildId, backupType });
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function ensureGuildBackupStructure({ environment, guildId }) {
  const created = {};

  for (const backupType of VALID_BACKUP_TYPES) {
    created[backupType] = ensureBackupDir({ environment, guildId, backupType });
  }

  return created;
}

function generateHash(content) {
  return crypto.createHash(HASH_ALGORITHM).update(content).digest('hex');
}

function getIntegrityPath(backupPath) {
  return `${backupPath}.integrity.json`;
}

function createIntegrityRecord({
  backupId,
  environment,
  guildId,
  backupType = 'runtime',
  backupPath,
  backupData,
}) {
  ensureFileExists(backupPath, 'Backup file');

  const normalized = normalizeJson(backupData);
  const hash = generateHash(normalized);
  const stats = fs.statSync(backupPath);

  return {
    version: INTEGRITY_VERSION,
    backup: {
      id: backupId,
      type: backupType,
      environment: normaliseEnvironment(environment),
      guildId,
      path: backupPath,
    },
    integrity: {
      algorithm: HASH_ALGORITHM,
      hash,
      size: stats.size,
      generatedAt: new Date().toISOString(),
    },
  };
}

function writeIntegrityFile({
  backupId,
  environment,
  guildId,
  backupType,
  backupPath,
  backupData,
}) {
  ensureFileExists(backupPath, 'Backup file');

  const integrityRecord = createIntegrityRecord({
    backupId,
    environment,
    guildId,
    backupType,
    backupPath,
    backupData,
  });
  const integrityPath = getIntegrityPath(backupPath);

  fs.writeFileSync(integrityPath, JSON.stringify(integrityRecord, null, 2), 'utf8');

  return { success: true, integrityPath, integrityRecord };
}

function validateBackupIntegrity(backupPath) {
  if (!fs.existsSync(backupPath)) {
    return { valid: false, reason: 'BACKUP_FILE_MISSING', backupPath };
  }

  const integrityPath = getIntegrityPath(backupPath);
  if (!fs.existsSync(integrityPath)) {
    return { valid: false, reason: 'INTEGRITY_FILE_MISSING', backupPath, integrityPath };
  }

  const backupRead = readJsonFileSafe(backupPath, 'CORRUPTED_BACKUP_JSON');
  if (!backupRead.success) {
    return {
      valid: false,
      reason: backupRead.reason,
      backupPath,
      integrityPath,
      error: backupRead.error,
    };
  }

  const integrityRead = readJsonFileSafe(integrityPath, 'CORRUPTED_INTEGRITY_JSON');
  if (!integrityRead.success) {
    return {
      valid: false,
      reason: integrityRead.reason,
      backupPath,
      integrityPath,
      error: integrityRead.error,
    };
  }

  const currentHash = generateHash(normalizeJson(backupRead.data));
  const storedHash = integrityRead.data?.integrity?.hash;
  const valid = currentHash === storedHash;

  return {
    valid,
    reason: valid ? 'VALID' : 'HASH_MISMATCH',
    backupPath,
    integrityPath,
    algorithm: HASH_ALGORITHM,
    currentHash,
    storedHash,
    generatedAt: integrityRead.data?.integrity?.generatedAt || null,
    metadata: integrityRead.data?.backup || {},
  };
}

module.exports = {
  VALID_BACKUP_TYPES,
  normaliseEnvironment,
  getBackupRoot,
  getGuildBackupRoot,
  getBackupDir,
  ensureBackupDir,
  ensureGuildBackupStructure,
  HASH_ALGORITHM,
  INTEGRITY_VERSION,
  generateHash,
  writeIntegrityFile,
  validateBackupIntegrity,
  getIntegrityPath,
  normalizeJson,
  ensureFileExists,
};
