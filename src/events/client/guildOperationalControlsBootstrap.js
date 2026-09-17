'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Events,
  MessageFlags,
} = require('discord.js');
const auditStore = require('../../owner/auditIntelligence/auditStore');
const security = require('../../core/security/protection/core');
const maintenance = require('../../owner/dev/maintenanceStatus');

const PREFIX = 'owner:commandcenter:globalnotices:';
const ENV_KEYS = [
  ['DEV', 'DEV_GUILD_IDS'], ['DEV', 'DEV_GUILD_ID'],
  ['BETA', 'BETA_GUILD_IDS'], ['BETA', 'BETA_GUILD_ID'],
  ['PRODUCTION', 'PRODUCTION_GUILD_IDS'], ['PRODUCTION', 'PRODUCTION_GUILD_ID'],
  ['PRODUCTION', 'PROD_GUILD_IDS'], ['PRODUCTION', 'PROD_GUILD_ID'],
];

function ids(value) {
  return String(value || '').split(',').map((v) => v.trim()).filter((v) => /^\d{16,22}$/.test(v));
}

function knownGuilds(client) {
  const destination = String(auditStore.getConfig().commandCenter?.guildId || '');
  const found = new Map();
  for (const item of auditStore.getGuildRegistry?.() || []) {
    const id = String(item.guildId || '');
    if (id && id !== destination) found.set(id, { id, name: item.name || id, environments: Object.keys(item.environments || {}) });
  }
  for (const [mode, key] of ENV_KEYS) {
    for (const id of ids(process.env[key])) {
      if (id === destination) continue;
      const current = found.get(id) || { id, name: id, environments: [] };
      if (!current.environments.includes(mode)) current.environments.push(mode);
      found.set(id, current);
    }
  }
  for (const [id, cfg] of Object.entries(auditStore.getConfig().guilds || {})) {
    if (id === destination) continue;
    const current = found.get(id) || { id, name: cfg.name || id, environments: [] };
    found.set(id, current);
  }
  for (const guild of client.guilds.cache.values()) {
    if (guild.id === destination) continue;
    const current = found.get(guild.id) || { id: guild.id, environments: [] };
    found.set(guild.id, { ...current, name: guild.name });
  }
  return [...found.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function provisionKnownGuilds(client) {
  if (auditStore.runtimeMode() !== 'DEV') return 0;
  const config = auditStore.getConfig();
  const patch = {};
  for (const item of knownGuilds(client)) {
    const existing = config.guilds?.[item.id] || {};
    patch[item.id] = {
      ...existing,
      name: item.name || existing.name || item.id,
      enabled: existing.enabled !== false,
      operationalNotices: {
        ...maintenance.DEFAULT_NOTICE_SETTINGS,
        ...(existing.operationalNotices || {}),
      },
    };
  }
  if (Object.keys(patch).length) auditStore.updateConfig({ guilds: patch });
  return Object.keys(patch).length;
}

function aggregate(client) {
  const guilds = knownGuilds(client);
  const settings = guilds.map((g) => ({ guild: g, notices: maintenance.noticeSettings(g.id) }));
  const count = (key) => settings.filter((x) => x.notices[key] !== false).length;
  const active = settings.filter((x) => !x.notices.paused).length;
  return { guilds, settings, active, maintenance: count('maintenance'), restart: count('restart'), recovery: count('recovery') };
}

function payload(client, result = null) {
  const a = aggregate(client);
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🚨 GOLIATH • GLOBAL OPERATIONAL NOTICES')
    .setDescription([
      'Owner controls for maintenance/restart/recovery messages across **every known guild**.',
      '',
      '**Sentinel collection is unaffected and remains ON.**',
      result ? `\n**Result:** ${result}` : null,
    ].filter(Boolean).join('\n'))
    .addFields(
      { name: 'Known Guilds', value: `**${a.guilds.length}**`, inline: true },
      { name: 'Notice Delivery', value: `🔔 Active **${a.active}/${a.guilds.length}**`, inline: true },
      { name: 'Maintenance', value: `🛠️ Enabled **${a.maintenance}/${a.guilds.length}**`, inline: true },
      { name: 'Restart / Offline', value: `🔄 Enabled **${a.restart}/${a.guilds.length}**`, inline: true },
      { name: 'Recovery', value: `✅ Enabled **${a.recovery}/${a.guilds.length}**`, inline: true },
      { name: 'Guilds', value: a.settings.length ? a.settings.slice(0, 20).map(({ guild, notices }) => `${notices.paused ? '🔕' : '🔔'} **${guild.name}** • M ${notices.maintenance ? '🟢' : '🔴'} • R ${notices.restart ? '🟢' : '🔴'} • Rec ${notices.recovery ? '🟢' : '🔴'}`).join('\n').slice(0, 1024) : 'No guilds discovered yet.' },
    )
    .setFooter({ text: 'Goliath Command Center • Operational notices only • Sentinel remains collecting' })
    .setTimestamp();
  const disabled = !a.guilds.length;
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}pause-all`).setLabel('Pause ALL Notices').setEmoji('🔕').setStyle(ButtonStyle.Danger).setDisabled(disabled),
        new ButtonBuilder().setCustomId(`${PREFIX}resume-all`).setLabel('Resume ALL Notices').setEmoji('🔔').setStyle(ButtonStyle.Success).setDisabled(disabled),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}maintenance`).setLabel('Toggle Maintenance ALL').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
        new ButtonBuilder().setCustomId(`${PREFIX}restart`).setLabel('Toggle Restart ALL').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
        new ButtonBuilder().setCustomId(`${PREFIX}recovery`).setLabel('Toggle Recovery ALL').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      ),
      new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}refresh`).setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Primary)),
    ],
    allowedMentions: { parse: [] },
  };
}

function applyAll(client, patchFactory) {
  const guilds = knownGuilds(client);
  for (const guild of guilds) {
    const current = maintenance.noticeSettings(guild.id);
    maintenance.updateNoticeSettings(guild.id, patchFactory(current, guild));
  }
  return guilds.length;
}

async function handle(client, interaction) {
  const id = String(interaction.customId || '');
  if (!id.startsWith(PREFIX)) return false;
  if (!security.isBotOwner(interaction.user?.id)) {
    await interaction.reply({ content: '❌ Owner-only control.', flags: MessageFlags.Ephemeral }).catch(() => null);
    return true;
  }
  const action = id.slice(PREFIX.length);
  let result = null;
  if (action === 'open') {
    provisionKnownGuilds(client);
    await interaction.reply({ ...payload(client), flags: MessageFlags.Ephemeral }).catch(() => null);
    return true;
  }
  if (action === 'pause-all') { const n = applyAll(client, () => ({ paused: true })); result = `Paused maintenance/restart/recovery notice delivery for ${n} guild(s).`; }
  else if (action === 'resume-all') { const n = applyAll(client, () => ({ paused: false })); result = `Resumed operational notice delivery for ${n} guild(s).`; }
  else if (['maintenance', 'restart', 'recovery'].includes(action)) {
    const a = aggregate(client); const turnOn = !a.settings.every((x) => x.notices[action] !== false);
    const n = applyAll(client, () => ({ [action]: turnOn })); result = `${action} notices ${turnOn ? 'enabled' : 'disabled'} for ${n} guild(s).`;
  }
  await interaction.update(payload(client, result)).catch(() => null);
  return true;
}

async function ensureButton(client) {
  if (auditStore.runtimeMode() !== 'DEV') return false;
  const config = auditStore.getConfig();
  const guild = client.guilds.cache.get(String(config.commandCenter?.guildId || ''));
  if (!guild) return false;
  let channel = config.commandCenter?.channelId ? guild.channels.cache.get(String(config.commandCenter.channelId)) : null;
  if (!channel?.isTextBased?.()) channel = guild.channels.cache.find((c) => c.isTextBased?.() && c.name === 'command-center');
  if (!channel) return false;
  const messages = await channel.messages.fetch({ limit: 25 }).catch(() => null);
  const message = messages?.find((m) => m.author?.id === client.user.id && m.embeds?.some((e) => String(e.title || '').includes('GOLIATH COMMAND CENTER')));
  if (!message) return false;
  const rows = message.components.map((r) => ActionRowBuilder.from(r));
  if (rows.some((r) => r.components.some((c) => c.data?.custom_id === `${PREFIX}open`))) return true;
  const button = new ButtonBuilder().setCustomId(`${PREFIX}open`).setLabel('Global Notices').setEmoji('🚨').setStyle(ButtonStyle.Danger);
  let row = rows.find((r) => r.components.length < 5);
  if (row) row.addComponents(button); else if (rows.length < 5) rows.push(new ActionRowBuilder().addComponents(button)); else return false;
  await message.edit({ components: rows }).catch(() => null);
  return true;
}

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    const count = provisionKnownGuilds(client);
    await ensureButton(client).catch(() => null);
    client.on(Events.InteractionCreate, (i) => handle(client, i).catch((e) => console.warn('[Global Notice Controls]', e?.stack || e)));
    const timer = setInterval(() => { provisionKnownGuilds(client); ensureButton(client).catch(() => null); }, 60 * 1000);
    timer.unref?.();
    console.log(`[Global Notice Controls] ${count} guild(s) provisioned for owner controls.`);
  },
};
