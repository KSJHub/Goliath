'use strict';

const { AttachmentBuilder, MessageFlags } = require('discord.js');
const forms = require('./forms');
const panel = require('./formsPanel');
const tracking = require('./formsTracking');
const { isModuleEnabled, setModuleEnabled } = require('../../../core/guild/guildManager');

async function safeReply(interaction, content) {
  const payload = { content, flags: MessageFlags.Ephemeral };
  if (interaction.deferred || interaction.replied) return interaction.followUp(payload).catch(() => null);
  return interaction.reply(payload).catch(() => null);
}

async function safeUpdate(interaction, payload) {
  if (interaction.deferred || interaction.replied) { await interaction.editReply(payload); return true; }
  await interaction.update(payload); return true;
}

function parseMemberCustomId(customId = '') {
  const parts = String(customId || '').split(':');
  if (parts[0] === 'form' && ['open', 'submit'].includes(parts[1])) return { action: parts[1], id: forms.cleanKey(parts[2]) };
  if (parts[0] === 'forms' && parts[1] === 'open') return { action: 'open', id: forms.cleanKey(parts[2]) };
  if (parts[0] === 'forms' && parts[1] === 'modal') return { action: 'submit', id: forms.cleanKey(parts[2]) };
  return null;
}

async function handleMemberInteraction(interaction) {
  const parsed = parseMemberCustomId(interaction.customId);
  if (!parsed || !interaction.guildId) return false;
  try {
    if (!isModuleEnabled(interaction.guildId, 'forms')) throw new Error('Forms are currently disabled on this server.');
    const form = forms.getForm(interaction.guildId, parsed.id);
    if (!form || form.enabled === false) throw new Error('This form is no longer available.');
    if (parsed.action === 'open') { await interaction.showModal(panel.buildFormModal(form)); return true; }
    const { answers, errors } = panel.collectModalAnswers(interaction, form);
    if (errors.length) return safeReply(interaction, panel.buildValidationErrorReply(errors));
    const submission = forms.saveSubmission(interaction.guildId, {
      formId: form.formId, userId: interaction.user.id, userTag: interaction.user.tag,
      answers, status: 'pending', workflow: { source: 'discord_modal', submittedAt: new Date().toISOString(), modalFieldCount: Object.keys(answers).length },
    }, interaction.guild);
    const result = await tracking.createTicketForSubmission({ interaction, form, submission });
    return safeReply(interaction, panel.buildSubmissionReply(form, submission, result));
  } catch (error) { await safeReply(interaction, `❌ Form action failed: ${error.message}`); return true; }
}

async function handleAdminInteraction(interaction) {
  const customId = String(interaction.customId || '');
  if (!customId.startsWith('admin:forms')) return false;
  const displayName = interaction.member?.displayName || interaction.user?.displayName || interaction.user?.username || 'Unknown User';
  try {
    const save = (updater) => forms.updateFormsSection(interaction.guild.id, updater, interaction.guild);
    if (customId === 'admin:forms') return safeUpdate(interaction, panel.buildFormsAdminPanel(interaction.guild, displayName));
    if (interaction.isChannelSelectMenu?.()) {
      const value = interaction.values?.[0] || null; const prop = customId.split(':')[2];
      if (prop === 'submitChannel') save((s) => ({ ...s, submitChannelId: value }));
      if (prop === 'logChannel') save((s) => ({ ...s, logChannelId: value }));
      return safeUpdate(interaction, panel.buildFormsAdminPanel(interaction.guild, displayName));
    }
    if (interaction.isRoleSelectMenu?.() && customId === 'admin:forms:managerRoles') {
      save((s) => ({ ...s, managerRoleIds: [...new Set(interaction.values || [])] }));
      return safeUpdate(interaction, panel.buildFormsAdminPanel(interaction.guild, displayName));
    }
    if (customId.endsWith(':enable')) setModuleEnabled(interaction.guild.id, 'forms', true, { actorId: interaction.user.id, action: 'forms_admin_enable' });
    if (customId.endsWith(':disable')) setModuleEnabled(interaction.guild.id, 'forms', false, { actorId: interaction.user.id, action: 'forms_admin_disable' });
    if (customId.endsWith(':toggleReview')) save((s) => ({ ...s, requireReview: !s.requireReview }));
    if (customId.endsWith(':toggleAnonymous')) save((s) => ({ ...s, anonymousSubmissions: !s.anonymousSubmissions }));
    if (customId.endsWith(':toggleStore')) save((s) => ({ ...s, storeResponses: !s.storeResponses }));
    if (customId.endsWith(':deployDefault')) { await interaction.deferUpdate().catch(() => null); await panel.deployDefaultForm(interaction.guild, interaction.user.id); }
    return safeUpdate(interaction, panel.buildFormsAdminPanel(interaction.guild, displayName));
  } catch (error) { await safeReply(interaction, `❌ Forms setup failed: ${error.message}`); return true; }
}

async function handleFormsInteraction(interaction) {
  if (await handleAdminInteraction(interaction)) return true;
  return handleMemberInteraction(interaction);
}

module.exports = { handleFormsInteraction, handleFormsAdminInteraction: handleAdminInteraction, handleMemberInteraction, handleAdminInteraction };
