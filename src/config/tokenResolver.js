'use strict';

const crypto = require('node:crypto');

const { normalizeBotMode } = require('./botModes');

const MODE_TOKEN_ENV = Object.freeze({
  DEV: 'DISCORD_BOT_TOKEN_DEV',
  BETA: 'DISCORD_BOT_TOKEN_BETA',
  PRODUCTION: 'DISCORD_BOT_TOKEN_PRODUCTION',
});

let loggedResolution = false;

function tokenFingerprint(token) {
  if (!token) return 'none';
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 12);
}

function resolveTokenDetails(config = {}) {
  const mode = normalizeBotMode(config?.mode || config?.name || process.env.BOT_MODE);

  if (String(config?.token || '').trim()) {
    return {
      token: String(config.token).trim(),
      source: 'mode-config',
      mode,
    };
  }

  const source = MODE_TOKEN_ENV[mode];
  const token = source ? String(process.env[source] || '').trim() : '';

  return {
    token: token || null,
    source: token ? source : null,
    mode,
  };
}

function resolveToken(config = {}) {
  const details = resolveTokenDetails(config);

  if (!loggedResolution) {
    loggedResolution = true;
    console.log(
      `[TokenResolver] mode=${details.mode} source=${details.source || 'missing'} fingerprint=${tokenFingerprint(details.token)}`
    );
  }

  return details.token;
}

function getRequiredTokenEnvName(mode = process.env.BOT_MODE) {
  return MODE_TOKEN_ENV[normalizeBotMode(mode)] || MODE_TOKEN_ENV.DEV;
}

module.exports = {
  MODE_TOKEN_ENV,
  resolveToken,
  resolveTokenDetails,
  getRequiredTokenEnvName,
  tokenFingerprint,
};
