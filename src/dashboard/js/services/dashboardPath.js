// Vite supplies / for production and /dev/ or /beta/ for staged builds.
export const dashboardBase = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
export const dashboardCookieSuffix = dashboardBase ? '_' + dashboardBase.slice(1).replace(/\//g, '_') : '';
export function dashboardPath(value = '/') {
  const path = String(value || '/');
  if (!path.startsWith('/') || path.startsWith('//')) return path;
  if (!dashboardBase || path === dashboardBase || path.startsWith(dashboardBase + '/') || path.startsWith(dashboardBase + '?')) return path;
  return dashboardBase + path;
}
export function localDashboardPath(value) {
  const path = String(value || '/');
  return dashboardBase && (path === dashboardBase || path.startsWith(dashboardBase + '/')) ? path.slice(dashboardBase.length) || '/' : path;
}
export function goDashboard(value, replace = false) {
  window.location[replace ? 'replace' : 'assign'](dashboardPath(value));
}
