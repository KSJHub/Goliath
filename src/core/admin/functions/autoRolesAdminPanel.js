'use strict';

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  RoleSelectMenuBuilder,
  AttachmentBuilder,
} = require('discord.js');

const autoRoles = require('../../../modules/autoroles');

function row(...components) {
  return new ActionRowBuilder().addComponents(...components);
}

function button(customId, label, style = ButtonStyle.Secondary) {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
}

function formatRoles(ids = []) {
  return ids.length ? ids.map((id) => `<@&${id}>`).join(', ') : '`None`';
}

async function buildAutoRolesAdminPanel(guild, memberDisplayName = 'Unknown User') {
  const config = autoRoles.getAutoRolesSection(guild.id);
  const health = await autoRoles.buildHealthReport(guild);

  const embed = new EmbedBuilder()
    .setColor(health.healthy ? 0x57f287 : 0xfaa61a)
    .setTitle('👥 Auto Roles · Setup')
    .setDescription([
      `**Status:** ${config.enabled !== false ? 'Enabled ✅' : 'Disabled ❌'}`,
      `**Join Roles:** ${formatRoles(config.joinRoles)}`,
      `**Bot Roles:** ${formatRoles(config.botRoles)}`,
      `**Apply To Bots:** ${config.settings.applyToBots ? 'Yes ✅' : 'No ❌'}`,
      `**Reapply On Startup:** ${config.settings.reapplyOnStartup ? 'Yes ✅' : 'No ❌'}`,
      `**Audit Logging:** ${config.settings.auditLog ? 'Yes ✅' : 'No ❌'}`,
      '',
      `Assigned: \`${config.analytics.assigned || 0}\` | Failed: \`${config.analytics.failed || 0}\` | Skipped: \`${config.analytics.skipped || 0}\``,
      '',
      health.warnings.length ? `**Warnings**\n${health.warnings.map((warning) => `• ${warning}`).join('\n')}` : '**Health:** Healthy ✅',
    ].join('\n').slice(0, 4096))
    .setFooter({ text: `Requested by ${memberDisplayName}` })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      row(new RoleSelectMenuBuilder().setCustomId('admin:autoRoles:joinRoles').setPlaceholder('Select join roles').setMinValues(0).setMaxValues(10)),
      row(new RoleSelectMenuBuilder().setCustomId('admin:autoRoles:botRoles').setPlaceholder('Select bot roles').setMinValues(0).setMaxValues(10)),
      row(
        button(config.enabled !== false ? 'admin:autoRoles:disable' : 'admin:autoRoles:enable', config.enabled !== false ? '⏸️ Disable' : '▶️ Enable', config.enabled !== false ? ButtonStyle.Secondary : ButtonStyle.Success),
        button('admin:autoRoles:toggleBots', '🤖 Apply To Bots'),
        button('admin:autoRoles:toggleReapply', '🔁 Reapply On Startup'),
        button('admin:autoRoles:repair', '🩺 Repair', ButtonStyle.Primary),
        button('admin:autoRoles:reapply', '🚀 Reapply Now', ButtonStyle.Success)
      ),
      row(
        button('admin:autoRoles:export', '📤 Export'),
        button('admin:autoRoles:reset', '♻️ Reset', ButtonStyle.Danger),
        button('admin:modules', '⬅️ Modules')
      ),
    ],
  };
}

async function updatePanel(interaction) {
  const payload = await buildAutoRolesAdminPanel(interaction.guild, interaction.member?.displayName || interaction.user?.username);
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  return interaction.update(payload);
}

async function handleAutoRolesAdminInteraction(interaction) {
  const customId = String(interaction.customId || '');
  if (!customId.startsWith('admin:autoRoles')) return false;

  try {
    if (customId === 'admin:autoRoles') return updatePanel(interaction);

    if (interaction.isRoleSelectMenu?.()) {
      const roleIds = autoRoles.cleanRoleIds(interaction.values || []);
      if (customId === 'admin:autoRoles:joinRoles') autoRoles.setJoinRoles(interaction.guild.id, roleIds, { actorId: interaction.user.id });
      if (customId === 'admin:autoRoles:botRoles') autoRoles.setBotRoles(interaction.guild.id, roleIds, { actorId: interaction.user.id });
      return updatePanel(interaction);
    }

    if (customId === 'admin:autoRoles:enable') autoRoles.setAutoRolesEnabled(interaction.guild.id, true, { actorId: interaction.user.id });
    if (customId === 'admin:autoRoles:disable') autoRoles.setAutoRolesEnabled(interaction.guild.id, false, { actorId: interaction.user.id });
    if (customId === 'admin:autoRoles:toggleBots') {
      const config = autoRoles.getAutoRolesSection(interaction.guild.id);
      autoRoles.updateSettings(interaction.guild.id, { applyToBots: !config.settings.applyToBots }, { actorId: interaction.user.id });
    }
    if (customId === 'admin:autoRoles:toggleReapply') {
      const config = autoRoles.getAutoRolesSection(interaction.guild.id);
      autoRoles.updateSettings(interaction.guild.id, { reapplyOnStartup: !config.settings.reapplyOnStartup }, { actorId: interaction.user.id });
    }
    if (customId === 'admin:autoRoles:repair') {
      await interaction.deferUpdate();
      await autoRoles.repairConfiguration(interaction.guild, { actorId: interaction.user.id });
      return updatePanel(interaction);
    }
    if (customId === 'admin:autoRoles:reapply') {
      await interaction.deferUpdate();
      await autoRoles.reapplyToGuild(interaction.guild, { reason: `Manual reapply by ${interaction.user.tag}` });
      return updatePanel(interaction);
    }
    if (customId === 'admin:autoRoles:reset') {
      await interaction.deferUpdate();
      autoRoles.resetAutoRoles(interaction.guild.id, { actorId: interaction.user.id });
      return updatePanel(interaction);
    }
    if (customId === 'admin:autoRoles:export') {
      const attachment = new AttachmentBuilder(
        Buffer.from(JSON.stringify(autoRoles.exportConfiguration(interaction.guild.id), null, 2), 'utf8'),
        { name: `goliath-auto-roles-${interaction.guild.id}.json` }
      );
      await interaction.reply({ content: '📤 Auto Roles configuration export.', files: [attachment], ephemeral: true });
      return true;
    }

    return updatePanel(interaction);
  } catch (error) {
    const payload = { content: `❌ Auto Roles setup failed: ${error.message}`, ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => null);
    else await interaction.reply(payload).catch(() => null);
    return true;
  }
}

module.exports = {
  buildAutoRolesAdminPanel,
  handleAutoRolesAdminInteraction,
};