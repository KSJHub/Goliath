'use strict';

const { Events } = require('discord.js');

const DEFAULT_STARTUP_SYNC_DELAY_MS = 15000;

function startupSyncEnabled() {
  // Command registration is deployment maintenance, not a prerequisite for the
  // Discord client becoming usable. Keep an opt-out for environments where a
  // deploy pipeline already performs command synchronization.
  const value = String(process.env.COMMAND_SYNC_ON_STARTUP ?? 'true').trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(value);
}

function startupSyncDelayMs() {
  const configured = Number(process.env.COMMAND_SYNC_STARTUP_DELAY_MS);
  return Number.isFinite(configured) && configured >= 0
    ? Math.floor(configured)
    : DEFAULT_STARTUP_SYNC_DELAY_MS;
}

async function runStartupSync() {
  try {
    const { syncCommands } = require('../../core/commands/syncCommands');
    const result = await syncCommands();
    console.log(
      `[CommandSync] Background startup sync complete (${String(result?.mode || process.env.BOT_MODE || 'unknown').toUpperCase()}): `
      + `${(result?.commands || []).map((name) => `/${name}`).join(', ') || 'no public commands'}`,
    );
  } catch (error) {
    // Command maintenance must never hold the ClientReady event open or take the
    // bot offline when Discord REST is slow/unavailable.
    console.error('[CommandSync] Background startup sync failed:', error?.stack || error?.message || error);
  }
}

module.exports = {
  name: Events.ClientReady,
  once: true,

  execute() {
    if (!startupSyncEnabled()) {
      console.log('[CommandSync] Startup sync disabled by COMMAND_SYNC_ON_STARTUP.');
      return;
    }

    const delayMs = startupSyncDelayMs();
    console.log(`[CommandSync] Startup sync queued in background (${delayMs}ms delay).`);

    const timer = setTimeout(() => {
      void runStartupSync();
    }, delayMs);

    // Do not keep the Node process alive solely for delayed command maintenance.
    timer.unref?.();
  },
};
