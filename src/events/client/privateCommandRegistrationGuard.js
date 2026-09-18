'use strict';

const { Events, REST, Routes } = require('discord.js');
const { resolveTokenDetails } = require('../../config/tokenResolver');

const RETIRED_GUILD_COMMANDS = new Set([
  'owner',
  'commandcenter',
  'Convert Emoji Shortcodes',
]);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function removeRetiredGuildCommands(client, rest, applicationId) {
  let removed = 0;

  for (const guild of client.guilds.cache.values()) {
    try {
      const commands = await rest.get(Routes.applicationGuildCommands(applicationId, guild.id));
      for (const command of commands || []) {
        if (!RETIRED_GUILD_COMMANDS.has(String(command?.name || ''))) continue;
        await rest.delete(Routes.applicationGuildCommand(applicationId, guild.id, command.id));
        removed += 1;
        console.warn(`[CommandGuard] Removed forbidden guild /${command.name} from ${guild.name} (${guild.id}).`);
      }
    } catch (error) {
      console.error(`[CommandGuard] Guild command cleanup failed for ${guild.id}:`, error?.message || error);
    }
  }

  return removed;
}

async function runGuard(client) {
  const mode = String(process.env.BOT_MODE || 'DEV').trim().toUpperCase();
  const token = String(resolveTokenDetails({ mode })?.token || '').trim();
  const applicationId = String(client.application?.id || client.user?.id || '').trim();
  if (!token || !applicationId) {
    console.warn('[CommandGuard] Missing token/application ID; retired command cleanup skipped.');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(token);
  const removed = await removeRetiredGuildCommands(client, rest, applicationId);
  console.log(`[CommandGuard] Retired guild-command guard complete; removed ${removed}.`);
}

module.exports = {
  name: Events.ClientReady,
  once: true,

  async execute(client) {
    // Audit Intelligence historically self-registered /commandcenter after the
    // central command sync. Run after ready listeners settle, then once more to
    // catch any delayed startup self-registration. This guard is authoritative:
    // private owner tooling belongs behind /owner buttons, never guild slash commands.
    await wait(8000);
    await runGuard(client);
    await wait(22000);
    await runGuard(client);
  },
};
