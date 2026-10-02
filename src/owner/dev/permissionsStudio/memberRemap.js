'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  UserSelectMenuBuilder,
} = require('discord.js');

function cid(action, guildId) {
  return `permstudio:${action}:guild:${guildId}`;
}

function button(id, label, emoji, style = ButtonStyle.Secondary) {
  return new ButtonBuilder().setCustomId(id).setLabel(label).setEmoji(emoji).setStyle(style);
}

function picker(guild, channel, sourceMember) {
  const select = new UserSelectMenuBuilder()
    .setCustomId(cid(`single-member-target-${channel.id}-${sourceMember.id}`, guild.id))
    .setPlaceholder(`Copy ${sourceMember.displayName}'s override to…`)
    .setMinValues(1)
    .setMaxValues(1);

  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('👤 Copy Member Override')
        .setDescription(
          `**Source:** ${sourceMember.displayName}\n` +
          `**Channel:** ${channel.name}\n\n` +
          'Choose the destination member. Only that member\'s direct channel overwrite will be changed; role and other member overwrites stay untouched.'
        ),
    ],
    components: [
      new ActionRowBuilder().addComponents(select),
      new ActionRowBuilder().addComponents(
        button(cid(`channel-member-open-${channel.id}-${sourceMember.id}`, guild.id), 'Cancel', '⬅️')
      ),
    ],
  };
}

function preview(guild, channel, sourceMember, targetMember, token) {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0xFEE75C)
        .setTitle('🔎 Member Override Copy Preview')
        .setDescription(
          `**Channel:** ${channel.name}\n` +
          `**From:** ${sourceMember.displayName}\n` +
          `**To:** ${targetMember.displayName}\n\n` +
          `The direct **Allow / Deny / Inherit** overwrite from ${sourceMember.displayName} will be copied to ${targetMember.displayName}.\n\n` +
          'Nothing else on this channel will be changed. A complete before-state snapshot will be kept for Undo.'
        ),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        button(cid(`confirm-single-member-${token}`, guild.id), 'Apply Member Override', '✅', ButtonStyle.Success),
        button(cid(`channel-member-open-${channel.id}-${sourceMember.id}`, guild.id), 'Back', '⬅️')
      ),
    ],
  };
}

module.exports = { picker, preview };
