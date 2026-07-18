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
const departureDm = require('./goodbyeDepartureDm');
const { buildGoodbyeDmPanel } = require('./goodbyeDmPanel');
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
  return goodbye.getGoodbyeTemplates(guildId).slice(0, 25).map((template) => ({
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
    .setMinValues(1).setMaxValues(1).setDisabled(options.length === 0);
  if (options.length) menu.addOptions(options.map((option) => ({ ...option, default: option.value === selected })));
  else menu.addOptions({ label: 'No templates found', value: 'none' });
  return menu;
}

function channelMenu(config) {
  const menu = new ChannelSelectMenuBuilder()
    .setCustomId('admin:goodbye:channel')
    .setPlaceholder('Select the goodbye log channel')
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(0).setMaxValues(1);
  if (config.channelId) menu.setDefaultChannels(config.channelId);
  return menu;
}

function assertPersistedConfig(guildId, expected = {}) {
  const saved = goodbye.getGoodbyeSection(guildId);
  if (Object.prototype.hasOwnProperty.call(expected, 'channelId') && saved.channelId !== expected.channelId) throw new Error('The goodbye channel did not persist. Please try again.');
  if (Object.prototype.hasOwnProperty.call(expected, 'templateId') && saved.templateId !== expected.templateId) throw new Error('The selected template did not persist. Please try again.');
  return saved;
}

async function buildGoodbyePanel(guild, memberDisplayName = 'Unknown User', userId = 'panel') {
  const config = goodbye.getGoodbyeSection(guild.id);
  const dm = departureDm.getConfig(guild.id);
  const health = await goodbye.buildHealthReport(guild);
  const analytics = config.analytics || {};
  const dmAnalytics = dm.analytics || {};
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
      `**Module:** ${config.enabled ? 'Enabled ✅' : 'Disabled ❌'}`,
      `**Log Channel:** ${config.channelId ? `<#${config.channelId}>` : '`Not set`'}`,
      `**Bots:** ${config.ignoreBots ? 'Excluded' : 'Included'}`,
      '',
      '**📋 Staff Departure Log**',
      `**Template:** ${activeTemplate ? `\`${activeTemplate.name || activeTemplate.templateId}\`` : '`Not set`'}`,
      `**Assignment:** ${binding ? 'Assigned ✅' : 'Using configured template'}`,
      '**Source:** Embed Studio',
      stagedTemplate ? `**Selected:** \`${stagedTemplate.name || stagedTemplate.templateId}\`` : null,
      `Sent: \`${analytics.sent || 0}\` | Failed: \`${analytics.failed || 0}\` | Skipped: \`${analytics.skipped || 0}\``,
      '',
      '**💌 Member Departure DM**',
      `**Status:** ${dm.enabled ? 'Enabled ✅' : 'Disabled ❌'}`,
      `**Events:** Leave ${dm.sendOnLeave ? 'On' : 'Off'} · Kick ${dm.sendOnKick ? 'On' : 'Off'} · Ban ${dm.sendOnBan ? 'On' : 'Off'} · Prune ${dm.sendOnPrune ? 'On' : 'Off'}`,
      `DM Sent: \`${dmAnalytics.sent || 0}\` | Failed: \`${dmAnalytics.failed || 0}\` | Skipped: \`${dmAnalytics.skipped || 0}\``,
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
        button(config.enabled ? 'admin:goodbye:disable' : 'admin:goodbye:enable', config.enabled ? '⏸ Disable Module' : '▶ Enable Module', config.enabled ? ButtonStyle.Secondary : ButtonStyle.Success),
        button('admin:goodbye:toggleBots', config.ignoreBots ? '🤖 Bots Off' : '🤖 Bots On', config.ignoreBots ? ButtonStyle.Secondary : ButtonStyle.Success),
        button('admin:goodbye:dm', '💌 Departure DM', ButtonStyle.Primary),
      ),
      row(
        button('admin:goodbye:assign', '✅ Assign Log Template', ButtonStyle.Primary),
        button('admin:goodbye:test', '🧪 Preview Log', ButtonStyle.Success),
        button('admin:goodbye:send', '📨 Send Log Test', ButtonStyle.Success),
        button('admin:goodbye:repair', '🩺 Repair'),
      ),
      row(
        button('admin:goodbye:reset', '♻ Reset Module', ButtonStyle.Danger),
        button('admin:goodbye:export', '📤 Export'),
        button('admin:modules', '⬅ Modules'),
      ),
    ],
  };
}

async function updatePanel(interaction, payload = null) {
  const nextPayload = payload || await buildGoodbyePanel(interaction.guild, interaction.member?.displayName || interaction.user?.username, interaction.user.id);
  if (interaction.deferred || interaction.replied) return interaction.editReply(nextPayload);
  return interaction.update(nextPayload);
}

function selectedTemplate(interaction) {
  const config = goodbye.getGoodbyeSection(interaction.guild.id);
  const binding = goodbye.getGoodbyeBinding(interaction.guild.id);
  const candidates = [selections.get(selectionKey(interaction)), config.templateId, binding?.templateId].filter(Boolean);
  for (const templateId of candidates) if (embedTemplateManager.getTemplate(interaction.guild.id, templateId)) return templateId;
  throw new Error('Choose a valid Embed Studio template from the dropdown first.');
}

async function handleGoodbyeInteraction(interaction) {
  const customId = String(interaction.customId || '');
  if (!customId.startsWith('admin:goodbye')) return false;

  try {
    if (customId === 'admin:goodbye') return updatePanel(interaction);
    if (customId === 'admin:goodbye:dm') {
      return updatePanel(interaction, buildGoodbyeDmPanel(interaction.guild, interaction.member?.displayName || interaction.user?.username));
    }

    if (interaction.isChannelSelectMenu?.() && customId === 'admin:goodbye:channel') {
      const channelId = interaction.values?.[0] || null;
      goodbye.updateConfig(interaction.guild.id, { channelId }, { actorId: interaction.user.id, action: 'goodbye_channel_select' });
      assertPersistedConfig(interaction.guild.id, { channelId });
      return updatePanel(interaction);
    }

    if (interaction.isStringSelectMenu?.() && customId === 'admin:goodbye:template') {
      const templateId = interaction.values?.[0];
      if (!templateId || templateId === 'none' || !embedTemplateManager.getTemplate(interaction.guild.id, templateId)) throw new Error('Choose a valid Embed Studio template.');
      selections.set(selectionKey(interaction), templateId);
      goodbye.updateConfig(interaction.guild.id, { templateId }, { actorId: interaction.user.id, action: 'goodbye_template_select' });
      assertPersistedConfig(interaction.guild.id, { templateId });
      return updatePanel(interaction);
    }

    if (customId === 'admin:goodbye:assign') {
      const templateId = selectedTemplate(interaction);
      goodbye.bindGoodbyeTemplate(interaction.guild.id, templateId, { actorId: interaction.user.id });
      const binding = goodbye.getGoodbyeBinding(interaction.guild.id);
      if (!binding || binding.templateId !== templateId) throw new Error('The Embed Studio template binding did not persist.');
      assertPersistedConfig(interaction.guild.id, { templateId });
      selections.delete(selectionKey(interaction));
      return updatePanel(interaction);
    }

    const config = goodbye.getGoodbyeSection(interaction.guild.id);
    const dm = departureDm.getConfig(interaction.guild.id);
    const actor = { actorId: interaction.user.id };
    const simpleModulePatch = {
      'admin:goodbye:enable': { enabled: true },
      'admin:goodbye:disable': { enabled: false },
      'admin:goodbye:toggleBots': { ignoreBots: !config.ignoreBots },
    }[customId];
    if (simpleModulePatch) {
      goodbye.updateConfig(interaction.guild.id, simpleModulePatch, actor);
      return updatePanel(interaction);
    }

    const dmPatch = {
      'admin:goodbye:dm:enable': { enabled: true },
      'admin:goodbye:dm:disable': { enabled: false },
      'admin:goodbye:dm:leave': { sendOnLeave: !dm.sendOnLeave },
      'admin:goodbye:dm:kick': { sendOnKick: !dm.sendOnKick },
      'admin:goodbye:dm:ban': { sendOnBan: !dm.sendOnBan },
      'admin:goodbye:dm:prune': { sendOnPrune: !dm.sendOnPrune },
      'admin:goodbye:dm:joined': { includeJoinDate: !dm.includeJoinDate },
      'admin:goodbye:dm:duration': { includeMembershipDuration: !dm.includeMembershipDuration },
      'admin:goodbye:dm:reason': { includeReason: !dm.includeReason },
      'admin:goodbye:dm:moderator': { includeModerator: !dm.includeModerator },
      'admin:goodbye:dm:appeal': { includeAppealLink: !dm.includeAppealLink },
      'admin:goodbye:dm:reference': { includeReferenceId: !dm.includeReferenceId },
    }[customId];
    if (dmPatch) {
      departureDm.updateConfig(interaction.guild.id, dmPatch, actor);
      return updatePanel(interaction, buildGoodbyeDmPanel(interaction.guild, interaction.member?.displayName || interaction.user?.username));
    }

    if (customId === 'admin:goodbye:test') {
      const payload = await goodbye.buildDiscordPayload(interaction.member, goodbye.getGoodbyeSection(interaction.guild.id), { includeComponents: false });
      return interaction.reply({ ...payload, ephemeral: true });
    }

    if (customId === 'admin:goodbye:send') {
      const latestConfig = goodbye.getGoodbyeSection(interaction.guild.id);
      if (!latestConfig.channelId) throw new Error('Choose a goodbye channel first.');
      const result = await goodbye.sendGoodbye(interaction.member, { silent: false, force: true, previewOnly: true });
      return interaction.reply({ content: result.sent ? `✅ Goodbye log sent to <#${result.channelId}>.` : `❌ Goodbye log failed: ${result.reason || result.error || 'unknown error'}`, ephemeral: true });
    }

    if (customId === 'admin:goodbye:dm:preview') {
      const embed = departureDm.buildDmEmbed(interaction.member, { key: 'left' });
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (customId === 'admin:goodbye:dm:test') {
      const result = await departureDm.sendDepartureDm(interaction.member, { key: 'left' }, { force: true });
      return interaction.reply({ content: result.sent ? '✅ Departure DM sent to you.' : `❌ Departure DM failed: ${result.error || result.reason || 'unknown error'}`, ephemeral: true });
    }

    if (customId === 'admin:goodbye:repair') {
      await interaction.deferUpdate();
      await goodbye.repairConfiguration(interaction.guild, actor);
      return updatePanel(interaction);
    }

    if (customId === 'admin:goodbye:dm:reset') {
      await interaction.deferUpdate();
      departureDm.resetConfig(interaction.guild.id, actor);
      return updatePanel(interaction, buildGoodbyeDmPanel(interaction.guild, interaction.member?.displayName || interaction.user?.username));
    }

    if (customId === 'admin:goodbye:reset') {
      await interaction.deferUpdate();
      selections.delete(selectionKey(interaction));
      goodbye.resetGoodbye(interaction.guild.id, actor);
      return updatePanel(interaction);
    }

    if (customId === 'admin:goodbye:export') {
      const attachment = new AttachmentBuilder(Buffer.from(JSON.stringify(goodbye.exportConfiguration(interaction.guild.id), null, 2), 'utf8'), { name: `goliath-goodbye-${interaction.guild.id}.json` });
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
