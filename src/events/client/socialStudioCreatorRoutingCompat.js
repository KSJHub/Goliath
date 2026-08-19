'use strict';

// Canonical Social Studio compatibility entry point.
// Legacy UI adapters are retained for interaction compatibility, while routing
// precedence is resolved dynamically by socialStudioRoutingResolver.

const roleHierarchyCompat = require('../../modules/socialStudio/socialAlerts/socialStudioRoleHierarchyCompat');
const core = require('./socialStudioCreatorRoutingCompatCore');

// Explicit Social Studio compatibility chain. The stable creator-actions
// handler calls this directly; no module-load handler rewrites are required.
async function handle(interaction) {
  if (!interaction) return false;
  if (await roleHierarchyCompat.handle(interaction)) return true;
  if (await core.handle(interaction)) return true;
  return false;
}

module.exports = { handle };
