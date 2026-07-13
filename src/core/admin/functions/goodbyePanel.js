'use strict';

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  StringSelectMenuBuilder,
  ChannelType,
  AttachmentBuilder,
} = require('discord.js');
const goodbye = require('../../../modules/goodbye');

const row = (...components) => new ActionRowBuilder().addComponents(...components);
const button = (customId, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);

function templateMenu(guildId, activeTemplateId) {
  const templates = goodbye.getGoodbyeTemplates(guildId).slice(0, 25);
  const menu = new StringSelectMenuBuilder()
    .setCustomId('admin:goodbye:template')
    .setPlaceholder(templates.length ? 'Choose the Embed Studio goodbye template' : 'No goodbye templates available')
    .setMinValues(1)
    .setMaxValues(1)
    .setDisabled(templates.length === 0);

  if (templates.length) {
    menu.addOptions(templates.map((template) => ({
      label: String(template.name || template.templateId).slice(0, 100),
      description: String(template.embed?.title || template.templateId || 'Goodbye template').slice(0, 100),
      value: String(template.templateId),
      default: String(template.templateId) === String(activeTemplateId),
    })));
  } else {
    menu.addOptions({ label: 'No templates found', value: 'none' });
  }
  return menu;
}

async function buildGoodbyePanel(guild, memberDisplayName = 'Unknown User') {
  const config = goodbye.getGoodbyeSection(guild.id);
  const health = await goodbye.buildHealthReport(guild);
  const analytics = config.analytics || {};
  const binding = goodbye.getGoodbyeBinding(guild.id);
  const activeTemplateId = binding?.templateId || config.templateId;
  const activeTemplateName = binding?.name || health.templateName || activeTemplateId;

  const embed = new EmbedBuilder()
    .setColor(health.healthy ? 0x57f287 : 0xfaa61a)
    .setTitle('👋 Goodbye · Setup')
    .setDescription([
      `**Status:** ${config.enabled ? 'Enabled ✅' : 'Disabled ❌'}`,
      `**Goodbye Channel:** ${config.channelId ? `<#${config.channelId}>` : '`Not set`'}`,
      `**Ignore Bots:** ${config.ignoreBots ? 'Yes ✅' : 'No ❌'}`,
      `**Active Template:** ${activeTemplateName ? `\`${activeTemplateName}\`` : '`Not set`'}`,
      `**Embed Studio Binding:** ${binding ? 'Bound ✅' : 'Fallback only ⚠️'}`,
      '',
      `Sent: \`${analytics.sent || 0}\` | Failed: \`${analytics.failed || 0}\` | Skipped: \`${analytics.skipped || 0}\``,
      '',
      health.warnings.length ? `**Warnings**\n${health.warnings.map((warning) => `• ${warning}`).join('\n')}` : '**Health:** Healthy ✅',
    ].join('\n').slice(0, 4096))
    .setFooter({ text: `Requested by ${memberDisplayName}` })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      row(new ChannelSelectMenuBuilder()
        .setCustomId('admin:goodbye:channel')
        .setPlaceholder('Select the public goodbye channel')
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(0)
        .setMaxValues(1)),
      row(templateMenu(guild.id, activeTemplateId)),
      row(
        button(config.enabled ? 'admin:goodbye:disable' : 'admin:goodbye:enable', config.enabled ? '⏸️ Disable' : '▶️ Enable', config.enabled ? ButtonStyle.Secondary : ButtonStyle.Success),
        button('admin:goodbye:toggleBots', config.ignoreBots ? '🤖 Include Bots' : '🤖 Ignore Bots')
      ),
      row(
        button('admin:goodbye:test', '👁️ Preview', ButtonStyle.Success),
        button('admin:goodbye:repair', '🩺 Repair', ButtonStyle.Primary),
        button('admin:goodbye:export', '📤 Export'),
        button('admin:goodbye:reset', '♻️ Reset', ButtonStyle.Danger),
        button('admin:modules', '⬅️ Modules')
      ),
    ],
  };
}

async function updatePanel(interaction) {
  const payload = await buildGoodbyePanel(interaction.guild, interaction.member?.displayName || interaction.user?.username);
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  return interaction.update(payload);
}

async function handleGoodbyeInteraction(interaction) {
  const customId = String(interaction.customId || '');
  if (!customId.startsWith('admin:goodbye')) return false;

  try {
    if (customId === 'admin:goodbye') return updatePanel(interaction);

    if (interaction.isChannelSelectMenu?.() && customId === 'admin:goodbye:channel') {
      goodbye.updateConfig(interaction.guild.id, { channelId: interaction.values?.[0] || null }, { actorId: interaction.user.id });
      return updatePanel(interaction);
    }

    if (interaction.isStringSelectMenu?.() && customId === 'admin:goodbye:template') {
      const templateId = interaction.values?.[0];
      if (!templateId || templateId === 'none') throw new Error('Choose a valid Embed Studio template.');
      goodbye.bindGoodbyeTemplate(interaction.guild.id, templateId, { actorId: interaction.user.id });
      return updatePanel(interaction);
    }

    const config = goodbye.getGoodbyeSection(interaction.guild.id);
    if (customId === 'admin:goodbye:enable') goodbye.updateConfig(interaction.guild.id, { enabled: true }, { actorId: interaction.user.id });
    if (customId === 'admin:goodbye:disable') goodbye.updateConfig(interaction.guild.id, { enabled: false }, { actorId: interaction.user.id });
    if (customId === 'admin:goodbye:toggleBots') goodbye.updateConfig(interaction.guild.id, { ignoreBots: !config.ignoreBots }, { actorId: interaction.user.id });

    if (customId === 'admin:goodbye:test') {
      await interaction.deferUpdate();
      if (!config.channelId) throw new Error('Select a goodbye channel before previewing.');
      await goodbye.sendGoodbye(interaction.member, { silent: false, force: true, previewOnly: true });
      return updatePanel(interaction);
    }

    if (customId === 'admin:goodbye:repair') {
      await interaction.deferUpdate();
      await goodbye.repairConfiguration(interaction.guild, { actorId: interaction.user.id });
      return updatePanel(interaction);
    }

    if (customId === 'admin:goodbye:reset') {
      await interaction.deferUpdate();
      goodbye.resetGoodbye(interaction.guild.id, { actorId: interaction.user.id });
      return updatePanel(interaction);
    }

    if (customId === 'admin:goodbye:export') {
      const attachment = new AttachmentBuilder(
        Buffer.from(JSON.stringify(goodbye.exportConfiguration(interaction.guild.id), null, 2), 'utf8'),
        { name: `goliath-goodbye-${interaction.guild.id}.json` }
      );
      await interaction.reply({ content: '📤 Goodbye configuration export.', files: [attachment], ephemeral: true });
      return true;
    }

    return updatePanel(interaction);
  } catch (error) {
    const payload = { content: `❌ Goodbye setup failed: ${error.message}`, ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => null);
    else await interaction.reply(payload).catch(() => null);
    return true;
  }
}

module.exports = {
  buildGoodbyePanel,
  handleGoodbyeInteraction,
  buildGoodbyeAdminPanel: buildGoodbyePanel,
  handleGoodbyeAdminInteraction: handleGoodbyeInteraction,
};
