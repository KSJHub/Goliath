'use strict';

const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const guildManager = require('../../core/guild/guildManager');
const runtime = require('./verificationChallengeRuntime');
const verificationStore = require('./verificationStore');

const MODAL_PREFIX = 'verify:answer';
const ANSWER_FIELD_ID = 'answer';
const METHOD_LABELS = Object.freeze({ captcha: 'CAPTCHA', minigame: 'Mini-game', one_time_challenge: 'One-Time Challenge', staff_approval: 'Staff Approval' });
const clean = value => String(value ?? '').trim();

function buildAnswerModal(userId, challenge) {
  if (!challenge?.challengeId) throw new Error('Challenge is unavailable.');
  const modal = new ModalBuilder().setCustomId(`${MODAL_PREFIX}:${clean(userId)}:${challenge.challengeId}`).setTitle((METHOD_LABELS[challenge.method] || 'Verification').slice(0, 45));
  const input = new TextInputBuilder().setCustomId(ANSWER_FIELD_ID).setLabel('Your answer').setStyle(TextInputStyle.Short).setRequired(true).setMinLength(1).setMaxLength(200).setPlaceholder('Enter your answer');
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

function parseAnswerModalId(customId = '') {
  const prefix = `${MODAL_PREFIX}:`; const value = clean(customId);
  if (!value.startsWith(prefix)) return null;
  const remainder = value.slice(prefix.length); const separator = remainder.indexOf(':');
  if (separator <= 0) return null;
  return { userId: remainder.slice(0, separator), challengeId: remainder.slice(separator + 1) };
}

function challengeEmbed(challenge, member = null) {
  const label = METHOD_LABELS[challenge?.method] || 'Verification';
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle(`🛡️ ${label}`).setDescription(clean(challenge?.prompt) || 'Complete this security check to continue.').setFooter({ text: 'Goliath Verification' }).setTimestamp();
  if (member?.user) embed.setAuthor({ name: member.user.tag || member.user.username || member.id });
  if (challenge?.rounds > 1) embed.addFields({ name: 'Progress', value: `Round ${challenge.round || 1}/${challenge.rounds}`, inline: true });
  if (challenge?.maxAttempts > 1) embed.addFields({ name: 'Attempts', value: `${challenge.attempts || 0}/${challenge.maxAttempts}`, inline: true });
  if (challenge?.expiresAt) embed.addFields({ name: 'Expires', value: `<t:${Math.floor(new Date(challenge.expiresAt).getTime() / 1000)}:R>`, inline: true });
  return embed;
}

function memberChallengePayload(userId, challenge) {
  if (!challenge) return { content: '❌ No active Verification challenge exists.', components: [] };
  if (challenge.method === 'staff_approval') return { embeds: [challengeEmbed(challenge)], content: '⏳ Verification is waiting for a member of staff.', components: [] };
  const button = new ButtonBuilder().setCustomId(runtime.buildMemberActionId(userId, challenge.challengeId)).setLabel(challenge.method === 'minigame' ? 'Answer Mini-game' : 'Enter Answer').setStyle(ButtonStyle.Primary);
  return { embeds: [challengeEmbed(challenge)], components: [new ActionRowBuilder().addComponents(button)] };
}

function staffChallengePayload(userId, challenge) {
  if (!challenge || challenge.method !== 'staff_approval') return null;
  const ids = Object.fromEntries((challenge.allowedActions || []).map(action => [action, runtime.buildStaffActionId(userId, challenge.challengeId, action)]));
  const buttons = [];
  if (ids.approve) buttons.push(new ButtonBuilder().setCustomId(ids.approve).setLabel('Approve').setStyle(ButtonStyle.Success));
  if (ids.reject) buttons.push(new ButtonBuilder().setCustomId(ids.reject).setLabel('Reject').setStyle(ButtonStyle.Danger));
  if (ids.quarantine) buttons.push(new ButtonBuilder().setCustomId(ids.quarantine).setLabel('Quarantine').setStyle(ButtonStyle.Secondary));
  return { embeds: [challengeEmbed(challenge)], components: buttons.length ? [new ActionRowBuilder().addComponents(buttons)] : [] };
}

function isStaff(member, settings = {}) {
  if (!member) return false;
  if (member.permissions?.has?.('Administrator') || member.permissions?.has?.('ManageGuild')) return true;
  const configured = Array.isArray(settings.roles?.staff) ? settings.roles.staff : [];
  return configured.some(roleId => member.roles?.cache?.has?.(String(roleId)));
}

async function maybeResumeFlow(interaction, result, manager, targetUserId = null) {
  if (!result?.resumeFlow || typeof manager?.resumeVerification !== 'function') return null;
  const userId = clean(targetUserId || interaction.user?.id);
  const member = await interaction.guild.members.fetch(userId).catch(() => userId === clean(interaction.user?.id) ? interaction.member : null);
  if (!member) return { ok: false, message: 'Verification member is no longer available.' };
  return manager.resumeVerification({ guild: interaction.guild, guildId: interaction.guildId, member, user: member.user, completedSecurity: result.completedSecurity });
}

async function recordTerminalFailure(interaction, parsed, result, manager) {
  if (!result?.recordFailure) return null;
  if (typeof manager?.recordVerificationFailure === 'function') return manager.recordVerificationFailure(interaction.guild, parsed.userId, result.challenge?.method || 'challenge', 'Verification security challenge failed');
  verificationStore.recordAttempt(interaction.guildId, parsed.userId, { failed: true, step: result.challenge?.method || 'challenge', reason: 'Verification security challenge failed' });
  verificationStore.addSecurityHistory(interaction.guildId, parsed.userId, { type: 'security_failed', step: result.challenge?.method || 'challenge', reason: 'Verification security challenge failed' });
  verificationStore.incrementAnalytics(interaction.guildId, { failed: 1, lastFailedAt: new Date().toISOString() });
  return null;
}

function resumedMemberPayload(userId, resumed) {
  if (!resumed?.challenge) return { content: resumed?.ok ? `✅ ${resumed.message}` : resumed?.message || 'Security check passed. Continue Verification.' };
  return { content: resumed.message || 'Continue with the next Verification security check.', ...memberChallengePayload(userId, resumed.challenge) };
}

async function publishResumedChallenge(interaction, userId, resumed) {
  if (!resumed?.challenge) return false;
  if (resumed.challenge.method === 'staff_approval') {
    const payload = staffChallengePayload(userId, resumed.challenge);
    if (!payload || !interaction.channel?.send) return false;
    await interaction.channel.send({ content: `<@${userId}> ${resumed.message || 'Verification requires staff approval.'}`, ...payload, allowedMentions: { users: [userId], roles: [], parse: [] } });
    return true;
  }
  const member = await interaction.guild?.members?.fetch(userId).catch(() => null);
  if (!member?.send) return false;
  const payload = memberChallengePayload(userId, resumed.challenge);
  await member.send({ content: resumed.message || 'Continue with the next Verification security check.', ...payload, allowedMentions: { parse: [] } });
  return true;
}

async function handleMemberAction(interaction, parsed) {
  if (clean(interaction.user?.id) !== clean(parsed.userId)) { await interaction.reply({ content: '❌ This Verification challenge belongs to another member.', flags: MessageFlags.Ephemeral }); return true; }
  const state = runtime.sessionState(interaction.guildId, parsed.userId); const challenge = state.activeChallenge;
  const session = verificationStore.getSession(interaction.guildId, parsed.userId) || {};
  const config = verificationStore.getVerificationSection(interaction.guildId);
  if (Number(session.securityConfigRevision || 0) !== Number(config.configRevision || 1)) { await interaction.reply({ content: '❌ Verification settings changed. Start Verification again for the updated checks.', flags: MessageFlags.Ephemeral }); return true; }
  if (!challenge || challenge.challengeId !== parsed.challengeId || challenge.status !== 'pending' || ['verified','quarantined','rejected','failed','timed_out'].includes(state.state)) { await interaction.reply({ content: '❌ This Verification challenge is no longer active.', flags: MessageFlags.Ephemeral }); return true; }
  const recovery = runtime.recover(interaction.guildId, parsed.userId);
  if (recovery?.changed && runtime.sessionState(interaction.guildId, parsed.userId).activeChallenge?.status !== 'pending') { await interaction.reply({ content: '❌ This Verification challenge has expired. Start Verification again.', flags: MessageFlags.Ephemeral }); return true; }
  await interaction.showModal(buildAnswerModal(parsed.userId, challenge));
  return true;
}

async function handleAnswerModal(interaction, parsed, manager) {
  if (clean(interaction.user?.id) !== clean(parsed.userId)) { await interaction.reply({ content: '❌ This Verification challenge belongs to another member.', flags: MessageFlags.Ephemeral }); return true; }
  const answer = interaction.fields.getTextInputValue(ANSWER_FIELD_ID);
  const current = runtime.sessionState(interaction.guildId, parsed.userId);if (!current.activeChallenge || current.activeChallenge.challengeId !== parsed.challengeId || current.activeChallenge.status !== 'pending' || ['verified','quarantined','rejected','failed','timed_out'].includes(current.state)) { await interaction.reply({ content: '❌ This Verification challenge is no longer active.', flags: MessageFlags.Ephemeral }); return true; }const result = runtime.submitAnswer(interaction.guildId, interaction.user.id, parsed.userId, parsed.challengeId, answer);
  if (!result.ok) {
    const failure = await recordTerminalFailure(interaction, parsed, result, manager);
    const message = failure?.quarantined ? '⛔ Verification failed and your account has been moved to quarantine for staff review.' : result.reason === 'security_configuration_changed' ? '❌ Verification settings changed. Start Verification again.' : result.reason === 'expired' ? '⏱️ This challenge expired. Start Verification again.' : result.complete ? '❌ That answer was incorrect and this challenge has ended.' : '❌ That answer was incorrect. Try again.';
    await interaction.reply({ content: message, flags: MessageFlags.Ephemeral }); return true;
  }
  const resumed = await maybeResumeFlow(interaction, result, manager);
  if (resumed) { await interaction.reply({ ...resumedMemberPayload(parsed.userId, resumed), flags: MessageFlags.Ephemeral }); return true; }
  const next = runtime.sessionState(interaction.guildId, parsed.userId).activeChallenge;
  await interaction.reply({ content: result.complete ? '✅ Security check passed.' : '✅ Round passed. Continue with the next round.', ...(next && !result.complete ? memberChallengePayload(parsed.userId, next) : {}), flags: MessageFlags.Ephemeral });
  return true;
}

async function handleStaffAction(interaction, parsed, manager) {
  const section = verificationStore.getVerificationSection(interaction.guildId);
  if (!isStaff(interaction.member, section.settings || {})) { await interaction.reply({ content: '❌ You are not authorised to resolve Verification staff approvals.', flags: MessageFlags.Ephemeral }); return true; }
  const requiredService = {
    approve: 'resumeVerification',
    reject: 'recordVerificationFailure',
    quarantine: 'quarantineVerificationMember',
  }[parsed.action];
  if (requiredService && typeof manager?.[requiredService] !== 'function') {
    await interaction.reply({ content: 'Verification action service is unavailable. Contact an administrator.', flags: MessageFlags.Ephemeral });
    return true;
  }
  const targetMember = await interaction.guild?.members?.fetch(parsed.userId).catch(() => null);
  if (!targetMember) {
    await interaction.reply({ content: 'Verification member is unavailable. Staff action was not recorded; check whether the member has left the server.', flags: MessageFlags.Ephemeral });
    return true;
  }
  if (parsed.action === 'quarantine') {
    const configured = section.settings?.roles?.quarantine || [];
    const ids = [...new Set((Array.isArray(configured) ? configured : []).map(clean).filter(Boolean))];
    if (!ids.length) {
      await interaction.reply({ content: 'Quarantine roles are not configured. Staff action was not recorded.', flags: MessageFlags.Ephemeral });
      return true;
    }
    for (const roleId of ids) {
      const role = interaction.guild.roles.cache.get(roleId) || await interaction.guild.roles.fetch(roleId).catch(() => null);
      if (!role || !role.editable) {
        await interaction.reply({ content: 'A configured Quarantine role is missing or cannot be managed by Goliath. Staff action was not recorded.', flags: MessageFlags.Ephemeral });
        return true;
      }
    }
    const removalIds = [...new Set(['pending', 'verifying', 'verified', 'auto']
      .flatMap(key => Array.isArray(section.settings?.roles?.[key]) ? section.settings.roles[key] : [])
      .map(clean).filter(Boolean))].filter(id => !ids.includes(id));
    for (const roleId of removalIds) {
      const role = interaction.guild.roles.cache.get(roleId) || await interaction.guild.roles.fetch(roleId).catch(() => null);
      if (!role || (targetMember.roles.cache.has(roleId) && !role.editable)) {
        await interaction.reply({ content: 'A configured Verification role to remove is missing or cannot be managed by Goliath. Staff action was not recorded.', flags: MessageFlags.Ephemeral });
        return true;
      }
    }
  }
  const result = runtime.resolveStaffAction(interaction.guildId, parsed.userId, parsed.challengeId, interaction.user.id, parsed.action);
  if (!result.complete || !result.action) { await interaction.reply({ content: `❌ Staff action failed: ${result.reason || 'challenge unavailable'}.`, flags: MessageFlags.Ephemeral }); return true; }
  let resumed = null;
  if (result.quarantine) {
    if (typeof manager?.quarantineVerificationMember !== 'function') {
      await interaction.reply({ content: 'Quarantine service is unavailable. Contact an administrator.', flags: MessageFlags.Ephemeral });
      return true;
    }
    let outcome;
    try {
      outcome = await manager.quarantineVerificationMember(interaction.guild, parsed.userId, 'Staff-directed verification quarantine');
    } catch (error) {
      verificationStore.addSecurityHistory(interaction.guildId, parsed.userId, { type: 'staff_quarantine_action_failed', staffUserId: clean(interaction.user.id), reason: String(error?.message || error).slice(0, 300) });
      await interaction.reply({ content: '⚠️ Staff quarantine action was recorded, but its role transition failed unexpectedly. Manual staff review is required.', flags: MessageFlags.Ephemeral });
      return true;
    }
    if (!outcome?.quarantined) {
      verificationStore.addSecurityHistory(interaction.guildId, parsed.userId, { type: 'staff_quarantine_action_failed', staffUserId: clean(interaction.user.id), reason: String(outcome?.message || 'Quarantine role transition failed').slice(0, 300) });
      await interaction.reply({ content: `⚠️ Staff quarantine action was recorded, but quarantine could not be applied: ${outcome?.message || 'Check role configuration and permissions.'} Manual staff review is required.`, flags: MessageFlags.Ephemeral });
      return true;
    }
  } else if (result.recordFailure) {
    if (typeof manager?.recordVerificationFailure !== 'function') {
      await interaction.reply({ content: 'Verification failure service is unavailable. Contact an administrator.', flags: MessageFlags.Ephemeral });
      return true;
    }
    const outcome = await manager.recordVerificationFailure(interaction.guild, parsed.userId, 'staff_approval', 'Rejected by Verification staff');
    if (outcome?.quarantined !== true && outcome?.ok === false && !Number.isFinite(outcome?.failed)) {
      verificationStore.addSecurityHistory(interaction.guildId, parsed.userId, { type: 'staff_rejection_processing_failed', staffUserId: clean(interaction.user.id), reason: String(outcome?.message || 'Failure processing did not complete').slice(0, 300) });
      await interaction.reply({ content: `⚠️ Staff rejection was recorded, but its security transition could not complete: ${outcome?.message || 'Unknown failure'}. Manual staff review is required.`, flags: MessageFlags.Ephemeral });
      return true;
    }
    if (!outcome?.quarantined) {
      verificationStore.upsertSession(interaction.guildId, parsed.userId, { state: 'rejected', activeSecurityMethod: null });
      verificationStore.addSecurityHistory(interaction.guildId, parsed.userId, { type: 'staff_verification_rejected', staffUserId: clean(interaction.user.id) });
    }
  } else resumed = await maybeResumeFlow(interaction, result, manager, parsed.userId);
  if (resumed?.challenge) await publishResumedChallenge(interaction, parsed.userId, resumed).catch(error => console.error('[Verification] Could not publish resumed challenge:', error));
  const actionMessage = resumed && !resumed.ok
    ? `⚠️ Staff approval was recorded, but Verification could not continue: ${resumed.message || 'Unknown error'}`
    : resumed?.complete
      ? `✅ Staff approval recorded. ${resumed.message}`
      : `✅ Verification staff action recorded: **${parsed.action}**.`;
  await interaction.reply({ content: actionMessage, flags: MessageFlags.Ephemeral });
  return true;
}

async function handleVerificationChallengeInteraction(interaction, manager = null) {
  const customId = clean(interaction?.customId);
  if (!customId.startsWith('verify:')) return false;
  if (!interaction.guildId || !guildManager.isModuleEnabled(interaction.guildId, 'verification')) {
    await interaction.reply({ content: '⏸️ Verification is currently disabled on this server.', flags: MessageFlags.Ephemeral });
    return true;
  }
  const modal = parseAnswerModalId(customId);
  if (modal && interaction.isModalSubmit?.()) return handleAnswerModal(interaction, modal, manager);
  const parsed = runtime.parseActionId(customId);
  if (!parsed) return false;
  if (parsed.type === 'member_answer' && interaction.isButton?.()) return handleMemberAction(interaction, parsed);
  if (parsed.type === 'staff_action' && interaction.isButton?.()) return handleStaffAction(interaction, parsed, manager);
  return false;
}

module.exports = { MODAL_PREFIX, ANSWER_FIELD_ID, METHOD_LABELS, buildAnswerModal, parseAnswerModalId, challengeEmbed, memberChallengePayload, staffChallengePayload, handleVerificationChallengeInteraction };
