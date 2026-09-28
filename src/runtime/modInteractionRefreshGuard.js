'use strict';

const Module = require('module');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const PATCH_KEY = Symbol.for('goliath.runtime.mod-interaction-refresh-guard-v1');
const ACKNOWLEDGEMENT_RESTORE_DELAY_MS = 3000;

if (!globalThis[PATCH_KEY]) {
  globalThis[PATCH_KEY] = { installed: true };

  const originalLoad = Module._load;

  Module._load = function goliathModRefreshLoad(request, parent, isMain) {
    const exported = originalLoad.apply(this, arguments);

    let resolved = '';
    try { resolved = Module._resolveFilename(request, parent, isMain); }
    catch {}

    if (
      exported
      && typeof exported === 'object'
      && typeof exported.refreshDashboard === 'function'
      && /[\\/]src[\\/]core[\\/]administration[\\/]mod[\\/]panel\.js$/.test(String(resolved))
      && !exported.refreshDashboard.__goliathAcknowledgedRefreshGuard
    ) {
      const originalRefreshDashboard = exported.refreshDashboard;

      const guardedRefreshDashboard = async function guardedRefreshDashboard(discord, interaction, ...args) {
        const acknowledged = Boolean(interaction?.replied || interaction?.deferred);
        const message = interaction?.message;

        if (!acknowledged || !message || typeof interaction?.editReply !== 'function' || typeof message.edit !== 'function') {
          return originalRefreshDashboard.call(this, discord, interaction, ...args);
        }

        const customId = String(interaction?.customId || '');
        const isCancel = customId.startsWith('mod_cancel_action');
        const isConfirm = customId.startsWith('mod_confirm_action');
        if (isCancel || isConfirm) await new Promise((resolve) => setTimeout(resolve, ACKNOWLEDGEMENT_RESTORE_DELAY_MS));

        const target = args[0] || null;
        // Kick/Ban remove the active member from the guild. Re-rendering the
        // previous member workspace with a null target leaves Discord's user
        // selector visually holding the departed member and subsequent clicks
        // produce "Could not find that member". Keep the successful result on
        // screen and offer an explicit clean return to Moderation instead.
        if (isConfirm && !target) {
          const back = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('mod_dashboard:none:actions')
              .setLabel('⬅️ Back to Moderation')
              .setStyle(ButtonStyle.Secondary),
          );
          await interaction.editReply({ components: [back] });
          return true;
        }

        const originalMessageEdit = message.edit;
        message.edit = function acknowledgedInteractionMessageEdit(payload) {
          return interaction.editReply(payload);
        };

        try {
          return await originalRefreshDashboard.call(this, discord, interaction, ...args);
        } finally {
          message.edit = originalMessageEdit;
        }
      };

      Object.defineProperty(guardedRefreshDashboard, '__goliathAcknowledgedRefreshGuard', { value: true, enumerable: false });
      exported.refreshDashboard = guardedRefreshDashboard;
    }

    return exported;
  };
}
