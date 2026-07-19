'use strict';

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const reactionRoles = require('./reactionRoles');
const legacyPanel = require('./reactionRolesPanelV3');

const row = (...items) => new ActionRowBuilder().addComponents(...items.filter(Boolean));
const button = (id, label, style = ButtonStyle.Secondary, disabled = false) => new ButtonBuilder()
  .setCustomId(id).setLabel(label).setStyle(style).setDisabled(Boolean(disabled));
const displayName = (interaction) => interaction.member?.displayName || interaction.user?.username || 'Unknown User';

function deploymentSelect(guildId) {
  const { StringSelectMenuBuilder } = require('discord.js');
  const panels = reactionRoles.listPanels(guildId).slice(0, 25);
  const menu = new StringSelectMenuBuilder()
    .setCustomId('admin:reactionRoles:manage:panel')
    .setPlaceholder(panels.length ? '📂 Manage a deployment' : 'No deployments yet')
    .setMinValues(1).setMaxValues(1).setDisabled(!panels.length);
  menu.addOptions(panels.length ? panels.map((panel) => ({
    label: String(panel.name || panel.panelId).slice(0, 100),
    description: `${panel.enabled === false ? 'Disabled' : 'Enabled'} • ${panel.mappings.length} role mapping(s) • ${panel.source === 'template' ? 'Goliath panel' : 'Existing message'}`.slice(0, 100),
    value: panel.panelId,
  })) : [{ label: 'Create or attach a panel to begin', value: 'none' }]);
  return menu;
}

async function buildReactionRolesAdminPanel(guild, memberDisplayName = 'Unknown User') {
  const config = reactionRoles.getSection(guild.id);
  const health = await reactionRoles.buildHealth(guild);
  const panels = reactionRoles.listPanels(guild.id);
  const mappings = panels.reduce((total, panel) => total + (panel.mappings?.length || 0), 0);
  const drafts = Object.keys(config.drafts || {}).length;
  const analytics = config.analytics || {};

  const status = config.enabled !== false ? '🟢 Online' : '⏸️ Disabled';
  const healthText = health.healthy ? 'Healthy' : `${health.unhealthy || 0} need attention`;
  const stats = [
    `**Deployments** \`${panels.length}\``,
    `**Mappings** \`${mappings}\``,
    `**Drafts** \`${drafts}\``,
    `**Assigned** \`${analytics.assigned || 0}\``,
    `**Removed** \`${analytics.removed || 0}\``,
    `**Failed** \`${analytics.failed || 0}\``,
  ].join('  •  ');

  const embed = new EmbedBuilder()
    .setColor(config.enabled !== false && health.healthy ? 0x57f287 : 0xfaa61a)
    .setTitle('🎭 Role Studio')
    .setDescription([
      `### ${status}  •  ${healthText}`,
      stats,
      '',
      '**Create, attach and manage role panels from one workspace.**',
      'Supports existing messages, embeds, bot and webhook posts, announcement channels and accessible threads.',
      '',
      '**Find any message using:**',
      '`Channel Browser`  •  `Recent Messages`  •  `Message Search`',
      '`Discord Link`  •  `Channel + Message IDs`',
      '',
      '> Original text, embeds, components and unrelated reactions are preserved.',
    ].join('\n'))
    .setFooter({ text: `Requested by ${memberDisplayName}` })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      row(
        button('admin:reactionRoles:new:existing', 'Attach Existing Message', ButtonStyle.Primary),
        button('admin:reactionRoles:new:template', 'Create New Panel', ButtonStyle.Success),
        button('admin:reactionRoles:continue', drafts ? 'Resume Draft' : 'Start Setup')
      ),
      row(deploymentSelect(guild.id)),
      row(
        button('admin:reactionRoles:admin', 'Admin Centre', ButtonStyle.Primary),
        button('admin:modules', 'Back to Modules')
      ),
    ],
  };
}

async function handleReactionRolesAdminInteraction(interaction) {
  if (String(interaction.customId || '') === 'admin:reactionRoles') {
    const payload = await buildReactionRolesAdminPanel(interaction.guild, displayName(interaction));
    if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
    else if (interaction.isButton?.() || interaction.isAnySelectMenu?.()) await interaction.update(payload);
    else await interaction.reply({ ...payload, ephemeral: true });
    return true;
  }
  return legacyPanel.handleReactionRolesAdminInteraction(interaction);
}

module.exports = { buildReactionRolesAdminPanel, handleReactionRolesAdminInteraction };
