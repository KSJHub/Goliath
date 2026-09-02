'use strict';

// Role lifecycle events must use the hardened service directly so reconciliation
// never depends on the compatibility module being patched first during startup.
const roleSelector = require('../../modules/roleStudio/roleSelector/roleSelectorService');

function isRelevantRole(role) {
  if (!role?.guild?.id) return false;
  const section = roleSelector.getSection(role.guild.id);
  if (section.style?.anchorRoleId === role.id) return true;
  for (const group of Object.values(section.groups || {})) {
    if (roleSelector.roleIdsForGroup(group).includes(role.id)) return true;
  }
  return false;
}

module.exports = [
  {
    name: 'roleUpdate',
    async execute(_oldRole, newRole) {
      if (!isRelevantRole(newRole)) return;
      try {
        await roleSelector.handleRoleUpdate(newRole);
      } catch (error) {
        console.warn('[RoleSelector] Role update reconciliation failed:', error.message || error);
      }
    },
  },
  {
    name: 'roleDelete',
    async execute(role) {
      if (!isRelevantRole(role)) return;
      try {
        await roleSelector.handleRoleDelete(role);
      } catch (error) {
        console.warn('[RoleSelector] Role deletion reconciliation failed:', error.message || error);
      }
    },
  },
];
