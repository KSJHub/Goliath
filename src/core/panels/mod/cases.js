'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const {
  getAllCases,
  getCaseById,
  updateCaseReason,
  updateCaseNote,
  clearCaseNote,
} = require('../../../core/logging/cases/caseStore');
const { COLORS, EMOJIS } = require('../../ui/uiConfig');
const { createEmbed } = require('../../ui/embeds');
const { safeReply, ephemeralError } = require('../../../core/ui/interactionResponse');
const { canUseModAction } = require('./permissions');

const STATUS_LABELS = Object.freeze({
  active: '🟢 Active',
  reversed: '🔁 Reversed',
  expired: '⌛ Expired',
});

const TRACKED_ACTIONS = Object.freeze([
  'warn',
  'timeout',
  'kick',
  'ban',
  'unwarn',
  'remove-timeout',
]);

function getStatus(modCase = {}) {
  return modCase.status || 'active';
}

function getStatusLabel(modCase = {}) {
  return STATUS_LABELS[getStatus(modCase)] || STATUS_LABELS.active;
}

function getCaseTimestamp(dateValue) {
  const timestamp = new Date(dateValue).getTime();
  return Number.isFinite(timestamp)
    ? Math.floor(timestamp / 1000)
    : Math.floor(Date.now() / 1000);
}

function formatCaseSummary(modCase = {}) {
  return [
    `#${modCase.caseId || '?'}`,
    modCase.action || 'unknown',
    getStatusLabel(modCase),
    `<t:${getCaseTimestamp(modCase.createdAt)}:R>`,
  ].join(' • ');
}

function countCasesByAction(cases = [], action) {
  return cases.filter((modCase) => modCase.action === action).length;
}

function countCasesByStatus(cases = [], status) {
  return cases.filter((modCase) => getStatus(modCase) === status).length;
}

function buildTopList(itemsMap = {}, limit = 5, formatter = (id, count) => `${id} — ${count}`) {
  return Object.entries(itemsMap)
    .filter(([id]) => Boolean(id))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, count]) => formatter(id, count));
}

function incrementCount(map, key) {
  if (!key) return;
  map[key] = (map[key] || 0) + 1;
}

function getRecentCases(cases = [], limit = 5) {
  return cases
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}

function getActionCounts(cases = []) {
  return TRACKED_ACTIONS.reduce((counts, action) => {
    counts[`${action.replace(/-/g, '')}Count`] = countCasesByAction(cases, action);
    return counts;
  }, {});
}

function getModerationAnalytics(guildId) {
  const allCases = getAllCases(guildId) || [];
  const moderatorCounts = {};
  const userCounts = {};

  for (const modCase of allCases) {
    incrementCount(moderatorCounts, modCase.moderatorId);
    incrementCount(userCounts, modCase.userId);
  }

  return {
    totalCases: allCases.length,
    activeCases: countCasesByStatus(allCases, 'active'),
    reversedCases: countCasesByStatus(allCases, 'reversed'),
    expiredCases: countCasesByStatus(allCases, 'expired'),
    ...getActionCounts(allCases),
    topModerators: buildTopList(
      moderatorCounts,
      5,
      (id, count) => `<@${id}> • ${count} case${count === 1 ? '' : 's'}`
    ),
    topUsers: buildTopList(
      userCounts,
      5,
      (id, count) => `<@${id}> • ${count} case${count === 1 ? '' : 's'}`
    ),
    recentCases: getRecentCases(allCases, 5),
  };
}

function buildCaseFilterButtons(targetId, actionFilter = 'all', statusFilter = 'all', page = 0) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`mod_filter_cases:${targetId}:all:${statusFilter}:${page}`)
      .setLabel('📂 All')
      .setStyle(actionFilter === 'all' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`mod_filter_cases:${targetId}:warn:${statusFilter}:${page}`)
      .setLabel(`${EMOJIS.WARNING} Warns`)
      .setStyle(actionFilter === 'warn' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`mod_filter_cases:${targetId}:timeout:${statusFilter}:${page}`)
      .setLabel(`${EMOJIS.TIMEOUT} Timeouts`)
      .setStyle(actionFilter === 'timeout' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`mod_filter_cases:${targetId}:note:${statusFilter}:${page}`)
      .setLabel(`${EMOJIS.NOTE} Notes`)
      .setStyle(actionFilter === 'note' ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`mod_filter_cases:${targetId}:${actionFilter}:active:${page}`)
      .setLabel(`${EMOJIS.ACTIVE} Active`)
      .setStyle(statusFilter === 'active' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`mod_filter_cases:${targetId}:${actionFilter}:reversed:${page}`)
      .setLabel(`${EMOJIS.REVERSED} Reversed`)
      .setStyle(statusFilter === 'reversed' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`mod_filter_cases:${targetId}:${actionFilter}:expired:${page}`)
      .setLabel(`${EMOJIS.EXPIRED} Expired`)
      .setStyle(statusFilter === 'expired' ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );

  return [row1, row2];
}

function buildCasesPageButtons(targetId, page, totalPages, actionFilter = 'all', statusFilter = 'all') {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`mod_case_page:${targetId}:${actionFilter}:${statusFilter}:${page - 1}`)
        .setLabel(`${EMOJIS.BACK} Prev`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 0),
      new ButtonBuilder()
        .setCustomId(`mod_case_page:${targetId}:${actionFilter}:${statusFilter}:${page + 1}`)
        .setLabel(`Next ${EMOJIS.NEXT}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1)
    ),
  ];
}

function buildCaseDetailButtons(modCase) {
  const isWarning = modCase.action === 'warn';
  const isTimeout = modCase.action === 'timeout';
  const reversedOrExpired = modCase.status === 'reversed' || modCase.status === 'expired';
  const hasNote = Boolean(modCase.note && String(modCase.note).trim());

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`mod_case_reverse_warning:${modCase.caseId}`)
        .setLabel(`${EMOJIS.REVERSED} Reverse Warning`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!isWarning || reversedOrExpired),
      new ButtonBuilder()
        .setCustomId(`mod_case_reverse_timeout:${modCase.caseId}`)
        .setLabel('⏪ Reverse Timeout')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!isTimeout || reversedOrExpired),
      new ButtonBuilder()
        .setCustomId(`mod_case_note:${modCase.caseId}`)
        .setLabel(hasNote ? `${EMOJIS.EDIT} Edit Note` : `${EMOJIS.NOTE} Add Note`)
        .setStyle(ButtonStyle.Primary)
    ),
  ];
}

function buildCaseIdModal(customId, title, label = 'Case ID') {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('case_id')
          .setLabel(label)
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('1')
          .setRequired(true)
          .setMaxLength(10)
      )
    );
}

function buildEditCaseModal(customId) {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle('Edit Case')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('case_id')
          .setLabel('Case ID')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('1')
          .setRequired(true)
          .setMaxLength(10)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('New Reason')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Enter the updated moderation reason')
          .setRequired(true)
          .setMaxLength(500)
      )
    );
}

function buildCaseNoteModal(customId, existingNote = '') {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(existingNote ? 'Edit Case Note' : 'Add Case Note')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('note')
          .setLabel('Staff Note')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Add internal staff-only context for this case')
          .setRequired(false)
          .setMaxLength(1000)
          .setValue(String(existingNote || '').slice(0, 1000))
      )
    );
}

function buildCaseDetailEmbed(modCase) {
  const embed = new EmbedBuilder()
    .setColor('#5865F2')
    .setTitle(`🧾 Case #${modCase.caseId}`)
    .addFields(
      { name: 'Action', value: modCase.action, inline: true },
      { name: 'Status', value: getStatusLabel(modCase), inline: true },
      { name: 'User ID', value: modCase.userId, inline: true },
      { name: 'Moderator ID', value: modCase.moderatorId, inline: true },
      { name: 'Reason', value: modCase.reason || 'No reason provided', inline: false },
      { name: 'Created', value: `<t:${getCaseTimestamp(modCase.createdAt)}:F>`, inline: true },
      {
        name: 'Updated',
        value: modCase.updatedAt ? `<t:${getCaseTimestamp(modCase.updatedAt)}:F>` : 'Never',
        inline: true,
      }
    )
    .setTimestamp();

  if (modCase.relatedCaseId) {
    embed.addFields({ name: 'Related Case', value: `#${modCase.relatedCaseId}`, inline: true });
  }
  if (modCase.note && String(modCase.note).trim()) {
    embed.addFields({ name: 'Staff Note', value: String(modCase.note).slice(0, 1024), inline: false });
  }
  if (modCase.metadata && Object.keys(modCase.metadata).length) {
    embed.addFields({
      name: 'Metadata',
      value: `\`\`\`json\n${JSON.stringify(modCase.metadata, null, 2).slice(0, 900)}\n\`\`\``,
      inline: false,
    });
  }

  return embed;
}

function getCaseIdFromModal(interaction, field = 'case_id') {
  const raw = interaction.fields.getTextInputValue(field).trim();
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

function editCaseReason(guildId, caseId, reason) {
  return updateCaseReason(guildId, caseId, String(reason || '').trim());
}

function setCaseNote(guildId, caseId, note) {
  const value = String(note || '').trim();
  return value
    ? updateCaseNote(guildId, caseId, value)
    : clearCaseNote(guildId, caseId);
}

function getTargetIdFromCustomId(customId) {
  const [, targetId] = String(customId || '').split(':');
  return targetId || 'none';
}

async function openCaseTool(interaction) {
  const id = String(interaction.customId || '');
  const targetId = getTargetIdFromCustomId(id);

  if (id.startsWith('mod_case_detail:')) {
    if (!canUseModAction(interaction.member, interaction.guild, 'view_case_detail')) {
      return safeReply(interaction, ephemeralError('No permission to view case details.'));
    }
    if (targetId === 'none') return safeReply(interaction, ephemeralError('No user selected.'));
    await interaction.showModal(buildCaseIdModal(`mod_submit_case_detail:${targetId}`, 'View Case Detail'));
    return true;
  }

  if (id.startsWith('mod_edit_case:')) {
    if (!canUseModAction(interaction.member, interaction.guild, 'edit_case')) {
      return safeReply(interaction, ephemeralError('No permission to edit cases.'));
    }
    if (targetId === 'none') return safeReply(interaction, ephemeralError('No user selected.'));
    await interaction.showModal(buildEditCaseModal(`mod_submit_edit_case:${targetId}`));
    return true;
  }

  return false;
}

async function handleCaseAction(interaction, { fetchTarget, createConfirmation } = {}) {
  const id = String(interaction.customId || '');

  if (id.startsWith('mod_case_note:')) {
    if (!canUseModAction(interaction.member, interaction.guild, 'add_case_note')) {
      return safeReply(interaction, ephemeralError('No permission to add case notes.'));
    }
    const [, caseIdRaw] = id.split(':');
    if (!/^\d+$/.test(caseIdRaw)) return safeReply(interaction, ephemeralError('Case ID must be a number.'));
    const modCase = getCaseById(interaction.guild.id, Number(caseIdRaw));
    if (!modCase) return safeReply(interaction, ephemeralError('Case not found.'));
    await interaction.showModal(buildCaseNoteModal(`mod_submit_case_note:${modCase.caseId}`, modCase.note || ''));
    return true;
  }

  if (id.startsWith('mod_case_reverse_warning:') || id.startsWith('mod_case_reverse_timeout:')) {
    const isWarning = id.startsWith('mod_case_reverse_warning:');
    const permission = isWarning ? 'remove_warning' : 'remove_timeout';
    if (!canUseModAction(interaction.member, interaction.guild, permission)) {
      return safeReply(interaction, ephemeralError(isWarning ? 'No permission to reverse warnings.' : 'No permission to reverse timeouts.'));
    }
    const [, caseIdRaw] = id.split(':');
    const modCase = getCaseById(interaction.guild.id, Number(caseIdRaw));
    const expectedAction = isWarning ? 'warn' : 'timeout';
    if (!modCase || modCase.action !== expectedAction) {
      return safeReply(interaction, ephemeralError(isWarning ? 'Warning case could not be found.' : 'That timeout case could not be found.'));
    }
    if (typeof fetchTarget !== 'function' || typeof createConfirmation !== 'function') return false;
    const target = await fetchTarget(interaction.guild, modCase.userId);
    if (!target) return safeReply(interaction, ephemeralError('User not found for that case.'));
    return createConfirmation(
      interaction,
      target.id,
      isWarning ? 'remove-warning' : 'remove-timeout',
      isWarning ? { caseId: modCase.caseId } : { sourceCaseId: modCase.caseId },
      isWarning
        ? `⚠️ Reverse warning from **Case #${modCase.caseId}**?`
        : `⏳ Reverse timeout from **Case #${modCase.caseId}**?`
    );
  }

  return false;
}

async function submitCaseModal(interaction, { fetchTarget, refreshCasesDashboard } = {}) {
  const id = String(interaction.customId || '');

  if (id.startsWith('mod_submit_case_detail:')) {
    const targetId = getTargetIdFromCustomId(id);
    const caseId = getCaseIdFromModal(interaction);
    if (!caseId) return safeReply(interaction, ephemeralError('Case ID must be a number.'));
    if (!canUseModAction(interaction.member, interaction.guild, 'view_case_detail')) {
      return safeReply(interaction, ephemeralError('No permission to view case details.'));
    }
    const modCase = getCaseById(interaction.guild.id, caseId);
    if (!modCase) return safeReply(interaction, ephemeralError('Case not found.'));
    if (targetId !== 'none' && modCase.userId !== targetId) {
      return safeReply(interaction, ephemeralError('That case does not belong to the currently selected user.'));
    }
    return safeReply(interaction, {
      embeds: [buildCaseDetailEmbed(modCase)],
      components: buildCaseDetailButtons(modCase),
      flags: 64,
    });
  }

  if (id.startsWith('mod_submit_edit_case:')) {
    const targetId = getTargetIdFromCustomId(id);
    const caseId = getCaseIdFromModal(interaction);
    const reason = interaction.fields.getTextInputValue('reason').trim();
    if (!caseId) return safeReply(interaction, ephemeralError('Case ID must be a number.'));
    if (!canUseModAction(interaction.member, interaction.guild, 'edit_case')) {
      return safeReply(interaction, ephemeralError('No permission to edit cases.'));
    }
    const existing = getCaseById(interaction.guild.id, caseId);
    if (!existing) return safeReply(interaction, ephemeralError('Case not found.'));
    if (targetId !== 'none' && existing.userId !== targetId) {
      return safeReply(interaction, ephemeralError('That case does not belong to the currently selected user.'));
    }
    const updated = editCaseReason(interaction.guild.id, caseId, reason);
    if (!updated) return safeReply(interaction, ephemeralError('Failed to update case.'));
    const target = typeof fetchTarget === 'function' ? await fetchTarget(interaction.guild, updated.userId) : null;
    await safeReply(interaction, { content: `✏️ Updated reason for **Case #${updated.caseId}**.`, flags: 64 });
    if (target && typeof refreshCasesDashboard === 'function') await refreshCasesDashboard(interaction, target);
    return true;
  }

  if (id.startsWith('mod_submit_case_note:')) {
    const [, caseIdRaw] = id.split(':');
    if (!/^\d+$/.test(caseIdRaw)) return safeReply(interaction, ephemeralError('Case ID must be a number.'));
    if (!canUseModAction(interaction.member, interaction.guild, 'add_case_note')) {
      return safeReply(interaction, ephemeralError('No permission to add case notes.'));
    }
    const caseId = Number(caseIdRaw);
    const existing = getCaseById(interaction.guild.id, caseId);
    if (!existing) return safeReply(interaction, ephemeralError('Case not found.'));
    const note = interaction.fields.getTextInputValue('note').trim();
    const updated = setCaseNote(interaction.guild.id, caseId, note);
    if (!updated) return safeReply(interaction, ephemeralError('Failed to update case note.'));
    const target = typeof fetchTarget === 'function' ? await fetchTarget(interaction.guild, updated.userId) : null;
    await safeReply(interaction, {
      content: note ? `📝 Updated note for **Case #${updated.caseId}**.` : `🗑️ Cleared note for **Case #${updated.caseId}**.`,
      flags: 64,
    });
    if (target && typeof refreshCasesDashboard === 'function') await refreshCasesDashboard(interaction, target);
    return true;
  }

  return false;
}

function getBulkActionProgressEmbed({ actionLabel, total, processed, successCount, failCount }) {
  return createEmbed({
    title: `${EMOJIS.SETTINGS} ${EMOJIS.BULK} ${actionLabel} Progress`,
    description: `${EMOJIS.FIRE} Bulk moderation is currently running...`,
    color: COLORS.PRIMARY,
    fields: [
      { name: '📦 Processed', value: `${processed}/${total}`, inline: true },
      { name: `${EMOJIS.SUCCESS} Success`, value: String(successCount), inline: true },
      { name: `${EMOJIS.ERROR} Failed`, value: String(failCount), inline: true },
    ],
  });
}

function getBulkActionSummaryEmbed({ actionLabel, total, success, failed }) {
  return createEmbed({
    title: failed.length
      ? `${EMOJIS.WARNING} ${EMOJIS.BULK} ${actionLabel} Complete`
      : `${EMOJIS.SUCCESS} ${EMOJIS.BULK} ${actionLabel} Complete`,
    color: failed.length ? COLORS.ERROR : COLORS.SUCCESS,
    fields: [
      { name: '🎯 Total Targets', value: String(total), inline: true },
      { name: `${EMOJIS.SUCCESS} Successful`, value: String(success.length), inline: true },
      { name: `${EMOJIS.ERROR} Failed`, value: String(failed.length), inline: true },
      { name: `${EMOJIS.SUCCESS} Successes`, value: success.length ? success.join('\n').slice(0, 1024) : 'None' },
      { name: `${EMOJIS.ERROR} Failures`, value: failed.length ? failed.join('\n').slice(0, 1024) : 'None' },
    ],
  });
}

module.exports = {
  getStatusLabel,
  formatCaseSummary,
  getModerationAnalytics,
  buildCaseFilterButtons,
  buildCasesPageButtons,
  openCaseTool,
  handleCaseAction,
  submitCaseModal,
  getBulkActionProgressEmbed,
  getBulkActionSummaryEmbed,
};