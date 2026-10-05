'use strict';

const verificationStore = require('../../modules/securityStudio/verificationStore');
const verificationFlow = require('../../modules/securityStudio/verificationFlowContinuation');
const challengeInteractions = require('../../modules/securityStudio/verificationChallengeInteractions');
const verificationQuarantine = require('../../modules/securityStudio/verificationQuarantine');

function settingsFor(guildId) {
  const section = verificationStore.getVerificationSection(guildId);
  return verificationStore.normalizeSettings(section?.settings || {});
}

async function notifyContinuation(member, result) {
  if (!member?.user || !result) return;

  if (result.challenge && typeof challengeInteractions.memberChallengePayload === 'function') {
    const payload = challengeInteractions.memberChallengePayload(member.id, result.challenge);
    await member.user.send({
      content: result.message || 'Continue Verification.',
      ...payload,
    }).catch(() => null);
    return;
  }

  if (result.complete) {
    await member.user.send({ content: result.message || 'Verification complete.' }).catch(() => null);
  }
}

async function resumeAfterScreening(oldMember, newMember) {
  if (!newMember?.guild || newMember.user?.bot) return;
  if (oldMember?.pending !== true || newMember.pending === true) return;

  const guildId = newMember.guild.id;
  const settings = settingsFor(guildId);
  if (settings.security?.discordScreening !== true) return;

  const session = verificationStore.getSession(guildId, newMember.id);
  if (!session || session.state !== 'verifying') return;
  if ((session.completedSecurity || []).includes('discord_screening')) return;

  verificationStore.addSecurityHistory(guildId, newMember.id, {
    type: 'discord_screening_completed',
    automaticResume: true,
  });
  verificationStore.incrementAnalytics(guildId, {
    screeningCompleted: 1,
    lastScreeningCompletedAt: new Date().toISOString(),
  });

  const result = await verificationFlow.resumeVerification({
    guild: newMember.guild,
    member: newMember,
    user: newMember.user,
  });

  await notifyContinuation(newMember, result);
}

async function ensureQuarantineFromRoleChange(oldMember, newMember) {
  if (!newMember?.guild || newMember.user?.bot) return;

  const settings = settingsFor(newMember.guild.id);
  if (settings.quarantine?.enabled === false) return;

  const quarantineRoleIds = Array.isArray(settings.roles?.quarantine) ? settings.roles.quarantine.map(String) : [];
  if (!quarantineRoleIds.length) return;

  const newlyQuarantined = quarantineRoleIds.some(roleId =>
    !oldMember?.roles?.cache?.has?.(roleId) && newMember.roles?.cache?.has?.(roleId));
  if (!newlyQuarantined) return;

  const session = verificationStore.getSession(newMember.guild.id, newMember.id);
  if (!session || session.state !== 'quarantined') return;

  await verificationQuarantine.ensureQuarantineCase(
    newMember.guild,
    newMember,
    'Verification quarantine threshold or staff action',
  );
}

function resetJourneyOnLeave(member) {
  if (!member?.guild || member.user?.bot) return;

  const guildId = member.guild.id;
  const settings = settingsFor(guildId);
  if (settings.flow?.resetActiveSessionOnLeave === false) return;

  const session = verificationStore.getSession(guildId, member.id);
  if (!session) return;

  verificationStore.addSecurityHistory(guildId, member.id, {
    type: 'member_left',
    previousState: session.state,
    completedSecurity: Array.isArray(session.completedSecurity) ? session.completedSecurity : [],
  });

  verificationStore.upsertSession(guildId, member.id, {
    state: 'new',
    requiredSecurity: [],
    completedSecurity: [],
    failedAttempts: 0,
    activeSecurityMethod: null,
    activeChallenge: null,
    startedAt: null,
    verifiedAt: null,
    quarantinedAt: null,
    quarantineChannelId: null,
    leftAt: new Date().toISOString(),
  });

  verificationStore.clearAttempts(guildId, member.id);
}

module.exports = [
  {
    name: 'guildMemberUpdate',
    async execute(oldMember, newMember) {
      try {
        await resumeAfterScreening(oldMember, newMember);
        await ensureQuarantineFromRoleChange(oldMember, newMember);
      } catch (error) {
        console.error('[Verification] Member lifecycle continuation failed:', error?.stack || error?.message || error);
      }
    },
  },
  {
    name: 'guildMemberRemove',
    execute(member) {
      try {
        resetJourneyOnLeave(member);
      } catch (error) {
        console.error('[Verification] Leave reset failed:', error?.stack || error?.message || error);
      }
    },
  },
];

module.exports.resumeAfterScreening = resumeAfterScreening;
module.exports.ensureQuarantineFromRoleChange = ensureQuarantineFromRoleChange;
module.exports.resetJourneyOnLeave = resetJourneyOnLeave;
