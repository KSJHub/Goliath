'use strict';

const { REST, Routes } = require('discord.js');
const core = require('./commandRegistry');
const auditStore = require('../../owner/auditIntelligence/auditStore');
const { resolveTokenDetails } = require('../../config/tokenResolver');
const { BETA_GUILD_IDS: CONFIGURED_BETA_GUILD_IDS = [] } = require('../../config/betaGuilds');

function ids(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(values.map((id) => String(id || '').trim()).filter((id) => /^\d{16,25}$/.test(id)))];
}

function configuredGuildIds() {
  const mode = String(process.env.BOT_MODE || 'dev').trim().toUpperCase();
  if (mode === 'BETA') {
    return ids([
      process.env.BETA_GUILD_IDS,
      process.env.BETA_GUILD_ID,
      process.env.MAIN_GUILD_ID,
      process.env.GUILD_ID,
      ...CONFIGURED_BETA_GUILD_IDS,
    ].flatMap((value) => Array.isArray(value) ? value : String(value || '').split(',')));
  }
  if (mode === 'PRODUCTION' || mode === 'PROD') {
    return ids([process.env.PRODUCTION_GUILD_IDS, process.env.PRODUCTION_GUILD_ID, process.env.MAIN_GUILD_ID, process.env.GUILD_ID]
      .flatMap((value) => String(value || '').split(',')));
  }
  return ids([process.env.DEV_GUILD_IDS, process.env.DEV_GUILD_ID, process.env.MAIN_GUILD_ID, process.env.GUILD_ID]
    .flatMap((value) => String(value || '').split(',')));
}

function restTimeoutMs() {
  const value = Number(process.env.DISCORD_REST_TIMEOUT_MS);
  return Number.isFinite(value) && value >= 1000 ? value : 30000;
}

async function cleanupCommandCenterScope() {
  const commandCenterGuildId = String(auditStore.getConfig()?.commandCenter?.guildId || process.env.COMMAND_CENTER_GUILD_ID || '').trim();
  const mode = String(process.env.BOT_MODE || 'dev').trim().toUpperCase();
  const token = resolveTokenDetails({ mode }).token;
  const clientId = String(process.env.DISCORD_CLIENT_ID || process.env.CLIENT_ID || process.env.APPLICATION_ID || '').trim();
  if (!token || !clientId) return;

  const rest = new REST({ version: '10', timeout: restTimeoutMs() }).setToken(token);
  for (const guildId of configuredGuildIds()) {
    if (!guildId || guildId === commandCenterGuildId) continue;
    const commands = await rest.get(Routes.applicationGuildCommands(clientId, guildId)).catch((error) => {
      console.warn(`[CommandSync] Could not inspect private commands in ${guildId}:`, error.message);
      return [];
    });
    for (const command of commands || []) {
      if (command?.name !== 'commandcenter') continue;
      try {
        await rest.delete(Routes.applicationGuildCommand(clientId, guildId, command.id));
        console.log(`[CommandSync] Removed stale private /commandcenter from non-Command-Center guild ${guildId}.`);
      } catch (error) {
        console.warn(`[CommandSync] Could not remove stale private /commandcenter from ${guildId}:`, error.message);
      }
    }
  }
}

async function syncCommands(...args) {
  const result = await core.syncCommands(...args);
  if (result?.dryRun) return result;
  await cleanupCommandCenterScope();
  return result;
}

if (require.main === module) {
  syncCommands().then(() => process.exit(0)).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  ...core,
  syncCommands,
  cleanupCommandCenterScope,
};
