'use strict';

const temporaryRoles = require('../../modules/roleStudio/temporaryRoles/temporaryRolesService');

module.exports = {
  name: 'roleDelete',
  async execute(role) {
    try {
      await temporaryRoles.handleRoleDelete(role);
    } catch (error) {
      console.warn('[TemporaryRoles] Role deletion reconciliation failed:', error?.message || error);
    }
  },
};
