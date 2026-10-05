'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const runtime = require('./verificationChallengeRuntime');
const verificationStore = require('./verificationStore');

const MODAL_PREFIX = 'verify:answer';
const ANSWER_FIELD_ID = 'answer';
const METHOD_LABELS = Object.freeze({
  captcha: 'CAPTCHA',
  minigame: 'Mini-game',
  one_time_challenge: 'One-Time Challenge',
  staff_approval: 'Staff Approval',
});

const clean = value => String(value ?? '').trim();

function buildAnswerModal(userId, challenge) {
  if (!challenge?.challengeId) throw new Error('Challenge is unavailable.');
  const modal = new ModalBuilder()
    .setCustomId(`${MODAL_PREFIX}:${clean(userId)}:${challenge.challengeId}`)
    .setTitle((METHOD_LABELS[challenge.method] || 'Verification').slice(0, 45));
  const input = new TextInputBuilder()
    .setCustomId(ANSWER_FIELD_ID)
    .setLabel('Your answer')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(200)
    .setPlaceholder('Enter your answer');
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

function parseAnswerModalId(customId = '') {
  const parts = clean(customId).split(':');
  if (parts.length !== 5 || parts[0] !== 'verify' || parts[1] !== 'answer') return null;
  return { userId: parts[2], challengeId: `${parts[3]}:${parts[4]}` };
}

function parseAnswerModalIdSafe(customId = '') {
  const prefix = `${MODAL_PREFIX}:`;
  const value = clean(customId);
  if (!value.startsWith(prefix)) return null;
  const remainder = value.slice(prefix.length);
  const separator = remainder.indexOf(':');
  if (separator <= 0) return null;
  return { userId: remainder.slice(0, separator), challengeId: remainder.slice(separator + 1) };
}

function challengeEmbed(challenge, member = null) {
  const label = METHOD_LABELS[challenge?.method] || 'Verification';
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🛡️ ${label}`)
    .setDescription(clean(challenge?.prompt) || 'Complete this security check to continue.')
    .setFooter({ text: 'Goliath Verification' })
    .setTimestamp();
  if (member?.user) embed.setAuthor({ name: member.user.tag || member.user.username || member.id });
  if (challenge?.rounds > 1) embed.addFields({ name: 'Progress', value: `Round ${challenge.round || 1}/${challenge.rounds}`, inline: true });
  if (challenge?.maxAttempts > 1) embed.addFields({ name: 'Attempts', value: `${challenge.attempts || 0}/${challenge.maxAttempts}`, inline: true });
  if (challenge?.expiresAt) embed.addFields({ name: 'Expires', value: `<t:${Math.floor(new Date(challenge.expiresAt).getTime() / 1000)}:R>`, inline: true });
  return embed;
}

function memberChallengePayload(userId, challenge) {
  if (!challenge) return { content: '❌ No active Verification challenge exists.', components: [] };
  if (challenge.method === 'staff_approval') {
    return { embeds: [challengeEmbed(challenge)], content: '⏳ Verification is waiting for a member of staff.', components: [] };
  }
  const button = new ButtonBuilder()
    .setCustomId(runtime.buildMemberActionId(userId, challenge.challengeId))
    .setLabel(challenge.method === 'minigame' ? 'Answer Mini-game' : 'Enter Answer')
    .setStyle(ButtonStyle.Primary);
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

async function maybeResumeFlow(interaction, result, manager) {
  if (!result?.resumeFlow || typeof manager?.resumeVerification !== 'function') return null;
  return manager.resumeVerification({
    guild: interaction.guild,
    guildId: interaction.guildId,
    member: await interaction.guild.members.fetch(interaction.user.id).catch(() => interaction.member),
    user: interaction.user,
    completedSecurity: result.completedSecurity,
  });
}

async function handleMemberAction(interaction, parsed) {
  if (clean(interaction.user?.id) !== clean(parsed.userId)) {
    await interaction.reply({ content: '❌ This Verification challenge belongs to another member.', flags: MessageFlags.Ephemeral });
    return true;
  }
  const state = runtime.sessionState(interaction.guildId, parsed.userId);
  const challenge = state.activeChallenge;
  if (!challenge || challenge.challengeId !== parsed.challengeId) {
    await interaction.reply({ content: '❌ This Verification challenge is no longer active.', flags: MessageFlags.Ephemeral });
    return true;
  }
  await interaction.showModal(buildAnswerModal(parsed.userId, challenge));
  return true;
}

async function handleAnswerModal(interaction, parsed, manager) {
  if (clean(interaction.user?.id) !== clean(parsed.userId)) {
    await interaction.reply({ content: '❌ This Verification challenge belongs to another member.', flags: MessageFlags.Ephemeral });
    return true;
  }
  const answer = interaction.fields.getTextInputValue(ANSWER_FIELD_ID);
  const result = runtime.submitAnswer(interaction.guildId, interaction.user.id, parsed.userId, parsed.challengeId, answer);
  if (!result.ok) {
    const message = result.reason === 'challenge_expired' ? '⏱️ This challenge expired. Start Verification again.' : result.complete ? '❌ That answer was incorrect and this challenge has ended.' : '❌ That answer was incorrect. Try again.';
    await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    return true;
  }
  const resumed = await maybeResumeFlow(interaction, result, manager);
  if (resumed) {
    await interaction.reply({ content: resumed.ok ? `✅ ${resumed.message}` : resumed.message || 'Security check passed. Continue Verification.', flags: MessageFlags.Ephemeral });
    return true;
  }
  const next = runtime.sessionState(interaction.guildId, parsed.userId).activeChallenge;
  await interaction.reply({
    content: result.complete ? '✅ Security check passed.' : '✅ Round passed. Continue with the next round.',
    ...(next && !result.complete ? memberChallengePayload(parsed.userId, next) : {}),
    flags: MessageFlags.Ephemeral,
  });
  return true;
}

async function handleStaffAction(interaction, parsed, manager) {
  const section = verificationStore.getVerificationSection(interaction.guildId);
  if (!isStaff(interaction.member, section.settings || {})) {
    await interaction.reply({ content: '❌ You are not authorised to resolve Verification staff approvals.', flags: MessageFlags.Ephemeral });
    return true;
  }
  const result = runtime.resolveStaffAction(interaction.guildId, parsed.userId, parsed.challengeId, interaction.user.id, parsed.action);
  if (!result.ok) {
    await interaction.reply({ content: `❌ Staff action failed: ${result.reason || 'challenge unavailable'}.`, flags: MessageFlags.Ephemeral });
    return true;
  }
  if (result.quarantine && typeof manager?.quarantineVerificationMember === 'function') {
    await manager.quarantineVerificationMember(interaction.guild, parsed.userId, 'Quarantined by Verification staff approval');
  } else if (result.recordFailure && typeof manager?.recordVerificationFailure === 'function') {
    await manager.recordVerificationFailure(interaction.guild, parsed.userId, 'staff_approval', 'Rejected by Verification staff');
  } else {
    await maybeResumeFlow({ ...interaction, user: { id: parsed.userId } }, result, manager);
  }
  await interaction.reply({ content: `✅ Verification staff action recorded: **${parsed.action}**.`, flags: MessageFlags.Ephemeral });
  return true;
}

async function handleVerificationChallengeInteraction(interaction, manager = null) {
  const customId = clean(interaction?.customId);
  if (!customId.startsWith('verify:')) return false;
  const modal = parseAnswerModalIdSafe(customId);
  if (modal && interaction.isModalSubmit?.()) return handleAnswerModal(interaction, modal, manager);
  const parsed = runtime.parseActionId(customId);
  if (!parsed) return false;
  if (parsed.type === 'member_answer' && interaction.isButton?.()) return handleMemberAction(interaction, parsed);
  if (parsed.type === 'staff_action' && interaction.isButton?.()) return handleStaffAction(interaction, parsed, manager);
  return false;
}

module.exports = {
  MODAL_PREFIX,
  ANSWER_FIELD_ID,
  METHOD_LABELS,
  buildAnswerModal,
  parseAnswerModalId: parseAnswerModalIdSafe,
  challengeEmbed,
  memberChallengePayload,
  staffChallengePayload,
  handleVerificationChallengeInteraction,
};
