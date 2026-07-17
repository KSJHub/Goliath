'use strict';

const { EmbedBuilder } = require('discord.js');

const formStore = require('./formStore');
const ticketManager = require('../tickets/ticketManager');
const ticketChannelManager = require('../tickets/ticketChannelManager');
const { sendTicketControlMessage } = require('../tickets/ticketPanelManager');
const { updateTicket } = require('../tickets/ticketStore');
const { isModuleEnabled } = require('../../core/guild/guildManager');
const {
  TICKET_CHANNEL_PERMISSIONS,
  guardCategoryAccess,
  isGoliathPermissionError,
} = require('../../core/security/goliathPermissionGuard');

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
  return formStore.normalizeWorkflowActions(form.actions || form.workflowActions || {}, form.action);
}

function shouldCreateTicket(form = {}) {
  const actions = getWorkflowActions(form);
  return form.action === formStore.FORM_ACTIONS.CREATE_TICKET || actions.createTicket === true;
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

function addTimeline(guildId, submissionId, entry, guild) {
  try {
    return formStore.addSubmissionTimeline(guildId, submissionId, entry, guild);
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

    const lines = [
      `Your **${cleanText(form.name, 100)}** submission has been received.`,
      `Reference: ${cleanText(submission.submissionId, 100)}`,
    ];
    if (bridgeResult?.ticket) lines.push(`Ticket: ${cleanText(bridgeResult.ticket.displayId || bridgeResult.ticket.ticketId, 100)}`);
    if (bridgeResult?.channel?.id) lines.push(`Channel: <#${bridgeResult.channel.id}>`);

    await user.send({ content: lines.join('\n').slice(0, 1900) });
    formStore.incrementAnalytics(interaction.guildId, { dmSent: 1 }, interaction.guild);
    formStore.updateSubmission(interaction.guildId, submission.submissionId, {
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
    const freshSubmission = formStore.getSubmission?.(interaction.guildId, submission.submissionId) || submission;
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

      if (!ticket?.ticketId) throw new Error('Ticket manager did not return a valid ticket.');
      addTimeline(interaction.guildId, submission.submissionId, {
        type: 'ticket_created',
        label: 'Ticket created',
        actorId: interaction.client?.user?.id || null,
        metadata: { ticketId: ticket.ticketId, displayId: ticket.displayId },
      }, interaction.guild);

      let channel = null;
      let savedTicket = ticket;
      try {
        channel = await ticketChannelManager.createTicketChannel({ client: interaction.client, guild: interaction.guild, ticket, panel });
      } catch (channelError) {
        console.error('[Forms] Failed to create ticket channel for submission:', channelError);
        addTimeline(interaction.guildId, submission.submissionId, {
          type: 'ticket_channel_failed',
          label: 'Ticket channel creation failed',
          metadata: { error: cleanText(channelError.message, 500) },
        }, interaction.guild);
        if (isGoliathPermissionError(channelError)) throw channelError;
      }

      if (channel?.send) {
        const controlMessage = await sendTicketControlMessage({ channel, ticket: savedTicket, panel, user: interaction.user }).catch((error) => {
          console.error('[Forms] Failed to post ticket control message:', error);
          return null;
        });
        if (controlMessage?.id) {
          savedTicket = updateTicket(interaction.guildId, ticket.ticketId, {
            discordMessageId: controlMessage.id,
            messageId: controlMessage.id,
          }) || savedTicket;
        }

        const roleIds = [...new Set((actions.pingRoleIds || []).map(cleanDiscordId).filter(Boolean))].slice(0, 20);
        await channel.send({
          content: buildStaffPingContent(form, freshSubmission),
          embeds: [buildSubmissionTicketEmbed(form, freshSubmission, savedTicket)],
          allowedMentions: { users: cleanDiscordId(freshSubmission.userId) ? [freshSubmission.userId] : [], roles: roleIds },
        }).catch((error) => console.error('[Forms] Failed to post submission embed in ticket channel:', error));

        if (actions.notifyStaff !== false && roleIds.length) {
          formStore.incrementAnalytics(interaction.guildId, { staffNotified: 1 }, interaction.guild);
        }
      }

      const updatedSubmission = formStore.updateSubmission(interaction.guildId, submission.submissionId, {
        ticketId: savedTicket.ticketId,
        ticketChannelId: channel?.id || null,
        status: 'pending',
        workflow: {
          ...(freshSubmission.workflow || {}),
          ticketCreated: true,
          ticketId: savedTicket.ticketId,
          ticketDisplayId: savedTicket.displayId,
          ticketChannelId: channel?.id || null,
          ticketControlMessageId: savedTicket.discordMessageId || savedTicket.messageId || null,
          ticketCreatedAt: now(),
        },
      }, interaction.guild);

      if (!updatedSubmission?.ticketId) throw new Error('Ticket was created but the form submission could not be linked.');
      formStore.incrementAnalytics(interaction.guildId, { ticketsCreated: 1 }, interaction.guild);

      const result = { ok: true, ticket: savedTicket, channel, submission: updatedSubmission };
      await sendConfirmationDm(interaction, form, updatedSubmission, result);
      return result;
    } catch (error) {
      console.error('[Forms] Ticket bridge failed:', error);
      addTimeline(interaction.guildId, submission.submissionId, {
        type: 'workflow_failed',
        label: 'Forms → Tickets workflow failed',
        metadata: { error: cleanText(error.message || 'Ticket bridge failed.', 500) },
      }, interaction.guild);
      return {
        ok: false,
        ticket: null,
        channel: null,
        error: error.message || 'Ticket bridge failed.',
        guard: isGoliathPermissionError(error) ? error.details : null,
      };
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
  createTicketForSubmission,
  getWorkflowActions,
  shouldCreateTicket,
};