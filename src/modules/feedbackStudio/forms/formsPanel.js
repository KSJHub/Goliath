'use strict';

// src/modules/feedbackStudio/forms/formManager.js

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  RoleSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const forms = require('./forms');
const { isModuleEnabled, setModuleEnabled } = require('../../../core/guild/guildManager');
const {
  DEFAULT_BOT_CHANNEL_PERMISSIONS,
  guardChannelAccess,
} = require('../../../core/security/goliathPermissionGuard');

const CUSTOM_ID_PREFIX = 'form';
const MAX_MODAL_FIELDS = 5;

function buildFormOpenCustomId(formId) {
  return `${CUSTOM_ID_PREFIX}:open:${forms.cleanKey(formId)}`;
}

function buildFormSubmitCustomId(formId) {
  return `${CUSTOM_ID_PREFIX}:submit:${forms.cleanKey(formId)}`;
}

function parseFormCustomId(customId = '') {
  const [prefix, action, id] = String(customId || '').split(':');
  if (prefix !== CUSTOM_ID_PREFIX || !action) return null;

  return {
    action,
    id: id ? forms.cleanKey(id) : null,
  };
}

function buildFormsOverviewEmbed(guildId) {
  const section = forms.getFormsSection(guildId);
  const moduleEnabled = isModuleEnabled(guildId, 'forms');
  const formItems = Object.values(section.forms || {});
  const enabledForms = formItems.filter((form) => form.enabled !== false);

  return new EmbedBuilder()
    .setColor(moduleEnabled ? 0x5865f2 : 0xed4245)
    .setTitle('Universal Forms')
    .setDescription([
      '**One clean form engine for applications, appeals, reports and support.**',
      '',
      `> **Status:** ${moduleEnabled ? 'Enabled' : 'Disabled'}`,
      `> **Forms:** ${enabledForms.length}/${formItems.length} active`,
      `> **Submissions:** ${section.analytics?.submitted || 0}`,
      `> **Tickets Created:** ${section.analytics?.ticketsCreated || 0}`,
      '',
      formItems.length
        ? formItems.slice(0, 10).map((form, index) => `**${index + 1}. ${form.name}** - ${form.enabled === false ? 'Disabled' : form.action}`).join('\n')
        : 'No forms created yet. Dashboard builder can wire into this store next.',
    ].join('\n'))
    .setFooter({ text: 'Goliath Forms - Universal forms + tickets foundation' })
    .setTimestamp(new Date());
}

function buildFormPanelEmbed(panel = {}, forms = []) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(panel.title || 'Forms')
    .setDescription([
      panel.description || 'Choose a form below.',
      '',
      forms.length
        ? forms.map((form) => `- **${form.name}** - ${form.description || 'Submit for staff review.'}`).join('\n')
        : 'No forms are currently available.',
    ].join('\n'))
    .setFooter({ text: 'Goliath Forms' })
    .setTimestamp(new Date());
}

function buildFormPanelRows(panel = {}, forms = []) {
  const buttons = forms
    .filter((form) => form.enabled !== false)
    .slice(0, 25)
    .map((form) => new ButtonBuilder()
      .setCustomId(buildFormOpenCustomId(form.formId))
      .setLabel(form.buttonLabel || form.name || 'Open Form')
      .setStyle(ButtonStyle.Primary));

  const rows = [];
  for (let index = 0; index < buttons.length; index += 5) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(index, index + 5)));
  }

  return rows;
}

function textInputStyleForField(field) {
  return field.type === forms.FIELD_TYPES.PARAGRAPH
    ? TextInputStyle.Paragraph
    : TextInputStyle.Short;
}

function buildFormModal(form) {
  const modal = new ModalBuilder()
    .setCustomId(buildFormSubmitCustomId(form.formId))
    .setTitle(String(form.name || 'Submit Form').slice(0, 45));

  const fields = Array.isArray(form.fields) ? form.fields.slice(0, MAX_MODAL_FIELDS) : [];

  if (!fields.length) {
    fields.push({
      id: 'message',
      label: 'Message',
      type: forms.FIELD_TYPES.PARAGRAPH,
      placeholder: 'Write your response here.',
      required: true,
      maxLength: 1000,
    });
  }

  modal.addComponents(fields.map((field) => new ActionRowBuilder().addComponents(
    new TextInputBuilder()
      .setCustomId(field.id)
      .setLabel(String(field.label || field.id).slice(0, 45))
      .setStyle(textInputStyleForField(field))
      .setPlaceholder(String(field.placeholder || field.options?.join(', ') || '').slice(0, 100))
      .setRequired(field.required !== false)
      .setMaxLength(Math.min(Math.max(Number(field.maxLength || 400), 1), 4000))
  )));

  return modal;
}

async function deployFormPanel(channel, panel, guildOrMeta = {}) {
  if (!channel?.guild?.id || !channel?.send) {
    throw new Error('A sendable channel is required.');
  }

  if (!isModuleEnabled(channel.guild.id, 'forms')) {
    throw new Error('Forms module is disabled for this server.');
  }

  await guardChannelAccess(
    channel.guild,
    channel.id,
    DEFAULT_BOT_CHANNEL_PERMISSIONS,
    {
      scope: 'forms.panel_deployment',
      autoFix: true,
      throwOnFail: true,
      reason: 'Goliath forms panel deployment validation',
    }
  );

  const panelForms = panel.formIds
    .map((formId) => forms.getForm(channel.guild.id, formId))
    .filter(Boolean);

  const savedPanel = forms.savePanel(channel.guild.id, {
    ...panel,
    channelId: channel.id,
  }, guildOrMeta);

  const message = await channel.send({
    embeds: [buildFormPanelEmbed(savedPanel, panelForms)],
    components: buildFormPanelRows(savedPanel, panelForms),
  });

  return forms.savePanel(channel.guild.id, {
    ...savedPanel,
    channelId: channel.id,
    messageId: message.id,
  }, guildOrMeta);
}

function getModalFields(form) {
  const fields = Array.isArray(form.fields) && form.fields.length
    ? form.fields.slice(0, MAX_MODAL_FIELDS)
    : [{ id: 'message', label: 'Message', type: forms.FIELD_TYPES.PARAGRAPH, required: true, maxLength: 1000 }];

  return fields;
}

function normalizeAnswerValue(field, value) {
  const raw = String(value ?? '').trim();

  if (field.type === forms.FIELD_TYPES.NUMBER) {
    return raw.replace(/,/g, '').trim();
  }

  if (field.type === forms.FIELD_TYPES.BOOLEAN) {
    const clean = raw.toLowerCase();
    if (['yes', 'y', 'true', '1'].includes(clean)) return 'Yes';
    if (['no', 'n', 'false', '0'].includes(clean)) return 'No';
  }

  if (field.type === forms.FIELD_TYPES.USER_MENTION || field.type === forms.FIELD_TYPES.ROLE_MENTION) {
    return raw.replace(/[<>]/g, '').trim();
  }

  return raw;
}

function validateAnswer(field, value) {
  const label = field.label || field.id || 'Question';
  const answer = normalizeAnswerValue(field, value);
  const errors = [];
  const minLength = Math.max(0, Number(field.minLength || 0));
  const maxLength = Math.min(Math.max(Number(field.maxLength || 400), 1), 4000);

  if (field.required !== false && !answer) {
    errors.push(`${label} is required.`);
    return { answer, errors };
  }

  if (!answer) return { answer, errors };

  if (answer.length < minLength) {
    errors.push(`${label} must be at least ${minLength} characters.`);
  }

  if (answer.length > maxLength) {
    errors.push(`${label} must be ${maxLength} characters or fewer.`);
  }

  if (field.type === forms.FIELD_TYPES.NUMBER && !/^-?\d+(\.\d+)?$/.test(answer)) {
    errors.push(`${label} must be a valid number.`);
  }

  if (field.type === forms.FIELD_TYPES.BOOLEAN && !['Yes', 'No'].includes(answer)) {
    errors.push(`${label} must be yes or no.`);
  }

  if ((field.type === forms.FIELD_TYPES.SELECT || field.type === forms.FIELD_TYPES.CHECKBOX) && Array.isArray(field.options) && field.options.length) {
    const allowed = field.options.map((option) => String(option).trim().toLowerCase());
    const selected = answer.split(',').map((option) => option.trim().toLowerCase()).filter(Boolean);
    const invalid = selected.filter((option) => !allowed.includes(option));

    if (invalid.length) {
      errors.push(`${label} must match one of: ${field.options.join(', ')}.`);
    }
  }

  if (field.type === forms.FIELD_TYPES.USER_MENTION && !/^@?!?\d{15,25}$|^\d{15,25}$/.test(answer)) {
    errors.push(`${label} must be a valid user mention or user ID.`);
  }

  if (field.type === forms.FIELD_TYPES.ROLE_MENTION && !/^@?&?\d{15,25}$|^\d{15,25}$/.test(answer)) {
    errors.push(`${label} must be a valid role mention or role ID.`);
  }

  return { answer, errors };
}

function collectModalAnswers(interaction, form) {
  const answers = {};
  const errors = [];

  for (const field of getModalFields(form)) {
    const rawValue = interaction.fields?.getTextInputValue(field.id) || '';
    const result = validateAnswer(field, rawValue);
    answers[field.id] = result.answer;
    errors.push(...result.errors);
  }

  return { answers, errors };
}

function buildValidationErrorReply(errors = []) {
  return [
    'Your form could not be submitted yet.',
    '',
    errors.slice(0, 8).map((error) => `• ${error}`).join('\n'),
    errors.length > 8 ? `• ${errors.length - 8} more issue(s).` : null,
  ].filter(Boolean).join('\n').slice(0, 1900);
}

function buildSubmissionReply(form, submission, bridgeResult) {
  if (bridgeResult?.ok && bridgeResult.ticket) {
    return [
      `Your **${form.name}** submission was received.`,
      `Reference: ${submission.submissionId}`,
      `Ticket: ${bridgeResult.ticket.displayId || bridgeResult.ticket.ticketId}`,
      bridgeResult.channel ? `Channel: <#${bridgeResult.channel.id}>` : 'Staff ticket record created. Channel creation is pending/recoverable.',
    ].join('\n');
  }

  if (bridgeResult?.skipped) {
    return `Your **${form.name}** submission was received. Reference: ${submission.submissionId}`;
  }

  return [
    `Your **${form.name}** submission was received.`,
    `Reference: ${submission.submissionId}`,
    'Staff ticket creation failed, but the submission was saved for recovery.',
  ].join('\n');
}


function row(...components) {
  return new ActionRowBuilder().addComponents(...components);
}

function button(customId, label, style = ButtonStyle.Primary) {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
}

function getMemberDisplayName(interaction) {
  return interaction.member?.displayName || interaction.user?.displayName || interaction.user?.username || 'Unknown User';
}

function formatChannel(id) {
  return id ? `<#${id}>` : '`Not set`';
}

function formatRoles(ids = []) {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
  return list.length ? list.map((id) => `<@&${id}>`).join(', ') : '`None`';
}

function buildFormsAdminPanel(guild, memberDisplayName = 'Unknown User') {
  const section = forms.getSection(guild.id);
  const moduleEnabled = isModuleEnabled(guild.id, 'forms');
  const formItems = Object.values(section.forms || {});
  const submissions = Object.values(section.submissions || {});
  const pending = submissions.filter((submission) => submission.status === 'pending').length;

  const embed = new EmbedBuilder()
    .setColor(moduleEnabled ? 0x57f287 : 0x5865f2)
    .setTitle('📝 Forms')
    .setDescription([
      'Configure form deployment, logging and review behaviour.',
      '',
      `**Status:** ${moduleEnabled ? 'Enabled ✅' : 'Disabled ❌'}`,
      `**Submit Channel:** ${formatChannel(section.submitChannelId)}`,
      `**Log Channel:** ${formatChannel(section.logChannelId)}`,
      `**Manager Roles:** ${formatRoles(section.managerRoleIds)}`,
      `**Require Review:** ${section.requireReview !== false ? 'Yes ✅' : 'No ❌'}`,
      `**Anonymous:** ${section.anonymousSubmissions ? 'Yes ✅' : 'No ❌'}`,
      `**Store Responses:** ${section.storeResponses !== false ? 'Yes ✅' : 'No ❌'}`,
      '',
      `Forms: \`${formItems.length}\` | Submissions: \`${submissions.length}\` | Pending: \`${pending}\``,
      `Submitted: \`${section.analytics.submitted}\` | Approved: \`${section.analytics.approved}\` | Denied: \`${section.analytics.denied}\``,
    ].join('\n'))
    .setFooter({ text: `Requested by ${memberDisplayName}` })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      row(
        new ChannelSelectMenuBuilder().setCustomId('admin:forms:submitChannel').setPlaceholder('Submit channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)
      ),
      row(
        new ChannelSelectMenuBuilder().setCustomId('admin:forms:logChannel').setPlaceholder('Log/review channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)
      ),
      row(
        new RoleSelectMenuBuilder().setCustomId('admin:forms:managerRoles').setPlaceholder('Manager roles').setMinValues(0).setMaxValues(10)
      ),
      row(
        button('admin:forms:deployDefault', '🚀 Deploy Form', ButtonStyle.Success),
        button(moduleEnabled ? 'admin:forms:disable' : 'admin:forms:enable', moduleEnabled ? '⏸️ Disable' : '▶️ Enable', ButtonStyle.Secondary),
        button('admin:forms:toggleReview', '🔎 Review', ButtonStyle.Secondary),
        button('admin:forms:toggleAnonymous', '👤 Anonymous', ButtonStyle.Secondary),
        button('admin:forms:toggleStore', '💾 Store', ButtonStyle.Secondary)
      ),
      row(button('admin:modules', '⬅️ Modules', ButtonStyle.Secondary)),
    ],
  };
}

function save(guild, updater) {
  return forms.updateSection(guild.id, updater, guild);
}

async function safeUpdate(interaction, payload) {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload);
    return true;
  }
  await interaction.update(payload);
  return true;
}

async function handleFormsAdminInteraction(interaction) {
  const customId = String(interaction.customId || '');
  if (!customId.startsWith('admin:forms')) return false;

  const memberDisplayName = getMemberDisplayName(interaction);

  try {
    if (customId === 'admin:forms') {
      return safeUpdate(interaction, buildFormsAdminPanel(interaction.guild, memberDisplayName));
    }

    if (interaction.isChannelSelectMenu?.()) {
      const value = interaction.values?.[0] || null;
      const prop = customId.split(':')[2];
      if (prop === 'submitChannel') save(interaction.guild, (section) => ({ ...section, submitChannelId: value }));
      if (prop === 'logChannel') save(interaction.guild, (section) => ({ ...section, logChannelId: value }));
      return safeUpdate(interaction, buildFormsAdminPanel(interaction.guild, memberDisplayName));
    }

    if (interaction.isRoleSelectMenu?.() && customId === 'admin:forms:managerRoles') {
      save(interaction.guild, (section) => ({ ...section, managerRoleIds: [...new Set(interaction.values || [])] }));
      return safeUpdate(interaction, buildFormsAdminPanel(interaction.guild, memberDisplayName));
    }

    if (customId === 'admin:forms:enable' || customId === 'admin:forms:disable') {
      setModuleEnabled(interaction.guild.id, 'forms', customId.endsWith(':enable'), {
        actorId: interaction.user.id,
        action: 'forms_admin_toggle',
      });
    }
    if (customId === 'admin:forms:toggleReview') save(interaction.guild, (section) => ({ ...section, requireReview: !section.requireReview }));
    if (customId === 'admin:forms:toggleAnonymous') save(interaction.guild, (section) => ({ ...section, anonymousSubmissions: !section.anonymousSubmissions }));
    if (customId === 'admin:forms:toggleStore') save(interaction.guild, (section) => ({ ...section, storeResponses: !section.storeResponses }));

    if (customId === 'admin:forms:deployDefault') {
      await interaction.deferUpdate().catch(() => null);
      await deployDefaultForm(interaction.guild, interaction.user.id);
      return safeUpdate(interaction, buildFormsAdminPanel(interaction.guild, memberDisplayName));
    }

    return safeUpdate(interaction, buildFormsAdminPanel(interaction.guild, memberDisplayName));
  } catch (error) {
    const payload = { content: `❌ Forms setup failed: ${error.message}`, flags: 64 };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => null);
    else await interaction.reply(payload).catch(() => null);
    return true;
  }
}


async function deployDefaultForm(guild, actorId = null) {
  if (!isModuleEnabled(guild.id, 'forms')) throw new Error('Forms are disabled.');
  const section = forms.getFormsSection(guild.id);
  const channelId = section.submitChannelId || section.settings?.submitChannelId || null;
  if (!channelId) throw new Error('Choose a submit channel first.');
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.send) throw new Error('Submit channel is not sendable.');

  const form = forms.saveForm(guild.id, {
    name: 'Server Form',
    description: 'Submit your response using the button below.',
    buttonLabel: 'Submit Form',
    action: forms.FORM_ACTIONS.STORE_ONLY,
    fields: [{ id: 'message', label: 'Tell us what this form is for', type: forms.FIELD_TYPES.PARAGRAPH, required: true, maxLength: 1000 }],
    createdBy: actorId,
  }, guild);

  const panelRecord = forms.savePanel(guild.id, {
    title: form.name,
    description: form.description,
    channelId: channel.id,
    formIds: [form.formId],
    createdBy: actorId,
  }, guild);
  const deployed = await deployFormPanel(channel, panelRecord, guild);
  forms.incrementAnalytics(guild.id, { deployed: 1 }, guild);
  return { form, panel: deployed };
}

module.exports = {
  buildFormsAdminPanel,
  deployDefaultForm,
  CUSTOM_ID_PREFIX,
  buildFormOpenCustomId,
  buildFormSubmitCustomId,
  parseFormCustomId,
  buildFormsOverviewEmbed,
  buildFormPanelEmbed,
  buildFormPanelRows,
  buildFormModal,
  deployFormPanel,
  collectModalAnswers,
  validateAnswer,
  buildValidationErrorReply,
  buildSubmissionReply,
};