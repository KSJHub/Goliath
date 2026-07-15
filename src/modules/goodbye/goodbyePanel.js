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
const goodbye = require('./goodbye');
const embedTemplateManager = require('../embed/embedTemplateManager');

const selections = new Map();
const row = (...components) => new ActionRowBuilder().addComponents(...components);
const button = (customId, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);

function selectionKey(interactionOrGuild, userId = 'panel') {
  const guildId = interactionOrGuild?.guild?.id || interactionOrGuild?.id;
  const resolvedUserId = interactionOrGuild?.user?.id || userId;
  return `${guildId}:${resolvedUserId}`;
}

function templateTypeLabel(template = {}) {
  const type = String(template.templateType || template.module || 'global');
  return type === 'global' ? 'General' : type.replace(/([a-z])([A-Z])/g, '$1 $2');
}

function getTemplateOptions(guildId) {
  return goodbye.getGoodbyeTemplates(guildId)
    .slice(0, 25)
    .map((template) => ({
      label: String(template.name || template.templateId).slice(0, 100),
      description: `${templateTypeLabel(template)} · ${template.embed?.title || template.panels?.[0]?.title || 'Embed Studio template'}`.slice(0, 100),
      value: String(template.templateId),
    }));
}

function templateMenu(guild, activeTemplateId, userId) {
  const options = getTemplateOptions(guild.id);
  const selected = selections.get(`${guild.id}:${userId}`) || activeTemplateId || null;
  const menu = new StringSelectMenuBuilder()
    .setCustomId('admin:goodbye:template')
    .setPlaceholder(options.length ? 'Choose an Embed Studio template' : 'No templates available')
    .setMinValues(1)
    .setMaxValues(1)
    .setDisabled(options.length === 0);

  if (options.length) {
    menu.addOptions(options.map((option) => ({
      ...option,
      default: option.value === selected,
    })));
  } else {
    menu.addOptions({ label: 'No templates found', value: 'none' });
  }
  return menu;
}

async function buildGoodbyePanel(guild, memberDisplayName = 'Unknown User', userId = 'panel') {
  const config = goodbye.getGoodbyeSection(guild.id);
  const health = await goodbye.buildHealthReport(guild);
  const analytics = config.analytics || {};
  const binding = goodbye.getGoodbyeBinding(guild.id);
  const activeTemplateId = binding?.templateId || config.templateId;
  const activeTemplate = binding || embedTemplateManager.getTemplate(guild.id, activeTemplateId);
  const stagedTemplateId = selections.get(`${guild.id}:${userId}`);
  const stagedTemplate = stagedTemplateId ? embedTemplateManager.getTemplate(guild.id, stagedTemplateId) : null;

  const embed = new EmbedBuilder()
    .setColor(health.healthy ? 0x57f287 : 0xfaa61a)
    .setTitle('👋 Goodbye · Setup')
    .setDescription([
      `**Status:** ${config.enabled ? 'Enabled ✅' : 'Disabled ❌'}`,
      `**Goodbye Channel:** ${config.channelId ? `<#${config.channelId}>` : '`Not set`'}`,
      `**Members:** ${config.ignoreBots ? 'Humans only' : 'Humans + bots'}`,
      '',
      '**📨 Current Goodbye Message**',
      `**Name:** ${activeTemplate ? `\`${activeTemplate.name || activeTemplate.templateId}\`` : '`Not set`'}`,
      `**Template:** ${activeTemplate ? `\`${activeTemplate.templateId}\`` : '`Not set`'}`,
      `**Assignment:** ${binding ? 'Assigned ✅' : 'Ready to assign'}`,
      '**Source:** Embed Studio',
      stagedTemplate ? `**Selected:** \`${stagedTemplate.name || stagedTemplate.templateId}\` · press **Assign**` : null,
      '',
      `Sent: \`${analytics.sent || 0}\` | Failed: \`${analytics.failed || 0}\` | Skipped: \`${analytics.skipped || 0}\``,
      '',
      health.warnings.length ? `**Warnings**\n${health.warnings.map((warning) => `• ${warning}`).join('\n')}` : '**Health:** Healthy ✅',
    ].filter(Boolean).join('\n').slice(0, 4096))
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
      row(templateMenu(guild, activeTemplateId, userId)),
      row(
        button(config.enabled ? 'admin:goodbye:disable' : 'admin:goodbye:enable', config.enabled ? '⏸ Disable' : '▶ Enable', config.enabled ? ButtonStyle.Secondary : ButtonStyle.Success),
        button('admin:goodbye:toggleBots', config.ignoreBots ? '🤖 Include' : '🤖 Exclude')
      ),
      row(
        button('admin:goodbye:assign', '✅ Assign', ButtonStyle.Primary),
        button('admin:goodbye:test', '🧪 Test', ButtonStyle.Success),
        button('admin:goodbye:send', '📨 Send', ButtonStyle.Success),
        button('admin:goodbye:repair', '🩺 Repair'),
        button('admin:goodbye:reset', '♻ Reset', ButtonStyle.Danger)
      ),
      row(
        button('admin:goodbye:export', '📤 Export'),
        button('admin:modules', '⬅ Modules')
      ),
    ],
  };
}

async function updatePanel(interaction) {
  const payload = await buildGoodbyePanel(
    interaction.guild,
    interaction.member?.displayName || interaction.user?.username,
    interaction.user.id
  );
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
      if (!templateId || templateId === 'none' || !embedTemplateManager.getTemplate(interaction.guild.id, templateId)) {
        throw new Error('Choose a valid Embed Studio template.');
      }
      selections.set(selectionKey(interaction), templateId);
      return updatePanel(interaction);
    }

    if (customId === 'admin:goodbye:assign') {
      const config = goodbye.getGoodbyeSection(interaction.guild.id);
      const existingBinding = goodbye.getGoodbyeBinding(interaction.guild.id);
      const templateId = selections.get(selectionKey(interaction)) || existingBinding?.templateId || config.templateId;
      if (!templateId || !embedTemplateManager.getTemplate(interaction.guild.id, templateId)) {
        throw new Error('Choose a valid template first.');
      }
      goodbye.bindGoodbyeTemplate(interaction.guild.id, templateId, { actorId: interaction.user.id });
      selections.delete(selectionKey(interaction));
      return updatePanel(interaction);
    }

    const config = goodbye.getGoodbyeSection(interaction.guild.id);
    if (customId === 'admin:goodbye:enable') goodbye.updateConfig(interaction.guild.id, { enabled: true }, { actorId: interaction.user.id });
    if (customId === 'admin:goodbye:disable') goodbye.updateConfig(interaction.guild.id, { enabled: false }, { actorId: interaction.user.id });
    if (customId === 'admin:goodbye:toggleBots') goodbye.updateConfig(interaction.guild.id, { ignoreBots: !config.ignoreBots }, { actorId: interaction.user.id });

    if (customId === 'admin:goodbye:test') {
      const payload = await goodbye.buildDiscordPayload(interaction.member, config);
      return interaction.reply({
        ...payload,
        allowedMentions: { parse: [], repliedUser: false },
        ephemeral: true,
      });
    }

    if (customId === 'admin:goodbye:send') {
      if (!config.channelId) throw new Error('Choose a goodbye channel first.');
      const result = await goodbye.sendGoodbye(interaction.member, {
        silent: false,
        force: true,
        previewOnly: true,
      });
      if (!result.sent) throw new Error(result.error || result.reason || 'Goodbye message could not be sent.');
      return interaction.reply({ content: `✅ Goodbye message sent to <#${result.channelId}>.`, ephemeral: true });
    }

    if (customId === 'admin:goodbye:repair') {
      await interaction.deferUpdate();
      await goodbye.repairConfiguration(interaction.guild, { actorId: interaction.user.id });
      return updatePanel(interaction);
    }

    if (customId === 'admin:goodbye:reset') {
      await interaction.deferUpdate();
      selections.delete(selectionKey(interaction));
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