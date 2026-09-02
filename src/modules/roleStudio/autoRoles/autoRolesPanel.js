'use strict';

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
} = require('discord.js');
const security = require('../../../core/security/protection/core');
const { validateRoleSelection } = require('../../../core/security/protection/permissions');
const {
  buildRolePicker,
  buildRolePickerPagination,
  mergeRolePickerSelection,
  parseRolePickerId,
  rolePickerPageCount,
} = require('../../../core/ui/panelNavigation');
const autoRoles = require('./autoRolesService');

function row(...components) {
  return new ActionRowBuilder().addComponents(...components);
}

function button(customId, label, style = ButtonStyle.Secondary) {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
}

function formatRoles(ids = []) {
  return ids.length ? ids.map((id) => `<@&${id}>`).join(', ') : '`None`';
}

async function buildAutoRolesPanel(guild, memberDisplayName = 'Unknown User', rolePage = 0) {
  const config = autoRoles.getAutoRolesSection(guild.id);
  const moduleEnabled = autoRoles.isAutoRolesEnabled(guild.id);
  const health = await autoRoles.buildHealthReport(guild);
  const pageCount = rolePickerPageCount(guild);
  const safePage = Math.min(Math.max(0, Number(rolePage) || 0), pageCount - 1);
  const joinPicker = buildRolePicker(guild, {
    customId: 'admin:autoRoles:joinRoles',
    placeholder: 'Select join roles',
    selectedIds: config.joinRoles,
    minValues: 0,
    maxValues: 10,
    page: safePage,
    pagination: false,
  });
  const botPicker = buildRolePicker(guild, {
    customId: 'admin:autoRoles:botRoles',
    placeholder: 'Select bot roles',
    selectedIds: config.botRoles,
    minValues: 0,
    maxValues: 10,
    page: safePage,
    pagination: false,
  });

  const embed = new EmbedBuilder()
    .setColor(health.healthy ? 0x57f287 : 0xfaa61a)
    .setTitle('👥 Auto Roles · Setup')
    .setDescription([
      `**Status:** ${moduleEnabled ? 'Enabled ✅' : 'Disabled ❌'}`,
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
      joinPicker.rows[0],
      botPicker.rows[0],
      ...(pageCount > 1 ? [buildRolePickerPagination('admin:autoRoles:rolePage', safePage, pageCount)] : []),
      row(
        button(moduleEnabled ? 'admin:autoRoles:disable' : 'admin:autoRoles:enable', moduleEnabled ? '⏸️ Disable' : '▶️ Enable', moduleEnabled ? ButtonStyle.Secondary : ButtonStyle.Success),
        button('admin:autoRoles:toggleBots', '🤖 Apply To Bots'),
        button('admin:autoRoles:toggleReapply', '🔁 Reapply On Startup'),
        button('admin:autoRoles:repair', '🩺 Repair', ButtonStyle.Primary),
        button('admin:autoRoles:reapply', '🚀 Reapply Now', ButtonStyle.Success)
      ),
      row(
        button('admin:autoRoles:export', '📤 Export'),
        button('admin:autoRoles:reset', '♻️ Reset', ButtonStyle.Danger),
        button('admin:reactionRoles', '⬅️ Role Studio')
      ),
    ],
  };
}

async function updatePanel(interaction, rolePage = 0) {
  const payload = await buildAutoRolesPanel(interaction.guild, interaction.member?.displayName || interaction.user?.username, rolePage);
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  return interaction.update(payload);
}

async function handleAutoRolesInteraction(interaction) {
  const customId = String(interaction.customId || '');
  if (!customId.startsWith('admin:autoRoles')) return false;

  try {
    const allowed = await security.enforceInteractionSecurity(interaction, { level: 'admin', guildOnly: true });
    if (!allowed) return true;
    if (customId === 'admin:autoRoles') return updatePanel(interaction);

    const rolePicker = parseRolePickerId(customId);
    if (rolePicker?.baseId === 'admin:autoRoles:rolePage' && rolePicker.kind === 'page') {
      return updatePanel(interaction, rolePicker.page);
    }
    if (rolePicker && ['admin:autoRoles:joinRoles', 'admin:autoRoles:botRoles'].includes(rolePicker.baseId) && rolePicker.kind === 'select') {
      await interaction.deferUpdate();
      const config = autoRoles.getAutoRolesSection(interaction.guild.id);
      const current = rolePicker.baseId.endsWith(':joinRoles') ? config.joinRoles : config.botRoles;
      const roleIds = autoRoles.cleanRoleIds(mergeRolePickerSelection(interaction.guild, current, interaction.values || [], rolePicker.page));
      if (roleIds.length > 10) throw new Error('Auto Roles supports up to 10 roles in each list. Remove a role before adding another.');
      if (roleIds.length) {
        const validation = await validateRoleSelection(interaction.guild, roleIds, { scope: 'auto_roles.discord', requireManageable: true });
        if (!validation.ok) throw validation.toError();
      }
      if (rolePicker.baseId === 'admin:autoRoles:joinRoles') await autoRoles.setConfiguredRoles(interaction.guild, 'join', roleIds, { actorId: interaction.user.id, action: 'auto_roles_discord_join_roles' });
      if (rolePicker.baseId === 'admin:autoRoles:botRoles') await autoRoles.setConfiguredRoles(interaction.guild, 'bot', roleIds, { actorId: interaction.user.id, action: 'auto_roles_discord_bot_roles' });
      return updatePanel(interaction, rolePicker.page);
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
      await autoRoles.withAutoRolesLock(interaction.guild.id, () => autoRoles.resetAutoRoles(interaction.guild.id, { actorId: interaction.user.id }));
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
  buildAutoRolesPanel,
  handleAutoRolesInteraction,
};
