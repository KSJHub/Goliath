'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, StringSelectMenuBuilder } = require('discord.js');

const guildIntelligenceWired = new WeakSet();

const COLORS = {
  create: 0x57F287, update: 0xFEE75C, delete: 0xED4245, moderation: 0xEB459E,
  member: 0x5865F2, voice: 0x3498DB, message: 0x95A5A6, system: 0x2F3136, intelligence: 0x5865F2,
};

const GUILD_ACTIVITY_FAMILIES = {
  all: { label: 'Recent Activity', emoji: '🕒' }, moderation: { label: 'Moderation', emoji: '🛡️' },
  members: { label: 'Members', emoji: '👥' }, roles: { label: 'Roles / Permissions', emoji: '🎭' },
  messages: { label: 'Messages / Reactions', emoji: '💬' }, voice: { label: 'Voice', emoji: '🔊' },
  security: { label: 'Security / AutoMod', emoji: '🔐' }, goliath: { label: 'Goliath Actions', emoji: '🤖' },
};

function runtimeMode() {
  const mode = String(process.env.BOT_MODE || 'DEV').trim().toUpperCase();
  if (mode === 'PROD' || mode === 'PRODUCTION') return 'PRODUCTION';
  if (mode === 'BETA') return 'BETA';
  return 'DEV';
}

function family(event = {}) {
  if (event.category === 'moderation') return 'moderation';
  if (event.category === 'voice') return 'voice';
  if (event.category === 'message') return 'message';
  if (event.category === 'member') return 'member';
  if (event.action === 'create' || event.action === 'join') return 'create';
  if (event.action === 'delete' || event.action === 'leave') return 'delete';
  if (event.action === 'update') return 'update';
  return 'system';
}

function compact(value, max = 950) {
  if (value === null || value === undefined || value === '') return 'None';
  const text = typeof value === 'string' ? value : String(value);
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function discordTime(value, style = 'F') {
  if (!value) return 'Unknown';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

function auditFamilyLabel(event = {}) {
  const category = String(event.category || '').toLowerCase();
  const type = String(event.type || '').toLowerCase();
  if (category === 'moderation' || /^member\.(ban|unban|kick|timeout|prune)/.test(type)) return 'Moderation';
  if (category === 'automod' || category === 'security') return 'Security / AutoMod';
  if (category === 'message' || type.startsWith('reaction.')) return 'Messages / Reactions';
  if (category === 'role' || type === 'member.roles' || type.includes('permission')) return 'Roles / Permissions';
  if (category === 'goliath' || type.startsWith('goliath.')) return 'Goliath Actions';
  if (category === 'voice' || type.startsWith('voice.')) return 'Voice Activity';
  if (category === 'member' || type.startsWith('member.')) return 'Member Events';
  return 'Guild / System Events';
}

function humanKey(key) {
  return String(key || 'Value').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[._-]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

function mentionAware(key, value) {
  if (value === null || value === undefined || value === '') return 'None';
  const text = String(value);
  const lower = String(key || '').toLowerCase();
  if (/channel(id)?$/.test(lower) && /^\d{15,22}$/.test(text)) return `<#${text}>`;
  if (/(user|member|actor|owner)(id)?$/.test(lower) && /^\d{15,22}$/.test(text)) return `<@${text}>`;
  if (/role(id)?$/.test(lower) && /^\d{15,22}$/.test(text)) return `<@&${text}>`;
  if (/timestamp|createdat|updatedat|joinedat|until|time$/.test(lower) && !Number.isNaN(new Date(value).getTime())) return discordTime(value, 'F');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return compact(text, 350);
}

function flattenState(value, prefix = '', out = {}, depth = 0) {
  if (value === null || value === undefined) return out;
  if (depth > 2) { out[prefix || 'Value'] = '[details stored internally]'; return out; }
  if (Array.isArray(value)) {
    out[prefix || 'Items'] = value.length ? value.map((item) => {
      if (item && typeof item === 'object') return item.name || item.label || item.username || item.id || '[item]';
      return String(item);
    }).join(', ') : 'None';
    return out;
  }
  if (typeof value !== 'object') { out[prefix || 'Value'] = value; return out; }
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) flattenState(child, path, out, depth + 1);
    else flattenState(child, path, out, depth + 1);
  }
  return out;
}

function describeState(value) {
  if (value === undefined) return null;
  if (value === null) return 'None';
  if (typeof value !== 'object') return compact(value, 900);
  const flat = flattenState(value);
  const lines = Object.entries(flat).slice(0, 12).map(([key, item]) => `**${humanKey(key.split('.').pop())}:** ${mentionAware(key, item)}`);
  return compact(lines.join('\n') || 'No visible details.', 1000);
}

function describeChanges(before, after) {
  if (before === undefined && after === undefined) return null;
  if (before === undefined) return `**Created / Added**\n${describeState(after)}`;
  if (after === undefined) return `**Removed / Deleted**\n${describeState(before)}`;
  const left = flattenState(before);
  const right = flattenState(after);
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])];
  const changed = keys.filter((key) => String(left[key] ?? '') !== String(right[key] ?? ''));
  if (!changed.length) return 'Discord reported an update, but no human-readable field changed. The raw event is retained by Sentinel.';
  return compact(changed.slice(0, 10).map((key) => {
    const label = humanKey(key.split('.').pop());
    return `**${label}**\n↳ Before: ${mentionAware(key, left[key])}\n↳ After: ${mentionAware(key, right[key])}`;
  }).join('\n\n'), 1000);
}

function personLabel(person, fallback) {
  if (person?.id) return `<@${person.id}>\n\`${person.id}\``;
  return compact(person?.label || person?.name || person?.username || fallback, 500);
}

function targetLabel(event = {}) {
  if (event.user?.id) return personLabel(event.user, 'Unknown member');
  if (event.target?.id && /user|member/i.test(String(event.target?.type || ''))) return `<@${event.target.id}>\n\`${event.target.id}\``;
  if (event.target?.name || event.target?.label) return compact(event.target.name || event.target.label, 500);
  if (event.target?.id) return `\`${event.target.id}\``;
  return 'Not applicable / not exposed by Discord';
}

function buildAuditEmbed(event = {}) {
  const environment = String(event.environment || event.mode || runtimeMode()).toUpperCase();
  const guildName = event.guildName || event.guild?.name || 'Unknown Guild';
  const guildId = event.guildId || event.guild?.id || null;
  const changes = describeChanges(event.before, event.after);
  const summary = compact(event.summary || `Goliath observed **${event.title || humanKey(event.type || 'activity')}** in **${guildName}**.`, 1800);
  const embed = new EmbedBuilder()
    .setColor(COLORS[family(event)] || COLORS.system)
    .setTitle(`${event.icon || '🧾'} ${event.title || humanKey(event.type || 'Audit Event')}`)
    .setDescription(summary)
    .addFields(
      { name: 'Server', value: guildId ? `**${guildName}**\n\`${guildId}\`` : `**${guildName}**`, inline: true },
      { name: 'When', value: discordTime(event.timestamp, 'F'), inline: true },
      { name: 'Report', value: auditFamilyLabel(event), inline: true },
      { name: 'Who Performed It', value: personLabel(event.actor, 'Unknown / Discord did not expose an actor'), inline: true },
      { name: 'Affected Target', value: targetLabel(event), inline: true },
      { name: 'Outcome', value: compact(event.result || 'Observed', 500), inline: true },
    );

  if (event.channel?.id) embed.addFields({ name: 'Where', value: `<#${event.channel.id}>\n\`${event.channel.id}\``, inline: false });
  if (changes) embed.addFields({ name: 'What Changed', value: changes, inline: false });
  if (event.reason) embed.addFields({ name: 'Reason', value: compact(event.reason, 1000), inline: false });
  embed.addFields({ name: 'Evidence', value: `Source: **${event.source || 'Discord Gateway'}** • Collector: **${environment}**\nRaw evidence is retained internally by Sentinel.`, inline: false });
  embed.setFooter({ text: `Goliath Sentinel • ${environment}${event.eventId ? ` • ${event.eventId}` : ''}` }).setTimestamp(new Date(event.timestamp || Date.now()));
  return embed;
}

function buildCommandCenterSetup(client) {
  const guilds = [...(client?.guilds?.cache?.values?.() || [])].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))).slice(0, 25);
  const embed = new EmbedBuilder().setColor(COLORS.intelligence).setTitle('🛡️ Goliath Command Center Setup')
    .setDescription('Choose the **one private Discord server** that should host Goliath Audit Intelligence. `/commandcenter` will only be registered in that server and nowhere else.')
    .addFields({ name: 'Privacy', value: 'Only the configured Goliath owner can complete setup or use the Command Center.' }, { name: 'Provisioning', value: 'Goliath will create a private **GOLIATH CONTROL** category and **#command-center** channel.' })
    .setFooter({ text: 'Goliath Command Center • Private owner bootstrap' });
  if (!guilds.length) return { embeds: [embed.setDescription('No shared guilds are currently available to Goliath.')], components: [] };
  const select = new StringSelectMenuBuilder().setCustomId('owner:commandcenter:destination').setPlaceholder('Select your private Command Center server')
    .addOptions(guilds.map((guild) => ({ label: String(guild.name || guild.id).slice(0, 100), value: guild.id, description: `Guild ID: ${guild.id}`.slice(0, 100) })));
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select)] };
}

function guildIntelligenceSources(client, destinationId) {
  return [...(client?.guilds?.cache?.values?.() || [])].filter((guild) => String(guild.id) !== String(destinationId || '')).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))).slice(0, 25);
}

function matchesGuildActivityFamily(event, familyKey) {
  const category = String(event?.category || 'system'); const type = String(event?.type || '');
  if (familyKey === 'all') return true;
  if (familyKey === 'moderation') return category === 'moderation';
  if (familyKey === 'members') return category === 'member' && type !== 'member.roles';
  if (familyKey === 'roles') return category === 'role' || type === 'member.roles' || type.startsWith('member.role.');
  if (familyKey === 'messages') return category === 'message';
  if (familyKey === 'voice') return category === 'voice';
  if (familyKey === 'security') return category === 'automod' || category === 'security';
  if (familyKey === 'goliath') return category === 'goliath' || type.startsWith('goliath.');
  return true;
}

function buildGuildActivityEmbed(guild, events, familyKey) {
  const cfg = GUILD_ACTIVITY_FAMILIES[familyKey] || GUILD_ACTIVITY_FAMILIES.all;
  const lines = events.length ? events.slice(0, 20).map((event) => {
    const actor = event.actor?.id ? `<@${event.actor.id}>` : 'Actor not exposed';
    const target = event.user?.id ? `<@${event.user.id}>` : event.target?.label || event.target?.name || 'server';
    const where = event.channel?.id ? ` in <#${event.channel.id}>` : '';
    return `${discordTime(event.timestamp, 'R')} • **${event.title || humanKey(event.type || 'Event')}** • ${actor} → ${target}${where}${event.reason ? ` • ${String(event.reason).slice(0, 90)}` : ''}`;
  }) : ['No matching stored events found in the recent Sentinel history.'];
  return new EmbedBuilder().setColor(COLORS.intelligence).setTitle(`${cfg.emoji} ${cfg.label} • ${guild?.name || 'Guild'}`)
    .setDescription(lines.join('\n').slice(0, 4000)).setFooter({ text: 'Goliath Sentinel • newest matching activity • up to 20 shown' }).setTimestamp();
}

async function buildGuildIntelligencePanel(client, sourceGuildId = null, familyKey = 'all') {
  const auditStore = require('./auditStore'); const auditRouter = require('./auditRouter'); const config = auditStore.getConfig();
  const sources = guildIntelligenceSources(client, config.commandCenter?.guildId); const sourceGuild = sourceGuildId ? client.guilds.cache.get(String(sourceGuildId)) : null;
  const selectedFamily = GUILD_ACTIVITY_FAMILIES[familyKey] ? familyKey : 'all'; const rows = [];
  if (sources.length) rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('owner:guildintelligence:guild').setPlaceholder('Select a guild to inspect').setMinValues(1).setMaxValues(1).addOptions(sources.map((guild) => ({ label: String(guild.name || guild.id).slice(0, 100), value: guild.id, description: `Guild ID: ${guild.id}`.slice(0, 100), default: guild.id === sourceGuild?.id })))));
  if (!sourceGuild) return { embeds: [new EmbedBuilder().setColor(COLORS.intelligence).setTitle('🏰 Guild Intelligence').setDescription('Choose any guild Goliath can currently inspect to view live state together with stored Sentinel history.').setFooter({ text: 'Goliath Command Center • Guild Intelligence • Owner only' })], components: rows, allowedMentions: { parse: [] } };
  const stored = auditStore.getGuild(sourceGuild.id) || {}; const guildConfig = config.guilds?.[sourceGuild.id] || {}; const structure = await auditRouter.inspectStructure(client, sourceGuild).catch(() => ({}));
  const recentEvents = auditStore.getGuildEvents(sourceGuild.id, { limit: 100 }); const matchingEvents = recentEvents.filter((event) => matchesGuildActivityFamily(event, selectedFamily));
  rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`owner:guildintelligence:family:${sourceGuild.id}`).setPlaceholder('Inspect activity by family').setMinValues(1).setMaxValues(1).addOptions(Object.entries(GUILD_ACTIVITY_FAMILIES).map(([value, details]) => ({ label: details.label, value, emoji: details.emoji, default: value === selectedFamily })))));
  rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`owner:guildintelligence:refresh:${sourceGuild.id}:${selectedFamily}`).setLabel('Rescan Guild').setEmoji('🔄').setStyle(ButtonStyle.Secondary)));
  return { embeds: [buildGuildIntelligenceEmbed(sourceGuild, stored, guildConfig, structure), buildGuildActivityEmbed(sourceGuild, matchingEvents, selectedFamily)], components: rows, allowedMentions: { parse: [] } };
}

function ensureGuildIntelligenceControls(client) {
  if (!client || guildIntelligenceWired.has(client)) return; guildIntelligenceWired.add(client);
  client.on('interactionCreate', async (interaction) => {
    const customId = String(interaction?.customId || ''); if (!customId.startsWith('owner:guildintelligence:')) return;
    const security = require('../../core/security/protection/core'); const auditStore = require('./auditStore');
    if (!security.isBotOwner(interaction.user?.id)) { if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: '❌ Owner-only control.', flags: MessageFlags.Ephemeral }).catch(() => null); return; }
    const config = auditStore.getConfig();
    if (!config.commandCenter?.guildId || String(interaction.guildId || '') !== String(config.commandCenter.guildId)) { if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: '❌ Guild Intelligence is only available inside your private Goliath Command Center server.', flags: MessageFlags.Ephemeral }).catch(() => null); return; }
    if (customId === 'owner:guildintelligence:open' && interaction.isButton?.()) { await interaction.reply({ ...(await buildGuildIntelligencePanel(client)), flags: MessageFlags.Ephemeral }).catch(() => null); return; }
    if (customId === 'owner:guildintelligence:guild' && interaction.isStringSelectMenu?.()) { await interaction.update(await buildGuildIntelligencePanel(client, interaction.values?.[0] || null, 'all')).catch(() => null); return; }
    if (customId.startsWith('owner:guildintelligence:family:') && interaction.isStringSelectMenu?.()) { const sourceGuildId = customId.slice('owner:guildintelligence:family:'.length); await interaction.update(await buildGuildIntelligencePanel(client, sourceGuildId, String(interaction.values?.[0] || 'all'))).catch(() => null); return; }
    if (customId.startsWith('owner:guildintelligence:refresh:') && interaction.isButton?.()) { const [sourceGuildId, selectedFamily = 'all'] = customId.slice('owner:guildintelligence:refresh:'.length).split(':'); await interaction.deferUpdate().catch(() => null); await interaction.editReply(await buildGuildIntelligencePanel(client, sourceGuildId, selectedFamily)).catch(() => null); }
  });
}

function buildCommandCenterHome(client, guild, config = {}) {
  ensureGuildIntelligenceControls(client);
  const monitored = Object.keys(config.guilds && typeof config.guilds === 'object' ? config.guilds : {}).filter((id) => String(id) !== String(guild?.id || config.commandCenter?.guildId || '')).length;
  const embed = new EmbedBuilder().setColor(COLORS.intelligence).setTitle('🛡️ GOLIATH COMMAND CENTER').setDescription('Private owner control plane for Sentinel and Audit Intelligence.')
    .addFields({ name: 'Environment', value: `\`${runtimeMode()}\``, inline: true }, { name: 'Destination', value: guild ? `**${guild.name}**\n\`${guild.id}\`` : 'Not configured', inline: true }, { name: 'Status', value: guild ? '🟢 Operational' : '🔴 Not configured', inline: true }, { name: 'Monitored Guilds', value: `\`${monitored}\``, inline: true }, { name: 'Auto Provision', value: config.autoProvision === false ? '🔴 Off' : '🟢 On', inline: true }, { name: 'Command Visibility', value: guild ? `Only registered in **${guild.name}**` : 'Not registered', inline: true }).setFooter({ text: 'Goliath Command Center • Owner only' }).setTimestamp();
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('owner:commandcenter:refresh').setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('owner:commandcenter:routing').setLabel('Routing').setEmoji('📡').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('owner:commandcenter:monitoring').setLabel('Monitoring').setEmoji('👁️').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('owner:commandcenter:structure').setLabel('Structure').setEmoji('📂').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('owner:commandcenter:health').setLabel('Health').setEmoji('🩺').setStyle(ButtonStyle.Secondary)), new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('owner:commandcenter:intelligence').setLabel('User Intelligence').setEmoji('🔎').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('owner:guildintelligence:open').setLabel('Guild Intelligence').setEmoji('🏰').setStyle(ButtonStyle.Primary))], allowedMentions: { parse: [] } };
}

function buildGuildIntelligenceEmbed(guild, stored = {}, guildConfig = {}, structure = {}) {
  const members = guild?.memberCount ?? guild?.members?.cache?.size ?? 0; const cached = guild?.members?.cache ? [...guild.members.cache.values()] : []; const bots = cached.filter((m) => m.user?.bot).length;
  const roles = Math.max(0, Number(guild?.roles?.cache?.size || 0) - 1); const channels = Number(guild?.channels?.cache?.size || 0); const categories = guild?.channels?.cache ? [...guild.channels.cache.values()].filter((c) => c.type === 4).length : 0;
  const disabled = Object.entries(guildConfig.monitoring || {}).filter(([, enabled]) => enabled === false).map(([key]) => key); const routes = Object.keys(guildConfig.routes || {}).length;
  const top = Object.entries(stored.eventTypes || {}).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 8).map(([type, count]) => `• **${humanKey(type)}** — ${count}`).join('\n') || 'No stored events yet.';
  return new EmbedBuilder().setColor(structure.healthy === false ? 0xFEE75C : COLORS.intelligence).setTitle(`🏰 Guild Intelligence • ${guild?.name || stored.guildName || stored.guildId || 'Unknown Guild'}`).setDescription('Live Discord state combined with Goliath Sentinel history.')
    .addFields({ name: 'Guild', value: `**${guild?.name || stored.guildName || 'Unknown'}**\n\`${guild?.id || stored.guildId || 'Unknown'}\``, inline: true }, { name: 'Owner', value: guild?.ownerId ? `<@${guild.ownerId}>` : 'Unknown', inline: true }, { name: 'Created', value: discordTime(guild?.createdAt, 'F'), inline: true }, { name: 'Members', value: `Total: **${members}**\nHumans: **${Math.max(0, Number(members) - bots)}**\nBots cached: **${bots}**`, inline: true }, { name: 'Structure', value: `Channels: **${channels}**\nCategories: **${categories}**\nRoles: **${roles}**`, inline: true }, { name: 'Sentinel History', value: `Events: **${stored.eventCount || 0}**\nFirst observed: ${discordTime(stored.firstObservedAt, 'F')}\nLast event: ${discordTime(stored.lastEventAt, 'R')}`, inline: false }, { name: 'Reporting', value: `${guildConfig.enabled === false ? '⏸️ Paused' : '▶️ Active'}\nDisabled feeds: **${disabled.length ? disabled.join(', ') : 'None'}**\nRoutes: **${routes}**`, inline: false }, { name: 'Most Recorded Activity', value: top.slice(0, 1024), inline: false }).setFooter({ text: 'Goliath Command Center • Guild Intelligence • Owner only' }).setTimestamp();
}

function buildUserIntelligenceEmbed(report, sourceGuild) {
  const profile = report?.profile || {}; const summary = report?.summary || {}; const history = report?.history || {}; const membership = report?.accountMembership?.membership || {};
  return new EmbedBuilder().setColor(COLORS.intelligence).setTitle('🔎 Goliath User Intelligence').setDescription(`Owner-only intelligence summary for <@${report.userId}> in **${sourceGuild?.name || 'Unknown Guild'}**.`)
    .addFields({ name: 'User', value: `<@${report.userId}>\n\`${report.userId}\``, inline: true }, { name: 'Bot', value: profile.bot === true ? 'Yes' : profile.bot === false ? 'No' : 'Unknown', inline: true }, { name: 'Account Created', value: discordTime(profile.accountCreatedAt, 'F'), inline: true }, { name: 'First Seen', value: discordTime(summary.firstObservedAt, 'F'), inline: true }, { name: 'Last Seen', value: discordTime(summary.lastObservedAt, 'R'), inline: true }, { name: 'Recorded Events', value: `**${summary.eventCount || 0}**`, inline: true }, { name: 'Membership', value: `Known guilds: **${membership.knownGuilds || 0}** • Current: **${membership.currentGuilds || 0}** • Former: **${membership.formerGuilds || 0}**`, inline: false }, { name: 'Moderation', value: `**${summary.moderationCount || 0}** events`, inline: true }, { name: 'Role Changes', value: `**${summary.roleChangeCount || 0}**`, inline: true }, { name: 'Voice Events', value: `**${summary.voiceEventCount || 0}**`, inline: true }, { name: 'Known Names', value: compact([profile.displayName, profile.globalName, profile.username, ...(history.displayNames || []).slice(-5)].filter(Boolean).join(' • ') || 'None recorded'), inline: false }).setFooter({ text: `Goliath User Intelligence • ${report.userId}` }).setTimestamp(new Date(report.generatedAt || Date.now()));
}

function buildUserIntelligenceControls() {
  return [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('owner:audit:refresh').setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('owner:audit:deep').setLabel('Deep Scan').setEmoji('🔎').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('owner:audit:identity').setLabel('Identity History').setEmoji('🏷️').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('owner:audit:guilds').setLabel('Guild History').setEmoji('🏰').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('owner:audit:moderation').setLabel('Moderation').setEmoji('🛡️').setStyle(ButtonStyle.Secondary)), new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('owner:audit:account').setLabel('Account & Membership').setEmoji('👥').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('owner:audit:evidence').setLabel('Evidence Summary').setEmoji('📌').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('owner:audit:roles').setLabel('Roles').setEmoji('🎭').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('owner:audit:voice').setLabel('Voice').setEmoji('🔊').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('owner:audit:timeline').setLabel('Timeline').setEmoji('🕒').setStyle(ButtonStyle.Secondary)), new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('owner:audit:actions').setLabel('Actions Performed').setEmoji('👤').setStyle(ButtonStyle.Primary))];
}

function listLines(items, formatter, limit = 15) { if (!Array.isArray(items) || !items.length) return 'None recorded.'; return items.slice(-limit).reverse().map(formatter).join('\n').slice(0, 3900) || 'None recorded.'; }

function buildUserIntelligenceSectionEmbed(report, section, sourceGuild) {
  const history = report?.history || {}; const stored = report?.stored || {}; const titleMap = { deep: '🔎 Deep Scan', identity: '🏷️ Identity History', account: '👥 Account & Membership', evidence: '📌 Evidence Summary', guilds: '🏰 Guild History', moderation: '🛡️ Moderation History', roles: '🎭 Role History', voice: '🔊 Voice History', timeline: '🕒 Recent Timeline', actions: '👤 Actions Performed' };
  const embed = new EmbedBuilder().setColor(COLORS.intelligence).setTitle(titleMap[section] || '🔎 User Intelligence').setFooter({ text: `Goliath User Intelligence • ${report.userId}` }).setTimestamp(new Date(report.generatedAt || Date.now()));
  if (section === 'guilds') { embed.setDescription(listLines(Object.values(stored.guilds || {}), (g) => `**${g.guildName || g.guildId}** — first ${discordTime(g.firstObservedAt, 'F')} • last ${discordTime(g.lastObservedAt, 'R')} • **${g.eventCount || 0}** events`, 20)); return embed; }
  if (section === 'actions') { embed.setDescription(listLines(history.actions, (item) => `${discordTime(item.timestamp, 'F')} • **${humanKey(item.type || 'Action')}** • ${item.guildName || item.guildId || 'Unknown guild'}${item.target?.id ? ` → <@${item.target.id}>` : ''}${item.reason ? ` • ${String(item.reason).slice(0, 100)}` : ''}`, 20)); return embed; }
  if (section === 'identity') { const i = report?.identity || {}; embed.setDescription(`Observed identity history for <@${report.userId}>.`).addFields({ name: 'Current', value: `Username: **${i.current?.username || 'Unknown'}**\nGlobal: **${i.current?.globalName || 'None'}**\nDisplay: **${i.current?.displayName || 'Unknown'}**` }, { name: 'Observed Names', value: compact([...(i.historical?.usernames || []), ...(i.historical?.globalNames || []), ...(i.historical?.displayNames || [])].slice(-20).reverse().join(' • ') || 'None recorded.', 1000) }); return embed; }
  if (section === 'moderation') { const m = report?.moderation || {}; embed.setDescription(`Recorded moderation evidence for <@${report.userId}>.`).addFields({ name: 'Overview', value: `Total: **${m.total || 0}** • With reason: **${m.reasoned || 0}** • Actor unresolved: **${m.unresolvedActor || 0}**` }, { name: 'Recent', value: compact((m.recent || []).map((x) => `${discordTime(x.timestamp, 'R')} • **${humanKey(x.type)}** • ${x.actorId ? `<@${x.actorId}>` : 'actor unknown'}${x.reason ? ` • ${x.reason}` : ''}`).join('\n') || 'None recorded.', 1000) }); return embed; }
  if (section === 'roles') { const r = report?.roles || {}; embed.setDescription(`Recorded role evidence for <@${report.userId}>.`).addFields({ name: 'Overview', value: `Changes: **${r.total || 0}** • Adds: **${r.additions || 0}** • Removes: **${r.removals || 0}**` }, { name: 'Recent', value: compact((r.recent || []).map((x) => `${discordTime(x.timestamp, 'R')} • ${x.actorId ? `<@${x.actorId}>` : 'actor unknown'} • +${(x.added || []).map((v) => v.name || v.id).join(', ') || 'none'} / -${(x.removed || []).map((v) => v.name || v.id).join(', ') || 'none'}`).join('\n') || 'None recorded.', 1000) }); return embed; }
  if (section === 'voice') { const v = report?.voice || {}; embed.setDescription(`Recorded voice-state evidence for <@${report.userId}>.`).addFields({ name: 'Overview', value: `Events: **${v.total || 0}** • Joins: **${v.joins || 0}** • Leaves: **${v.leaves || 0}** • Moves: **${v.moves || 0}**` }, { name: 'Recent', value: compact((v.recent || []).map((x) => `${discordTime(x.timestamp, 'R')} • ${x.before?.channelId ? `<#${x.before.channelId}>` : 'none'} → ${x.after?.channelId ? `<#${x.after.channelId}>` : 'none'}`).join('\n') || 'None recorded.', 1000) }); return embed; }
  if (section === 'account') { const a = report?.accountMembership || {}; const m = a.membership || {}; embed.setDescription(`Account and membership state for <@${report.userId}>.`).addFields({ name: 'Membership', value: `Known: **${m.knownGuilds || 0}** • Current: **${m.currentGuilds || 0}** • Former: **${m.formerGuilds || 0}** • Live visible: **${m.liveVisibleGuilds || 0}**` }, { name: 'Restrictions', value: `Pending screening: **${m.pendingGuilds || 0}** • Active timeouts: **${m.timedOutGuilds || 0}**` }); return embed; }
  if (section === 'evidence') { const e = report?.evidenceSummary || {}; embed.setDescription(e.note || `Factual evidence summary for <@${report.userId}>.`).addFields({ name: 'Moderation Evidence', value: `Events: **${e.moderationEvents || 0}** • Actor unresolved: **${e.moderationWithoutAttributedActor || 0}**` }, { name: 'Membership Evidence', value: `Joins: **${e.observedJoins || 0}** • Leaves: **${e.observedLeaves || 0}** • Known guilds: **${e.knownGuilds || 0}**` }); return embed; }
  if (section === 'deep') { const d = report?.deep || {}; embed.setDescription(`Cross-environment stored + live intelligence for <@${report.userId}>.`).addFields({ name: 'Coverage', value: compact((d.environments || []).map((x) => `**${x.mode}** — ${x.eventCount || 0} events`).join('\n') || 'No stored environment coverage.') }, { name: 'Activity', value: `Events: **${d.activity?.totalEvents || 0}** • Moderation: **${d.activity?.moderation || 0}** • Role changes: **${d.activity?.roleChanges || 0}** • Voice: **${d.activity?.voiceEvents || 0}**` }); return embed; }
  embed.setDescription(listLines(history.recentEvents, (item) => `${discordTime(item.timestamp, 'F')} • **${humanKey(item.type || 'Event')}** • ${item.guildName || item.guildId || 'Unknown guild'}${item.relation ? ` • ${item.relation}` : ''}`, 25)); return embed;
}

module.exports = { buildAuditEmbed, buildCommandCenterSetup, buildCommandCenterHome, buildGuildIntelligenceEmbed, buildUserIntelligenceEmbed, buildUserIntelligenceControls, buildUserIntelligenceSectionEmbed };
