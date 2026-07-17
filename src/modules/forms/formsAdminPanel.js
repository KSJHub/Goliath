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

const formsStore = require('./formsStore');
const formsManager = require('./formsManager');

function row(...components) {
  return new ActionRowBuilder().addComponents(...components);
}

function button(customId, label, style = ButtonStyle.Primary) {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
}

function getMemberDisplayName(interaction) {
  return interaction.member?.displayName || interaction.user?.displayName || interaction.user?.username || 'Unknown User';
}

function formatChannel(id) {
  return id ? `<#${id}>` : '`Not set`';
}

function formatRoles(ids = []) {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
  return list.length ? list.map((id) => `<@&${id}>`).join(', ') : '`None`';
}

function buildFormsAdminPanel(guild, memberDisplayName = 'Unknown User') {
  const section = formsStore.getSection(guild.id);
  const forms = Object.values(section.forms || {});
  const submissions = Object.values(section.submissions || {});
  const pending = submissions.filter((submission) => submission.status === 'pending').length;

  const embed = new EmbedBuilder()
    .setColor(section.enabled !== false ? 0x57f287 : 0x5865f2)
    .setTitle('📝 Forms')
    .setDescription([
      'Configure form deployment, logging and review behaviour.',
      '',
      `**Status:** ${section.enabled !== false ? 'Enabled ✅' : 'Disabled ❌'}`,
      `**Submit Channel:** ${formatChannel(section.submitChannelId)}`,
      `**Log Channel:** ${formatChannel(section.logChannelId)}`,
      `**Manager Roles:** ${formatRoles(section.managerRoleIds)}`,
      `**Require Review:** ${section.requireReview !== false ? 'Yes ✅' : 'No ❌'}`,
      `**Anonymous:** ${section.anonymousSubmissions ? 'Yes ✅' : 'No ❌'}`,
      `**Store Responses:** ${section.storeResponses !== false ? 'Yes ✅' : 'No ❌'}`,
      '',
      `Forms: \`${forms.length}\` | Submissions: \`${submissions.length}\` | Pending: \`${pending}\``,
      `Submitted: \`${section.analytics.submitted}\` | Approved: \`${section.analytics.approved}\` | Denied: \`${section.analytics.denied}\``,
    ].join('\n'))
    .setFooter({ text: `Requested by ${memberDisplayName}` })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      row(
        new ChannelSelectMenuBuilder().setCustomId('admin:forms:submitChannel').setPlaceholder('Submit channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)
      ),
      row(
        new ChannelSelectMenuBuilder().setCustomId('admin:forms:logChannel').setPlaceholder('Log/review channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)
      ),
      row(
        new RoleSelectMenuBuilder().setCustomId('admin:forms:managerRoles').setPlaceholder('Manager roles').setMinValues(0).setMaxValues(10)
      ),
      row(
        button('admin:forms:deployDefault', '🚀 Deploy Form', ButtonStyle.Success),
        button(section.enabled !== false ? 'admin:forms:disable' : 'admin:forms:enable', section.enabled !== false ? '⏸️ Disable' : '▶️ Enable', ButtonStyle.Secondary),
        button('admin:forms:toggleReview', '🔎 Review', ButtonStyle.Secondary),
        button('admin:forms:toggleAnonymous', '👤 Anonymous', ButtonStyle.Secondary),
        button('admin:forms:toggleStore', '💾 Store', ButtonStyle.Secondary)
      ),
      row(button('admin:modules', '⬅️ Modules', ButtonStyle.Secondary)),
    ],
  };
}

function save(guild, updater) {
  return formsStore.updateSection(guild.id, updater, guild);
}

async function safeUpdate(interaction, payload) {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload);
    return true;
  }
  await interaction.update(payload);
  return true;
}

async function handleFormsAdminInteraction(interaction) {
  const customId = String(interaction.customId || '');
  if (!customId.startsWith('admin:forms')) return false;

  const memberDisplayName = getMemberDisplayName(interaction);

  try {
    if (customId === 'admin:forms') {
      return safeUpdate(interaction, buildFormsAdminPanel(interaction.guild, memberDisplayName));
    }

    if (interaction.isChannelSelectMenu?.()) {
      const value = interaction.values?.[0] || null;
      const prop = customId.split(':')[2];
      if (prop === 'submitChannel') save(interaction.guild, (section) => ({ ...section, submitChannelId: value }));
      if (prop === 'logChannel') save(interaction.guild, (section) => ({ ...section, logChannelId: value }));
      return safeUpdate(interaction, buildFormsAdminPanel(interaction.guild, memberDisplayName));
    }

    if (interaction.isRoleSelectMenu?.() && customId === 'admin:forms:managerRoles') {
      save(interaction.guild, (section) => ({ ...section, managerRoleIds: [...new Set(interaction.values || [])] }));
      return safeUpdate(interaction, buildFormsAdminPanel(interaction.guild, memberDisplayName));
    }

    if (customId === 'admin:forms:enable') save(interaction.guild, (section) => ({ ...section, enabled: true }));
    if (customId === 'admin:forms:disable') save(interaction.guild, (section) => ({ ...section, enabled: false }));
    if (customId === 'admin:forms:toggleReview') save(interaction.guild, (section) => ({ ...section, requireReview: !section.requireReview }));
    if (customId === 'admin:forms:toggleAnonymous') save(interaction.guild, (section) => ({ ...section, anonymousSubmissions: !section.anonymousSubmissions }));
    if (customId === 'admin:forms:toggleStore') save(interaction.guild, (section) => ({ ...section, storeResponses: !section.storeResponses }));

    if (customId === 'admin:forms:deployDefault') {
      await interaction.deferUpdate().catch(() => null);
      await formsManager.deployDefaultForm(interaction.guild, interaction.user.id);
      return safeUpdate(interaction, buildFormsAdminPanel(interaction.guild, memberDisplayName));
    }

    return safeUpdate(interaction, buildFormsAdminPanel(interaction.guild, memberDisplayName));
  } catch (error) {
    const payload = { content: `❌ Forms setup failed: ${error.message}`, flags: 64 };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => null);
    else await interaction.reply(payload).catch(() => null);
    return true;
  }
}

module.exports = {
  buildFormsAdminPanel,
  handleFormsAdminInteraction,
};
