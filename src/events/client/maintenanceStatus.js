'use strict';

const { Events } = require('discord.js');
const maintenanceStatus = require('../../owner/dev/maintenanceStatus');

let processHandlersWired = false;

module.exports = {
  name: Events.ClientReady,
  once: true,

  async execute(client) {
    if (!processHandlersWired) {
      maintenanceStatus.wireProcessHandlers(client);
      maintenanceStatus.wireCommandCenterControls?.(client);
      processHandlersWired = true;
    }

    const results = await maintenanceStatus.recoverAll(client).catch((error) => {
      console.warn('[MaintenanceStatus] Startup recovery pass failed:', error?.stack || error?.message || error);
      return [];
    });

    await maintenanceStatus.ensureCommandCenterControls?.(client).catch((error) => {
      console.warn('[MaintenanceStatus] Command Center controls bootstrap failed:', error?.message || error);
    });

    const recovered = results.filter((result) => result?.found).length;
    if (recovered) {
      console.log(`[MaintenanceStatus] Restored ${recovered} maintenance channel(s); cleanup scheduled in 5 minutes.`);
    }
  },
};
