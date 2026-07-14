'use strict';

const giveawayManager = require('./giveawayManager');

function start(client) {
  const timer = giveawayManager.startGiveawayScheduler(client);
  return {
    ok: Boolean(client),
    guildsChecked: client?.guilds?.cache?.size || 0,
    started: Boolean(timer),
    delegated: true,
  };
}

module.exports = {
  start,
};
