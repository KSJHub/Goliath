'use strict';

const temporaryRoles = require('../../modules/roleStudio/temporaryRoles/temporaryRolesService');

module.exports = [
  {
    name: 'guildMemberUpdate',
    async execute(oldMember, newMember) {
      try {
        await temporaryRoles.handleMemberUpdate(oldMember, newMember);
      } catch (error) {
        console.warn('[TemporaryRoles] Member update reconciliation failed:', error?.message || error);
      }
    },
  },
  {
    name: 'guildMemberRemove',
    async execute(member) {
      try {
        await temporaryRoles.handleMemberRemove(member);
      } catch (error) {
        console.warn('[TemporaryRoles] Member departure reconciliation failed:', error?.message || error);
      }
    },
  },
];
