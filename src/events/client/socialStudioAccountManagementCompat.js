'use strict';

// Compatibility entry point retained for Social Studio creator routing.
// The account-management implementation was removed from the dev tree, but
// socialStudioCreatorRoutingCompatCore still delegates account interactions
// through this module. Keep the dependency valid and allow unhandled account
// interactions to fall through to the rest of the Social Studio router.
async function handle() {
  return false;
}

module.exports = {
  name: 'clientReady',
  once: true,
  handle,
  async execute() {},
};
