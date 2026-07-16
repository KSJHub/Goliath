'use strict';

const socialManager = require('./socialManager');
const socialDelivery = require('./socialDelivery');
const socialStore = require('./socialStore');
const socialHistory = require('./socialHistory');
const providerRegistry = require('./providerRegistry');

let intervalRef = null;
let running = false;
function getIntervalMs(options = {}) { const value = Number(options.intervalMs || process.env.SOCIAL_CHECK_INTERVAL_MS || 300000); return Number.isFinite(value) && value >= 60000 ? value : 300000; }
function buildProviderMetadata(result = {}) { return { providerStatus: result.providerStatus || result.status || 'unknown', lastCheckedAt: result.checkedAt || new Date().toISOString(), lastError: result.success ? '' : result.error || '', isLive: result.isLive === true, lastTitle: result.title || '', lastGameName: result.gameName || '', lastViewerCount: Number(result.viewerCount || 0), responseTimeMs: Number(result.responseTimeMs || 0), alertType: result.alertType || null, publishedAt: result.publishedAt || null }; }
function historyBase(account, result = {}) { return { accountId: account.accountId, creator: account.displayName || account.username || null, platform: account.platform, alertType: result.alertType || 'live', contentId: result.contentId || null, title: result.title || null, providerStatus: result.providerStatus || result.status || 'unknown' }; }
async function handleProviderResult(guildId, account, result, client) {
  const metadata = buildProviderMetadata(result);
  const firstContent = Boolean(result.success && result.contentId && !account.lastSeen?.lastContentId);
  const updates = { externalId: result.externalId || account.externalId, displayName: result.displayName || account.displayName, metadata: { ...(account.metadata || {}), provider: metadata }, lastSeen: { ...(account.lastSeen || {}), lastCheckedAt: metadata.lastCheckedAt, lastProviderStatus: metadata.providerStatus, lastProviderError: metadata.lastError, lastLiveState: metadata.isLive ? 'live' : 'offline', ...(firstContent ? { lastContentId: result.contentId, lastTitle: result.title || '' } : {}) } };
  socialManager.updateAccount(guildId, account.accountId, updates, { action: 'social_provider_check' });
  if (!result.success) {
    socialStore.incrementAnalytics(guildId, { errors: 1 }, { action: 'social_provider_error' });
    socialHistory.record(guildId, { ...historyBase(account, result), status: 'failed', eventType: 'provider_check', error: result.error || 'Provider check failed.' });
    return { success: false, skipped: true, reason: result.error || 'provider_error' };
  }
  if (firstContent) {
    socialHistory.record(guildId, { ...historyBase(account, result), status: 'suppressed', eventType: 'provider_baseline', reason: 'initial_content_baseline' });
    return { success: false, skipped: true, reason: 'initial_content_baseline' };
  }
  if (result.contentId && result.hasAlert !== false && (result.isLive || result.alertType)) {
    const enabledTypes = Array.isArray(account.alertTypes) ? account.alertTypes : ['live'];
    if (!enabledTypes.includes(result.alertType || 'live')) {
      socialHistory.record(guildId, { ...historyBase(account, result), status: 'skipped', eventType: 'provider_check', reason: 'alert_type_disabled' });
      return { success: false, skipped: true, reason: 'alert_type_disabled' };
    }
    return socialDelivery.deliver(guildId, { ...account, ...updates }, result, client, { action: 'social_provider_content_alert' });
  }
  socialHistory.record(guildId, { ...historyBase(account, result), status: 'skipped', eventType: 'provider_check', reason: 'no_new_alert' });
  return { success: false, skipped: true, reason: 'no_alert' };
}
async function runSocialCheck(client, options = {}) {
  if (running) return { skipped: true, reason: 'already_running' };
  running = true;
  try {
    const guildIds = Array.isArray(options.guildIds) && options.guildIds.length ? options.guildIds : [...(client?.guilds?.cache?.keys?.() || [])];
    const results = [];
    let checkedGuilds = 0;
    for (const guildId of guildIds) {
      const config = socialManager.getConfig(guildId);
      if (config.enabled === false) continue;
      checkedGuilds += 1;
      const accounts = (config.accounts || []).filter((account) => account.enabled !== false && config.providers?.[account.platform]?.enabled !== false);
      for (const account of accounts) {
        try {
          const result = await providerRegistry.checkAccount(account);
          const alertResult = await handleProviderResult(guildId, account, result, client);
          results.push({ guildId, accountId: account.accountId, ...result, alertResult });
        } catch (error) {
          socialStore.incrementAnalytics(guildId, { errors: 1 }, { action: 'social_scheduler_exception' });
          socialManager.updateAccount(guildId, account.accountId, { lastSeen: { ...(account.lastSeen || {}), lastCheckedAt: new Date().toISOString(), lastProviderStatus: 'error', lastProviderError: error.message } }, { action: 'social_scheduler_exception' });
          socialHistory.record(guildId, { ...historyBase(account, { status: 'error' }), status: 'failed', eventType: 'scheduler', error: error.message });
          results.push({ guildId, accountId: account.accountId, success: false, error: error.message });
        }
      }
    }
    return { skipped: false, guildCount: checkedGuilds, accountCount: results.length, results };
  } finally { running = false; }
}
function startSocialScheduler(client, options = {}) { if (intervalRef) return intervalRef; const intervalMs = getIntervalMs(options); intervalRef = setInterval(() => { runSocialCheck(client, options).catch((error) => console.error('[SocialScheduler] Check failed:', error)); }, intervalMs); intervalRef.unref?.(); console.log(`[SocialScheduler] Social provider scheduler ready (${intervalMs}ms)`); return intervalRef; }
function stopSocialScheduler() { if (!intervalRef) return false; clearInterval(intervalRef); intervalRef = null; return true; }

module.exports = { runSocialCheck, startSocialScheduler, stopSocialScheduler, handleProviderResult };