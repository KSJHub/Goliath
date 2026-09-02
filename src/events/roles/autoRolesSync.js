'use strict';

const autoRoles = require('../../modules/roleStudio/autoRoles/autoRolesService');

module.exports = {
  name: 'roleDelete',
  async execute(role) {
    if (!role?.guild?.id || !role.id) return;
    await autoRoles.handleRoleDelete(role).catch((error) => {
      console.warn(`[AutoRoles] Role deletion reconciliation failed in ${role.guild.id}: ${error.message}`);
    });
  },
};
