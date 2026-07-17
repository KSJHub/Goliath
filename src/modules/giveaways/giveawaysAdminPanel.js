'use strict';

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  RoleSelectMenuBuilder,
} = require('discord.js');

const giveawaysStore = require('./giveawaysStore');
const giveawaysManager = require('./giveawaysManager');

function row(...components) { return new ActionRowBuilder().addComponents(...components); }
function button(customId, label, style = ButtonStyle.Primary) { return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style); }
function getMemberDisplayName(interaction) { return interaction.member?.displayName || interaction.user?.displayName || interaction.user?.username || 'Unknown User'; }
function formatChannel(id) { return id ? `<#${id}>` : '`Not set`'; }
function formatRoles(ids = []) { const list = Array.isArray(ids) ? ids.filter(Boolean) : []; return list.length ? list.map((id) => `<@&${id}>`).join(', ') : '`None`'; }

function buildGiveawaysAdminPanel(guild, memberDisplayName = 'Unknown User') {
  const section = giveawaysStore.getSection(guild.id);
  const giveaways = Object.values(section.giveaways || {});
  const active = giveaways.filter((giveaway) => giveaway.status === 'active').length;
  const embed = new EmbedBuilder()
    .setColor(section.enabled !== false ? 0x57f287 : 0x5865f2)
    .setTitle('🎉 Giveaways')
    .setDescription([
      'Configure giveaway channels, roles and entry rules.', '',
      `**Status:** ${section.enabled !== false ? 'Enabled ✅' : 'Disabled ❌'}`,
      `**Announcement Channel:** ${formatChannel(section.announcementChannelId)}`,
      `**Log Channel:** ${formatChannel(section.logChannelId)}`,
      `**Manager Roles:** ${formatRoles(section.managerRoleIds)}`,
      `**Required Roles:** ${formatRoles(section.requiredRoleIds)}`,
      `**Multiple Entries:** ${section.allowMultipleEntries ? 'Yes ✅' : 'No ❌'}`,
      `**Require Role:** ${section.requireRole ? 'Yes ✅' : 'No ❌'}`,
      `**Ping Winners:** ${section.pingWinners !== false ? 'Yes ✅' : 'No ❌'}`, '',
      `Active: \`${active}\` | Created: \`${section.analytics.created}\` | Ended: \`${section.analytics.ended}\` | Entries: \`${section.analytics.entries}\``,
    ].join('\n')).setFooter({ text: `Requested by ${memberDisplayName}` }).setTimestamp();
  return { embeds: [embed], components: [
    row(new ChannelSelectMenuBuilder().setCustomId('admin:giveaways:announcementChannel').setPlaceholder('Announcement channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),
    row(new ChannelSelectMenuBuilder().setCustomId('admin:giveaways:logChannel').setPlaceholder('Log channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),
    row(new RoleSelectMenuBuilder().setCustomId('admin:giveaways:managerRoles').setPlaceholder('Manager roles').setMinValues(0).setMaxValues(10)),
    row(button('admin:giveaways:deployTest', '🚀 Deploy Test Giveaway', ButtonStyle.Success), button(section.enabled !== false ? 'admin:giveaways:disable' : 'admin:giveaways:enable', section.enabled !== false ? '⏸️ Disable' : '▶️ Enable', ButtonStyle.Secondary), button('admin:giveaways:toggleMultiple', '🎟️ Multiple', ButtonStyle.Secondary), button('admin:giveaways:toggleRequireRole', '🔒 Role Req', ButtonStyle.Secondary), button('admin:giveaways:togglePing', '📣 Ping', ButtonStyle.Secondary)),
    row(button('admin:modules', '⬅️ Modules', ButtonStyle.Secondary)),
  ] };
}

function save(guild, updater) { return giveawaysStore.updateSection(guild.id, updater, guild); }
async function safeUpdate(interaction, payload) { if (interaction.deferred || interaction.replied) { await interaction.editReply(payload); return true; } await interaction.update(payload); return true; }

async function handleGiveawaysAdminInteraction(interaction) {
  const customId = String(interaction.customId || '');
  if (!customId.startsWith('admin:giveaways')) return false;
  const memberDisplayName = getMemberDisplayName(interaction);
  try {
    if (customId === 'admin:giveaways') return safeUpdate(interaction, buildGiveawaysAdminPanel(interaction.guild, memberDisplayName));
    if (interaction.isChannelSelectMenu?.()) {
      const value = interaction.values?.[0] || null;
      const prop = customId.split(':')[2];
      if (prop === 'announcementChannel') save(interaction.guild, (section) => ({ ...section, announcementChannelId: value }));
      if (prop === 'logChannel') save(interaction.guild, (section) => ({ ...section, logChannelId: value }));
      return safeUpdate(interaction, buildGiveawaysAdminPanel(interaction.guild, memberDisplayName));
    }
    if (interaction.isRoleSelectMenu?.() && customId === 'admin:giveaways:managerRoles') {
      save(interaction.guild, (section) => ({ ...section, managerRoleIds: [...new Set(interaction.values || [])] }));
      return safeUpdate(interaction, buildGiveawaysAdminPanel(interaction.guild, memberDisplayName));
    }
    if (customId === 'admin:giveaways:enable') save(interaction.guild, (section) => ({ ...section, enabled: true }));
    if (customId === 'admin:giveaways:disable') save(interaction.guild, (section) => ({ ...section, enabled: false }));
    if (customId === 'admin:giveaways:toggleMultiple') save(interaction.guild, (section) => ({ ...section, allowMultipleEntries: !section.allowMultipleEntries }));
    if (customId === 'admin:giveaways:toggleRequireRole') save(interaction.guild, (section) => ({ ...section, requireRole: !section.requireRole }));
    if (customId === 'admin:giveaways:togglePing') save(interaction.guild, (section) => ({ ...section, pingWinners: !section.pingWinners }));
    if (customId === 'admin:giveaways:deployTest') {
      await interaction.deferUpdate().catch(() => null);
      await giveawaysManager.deployTestGiveaway(interaction.guild, interaction.user.id);
      return safeUpdate(interaction, buildGiveawaysAdminPanel(interaction.guild, memberDisplayName));
    }
    return safeUpdate(interaction, buildGiveawaysAdminPanel(interaction.guild, memberDisplayName));
  } catch (error) {
    const payload = { content: `❌ Giveaways setup failed: ${error.message}`, flags: 64 };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => null); else await interaction.reply(payload).catch(() => null);
    return true;
  }
}

module.exports = { buildGiveawaysAdminPanel, handleGiveawaysAdminInteraction };
