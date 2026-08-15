'use strict';

const { Events } = require('discord.js');
const terminal = require('../../core/logging/terminalLogger').createLogger('commands');
const auditStore = require('../../owner/auditIntelligence/auditStore');

const PRIVATE_GUILD_COMMANDS = new Set(['commandcenter']);
const inFlightGuilds = new Map();

function resolvedBotMode(client) {
  return String(client?.botMode || process.env.BOT_MODE || 'DEV').trim().toUpperCase();
}

function resolvedCommandMode(client) {
  const configured = String(process.env.COMMAND_MODE || '').trim().toLowerCase();
  if (configured === 'guild' || configured === 'global') return configured;
  return resolvedBotMode(client) === 'PRODUCTION' ? 'global' : 'guild';
}

function commandCenterGuildId() {
  return String(
    auditStore.getConfig?.()?.commandCenter?.guildId
    || process.env.COMMAND_CENTER_GUILD_ID
    || ''
  ).trim();
}

function normalCommandPayloads(client) {
  return [...(client?.commands?.values?.() || [])]
    .filter((command) => command?.data?.name && !PRIVATE_GUILD_COMMANDS.has(command.data.name))
    .filter((command) => resolvedCommandMode(client) !== 'global' || command.devOnly !== true)
    .map((command) => command.data.toJSON());
}

function privateCommandsToPreserve(existingCommands, guildId) {
  if (String(guildId) !== commandCenterGuildId()) return [];
  return [...existingCommands.values()].filter((command) => PRIVATE_GUILD_COMMANDS.has(command.name));
}

async function reconcileGuildCommands(guild, client, reason = 'manual') {
  if (!guild?.id || !guild?.commands?.fetch || !guild?.commands?.set) {
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

    const existingCommands = await guild.commands.fetch();
    const protectedCommands = privateCommandsToPreserve(existingCommands, guild.id);
    const desired = [...normalCommands, ...protectedCommands];

    await guild.commands.set(desired);

    terminal.success(
      `Guild commands reconciled for ${guild.name || guild.id} (${guild.id}) — `
      + `${normalCommands.length} normal, ${protectedCommands.length} protected (${reason}).`
    );

    return {
      guildId: guild.id,
      commands: normalCommands.length,
      protectedCommands: protectedCommands.length,
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
