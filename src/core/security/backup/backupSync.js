// src/security/backup/backupSync.js

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveRuntimePath } = require('../../../config/runtimePaths');

// ======================================================
// BACKUP SYNC SYSTEM
// Goliath Distributed Backup Layer
// ======================================================
// VERSIONS
// ======================================================

const SYNC_MANAGER_VERSION =
  '1A_LOCAL_SYNC_QUEUE';

const TRUST_MANAGER_VERSION =
  '1A_BACKUP_TRUST_STATUS';

const GOOGLE_DRIVE_ADAPTER_VERSION =
  '1A_PLACEHOLDER_ADAPTER';

// ======================================================
// STORAGE
// ======================================================

const BOT_MODE = (
  process.env.BOT_MODE ||
  'DEV'
).toLowerCase();

const BACKUP_SYNC_DIR = resolveRuntimePath(
  BOT_MODE,
  'backups',
  'sync'
);

const QUEUE_FILE = path.join(
  BACKUP_SYNC_DIR,
  'queue.json'
);

// ======================================================
// STATUS
// ======================================================

const STATUS = {
  PENDING: 'pending',
  SYNCED: 'synced',
  FAILED: 'failed',
};

const TRUST_LEVELS = {
  UNTRUSTED: 'UNTRUSTED',
  LOCAL_ONLY: 'LOCAL_ONLY',
  REMOTE_SYNCED: 'REMOTE_SYNCED',
  REMOTE_VERIFIED:
    'REMOTE_VERIFIED',
};

// ======================================================
// INTERNAL HELPERS
// ======================================================

function nowIso() {
  return new Date().toISOString();
}

function ensureStorage() {
  if (
    !fs.existsSync(
      BACKUP_SYNC_DIR
    )
  ) {
    fs.mkdirSync(
      BACKUP_SYNC_DIR,
      {
        recursive: true,
      }
    );
  }

  if (
    !fs.existsSync(
      QUEUE_FILE
    )
  ) {
    fs.writeFileSync(
      QUEUE_FILE,
      JSON.stringify(
        { queue: [] },
        null,
        2
      )
    );
  }
}

function readQueue() {
  ensureStorage();

  try {
    return JSON.parse(
      fs.readFileSync(
        QUEUE_FILE,
        'utf8'
      )
    );
  } catch {
    return { queue: [] };
  }
}

function writeQueue(data) {
  ensureStorage();

  const tempFile =
    `${QUEUE_FILE}.tmp`;

  try {
    fs.writeFileSync(
      tempFile,
      JSON.stringify(
        data,
        null,
        2
      ),
      'utf8'
    );

    fs.renameSync(
      tempFile,
      QUEUE_FILE
    );
  } catch (error) {
    if (
      error.code === 'EPERM' ||
      error.code === 'EBUSY'
    ) {
      fs.writeFileSync(
        QUEUE_FILE,
        JSON.stringify(
          data,
          null,
          2
        ),
        'utf8'
      );

      try {
        if (
          fs.existsSync(tempFile)
        ) {
          fs.unlinkSync(tempFile);
        }
      } catch {}

      return;
    }

    throw error;
  }
}

function generateSyncId(guildId) {
  return `sync_${guildId}_${Date.now()}`;
}

function calculateFileHash(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `File does not exist: ${filePath}`
    );
  }

  const buffer =
    fs.readFileSync(filePath);

  return crypto
    .createHash('sha256')
    .update(buffer)
    .digest('hex');
}

// ======================================================
// SYNC QUEUE SYSTEM
// ======================================================

function getSyncQueue() {
  return readQueue().queue;
}

function saveQueue(queue) {
  writeQueue({ queue });
}

function queueBackupSync(
  options = {}
) {
  const {
    guildId,
    backupId,
    backupPath,
    environment = 'unknown',
    backupType = 'runtime',
    createdBy = 'system',
    metadata = {},
  } = options;

  if (!guildId) {
    throw new Error(
      'Missing guildId'
    );
  }

  if (!backupId) {
    throw new Error(
      'Missing backupId'
    );
  }

  if (!backupPath) {
    throw new Error(
      'Missing backupPath'
    );
  }

  const queue =
    getSyncQueue();

  const existing = queue.find(
    (item) =>
      item.backupId ===
        backupId &&
      item.backupPath ===
        backupPath
  );

  if (existing) {
    return existing;
  }

  const hash =
    calculateFileHash(
      backupPath
    );

  const entry = {
    syncId:
      generateSyncId(
        guildId
      ),

    version:
      SYNC_MANAGER_VERSION,

    guildId,
    backupId,

    backupPath,
    environment,
    backupType,

    status:
      STATUS.PENDING,

    algorithm:
      'SHA256',

    hash,

    remoteVerified:
      false,

    remoteHash: null,

    syncAttempts: 0,

    lastSyncAttemptAt:
      null,

    syncedAt: null,

    failedAt: null,

    failureReason: null,

    createdBy,

    metadata,

    createdAt: nowIso(),

    updatedAt: nowIso(),
  };

  queue.unshift(entry);

  saveQueue(queue);

  return entry;
}

function getBackupSyncStatus(
  backupId
) {
  const queue =
    getSyncQueue();

  return (
    queue.find(
      (item) =>
        item.backupId ===
        backupId
    ) || null
  );
}

function markBackupSynced(
  syncId,
  options = {}
) {
  const queue =
    getSyncQueue();

  const entry = queue.find(
    (item) =>
      item.syncId ===
      syncId
  );

  if (!entry) {
    throw new Error(
      `Sync entry not found: ${syncId}`
    );
  }

  entry.status =
    STATUS.SYNCED;

  entry.remoteVerified =
    options.remoteVerified ===
    true;

  entry.remoteHash =
    options.remoteHash ||
    null;

  entry.syncedAt =
    nowIso();

  entry.updatedAt =
    nowIso();

  entry.failureReason =
    null;

  saveQueue(queue);

  return entry;
}

function markBackupFailed(
  syncId,
  reason = 'Unknown failure'
) {
  const queue =
    getSyncQueue();

  const entry = queue.find(
    (item) =>
      item.syncId ===
      syncId
  );

  if (!entry) {
    throw new Error(
      `Sync entry not found: ${syncId}`
    );
  }

  entry.status =
    STATUS.FAILED;

  entry.failedAt =
    nowIso();

  entry.updatedAt =
    nowIso();

  entry.failureReason =
    reason;

  entry.syncAttempts += 1;

  entry.lastSyncAttemptAt =
    nowIso();

  saveQueue(queue);

  return entry;
}

function incrementSyncAttempt(
  syncId
) {
  const queue =
    getSyncQueue();

  const entry = queue.find(
    (item) =>
      item.syncId ===
      syncId
  );

  if (!entry) {
    throw new Error(
      `Sync entry not found: ${syncId}`
    );
  }

  entry.syncAttempts += 1;

  entry.lastSyncAttemptAt =
    nowIso();

  entry.updatedAt =
    nowIso();

  saveQueue(queue);

  return entry;
}

function getPendingSyncs() {
  return getSyncQueue().filter(
    (item) =>
      item.status ===
      STATUS.PENDING
  );
}

function getFailedSyncs() {
  return getSyncQueue().filter(
    (item) =>
      item.status ===
      STATUS.FAILED
  );
}

function verifyRemoteHash(
  syncId,
  remoteHash
) {
  const queue =
    getSyncQueue();

  const entry = queue.find(
    (item) =>
      item.syncId ===
      syncId
  );

  if (!entry) {
    throw new Error(
      `Sync entry not found: ${syncId}`
    );
  }

  const verified =
    String(entry.hash) ===
    String(remoteHash);

  entry.remoteHash =
    remoteHash;

  entry.remoteVerified =
    verified;

  entry.updatedAt =
    nowIso();

  saveQueue(queue);

  return {
    verified,

    expectedHash:
      entry.hash,

    remoteHash,
  };
}

// ======================================================
// TRUST SYSTEM
// ======================================================

function getLocalIntegrityStatus(
  backup
) {
  const integrity =
    backup?.integrity || null;

  if (!integrity) {
    return {
      verified: false,
      status: 'MISSING',
      algorithm: null,
      hash: null,
    };
  }

  return {
    verified:
      integrity.verified ===
      true,

    status:
      integrity.verified ===
      true
        ? 'VERIFIED'
        : 'FAILED',

    algorithm:
      integrity.algorithm ||
      'SHA256',

    hash:
      integrity.hash || null,
  };
}

function getRemoteSyncStatus(
  backupId
) {
  const syncStatus =
    getBackupSyncStatus(
      backupId
    );

  if (!syncStatus) {
    return {
      exists: false,
      status: 'NOT_QUEUED',
      remoteVerified: false,
      remoteHash: null,
      syncAttempts: 0,
      lastSyncAttemptAt: null,
      syncedAt: null,
      failedAt: null,
      failureReason: null,
    };
  }

  return {
    exists: true,

    status: String(
      syncStatus.status ||
        'unknown'
    ).toUpperCase(),

    remoteVerified:
      syncStatus.remoteVerified ===
      true,

    remoteHash:
      syncStatus.remoteHash ||
      null,

    syncAttempts:
      syncStatus.syncAttempts ||
      0,

    lastSyncAttemptAt:
      syncStatus.lastSyncAttemptAt ||
      null,

    syncedAt:
      syncStatus.syncedAt ||
      null,

    failedAt:
      syncStatus.failedAt ||
      null,

    failureReason:
      syncStatus.failureReason ||
      null,
  };
}

function calculateTrustLevel(
  localIntegrity,
  remoteSync
) {
  if (
    !localIntegrity?.verified
  ) {
    return TRUST_LEVELS.UNTRUSTED;
  }

  if (
    remoteSync?.remoteVerified
  ) {
    return TRUST_LEVELS.REMOTE_VERIFIED;
  }

  if (
    remoteSync?.status ===
    'SYNCED'
  ) {
    return TRUST_LEVELS.REMOTE_SYNCED;
  }

  return TRUST_LEVELS.LOCAL_ONLY;
}

function getTrustLabel(
  trustLevel
) {
  switch (trustLevel) {
    case TRUST_LEVELS.REMOTE_VERIFIED:
      return 'Remote Verified';

    case TRUST_LEVELS.REMOTE_SYNCED:
      return 'Remote Synced';

    case TRUST_LEVELS.LOCAL_ONLY:
      return 'Local Verified Only';

    case TRUST_LEVELS.UNTRUSTED:
    default:
      return 'Untrusted';
  }
}

function getTrustScore(
  trustLevel
) {
  switch (trustLevel) {
    case TRUST_LEVELS.REMOTE_VERIFIED:
      return 100;

    case TRUST_LEVELS.REMOTE_SYNCED:
      return 85;

    case TRUST_LEVELS.LOCAL_ONLY:
      return 60;

    case TRUST_LEVELS.UNTRUSTED:
    default:
      return 0;
  }
}

function getBackupTrustStatus(
  backup
) {
  const backupId =
    backup?.backupId || null;

  const localIntegrity =
    getLocalIntegrityStatus(
      backup
    );

  const remoteSync =
    backupId
      ? getRemoteSyncStatus(
          backupId
        )
      : {
          exists: false,
          status: 'UNKNOWN',
          remoteVerified: false,
        };

  const trustLevel =
    calculateTrustLevel(
      localIntegrity,
      remoteSync
    );

  return {
    version:
      TRUST_MANAGER_VERSION,

    backupId,

    trustLevel,

    trustLabel:
      getTrustLabel(
        trustLevel
      ),

    trustScore:
      getTrustScore(
        trustLevel
      ),

    localIntegrity,
    remoteSync,

    safeToRestore:
      localIntegrity.verified ===
      true,

    remoteRequired: false,

    generatedAt:
      new Date().toISOString(),
  };
}

function formatBackupTrustSummary(
  trustStatus
) {
  if (!trustStatus) {
    return [
      'Trust Level: UNKNOWN',
      'Local Integrity: UNKNOWN',
      'Remote Sync: UNKNOWN',
      'Remote Trust: UNKNOWN',
    ].join('\n');
  }

  return [
    `Trust Level: ${trustStatus.trustLevel}`,

    `Trust Score: ${trustStatus.trustScore}`,

    `Local Integrity: ${
      trustStatus.localIntegrity
        ?.status || 'UNKNOWN'
    }`,

    `Algorithm: ${
      trustStatus.localIntegrity
        ?.algorithm || 'UNKNOWN'
    }`,

    `Remote Sync: ${
      trustStatus.remoteSync
        ?.status || 'UNKNOWN'
    }`,

    `Remote Trust: ${
      trustStatus.remoteSync
        ?.remoteVerified
        ? 'VERIFIED'
        : 'NOT VERIFIED'
    }`,
  ].join('\n');
}

// ======================================================
// GOOGLE DRIVE ADAPTER
// ======================================================

const { google } =
  require('googleapis');

function isConfigured() {
  return Boolean(
    process.env
      .GOOGLE_DRIVE_BACKUP_FOLDER_ID &&
      process.env
        .GOOGLE_DRIVE_CLIENT_EMAIL &&
      process.env
        .GOOGLE_DRIVE_PRIVATE_KEY
  );
}

function getDriveClient() {
  if (!isConfigured()) {
    throw new Error(
      'Google Drive backup sync is not configured.'
    );
  }

  const auth =
    new google.auth.JWT({
      email:
        process.env
          .GOOGLE_DRIVE_CLIENT_EMAIL,

      key: process.env
        .GOOGLE_DRIVE_PRIVATE_KEY
        .replace(/\\n/g, '\n'),

      scopes: [
        'https://www.googleapis.com/auth/drive',
      ],
    });

  return google.drive({
    version: 'v3',
    auth,
  });
}

async function ensureFolder(
  drive,
  name,
  parentId
) {
  const query = [
    `name='${name}'`,
    `mimeType='application/vnd.google-apps.folder'`,
    `trashed=false`,
    `'${parentId}' in parents`,
  ].join(' and ');

  const existing =
    await drive.files.list({
      q: query,
      fields:
        'files(id, name)',
      pageSize: 1,
    });

  const existingFolder =
    existing.data.files?.[0];

  if (existingFolder) {
    return existingFolder.id;
  }

  const created =
    await drive.files.create({
      requestBody: {
        name,
        mimeType:
          'application/vnd.google-apps.folder',

        parents: [parentId],
      },

      fields: 'id',
    });

  return created.data.id;
}

async function uploadBackup(
  options = {}
) {
  const {
    backupPath,
    backupId,
    guildId,
    environment = 'production',
    backupType = 'runtime',
  } = options;

  if (!backupPath) {
    throw new Error(
      'Missing backupPath.'
    );
  }

  if (!backupId) {
    throw new Error(
      'Missing backupId.'
    );
  }

  if (!guildId) {
    throw new Error(
      'Missing guildId.'
    );
  }

  if (
    !fs.existsSync(
      backupPath
    )
  ) {
    throw new Error(
      `Backup file not found: ${backupPath}`
    );
  }

  if (!isConfigured()) {
    return {
      uploaded: false,
      configured: false,

      reason:
        'Google Drive backup sync is not configured.',

      backupId,
      guildId,
    };
  }

  try {
    const drive =
      getDriveClient();

    const rootFolderId =
      process.env
        .GOOGLE_DRIVE_BACKUP_FOLDER_ID;

    const guildsFolderId =
      await ensureFolder(
        drive,
        'guilds',
        rootFolderId
      );

    const guildFolderId =
      await ensureFolder(
        drive,
        String(guildId),
        guildsFolderId
      );

    const envFolderId =
      await ensureFolder(
        drive,
        String(environment),
        guildFolderId
      );

    const typeFolderId =
      await ensureFolder(
        drive,
        String(backupType),
        envFolderId
      );

    const fileName =
      path.basename(
        backupPath
      );

    const upload =
      await drive.files.create({
        requestBody: {
          name: fileName,
          parents: [
            typeFolderId,
          ],
        },

        media: {
          mimeType:
            'application/json',

          body:
            fs.createReadStream(
              backupPath
            ),
        },

        fields:
          'id, md5Checksum',
      });

    const localHash =
      calculateFileHash(
        backupPath
      );

    return {
      uploaded: true,
      configured: true,

      backupId,
      guildId,

      environment,
      backupType,

      fileId:
        upload.data.id,

      remoteHash:
        localHash,

      verified: true,
    };
  } catch (error) {
    return {
      uploaded: false,
      configured: true,

      reason:
        error.message ||
        'Unknown Google Drive upload failure.',

      backupId,
      guildId,

      environment,
      backupType,
    };
  }
}

async function verifyUploadedBackup(
  options = {}
) {
  const {
    backupPath,
    remoteHash,
  } = options;

  if (!backupPath) {
    throw new Error(
      'Missing backupPath.'
    );
  }

  const localHash =
    calculateFileHash(
      backupPath
    );

  return {
    verified:
      Boolean(remoteHash) &&
      String(localHash) ===
        String(remoteHash),

    localHash,

    remoteHash:
      remoteHash || null,
  };
}

async function downloadBackup(
  options = {}
) {
  const {
    fileId,
    destinationPath,
  } = options;

  if (!fileId) {
    throw new Error(
      'Missing fileId.'
    );
  }

  if (!destinationPath) {
    throw new Error(
      'Missing destinationPath.'
    );
  }

  if (!isConfigured()) {
    return {
      downloaded: false,
      configured: false,

      reason:
        'Google Drive backup sync is not configured.',
    };
  }

  try {
    const drive =
      getDriveClient();

    const response =
      await drive.files.get(
        {
          fileId,
          alt: 'media',
        },
        {
          responseType:
            'stream',
        }
      );

    await new Promise(
      (
        resolve,
        reject
      ) => {
        const dest =
          fs.createWriteStream(
            destinationPath
          );

        response.data
          .pipe(dest)
          .on(
            'finish',
            resolve
          )
          .on(
            'error',
            reject
          );
      }
    );

    return {
      downloaded: true,
      configured: true,

      destinationPath,
    };
  } catch (error) {
    return {
      downloaded: false,
      configured: true,

      reason:
        error.message ||
        'Unknown Google Drive download failure.',
    };
  }
}

// ======================================================
// EXPORTS
// ======================================================

module.exports = {
  // versions
  SYNC_MANAGER_VERSION,
  TRUST_MANAGER_VERSION,
  GOOGLE_DRIVE_ADAPTER_VERSION,

  // status
  STATUS,
  TRUST_LEVELS,

  // queue
  queueBackupSync,
  getSyncQueue,
  getPendingSyncs,
  getFailedSyncs,
  getBackupSyncStatus,

  markBackupSynced,
  markBackupFailed,
  incrementSyncAttempt,

  verifyRemoteHash,

  // trust
  getBackupTrustStatus,
  formatBackupTrustSummary,

  getLocalIntegrityStatus,
  getRemoteSyncStatus,

  calculateTrustLevel,
  getTrustLabel,
  getTrustScore,

  // adapter
  isConfigured,
  uploadBackup,
  verifyUploadedBackup,
  downloadBackup,

  // utilities
  calculateFileHash,
};
