'use strict';

async function initializeRoles(client) {
  return {
    ok: Boolean(client),
    guildsChecked: client?.guilds?.cache?.size || 0,
    delegated: true,
  };
}

module.exports = {
  initializeRoles,
};
