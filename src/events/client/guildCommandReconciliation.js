'use strict';

const { Events } = require('discord.js');
const terminal = require('../../core/logging/terminalLogger').createLogger('commands');

const RETIRED_GUILD_COMMANDS = new Set(['owner', 'commandcenter', 'Convert Emoji Shortcodes']);
const inFlightGuilds = new Map();

function resolvedBotMode(client) {
  return String(client?.botMode || process.env.BOT_MODE || 'DEV').trim().toUpperCase();
}

function resolvedCommandMode(client) {
  const configured = String(process.env.COMMAND_MODE || '').trim().toLowerCase();
  if (configured === 'guild' || configured === 'global') return configured;
  return resolvedBotMode(client) === 'PRODUCTION' ? 'global' : 'guild';
}

function normalCommandPayloads(client) {
  return [...(client?.commands?.values?.() || [])]
    .filter((command) => command?.data?.name && !RETIRED_GUILD_COMMANDS.has(command.data.name))
    .filter((command) => resolvedCommandMode(client) !== 'global' || command.devOnly !== true)
    .map((command) => command.data.toJSON());
}

async function reconcileGuildCommands(guild, client, reason = 'manual') {
  if (!guild?.id || !guild?.commands?.set) {
    return { guildId: guild?.id || null, skipped: true, reason: 'invalid-guild' };
  }

  if (resolvedCommandMode(client) !== 'guild') {
    return { guildId: guild.id, skipped: true, reason: 'global-command-mode' };
  }

  if (inFlightGuilds.has(guild.id)) return inFlightGuilds.get(guild.id);

  const operation = (async () => {
    const normalCommands = normalCommandPayloads(client);
    if (!normalCommands.length) {
      terminal.warn(`Guild command reconciliation skipped for ${guild.id}: no normal commands loaded.`);
      return { guildId: guild.id, skipped: true, reason: 'no-commands' };
    }

    // SET is authoritative for this guild. Do not preserve any retired/private
    // commands here: /owner is USER_INSTALL only and /commandcenter plus the
    // message context shortcut are intentionally absent from guild integrations.
    await guild.commands.set(normalCommands);

    terminal.success(
      `Guild commands reconciled for ${guild.name || guild.id} (${guild.id}) — `
      + `${normalCommands.length} public command(s), 0 retired/private (${reason}).`
    );

    return {
      guildId: guild.id,
      commands: normalCommands.length,
      protectedCommands: 0,
      skipped: false,
      reason,
    };
  })().catch((error) => {
    terminal.error(`Guild command reconciliation failed for ${guild?.name || guild?.id} (${reason}): ${error?.message || error}`);
    return { guildId: guild?.id || null, skipped: false, failed: true, reason, error };
  }).finally(() => {
    inFlightGuilds.delete(guild.id);
  });

  inFlightGuilds.set(guild.id, operation);
  return operation;
}

async function reconcileAllGuildCommands(client, reason = 'startup') {
  if (resolvedCommandMode(client) !== 'guild') {
    terminal.info(`Guild command reconciliation not required in ${resolvedCommandMode(client).toUpperCase()} command mode.`);
    return [];
  }

  const guilds = [...(client?.guilds?.cache?.values?.() || [])];
  const results = [];

  for (const guild of guilds) {
    results.push(await reconcileGuildCommands(guild, client, reason));
  }

  const failed = results.filter((result) => result?.failed).length;
  terminal.info(`Guild command startup reconciliation complete: ${results.length - failed}/${results.length} guild(s) ready${failed ? `, ${failed} failed` : ''}.`);
  return results;
}

module.exports = [
  {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
      await reconcileAllGuildCommands(client, 'startup');
    },
  },
  {
    name: Events.GuildCreate,
    async execute(guild, client) {
      await reconcileGuildCommands(guild, client, 'guild joined');
    },
  },
];

module.exports.reconcileGuildCommands = reconcileGuildCommands;
module.exports.reconcileAllGuildCommands = reconcileAllGuildCommands;
