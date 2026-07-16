'use strict';

const timedRoles = require('../../modules/timedroles/timedRoles');

module.exports = {
  name: 'guildMemberAdd',
  async execute(member) {
    const section = timedRoles.getSection(member.guild.id);
    if (section.enabled === false || (member.user?.bot && section.settings.includeBots !== true)) return;
    for (const rule of timedRoles.listRules(member.guild.id).filter((item) => item.enabled)) {
      await timedRoles.applyRuleToMember(member, rule).catch(() => null);
    }
  },
};
