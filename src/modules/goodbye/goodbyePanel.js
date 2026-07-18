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
    menu.addOptions(options.map((option) => ({ ...option, default: option.value === selected })));
  } else {
    menu.addOptions({ label: 'No templates found', value: 'none' });
  }
  return menu;
}

function channelMenu(config) {
  const menu = new ChannelSelectMenuBuilder()
    .setCustomId('admin:goodbye:channel')
    .setPlaceholder('Select the goodbye channel')
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(0)
    .setMaxValues(1);

  if (config.channelId) menu.setDefaultChannels(config.channelId);
  return menu;
}

function assertPersistedConfig(guildId, expected = {}) {
  const saved = goodbye.getGoodbyeSection(guildId);
  if (Object.prototype.hasOwnProperty.call(expected, 'channelId') && saved.channelId !== expected.channelId) {
    throw new Error('The goodbye channel did not persist. Please try again.');
  }
  if (Object.prototype.hasOwnProperty.call(expected, 'templateId') && saved.templateId !== expected.templateId) {
    throw new Error('The selected template did not persist. Please try again.');
  }
  return saved;
}

async function buildGoodbyePanel(guild, memberDisplayName = 'Unknown User', userId = 'panel') {
  const config = goodbye.getGoodbyeSection(guild.id);
  const health = await goodbye.buildHealthReport(guild);
  const analytics = config.analytics || {};
  const binding = goodbye.getGoodbyeBinding(guild.id);
  const activeTemplate = goodbye.getAssignedTemplate(guild.id, config);
  const activeTemplateId = activeTemplate?.templateId || config.templateId;
  const stagedTemplateId = selections.get(`${guild.id}:${userId}`);
  const stagedTemplate = stagedTemplateId ? embedTemplateManager.getTemplate(guild.id, stagedTemplateId) : null;
  const warnings = health.warnings || [];

  const embed = new EmbedBuilder()
    .setColor(warnings.length ? 0xfaa61a : 0x57f287)
    .setTitle('👋 Goodbye · Setup')
    .setDescription([
      `**Status:** ${config.enabled ? 'Enabled ✅' : 'Disabled ❌'}`,
      `**Channel:** ${config.channelId ? `<#${config.channelId}>` : '`Not set`'}`,
      `**Bots:** ${config.ignoreBots ? 'Excluded' : 'Included'}`,
      '',
      '**📨 Goodbye Message**',
      `**Template:** ${activeTemplate ? `\`${activeTemplate.name || activeTemplate.templateId}\`` : '`Not set`'}`,
      `**Assignment:** ${binding ? 'Assigned ✅' : 'Using configured template'}`,
      '**Source:** Embed Studio',
      stagedTemplate ? `**Selected:** \`${stagedTemplate.name || stagedTemplate.templateId}\`` : null,
      '',
      `Sent: \`${analytics.sent || 0}\` | Failed: \`${analytics.failed || 0}\` | Skipped: \`${analytics.skipped || 0}\``,
      '',
      warnings.length ? `**Warnings**\n${warnings.map((warning) => `• ${warning}`).join('\n')}` : '**Health:** Healthy ✅',
    ].filter(Boolean).join('\n').slice(0, 4096))
    .setFooter({ text: `Requested by ${memberDisplayName}` })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      row(channelMenu(config)),
      row(templateMenu(guild, activeTemplateId, userId)),
      row(
        button(config.enabled ? 'admin:goodbye:disable' : 'admin:goodbye:enable', config.enabled ? '⏸ Disable' : '▶ Enable', config.enabled ? ButtonStyle.Secondary : ButtonStyle.Success),
        button('admin:goodbye:toggleBots', config.ignoreBots ? '🤖 Bots Off' : '🤖 Bots On', config.ignoreBots ? ButtonStyle.Secondary : ButtonStyle.Success)
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

function selectedTemplate(interaction) {
  const config = goodbye.getGoodbyeSection(interaction.guild.id);
  const binding = goodbye.getGoodbyeBinding(interaction.guild.id);
  const candidates = [
    selections.get(selectionKey(interaction)),
    config.templateId,
    binding?.templateId,
  ].filter(Boolean);

  for (const templateId of candidates) {
    if (embedTemplateManager.getTemplate(interaction.guild.id, templateId)) return templateId;
  }

  throw new Error('Choose a valid Embed Studio template from the dropdown first.');
}

async function handleGoodbyeInteraction(interaction) {
  const customId = String(interaction.customId || '');
  if (!customId.startsWith('admin:goodbye')) return false;

  try {
    if (customId === 'admin:goodbye') return updatePanel(interaction);

    if (interaction.isChannelSelectMenu?.() && customId === 'admin:goodbye:channel') {
      const channelId = interaction.values?.[0] || null;
      goodbye.updateConfig(interaction.guild.id, { channelId }, { actorId: interaction.user.id, action: 'goodbye_channel_select' });
      assertPersistedConfig(interaction.guild.id, { channelId });
      return updatePanel(interaction);
    }

    if (interaction.isStringSelectMenu?.() && customId === 'admin:goodbye:template') {
      const templateId = interaction.values?.[0];
      if (!templateId || templateId === 'none' || !embedTemplateManager.getTemplate(interaction.guild.id, templateId)) {
        throw new Error('Choose a valid Embed Studio template.');
      }
      selections.set(selectionKey(interaction), templateId);
      goodbye.updateConfig(interaction.guild.id, { templateId }, { actorId: interaction.user.id, action: 'goodbye_template_select' });
      assertPersistedConfig(interaction.guild.id, { templateId });
      return updatePanel(interaction);
    }

    if (customId === 'admin:goodbye:assign') {
      const templateId = selectedTemplate(interaction);
      goodbye.bindGoodbyeTemplate(interaction.guild.id, templateId, { actorId: interaction.user.id });
      const binding = goodbye.getGoodbyeBinding(interaction.guild.id);
      if (!binding || binding.templateId !== templateId) {
        throw new Error('The Embed Studio template binding did not persist.');
      }
      assertPersistedConfig(interaction.guild.id, { templateId });
      selections.delete(selectionKey(interaction));
      return updatePanel(interaction);
    }

    const config = goodbye.getGoodbyeSection(interaction.guild.id);
    if (customId === 'admin:goodbye:enable') goodbye.updateConfig(interaction.guild.id, { enabled: true }, { actorId: interaction.user.id });
    if (customId === 'admin:goodbye:disable') goodbye.updateConfig(interaction.guild.id, { enabled: false }, { actorId: interaction.user.id });
    if (customId === 'admin:goodbye:toggleBots') goodbye.updateConfig(interaction.guild.id, { ignoreBots: !config.ignoreBots }, { actorId: interaction.user.id });

    if (['admin:goodbye:enable', 'admin:goodbye:disable', 'admin:goodbye:toggleBots'].includes(customId)) {
      return updatePanel(interaction);
    }

    if (customId === 'admin:goodbye:test') {
      const payload = await goodbye.buildDiscordPayload(interaction.member, goodbye.getGoodbyeSection(interaction.guild.id), { includeComponents: false });
      return interaction.reply({ ...payload, ephemeral: true });
    }

    if (customId === 'admin:goodbye:send') {
      const latestConfig = goodbye.getGoodbyeSection(interaction.guild.id);
      if (!latestConfig.channelId) throw new Error('Choose a goodbye channel first.');
      const result = await goodbye.sendGoodbye(interaction.member, {
        silent: false,
        force: true,
        previewOnly: true,
      });
      const lines = [
        result.sent ? `✅ Goodbye message sent to <#${result.channelId}>.` : null,
        result.failed ? '❌ Goodbye message failed.' : null,
        result.skipped ? `⚠️ Nothing was sent: ${result.reason || 'skipped'}.` : null,
        ...(result.errors || []).map((error) => `• ${error}`),
      ].filter(Boolean);
      return interaction.reply({ content: lines.join('\n').slice(0, 2000), ephemeral: true });
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