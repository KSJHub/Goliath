'use strict';

const Module = require('module');

const PATCH_KEY = Symbol.for('goliath.runtime.mod-interaction-refresh-guard-v1');

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
