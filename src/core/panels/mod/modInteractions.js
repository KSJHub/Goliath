'use strict';

const Discord = require('discord.js');

const { safeReply } = require('../../../core/ui/interactionResponse');
const {
  fetchTarget,
  ensurePanelAccess,
  ensureActionAccess,
  requireModeratableTarget,
} = require('./permissions');
const {
  buildPunishmentModal,
  buildBulkModal,
  submitPunishmentRequest,
  submitBulkModal,
  createConfirmation,
  executePendingAction,
} = require('./punishments');
const {
  syncExpiredWarningsToCases,
  showWarningModal,
  showRemoveWarningModal,
  submitWarningModal,
  submitRemoveWarningRequest,
} = require('./warns');
const {
  openCaseTool,
  handleCaseAction,
  submitCaseModal,
} = require('./cases');
const {
  refreshCasesDashboard,
  handleDashboardNavigation,
  handleUserSelectMenu,
  handleSelectUserButton,
} = require('./modPanel');

const PUNISHMENT_ACTIONS = new Set(['timeout', 'kick', 'ban']);
const BULK_ACTIONS = new Set(['warn', 'timeout', 'kick', 'ban']);
const OPEN_ACTIONS = new Set(['warn', ...PUNISHMENT_ACTIONS]);

function isModCustomId(customId) {
  const id = String(customId || '');
  return id.startsWith('mod_') || id.startsWith('mod:');
}

function getTargetIdFromCustomId(customId) {
  return String(customId || '').split(':')[1] || 'none';
}

function getPrefixedAction(customId, prefix, allowedActions) {
  const id = String(customId || '').split(':')[0];
  if (!id.startsWith(prefix)) return null;
  const action = id.slice(prefix.length);
  return allowedActions.has(action) ? action : null;
}

function getPunishmentSubmitAction(customId) {
  return getPrefixedAction(customId, 'mod_submit_', PUNISHMENT_ACTIONS);
}

function getBulkAction(customId) {
  return (
    getPrefixedAction(customId, 'mod_submit_bulk_', BULK_ACTIONS) ||
    getPrefixedAction(customId, 'mod_bulk_', BULK_ACTIONS)
  );
}

function parseConfirmActionContext(customId) {
  const parts = String(customId || '').split(':');
  const requestedPage = Number(parts[5]);
  return {
    token: parts[1] || null,
    context: {
      view: parts[2] || 'overview',
      actionFilter: parts[3] || 'all',
      statusFilter: parts[4] || 'all',
      page: Number.isFinite(requestedPage) ? Math.max(0, Math.trunc(requestedPage)) : 0,
    },
  };
}

async function showPunishmentModal(interaction, action, targetId) {
  if (!PUNISHMENT_ACTIONS.has(action)) return false;

  const target = await requireModeratableTarget(interaction, targetId, action);
  if (!target) return true;

  await interaction.showModal(buildPunishmentModal(action, target.id));
  return true;
}

async function requestRemoveTimeout(interaction, targetId) {
  const target = await requireModeratableTarget(interaction, targetId, 'remove_timeout');
  if (!target) return true;

  return createConfirmation(
    interaction,
    target.id,
    'remove-timeout',
    {},
    `✅ Remove timeout from **${target.user.tag}**?`
  );
}

async function routeActionRequest(interaction, action, targetId) {
  if (action === 'warn') return showWarningModal(interaction, targetId);
  if (action === 'remove-warning') return showRemoveWarningModal(interaction, targetId);
  if (action === 'remove-timeout') return requestRemoveTimeout(interaction, targetId);
  if (PUNISHMENT_ACTIONS.has(action)) return showPunishmentModal(interaction, action, targetId);
  return false;
}

async function handleActionSelectMenu(interaction) {
  if (!interaction.customId.startsWith('mod_action_select:')) return false;
  return routeActionRequest(
    interaction,
    interaction.values[0],
    getTargetIdFromCustomId(interaction.customId)
  );
}

async function handleOpenActionButton(interaction) {
  const action = getPrefixedAction(interaction.customId, 'mod_open_', OPEN_ACTIONS);
  if (!action) return false;
  return routeActionRequest(interaction, action, getTargetIdFromCustomId(interaction.customId));
}

async function handleCaseToolButton(interaction) {
  const caseResult = await openCaseTool(interaction);
  if (caseResult) return caseResult;

  const id = String(interaction.customId || '');
  const targetId = getTargetIdFromCustomId(id);
  if (id.startsWith('mod_remove_warning:')) {
    return routeActionRequest(interaction, 'remove-warning', targetId);
  }
  if (id.startsWith('mod_remove_timeout:')) {
    return routeActionRequest(interaction, 'remove-timeout', targetId);
  }
  return false;
}

async function handleBulkButton(interaction) {
  if (!String(interaction.customId || '').startsWith('mod_bulk_')) return false;
  const action = getBulkAction(interaction.customId);
  if (!action) return false;

  const allowed = await ensureActionAccess(
    interaction,
    `bulk_${action}`,
    `❌ No permission to use bulk ${action}.`
  );
  if (!allowed) return true;

  await interaction.showModal(buildBulkModal(action));
  return true;
}

async function handleConfirmButton(interaction) {
  if (!interaction.customId.startsWith('mod_confirm_action:')) return false;
  const { token, context } = parseConfirmActionContext(interaction.customId);
  return executePendingAction(Discord, interaction, token, context);
}

async function handleCancelButton(interaction) {
  if (interaction.customId !== 'mod_cancel_action') return false;

  if (interaction.message && typeof interaction.update === 'function') {
    await interaction.update({ content: '❌ Cancelled.', embeds: [], components: [] });
    return true;
  }

  return safeReply(interaction, { content: '❌ Cancelled.', flags: 64 });
}

async function handleBulkModal(interaction) {
  if (!String(interaction.customId || '').startsWith('mod_submit_bulk_')) return false;
  const action = getBulkAction(interaction.customId);
  if (!action) return false;

  const allowed = await ensureActionAccess(
    interaction,
    `bulk_${action}`,
    `❌ No permission to use bulk ${action}.`
  );
  if (!allowed) return true;

  return submitBulkModal(interaction, action);
}

async function handleActionModal(interaction) {
  const id = String(interaction.customId || '');
  const targetId = getTargetIdFromCustomId(id);

  if (id.startsWith('mod_submit_warn:')) {
    return submitWarningModal(interaction, targetId, refreshCasesDashboard);
  }

  if (id.startsWith('mod_submit_remove_warning:')) {
    return submitRemoveWarningRequest(interaction, targetId, createConfirmation);
  }

  const action = getPunishmentSubmitAction(id);
  if (!action) return false;

  const target = await requireModeratableTarget(interaction, targetId, action);
  if (!target) return true;

  const result = await submitPunishmentRequest(interaction, target, action);
  if (action === 'timeout' && result?.ok) {
    await refreshCasesDashboard(interaction, target);
  }
  return true;
}

async function routeHandlers(interaction, handlers) {
  for (const handler of handlers) {
    const result = await handler(interaction);
    if (result) return result;
  }
  return false;
}

async function routeButtonsAndSelects(interaction) {
  const denied = ensurePanelAccess(interaction);
  if (denied) return denied;

  if (interaction.isUserSelectMenu?.()) return handleUserSelectMenu(interaction);
  if (interaction.isStringSelectMenu?.()) return handleActionSelectMenu(interaction);
  if (!interaction.isButton?.()) return false;

  return routeHandlers(interaction, [
    handleConfirmButton,
    (value) => handleCaseAction(value, { fetchTarget, createConfirmation }),
    handleDashboardNavigation,
    handleCancelButton,
    handleSelectUserButton,
    handleBulkButton,
    handleOpenActionButton,
    handleCaseToolButton,
  ]);
}

async function routeModModal(interaction) {
  if (!interaction?.customId?.startsWith('mod_')) return false;

  const denied = ensurePanelAccess(interaction);
  if (denied) return denied;

  await syncExpiredWarningsToCases(interaction.guild.id);

  return routeHandlers(interaction, [
    (value) => submitCaseModal(value, { fetchTarget, refreshCasesDashboard }),
    handleBulkModal,
    handleActionModal,
  ]);
}

async function handleModInteraction(interaction) {
  if (!interaction?.customId || !isModCustomId(interaction.customId)) return false;
  if (interaction.customId.startsWith('nav|')) return false;
  if (interaction.isModalSubmit?.()) return routeModModal(interaction);
  return routeButtonsAndSelects(interaction);
}

module.exports = {
  handleModInteraction,
};
