'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  Events,
  MessageFlags,
  StringSelectMenuBuilder,
} = require('discord.js');
const auditStore = require('../../owner/auditIntelligence/auditStore');
const observatory = require('../../owner/auditIntelligence/guildObservatory');
const security = require('../../core/security/protection/core');

const PREFIX = 'owner:observatory:';
const sessions = new Map();
const AUDIT_ACTIONS = Object.freeze({
  1: 'Guild settings updated', 10: 'Channel created', 11: 'Channel updated', 12: 'Channel deleted', 13: 'Channel permissions created', 14: 'Channel permissions updated', 15: 'Channel permissions deleted',
  20: 'Member removed', 21: 'Member pruned', 22: 'Member banned', 23: 'Member unbanned', 24: 'Member updated', 25: 'Member roles updated', 26: 'Member moved', 27: 'Member disconnected', 28: 'Bot added',
  30: 'Role created', 31: 'Role updated', 32: 'Role deleted', 40: 'Invite created', 41: 'Invite updated', 42: 'Invite deleted', 50: 'Webhook created', 51: 'Webhook updated', 52: 'Webhook deleted',
  60: 'Emoji created', 61: 'Emoji updated', 62: 'Emoji deleted', 72: 'Message deleted', 73: 'Messages bulk deleted', 74: 'Message pinned', 75: 'Message unpinned', 80: 'Integration created', 81: 'Integration updated', 82: 'Integration deleted',
  83: 'Stage instance created', 84: 'Stage instance updated', 85: 'Stage instance deleted', 90: 'Sticker created', 91: 'Sticker updated', 92: 'Sticker deleted', 100: 'Guild scheduled event created', 101: 'Guild scheduled event updated', 102: 'Guild scheduled event deleted',
  110: 'Thread created', 111: 'Thread updated', 112: 'Thread deleted', 121: 'AutoMod rule created', 122: 'AutoMod rule updated', 123: 'AutoMod rule deleted', 140: 'Voice channel status updated',
});

function stateFor(interaction) {
  const key = `${interaction.guildId}:${interaction.user.id}`;
  if (!sessions.has(key)) sessions.set(key, { guildId: null, view: 'overview', notice: null });
  return sessions.get(key);
}
function unix(value) { const parsed = Date.parse(value || ''); return Math.floor((Number.isFinite(parsed) ? parsed : Date.now()) / 1000); }
function currentMode() {
  const value = String(process.env.BOT_MODE || 'DEV').toUpperCase();
  return value === 'PROD' ? 'PRODUCTION' : value;
}
function knownGuilds(client) {
  const destination = String(auditStore.getConfig().commandCenter?.guildId || '');
  const merged = new Map();
  for (const item of auditStore.getGuildRegistry?.() || []) {
    const id = String(item.guildId || '');
    if (!id || id === destination) continue;
    merged.set(id, { id, name: item.name || id, environments: Object.keys(item.environments || {}).map((x) => x === 'PROD' ? 'PRODUCTION' : x), environmentState: item.environments || {} });
  }
  for (const guild of client.guilds.cache.values()) {
    if (guild.id === destination) continue;
    const existing = merged.get(guild.id) || { environments: [], environmentState: {} };
    merged.set(guild.id, { ...existing, id: guild.id, name: guild.name, liveHere: true, environments: existing.environments.length ? existing.environments : [currentMode()] });
  }
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 25);
}
function collectorFor(item, client) {
  if (!item) return currentMode();
  if (client?.guilds?.cache?.has(item.id)) return currentMode();
  const envs = item.environments || [];
  const ranked = ['PRODUCTION', 'BETA', 'DEV'];
  return ranked.find((env) => envs.includes(env)) || envs[0] || 'DEV';
}
function findName(scan, group, id) {
  if (!scan || !id) return String(id || 'Unknown');
  const source = scan[group] || [];
  const found = source.find((item) => String(item.id) === String(id));
  return found?.name || found?.displayName || found?.username || String(id);
}
function previousScan(guildId) {
  const history = observatory.getHistory(guildId, 2);
  return history.length > 1 ? history[history.length - 2] : null;
}
function diffLines(scan, guildId) {
  const diff = scan?.diff;
  if (!diff) return ['No comparison available yet.'];
  if (diff.baseline) return ['📌 First stored baseline. Future scans will be compared against this state.'];
  const previous = previousScan(guildId);
  const labels = { roles: 'Role', channels: 'Channel', members: 'Member', bans: 'Ban', automod: 'AutoMod rule', emojis: 'Emoji', stickers: 'Sticker' };
  const lines = [];
  if (diff.guildChanged) lines.push('🟠 **Guild settings changed**');
  for (const [key, label] of Object.entries(labels)) {
    const value = diff[key] || {};
    for (const id of (value.added || []).slice(0, 4)) lines.push(`🟢 **${label} added:** ${findName(scan, key, id)}`);
    for (const id of (value.removed || []).slice(0, 4)) lines.push(`🔴 **${label} removed:** ${findName(previous, key, id)}`);
    for (const id of (value.changed || []).slice(0, 4)) lines.push(`🟠 **${label} changed:** ${findName(scan, key, id)}`);
  }
  return lines.length ? lines : ['🟢 No structural changes detected since the previous baseline.'];
}
function auditActionName(action) { return AUDIT_ACTIONS[Number(action)] || `Discord audit action ${action}`; }
function latestAuditLines(scan) {
  const entries = scan?.auditLogs || [];
  if (!entries.length) return 'No recoverable Discord Audit Log entries are stored in this snapshot.';
  return entries.slice(0, 8).map((entry) => {
    const when = entry.createdAt ? `<t:${unix(entry.createdAt)}:R>` : 'unknown time';
    const actor = entry.executorTag || (entry.executorId ? `<@${entry.executorId}>` : 'Unknown actor');
    const target = entry.targetId ? `target \`${entry.targetId}\`` : 'unknown target';
    const reason = entry.reason ? `\n↳ **Reason:** ${String(entry.reason).slice(0, 140)}` : '';
    return `• **${auditActionName(entry.action)}**\n↳ ${actor} → ${target} • ${when}${reason}`;
  }).join('\n').slice(0, 1024);
}
function securityLines(scan) {
  if (!scan) return 'No stored scan yet.';
  const errors = scan.errors || [];
  const adminRoles = (scan.roles || []).filter((role) => {
    try { return (BigInt(role.permissions || '0') & 8n) === 8n; } catch { return false; }
  });
  const timedOut = (scan.members || []).filter((member) => member.communicationDisabledUntil && Date.parse(member.communicationDisabledUntil) > Date.now());
  return [
    `Bans **${scan.bans?.length ?? 0}** • Invites **${scan.invites?.length ?? 0}** • AutoMod rules **${scan.automod?.length ?? 0}**`,
    `Administrator roles **${adminRoles.length}** • Timed-out members **${timedOut.length}**`,
    `Scan permission/data gaps **${errors.length}**`,
    errors.length ? errors.slice(0, 6).map((x) => `⚠️ ${String(x).replace(/^[a-z]+:/i, '')}`).join('\n') : '🟢 Full requested scan coverage completed without recorded access errors.',
  ].join('\n').slice(0, 1024);
}
function historyLines(guildId) {
  const history = observatory.getHistory(guildId, 10);
  if (!history.length) return 'No stored scan history yet.';
  return history.slice().reverse().map((scan, index) => `**${index + 1}.** <t:${unix(scan.scannedAt)}:F> • **${scan.collectorMode || 'Unknown'}** • ${scan.durationMs ?? '?'}ms • ${scan.errors?.length || 0} coverage issue(s)`).join('\n').slice(0, 1024);
}
function overviewLines(scan) {
  if (!scan) return 'No stored Observatory baseline yet. Press **Scan Server**.';
  return [
    `Members **${scan.members?.length ?? 0}** • Bots **${scan.members?.filter((x) => x.bot).length ?? 0}** • Roles **${scan.roles?.length ?? 0}**`,
    `Channels **${scan.channels?.length ?? 0}** • Categories **${scan.channels?.filter((x) => x.type === ChannelType.GuildCategory).length ?? 0}**`,
    `Bans **${scan.bans?.length ?? 0}** • Invites **${scan.invites?.length ?? 0}** • AutoMod **${scan.automod?.length ?? 0}**`,
    `Emojis **${scan.emojis?.length ?? 0}** • Stickers **${scan.stickers?.length ?? 0}** • Recoverable audit entries **${scan.auditLogs?.length ?? 0}**`,
    scan.errors?.length ? `⚠️ **${scan.errors.length}** scan coverage issue(s) — see Security.` : '🟢 Requested scan coverage complete.',
  ].join('\n');
}
function payload(client, interaction) {
  const state = stateFor(interaction);
  const guilds = knownGuilds(client);
  if (!state.guildId && guilds.length) state.guildId = guilds[0].id;
  const selected = guilds.find((x) => x.id === state.guildId) || null;
  const scan = selected ? observatory.getLatest(selected.id) : null;
  const collector = collectorFor(selected, client);
  const title = { overview: '📊 SERVER INTELLIGENCE', changes: '🔄 CHANGE INTELLIGENCE', history: '🕒 SCAN HISTORY', security: '🛡️ SECURITY', audit: '📜 AUDIT HISTORY' }[state.view] || '📊 SERVER INTELLIGENCE';
  const embed = new EmbedBuilder().setColor(0x5865F2).setTitle(`🔭 GOLIATH OBSERVATORY • ${title}`)
    .setDescription(['Owner-only cross-environment view of every monitored server.', '**Sentinel collection stays ON at all times.** Observatory scans create persistent server baselines; reporting switches do not stop evidence collection.', state.notice ? `\n**Result:** ${state.notice}` : null].filter(Boolean).join('\n'));
  if (!selected) embed.addFields({ name: 'Guild', value: 'No registered guilds are available.' });
  else {
    embed.addFields(
      { name: 'Selected Guild', value: `**${selected.name}**\n\`${selected.id}\``, inline: true },
      { name: 'Responsible Collector', value: `**${collector}**\n${client.guilds.cache.has(selected.id) ? '🟢 Connected to this process' : '🌐 Remote collector request'}`, inline: true },
      { name: 'Last Complete Scan', value: scan ? `<t:${unix(scan.scannedAt)}:F>\n<t:${unix(scan.scannedAt)}:R>` : 'Never', inline: true },
    );
    if (state.view === 'changes') embed.addFields({ name: 'Changes Since Previous Baseline', value: diffLines(scan, selected.id).join('\n').slice(0, 1024) });
    else if (state.view === 'history') embed.addFields({ name: 'Persistent Scan History', value: historyLines(selected.id) });
    else if (state.view === 'security') embed.addFields({ name: 'Security / Access Coverage', value: securityLines(scan) });
    else if (state.view === 'audit') embed.addFields({ name: 'Recoverable Discord Audit History', value: latestAuditLines(scan) });
    else embed.addFields(
      { name: 'Current Server Baseline', value: overviewLines(scan) },
      { name: 'Latest Comparison', value: diffLines(scan, selected.id).join('\n').slice(0, 1024) },
    );
  }
  embed.setFooter({ text: 'Goliath Command Center • Persistent Observatory • DEV / BETA / PRODUCTION' }).setTimestamp();
  const rows = [];
  if (guilds.length) rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`${PREFIX}guild`).setPlaceholder('Select a monitored guild').addOptions(guilds.map((item) => ({ label: item.name.slice(0, 100), value: item.id, description: `${item.environments.join(' • ') || 'Registry'} • ${item.id}`.slice(0, 100), default: item.id === state.guildId })))));
  if (selected) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}scan`).setLabel('Scan Server').setEmoji('🔎').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${PREFIX}overview`).setLabel('Intelligence').setEmoji('📊').setStyle(state.view === 'overview' ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${PREFIX}changes`).setLabel('Changes').setEmoji('🔄').setStyle(state.view === 'changes' ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${PREFIX}history`).setLabel('History').setEmoji('🕒').setStyle(state.view === 'history' ? ButtonStyle.Success : ButtonStyle.Secondary),
    ));
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}security`).setLabel('Security').setEmoji('🛡️').setStyle(state.view === 'security' ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${PREFIX}audit`).setLabel('Audit History').setEmoji('📜').setStyle(state.view === 'audit' ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${PREFIX}refresh`).setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
    ));
  }
  return { embeds: [embed], components: rows, allowedMentions: { parse: [] } };
}
async function handle(client, interaction) {
  const id = String(interaction.customId || '');
  if (!id.startsWith(PREFIX)) return false;
  const cfg = auditStore.getConfig();
  if (String(interaction.guildId || '') !== String(cfg.commandCenter?.guildId || '')) return false;
  if (!security.isBotOwner(interaction.user?.id)) { await interaction.reply({ content: '❌ Owner-only control.', flags: MessageFlags.Ephemeral }).catch(() => null); return true; }
  const action = id.slice(PREFIX.length);
  const state = stateFor(interaction);
  state.notice = null;
  if (action === 'open') return interaction.reply({ ...payload(client, interaction), flags: MessageFlags.Ephemeral }).then(() => true).catch(() => true);
  if (action === 'guild' && interaction.isStringSelectMenu?.()) { state.guildId = interaction.values[0]; state.view = 'overview'; }
  else if (['overview', 'changes', 'history', 'security', 'audit'].includes(action)) state.view = action;
  else if (action === 'scan' && state.guildId) {
    await interaction.deferUpdate().catch(() => null);
    const item = knownGuilds(client).find((x) => x.id === state.guildId);
    const collector = collectorFor(item, client);
    const result = await observatory.requestScan(client, state.guildId, collector, interaction.user.id, 20000);
    state.notice = result.ok ? `${result.remote ? 'Remote ' : ''}${result.collectorMode || collector} scan completed and baseline stored.` : `Scan failed: ${result.reason || result.error || 'unknown error'}.`;
    await interaction.editReply(payload(client, interaction)).catch(() => null);
    return true;
  }
  if (interaction.deferred || interaction.replied) await interaction.editReply(payload(client, interaction)).catch(() => null);
  else await interaction.update(payload(client, interaction)).catch(() => null);
  return true;
}
async function ensureHomeButton(client) {
  if (currentMode() !== 'DEV') return false;
  const cfg = auditStore.getConfig();
  const guild = client.guilds.cache.get(String(cfg.commandCenter?.guildId || ''));
  if (!guild) return false;
  let channel = cfg.commandCenter?.channelId ? guild.channels.cache.get(String(cfg.commandCenter.channelId)) : null;
  if (!channel?.isTextBased?.()) channel = guild.channels.cache.find((x) => x.isTextBased?.() && x.name === 'command-center') || null;
  if (!channel) return false;
  const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
  const message = messages?.find((x) => x.author?.id === client.user?.id && x.embeds?.some((e) => String(e.title || '').includes('GOLIATH COMMAND CENTER')));
  if (!message) return false;
  if (message.components.some((row) => row.components.some((component) => component.customId === `${PREFIX}open`))) return true;
  const rows = message.components.map((row) => ActionRowBuilder.from(row));
  const button = new ButtonBuilder().setCustomId(`${PREFIX}open`).setLabel('Observatory').setEmoji('🔭').setStyle(ButtonStyle.Primary);
  const target = rows.find((row) => row.components.length < 5);
  if (target) target.addComponents(button); else if (rows.length < 5) rows.push(new ActionRowBuilder().addComponents(button)); else return false;
  await message.edit({ components: rows });
  return true;
}

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    if (currentMode() !== 'DEV') return;
    client.prependListener(Events.InteractionCreate, (interaction) => { handle(client, interaction).catch((error) => console.warn('[GuildObservatory UI]', error?.stack || error)); });
    await ensureHomeButton(client).catch((error) => console.warn('[GuildObservatory UI] home button:', error?.message || error));
    client.prependListener(Events.InteractionCreate, (interaction) => {
      const id = String(interaction.customId || '');
      if (!id.startsWith('owner:commandcenter:') || id.startsWith(PREFIX)) return;
      const timer = setTimeout(() => ensureHomeButton(client).catch(() => null), 500); timer.unref?.();
    });
    console.log('[GuildObservatory UI] Command Center Observatory controls online.');
  },
};
