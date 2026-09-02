'use strict';
const { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, EmbedBuilder, ModalBuilder, PermissionFlagsBits, RoleSelectMenuBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const crypto = require('crypto');
const security = require('../../../core/security/protection/core');
const store = require('./socialStudioStore');
const { normalizeAccountInput, migrateAccount } = require('./accountNormalizer');
const { providerInfo } = require('./socialStudioProviders');
const { forcePostCreatorLive } = require('./socialStudioMonitor');
const { ALERT_TYPES, normalizeTemplates, resolveTemplate, resetTemplate } = require('./socialStudioTemplates');

const P = 'social:';
const PAGE_SIZE = 25;
const PLATFORMS = ['facebook', 'instagram', 'kick', 'tiktok', 'twitch', 'x', 'youtube'];
const ALERT_LABEL = { live: 'LIVE', ended: 'Stream Ended', vod: 'VOD', clip: 'Clip', upload: 'Upload', short: 'Short', post: 'Social Post' };
const ALERT_EMOJI = { live: '🔴', ended: '⚫', vod: '🎞️', clip: '🎬', upload: '📺', short: '📱', post: '📝' };
const ALERT_HELP = {
  live: 'Controls the stream start alert.',
  ended: 'Controls the stream finished update.',
  vod: 'Controls replay/VOD alerts, such as Twitch stream replays.',
  clip: 'Controls short clip alerts.',
  upload: 'Controls long-form video upload alerts.',
  short: 'Controls short-form video alerts.',
  post: 'Controls normal social feed posts, not VOD/replay alerts.',
};
const LABEL = { twitch: 'Twitch', youtube: 'YouTube', tiktok: 'TikTok', kick: 'Kick', facebook: 'Facebook', instagram: 'Instagram', x: 'X' };
const ICON = { twitch: '🟣', youtube: '🔴', tiktok: '⚫', kick: '🟢', facebook: '🔵', instagram: '🟠', x: '⚪' };
const PLATFORM_COLOR = { twitch: 0x9146FF, youtube: 0xFF0000, tiktok: 0x2F3136, kick: 0x53FC18, facebook: 0x1877F2, instagram: 0xE1306C, x: 0xFFFFFF };
const NAV = new Set(['creators', 'accounts', 'notifications', 'templates', 'variables', 'channels', 'settings', 'permissions', 'roles', 'operations', 'monitoring', 'liveMessages', 'diagnostics', 'automation', 'testing', 'data']);
const SETTINGS_CHILDREN = new Set(['permissions', 'roles', 'operations', 'monitoring', 'liveMessages', 'diagnostics', 'automation', 'testing', 'data']);
const accountSessions = new Map();
const creatorSessions = new Map();
const feedSessions = new Map();
const row = (...components) => new ActionRowBuilder().addComponents(...components);
const btn = (id, label, style = ButtonStyle.Secondary, disabled = false) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
const linkBtn = (url, label) => new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel(label);
const sessionKey = (i) => `${i.guildId}:${i.user?.id || 'unknown'}`;
const who = (i) => i.member?.displayName || i.user?.displayName || i.user?.username || 'Unknown User';
const makeId = (prefix) => `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
const now = () => new Date().toISOString();
const MONITORING_INTERVALS = [
  { label: 'Interval: 30 seconds', value: '30000', description: 'Check providers every 30 seconds.' },
  { label: 'Interval: 1 minute', value: '60000', description: 'Check providers every minute.' },
  { label: 'Interval: 5 minutes', value: '300000', description: 'Check providers every 5 minutes.' },
  { label: 'Interval: 10 minutes', value: '600000', description: 'Check providers every 10 minutes.' },
  { label: 'Interval: 15 minutes', value: '900000', description: 'Check providers every 15 minutes.' },
  { label: 'Interval: 30 minutes', value: '1800000', description: 'Check providers every 30 minutes.' },
  { label: 'Interval: 1 hour', value: '3600000', description: 'Check providers every hour.' },
];
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort((a, b) => a.localeCompare(b)).reduce((sorted, key) => {
    sorted[key] = sortKeys(value[key]);
    return sorted;
  }, {});
}
const accountSort = (a, b) => {
  const platform = String(LABEL[a?.platform] || a?.platform || '').localeCompare(String(LABEL[b?.platform] || b?.platform || ''), undefined, { sensitivity: 'base' });
  if (platform) return platform;
  return String(a?.username || a?.externalId || '').localeCompare(String(b?.username || b?.externalId || ''), undefined, { sensitivity: 'base' });
};
const supportedAlerts = (platform) => {
  const supported = (providerInfo(platform).supportedAlertTypes || []).filter((type) => ALERT_TYPES.includes(type));
  if (supported.includes('live') && !supported.includes('ended')) supported.splice(1, 0, 'ended');
  return supported;
};
const hasAnyRole = (member, roleIds = []) => Array.isArray(roleIds) && roleIds.some((id) => member?.roles?.cache?.has?.(id));
function canManageSocialStudio(i, config = getConfig(i.guildId)) {
  return Boolean(
    security.isBotOwner?.(i.user?.id) ||
    i.guild?.ownerId === i.user?.id ||
    i.member?.permissions?.has?.(PermissionFlagsBits.Administrator) ||
    hasAnyRole(i.member, config.managerRoleIds),
  );
}
async function denySocialAccess(i) {
  const payload = { content: 'You do not have permission to manage Social Studio.', flags: 64 };
  if (i.deferred || i.replied) await i.followUp(payload).catch(() => null);
  else await i.reply(payload);
  return true;
}

const getConfig = store.getConfig;

function saveConfig(guildId, config, guild, actorId = null) {
  return store.saveConfig(guildId, config, {
    actorId,
    guild,
  });
}

function applyNotificationDefaults(config) {
  const mode = ['none', 'role', 'everyone', 'here'].includes(config.notificationMentionMode)
    ? config.notificationMentionMode
    : 'none';
  const roleId = mode === 'role' ? config.notificationRoleId || null : null;
  for (const account of Object.values(config.accounts || {})) {
    if (!account || typeof account !== 'object') continue;
    account.mentionMode = mode;
    account.mentionRoleId = roleId;
    account.updatedAt = now();
  }
}

function getAccountSession(i) { return accountSessions.get(sessionKey(i)) || { creatorId: null, platforms: [], accountId: null, routeType: 'default' }; }
function setAccountSession(i, patch) { const next = { ...getAccountSession(i), ...patch }; accountSessions.set(sessionKey(i), next); return next; }
function getCreatorSession(i) { return creatorSessions.get(sessionKey(i)) || { creatorId: null, page: 0 }; }
function setCreatorSession(i, patch) { const next = { ...getCreatorSession(i), ...patch }; creatorSessions.set(sessionKey(i), next); return next; }
function getFeedSession(i) { return feedSessions.get(sessionKey(i)) || { routeType: 'default' }; }
function setFeedSession(i, patch) { const next = { ...getFeedSession(i), ...patch }; feedSessions.set(sessionKey(i), next); return next; }
function embed(config, title, description, requestedBy, color = null) { return new EmbedBuilder().setColor(color || (config.enabled ? 0x5865F2 : 0x747F8D)).setTitle(title).setDescription(description).setFooter({ text: `Requested by ${requestedBy}` }).setTimestamp(); }
function platformColor(platform) { return PLATFORM_COLOR[platform] || 0x5865F2; }
function creatorAccent(linked) { const platforms = [...new Set((linked || []).map((account) => account?.platform).filter(Boolean))]; return platforms.length === 1 ? platformColor(platforms[0]) : null; }
function navigation(active = 'main') {
  let backId = 'admin:studio:socialStudio';
  let secondaryId = `${P}settings`;
  let secondaryLabel = '⚙️ Settings';
  let secondaryDisabled = active === 'settings';
  if (active === 'settings') backId = `${P}main`;
  else if (SETTINGS_CHILDREN.has(active)) { backId = `${P}settings`; secondaryId = `${P}main`; secondaryLabel = '🏠 Social Studio'; secondaryDisabled = false; }
  else if (active !== 'main') backId = `${P}main`;
  return row(btn(backId, '⬅️ Back'), btn(secondaryId, secondaryLabel, ButtonStyle.Secondary, secondaryDisabled));
}

function creatorSelect(creators, selected, id = `${P}account:creator`, placeholder = '1. Select the creator profile') {
  return row(new StringSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder).setMinValues(1).setMaxValues(1).addOptions(creators.slice(0, 25).map((c) => ({ label: String(c.displayName || 'Unnamed creator').slice(0, 100), value: c.creatorId, description: `${(c.accountIds || []).length} linked account(s)`.slice(0, 100), default: c.creatorId === selected }))));
}
function accountSelect(accounts, selected) {
  return row(new StringSelectMenuBuilder().setCustomId(`${P}account:select`).setPlaceholder('2. Select an account to manage').setMinValues(1).setMaxValues(1).addOptions(accounts.slice(0, 25).map((a) => ({ label: `${LABEL[a.platform] || a.platform} · ${a.username || a.externalId || 'Resolving'}`.slice(0, 100), value: a.accountId, description: String(a.profileUrl || a.externalId || '').slice(0, 100), default: a.accountId === selected }))));
}
function platformSelect(selected = []) { return row(new StringSelectMenuBuilder().setCustomId(`${P}account:platforms`).setPlaceholder('Select platform(s) to add an account').setMinValues(1).setMaxValues(5).addOptions(PLATFORMS.map((p) => ({ label: LABEL[p], value: p, default: selected.includes(p) })))); }
function routeTypeSelect(id, selected, types = ALERT_TYPES) {
  const copy = {
    default: { label: '🏠 Default Channel', description: 'All social posts go here unless you choose a dedicated channel below.' },
    live: { label: '🔴 LIVE Alerts', description: 'When a creator starts streaming.' },
    ended: { label: '⚫ Stream Ended', description: 'When a live stream finishes.' },
    vod: { label: '🎥 VOD Posts', description: 'When a stream replay is available.' },
    clip: { label: '🎬 Clip Posts', description: 'When a new clip is found.' },
    upload: { label: '📺 Video Uploads', description: 'When a new video is uploaded.' },
    short: { label: '📱 Shorts', description: 'When a short-form video is found.' },
    post: { label: '📝 Social Posts', description: 'When a normal social post is found.' },
  };
  const options = [copy.default, ...types.map((type) => ({ label: copy[type]?.label || ALERT_LABEL[type] || type, value: type, description: copy[type]?.description || ('Choose where ' + (ALERT_LABEL[type] || type) + ' posts go.') }))];
  options[0] = { ...options[0], value: 'default' };
  return row(new StringSelectMenuBuilder().setCustomId(id).setPlaceholder('Choose what you want to send').setMinValues(1).setMaxValues(1).addOptions(options.map((o) => ({ ...o, default: o.value === selected }))));
}
function platformAvailabilityLines() {
  const available = {};
  for (const type of ALERT_TYPES) available[type] = [];
  for (const platform of PLATFORMS) for (const type of supportedAlerts(platform)) available[type]?.push(LABEL[platform] || platform);
  return ALERT_TYPES.filter((type) => available[type]?.length).map((type) => `${ALERT_EMOJI[type] || '🔔'} **${ALERT_LABEL[type]}:** ${available[type].join(', ')}`);
}
function platformAvailabilityText(type) {
  const platforms = PLATFORMS.filter((platform) => supportedAlerts(platform).includes(type)).map((platform) => LABEL[platform] || platform);
  return platforms.length ? platforms.join(', ') : 'No connected provider currently reports this alert type.';
}
function notificationTargetSelect(i, config) {
  const selected = config.notificationMentionMode === 'role' && config.notificationRoleId
    ? `role:${config.notificationRoleId}`
    : config.notificationMentionMode;
  const roles = [...(i.guild?.roles?.cache?.values?.() || [])]
    .filter((role) => role && role.id !== i.guildId && !role.managed)
    .sort((a, b) => b.position - a.position)
    .slice(0, 22);
  return row(new StringSelectMenuBuilder()
    .setCustomId(`${P}notification:mode`)
    .setPlaceholder('Select LIVE notification target')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions([
      ...roles.map((role) => ({
        label: role.name.slice(0, 100),
        value: `role:${role.id}`,
        description: 'Ping this role when a creator goes LIVE.',
        default: selected === `role:${role.id}`,
      })),
      {
        label: '@here',
        value: 'here',
        description: 'Ping currently online members.',
        default: selected === 'here',
      },
      {
        label: '@everyone',
        value: 'everyone',
        description: 'Ping everyone when a creator goes LIVE.',
        default: selected === 'everyone',
      },
      {
        label: 'No notification ping',
        value: 'none',
        description: 'Post alerts without pinging members.',
        default: selected === 'none',
      },
    ]));
}
function monitoringIntervalSelect(settings = {}) {
  const current = String(Math.max(30000, Number(settings.checkIntervalMs || 300000)));
  return row(new StringSelectMenuBuilder()
    .setCustomId(`${P}automation:interval`)
    .setPlaceholder('Choose check interval')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(MONITORING_INTERVALS.map((option) => ({ ...option, default: option.value === current }))));
}
function monitoringBooleanSelect(id, label, enabled) {
  return row(new StringSelectMenuBuilder()
    .setCustomId(id)
    .setPlaceholder(label)
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions([
      { label: `${label}: Enabled`, value: 'true', description: `Turn ${label.toLowerCase()} on.`, default: enabled === true },
      { label: `${label}: Disabled`, value: 'false', description: `Turn ${label.toLowerCase()} off.`, default: enabled !== true },
    ]));
}
function channelSelect(id, selected, placeholder) { const m = new ChannelSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder).setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(1).setMaxValues(1); if (selected) m.setDefaultChannels([selected]); return row(m); }
function roleSelect(ids, customId = `${P}roles:select`, placeholder = 'Select Social Studio manager roles') { const m = new RoleSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder).setMinValues(0).setMaxValues(10); if (ids?.length) m.setDefaultRoles(ids.slice(0, 10)); return row(m); }
function notificationRoleSelect(roleId, disabled = false) {
  const menu = new RoleSelectMenuBuilder()
    .setCustomId(`${P}notification:role`)
    .setPlaceholder('Select the role pinged for LIVE alerts')
    .setMinValues(0)
    .setMaxValues(1)
    .setDisabled(disabled);
  if (roleId) menu.setDefaultRoles([roleId]);
  return row(menu);
}

function creatorModal(c = null) {
  return new ModalBuilder().setCustomId(c ? `${P}creator:update:${c.creatorId}` : `${P}creator:create`).setTitle(c ? 'Edit Creator Profile' : 'Create Creator Profile').addComponents(
    row(new TextInputBuilder().setCustomId('displayName').setLabel('Creator display name').setPlaceholder('Enter the public creator name here').setStyle(TextInputStyle.Short).setMaxLength(120).setRequired(true).setValue(String(c?.displayName || ''))),
    row(new TextInputBuilder().setCustomId('group').setLabel('Group or team').setPlaceholder('Add their team, brand or category here').setStyle(TextInputStyle.Short).setMaxLength(120).setRequired(false).setValue(String(c?.group || ''))),
    row(new TextInputBuilder().setCustomId('tags').setLabel('Tags (comma separated)').setPlaceholder('Example: streamer, ksj, twitch').setStyle(TextInputStyle.Short).setMaxLength(300).setRequired(false).setValue(Array.isArray(c?.tags) ? c.tags.join(', ') : '')),
    row(new TextInputBuilder().setCustomId('notes').setLabel('Profile Notes (optional)').setPlaceholder('Add notes about this creator profile.').setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(false).setValue(String(c?.notes || ''))),
    row(new TextInputBuilder()
      .setCustomId('adminNotes')
      .setLabel('Admin Notes (Management Only)')
      .setPlaceholder('Private notes visible only to Social Studio managers.')
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(1000)
      .setRequired(false)
      .setValue(String(c?.adminNotes || ''))
    ),

  );
}
function accountModal(platforms) { const m = new ModalBuilder().setCustomId(`${P}account:create-multi`).setTitle('Add Social Accounts'); for (const p of platforms.slice(0, 5)) m.addComponents(row(new TextInputBuilder().setCustomId(`account_${p}`).setLabel(`${LABEL[p]} username, channel ID or URL`).setPlaceholder(`Paste the ${LABEL[p]} profile URL, username or ID here`).setStyle(TextInputStyle.Short).setMaxLength(500).setRequired(true))); return m; }
function accountEditModal(a) { return new ModalBuilder().setCustomId(`${P}account:update:${a.accountId}`).setTitle(`Edit ${LABEL[a.platform] || a.platform} Account`).addComponents(row(new TextInputBuilder().setCustomId('accountValue').setLabel('Username, channel ID or URL').setPlaceholder('Paste the profile URL, username or channel ID here').setStyle(TextInputStyle.Short).setMaxLength(500).setRequired(true).setValue(String(a.sourceInput || a.profileUrl || a.externalId || a.username || '')))); }
function accountMoveNewProfileModal(account) {
  return new ModalBuilder().setCustomId(`${P}account:move:create`).setTitle('Move Account to New Profile').addComponents(
    row(new TextInputBuilder().setCustomId('displayName').setLabel('New creator display name').setPlaceholder(`Example: ${account.displayName || account.username || account.externalId || 'Creator name'}`).setStyle(TextInputStyle.Short).setMaxLength(120).setRequired(true)),
    row(new TextInputBuilder().setCustomId('group').setLabel('Group or team').setPlaceholder('Optional team, brand or category').setStyle(TextInputStyle.Short).setMaxLength(120).setRequired(false)),
    row(new TextInputBuilder().setCustomId('tags').setLabel('Tags (comma separated)').setPlaceholder(`Example: ${account.platform || 'social'}, creator`).setStyle(TextInputStyle.Short).setMaxLength(300).setRequired(false)),
    row(new TextInputBuilder().setCustomId('notes').setLabel('Profile Notes (optional)').setPlaceholder('Add notes about this creator profile.').setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(false)),
  );
}
function templateModal(type, config) {
  const defaults = config.templates?.defaults?.[type] || resolveTemplate(config.templates, type);
  const c = resolveTemplate(config.templates, type);
  return new ModalBuilder().setCustomId(`${P}template:save:${type}`).setTitle(`${ALERT_LABEL[type] || type} Template`).addComponents(
    row(new TextInputBuilder().setCustomId('title').setLabel('Alert headline').setPlaceholder(defaults.title).setStyle(TextInputStyle.Short).setMaxLength(256).setValue(String(c.title)).setRequired(true)),
    row(new TextInputBuilder().setCustomId('description').setLabel('Main message text').setPlaceholder('This appears under the headline. Example: **{title}**').setStyle(TextInputStyle.Paragraph).setMaxLength(2000).setValue(String(c.description)).setRequired(true)),
  );
}
function quietHoursModal(config) {
  const quiet = config.settings?.quietHours && typeof config.settings.quietHours === 'object' ? config.settings.quietHours : {};
  return new ModalBuilder().setCustomId(`${P}automation:quiet`).setTitle('Configure Quiet Hours').addComponents(
    row(new TextInputBuilder().setCustomId('enabled').setLabel('Enabled? yes or no').setPlaceholder('yes or no').setStyle(TextInputStyle.Short).setMaxLength(3).setRequired(true).setValue(quiet.enabled === true ? 'yes' : 'no')),
    row(new TextInputBuilder().setCustomId('start').setLabel('Start time, HH:MM').setPlaceholder('Example: 23:00').setStyle(TextInputStyle.Short).setMaxLength(5).setRequired(true).setValue(String(quiet.start || '23:00'))),
    row(new TextInputBuilder().setCustomId('end').setLabel('End time, HH:MM').setPlaceholder('Example: 08:00').setStyle(TextInputStyle.Short).setMaxLength(5).setRequired(true).setValue(String(quiet.end || '08:00'))),
    row(new TextInputBuilder().setCustomId('timezone').setLabel('Timezone').setPlaceholder('Example: Europe/London').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true).setValue(String(quiet.timezone || 'Europe/London'))),
  );
}

function removeAccountReferences(config, ids) { const set = new Set(ids); for (const c of Object.values(config.creators)) c.accountIds = (c.accountIds || []).filter((id) => !set.has(id)); }
function moveAccountToCreator(config, account, creator) {
  removeAccountReferences(config, [account.accountId]);
  creator.accountIds = [...new Set([...(creator.accountIds || []), account.accountId])];
  creator.updatedAt = now();
  account.displayName = creator.displayName;
  account.updatedAt = now();
}
function canonicalIdentity(a) { return String(a.canonicalIdentity || a.externalId || a.normalizedUsername || a.username || '').toLowerCase(); }
function canonicalKey(a) { return `${String(a.platform || '').toLowerCase()}:${canonicalIdentity(a)}`; }
function upsertAccount(config, creator, platform, rawValue) {
  const n = normalizeAccountInput(platform, rawValue); const key = `${platform}:${String(n.canonicalIdentity || n.externalId || n.normalizedUsername || n.username || '').toLowerCase()}`;
  const matches = Object.values(config.accounts).filter((a) => { try { return canonicalKey(migrateAccount(a)) === key; } catch { return false; } });
  const primary = matches[0] || null; const accountId = primary?.accountId || makeId('account'); const duplicates = matches.slice(1).map((a) => a.accountId);
  if (duplicates.length) { removeAccountReferences(config, duplicates); for (const id of duplicates) delete config.accounts[id]; }
  config.accounts[accountId] = { ...(primary || {}), accountId, platform, username: n.username, normalizedUsername: n.normalizedUsername, externalId: primary?.externalId || n.externalId || null, inputType: n.inputType, canonicalIdentity: n.canonicalIdentity, profileUrl: n.profileUrl, sourceInput: n.sourceInput, displayName: creator.displayName, enabled: primary?.enabled !== false, alertTypes: Array.isArray(primary?.alertTypes) ? primary.alertTypes : supportedAlerts(platform), alertChannelId: primary?.alertChannelId || null, alertChannels: primary?.alertChannels && typeof primary.alertChannels === 'object' ? primary.alertChannels : {}, mentionMode: primary?.mentionMode || config.notificationMentionMode || 'none', mentionRoleId: primary?.mentionRoleId || (config.notificationMentionMode === 'role' ? config.notificationRoleId || null : null), createdAt: primary?.createdAt || now(), updatedAt: now() };
  creator.accountIds = [...new Set([...(creator.accountIds || []), accountId])]; creator.updatedAt = now(); return { accountId, created: !primary, removedDuplicates: duplicates.length };
}
function accountState(a) { const s = a.state || {}; return a.enabled === false ? '⏸️ Paused' : s.isLive === true ? '🔴 LIVE' : s.isLive === false ? '⚫ Offline' : s.lastError ? '🟡 Unavailable' : '🟢 Monitoring'; }
function ts(value) { const ms = new Date(value || '').getTime(); return Number.isFinite(ms) ? `<t:${Math.floor(ms / 1000)}:R>` : 'Never'; }
function newestTime(values = []) {
  return values.reduce((latest, value) => {
    const ms = new Date(value || '').getTime();
    return Number.isFinite(ms) && ms > latest ? ms : latest;
  }, 0);
}
function dashboardStats(config) {
  const accounts = Object.values(config.accounts);
  return { live: accounts.filter((a) => a.enabled !== false && a.state?.isLive === true).length, offline: accounts.filter((a) => a.enabled !== false && a.state?.isLive === false).length, unavailable: accounts.filter((a) => a.enabled !== false && a.state?.lastError).length, monitored: accounts.filter((a) => a.enabled !== false).length };
}
function creatorLivePostState(config, creator, options = {}) {
  if (!creator) return { canPost: false, reason: 'Select a profile first.' };
  const linked = (creator.accountIds || []).map((id) => config.accounts[id]).filter(Boolean);
  const liveAccounts = linked.filter((account) => account.enabled !== false && account.state?.isLive === true && account.state?.lastLiveEvent && account.state?.lastCheckedAt);
  if (!liveAccounts.length) return { canPost: false, reason: 'No checked LIVE account.' };
  const accountIds = new Set(linked.map((account) => String(account.accountId)));
  const cutoff = Date.now() - (2 * 60 * 60 * 1000);
  if (options.bypassCooldown !== true) {
    const recentState = linked.find((account) => {
      if (!String(account.state?.lastAlertKey || '').startsWith('live:')) return false;
      const sent = new Date(account.state?.lastAlertAt || '').getTime();
      return Number.isFinite(sent) && sent >= cutoff;
    });
    if (recentState) return { canPost: false, reason: 'LIVE post sent recently.' };
    const recent = [...(config.history || [])].reverse().find((entry) => {
      if (entry?.status !== 'alert_sent' || entry?.alertType !== 'live') return false;
      const created = new Date(entry.createdAt).getTime();
      if (!Number.isFinite(created) || created < cutoff) return false;
      return String(entry.creatorId || '') === String(creator.creatorId) || accountIds.has(String(entry.accountId || ''));
    });
    if (recent) return { canPost: false, reason: 'LIVE post sent recently.' };
  }
  return { canPost: true, reason: `${liveAccounts.length} LIVE account${liveAccounts.length === 1 ? '' : 's'} ready.` };
}
function buildMainPanel(guild, requestedBy = 'Unknown User') {
  const c = getConfig(guild.id), creators = Object.keys(c.creators).length, accounts = Object.keys(c.accounts).length, ready = creators && accounts && c.alertsChannelId, stats = dashboardStats(c);
  const d = [`${ready ? '✅' : '⚠️'} **${ready ? 'Social Studio is ready.' : 'Setup required'}**`, '', `**Creators:** ${creators}  •  **Accounts:** ${accounts}`, `🔴 **LIVE:** ${stats.live}  •  ⚫ **Offline:** ${stats.offline}  •  🟡 **Issues:** ${stats.unavailable}`, `📡 **Monitoring:** ${stats.monitored}/${accounts}`, `📨 **Alerts Sent:** ${Number(c.analytics?.alertsSent || 0).toLocaleString('en-GB')}`, `📂 **Default Channel:** ${c.alertsChannelId ? `<#${c.alertsChannelId}>` : 'Not configured'}`, `🔔 **Notifications:** ${c.enabled ? '🟢 Enabled' : '🔴 Disabled'}`].join('\n');
  return { embeds: [embed(c, '📣 Social Studio', d, requestedBy)], components: [row(btn(`${P}creators`, '👥 Creator Profiles', ButtonStyle.Primary), btn(`${P}channels`, '📂 Channels'), btn(`${P}refresh`, '🔄 Refresh', ButtonStyle.Secondary), btn(`${P}templates`, '🎨 Templates', ButtonStyle.Secondary, true)), navigation('main')] };
}
function buildCreatorPanel(i, config, creators) {
  const view = getCreatorSession(i), pages = Math.max(1, Math.ceil(creators.length / PAGE_SIZE)); if (view.page >= pages) setCreatorSession(i, { page: pages - 1 });
  let current = getCreatorSession(i), selected = config.creators[current.creatorId] || null; if (current.creatorId && !selected) { setCreatorSession(i, { creatorId: null }); selected = null; }
  const linked = selected ? (selected.accountIds || []).map((id) => config.accounts[id]).filter(Boolean).sort(accountSort) : [];
  const d = selected ? [`👤 **${selected.displayName}**`, '', ...(linked.length ? linked.map((a) => `${ICON[a.platform]} **${LABEL[a.platform]}** — ${a.profileUrl ? `[${a.username || a.externalId}](${a.profileUrl})` : a.username || a.externalId} — ${accountState(a)}`) : ['No linked social accounts.']), '', `**Status:** ${selected.enabled === false ? '⏸️ Paused' : '🟢 Monitoring'}`, `**Accounts:** ${linked.length}`, '', `**Group / Team:** ${selected.group || 'Not set'}`, `**Tags:** ${selected.tags?.length ? selected.tags.join(', ') : 'None'}`, `**Profile Notes:** ${selected.notes || 'None'}`].join('\n') : `Select a creator profile below.\n\n**Profiles:** ${creators.length}`;
  const postState = creatorLivePostState(config, selected, { bypassCooldown: true });
  const components = [], page = getCreatorSession(i).page, items = creators.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE); if (items.length) components.push(creatorSelect(items, getCreatorSession(i).creatorId, `${P}creator:select`, `Select a creator - Page ${page + 1}/${pages}`)); components.push(row(btn(`${P}creator:new`, '➕ New Profile', ButtonStyle.Success), btn(`${P}account:new`, '➕ New Account', ButtonStyle.Success, !selected), btn(`${P}creator:post`, '📣 Post LIVE', ButtonStyle.Primary, !postState.canPost))); components.push(row(btn(`${P}creator:profile`, '📝 Manage Profile', ButtonStyle.Primary, !selected), btn(`${P}creator:accounts`, '🛠️ Manage Account', ButtonStyle.Primary, !selected || !linked.length))); if (pages > 1) components.push(row(btn(`${P}creator:page:prev`, '⬅️ Previous', ButtonStyle.Secondary, page <= 0), btn(`${P}creator:page:next`, 'Next ➡️', ButtonStyle.Secondary, page >= pages - 1))); components.push(navigation('creators')); return { embeds: [embed(config, '👥 Creator Profiles', selected ? `${d}\n**Post LIVE:** ${postState.reason}` : d, who(i), selected ? creatorAccent(linked) : null)], components };
}
function buildAccountEditPanel(i, config, creator, account) {
  const supported = supportedAlerts(account.platform), alerts = Array.isArray(account.alertTypes) ? account.alertTypes : supported, s = account.state || {}, components = [];
  const actions = [btn(`${P}account:check:${account.accountId}`, '🔄 Check Now', ButtonStyle.Secondary), btn(`${P}account:change`, '📝 Edit'), btn(`${P}account:move`, '↪️ Move Account')]; if (account.profileUrl && /^https?:\/\//i.test(account.profileUrl)) actions.push(linkBtn(account.profileUrl, '🔗 Open Profile')); components.push(row(...actions.slice(0, 5))); components.push(row(btn(`${P}account:toggle`, account.enabled === false ? '▶️ Resume' : '⏸️ Pause', account.enabled === false ? ButtonStyle.Success : ButtonStyle.Secondary), btn(`${P}account:delete`, '🗑️ Delete', ButtonStyle.Danger)));
  components.push(row(btn(`${P}accounts`, '⬅️ Accounts'), btn(`${P}settings`, '⚙️ Settings')));
  const routes = Object.entries(account.alertChannels || {}).filter(([, channelId]) => channelId).map(([type, channelId]) => `${ALERT_LABEL[type] || type}: <#${channelId}>`).join(' • ');
  const deliveryError = s.lastDeliveryError && /notification channel is configured/i.test(String(s.lastDeliveryError)) ? 'LIVE posts need a channel route. Set this in Social Studio > Channels.' : String(s.lastDeliveryError || '').slice(0, 400);
  const d = [`${ICON[account.platform]} **${LABEL[account.platform]} Account**`, `${accountState(account)} **${account.username || account.externalId || 'Resolving…'}**`, '', `**Creator:** ${creator.displayName}`, '', '**Status**', `${account.enabled === false ? '⏸️ Monitoring paused' : '🟢 Monitoring enabled'}`, `Last checked: ${ts(s.lastCheckedAt)}`, '', '**Alerts**', alerts.length ? `${alerts.map((t) => ALERT_LABEL[t] || t).join(', ')} enabled` : 'No alert types enabled', '', '**Routing**', `Default channel: ${account.alertChannelId ? `<#${account.alertChannelId}>` : config.alertsChannelId ? `Server default <#${config.alertsChannelId}>` : 'Not configured'}`, `Dedicated channels: ${routes || 'None'}`, ...(deliveryError ? ['', `⚠️ **Last delivery**`, deliveryError] : []), ...(s.lastError ? ['', `⚠️ **Provider**`, String(s.lastError).slice(0, 400)] : [])].join('\n'); return { embeds: [embed(config, '🔗 Manage Social Account', d, who(i), platformColor(account.platform))], components: components.slice(0, 5) };
}
function buildAccountMovePanel(i, config, creator, account) {
  const creators = Object.values(config.creators).filter((item) => item?.creatorId && item.creatorId !== creator.creatorId).sort((a, b) => String(a.displayName || '').localeCompare(String(b.displayName || ''), undefined, { sensitivity: 'base' }));
  const d = [`Move **${LABEL[account.platform] || account.platform} — ${account.username || account.externalId || 'Resolving…'}** from **${creator.displayName}** to another creator profile.`, '', creators.length ? 'Choose an existing profile below, or create a new profile for this account.' : 'No other creator profiles exist yet. Create a new profile to move this account.'].join('\n');
  const components = [];
  if (creators.length) components.push(row(new StringSelectMenuBuilder().setCustomId(`${P}account:move:creator`).setPlaceholder('Move to existing creator profile').setMinValues(1).setMaxValues(1).addOptions(creators.slice(0, 25).map((item) => ({ label: String(item.displayName || 'Unnamed creator').slice(0, 100), value: item.creatorId, description: `${(item.accountIds || []).length} linked account(s)`.slice(0, 100) })))));
  components.push(row(btn(`${P}account:move:new`, '➕ New Profile', ButtonStyle.Success), btn(`${P}account:edit`, '⬅️ Back')));
  return { embeds: [embed(config, '↪️ Move Social Account', d, who(i), platformColor(account.platform))], components };
}
function buildAccountAddPanel(i, config, creator) {
  const selected = getAccountSession(i).platforms || [];
  const d = [`Add one or more social accounts to **${creator.displayName}**.`, '', 'Select up to 5 platforms, then continue. The next form will ask for a username, channel ID or URL for each selected platform.', '', `**Selected:** ${selected.length ? selected.map((p) => LABEL[p] || p).join(', ') : 'None'}`].join('\n');
  return { embeds: [embed(config, '➕ Add Accounts', d, who(i), creatorAccent((creator.accountIds || []).map((id) => config.accounts[id]).filter(Boolean)))], components: [platformSelect(selected), row(btn(`${P}creators`, '⬅️ Back'), btn(`${P}account:continue`, '➡️ Continue', ButtonStyle.Success, !selected.length))] };
}
function buildProfileManagePanel(i, config, creator) {
  const d = [`👤 **${creator.displayName}**`, '', '**Profile**', `Status: ${creator.enabled === false ? '⏸️ Paused' : '🟢 Monitoring'}`, `Group / Team: ${creator.group || 'Not set'}`, `Tags: ${creator.tags?.length ? creator.tags.join(', ') : 'None'}`, `Profile Notes: ${creator.notes || 'None'}`,
    `\u{1F512} Admin Notes: ${creator.adminNotes || 'None'}`].join('\n');
  const components = [
    row(btn(`${P}creator:edit`, '📝 Edit Profile'), btn(`${P}creator:clear`, '🔄 Clear'), btn(`${P}creator:profile:toggle`, creator.enabled === false ? '▶️ Resume' : '⏸️ Pause', creator.enabled === false ? ButtonStyle.Success : ButtonStyle.Secondary), btn(`${P}creator:delete`, '🗑️ Delete', ButtonStyle.Danger)),
    row(btn(`${P}creators`, '⬅️ Back'), btn(`${P}settings`, '⚙️ Settings')),
  ];
  return { embeds: [embed(config, '📝 Manage Profile', d, who(i), creatorAccent((creator.accountIds || []).map((id) => config.accounts[id]).filter(Boolean)))], components };
}
function buildAccountManagePanel(i, config, creator) {
  const linked = (creator.accountIds || []).map((id) => config.accounts[id]).filter(Boolean).sort(accountSort);
  const active = config.accounts[getAccountSession(i).accountId] || null;
  const d = [`👤 **${creator.displayName}**`, '', '**Accounts**', `Linked: ${linked.length}`, `Selected: ${active ? `${LABEL[active.platform]} — ${active.username || active.externalId}` : linked.length ? 'Choose an account below.' : 'None yet.'}`, ...(linked.length ? ['', linked.map((a) => `• ${ICON[a.platform]} **${LABEL[a.platform]}** — ${a.profileUrl ? `[${a.username || a.externalId}](${a.profileUrl})` : a.username || a.externalId} — ${accountState(a)}`).join('\n')] : ['', 'No linked social accounts.'])].join('\n');
  const components = [];
  if (linked.length) components.push(accountSelect(linked, getAccountSession(i).accountId));
  components.push(row(btn(`${P}account:change`, '📝 Edit Account', ButtonStyle.Secondary, !active), btn(`${P}account:reset`, '🔄 Clear'), btn(`${P}account:delete`, '🗑️ Delete', ButtonStyle.Danger, !active)));
  components.push(row(btn(`${P}creators`, '⬅️ Back'), btn(`${P}settings`, '⚙️ Settings')));
  return { embeds: [embed(config, '🛠️ Manage Account', d, who(i), active ? platformColor(active.platform) : creatorAccent(linked))], components };
}
function variablesDescription() { return ['**🌍 Global / Server**','`{timestamp}` `{nowTimestamp}` `{guildId}` `{guildName}` `{server}` `{guildIcon}` `{serverIcon}` `{guildBanner}` `{guildMemberCount}` `{memberCount}` `{guildVanityCode}`','`{successEmoji}` `{warningEmoji}` `{errorEmoji}` `{proofVerifiedEmoji}` `{successColor}` `{warningColor}` `{errorColor}` `{proofVerifiedColor}`','','**👤 Discord User Context**','`{userId}` `{userTag}` `{userName}` `{userGlobalName}` `{userMention}` `{userNoPing}` `{userAvatar}` `{userServerAvatar}` `{userNickname}` `{userDisplay}`','`{userCreatedAt}` `{userCreatedTimestamp}` `{userJoinedAt}` `{userJoinedTimestamp}` `{createdAt}` `{joinedAt}` `{leftAt}` `{accountAge}` `{membershipDuration}`','`{departureIcon}` `{departureType}` `{departureLabel}` `{departureReason}` `{departureModerator}` `{departureModeratorId}`','','**📣 Creator / Platform**','`{creator}` `{creatorName}` `{creatorDisplayName}` `{creatorAvatar}` `{creatorBanner}` `{creatorDescription}` `{platform}` `{platformIcon}` `{platformColor}` `{username}` `{displayName}` `{channelId}` `{profileUrl}`','','**🔴 LIVE / Stream**','`{title}` `{description}` `{game}` `{category}` `{viewers}` `{peakViewers}` `{started}` `{duration}` `{liveThumbnail}` `{thumbnail}` `{liveUrl}` `{url}`','','**🎥 Video / VOD / Upload / Clip / Short**','`{videoTitle}` `{videoDescription}` `{videoDuration}` `{videoViews}` `{videoThumbnail}` `{videoUrl}`','`{clipTitle}` `{clipCreator}` `{clipViews}` `{clipUrl}` `{uploadTitle}` `{uploadDescription}` `{uploadThumbnail}` `{uploadUrl}` `{shortTitle}` `{shortThumbnail}` `{shortUrl}`','','*Variables without context resolve to an empty value instead of breaking the message.*'].join('\n'); }

function buildTemplatePanel(i, config, type) {
  const current = resolveTemplate(config.templates, type);
  const defaults = config.templates?.defaults?.[type] || current;
  const custom = config.templates?.custom?.[type];
  const changed = Boolean(custom);
  const d = [
    `${ALERT_HELP[type] || `Controls ${ALERT_LABEL[type] || type} alerts.`}`,
    `**Platforms:** ${platformAvailabilityText(type)}`,
    '',
    '**Current Headline**',
    current.title || 'Not set',
    '',
    '**Current Message**',
    current.description || 'Not set',
    '',
    '**Default Headline**',
    defaults.title || 'Not set',
    '',
    '**Default Message**',
    defaults.description || 'Not set',
    '',
    `**Status:** ${changed ? 'Customised' : 'Using default'}`,
    changed ? 'Current copy is coming from `templates.custom`.' : 'Current copy matches `templates.defaults`.',
    'Layout, media, links, colour, footer and previews stay managed by Goliath.'
  ].join('\n');
  return {
    embeds: [embed(config, `${ALERT_EMOJI[type] || '🔔'} ${ALERT_LABEL[type] || type} Template`, d, who(i))],
    components: [
      row(btn(`${P}template:edit:${type}`, '📝 Edit Template', ButtonStyle.Primary), btn(`${P}template:reset:${type}`, '🔄 Reset to Default', ButtonStyle.Secondary, !changed)),
      row(btn(`${P}templates`, '⬅️ Templates'), btn(`${P}settings`, '⚙️ Settings')),
    ],
  };
}
function socialStudioExport(config, guildId) {
  return sortKeys({
    accounts: config.accounts || {},
    alertChannels: config.alertChannels || {},
    alertsChannelId: config.alertsChannelId || null,
    analytics: config.analytics || {},
    creators: config.creators || {},
    exportedAt: now(),
    guildId,
    managerRoleIds: config.managerRoleIds || [],
    notificationMentionMode: config.notificationMentionMode || 'none',
    notificationRoleId: config.notificationRoleId || null,
    settings: config.settings || {},
    templates: normalizeTemplates(config.templates),
    userRoleIds: config.userRoleIds || [],
  });
}

function buildSectionPanel(i, name) {
  const config = getConfig(i.guildId), accounts = Object.values(config.accounts), creators = Object.values(config.creators).sort((a, b) => String(a.displayName || '').localeCompare(String(b.displayName || ''), undefined, { sensitivity: 'base' })); if (name === 'creators') return buildCreatorPanel(i, config, creators);
  if (name === 'accounts') {
    const session = getAccountSession(i), creator = session.creatorId ? config.creators[session.creatorId] || null : null; if (session.creatorId && !creator) { accountSessions.delete(sessionKey(i)); return buildSectionPanel(i, 'accounts'); }
    if (!creator) return { embeds: [embed(config, '🛠️ Manage Account', `Select a creator profile first.\n\n**Profiles:** ${creators.length}`, who(i))], components: [row(btn(`${P}creators`, '⬅️ Back'), btn(`${P}settings`, '⚙️ Settings'))] };
    const linked = (creator.accountIds || []).map((id) => config.accounts[id]).filter(Boolean).sort(accountSort); if (session.accountId && !linked.some((a) => a.accountId === session.accountId)) setAccountSession(i, { accountId: null });
    return buildAccountManagePanel(i, config, creator);
  }
  if (name === 'notifications') return buildSectionPanel(i, 'operations');
  if (name === 'templates') {
    const templateButtons = ALERT_TYPES.map((t) => btn(`${P}template:${t}`, `${ALERT_EMOJI[t] || '🔔'} ${ALERT_LABEL[t]}`, ButtonStyle.Primary));
    const c = [row(...templateButtons.slice(0, 5)), row(...templateButtons.slice(5)), row(btn(`${P}variables`, '🧩 Variables')), navigation('templates')];
    return { embeds: [embed(config, '🎨 Alert Templates', 'Edit the headline and main message for each Social Studio post. The bot keeps the layout consistent with channel links, status, metadata, thumbnails, media previews, platform colours and footer details.\n\nUse **🧩 Variables** for the complete helper list.', who(i))], components: c };
  }
  if (name === 'variables') return { embeds: [embed(config, '🧩 Template Variables', variablesDescription(), who(i))], components: [row(btn(`${P}templates`, '⬅️ Templates'), btn(`${P}main`, '🏠 Social Studio'))] };
  if (name === 'feeds') return buildSectionPanel(i, 'channels');
  if (name === 'channels') {
    const session = getFeedSession(i), routeType = ALERT_TYPES.includes(session.routeType) ? session.routeType : 'default', selected = routeType === 'default' ? config.alertsChannelId : config.alertChannels?.[routeType];
    const routeSummary = ALERT_TYPES.map((type) => `${ALERT_EMOJI[type] || '🔔'} **${ALERT_LABEL[type]}:** ${config.alertChannels?.[type] ? `<#${config.alertChannels[type]}>` : 'Default channel'}`).join('\n');
    const d = `Choose which Discord channels receive Social Studio posts.\n\n**🏠 Default Channel:** ${config.alertsChannelId ? `<#${config.alertsChannelId}>` : 'Not set'}\nEverything posts here unless you choose a separate channel below.\n\n**Available by Platform**\n${platformAvailabilityLines().join('\n')}\n\n**Dedicated Channels**\n${routeSummary}\n\nPick what you want to configure, then choose the Discord channel.`;
    const components = [routeTypeSelect(`${P}channel:type`, routeType), channelSelect(`${P}channel:route`, selected, routeType === 'default' ? 'Choose the default channel' : `Choose where ${ALERT_LABEL[routeType]} posts go`)];
    if (routeType !== 'default' && selected) components.push(row(btn(`${P}channel:default`, '🏠 Use Default Channel')));
    components.push(navigation('channels'));
    return { embeds: [embed(config, '📂 Channels', d, who(i))], components };
  }
  if (name === 'settings') return { embeds: [embed(config, '⚙️ Social Studio Settings', 'Manage access, monitoring, live message behaviour and diagnostics.', who(i))], components: [row(btn(`${P}permissions`, '🔐 Permissions', ButtonStyle.Primary), btn(`${P}monitoring`, '📡 Monitoring', ButtonStyle.Primary), btn(`${P}liveMessages`, '🔴 Live Messages', ButtonStyle.Primary), btn(`${P}diagnostics`, '🧪 Diagnostics', ButtonStyle.Primary)), navigation('settings')] };
  if (name === 'permissions') {
    const managerRoles = config.managerRoleIds.length ? config.managerRoleIds.map((id) => `<@&${id}>`).join(', ') : 'None';
    const userRoles = config.userRoleIds.length ? config.userRoleIds.map((id) => `<@&${id}>`).join(', ') : 'Everyone';
    const pingTarget = config.notificationMentionMode === 'everyone'
      ? '@everyone'
      : config.notificationMentionMode === 'here'
        ? '@here'
        : config.notificationMentionMode === 'role' && config.notificationRoleId
          ? `<@&${config.notificationRoleId}>`
          : 'No ping';
    const d = [
      '👥 **Manager roles**',
      `Current: ${managerRoles}`,
      '',
      '👤 **User access roles**',
      `Current: ${userRoles}`,
      '',
      '📢 **LIVE Notification Target**',
      `Current: ${pingTarget}`,
    ].join('\n');
    const components = [
      roleSelect(config.managerRoleIds, `${P}roles:select`, 'Select Social Studio manager roles'),
      roleSelect(config.userRoleIds, `${P}userroles:select`, 'Select roles allowed to use /user Social Studio'),
      notificationTargetSelect(i, config),
      navigation('permissions'),
    ];
    return { embeds: [embed(config, '🔐 Permissions', d, who(i))], components };
  }
  if (name === 'roles') return buildSectionPanel(i, 'permissions');
  if (name === 'automation') return buildSectionPanel(i, 'monitoring');
  if (name === 'testing' || name === 'data') return buildSectionPanel(i, 'diagnostics');
  if (name === 'operations') return { embeds: [embed(config, '⚙️ Operations', 'Choose the area you want to manage.', who(i))], components: [row(btn(`${P}monitoring`, '📡 Monitoring', ButtonStyle.Primary), btn(`${P}liveMessages`, '🔴 Live Messages', ButtonStyle.Primary), btn(`${P}diagnostics`, '🧪 Diagnostics', ButtonStyle.Primary)), navigation('operations')] };
  if (name === 'monitoring') {
    const settings = config.settings || {}, interval = Math.max(30000, Number(settings.checkIntervalMs || 300000)), mins = interval / 60000, quiet = settings.quietHours && typeof settings.quietHours === 'object' ? settings.quietHours : { enabled: false, start: '23:00', end: '08:00', timezone: 'Europe/London' };
    const monitored = accounts.filter((a) => a.enabled !== false).length;
    const lastHistoryCheck = [...config.history].reverse().find((entry) => entry?.status === 'checked' || entry?.providerStatus);
    const lastAccountCheckMs = newestTime(accounts.map((account) => account.state?.lastCheckedAt));
    const lastProviderCheck = lastAccountCheckMs ? new Date(lastAccountCheckMs).toISOString() : lastHistoryCheck?.createdAt || lastHistoryCheck?.checkedAt || lastHistoryCheck?.lastCheckedAt;
    const failures = accounts.filter((a) => a.state?.lastError || a.state?.lastDeliveryError).length + Number(config.queue?.length || 0);
    const d = [
      `${failures ? 'Warning' : 'Operational'} **System Health**`,
      failures ? `${failures} account, delivery or queue item(s) need attention.` : 'No provider, delivery or queue issues detected.',
      '',
      `**Module Status**\n${config.enabled ? 'Enabled' : 'Disabled'}`,
      'Turns Social Studio monitoring on or off for this server.',
      '',
      `**Check Interval**\n${interval < 60000 ? 'Every 30 seconds' : `Every ${mins} minute${mins === 1 ? '' : 's'}`}`,
      'How often the bot checks linked accounts for new provider activity.',
      '',
      `**Duplicate Protection**\n${settings.suppressDuplicates === false ? 'Disabled' : 'Enabled'}`,
      'Prevents the same LIVE/provider event from being posted twice.',
      '',
      `**Failed Delivery Retry**\n${settings.retryDeliveries === false ? 'Disabled' : 'Enabled'}`,
      'Retries alert sends that failed because Discord or the target channel was unavailable.',
      '',
      `**Quiet Hours**\n${quiet.enabled === true ? `${quiet.start || '23:00'} - ${quiet.end || '08:00'} (${quiet.timezone || 'Europe/London'})` : 'Disabled'}`,
      'Pauses outbound alerts during the selected quiet window.',
      '',
      `**Monitored Accounts**\n${monitored} / ${accounts.length}`,
      'Accounts enabled for automatic provider checks.',
      '',
      `**Last Provider Check**\n${ts(lastProviderCheck)}`,
      'Newest recorded check time across monitored account states.',
    ].join('\n');
    return {
      embeds: [embed(config, 'Social Studio Monitoring', d, who(i))],
      components: [
        monitoringIntervalSelect(settings),
        monitoringBooleanSelect(`${P}automation:dupes`, 'Duplicate protection', settings.suppressDuplicates !== false),
        monitoringBooleanSelect(`${P}automation:retry`, 'Failed delivery retry', settings.retryDeliveries !== false),
        row(btn(`${P}automation:quiet`, 'Configure Quiet Hours'), btn(`${P}account:check`, 'Run Provider Check', ButtonStyle.Secondary, !accounts.length), btn(`${P}test`, 'Send Test LIVE Alert', ButtonStyle.Secondary, !config.alertsChannelId)),
        row(btn(`${P}settings`, '⬅️ Back'), btn(`${P}toggle`, config.enabled ? 'Disable Monitoring' : 'Enable Monitoring', config.enabled ? ButtonStyle.Danger : ButtonStyle.Success)),
      ],
    };
  }
  if (name === 'liveMessages') {
    const settings = config.settings || {};
    const d = ['**Live Message Behaviour**', `✏️ **Edit:** ${settings.editLiveNotifications !== false ? 'On' : 'Off'} - update the same LIVE post.`, `🗑️ **Cleanup:** ${settings.deleteEndedNotifications !== false ? 'On' : 'Off'} - remove ended LIVE posts.`, `👥 **Viewers:** ${settings.includeViewerCount === false ? 'Off' : 'On'} - show viewer count.`, `⏱️ **Duration:** ${settings.includeLiveDuration === false ? 'Off' : 'On'} - show time live.`].join('\n');
    return { embeds: [embed(config, '🔴 Live Messages', d, who(i))], components: [row(btn(`${P}automation:editlive`, settings.editLiveNotifications !== false ? '✏️ Edit: On' : '✏️ Edit: Off'), btn(`${P}automation:deleteended`, settings.deleteEndedNotifications !== false ? '🗑️ Cleanup: On' : '🗑️ Cleanup: Off'), btn(`${P}automation:viewers`, settings.includeViewerCount === false ? '👥 Viewers: Off' : '👥 Viewers: On'), btn(`${P}automation:duration`, settings.includeLiveDuration === false ? '⏱️ Duration: Off' : '⏱️ Duration: On')), row(btn(`${P}settings`, '⬅️ Back'), btn(`${P}main`, '🏠 Social Studio'))] };
  }
  if (name === 'diagnostics') {
    const checks = Number(config.analytics?.checks || 0), alerts = Number(config.analytics?.alertsSent || 0), failures = Number(config.analytics?.failures || 0), monitored = accounts.filter((a) => a.enabled !== false).length;
    const checkedEntries = config.history.filter((e) => e?.status === 'checked'), failedEntries = config.history.filter((e) => e?.status === 'delivery_failed' || e?.providerStatus === 'error' || e?.providerStatus === 'unavailable');
    const lastSuccess = [...checkedEntries].reverse().find((e) => e?.isLive === true || e?.isLive === false || e?.providerStatus === 'ok' || e?.providerStatus === 'live' || e?.providerStatus === 'offline'), lastFailure = failedEntries.at(-1);
    const recent = config.history.slice(-3).reverse().map((entry) => `- ${entry.status || 'event'}${entry.platform ? ` - ${LABEL[entry.platform] || entry.platform}` : ''}${entry.alertType ? ` - ${ALERT_LABEL[entry.alertType] || entry.alertType}` : ''}`).join('\n') || 'No history yet.';
    const d = ['**Testing & Data**', `Default channel: ${config.alertsChannelId ? `<#${config.alertsChannelId}>` : 'Not configured'}`, `Accounts: ${accounts.length} (${monitored} monitored)`, `Provider checks: ${checks.toLocaleString('en-GB')}`, `Alerts sent: ${alerts.toLocaleString('en-GB')}`, `Failures: ${failures.toLocaleString('en-GB')}`, `Queue size: ${config.queue.length}`, `History entries: ${config.history.length}`, `Last successful scan: ${ts(lastSuccess?.createdAt)}`, `Last failure: ${ts(lastFailure?.createdAt)}`, '', '**Tools**', '📨 **Send Test:** preview a test alert privately.', '📄 **Last Response:** view latest account check.', '🩺 **Provider Details:** show provider support.', '📤 **Config Export:** download readable Social Studio settings.', '🗂️ **History Export:** download saved activity history.', '🧹 **Clear History:** remove saved history.', '', '**Recent Activity**', recent].join('\n');
    return { embeds: [embed(config, '🧪 Diagnostics', d, who(i))], components: [row(btn(`${P}test`, '📨 Send Test', ButtonStyle.Primary, !config.alertsChannelId), btn(`${P}testing:last`, '📄 Last Response'), btn(`${P}testing:diagnostics`, '🩺 Provider Details')), row(btn(`${P}data:export:config`, '📤 Config Export', ButtonStyle.Primary), btn(`${P}data:export`, '🗂️ History Export', ButtonStyle.Secondary), btn(`${P}data:clear`, '🧹 Clear History', ButtonStyle.Danger, !config.history.length)), row(btn(`${P}settings`, '⬅️ Back'), btn(`${P}main`, '🏠 Social Studio'), btn(`${P}data:refresh`, '🔄 Refresh'))] };
  }
  return { embeds: [embed(config, name[0].toUpperCase() + name.slice(1), 'Social Studio settings.', who(i))], components: [navigation(name)] };
}

async function respond(i, payload) {
  if (i.deferred || i.replied) {
    await i.editReply(payload);
    return true;
  }
  try {
    await i.update(payload);
  } catch (error) {
    if (!/already been (sent|deferred)|already replied|Unknown interaction/i.test(String(error?.message || error))) throw error;
    await i.editReply(payload);
  }
  return true;
}
async function afterModal(i, section, message) { const payload = buildSectionPanel(i, section); if (i.isFromMessage?.() && !i.deferred && !i.replied) { await i.update(payload); await i.followUp({ content: message, flags: 64 }).catch(() => null); } else if (!i.deferred && !i.replied) await i.reply({ content: message, flags: 64 }); else await i.followUp({ content: message, flags: 64 }); return true; }
function opensModal(id) { return id === `${P}creator:new` || id === `${P}creator:edit` || id === `${P}creator:change` || id === `${P}account:continue` || id === `${P}account:change` || id === `${P}account:move:new` || id === `${P}automation:quiet` || id.startsWith(`${P}template:edit:`); }


async function handleCreatorInteraction(i, context) {
  const {
    id,
    config,
    actorId,
  } = context;

  if (id === `${P}creator:select`) {
    setCreatorSession(i, { creatorId: i.values?.[0] || null });
    return respond(i, buildSectionPanel(i, 'creators'));
  }

  if (
    id === `${P}creator:page:prev` ||
    id === `${P}creator:page:next`
  ) {
    const v = getCreatorSession(i);

    setCreatorSession(i, {
      page: Math.max(
        0,
        v.page + (id.endsWith('next') ? 1 : -1),
      ),
      creatorId: null,
    });

    return respond(i, buildSectionPanel(i, 'creators'));
  }

  if (id === `${P}creator:new`) {
    await i.showModal(creatorModal());
    return true;
  }

  if (id === `${P}creator:edit`) {
    const creatorId = getCreatorSession(i).creatorId;
    const creator = config.creators[creatorId];

    if (!creator) {
      throw new Error('Select a creator profile first.');
    }

    setCreatorSession(i, { creatorId });
    setAccountSession(i, { creatorId });

    await i.showModal(creatorModal(creator));

    return true;
  }

  if (id === `${P}creator:change`) {
    const creator =
      config.creators[getCreatorSession(i).creatorId];

    if (!creator) {
      throw new Error(
        'The selected creator profile no longer exists.',
      );
    }

    await i.showModal(creatorModal(creator));
    return true;
  }

  if (id.startsWith(`${P}creator:update:`)) {
    const creatorId = id.split(':')[2];

    const values = {
      displayName: i.fields.getTextInputValue('displayName'),
      group: i.fields.getTextInputValue('group'),
      tags: i.fields.getTextInputValue('tags'),
      notes: i.fields.getTextInputValue('notes'),
      adminNotes: i.fields.getTextInputValue('adminNotes'),
    };

    updateCreator(
      i.guildId,
      creatorId,
      values,
      {
        actorId,
      },
    );

    const updated =
      getConfig(i.guildId).creators[creatorId];

    return respond(
      i,
      buildProfileManagePanel(
        i,
        getConfig(i.guildId),
        updated,
      ),
    );
  }

  if (id === `${P}creator:profile`) {
    const cid = getCreatorSession(i).creatorId;
    const creator = config.creators[cid];

    if (!creator) {
      throw new Error('Select a creator profile first.');
    }

    setAccountSession(i, {
      creatorId: cid,
      accountId: null,
      platforms: [],
      routeType: 'default',
    });

    return respond(
      i,
      buildProfileManagePanel(i, config, creator),
    );
  }

  if (id === `${P}creator:accounts`) {
    const cid = getCreatorSession(i).creatorId;

    if (!cid || !config.creators[cid]) {
      throw new Error('Select a creator profile first.');
    }

    setAccountSession(i, {
      creatorId: cid,
      accountId: null,
      platforms: [],
      routeType: 'default',
    });

    return respond(
      i,
      buildSectionPanel(i, 'accounts'),
    );
  }

  if (id === `${P}creator:post`) {
    const cid = getCreatorSession(i).creatorId;

    if (!cid || !config.creators[cid]) {
      throw new Error('Select a creator profile first.');
    }

    const result = await forcePostCreatorLive(
      i.client,
      i.guildId,
      cid,
      {
        actorId,
        guild: i.guild,
        bypassCooldown: true,
      },
    );

    await i.followUp({
      content:
        `?? Sent ${result.sent?.length || 0} LIVE post(s).`,
      flags: 64,
    }).catch(() => null);

    return respond(
      i,
      buildSectionPanel(i, 'creators'),
    );
  }

  if (id === `${P}creator:profile:toggle`) {
    const creator =
      config.creators[getCreatorSession(i).creatorId];

    if (!creator) {
      throw new Error(
        'The selected creator profile no longer exists.',
      );
    }

    creator.enabled = creator.enabled === false;
    creator.updatedAt = now();

    saveConfig(
      i.guildId,
      config,
      i.guild,
      actorId,
    );

    return respond(
      i,
      buildProfileManagePanel(
        i,
        getConfig(i.guildId),
        creator,
      ),
    );
  }

  return false;
}


async function handleAccountInteraction(i, context) {
  const {
    id,
    config,
    actorId,
  } = context;

  if (id === `${P}account:new`) { const cid = getCreatorSession(i).creatorId; const creator = config.creators[cid]; if (!creator) throw new Error('Select a creator profile first.'); setAccountSession(i, { creatorId: cid, accountId: null, platforms: [], routeType: 'default', mode: 'add' }); return respond(i, buildAccountAddPanel(i, config, creator)); }

  return false;
}


async function handleTemplateInteraction(i, context) {
  const {
    id,
    config,
    actorId,
  } = context;

  if (id.startsWith(`${P}template:edit:`)) { const type = id.split(':')[3]; if (!ALERT_TYPES.includes(type)) throw new Error('Unknown notification template.'); await i.showModal(templateModal(type, config)); return true; }
  if (id.startsWith(`${P}template:reset:`)) { const type = id.split(':')[3]; if (!ALERT_TYPES.includes(type)) throw new Error('Unknown notification template.'); config.templates = { ...resetTemplate(config.templates, type), lastResetAt: now(), lastResetBy: actorId, lastResetType: type }; saveConfig(i.guildId, config, i.guild, actorId); return respond(i, buildTemplatePanel(i, getConfig(i.guildId), type)); }
  if (id.startsWith(`${P}template:`) && !id.startsWith(`${P}template:save:`)) { const type = id.split(':')[2]; if (!ALERT_TYPES.includes(type)) throw new Error('Unknown notification template.'); return respond(i, buildTemplatePanel(i, config, type)); }
  if (id.startsWith(`${P}template:save:`)) {
    const type = id.split(':')[3];
    config.templates = normalizeTemplates(config.templates);
    const existing = config.templates.custom?.[type] || {};
    config.templates.custom[type] = {
      ...existing,
      title: i.fields.getTextInputValue('title'),
      description: i.fields.getTextInputValue('description')
    };
    config.templates.lastEditedAt = now();
    config.templates.lastEditedBy = actorId;
    config.templates.lastEditedType = type;
    saveConfig(i.guildId, config, i.guild, actorId);
    const payload = buildTemplatePanel(i, getConfig(i.guildId), type);
    if (i.isFromMessage?.() && !i.deferred && !i.replied) { await i.update(payload); await i.followUp({ content: `${ALERT_LABEL[type] || type} template saved.`, flags: 64 }).catch(() => null); }
    else if (!i.deferred && !i.replied) await i.reply({ content: `${ALERT_LABEL[type] || type} template saved.`, flags: 64 });
    else await i.followUp({ content: `${ALERT_LABEL[type] || type} template saved.`, flags: 64 });
    return true;
  }

  return false;
}


async function handleChannelInteraction(i, context) {
  const {
    id,
    config,
    actorId,
  } = context;

  if (id === `${P}feed:type` || id === `${P}channel:type`) { setFeedSession(i, { routeType: i.values?.[0] || 'default' }); return respond(i, buildSectionPanel(i, 'channels')); }
  if (id === `${P}feed:route` || id === `${P}channel:route`) { const type = getFeedSession(i).routeType || 'default', channelId = i.values?.[0] || null; if (type === 'default') config.alertsChannelId = channelId; else { config.alertChannels = config.alertChannels && typeof config.alertChannels === 'object' ? config.alertChannels : {}; config.alertChannels[type] = channelId; } saveConfig(i.guildId, config, i.guild, actorId); return respond(i, buildSectionPanel(i, 'channels')); }
  if (id === `${P}channel:default`) { const type = getFeedSession(i).routeType || 'default'; if (type !== 'default') { config.alertChannels = config.alertChannels && typeof config.alertChannels === 'object' ? config.alertChannels : {}; delete config.alertChannels[type]; saveConfig(i.guildId, config, i.guild, actorId); } return respond(i, buildSectionPanel(i, 'channels')); }
  if (id === `${P}feed:channel` || id === `${P}channel:alerts`) { config.alertsChannelId = i.values?.[0] || null; saveConfig(i.guildId, config, i.guild, actorId); return respond(i, buildSectionPanel(i, 'channels')); }

  return false;
}


async function handlePermissionInteraction(i, context) {
  const {
    id,
    config,
    actorId,
  } = context;

  if (id === `${P}roles:select`) { config.managerRoleIds = i.values || []; saveConfig(i.guildId, config, i.guild, actorId); return respond(i, buildSectionPanel(i, 'permissions')); }
  if (id === `${P}userroles:select`) { config.userRoleIds = i.values || []; saveConfig(i.guildId, config, i.guild, actorId); return respond(i, buildSectionPanel(i, 'permissions')); }
  if (id === `${P}notification:mode`) { const value = i.values?.[0] || 'none'; const roleId = value.startsWith('role:') ? value.slice(5) : null; config.notificationMentionMode = roleId ? 'role' : ['none', 'everyone', 'here'].includes(value) ? value : 'none'; config.notificationRoleId = roleId || null; applyNotificationDefaults(config); saveConfig(i.guildId, config, i.guild, actorId); return respond(i, buildSectionPanel(i, 'permissions')); }
  if (id === `${P}notification:role`) { config.notificationRoleId = i.values?.[0] || null; config.notificationMentionMode = config.notificationRoleId ? 'role' : 'none'; applyNotificationDefaults(config); saveConfig(i.guildId, config, i.guild, actorId); return respond(i, buildSectionPanel(i, 'permissions')); }

  return false;
}


async function handleAutomationInteraction(i, context) {
  const {
    id,
    config,
    actorId,
  } = context;

  if (id === `${P}creator:rebuild`) { const linked = new Set(Object.values(config.creators).flatMap((c) => c.accountIds || [])); for (const a of Object.values(config.accounts)) if (!linked.has(a.accountId)) { const cid = makeId('creator'); config.creators[cid] = { creatorId: cid, displayName: a.displayName || a.username || a.externalId, group: '', tags: [a.platform], notes: '', enabled: true, accountIds: [a.accountId], createdAt: now(), updatedAt: now() }; } saveConfig(i.guildId, config, i.guild, actorId); return respond(i, buildSectionPanel(i, 'creators')); }
  if (id === `${P}main` || id === `${P}refresh`) {
    return respond(
      i,
      buildMainPanel(i.guild, who(i)),
    );
  }

  const section = id.slice(P.length);
  if (section === 'templates') {
    config.templates = normalizeTemplates(config.templates);
    saveConfig(i.guildId, config, i.guild, actorId);
    return respond(i, buildSectionPanel(i, section));
  }
  if (NAV.has(section)) return respond(i, buildSectionPanel(i, section)); throw new Error(`Unknown Social Studio interaction: ${id}`);
}



async function handleDiagnosticsInteraction(i, context) {
  const {
    id,
    config,
    actorId,
  } = context;

  if (id === `${P}test`) { if (!config.alertsChannelId) throw new Error('Choose an alert channel first.'); await i.followUp({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🧪 Social Studio Test').setDescription(`✅ Notification routing is working.\n\nThis private preview was opened from ${i.channelId ? `<#${i.channelId}>` : 'this setup channel'}.\n\nThumbnails, platform metadata and template variables will be applied to real provider events.`).setFooter({ text: 'Social Studio • Test' }).setTimestamp()], flags: 64 }).catch(() => null); return respond(i, buildSectionPanel(i, 'diagnostics')); }

  return false;
}


async function handleAdminSocialEntry(i, context) {
  const {
    config,
  } = context;

  if (i.customId === 'admin:social') {
    return respond(
      i,
      buildMainPanel(i.guild, who(i)),
    );
  }

  return false;
}

async function handleInteraction(i) {
  const id = i.customId;
  const config = getConfig(i.guildId);
  const actorId = i.user?.id;

  if (await handleAdminSocialEntry(i, {
    id,
    config,
    actorId,
  })) return true;

  if (await handleCreatorInteraction(i, {
    id,
    config,
    actorId,
  })) return true;

  if (await handleAccountInteraction(i, {
    id,
    config,
    actorId,
  })) return true;

  if (await handleTemplateInteraction(i, {
    id,
    config,
    actorId,
  })) return true;

  if (await handleChannelInteraction(i, {
    id,
    config,
    actorId,
  })) return true;

  if (await handlePermissionInteraction(i, {
    id,
    config,
    actorId,
  })) return true;

  if (await handleAutomationInteraction(i, {
    id,
    config,
    actorId,
  })) return true;

  if (await handleDiagnosticsInteraction(i, {
    id,
    config,
    actorId,
  })) return true;

  const section = id.slice(P.length);

  if (section === 'templates') {
    config.templates = normalizeTemplates(config.templates);
    saveConfig(i.guildId, config, i.guild, actorId);
    return respond(i, buildSectionPanel(i, section));
  }

  if (NAV.has(section)) {
    return respond(i, buildSectionPanel(i, section));
  }

  throw new Error(
    `Unknown Social Studio interaction: ${id}`,
  );
}

function userCreatorModal(
  creator = null,
  interaction = null,
) {
  const suggestedName =
    creator?.displayName
    || interaction?.member?.displayName
    || interaction?.user?.globalName
    || interaction?.user?.username
    || '';

  return new ModalBuilder()
    .setCustomId('user:social:create:submit')
    .setTitle('Create Creator Profile')
    .addComponents(
      row(
        new TextInputBuilder()
          .setCustomId('displayName')
          .setLabel('Creator display name')
          .setPlaceholder('Enter the public creator name here')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(120)
          .setRequired(true)
          .setValue(String(suggestedName).slice(0, 120)),
      ),
      row(
        new TextInputBuilder()
          .setCustomId('group')
          .setLabel('Group or team')
          .setPlaceholder('Add your team, brand or category here')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(120)
          .setRequired(false)
          .setValue(String(creator?.group || '').slice(0, 120)),
      ),
      row(
        new TextInputBuilder()
          .setCustomId('tags')
          .setLabel('Tags (comma separated)')
          .setPlaceholder('Example: streamer, ksj, twitch')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(300)
          .setRequired(false)
          .setValue(
            Array.isArray(creator?.tags)
              ? creator.tags.join(', ').slice(0, 300)
              : '',
          ),
      ),
      row(
        new TextInputBuilder()
          .setCustomId('notes')
          .setLabel('Profile Notes (optional)')
          .setPlaceholder('Add notes about this creator profile.')
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(1000)
          .setRequired(false)
          .setValue(String(creator?.notes || '').slice(0, 1000)),
      ),
    );
}

function userAccountModal(platforms) {
  const modal = new ModalBuilder().setCustomId('user:social:account:create-multi').setTitle('Add Social Accounts');
  for (const platform of platforms.slice(0, 5)) {
    modal.addComponents(row(new TextInputBuilder()
      .setCustomId(`account_${platform}`)
      .setLabel(`${LABEL[platform]} username, channel ID or URL`)
      .setPlaceholder(`Paste the ${LABEL[platform]} profile URL, username or ID here`)
      .setStyle(TextInputStyle.Short)
      .setMaxLength(500)
      .setRequired(true)));
  }
  return modal;
}

function userPlatformSelect(selected = []) {
  return row(
    new StringSelectMenuBuilder()
      .setCustomId('user:social:account:platforms')
      .setPlaceholder('Select platform(s) to add an account')
      .setMinValues(1)
      .setMaxValues(5)
      .addOptions(
        PLATFORMS.map((platform) => ({
          label: LABEL[platform],
          value: platform,
          default: selected.includes(platform),
        })),
      ),
  );
}

function buildUserAddAccounts(
  interaction,
  creator,
  selected = [],
) {
  const selectedText = selected.length
    ? selected
      .map((platform) => LABEL[platform] || platform)
      .join(', ')
    : 'None';

  return {
    embeds: [
      embed(
        store.getConfig(interaction.guildId),
        '➕ Add Accounts',
        [
          `Add one or more social accounts to **${creator.displayName || creator.creatorId}**.`,
          '',
          'Select up to 5 platforms, then continue. The next form will ask for a username, channel ID or URL for each selected platform.',
          '',
          `**Selected:** ${selectedText}`,
        ].join('\n'),
        who(interaction),
      ),
    ],
    components: [
      userPlatformSelect(selected),
      row(
        btn(
          'user:social:open',
          '⬅️ Back',
          ButtonStyle.Secondary,
        ),
        btn(
          'user:social:account:continue',
          '➡️ Continue',
          ButtonStyle.Success,
          !selected.length,
        ),
      ),
    ],
  };
}

function userNavigation(backId = 'user:category:social') {
  return row(btn(backId, '⬅️ Back', ButtonStyle.Secondary));
}

function userSectionNavigation(backId = 'user:social:open') {
  return row(btn(backId, '⬅️ Back', ButtonStyle.Secondary));
}

function userAccountLabel(account) {
  const platform = String(account?.platform || 'account').trim();

  return platform
    ? `${platform.charAt(0).toUpperCase()}${platform.slice(1)}`
    : 'Account';
}

function userAccountSummary(accounts = []) {
  if (!accounts.length) {
    return '**Linked Accounts**\nNone connected';
  }

  return [
    `**Linked Accounts (${accounts.length})**`,
    ...accounts.map((account) => {
      const name =
        account.displayName
        || account.username
        || account.externalId
        || account.accountId
        || 'Unnamed account';

      return `\u{1F7E3} **${userAccountLabel(account)}** \u{2705} ${name} \u{25CF} ${account.enabled === false ? 'Disabled' : 'Enabled'}`;
    }),
  ].join('\n');
}

function userCreatorActionRows(creator = null, accounts = []) {
  const hasCreator = Boolean(creator);
  const completed = creator?.profileCompleted === true;
  const hasAccounts = Array.isArray(accounts) && accounts.length > 0;

  if (!hasCreator || !completed) {
    return [
      row(
        btn(
          'user:social:create',
          '➕ New Profile',
          ButtonStyle.Success,
          completed,
        ),
      ),
    ];
  }

  return [
    row(
      btn(
        'user:social:create',
        '➕ New Profile',
        ButtonStyle.Success,
        true,
      ),
      btn(
        'user:social:newAccount',
        '➕ New Account',
        ButtonStyle.Success,
      ),
      ...(hasAccounts
        ? [
            btn(
              'user:social:alerts',
              '📣 Post LIVE',
              ButtonStyle.Primary,
            ),
          ]
        : []),
    ),
    row(
      btn(
        'user:social:details',
        '📝 Manage Profile',
        ButtonStyle.Primary,
      ),
      ...(hasAccounts
        ? [
            btn(
              'user:social:manageAccount',
              '🛠️ Manage Account',
              ButtonStyle.Primary,
            ),
          ]
        : []),
    ),
  ];
}

function buildUserLanding(interaction) {
  return {
    embeds: [
      embed(
        store.getConfig(interaction.guildId),
        '📣 Social Studio',
        [
          'Create and manage your own Social Studio creator profile.',
          '',
          'Your profile connects your Discord account to your streaming accounts and live alerts.',
        ].join('\n'),
        who(interaction),
      ),
    ],
    components: [
      row(
        btn(
          'user:module:social',
          'My Creator Profile',
          ButtonStyle.Primary,
          false,
        ).setEmoji('👤'),
      ),
      userNavigation('user:home'),
    ],
  };
}

function buildUserDenied(interaction, roleIds = []) {
  const roleText = roleIds.length
    ? roleIds.map((id) => `<@&${id}>`).join('\n')
    : 'No eligible roles are currently available.';

  return {
    embeds: [
      embed(
        store.getConfig(interaction.guildId),
        '📣 Social Studio',
        [
          'You do not currently have access to Social Studio.',
          '',
          '**Required role ? one of:**',
          roleText,
          '',
          'The Social Studio button is unavailable until you receive an eligible role.',
        ].join('\n'),
        who(interaction),
        0xFEE75C,
      ),
    ],
    components: [
      row(
        btn(
          'user:social:locked',
          'Social Studio',
          ButtonStyle.Secondary,
          true,
        ).setEmoji('👤'),
      ),
      userNavigation(),
    ],
  };
}

function buildUserCreate(interaction) {
  return {
    embeds: [
      embed(
        store.getConfig(interaction.guildId),
        '👥 Creator Profiles',
        [
          'You do not have a completed Creator Profile yet.',
          '',
          'Select New Profile to complete the same Creator Profile form used by Social Studio Management.',
          '',
          'Your unique Creator ID and ownership are permanently attached to your Discord user ID.',
        ].join('\n'),
        who(interaction),
      ),
    ],
    components: [
      ...userCreatorActionRows(null, []),
      userNavigation(),
    ],
  };
}

function buildUserProfile(
  interaction,
  creator,
  accounts = [],
  created = false,
) {
  const config = store.getConfig(interaction.guildId);

  if (creator.profileCompleted !== true) {
    return {
      embeds: [
        embed(
          config,
          '👥 My Creator Profile',
          [
            '⚠️ **Profile setup has not been submitted yet.**',
            '',
            'Select **New Profile** to finish creating your Creator Profile.',
          ].join('\n'),
          who(interaction),
          0xFEE75C,
        ),
      ],
      components: [
        ...userCreatorActionRows(creator, accounts),
        userNavigation(),
      ],
    };
  }

  const status =
    creator.status === 'left_server'
      ? 'Left Server'
      : creator.status === 'disabled'
        ? 'Disabled'
        : 'Active';

  const createdAt = creator.createdAt
    ? `<t:${Math.floor(new Date(creator.createdAt).getTime() / 1000)}:F>`
    : 'Unknown';

  const updatedAt = creator.updatedAt
    ? `<t:${Math.floor(new Date(creator.updatedAt).getTime() / 1000)}:R>`
    : 'Unknown';

  return {
    embeds: [
      embed(
        config,
        '👥 My Creator Profile',
        [
          created ? '✅ **Creator Profile created.**' : null,
                    `**__Creator ID__** \`${creator.creatorId}\``,
          creator.displayName
            ? `**__Creator Name__** ${creator.displayName}`
            : null,
          `**__Status__** ${status}`,
          creator.group
            ? `**__Group / Team__** ${creator.group}`
            : null,
          Array.isArray(creator.tags) && creator.tags.length
            ? `**__Tags__** ${creator.tags.join(', ')}`
            : null,
          creator.notes
            ? `**__Profile Notes__** ${creator.notes}`
            : null,
          userAccountSummary(accounts),
          `**__Created__** ${createdAt}`,
          `**__Last Updated__** ${updatedAt}`,
          '',
          'Manage your Creator Profile and linked accounts below.',
        ].filter(Boolean).join('\n\n'),
        who(interaction),
      ),
    ],
    components: [
      ...userCreatorActionRows(creator, accounts),
      userNavigation(),
    ],
  };
}

function buildUserSection(
  interaction,
  creator,
  section,
  accounts = [],
) {
  const sections = {
    details: {
      title: '📝 Manage Profile',
      description: [
        '**Creator ID**',
        `\`${creator.creatorId}\``,
        '',
        ...(creator.displayName
          ? ['**Creator Name**', creator.displayName, '']
          : []),
        '**Status**',
        creator.status || 'active',
        '',
        'Creator profile management will be connected here using the existing Social Studio profile functions.',
      ].join('\n'),
    },
    accounts: {
      title: '🔗 Accounts',
      description: [
        '**Creator ID**',
        `\`${creator.creatorId}\``,
        '',
        userAccountSummary(accounts),
        '',
        'Only accounts linked to your Creator Profile are shown here.',
      ].join('\n'),
    },
    alerts: {
      title: '📣 Post LIVE',
      description:
        'Create and send a LIVE post for an account connected to your Creator Profile. Existing Social Studio posting and alert logic remains the source of truth.',
    },
  };

  const selected = sections[section] || sections.details;

  return {
    embeds: [
      embed(
        store.getConfig(interaction.guildId),
        selected.title,
        selected.description,
        who(interaction),
        0xFEE75C,
      ),
    ],
    components: [userSectionNavigation()],
  };
}

const userPanel = {
  buildLanding: buildUserLanding,
  buildDenied: buildUserDenied,
  buildCreate: buildUserCreate,
  buildProfile: buildUserProfile,
  buildSection: buildUserSection,
  buildCreatorModal: userCreatorModal,
  buildAccountModal: userAccountModal,
  buildAddAccounts: buildUserAddAccounts,
};

module.exports = {
  buildPanel: buildMainPanel,
  handleInteraction,
  buildSocialAdminPanel: buildMainPanel,
  buildSectionPanel,
  handleSocialAdminInteraction: handleInteraction,
  canManageSocialStudio,
  user: userPanel,
};
