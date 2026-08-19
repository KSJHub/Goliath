'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, StringSelectMenuBuilder } = require('discord.js');

const guildIntelligenceWired = new WeakSet();

const COLORS = {
  create: 0x57F287,
  update: 0xFEE75C,
  delete: 0xED4245,
  moderation: 0xEB459E,
  member: 0x5865F2,
  voice: 0x3498DB,
  message: 0x95A5A6,
  system: 0x2F3136,
  intelligence: 0x5865F2,
};

const GUILD_ACTIVITY_FAMILIES = {
  all: { label: 'Recent Activity', emoji: '🕒' },
  moderation: { label: 'Moderation', emoji: '🛡️' },
  members: { label: 'Members', emoji: '👥' },
  roles: { label: 'Roles / Permissions', emoji: '🎭' },
  messages: { label: 'Messages / Reactions', emoji: '💬' },
  voice: { label: 'Voice', emoji: '🔊' },
  security: { label: 'Security / AutoMod', emoji: '🔐' },
  goliath: { label: 'Goliath Actions', emoji: '🤖' },
};

function runtimeMode() {
  const mode = String(process.env.BOT_MODE || 'DEV').trim().toUpperCase();
  if (mode === 'PROD' || mode === 'PRODUCTION') return 'PRODUCTION';
  if (mode === 'BETA') return 'BETA';
  return 'DEV';
}

function family(event) {
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
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function discordTime(value, style = 'F') {
  if (!value) return 'Unknown';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

function auditFamilyLabel(event) {
  const category = String(event?.category || '').toLowerCase();
  const type = String(event?.type || '').toLowerCase();
  if (category === 'moderation' || /^member\.(ban|unban|kick|timeout|prune)/.test(type)) return 'Moderation';
  if (category === 'automod' || category === 'security') return 'Security / AutoMod';
  if (category === 'message' || type.startsWith('reaction.')) return 'Messages / Reactions';
  if (category === 'role' || type === 'member.roles' || type.includes('permission')) return 'Roles / Permissions';
  if (category === 'goliath' || type.startsWith('goliath.')) return 'Goliath Actions';
  if (category === 'voice' || type.startsWith('voice.')) return 'Voice Activity';
  if (category === 'member' || type.startsWith('member.')) return 'Member Events';
  return 'Guild / System Events';
}

function buildAuditEmbed(event) {
  const actor = event.actor?.id ? `<@${event.actor.id}>\n\`${event.actor.id}\`` : event.actor?.label || 'Unknown / not exposed by Discord';
  const user = event.user?.id ? `<@${event.user.id}>\n\`${event.user.id}\`` : null;
  const target = user || event.target?.label || event.target?.name || event.target?.id || 'Unknown';
  const environment = runtimeMode();
  const guildName = event.guildName || event.guild?.name || 'Unknown Guild';
  const guildId = event.guildId || event.guild?.id || null;
  const eventTime = discordTime(event.timestamp, 'F');

  const embed = new EmbedBuilder()
    .setColor(COLORS[family(event)] || COLORS.system)
    .setTitle(`${event.icon || '🧾'} ${event.title || event.type}`)
    .setDescription(event.summary || `Audit event detected in **${guildName}**.`)
    .addFields(
      { name: 'Server', value: guildId ? `**${guildName}**\n\`${guildId}\`` : `**${guildName}**`, inline: true },
      { name: 'Report Family', value: auditFamilyLabel(event), inline: true },
      { name: 'When', value: eventTime, inline: true },
      { name: 'Target', value: compact(target), inline: true },
      { name: 'Actor', value: compact(actor), inline: true },
      { name: 'Result', value: event.result || 'Observed', inline: true },
      { name: 'Event Type', value: `\`${event.type}\``, inline: true },
      { name: 'Environment', value: `\`${environment}\``, inline: true },
      { name: 'Source', value: event.source || 'Discord', inline: true },
    )
    .setFooter({ text: `Goliath Audit • ${environment} • ${event.eventId}` })
    .setTimestamp(new Date(event.timestamp));

  if (event.channel?.id) embed.addFields({ name: 'Location', value: `<#${event.channel.id}>\n\`${event.channel.id}\``, inline: false });
  if (event.reason) embed.addFields({ name: 'Reason', value: compact(event.reason), inline: false });
  if (event.before !== undefined) embed.addFields({ name: 'Before', value: `\`\`\`json\n${compact(event.before)}\n\`\`\``, inline: false });
  if (event.after !== undefined) embed.addFields({ name: 'After', value: `\`\`\`json\n${compact(event.after)}\n\`\`\``, inline: false });

  return embed;
}

function buildCommandCenterSetup(client) {
  const guilds = [...(client?.guilds?.cache?.values?.() || [])]
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
    .slice(0, 25);
  const embed = new EmbedBuilder()
    .setColor(COLORS.intelligence)
    .setTitle('🛡️ Goliath Command Center Setup')
    .setDescription('Choose the **one private Discord server** that should host Goliath Audit Intelligence. `/commandcenter` will only be registered in that server and nowhere else.')
    .addFields(
      { name: 'Privacy', value: 'Only the configured Goliath owner can complete setup or use the Command Center.' },
      { name: 'Provisioning', value: 'Goliath will create a private **GOLIATH CONTROL** category and **#command-center** channel.' },
    )
    .setFooter({ text: 'Goliath Command Center • Private owner bootstrap' });

  if (!guilds.length) return { embeds: [embed.setDescription('No shared guilds are currently available to Goliath.')], components: [] };
  const select = new StringSelectMenuBuilder()
    .setCustomId('owner:commandcenter:destination')
    .setPlaceholder('Select your private Command Center server')
    .addOptions(guilds.map((guild) => ({ label: String(guild.name || guild.id).slice(0, 100), value: guild.id, description: `Guild ID: ${guild.id}`.slice(0, 100) })));
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select)] };
}

function guildIntelligenceSources(client, destinationId) {
  return [...(client?.guilds?.cache?.values?.() || [])]
    .filter((guild) => String(guild.id) !== String(destinationId || ''))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
    .slice(0, 25);
}

function matchesGuildActivityFamily(event, familyKey) {
  const category = String(event?.category || 'system');
  const type = String(event?.type || '');
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
  const familyConfig = GUILD_ACTIVITY_FAMILIES[familyKey] || GUILD_ACTIVITY_FAMILIES.all;
  const lines = events.length ? events.slice(0, 20).map((event) => {
    const actor = event.actor?.id ? `<@${event.actor.id}>` : 'Unknown actor';
    const target = event.user?.id ? `<@${event.user.id}>` : event.target?.label || event.target?.name || event.target?.id || 'Unknown target';
    const channel = event.channel?.id ? ` in <#${event.channel.id}>` : '';
    const reason = event.reason ? ` — ${String(event.reason).slice(0, 120)}` : '';
    return `${discordTime(event.timestamp, 'R')} • \`${runtimeMode()}\` • \`${event.type || 'event'}\` • ${actor} → ${target}${channel}${reason}`;
  }) : ['No matching stored events found in the recent audit window.'];

  return new EmbedBuilder()
    .setColor(COLORS.intelligence)
    .setTitle(`${familyConfig.emoji} ${familyConfig.label} • ${guild?.name || 'Guild'}`)
    .setDescription(lines.join('\n').slice(0, 4000))
    .setFooter({ text: `Newest matching events • ${runtimeMode()} • Up to 20 shown from the latest 100 stored guild events` })
    .setTimestamp();
}

async function buildGuildIntelligencePanel(client, sourceGuildId = null, familyKey = 'all') {
  const auditStore = require('./auditStore');
  const auditRouter = require('./auditRouter');
  const config = auditStore.getConfig();
  const sources = guildIntelligenceSources(client, config.commandCenter?.guildId);
  const sourceGuild = sourceGuildId ? client.guilds.cache.get(String(sourceGuildId)) : null;
  const selectedFamily = GUILD_ACTIVITY_FAMILIES[familyKey] ? familyKey : 'all';
  const rows = [];
  const select = new StringSelectMenuBuilder()
    .setCustomId('owner:guildintelligence:guild')
    .setPlaceholder('Select a guild to inspect')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(sources.map((guild) => ({
      label: String(guild.name || guild.id).slice(0, 100),
      value: guild.id,
      description: `Guild ID: ${guild.id}`.slice(0, 100),
      default: guild.id === sourceGuild?.id,
    })));
  if (sources.length) rows.push(new ActionRowBuilder().addComponents(select));

  if (!sourceGuild) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.intelligence)
      .setTitle('🏰 Guild Intelligence')
      .setDescription('Choose any guild Goliath is in to inspect its live Discord state together with Goliath\'s stored Audit Intelligence history.')
      .setFooter({ text: 'Goliath Command Center • Guild Intelligence • Owner only' });
    return { embeds: [embed], components: rows, allowedMentions: { parse: [] } };
  }

  const stored = auditStore.getGuild(sourceGuild.id) || {};
  const guildConfig = config.guilds?.[sourceGuild.id] || {};
  const structure = await auditRouter.inspectStructure(client, sourceGuild).catch(() => ({}));
  const recentEvents = auditStore.getGuildEvents(sourceGuild.id, { limit: 100 });
  const matchingEvents = recentEvents.filter((event) => matchesGuildActivityFamily(event, selectedFamily));
  const familySelect = new StringSelectMenuBuilder()
    .setCustomId(`owner:guildintelligence:family:${sourceGuild.id}`)
    .setPlaceholder('Inspect recent activity by family')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(Object.entries(GUILD_ACTIVITY_FAMILIES).map(([value, details]) => ({
      label: details.label,
      value,
      emoji: details.emoji,
      default: value === selectedFamily,
    })));
  rows.push(new ActionRowBuilder().addComponents(familySelect));
  const refresh = new ButtonBuilder()
    .setCustomId(`owner:guildintelligence:refresh:${sourceGuild.id}:${selectedFamily}`)
    .setLabel('Rescan Guild')
    .setEmoji('🔄')
    .setStyle(ButtonStyle.Secondary);
  rows.push(new ActionRowBuilder().addComponents(refresh));
  return {
    embeds: [
      buildGuildIntelligenceEmbed(sourceGuild, stored, guildConfig, structure),
      buildGuildActivityEmbed(sourceGuild, matchingEvents, selectedFamily),
    ],
    components: rows,
    allowedMentions: { parse: [] },
  };
}

function ensureGuildIntelligenceControls(client) {
  if (!client || guildIntelligenceWired.has(client)) return;
  guildIntelligenceWired.add(client);
  client.on('interactionCreate', async (interaction) => {
    const customId = String(interaction?.customId || '');
    if (!customId.startsWith('owner:guildintelligence:')) return;
    const security = require('../../core/security/securityCore');
    const auditStore = require('./auditStore');
    if (!security.isBotOwner(interaction.user?.id)) {
      if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: '❌ Owner-only control.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return;
    }
    const config = auditStore.getConfig();
    if (!config.commandCenter?.guildId || String(interaction.guildId || '') !== String(config.commandCenter.guildId)) {
      if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: '❌ Guild Intelligence is only available inside your private Goliath Command Center server.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return;
    }
    if (customId === 'owner:guildintelligence:open' && interaction.isButton?.()) {
      await interaction.reply({ ...(await buildGuildIntelligencePanel(client)), flags: MessageFlags.Ephemeral }).catch(() => null);
      return;
    }
    if (customId === 'owner:guildintelligence:guild' && interaction.isStringSelectMenu?.()) {
      await interaction.update(await buildGuildIntelligencePanel(client, interaction.values?.[0] || null, 'all')).catch(() => null);
      return;
    }
    if (customId.startsWith('owner:guildintelligence:family:') && interaction.isStringSelectMenu?.()) {
      const sourceGuildId = customId.slice('owner:guildintelligence:family:'.length);
      const selectedFamily = String(interaction.values?.[0] || 'all');
      await interaction.update(await buildGuildIntelligencePanel(client, sourceGuildId, selectedFamily)).catch(() => null);
      return;
    }
    if (customId.startsWith('owner:guildintelligence:refresh:') && interaction.isButton?.()) {
      const payload = customId.slice('owner:guildintelligence:refresh:'.length);
      const [sourceGuildId, selectedFamily = 'all'] = payload.split(':');
      await interaction.deferUpdate().catch(() => null);
      await interaction.editReply(await buildGuildIntelligencePanel(client, sourceGuildId, selectedFamily)).catch(() => null);
    }
  });
}

function buildCommandCenterHome(client, guild, config = {}) {
  ensureGuildIntelligenceControls(client);
  const monitored = Object.keys(config.guilds && typeof config.guilds === 'object' ? config.guilds : {})
    .filter((guildId) => String(guildId) !== String(guild?.id || config.commandCenter?.guildId || ''))
    .length;
  const embed = new EmbedBuilder()
    .setColor(COLORS.intelligence)
    .setTitle('🛡️ GOLIATH COMMAND CENTER')
    .setDescription('Private owner control plane for Audit Intelligence. This panel is intentionally isolated from Goliath public guild commands.')
    .addFields(
      { name: 'Environment', value: `\`${String(process.env.BOT_MODE || 'DEV').toUpperCase()}\``, inline: true },
      { name: 'Destination', value: guild ? `**${guild.name}**\n\`${guild.id}\`` : 'Not configured', inline: true },
      { name: 'Status', value: guild ? '🟢 Operational' : '🔴 Not configured', inline: true },
      { name: 'Monitored Guilds', value: `\`${monitored}\``, inline: true },
      { name: 'Auto Provision', value: config.autoProvision === false ? '🔴 Off' : '🟢 On', inline: true },
      { name: 'Command Visibility', value: guild ? `Only registered in **${guild.name}**` : 'Not registered', inline: true },
    )
    .setFooter({ text: 'Goliath Command Center • Owner only' })
    .setTimestamp();

  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('owner:commandcenter:refresh').setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('owner:commandcenter:routing').setLabel('Routing').setEmoji('📡').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('owner:commandcenter:monitoring').setLabel('Monitoring').setEmoji('👁️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('owner:commandcenter:structure').setLabel('Structure').setEmoji('📂').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('owner:commandcenter:health').setLabel('Health').setEmoji('🩺').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('owner:commandcenter:intelligence').setLabel('User Intelligence').setEmoji('🔎').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('owner:guildintelligence:open').setLabel('Guild Intelligence').setEmoji('🏰').setStyle(ButtonStyle.Primary),
    ),
  ];
  return { embeds: [embed], components: rows, allowedMentions: { parse: [] } };
}

function buildGuildIntelligenceEmbed(guild, stored = {}, guildConfig = {}, structure = {}) {
  const members = guild?.memberCount ?? guild?.members?.cache?.size ?? 0;
  const cachedMembers = guild?.members?.cache ? [...guild.members.cache.values()] : [];
  const bots = cachedMembers.filter((member) => member.user?.bot).length;
  const humans = Math.max(0, Number(members || 0) - bots);
  const roles = Math.max(0, Number(guild?.roles?.cache?.size || 0) - 1);
  const channels = Number(guild?.channels?.cache?.size || 0);
  const categories = guild?.channels?.cache ? [...guild.channels.cache.values()].filter((channel) => channel.type === 4).length : 0;
  const disabledFamilies = Object.entries(guildConfig.monitoring || {}).filter(([, enabled]) => enabled === false).map(([key]) => key);
  const routes = Object.keys(guildConfig.routes || {}).length;
  const eventTypes = Object.entries(stored.eventTypes || {}).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 8);
  const topEvents = eventTypes.length ? eventTypes.map(([type, count]) => `• \`${type}\` — **${count}**`).join('\n') : 'No stored events yet.';
  const structureState = structure.healthy === true ? '🟢 Healthy' : structure.systemChannel ? '🟠 Attention required' : '⚪ Not provisioned';

  return new EmbedBuilder()
    .setColor(structure.healthy === false ? 0xFEE75C : COLORS.intelligence)
    .setTitle(`🏰 Guild Intelligence • ${guild?.name || stored.guildName || stored.guildId || 'Unknown Guild'}`)
    .setDescription('Owner-only combined live Discord state and Goliath Audit Intelligence history.')
    .addFields(
      { name: 'Guild', value: `**${guild?.name || stored.guildName || 'Unknown'}**\n\`${guild?.id || stored.guildId || 'Unknown'}\``, inline: true },
      { name: 'Owner', value: guild?.ownerId ? `<@${guild.ownerId}>\n\`${guild.ownerId}\`` : 'Unknown', inline: true },
      { name: 'Created', value: discordTime(guild?.createdAt, 'F'), inline: true },
      { name: 'Members', value: `Total: **${members}**\nHumans: **${humans}**\nBots cached: **${bots}**`, inline: true },
      { name: 'Structure', value: `Channels: **${channels}**\nCategories: **${categories}**\nRoles: **${roles}**`, inline: true },
      { name: 'Security', value: `Verification: **${guild?.verificationLevel ?? 'Unknown'}**\nContent filter: **${guild?.explicitContentFilter ?? 'Unknown'}**`, inline: true },
      { name: 'Goliath History', value: `Events: **${stored.eventCount || 0}**\nFirst observed: ${discordTime(stored.firstObservedAt, 'F')}\nLast event: ${discordTime(stored.lastEventAt, 'R')}`, inline: false },
      { name: 'Audit Configuration', value: `${guildConfig.enabled === false ? '⏸️ Monitoring paused' : '▶️ Monitoring active'}\nDisabled families: **${disabledFamilies.length ? disabledFamilies.join(', ') : 'None'}**\nCustom routes: **${routes}**\nStructure: **${structureState}**`, inline: false },
      { name: 'Top Recorded Event Types', value: topEvents.slice(0, 1024), inline: false },
    )
    .setFooter({ text: 'Goliath Command Center • Guild Intelligence • Owner only' })
    .setTimestamp();
}

function buildUserIntelligenceEmbed(report, sourceGuild) {
  const profile = report?.profile || {};
  const summary = report?.summary || {};
  const history = report?.history || {};
  const accountMembership = report?.accountMembership || {};
  const account = accountMembership.account || {};
  const membership = accountMembership.membership || {};
  const guildState = (report?.currentState?.guilds || []).find((item) => String(item.guildId) === String(sourceGuild?.id));
  const member = guildState?.member || null;
  const latestNames = [...new Set([
    profile.displayName,
    profile.globalName,
    profile.username,
    ...(history.displayNames || []).slice(-5).reverse(),
    ...(history.names || []).slice(-5).reverse(),
  ].filter(Boolean))].slice(0, 8);
  const roles = (member?.roles || []).slice(0, 12).map((role) => role.name).join(', ') || 'None / not currently in guild';
  const status = member ? 'Current member' : 'Not currently present';

  return new EmbedBuilder()
    .setColor(COLORS.intelligence)
    .setTitle('🔎 Goliath User Intelligence')
    .setDescription(`Live owner-only intelligence summary for <@${report.userId}> in **${sourceGuild?.name || 'Unknown Guild'}**.`)
    .addFields(
      { name: 'User', value: `<@${report.userId}>\n\`${report.userId}\``, inline: true },
      { name: 'Status', value: status, inline: true },
      { name: 'Bot', value: profile.bot === true ? 'Yes' : profile.bot === false ? 'No' : 'Unknown', inline: true },
      { name: 'Account Created', value: discordTime(profile.accountCreatedAt, 'F'), inline: true },
      { name: 'First Seen by Goliath', value: discordTime(summary.firstObservedAt, 'F'), inline: true },
      { name: 'Last Seen by Goliath', value: discordTime(summary.lastObservedAt, 'R'), inline: true },
      { name: 'Joined This Guild', value: discordTime(member?.joinedAt, 'F'), inline: true },
      { name: 'Known Guilds', value: `\`${summary.knownGuildCount || 0}\``, inline: true },
      { name: 'Recorded Events', value: `\`${summary.eventCount || 0}\``, inline: true },
      { name: 'Account & Membership', value: `Discord visible: **${account.knownToDiscord ? 'Yes' : 'No / stored only'}**\nKnown guilds: **${membership.knownGuilds || 0}** • Current: **${membership.currentGuilds || 0}** • Former: **${membership.formerGuilds || 0}** • Unknown: **${membership.unknownGuilds || 0}**\nLive visible: **${membership.liveVisibleGuilds || 0}**\nEarliest live join: ${discordTime(membership.earliestLiveJoinAt, 'F')}\nLatest live join: ${discordTime(membership.latestLiveJoinAt, 'F')}`, inline: false },
      { name: 'Live Membership Restrictions', value: `Pending screening: **${membership.pendingGuilds || 0}** guild(s)\nActive timeout: **${membership.timedOutGuilds || 0}** guild(s)`, inline: false },
      { name: 'Moderation History', value: `\`${summary.moderationCount || 0}\` events`, inline: true },
      { name: 'Role Changes', value: `\`${summary.roleChangeCount || 0}\``, inline: true },
      { name: 'Voice Events', value: `\`${summary.voiceEventCount || 0}\``, inline: true },
      { name: 'Actions Performed', value: `\`${(history.actions || []).length}\``, inline: true },
      { name: 'Current Roles', value: compact(roles), inline: false },
      { name: 'Known Names', value: latestNames.length ? compact(latestNames.join(' • ')) : 'None recorded', inline: false },
    )
    .setFooter({ text: `Goliath User Intelligence • ${report.userId}` })
    .setTimestamp(new Date(report.generatedAt || Date.now()));
}

function buildUserIntelligenceControls() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('owner:audit:refresh').setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('owner:audit:deep').setLabel('Deep Scan').setEmoji('🔎').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('owner:audit:identity').setLabel('Identity History').setEmoji('🏷️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('owner:audit:guilds').setLabel('Guild History').setEmoji('🏰').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('owner:audit:moderation').setLabel('Moderation').setEmoji('🛡️').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('owner:audit:account').setLabel('Account & Membership').setEmoji('👥').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('owner:audit:evidence').setLabel('Evidence Summary').setEmoji('📌').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('owner:audit:roles').setLabel('Roles').setEmoji('🎭').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('owner:audit:voice').setLabel('Voice').setEmoji('🔊').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('owner:audit:timeline').setLabel('Timeline').setEmoji('🕒').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('owner:audit:actions').setLabel('Actions Performed').setEmoji('👤').setStyle(ButtonStyle.Primary),
    ),
  ];
}

function listLines(items, formatter, limit = 15) {
  if (!Array.isArray(items) || !items.length) return 'None recorded.';
  return items.slice(-limit).reverse().map(formatter).join('\n').slice(0, 3900) || 'None recorded.';
}

function buildUserIntelligenceSectionEmbed(report, section, sourceGuild) {
  const history = report?.history || {};
  const stored = report?.stored || {};
  const currentGuilds = report?.currentState?.guilds || [];
  const titleMap = {
    deep: '🔎 Deep Scan',
    identity: '🏷️ Identity History',
    account: '👥 Account & Membership',
    evidence: '📌 Evidence Summary',
    guilds: '🏰 Guild History',
    moderation: '🛡️ Moderation History',
    roles: '🎭 Role History',
    voice: '🔊 Voice History',
    timeline: '🕒 Recent Timeline',
    actions: '👤 Actions Performed',
  };
  const embed = new EmbedBuilder()
    .setColor(COLORS.intelligence)
    .setTitle(titleMap[section] || '🔎 User Intelligence')
    .setFooter({ text: `Goliath User Intelligence • ${report.userId}` })
    .setTimestamp(new Date(report.generatedAt || Date.now()));

  if (section === 'deep') {
    const deep = report?.deep || {};
    const presence = deep.guildPresence || {};
    const relations = deep.relations || {};
    const activity = deep.activity || {};
    const environmentLines = (deep.environments || []).map((item) => `• **${item.mode}** — ${item.eventCount || 0} events • ${discordTime(item.firstObservedAt, 'd')} → ${discordTime(item.lastObservedAt, 'R')}`).join('\n') || 'No stored environment coverage.';
    const currentStored = (presence.currentGuilds || []).map((guild) => `• **${guild.guildName || guild.guildId}** — last seen ${discordTime(guild.lastObservedAt, 'R')}`).join('\n') || 'None recorded.';
    const formerStored = (presence.formerGuilds || []).map((guild) => `• **${guild.guildName || guild.guildId}** — left ${discordTime(guild.lastLeftAt || guild.lastObservedAt, 'R')}`).join('\n') || 'None recorded.';
    const topTypes = (activity.topEventTypes || []).map((item) => `• \`${item.key}\` — **${item.count}**`).join('\n') || 'None recorded.';
    const topCategories = (activity.topCategories || []).map((item) => `• \`${item.key}\` — **${item.count}**`).join('\n') || 'None recorded.';
    const recent = (deep.recentActivity || []).slice(0, 8).map((item) => `• ${discordTime(item.timestamp, 'R')} — \`${item.type || 'event'}\` — ${item.guildName || item.guildId || 'Unknown guild'}${item.relation ? ` • ${item.relation}` : ''}`).join('\n') || 'No recent activity recorded.';
    const latestModeration = deep.latest?.moderation ? `\`${deep.latest.moderation.type || 'moderation'}\` in **${deep.latest.moderation.guildName || deep.latest.moderation.guildId || 'Unknown guild'}** • ${discordTime(deep.latest.moderation.timestamp, 'R')}${deep.latest.moderation.reason ? `\nReason: ${String(deep.latest.moderation.reason).slice(0, 180)}` : ''}` : 'None recorded.';
    const latestAction = deep.latest?.action ? `\`${deep.latest.action.type || 'action'}\` in **${deep.latest.action.guildName || deep.latest.action.guildId || 'Unknown guild'}** • ${discordTime(deep.latest.action.timestamp, 'R')}` : 'None recorded.';

    embed.setDescription(`Cross-environment live + stored intelligence scan for <@${report.userId}>.`).addFields(
      { name: 'Environment Coverage', value: compact(environmentLines, 1024), inline: false },
      { name: 'Guild Presence', value: `Known: **${presence.known || 0}** • Live visible: **${presence.liveVisible || 0}**\nCurrent stored: **${presence.currentStored || 0}** • Former: **${presence.formerStored || 0}** • Unknown: **${presence.unknownStored || 0}**`, inline: false },
      { name: 'Current Guilds', value: compact(currentStored, 1024), inline: false },
      { name: 'Former Guilds', value: compact(formerStored, 1024), inline: false },
      { name: 'Observed Relationship', value: `Subject events: **${relations.subjectEvents || 0}**\nActor actions: **${relations.actorActions || 0}**`, inline: true },
      { name: 'Activity Totals', value: `Events: **${activity.totalEvents || 0}**\nJoins: **${activity.joins || 0}** • Leaves: **${activity.leaves || 0}**\nModeration: **${activity.moderation || 0}** • Roles: **${activity.roleChanges || 0}**\nVoice: **${activity.voiceEvents || 0}** • Actions: **${activity.actionsPerformed || 0}**`, inline: true },
      { name: 'Latest Moderation', value: compact(latestModeration, 1024), inline: false },
      { name: 'Latest Action Performed', value: compact(latestAction, 1024), inline: false },
      { name: 'Top Event Types', value: compact(topTypes, 1024), inline: true },
      { name: 'Top Categories', value: compact(topCategories, 1024), inline: true },
      { name: 'Recent Cross-Environment Activity', value: compact(recent, 1024), inline: false },
    );
    return embed;
  }

  if (section === 'identity') {
    const identity = report?.identity || {};
    const current = identity.current || {};
    const historical = identity.historical || {};
    const counts = identity.counts || {};
    const environments = (identity.environments || []).map((mode) => `\`${mode}\``).join(' • ') || 'None recorded';
    const usernames = (historical.usernames || []).slice(-15).reverse().map((value) => `• ${value}`).join('\n') || 'None recorded.';
    const globalNames = (historical.globalNames || []).slice(-15).reverse().map((value) => `• ${value}`).join('\n') || 'None recorded.';
    const displayNames = (historical.displayNames || []).slice(-15).reverse().map((value) => `• ${value}`).join('\n') || 'None recorded.';
    const nicknames = (historical.nicknames || []).slice(-20).reverse().map((item) => `• **${item.guildName || item.guildId || 'Unknown guild'}** — ${item.nickname}${item.observedAt ? ` • ${discordTime(item.observedAt, 'R')}` : ''}`).join('\n') || 'None recorded.';
    const liveNicknames = (identity.liveNicknames || []).map((item) => `• **${item.guildName || item.guildId || 'Unknown guild'}** — ${item.nickname}`).join('\n') || 'None visible right now.';
    embed.setDescription(`Cross-environment identity history for <@${report.userId}>. This reflects names Goliath has actually observed; it does not infer unobserved Discord identity changes.`).addFields(
      { name: 'Current Identity', value: `Username: **${current.username || 'Unknown'}**\nGlobal name: **${current.globalName || 'None'}**\nDisplay name: **${current.displayName || 'Unknown'}**`, inline: false },
      { name: 'Observed Coverage', value: `Environments: ${environments}\nAccount created: ${discordTime(identity.accountCreatedAt, 'F')}\nFirst observed: ${discordTime(identity.firstObservedAt, 'F')}\nLast observed: ${discordTime(identity.lastObservedAt, 'R')}`, inline: false },
      { name: 'Identity Counts', value: `Usernames: **${counts.usernames || 0}** • Global names: **${counts.globalNames || 0}**\nDisplay names: **${counts.displayNames || 0}** • Stored nicknames: **${counts.nicknames || 0}**\nLive nicknames: **${counts.liveNicknames || 0}**`, inline: false },
      { name: 'Username History', value: compact(usernames, 1024), inline: true },
      { name: 'Global Name History', value: compact(globalNames, 1024), inline: true },
      { name: 'Display Name History', value: compact(displayNames, 1024), inline: true },
      { name: 'Nickname History by Guild', value: compact(nicknames, 1024), inline: false },
      { name: 'Current Live Nicknames', value: compact(liveNicknames, 1024), inline: false },
    );
    return embed;
  }

  if (section === 'account') {
    const accountMembership = report?.accountMembership || {};
    const account = accountMembership.account || {};
    const membership = accountMembership.membership || {};
    const currentMemberships = (accountMembership.currentMemberships || []).map((item) => {
      const highest = item.highestRole?.name || item.highestRole?.id || 'None';
      const restrictions = [item.pending ? 'pending screening' : null, item.timedOutUntil ? `timeout until ${discordTime(item.timedOutUntil, 'F')}` : null].filter(Boolean).join(' • ');
      return `• **${item.guildName || item.guildId || 'Unknown guild'}** — joined ${discordTime(item.joinedAt, 'F')}\n  Roles: **${item.roleCount || 0}** • Highest: **${highest}**${restrictions ? `\n  ${restrictions}` : ''}`;
    }).join('\n') || 'No current live memberships visible.';
    const formerMemberships = (accountMembership.formerMemberships || []).map((item) => `• **${item.guildName || item.guildId || 'Unknown guild'}** — last seen ${discordTime(item.lastObservedAt, 'R')} • left ${discordTime(item.lastLeftAt || item.lastObservedAt, 'R')}`).join('\n') || 'None recorded.';
    const unknownMemberships = (accountMembership.unknownMemberships || []).map((item) => `• **${item.guildName || item.guildId || 'Unknown guild'}** — historical-only state • last seen ${discordTime(item.lastObservedAt, 'R')}`).join('\n') || 'None recorded.';
    embed.setDescription(`Account and membership state for <@${report.userId}> using live Discord visibility plus reconciled Goliath history.`).addFields(
      { name: 'Discord Account', value: `Visible to Discord now: **${account.knownToDiscord ? 'Yes' : 'No / stored only'}**\nBot account: **${account.bot === true ? 'Yes' : account.bot === false ? 'No' : 'Unknown'}**\nCreated: ${discordTime(account.accountCreatedAt, 'F')}`, inline: false },
      { name: 'Membership Overview', value: `Known guilds: **${membership.knownGuilds || 0}**\nCurrent: **${membership.currentGuilds || 0}** • Former: **${membership.formerGuilds || 0}** • Unknown: **${membership.unknownGuilds || 0}**\nLive visible: **${membership.liveVisibleGuilds || 0}**\nPending screening: **${membership.pendingGuilds || 0}** • Active timeouts: **${membership.timedOutGuilds || 0}**`, inline: false },
      { name: 'Live Join Range', value: `Earliest visible join: ${discordTime(membership.earliestLiveJoinAt, 'F')}\nLatest visible join: ${discordTime(membership.latestLiveJoinAt, 'F')}`, inline: false },
      { name: 'Current Memberships', value: compact(currentMemberships, 1024), inline: false },
      { name: 'Former Memberships', value: compact(formerMemberships, 1024), inline: false },
      { name: 'Unknown / Historical-only Memberships', value: compact(unknownMemberships, 1024), inline: false },
    );
    return embed;
  }

  if (section === 'evidence') {
    const evidence = report?.evidenceSummary || {};
    const timeouts = (evidence.activeTimeouts || []).map((item) => `• **${item.guildName || item.guildId || 'Unknown guild'}** — until ${discordTime(item.timedOutUntil, 'F')}`).join('\n') || 'None active.';
    const pending = (evidence.pendingScreening || []).map((item) => `• **${item.guildName || item.guildId || 'Unknown guild'}**`).join('\n') || 'None pending.';
    embed.setDescription(`Factual, evidence-backed observations for <@${report.userId}>. **No behavioural or risk score is calculated.**`).addFields(
      { name: 'Evidence Policy', value: evidence.note || 'Factual evidence summary only. Goliath does not calculate a behavioural or risk score.', inline: false },
      { name: 'Moderation Evidence', value: `Recorded moderation events: **${evidence.moderationEvents || 0}**\nLatest moderation: ${discordTime(evidence.latestModerationAt, 'R')}\nWithout attributed actor: **${evidence.moderationWithoutAttributedActor || 0}**`, inline: false },
      { name: 'Live Restrictions', value: `Active timeout guilds: **${(evidence.activeTimeouts || []).length}**\nPending screening guilds: **${(evidence.pendingScreening || []).length}**`, inline: false },
      { name: 'Active Timeouts', value: compact(timeouts, 1024), inline: false },
      { name: 'Pending Membership Screening', value: compact(pending, 1024), inline: false },
      { name: 'Membership Evidence', value: `Observed joins: **${evidence.observedJoins || 0}** • Observed leaves: **${evidence.observedLeaves || 0}**\nKnown guilds: **${evidence.knownGuilds || 0}** • Current: **${evidence.currentGuilds || 0}** • Former: **${evidence.formerGuilds || 0}**`, inline: false },
      { name: 'Identity Evidence', value: `Distinct observed username/global/display-name values: **${evidence.observedIdentityValues || 0}**`, inline: false },
    );
    return embed;
  }

  if (section === 'guilds') {
    const guilds = Object.values(stored.guilds || {});
    embed.setDescription(listLines(guilds, (guild) => `**${guild.guildName || guild.guildId}** — first seen ${discordTime(guild.firstObservedAt, 'F')} — last seen ${discordTime(guild.lastObservedAt, 'R')} — ${guild.currentMember === true ? 'current member' : guild.currentMember === false ? 'former member' : 'membership unknown'} — ${guild.eventCount || 0} events`, 20));
    return embed;
  }

  if (section === 'moderation') {
    const moderation = report?.moderation || {};
    const environments = (moderation.environments || []).map((mode) => `\`${mode}\``).join(' • ') || 'None recorded';
    const topTypes = (moderation.topTypes || []).map((item) => `• \`${item.key}\` — **${item.count}**`).join('\n') || 'None recorded.';
    const topGuilds = (moderation.topGuilds || []).map((item) => `• **${item.key}** — ${item.count}`).join('\n') || 'None recorded.';
    const topActors = (moderation.topActors || []).map((item) => `• <@${item.key}> — **${item.count}**`).join('\n') || 'None attributed.';
    const recent = (moderation.recent || []).map((item) => {
      const actor = item.actorId ? `<@${item.actorId}>` : 'Unknown actor';
      const reason = item.reason ? ` — ${String(item.reason).slice(0, 120)}` : ' — No reason recorded';
      return `• ${discordTime(item.timestamp, 'R')} — \`${item.type || 'moderation'}\` — **${item.guildName || item.guildId || 'Unknown guild'}** — ${actor}${reason}`;
    }).join('\n') || 'No moderation events recorded.';
    const first = moderation.first ? `\`${moderation.first.type || 'moderation'}\` in **${moderation.first.guildName || moderation.first.guildId || 'Unknown guild'}** • ${discordTime(moderation.first.timestamp, 'F')}` : 'None recorded.';
    const latest = moderation.latest ? `\`${moderation.latest.type || 'moderation'}\` in **${moderation.latest.guildName || moderation.latest.guildId || 'Unknown guild'}** • ${discordTime(moderation.latest.timestamp, 'R')}${moderation.latest.actorId ? `\nActor: <@${moderation.latest.actorId}>` : '\nActor: unresolved'}${moderation.latest.reason ? `\nReason: ${String(moderation.latest.reason).slice(0, 180)}` : '\nReason: not recorded'}` : 'None recorded.';
    embed.setDescription(`Cross-environment moderation intelligence for <@${report.userId}> based only on moderation events Goliath has actually observed.`).addFields(
      { name: 'Moderation Overview', value: `Total events: **${moderation.total || 0}**\nWith reason: **${moderation.reasoned || 0}** • Without reason: **${moderation.withoutReason || 0}**\nDistinct attributed actors: **${moderation.attributedActorCount || 0}**\nUnresolved actor events: **${moderation.unresolvedActor || 0}**`, inline: false },
      { name: 'Environment Coverage', value: environments, inline: false },
      { name: 'First Recorded Moderation', value: compact(first, 1024), inline: false },
      { name: 'Latest Moderation', value: compact(latest, 1024), inline: false },
      { name: 'Top Moderation Types', value: compact(topTypes, 1024), inline: true },
      { name: 'Top Guilds', value: compact(topGuilds, 1024), inline: true },
      { name: 'Top Attributed Actors', value: compact(topActors, 1024), inline: false },
      { name: 'Recent Moderation History', value: compact(recent, 1024), inline: false },
    );
    return embed;
  }

  if (section === 'roles') {
    const roles = report?.roles || {};
    const topTypes = (roles.topTypes || []).map((item) => `• \`${item.key}\` — **${item.count}**`).join('\n') || 'None recorded.';
    const topGuilds = (roles.topGuilds || []).map((item) => `• **${item.key}** — ${item.count}`).join('\n') || 'None recorded.';
    const topActors = (roles.topActors || []).map((item) => `• <@${item.key}> — **${item.count}**`).join('\n') || 'None attributed.';
    const live = (roles.liveGuilds || []).map((item) => {
      const member = item.member || {};
      const roleNames = (member.roles || []).slice(0, 12).map((role) => role.name || role.id).join(', ') || 'No roles';
      const highest = member.highestRole?.name || member.highestRole?.id || 'None';
      return `• **${item.guildName || item.guildId || 'Unknown guild'}** — ${roleNames}\n  Highest: **${highest}**`;
    }).join('\n') || 'No live guild role state visible.';
    const recent = (roles.recent || []).map((item) => {
      const actor = item.actorId ? `<@${item.actorId}>` : 'Unknown actor';
      const added = (item.added || []).map((role) => role.name || role.id).join(', ') || 'none';
      const removed = (item.removed || []).map((role) => role.name || role.id).join(', ') || 'none';
      return `• ${discordTime(item.timestamp, 'R')} — \`${item.type || 'member.roles'}\` — **${item.guildName || item.guildId || 'Unknown guild'}** — ${actor}\n  + ${added} / - ${removed}`;
    }).join('\n') || 'No role changes recorded.';
    const first = roles.first ? `\`${roles.first.type || 'member.roles'}\` in **${roles.first.guildName || roles.first.guildId || 'Unknown guild'}** • ${discordTime(roles.first.timestamp, 'F')}` : 'None recorded.';
    const latest = roles.latest ? `\`${roles.latest.type || 'member.roles'}\` in **${roles.latest.guildName || roles.latest.guildId || 'Unknown guild'}** • ${discordTime(roles.latest.timestamp, 'R')}${roles.latest.actorId ? `\nActor: <@${roles.latest.actorId}>` : '\nActor: unresolved'}` : 'None recorded.';
    embed.setDescription(`Cross-environment role intelligence for <@${report.userId}> based on role changes and live guild state Goliath can actually observe.`).addFields(
      { name: 'Role Change Overview', value: `Total changes: **${roles.total || 0}**\nAdd events: **${roles.additions || 0}** • Remove events: **${roles.removals || 0}** • Replacement/mixed: **${roles.replacements || 0}**\nDistinct attributed actors: **${roles.attributedActorCount || 0}**\nUnresolved actor events: **${roles.unresolvedActor || 0}**`, inline: false },
      { name: 'Current Role State', value: `Live guilds: **${roles.liveGuildCount || 0}**\nUnique current roles: **${roles.uniqueCurrentRoleCount || 0}**`, inline: false },
      { name: 'First Recorded Role Change', value: compact(first, 1024), inline: false },
      { name: 'Latest Role Change', value: compact(latest, 1024), inline: false },
      { name: 'Top Role Event Types', value: compact(topTypes, 1024), inline: true },
      { name: 'Top Guilds', value: compact(topGuilds, 1024), inline: true },
      { name: 'Top Attributed Actors', value: compact(topActors, 1024), inline: false },
      { name: 'Live Roles by Guild', value: compact(live, 1024), inline: false },
      { name: 'Recent Role History', value: compact(recent, 1024), inline: false },
    );
    return embed;
  }

  if (section === 'voice') {
    const voice = report?.voice || {};
    const current = voice.current || {};
    const topTypes = (voice.topTypes || []).map((item) => `• \`${item.key}\` — **${item.count}**`).join('\n') || 'None recorded.';
    const topGuilds = (voice.topGuilds || []).map((item) => `• **${item.key}** — ${item.count}`).join('\n') || 'None recorded.';
    const topChannels = (voice.topChannels || []).map((item) => `• <#${item.key}> — **${item.count}** observations`).join('\n') || 'None recorded.';
    const live = (current.guilds || []).map((item) => {
      const state = item.voice || {};
      const location = state.channelId ? `<#${state.channelId}>` : 'Not connected';
      const flags = [
        state.streaming ? 'streaming' : null,
        state.selfVideo ? 'video' : null,
        state.serverMute ? 'server-muted' : null,
        state.serverDeaf ? 'server-deafened' : null,
        state.selfMute ? 'self-muted' : null,
        state.selfDeaf ? 'self-deafened' : null,
      ].filter(Boolean).join(', ');
      return `• **${item.guildName || item.guildId || 'Unknown guild'}** — ${location}${flags ? ` — ${flags}` : ''}`;
    }).join('\n') || 'No live voice state visible.';
    const recent = (voice.recent || []).map((item) => {
      const before = item.before?.channelId ? `<#${item.before.channelId}>` : 'none';
      const after = item.after?.channelId ? `<#${item.after.channelId}>` : 'none';
      return `• ${discordTime(item.timestamp, 'R')} — \`${item.type || 'voice.update'}\` — **${item.guildName || item.guildId || 'Unknown guild'}** — ${before} → ${after}`;
    }).join('\n') || 'No voice events recorded.';
    const first = voice.first ? `\`${voice.first.type || 'voice.update'}\` in **${voice.first.guildName || voice.first.guildId || 'Unknown guild'}** • ${discordTime(voice.first.timestamp, 'F')}` : 'None recorded.';
    const latest = voice.latest ? `\`${voice.latest.type || 'voice.update'}\` in **${voice.latest.guildName || voice.latest.guildId || 'Unknown guild'}** • ${discordTime(voice.latest.timestamp, 'R')}\n${voice.latest.before?.channelId ? `<#${voice.latest.before.channelId}>` : 'none'} → ${voice.latest.after?.channelId ? `<#${voice.latest.after.channelId}>` : 'none'}` : 'None recorded.';
    embed.setDescription(`Cross-environment voice intelligence for <@${report.userId}> based only on voice state Goliath has actually observed and can currently see.`).addFields(
      { name: 'Voice Activity Overview', value: `Total events: **${voice.total || 0}**\nJoins: **${voice.joins || 0}** • Leaves: **${voice.leaves || 0}** • Moves: **${voice.moves || 0}**\nOther state changes: **${voice.stateChanges || 0}**`, inline: false },
      { name: 'Current Live Voice State', value: `Visible guilds: **${current.visibleGuilds || 0}** • Connected: **${current.connectedGuilds || 0}**\nStreaming: **${current.streamingGuilds || 0}** • Video: **${current.videoGuilds || 0}**\nServer muted: **${current.serverMutedGuilds || 0}** • Server deafened: **${current.serverDeafenedGuilds || 0}**\nSelf muted: **${current.selfMutedGuilds || 0}** • Self deafened: **${current.selfDeafenedGuilds || 0}**`, inline: false },
      { name: 'First Recorded Voice Event', value: compact(first, 1024), inline: false },
      { name: 'Latest Voice Event', value: compact(latest, 1024), inline: false },
      { name: 'Top Voice Event Types', value: compact(topTypes, 1024), inline: true },
      { name: 'Top Guilds', value: compact(topGuilds, 1024), inline: true },
      { name: 'Most Seen Voice Channels', value: compact(topChannels, 1024), inline: false },
      { name: 'Live Voice State by Guild', value: compact(live, 1024), inline: false },
      { name: 'Recent Voice History', value: compact(recent, 1024), inline: false },
    );
    return embed;
  }

  if (section === 'actions') {
    embed.setDescription(listLines(history.actions, (item) => {
      const target = item.target?.id ? `<@${item.target.id}>` : item.target?.label || item.target?.name || item.target?.id || 'Unknown target';
      const channel = item.channelId ? ` in <#${item.channelId}>` : '';
      const reason = item.reason ? ` — ${String(item.reason).slice(0, 100)}` : '';
      const result = item.result ? ` — ${item.result}` : '';
      const operation = item.operationId ? ` • op \`${item.operationId}\`` : '';
      return `**${discordTime(item.timestamp, 'F')}** — \`${item.type || 'action'}\` — ${item.guildName || item.guildId || 'Unknown guild'} — ${target}${channel}${reason}${result}${operation}`;
    }, 20));
    return embed;
  }

  embed.setDescription(listLines(history.recentEvents, (item) => `**${discordTime(item.timestamp, 'F')}** — \`${item.type || 'event'}\` — ${item.guildName || item.guildId || 'Unknown guild'}${item.relation ? ` — ${item.relation}` : ''}`, 25));
  return embed;
}

module.exports = {
  buildAuditEmbed,
  buildCommandCenterSetup,
  buildCommandCenterHome,
  buildGuildIntelligenceEmbed,
  buildUserIntelligenceEmbed,
  buildUserIntelligenceControls,
  buildUserIntelligenceSectionEmbed,
};
