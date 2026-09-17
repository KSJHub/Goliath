'use strict';

const { EmbedBuilder, Events, MessageFlags } = require('discord.js');
const auditStore = require('../../owner/auditIntelligence/auditStore');
const maintenance = require('../../owner/dev/maintenanceStatus');
const security = require('../../core/security/protection/core');

const PREFIX = 'owner:commandcenter:globalnotices:';
let wired = false;

function knownGuilds(client) {
  const destination = String(auditStore.getConfig().commandCenter?.guildId || '');
  const found = new Map();
  for (const item of auditStore.getGuildRegistry?.() || []) {
    const id = String(item?.guildId || '');
    if (id && id !== destination) found.set(id, { id, name: item.name || id });
  }
  for (const [id, cfg] of Object.entries(auditStore.getConfig().guilds || {})) {
    if (id && id !== destination) found.set(id, { id, name: cfg?.name || found.get(id)?.name || id });
  }
  for (const guild of client.guilds.cache.values()) {
    if (guild.id !== destination) found.set(guild.id, { id: guild.id, name: guild.name });
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function aggregate(client) {
  const guilds = knownGuilds(client);
  const settings = guilds.map((guild) => ({ guild, notices: maintenance.noticeSettings(guild.id) }));
  const count = (key) => settings.filter(({ notices }) => notices[key] !== false).length;
  return {
    guilds,
    settings,
    active: settings.filter(({ notices }) => !notices.paused).length,
    maintenance: count('maintenance'),
    restart: count('restart'),
    recovery: count('recovery'),
  };
}

function applyAll(client, factory) {
  const guilds = knownGuilds(client);
  for (const guild of guilds) {
    const current = maintenance.noticeSettings(guild.id);
    maintenance.updateNoticeSettings(guild.id, factory(current, guild));
  }
  return guilds.length;
}

function refreshedEmbed(client, original, result) {
  const a = aggregate(client);
  const base = original ? EmbedBuilder.from(original) : new EmbedBuilder().setColor(0x5865F2).setTitle('🚨 GOLIATH • GLOBAL OPERATIONAL NOTICES');
  base.setDescription([
    'Owner controls for maintenance/restart/recovery messages across **every known guild**.',
    '',
    '**Sentinel collection is unaffected and remains ON.**',
    result ? `\n**Result:** ${result}` : null,
  ].filter(Boolean).join('\n'));
  base.setFields(
    { name: 'Known Guilds', value: `**${a.guilds.length}**`, inline: true },
    { name: 'Notice Delivery', value: `${a.active ? '🔔' : '🔕'} Active **${a.active}/${a.guilds.length}**`, inline: true },
    { name: 'Maintenance', value: `🛠️ Enabled **${a.maintenance}/${a.guilds.length}**`, inline: true },
    { name: 'Restart / Offline', value: `🔄 Enabled **${a.restart}/${a.guilds.length}**`, inline: true },
    { name: 'Recovery', value: `✅ Enabled **${a.recovery}/${a.guilds.length}**`, inline: true },
    { name: 'Guilds', value: a.settings.length ? a.settings.slice(0, 20).map(({ guild, notices }) => `${notices.paused ? '🔕' : '🔔'} **${guild.name}** • M ${notices.maintenance ? '🟢' : '🔴'} • R ${notices.restart ? '🟢' : '🔴'} • Rec ${notices.recovery ? '🟢' : '🔴'}`).join('\n').slice(0, 1024) : 'No guilds discovered yet.' },
  );
  base.setFooter({ text: 'Goliath Command Center • Operational notices only • Sentinel remains collecting' }).setTimestamp();
  return base;
}

async function handle(client, interaction, originalId) {
  if (!security.isBotOwner(interaction.user?.id)) {
    if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: '❌ Owner-only control.', flags: MessageFlags.Ephemeral }).catch(() => null);
    return;
  }
  const action = originalId.slice(PREFIX.length);
  // Leave :open to the existing panel opener. This guard is for controls inside
  // the already-open panel, which were being swallowed by Audit Intelligence.
  if (action === 'open') return;

  let result = null;
  if (action === 'pause-all') {
    const n = applyAll(client, () => ({ paused: true }));
    result = `Paused maintenance/restart/recovery notice delivery for ${n} guild(s).`;
  } else if (action === 'resume-all') {
    const n = applyAll(client, () => ({ paused: false }));
    result = `Resumed operational notice delivery for ${n} guild(s).`;
  } else if (['maintenance', 'restart', 'recovery'].includes(action)) {
    const a = aggregate(client);
    const turnOn = !a.settings.every(({ notices }) => notices[action] !== false);
    const n = applyAll(client, () => ({ [action]: turnOn }));
    result = `${action} notices ${turnOn ? 'enabled' : 'disabled'} for ${n} guild(s).`;
  } else if (action === 'refresh') {
    result = 'Operational notice settings refreshed.';
  } else {
    return;
  }

  const embed = refreshedEmbed(client, interaction.message?.embeds?.[0], result);
  if (!interaction.replied && !interaction.deferred) {
    await interaction.update({ embeds: [embed], components: interaction.message?.components || [], allowedMentions: { parse: [] } }).catch((error) => {
      console.warn('[CommandCenter Control Router] Global notice update failed:', error?.message || error);
    });
  }
}

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    if (wired || String(auditStore.runtimeMode?.() || process.env.BOT_MODE || 'DEV').toUpperCase() !== 'DEV') return;
    wired = true;
    client.prependListener(Events.InteractionCreate, (interaction) => {
      const originalId = String(interaction?.customId || '');
      if (!originalId.startsWith(PREFIX) || originalId === `${PREFIX}open`) return;

      // Start the real action immediately, then remove it from the broad
      // owner:commandcenter:* namespace before Audit Intelligence's generic
      // fallback listener receives the same Discord interaction.
      const task = handle(client, interaction, originalId);
      try { interaction.customId = `owner:globalnotices:handled:${interaction.id}`; } catch {}
      Promise.resolve(task).catch((error) => console.warn('[CommandCenter Control Router]', error?.stack || error));
    });
    console.log('[CommandCenter Control Router] Global notice actions protected from generic fallback.');
  },
};
