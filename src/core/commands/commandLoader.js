'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ALLOWED_COMMAND_NAMES = new Set(['admin', 'mod', 'user']);

function getAllJsFiles(dir) {
  if (!fs.existsSync(dir)) return [];

  const files = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...getAllJsFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.endsWith('.test.js') && !entry.name.endsWith('.spec.js')) {
      files.push(fullPath);
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

function loadCommands(client, options = {}) {
  const commandsPath = options.commandsPath || path.join(process.cwd(), 'src', 'commands');
  const ownerCommandModule = path.join(process.cwd(), 'src', 'owner', 'auditIntelligence', 'auditEvents.js');
  const files = [
    ...getAllJsFiles(commandsPath),
    ...(fs.existsSync(ownerCommandModule) ? [ownerCommandModule] : []),
  ];
  const loaded = [];
  const skipped = [];

  if (!client?.commands?.set) {
    throw new Error('Command collection is not available on Discord client.');
  }

  client.commands.clear();

  for (const filePath of files) {
    try {
      delete require.cache[require.resolve(filePath)];
      const command = require(filePath);
      const name = command?.data?.name;

      if (!name || typeof command.execute !== 'function') {
        skipped.push({ filePath, reason: 'Missing command data name or execute function.' });
        continue;
      }

      if (!ALLOWED_COMMAND_NAMES.has(name)) {
        skipped.push({
          filePath,
          reason: `Command is not part of the canonical /admin, /mod, /user surface: ${name}`,
          intentional: true,
        });
        continue;
      }

      if (client.commands.has(name)) {
        skipped.push({ filePath, reason: `Duplicate command name: ${name}` });
        continue;
      }

      client.commands.set(name, command);
      loaded.push(name);
    } catch (error) {
      skipped.push({ filePath, reason: error?.message || String(error) });
    }
  }

  const unexpectedSkips = skipped.filter((item) => item.intentional !== true);
  for (const item of unexpectedSkips) {
    console.warn(`⚠️ Skipped command: ${item.filePath} — ${item.reason}`);
  }

  console.log(`✅ commands loaded (${loaded.length}): ${loaded.join(', ')}`);

  return {
    loaded,
    skipped,
    count: loaded.length,
    commandsPath,
  };
}

module.exports = {
  ALLOWED_COMMAND_NAMES,
  getAllJsFiles,
  loadCommands,
};
