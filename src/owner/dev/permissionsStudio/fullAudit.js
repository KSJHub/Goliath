'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } = require('discord.js');
const detector = require('./auditDetector');

const PREFIX = 'permaudit:';
const gid = interaction => String(interaction.customId || '').match(/:guild:(\d{16,25})$/)?.[1] || interaction.guildId;
const cid = (action, guildId) => `${PREFIX}${action}:guild:${guildId}`;
const studioId = (action, guildId) => `permstudio:${action}:guild:${guildId}`;
const severityEmoji = severity => ({ critical: '🔴', high: '🟠', medium: '🟡', low: '🔵' }[severity] || '⚪');

async function getGuild(interaction) {
  const id = gid(interaction);
  if (interaction?.guild?.id === id) return interaction.guild;
  const cached = interaction?.client?.guilds?.cache?.get(id);
  if (cached) return cached;
  return Promise.race([
    interaction.client.guilds.fetch(id).catch(() => null),
    new Promise(resolve => setTimeout(() => resolve(null), 5000)),
  ]);
}

function payload(guild, report) {
  const counts = report.severityCounts;
  const top = report.findings.slice(0, 12);
  const embed = new EmbedBuilder()
    .setColor(counts.critical ? 0xED4245 : counts.high ? 0xF47B20 : counts.medium ? 0xFEE75C : 0x57F287)
    .setTitle('🔎 Full Permission Audit')
    .setDescription(report.findings.length
      ? `Found **${report.findings.length}** permission issue${report.findings.length === 1 ? '' : 's'} requiring review.\n\n${top.map((f, i) => `${severityEmoji(f.severity)} **${i + 1}. ${f.title}**\n${f.detail}`).join('\n\n')}`
      : '✅ No permission problems were detected by the current audit rules.')
    .addFields(
      { name: 'Severity', value: `🔴 Critical **${counts.critical}**\n🟠 High **${counts.high}**\n🟡 Review **${counts.medium}**`, inline: true },
      { name: 'Structure', value: `Roles **${report.roles}**\nCategories **${report.categories}**\nChannels **${report.channels}**`, inline: true },
      { name: 'Permission state', value: `Unsynced **${report.unsynced}**\nMember overrides **${report.memberOverrides}**\nRole overrides **${report.roleOverrides}**`, inline: true },
    )
    .setFooter({ text: report.findings.length > 12 ? `Showing first 12 of ${report.findings.length} findings • Select any of the first 25 below to inspect it` : 'Read-only scan • Select a finding to open the relevant Permissions Studio workspace' });

  const components = [];
  if (report.findings.length) {
    const options = report.findings.slice(0, 25).map((f, i) => ({
      label: `${i + 1}. ${f.title}`.slice(0, 100),
      description: `${f.severity.toUpperCase()} • ${f.code}`.slice(0, 100),
      // Findings can share the same target (for example, one channel can have
      // both a broken-inheritance and member-override finding). Discord select
      // option values must still be unique, so include the finding index.
      value: `${f.targetKind}:${f.targetId}:${i}`,
      emoji: severityEmoji(f.severity),
    }));
    components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(cid('open', guild.id)).setPlaceholder('Inspect a finding…').addOptions(options)));
  }
  components.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(cid('rescan', guild.id)).setLabel('Rescan').setEmoji('🔄').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(studioId('audit', guild.id)).setLabel('Back to Audit').setEmoji('⬅️').setStyle(ButtonStyle.Secondary),
  ));
  return { embeds: [embed], components };
}

async function scan(interaction) {
  // Acknowledge the button before resolving or fetching the guild. This keeps
  // the interaction alive even if the guild manager/cache is slow.
  if (!interaction.replied && !interaction.deferred) await interaction.deferUpdate();

  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🔎 Full Permission Audit')
      .setDescription('⏳ Scanning the current server roles, channels and permission overwrites…')],
    components: [],
  });

  const guild = await getGuild(interaction);
  if (!guild) {
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle('🔎 Full Permission Audit')
        .setDescription('❌ Server context unavailable. The audit could not resolve the current guild.')],
      components: [],
    });
    return true;
  }

  // Refresh what Discord can provide, but never let a slow fetch block the
  // interaction indefinitely. The detector can safely operate on the cache.
  const refresh = (promise, timeoutMs = 5000) => Promise.race([
    promise.catch(() => null),
    new Promise(resolve => setTimeout(() => resolve(null), timeoutMs)),
  ]);
  await refresh(guild.roles.fetch());
  await refresh(guild.channels.fetch());

  const report = detector.scanGuild(guild);
  await interaction.editReply(payload(guild, report));
  return true;
}

async function handle(interaction) {
  const raw = String(interaction.customId || '');
  if (!raw.startsWith(PREFIX)) return false;
  const guild = await getGuild(interaction);
  if (!guild) { await interaction.reply({ content: '❌ Server context unavailable.', ephemeral: true }); return true; }
  const action = raw.slice(PREFIX.length).replace(/:guild:\d{16,25}$/, '');
  if (action === 'rescan') return scan(interaction);
  if (action === 'open') {
    const [kind, id] = String(interaction.values?.[0] || '').split(':');
    if (kind === 'role') {
      const role = guild.roles.cache.get(id);
      if (!role) { await interaction.reply({ content: '❌ That role is no longer available.', ephemeral: true }); return true; }
      const studio = require('./index');
      const panel = require('./panel');
      await interaction.update(panel.role(guild, role, { clipboard: null, history: [] }));
      return true;
    }
    if (kind === 'channel') {
      const channel = guild.channels.cache.get(id);
      if (!channel) { await interaction.reply({ content: '❌ That channel is no longer available.', ephemeral: true }); return true; }
      const panel = require('./panel');
      await interaction.update(panel.channel(guild, channel, { clipboard: null, history: [] }));
      return true;
    }
  }
  return false;
}

module.exports = { scan, handle };
