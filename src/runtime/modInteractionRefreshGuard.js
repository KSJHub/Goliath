'use strict';

const Module = require('module');

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

        // Confirmation and cancellation both replace the workspace with a short
        // result acknowledgement before refreshDashboard restores the member
        // workspace. Keep that acknowledgement readable for the same 3 seconds
        // in either direction. This is intentionally limited to the shared
        // pending-action buttons; ordinary navigation/refresh remains immediate.
        const customId = String(interaction?.customId || '');
        if (customId.startsWith('mod_cancel_action') || customId.startsWith('mod_confirm_action')) {
          await new Promise((resolve) => setTimeout(resolve, ACKNOWLEDGEMENT_RESTORE_DELAY_MS));
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

      Object.defineProperty(guardedRefreshDashboard, '__goliathAcknowledgedRefreshGuard', {
        value: true,
        enumerable: false,
      });

      exported.refreshDashboard = guardedRefreshDashboard;
    }

    return exported;
  };
}
