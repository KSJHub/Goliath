'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { MEDIA_ROOT } = require('./mediaConfig');

const DEFAULT_MAX_AGE_MS = 1000 * 60 * 60 * 24;

function positiveMs(value, fallback = DEFAULT_MAX_AGE_MS) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function cleanupMediaTempFiles({ maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
  const retentionMs = positiveMs(maxAgeMs);
  const now = Date.now();
  let deleted = 0;

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }

      if (!full.includes(`${path.sep}uploads${path.sep}`)) continue;
      const stats = fs.statSync(full);
      if (now - stats.mtimeMs > retentionMs) {
        fs.unlinkSync(full);
        deleted += 1;
      }
    }
  }

  walk(MEDIA_ROOT);
  return { deleted };
}

module.exports = {
  cleanupMediaTempFiles,
};
