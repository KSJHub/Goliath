'use strict';

const DEFAULT_MAX_ATTEMPTS = 8;
const DEFAULT_BASE_DELAY_MS = 2000;
const DEFAULT_MAX_DELAY_MS = 30000;

const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'ENETUNREACH',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function statusOf(error) {
  const value = Number(error?.status || error?.statusCode || error?.rawError?.status);
  return Number.isFinite(value) ? value : null;
}

function codeOf(error) {
  return String(error?.code || error?.cause?.code || '').trim();
}

function isPermanentLoginError(error) {
  const status = statusOf(error);
  if (status === 401 || status === 403) return true;

  const code = codeOf(error);
  return code === 'TokenInvalid' || code === 'DisallowedIntents' || code === 'PrivilegedIntentsRequired';
}

function isTransientLoginError(error) {
  const status = statusOf(error);
  if (status === 429 || (status !== null && status >= 500 && status <= 599)) return true;

  const code = codeOf(error);
  if (TRANSIENT_NETWORK_CODES.has(code)) return true;

  const message = String(error?.message || '').toLowerCase();
  return message.includes('service unavailable')
    || message.includes('gateway timeout')
    || message.includes('socket hang up')
    || message.includes('fetch failed')
    || message.includes('network');
}

function retryDelay(attempt, baseDelayMs = DEFAULT_BASE_DELAY_MS, maxDelayMs = DEFAULT_MAX_DELAY_MS) {
  return Math.min(maxDelayMs, baseDelayMs * (2 ** Math.max(0, attempt - 1)));
}

async function cleanupFailedLogin(client) {
  try {
    const result = client?.destroy?.();
    if (result && typeof result.then === 'function') await result;
  } catch {
    // Best effort only. A subsequent login or PM2 restart will create a clean connection.
  }
}

async function loginWithRetry(client, token, options = {}) {
  if (!client?.login) throw new Error('Discord client is unavailable.');
  if (!token) throw new Error('Discord bot token is unavailable.');

  const maxAttempts = Math.max(1, Number(options.maxAttempts) || DEFAULT_MAX_ATTEMPTS);
  const baseDelayMs = Math.max(250, Number(options.baseDelayMs) || DEFAULT_BASE_DELAY_MS);
  const maxDelayMs = Math.max(baseDelayMs, Number(options.maxDelayMs) || DEFAULT_MAX_DELAY_MS);
  const label = options.label || 'Discord';

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      if (attempt > 1) console.log(`[${label}] Login retry ${attempt}/${maxAttempts}...`);
      await client.login(token);
      if (attempt > 1) console.log(`[${label}] Login recovered on attempt ${attempt}/${maxAttempts}.`);
      return true;
    } catch (error) {
      const status = statusOf(error);
      const code = codeOf(error);
      const detail = error?.message || 'Unknown Discord login error';

      if (isPermanentLoginError(error)) {
        console.error(`[${label}] Login failed permanently${status ? ` (HTTP ${status})` : ''}${code ? ` [${code}]` : ''}: ${detail}`);
        throw error;
      }

      const transient = isTransientLoginError(error);
      if (!transient || attempt >= maxAttempts) {
        console.error(`[${label}] Login failed after ${attempt}/${maxAttempts} attempt(s)${status ? ` (HTTP ${status})` : ''}${code ? ` [${code}]` : ''}: ${detail}`);
        throw error;
      }

      const delayMs = retryDelay(attempt, baseDelayMs, maxDelayMs);
      console.warn(`[${label}] Temporary login failure${status ? ` (HTTP ${status})` : ''}${code ? ` [${code}]` : ''}: ${detail}. Retrying in ${Math.ceil(delayMs / 1000)}s.`);
      await cleanupFailedLogin(client);
      await sleep(delayMs);
    }
  }

  return false;
}

module.exports = {
  loginWithRetry,
};
