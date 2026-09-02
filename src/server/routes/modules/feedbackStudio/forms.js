'use strict';

// src/server/routes/modules/feedbackStudio/forms.js

const express = require('express');

const forms = require('../../../../modules/feedbackStudio/forms/forms');
const formsPanel = require('../../../../modules/feedbackStudio/forms/formsPanel');
const ticketStore = require('../../../../modules/feedbackStudio/tickets/tickets');
const planLimitManager = require('../../../../core/billing/planLimitManager');
const guildManager = require('../../../../core/guild/guildManager');
const {
  buildFormsWorkflowOverview,
  buildSubmissionWorkflowSummary,
} = require('../../../../modules/feedbackStudio/forms/formsTracking');
const {
  isGoliathPermissionError,
  validateRoleSelection,
} = require('../../../../core/security/protection/permissions');

const router = express.Router();

function success(res, payload = {}) {
  return res.json({ success: true, ...payload });
}

function failure(res, error, status = 500) {
  console.error('[Forms API]', error);

  if (isGoliathPermissionError(error)) {
    const details = error.details || {};
    return res.status(403).json({
      success: false,
      code: error.code,
      error: error.message,
      message: details.message || error.message,
      scope: details.scope || null,
      guildId: details.guildId || null,
      channelId: details.channelId || null,
      channelName: details.channelName || null,
      missingPermissions: details.missingPermissions || [],
      failures: details.failures || [],
      metadata: details.metadata || {},
      autoFixAvailable: Boolean(details.autoFixAvailable),
      confirmationRequired: Boolean(details.confirmationRequired),
    });
  }

  if (error?.code === 'PLAN_LIMIT_REACHED') {
    return res.status(403).json({
      success: false,
      code: error.code,
      error: error.message,
      limitKey: error.limitKey,
      label: error.label,
      currentPlan: error.currentPlan,
      currentPlanName: error.currentPlanName,
      currentCount: error.currentCount,
      limit: error.limit,
      remaining: error.remaining,
      upgradeHint: error.upgradeHint,
    });
  }

  return res.status(status).json({
    success: false,
    error: error.message || 'Forms API request failed.',
  });
}

function getGuildId(req) {
  const guildId = String(req.params.guildId || '').trim();
  if (!/^\d{16,25}$/.test(guildId)) throw new Error('Invalid guild ID.');
  return guildId;
}

function canonicalConfig(guildId, section = forms.getFormsSection(guildId)) {
  return {
    ...section,
    enabled: guildManager.isModuleEnabled(guildId, 'forms'),
  };
}

function getDiscordClient(req) {
  return (
    req.client ||
    req.app?.get?.('goliath.client') ||
    req.app?.locals?.client ||
    req.app?.locals?.discordClient ||
    global.client ||
    global.discordClient ||
    null
  );
}

async function fetchGuild(req, guildId) {
  const client = getDiscordClient(req);
  if (!client?.guilds?.fetch) return null;
  return client.guilds.cache.get(guildId) || client.guilds.fetch(guildId).catch(() => null);
}

async function fetchGuildChannel(req, guildId, channelId) {
  const guild = await fetchGuild(req, guildId);
  if (!guild) throw new Error('Guild is unavailable.');
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) throw new Error('Panel channel is unavailable.');
  return channel;
}

function cleanRoleIds(roleIds = []) {
  return [...new Set((Array.isArray(roleIds) ? roleIds : [roleIds]).map((roleId) => String(roleId || '').replace(/[<@&>]/g, '').trim()).filter((roleId) => /^\d{15,25}$/.test(roleId)))];
}

function cleanDiscordId(value) {
  const id = String(value || '').replace(/[<@#!&>]/g, '').trim();
  return /^\d{15,25}$/.test(id) ? id : null;
}

function cleanWorkflowText(value, maxLength = 1800) {
  return String(value || '').trim().slice(0, maxLength);
}

function getActorId(req) {
  return cleanDiscordId(req.session?.user?.id || req.body?.actorId || req.body?.reviewedBy || req.body?.reviewerId);
}

function workflowEvent(type, label, actorId, metadata = {}) {
  return {
    type,
    label,
    actorId: cleanDiscordId(actorId),
    metadata: metadata && typeof metadata === 'object' ? metadata : {},
    createdAt: new Date().toISOString(),
  };
}

function readSubmission(guildId, submissionId) {
  const section = forms.getFormsSection(guildId);
  return section.submissions?.[forms.cleanKey(submissionId)] || null;
}

function updateSubmissionWorkflow(guildId, submissionId, updater, actorId, timelineEvent) {
  const existing = readSubmission(guildId, submissionId);
  if (!existing) return null;

  const currentWorkflow = existing.workflow && typeof existing.workflow === 'object' ? existing.workflow : {};
  const nextWorkflow = typeof updater === 'function' ? updater({ ...currentWorkflow }, existing) : { ...currentWorkflow, ...(updater || {}) };
  const saved = forms.updateSubmission(guildId, submissionId, {
    workflow: {
      ...nextWorkflow,
      version: Math.max(Number(nextWorkflow.version || 1), 2),
      updatedAt: new Date().toISOString(),
      updatedBy: cleanDiscordId(actorId),
    },
  }, { action: 'forms_workflow_update', actorId });

  if (saved && timelineEvent) {
    forms.addSubmissionTimeline(guildId, submissionId, timelineEvent, { action: 'forms_workflow_timeline', actorId });
  }

  return readSubmission(guildId, submissionId) || saved;
}

async function guardFormStaffRoles(req, guildId, input = {}, scope = 'forms.staff_roles') {
  const actionRoleIds = input.actions?.pingRoleIds || input.workflowActions?.pingRoleIds || [];
  const roleIds = cleanRoleIds([...(input.staffRoleIds || input.settings?.staffRoleIds || []), ...actionRoleIds]);
  if (!roleIds.length) return null;
  const guild = await fetchGuild(req, guildId);
  if (!guild) throw new Error('Guild is unavailable.');
  const result = await validateRoleSelection(guild, roleIds, { scope, requireManageable: true });
  if (!result.ok) throw result.toError();
  return result;
}

function assertFormLimit(guildId) {
  const currentForms = forms.listForms(guildId).length;
  return planLimitManager.assertCanCreateResource(guildId, 'forms', currentForms, {
    upgradeHint: 'Upgrade to Plus for 25 forms or Pro for unlimited forms.',
  });
}

function sortByNewest(items = []) {
  return [...items].sort((a, b) => (Date.parse(b.createdAt || b.updatedAt || 0) || 0) - (Date.parse(a.createdAt || a.updatedAt || 0) || 0));
}

function filterSubmissions(submissions = [], query = {}) {
  let result = [...submissions];
  if (query.formId) result = result.filter((submission) => submission.formId === forms.cleanKey(query.formId));
  if (query.status) result = result.filter((submission) => submission.status === String(query.status).trim().toLowerCase());
  if (query.userId) {
    const userId = String(query.userId).replace(/[<@!>]/g, '').trim();
    result = result.filter((submission) => submission.userId === userId);
  }
  return result;
}

function getPanelForms(guildId, panel) {
  return (panel.formIds || []).map((formId) => forms.getForm(guildId, formId)).filter(Boolean);
}

function buildDecisionTicketUpdates(submission, decision = {}) {
  const status = String(decision.status || submission.status || '').trim().toLowerCase();
  const reviewedAt = decision.reviewedAt || new Date().toISOString();
  const reviewedBy = decision.reviewedBy || decision.actorId || submission.reviewedBy || null;
  const notes = String(decision.notes || submission.decision?.notes || '').trim();
  const ticketStatus = ['approved', 'denied'].includes(status) ? 'closed' : 'open';

  return {
    status: ticketStatus,
    closedById: ticketStatus === 'closed' ? reviewedBy : undefined,
    closedAt: ticketStatus === 'closed' ? reviewedAt : undefined,
    closeReason: ticketStatus === 'closed' ? `Form submission ${status}${notes ? `: ${notes}` : ''}` : undefined,
    metadata: {
      formWorkflow: {
        submissionId: submission.submissionId,
        formId: submission.formId,
        status,
        reviewedBy,
        reviewedAt,
        notes,
      },
    },
    tags: [...new Set([...(submission.workflow?.ticketTags || []), 'form', `form-${status}`])],
    timeline: [
      ...(Array.isArray(submission.workflow?.ticketTimeline) ? submission.workflow.ticketTimeline : []),
      {
        id: `form-decision-${Date.now()}`,
        type: 'form_decision',
        label: `Form decision: ${status}`,
        actorId: reviewedBy,
        metadata: { submissionId: submission.submissionId, formId: submission.formId, notes },
        createdAt: reviewedAt,
      },
    ],
  };
}

function syncLinkedTicketDecision(guildId, submission, decision = {}) {
  const ticketId = submission?.ticketId || submission?.workflow?.ticketId;
  if (!ticketId) return null;

  const existingTicket = ticketStore.getTicket(guildId, ticketId);
  if (!existingTicket) return null;

  const updates = buildDecisionTicketUpdates(submission, decision);
  updates.tags = [...new Set([...(existingTicket.tags || []), ...(updates.tags || [])])];
  updates.timeline = [...(existingTicket.timeline || []), ...(updates.timeline || [])].slice(-100);

  Object.keys(updates).forEach((key) => {
    if (updates[key] === undefined) delete updates[key];
  });

  return ticketStore.updateTicket(guildId, ticketId, updates);
}

router.get('/:guildId/overview', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const section = forms.getFormsSection(guildId);
    const formItems = Object.values(section.forms || {});
    const panels = Object.values(section.panels || {});
    const submissions = Object.values(section.submissions || {});
    const workflowOverview = buildFormsWorkflowOverview(formItems, submissions);

    return success(res, {
      guildId,
      overview: {
        enabled: guildManager.isModuleEnabled(guildId, 'forms'),
        formCount: formItems.length,
        enabledFormCount: formItems.filter((form) => form.enabled !== false).length,
        disabledFormCount: formItems.filter((form) => form.enabled === false).length,
        panelCount: panels.length,
        deployedPanelCount: panels.filter((panel) => panel.channelId && panel.messageId).length,
        submissionCount: submissions.length,
        ...workflowOverview,
        analytics: section.analytics || {},
        settings: section.settings || {},
      },
    });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.get('/:guildId', (req, res) => {
  try {
    const guildId = getGuildId(req);
    return success(res, { guildId, config: canonicalConfig(guildId) });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.get('/:guildId/forms', (req, res) => {
  try {
    const guildId = getGuildId(req);
    return success(res, { guildId, forms: forms.listForms(guildId) });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.get('/:guildId/forms/:formId', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const form = forms.getForm(guildId, req.params.formId);
    if (!form) return failure(res, new Error('Form not found.'), 404);
    return success(res, { guildId, form });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.post('/:guildId/forms', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    await guardFormStaffRoles(req, guildId, req.body || {}, 'forms.create_staff_roles');
    assertFormLimit(guildId);
    const saved = forms.saveForm(guildId, req.body || {});
    return success(res, { guildId, form: saved });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.put('/:guildId/forms/:formId', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    await guardFormStaffRoles(req, guildId, req.body || {}, 'forms.update_staff_roles');
    const existing = forms.getForm(guildId, req.params.formId);
    if (!existing) assertFormLimit(guildId);
    const saved = forms.saveForm(guildId, { ...(req.body || {}), formId: req.params.formId });
    return success(res, { guildId, form: saved });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.patch('/:guildId/forms/:formId/enabled', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const existing = forms.getForm(guildId, req.params.formId);
    if (!existing) return failure(res, new Error('Form not found.'), 404);
    const saved = forms.saveForm(guildId, { ...existing, enabled: req.body?.enabled !== false });
    return success(res, { guildId, form: saved });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.get('/:guildId/panels', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const section = forms.getFormsSection(guildId);
    return success(res, { guildId, panels: Object.values(section.panels || {}) });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.post('/:guildId/panels', (req, res) => {
  try {
    const guildId = getGuildId(req);
    return success(res, { guildId, panel: forms.savePanel(guildId, req.body || {}) });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.put('/:guildId/panels/:panelId', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const panel = forms.savePanel(guildId, { ...(req.body || {}), panelId: req.params.panelId });
    return success(res, { guildId, panel });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.post('/:guildId/panels/:panelId/deploy', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    const panel = forms.getPanel(guildId, req.params.panelId);
    if (!panel) return failure(res, new Error('Panel not found.'), 404);
    if (!panel.channelId) throw new Error('Panel needs a target channel before deployment.');
    const channel = await fetchGuildChannel(req, guildId, panel.channelId);
    const saved = await formsPanel.deployFormPanel(channel, panel, channel.guild);
    return success(res, { guildId, panel: saved, message: 'Panel deployed.' });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.post('/:guildId/panels/:panelId/refresh', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    const panel = forms.getPanel(guildId, req.params.panelId);
    if (!panel) return failure(res, new Error('Panel not found.'), 404);
    if (!panel.channelId || !panel.messageId) throw new Error('Panel must be deployed before it can be refreshed.');
    const channel = await fetchGuildChannel(req, guildId, panel.channelId);
    const message = await channel.messages.fetch(panel.messageId).catch(() => null);
    if (!message) throw new Error('Existing panel message was not found. Deploy a new panel instead.');
    const panelForms = getPanelForms(guildId, panel);
    await message.edit({ embeds: [formsPanel.buildFormPanelEmbed(panel, panelForms)], components: formsPanel.buildFormPanelRows(panel, panelForms) });
    const saved = forms.savePanel(guildId, panel, channel.guild);
    return success(res, { guildId, panel: saved, message: 'Panel refreshed.' });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.get('/:guildId/submissions', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const section = forms.getFormsSection(guildId);
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const submissions = filterSubmissions(Object.values(section.submissions || {}), req.query);
    return success(res, { guildId, submissions: sortByNewest(submissions).slice(0, limit), total: submissions.length });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.get('/:guildId/submissions/:submissionId', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const submission = readSubmission(guildId, req.params.submissionId);
    if (!submission) return failure(res, new Error('Submission not found.'), 404);
    return success(res, { guildId, submission });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.get('/:guildId/submissions/:submissionId/workflow', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const submission = readSubmission(guildId, req.params.submissionId);
    if (!submission) return failure(res, new Error('Submission not found.'), 404);
    const form = forms.getForm(guildId, submission.formId);
    return success(res, { guildId, workflow: buildSubmissionWorkflowSummary(form, submission) });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.patch('/:guildId/submissions/:submissionId/workflow/state', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const actorId = getActorId(req);
    const state = String(req.body?.state || '').trim().toLowerCase();
    const allowed = new Set(['pending', 'reviewing', 'under_review', 'request_info', 'closed']);
    if (!allowed.has(state)) throw new Error('Invalid workflow state.');

    const normalizedState = state === 'under_review' ? 'reviewing' : state;
    const saved = updateSubmissionWorkflow(
      guildId,
      req.params.submissionId,
      (workflow) => ({
        ...workflow,
        reviewState: normalizedState,
        status: normalizedState,
        reviewedAt: ['request_info', 'closed'].includes(normalizedState) ? new Date().toISOString() : workflow.reviewedAt || null,
        reviewedBy: ['request_info', 'closed'].includes(normalizedState) ? actorId : workflow.reviewedBy || null,
      }),
      actorId,
      workflowEvent('workflow_state_changed', `Workflow state changed to ${normalizedState}`, actorId, { state: normalizedState })
    );

    if (!saved) return failure(res, new Error('Submission not found.'), 404);
    return success(res, { guildId, submission: saved });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.patch('/:guildId/submissions/:submissionId/workflow/reviewer', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const actorId = getActorId(req);
    const reviewerId = cleanDiscordId(req.body?.reviewerId || req.body?.assignedTo || actorId);
    if (!reviewerId) throw new Error('Invalid reviewer ID.');

    const saved = updateSubmissionWorkflow(
      guildId,
      req.params.submissionId,
      (workflow) => ({
        ...workflow,
        reviewState: workflow.reviewState || 'reviewing',
        assignedTo: reviewerId,
        reviewerId,
        assignedBy: actorId,
        assignedAt: new Date().toISOString(),
      }),
      actorId,
      workflowEvent('workflow_reviewer_assigned', 'Reviewer assigned', actorId, { reviewerId })
    );

    if (!saved) return failure(res, new Error('Submission not found.'), 404);
    return success(res, { guildId, submission: saved });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.post('/:guildId/submissions/:submissionId/workflow/notes', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const actorId = getActorId(req);
    const note = cleanWorkflowText(req.body?.note || req.body?.content || '', 1800);
    if (!note) throw new Error('Note is required.');

    const noteEntry = {
      id: `note_${Date.now()}`,
      note,
      actorId,
      createdAt: new Date().toISOString(),
    };

    const saved = updateSubmissionWorkflow(
      guildId,
      req.params.submissionId,
      (workflow) => ({
        ...workflow,
        internalNotes: [...(Array.isArray(workflow.internalNotes) ? workflow.internalNotes : []), noteEntry].slice(-100),
      }),
      actorId,
      workflowEvent('workflow_internal_note', 'Internal note added', actorId, { noteId: noteEntry.id })
    );

    if (!saved) return failure(res, new Error('Submission not found.'), 404);
    return success(res, { guildId, submission: saved, note: noteEntry });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.patch('/:guildId/submissions/:submissionId/status', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const status = String(req.body?.status || '').trim().toLowerCase();
    if (!forms.SUBMISSION_STATUSES.includes(status)) throw new Error('Invalid submission status.');

    let updated;
    let linkedTicket = null;
    const actorId = req.session?.user?.id || req.body?.reviewedBy || null;

    if (['approved', 'denied', 'request_info'].includes(status)) {
      updated = forms.recordSubmissionDecision(guildId, req.params.submissionId, {
        status,
        reviewedBy: actorId,
        notes: req.body?.notes || '',
        templateKey: req.body?.templateKey || status,
      });

      if (updated) {
        linkedTicket = syncLinkedTicketDecision(guildId, updated, {
          status,
          reviewedBy: actorId,
          notes: req.body?.notes || '',
          reviewedAt: updated.reviewedAt,
        });

        forms.addSubmissionTimeline(guildId, req.params.submissionId, {
          type: linkedTicket ? 'ticket_synced' : 'ticket_sync_skipped',
          label: linkedTicket ? 'Linked ticket updated' : 'No linked ticket to update',
          actorId,
          metadata: { ticketId: linkedTicket?.ticketId || updated.ticketId || null, status },
        });
      }
    } else {
      updated = forms.updateSubmission(guildId, req.params.submissionId, {
        status,
        reviewedBy: req.body?.reviewedBy || null,
        reviewedAt: status === 'closed' ? new Date().toISOString() : null,
      });
      if (updated) {
        forms.addSubmissionTimeline(guildId, req.params.submissionId, {
          type: `status_${status}`,
          label: `Status changed to ${status}`,
          actorId,
        });
      }
    }

    const finalSubmission = updated ? forms.getFormsSection(guildId).submissions?.[forms.cleanKey(req.params.submissionId)] || updated : null;
    if (!finalSubmission) return failure(res, new Error('Submission not found.'), 404);
    return success(res, { guildId, submission: finalSubmission, linkedTicket });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.patch('/:guildId/settings', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    await guardFormStaffRoles(req, guildId, req.body || {}, 'forms.settings_staff_roles');
    if (typeof req.body?.enabled === 'boolean') {
      guildManager.setModuleEnabled(guildId, 'forms', req.body.enabled, { actorId: getActorId(req) });
    }
    const section = forms.updateFormsSection(guildId, (current) => ({
      ...current,
      settings: { ...(current.settings || {}), ...(req.body?.settings || {}) },
    }));
    return success(res, { guildId, config: canonicalConfig(guildId, section) });
  } catch (error) {
    return failure(res, error, 400);
  }
});

module.exports = router;
