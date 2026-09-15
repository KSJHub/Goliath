'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const guildManager = require('../../guild/guildManager');
const { getQuarantineState, getQuarantineMode, QUARANTINE_MODES } = require('../../security/protection/quarantine');

const data = new SlashCommandBuilder()
  .setName('investigation-access')
  .setDescription('Choose normal channels an investigated member can still use')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption(o => o.setName('member').setDescription('Member under investigation').setRequired(true))
  .addStringOption(o => o.setName('action').setDescription('What to change').setRequired(true)
    .addChoices(
      { name: 'Allow a channel', value: 'add' },
      { name: 'Remove a channel', value: 'remove' },
      { name: 'Return to investigation room only', value: 'clear' },
    ))
  .addChannelOption(o => o.setName('channel').setDescription('Channel to allow or remove').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement));

const help = {
  category: 'Moderation',
  summary: 'Choose which normal channels an investigated member can still use.',
  access: 'moderator',
};

function save(guild, state) {
  return guildManager.updateSecurityConfig(guild.id, security => ({ ...security, quarantine: state }), guild);
}

async function editAccess(channel, memberId, allowed, reason) {
  if (!channel?.permissionOverwrites?.edit) throw new Error('That channel cannot be managed.');
  if (allowed) {
    await channel.permissionOverwrites.edit(memberId, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
    }, { reason });
  } else {
    await channel.permissionOverwrites.edit(memberId, { ViewChannel: false }, { reason });
  }
}

async function execute(interaction) {
  if (!interaction.inGuild()) return interaction.reply({ content: '❌ This only works inside a server.', ephemeral: true });
  const target = interaction.options.getMember('member');
  const action = interaction.options.getString('action', true);
  const channel = interaction.options.getChannel('channel');
  if (!target) return interaction.reply({ content: '❌ I could not find that member.', ephemeral: true });

  const state = getQuarantineState(interaction.guild.id);
  const snapshot = state.users?.[target.id];
  if (!snapshot || getQuarantineMode(snapshot) !== QUARANTINE_MODES.INVESTIGATION) {
    return interaction.reply({ content: `⚠️ **${target.user.tag}** is not currently under Investigation Isolation.`, ephemeral: true });
  }
  if ((action === 'add' || action === 'remove') && !channel) {
    return interaction.reply({ content: '❌ Choose a channel as well.', ephemeral: true });
  }
  if (channel && String(channel.id) === String(snapshot.interviewChannelId || '')) {
    return interaction.reply({ content: 'ℹ️ The private investigation room is always available while the investigation is active.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });
  const existing = [...new Set((snapshot.allowedChannelIds || []).map(String))];
  const before = new Set(existing);
  const next = new Set(existing);

  try {
    if (action === 'add') {
      await editAccess(channel, target.id, true, `Investigation channel access allowed by ${interaction.user.tag}`);
      next.add(String(channel.id));
    } else if (action === 'remove') {
      await editAccess(channel, target.id, false, `Investigation channel access removed by ${interaction.user.tag}`);
      next.delete(String(channel.id));
    } else {
      for (const channelId of existing) {
        const current = interaction.guild.channels.cache.get(channelId) || await interaction.guild.channels.fetch(channelId).catch(() => null);
        if (current) await editAccess(current, target.id, false, `Investigation returned to private-room-only by ${interaction.user.tag}`);
      }
      next.clear();
    }

    snapshot.allowedChannelIds = [...next];
    snapshot.allowedChannelsUpdatedAt = Date.now();
    snapshot.allowedChannelsUpdatedBy = interaction.user.id;
    state.users[target.id] = snapshot;
    save(interaction.guild, state);

    const allowed = snapshot.allowedChannelIds.length
      ? snapshot.allowedChannelIds.map(id => `<#${id}>`).join(', ')
      : '**Private investigation room only**';
    return interaction.editReply({ content: `✅ **${target.user.tag}** investigation access updated.\nAllowed: ${allowed}` });
  } catch (error) {
    // Best-effort rollback of the single changed channel. State is not saved until Discord succeeds.
    if (channel && action !== 'clear') {
      await editAccess(channel, target.id, before.has(String(channel.id)), 'Rollback failed investigation access change').catch(() => null);
    }
    return interaction.editReply({ content: `❌ I couldn't change that access: ${error.message}` });
  }
}

module.exports = { data, execute, help };
