'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { REST, Routes } = require('discord.js');
const { loadEnvironment } = require('../../config/envLoader');
const { resolveTokenDetails, getRequiredTokenEnvName } = require('../../config/tokenResolver');
const { BETA_GUILD_IDS: CONFIGURED_BETA_GUILD_IDS = [] } = require('../../config/betaGuilds');

const ALLOWED_MODES = ['dev', 'beta', 'production'];
const ALLOWED_COMMAND_MODES = ['guild', 'global'];
const COMMAND_NAME_REGEX = /^[a-z0-9_-]{1,32}$/;
const PRIVATE_GUILD_COMMANDS = new Set(['commandcenter']);

function envFlag(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'y', 'on'].includes(String(value).toLowerCase());
}

function envNumber(name, fallback, minimum = 0) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value) || value < minimum) return fallback;
  return value;
}

function firstEnv(names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return '';
}

function required(label, value, envFile) {
  if (!value || !String(value).trim()) throw new Error(`Missing ${label} in ${envFile}`);
  return String(value).trim();
}

function parseGuildIds(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(values
    .map((id) => String(id || '').trim())
    .filter((id) => /^\d{16,25}$/.test(id)))];
}

function combineGuildIds(...values) {
  return parseGuildIds(values.flatMap((value) => Array.isArray(value) ? value : String(value || '').split(','))).join(',');
}

function getConfiguredGuildIdsForMode(mode) {
  if (mode === 'DEV') return firstEnv(['DEV_GUILD_ID', 'MAIN_GUILD_ID', 'GUILD_ID']);
  if (mode === 'BETA') {
    return combineGuildIds(
      firstEnv(['BETA_GUILD_IDS', 'BETA_GUILD_ID', 'MAIN_GUILD_ID', 'GUILD_ID']),
      CONFIGURED_BETA_GUILD_IDS
    );
  }
  return firstEnv(['PRODUCTION_GUILD_IDS', 'PRODUCTION_GUILD_ID', 'MAIN_GUILD_ID', 'GUILD_ID']);
}

function getAllJsFiles(dir) {
  if (!fs.existsSync(dir)) return [];

  const files = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...getAllJsFiles(fullPath));
      continue;
    }

    if (
      entry.isFile() &&
      entry.name.endsWith('.js') &&
      !entry.name.endsWith('.test.js') &&
      !entry.name.endsWith('.spec.js')
    ) {
      files.push(fullPath);
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

function resolveBotMode() {
  const argMode = process.argv[2]?.toLowerCase();
  const envMode = process.env.BOT_MODE?.toLowerCase();

  if (ALLOWED_MODES.includes(argMode)) return argMode;
  if (ALLOWED_MODES.includes(envMode)) return envMode;
  return 'dev';
}

const selectedMode = resolveBotMode();
process.env.BOT_MODE = selectedMode;

const loadedEnv = loadEnvironment(selectedMode);
const BOT_MODE = selectedMode.toUpperCase();
const envFile = loadedEnv?.envFile || `.env.${selectedMode}`;
const tokenDetails = resolveTokenDetails({ mode: BOT_MODE });

const TOKEN = required(getRequiredTokenEnvName(BOT_MODE), tokenDetails.token, envFile);
const CLIENT_ID = required('DISCORD_CLIENT_ID', firstEnv(['DISCORD_CLIENT_ID', 'CLIENT_ID', 'APPLICATION_ID']), envFile);

const COMMAND_MODE = (() => {
  const value = process.env.COMMAND_MODE?.toLowerCase();
  if (ALLOWED_COMMAND_MODES.includes(value)) return value;
  return BOT_MODE === 'PRODUCTION' ? 'global' : 'guild';
})();

const GUILD_IDS = getConfiguredGuildIdsForMode(BOT_MODE);

if (!ALLOWED_COMMAND_MODES.includes(COMMAND_MODE)) {
  throw new Error(`Invalid COMMAND_MODE ${COMMAND_MODE}`);
}

if (COMMAND_MODE === 'guild') {
  required('guild id', GUILD_IDS, envFile);
}

const DRY_RUN = envFlag('COMMAND_SYNC_DRY_RUN', false);
const CLEAR_BEFORE_SYNC = envFlag('CLEAR_COMMANDS_BEFORE_SYNC', false);
const DELETE_STALE = envFlag('COMMAND_SYNC_DELETE_STALE', false);
const BULK_OVERWRITE = envFlag('COMMAND_SYNC_BULK_OVERWRITE', false);
const STOP_ON_ERROR = envFlag('COMMAND_SYNC_STOP_ON_ERROR', false);
const UPDATE_EXISTING = envFlag('COMMAND_SYNC_UPDATE_EXISTING', false);
const SINGLE_COMMAND = String(process.env.COMMAND_SYNC_SINGLE || '').trim().toLowerCase();
const REST_TIMEOUT_MS = envNumber('DISCORD_REST_TIMEOUT_MS', 30000, 1000);
const REST_RETRIES = envNumber('COMMAND_SYNC_RETRIES', 1, 0);
const REST_RETRY_DELAY_MS = envNumber('COMMAND_SYNC_RETRY_DELAY_MS', 1500, 0);

const rest = new REST({ version: '10', timeout: REST_TIMEOUT_MS }).setToken(TOKEN);

function wait(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

async function withTimeout(label, fn, timeoutMs = REST_TIMEOUT_MS) {
  let timer;
  const startedAt = Date.now();
  const operation = Promise.resolve().then(fn);
  operation.catch(() => null);

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();
  });

  try {
    const result = await Promise.race([operation, timeout]);
    console.log(`Discord REST OK: ${label} (${Date.now() - startedAt}ms)`);
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function discordRequest(label, fn) {
  let lastError;

  for (let attempt = 1; attempt <= REST_RETRIES + 1; attempt += 1) {
    try {
      console.log(`Discord REST start: ${label}${attempt > 1 ? ` (retry ${attempt - 1}/${REST_RETRIES})` : ''}`);
      return await withTimeout(label, fn);
    } catch (error) {
      lastError = error;
      console.error(`Discord REST failed: ${label} — ${error.message}`);

      if (attempt > REST_RETRIES) break;
      if (REST_RETRY_DELAY_MS > 0) await wait(REST_RETRY_DELAY_MS * attempt);
    }
  }

  throw lastError;
}

function validateOption(option, filePath, errors, parent = '') {
  const label = parent ? `${parent}.${option?.name || 'unknown'}` : option?.name || 'unknown';

  if (!option || typeof option !== 'object') {
    errors.push(`${filePath}: option is not an object`);
    return;
  }

  if (!option.name || typeof option.name !== 'string') {
    errors.push(`${filePath}: option ${label} missing name`);
  } else if (!COMMAND_NAME_REGEX.test(option.name)) {
    errors.push(`${filePath}: invalid option name ${label}`);
  }

  if (!option.description || typeof option.description !== 'string') {
    errors.push(`${filePath}: option ${label} missing description`);
  } else if (option.description.length > 100) {
    errors.push(`${filePath}: option ${label} description too long`);
  }

  if (Array.isArray(option.options)) {
    for (const child of option.options) validateOption(child, filePath, errors, label);
  }
}

function validateCommandPayload(command, filePath) {
  const errors = [];

  if (!command || typeof command !== 'object') return [`${filePath}: command payload is not an object`];

  if (!command.name || typeof command.name !== 'string') {
    errors.push(`${filePath}: missing command name`);
  } else if (!COMMAND_NAME_REGEX.test(command.name)) {
    errors.push(`${filePath}: invalid command name ${command.name}`);
  }

  if (!command.description || typeof command.description !== 'string') {
    errors.push(`${filePath}: missing command description`);
  } else if (command.description.length > 100) {
    errors.push(`${filePath}: command description too long`);
  }

  if (Array.isArray(command.options)) {
    for (const option of command.options) validateOption(option, filePath, errors);
  }

  return errors;
}

function loadCommands(commandsPath, mode) {
  const commands = [];
  const seen = new Set();
  const errors = [];
  const commandFiles = getAllJsFiles(commandsPath);

  for (const filePath of commandFiles) {
    try {
      delete require.cache[require.resolve(filePath)];

      const commandModule = require(filePath);
      const commandName = commandModule?.data?.name;

      if (!commandModule?.data || typeof commandModule.execute !== 'function') {
        console.warn(`Skipped invalid command module: ${filePath}`);
        continue;
      }

      if (!commandName || typeof commandName !== 'string') {
        errors.push(`${filePath}: missing command data name`);
        continue;
      }

      if (SINGLE_COMMAND && commandName !== SINGLE_COMMAND) continue;

      if (seen.has(commandName)) {
        errors.push(`${filePath}: duplicate command name /${commandName}`);
        continue;
      }

      if (mode === 'global' && commandModule.devOnly === true) {
        console.log(`Skipped dev-only command: /${commandName}`);
        continue;
      }

      const payload = commandModule.data.toJSON();
      errors.push(...validateCommandPayload(payload, filePath));

      seen.add(commandName);
      commands.push(payload);

      console.log(`Loaded command: /${commandName}`);
    } catch (error) {
      errors.push(`${filePath}: failed to load - ${error.message}`);
    }
  }

  if (errors.length) {
    throw new Error(`Command validation failed:\n${errors.map((error) => ` - ${error}`).join('\n')}`);
  }

  return commands;
}

function commandChanged(existing, next) {
  const existingComparable = {
    name: existing.name,
    description: existing.description,
    options: existing.options || [],
    default_member_permissions: existing.default_member_permissions ?? null,
    dm_permission: existing.dm_permission ?? undefined,
    nsfw: existing.nsfw || false,
  };

  const nextComparable = {
    name: next.name,
    description: next.description,
    options: next.options || [],
    default_member_permissions: next.default_member_permissions ?? null,
    dm_permission: next.dm_permission ?? undefined,
    nsfw: next.nsfw || false,
  };

  return JSON.stringify(existingComparable) !== JSON.stringify(nextComparable);
}

async function readGuildPrivateCommands(guildId) {
  const existing = await discordRequest(`read protected guild commands ${guildId}`, () => rest.get(Routes.applicationGuildCommands(CLIENT_ID, guildId)));
  return existing.filter((command) => PRIVATE_GUILD_COMMANDS.has(command.name));
}

async function clearGuildCommands(guildId) {
  console.log(`Clearing normal guild commands while preserving private commands: ${guildId}`);
  const protectedCommands = await readGuildPrivateCommands(guildId);
  await discordRequest(`clear guild commands ${guildId}`, () => rest.put(Routes.applicationGuildCommands(CLIENT_ID, guildId), { body: protectedCommands }));
  console.log(`Cleared normal guild commands: ${guildId}; protected ${protectedCommands.length}.`);
}

async function safeCommandAction(label, fn, failures) {
  try {
    await fn();
    return true;
  } catch (error) {
    failures.push(`${label}: ${error.message}`);
    console.error(`Failed: ${label}`);
    console.error(error);

    if (STOP_ON_ERROR) throw error;
    return false;
  }
}

async function bulkGuildOverwrite(guildId, commands) {
  const protectedCommands = await readGuildPrivateCommands(guildId);
  const body = [...commands, ...protectedCommands.filter((item) => !commands.some((command) => command.name === item.name))];
  console.log(`Bulk overwriting ${commands.length} normal guild command(s), preserving ${protectedCommands.length} private command(s): ${guildId}`);
  await discordRequest(`bulk overwrite guild commands ${guildId}`, () => rest.put(Routes.applicationGuildCommands(CLIENT_ID, guildId), { body }));
  console.log(`Bulk overwrite complete: ${guildId}`);
}

async function upsertGuildCommands(guildId, commands, failures) {
  if (BULK_OVERWRITE) return bulkGuildOverwrite(guildId, commands);

  let existingCommands = [];

  if (CLEAR_BEFORE_SYNC) {
    await clearGuildCommands(guildId);
    console.log(`Skipping existing command read after clear: ${guildId}`);
  } else {
    console.log(`Reading existing guild commands: ${guildId}`);
    existingCommands = await discordRequest(`read guild commands ${guildId}`, () => rest.get(Routes.applicationGuildCommands(CLIENT_ID, guildId)));
  }

  const existingByName = new Map(existingCommands.map((command) => [command.name, command]));
  const wantedNames = new Set(commands.map((command) => command.name));

  for (const command of commands) {
    const existing = existingByName.get(command.name);

    if (!existing) {
      console.log(`Creating guild command: /${command.name}`);
      await safeCommandAction(`/${command.name} create`, async () => {
        await discordRequest(`create guild command /${command.name} in ${guildId}`, () => rest.post(Routes.applicationGuildCommands(CLIENT_ID, guildId), { body: command }));
        console.log(`Created guild command: /${command.name}`);
      }, failures);
      continue;
    }

    if (!UPDATE_EXISTING) {
      console.log(`Existing guild command skipped: /${command.name}`);
      continue;
    }

    if (!commandChanged(existing, command)) {
      console.log(`Unchanged guild command: /${command.name}`);
      continue;
    }

    console.log(`Updating guild command: /${command.name}`);
    await safeCommandAction(`/${command.name} update`, async () => {
      await discordRequest(`update guild command /${command.name} in ${guildId}`, () => rest.patch(Routes.applicationGuildCommand(CLIENT_ID, guildId, existing.id), { body: command }));
      console.log(`Updated guild command: /${command.name}`);
    }, failures);
  }

  if (DELETE_STALE && !SINGLE_COMMAND && !CLEAR_BEFORE_SYNC) {
    for (const existing of existingCommands) {
      if (wantedNames.has(existing.name) || PRIVATE_GUILD_COMMANDS.has(existing.name)) continue;

      await safeCommandAction(`/${existing.name} delete stale`, async () => {
        console.log(`Deleting stale guild command: /${existing.name}`);
        await discordRequest(`delete stale guild command /${existing.name} in ${guildId}`, () => rest.delete(Routes.applicationGuildCommand(CLIENT_ID, guildId, existing.id)));
        console.log(`Deleted stale guild command: /${existing.name}`);
      }, failures);
    }
  }
}

async function bulkGlobalOverwrite(commands) {
  const safeCommands = commands.filter((command) => !PRIVATE_GUILD_COMMANDS.has(command.name));
  console.log(`Bulk overwriting ${safeCommands.length} global command(s)`);
  await discordRequest('bulk overwrite global commands', () => rest.put(Routes.applicationCommands(CLIENT_ID), { body: safeCommands }));
  console.log('Global bulk overwrite complete');
}

async function upsertGlobalCommands(commands, failures) {
  const safeCommands = commands.filter((command) => !PRIVATE_GUILD_COMMANDS.has(command.name));
  if (CLEAR_BEFORE_SYNC || BULK_OVERWRITE) return bulkGlobalOverwrite(safeCommands);

  console.log('Reading existing global commands');

  const existingCommands = await discordRequest('read global commands', () => rest.get(Routes.applicationCommands(CLIENT_ID)));
  const existingByName = new Map(existingCommands.map((command) => [command.name, command]));
  const wantedNames = new Set(safeCommands.map((command) => command.name));

  for (const command of safeCommands) {
    const existing = existingByName.get(command.name);

    if (!existing) {
      await safeCommandAction(`/${command.name} create`, async () => {
        console.log(`Creating global command: /${command.name}`);
        await discordRequest(`create global command /${command.name}`, () => rest.post(Routes.applicationCommands(CLIENT_ID), { body: command }));
        console.log(`Created global command: /${command.name}`);
      }, failures);
      continue;
    }

    if (!UPDATE_EXISTING) {
      console.log(`Existing global command skipped: /${command.name}`);
      continue;
    }

    if (!commandChanged(existing, command)) {
      console.log(`Unchanged global command: /${command.name}`);
      continue;
    }

    await safeCommandAction(`/${command.name} update`, async () => {
      console.log(`Updating global command: /${command.name}`);
      await discordRequest(`update global command /${command.name}`, () => rest.patch(Routes.applicationCommand(CLIENT_ID, existing.id), { body: command }));
      console.log(`Updated global command: /${command.name}`);
    }, failures);
  }

  if (DELETE_STALE && !SINGLE_COMMAND) {
    for (const existing of existingCommands) {
      if (wantedNames.has(existing.name)) continue;

      await safeCommandAction(`/${existing.name} delete stale`, async () => {
        await discordRequest(`delete stale global command /${existing.name}`, () => rest.delete(Routes.applicationCommand(CLIENT_ID, existing.id)));
      }, failures);
    }
  }
}

function printBanner(mode, commandsPath) {
  console.log('============================================================');
  console.log('Syncing Goliath Commands');
  console.log(`Bot Mode: ${BOT_MODE}`);
  console.log(`Env: ${envFile}`);
  console.log(`Command Mode: ${mode.toUpperCase()}`);
  console.log(`Client ID: ${CLIENT_ID}`);
  console.log(`Commands Path: ${commandsPath}`);
  console.log(`REST Timeout: ${REST_TIMEOUT_MS}ms`);
  console.log(`REST Retries: ${REST_RETRIES}`);
  console.log(`Retry Delay: ${REST_RETRY_DELAY_MS}ms`);
  console.log(`Dry Run: ${DRY_RUN ? 'YES' : 'NO'}`);
  console.log(`Clear Before Sync: ${CLEAR_BEFORE_SYNC ? 'YES' : 'NO'}`);
  console.log(`Bulk Overwrite: ${BULK_OVERWRITE ? 'YES' : 'NO'}`);
  console.log(`Delete Stale: ${DELETE_STALE ? 'YES' : 'NO'}`);
  console.log(`Update Existing: ${UPDATE_EXISTING ? 'YES' : 'NO'}`);
  console.log(`Stop On Error: ${STOP_ON_ERROR ? 'YES' : 'NO'}`);
  console.log(`Single Command: ${SINGLE_COMMAND || 'NO'}`);
  console.log('============================================================');
}

async function syncCommands(options = {}) {
  const startedAt = Date.now();
  const mode = String(options.mode || COMMAND_MODE).toLowerCase();
  const commandsPath = options.commandsPath || path.join(process.cwd(), 'src', 'commands');
  const guildIds = parseGuildIds(options.guildIds ?? GUILD_IDS);
  const failures = [];

  if (!ALLOWED_COMMAND_MODES.includes(mode)) {
    throw new Error(`Invalid command mode ${mode}`);
  }

  if (mode === 'guild' && guildIds.length === 0) {
    throw new Error(`No valid guild IDs found for ${BOT_MODE} mode.`);
  }

  printBanner(mode, commandsPath);

  const commands = loadCommands(commandsPath, mode).filter((command) => !PRIVATE_GUILD_COMMANDS.has(command.name));

  console.log(`Commands loaded and validated: ${commands.length}`);

  if (commands.length === 0) {
    throw new Error('No commands loaded. Sync aborted to protect existing Discord commands.');
  }

  if (DRY_RUN) {
    console.log('Dry run complete. No Discord API calls were made.');
    return {
      botMode: BOT_MODE,
      commandMode: mode,
      commands: commands.length,
      guilds: mode === 'guild' ? guildIds.length : 0,
      dryRun: true,
      failures,
      durationMs: Date.now() - startedAt,
    };
  }

  if (mode === 'guild') {
    for (const guildId of guildIds) {
      await upsertGuildCommands(guildId, commands, failures);
    }
  } else {
    await upsertGlobalCommands(commands, failures);
  }

  const durationMs = Date.now() - startedAt;

  console.log('============================================================');
  console.log(`Command sync complete in ${durationMs}ms`);

  if (failures.length) {
    console.log(`Completed with ${failures.length} failed command action(s):`);
    for (const failure of failures) console.log(` - ${failure}`);
  }

  console.log('============================================================');

  return {
    botMode: BOT_MODE,
    commandMode: mode,
    commands: commands.length,
    guilds: mode === 'guild' ? guildIds.length : 0,
    dryRun: false,
    failures,
    durationMs,
  };
}

if (require.main === module) {
  syncCommands().catch((error) => {
    console.error('Command sync failed:');
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  syncCommands,
  loadCommands,
  validateCommandPayload,
};