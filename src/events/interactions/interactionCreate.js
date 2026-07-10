'use strict';

const { Events, MessageFlags } = require('discord.js');

function optionalRequire(label, modulePath, fallback = {}) {
  try {
    return require(modulePath);
  } catch (error) {
    console.warn(`[InteractionCreate] Optional handler unavailable: ${label}`);
    console.warn(error?.stack || error?.message || error);
    return fallback;
  }
}

const verificationManager = optionalRequire('verification manager', '../../modules/verification/verificationManager');
const ticketInteractionHandler = optionalRequire('tickets', '../../modules/tickets/ticketInteractionHandler');
const roleInteractionHandler = optionalRequire('roles', '../../modules/roles/roleInteractionHandler');
const pollsManager = optionalRequire('polls', '../../modules/polls/pollsManager');
const tempVoiceInteractionHandler = optionalRequire('temp voice', '../../modules/tempvoice/tempVoiceInteractionHandler');
const suggestionsInteractionHandler = optionalRequire('suggestions', '../../modules/suggestions/suggestionsInteractionHandler');
const giveawaysInteractionHandler = optionalRequire('giveaways', '../../modules/giveaways/giveawaysInteractionHandler');
const formsInteractionHandler = optionalRequire('forms', '../../modules/forms/formsInteractionHandler');
const testSecurityCommand = optionalRequire('test security', '../../commands/admin/testsecurity');
const embedPanel = optionalRequire('embed panel', '../../modules/embed/functions/embedPanel');
const duplicator = optionalRequire('duplicator', '../../core/dev/duplicator');
const adminPanel = optionalRequire('admin panel', '../../core/admin/functions/adminPanel');
const statsAdminPanel = optionalRequire('stats admin', '../../core/admin/functions/statsAdminPanel');
const reactionRolesAdminPanel = optionalRequire('reaction roles admin', '../../core/admin/functions/reactionRolesAdminPanel');
const suggestionsAdminPanel = optionalRequire('suggestions admin', '../../core/admin/functions/suggestionsAdminPanel');
const giveawaysAdminPanel = optionalRequire('giveaways admin', '../../core/admin/functions/giveawaysAdminPanel');
const formsAdminPanel = optionalRequire('forms admin', '../../core/admin/functions/formsAdminPanel');
const pollsAdminPanel = optionalRequire('polls admin', '../../core/admin/functions/pollsAdminPanel');
const starboardAdminPanel = optionalRequire('starboard admin', '../../core/admin/functions/starboardAdminPanel');
const stickyAdminPanel = optionalRequire('sticky admin', '../../core/admin/functions/stickyAdminPanel');
const levelingAdminPanel = optionalRequire('leveling admin', '../../core/admin/functions/levelingAdminPanel');
const socialAdminPanel = optionalRequire('social admin', '../../core/admin/functions/socialAdminPanel');
const verificationAdminPanel = optionalRequire('verification admin', '../../core/admin/functions/verificationAdminPanel');
const moduleAdminPanels = optionalRequire('generic module admin', '../../core/admin/functions/moduleAdminPanels');

async function callHandler(target, method, ...args) {
  if (typeof target?.[method] !== 'function') return false;
  return Boolean(await target[method](...args));
}

function sanitizeComponentPayload(payload) {
  if (!payload || !Array.isArray(payload.components)) return payload;

  const seen = new Set();
  const rows = [];

  for (const actionRow of payload.components) {
    const rowData = typeof actionRow?.toJSON === 'function' ? actionRow.toJSON() : actionRow;
    const components = Array.isArray(rowData?.components)
      ? rowData.components.filter((component) => {
        const customId = component?.custom_id || component?.customId || null;
        if (!customId) return true;
        if (seen.has(customId)) {
          console.warn(`[InteractionCreate] Removed duplicate component custom_id: ${customId}`);
          return false;
        }
        seen.add(customId);
        return true;
      })
      : [];

    if (components.length) rows.push({ ...rowData, components });
  }

  return { ...payload, components: rows };
}

function wrapInteractionResponses(interaction) {
  if (!interaction || interaction.__goliathResponsesWrapped) return;
  interaction.__goliathResponsesWrapped = true;

  for (const methodName of ['reply', 'update', 'editReply', 'followUp']) {
    if (typeof interaction[methodName] !== 'function') continue;
    const original = interaction[methodName].bind(interaction);
    interaction[methodName] = (payload, ...args) => original(sanitizeComponentPayload(payload), ...args);
  }
}

function isVerificationAdminInteraction(interaction) {
  return String(interaction?.customId || '').startsWith('admin:verification');
}

function isVerificationMemberInteraction(interaction) {
  if (!interaction?.isButton?.()) return false;
  return typeof verificationManager?.parseVerifyCustomId === 'function'
    && Boolean(verificationManager.parseVerifyCustomId(interaction.customId));
}

async function safeInteractionError(interaction) {
  const payload = {
    content: '❌ Interaction failed. Check bot logs for details.',
    flags: MessageFlags.Ephemeral,
  };

  try {
    if (interaction?.isAutocomplete?.()) {
      await interaction.respond([]).catch(() => null);
      return;
    }

    if (interaction?.deferred || interaction?.replied) {
      await interaction.followUp(payload).catch(() => null);
      return;
    }

    await interaction?.reply?.(payload).catch(() => null);
  } catch {
    // Ignore final safety response errors.
  }
}

module.exports = {
  name: Events.InteractionCreate,

  async execute(interaction, client) {
    try {
      wrapInteractionResponses(interaction);

      if (interaction?.isAutocomplete?.()) {
        const command = client.commands?.get?.(interaction.commandName);
        if (command?.autocomplete) await command.autocomplete(interaction, client);
        else await interaction.respond([]).catch(() => null);
        return;
      }

      if (!interaction?.customId && !interaction?.isChatInputCommand?.()) return;

      if (interaction.isChatInputCommand?.()) {
        const command = client.commands?.get?.(interaction.commandName);
        if (!command) return;
        await command.execute(interaction, client);
        return;
      }

      // Modal responses must be the first acknowledgement and must happen quickly.
      // Route Verification interactions before unrelated handlers so showModal()
      // cannot expire while waiting through the full handler chain.
      if (isVerificationAdminInteraction(interaction)) {
        await callHandler(verificationAdminPanel, 'handleVerificationAdminInteraction', interaction);
        return;
      }

      if (isVerificationMemberInteraction(interaction)) {
        await callHandler(verificationManager, 'handleVerificationInteraction', interaction);
        return;
      }

      if (await callHandler(statsAdminPanel, 'handleStatsAdminInteraction', interaction)) return;
      if (await callHandler(reactionRolesAdminPanel, 'handleReactionRolesAdminInteraction', interaction)) return;
      if (await callHandler(suggestionsAdminPanel, 'handleSuggestionsAdminInteraction', interaction)) return;
      if (await callHandler(giveawaysAdminPanel, 'handleGiveawaysAdminInteraction', interaction)) return;
      if (await callHandler(formsAdminPanel, 'handleFormsAdminInteraction', interaction)) return;
      if (await callHandler(pollsAdminPanel, 'handlePollsAdminInteraction', interaction)) return;
      if (await callHandler(starboardAdminPanel, 'handleStarboardAdminInteraction', interaction)) return;
      if (await callHandler(stickyAdminPanel, 'handleStickyAdminInteraction', interaction)) return;
      if (await callHandler(levelingAdminPanel, 'handleLevelingAdminInteraction', interaction)) return;
      if (await callHandler(socialAdminPanel, 'handleSocialAdminInteraction', interaction)) return;
      if (await callHandler(moduleAdminPanels, 'handleModuleAdminInteraction', interaction)) return;
      if (await callHandler(adminPanel, 'handleAdminNavigation', interaction)) return;
      if (await callHandler(duplicator, 'handleInteraction', interaction)) return;
      if (await callHandler(embedPanel, 'handleInteraction', interaction)) return;

      if (interaction.isButton?.() && await callHandler(testSecurityCommand, 'handleButton', interaction)) return;
      if (interaction.isButton?.() && await callHandler(tempVoiceInteractionHandler, 'handleTempVoiceInteraction', interaction, client)) return;
      if (await callHandler(formsInteractionHandler, 'handleFormsInteraction', interaction)) return;
      if (await callHandler(suggestionsInteractionHandler, 'handleSuggestionsInteraction', interaction)) return;
      if (await callHandler(giveawaysInteractionHandler, 'handleGiveawayInteraction', interaction)) return;

      if (interaction.isButton?.() && await callHandler(pollsManager, 'vote', interaction)) return;
      if (await callHandler(ticketInteractionHandler, 'handleTicketInteraction', interaction, client)) return;
      if (await callHandler(roleInteractionHandler, 'handleRoleInteraction', interaction)) return;
    } catch (error) {
      console.error('[InteractionCreate] Failed to handle interaction:', error);
      await safeInteractionError(interaction);
    }
  },
};
