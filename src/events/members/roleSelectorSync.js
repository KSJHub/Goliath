'use strict';

const roleSelector = require('../../modules/roleStudio/roleSelector/roleSelector');

function selectorRoleIds(guildId) {
  const section = roleSelector.getSection(guildId);
  const ids = new Set();
  for (const group of Object.values(section.groups || {})) {
    for (const roleId of roleSelector.roleIdsForGroup(group)) if (roleId) ids.add(roleId);
  }
  return ids;
}

function changedRoleIds(oldMember, newMember) {
  const oldIds = new Set(oldMember?.roles?.cache?.keys?.() || []);
  const newIds = new Set(newMember?.roles?.cache?.keys?.() || []);
  return new Set([...oldIds, ...newIds].filter((id) => oldIds.has(id) !== newIds.has(id)));
}

module.exports = [
  {
    name: 'guildMemberUpdate',
    async execute(oldMember, newMember) {
      if (!newMember?.guild || newMember.user?.bot) return;
      try {
        const changed = changedRoleIds(oldMember, newMember);
        if (!changed.size) return;
        const selectorIds = selectorRoleIds(newMember.guild.id);
        if (![...changed].some((roleId) => selectorIds.has(roleId))) return;
        await roleSelector.reconcileMemberFromDiscord(newMember.guild, newMember);
      } catch (error) {
        console.warn('[RoleSelector] Member role reconciliation failed:', error.message || error);
      }
    },
  },
  {
    name: 'guildMemberRemove',
    async execute(member) {
      if (!member?.guild || member.user?.bot) return;
      try {
        const section = roleSelector.getSection(member.guild.id);
        const hadState = Boolean(section.memberSelections?.[member.id]);
        const selectorIds = selectorRoleIds(member.guild.id);
        const hadRole = [...selectorIds].some((roleId) => member.roles?.cache?.has(roleId));
        if (!hadState && !hadRole) return;
        await roleSelector.handleMemberRemove(member);
      } catch (error) {
        console.warn('[RoleSelector] Member departure cleanup failed:', error.message || error);
      }
    },
  },
];