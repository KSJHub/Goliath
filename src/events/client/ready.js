const { Events } = require('discord.js');
const terminal = require('../../core/logging/terminalLogger').createLogger('bot');

const {
  restoreLockdownReminders,
} = require('../../core/security/lockdownSystem');

const {
  startbackupWorker,
} = require('../../core/security/backup/backupWorker');

const {
  startStatusRotation,
} = require('../../features/status/statusRotation');

function getEnvList(name) {
  const value = process.env[name];

  if (!value) return [];

  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    terminal.success(`Logged in as ${client.user?.tag || 'Unknown bot'}`);

    const devGuildIds = getEnvList('DEV_GUILD_IDS');
    const betaGuildIds = getEnvList('BETA_GUILD_IDS');
    const prodGuildIds = getEnvList('PRODUCTION_GUILD_IDS');

    terminal.info(`Guilds cached: ${client.guilds.cache.size}`);

    if (client.botMode === 'DEV' && devGuildIds.length) {
      terminal.info(`DEV guild scope: ${devGuildIds.join(', ')}`);
    }

    if (client.botMode === 'BETA' && betaGuildIds.length) {
      terminal.info(`BETA guild scope: ${betaGuildIds.join(', ')}`);
    }

    if (client.botMode === 'PRODUCTION' && prodGuildIds.length) {
      terminal.info(`PRODUCTION guild scope: ${prodGuildIds.join(', ')}`);
    }

    restoreLockdownReminders(client);
    startbackupWorker(client);
    startStatusRotation(client);
  },
};
