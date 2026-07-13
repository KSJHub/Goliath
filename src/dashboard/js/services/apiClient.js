const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '';

function apiUrl(path = '') {
  return `${API_BASE}${path}`;
}

async function request(url, options = {}) {
  const response = await fetch(apiUrl(url), {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(data?.error || `API request failed: ${response.status}`);
    error.data = data;
    error.diagnostics = data?.diagnostics || null;
    error.status = response.status;
    throw error;
  }

  return data;
}

function buildQuery(params = {}) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    query.set(key, String(value));
  });

  return query.toString();
}

export const api = {
  request,
  buildQuery,
  getStatus: (guildId = '') => request(`/api/status${guildId ? `?guildId=${guildId}` : ''}`),
  getAuthMe: () => request('/api/auth/me'),
  getLoginUrl: () => apiUrl('/api/auth/login'),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  getOwnerMe: () => request('/api/owner/me'),
  getOwnerDiagnostics: () => request('/api/owner/diagnostics'),
  getOwnerGuilds: () => request('/api/owner/guilds/all'),
  getPlatformRuntime: () => request('/api/owner/runtime'),
  getOwnerBackups: (environment = 'all') => request(`/api/owner/backups?environment=${encodeURIComponent(environment)}`),
  createOwnerManualBackup: (payload) => request('/api/owner/backups/manual', { method: 'POST', body: JSON.stringify(payload) }),
  getOwnerRuntime: (guildId) => request(`/api/status?guildId=${guildId}`),
  getOwnerSecurity: (guildId) => request(`/api/security/overview?guildId=${guildId}`),
  getPermissionHealth: (guildId) => request(`/api/permissions/${guildId}`),
  getRestoreBackups: (guildId) => request(`/api/restore/${guildId}/backups`),
  getRestoreBackup: (guildId, backupId) => request(`/api/restore/${guildId}/backups/${encodeURIComponent(backupId)}`),
  compareRestoreBackup: (guildId, backupId) => request(`/api/restore/${guildId}/restore/compare`, { method: 'POST', body: JSON.stringify({ backupId }) }),
  previewRestoreBackup: (guildId, backupId, options = {}) => request(`/api/restore/${guildId}/restore/preview`, { method: 'POST', body: JSON.stringify({ backupId, options }) }),
  executeRestoreBackup: (guildId, payload = {}) => request(`/api/restore/${guildId}/restore/execute`, { method: 'POST', body: JSON.stringify(payload) }),
  getGuilds: () => request('/api/discord/guilds'),
  getGuildChannels: (guildId) => request(`/api/discord/${guildId}/channels`),
  getGuildRoles: (guildId) => request(`/api/discord/${guildId}/roles`),
  createGuildRole: (guildId, payload) => request(`/api/discord/${guildId}/roles`, { method: 'POST', body: JSON.stringify(payload) }),
  updateGuildRole: (guildId, roleId, payload) => request(`/api/discord/${guildId}/roles/${encodeURIComponent(roleId)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteGuildRole: (guildId, roleId) => request(`/api/discord/${guildId}/roles/${encodeURIComponent(roleId)}`, { method: 'DELETE' }),
  reorderGuildRoles: (guildId, roleIds) => request(`/api/discord/${guildId}/roles/order`, { method: 'PATCH', body: JSON.stringify({ roleIds }) }),
  getGeneralSettings: (guildId) => request(`/api/config/general/${guildId}`),
  saveGeneralSettings: (guildId, payload) => request(`/api/config/general/${guildId}`, { method: 'POST', body: JSON.stringify(payload) }),
  getGuildModules: (guildId) => request(`/api/modules/${guildId}`),
  setGuildModuleEnabled: (guildId, moduleKey, enabled) => request(`/api/modules/${guildId}/${moduleKey}/enabled`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
  getBillingPlans: () => request('/api/billing/plans'),
  getBillingSubscription: (guildId) => request(`/api/billing/subscription/${guildId}`),
  getBillingEntitlements: (guildId) => request(`/api/billing/entitlements/${guildId}`),
  getTranslationConfig: (guildId) => request(`/api/translation/${guildId}`),
  getTranslationProvider: (guildId) => request(`/api/translation/${guildId}/provider`),
  saveTranslationProvider: (guildId, payload) => request(`/api/translation/${guildId}/provider`, { method: 'PATCH', body: JSON.stringify(payload) }),
  setTranslationEnabled: (guildId, enabled) => request(`/api/translation/${guildId}/enabled`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
  getFormsOverview: (guildId) => request(`/api/forms/${guildId}/overview`),
  getFormsWorkflowOverview: (guildId) => request(`/api/forms/${guildId}/overview`),
  getFormsConfig: (guildId) => request(`/api/forms/${guildId}`),
  getForms: (guildId) => request(`/api/forms/${guildId}/forms`),
  getForm: (guildId, formId) => request(`/api/forms/${guildId}/forms/${encodeURIComponent(formId)}`),
  createForm: (guildId, payload) => request(`/api/forms/${guildId}/forms`, { method: 'POST', body: JSON.stringify(payload) }),
  updateForm: (guildId, formId, payload) => request(`/api/forms/${guildId}/forms/${encodeURIComponent(formId)}`, { method: 'PUT', body: JSON.stringify(payload) }),
  setFormEnabled: (guildId, formId, enabled) => request(`/api/forms/${guildId}/forms/${encodeURIComponent(formId)}/enabled`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
  getFormPanels: (guildId) => request(`/api/forms/${guildId}/panels`),
  createFormPanel: (guildId, payload) => request(`/api/forms/${guildId}/panels`, { method: 'POST', body: JSON.stringify(payload) }),
  updateFormPanel: (guildId, panelId, payload) => request(`/api/forms/${guildId}/panels/${encodeURIComponent(panelId)}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deployFormPanel: (guildId, panelId) => request(`/api/forms/${guildId}/panels/${encodeURIComponent(panelId)}/deploy`, { method: 'POST' }),
  refreshFormPanel: (guildId, panelId) => request(`/api/forms/${guildId}/panels/${encodeURIComponent(panelId)}/refresh`, { method: 'POST' }),
  getFormSubmissions: (guildId, query = '') => request(`/api/forms/${guildId}/submissions${query ? `?${query}` : ''}`),
  getFilteredFormSubmissions: (guildId, filters = {}) => request(`/api/forms/${guildId}/submissions${buildQuery(filters) ? `?${buildQuery(filters)}` : ''}`),
  getFormSubmission: (guildId, submissionId) => request(`/api/forms/${guildId}/submissions/${encodeURIComponent(submissionId)}`),
  getFormSubmissionWorkflow: (guildId, submissionId) => request(`/api/forms/${guildId}/submissions/${encodeURIComponent(submissionId)}/workflow`),
  updateFormSubmissionStatus: (guildId, submissionId, status, payload = {}) => request(`/api/forms/${guildId}/submissions/${encodeURIComponent(submissionId)}/status`, { method: 'PATCH', body: JSON.stringify({ ...payload, status }) }),
  updateFormWorkflowState: (guildId, submissionId, state) => request(`/api/forms/${guildId}/submissions/${encodeURIComponent(submissionId)}/workflow/state`, { method: 'PATCH', body: JSON.stringify({ state }) }),
  assignFormReviewer: (guildId, submissionId, reviewerId) => request(`/api/forms/${guildId}/submissions/${encodeURIComponent(submissionId)}/workflow/reviewer`, { method: 'PATCH', body: JSON.stringify({ reviewerId }) }),
  addFormSubmissionNote: (guildId, submissionId, note) => request(`/api/forms/${guildId}/submissions/${encodeURIComponent(submissionId)}/workflow/notes`, { method: 'POST', body: JSON.stringify({ note }) }),
  saveFormsSettings: (guildId, payload) => request(`/api/forms/${guildId}/settings`, { method: 'PATCH', body: JSON.stringify(payload) }),
  getTicketOverview: (guildId) => request(`/api/tickets/${guildId}/overview`),
  getTicketsOverview: (guildId) => request(`/api/tickets/${guildId}/overview`),
  getTickets: (guildId) => request(`/api/tickets/${guildId}`),
  runTicketRecovery: (guildId, createMissingChannels = false) => request(`/api/tickets/${guildId}/recovery`, { method: 'POST', body: JSON.stringify({ createMissingChannels }) }),
  runTicketRecoveryScan: (guildId) => request(`/api/tickets/${guildId}/recovery`, { method: 'POST', body: JSON.stringify({ createMissingChannels: false }) }),
  recreateMissingTicketChannels: (guildId) => request(`/api/tickets/${guildId}/recovery`, { method: 'POST', body: JSON.stringify({ createMissingChannels: true }) }),
  getEmbedStudio: (guildId) => request(`/api/modules/${guildId}/embed-studio`),
  saveEmbedDraft: (guildId, payload) => request(`/api/modules/${guildId}/embed-studio/draft`, { method: 'POST', body: JSON.stringify(payload) }),
  saveEmbedPreset: (guildId, name, payload) => request(`/api/modules/${guildId}/embed-studio/presets`, { method: 'POST', body: JSON.stringify({ name, ...payload }) }),
  deleteEmbedPreset: (guildId, name) => request(`/api/modules/${guildId}/embed-studio/presets/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  deleteEmbedDeployment: (guildId, key) => request(`/api/modules/${guildId}/embed-studio/deployments/${encodeURIComponent(key)}`, { method: 'DELETE' }),
  getEmbedTemplates: (guildId) => request(`/api/modules/${guildId}/embed-studio/templates`),
  saveEmbedTemplate: (guildId, payload) => request(`/api/modules/${guildId}/embed-studio/templates`, { method: 'POST', body: JSON.stringify(payload) }),
  bindEmbedTemplate: (guildId, moduleKey, slot, templateId) => request(`/api/modules/${guildId}/embed-studio/bindings/${encodeURIComponent(moduleKey)}/${encodeURIComponent(slot)}`, { method: 'POST', body: JSON.stringify({ templateId }) }),
  getAutomationRegistry: () => request('/api/automation/registry'),
  getAutomation: (guildId) => request(`/api/automation/${guildId}`),
  saveAutomationRule: (guildId, payload) => request(`/api/automation/${guildId}/rules`, { method: 'POST', body: JSON.stringify(payload) }),
  deleteAutomationRule: (guildId, ruleId) => request(`/api/automation/${guildId}/rules/${encodeURIComponent(ruleId)}`, { method: 'DELETE' }),
  testAutomationLog: (guildId, payload) => request(`/api/automation/${guildId}/test-log`, { method: 'POST', body: JSON.stringify(payload) }),
  simulateAutomationRule: (guildId, ruleId, context = {}) => request(`/api/automation/${guildId}/rules/${encodeURIComponent(ruleId)}/simulate`, { method: 'POST', body: JSON.stringify({ context }) }),
  getVerification: (guildId) => request(`/api/modules/${guildId}/verification`),
  getVerificationOverview: (guildId) => request(`/api/verification/${guildId}/overview`),
  setVerificationEnabled: (guildId, enabled) => request(`/api/modules/${guildId}/verification/enabled`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
  saveVerificationSettings: (guildId, settings) => request(`/api/modules/${guildId}/verification/settings`, { method: 'PATCH', body: JSON.stringify({ settings }) }),
  saveVerificationConfig: (guildId, payload) => request(`/api/verification/${guildId}/config`, { method: 'POST', body: JSON.stringify(payload) }),
  saveVerificationTemplate: (guildId, payload) => request(`/api/verification/${guildId}/template`, { method: 'POST', body: JSON.stringify(payload) }),
  deployVerificationPanel: (guildId, payload = {}) => request(`/api/verification/${guildId}/deploy`, {
    method: 'POST',
    body: JSON.stringify({
      channelId: payload.channelId,
      panelId: payload.panelId,
      template: payload.template || payload,
    }),
  }),
  refreshVerificationPanel: (guildId, panelId, payload = {}) => request(`/api/verification/${guildId}/panels/${encodeURIComponent(panelId)}/redeploy`, { method: 'POST', body: JSON.stringify(payload) }),
  deleteVerificationPanel: (guildId, panelId) => request(`/api/verification/${guildId}/panels/${encodeURIComponent(panelId)}`, { method: 'DELETE' }),
  resetVerification: (guildId) => request(`/api/verification/${guildId}/reset`, { method: 'POST' }),
  getVerificationExportUrl: (guildId) => apiUrl(`/api/verification/${guildId}/export`),
  getAutoRoles: (guildId) => request(`/api/modules/${guildId}/auto-roles`),
  setAutoRolesEnabled: (guildId, enabled) => request(`/api/modules/${guildId}/auto-roles/enabled`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
  saveAutoRolesSettings: (guildId, settings) => request(`/api/modules/${guildId}/auto-roles/settings`, { method: 'PATCH', body: JSON.stringify({ settings }) }),
  saveAutoRolesConfig: (guildId, payload) => request(`/api/modules/${guildId}/auto-roles`, { method: 'PUT', body: JSON.stringify(payload) }),
  addJoinAutoRole: (guildId, roleId) => request(`/api/modules/${guildId}/auto-roles/join`, { method: 'POST', body: JSON.stringify({ roleId }) }),
  removeJoinAutoRole: (guildId, roleId) => request(`/api/modules/${guildId}/auto-roles/join/${roleId}`, { method: 'DELETE' }),
  addBotAutoRole: (guildId, roleId) => request(`/api/modules/${guildId}/auto-roles/bots`, { method: 'POST', body: JSON.stringify({ roleId }) }),
  removeBotAutoRole: (guildId, roleId) => request(`/api/modules/${guildId}/auto-roles/bots/${roleId}`, { method: 'DELETE' }),
  getAutoRolesAnalytics: (guildId) => request(`/api/modules/${guildId}/auto-roles/analytics`),
  getAutoModConfig: (guildId) => request(`/api/config/automod/${guildId}`),
  saveAutoModConfig: (guildId, payload) => request(`/api/config/automod/${guildId}`, { method: 'POST', body: JSON.stringify(payload) }),
  getMessages: (guildId) => request(`/api/config/messages/${guildId}`),
  saveMessages: (guildId, payload) => request(`/api/config/messages/${guildId}`, { method: 'POST', body: JSON.stringify(payload) }),
  getCases: (guildId) => request(`/api/cases/${guildId}`),
  getWarnings: (guildId) => request(`/api/cases/${guildId}/warnings`),
};

export default api;
