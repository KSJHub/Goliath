'use strict';

function start(client) {
  return {
    ok: Boolean(client),
    guildsChecked: client?.guilds?.cache?.size || 0,
    delegated: true,
  };
}

module.exports = {
  start,
};
