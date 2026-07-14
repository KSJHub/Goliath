'use strict';

const { startupRoles } = require('./roleStartup');

async function initializeRoles(client) {
  return startupRoles(client);
}

module.exports = {
  initializeRoles,
};
