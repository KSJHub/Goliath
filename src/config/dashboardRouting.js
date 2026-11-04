'use strict';
function dashboardBasePath() {
  const raw = String(process.env.DASHBOARD_BASE_PATH || '').trim().replace(/\/+$/, '');
  if (!raw || raw === '/') return '';
  if (!['/dev', '/beta'].includes(raw)) throw new Error('DASHBOARD_BASE_PATH must be empty, /dev, or /beta');
  return raw;
}
function dashboardSessionName() { return dashboardBasePath() ? 'goliath_session_' + dashboardBasePath().slice(1) : 'connect.sid'; }
function oauthReturnName() { return 'goliath_oauth_return' + (dashboardBasePath() ? '_' + dashboardBasePath().slice(1) : ''); }
function dashboardUrl(configured, route = '/') {
  const url = new URL(configured || 'https://goliath.ksjdigital.co.uk');
  return url.origin + dashboardBasePath() + route;
}
module.exports = { dashboardBasePath, dashboardSessionName, oauthReturnName, dashboardUrl };
