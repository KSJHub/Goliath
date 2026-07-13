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
const welcome = require('../../../modules/welcome');

function row(...components) {
  return new ActionRowBuilder().addComponents(...components);
}

function button(customId, label, style = ButtonStyle.Secondary) {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
}

function templateMenu(guildId, activeTemplateId) {
  const templates = welcome.getWelcomeTemplates(guildId, 'welcome').slice(0, 25);
  const menu = new StringSelectMenuBuilder()
    .setCustomId('admin:welcome:template')
    .setPlaceholder(templates.length ? 'Choose the Embed Studio welcome template' : 'No welcome templates available')
    .setMinValues(1)
    .setMaxValues(1)
    .setDisabled(templates.length === 0);

  if (templates.length) {
    menu.addOptions(templates.map((template) => ({
      label: String(template.name || template.templateId).slice(0, 100),
      description: String(template.embed?.title || template.templateId || 'Welcome template').slice(0, 100),
      value: String(template.templateId),
      default: String(template.templateId) === String(activeTemplateId),
    })));
  } else {
    menu.addOptions({ label: 'No templates found', value: 'none' });
  }
  return menu;
}

async function buildWelcomePanel(guild, memberDisplayName = 'Unknown User') {
  const config = welcome.getWelcomeSection(guild.id);
  const health = await welcome.buildHealthReport(guild);
  const analytics = config.analytics || {};
  const binding = welcome.getWelcomeBinding(guild.id, 'welcome');
  const activeTemplateId = binding?.templateId || config.templateId;
  const activeTemplateName = binding?.name || health.templateName || activeTemplateId;

  const embed = new EmbedBuilder()
    .setColor(health.healthy ? 0x57f287 : 0xfaa61a)
    .setTitle('👋 Welcome · Setup')
    .setDescription([
      `**Status:** ${config.enabled ? 'Enabled ✅' : 'Disabled ❌'}`,
      `**Welcome Channel:** ${config.channelId ? `<#${config.channelId}>` : '`Not set`'}`,
      `**Welcome DM:** ${config.dmEnabled ? 'Enabled ✅' : 'Disabled ❌'}`,
      `**Ping New Member:** ${config.allowUserPing ? 'Yes ✅' : 'No ❌'}`,
      `**Ignore Bots:** ${config.ignoreBots ? 'Yes ✅' : 'No ❌'}`,
      `**Active Template:** ${activeTemplateName ? `\`${activeTemplateName}\`` : '`Not set`'}`,
      `**Embed Studio Binding:** ${binding ? 'Bound ✅' : 'Fallback only ⚠️'}`,
      '',
      `Public sent: \`${analytics.publicSent || 0}\` | DMs sent: \`${analytics.dmSent || 0}\` | Failed: \`${(analytics.publicFailed || 0) + (analytics.dmFailed || 0)}\``,
      '',
      health.warnings.length ? `**Warnings**\n${health.warnings.map((warning) => `• ${warning}`).join('\n')}` : '**Health:** Healthy ✅',
    ].join('\n').slice(0, 4096))
    .setFooter({ text: `Requested by ${memberDisplayName}` })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      row(new ChannelSelectMenuBuilder()
        .setCustomId('admin:welcome:channel')
        .setPlaceholder('Select the public welcome channel')
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(0)
        .setMaxValues(1)),
      row(templateMenu(guild.id, activeTemplateId)),
      row(
        button(config.enabled ? 'admin:welcome:disable' : 'admin:welcome:enable', config.enabled ? '⏸️ Disable' : '▶️ Enable', config.enabled ? ButtonStyle.Secondary : ButtonStyle.Success),
        button('admin:welcome:toggleDm', config.dmEnabled ? '📨 Disable DM' : '📨 Enable DM'),
        button('admin:welcome:togglePing', config.allowUserPing ? '🔕 Disable Ping' : '🔔 Enable Ping'),
        button('admin:welcome:toggleBots', config.ignoreBots ? '🤖 Include Bots' : '🤖 Ignore Bots')
      ),
      row(
        button('admin:welcome:test', '👁️ Preview', ButtonStyle.Success),
        button('admin:welcome:repair', '🩺 Repair', ButtonStyle.Primary),
        button('admin:welcome:export', '📤 Export'),
        button('admin:welcome:reset', '♻️ Reset', ButtonStyle.Danger),
        button('admin:modules', '⬅️ Modules')
      ),
    ],
  };
}

async function updatePanel(interaction) {
  const payload = await buildWelcomePanel(interaction.guild, interaction.member?.displayName || interaction.user?.username);
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  return interaction.update(payload);
}

async function handleWelcomeInteraction(interaction) {
  const customId = String(interaction.customId || '');
  if (!customId.startsWith('admin:welcome')) return false;

  try {
    if (customId === 'admin:welcome') return updatePanel(interaction);

    if (interaction.isChannelSelectMenu?.() && customId === 'admin:welcome:channel') {
      welcome.updateConfig(interaction.guild.id, { channelId: interaction.values?.[0] || null }, { actorId: interaction.user.id });
      return updatePanel(interaction);
    }

    if (interaction.isStringSelectMenu?.() && customId === 'admin:welcome:template') {
      const templateId = interaction.values?.[0];
      if (!templateId || templateId === 'none') throw new Error('Choose a valid Embed Studio template.');
      welcome.bindWelcomeTemplate(interaction.guild.id, templateId, 'welcome', { actorId: interaction.user.id });
      return updatePanel(interaction);
    }

    const config = welcome.getWelcomeSection(interaction.guild.id);
    if (customId === 'admin:welcome:enable') welcome.updateConfig(interaction.guild.id, { enabled: true }, { actorId: interaction.user.id });
    if (customId === 'admin:welcome:disable') welcome.updateConfig(interaction.guild.id, { enabled: false }, { actorId: interaction.user.id });
    if (customId === 'admin:welcome:toggleDm') welcome.updateConfig(interaction.guild.id, { dmEnabled: !config.dmEnabled }, { actorId: interaction.user.id });
    if (customId === 'admin:welcome:togglePing') welcome.updateConfig(interaction.guild.id, { allowUserPing: !config.allowUserPing }, { actorId: interaction.user.id });
    if (customId === 'admin:welcome:toggleBots') welcome.updateConfig(interaction.guild.id, { ignoreBots: !config.ignoreBots }, { actorId: interaction.user.id });

    if (customId === 'admin:welcome:test') {
      await interaction.deferUpdate();
      const current = welcome.getWelcomeSection(interaction.guild.id);
      if (!current.channelId && !current.dmEnabled) throw new Error('Select a welcome channel or enable welcome DMs before previewing.');
      await welcome.sendWelcome(interaction.member, { silent: false, force: true, previewOnly: true });
      return updatePanel(interaction);
    }

    if (customId === 'admin:welcome:repair') {
      await interaction.deferUpdate();
      await welcome.repairConfiguration(interaction.guild, { actorId: interaction.user.id });
      return updatePanel(interaction);
    }

    if (customId === 'admin:welcome:reset') {
      await interaction.deferUpdate();
      welcome.resetWelcome(interaction.guild.id, { actorId: interaction.user.id });
      return updatePanel(interaction);
    }

    if (customId === 'admin:welcome:export') {
      const attachment = new AttachmentBuilder(
        Buffer.from(JSON.stringify(welcome.exportConfiguration(interaction.guild.id), null, 2), 'utf8'),
        { name: `goliath-welcome-${interaction.guild.id}.json` }
      );
      await interaction.reply({ content: '📤 Welcome configuration export.', files: [attachment], ephemeral: true });
      return true;
    }

    return updatePanel(interaction);
  } catch (error) {
    const payload = { content: `❌ Welcome setup failed: ${error.message}`, ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => null);
    else await interaction.reply(payload).catch(() => null);
    return true;
  }
}

module.exports = {
  buildWelcomePanel,
  handleWelcomeInteraction,
  buildWelcomeAdminPanel: buildWelcomePanel,
  handleWelcomeAdminInteraction: handleWelcomeInteraction,
};
