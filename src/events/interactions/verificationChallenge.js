'use strict';

const { Events } = require('discord.js');
const challengeInteractions = require('../../modules/securityStudio/verificationChallengeInteractions');
const verificationManager = require('../../modules/securityStudio/verificationManager');
const flowContinuation = require('../../modules/securityStudio/verificationFlowContinuation');

const verificationRuntime = Object.assign(verificationManager, {
  resumeVerification: flowContinuation.resumeVerification,
  recordVerificationFailure: flowContinuation.recordVerificationFailure,
  quarantineVerificationMember: flowContinuation.quarantineVerificationMember,
});

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    const customId = String(interaction?.customId || '');
    if (!customId.startsWith('verify:challenge:') && !customId.startsWith('verify:staff:') && !customId.startsWith('verify:answer:')) return;

    try {
      await challengeInteractions.handleVerificationChallengeInteraction(interaction, verificationRuntime);
    } catch (error) {
      console.error('[Verification] Challenge interaction failed:', error);
      const payload = { content: `❌ Verification security check failed: ${error?.message || 'Unknown error.'}`, flags: 64 };
      if (interaction?.deferred || interaction?.replied) await interaction.followUp(payload).catch(() => null);
      else await interaction.reply(payload).catch(() => null);
    }
  },
};
