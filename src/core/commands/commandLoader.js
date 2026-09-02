'use strict';

const path = require('node:path');

const CANONICAL_COMMAND_NAMES = new Set(['admin', 'mod', 'user', 'owner', 'e', 'Convert Emoji Shortcodes']);

function getCanonicalCommandFiles() {
  const root = process.cwd();
  return [
    path.join(root, 'src', 'core', 'administration', 'admin', 'command.js'),
    path.join(root, 'src', 'core', 'administration', 'mod', 'command.js'),
    path.join(root, 'src', 'core', 'administration', 'user', 'command.js'),
    path.join(root, 'src', 'owner', 'userInstallCommand.js'),
    path.join(root, 'src', 'modules', 'utilityStudio', 'emojis', 'emojiAliasCommand.js'),
    path.join(root, 'src', 'modules', 'utilityStudio', 'emojis', 'emojiMessageCommand.js'),
  ];
}

function loadCommands(client) {
  if (!client?.commands?.set) throw new Error('Command collection is not available on Discord client.');

  client.commands.clear();
  const loaded = [];

  for (const filePath of getCanonicalCommandFiles()) {
    delete require.cache[require.resolve(filePath)];
    const command = require(filePath);
    const name = String(command?.data?.name || '').trim();

    if (!CANONICAL_COMMAND_NAMES.has(name)) throw new Error(`Unexpected canonical command name in ${filePath}: ${name || 'missing'}`);
    if (typeof command.execute !== 'function') throw new Error(`Canonical command is missing execute(): ${filePath}`);
    if (client.commands.has(name)) throw new Error(`Duplicate canonical command: ${name}`);

    client.commands.set(name, command);
    command.wireClient?.(client);
    loaded.push(name);
  }

  if (loaded.length !== CANONICAL_COMMAND_NAMES.size) {
    throw new Error(`Expected admin, mod, user, owner, e and Convert Emoji Shortcodes; loaded ${loaded.join(', ')}`);
  }

  console.log(`✅ commands loaded (${loaded.length}): ${loaded.join(', ')}`);
  return { loaded, count: loaded.length };
}

module.exports = {
  CANONICAL_COMMAND_NAMES,
  getCanonicalCommandFiles,
  loadCommands,
};
