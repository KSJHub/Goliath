'use strict';

const timedRoles = require('../../modules/roleStudio/timedRoles/timedRolesService');

module.exports = {
  name: 'roleDelete',
  async execute(role) {
    if (!role?.guild?.id || !role.id) return;
    await timedRoles.withTimedRolesLock(role.guild.id, async () => {
      const rules = timedRoles.listRules(role.guild.id);
      for (const rule of rules) {
        if (rule.roleId === role.id) {
          timedRoles.removeRule(role.guild.id, rule.ruleId, { action: 'timed_roles_target_role_deleted' });
          continue;
        }
        if ((rule.removeRoleIds || []).includes(role.id)) {
          timedRoles.saveRule(role.guild.id, { ...rule, removeRoleIds: rule.removeRoleIds.filter((id) => id !== role.id) }, { action: 'timed_roles_cleanup_role_deleted' });
        }
      }
    }).catch((error) => {
      console.warn(`[TimedRoles] Role deletion reconciliation failed in ${role.guild.id}: ${error.message}`);
    });
  },
};
