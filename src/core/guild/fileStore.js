const fs = require('node:fs');
const path = require('node:path');

const EXPECTED_WINDOWS_SYNC_ERRORS = new Set(['EPERM', 'EBUSY']);
const warnedSyncPaths = new Set();
let writeSequence = 0;

function clone(value) {
  try {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== 'object') return value;

  return Object.keys(value)
    .sort((a, b) => a.localeCompare(b))
    .reduce((sorted, key) => {
      sorted[key] = sortKeys(value[key]);
      return sorted;
    }, {});
}

function ensureDir(dirPath) {
  if (!dirPath || typeof dirPath !== 'string') return false;

  fs.mkdirSync(dirPath, { recursive: true });
  return true;
}

function read(filePath, fallback = {}) {
  if (!filePath || typeof filePath !== 'string') return clone(fallback);
  if (!fs.existsSync(filePath)) return clone(fallback);

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw || !raw.trim()) return clone(fallback);

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : clone(fallback);
  } catch (error) {
    console.error(`[fileStore] Failed to read file: ${filePath}`, error);
    throw error;
  }
}

function validateJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw || !raw.trim()) throw new Error('JSON file is empty after write.');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSON root is not an object.');
  }
  return true;
}

function syncFile(filePath) {
  let fd;

  try {
    // Windows' FlushFileBuffers requires a handle opened with write access.
    // A read-only descriptor can surface EPERM on OneDrive-backed paths even
    // though the file itself is writable, so use r+ there without truncation.
    fd = fs.openSync(filePath, process.platform === 'win32' ? 'r+' : 'r');
    fs.fsyncSync(fd);
    return true;
  } catch (error) {
    const expectedWindowsLock = process.platform === 'win32' && EXPECTED_WINDOWS_SYNC_ERRORS.has(error?.code);
    if (!expectedWindowsLock) throw error;

    if (!warnedSyncPaths.has(filePath)) {
      warnedSyncPaths.add(filePath);
      console.warn(`[fileStore] Durability sync skipped for OneDrive-locked file: ${filePath} (${error.code})`);
    }

    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function tempPathFor(filePath, purpose = 'write') {
  writeSequence = (writeSequence + 1) % Number.MAX_SAFE_INTEGER;
  return `${filePath}.${purpose}.${process.pid}.${Date.now()}.${writeSequence}.tmp`;
}

function restoreBackup(filePath, backupPath = `${filePath}.bak`) {
  if (!filePath || typeof filePath !== 'string') return false;
  if (!backupPath || typeof backupPath !== 'string' || !fs.existsSync(backupPath)) return false;

  validateJsonFile(backupPath);
  ensureDir(path.dirname(filePath));

  const restoreTempPath = tempPathFor(filePath, 'restore');
  try {
    fs.copyFileSync(backupPath, restoreTempPath);
    validateJsonFile(restoreTempPath);
    syncFile(restoreTempPath);

    try {
      fs.renameSync(restoreTempPath, filePath);
    } catch (error) {
      if (error.code !== 'EPERM' && error.code !== 'EBUSY') throw error;
      fs.copyFileSync(backupPath, filePath);
      validateJsonFile(filePath);
      syncFile(filePath);
      try {
        if (fs.existsSync(restoreTempPath)) fs.unlinkSync(restoreTempPath);
      } catch {}
    }

    validateJsonFile(filePath);
    return true;
  } catch (error) {
    console.error(`[fileStore] Failed to restore backup: ${backupPath} -> ${filePath}`, error);
    try {
      if (fs.existsSync(restoreTempPath)) fs.unlinkSync(restoreTempPath);
    } catch {}
    return false;
  }
}

function write(filePath, data = {}) {
  if (!filePath || typeof filePath !== 'string') return false;

  ensureDir(path.dirname(filePath));

  // Every write gets its own staging paths. A shared `${filePath}.tmp` allowed
  // overlapping runtime processes/restarts to rename or delete another writer's
  // temporary file, producing ENOENT and occasionally breaking the backup step.
  const tempPath = tempPathFor(filePath, 'write');
  const backupPath = `${filePath}.bak`;
  const backupTempPath = tempPathFor(filePath, 'backup');
  const json = JSON.stringify(sortKeys(data ?? {}), null, 2);
  const hadExisting = fs.existsSync(filePath);

  try {
    fs.writeFileSync(tempPath, json, 'utf8');
    validateJsonFile(tempPath);
    syncFile(tempPath);

    // Stage the backup independently too, then atomically publish it. This keeps
    // concurrent writers from copying over or validating one another's backup.
    if (hadExisting && fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, backupTempPath);
      validateJsonFile(backupTempPath);
      syncFile(backupTempPath);
      fs.renameSync(backupTempPath, backupPath);
    }

    try {
      fs.renameSync(tempPath, filePath);
    } catch (error) {
      if (error.code !== 'EPERM' && error.code !== 'EBUSY') throw error;

      // Windows can occasionally block atomic rename. Preserve the backup and
      // still validate the replacement before accepting it as successful.
      fs.writeFileSync(filePath, json, 'utf8');
      validateJsonFile(filePath);
      syncFile(filePath);

      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch {}
    }

    validateJsonFile(filePath);
    return true;
  } catch (error) {
    console.error(`[fileStore] Failed to write file: ${filePath}`, error);

    for (const stagedPath of [tempPath, backupTempPath]) {
      try {
        if (fs.existsSync(stagedPath)) fs.unlinkSync(stagedPath);
      } catch {}
    }

    // If the active file became invalid during a fallback write, restore the
    // last-known-good copy automatically rather than leaving client data broken.
    try {
      if (fs.existsSync(backupPath)) {
        let activeValid = false;
        try {
          activeValid = validateJsonFile(filePath);
        } catch {}
        if (!activeValid) restoreBackup(filePath, backupPath);
      }
    } catch (restoreError) {
      console.error(`[fileStore] Failed to restore backup: ${filePath}`, restoreError);
    }

    throw error;
  } finally {
    for (const stagedPath of [tempPath, backupTempPath]) {
      try {
        if (fs.existsSync(stagedPath)) fs.unlinkSync(stagedPath);
      } catch {}
    }
  }
}

module.exports = {
  clone,
  ensureDir,
  read,
  write,
};