'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require('discord.js');
const invites = require('./invites');

const ACHIEVEMENTS = [
  { threshold: 1, emoji: '🥉', name: 'First Friend' },
  { threshold: 10, emoji: '🥈', name: 'Recruiter' },
  { threshold: 25, emoji: '🥇', name: 'Community Builder' },
  { threshold: 50, emoji: '💎', name: 'Diamond Recruiter' },
  { threshold: 100, emoji: '👑', name: 'Legend' },
];

function statsFor(guildId, userId) {
  const section = invites.getSection(guildId);
  const stats = section.inviters?.[userId] || {};
  const score = Math.max(0, Number(stats.active || 0) + Number(stats.bonus || 0));
  const rankIndex = invites.leaderboard(guildId, 100).findIndex((entry) => entry.inviterId === userId);
  const personal = invites.findPersonalInvite(guildId, userId);
  const earned = ACHIEVEMENTS.filter((achievement) => score >= achievement.threshold);
  const next = ACHIEVEMENTS.find((achievement) => score < achievement.threshold) || null;
  return {
    score,
    active: Math.max(0, Number(stats.active || 0)),
    total: Math.max(0, Number(stats.total || 0)),
    left: Math.max(0, Number(stats.left || 0)),
    bonus: Number(stats.bonus || 0),
    rank: rankIndex >= 0 ? rankIndex + 1 : null,
    personal,
    earned,
    next,
  };
}

function profilePayload(guild, user) {
  const stats = statsFor(guild.id, user.id);
  const inviteUrl = stats.personal?.code ? `https://discord.gg/${stats.personal.code}` : 'No personal invite yet';
  const achievements = stats.earned.length
    ? stats.earned.map((item) => `${item.emoji} ${item.name}`).join('\n')
    : 'No achievements unlocked yet.';
  const remaining = stats.next ? Math.max(0, stats.next.threshold - stats.score) : 0;
  const nextReward = stats.next
    ? `${remaining} more invite${remaining === 1 ? '' : 's'} until ${stats.next.emoji} ${stats.next.name}`
    : 'All achievements unlocked.';

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`💎 ${user.displayName || user.username}'s Invite Profile`)
    .setThumbnail(user.displayAvatarURL?.() || null)
    .addFields(
      { name: 'Rank', value: stats.rank ? `#${stats.rank}` : 'Unranked', inline: true },
      { name: 'Leaderboard score', value: String(stats.score), inline: true },
      { name: 'Lifetime invites', value: String(stats.total), inline: true },
      { name: 'Active invites', value: String(stats.active), inline: true },
      { name: 'Members left', value: String(stats.left), inline: true },
      { name: 'Bonus', value: String(stats.bonus), inline: true },
      { name: 'Personal invite', value: inviteUrl, inline: false },
      { name: 'Achievements', value: achievements, inline: false },
      { name: 'Next achievement', value: nextReward, inline: false },
    )
    .setFooter({ text: `Invite friends to ${guild.name} and climb the leaderboard.` })
    .setTimestamp();

  const buttons = [
    new ButtonBuilder().setCustomId('invites:member-personal').setLabel(stats.personal ? 'Resend My Invite' : 'Get My Invite').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('invites:member-personal-delete').setLabel('Delete My Invite').setStyle(ButtonStyle.Danger).setDisabled(!stats.personal),
  ];
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(...buttons)], flags: MessageFlags.Ephemeral };
}

async function handleProfileInteraction(interaction) {
  if (interaction.customId !== 'invites:member-profile') return false;
  await interaction.reply(profilePayload(interaction.guild, interaction.user));
  return true;
}

async function notifyInviteUsed(guild, inviterId, joinedMember) {
  if (!inviterId) return false;
  const inviter = await guild.members.fetch(inviterId).catch(() => null);
  if (!inviter?.user) return false;
  const stats = statsFor(guild.id, inviterId);
  const remaining = stats.next ? Math.max(0, stats.next.threshold - stats.score) : 0;
  const nextReward = stats.next
    ? `${remaining} more invite${remaining === 1 ? '' : 's'} until ${stats.next.name}`
    : 'All achievements unlocked';
  const embed = new EmbedBuilder()
    .setColor(0x57F287)
    .setTitle('🎉 Someone joined using your invite!')
    .setDescription(`**${joinedMember.user?.tag || joinedMember.id}** joined **${guild.name}** using an invite credited to you.`)
    .addFields(
      { name: 'Current score', value: String(stats.score), inline: true },
      { name: 'Current rank', value: stats.rank ? `#${stats.rank}` : 'Unranked', inline: true },
      { name: 'Next achievement', value: nextReward, inline: false },
    )
    .setTimestamp();
  await inviter.user.send({ embeds: [embed] }).catch(() => null);
  return true;
}

module.exports = { ACHIEVEMENTS, statsFor, profilePayload, handleProfileInteraction, notifyInviteUsed };