'use strict';
const { EMOJIS, emojiLabel } = require('../../../core/ui/emojis');
const { navigationButton } = require('../../../core/guild/goliathNavigation');

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

const COLOR = 0x5865F2;
const SUCCESS = 0x57F287;
const WARNING = 0xFEE75C;
const DANGER = 0xED4245;
const DISABLED = 0x747F8D;
const BULK_LIMIT = 25;
const bulkSelections = new Map();

const TYPES = Object.freeze({
  channels: [EMOJIS.MOD_CASE_FOLDER, 'Channels'], countdown: [EMOJIS.STATS_TIMER, 'Countdown / Timer'], datetime: [EMOJIS.STATS_DATE, 'Date & Time'],
  members: [EMOJIS.ROLE_MEMBERS, 'Members'], status: [EMOJIS.ACTIVE, 'Members with Status'], role: [EMOJIS.USER_ROLES, 'Members in Role'],
  roles: [EMOJIS.ROLE_TAG, 'Roles'], voice: [EMOJIS.USER_TEMP_VOICE, 'Members in Voice'], messages: [EMOJIS.USER_FEEDBACK, 'Message Count'],
  voiceMinutes: [EMOJIS.STATS_VOICE_MINUTES, 'Voice Minutes'], joins: [EMOJIS.STATS_JOINS, 'Member Joins'], leaves: [EMOJIS.STATS_LEAVES, 'Member Leaves'],
  boosts: [EMOJIS.DEPLOY, 'Server Boosts'], emojis: [EMOJIS.AUTOMOD_EMOJI, 'Emojis'],
});
const STATUSES = Object.freeze({ online: [EMOJIS.ACTIVE, 'Online'], idle: [EMOJIS.STATS_IDLE, 'Idle'], dnd: [EMOJIS.STATS_DND, 'Do Not Disturb'], offline: [EMOJIS.RULE_INACTIVE, 'Offline'] });

const row = (...items) => new ActionRowBuilder().addComponents(...items.filter(Boolean));
const button = (id, label, style = ButtonStyle.Secondary, disabled = false) => navigationButton(id, label, style, disabled);
const requester = (i) => i.member?.displayName || i.user?.displayName || i.user?.username || 'Management';
const docks = (guildId) => stats.counters.listCounters(guildId);
const dock = (guildId, id) => docks(guildId).find((item) => item.id === id || item.channelId === id) || null;
const footer = (embed, name) => embed.setFooter({ text: `Requested by ${name}` }).setTimestamp();
const nav = (back = 'admin:stats', settings = true) => row(button(back, emojiLabel('BACK', 'Back')), settings ? button('admin:stats:settings', emojiLabel('MODERATION_DASHBOARD', 'Settings')) : null);

function select(id, placeholder, options, min = 1, max = 1) {
  const safe = options.slice(0, 25);
  return new StringSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder).setMinValues(Math.min(min, safe.length || 1)).setMaxValues(Math.min(max, safe.length || 1)).addOptions(safe);
}
function roleSelect(id, placeholder, values = []) {
  const menu = new RoleSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder).setMinValues(0).setMaxValues(25);
  if (values.length) menu.setDefaultRoles(...values.slice(0, 25));
  return menu;
}
function typeOptions(selected) {
  return Object.entries(TYPES).map(([value, [emoji, label]]) => ({ label, value, emoji, default: value === selected, description: `Show ${label.toLowerCase()}`.slice(0, 100) }));
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
function generatedName(segments) { return segments.length > 1 ? 'Combined Counter' : (TYPES[segments[0]?.type]?.[1] || 'Counter'); }
function generatedTemplate(guild, segments) {
  return segments.map((segment, index) => {
    const p = `{${index + 1}}`;
    if (segment.type === 'datetime') return `${EMOJIS.STATS_DATE} ${p}`;
    if (segment.type === 'countdown') return `⏳ ${p}`;
    if (segment.type === 'status') { const status = segment.options?.statuses?.[0]; const meta = STATUSES[status] || [EMOJIS.ACTIVE, 'Status']; return `${meta[0]} ${meta[1]}: ${p}`; }
    if (segment.type === 'role') { const role = guild.roles.cache.get(segment.options?.roleIds?.[0]); return `${EMOJIS.USER_ROLES} ${role?.name || 'Role'}: ${p}`; }
    const meta = TYPES[segment.type] || [EMOJIS.STATS_CHART, 'Counter']; return `${meta[0]} ${meta[1]}: ${p}`;
  }).join(' • ').slice(0, 100);
}
function category(guild) {
  const storedId = docks(guild.id).find((item) => item.categoryId)?.categoryId;
  if (storedId && guild.channels.cache.get(storedId)?.type === ChannelType.GuildCategory) return guild.channels.cache.get(storedId);
  const wanted = String(stats.getConfig(guild.id).settings?.categoryName || emojiLabel('ANALYTICS', 'SERVER STATS')).toLowerCase();
  return guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === wanted) || null;
}
function summary(all) {
  if (!all.length) return '> No counters have been created yet.';
  return all.slice(0, 12).map((item) => `${item.enabled ? EMOJIS.ACTIVE : EMOJIS.RULE_INACTIVE} ${item.channelType === 'text' ? EMOJIS.STATS_TEXT_CHANNEL : EMOJIS.USER_TEMP_VOICE} **${item.name || 'Counter'}**${item.channelId ? ` — <#${item.channelId}>` : ''}`).join('\n');
}
function valuesText(guild, item) {
  return (item.segments || []).map((segment, index) => `**${index + 1}.** ${(TYPES[segment.type] || [EMOJIS.STATS_CHART, segment.type]).join(' ')}`).join('\n') || 'None';
}
function updateConfig(guild, patch) {
  return stats.applyRuntimeConfig(guild, patch, guild);
}

function mainPanel(guild, who = 'Management') {
  const all = docks(guild.id); const config = stats.getSummary(guild.id); const cat = category(guild); const enabled = config.enabled !== false;
  return { embeds: [footer(new EmbedBuilder().setColor(enabled ? SUCCESS : DISABLED).setTitle(emojiLabel('ANALYTICS', 'Server Counters')).setDescription([
    'Create live Discord channels that keep your server numbers visible at a glance.', '',
    `**Module:** ${enabled ? emojiLabel('ENABLED', 'Enabled') : emojiLabel('DISABLED', 'Disabled')}`, `**Counters:** \`${all.length}\` saved · \`${all.filter((x) => x.enabled).length}\` active`,
    `**Category:** ${cat ? `**${cat.name}**` : '`Not created`'}`, '', 'Use **Setup** to add counters. Use **Manage** for existing counters and their category.',
  ].join('\n')), who)], components: [row(button('admin:stats:setup-page', emojiLabel('ADD', 'Setup'), ButtonStyle.Success), button('admin:stats:manager', emojiLabel('INCIDENT_AUDIT', 'Manage'), ButtonStyle.Primary, !all.length)), nav('admin:studio:utilityStudio')] };
}
function setupPanel(guild, who = 'Management', notice = '') {
  return { embeds: [footer(new EmbedBuilder().setColor(COLOR).setTitle(emojiLabel('ADD', 'Server Counters · Setup')).setDescription([notice ? `> ${notice}` : null, notice ? '' : null, 'Create your server counter channels here.', '', '**Quick Setup** creates Date & Time, Members, Presence and In Voice.', `**Saved Counters:** \`${docks(guild.id).length}\``].filter((x) => x !== null).join('\n')), who)], components: [row(button('admin:stats:setup', emojiLabel('THREAT', 'Quick Setup'), ButtonStyle.Success)), row(select('admin:stats:create', emojiLabel('ADD', 'Create a counter…'), typeOptions())), row(roleSelect('admin:stats:setup:roles', 'Select roles to monitor…')), nav('admin:stats')] };
}
function managerPanel(guild, who = 'Management', notice = null) {
  const all = docks(guild.id); const cat = category(guild); const components = [];
  if (all.length) components.push(row(select('admin:stats:manage', 'Choose a counter to manage…', all.map((item) => ({ label: String(item.name || 'Counter').slice(0, 100), value: item.id, emoji: item.channelType === 'text' ? EMOJIS.STATS_TEXT_CHANNEL : EMOJIS.USER_TEMP_VOICE, description: `${item.enabled ? 'Active' : 'Off'} · ${(item.segments || []).length} value${(item.segments || []).length === 1 ? '' : 's'}` })))));
  components.push(row(button('admin:stats:bulk', emojiLabel('TOOLS', 'Bulk Manage'), ButtonStyle.Primary, !all.length), button('admin:stats:category', emojiLabel('MOD_CASE_FOLDER', 'Category'), ButtonStyle.Secondary, !cat && !all.length)));
  components.push(row(button('admin:stats', emojiLabel('BACK', 'Back')), button('admin:stats:refresh', emojiLabel('REFRESH', 'Refresh'), ButtonStyle.Secondary, !all.length), button('admin:stats:settings', emojiLabel('MODERATION_DASHBOARD', 'Settings'))));
  const embed = footer(new EmbedBuilder().setColor(notice?.error ? DANGER : COLOR).setTitle(emojiLabel('INCIDENT_AUDIT', 'Server Counters · Manage')).setDescription(all.length ? 'View and manage your Server Counters, refresh their values or make changes to several counters at once.' : 'No counters have been created yet. Go back to **Setup** to create your first counter.').addFields({ name: 'Category', value: cat ? `${EMOJIS.MOD_CASE_FOLDER} **${cat.name}**` : '`Not created`', inline: true }, { name: 'Counters', value: `\`${all.length}\` saved · \`${all.filter((x) => x.enabled).length}\` active`, inline: true }, { name: 'Saved Counters', value: summary(all).slice(0, 1024) }), who);
  if (notice?.text) embed.addFields({ name: notice.error ? emojiLabel('WARNING', 'Problem') : emojiLabel('HEALTHY', 'Done'), value: notice.text.slice(0, 1024) });
  return { embeds: [embed], components };
}
function settingsPanel(guild, who = 'Management', notice = '') {
  const c = stats.getConfig(guild.id); const s = c.settings || {}; const enabled = stats.getSummary(guild.id).enabled !== false;
  const messages = c.trackMessages !== false; const voice = c.trackVoice !== false; const members = c.trackMembers !== false; const bots = c.ignoreBots !== false;
  return { embeds: [footer(new EmbedBuilder().setColor(enabled ? COLOR : DISABLED).setTitle(emojiLabel('MODERATION_DASHBOARD', 'Server Counters · Settings')).setDescription([notice ? `> ${notice}` : null, notice ? '' : null, 'These settings control **how Server Counters collects and updates data**. They do **not** create, hide or delete individual counters — use **Manage** for that.', '', `**Module:** ${enabled ? emojiLabel('ENABLED', 'Enabled') : emojiLabel('DISABLED', 'Disabled')}`, `**Default Time Zone:** ${s.timeZone || 'Europe/London'} — used by new date/time counters.`, `**Default Refresh:** ${s.defaultFrequencyMinutes || 10} minutes — used when new counters are created.`, '', '**Activity Tracking**', `${messages ? '✅' : '❌'} **Messages** — records message activity for message-based counters.`, `${voice ? '✅' : '❌'} **Voice** — records voice activity and voice minutes.`, `${members ? '✅' : '❌'} **Member Events** — records joins and leaves for member-event counters.`, `${bots ? '✅' : '❌'} **Ignore Bots** — excludes bot activity from tracked activity statistics.`, '', '**Health Check** scans the Stats setup for missing channels, permission problems and configuration issues.'].filter((x) => x !== null).join('\n')), who)], components: [row(button('admin:stats:settings:messages', emojiLabel('USER_FEEDBACK', 'Track Messages'), messages ? ButtonStyle.Success : ButtonStyle.Secondary), button('admin:stats:settings:voice', emojiLabel('UTILITY_MIC', 'Track Voice'), voice ? ButtonStyle.Success : ButtonStyle.Secondary), button('admin:stats:settings:members', emojiLabel('MOD_STAFF', 'Member Events'), members ? ButtonStyle.Success : ButtonStyle.Secondary), button('admin:stats:settings:bots', emojiLabel('AUTOMOD', 'Ignore Bots'), bots ? ButtonStyle.Success : ButtonStyle.Secondary)), row(button(enabled ? 'admin:stats:disable' : 'admin:stats:enable', enabled ? emojiLabel('USER_PAUSE', 'Disable') : emojiLabel('USER_PLAY', 'Enable'), enabled ? ButtonStyle.Danger : ButtonStyle.Success), button('admin:stats:health', emojiLabel('WELCOME_DIAGNOSTICS', 'Health'), ButtonStyle.Primary), button('admin:stats:settings:timezone', emojiLabel('INVITE_GLOBE', 'Time Zone')), button('admin:stats:settings:frequency', emojiLabel('AUTOMOD_LIMITS', 'Refresh')), button('admin:stats:settings:retention', emojiLabel('COMMUNITY_CALENDAR', 'Retention'))), nav('admin:stats', false)] };
}
function healthPanel(health, who = 'Management', notice = '') {
  const issues = health?.issues || [];
  return { embeds: [footer(new EmbedBuilder().setColor(health?.healthy ? SUCCESS : WARNING).setTitle(emojiLabel('WELCOME_DIAGNOSTICS', 'Server Counters · Health')).setDescription([notice ? `> ${notice}` : null, notice ? '' : null, `**Overall:** ${health?.healthy ? emojiLabel('HEALTHY', 'Healthy') : emojiLabel('WARNING', 'Needs attention')}`, `**Module:** ${health?.enabled ? emojiLabel('ENABLED', 'Enabled') : emojiLabel('DISABLED', 'Disabled')}`, `**Configured Counters:** \`${health?.counters?.configured || 0}\``, `**Missing Channels:** \`${health?.counters?.missing || 0}\``, '', issues.length ? issues.slice(0, 10).map((x) => `${x.severity === 'error' ? '❌' : '⚠️'} ${String(x.code).replaceAll('_', ' ')}`).join('\n') : emojiLabel('HEALTHY', 'No problems found.')].filter((x) => x !== null).join('\n')), who)], components: [row(button('admin:stats:health', emojiLabel('REFRESH', 'Check Again'), ButtonStyle.Primary), button('admin:stats:health:repair', emojiLabel('WELCOME_CUSTOM', 'Repair'), ButtonStyle.Success, health?.healthy)), nav('admin:stats:settings', false)] };
}
function counterPanel(guild, item, who = 'Management') {
  return { embeds: [footer(new EmbedBuilder().setColor(item.enabled ? SUCCESS : DISABLED).setTitle(`⚙️ ${item.name || 'Counter'}`).setDescription(item.channelId ? `Counter channel: <#${item.channelId}>` : 'Saved but currently turned off.').addFields({ name: 'Status', value: item.enabled ? emojiLabel('ENABLED', 'On') : emojiLabel('RULE_INACTIVE', 'Off'), inline: true }, { name: 'Channel Type', value: item.channelType === 'text' ? '#️⃣ Text Channel' : emojiLabel('USER_TEMP_VOICE', 'Voice Channel'), inline: true }, { name: 'Refresh', value: `${item.frequencyMinutes || 10} min`, inline: true }, { name: 'Values', value: valuesText(guild, item) }, { name: 'Preview', value: `\`${stats.counters.previewDock(guild, item)}\`` }, { name: 'Channel Text', value: `\`${item.template}\`` }), who)], components: [row(button(`admin:stats:edit:${item.id}`, emojiLabel('EDIT', 'Edit Counter'), ButtonStyle.Primary), button(`admin:stats:add:${item.id}`, emojiLabel('ADD', 'Add Value'), ButtonStyle.Success, item.segments.length >= 4), button(`admin:stats:toggle:${item.id}`, item.enabled ? emojiLabel('USER_PAUSE', 'Turn Off') : emojiLabel('USER_PLAY', 'Turn On'), item.enabled ? ButtonStyle.Secondary : ButtonStyle.Success)), row(button(`admin:stats:delete:${item.id}`, emojiLabel('DELETE', 'Delete'), ButtonStyle.Danger)), nav('admin:stats:manager')] };
}
function categoryPanel(guild, who = 'Management', notice = '') {
  const all = docks(guild.id); const cat = category(guild); const allOn = all.length && all.every((x) => x.enabled);
  return { embeds: [footer(new EmbedBuilder().setColor(COLOR).setTitle(emojiLabel('MOD_CASE_FOLDER', 'Server Counters · Category')).setDescription([notice ? `> ${notice}` : null, notice ? '' : null, 'Manage the Discord category and all counters inside it.', '', `**Category:** ${cat ? `**${cat.name}**` : '`Not created`'}`, `**Counters:** \`${all.length}\` saved · \`${all.filter((x) => x.enabled).length}\` active`].filter((x) => x !== null).join('\n')), who)], components: [row(button('admin:stats:category:rename', emojiLabel('EDIT', 'Name & Emoji')), button('admin:stats:category:toggleall', allOn ? emojiLabel('USER_PAUSE', 'Turn All Off') : emojiLabel('USER_PLAY', 'Turn All On'), allOn ? ButtonStyle.Secondary : ButtonStyle.Success, !all.length)), row(button('admin:stats:category:delete', emojiLabel('DELETE', 'Delete Category & Counters'), ButtonStyle.Danger, !all.length && !cat)), nav('admin:stats:manager')] };
}
function bulkPanel(i, who = 'Management', notice = null) {
  const all = docks(i.guild.id); const key = `${i.guild.id}:${i.user.id}`; const selected = new Set(bulkSelections.get(key) || []);
  const options = all.slice(0, BULK_LIMIT).map((x) => ({ label: String(x.name || 'Counter').slice(0, 100), value: x.id, emoji: x.channelType === 'text' ? EMOJIS.STATS_TEXT_CHANNEL : EMOJIS.USER_TEMP_VOICE, default: selected.has(x.id) }));
  const components = options.length ? [row(select('admin:stats:bulk:select', 'Select counters to manage…', options, 0, options.length)), row(button('admin:stats:bulk:delete', emojiLabel('DELETE', 'Delete Selected'), ButtonStyle.Danger, !selected.size), button('admin:stats:bulk:disable', emojiLabel('USER_PAUSE', 'Disable'), ButtonStyle.Secondary, !selected.size), button('admin:stats:bulk:enable', emojiLabel('USER_PLAY', 'Enable'), ButtonStyle.Success, !selected.size)), row(button('admin:stats:bulk:voice', emojiLabel('USER_TEMP_VOICE', 'Make Voice'), ButtonStyle.Primary, !selected.size), button('admin:stats:bulk:text', '#️⃣ Make Text', ButtonStyle.Primary, !selected.size))] : [];
  components.push(nav('admin:stats:manager'));
  const embed = footer(new EmbedBuilder().setColor(notice?.error ? DANGER : COLOR).setTitle(emojiLabel('TOOLS', 'Server Counters · Bulk Manage')).setDescription(`Select up to **${BULK_LIMIT} counters** and apply one action to all of them.\n\n**Selected:** \`${selected.size}\``), who);
  if (notice?.text) embed.addFields({ name: notice.error ? emojiLabel('WARNING', 'Problem') : emojiLabel('HEALTHY', 'Done'), value: notice.text });
  return { embeds: [embed], components };
}
function modal(id, title, fieldId, label, value, max = 100) { return new ModalBuilder().setCustomId(id).setTitle(title).addComponents(row(new TextInputBuilder().setCustomId(fieldId).setLabel(label).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(max).setValue(String(value || '')))); }
async function send(i, payload) { if (i.deferred || i.replied) await i.editReply(payload); else if (i.update) await i.update(payload); else await i.reply({ ...payload, ephemeral: true }); return true; }

async function handleStatsAdminInteraction(i) {
  const id = String(i?.customId || ''); if (!id.startsWith('admin:stats')) return false;
  const guild = i.guild; const who = requester(i);
  if (i.isModalSubmit?.()) {
    await i.deferUpdate().catch(() => null);
    if (id === 'admin:stats:settings:timezone-submit') { const timeZone = i.fields.getTextInputValue('timeZone').trim(); try { new Intl.DateTimeFormat('en-GB', { timeZone }).format(new Date()); } catch { return send(i, settingsPanel(guild, who, 'That time zone is not valid.')); } updateConfig(guild, { settings: { timeZone } }); return send(i, settingsPanel(guild, who, 'Default time zone updated.')); }
    if (id === 'admin:stats:settings:frequency-submit') { const n = Number(i.fields.getTextInputValue('frequency')); if (!Number.isFinite(n) || n < 10 || n > 1440) return send(i, settingsPanel(guild, who, 'Refresh must be between 10 and 1440 minutes.')); updateConfig(guild, { settings: { defaultFrequencyMinutes: Math.floor(n) } }); return send(i, settingsPanel(guild, who, 'Default refresh updated.')); }
    if (id === 'admin:stats:settings:retention-submit') { const n = Number(i.fields.getTextInputValue('retention')); if (!Number.isFinite(n) || n < 1 || n > 365) return send(i, settingsPanel(guild, who, 'Retention must be between 1 and 365 days.')); updateConfig(guild, { settings: { retentionDays: Math.floor(n) } }); return send(i, settingsPanel(guild, who, 'Activity retention updated.')); }
    if (id.startsWith('admin:stats:text-submit:')) { const item = dock(guild.id, id.slice(24)); if (!item) return send(i, managerPanel(guild, who)); const updated = await stats.counters.updateDock(guild, item.id, { template: i.fields.getTextInputValue('template').trim().slice(0, 100) }, guild); return send(i, counterPanel(guild, updated, who)); }
    if (id === 'admin:stats:category:rename-submit') { const name = i.fields.getTextInputValue('categoryName').trim().slice(0, 100) || emojiLabel('ANALYTICS', 'SERVER STATS'); updateConfig(guild, { settings: { categoryName: name } }); const cat = category(guild); if (cat?.setName) await cat.setName(name, 'Goliath Stats category renamed'); return send(i, categoryPanel(guild, who, 'Category name updated.')); }
  }
  if (id === 'admin:stats') return send(i, mainPanel(guild, who));
  if (id === 'admin:stats:setup-page') return send(i, setupPanel(guild, who));
  if (id === 'admin:stats:manager') return send(i, managerPanel(guild, who));
  if (id === 'admin:stats:settings') return send(i, settingsPanel(guild, who));
  if (id === 'admin:stats:category') return send(i, categoryPanel(guild, who));
  if (id === 'admin:stats:bulk') return send(i, bulkPanel(i, who));
  if (i.isStringSelectMenu?.()) {
    if (id === 'admin:stats:create') { await i.deferUpdate().catch(() => null); const segments = [defaultSegment(i.values[0])]; stats.setEnabled(guild.id, true, guild); const item = await stats.counters.createDock(guild, { name: generatedName(segments), template: generatedTemplate(guild, segments), channelType: 'voice', segments, frequencyMinutes: stats.getConfig(guild.id).settings?.defaultFrequencyMinutes || 10, source: 'panel' }, guild); return send(i, counterPanel(guild, item, who)); }
    if (id === 'admin:stats:manage') { const item = dock(guild.id, i.values[0]); return send(i, item ? counterPanel(guild, item, who) : managerPanel(guild, who)); }
    if (id === 'admin:stats:bulk:select') { bulkSelections.set(`${guild.id}:${i.user.id}`, i.values || []); return send(i, bulkPanel(i, who)); }
  }
  if (!i.isButton?.()) return false;
  if (id === 'admin:stats:setup') { await i.deferUpdate().catch(() => null); stats.setEnabled(guild.id, true, guild); await stats.counters.createCounterSuite(guild); return send(i, setupPanel(guild, who, 'Quick Setup completed.')); }
  if (id === 'admin:stats:refresh') { await i.deferUpdate().catch(() => null); await stats.counters.refreshCounters(guild, {
    force: true,
    fetchMembers: true,
  }); return send(i, managerPanel(guild, who, { text: 'All counters refreshed.' })); }
  if (id === 'admin:stats:enable' || id === 'admin:stats:disable') { stats.setEnabled(guild.id, id.endsWith(':enable'), guild); return send(i, settingsPanel(guild, who, id.endsWith(':enable') ? 'Server Counters enabled.' : 'Server Counters disabled.')); }
  if (id === 'admin:stats:health') { await i.deferUpdate().catch(() => null); return send(i, healthPanel(await stats.buildHealth(guild), who)); }
  if (id === 'admin:stats:health:repair') { await i.deferUpdate().catch(() => null); const result = await stats.repair(guild); return send(i, healthPanel(result.health, who, 'Repair completed and counters refreshed.')); }
  if (id === 'admin:stats:settings:timezone') { await i.showModal(modal(id + '-submit', 'Stats Time Zone', 'timeZone', 'IANA time zone', stats.getConfig(guild.id).settings?.timeZone || 'Europe/London', 64)); return true; }
  if (id === 'admin:stats:settings:frequency') { await i.showModal(modal(id + '-submit', 'Default Refresh', 'frequency', 'Minutes (10 - 1440)', stats.getConfig(guild.id).settings?.defaultFrequencyMinutes || 10, 4)); return true; }
  if (id === 'admin:stats:settings:retention') { await i.showModal(modal(id + '-submit', 'Activity Retention', 'retention', 'Days (1 - 365)', stats.getConfig(guild.id).settings?.retentionDays || 30, 3)); return true; }
  for (const key of ['messages', 'voice', 'members', 'bots']) if (id === `admin:stats:settings:${key}`) { const c = stats.getConfig(guild.id); if (key === 'messages') updateConfig(guild, { trackMessages: c.trackMessages === false }); if (key === 'voice') updateConfig(guild, { trackVoice: c.trackVoice === false }); if (key === 'members') updateConfig(guild, { trackMembers: c.trackMembers === false }); if (key === 'bots') updateConfig(guild, { ignoreBots: c.ignoreBots === false }); return send(i, settingsPanel(guild, who, 'Setting updated.')); }
  const toggle = id.match(/^admin:stats:toggle:(.+)$/); if (toggle) { await i.deferUpdate().catch(() => null); const item = dock(guild.id, toggle[1]); if (!item) return send(i, managerPanel(guild, who)); return send(i, counterPanel(guild, await stats.counters.setDockEnabled(guild, item.id, !item.enabled, guild), who)); }
  const del = id.match(/^admin:stats:delete:(.+)$/); if (del) { const item = dock(guild.id, del[1]); if (!item) return send(i, managerPanel(guild, who)); await i.deferUpdate().catch(() => null); await stats.counters.deleteDock(guild, item.id, guild); return send(i, managerPanel(guild, who, { text: `${item.name || 'Counter'} was deleted.` })); }
  if (id === 'admin:stats:category:rename') { await i.showModal(modal('admin:stats:category:rename-submit', 'Counter Category', 'categoryName', 'Category name', stats.getConfig(guild.id).settings?.categoryName || emojiLabel('ANALYTICS', 'SERVER STATS'))); return true; }
  if (id === 'admin:stats:category:toggleall') { await i.deferUpdate().catch(() => null); const all = docks(guild.id); const enable = !all.every((x) => x.enabled); for (const item of all) await stats.counters.setDockEnabled(guild, item.id, enable, guild); return send(i, categoryPanel(guild, who, enable ? 'All counters turned on.' : 'All counters turned off.')); }
  for (const action of ['enable', 'disable', 'voice', 'text']) if (id === `admin:stats:bulk:${action}`) { await i.deferUpdate().catch(() => null); const selected = new Set(bulkSelections.get(`${guild.id}:${i.user.id}`) || []); let done = 0; for (const item of docks(guild.id).filter((x) => selected.has(x.id))) { if (action === 'enable' || action === 'disable') await stats.counters.setDockEnabled(guild, item.id, action === 'enable', guild); else await stats.counters.updateDock(guild, item.id, { channelType: action }, guild); done++; } return send(i, bulkPanel(i, who, { text: `${done} counter${done === 1 ? '' : 's'} updated.` })); }
  return false;
}

module.exports = { buildStatsAdminPanel: mainPanel, handleStatsAdminInteraction };
