'use strict';

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  RoleSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const giveawaysStore = require('./giveawaysStore');
const guildManager = require('../../../core/guild/guildManager');

function row(...components) { return new ActionRowBuilder().addComponents(...components); }
function button(customId, label, style = ButtonStyle.Primary, disabled = false) { return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style).setDisabled(disabled); }
function formatChannel(id) { return id ? `<#${id}>` : '`Not set`'; }
function formatRoles(ids = []) { const list = Array.isArray(ids) ? ids.filter(Boolean) : []; return list.length ? list.map((id) => `<@&${id}>`).join(', ') : '`None`'; }

function input(customId, label, value, placeholder = null) {
  const component = new TextInputBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setValue(String(value ?? ''));
  if (placeholder) component.setPlaceholder(placeholder);
  return new ActionRowBuilder().addComponents(component);
}

function getLevelingEligibility(section = {}) {
  const config = section.levelingEligibility && typeof section.levelingEligibility === 'object'
    ? section.levelingEligibility
    : {};
  const sortBy = ['xp', 'level', 'messages', 'voice'].includes(String(config.sortBy || '').toLowerCase())
    ? String(config.sortBy).toLowerCase()
    : 'xp';
  return {
    enabled: config.enabled === true,
    minLevel: Math.max(0, Math.floor(Number(config.minLevel || 0))),
    minXp: Math.max(0, Math.floor(Number(config.minXp || 0))),
    top: Math.max(0, Math.min(500, Math.floor(Number(config.top || 0)))),
    sortBy,
    activeOnly: config.activeOnly !== false,
  };
}

function eligibilitySummary(section = {}) {
  const config = getLevelingEligibility(section);
  if (!config.enabled) return 'Disabled';
  const rules = [];
  if (config.minLevel > 0) rules.push(`Level ${config.minLevel}+`);
  if (config.minXp > 0) rules.push(`${config.minXp.toLocaleString()}+ XP`);
  if (config.top > 0) rules.push(`Top ${config.top} by ${config.sortBy}`);
  if (config.activeOnly) rules.push('Leveling enabled');
  return rules.length ? rules.join(' · ') : 'Enabled · Any active Leveling participant';
}

function buildGiveawaysAdminPanel(guild, memberDisplayName = 'Unknown User') {
  const section = giveawaysStore.getSection(guild.id);
  const enabled = guildManager.isModuleEnabled(guild.id, 'giveaways');
  const giveawayList = Object.values(section.giveaways || {});
  const active = giveawayList.filter((giveaway) => giveaway.status === 'active').length;
  const embed = new EmbedBuilder()
    .setColor(enabled ? 0x57f287 : 0x5865f2)
    .setTitle('🎉 Giveaways')
    .setDescription([
      'Configure giveaway channels, roles and entry rules.', '',
      `**Status:** ${enabled ? 'Enabled ✅' : 'Disabled ❌'}`,
      `**Announcement Channel:** ${formatChannel(section.announcementChannelId)}`,
      `**Log Channel:** ${formatChannel(section.logChannelId)}`,
      `**Manager Roles:** ${formatRoles(section.managerRoleIds)}`,
      `**Required Roles:** ${formatRoles(section.requiredRoleIds)}`,
      `**Multiple Entries:** ${section.allowMultipleEntries ? 'Yes ✅' : 'No ❌'}`,
      `**Require Role:** ${section.requireRole ? 'Yes ✅' : 'No ❌'}`,
      `**Ping Winners:** ${section.pingWinners !== false ? 'Yes ✅' : 'No ❌'}`,
      `**Leveling Eligibility:** ${eligibilitySummary(section)}`, '',
      `Active: \`${active}\` | Created: \`${section.analytics.created}\` | Ended: \`${section.analytics.ended}\` | Entries: \`${section.analytics.entries}\``,
    ].join('\n')).setFooter({ text: `Requested by ${memberDisplayName}` }).setTimestamp();
  return { embeds: [embed], components: [
    row(new ChannelSelectMenuBuilder().setCustomId('admin:giveaways:announcementChannel').setPlaceholder('Announcement channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),
    row(new ChannelSelectMenuBuilder().setCustomId('admin:giveaways:logChannel').setPlaceholder('Log channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),
    row(new RoleSelectMenuBuilder().setCustomId('admin:giveaways:managerRoles').setPlaceholder('Manager roles').setMinValues(0).setMaxValues(10)),
    row(button('admin:giveaways:deployTest', '🚀 Deploy Test Giveaway', ButtonStyle.Success), button(enabled ? 'admin:giveaways:disable' : 'admin:giveaways:enable', enabled ? '⏸️ Disable' : '▶️ Enable', ButtonStyle.Secondary), button('admin:giveaways:toggleMultiple', '🎟️ Multiple', ButtonStyle.Secondary), button('admin:giveaways:toggleRequireRole', '🔒 Role Req', ButtonStyle.Secondary), button('admin:giveaways:togglePing', '📣 Ping', ButtonStyle.Secondary)),
    row(button('admin:giveaways:levelingEligibility', '🏆 XP Eligibility', ButtonStyle.Primary), button('admin:studio:communityStudio', '⬅️ Back', ButtonStyle.Secondary)),
  ] };
}

function buildLevelingEligibilityPanel(guild, memberDisplayName = 'Unknown User') {
  const section = giveawaysStore.getSection(guild.id);
  const config = getLevelingEligibility(section);
  const levelingEnabled = guildManager.isModuleEnabled(guild.id, 'leveling');
  const lines = [
    'Use the Leveling module as an additional giveaway entry and winner requirement.',
    '',
    `**Eligibility:** ${config.enabled ? 'Enabled ✅' : 'Disabled ❌'}`,
    `**Leveling Module:** ${levelingEnabled ? 'Enabled ✅' : 'Disabled ⚠️'}`,
    `**Minimum Level:** ${config.minLevel || 'None'}`,
    `**Minimum XP:** ${config.minXp ? config.minXp.toLocaleString() : 'None'}`,
    `**Top Rank Limit:** ${config.top ? `Top ${config.top}` : 'None'}`,
    `**Ranking Metric:** ${config.sortBy}`,
    `**Participation:** ${config.activeOnly ? 'Active Leveling participants only' : 'Active and paused Leveling users'}`,
    '',
    'Role requirements still apply separately. If XP eligibility is enabled, a member must satisfy both the role rules and these Leveling rules.',
    'Eligibility is checked when entering and checked again before winner selection/rerolls.',
    !levelingEnabled && config.enabled ? '\n⚠️ Leveling eligibility is enabled while the Leveling module is disabled. Entries will be blocked until Leveling is enabled again.' : null,
  ].filter(Boolean);

  return {
    embeds: [new EmbedBuilder()
      .setColor(config.enabled && levelingEnabled ? 0x57f287 : config.enabled ? 0xFEE75C : 0x5865f2)
      .setTitle('🏆 Giveaway XP Eligibility')
      .setDescription(lines.join('\n'))
      .setFooter({ text: `Requested by ${memberDisplayName}` })
      .setTimestamp()],
    components: [
      row(
        button('admin:giveaways:levelingEligibility:configure', '⚙️ Configure', ButtonStyle.Primary),
        button('admin:giveaways:levelingEligibility:toggle', config.enabled ? '⏸️ Disable' : '▶️ Enable', ButtonStyle.Secondary),
        button('admin:giveaways:levelingEligibility:toggleActive', config.activeOnly ? '👤 Active Only' : '👥 Include Paused', ButtonStyle.Secondary),
      ),
      row(button('admin:giveaways', '⬅️ Back', ButtonStyle.Secondary)),
    ],
  };
}

function buildLevelingEligibilityModal(section = {}) {
  const config = getLevelingEligibility(section);
  return new ModalBuilder()
    .setCustomId('admin:giveaways:levelingEligibility:configure:submit')
    .setTitle('Configure XP Eligibility')
    .addComponents(
      input('minLevel', 'Minimum level (0 = none)', config.minLevel, 'Example: 10'),
      input('minXp', 'Minimum XP (0 = none)', config.minXp, 'Example: 5000'),
      input('top', 'Top rank limit (0 = none)', config.top, 'Example: 25'),
      input('sortBy', 'Ranking metric', config.sortBy, 'xp, level, messages or voice'),
    );
}

async function handleGiveawaysAdminInteraction(interaction) {
  const handler = require('./giveawaysInteractionHandler');
  return handler.handleGiveawaysAdminInteraction(interaction);
}

module.exports = {
  buildGiveawaysAdminPanel,
  buildLevelingEligibilityPanel,
  buildLevelingEligibilityModal,
  getLevelingEligibility,
  handleGiveawaysAdminInteraction,
};