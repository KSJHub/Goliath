'use strict';

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, RoleSelectMenuBuilder } = require('discord.js');
const starboardStore = require('./starboardStore');
const { isModuleEnabled, setModuleEnabled } = require('../../../core/guild/guildManager');

const row = (...components) => new ActionRowBuilder().addComponents(...components);
const button = (customId, label, style = ButtonStyle.Primary) => new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
const displayName = (interaction) => interaction.member?.displayName || interaction.user?.displayName || interaction.user?.username || 'Unknown User';
const formatChannel = (id) => id ? `<#${id}>` : '`Not set`';
const formatRoles = (ids = []) => Array.isArray(ids) && ids.filter(Boolean).length ? ids.filter(Boolean).map((id) => `<@&${id}>`).join(', ') : '`None`';

function buildStarboardAdminPanel(guild, memberDisplayName = 'Unknown User') {
  const section = starboardStore.getStarboardSection(guild.id);
  const enabled = isModuleEnabled(guild.id, 'starboard') === true;
  const posts = Object.values(section.posts || {});
  const embed = new EmbedBuilder()
    .setColor(enabled ? 0x57f287 : 0x5865f2)
    .setTitle('⭐ Starboard')
    .setDescription([
      'Configure highlighted messages powered by reactions.', '',
      `**Status:** ${enabled ? 'Enabled ✅' : 'Disabled ❌'}`,
      `**Starboard Channel:** ${formatChannel(section.channelId)}`,
      `**Log Channel:** ${formatChannel(section.logChannelId)}`,
      `**Manager Roles:** ${formatRoles(section.managerRoleIds)}`,
      `**Emoji:** ${section.emoji || '⭐'}`,
      `**Threshold:** \`${section.threshold || 3}\``,
      `**Self Star:** ${section.allowSelfStar ? 'Allowed ✅' : 'Blocked ❌'}`,
      `**Unique Users:** ${section.requireUniqueUsers !== false ? 'Required ✅' : 'Not Required ❌'}`, '',
      `Posts: \`${posts.length}\` | Posted: \`${section.analytics?.posted || 0}\` | Updated: \`${section.analytics?.updated || 0}\``,
    ].join('\n'))
    .setFooter({ text: `Requested by ${memberDisplayName}` })
    .setTimestamp();

  return { embeds: [embed], components: [
    row(new ChannelSelectMenuBuilder().setCustomId('admin:starboard:channel').setPlaceholder('Starboard channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),
    row(new ChannelSelectMenuBuilder().setCustomId('admin:starboard:logChannel').setPlaceholder('Log channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),
    row(new RoleSelectMenuBuilder().setCustomId('admin:starboard:managerRoles').setPlaceholder('Manager roles').setMinValues(0).setMaxValues(10)),
    row(
      button(enabled ? 'admin:starboard:disable' : 'admin:starboard:enable', enabled ? '⏸️ Disable' : '▶️ Enable', ButtonStyle.Secondary),
      button('admin:starboard:thresholdDown', '➖ Threshold', ButtonStyle.Secondary),
      button('admin:starboard:thresholdUp', '➕ Threshold', ButtonStyle.Secondary),
      button('admin:starboard:toggleSelf', '⭐ Self Star', ButtonStyle.Secondary),
      button('admin:starboard:toggleUnique', '👥 Unique', ButtonStyle.Secondary)
    ),
    row(button('admin:modules', '⬅️ Modules', ButtonStyle.Secondary)),
  ] };
}

const save = (guild, updater) => starboardStore.updateStarboardSection(guild.id, updater, guild);
async function safeUpdate(interaction, payload) {
  if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
  else await interaction.update(payload);
  return true;
}

async function handleStarboardAdminInteraction(interaction) {
  const id = String(interaction.customId || '');
  if (!id.startsWith('admin:starboard')) return false;
  const member = displayName(interaction);

  try {
    if (id === 'admin:starboard') return safeUpdate(interaction, buildStarboardAdminPanel(interaction.guild, member));
    if (interaction.isChannelSelectMenu?.()) {
      const value = interaction.values?.[0] || null;
      const property = id.split(':')[2];
      if (property === 'channel') save(interaction.guild, (section) => ({ ...section, channelId: value }));
      if (property === 'logChannel') save(interaction.guild, (section) => ({ ...section, logChannelId: value }));
    } else if (interaction.isRoleSelectMenu?.() && id === 'admin:starboard:managerRoles') {
      save(interaction.guild, (section) => ({ ...section, managerRoleIds: [...new Set(interaction.values || [])] }));
    } else if (id === 'admin:starboard:enable') {
      setModuleEnabled(interaction.guild.id, 'starboard', true);
    } else if (id === 'admin:starboard:disable') {
      setModuleEnabled(interaction.guild.id, 'starboard', false);
    } else if (id === 'admin:starboard:thresholdUp') {
      save(interaction.guild, (section) => ({ ...section, threshold: Math.min(50, Number(section.threshold || 3) + 1) }));
    } else if (id === 'admin:starboard:thresholdDown') {
      save(interaction.guild, (section) => ({ ...section, threshold: Math.max(1, Number(section.threshold || 3) - 1) }));
    } else if (id === 'admin:starboard:toggleSelf') {
      save(interaction.guild, (section) => ({ ...section, allowSelfStar: !section.allowSelfStar }));
    } else if (id === 'admin:starboard:toggleUnique') {
      save(interaction.guild, (section) => ({ ...section, requireUniqueUsers: !section.requireUniqueUsers }));
    }
    return safeUpdate(interaction, buildStarboardAdminPanel(interaction.guild, member));
  } catch (error) {
    const payload = { content: `❌ Starboard setup failed: ${error.message}`, flags: 64 };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => null);
    else await interaction.reply(payload).catch(() => null);
    return true;
  }
}

module.exports = { buildStarboardAdminPanel, handleStarboardAdminInteraction };
