'use strict';

const fs = require('node:fs');
const {
  CANONICAL_COMMAND_NAMES,
  getCanonicalCommandFiles,
} = require('./commandLoader');
const { REST, Routes } = require('discord.js');
const { loadEnvironment } = require('../../config/envLoader');
const { resolveTokenDetails, getRequiredTokenEnvName } = require('../../config/tokenResolver');
const { BETA_GUILD_IDS: CONFIGURED_BETA_GUILD_IDS = [] } = require('../../config/betaGuilds');
const auditStore = require('../../owner/auditIntelligence/auditStore');

const ALLOWED_MODES = new Set(['dev', 'beta', 'production']);
const OWNER_COMMAND_NAME = 'owner';
const RETIRED_GUILD_COMMAND_NAMES = new Set(['owner', 'commandcenter']);
const PUBLIC_COMMAND_NAMES = new Set(
  [...CANONICAL_COMMAND_NAMES].filter((name) => !RETIRED_GUILD_COMMAND_NAMES.has(name)),
);
const ALLOWED_GLOBAL_COMMAND_NAMES = new Set([...PUBLIC_COMMAND_NAMES, OWNER_COMMAND_NAME]);
const OWNER_USER_CONTEXTS = [0, 1, 2];
const INACCESSIBLE_GUILD_ERROR_CODES = new Set([50001, 50013, 10004]);

function resolveMode() {
  const fromArg = String(process.argv[2] || '').trim().toLowerCase();
  const fromEnv = String(process.env.BOT_MODE || '').trim().toLowerCase();
  if (ALLOWED_MODES.has(fromArg)) return fromArg;
  if (ALLOWED_MODES.has(fromEnv)) return fromEnv;
  return 'dev';
}

function firstEnv(names) {
  for (const name of names) {
    const value = String(process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

function uniqueGuildIds(values) {
  return [...new Set(values
    .flatMap((value) => Array.isArray(value) ? value : String(value || '').split(','))
    .map((value) => String(value || '').trim())
    .filter((value) => /^\d{16,25}$/.test(value)))];
}

function configuredGuildIds(mode) {
  if (mode === 'beta') {
    return uniqueGuildIds([
      process.env.BETA_GUILD_IDS,
      process.env.BETA_GUILD_ID,
      process.env.MAIN_GUILD_ID,
      process.env.GUILD_ID,
      CONFIGURED_BETA_GUILD_IDS,
    ]);
  }
  if (mode === 'production') {
    return uniqueGuildIds([
      process.env.PRODUCTION_GUILD_IDS,
      process.env.PRODUCTION_GUILD_ID,
      process.env.MAIN_GUILD_ID,
      process.env.GUILD_ID,
    ]);
  }
  return uniqueGuildIds([
    process.env.DEV_GUILD_IDS,
    process.env.DEV_GUILD_ID,
    process.env.MAIN_GUILD_ID,
    process.env.GUILD_ID,
  ]);
}

function loadCanonicalCommands() {
  const files = getCanonicalCommandFiles();
  const commands = [];
  const seen = new Set();

  for (const filePath of files) {
    if (!fs.existsSync(filePath)) throw new Error(`Missing canonical command: ${filePath}`);
    delete require.cache[require.resolve(filePath)];
    const command = require(filePath);
    const name = String(command?.data?.name || '').trim();
    if (!CANONICAL_COMMAND_NAMES.has(name)) {
      throw new Error(`Unexpected canonical command name in ${filePath}: ${name || 'missing'}`);
    }
    if (seen.has(name)) throw new Error(`Duplicate canonical command: /${name}`);
    if (typeof command.execute !== 'function' || typeof command.data?.toJSON !== 'function') {
      throw new Error(`Invalid canonical command module: ${filePath}`);
    }
    seen.add(name);
    commands.push(command.data.toJSON());
  }

  if (seen.size !== CANONICAL_COMMAND_NAMES.size) {
    throw new Error(`Expected /admin, /mod, /user, /owner, /e and Convert Emoji Shortcodes; loaded ${[...seen].join(', ')}`);
  }

  return commands;
}

function commandCenterGuildId() {
  return String(
    auditStore.getConfig()?.commandCenter?.guildId
      || process.env.COMMAND_CENTER_GUILD_ID
      || ''
  ).trim();
}

function timeoutMs() {
  const value = Number(process.env.DISCORD_REST_TIMEOUT_MS);
  return Number.isFinite(value) && value >= 1000 ? value : 30000;
}

function discordErrorCode(error) {
  const numeric = Number(error?.code ?? error?.rawError?.code);
  return Number.isFinite(numeric) ? numeric : null;
}

function isInaccessibleGuildError(error) {
  return INACCESSIBLE_GUILD_ERROR_CODES.has(discordErrorCode(error));
}

function buildUserInstalledOwnerCommand(ownerCommand) {
  if (!ownerCommand || ownerCommand.name !== OWNER_COMMAND_NAME) {
    throw new Error('Missing canonical /owner command.');
  }

  const command = { ...ownerCommand };
  command.integration_types = [1];
  command.contexts = [...OWNER_USER_CONTEXTS];
  delete command.default_member_permissions;
  delete command.default_permission;
  delete command.dm_permission;
  return command;
}

function assertOwnerCommandUserInstall(ownerCommand) {
  if (!ownerCommand) throw new Error('Missing /owner command payload.');
  const integrationTypes = Array.isArray(ownerCommand.integration_types) ? ownerCommand.integration_types : [];
  const contexts = Array.isArray(ownerCommand.contexts) ? [...ownerCommand.contexts].sort() : [];
  if (integrationTypes.length !== 1 || integrationTypes[0] !== 1) {
    throw new Error('Refusing to sync /owner unless it is USER_INSTALL only.');
  }
  if (contexts.length !== OWNER_USER_CONTEXTS.length || !OWNER_USER_CONTEXTS.every((value) => contexts.includes(value))) {
    throw new Error('Refusing to sync /owner without the complete USER_INSTALL interaction-context set.');
  }
}

async function putGuildCommands(rest, clientId, guildId, publicCommands, dryRun) {
  if (dryRun) {
    console.log(`[CommandSync] DRY RUN guild ${guildId}: ${publicCommands.map((command) => `/${command.name}`).join(', ')}`);
    return;
  }
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: publicCommands });
  console.log(`[CommandSync] Guild ${guildId}: ${publicCommands.map((command) => `/${command.name}`).join(', ')}`);
}

async function putGlobalCommands(rest, clientId, commands, dryRun) {
  if (dryRun) {
    console.log(`[CommandSync] DRY RUN global: ${commands.map((command) => `/${command.name}`).join(', ')}`);
    return;
  }
  await rest.put(Routes.applicationCommands(clientId), { body: commands });
  console.log(`[CommandSync] Global: ${commands.map((command) => `/${command.name}`).join(', ')}`);
}

async function upsertGlobalOwnerCommand(rest, clientId, ownerCommand, dryRun = false) {
  assertOwnerCommandUserInstall(ownerCommand);
  const existing = await rest.get(Routes.applicationCommands(clientId));
  const current = (existing || []).find((command) => command?.name === OWNER_COMMAND_NAME);
  if (dryRun) {
    console.log(`[CommandSync] DRY RUN ${current ? 'update' : 'create'} USER_INSTALL /owner globally`);
    return true;
  }
  if (current) await rest.patch(Routes.applicationCommand(clientId, current.id), { body: ownerCommand });
  else await rest.post(Routes.applicationCommands(clientId), { body: ownerCommand });
  console.log(`[CommandSync] USER_INSTALL /owner ${current ? 'updated' : 'created'} globally.`);
  return true;
}

async function cleanupStaleGlobalCommands(rest, clientId, dryRun = false) {
  const commands = await rest.get(Routes.applicationCommands(clientId));
  const stale = (commands || []).filter(
    (command) => !ALLOWED_GLOBAL_COMMAND_NAMES.has(String(command?.name || '')),
  );
  for (const command of stale) {
    if (dryRun) {
      console.log(`[CommandSync] DRY RUN remove stale global /${command.name}`);
      continue;
    }
    await rest.delete(Routes.applicationCommand(clientId, command.id));
    console.log(`[CommandSync] Removed stale global /${command.name}`);
  }
  return stale.map((command) => command.name);
}

async function cleanupRetiredGuildCommands(rest, clientId, guildIds, dryRun = false) {
  const scopes = uniqueGuildIds([guildIds]);
  const removed = [];

  for (const guildId of scopes) {
    let commands;
    try {
      commands = await rest.get(Routes.applicationGuildCommands(clientId, guildId));
    } catch (error) {
      if (isInaccessibleGuildError(error)) {
        console.warn(`[CommandSync] Skipped retired-command cleanup for inaccessible guild ${guildId} (Discord ${discordErrorCode(error)}).`);
        continue;
      }
      throw error;
    }

    const stale = (commands || []).filter((command) =>
      RETIRED_GUILD_COMMAND_NAMES.has(String(command?.name || '')),
    );

    for (const command of stale) {
      removed.push({ guildId, name: command.name });
      if (dryRun) {
        console.log(`[CommandSync] DRY RUN remove guild /${command.name} from ${guildId}`);
        continue;
      }
      try {
        await rest.delete(Routes.applicationGuildCommand(clientId, guildId, command.id));
        console.log(`[CommandSync] Removed guild /${command.name} from ${guildId}`);
      } catch (error) {
        if (isInaccessibleGuildError(error)) {
          console.warn(`[CommandSync] Could not remove guild /${command.name} from inaccessible guild ${guildId} (Discord ${discordErrorCode(error)}).`);
          continue;
        }
        throw error;
      }
    }
  }

  return removed;
}

async function syncCommands() {
  const mode = resolveMode();
  process.env.BOT_MODE = mode;
  const loadedEnv = loadEnvironment(mode);
  const modeUpper = mode.toUpperCase();
  const tokenDetails = resolveTokenDetails({ mode: modeUpper });
  const token = String(tokenDetails.token || '').trim();
  const clientId = firstEnv(['DISCORD_CLIENT_ID', 'CLIENT_ID', 'APPLICATION_ID']);
  const requiredTokenName = getRequiredTokenEnvName(modeUpper);

  if (!token) throw new Error(`Missing ${requiredTokenName} in ${loadedEnv?.envFile || `.env.${mode}`}`);
  if (!clientId) throw new Error(`Missing DISCORD_CLIENT_ID in ${loadedEnv?.envFile || `.env.${mode}`}`);

  const commandMode = String(process.env.COMMAND_MODE || (mode === 'production' ? 'global' : 'guild')).trim().toLowerCase();
  if (!['guild', 'global'].includes(commandMode)) throw new Error(`Invalid COMMAND_MODE: ${commandMode}`);

  const dryRun = ['1', 'true', 'yes', 'on'].includes(String(process.env.COMMAND_SYNC_DRY_RUN || '').toLowerCase());
  const commands = loadCanonicalCommands();
  const publicCommands = commands.filter((command) => PUBLIC_COMMAND_NAMES.has(command.name));
  const canonicalOwner = commands.find((command) => command.name === OWNER_COMMAND_NAME) || null;
  const ownerCommand = buildUserInstalledOwnerCommand(canonicalOwner);
  assertOwnerCommandUserInstall(ownerCommand);

  const guildIds = configuredGuildIds(mode);
  const privateGuildId = commandCenterGuildId();
  const cleanupGuildIds = uniqueGuildIds([guildIds, privateGuildId]);
  const rest = new REST({ version: '10', timeout: timeoutMs() }).setToken(token);
  let removedGlobalCommands = [];
  let removedGuildCommands = [];

  if (commandMode === 'global') {
    await putGlobalCommands(rest, clientId, publicCommands, dryRun);
    await upsertGlobalOwnerCommand(rest, clientId, ownerCommand, dryRun);
  } else {
    if (!guildIds.length) throw new Error(`No guild IDs configured for ${mode}`);
    for (const guildId of guildIds) await putGuildCommands(rest, clientId, guildId, publicCommands, dryRun);
    await upsertGlobalOwnerCommand(rest, clientId, ownerCommand, dryRun);
  }

  removedGuildCommands = await cleanupRetiredGuildCommands(rest, clientId, cleanupGuildIds, dryRun);
  removedGlobalCommands = await cleanupStaleGlobalCommands(rest, clientId, dryRun);

  return {
    mode,
    commandMode,
    dryRun,
    guildIds,
    commands: publicCommands.map((command) => command.name),
    userInstalledCommands: [OWNER_COMMAND_NAME],
    removedGuildCommands,
    removedGlobalCommands,
  };
}

if (require.main === module) {
  syncCommands()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = {
  CANONICAL_COMMAND_NAMES,
  PUBLIC_COMMAND_NAMES,
  RETIRED_GUILD_COMMAND_NAMES,
  getCanonicalCommandFiles,
  loadCanonicalCommands,
  configuredGuildIds,
  buildUserInstalledOwnerCommand,
  assertOwnerCommandUserInstall,
  cleanupStaleGlobalCommands,
  cleanupRetiredGuildCommands,
  upsertGlobalOwnerCommand,
  syncCommands,
};