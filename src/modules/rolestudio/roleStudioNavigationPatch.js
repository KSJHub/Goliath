'use strict';

const modulePanels = require('../../core/admin/functions/moduleAdminPanels');

for (let index = modulePanels.SERVER_MODULES.length - 1; index >= 0; index -= 1) {
  const route = modulePanels.SERVER_MODULES[index][0];
  if (route === 'admin:autoRoles' || route === 'admin:timedRoles') modulePanels.SERVER_MODULES.splice(index, 1);
}

const moduleEntry = modulePanels.SERVER_MODULES.find((entry) => entry[0] === 'admin:reactionRoles');
if (moduleEntry) {
  moduleEntry[1] = '🛡️ Role Studio';
  moduleEntry[2] = 'Role Studio';
  moduleEntry[3] = 'Auto roles, reaction roles, tenure milestones and temporary role assignments.';
}

modulePanels.SERVER_MODULES.sort((a, b) => a[2].localeCompare(b[2]));

if (modulePanels.MODULE_PANEL_REGISTRY?.reactionRoles) {
  modulePanels.MODULE_PANEL_REGISTRY.reactionRoles.title = '🛡️ Role Studio';
  modulePanels.MODULE_PANEL_REGISTRY.reactionRoles.summary = 'Manage auto roles, reaction roles, tenure milestones and temporary roles.';
}

module.exports = modulePanels;