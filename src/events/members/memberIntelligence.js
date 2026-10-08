'use strict';

const intelligence = require('../../core/administration/mod/intelligence');
const joinIntelligence = require('../../core/administration/mod/joinIntelligence');
const continuousIntelligence = require('../../core/administration/mod/continuousIntelligence');

module.exports = [
  {
    name: 'guildMemberAdd',
    async execute(member) {
      try { intelligence.observeJoin(member); }
      catch (error) { console.warn('[Member Intelligence] join capture failed:', error?.message || error); }

      try {
        const result = await joinIntelligence.scanMemberOnJoin(member);
        if (result?.success && result?.delivered) {
          console.log(`[Join Intelligence] ${member.guild?.name || member.guild?.id}: scanned ${member.user?.tag || member.id} -> ${result.channelId} (${result.risk?.score || 0}/100, ${result.assessment?.decision || 'clear'}).`);
        }
      } catch (error) {
        console.warn('[Join Intelligence] automatic join scan failed:', error?.message || error);
      }
    },
  },
  {
    name: 'guildMemberUpdate',
    async execute(oldMember, newMember) {
      let changed = false;
      try { changed = Boolean(intelligence.observeUpdate(oldMember, newMember)); }
      catch (error) { console.warn('[Member Intelligence] member update capture failed:', error?.message || error); }
      if (changed) {
        try { await continuousIntelligence.reevaluateMember(newMember, 'member_update'); }
        catch (error) { console.warn('[Continuous Intelligence] member update reassessment failed:', error?.message || error); }
      }
    },
  },
  {
    name: 'guildMemberRemove',
    execute(member) {
      try { intelligence.observeLeave(member, 'leave'); }
      catch (error) { console.warn('[Member Intelligence] leave capture failed:', error?.message || error); }
    },
  },
  {
    name: 'guildBanAdd',
    execute(ban) {
      try {
        const member = ban?.guild?.members?.cache?.get?.(ban.user?.id);
        if (member) intelligence.observeLeave(member, 'ban');
      } catch (error) { console.warn('[Member Intelligence] ban capture failed:', error?.message || error); }
    },
  },
  {
    name: 'userUpdate',
    async execute(oldUser, newUser) {
      try { intelligence.observeUserUpdate(newUser?.client, oldUser, newUser); }
      catch (error) { console.warn('[Member Intelligence] identity update capture failed:', error?.message || error); }
      for (const guild of newUser?.client?.guilds?.cache?.values?.() || []) {
        const member = guild.members.cache.get(newUser.id);
        if (!member) continue;
        try { await continuousIntelligence.reevaluateMember(member, 'identity_update'); }
        catch (error) { console.warn('[Continuous Intelligence] identity reassessment failed:', error?.message || error); }
      }
    },
  },
];
