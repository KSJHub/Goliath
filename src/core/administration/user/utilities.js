'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const translationStore = require('../../../modules/utilityStudio/translation/translationStore');
const translation = require('../../../modules/utilityStudio/translation/translation');
const guildManager = require('../../guild/guildManager');
const { canAccessCommand } = require('../../commands/commandAccess');
const { CATEGORY_CATALOG, MODULE_CATALOG: USER_MODULES } = require('./panel');
const { STUDIO_CATALOG, MODULE_CATALOG: ADMIN_MODULES } = require('../admin/modules');

const HIDDEN_HELP_COMMANDS = new Set(['owner', 'commandcenter']);

function backRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('user:home')
      .setLabel('Back to User Panel')
      .setEmoji('⬅️')
      .setStyle(ButtonStyle.Secondary),
  );
}

async function replaceComponent(interaction, payload) {
  const data = { ...payload, components: payload.components || [backRow()] };
  if (interaction.deferred || interaction.replied) return interaction.editReply(data);
  if (typeof interaction.update === 'function' && interaction.isMessageComponent?.()) return interaction.update(data);
  return interaction.reply({ ...data, flags: 64 });
}

function latencyHealth(clientLatency, apiLatency) {
  if (clientLatency < 100 && apiLatency < 100) return '🟢 Excellent';
  if (clientLatency < 200 && apiLatency < 200) return '🟡 Stable';
  if (clientLatency < 400 && apiLatency < 400) return '🟠 Slower than usual';
  return '🔴 Needs attention';
}

function latencyBar(ms) {
  if (ms < 100) return '▰▰▰▰▰';
  if (ms < 200) return '▰▰▰▰▱';
  if (ms < 400) return '▰▰▰▱▱';
  return '▰▰▱▱▱';
}

function formatUptime(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours || days) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
}

async function showPing(interaction) {
  const clientLatency = Math.max(0, Date.now() - interaction.createdTimestamp);
  const apiLatency = Math.max(0, Math.round(Number(interaction.client?.ws?.ping) || 0));
  const health = latencyHealth(clientLatency, apiLatency);
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🏓 Goliath Status')
    .setDescription([
      `**Status:** ${health}`, '', '**Bot Latency**', `\`${clientLatency}ms\``, latencyBar(clientLatency),
      '', '**Discord API**', `\`${apiLatency}ms\``, latencyBar(apiLatency), '', '**Uptime**',
      `\`${formatUptime(process.uptime())}\``,
    ].join('\n'))
    .setTimestamp();
  return replaceComponent(interaction, { embeds: [embed] });
}

async function showServerInfo(interaction) {
  const guild = interaction.guild;
  if (!guild) return interaction.reply({ content: 'This panel can only be used inside a server.', flags: 64 });
  await guild.members.fetch().catch(() => null);
  const owner = await guild.fetchOwner().catch(() => null);
  const textChannels = guild.channels.cache.filter((channel) => channel.type === ChannelType.GuildText).size;
  const voiceChannels = guild.channels.cache.filter((channel) => channel.type === ChannelType.GuildVoice).size;
  const categories = guild.channels.cache.filter((channel) => channel.type === ChannelType.GuildCategory).size;
  const humans = guild.members.cache.filter((member) => !member.user.bot).size;
  const bots = guild.members.cache.filter((member) => member.user.bot).size;
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🏰 Server Overview')
    .setThumbnail(guild.iconURL({ size: 256 }))
    .setDescription([
      `**${guild.name}**`, '', `**Owner:** ${owner ? `<@${owner.id}>` : 'Unknown'}`,
      `**Server ID:** \`${guild.id}\``, `**Created:** <t:${Math.floor(guild.createdTimestamp / 1000)}:F>`,
      '', '**Members**', `Total: \`${guild.memberCount}\` • Humans: \`${humans}\` • Bots: \`${bots}\``,
      '', '**Channels**', `Text: \`${textChannels}\` • Voice: \`${voiceChannels}\` • Categories: \`${categories}\``,
      '', `**Roles:** \`${guild.roles.cache.size}\``,
    ].join('\n'))
    .setTimestamp();
  return replaceComponent(interaction, { embeds: [embed] });
}

function visibleCommands(interaction) {
  return [...(interaction.client?.commands?.values?.() || [])]
    .filter((command) => {
      const name = String(command?.data?.name || '').trim();
      if (!name || HIDDEN_HELP_COMMANDS.has(name.toLowerCase())) return false;
      const json = command.data?.toJSON?.() || {};
      if (json.type && json.type !== 1) return false;
      return canAccessCommand(interaction, command);
    })
    .sort((a, b) => String(a.data.name).localeCompare(String(b.data.name)));
}

function userFeatureLines() {
  const live = USER_MODULES.filter((module) => ['live', 'approved'].includes(module.status));
  return CATEGORY_CATALOG.map((category) => {
    const modules = live.filter((module) => module.category === category.key);
    if (!modules.length) return null;
    return `${category.emoji} **${category.label}** — ${modules.map((module) => module.label).join(', ')}`;
  }).filter(Boolean);
}

function adminFeatureLines(interaction, commands) {
  if (!commands.some((command) => command.data.name === 'admin')) return [];
  return STUDIO_CATALOG.map((studio) => {
    const modules = ADMIN_MODULES.filter((module) => module.studio === studio.key);
    if (!modules.length) return null;
    return `${studio.label} — ${modules.map((module) => module.label.replace(/^\S+\s*/, '')).join(', ')}`;
  }).filter(Boolean);
}

async function showHelp(interaction, options = {}) {
  const commands = visibleCommands(interaction);
  const commandLines = commands.map((command) => {
    const help = command.help || {};
    return `**/${command.data.name}** — ${help.description || command.data.description || 'Open Goliath'}`;
  });
  const features = userFeatureLines();
  const adminFeatures = adminFeatureLines(interaction, commands);
  const description = [
    'Need help finding something? Here’s what Goliath can do.',
    '',
    '**Commands**',
    ...(commandLines.length ? commandLines : ['**/user** — Open your Goliath user panel.']),
    '',
    '**Features**',
    ...features,
    ...(adminFeatures.length ? ['', '**Server Tools**', ...adminFeatures] : []),
  ].join('\n').slice(0, 4096);

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('❓ Goliath Help')
    .setDescription(description)
    .setFooter({ text: 'Goliath Help' })
    .setTimestamp();

  if (options.standalone) {
    const payload = { embeds: [embed], flags: 64 };
    if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
    return interaction.reply(payload);
  }
  return replaceComponent(interaction, { embeds: [embed] });
}

function buildTranslateModal(interaction) {
  const config = translationStore.getTranslationSection(interaction.guildId);
  return new ModalBuilder()
    .setCustomId('user:utility:translate:submit')
    .setTitle('Translate Text')
    .addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('text').setLabel('Text to translate').setStyle(TextInputStyle.Paragraph).setMaxLength(1500).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('target').setLabel('Target language code').setPlaceholder('en, es, de, fr').setStyle(TextInputStyle.Short).setMaxLength(20).setRequired(false).setValue(String(config.settings?.defaultTargetLanguage || 'en').slice(0, 20))),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('source').setLabel('Source language code').setPlaceholder('auto').setStyle(TextInputStyle.Short).setMaxLength(20).setRequired(false).setValue(String(config.settings?.defaultSourceLanguage || 'auto').slice(0, 20))),
    );
}

async function showTranslate(interaction) {
  if (!guildManager.isModuleEnabled(interaction.guildId, 'translation')) {
    return replaceComponent(interaction, { embeds: [new EmbedBuilder().setColor(0xFEE75C).setTitle('🌐 Translation Unavailable').setDescription('Translation is not enabled for this server. An administrator can enable it from the Admin panel.')] });
  }
  await interaction.showModal(buildTranslateModal(interaction));
  return true;
}

async function submitTranslate(interaction) {
  if (interaction.customId !== 'user:utility:translate:submit' || !interaction.isModalSubmit?.()) return false;
  if (!guildManager.isModuleEnabled(interaction.guildId, 'translation')) {
    await interaction.reply({ content: 'Translation is no longer enabled for this server.', flags: 64 });
    return true;
  }
  const config = translationStore.getTranslationSection(interaction.guildId);
  const text = interaction.fields.getTextInputValue('text').trim();
  const targetLanguage = translation.normalizeLanguage(interaction.fields.getTextInputValue('target').trim() || config.settings?.defaultTargetLanguage || 'en');
  const sourceLanguage = translation.normalizeLanguage(interaction.fields.getTextInputValue('source').trim() || config.settings?.defaultSourceLanguage || 'auto');
  await interaction.deferReply({ flags: 64 });
  const result = await translation.translateText({ guildId: interaction.guildId, text, targetLanguage, sourceLanguage, mode: 'manual' });
  if (!result.ok) {
    await interaction.editReply({ embeds: [translation.buildProviderNotConnectedEmbed({ text, targetLanguage, sourceLanguage, result })] });
    return true;
  }
  await interaction.editReply({ content: [`🌐 **${translation.languageLabel(result.sourceLanguage)} → ${translation.languageLabel(result.targetLanguage)}**`, '', result.translatedText].join('\n') });
  return true;
}

const adapters = {
  ping: { execute: showPing },
  help: { execute: showHelp },
  serverinfo: { execute: showServerInfo },
  translate: { execute: showTranslate },
};

module.exports = { adapters, showPing, showHelp, showServerInfo, showTranslate, submitTranslate };
