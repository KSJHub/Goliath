'use strict';

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
} = require('discord.js');

const stats = require('./stats');
const statsHealth = require('./statsHealth');

const PANEL_COLOR = 0x5865F2;
const SUCCESS_COLOR = 0x57F287;
const WARNING_COLOR = 0xFEE75C;
const DANGER_COLOR = 0xED4245;
const DISABLED_COLOR = 0x747F8D;
const BULK_LIMIT = 25;

const TYPES = Object.freeze({
  channels: ['📁', 'Channels'],
  countdown: ['⏳', 'Countdown / Timer'],
  datetime: ['📅', 'Date & Time'],
  members: ['👥', 'Members'],
  status: ['🟢', 'Members with Status'],
  role: ['🎭', 'Members in Role'],
  roles: ['🏷️', 'Roles'],
  voice: ['🔊', 'Members in Voice'],
  messages: ['💬', 'Message Count'],
  voiceMinutes: ['🎙️', 'Voice Minutes'],
  joins: ['📥', 'Member Joins'],
  leaves: ['📤', 'Member Leaves'],
  boosts: ['🚀', 'Server Boosts'],
  emojis: ['😀', 'Emojis'],
});

const STATUSES = Object.freeze({
  online: ['🟢', 'Online'],
  idle: ['🌙', 'Idle'],
  dnd: ['⛔', 'Do Not Disturb'],
  offline: ['⚫', 'Offline'],
});

const bulkSelections = new Map();

const row = (...components) => new ActionRowBuilder().addComponents(...components.filter(Boolean));
const button = (customId, label, style = ButtonStyle.Secondary, disabled = false) => new ButtonBuilder()
  .setCustomId(customId)
  .setLabel(label)
  .setStyle(style)
  .setDisabled(Boolean(disabled));
const requesterName = (interaction) => interaction.member?.displayName || interaction.user?.displayName || interaction.user?.username || 'Management';
const listDocks = (guildId) => stats.counters.listCounters(guildId);
const findDock = (guildId, key) => listDocks(guildId).find((item) => item.id === key || item.channelId === key) || null;

function select(customId, placeholder, options, minValues = 1, maxValues = 1) {
  const safe = options.slice(0, 25);
  const max = Math.max(1, Math.min(maxValues, safe.length || 1));
  return new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .setMinValues(Math.max(0, Math.min(minValues, max)))
    .setMaxValues(max)
    .addOptions(safe);
}

function roleSelect(customId, placeholder, values = []) {
  const menu = new RoleSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder).setMinValues(0).setMaxValues(25);
  if (values.length) menu.setDefaultRoles(...values.slice(0, 25));
  return menu;
}

function footer(embed, requester) {
  return embed.setFooter({ text: `Requested by ${requester}` }).setTimestamp();
}

function navigation(backId, includeSettings = true, backLabel = '⬅️ Back') {
  return row(button(backId, backLabel), includeSettings ? button('admin:stats:settings', '⚙️ Settings') : null);
}

function defaultSegment(type) {
  if (type === 'members') return { type, options: { humans: true, bots: true } };
  if (type === 'status') return { type, options: { statuses: ['online'] } };
  if (type === 'role') return { type, options: { roleIds: [], statuses: [] } };
  if (type === 'voice') return { type, options: { mode: 'all', channelIds: [] } };
  if (type === 'channels') return { type, options: { channelTypes: ['text', 'voice', 'category'] } };
  if (type === 'roles') return { type, options: { unmanaged: true, managed: false } };
  if (type === 'datetime') return { type, options: { format: 'weekday-short', timeZone: 'Europe/London' } };
  if (type === 'countdown') return { type, options: { timestamp: Date.now() + 86400000, includeDays: true, includeHours: true, includeMinutes: true, endText: 'Countdown complete!' } };
  if (type === 'messages' || type === 'voiceMinutes') return { type, options: { periodDays: null } };
  return { type, options: {} };
}

function typeOptions(selected = null) {
  return Object.entries(TYPES).map(([value, [emoji, label]]) => ({
    label,
    value,
    emoji,
    default: value === selected,
    description: value === 'role' ? 'Count members in selected roles' : value === 'status' ? 'Online, idle, DND or offline members' : `Show ${label.toLowerCase()}`,
  }));
}

function optionDefaults(items, values = []) {
  const wanted = new Set(values.filter(Boolean).map(String));
  return items.map((item) => ({ ...item, default: wanted.has(String(item.value)) }));
}

function roleName(guild, ids = []) {
  if (ids.length !== 1) return 'Roles';
  return guild.roles.cache.get(ids[0])?.name || 'Role';
}

function segmentTemplate(guild, segment, placeholder) {
  const options = segment.options || {};
  if (segment.type === 'datetime') return `📅 ${placeholder}`;
  if (segment.type === 'countdown') return `⏳ ${placeholder}`;
  if (segment.type === 'status') {
    const statuses = options.statuses || [];
    if (statuses.length === 1 && STATUSES[statuses[0]]) {
      const [emoji, label] = STATUSES[statuses[0]];
      return `${emoji} ${label}: ${placeholder}`;
    }
    return `🟢 Status: ${placeholder}`;
  }
  if (segment.type === 'role') return `🎭 ${roleName(guild, options.roleIds || [])}: ${placeholder}`;
  const [emoji, label] = TYPES[segment.type] || ['📊', 'Counter'];
  return `${emoji} ${label}: ${placeholder}`;
}

const generatedTemplate = (guild, segments) => segments.map((segment, index) => segmentTemplate(guild, segment, `{${index + 1}}`)).join(' • ').slice(0, 100);
const generatedName = (segments) => segments.length > 1 ? 'Combined Counter' : (TYPES[segments[0]?.type]?.[1] || 'Counter');

function configuredCategory(guild) {
  const all = listDocks(guild.id);
  const storedId = all.find((item) => item.categoryId)?.categoryId;
  if (storedId) {
    const stored = guild.channels.cache.get(storedId);
    if (stored?.type === ChannelType.GuildCategory) return stored;
  }
  const wanted = String(stats.getConfig(guild.id).settings?.categoryName || '📊 SERVER STATS');
  return guild.channels.cache.find((channel) => channel.type === ChannelType.GuildCategory && channel.name.toLowerCase() === wanted.toLowerCase())
    || guild.channels.cache.find((channel) => channel.type === ChannelType.GuildCategory && /server\s*stats/i.test(channel.name))
    || null;
}

async function ensureCategory(guild) {
  const existing = configuredCategory(guild);
  if (existing) {
    await stats.counters.ensureManageChannels(guild, existing, 'manage the Stats category');
    return existing;
  }
  const name = String(stats.getConfig(guild.id).settings?.categoryName || '📊 SERVER STATS').slice(0, 100);
  return stats.counters.findOrCreateCategory
    ? stats.counters.findOrCreateCategory(guild, name)
    : guild.channels.create({ name, type: ChannelType.GuildCategory, reason: 'Goliath Stats category setup' });
}

const stripLeadingSymbols = (name) => String(name || '').replace(/^[^\p{L}\p{N}]+/u, '').trim();

function detectCounter(guild, channel) {
  const plain = stripLeadingSymbols(channel.name);
  const lower = plain.toLowerCase();
  let type;
  let name;
  let template;
  let options = {};
  if (/countdown|timer/.test(lower)) { type = 'countdown'; name = 'Countdown / Timer'; template = '⏳ Countdown / Timer: {value}'; }
  else if (/\bmember\s+joins?\b|\bjoins?\b/.test(lower)) { type = 'joins'; name = 'Member Joins'; template = '📥 Member Joins: {value}'; }
  else if (/\bmember\s+leaves?\b|\bleaves?\b/.test(lower)) { type = 'leaves'; name = 'Member Leaves'; template = '📤 Member Leaves: {value}'; }
  else if (/\bin\s+voice\b|\bvoice\s+members?\b/.test(lower)) { type = 'voice'; name = 'Members in Voice'; template = '🔊 In Voice: {value}'; options = { mode: 'all', channelIds: [] }; }
  else if (/\bonline\b/.test(lower)) { type = 'status'; name = 'Online'; template = '🟢 Online: {value}'; options = { statuses: ['online'] }; }
  else if (/\bidle\b/.test(lower)) { type = 'status'; name = 'Idle'; template = '🌙 Idle: {value}'; options = { statuses: ['idle'] }; }
  else if (/\b(?:dnd|do not disturb)\b/.test(lower)) { type = 'status'; name = 'Do Not Disturb'; template = '⛔ Do Not Disturb: {value}'; options = { statuses: ['dnd'] }; }
  else if (/\boffline\b/.test(lower)) { type = 'status'; name = 'Offline'; template = '⚫ Offline: {value}'; options = { statuses: ['offline'] }; }
  else if (/\bmembers?\b|\busers?\b/.test(lower)) { type = 'members'; name = 'Members'; template = '👥 Members: {value}'; options = { humans: true, bots: true }; }
  else if (/\bvoice\s+minutes?\b/.test(lower)) { type = 'voiceMinutes'; name = 'Voice Minutes'; template = '🎙️ Voice Minutes: {value}'; }
  else if (/\bmessages?\b|\bmsg\b/.test(lower)) { type = 'messages'; name = 'Message Count'; template = '💬 Messages: {value}'; }
  else if (/\bboosts?\b/.test(lower)) { type = 'boosts'; name = 'Server Boosts'; template = '🚀 Boosts: {value}'; }
  else if (/\bemojis?\b/.test(lower)) { type = 'emojis'; name = 'Emojis'; template = '😀 Emojis: {value}'; }
  else if (/^(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?\b/i.test(plain) || /^\d{1,2}[\/-]\d{1,2}/.test(plain)) {
    type = 'datetime'; name = 'Date & Time'; template = '📅 {value}'; options = { format: 'weekday-short', timeZone: stats.getConfig(guild.id).settings?.timeZone || 'Europe/London' };
  } else {
    const label = plain.split(':')[0]?.trim();
    const role = label && guild.roles.cache.find((item) => item.id !== guild.id && item.name.toLowerCase() === label.toLowerCase());
    if (role) { type = 'role'; name = `Role: ${role.name}`; template = `🎭 ${role.name}: {value}`; options = { roleIds: [role.id], statuses: [] }; }
  }
  return type ? { type, name, template, options } : null;
}

function looksRenderedCounter(channel, spec, statsCategory) {
  if (!spec) return false;
  if (channel.parentId && statsCategory?.id === channel.parentId) return true;
  const plain = stripLeadingSymbols(channel.name);
  return /\d/.test(plain) || (channel.type === ChannelType.GuildVoice && spec.type === 'countdown' && /countdown|timer/i.test(plain));
}

function unsavedCounters(guild) {
  const savedIds = new Set(listDocks(guild.id).map((item) => item.channelId).filter(Boolean));
  const category = configuredCategory(guild);
  return [...guild.channels.cache.values()]
    .filter((channel) => !savedIds.has(channel.id) && [ChannelType.GuildVoice, ChannelType.GuildText].includes(channel.type))
    .map((channel) => ({ channel, spec: detectCounter(guild, channel) }))
    .filter(({ channel, spec }) => looksRenderedCounter(channel, spec, category));
}

async function cleanupFalseAdoptions(guild) {
  const category = configuredCategory(guild);
  for (const item of listDocks(guild.id)) {
    if (!['adopted', 'default-suite'].includes(item.source) || !item.channelId) continue;
    const channel = guild.channels.cache.get(item.channelId) || await guild.channels.fetch(item.channelId).catch(() => null);
    if (!channel) continue;
    if (!looksRenderedCounter(channel, detectCounter(guild, channel), category)) stats.counters.removeCounter(guild.id, item.id, guild);
  }
}

async function reconcile(guild) {
  await guild.channels.fetch().catch(() => null);
  await guild.roles.fetch().catch(() => null);
  await cleanupFalseAdoptions(guild);
  const found = unsavedCounters(guild);
  for (const { channel, spec } of found) {
    stats.counters.saveDock(guild.id, {
      id: `adopted-${channel.id}`,
      channelId: channel.id,
      categoryId: channel.parentId || null,
      channelType: channel.type === ChannelType.GuildText ? 'text' : 'voice',
      name: spec.name,
      enabled: true,
      template: spec.template,
      segments: [{ type: spec.type, options: spec.options }],
      source: 'adopted',
    }, guild);
  }
  return found.length;
}

function monitoredRoleDocks(guildId) {
  return listDocks(guildId).filter((item) => item.source === 'monitored-role' && item.segments?.[0]?.type === 'role');
}
function monitoredRoleIds(guildId) {
  return [...new Set(monitoredRoleDocks(guildId).flatMap((item) => item.segments?.[0]?.options?.roleIds || []))];
}

function summaryText(all) {
  if (!all.length) return '> No counters have been created yet.';
  return all.slice(0, 12).map((item) => `${item.enabled ? '🟢' : '⚫'} ${item.channelType === 'text' ? '#️⃣' : '🔊'} **${item.name || 'Counter'}**${item.channelId ? ` — <#${item.channelId}>` : ''}`).join('\n');
}

function counterValueLines(guild, item) {
  return (item.segments || []).map((segment, index) => {
    const [emoji, label] = TYPES[segment.type] || ['•', segment.type];
    let extra = '';
    if (segment.type === 'status') extra = ` — ${(segment.options?.statuses || []).map((value) => STATUSES[value]?.[1] || value).join(', ')}`;
    if (segment.type === 'role') extra = ` — ${(segment.options?.roleIds || []).map((id) => guild.roles.cache.get(id)?.name).filter(Boolean).join(', ') || 'No role selected'}`;
    if ((segment.type === 'messages' || segment.type === 'voiceMinutes') && segment.options?.periodDays) extra = ` — last ${segment.options.periodDays} days`;
    return `**${index + 1}.** ${emoji} ${label}${extra}`;
  }).join('\n');
}

function healthState(guild) {
  const all = listDocks(guild.id);
  const missing = all.filter((item) => item.enabled && item.channelId && !guild.channels.cache.has(item.channelId)).length;
  const unsaved = unsavedCounters(guild).length;
  if (missing) return { color: WARNING_COLOR, text: `⚠️ ${missing} counter${missing === 1 ? '' : 's'} need attention` };
  if (unsaved) return { color: WARNING_COLOR, text: `⚠️ ${unsaved} existing counter${unsaved === 1 ? '' : 's'} can be reconnected` };
  return { color: SUCCESS_COLOR, text: '✅ Ready' };
}

function buildMainPanel(guild, requester = 'Management') {
  const summary = stats.getSummary(guild.id);
  const all = listDocks(guild.id);
  const category = configuredCategory(guild);
  const health = healthState(guild);
  const enabled = summary.enabled !== false;
  return {
    embeds: [footer(new EmbedBuilder()
      .setColor(enabled ? health.color : DISABLED_COLOR)
      .setTitle('📊 Server Counters')
      .setDescription([
        'Create live Discord channels that keep your server numbers visible at a glance.',
        '',
        `**Module:** ${enabled ? '🟢 Enabled' : '🔴 Disabled'}`,
        `**Counters:** \`${all.length}\` saved · \`${all.filter((item) => item.enabled).length}\` active`,
        `**Monitored Roles:** \`${monitoredRoleIds(guild.id).length}\``,
        `**Category:** ${category ? `**${category.name}**` : '`Not created`'}`,
        `**Health:** ${health.text}`,
        '',
        'Use **Setup** to add counters. Use **Manage** for existing counters and their category.',
      ].join('\n')), requester)],
    components: [
      row(
        button('admin:stats:setup-page', '➕ Setup', ButtonStyle.Success),
        button('admin:stats:manager', '📋 Manage', ButtonStyle.Primary, !all.length && !unsavedCounters(guild).length)
      ),
      navigation('admin:studio:utilityStudio'),
    ],
  };
}

function buildSetupPanel(guild, requester = 'Management', notice = '') {
  const all = listDocks(guild.id);
  const roles = monitoredRoleIds(guild.id).filter((id) => guild.roles.cache.has(id));
  return {
    embeds: [footer(new EmbedBuilder()
      .setColor(PANEL_COLOR)
      .setTitle('➕ Server Counters · Setup')
      .setDescription([
        notice ? `> ${notice}` : null,
        notice ? '' : null,
        'Create your server counter channels here.',
        '',
        '**Quick Setup** creates Date & Time, Members, a combined **🟢 Online · ⛔ DND · 🌙 Idle** counter, and In Voice.',
        `**Saved Counters:** \`${all.length}\``,
        `**Monitored Roles:** \`${roles.length}\``,
      ].filter((line) => line !== null).join('\n')), requester)],
    components: [
      row(button('admin:stats:setup', '⚡ Quick Setup', ButtonStyle.Success)),
      row(select('admin:stats:create', '➕ Create a counter…', typeOptions())),
      row(roleSelect('admin:stats:setup:roles', 'Select roles to monitor…', roles)),
      navigation('admin:stats'),
    ],
  };
}

function buildManagerPanel(guild, requester = 'Management', notice = null) {
  const all = listDocks(guild.id);
  const category = configuredCategory(guild);
  const components = [];
  if (all.length) {
    components.push(row(select('admin:stats:manage', 'Choose a counter to manage…', all.map((item) => ({
      label: String(item.name || 'Counter').slice(0, 100),
      value: item.id,
      emoji: item.channelType === 'text' ? '#️⃣' : '🔊',
      description: `${item.enabled ? 'Active' : 'Off'} · ${(item.segments || []).length} value${(item.segments || []).length === 1 ? '' : 's'}`.slice(0, 100),
    })))));
    components.push(row(
      button('admin:stats:bulk', '🧰 Bulk Manage', ButtonStyle.Primary),
      button('admin:stats:refresh', '🔄 Refresh Now')
    ));
  }
  components.push(row(button('admin:stats:category', '📁 Category', ButtonStyle.Secondary, !category && !all.length)));
  components.push(navigation('admin:stats'));
  const embed = footer(new EmbedBuilder()
    .setColor(notice?.error ? DANGER_COLOR : PANEL_COLOR)
    .setTitle('📋 Server Counters · Manage')
    .setDescription(all.length
      ? 'Manage individual counters, make bulk changes, refresh live values or manage the Stats category.'
      : 'No counters have been created yet. Go back to **Setup** to create your first counter.')
    .addFields(
      { name: 'Category', value: category ? `📁 **${category.name}**` : '`Not created`', inline: true },
      { name: 'Counters', value: `\`${all.length}\` saved · \`${all.filter((item) => item.enabled).length}\` active`, inline: true },
      { name: 'Saved Counters', value: summaryText(all).slice(0, 1024) }
    ), requester);
  if (notice?.text) embed.addFields({ name: notice.error ? '⚠️ Problem' : '✅ Done', value: notice.text.slice(0, 1024) });
  return { embeds: [embed], components };
}

function buildCategoryPanel(guild, requester = 'Management', notice = '') {
  const all = listDocks(guild.id);
  const category = configuredCategory(guild);
  const settings = stats.getConfig(guild.id).settings || {};
  const allEnabled = all.length > 0 && all.every((item) => item.enabled);
  return {
    embeds: [footer(new EmbedBuilder()
      .setColor(PANEL_COLOR)
      .setTitle('📁 Server Counters · Category')
      .setDescription([
        notice ? `> ${notice}` : null,
        notice ? '' : null,
        'Manage the Discord category and all counters inside it.',
        '',
        `**Category:** ${category ? `**${category.name}**` : `**${settings.categoryName || '📊 SERVER STATS'}** · not created yet`}`,
        `**Counters:** \`${all.length}\` saved · \`${all.filter((item) => item.enabled).length}\` active`,
      ].filter((line) => line !== null).join('\n')), requester)],
    components: [
      row(
        button('admin:stats:category:rename', '✏️ Name & Emoji'),
        button('admin:stats:category:toggleall', allEnabled ? '⏸️ Turn All Off' : '▶️ Turn All On', allEnabled ? ButtonStyle.Secondary : ButtonStyle.Success, !all.length)
      ),
      row(button('admin:stats:category:delete', '🗑️ Delete Category & Counters', ButtonStyle.Danger, !all.length && !category)),
      navigation('admin:stats:manager'),
    ],
  };
}

function buildSettingsPanel(guild, requester = 'Management', notice = '') {
  const config = stats.getConfig(guild.id);
  const summary = stats.getSummary(guild.id);
  const settings = config.settings || {};
  const enabled = summary.enabled !== false;
  const tracking = [
    `**Messages:** ${config.trackMessages !== false ? '✅ On' : '❌ Off'}`,
    `**Voice:** ${config.trackVoice !== false ? '✅ On' : '❌ Off'}`,
    `**Member Events:** ${config.trackMembers !== false ? '✅ On' : '❌ Off'}`,
    `**Ignore Bots:** ${config.ignoreBots !== false ? '✅ Yes' : '❌ No'}`,
  ].join('\n');
  return {
    embeds: [footer(new EmbedBuilder()
      .setColor(enabled ? PANEL_COLOR : DISABLED_COLOR)
      .setTitle('⚙️ Server Counters · Settings')
      .setDescription([
        notice ? `> ${notice}` : null,
        notice ? '' : null,
        'Configure how Server Counters behaves. Counter and category management stays under **Manage**.',
        '',
        `**Module:** ${enabled ? '🟢 Enabled' : '🔴 Disabled'}`,
        `**Default Time Zone:** ${settings.timeZone || 'Europe/London'}`,
        `**Default Refresh:** ${settings.defaultFrequencyMinutes || 10} minutes`,
        '',
        tracking,
      ].filter((line) => line !== null).join('\n')), requester)],
    components: [
      row(
        button(enabled ? 'admin:stats:disable' : 'admin:stats:enable', enabled ? '⏸️ Disable Module' : '▶️ Enable Module', enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        button('admin:stats:health', '🩺 Check Health', ButtonStyle.Primary)
      ),
      row(
        button('admin:stats:settings:timezone', '🌍 Time Zone'),
        button('admin:stats:settings:frequency', '⏱️ Default Refresh')
      ),
      row(
        button('admin:stats:settings:messages', config.trackMessages !== false ? '💬 Messages: On' : '💬 Messages: Off', config.trackMessages !== false ? ButtonStyle.Success : ButtonStyle.Secondary),
        button('admin:stats:settings:voice', config.trackVoice !== false ? '🎙️ Voice: On' : '🎙️ Voice: Off', config.trackVoice !== false ? ButtonStyle.Success : ButtonStyle.Secondary),
        button('admin:stats:settings:members', config.trackMembers !== false ? '👥 Members: On' : '👥 Members: Off', config.trackMembers !== false ? ButtonStyle.Success : ButtonStyle.Secondary)
      ),
      row(button('admin:stats:settings:bots', config.ignoreBots !== false ? '🤖 Ignore Bots: Yes' : '🤖 Ignore Bots: No', config.ignoreBots !== false ? ButtonStyle.Success : ButtonStyle.Secondary)),
      navigation('admin:stats', false, '⬅️ Back to Server Counters'),
    ],
  };
}

function healthIssueText(issue) {
  if (issue.code === 'counter_channel_missing') return 'A saved counter channel is missing.';
  if (issue.code === 'counter_channel_unmanageable') return 'A saved counter channel cannot be managed.';
  if (issue.code === 'retention_invalid') return 'The Stats retention setting is invalid.';
  return String(issue.code || 'Unknown Stats issue').replaceAll('_', ' ');
}

function buildHealthPanel(health, requester = 'Management', notice = '') {
  const issues = Array.isArray(health?.issues) ? health.issues : [];
  const issueText = issues.length ? issues.slice(0, 10).map((issue) => `${issue.severity === 'error' ? '❌' : '⚠️'} ${healthIssueText(issue)}`).join('\n') : '✅ No problems found.';
  return {
    embeds: [footer(new EmbedBuilder()
      .setColor(health?.healthy ? SUCCESS_COLOR : WARNING_COLOR)
      .setTitle('🩺 Server Counters · Health')
      .setDescription([
        notice ? `> ${notice}` : null,
        notice ? '' : null,
        `**Overall:** ${health?.healthy ? '✅ Healthy' : '⚠️ Needs attention'}`,
        `**Module:** ${health?.enabled ? '🟢 Enabled' : '🔴 Disabled'}`,
        `**Configured Counters:** \`${health?.counters?.configured || 0}\``,
        `**Missing Channels:** \`${health?.counters?.missing || 0}\``,
        '',
        issueText,
      ].filter((line) => line !== null).join('\n')), requester)],
    components: [
      row(
        button('admin:stats:health', '🔄 Check Again', ButtonStyle.Primary),
        button('admin:stats:health:repair', '🛠️ Repair', ButtonStyle.Success, health?.healthy)
      ),
      navigation('admin:stats:settings', false),
    ],
  };
}

function buildManagePanel(guild, item, requester = 'Management') {
  const preview = stats.counters.previewDock(guild, item);
  return {
    embeds: [footer(new EmbedBuilder()
      .setColor(item.enabled ? SUCCESS_COLOR : DISABLED_COLOR)
      .setTitle(`⚙️ ${item.name || 'Counter'}`)
      .setDescription(item.channelId ? `Counter channel: <#${item.channelId}>` : 'Saved but currently turned off.')
      .addFields(
        { name: 'Status', value: item.enabled ? '🟢 On' : '⚫ Off', inline: true },
        { name: 'Channel Type', value: item.channelType === 'text' ? '#️⃣ Text Channel' : '🔊 Voice Channel', inline: true },
        { name: 'Refresh', value: `${item.frequencyMinutes || 10} min`, inline: true },
        { name: 'Values', value: counterValueLines(guild, item) || 'None' },
        { name: 'Preview', value: `\`${preview}\`` },
        { name: 'Channel Text', value: `\`${item.template}\`` }
      ), requester)],
    components: [
      row(
        button(`admin:stats:edit:${item.id}`, '✏️ Edit Counter', ButtonStyle.Primary),
        button(`admin:stats:add:${item.id}`, '➕ Add Value', ButtonStyle.Success, item.segments.length >= 4),
        button(`admin:stats:toggle:${item.id}`, item.enabled ? '⏸️ Turn Off' : '▶️ Turn On', item.enabled ? ButtonStyle.Secondary : ButtonStyle.Success)
      ),
      row(button(`admin:stats:delete:${item.id}`, '🗑️ Delete', ButtonStyle.Danger)),
      navigation('admin:stats:manager'),
    ],
  };
}

function buildEditPanel(guild, item, requester = 'Management') {
  const options = item.segments.map((segment, index) => ({ label: `Value ${index + 1} — ${TYPES[segment.type]?.[1] || segment.type}`.slice(0, 100), value: String(index), emoji: TYPES[segment.type]?.[0] || '📊' }));
  return {
    embeds: [footer(new EmbedBuilder()
      .setColor(PANEL_COLOR)
      .setTitle(`✏️ Edit ${item.name || 'Counter'}`)
      .setDescription('Edit the channel output, display text and individual live values. A counter can display up to **four values**.')
      .addFields(
        { name: 'Current Values', value: counterValueLines(guild, item) },
        { name: 'Preview', value: `\`${stats.counters.previewDock(guild, item)}\`` }
      ), requester)],
    components: [
      row(select(`admin:stats:output:${item.id}`, 'Choose voice or text channel…', [
        { label: 'Voice Channel', value: 'voice', emoji: '🔊', default: item.channelType !== 'text' },
        { label: 'Text Channel', value: 'text', emoji: '#️⃣', default: item.channelType === 'text' },
      ])),
      row(select(`admin:stats:value:${item.id}`, 'Choose a value to edit…', options)),
      row(
        button(`admin:stats:text:${item.id}`, '📝 Channel Text'),
        button(`admin:stats:add:${item.id}`, '➕ Add Another Value', ButtonStyle.Success, item.segments.length >= 4)
      ),
      navigation(`admin:stats:open:${item.id}`),
    ],
  };
}

function buildValuePanel(guild, item, index, requester = 'Management') {
  const segment = item.segments[index];
  if (!segment) return buildEditPanel(guild, item, requester);
  const options = segment.options || {};
  const components = [row(select(`admin:stats:valuetype:${item.id}:${index}`, 'What should this value show?', typeOptions(segment.type)))];
  if (segment.type === 'status') {
    components.push(row(select(`admin:stats:status:${item.id}:${index}`, 'Choose statuses…', optionDefaults(Object.entries(STATUSES).map(([value, [emoji, label]]) => ({ label, value, emoji })), options.statuses || ['online']), 1, 4)));
  } else if (segment.type === 'members') {
    components.push(row(select(`admin:stats:members:${item.id}:${index}`, 'Choose who to count…', optionDefaults([
      { label: 'People', value: 'humans', emoji: '👤' }, { label: 'Bots', value: 'bots', emoji: '🤖' },
    ], [options.humans !== false ? 'humans' : null, options.bots !== false ? 'bots' : null]), 1, 2)));
  } else if (segment.type === 'role') {
    components.push(row(roleSelect(`admin:stats:roleselect:${item.id}:${index}`, 'Choose role(s) to count…', options.roleIds || [])));
  } else if (segment.type === 'voice') {
    components.push(row(select(`admin:stats:voicemode:${item.id}:${index}`, 'Voice channel filter…', optionDefaults([
      { label: 'All Voice Channels', value: 'all' }, { label: 'Only Selected Channels', value: 'whitelist' }, { label: 'All Except Selected', value: 'blacklist' },
    ], [options.mode || 'all']))));
  } else if (segment.type === 'channels') {
    components.push(row(select(`admin:stats:channeltypes:${item.id}:${index}`, 'Choose channel types…', optionDefaults([
      { label: 'Text Channels', value: 'text' }, { label: 'Voice Channels', value: 'voice' }, { label: 'Categories', value: 'category' },
    ], options.channelTypes || ['text', 'voice', 'category']), 1, 3)));
  } else if (segment.type === 'roles') {
    components.push(row(select(`admin:stats:roletypes:${item.id}:${index}`, 'Choose role types…', optionDefaults([
      { label: 'Server Roles', value: 'unmanaged' }, { label: 'Integration / Bot Roles', value: 'managed' },
    ], [options.unmanaged !== false ? 'unmanaged' : null, options.managed === true ? 'managed' : null]), 1, 2)));
  } else if (segment.type === 'datetime') {
    components.push(row(select(`admin:stats:dateformat:${item.id}:${index}`, 'Choose date/time display…', optionDefaults([
      { label: 'Sat, 12 Sep', value: 'weekday-short' }, { label: 'Saturday, 12 September', value: 'weekday-long' }, { label: '12/09/2026', value: 'date' }, { label: '05:30', value: 'time' }, { label: '12/09 05:30', value: 'date-time' },
    ], [options.format || 'weekday-short']))));
  } else if (segment.type === 'countdown') {
    components.push(row(select(`admin:stats:countdown:${item.id}:${index}`, 'Set countdown duration…', [
      { label: '1 Hour', value: '60' }, { label: '1 Day', value: '1440' }, { label: '7 Days', value: '10080' }, { label: '30 Days', value: '43200' },
    ])));
  } else if (segment.type === 'messages' || segment.type === 'voiceMinutes') {
    components.push(row(select(`admin:stats:period:${item.id}:${index}`, 'Choose activity period…', optionDefaults([
      { label: 'All Tracked Time', value: '0' }, { label: 'Last 24 Hours', value: '1' }, { label: 'Last 7 Days', value: '7' }, { label: 'Last 30 Days', value: '30' }, { label: 'Last 90 Days', value: '90' },
    ], [String(options.periodDays || 0)]))));
  }
  components.push(row(
    button(`admin:stats:remove:${item.id}:${index}`, '🗑️ Remove Value', ButtonStyle.Danger, item.segments.length <= 1),
    button(`admin:stats:edit:${item.id}`, '⬅️ Back')
  ));
  return {
    embeds: [footer(new EmbedBuilder()
      .setColor(PANEL_COLOR)
      .setTitle(`${TYPES[segment.type]?.[0] || '📊'} Edit Value ${index + 1} · ${TYPES[segment.type]?.[1] || segment.type}`)
      .setDescription(segment.type === 'role' ? 'Select the role or roles this value should monitor.' : 'Change what this live value counts.'), requester)],
    components: components.slice(0, 5),
  };
}

function buildAddPanel(item, requester = 'Management') {
  return {
    embeds: [footer(new EmbedBuilder().setColor(SUCCESS_COLOR).setTitle('➕ Add Counter Value').setDescription(`This counter displays **${item.segments.length} / 4** values. Choose another value to add.`), requester)],
    components: [row(select(`admin:stats:addtype:${item.id}`, 'Choose a value to add…', typeOptions())), row(button(`admin:stats:open:${item.id}`, '⬅️ Cancel'))],
  };
}

function buildDeletePanel(item, requester = 'Management') {
  return {
    embeds: [footer(new EmbedBuilder().setColor(DANGER_COLOR).setTitle('🗑️ Delete Counter?').setDescription(`This permanently removes **${item.name || 'Counter'}** and its Discord channel.\n\n**This cannot be undone.**`), requester)],
    components: [row(button(`admin:stats:delete-confirm:${item.id}`, '🗑️ Delete Counter', ButtonStyle.Danger), button(`admin:stats:open:${item.id}`, 'Cancel'))],
  };
}

function buildCategoryDeletePanel(requester = 'Management') {
  return {
    embeds: [footer(new EmbedBuilder().setColor(DANGER_COLOR).setTitle('🗑️ Delete Stats Category?').setDescription('This deletes **all saved counters and their Discord channels**, then removes the Stats category.\n\n**This cannot be undone.**'), requester)],
    components: [row(button('admin:stats:category:delete-confirm', '🗑️ Delete Everything', ButtonStyle.Danger), button('admin:stats:category', 'Cancel'))],
  };
}

function buildCategoryModal(guild) {
  const current = String(stats.getConfig(guild.id).settings?.categoryName || '📊 SERVER STATS');
  const modal = new ModalBuilder().setCustomId('admin:stats:category:rename-submit').setTitle('Counter Category');
  modal.addComponents(
    row(new TextInputBuilder().setCustomId('categoryName').setLabel('Category name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(90).setValue(current.replace(/^\S+\s+/, '').trim() || 'SERVER STATS')),
    row(new TextInputBuilder().setCustomId('categoryEmoji').setLabel('Emoji (optional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(16).setValue(current.match(/^\S+/)?.[0] || '📊'))
  );
  return modal;
}

function buildTextModal(item) {
  return new ModalBuilder()
    .setCustomId(`admin:stats:text-submit:${item.id}`)
    .setTitle('Counter Channel Text')
    .addComponents(row(new TextInputBuilder()
      .setCustomId('template')
      .setLabel('Channel text')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(100)
      .setValue(String(item.template || '{value}'))));
}

function buildTimezoneModal(guild) {
  return new ModalBuilder().setCustomId('admin:stats:settings:timezone-submit').setTitle('Stats Time Zone').addComponents(row(new TextInputBuilder()
    .setCustomId('timeZone').setLabel('IANA time zone').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(64).setValue(String(stats.getConfig(guild.id).settings?.timeZone || 'Europe/London'))));
}

function buildFrequencyModal(guild) {
  return new ModalBuilder().setCustomId('admin:stats:settings:frequency-submit').setTitle('Default Refresh').addComponents(row(new TextInputBuilder()
    .setCustomId('frequency').setLabel('Minutes (10 - 1440)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(4).setValue(String(stats.getConfig(guild.id).settings?.defaultFrequencyMinutes || 10))));
}

function bulkKey(interaction) { return `${interaction.guild?.id || 'guild'}:${interaction.user?.id || 'user'}`; }
function getBulkSelection(interaction) { return new Set(bulkSelections.get(bulkKey(interaction)) || []); }
function setBulkSelection(interaction, ids) {
  const allowed = new Set(listDocks(interaction.guild.id).map((item) => item.id));
  const next = [...new Set(ids || [])].filter((id) => allowed.has(id)).slice(0, BULK_LIMIT);
  bulkSelections.set(bulkKey(interaction), next);
  return new Set(next);
}
function dockSignature(item) { return JSON.stringify((item.segments || []).map((segment) => ({ type: segment.type, options: segment.options || {} }))); }
function duplicateExtraIds(all) {
  const groups = new Map();
  for (const item of all) {
    const key = dockSignature(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const extras = [];
  for (const group of groups.values()) {
    if (group.length <= 1) continue;
    const sorted = [...group].sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    extras.push(...sorted.slice(1).map((item) => item.id));
  }
  return extras.slice(0, BULK_LIMIT);
}

function buildBulkPanel(interaction, requester = 'Management', notice = null) {
  const all = listDocks(interaction.guild.id);
  const selected = getBulkSelection(interaction);
  const selectedItems = all.filter((item) => selected.has(item.id));
  const options = all.slice(0, BULK_LIMIT).map((item) => ({
    label: String(item.name || 'Counter').slice(0, 100), value: item.id, emoji: item.channelType === 'text' ? '#️⃣' : '🔊',
    description: `${item.enabled ? 'Active' : 'Off'} · ${(item.segments || []).map((segment) => TYPES[segment.type]?.[1] || segment.type).join(' + ')}`.slice(0, 100), default: selected.has(item.id),
  }));
  const components = [];
  if (options.length) {
    components.push(row(select('admin:stats:bulk:select', 'Select counters to manage…', options, 0, Math.min(BULK_LIMIT, options.length))));
    components.push(row(select('admin:stats:bulk:preset', 'Quick selection…', [
      { label: 'Select All', value: 'all', emoji: '✅' }, { label: 'Select Duplicate Extras', value: 'duplicates', emoji: '🧹', description: 'Keeps one of each matching counter' },
      { label: 'Select Voice Counters', value: 'voice', emoji: '🔊' }, { label: 'Select Text Counters', value: 'text', emoji: '#️⃣' }, { label: 'Select Adopted Counters', value: 'adopted', emoji: '🔗' }, { label: 'Clear Selection', value: 'clear', emoji: '✖️' },
    ])));
    components.push(row(button('admin:stats:bulk:delete', '🗑️ Delete Selected', ButtonStyle.Danger, !selectedItems.length), button('admin:stats:bulk:disable', '⏸️ Disable', ButtonStyle.Secondary, !selectedItems.length), button('admin:stats:bulk:enable', '▶️ Enable', ButtonStyle.Success, !selectedItems.length)));
    components.push(row(button('admin:stats:bulk:voice', '🔊 Make Voice', ButtonStyle.Primary, !selectedItems.length), button('admin:stats:bulk:text', '#️⃣ Make Text', ButtonStyle.Primary, !selectedItems.length), button('admin:stats:bulk:move', '📁 Move to Stats', ButtonStyle.Secondary, !selectedItems.length)));
  }
  components.push(navigation('admin:stats:manager'));
  const embed = footer(new EmbedBuilder().setColor(notice?.error ? DANGER_COLOR : PANEL_COLOR).setTitle('🧰 Server Counters · Bulk Manage').setDescription([
    `Select up to **${BULK_LIMIT} counters** and apply one action to all of them.`, '', `**Selected:** \`${selectedItems.length}\``, all.length > BULK_LIMIT ? `Showing the first ${BULK_LIMIT} of ${all.length} counters.` : null,
  ].filter(Boolean).join('\n')), requester);
  if (selectedItems.length) embed.addFields({ name: 'Selected Counters', value: selectedItems.slice(0, 12).map((item) => `• ${item.name || 'Counter'}${item.channelId ? ` — <#${item.channelId}>` : ''}`).join('\n').slice(0, 1024) });
  if (notice?.text) embed.addFields({ name: notice.error ? '⚠️ Problem' : '✅ Done', value: notice.text.slice(0, 1024) });
  return { embeds: [embed], components };
}

function buildBulkDeleteConfirm(interaction, requester = 'Management') {
  const selected = getBulkSelection(interaction);
  const items = listDocks(interaction.guild.id).filter((item) => selected.has(item.id));
  return {
    embeds: [footer(new EmbedBuilder().setColor(DANGER_COLOR).setTitle(`🗑️ Delete ${items.length} Counter${items.length === 1 ? '' : 's'}?`).setDescription([
      'This permanently deletes the selected counter configuration **and its Discord channel**.', '', items.slice(0, 10).map((item) => `• ${item.name || 'Counter'}`).join('\n'), items.length > 10 ? `• …and ${items.length - 10} more` : null, '', '**This cannot be undone.**',
    ].filter(Boolean).join('\n')), requester)],
    components: [row(button('admin:stats:bulk:delete-confirm', `🗑️ Delete ${items.length}`, ButtonStyle.Danger, !items.length), button('admin:stats:bulk', 'Cancel'))],
  };
}

function buildErrorPanel(title, message, requester = 'Management', backId = 'admin:stats:manager') {
  return { embeds: [footer(new EmbedBuilder().setColor(DANGER_COLOR).setTitle(`⚠️ ${title}`).setDescription(String(message || 'Something went wrong.').slice(0, 4000)), requester)], components: [row(button(backId, '⬅️ Back'))] };
}

async function send(interaction, payload) {
  if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
  else if (typeof interaction.update === 'function') await interaction.update(payload);
  else await interaction.reply({ ...payload, ephemeral: true });
  return true;
}

async function saveSegments(interaction, item, segments, requester) {
  const updated = await stats.counters.updateDock(interaction.guild, item.id, { segments, name: generatedName(segments), template: generatedTemplate(interaction.guild, segments) }, interaction.guild);
  return send(interaction, buildEditPanel(interaction.guild, updated, requester));
}

async function deleteOneCounter(guild, item) {
  if (!item) return false;
  return stats.counters.deleteDock(guild, item.id, guild);
}

async function syncMonitoredRoles(interaction, ids) {
  const guild = interaction.guild;
  const wanted = new Set((ids || []).filter((id) => id !== guild.id && guild.roles.cache.has(id)));
  for (const item of monitoredRoleDocks(guild.id)) {
    const roleId = item.segments?.[0]?.options?.roleIds?.[0];
    if (!wanted.has(roleId)) await deleteOneCounter(guild, item);
  }
  const current = new Map(monitoredRoleDocks(guild.id).map((item) => [item.segments?.[0]?.options?.roleIds?.[0], item]));
  const category = await ensureCategory(guild);
  for (const id of wanted) {
    const role = guild.roles.cache.get(id);
    const existing = current.get(id);
    if (!role) continue;
    if (existing) {
      await stats.counters.updateDock(guild, existing.id, { name: `Role: ${role.name}`, template: `🎭 ${role.name}: {value}`, segments: [{ type: 'role', options: { roleIds: [id], statuses: [] } }] }, guild);
    } else {
      await stats.counters.createDock(guild, { name: `Role: ${role.name}`, template: `🎭 ${role.name}: {value}`, segments: [{ type: 'role', options: { roleIds: [id], statuses: [] } }], categoryId: category.id, channelType: 'voice', source: 'monitored-role' }, guild);
    }
  }
}

async function applyBulkAction(interaction, action) {
  const guild = interaction.guild;
  const selected = getBulkSelection(interaction);
  const items = listDocks(guild.id).filter((item) => selected.has(item.id));
  if (!items.length) return { done: 0, failed: 0 };
  let done = 0;
  let failed = 0;
  let category = null;
  if (action === 'move') category = await ensureCategory(guild);
  for (const item of items) {
    try {
      if (action === 'enable') await stats.counters.setDockEnabled(guild, item.id, true, guild);
      else if (action === 'disable') await stats.counters.setDockEnabled(guild, item.id, false, guild);
      else if (action === 'voice' || action === 'text') await stats.counters.updateDock(guild, item.id, { channelType: action }, guild);
      else if (action === 'move') {
        if (item.channelId) {
          const channel = guild.channels.cache.get(item.channelId) || await guild.channels.fetch(item.channelId).catch(() => null);
          if (channel?.setParent) {
            await stats.counters.ensureManageChannels(guild, channel, 'move this Stats counter');
            await channel.setParent(category.id, { lockPermissions: false, reason: 'Goliath Stats bulk move' });
          }
        }
        stats.counters.saveDock(guild.id, { ...item, categoryId: category.id }, guild);
      }
      done += 1;
    } catch (error) {
      failed += 1;
      console.error(`[Stats] Bulk ${action} failed for ${item.id}:`, error);
    }
  }
  return { done, failed };
}

function updateConfig(guild, patch) {
  return stats.store.updateStats(guild.id, (config) => ({ ...config, ...patch, settings: patch.settings ? { ...(config.settings || {}), ...patch.settings } : config.settings }), guild);
}

async function handleStatsAdminInteraction(interaction) {
  const id = String(interaction?.customId || '');
  if (!id.startsWith('admin:stats')) return false;
  const guild = interaction.guild;
  const requester = requesterName(interaction);

  if (interaction.isModalSubmit?.()) {
    if (id === 'admin:stats:category:rename-submit') {
      await interaction.deferUpdate().catch(() => null);
      const raw = interaction.fields.getTextInputValue('categoryName').trim().slice(0, 90) || 'SERVER STATS';
      const emoji = interaction.fields.getTextInputValue('categoryEmoji').trim().slice(0, 16);
      const clean = emoji && raw.startsWith(emoji) ? raw.slice(emoji.length).trim() : raw;
      const categoryName = `${emoji ? `${emoji} ` : ''}${clean}`.trim().slice(0, 100) || 'SERVER STATS';
      const category = configuredCategory(guild);
      updateConfig(guild, { settings: { categoryName } });
      if (category?.setName && category.name !== categoryName) await category.setName(categoryName, 'Goliath Stats category renamed');
      return send(interaction, buildCategoryPanel(guild, requester, 'Category name updated.'));
    }
    if (id.startsWith('admin:stats:text-submit:')) {
      await interaction.deferUpdate().catch(() => null);
      const item = findDock(guild.id, id.slice('admin:stats:text-submit:'.length));
      if (!item) return send(interaction, buildManagerPanel(guild, requester));
      const template = interaction.fields.getTextInputValue('template').trim().slice(0, 100) || item.template;
      const updated = await stats.counters.updateDock(guild, item.id, { template }, guild);
      return send(interaction, buildEditPanel(guild, updated, requester));
    }
    if (id === 'admin:stats:settings:timezone-submit') {
      await interaction.deferUpdate().catch(() => null);
      const timeZone = interaction.fields.getTextInputValue('timeZone').trim().slice(0, 64) || 'Europe/London';
      try { new Intl.DateTimeFormat('en-GB', { timeZone }).format(new Date()); }
      catch { return send(interaction, buildSettingsPanel(guild, requester, 'That time zone is not valid. Use an IANA time zone such as Europe/London.')); }
      updateConfig(guild, { settings: { timeZone } });
      return send(interaction, buildSettingsPanel(guild, requester, 'Default time zone updated.'));
    }
    if (id === 'admin:stats:settings:frequency-submit') {
      await interaction.deferUpdate().catch(() => null);
      const frequency = Number(interaction.fields.getTextInputValue('frequency'));
      if (!Number.isFinite(frequency) || frequency < 10 || frequency > 1440) return send(interaction, buildSettingsPanel(guild, requester, 'Refresh must be between 10 and 1440 minutes.'));
      updateConfig(guild, { settings: { defaultFrequencyMinutes: Math.floor(frequency) } });
      return send(interaction, buildSettingsPanel(guild, requester, 'Default refresh updated. Existing counters keep their own refresh setting.'));
    }
  }

  if (interaction.isRoleSelectMenu?.()) {
    if (id === 'admin:stats:setup:roles' || id === 'admin:stats:category:roles') {
      await interaction.deferUpdate().catch(() => null);
      await reconcile(guild);
      await syncMonitoredRoles(interaction, interaction.values || []);
      return send(interaction, buildSetupPanel(guild, requester, 'Monitored roles updated.'));
    }
    const match = id.match(/^admin:stats:roleselect:([^:]+):(\d+)$/);
    if (match) {
      await interaction.deferUpdate().catch(() => null);
      const item = findDock(guild.id, match[1]);
      const index = Number(match[2]);
      if (!item?.segments[index]) return send(interaction, buildManagerPanel(guild, requester));
      const segments = item.segments.map((segment) => ({ ...segment, options: { ...(segment.options || {}) } }));
      segments[index].options.roleIds = (interaction.values || []).filter((roleId) => roleId !== guild.id);
      const updated = await stats.counters.updateDock(guild, item.id, { segments, template: generatedTemplate(guild, segments) }, guild);
      return send(interaction, buildValuePanel(guild, updated, index, requester));
    }
  }

  if (id === 'admin:stats') return send(interaction, buildMainPanel(guild, requester));
  if (id === 'admin:stats:setup-page') { await interaction.deferUpdate().catch(() => null); await reconcile(guild); return send(interaction, buildSetupPanel(guild, requester)); }
  if (id === 'admin:stats:manager') { await interaction.deferUpdate().catch(() => null); await reconcile(guild); return send(interaction, buildManagerPanel(guild, requester)); }
  if (id === 'admin:stats:settings') { await interaction.deferUpdate().catch(() => null); await reconcile(guild); return send(interaction, buildSettingsPanel(guild, requester)); }
  if (id === 'admin:stats:category') { await interaction.deferUpdate().catch(() => null); await reconcile(guild); return send(interaction, buildCategoryPanel(guild, requester)); }
  if (id === 'admin:stats:bulk') { await interaction.deferUpdate().catch(() => null); await reconcile(guild); return send(interaction, buildBulkPanel(interaction, requester)); }

  if (interaction.isStringSelectMenu?.()) {
    if (id === 'admin:stats:create') {
      await interaction.deferUpdate().catch(() => null);
      await reconcile(guild);
      const segments = [defaultSegment(interaction.values?.[0])];
      stats.setEnabled(guild.id, true, guild);
      const item = await stats.counters.createDock(guild, { name: generatedName(segments), template: generatedTemplate(guild, segments), channelType: 'voice', segments, frequencyMinutes: stats.getConfig(guild.id).settings?.defaultFrequencyMinutes || 10, source: 'panel' }, guild);
      return send(interaction, buildManagePanel(guild, item, requester));
    }
    if (id === 'admin:stats:manage') {
      const item = findDock(guild.id, interaction.values?.[0]);
      return send(interaction, item ? buildManagePanel(guild, item, requester) : buildManagerPanel(guild, requester));
    }
    if (id === 'admin:stats:bulk:select') { await interaction.deferUpdate().catch(() => null); setBulkSelection(interaction, interaction.values || []); return send(interaction, buildBulkPanel(interaction, requester)); }
    if (id === 'admin:stats:bulk:preset') {
      await interaction.deferUpdate().catch(() => null);
      const all = listDocks(guild.id);
      const preset = interaction.values?.[0];
      let ids = [];
      if (preset === 'all') ids = all.slice(0, BULK_LIMIT).map((item) => item.id);
      else if (preset === 'duplicates') ids = duplicateExtraIds(all);
      else if (preset === 'voice') ids = all.filter((item) => item.channelType !== 'text').slice(0, BULK_LIMIT).map((item) => item.id);
      else if (preset === 'text') ids = all.filter((item) => item.channelType === 'text').slice(0, BULK_LIMIT).map((item) => item.id);
      else if (preset === 'adopted') ids = all.filter((item) => ['adopted', 'default-suite'].includes(item.source)).slice(0, BULK_LIMIT).map((item) => item.id);
      setBulkSelection(interaction, ids);
      return send(interaction, buildBulkPanel(interaction, requester, preset === 'duplicates' && !ids.length ? { text: 'No duplicate extras were found.', error: false } : null));
    }
    const outputMatch = id.match(/^admin:stats:output:(.+)$/);
    if (outputMatch) {
      await interaction.deferUpdate().catch(() => null);
      const item = findDock(guild.id, outputMatch[1]);
      if (!item) return send(interaction, buildManagerPanel(guild, requester));
      try {
        const updated = await stats.counters.updateDock(guild, item.id, { channelType: interaction.values?.[0] }, guild);
        return send(interaction, buildEditPanel(guild, updated, requester));
      } catch (error) {
        return send(interaction, buildErrorPanel('Could not change channel type', error.message, requester, `admin:stats:edit:${item.id}`));
      }
    }
    const valueMatch = id.match(/^admin:stats:value:(.+)$/);
    if (valueMatch) {
      const item = findDock(guild.id, valueMatch[1]);
      return send(interaction, item ? buildValuePanel(guild, item, Number(interaction.values?.[0] || 0), requester) : buildManagerPanel(guild, requester));
    }
    const addTypeMatch = id.match(/^admin:stats:addtype:(.+)$/);
    if (addTypeMatch) {
      await interaction.deferUpdate().catch(() => null);
      const item = findDock(guild.id, addTypeMatch[1]);
      if (!item || item.segments.length >= 4) return send(interaction, item ? buildManagePanel(guild, item, requester) : buildManagerPanel(guild, requester));
      return saveSegments(interaction, item, [...item.segments, defaultSegment(interaction.values?.[0])], requester);
    }
    const valueTypeMatch = id.match(/^admin:stats:valuetype:([^:]+):(\d+)$/);
    if (valueTypeMatch) {
      await interaction.deferUpdate().catch(() => null);
      const item = findDock(guild.id, valueTypeMatch[1]);
      const index = Number(valueTypeMatch[2]);
      if (!item?.segments[index]) return send(interaction, buildManagerPanel(guild, requester));
      const segments = [...item.segments];
      segments[index] = defaultSegment(interaction.values?.[0]);
      const updated = await stats.counters.updateDock(guild, item.id, { segments, name: generatedName(segments), template: generatedTemplate(guild, segments) }, guild);
      return send(interaction, buildValuePanel(guild, updated, index, requester));
    }
    const configMatch = id.match(/^admin:stats:(status|members|voicemode|channeltypes|roletypes|dateformat|countdown|period):([^:]+):(\d+)$/);
    if (configMatch) {
      await interaction.deferUpdate().catch(() => null);
      const item = findDock(guild.id, configMatch[2]);
      const index = Number(configMatch[3]);
      if (!item?.segments[index]) return send(interaction, buildManagerPanel(guild, requester));
      const segments = item.segments.map((segment) => ({ ...segment, options: { ...(segment.options || {}) } }));
      const options = segments[index].options;
      const values = interaction.values || [];
      const action = configMatch[1];
      if (action === 'status') options.statuses = values;
      else if (action === 'members') { options.humans = values.includes('humans'); options.bots = values.includes('bots'); }
      else if (action === 'voicemode') options.mode = values[0] || 'all';
      else if (action === 'channeltypes') options.channelTypes = values;
      else if (action === 'roletypes') { options.unmanaged = values.includes('unmanaged'); options.managed = values.includes('managed'); }
      else if (action === 'dateformat') options.format = values[0] || 'weekday-short';
      else if (action === 'countdown') options.timestamp = Date.now() + Number(values[0] || 1440) * 60000;
      else if (action === 'period') options.periodDays = Number(values[0] || 0) || null;
      const updated = await stats.counters.updateDock(guild, item.id, { segments, template: generatedTemplate(guild, segments) }, guild);
      return send(interaction, buildValuePanel(guild, updated, index, requester));
    }
  }

  if (!interaction.isButton?.()) return false;

  if (id === 'admin:stats:setup') {
    await interaction.deferUpdate().catch(() => null);
    await reconcile(guild);
    stats.setEnabled(guild.id, true, guild);
    await stats.counters.createCounterSuite(guild);
    return send(interaction, buildSetupPanel(guild, requester, 'Quick Setup completed.'));
  }
  if (id === 'admin:stats:refresh' || id === 'admin:stats:category:refresh') {
    await interaction.deferUpdate().catch(() => null);
    await reconcile(guild);
    await stats.counters.refreshCounters(guild, { force: true });
    return send(interaction, buildManagerPanel(guild, requester, { text: 'All counters refreshed.', error: false }));
  }
  if (id === 'admin:stats:enable' || id === 'admin:stats:disable') {
    stats.setEnabled(guild.id, id.endsWith(':enable'), guild);
    return send(interaction, buildSettingsPanel(guild, requester, id.endsWith(':enable') ? 'Server Counters enabled.' : 'Server Counters disabled.'));
  }
  if (id === 'admin:stats:settings:timezone') { await interaction.showModal(buildTimezoneModal(guild)); return true; }
  if (id === 'admin:stats:settings:frequency') { await interaction.showModal(buildFrequencyModal(guild)); return true; }
  if (['messages', 'voice', 'members', 'bots'].some((key) => id === `admin:stats:settings:${key}`)) {
    const config = stats.getConfig(guild.id);
    if (id.endsWith(':messages')) updateConfig(guild, { trackMessages: config.trackMessages === false });
    if (id.endsWith(':voice')) updateConfig(guild, { trackVoice: config.trackVoice === false });
    if (id.endsWith(':members')) updateConfig(guild, { trackMembers: config.trackMembers === false });
    if (id.endsWith(':bots')) updateConfig(guild, { ignoreBots: config.ignoreBots === false });
    return send(interaction, buildSettingsPanel(guild, requester, 'Setting updated.'));
  }
  if (id === 'admin:stats:health') {
    await interaction.deferUpdate().catch(() => null);
    return send(interaction, buildHealthPanel(await statsHealth.buildHealth(guild), requester));
  }
  if (id === 'admin:stats:health:repair') {
    await interaction.deferUpdate().catch(() => null);
    try {
      const result = await statsHealth.repair(guild);
      return send(interaction, buildHealthPanel(result.health, requester, 'Repair completed and counters refreshed.'));
    } catch (error) {
      return send(interaction, buildErrorPanel('Health repair failed', error.message, requester, 'admin:stats:settings'));
    }
  }
  if (id === 'admin:stats:category:rename') { await interaction.showModal(buildCategoryModal(guild)); return true; }
  if (id === 'admin:stats:category:toggleall') {
    await interaction.deferUpdate().catch(() => null);
    await reconcile(guild);
    const all = listDocks(guild.id);
    const enable = !all.length || !all.every((item) => item.enabled);
    for (const item of all) await stats.counters.setDockEnabled(guild, item.id, enable, guild);
    return send(interaction, buildCategoryPanel(guild, requester, enable ? 'All counters turned on.' : 'All counters turned off.'));
  }
  if (id === 'admin:stats:category:delete') return send(interaction, buildCategoryDeletePanel(requester));
  if (id === 'admin:stats:category:delete-confirm') {
    await interaction.deferUpdate().catch(() => null);
    await reconcile(guild);
    try {
      for (const item of [...listDocks(guild.id)]) await deleteOneCounter(guild, item);
      const category = configuredCategory(guild);
      if (category) {
        await stats.counters.ensureManageChannels(guild, category, 'delete the Stats category');
        await category.delete('Goliath Stats category deleted');
      }
      return send(interaction, buildCategoryPanel(guild, requester, 'Stats category and counters deleted.'));
    } catch (error) {
      return send(interaction, buildErrorPanel('Could not delete everything', error.message, requester, 'admin:stats:category'));
    }
  }
  if (id === 'admin:stats:bulk:delete') return send(interaction, buildBulkDeleteConfirm(interaction, requester));
  if (id === 'admin:stats:bulk:delete-confirm') {
    await interaction.deferUpdate().catch(() => null);
    const selected = getBulkSelection(interaction);
    const items = listDocks(guild.id).filter((item) => selected.has(item.id));
    let deleted = 0;
    const failures = [];
    for (const item of items) {
      try { if (await deleteOneCounter(guild, item)) deleted += 1; }
      catch { failures.push({ id: item.id, name: item.name || 'Counter' }); }
    }
    setBulkSelection(interaction, failures.map((failure) => failure.id));
    const text = failures.length ? `Deleted **${deleted}**. **${failures.length}** could not be deleted.\n\n${failures.slice(0, 10).map((failure) => `• ${failure.name}`).join('\n')}` : `Deleted **${deleted}** counter${deleted === 1 ? '' : 's'} and their Discord channel${deleted === 1 ? '' : 's'}.`;
    return send(interaction, buildBulkPanel(interaction, requester, { text, error: failures.length > 0 }));
  }
  if (['admin:stats:bulk:enable', 'admin:stats:bulk:disable', 'admin:stats:bulk:voice', 'admin:stats:bulk:text', 'admin:stats:bulk:move'].includes(id)) {
    await interaction.deferUpdate().catch(() => null);
    const action = id.split(':').pop();
    const result = await applyBulkAction(interaction, action);
    return send(interaction, buildBulkPanel(interaction, requester, { text: `${result.done} counter${result.done === 1 ? '' : 's'} updated${result.failed ? ` · ${result.failed} failed` : ''}.`, error: result.failed > 0 }));
  }
  const textMatch = id.match(/^admin:stats:text:(.+)$/);
  if (textMatch) {
    const item = findDock(guild.id, textMatch[1]);
    if (!item) return send(interaction, buildManagerPanel(guild, requester));
    await interaction.showModal(buildTextModal(item));
    return true;
  }
  const openMatch = id.match(/^admin:stats:open:(.+)$/);
  if (openMatch) { const item = findDock(guild.id, openMatch[1]); return send(interaction, item ? buildManagePanel(guild, item, requester) : buildManagerPanel(guild, requester)); }
  const editMatch = id.match(/^admin:stats:edit:(.+)$/);
  if (editMatch) { const item = findDock(guild.id, editMatch[1]); return send(interaction, item ? buildEditPanel(guild, item, requester) : buildManagerPanel(guild, requester)); }
  const addMatch = id.match(/^admin:stats:add:(.+)$/);
  if (addMatch) { const item = findDock(guild.id, addMatch[1]); return send(interaction, item && item.segments.length < 4 ? buildAddPanel(item, requester) : item ? buildManagePanel(guild, item, requester) : buildManagerPanel(guild, requester)); }
  const removeMatch = id.match(/^admin:stats:remove:([^:]+):(\d+)$/);
  if (removeMatch) {
    await interaction.deferUpdate().catch(() => null);
    const item = findDock(guild.id, removeMatch[1]);
    const index = Number(removeMatch[2]);
    if (!item || item.segments.length <= 1 || !item.segments[index]) return send(interaction, item ? buildEditPanel(guild, item, requester) : buildManagerPanel(guild, requester));
    return saveSegments(interaction, item, item.segments.filter((_, i) => i !== index), requester);
  }
  const toggleMatch = id.match(/^admin:stats:toggle:(.+)$/);
  if (toggleMatch) {
    await interaction.deferUpdate().catch(() => null);
    const item = findDock(guild.id, toggleMatch[1]);
    if (!item) return send(interaction, buildManagerPanel(guild, requester));
    try { return send(interaction, buildManagePanel(guild, await stats.counters.setDockEnabled(guild, item.id, !item.enabled, guild), requester)); }
    catch (error) { return send(interaction, buildErrorPanel('Counter could not be changed', error.message, requester, `admin:stats:open:${item.id}`)); }
  }
  const deleteConfirmMatch = id.match(/^admin:stats:delete-confirm:(.+)$/);
  if (deleteConfirmMatch) {
    await interaction.deferUpdate().catch(() => null);
    const item = findDock(guild.id, deleteConfirmMatch[1]);
    if (!item) return send(interaction, buildManagerPanel(guild, requester));
    try { await deleteOneCounter(guild, item); return send(interaction, buildManagerPanel(guild, requester, { text: `${item.name || 'Counter'} was deleted.` })); }
    catch (error) { return send(interaction, buildErrorPanel('Counter could not be deleted', error.message, requester, `admin:stats:open:${item.id}`)); }
  }
  const deleteMatch = id.match(/^admin:stats:delete:(.+)$/);
  if (deleteMatch) { const item = findDock(guild.id, deleteMatch[1]); return send(interaction, item ? buildDeletePanel(item, requester) : buildManagerPanel(guild, requester)); }
  return false;
}

module.exports = { buildStatsAdminPanel: buildMainPanel, handleStatsAdminInteraction };
