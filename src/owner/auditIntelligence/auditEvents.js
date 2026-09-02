'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  Events,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const audit = require('./auditIntelligence');
const auditRouter = require('./auditRouter');
const auditStore = require('./auditStore');
const security = require('../../core/security/protection/core');
const { snapshotMember, buildReport } = require('./userIntelligence');
const { buildUserIntelligenceEmbed, buildUserIntelligenceSectionEmbed, buildCommandCenterSetup } = require('./auditEmbeds');

const wired = new WeakSet();
const routingSessions = new Map();
const monitoringSessions = new Map();
const structureSessions = new Map();
const intelligenceSessions = new Map();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ROUTE_LABELS = {
  guild: 'Guild / System Events',
  members: 'Member Events',
  moderation: 'Moderation',
  security: 'Security / AutoMod',
  messages: 'Messages / Reactions',
  voice: 'Voice Activity',
  roles: 'Roles / Permissions',
  goliath: 'Goliath Actions',
  default: 'Fallback / All Other Events',
};
const MONITOR_LABELS = {
  guild: 'Guild / System Events',
  members: 'Member Events',
  moderation: 'Moderation',
  messages: 'Messages / Reactions',
  voice: 'Voice',
  roles: 'Roles / Permissions',
  security: 'Security / AutoMod',
  goliath: 'Goliath Actions',
};
const roleState = (role) => role ? { id: role.id, name: role.name, color: role.hexColor, position: role.position, hoist: role.hoist, mentionable: role.mentionable, permissions: role.permissions?.bitfield?.toString?.() || null } : null;
const channelState = (channel) => channel ? {
  id: channel.id,
  name: channel.name,
  type: channel.type,
  parentId: channel.parentId || null,
  position: channel.rawPosition ?? channel.position ?? null,
  topic: channel.topic || null,
  nsfw: channel.nsfw || false,
  rateLimitPerUser: channel.rateLimitPerUser ?? null,
  bitrate: channel.bitrate ?? null,
  userLimit: channel.userLimit ?? null,
  permissionOverwrites: channel.permissionOverwrites?.cache
    ? channel.permissionOverwrites.cache.map((overwrite) => ({ id: overwrite.id, type: overwrite.type, allow: overwrite.allow.bitfield.toString(), deny: overwrite.deny.bitfield.toString() }))
    : [],
} : null;
const guildState = (guild) => guild ? { id: guild.id, name: guild.name, ownerId: guild.ownerId, verificationLevel: guild.verificationLevel, explicitContentFilter: guild.explicitContentFilter, preferredLocale: guild.preferredLocale, afkChannelId: guild.afkChannelId || null, systemChannelId: guild.systemChannelId || null, rulesChannelId: guild.rulesChannelId || null, publicUpdatesChannelId: guild.publicUpdatesChannelId || null } : null;
const messageState = (message) => message ? { id: message.id, content: message.content || null, authorId: message.author?.id || null, authorTag: message.author?.tag || message.author?.username || null, channelId: message.channelId || null, createdAt: message.createdAt?.toISOString?.() || null, editedAt: message.editedAt?.toISOString?.() || null, pinned: Boolean(message.pinned), attachments: [...(message.attachments?.values?.() || [])].map((item) => ({ id: item.id, name: item.name, url: item.url, size: item.size })) } : null;
const threadState = (thread) => thread ? { id: thread.id, name: thread.name, parentId: thread.parentId || null, ownerId: thread.ownerId || null, archived: Boolean(thread.archived), locked: Boolean(thread.locked), autoArchiveDuration: thread.autoArchiveDuration ?? null, rateLimitPerUser: thread.rateLimitPerUser ?? null } : null;
const emojiState = (emoji) => emoji ? { id: emoji.id, name: emoji.name, animated: Boolean(emoji.animated), available: emoji.available !== false, managed: Boolean(emoji.managed), roles: emoji.roles?.cache?.map?.((role) => ({ id: role.id, name: role.name })) || [] } : null;
const stickerState = (sticker) => sticker ? { id: sticker.id, name: sticker.name, description: sticker.description || null, tags: sticker.tags || null, format: sticker.format ?? null, available: sticker.available !== false } : null;
const scheduledEventState = (event) => event ? { id: event.id, name: event.name, description: event.description || null, channelId: event.channelId || null, creatorId: event.creatorId || null, status: event.status, privacyLevel: event.privacyLevel, entityType: event.entityType, scheduledStartAt: event.scheduledStartAt?.toISOString?.() || null, scheduledEndAt: event.scheduledEndAt?.toISOString?.() || null, entityMetadata: event.entityMetadata || null } : null;

function ownerIds() { return security.getBotOwnerIds(); }
function commandCenterUiEnabled() { return String(process.env.BOT_MODE || 'DEV').trim().toUpperCase() === 'DEV'; }
function sessionKey(interaction) { return `${interaction.guildId}:${interaction.user?.id || 'unknown'}`; }
function getRoutingSession(interaction) { return routingSessions.get(sessionKey(interaction)) || { sourceGuildId: null, routeKey: 'default' }; }
function setRoutingSession(interaction, patch) { const next = { ...getRoutingSession(interaction), ...patch }; routingSessions.set(sessionKey(interaction), next); return next; }
function getMonitoringSession(interaction) { return monitoringSessions.get(sessionKey(interaction)) || { sourceGuildId: null, family: 'members' }; }
function setMonitoringSession(interaction, patch) { const next = { ...getMonitoringSession(interaction), ...patch }; monitoringSessions.set(sessionKey(interaction), next); return next; }
function getStructureSession(interaction) { return structureSessions.get(sessionKey(interaction)) || { sourceGuildId: null, repairResult: null }; }
function setStructureSession(interaction, patch) { const next = { ...getStructureSession(interaction), ...patch }; structureSessions.set(sessionKey(interaction), next); return next; }
function getIntelligenceSession(interaction) { return intelligenceSessions.get(sessionKey(interaction)) || { sourceGuildId: null, userId: null, matches: [] }; }
function setIntelligenceSession(interaction, patch) { const next = { ...getIntelligenceSession(interaction), ...patch }; intelligenceSessions.set(sessionKey(interaction), next); return next; }
function configuredGuild(client, id) { return client.guilds.cache.get(String(id || '')) || null; }
function sourceGuildOptions(client, destinationId) {
  return [...client.guilds.cache.values()]
    .filter((guild) => guild.id !== String(destinationId || ''))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
    .slice(0, 25);
}
function registryEnvironments(guild) {
  return Object.keys(guild?.environments || {}).filter(Boolean);
}
function registryGuildOptions(client, destinationId) {
  const destination = String(destinationId || '');
  const merged = new Map();
  for (const item of auditStore.getGuildRegistry?.() || []) {
    const id = String(item?.guildId || '');
    if (!id || id === destination) continue;
    merged.set(id, { ...item, id, name: item.name || id, live: Boolean(client.guilds.cache.has(id)) });
  }
  for (const guild of client.guilds.cache.values()) {
    if (guild.id === destination) continue;
    const current = merged.get(guild.id) || {};
    merged.set(guild.id, { ...current, id: guild.id, name: guild.name || current.name || guild.id, live: true });
  }
  return [...merged.values()]
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
    .slice(0, 25);
}
function registryGuild(client, id) {
  const key = String(id || '');
  if (!key) return null;
  const live = configuredGuild(client, key);
  const stored = (auditStore.getGuildRegistry?.() || []).find((item) => String(item.guildId || '') === key);
  if (!live && !stored) return null;
  return { ...(stored || {}), id: key, name: live?.name || stored?.name || key, live: Boolean(live) };
}
function guildEnvironmentLabel(guild) {
  const modes = registryEnvironments(guild);
  return modes.length ? modes.join(' • ') : (guild?.live ? 'DEV' : 'Registry');
}
function liveProbeCollectorLabel(result) {
  const collector = String(result?.collectorMode || result?.environment || result?.completedBy || '').trim().toUpperCase();
  return collector || (result?.remote ? 'REMOTE' : 'DEV');
}
function liveProbeStatus(result) {
  const collector = liveProbeCollectorLabel(result);
  const duration = Number.isFinite(Number(result?.durationMs)) ? ` • ${Math.max(0, Number(result.durationMs))}ms` : '';
  const lifecycle = result?.lifecycleStatus ? ` • ${String(result.lifecycleStatus).toUpperCase()}` : '';
  if (result?.started) return `🟢 **Live event probe:** executed by **${collector}**${duration}${lifecycle} via temporary hidden channel \`${result.channelName || result.channelId}\`. Expect real **Channel Created** and **Channel Deleted** reports in Guild / System Events.`;
  switch (result?.reason) {
    case 'remote-timeout': return `🟠 **Live event probe:** timed out waiting for **${collector}**${lifecycle}. The remote request did not reach a terminal result within the Command Center wait window; normal route delivery still ran.`;
    case 'expired': return `🟠 **Live event probe:** request expired for **${collector}**${lifecycle} before a collector could complete it. Normal route delivery still ran.`;
    case 'remote-failed': return `🔴 **Live event probe:** remote collector **${collector}** failed the probe${duration}${lifecycle}. Check the collector logs before retrying.`;
    case 'registry-only': return `🟡 **Live event probe:** skipped by **${collector}**${duration}${lifecycle} — that collector does not have live access to this guild. The configured route test still ran normally.`;
    case 'cooldown': return `🟡 **Live event probe:** skipped by **${collector}**${duration}${lifecycle} — the 15-second safety cooldown is active. Wait briefly before another live probe.`;
    case 'missing-manage-channels': return `🔴 **Live event probe:** blocked on **${collector}**${duration}${lifecycle} — Goliath does not have **Manage Channels** in the source guild.`;
    case 'create-failed': return result?.remote
      ? `🔴 **Live event probe:** remote collector **${collector}** failed to create the temporary verification channel${duration}${lifecycle}. Check its guild permissions and collector logs.`
      : `🔴 **Live event probe:** failed on **${collector}**${duration}${lifecycle} — Goliath could not create the temporary hidden verification channel.`;
    case 'invalid-guild': return `🔴 **Live event probe:** unavailable on **${collector}**${duration}${lifecycle} — the selected guild could not be resolved for live verification.`;
    default: return `🟠 **Live event probe:** status unavailable from **${collector}**${duration}${lifecycle}. The normal route-delivery result below is still authoritative.`;
  }
}
function sourceGuildSelect(customId, placeholder, sourceGuilds, selectedId) {
  return new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(sourceGuilds.map((guild) => {
      const modes = registryEnvironments(guild);
      return {
        label: String(guild.name || guild.id).slice(0, 100),
        value: guild.id,
        description: (modes.length ? `${modes.join(' • ')} • ${guild.id}` : `Guild ID: ${guild.id}`).slice(0, 100),
        default: guild.id === selectedId,
      };
    }));
}
function routeSummary(config, sourceGuildId, destinationGuild) {
  const routes = config.guilds?.[String(sourceGuildId || '')]?.routes || {};
  return Object.keys(ROUTE_LABELS).map((key) => {
    const channelId = routes[key];
    if (!channelId) return `⚪ **${ROUTE_LABELS[key]}:** Automatic / not provisioned yet`;
    const channel = destinationGuild?.channels?.cache?.get(String(channelId)) || null;
    if (!channel) return `🔴 **${ROUTE_LABELS[key]}:** <#${channelId}> • Missing channel`;
    const member = destinationGuild?.members?.me || null;
    const permissions = member ? channel.permissionsFor(member) : null;
    const missing = [];
    if (!permissions?.has(PermissionFlagsBits.ViewChannel)) missing.push('View');
    if (!permissions?.has(PermissionFlagsBits.SendMessages)) missing.push('Send');
    if (!permissions?.has(PermissionFlagsBits.ReadMessageHistory)) missing.push('History');
    return `${missing.length ? '🟠' : '🟢'} **${ROUTE_LABELS[key]}:** <#${channelId}>${missing.length ? ` • Missing: ${missing.join(', ')}` : ' • Healthy'}`;
  }).join('\n');
}
function monitoringSummary(config, sourceGuildId) {
  const guildConfig = config.guilds?.[String(sourceGuildId || '')] || {};
  const monitoring = guildConfig.monitoring && typeof guildConfig.monitoring === 'object' ? guildConfig.monitoring : {};
  const lines = Object.entries(MONITOR_LABELS).map(([key, label]) => `${monitoring[key] === false ? '🔴' : '🟢'} **${label}**`);
  return `${guildConfig.enabled === false ? '⏸️ **Guild monitoring paused**' : '▶️ **Guild monitoring active**'}\n\n${lines.join('\n')}`;
}
function buildRoutingPanel(client, interaction) {
  const config = auditStore.getConfig();
  const session = getRoutingSession(interaction);
  const sourceGuilds = registryGuildOptions(client, config.commandCenter?.guildId);
  const selectedGuild = registryGuild(client, session.sourceGuildId);
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('📡 Audit Intelligence Routing')
    .setDescription(selectedGuild ? `Configure where **${selectedGuild.name}** audit events are mirrored inside this private server. Individual user intelligence channels remain intact.` : 'Choose a source guild to configure.')
    .addFields(
      { name: 'Source Guild', value: selectedGuild ? `**${selectedGuild.name}**\n\`${selectedGuild.id}\`\n${guildEnvironmentLabel(selectedGuild)}` : 'Not selected', inline: true },
      { name: 'Route Type', value: ROUTE_LABELS[session.routeKey] || ROUTE_LABELS.default, inline: true },
      { name: 'Current Report Feeds', value: selectedGuild ? routeSummary(config, selectedGuild.id, interaction.guild) : 'Select a guild first.', inline: false },
    )
    .setFooter({ text: 'Goliath Command Center • Routing • Owner only • 🟢 healthy • 🟠 permission issue • 🔴 missing • ⚪ automatic' });
  const rows = [];
  if (sourceGuilds.length) rows.push(new ActionRowBuilder().addComponents(sourceGuildSelect('owner:commandcenter:routing:guild', '1. Select source guild', sourceGuilds, session.sourceGuildId)));
  if (selectedGuild) {
    const routeSelect = new StringSelectMenuBuilder().setCustomId('owner:commandcenter:routing:type').setPlaceholder('2. Select audit event family').setMinValues(1).setMaxValues(1).addOptions(Object.entries(ROUTE_LABELS).map(([value, label]) => ({ label, value, default: value === session.routeKey })));
    rows.push(new ActionRowBuilder().addComponents(routeSelect));
    const channelSelect = new ChannelSelectMenuBuilder().setCustomId('owner:commandcenter:routing:channel').setPlaceholder(`3. Choose destination for ${ROUTE_LABELS[session.routeKey] || 'route'}`).setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(1).setMaxValues(1);
    rows.push(new ActionRowBuilder().addComponents(channelSelect));
    const provisionButton = new ButtonBuilder().setCustomId('owner:commandcenter:routing:provision').setLabel('Create / Repair Report Channels').setEmoji('🛠️').setStyle(ButtonStyle.Success);
    const testButton = new ButtonBuilder().setCustomId('owner:commandcenter:routing:test').setLabel('Send Test Report').setEmoji('🧪').setStyle(ButtonStyle.Primary);
    const resetButton = new ButtonBuilder().setCustomId('owner:commandcenter:routing:reset').setLabel('Reset This Route').setStyle(ButtonStyle.Secondary);
    const backButton = new ButtonBuilder().setCustomId('owner:commandcenter:refresh').setLabel('Back / Refresh Home').setStyle(ButtonStyle.Secondary);
    rows.push(new ActionRowBuilder().addComponents(provisionButton, testButton, resetButton, backButton));
  }
  return { embeds: [embed], components: rows, allowedMentions: { parse: [] } };
}
function buildMonitoringPanel(client, interaction) {
  const config = auditStore.getConfig();
  const session = getMonitoringSession(interaction);
  const sourceGuilds = registryGuildOptions(client, config.commandCenter?.guildId);
  const selectedGuild = registryGuild(client, session.sourceGuildId);
  const guildConfig = selectedGuild ? (config.guilds?.[selectedGuild.id] || {}) : {};
  const monitoring = guildConfig.monitoring && typeof guildConfig.monitoring === 'object' ? guildConfig.monitoring : {};
  const selectedEnabled = monitoring[session.family] !== false;
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('👁️ Audit Intelligence Monitoring')
    .setDescription(selectedGuild ? `Control which **${selectedGuild.name}** events are mirrored into your private Audit Intelligence server. Captured intelligence remains stored even when a mirror family is disabled.` : 'Choose a source guild to configure. All monitoring families default to enabled.')
    .addFields(
      { name: 'Source Guild', value: selectedGuild ? `**${selectedGuild.name}**\n\`${selectedGuild.id}\`\n${guildEnvironmentLabel(selectedGuild)}` : 'Not selected', inline: true },
      { name: 'Selected Family', value: MONITOR_LABELS[session.family] || MONITOR_LABELS.members, inline: true },
      { name: 'Selected Status', value: selectedGuild ? (selectedEnabled ? '🟢 Mirroring enabled' : '🔴 Mirroring disabled') : 'Select a guild first.', inline: true },
      { name: 'Monitoring Status', value: selectedGuild ? monitoringSummary(config, selectedGuild.id) : 'Select a guild first.', inline: false },
    )
    .setFooter({ text: 'Goliath Command Center • Monitoring • Owner only' });
  const rows = [];
  if (sourceGuilds.length) rows.push(new ActionRowBuilder().addComponents(sourceGuildSelect('owner:commandcenter:monitoring:guild', '1. Select source guild', sourceGuilds, session.sourceGuildId)));
  if (selectedGuild) {
    const familySelect = new StringSelectMenuBuilder().setCustomId('owner:commandcenter:monitoring:family').setPlaceholder('2. Select monitoring family').setMinValues(1).setMaxValues(1).addOptions(Object.entries(MONITOR_LABELS).map(([value, label]) => ({ label, value, default: value === session.family })));
    rows.push(new ActionRowBuilder().addComponents(familySelect));
    const toggleFamily = new ButtonBuilder().setCustomId('owner:commandcenter:monitoring:toggle').setLabel(selectedEnabled ? 'Disable Selected' : 'Enable Selected').setStyle(selectedEnabled ? ButtonStyle.Danger : ButtonStyle.Success);
    const toggleGuild = new ButtonBuilder().setCustomId('owner:commandcenter:monitoring:guild-toggle').setLabel(guildConfig.enabled === false ? 'Resume Guild' : 'Pause Guild').setStyle(guildConfig.enabled === false ? ButtonStyle.Success : ButtonStyle.Danger);
    const enableAll = new ButtonBuilder().setCustomId('owner:commandcenter:monitoring:all-on').setLabel('Enable All').setStyle(ButtonStyle.Secondary);
    const backButton = new ButtonBuilder().setCustomId('owner:commandcenter:refresh').setLabel('Back / Refresh Home').setStyle(ButtonStyle.Secondary);
    rows.push(new ActionRowBuilder().addComponents(toggleFamily, toggleGuild, enableAll, backButton));
  }
  return { embeds: [embed], components: rows, allowedMentions: { parse: [] } };
}
function structureRepairSummary(result) {
  if (!result?.before || !result?.after) return null;
  const beforeIssues = Array.isArray(result.before.issues) ? result.before.issues : [];
  const afterIssues = Array.isArray(result.after.issues) ? result.after.issues : [];
  const repaired = beforeIssues.filter((issue) => !afterIssues.includes(issue));
  const lines = [
    result.after.healthy ? '🟢 **Repair complete — structure is healthy.**' : '🟠 **Repair completed with manual attention still required.**',
    `Before: **${beforeIssues.length}** issue(s) • After: **${afterIssues.length}** issue(s)`,
  ];
  if (repaired.length) lines.push('', '**Repaired automatically**', ...repaired.slice(0, 6).map((issue) => `✅ ${issue}`));
  if (afterIssues.length) lines.push('', '**Still requires attention**', ...afterIssues.slice(0, 6).map((issue) => `⚠️ ${issue}`));
  if (!repaired.length && !afterIssues.length) lines.push('', 'No faults remained after the repair/rescan.');
  return lines.join('\n').slice(0, 1024);
}
async function buildStructurePanel(client, interaction) {
  const config = auditStore.getConfig();
  const session = getStructureSession(interaction);
  const sourceGuilds = registryGuildOptions(client, config.commandCenter?.guildId);
  const selectedGuild = registryGuild(client, session.sourceGuildId);
  const report = selectedGuild ? await auditRouter.inspectStructure(client, selectedGuild) : null;
  const status = !report ? 'Select a guild first.' : report.healthy ? '🟢 Healthy' : report.systemChannel ? '🟠 Attention required' : '⚪ Not provisioned';
  const placement = !report?.systemChannel ? 'Not provisioned' : report.systemChannel.parentId ? `<#${report.systemChannel.id}> inside a category` : `<#${report.systemChannel.id}> uncategorised`;
  const issues = report?.issues?.length ? report.issues.map((issue) => `• ${issue}`).join('\n') : 'None';
  const categories = report?.categories?.length ? report.categories.map((category) => `• **${category.name}** — ${category.childCount} channel(s)`).join('\n') : 'None / owner-managed placement';
  const repairSummary = structureRepairSummary(session.repairResult);
  const embed = new EmbedBuilder()
    .setColor(report?.healthy ? 0x57F287 : report?.systemChannel ? 0xFEE75C : 0x5865F2)
    .setTitle('📁 Audit Intelligence Structure')
    .setDescription(selectedGuild ? `Inspect and safely provision/repair **${selectedGuild.name}**. Goliath identifies resources by internal markers, so renamed or moved channels remain valid.` : 'Choose a source guild to inspect or provision.')
    .addFields(
      { name: 'Source Guild', value: selectedGuild ? `**${selectedGuild.name}**\n\`${selectedGuild.id}\`\n${guildEnvironmentLabel(selectedGuild)}` : 'Not selected', inline: true },
      { name: 'Status', value: status, inline: true },
      { name: 'Guild Events', value: placement, inline: false },
      { name: 'User Intelligence Channels', value: report ? String(report.userChannelCount) : '—', inline: true },
      { name: 'Categories In Use', value: report ? String(report.categoryCount) : '—', inline: true },
      { name: 'Missing Routes', value: report ? String(report.missingRouteCount) : '—', inline: true },
      { name: 'Detected Categories', value: categories.slice(0, 1024), inline: false },
      { name: 'Issues', value: issues.slice(0, 1024), inline: false },
      ...(repairSummary ? [{ name: 'Last Repair Result', value: repairSummary, inline: false }] : []),
    )
    .setFooter({ text: 'Goliath Command Center • Structure • Owner only • Repair never renames or moves valid resources' });
  const rows = [];
  if (sourceGuilds.length) rows.push(new ActionRowBuilder().addComponents(sourceGuildSelect('owner:commandcenter:structure:guild', '1. Select source guild', sourceGuilds, session.sourceGuildId)));
  if (selectedGuild) {
    const repairButton = new ButtonBuilder().setCustomId('owner:commandcenter:structure:repair').setLabel(report?.systemChannel ? 'Repair Structure' : 'Provision Structure').setStyle(report?.healthy ? ButtonStyle.Secondary : ButtonStyle.Primary);
    const rescanButton = new ButtonBuilder().setCustomId('owner:commandcenter:structure:rescan').setLabel('Rescan').setStyle(ButtonStyle.Secondary);
    const backButton = new ButtonBuilder().setCustomId('owner:commandcenter:refresh').setLabel('Back / Refresh Home').setStyle(ButtonStyle.Secondary);
    rows.push(new ActionRowBuilder().addComponents(repairButton, rescanButton, backButton));
  }
  return { embeds: [embed], components: rows, allowedMentions: { parse: [] } };
}

function intelligenceMemberLabel(member) {
  return member?.displayName || member?.user?.globalName || member?.user?.username || member?.id || 'Unknown user';
}
function intelligenceMatchKindLabel(kind) {
  return ({ id: 'ID', username: 'username', globalName: 'global name', displayName: 'display name', nickname: 'nickname', liveSearch: 'live Discord search' })[kind] || String(kind || 'identity');
}
function intelligenceMatchEvidence(match) {
  if (!match?.matchedOn || match.matchedValue == null) return null;
  return `Matched ${intelligenceMatchKindLabel(match.matchedOn)}: \`${String(match.matchedValue).slice(0, 80)}\``;
}
function intelligenceSearchModal() {
  const input = new TextInputBuilder()
    .setCustomId('query')
    .setLabel('Discord user ID or username')
    .setPlaceholder('Example: 123456789012345678 or username')
    .setStyle(TextInputStyle.Short)
    .setMinLength(2)
    .setMaxLength(100)
    .setRequired(true);
  return new ModalBuilder()
    .setCustomId('owner:commandcenter:intelligence:search-submit')
    .setTitle('Search User Intelligence')
    .addComponents(new ActionRowBuilder().addComponents(input));
}
async function buildIntelligencePanel(client, interaction) {
  const config = auditStore.getConfig();
  const session = getIntelligenceSession(interaction);
  const sourceGuilds = registryGuildOptions(client, config.commandCenter?.guildId);
  const sourceGuild = registryGuild(client, session.sourceGuildId);
  const report = sourceGuild && session.userId ? await buildReport(client, session.userId) : null;
  const liveGuild = sourceGuild ? configuredGuild(client, sourceGuild.id) : null;
  const selectedMatch = session.userId ? session.matches?.find((match) => String(match.id) === String(session.userId)) : null;
  const selectedEvidence = intelligenceMatchEvidence(selectedMatch);
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🔎 User Intelligence Lookup')
    .setDescription(sourceGuild
      ? `Search **${sourceGuild.name}** by Discord **user ID or username**. Goliath combines live Discord state when available with stored Audit Intelligence from every environment that has observed this guild.`
      : 'Choose the source guild that contains, or previously contained, the user you want to investigate.')
    .addFields(
      { name: 'Source Guild', value: sourceGuild ? `**${sourceGuild.name}**\n\`${sourceGuild.id}\`\n${guildEnvironmentLabel(sourceGuild)}` : 'Not selected', inline: true },
      { name: 'Live Access', value: sourceGuild ? (liveGuild ? '🟢 DEV has live access' : '🟡 Registry / stored intelligence') : '—', inline: true },
      { name: 'Selected User', value: session.userId ? `<@${session.userId}>\n\`${session.userId}\`${selectedEvidence ? `\n${selectedEvidence}` : ''}` : 'Not selected', inline: true },
      { name: 'Search Results', value: session.matches?.length ? `${session.matches.length} matching user(s)` : 'None / not searched', inline: true },
    )
    .setFooter({ text: 'Goliath Command Center • User Intelligence • Cross-mode stored search • Owner only' });
  const rows = [];
  if (sourceGuilds.length) rows.push(new ActionRowBuilder().addComponents(sourceGuildSelect('owner:commandcenter:intelligence:guild', '1. Select source guild', sourceGuilds, session.sourceGuildId)));
  if (sourceGuild) {
    const searchButton = new ButtonBuilder().setCustomId('owner:commandcenter:intelligence:search').setLabel('Search User').setEmoji('🔎').setStyle(ButtonStyle.Primary);
    const resetButton = new ButtonBuilder().setCustomId('owner:commandcenter:intelligence:reset').setLabel('Reset User').setStyle(ButtonStyle.Secondary).setDisabled(!session.userId && !session.matches?.length);
    const backButton = new ButtonBuilder().setCustomId('owner:commandcenter:refresh').setLabel('Back / Refresh Home').setStyle(ButtonStyle.Secondary);
    rows.push(new ActionRowBuilder().addComponents(searchButton, resetButton, backButton));
  }
  if (sourceGuild && session.matches?.length > 1) {
    const resultSelect = new StringSelectMenuBuilder()
      .setCustomId('owner:commandcenter:intelligence:result')
      .setPlaceholder('2. Select matching user')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(session.matches.slice(0, 25).map((match) => ({
        label: String(match.label || match.id).slice(0, 100),
        value: match.id,
        description: `${match.environments?.length ? `${match.environments.join(' • ')} • ` : ''}${match.matchedOn && match.matchedValue != null ? `Matched ${intelligenceMatchKindLabel(match.matchedOn)}: ${String(match.matchedValue)} • ` : ''}User ID: ${match.id}`.slice(0, 100),
        default: match.id === session.userId,
      })));
    rows.push(new ActionRowBuilder().addComponents(resultSelect));
  }
  if (sourceGuild && session.userId) {
    const channelButton = new ButtonBuilder().setCustomId('owner:commandcenter:intelligence:channel').setLabel('Create / Open Intelligence Channel').setEmoji('📂').setStyle(ButtonStyle.Success);
    rows.push(new ActionRowBuilder().addComponents(channelButton));
  }
  return { embeds: report ? [embed, buildUserIntelligenceEmbed(report, sourceGuild)] : [embed], components: rows, allowedMentions: { parse: [] } };
}
async function searchIntelligenceUser(client, sourceGuild, query) {
  const value = String(query || '').trim();
  if (!sourceGuild || !value) return [];
  const merged = new Map();
  const add = (entry) => {
    if (!entry?.id) return;
    const current = merged.get(String(entry.id)) || { id: String(entry.id), label: entry.label || String(entry.id), environments: [], matchedOn: entry.matchedOn || null, matchedValue: entry.matchedValue ?? null };
    if (entry.label && (!current.label || current.label === current.id)) current.label = entry.label;
    if (entry.matchedOn && entry.matchedValue != null) { current.matchedOn = entry.matchedOn; current.matchedValue = entry.matchedValue; }
    current.environments = [...new Set([...(current.environments || []), ...(entry.environments || [])])];
    merged.set(current.id, current);
  };
  for (const entry of auditStore.searchUsersAcrossModes?.(value, { guildId: sourceGuild.id, limit: 25 }) || []) add(entry);
  const liveGuild = configuredGuild(client, sourceGuild.id);
  if (liveGuild) {
    if (/^\d{16,22}$/.test(value)) {
      const member = await liveGuild.members.fetch(value).catch(() => null);
      if (member) add({ id: member.id, label: intelligenceMemberLabel(member), environments: ['DEV'], matchedOn: 'id', matchedValue: value });
    } else {
      const members = await liveGuild.members.search({ query: value, limit: 25 }).catch(() => null);
      for (const member of members?.values?.() || []) add({ id: member.id, label: intelligenceMemberLabel(member), environments: ['DEV'], matchedOn: 'liveSearch', matchedValue: value });
    }
  }
  if (/^\d{16,22}$/.test(value) && !merged.has(value)) {
    const stored = auditStore.getUserAcrossModes?.(value);
    if (stored?.guilds?.[sourceGuild.id]) add({ id: value, label: stored.displayNames?.at?.(-1) || stored.globalNames?.at?.(-1) || stored.names?.at?.(-1) || `Stored user ${value}`, environments: Object.keys(stored.environments || {}), matchedOn: 'id', matchedValue: value });
  }
  return [...merged.values()].slice(0, 25);
}

function healthRepairSummary(result) {
  if (!result?.before || !result?.after) return null;
  const beforeIssues = Array.isArray(result.before.issues) ? result.before.issues : [];
  const afterIssues = Array.isArray(result.after.issues) ? result.after.issues : [];
  const repairedGuilds = (result.actions || []).filter((action) => action.type === 'guild-structure' && action.repaired).length;
  const failedGuilds = (result.actions || []).filter((action) => action.type === 'guild-structure' && !action.repaired).length;
  const commandCenterAction = (result.actions || []).find((action) => action.type === 'command-center');
  const lines = [
    result.after.healthy ? '🟢 **Health repair complete — all critical checks are passing.**' : result.improved ? '🟡 **Health repair improved the system, but attention is still required.**' : '🟠 **Health repair completed, but no measurable health improvement was confirmed.**',
    `Critical issues: **${beforeIssues.length} → ${afterIssues.length}**`,
    `Structural failures: **${result.before.counts?.structuralFailures || 0} → ${result.after.counts?.structuralFailures || 0}**`,
  ];
  if (commandCenterAction) lines.push(`Command Center: ${commandCenterAction.repaired ? '✅ repaired' : '⚠️ repair attempted'}`);
  if (repairedGuilds || failedGuilds) lines.push(`Guild structures: **${repairedGuilds} repaired**${failedGuilds ? ` • **${failedGuilds} still unhealthy**` : ''}`);
  const remaining = afterIssues.slice(0, 5);
  if (remaining.length) lines.push('', '**Still requires attention**', ...remaining.map((issue) => `⚠️ ${issue}`));
  return lines.join('\n').slice(0, 1024);
}
async function buildHealthPanel(client, repairResult = null) {
  const report = await auditRouter.inspectHealth(client);
  const commandCenter = report.commandCenter || {};
  const permissions = commandCenter.permissions || {};
  const counts = report.counts || {};
  const issueLines = report.issues?.length ? report.issues.map((issue) => `• ${issue}`) : ['None'];
  const guildIssueLines = report.guilds
    .filter((guild) => !guild.healthy)
    .slice(0, 12)
    .map((guild) => `• **${guild.guildName || guild.guildId}** — ${guild.issues.join('; ')}`);
  const repairSummary = healthRepairSummary(repairResult);
  const embed = new EmbedBuilder()
    .setColor(report.healthy ? 0x57F287 : 0xED4245)
    .setTitle('🩺 Audit Intelligence Health')
    .setDescription(report.healthy ? 'All critical Audit Intelligence health checks are passing.' : 'One or more Audit Intelligence health checks need attention.')
    .addFields(
      { name: 'Environment', value: report.environment || 'Unknown', inline: true },
      { name: 'Overall', value: report.healthy ? '🟢 Healthy' : '🔴 Attention required', inline: true },
      { name: 'Destination', value: report.destination ? `**${report.destination.name}**\n\`${report.destination.id}\`` : 'Unavailable', inline: true },
      { name: 'Command Center', value: [
        `Channel: ${commandCenter.channelId ? `<#${commandCenter.channelId}>` : 'Missing'}`,
        `Panel message: ${commandCenter.messagePresent ? '🟢 Present' : '🔴 Missing'}`,
        `Owner access: ${permissions.owner ? '🟢' : '🔴'}`,
        `Goliath access: ${permissions.bot ? '🟢' : '🔴'}`,
        `@everyone hidden: ${permissions.everyone === false ? '🟢' : '🔴'}`,
      ].join('\n'), inline: false },
      { name: '/commandcenter Privacy', value: [
        `Private registration: ${commandCenter.privateCommandRegistered ? '🟢 Present' : '🔴 Missing'}`,
        `Global exposure: ${commandCenter.globalCommandLeaked ? '🔴 LEAKED' : '🟢 None'}`,
      ].join('\n'), inline: false },
      { name: 'Monitored Guilds', value: [
        `Configured: **${counts.configured || 0}**`,
        `Healthy: **${counts.healthy || 0}**`,
        `Structural failures: **${counts.structuralFailures || 0}**`,
        `Unavailable: **${counts.unavailable || 0}**`,
        `Paused: **${counts.paused || 0}**`,
        `Partially disabled: **${counts.partiallyDisabled || 0}**`,
      ].join('\n'), inline: false },
      { name: 'Critical Issues', value: issueLines.join('\n').slice(0, 1024), inline: false },
      { name: 'Guild Attention', value: (guildIssueLines.length ? guildIssueLines.join('\n') : 'None').slice(0, 1024), inline: false },
      ...(repairSummary ? [{ name: 'Last Health Repair', value: repairSummary, inline: false }] : []),
    )
    .setFooter({ text: `Goliath Command Center • Health • Owner only • Checked ${report.checkedAt || 'now'}` });
  const repairButton = new ButtonBuilder().setCustomId('owner:commandcenter:health:repair').setLabel('Repair Health').setEmoji('🛠️').setStyle(report.healthy ? ButtonStyle.Secondary : ButtonStyle.Success).setDisabled(report.healthy);
  const rescanButton = new ButtonBuilder().setCustomId('owner:commandcenter:health:rescan').setLabel('Rescan Health').setStyle(ButtonStyle.Primary);
  const backButton = new ButtonBuilder().setCustomId('owner:commandcenter:refresh').setLabel('Back / Refresh Home').setStyle(ButtonStyle.Secondary);
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(repairButton, rescanButton, backButton)], allowedMentions: { parse: [] } };
}

async function ensurePrivateCommandRegistration(client, guildId) {
  if (!client?.application || !guildId) return false;
  const ownerGuild = client.guilds.cache.get(String(guildId)) || await client.guilds.fetch(String(guildId)).catch(() => null);
  if (!ownerGuild) return false;
  if (!commandCenterUiEnabled()) {
    try {
      const globals = await client.application.commands.fetch();
      const leaked = globals.find((command) => command.name === 'commandcenter');
      if (leaked) await leaked.delete();
    } catch (error) { console.warn('[Audit Intelligence] Non-DEV global /commandcenter cleanup failed:', error?.message || error); }
    try {
      const commands = await ownerGuild.commands.fetch();
      const existing = commands.find((command) => command.name === 'commandcenter');
      if (existing) await existing.delete();
    } catch (error) { console.warn('[Audit Intelligence] Non-DEV private /commandcenter cleanup failed:', error?.message || error); }
    console.log(`[Audit Intelligence] ${String(process.env.BOT_MODE || '').toUpperCase()} uses shared Command Center destination without its own UI.`);
    return true;
  }
  try {
    const globals = await client.application.commands.fetch();
    const leaked = globals.find((command) => command.name === 'commandcenter');
    if (leaked) { await leaked.delete(); console.warn('[Audit Intelligence] Removed leaked global /commandcenter registration.'); }
  } catch (error) { console.warn('[Audit Intelligence] Global command privacy check failed:', error?.message || error); }
  try {
    const commands = await ownerGuild.commands.fetch();
    const existing = commands.find((command) => command.name === 'commandcenter');
    const payload = module.exports.data.toJSON();
    if (existing) await existing.edit(payload); else await ownerGuild.commands.create(payload);
    console.log(`[Audit Intelligence] /commandcenter registered privately in ${ownerGuild.name} (${ownerGuild.id}).`);
    return true;
  } catch (error) { console.warn('[Audit Intelligence] Private /commandcenter registration failed:', error?.message || error); return false; }
}
async function sendCommandCenterSetupDm(client) {
  if (!commandCenterUiEnabled()) return false;
  const ownerId = security.getBotOwnerId();
  if (!ownerId) { console.warn('[Audit Intelligence] Command Center bootstrap skipped: no configured Goliath owner.'); return false; }
  const user = await client.users.fetch(ownerId).catch(() => null);
  if (!user) return false;
  const dm = await user.createDM().catch(() => null);
  if (!dm) { console.warn('[Audit Intelligence] Unable to DM the Goliath owner for Command Center setup.'); return false; }
  await dm.send(buildCommandCenterSetup(client)).catch((error) => console.warn('[Audit Intelligence] Command Center setup DM failed:', error?.message || error));
  return true;
}
async function initializeCommandCenter(client) {
  const config = auditStore.getConfig();
  const guildId = String(config.commandCenter?.guildId || '');
  if (!guildId) return sendCommandCenterSetupDm(client);
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) { console.warn(`[Audit Intelligence] Configured Command Center guild ${guildId} is unavailable.`); return false; }
  if (!commandCenterUiEnabled()) return ensurePrivateCommandRegistration(client, guild.id);
  await auditRouter.ensureCommandCenter(client, guild);
  return ensurePrivateCommandRegistration(client, guild.id);
}

async function handleCommandCenterInteraction(client, interaction) {
  const customId = String(interaction?.customId || '');
  if (!customId.startsWith('owner:commandcenter:')) return false;
  if (!commandCenterUiEnabled()) return false;
  if (!security.isBotOwner(interaction.user?.id)) {
    if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: '❌ Owner-only control.', flags: MessageFlags.Ephemeral }).catch(() => null);
    return true;
  }
  if (customId === 'owner:commandcenter:destination' && interaction.isStringSelectMenu?.()) {
    const guildId = String(interaction.values?.[0] || '');
    const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) { await interaction.update({ content: '❌ That guild is no longer available to Goliath.', embeds: [], components: [] }).catch(() => null); return true; }
    const ownerMember = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!ownerMember) { await interaction.update({ content: '❌ You must be a member of the selected private server.', embeds: [], components: [] }).catch(() => null); return true; }
    auditStore.updateConfig({ commandCenter: { guildId: guild.id, categoryId: null, channelId: null, messageId: null } });
    const context = await auditRouter.ensureCommandCenter(client, guild);
    const registered = await ensurePrivateCommandRegistration(client, guild.id);
    const link = context?.channel ? `https://discord.com/channels/${guild.id}/${context.channel.id}` : null;
    await interaction.update({ content: registered ? `✅ **Goliath Command Center secured.**\n\nDestination: **${guild.name}**\n/commandcenter is registered **only** in that server.${link ? `\n\nOpen: ${link}` : ''}` : `⚠️ Command Center channels were prepared in **${guild.name}**, but private command registration needs attention.`, embeds: [], components: [] }).catch(() => null);
    return true;
  }
  const config = auditStore.getConfig();
  if (!config.commandCenter?.guildId || String(interaction.guildId || '') !== String(config.commandCenter.guildId)) {
    if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: '❌ This control is only valid inside your private Goliath Command Center server.', flags: MessageFlags.Ephemeral }).catch(() => null);
    return true;
  }
  if (customId === 'owner:commandcenter:refresh' && interaction.isButton?.()) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
    const context = await auditRouter.ensureCommandCenter(client, interaction.guild);
    await interaction.editReply({ content: context ? '✅ Command Center refreshed.' : '❌ Command Center refresh failed.' }).catch(() => null);
    return true;
  }
  if (customId === 'owner:commandcenter:routing' && interaction.isButton?.()) {
    routingSessions.set(sessionKey(interaction), { sourceGuildId: null, routeKey: 'default' });
    await interaction.reply({ ...buildRoutingPanel(client, interaction), flags: MessageFlags.Ephemeral }).catch(() => null); return true;
  }
  if (customId === 'owner:commandcenter:routing:guild' && interaction.isStringSelectMenu?.()) { setRoutingSession(interaction, { sourceGuildId: interaction.values?.[0] || null, routeKey: 'default' }); await interaction.update(buildRoutingPanel(client, interaction)).catch(() => null); return true; }
  if (customId === 'owner:commandcenter:routing:type' && interaction.isStringSelectMenu?.()) { const routeKey = String(interaction.values?.[0] || 'default'); setRoutingSession(interaction, { routeKey: ROUTE_LABELS[routeKey] ? routeKey : 'default' }); await interaction.update(buildRoutingPanel(client, interaction)).catch(() => null); return true; }
  if (customId === 'owner:commandcenter:routing:channel' && interaction.isChannelSelectMenu?.()) {
    const session = getRoutingSession(interaction); if (!session.sourceGuildId) return true;
    const current = auditStore.getConfig(); const existing = current.guilds?.[session.sourceGuildId] || {};
    auditStore.updateConfig({ guilds: { [session.sourceGuildId]: { ...existing, enabled: existing.enabled !== false, mode: 'custom', routes: { ...(existing.routes || {}), [session.routeKey]: String(interaction.values?.[0] || '') } } } });
    await interaction.update(buildRoutingPanel(client, interaction)).catch(() => null); return true;
  }
  if (customId === 'owner:commandcenter:routing:provision' && interaction.isButton?.()) {
    const session = getRoutingSession(interaction);
    const sourceGuild = registryGuild(client, session.sourceGuildId);
    if (!sourceGuild) { await interaction.reply({ content: '❌ Select a source guild first.', flags: MessageFlags.Ephemeral }).catch(() => null); return true; }
    await interaction.deferUpdate().catch(() => null);
    const result = await auditRouter.ensureReportRoutes(client, sourceGuild).catch((error) => { console.warn('[Audit Intelligence] report channel provisioning failed:', error?.message || error); return null; });
    if (!result) { await interaction.editReply({ content: '❌ Report channels could not be prepared.', embeds: [], components: [] }).catch(() => null); return true; }
    await interaction.editReply(buildRoutingPanel(client, interaction)).catch(() => null);
    return true;
  }
  if (customId === 'owner:commandcenter:routing:test' && interaction.isButton?.()) {
    const session = getRoutingSession(interaction);
    const sourceGuild = registryGuild(client, session.sourceGuildId);
    if (!sourceGuild) { await interaction.reply({ content: '❌ Select a source guild first.', flags: MessageFlags.Ephemeral }).catch(() => null); return true; }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
    await auditRouter.ensureReportRoutes(client, sourceGuild).catch(() => null);
    const categoryByRoute = { guild: 'guild', members: 'member', moderation: 'moderation', security: 'security', messages: 'message', voice: 'voice', roles: 'role', goliath: 'goliath', default: 'guild' };
    const syntheticEvent = { type: `routing-check.${session.routeKey}`, category: categoryByRoute[session.routeKey] || 'guild' };
    const destination = await auditRouter.configuredRouteChannel(client, sourceGuild, syntheticEvent).catch(() => null);
    if (!destination?.isTextBased?.()) { await interaction.editReply({ content: '❌ No usable destination exists for that report family. Use Create / Repair Report Channels first.' }).catch(() => null); return true; }
    const probe = await auditRouter.runLiveEndToEndProbe(client, sourceGuild).catch((error) => { console.warn('[Audit Intelligence] live routing probe failed:', error?.message || error); return { started: false, reason: 'create-failed' }; });
    const probeStatus = liveProbeStatus(probe);
    const familyLabel = ROUTE_LABELS[session.routeKey] || ROUTE_LABELS.default;
    const testEmbed = new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle('🧪 Goliath Audit Feed Test')
      .setDescription('This is a live routing test from the private Goliath Command Center. No fake audit history was stored.')
      .addFields(
        { name: 'Source Guild', value: `**${sourceGuild.name || sourceGuild.id}**\n\`${sourceGuild.id}\``, inline: true },
        { name: 'Report Family', value: familyLabel, inline: true },
        { name: 'Destination', value: `<#${destination.id}>`, inline: true },
        { name: 'Requested By', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Environment Coverage', value: guildEnvironmentLabel(sourceGuild), inline: true },
        { name: 'Probe Collector', value: `**${liveProbeCollectorLabel(probe)}**${Number.isFinite(Number(probe?.durationMs)) ? `\n${Math.max(0, Number(probe.durationMs))}ms` : ''}`, inline: true },
        { name: 'Route Status', value: '🟢 Route resolved', inline: true },
        { name: 'Live End-to-End Probe', value: probeStatus, inline: false },
      )
      .setFooter({ text: 'Goliath Audit Intelligence • Test report only' })
      .setTimestamp();
    const sent = await destination.send({ embeds: [testEmbed], allowedMentions: { parse: [] } }).catch((error) => { console.warn('[Audit Intelligence] test report delivery failed:', error?.message || error); return null; });
    const link = sent ? `https://discord.com/channels/${interaction.guildId}/${destination.id}/${sent.id}` : null;
    const deliveryStatus = sent ? `✅ **Normal route delivery:** test report delivered to <#${destination.id}>.${link ? `\n${link}` : ''}` : '❌ **Normal route delivery:** Goliath resolved the route but could not send into the destination channel.';
    await interaction.editReply({ content: `${deliveryStatus}\n\n${probeStatus}` }).catch(() => null);
    return true;
  }
  if (customId === 'owner:commandcenter:routing:reset' && interaction.isButton?.()) {
    const session = getRoutingSession(interaction); if (!session.sourceGuildId) return true;
    const current = auditStore.getConfig(); const existing = current.guilds?.[session.sourceGuildId] || {}; const routes = { ...(existing.routes || {}) }; delete routes[session.routeKey];
    auditStore.updateConfig({ guilds: { [session.sourceGuildId]: { ...existing, routes, mode: Object.keys(routes).length ? 'custom' : 'auto' } } });
    await interaction.update(buildRoutingPanel(client, interaction)).catch(() => null); return true;
  }
  if (customId === 'owner:commandcenter:monitoring' && interaction.isButton?.()) { monitoringSessions.set(sessionKey(interaction), { sourceGuildId: null, family: 'members' }); await interaction.reply({ ...buildMonitoringPanel(client, interaction), flags: MessageFlags.Ephemeral }).catch(() => null); return true; }
  if (customId === 'owner:commandcenter:monitoring:guild' && interaction.isStringSelectMenu?.()) { setMonitoringSession(interaction, { sourceGuildId: interaction.values?.[0] || null, family: 'members' }); await interaction.update(buildMonitoringPanel(client, interaction)).catch(() => null); return true; }
  if (customId === 'owner:commandcenter:monitoring:family' && interaction.isStringSelectMenu?.()) { const family = String(interaction.values?.[0] || 'members'); setMonitoringSession(interaction, { family: MONITOR_LABELS[family] ? family : 'members' }); await interaction.update(buildMonitoringPanel(client, interaction)).catch(() => null); return true; }
  if (customId === 'owner:commandcenter:monitoring:toggle' && interaction.isButton?.()) {
    const session = getMonitoringSession(interaction); if (!session.sourceGuildId) return true;
    const current = auditStore.getConfig(); const existing = current.guilds?.[session.sourceGuildId] || {}; const monitoring = { ...(existing.monitoring || {}) }; monitoring[session.family] = monitoring[session.family] === false;
    auditStore.updateConfig({ guilds: { [session.sourceGuildId]: { ...existing, monitoring } } }); await interaction.update(buildMonitoringPanel(client, interaction)).catch(() => null); return true;
  }
  if (customId === 'owner:commandcenter:monitoring:guild-toggle' && interaction.isButton?.()) {
    const session = getMonitoringSession(interaction); if (!session.sourceGuildId) return true;
    const current = auditStore.getConfig(); const existing = current.guilds?.[session.sourceGuildId] || {};
    auditStore.updateConfig({ guilds: { [session.sourceGuildId]: { ...existing, enabled: existing.enabled === false } } }); await interaction.update(buildMonitoringPanel(client, interaction)).catch(() => null); return true;
  }
  if (customId === 'owner:commandcenter:monitoring:all-on' && interaction.isButton?.()) {
    const session = getMonitoringSession(interaction); if (!session.sourceGuildId) return true;
    const current = auditStore.getConfig(); const existing = current.guilds?.[session.sourceGuildId] || {}; const monitoring = Object.fromEntries(Object.keys(MONITOR_LABELS).map((key) => [key, true]));
    auditStore.updateConfig({ guilds: { [session.sourceGuildId]: { ...existing, enabled: true, monitoring } } }); await interaction.update(buildMonitoringPanel(client, interaction)).catch(() => null); return true;
  }
  if (customId === 'owner:commandcenter:structure' && interaction.isButton?.()) {
    structureSessions.set(sessionKey(interaction), { sourceGuildId: null, repairResult: null });
    await interaction.reply({ ...(await buildStructurePanel(client, interaction)), flags: MessageFlags.Ephemeral }).catch(() => null); return true;
  }
  if (customId === 'owner:commandcenter:structure:guild' && interaction.isStringSelectMenu?.()) {
    const sourceGuildId = String(interaction.values?.[0] || ''); setStructureSession(interaction, { sourceGuildId, repairResult: null });
    const current = auditStore.getConfig(); const existing = current.guilds?.[sourceGuildId] || {};
    auditStore.updateConfig({ guilds: { [sourceGuildId]: { enabled: existing.enabled !== false, mode: existing.mode || 'auto', ...existing } } });
    await interaction.update(await buildStructurePanel(client, interaction)).catch(() => null); return true;
  }
  if (customId === 'owner:commandcenter:structure:rescan' && interaction.isButton?.()) { setStructureSession(interaction, { repairResult: null }); await interaction.update(await buildStructurePanel(client, interaction)).catch(() => null); return true; }
  if (customId === 'owner:commandcenter:structure:repair' && interaction.isButton?.()) {
    const session = getStructureSession(interaction); const sourceGuild = registryGuild(client, session.sourceGuildId); if (!sourceGuild) return true;
    await interaction.deferUpdate().catch(() => null);
    const repairResult = await auditRouter.repairStructure(client, sourceGuild).catch((error) => { console.warn('[Audit Intelligence] structure repair failed:', error?.message || error); return null; });
    setStructureSession(interaction, { repairResult });
    await interaction.editReply(await buildStructurePanel(client, interaction)).catch(() => null); return true;
  }
  if (customId === 'owner:commandcenter:intelligence' && interaction.isButton?.()) {
    intelligenceSessions.set(sessionKey(interaction), { sourceGuildId: null, userId: null, matches: [] });
    await interaction.reply({ ...(await buildIntelligencePanel(client, interaction)), flags: MessageFlags.Ephemeral }).catch(() => null); return true;
  }
  if (customId === 'owner:commandcenter:intelligence:guild' && interaction.isStringSelectMenu?.()) {
    setIntelligenceSession(interaction, { sourceGuildId: String(interaction.values?.[0] || ''), userId: null, matches: [] });
    await interaction.update(await buildIntelligencePanel(client, interaction)).catch(() => null); return true;
  }
  if (customId === 'owner:commandcenter:intelligence:search' && interaction.isButton?.()) {
    const session = getIntelligenceSession(interaction);
    if (!session.sourceGuildId) { await interaction.reply({ content: '❌ Select a source guild first.', flags: MessageFlags.Ephemeral }).catch(() => null); return true; }
    await interaction.showModal(intelligenceSearchModal()).catch(() => null); return true;
  }
  if (customId === 'owner:commandcenter:intelligence:search-submit' && interaction.isModalSubmit?.()) {
    const session = getIntelligenceSession(interaction);
    const sourceGuild = registryGuild(client, session.sourceGuildId);
    if (!sourceGuild) { await interaction.reply({ content: '❌ The selected source guild is no longer known to Goliath.', flags: MessageFlags.Ephemeral }).catch(() => null); return true; }
    const query = interaction.fields.getTextInputValue('query');
    const matches = await searchIntelligenceUser(client, sourceGuild, query);
    const userId = matches.length === 1 ? matches[0].id : null;
    setIntelligenceSession(interaction, { matches, userId });
    await interaction.update(await buildIntelligencePanel(client, interaction)).catch(() => null); return true;
  }
  if (customId === 'owner:commandcenter:intelligence:result' && interaction.isStringSelectMenu?.()) {
    setIntelligenceSession(interaction, { userId: String(interaction.values?.[0] || '') });
    await interaction.update(await buildIntelligencePanel(client, interaction)).catch(() => null); return true;
  }
  if (customId === 'owner:commandcenter:intelligence:reset' && interaction.isButton?.()) {
    setIntelligenceSession(interaction, { userId: null, matches: [] });
    await interaction.update(await buildIntelligencePanel(client, interaction)).catch(() => null); return true;
  }
  if (customId === 'owner:commandcenter:intelligence:channel' && interaction.isButton?.()) {
    const session = getIntelligenceSession(interaction);
    const sourceGuild = registryGuild(client, session.sourceGuildId);
    if (!sourceGuild || !session.userId) return true;
    const liveGuild = configuredGuild(client, sourceGuild.id);
    const member = liveGuild ? await liveGuild.members.fetch(session.userId).catch(() => null) : null;
    const stored = auditStore.getUserAcrossModes?.(session.userId);
    const user = member?.user || await client.users.fetch(session.userId).catch(() => null) || {
      id: session.userId,
      username: stored?.names?.at?.(-1) || `user-${String(session.userId).slice(-6)}`,
      globalName: stored?.globalNames?.at?.(-1) || null,
    };
    const channel = await auditRouter.ensureUserAuditChannel(client, sourceGuild, { user });
    const link = channel ? `https://discord.com/channels/${interaction.guildId}/${channel.id}` : null;
    await interaction.reply({ content: link ? `✅ Intelligence channel ready: ${link}` : '❌ Intelligence channel could not be prepared.', flags: MessageFlags.Ephemeral }).catch(() => null); return true;
  }
  if (customId === 'owner:commandcenter:health' && interaction.isButton?.()) {
    await interaction.reply({ ...(await buildHealthPanel(client)), flags: MessageFlags.Ephemeral }).catch(() => null); return true;
  }
  if (customId === 'owner:commandcenter:health:repair' && interaction.isButton?.()) {
    await interaction.deferUpdate().catch(() => null);
    const repairResult = await auditRouter.repairHealth(client).catch((error) => { console.warn('[Audit Intelligence] health repair failed:', error?.message || error); return null; });
    await interaction.editReply(await buildHealthPanel(client, repairResult)).catch(() => null); return true;
  }
  if (customId === 'owner:commandcenter:health:rescan' && interaction.isButton?.()) {
    await interaction.deferUpdate().catch(() => null);
    await interaction.editReply(await buildHealthPanel(client)).catch(() => null); return true;
  }
  if (interaction.isButton?.()) { await interaction.reply({ content: 'ℹ️ This Command Center section is ready for the next build phase.', flags: MessageFlags.Ephemeral }).catch(() => null); return true; }
  return false;
}

function auditChannelContext(channel) {
  const userMatch = String(channel?.topic || '').match(/GOLIATH_AUDIT_USER:(\d+):(\d+)/);
  return userMatch ? { sourceGuildId: userMatch[1], userId: userMatch[2] } : null;
}
function interactionKind(interaction) {
  if (interaction?.isChatInputCommand?.()) return 'command';
  if (interaction?.isButton?.()) return 'button';
  if (interaction?.isStringSelectMenu?.()) return 'string-select';
  if (interaction?.isUserSelectMenu?.()) return 'user-select';
  if (interaction?.isRoleSelectMenu?.()) return 'role-select';
  if (interaction?.isChannelSelectMenu?.()) return 'channel-select';
  if (interaction?.isMentionableSelectMenu?.()) return 'mentionable-select';
  if (interaction?.isModalSubmit?.()) return 'modal';
  if (interaction?.isContextMenuCommand?.()) return 'context-menu';
  return 'interaction';
}
function safeInteractionOptions(interaction) {
  if (!interaction?.isChatInputCommand?.()) return null;
  const simplify = (items = []) => items.map((item) => ({ name: item.name, type: item.type, value: item.value ?? null, options: Array.isArray(item.options) ? simplify(item.options) : undefined }));
  return simplify(interaction.options?.data || []);
}
function interactionValues(interaction) {
  if (Array.isArray(interaction?.values)) return interaction.values.slice(0, 25);
  if (interaction?.isUserSelectMenu?.() || interaction?.isRoleSelectMenu?.() || interaction?.isChannelSelectMenu?.() || interaction?.isMentionableSelectMenu?.()) return Array.isArray(interaction.values) ? interaction.values.slice(0, 25) : [];
  return null;
}
function interactionLabel(interaction, kind) {
  if (kind === 'command') return `/${interaction.commandName || 'unknown'}`;
  if (kind === 'context-menu') return interaction.commandName || 'context menu';
  return String(interaction.customId || kind || 'interaction');
}
async function captureGoliathInteraction(client, interaction) {
  if (!interaction?.guild || !interaction?.user) return false;
  const ownerAuditGuildId = auditRouter.getOwnerAuditGuildId();
  if (ownerAuditGuildId && String(interaction.guildId || '') === String(ownerAuditGuildId)) return false;
  if (String(interaction.customId || '').startsWith('owner:audit:') || String(interaction.customId || '').startsWith('owner:commandcenter:')) return false;
  if (interaction?.isAutocomplete?.()) return false;
  const kind = interactionKind(interaction);
  const label = interactionLabel(interaction, kind);
  const actor = { id: interaction.user.id, username: interaction.user.username || null, globalName: interaction.user.globalName || null, bot: Boolean(interaction.user.bot) };
  const metadata = { interactionId: interaction.id || null, interactionType: interaction.type ?? null, kind, commandName: interaction.commandName || null, commandId: interaction.commandId || null, customId: interaction.customId || null, channelId: interaction.channelId || null, messageId: interaction.message?.id || null, options: safeInteractionOptions(interaction), values: interactionValues(interaction) };
  await audit.captureGoliathAction(client, { type: `goliath.interaction.${kind}`, category: 'goliath', action: 'execute', title: kind === 'command' ? 'Goliath Command Used' : 'Goliath Interaction Used', icon: '🤖', guild: interaction.guild, channel: interaction.channel || null, user: interaction.user, actor, target: { id: interaction.id || null, label }, summary: `<@${interaction.user.id}> used **${label}** through Goliath.`, metadata });
  return true;
}

async function handleOwnerAuditInteraction(client, interaction) {
  const customId = String(interaction?.customId || '');
  if (!interaction?.isButton?.() || !customId.startsWith('owner:audit:')) return false;
  const ownerGuildId = auditRouter.getOwnerAuditGuildId();
  if (!ownerGuildId || String(interaction.guildId || '') !== ownerGuildId) { if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: '❌ This control is only available in the private Goliath audit server.', flags: MessageFlags.Ephemeral }).catch(() => null); return true; }
  if (!security.isBotOwner(interaction.user?.id)) { if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: '❌ Owner-only control.', flags: MessageFlags.Ephemeral }).catch(() => null); return true; }
  const context = auditChannelContext(interaction.channel);
  if (!context) { if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: '❌ This is not a Goliath user intelligence channel.', flags: MessageFlags.Ephemeral }).catch(() => null); return true; }
  const sourceGuild = registryGuild(client, context.sourceGuildId);
  if (!sourceGuild) { if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: '❌ Source guild is no longer known to Goliath.', flags: MessageFlags.Ephemeral }).catch(() => null); return true; }
  if (customId === 'owner:audit:refresh') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
    const refreshed = await auditRouter.refreshUserSummary(client, sourceGuild, interaction.channel, context.userId, true);
    await interaction.editReply({ content: refreshed ? '✅ User Intelligence summary refreshed.' : '❌ Summary refresh failed.' }).catch(() => null);
    return true;
  }
  const section = customId.slice('owner:audit:'.length);
  if (!['deep', 'identity', 'account', 'evidence', 'guilds', 'moderation', 'roles', 'voice', 'timeline', 'actions'].includes(section)) return false;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
  const report = await buildReport(client, context.userId);
  const embed = buildUserIntelligenceSectionEmbed(report, section, sourceGuild);
  await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
  return true;
}

function changedRoleIds(member) { return new Set(member?.roles?.cache?.keys?.() || []); }
async function findRemoval(guild, userId) {
  await wait(600);
  for (const type of ['member.kick', 'member.prune']) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const correlation = await audit.correlate(guild, type, userId, Date.now(), { maxAgeMs: type === 'member.prune' ? 45000 : 30000, allowTargetless: type === 'member.prune', limit: 10 });
      if (correlation) return { type, correlation };
      if (attempt < 2) await wait(500 * (attempt + 1));
    }
  }
  return { type: 'member.leave', correlation: null };
}
async function captureMemberUpdate(client, before, after) {
  const common = { guild: after.guild, member: after, target: { id: after.id, label: after.user?.tag || after.user?.username } };
  let emitted = false;
  const beforeRoles = changedRoleIds(before);
  const afterRoles = changedRoleIds(after);
  const added = [...afterRoles].filter((id) => !beforeRoles.has(id) && id !== after.guild.id).map((id) => after.guild.roles.cache.get(id)).filter(Boolean);
  const removed = [...beforeRoles].filter((id) => !afterRoles.has(id) && id !== after.guild.id).map((id) => before.guild.roles.cache.get(id)).filter(Boolean);
  if (added.length || removed.length) {
    emitted = true;
    await audit.capture(client, { ...common, type: 'member.roles', category: 'member', action: 'update', title: 'Member Roles Changed', icon: '🎭', before: { roles: before.roles.cache.filter((role) => role.id !== before.guild.id).map((role) => ({ id: role.id, name: role.name, position: role.position })) }, after: { roles: after.roles.cache.filter((role) => role.id !== after.guild.id).map((role) => ({ id: role.id, name: role.name, position: role.position })) }, metadata: { added: added.map((role) => ({ id: role.id, name: role.name })), removed: removed.map((role) => ({ id: role.id, name: role.name })) } });
  }
  if ((before.nickname || null) !== (after.nickname || null)) { emitted = true; await audit.capture(client, { ...common, type: 'member.nickname', category: 'member', action: 'update', title: 'Nickname Changed', icon: '🏷️', before: { nickname: before.nickname || null, displayName: before.displayName || null }, after: { nickname: after.nickname || null, displayName: after.displayName || null } }); }
  const beforeTimeout = before.communicationDisabledUntil?.toISOString?.() || null;
  const afterTimeout = after.communicationDisabledUntil?.toISOString?.() || null;
  if (beforeTimeout !== afterTimeout) { emitted = true; const title = !beforeTimeout && afterTimeout ? 'Member Timed Out' : beforeTimeout && !afterTimeout ? 'Member Timeout Removed' : 'Member Timeout Changed'; await audit.capture(client, { ...common, type: 'member.timeout', category: 'moderation', action: 'update', title, icon: '⏳', before: { timedOutUntil: beforeTimeout }, after: { timedOutUntil: afterTimeout } }); }
  if (Boolean(before.pending) !== Boolean(after.pending)) { emitted = true; await audit.capture(client, { ...common, type: 'member.verification', category: 'member', action: 'update', title: 'Membership Screening State Changed', icon: '✅', before: { pending: Boolean(before.pending) }, after: { pending: Boolean(after.pending) } }); }
  if (!emitted) await audit.capture(client, { ...common, type: 'member.update', category: 'member', action: 'update', title: 'Member Updated', icon: '👤', before: snapshotMember(before), after: snapshotMember(after) });
}

function registerAuditEvents(client) {
  if (!client || wired.has(client)) return false;
  wired.add(client);
  client.on(Events.InteractionCreate, (interaction) => {
    handleCommandCenterInteraction(client, interaction).catch((error) => console.warn('[Audit Intelligence] command center interaction failed:', error?.message || error));
    handleOwnerAuditInteraction(client, interaction).catch((error) => console.warn('[Audit Intelligence] owner interaction failed:', error?.message || error));
    captureGoliathInteraction(client, interaction).catch((error) => console.warn('[Audit Intelligence] Goliath interaction capture failed:', error?.message || error));
  });
  client.once(Events.ClientReady, () => initializeCommandCenter(client).catch((error) => console.warn('[Audit Intelligence] Command Center startup failed:', error?.message || error)));
  client.on(Events.GuildMemberAdd, (member) => audit.capture(client, { type: 'member.join', category: 'member', action: 'join', title: 'Member Joined', icon: '📥', guild: member.guild, member, target: { id: member.id, label: member.user?.tag || member.user?.username }, after: snapshotMember(member) }));
  client.on(Events.GuildMemberRemove, async (member) => {
    const removal = await findRemoval(member.guild, member.id).catch(() => ({ type: 'member.leave', correlation: null }));
    if (removal.type === 'member.kick') return audit.capture(client, { type: 'member.kick', category: 'moderation', action: 'delete', title: 'Member Kicked', icon: '👢', guild: member.guild, member, target: { id: member.id, label: member.user?.tag || member.user?.username }, actor: removal.correlation?.actor || null, reason: removal.correlation?.reason || null, before: snapshotMember(member), metadata: { auditLog: removal.correlation } });
    if (removal.type === 'member.prune') return audit.capture(client, { type: 'member.prune', category: 'moderation', action: 'delete', title: 'Member Pruned / Removed', icon: '🧹', guild: member.guild, member, target: { id: member.id, label: member.user?.tag || member.user?.username }, actor: removal.correlation?.actor || null, reason: removal.correlation?.reason || null, before: snapshotMember(member), metadata: { auditLog: removal.correlation } });
    return audit.capture(client, { type: 'member.leave', category: 'member', action: 'leave', title: 'Member Left', icon: '📤', guild: member.guild, member, target: { id: member.id, label: member.user?.tag || member.user?.username }, before: snapshotMember(member) });
  });
  client.on(Events.GuildMemberUpdate, (before, after) => captureMemberUpdate(client, before, after).catch((error) => console.warn('[Audit Intelligence] member update capture failed:', error?.message || error)));
  client.on(Events.GuildBanAdd, (ban) => audit.capture(client, { type: 'member.ban', category: 'moderation', action: 'create', title: 'Member Banned', icon: '🔨', guild: ban.guild, user: ban.user, target: { id: ban.user.id, label: ban.user.tag || ban.user.username }, reason: ban.reason || null }));
  client.on(Events.GuildBanRemove, (ban) => audit.capture(client, { type: 'member.unban', category: 'moderation', action: 'delete', title: 'Member Unbanned', icon: '🕊️', guild: ban.guild, user: ban.user, target: { id: ban.user.id, label: ban.user.tag || ban.user.username } }));
  client.on(Events.GuildRoleCreate, (role) => audit.capture(client, { type: 'role.create', category: 'role', action: 'create', title: 'Role Created', icon: '🎭', guild: role.guild, target: { id: role.id, label: role.name }, after: roleState(role) }));
  client.on(Events.GuildRoleUpdate, (before, after) => audit.capture(client, { type: 'role.update', category: 'role', action: 'update', title: 'Role Updated', icon: '🎭', guild: after.guild, target: { id: after.id, label: after.name }, before: roleState(before), after: roleState(after) }));
  client.on(Events.GuildRoleDelete, (role) => audit.capture(client, { type: 'role.delete', category: 'role', action: 'delete', title: 'Role Deleted', icon: '🗑️', guild: role.guild, target: { id: role.id, label: role.name }, before: roleState(role) }));
  client.on(Events.ChannelCreate, (channel) => channel.guild && audit.capture(client, { type: 'channel.create', category: 'channel', action: 'create', title: 'Channel Created', icon: '🆕', guild: channel.guild, channel, target: { id: channel.id, label: channel.name }, after: channelState(channel) }));
  client.on(Events.ChannelUpdate, (before, after) => after.guild && audit.capture(client, { type: 'channel.update', category: 'channel', action: 'update', title: 'Channel Updated', icon: '📝', guild: after.guild, channel: after, target: { id: after.id, label: after.name }, before: channelState(before), after: channelState(after) }));
  client.on(Events.ChannelDelete, (channel) => channel.guild && audit.capture(client, { type: 'channel.delete', category: 'channel', action: 'delete', title: 'Channel Deleted', icon: '🗑️', guild: channel.guild, channel, target: { id: channel.id, label: channel.name }, before: channelState(channel) }));
  client.on(Events.ThreadCreate, (thread) => thread.guild && audit.capture(client, { type: 'thread.create', category: 'thread', action: 'create', title: 'Thread Created', icon: '🧵', guild: thread.guild, channel: thread, target: { id: thread.id, label: thread.name }, after: threadState(thread) }));
  client.on(Events.ThreadUpdate, (before, after) => after.guild && audit.capture(client, { type: 'thread.update', category: 'thread', action: 'update', title: 'Thread Updated', icon: '🧵', guild: after.guild, channel: after, target: { id: after.id, label: after.name }, before: threadState(before), after: threadState(after) }));
  client.on(Events.ThreadDelete, (thread) => thread.guild && audit.capture(client, { type: 'thread.delete', category: 'thread', action: 'delete', title: 'Thread Deleted', icon: '🗑️', guild: thread.guild, target: { id: thread.id, label: thread.name }, before: threadState(thread) }));
  client.on(Events.GuildEmojiCreate, (emoji) => audit.capture(client, { type: 'emoji.create', category: 'expression', action: 'create', title: 'Emoji Created', icon: '😀', guild: emoji.guild, target: { id: emoji.id, label: emoji.name }, after: emojiState(emoji) }));
  client.on(Events.GuildEmojiUpdate, (before, after) => audit.capture(client, { type: 'emoji.update', category: 'expression', action: 'update', title: 'Emoji Updated', icon: '😀', guild: after.guild, target: { id: after.id, label: after.name }, before: emojiState(before), after: emojiState(after) }));
  client.on(Events.GuildEmojiDelete, (emoji) => audit.capture(client, { type: 'emoji.delete', category: 'expression', action: 'delete', title: 'Emoji Deleted', icon: '🗑️', guild: emoji.guild, target: { id: emoji.id, label: emoji.name }, before: emojiState(emoji) }));
  client.on(Events.GuildStickerCreate, (sticker) => audit.capture(client, { type: 'sticker.create', category: 'expression', action: 'create', title: 'Sticker Created', icon: '🏷️', guild: sticker.guild, target: { id: sticker.id, label: sticker.name }, after: stickerState(sticker) }));
  client.on(Events.GuildStickerUpdate, (before, after) => audit.capture(client, { type: 'sticker.update', category: 'expression', action: 'update', title: 'Sticker Updated', icon: '🏷️', guild: after.guild, target: { id: after.id, label: after.name }, before: stickerState(before), after: stickerState(after) }));
  client.on(Events.GuildStickerDelete, (sticker) => audit.capture(client, { type: 'sticker.delete', category: 'expression', action: 'delete', title: 'Sticker Deleted', icon: '🗑️', guild: sticker.guild, target: { id: sticker.id, label: sticker.name }, before: stickerState(sticker) }));
  client.on(Events.MessageUpdate, (before, after) => after.guild && audit.capture(client, { type: 'message.update', category: 'message', action: 'update', title: 'Message Edited', icon: '✏️', guild: after.guild, channel: after.channel, user: after.author, target: { id: after.id, label: `Message ${after.id}` }, before: messageState(before), after: messageState(after) }));
  client.on(Events.MessageDelete, (message) => message.guild && audit.capture(client, { type: 'message.delete', category: 'message', action: 'delete', title: 'Message Deleted', icon: '🗑️', guild: message.guild, channel: message.channel, user: message.author, target: { id: message.id, label: `Message ${message.id}` }, before: messageState(message) }));
  client.on(Events.MessageBulkDelete, (messages, channel) => channel.guild && audit.capture(client, { type: 'message.bulkDelete', category: 'message', action: 'delete', title: 'Messages Bulk Deleted', icon: '🧹', guild: channel.guild, channel, target: { id: channel.id, label: `${messages.size} messages` }, before: [...messages.values()].slice(0, 100).map(messageState), metadata: { count: messages.size } }));
  client.on(Events.MessageReactionAdd, (reaction, user) => reaction.message?.guild && audit.capture(client, { type: 'reaction.add', category: 'message', action: 'create', title: 'Reaction Added', icon: '➕', guild: reaction.message.guild, channel: reaction.message.channel, user, target: { id: reaction.message.id, label: `Message ${reaction.message.id}` }, after: { emoji: reaction.emoji?.toString?.() || reaction.emoji?.name || null, emojiId: reaction.emoji?.id || null } }));
  client.on(Events.MessageReactionRemove, (reaction, user) => reaction.message?.guild && audit.capture(client, { type: 'reaction.remove', category: 'message', action: 'delete', title: 'Reaction Removed', icon: '➖', guild: reaction.message.guild, channel: reaction.message.channel, user, target: { id: reaction.message.id, label: `Message ${reaction.message.id}` }, before: { emoji: reaction.emoji?.toString?.() || reaction.emoji?.name || null, emojiId: reaction.emoji?.id || null } }));
  client.on(Events.VoiceStateUpdate, (before, after) => {
    const guild = after.guild || before.guild;
    if (!guild || before.channelId === after.channelId && before.serverMute === after.serverMute && before.serverDeaf === after.serverDeaf) return;
    audit.capture(client, { type: 'voice.update', category: 'voice', action: 'update', title: 'Voice State Changed', icon: '🔊', guild, member: after.member || before.member, target: { id: after.id || before.id, label: after.member?.user?.tag || before.member?.user?.tag }, before: { channelId: before.channelId, serverMute: before.serverMute, serverDeaf: before.serverDeaf }, after: { channelId: after.channelId, serverMute: after.serverMute, serverDeaf: after.serverDeaf } });
  });
  client.on(Events.InviteCreate, (invite) => invite.guild && audit.capture(client, { type: 'invite.create', category: 'invite', action: 'create', title: 'Invite Created', icon: '🔗', guild: invite.guild, channel: invite.channel, target: { id: invite.code, label: invite.code }, after: { code: invite.code, inviterId: invite.inviterId || null, maxAge: invite.maxAge, maxUses: invite.maxUses, temporary: invite.temporary } }));
  client.on(Events.InviteDelete, (invite) => invite.guild && audit.capture(client, { type: 'invite.delete', category: 'invite', action: 'delete', title: 'Invite Deleted', icon: '🔗', guild: invite.guild, channel: invite.channel, target: { id: invite.code, label: invite.code }, before: { code: invite.code, inviterId: invite.inviterId || null, maxAge: invite.maxAge, maxUses: invite.maxUses, temporary: invite.temporary } }));
  client.on(Events.GuildScheduledEventCreate, (event) => audit.capture(client, { type: 'scheduledEvent.create', category: 'scheduledEvent', action: 'create', title: 'Scheduled Event Created', icon: '📅', guild: event.guild, target: { id: event.id, label: event.name }, after: scheduledEventState(event) }));
  client.on(Events.GuildScheduledEventUpdate, (before, after) => audit.capture(client, { type: 'scheduledEvent.update', category: 'scheduledEvent', action: 'update', title: 'Scheduled Event Updated', icon: '📅', guild: after.guild, target: { id: after.id, label: after.name }, before: scheduledEventState(before), after: scheduledEventState(after) }));
  client.on(Events.GuildScheduledEventDelete, (event) => audit.capture(client, { type: 'scheduledEvent.delete', category: 'scheduledEvent', action: 'delete', title: 'Scheduled Event Deleted', icon: '🗑️', guild: event.guild, target: { id: event.id, label: event.name }, before: scheduledEventState(event) }));
  client.on(Events.WebhooksUpdate, (channel) => channel.guild && audit.capture(client, { type: 'webhook.update', category: 'webhook', action: 'update', title: 'Webhook Configuration Changed', icon: '🪝', guild: channel.guild, channel, target: { id: channel.id, label: channel.name }, metadata: { note: 'Discord signals that one or more webhooks in this channel changed; exact webhook details depend on audit-log visibility.' } }));
  if (Events.AutoModerationRuleCreate) client.on(Events.AutoModerationRuleCreate, (rule) => audit.capture(client, { type: 'automod.ruleCreate', category: 'automod', action: 'create', title: 'AutoMod Rule Created', icon: '🛡️', guild: rule.guild, target: { id: rule.id, label: rule.name }, after: { id: rule.id, name: rule.name, enabled: rule.enabled, eventType: rule.eventType, triggerType: rule.triggerType, actions: rule.actions } }));
  if (Events.AutoModerationRuleUpdate) client.on(Events.AutoModerationRuleUpdate, (before, after) => {
    const rule = after || before;
    if (!rule?.guild) return;
    const snapshot = (value) => value ? { id: value.id, name: value.name, enabled: value.enabled, eventType: value.eventType, triggerType: value.triggerType, actions: value.actions } : null;
    return audit.capture(client, {
      type: 'automod.ruleUpdate',
      category: 'automod',
      action: 'update',
      title: 'AutoMod Rule Updated',
      icon: '🛡️',
      guild: rule.guild,
      target: { id: rule.id || null, label: rule.name || 'AutoMod rule' },
      before: snapshot(before),
      after: snapshot(after),
    });
  });
  if (Events.AutoModerationRuleDelete) client.on(Events.AutoModerationRuleDelete, (rule) => audit.capture(client, { type: 'automod.ruleDelete', category: 'automod', action: 'delete', title: 'AutoMod Rule Deleted', icon: '🗑️', guild: rule.guild, target: { id: rule.id, label: rule.name }, before: { id: rule.id, name: rule.name, enabled: rule.enabled, eventType: rule.eventType, triggerType: rule.triggerType, actions: rule.actions } }));
  if (Events.AutoModerationActionExecution) client.on(Events.AutoModerationActionExecution, (execution) => audit.capture(client, { type: 'automod.action', category: 'automod', action: 'execute', title: 'AutoMod Action Executed', icon: '🛡️', guild: execution.guild, channel: execution.channel || null, user: execution.member?.user || null, member: execution.member || null, target: { id: execution.userId || execution.member?.id || null, label: execution.member?.user?.tag || execution.userId || 'Unknown user' }, metadata: { ruleId: execution.ruleId || null, ruleTriggerType: execution.ruleTriggerType ?? null, action: execution.action || null, matchedKeyword: execution.matchedKeyword || null, matchedContent: execution.matchedContent || null, content: execution.content || null } }));
  client.on(Events.GuildUpdate, (before, after) => audit.capture(client, { type: 'guild.update', category: 'guild', action: 'update', title: 'Guild Settings Updated', icon: '🏰', guild: after, target: { id: after.id, label: after.name }, before: guildState(before), after: guildState(after) }));
  console.log('[Audit Intelligence] Discord event capture registered.');
  return true;
}

const commandCenterCommand = {
  category: 'Owner',
  help: { name: 'commandcenter', description: 'Open the private Goliath owner Command Center.', usage: '/commandcenter' },
  access: { ownerOnly: true },
  privateGuildOnly: true,
  data: new SlashCommandBuilder().setName('commandcenter').setDescription('Open the private Goliath owner Command Center').setDMPermission(false),
  async execute(interaction) {
    if (!commandCenterUiEnabled()) return interaction.reply({ content: '❌ /commandcenter is owned by the DEV control plane only.', flags: MessageFlags.Ephemeral }).catch(() => null);
    if (!security.isBotOwner(interaction.user?.id)) return interaction.reply({ content: '❌ This command is restricted to the Goliath owner.', flags: MessageFlags.Ephemeral }).catch(() => null);
    const config = auditStore.getConfig();
    if (!config.commandCenter?.guildId || String(interaction.guildId || '') !== String(config.commandCenter.guildId)) return interaction.reply({ content: '❌ /commandcenter is only valid inside your private Goliath Command Center server.', flags: MessageFlags.Ephemeral }).catch(() => null);
    const context = await auditRouter.ensureCommandCenter(interaction.client, interaction.guild);
    const link = context?.channel ? `https://discord.com/channels/${interaction.guildId}/${context.channel.id}` : null;
    return interaction.reply({ content: context ? `✅ Command Center ready.${link ? `\n${link}` : ''}` : '❌ Command Center could not be prepared.', flags: MessageFlags.Ephemeral }).catch(() => null);
  },
};

module.exports = {
  ...commandCenterCommand,
  registerAuditEvents,
  handleOwnerAuditInteraction,
  handleCommandCenterInteraction,
  captureGoliathInteraction,
  initializeCommandCenter,
  ensurePrivateCommandRegistration,
};
