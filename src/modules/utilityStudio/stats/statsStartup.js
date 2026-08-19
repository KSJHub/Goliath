'use strict';

const statsManager = require('./statsManager');

async function startup(client) {
  if (!client?.guilds?.cache) {
    throw new Error('Discord client is unavailable.');
  }

  return statsManager.startCounterRefreshScheduler(client);
}

function shutdown() {
  return statsManager.stopCounterRefreshScheduler();
}

module.exports = {
  startup,
  shutdown,
};
