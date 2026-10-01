'use strict';

const { EmbedBuilder } = require('discord.js');

const forms = require('./forms');
const ticketManager = require('../tickets/tickets');
const ticketChannelManager = require('../tickets/ticketsChannels');
const { sendTicketControlMessage } = require('../tickets/ticketsPanel');
const { updateTicket } = require('../tickets/tickets');
const emojis = require('../../utilityStudio/emojis/emojis');
const emojiPayload = require('../../utilityStudio/emojis/emojiPayload');
const { isModuleEnabled } = require('../../../core/guild/guildManager');
const { buildMemberNotice } = require('../../../core/ui/memberNotice');
const {
  TICKET_CHANNEL_PERMISSIONS,
  guardCategoryAccess,
  isGoliathPermissionError,
} = require('../../../core/security/protection/permissions');

const workflowLocks = new Map();
const MAX_DESCRIPTION_LENGTH = 4000;

function now() {
  return new Date().toISOString();
}

function cleanDiscordId(value) {
  const id = String(value || '').replace(/[<@#!&>]/g, '').trim();
  return /^\d{15,25}$/.test(id) ? id : null;
}

function cleanText(value, maxLength = 1000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function formatAnswerValue(value) {
  return cleanText(value, 1000) || '_No answer provided._';
}

function buildAnswerLines(form, submission) {
  const fields = Array.isArray(form.fields) && form.fields.length
    ? form.fields
    : Object.keys(submission.answers || {}).map((id) => ({ id, label: id }));

  return fields.slice(0, 25).map((field) => {
    const fieldId = cleanText(field.id, 100);
    const label = cleanText(field.label || fieldId || 'Question', 256);
    const answer = formatAnswerValue(submission.answers?.[fieldId]);
    return `**${label}**\n${answer}`;
  });
}

function buildUserMention(userId) {
  const id = cleanDiscordId(userId);
  return id ? `<@${id}>` : null;
}

function getWorkflowActions(form = {}) {
  return forms.normalizeWorkflowActions(form.actions || form.workflowActions || {}, form.action);
}

function shouldCreateTicket(form = {}) {
  const actions = getWorkflowActions(form);
  return form.action === forms.FORM_ACTIONS.CREATE_TICKET || actions.createTicket === true;
}

function buildSubmissionTicketEmbed(form, submission, ticket) {
  const answerText = buildAnswerLines(form, submission).join('\n\n');
  const header = [
    `**Submission ID:** \`${cleanText(submission.submissionId, 100)}\``,
    `**Ticket:** \`${cleanText(ticket.displayId || ticket.ticketId, 100)}\``,
    `**User:** ${buildUserMention(submission.userId) || cleanText(submission.userTag, 100) || 'Unknown'}`,
    `**Form:** \`${cleanText(form.formId, 100)}\``,
    '',
  ].join('\n');

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📝 ${cleanText(form.name || 'Form Submission', 240)}`)
    .setDescription(`${header}${answerText || '_No answers captured._'}`.slice(0, MAX_DESCRIPTION_LENGTH))
    .setFooter({ text: 'Goliath Forms → Tickets Workflow' })
    .setTimestamp(new Date());
}

function buildStaffPingContent(form, submission) {
  const actions = getWorkflowActions(form);
  const roleIds = [...new Set((actions.pingRoleIds || []).map(cleanDiscordId).filter(Boolean))].slice(0, 20);
  const roleMentions = actions.notifyStaff !== false ? roleIds.map((roleId) => `<@&${roleId}>`) : [];
  const userMention = buildUserMention(submission.userId);
  return [...roleMentions, userMention].filter(Boolean).join(' ') || undefined;
}

function buildFormTicketPanel(form = {}) {
  return {
    panelId: form.formId || null,
    name: form.name || 'Form Submission',
    ticketType: form.ticketType || form.formId || 'form',
    staffRoleIds: form.staffRoleIds || [],
    managerRoleIds: form.managerRoleIds || [],
    viewerRoleIds: form.viewerRoleIds || [],
    outputCategoryId: form.outputCategoryId || null,
    archiveCategoryId: form.archiveCategoryId || null,
    logsChannelId: form.logsChannelId || null,
    transcriptsChannelId: form.transcriptsChannelId || null,
  };
}

async function resolveFormPayload(guild, payload = {}) {
  return emojiPayload.resolveMessagePayload(guild.client, guild.id, payload, 'forms');
}

function addTimeline(guildId, submissionId, entry, guild) {
  try {
    return forms.addSubmissionTimeline(guildId, submissionId, entry, guild);
  } catch (error) {
    console.error('[Forms] Failed to append submission timeline:', error);
    return null;
  }
}

async function sendConfirmationDm(interaction, form, submission, bridgeResult) {
  const actions = getWorkflowActions(form);
  if (actions.sendDm === false || !submission.userId || submission.workflow?.confirmationDmSent === true) return false;

  try {
    const user = interaction.user?.id === submission.userId
      ? interaction.user
      : await interaction.client.users.fetch(submission.userId).catch(() => null);
    if (!user?.send) return false;

    const ticketRef = bridgeResult?.ticket
      ? cleanText(bridgeResult.ticket.displayId || bridgeResult.ticket.ticketId, 100)
      : null;
    const channelId = cleanDiscordId(bridgeResult?.channel?.id);
    const submittedAt = submission.createdAt || submission.submittedAt || submission.created_at || now();
    const contextFields = [
      { name: '📝 Form', value: cleanText(form.name || 'Form Submission', 1024), inline: true },
      { name: '🟡 Status', value: 'Received', inline: true },
      { name: '🕒 Submitted', value: `<t:${Math.floor(new Date(submittedAt).getTime() / 1000)}:f>`, inline: false },
    ];
    if (ticketRef) contextFields.push({ name: '🎫 Ticket', value: `\`${ticketRef}\``, inline: true });
    if (channelId) contextFields.push({ name: '📍 Ticket Channel', value: `<#${channelId}>`, inline: true });

    const notice = buildMemberNotice(interaction.guild, {
      moduleName: 'Forms',
      moduleEmoji: '📝',
      title: 'FORM SUBMITTED',
      subtitle: 'Submission Receipt',
      color: 0x5865f2,
      referenceLabel: 'Submission',
      referenceValue: cleanText(submission.submissionId, 100),
      status: '🟡 Received',
      member: user,
      contextFields,
      detailsTitle: '📋 SUBMISSION RECEIVED',
      details: `Your **${cleanText(form.name || 'form', 100)}** submission has been successfully received by Goliath.`,
      meaning: 'Your submission is now recorded in this server. This receipt confirms delivery; it does not by itself mean the submission has been approved or completed.',
      nextSteps: ticketRef
        ? `A ticket has been linked to this submission${channelId ? ` in <#${channelId}>` : ''}. Follow any instructions there and wait for the server team to review your submission.`
        : 'The server team can now review your submission. Any further action or outcome will depend on this form\'s configured workflow.',
      footerLabel: `Submission ${cleanText(submission.submissionId, 80)}`,
    });

    await user.send(notice);
    forms.incrementAnalytics(interaction.guildId, { dmSent: 1 }, interaction.guild);
    forms.updateSubmission(interaction.guildId, submission.submissionId, {
      workflow: { ...(submission.workflow || {}), confirmationDmSent: true, confirmationDmSentAt: now() },
    }, interaction.guild);
    addTimeline(interaction.guildId, submission.submissionId, {
      type: 'dm_sent',
      label: 'Confirmation DM sent',
      metadata: { ticketId: bridgeResult?.ticket?.ticketId || null },
    }, interaction.guild);
    return true;
  } catch (error) {
    addTimeline(interaction.guildId, submission.submissionId, {
      type: 'dm_failed',
      label: 'Confirmation DM failed',
      metadata: { error: cleanText(error.message, 500) },
    }, interaction.guild);
    return false;
  }
}

async function validateFormTicketTarget(interaction, form) {
  if (!interaction?.guild || !form?.outputCategoryId) return null;
  return guardCategoryAccess(interaction.guild, form.outputCategoryId, TICKET_CHANNEL_PERMISSIONS, {
    scope: 'forms.ticket_bridge',
    autoFix: true,
    throwOnFail: true,
    reason: 'Goliath forms to ticket category validation',
  });
}

function getLockKey(interaction, submission) {
  return `${interaction.guildId}:${submission.submissionId}`;
}

async function createTicketForSubmission({ interaction, form, submission } = {}) {
  if (!interaction?.guild || !interaction.guildId || !form || !submission?.submissionId) {
    return { ok: false, ticket: null, channel: null, error: 'Missing guild, form, or submission.' };
  }

  if (!isModuleEnabled(interaction.guildId, 'forms')) {
    return { ok: false, ticket: null, channel: null, error: 'Forms module is disabled.' };
  }

  const lockKey = getLockKey(interaction, submission);
  if (workflowLocks.has(lockKey)) return workflowLocks.get(lockKey);

  const task = (async () => {
    const freshSubmission = forms.getSubmission?.(interaction.guildId, submission.submissionId) || submission;
    if (freshSubmission.ticketId) {
      return {
        ok: true,
        duplicate: true,
        ticket: { ticketId: freshSubmission.ticketId, displayId: freshSubmission.workflow?.ticketDisplayId },
        channel: freshSubmission.ticketChannelId ? interaction.guild.channels.cache.get(freshSubmission.ticketChannelId) || null : null,
        submission: freshSubmission,
      };
    }

    const actions = getWorkflowActions(form);
    const panel = buildFormTicketPanel(form);
    addTimeline(interaction.guildId, submission.submissionId, {
      type: 'submitted',
      label: 'Submission received',
      actorId: submission.userId || interaction.user?.id,
      metadata: { formId: form.formId, action: form.action, actions },
    }, interaction.guild);

    if (!shouldCreateTicket(form)) {
      const skipped = { ok: true, skipped: true, ticket: null, channel: null, reason: 'Workflow does not create tickets.' };
      await sendConfirmationDm(interaction, form, freshSubmission, skipped);
      return skipped;
    }

    try {
      if (!isModuleEnabled(interaction.guildId, 'forms')) throw new Error('Forms module was disabled before ticket creation.');
      await validateFormTicketTarget(interaction, form);

      const answerSummary = buildAnswerLines(form, freshSubmission).join('\n\n').slice(0, 3500);
      const ticket = await ticketManager.createNewTicket({
        guildId: interaction.guildId,
        creatorId: cleanDiscordId(freshSubmission.userId || interaction.user.id),
        type: cleanText(form.ticketType || form.formId || 'form', 100),
        title: `${cleanText(form.name || 'Form', 180)} Submission`,
        description: answerSummary || 'Form submission received.',
        priority: 'normal',
        source: 'form',
        sourceId: form.formId,
        formSubmissionId: freshSubmission.submissionId,
        tags: [...new Set(['form', form.formId, form.ticketType].filter(Boolean).map((tag) => cleanText(tag, 50)))],
        metadata: {
          formId: form.formId,
          formName: cleanText(form.name, 100),
          submissionId: freshSubmission.submissionId,
          submitterTag: cleanText(freshSubmission.userTag, 100),
          creatorUsername: cleanText(interaction.user?.username, 100),
          creatorTag: cleanText(interaction.user?.tag, 100),
          panelId: form.formId,
          sourcePanelId: form.formId,
          workflow: { actions, createdAt: now() },
        },
      });

      let channel = null;
      if (ticket?.ticketId) {
        channel = await ticketChannelManager.createTicketChannel(interaction.guild, ticket, panel, interaction.user).catch(() => null);
        if (channel?.id) {
          await updateTicket(interaction.guildId, ticket.ticketId, { channelId: channel.id }).catch(() => null);
          await channel.send({ embeds: [buildSubmissionTicketEmbed(form, freshSubmission, ticket)], content: buildStaffPingContent(form, freshSubmission), allowedMentions: { users: [freshSubmission.userId].filter(Boolean), roles: actions.pingRoleIds || [], parse: [] } }).catch(() => null);
          await sendTicketControlMessage(channel, ticket, panel).catch(() => null);
        }
      }

      const updated = forms.updateSubmission(interaction.guildId, submission.submissionId, {
        ticketId: ticket?.ticketId || null,
        ticketChannelId: channel?.id || null,
        workflow: {
          ...(freshSubmission.workflow || {}),
          ticketDisplayId: ticket?.displayId || null,
          ticketCreatedAt: now(),
        },
      }, interaction.guild);

      addTimeline(interaction.guildId, submission.submissionId, {
        type: 'ticket_created',
        label: 'Ticket created from form submission',
        metadata: { ticketId: ticket?.ticketId || null, channelId: channel?.id || null },
      }, interaction.guild);

      const result = { ok: true, ticket, channel, submission: updated };
      await sendConfirmationDm(interaction, form, updated || freshSubmission, result);
      return result;
    } catch (error) {
      if (isGoliathPermissionError(error)) console.warn('[Forms] Ticket workflow permission failure:', error.message);
      else console.error('[Forms] Ticket workflow failed:', error);
      addTimeline(interaction.guildId, submission.submissionId, {
        type: 'ticket_failed',
        label: 'Ticket workflow failed',
        metadata: { error: cleanText(error.message, 500) },
      }, interaction.guild);
      return { ok: false, ticket: null, channel: null, error: cleanText(error.message, 500) };
    }
  })();

  workflowLocks.set(lockKey, task);
  try {
    return await task;
  } finally {
    workflowLocks.delete(lockKey);
  }
}

module.exports = {
  buildSubmissionTicketEmbed,
  buildStaffPingContent,
  createTicketForSubmission,
  sendConfirmationDm,
};
