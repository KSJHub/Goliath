'use strict';

require('../runtime/warningFilter');

const path = require('node:path');
const dotenv = require('dotenv');

const { normalizeBotMode, isValidBotMode } = require('./botModes');

function normalizeClientUrlEnvironment() {
  const keys = ['CLIENT_URL', 'DASHBOARD_CLIENT_URL', 'DASHBOARD_URL', 'VITE_CLIENT_URL', 'TWOTONETAJ_CLIENT_URL'];
  for (const key of keys) {
    const raw = String(process.env[key] || '').trim();
    if (!raw) continue;
    try {
      process.env[key] = new URL(raw).origin;
    } catch {
      console.warn(`⚠️ Ignoring invalid ${key}; expected an absolute URL.`);
      delete process.env[key];
    }
  }
}

function applyModePublicClientOrigin(requestedMode) {
  if (requestedMode !== 'DEV') return;
  // DEV nginx currently canonicalises unknown SPA paths to /overview.
  // Enter member-only deep links through the root hash so the static server
  // always serves index.html; main.jsx then recovers the appeal reference.
  process.env.CLIENT_URL = 'https://dev.goliath.ksjdigital.co.uk/#';
}

function loadEnvironment(mode = process.env.BOT_MODE) {
  const requestedMode = normalizeBotMode(mode);

  if (!isValidBotMode(requestedMode)) {
    console.error(`❌ Invalid BOT_MODE: ${requestedMode}`);
    console.error('✅ Valid modes: DEV, BETA, PRODUCTION');
    process.exit(1);
  }

  const envFile = `.env.${requestedMode.toLowerCase()}`;
  const envPath = path.resolve(process.cwd(), envFile);

  const result = dotenv.config({ path: envPath });

  if (result.error) {
    console.error(`❌ Failed to load ${envFile}`);
    console.error(`Expected path: ${envPath}`);
    console.error(result.error.message);
    process.exit(1);
  }

  // Owner identity is security-critical. PM2 can retain old environment values
  // across reloads, so the active mode file must be authoritative for these keys.
  for (const key of ['OWNER_ID', 'OWNER_IDS', 'BOT_OWNER_ID', 'BOT_OWNER_IDS']) {
    if (Object.prototype.hasOwnProperty.call(result.parsed || {}, key)) {
      process.env[key] = result.parsed[key];
    }
  }

  process.env.BOT_MODE = requestedMode;
  normalizeClientUrlEnvironment();
  applyModePublicClientOrigin(requestedMode);

  return {
    mode: requestedMode,
    envFile,
    envPath,
  };
}

module.exports = {
  loadEnvironment,
};
