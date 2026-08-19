'use strict';

// src/modules/feedbackStudio/forms/formStore.js

const crypto = require('crypto');
const {
  getModuleSection,
  saveModuleSection,
  updateModuleSection,
} = require('../../../core/guild/moduleSectionManager');
const notifications = require('../../../core/notifications/notificationStore');

const {
  emitGuildUpdate,
} = require('../../../server/sockets/socketHub');

const EVENTS = Object.freeze({
  FORM_CREATED: 'form.created',
  FORM_UPDATED: 'form.updated',
  FORM_SUBMITTED: 'form.submitted',
  FORM_SUBMISSION_UPDATED: 'form.submission.updated',

  PANEL_CREATED: 'form.panel.created',
  PANEL_UPDATED: 'form.panel.updated',

  ANALYTICS_UPDATED: 'form.analytics.updated',
});

function now() {
  return new Date().toISOString();
}

function createPayload(event, guildId, data = {}) {
  const timestamp = now();

  return {
    module: 'forms',
    event,
    guildId: String(guildId),
    timestamp,
    updatedAt: timestamp,
    data,
  };
}

function emit(event, guildId, data = {}) {
  const payload = createPayload(event, guildId, data);
  const update = emitGuildUpdate(guildId, payload);

  if (!update) return payload;

  return update;
}

function emitFormUpdated(guildId, form) {
  return emit(EVENTS.FORM_UPDATED, guildId, {
    formId: form?.formId || form?.id || null,
    name: form?.name || null,
    enabled: form?.enabled !== false,
    action: form?.action || null,
    updatedAt: form?.updatedAt || null,
  });
}

function emitFormSubmitted(guildId, submission) {
  return emit(EVENTS.FORM_SUBMITTED, guildId, {
    submissionId: submission?.submissionId || submission?.id || null,
    formId: submission?.formId || null,
    userId: submission?.userId || null,
    userTag: submission?.userTag || null,
    status: submission?.status || null,
    ticketId: submission?.ticketId || null,
    ticketChannelId: submission?.ticketChannelId || null,
    createdAt: submission?.createdAt || null,
  });
}

function emitFormSubmissionUpdated(guildId, submission) {
  return emit(EVENTS.FORM_SUBMISSION_UPDATED, guildId, {
    submissionId: submission?.submissionId || submission?.id || null,
    formId: submission?.formId || null,
    status: submission?.status || null,
    ticketId: submission?.ticketId || null,
    ticketChannelId: submission?.ticketChannelId || null,
    updatedAt: submission?.updatedAt || null,
  });
}

function emitFormPanelUpdated(guildId, panel) {
  return emit(EVENTS.PANEL_UPDATED, guildId, {
    panelId: panel?.panelId || panel?.id || null,
    title: panel?.title || null,
    channelId: panel?.channelId || null,
    messageId: panel?.messageId || null,
    updatedAt: panel?.updatedAt || null,
  });
}

function emitFormAnalyticsUpdated(guildId, analytics) {
  return emit(EVENTS.ANALYTICS_UPDATED, guildId, analytics || {});
}


const MODULE = 'forms';
const FIELD_TYPES = Object.freeze({
  SHORT: 'short',
  PARAGRAPH: 'paragraph',
  NUMBER: 'number',
  SELECT: 'select',
  CHECKBOX: 'checkbox',
  BOOLEAN: 'boolean',
  USER_MENTION: 'user_mention',
  ROLE_MENTION: 'role_mention',
});
const FORM_ACTIONS = Object.freeze({
  NONE: 'none',
  CREATE_TICKET: 'create_ticket',
  LOG_ONLY: 'log_only',
  STORE_ONLY: 'store_only',
});
const SUBMISSION_STATUSES = Object.freeze(['pending', 'approved', 'denied', 'closed', 'request_info']);

function now() {
  return new Date().toISOString();
}

function notify(guildId, payload = {}) {
  try {
    return notifications.addNotification(guildId, {
      source: 'forms',
      route: '/forms',
      ...payload,
    });
  } catch (error) {
    console.warn('[FormStore] Notification skipped:', error.message || error);
    return null;
  }
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value, fallback = '', maxLength = 1000) {
  return String(value ?? fallback).trim().slice(0, maxLength);
}

function cleanKey(value, fallback = 'form') {
  return (
    String(value || fallback)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9-_]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || fallback
  ).slice(0, 80);
}

function cleanDiscordId(value) {
  const id = String(value || '').replace(/[<@#!&>]/g, '').trim();
  return /^\d{15,25}$/.test(id) ? id : null;
}

function createId(prefix = 'form') {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

function normalizeFieldType(value) {
  const type = String(value || '').trim().toLowerCase();
  if (type === 'long' || type === 'long_text' || type === 'textarea') return FIELD_TYPES.PARAGRAPH;
  if (type === 'dropdown') return FIELD_TYPES.SELECT;
  if (type === 'yes_no' || type === 'yesno') return FIELD_TYPES.BOOLEAN;
  if (type === 'user' || type === 'member') return FIELD_TYPES.USER_MENTION;
  if (type === 'role') return FIELD_TYPES.ROLE_MENTION;
  return Object.values(FIELD_TYPES).includes(type) ? type : FIELD_TYPES.SHORT;
}

function defaultWorkflowActions(action = FORM_ACTIONS.CREATE_TICKET) {
  return {
    createTicket: action === FORM_ACTIONS.CREATE_TICKET,
    ticketPanelId: null,
    pingRoleIds: [],
    sendDm: true,
    logSubmission: true,
    notifyStaff: true,
    attachAnswersToTicket: true,
  };
}

function normalizeWorkflowActions(source = {}, action = FORM_ACTIONS.CREATE_TICKET) {
  const actions = isPlainObject(source) ? source : {};
  const defaults = defaultWorkflowActions(action);
  return {
    createTicket: actions.createTicket !== undefined ? actions.createTicket === true : defaults.createTicket,
    ticketPanelId: actions.ticketPanelId ? cleanKey(actions.ticketPanelId, 'ticket-panel') : null,
    pingRoleIds: Array.isArray(actions.pingRoleIds) ? actions.pingRoleIds.map(cleanDiscordId).filter(Boolean).slice(0, 10) : [],
    sendDm: actions.sendDm !== false,
    logSubmission: actions.logSubmission !== false,
    notifyStaff: actions.notifyStaff !== false,
    attachAnswersToTicket: actions.attachAnswersToTicket !== false,
  };
}

function normalizeDecisionTemplates(source = {}) {
  const templates = isPlainObject(source) ? source : {};
  return {
    approved: cleanString(templates.approved || 'Your submission has been approved.', 'Your submission has been approved.', 1800),
    denied: cleanString(templates.denied || 'Your submission has been denied.', 'Your submission has been denied.', 1800),
    requestInfo: cleanString(templates.requestInfo || 'Staff need more information about your submission.', 'Staff need more information about your submission.', 1800),
  };
}

function normalizeTimelineEvent(event = {}, index = 0) {
  const source = isPlainObject(event) ? event : {};
  return {
    id: cleanKey(source.id || createId('event'), `event-${index + 1}`),
    type: cleanKey(source.type || 'event', 'event'),
    label: cleanString(source.label || source.type || 'Event', 'Event', 120),
    actorId: cleanDiscordId(source.actorId),
    metadata: isPlainObject(source.metadata) ? clone(source.metadata) : {},
    createdAt: source.createdAt || now(),
  };
}

function defaultFormsSection() {
  return {
    settings: {
      defaultAction: FORM_ACTIONS.CREATE_TICKET,
      dmSubmitter: true,
      requireStaffReview: true,
    },
    forms: {},
    submissions: {},
    panels: {},
    analytics: {
      submitted: 0,
      ticketsCreated: 0,
      approved: 0,
      denied: 0,
      requestInfo: 0,
      dmSent: 0,
      staffNotified: 0,
    },
    createdAt: now(),
    updatedAt: now(),
  };
}

function normalizeField(field = {}, index = 0) {
  const source = isPlainObject(field) ? field : {};
  const type = normalizeFieldType(source.type);
  const id = cleanKey(source.id || source.key || `field-${index + 1}`, `field-${index + 1}`);
  return {
    id,
    type,
    label: cleanString(source.label || `Question ${index + 1}`, `Question ${index + 1}`, 80),
    placeholder: cleanString(source.placeholder || '', '', 100),
    required: source.required !== false,
    options: Array.isArray(source.options) ? source.options.map((option) => cleanString(option, '', 80)).filter(Boolean).slice(0, 25) : [],
    minLength: Math.max(0, Number(source.minLength || 0)),
    maxLength: Math.min(Math.max(Number(source.maxLength || 400), 1), 4000),
  };
}

function normalizeForm(form = {}) {
  const source = isPlainObject(form) ? form : {};
  const formId = cleanKey(source.formId || source.id || createId('form'));
  const action = Object.values(FORM_ACTIONS).includes(source.action) ? source.action : FORM_ACTIONS.CREATE_TICKET;
  return {
    formId,
    id: formId,
    enabled: source.enabled !== false,
    name: cleanString(source.name || 'New Form', 'New Form', 100),
    description: cleanString(source.description || 'Submit this form for staff review.', '', 1000),
    buttonLabel: cleanString(source.buttonLabel || 'Open Form', 'Open Form', 80),
    action,
    actions: normalizeWorkflowActions(source.actions || source.workflowActions, action),
    decisionTemplates: normalizeDecisionTemplates(source.decisionTemplates),
    ticketType: cleanKey(source.ticketType || formId, formId),
    panelId: source.panelId ? cleanKey(source.panelId) : null,
    staffRoleIds: Array.isArray(source.staffRoleIds) ? source.staffRoleIds.map(cleanDiscordId).filter(Boolean) : [],
    logChannelId: cleanDiscordId(source.logChannelId),
    outputCategoryId: cleanDiscordId(source.outputCategoryId),
    fields: Array.isArray(source.fields) ? source.fields.map(normalizeField).slice(0, 5) : [],
    createdAt: source.createdAt || now(),
    createdBy: cleanDiscordId(source.createdBy),
    updatedAt: source.updatedAt || source.createdAt || now(),
    updatedBy: cleanDiscordId(source.updatedBy),
  };
}

function normalizeSubmission(submission = {}) {
  const source = isPlainObject(submission) ? submission : {};
  const submissionId = cleanKey(source.submissionId || source.id || createId('submission'));
  const status = SUBMISSION_STATUSES.includes(source.status) ? source.status : 'pending';
  return {
    submissionId,
    id: submissionId,
    formId: cleanKey(source.formId || 'unknown'),
    userId: cleanDiscordId(source.userId),
    userTag: cleanString(source.userTag || '', '', 120),
    status,
    answers: isPlainObject(source.answers) ? clone(source.answers) : {},
    ticketId: source.ticketId ? cleanString(source.ticketId, '', 120) : null,
    ticketChannelId: cleanDiscordId(source.ticketChannelId),
    workflow: isPlainObject(source.workflow) ? clone(source.workflow) : {},
    timeline: Array.isArray(source.timeline) ? source.timeline.map(normalizeTimelineEvent).slice(-50) : [],
    decision: isPlainObject(source.decision) ? clone(source.decision) : null,
    reviewedBy: cleanDiscordId(source.reviewedBy),
    reviewedAt: source.reviewedAt || null,
    createdAt: source.createdAt || now(),
    updatedAt: source.updatedAt || source.createdAt || now(),
  };
}

function normalizePanel(panel = {}) {
  const source = isPlainObject(panel) ? panel : {};
  const panelId = cleanKey(source.panelId || source.id || createId('form_panel'));
  return {
    panelId,
    id: panelId,
    enabled: source.enabled !== false,
    title: cleanString(source.title || 'Forms', 'Forms', 100),
    description: cleanString(source.description || 'Choose a form below.', '', 1000),
    channelId: cleanDiscordId(source.channelId),
    messageId: cleanDiscordId(source.messageId),
    formIds: Array.isArray(source.formIds) ? source.formIds.map((id) => cleanKey(id)).slice(0, 25) : [],
    createdAt: source.createdAt || now(),
    createdBy: cleanDiscordId(source.createdBy),
    updatedAt: source.updatedAt || source.createdAt || now(),
    updatedBy: cleanDiscordId(source.updatedBy),
  };
}

function normalizeFormsSection(section = {}) {
  const base = defaultFormsSection();
  const source = isPlainObject(section) ? section : {};
  const normalized = {
    ...base,
    ...clone(source),
    settings: { ...base.settings, ...(isPlainObject(source.settings) ? clone(source.settings) : {}) },
    forms: Object.fromEntries(Object.entries(isPlainObject(source.forms) ? source.forms : {}).map(([id, form]) => {
      const normalized = normalizeForm({ ...form, formId: form.formId || id });
      return [normalized.formId, normalized];
    })),
    submissions: Object.fromEntries(Object.entries(isPlainObject(source.submissions) ? source.submissions : {}).map(([id, submission]) => {
      const normalized = normalizeSubmission({ ...submission, submissionId: submission.submissionId || id });
      return [normalized.submissionId, normalized];
    })),
    panels: Object.fromEntries(Object.entries(isPlainObject(source.panels) ? source.panels : {}).map(([id, panel]) => {
      const normalized = normalizePanel({ ...panel, panelId: panel.panelId || id });
      return [normalized.panelId, normalized];
    })),
    analytics: {
      ...base.analytics,
      ...(isPlainObject(source.analytics) ? clone(source.analytics) : {}),
      submitted: Math.max(0, Number(source.analytics?.submitted || 0)),
      ticketsCreated: Math.max(0, Number(source.analytics?.ticketsCreated || 0)),
      approved: Math.max(0, Number(source.analytics?.approved || 0)),
      denied: Math.max(0, Number(source.analytics?.denied || 0)),
    },
    createdAt: source.createdAt || base.createdAt,
    updatedAt: source.updatedAt || now(),
  };
  delete normalized.enabled;
  return normalized;
}

function getFormsSection(guildId) {
  return normalizeFormsSection(getModuleSection(guildId, MODULE, defaultFormsSection()));
}

function saveFormsSection(guildId, section, guildOrMeta = {}) {
  return normalizeFormsSection(saveModuleSection(guildId, MODULE, normalizeFormsSection(section), guildOrMeta));
}

function updateFormsSection(guildId, updater, guildOrMeta = {}) {
  return normalizeFormsSection(updateModuleSection(guildId, MODULE, (current) => {
    const normalized = normalizeFormsSection(current);
    const next = typeof updater === 'function' ? updater(clone(normalized)) : updater;
    return normalizeFormsSection(next);
  }, defaultFormsSection(), guildOrMeta));
}

function saveForm(guildId, form, guildOrMeta = {}) {
  const normalized = normalizeForm(form);
  const saved = updateFormsSection(guildId, (section) => ({
    ...section,
    forms: { ...section.forms, [normalized.formId]: { ...(section.forms[normalized.formId] || {}), ...normalized, updatedAt: now() } },
    updatedAt: now(),
  }), guildOrMeta).forms[normalized.formId];

  emitFormUpdated(guildId, saved);
  return saved;
}

function getForm(guildId, formId) {
  return getFormsSection(guildId).forms[cleanKey(formId)] || null;
}

function listForms(guildId) {
  return Object.values(getFormsSection(guildId).forms || {});
}

function savePanel(guildId, panel, guildOrMeta = {}) {
  const normalized = normalizePanel(panel);
  const saved = updateFormsSection(guildId, (section) => ({
    ...section,
    panels: { ...section.panels, [normalized.panelId]: { ...(section.panels[normalized.panelId] || {}), ...normalized, updatedAt: now() } },
    updatedAt: now(),
  }), guildOrMeta).panels[normalized.panelId];

  emitFormPanelUpdated(guildId, saved);
  return saved;
}

function getPanel(guildId, panelId) {
  return getFormsSection(guildId).panels[cleanKey(panelId)] || null;
}

function saveSubmission(guildId, submission, guildOrMeta = {}) {
  const normalized = normalizeSubmission(submission);
  const isNew = !getFormsSection(guildId).submissions[normalized.submissionId];
  const saved = updateFormsSection(guildId, (section) => ({
    ...section,
    submissions: { ...section.submissions, [normalized.submissionId]: { ...(section.submissions[normalized.submissionId] || {}), ...normalized, updatedAt: now() } },
    analytics: { ...section.analytics, submitted: section.analytics.submitted + (isNew ? 1 : 0) },
    updatedAt: now(),
  }), guildOrMeta).submissions[normalized.submissionId];

  if (isNew) {
    emitFormSubmitted(guildId, saved);
    notify(guildId, {
      level: 'info',
      title: 'New form submission',
      message: `${saved.userTag || saved.userId || 'A member'} submitted ${saved.formId}.`,
      metadata: { submissionId: saved.submissionId, formId: saved.formId, userId: saved.userId },
    });
  } else {
    emitFormSubmissionUpdated(guildId, saved);
  }

  emitFormAnalyticsUpdated(guildId, getFormsSection(guildId).analytics);

  return saved;
}

function updateSubmission(guildId, submissionId, updates = {}, guildOrMeta = {}) {
  const safeId = cleanKey(submissionId, 'submission');
  const before = getFormsSection(guildId).submissions[safeId] || null;
  const saved = updateFormsSection(guildId, (section) => {
    const existing = section.submissions[safeId];
    if (!existing) return section;
    const normalized = normalizeSubmission({ ...existing, ...(isPlainObject(updates) ? updates : {}), submissionId: safeId, updatedAt: now() });
    return { ...section, submissions: { ...section.submissions, [safeId]: normalized }, updatedAt: now() };
  }, guildOrMeta).submissions[safeId] || null;

  if (saved) {
    emitFormSubmissionUpdated(guildId, saved);
    if (before && before.status !== saved.status) {
      notify(guildId, {
        level: ['approved'].includes(saved.status) ? 'success' : ['denied', 'request_info'].includes(saved.status) ? 'warning' : 'info',
        title: 'Form submission updated',
        message: `Submission ${saved.submissionId} changed from ${before.status} to ${saved.status}.`,
        metadata: { submissionId: saved.submissionId, formId: saved.formId, status: saved.status },
      });
    }
  }

  return saved;
}

function addSubmissionTimeline(guildId, submissionId, event = {}, guildOrMeta = {}) {
  const safeId = cleanKey(submissionId, 'submission');
  const saved = updateFormsSection(guildId, (section) => {
    const existing = section.submissions[safeId];
    if (!existing) return section;
    const timeline = [...(existing.timeline || []), normalizeTimelineEvent(event)].slice(-50);
    return { ...section, submissions: { ...section.submissions, [safeId]: { ...existing, timeline, updatedAt: now() } }, updatedAt: now() };
  }, guildOrMeta).submissions[safeId] || null;

  if (saved) {
    emitFormSubmissionUpdated(guildId, saved);
  }

  return saved;
}

function recordSubmissionDecision(guildId, submissionId, decision = {}, guildOrMeta = {}) {
  const status = SUBMISSION_STATUSES.includes(decision.status) ? decision.status : 'pending';
  const reviewedBy = cleanDiscordId(decision.reviewedBy || decision.actorId);
  const reviewedAt = now();
  const updates = {
    status,
    reviewedBy,
    reviewedAt,
    decision: {
      status,
      reviewedBy,
      reviewedAt,
      notes: cleanString(decision.notes || '', '', 1800),
      templateKey: cleanKey(decision.templateKey || status, status),
    },
  };
  const submission = updateSubmission(guildId, submissionId, updates, guildOrMeta);
  addSubmissionTimeline(guildId, submissionId, { type: `decision_${status}`, label: `Decision: ${status}`, actorId: reviewedBy, metadata: updates.decision }, guildOrMeta);
  if (submission) {
    notify(guildId, {
      level: status === 'approved' ? 'success' : status === 'denied' ? 'warning' : 'info',
      title: 'Form decision recorded',
      message: `Submission ${submission.submissionId} was marked ${status}.`,
      metadata: { submissionId: submission.submissionId, formId: submission.formId, status, reviewedBy },
    });
  }
  if (status === 'approved') incrementAnalytics(guildId, { approved: 1 }, guildOrMeta);
  if (status === 'denied') incrementAnalytics(guildId, { denied: 1 }, guildOrMeta);
  if (status === 'request_info') incrementAnalytics(guildId, { requestInfo: 1 }, guildOrMeta);
  return submission;
}

function incrementAnalytics(guildId, increments = {}, guildOrMeta = {}) {
  const analytics = updateFormsSection(guildId, (section) => {
    const nextAnalytics = { ...section.analytics };
    for (const [key, amount] of Object.entries(increments || {})) {
      const value = Number(amount || 0);
      if (!Number.isFinite(value)) continue;
      nextAnalytics[key] = Math.max(0, Number(nextAnalytics[key] || 0) + value);
    }
    return { ...section, analytics: nextAnalytics, updatedAt: now() };
  }, guildOrMeta).analytics;

  emitFormAnalyticsUpdated(guildId, analytics);
  return analytics;
}


function getSubmission(guildId, submissionId) {
  return getFormsSection(guildId).submissions[cleanKey(submissionId, 'submission')] || null;
}

const getSection = getFormsSection;
const saveSection = saveFormsSection;
const updateSection = updateFormsSection;

module.exports = {
  MODULE,
  FIELD_TYPES,
  FORM_ACTIONS,
  SUBMISSION_STATUSES,
  createId,
  cleanKey,
  defaultFormsSection,
  normalizeForm,
  normalizePanel,
  normalizeSubmission,
  normalizeFormsSection,
  normalizeWorkflowActions,
  normalizeDecisionTemplates,
  getFormsSection,
  getSection,
  saveFormsSection,
  saveSection,
  updateFormsSection,
  updateSection,
  saveForm,
  getForm,
  listForms,
  savePanel,
  getPanel,
  saveSubmission,
  getSubmission,
  updateSubmission,
  addSubmissionTimeline,
  recordSubmissionDecision,
  incrementAnalytics,
};