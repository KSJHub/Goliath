'use strict';
const { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, EmbedBuilder, ModalBuilder, PermissionFlagsBits, RoleSelectMenuBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const crypto = require('crypto');
const security = require('../../../core/security/protection/core');
const { goliathNavigation } = require('../../../components/goliathNavigation');
const { variablesForModule } = require('../../../core/guild/guildVariables');
const store = require('./socialStudioStore');
const { normalizeAccountInput, migrateAccount } = require('./accountNormalizer');
const { providerInfo } = require('./socialStudioProviders');
const {
  checkGuildAccounts,
  forcePostCreatorLive,
} = require('./socialStudioMonitor');
const { ALERT_TYPES, normalizeTemplates, resolveTemplate, resetTemplate, resolveSocialRoute } = require('./socialStudioTemplates');

const P = 'social:';
const PAGE_SIZE = 22;
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
const NAV = new Set([
  'creators',
  'accounts',
  'templates',
  'variables',
  'alerts',
  'channels',
  'settings',
  'permissions',
  'roles',
  'monitoring',
  'liveMessages',
  'diagnostics',
  'automation',
  'testing',
  'data',
]);
const SETTINGS_CHILDREN = new Set([
  'permissions',
  'roles',
  'monitoring',
  'channels',
  'liveMessages',
  'diagnostics',
  'data',
]);
const accountSessions = new Map();
const creatorSessions = new Map();
const feedSessions = new Map();
const roleSessions = new Map();
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
function redactExportSecrets(value) {
  if (Array.isArray(value)) return value.map(redactExportSecrets);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, entryValue] of Object.entries(value)) {
    if (/(token|secret|password|authorization|cookie|api.?key|access.?key)/i.test(key)) output[key] = '[REDACTED]';
    else output[key] = redactExportSecrets(entryValue);
  }
  return output;
}
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
function getRoleSession(i) { return roleSessions.get(sessionKey(i)) || { rolePage: 0 }; }
function setRoleSession(i, patch) { const next = { ...getRoleSession(i), ...patch }; roleSessions.set(sessionKey(i), next); return next; }
function sortedGuildRoles(i) { return [...(i.guild?.roles?.cache?.values?.() || [])].filter((role) => role && role.id !== i.guildId && !role.managed).sort((a, b) => b.position - a.position); }
function rolePageCount(i) { return Math.max(1, Math.ceil(sortedGuildRoles(i).length / PAGE_SIZE)); }
function clampRolePage(page, count) { return Math.max(0, Math.min(Number(page) || 0, Math.max(0, count - 1))); }
function pagedRoleSelect(i, customId, placeholder, selectedIds = [], page = 0, single = false) {
  const roles = sortedGuildRoles(i);
  const count = Math.max(1, Math.ceil(roles.length / PAGE_SIZE));
  const safe = clampRolePage(page, count);
  const options = roles.slice(safe * PAGE_SIZE, (safe + 1) * PAGE_SIZE).map((role) => ({
    label: String(role.name || 'Unnamed role').slice(0, 100),
    value: role.id,
    description: `Hierarchy position ${role.position}`.slice(0, 100),
    default: selectedIds.includes(role.id),
  }));
  if (single) options.unshift({ label: 'No temporary LIVE role', value: '__none__', description: 'Do not assign a temporary role while creators are LIVE.', default: !selectedIds.length });
  return row(new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder(`${placeholder} • page ${safe + 1}/${count}`).setMinValues(single ? 1 : 0).setMaxValues(single ? 1 : Math.max(1, Math.min(options.length, 22))).addOptions(options));
}
function pagedNotificationSelect(i, config, page = 0) {
  const selected = config.notificationMentionMode === 'role' && config.notificationRoleId ? `role:${config.notificationRoleId}` : (config.notificationMentionMode || 'none');
  const roles = sortedGuildRoles(i);
  const count = Math.max(1, Math.ceil(roles.length / PAGE_SIZE));
  const safe = clampRolePage(page, count);
  const options = roles.slice(safe * PAGE_SIZE, (safe + 1) * PAGE_SIZE).map((role) => ({ label: String(role.name || 'Unnamed role').slice(0, 100), value: `role:${role.id}`, description: 'Ping this role for the first alert of a new LIVE session.', default: selected === `role:${role.id}` }));
  options.push(
    { label: '@here', value: 'here', description: 'Ping currently online members.', default: selected === 'here' },
    { label: '@everyone', value: 'everyone', description: 'Ping everyone when a creator goes LIVE.', default: selected === 'everyone' },
    { label: 'No notification ping', value: 'none', description: 'Post LIVE alerts without pinging members.', default: selected === 'none' },
  );
  return row(new StringSelectMenuBuilder().setCustomId(`${P}notification:mode`).setPlaceholder(`LIVE Notification Target • page ${safe + 1}/${count}`).setMinValues(1).setMaxValues(1).addOptions(options));
}
function mergeRolePageSelection(i, existingIds, selectedIds, page) {
  const roles = sortedGuildRoles(i);
  const pageIds = new Set(roles.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((role) => role.id));
  const next = new Set((existingIds || []).filter((id) => !pageIds.has(id)));
  for (const id of selectedIds || []) if (id !== '__none__') next.add(id);
  return [...next].slice(0, 100);
}
function setFeedSession(i, patch) { const next = { ...getFeedSession(i), ...patch }; feedSessions.set(sessionKey(i), next); return next; }
function embed(config, title, description, requestedBy, color = null) { return new EmbedBuilder().setColor(color || (config.enabled ? 0x5865F2 : 0x747F8D)).setTitle(title).setDescription(description).setFooter({ text: `Requested by ${requestedBy}` }).setTimestamp(); }
function platformColor(platform) { return PLATFORM_COLOR[platform] || 0x5865F2; }
function creatorAccent(linked) { const platforms = [...new Set((linked || []).map((account) => account?.platform).filter(Boolean))]; return platforms.length === 1 ? platformColor(platforms[0]) : null; }
function navigation(active = 'main') {
  let backId = 'admin:studio:socialStudio';

  if (active === 'settings') {
    backId = `${P}main`;
  } else if (SETTINGS_CHILDREN.has(active)) {
    backId = `${P}settings`;
  } else if (active !== 'main') {
    backId = `${P}main`;
  }

  return row(
    btn(
      backId,
      '⬅️ Back',
      ButtonStyle.Primary,
    ),
    btn(
      `${P}settings`,
      '⚙️ Settings',
      ButtonStyle.Secondary,
      active === 'settings',
    ),
  );
}

function creatorSelect(creators, selected, id = `${P}account:creator`, placeholder = '1. Select the creator profile') {
  return row(new StringSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder).setMinValues(1).setMaxValues(1).addOptions(creators.slice(0, 25).map((c) => ({ label: String(c.displayName || 'Unnamed creator').slice(0, 100), value: c.creatorId, description: `${(c.accountIds || []).length} linked account(s)`.slice(0, 100), default: c.creatorId === selected }))));
}
function accountSelect(accounts, selected) {
  return row(new StringSelectMenuBuilder().setCustomId(`${P}account:select`).setPlaceholder('2. Select an account to manage').setMinValues(1).setMaxValues(1).addOptions(accounts.slice(0, 25).map((a) => ({ label: `${LABEL[a.platform] || a.platform} · ${a.username || a.externalId || 'Resolving'}`.slice(0, 100), value: a.accountId, description: String(a.profileUrl || a.externalId || '').slice(0, 100), default: a.accountId === selected }))));
}
function platformSelect(selected = []) { return row(new StringSelectMenuBuilder().setCustomId(`${P}account:platforms`).setPlaceholder('Select platform(s) to add an account').setMinValues(1).setMaxValues(Math.min(PLATFORMS.length, 25)).addOptions(PLATFORMS.map((p) => ({ label: LABEL[p], value: p, default: selected.includes(p) })))); }
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
  const config = getConfig(guild.id);
  const creators = Object.keys(config.creators || {}).length;
  const accounts = Object.keys(config.accounts || {}).length;
  const stats = dashboardStats(config);

  const ready = Boolean(
    creators &&
    accounts &&
    config.alertsChannelId
  );

  const status = config.enabled
    ? '🟢 Monitoring Active'
    : '🔴 Monitoring Disabled';

  const description = [
    `**${ready ? 'Social Studio is ready' : 'Setup required'}**`,
    '',
    'Manage creators, alert templates and Social Studio configuration from one place.',
    '',
    '**Status**',
    status,
    `👥 Creators: **${creators}**`,
    `🔗 Accounts: **${accounts}**`,
    `🔴 LIVE: **${stats.live}**`,
    `⚠️ Issues: **${stats.unavailable}**`,
    '',
    '**Delivery**',
    `📡 Monitored Accounts: **${stats.monitored}/${accounts}**`,
    `📨 Alerts Sent: **${Number(config.analytics?.alertsSent || 0).toLocaleString('en-GB')}**`,
    `📍 Default Channel: ${config.alertsChannelId ? `<#${config.alertsChannelId}>` : '**Not configured**'}`,
  ].join('\n');

  return {
    embeds: [
      embed(
        config,
        '📡 Social Studio',
        description,
        requestedBy,
      ),
    ],
    components: [
      row(
        btn(
          `${P}creators`,
          '👥 Creators',
          ButtonStyle.Primary,
        ),
        btn(
          `${P}templates`,
          '🎨 Templates',
          ButtonStyle.Primary,
        ),
      ),
      goliathNavigation(
        'admin:modules',
        `${P}settings`,
      ),
    ],
  };
}
function buildCreatorPanel(i, config, creators) {
  const view = getCreatorSession(i);
  const pages = Math.max(1, Math.ceil(creators.length / PAGE_SIZE));

  if (view.page >= pages) {
    setCreatorSession(i, { page: pages - 1 });
  }

  let current = getCreatorSession(i);
  let selected = config.creators[current.creatorId] || null;

  if (current.creatorId && !selected) {
    setCreatorSession(i, { creatorId: null });
    selected = null;
    current = getCreatorSession(i);
  }

  const linked = selected
    ? (selected.accountIds || [])
        .map((id) => config.accounts[id])
        .filter(Boolean)
        .sort(accountSort)
    : [];

  const allAccounts = Object.values(config.accounts || {});

  const liveAccounts = allAccounts.filter(
    (account) => account?.state?.isLive === true,
  ).length;

  const description = selected
    ? [
        `## 👤 ${selected.displayName}`,
        '',
        selected.enabled === false
          ? '⏸️ **Monitoring Paused**'
          : '🟢 **Monitoring Enabled**',
        `🔗 **Connected Accounts:** ${linked.length}`,
        `🔴 **Currently LIVE:** ${linked.filter(
          (account) => account?.state?.isLive === true,
        ).length}`,
        '',
        '**Connected Platforms**',
        ...(linked.length
          ? linked.map((account) => {
              const name =
                account.username ||
                account.externalId ||
                'Resolving…';

              const profile = account.profileUrl
                ? `[${name}](${account.profileUrl})`
                : name;

              return `${ICON[account.platform]} **${LABEL[account.platform]}** — ${profile} — ${accountState(account)}`;
            })
          : ['No social accounts connected yet.']),
        '',
        `**Group / Team:** ${selected.group || 'Not set'}`,
        `**Tags:** ${
          selected.tags?.length
            ? selected.tags.join(', ')
            : 'None'
        }`,
      ].join('\n')
    : creators.length
      ? [
          'Select a creator to manage their profile and connected social accounts.',
          '',
          `👥 **Creators:** ${creators.length}`,
          `🔗 **Connected Accounts:** ${allAccounts.length}`,
          `🔴 **Currently LIVE:** ${liveAccounts}`,
        ].join('\n')
      : [
          '**No creators have been added yet.**',
          '',
          'Creators are the people Social Studio monitors across their connected social platforms.',
          '',
          'Create a creator first. You can then open that creator and connect their social accounts.',
          '',
          '👥 **Creators:** 0',
          '🔗 **Connected Accounts:** 0',
        ].join('\n');

  const components = [];
  const page = getCreatorSession(i).page;

  const items = creators.slice(
    page * PAGE_SIZE,
    (page + 1) * PAGE_SIZE,
  );

  if (items.length) {
    components.push(
      creatorSelect(
        items,
        getCreatorSession(i).creatorId,
        `${P}creator:select`,
        `Select a creator — Page ${page + 1}/${pages}`,
      ),
    );
  }

  if (!selected) {
    components.push(
      row(
        btn(
          `${P}creator:new`,
          '➕ Add Creator',
          ButtonStyle.Success,
        ),
      ),
    );
  } else {
    const postState = creatorLivePostState(
      config,
      selected,
      { bypassCooldown: true },
    );

    components.push(
      row(
        btn(
          `${P}creator:profile`,
          '👤 Creator Details',
          ButtonStyle.Primary,
        ),
        btn(
          `${P}creator:accounts`,
          '🔗 Accounts',
          ButtonStyle.Primary,
        ),
        btn(
          `${P}creator:post`,
          '🔴 Post LIVE',
          ButtonStyle.Secondary,
          !postState.canPost,
        ),
      ),
    );

    components.push(
      row(
        btn(
          `${P}creator:new`,
          '➕ Add Creator',
          ButtonStyle.Success,
        ),
      ),
    );
  }

  if (pages > 1) {
    components.push(
      row(
        btn(
          `${P}creator:page:prev`,
          '◀ Previous',
          ButtonStyle.Secondary,
          page <= 0,
        ),
        btn(
          `${P}creator:page:next`,
          'Next ▶',
          ButtonStyle.Secondary,
          page >= pages - 1,
        ),
      ),
    );
  }

  components.push(
    row(
      btn(
        `${P}main`,
        '⬅️ Back',
        ButtonStyle.Secondary,
      ),
    ),
  );

  return {
    embeds: [
      embed(
        config,
        '👥 Creators',
        description,
        who(i),
        selected ? creatorAccent(linked) : null,
      ),
    ],
    components,
  };
}

function buildAccountEditPanel(i, config, creator, account) {
  const supported = supportedAlerts(account.platform), alerts = Array.isArray(account.alertTypes) ? account.alertTypes : supported, s = account.state || {}, components = [];
  const actions = [btn(`${P}account:check:${account.accountId}`, '🔄 Check Now', ButtonStyle.Secondary), btn(`${P}account:change`, '📝 Edit'), btn(`${P}account:move`, '↪️ Move Account')]; if (account.profileUrl && /^https?:\/\//i.test(account.profileUrl)) actions.push(linkBtn(account.profileUrl, '🔗 Open Profile')); components.push(row(...actions.slice(0, 5))); components.push(row(btn(`${P}account:toggle`, account.enabled === false ? '▶️ Resume' : '⏸️ Pause', account.enabled === false ? ButtonStyle.Success : ButtonStyle.Secondary), btn(`${P}account:delete`, '🗑️ Delete', ButtonStyle.Danger)));
  components.push(row(
    btn(`${P}accounts`, '⬅️ Accounts'),
    btn(`${P}creators`, '👥 Creators'),
    btn(`${P}settings`, '⚙️ Settings'),
  ));
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
    goliathNavigation(
      `${P}creators`,
      `${P}settings`,
    ),
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
  components.push(goliathNavigation(
    `${P}creators`,
    `${P}settings`,
  ));
  return { embeds: [embed(config, '🛠️ Manage Account', d, who(i), active ? platformColor(active.platform) : creatorAccent(linked))], components };
}
function variablesDescription() {
  const variables = variablesForModule('socialStudio');
  const lines = ['**🧩 Available Variables**'];
  let current = '';

  for (const variable of variables) {
    const token = `\`${variable}\``;
    if (current && `${current} ${token}`.length > 90) {
      lines.push(current);
      current = token;
    } else {
      current = current ? `${current} ${token}` : token;
    }
  }

  if (current) lines.push(current);

  const note = '\n\n*Variables without context resolve to an empty value instead of breaking the message.*';
  const description = lines.join('\n');
  const maxLength = 4096 - note.length;

  if (description.length <= maxLength) return description + note;

  return `${description.slice(0, Math.max(0, maxLength - 80)).trimEnd()}\n… additional centrally managed variables are available.${note}`;
}

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
      goliathNavigation(
      `${P}templates`,
      `${P}settings`,
    ),
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
    if (!creator) return { embeds: [embed(config, '🛠️ Manage Account', `Select a creator profile first.\n\n**Profiles:** ${creators.length}`, who(i))], components: [
      goliathNavigation(
        `${P}creators`,
        `${P}settings`,
      ),
    ] };
    const linked = (creator.accountIds || []).map((id) => config.accounts[id]).filter(Boolean).sort(accountSort); if (session.accountId && !linked.some((a) => a.accountId === session.accountId)) setAccountSession(i, { accountId: null });
    return buildAccountManagePanel(i, config, creator);
  }
if (name === 'templates') {
    const templateButtons = ALERT_TYPES.map((t) => btn(`${P}template:${t}`, `${ALERT_EMOJI[t] || '🔔'} ${ALERT_LABEL[t]}`, ButtonStyle.Primary));
    const c = [row(...templateButtons.slice(0, 5)), row(...templateButtons.slice(5)), row(
      btn(`${P}main`, '⬅️ Back', ButtonStyle.Secondary),
      btn(`${P}settings`, '⚙️ Settings', ButtonStyle.Secondary),
      btn(`${P}variables`, '🧩 Variables', ButtonStyle.Secondary),
    )];
    return { embeds: [embed(config, '🎨 Alert Templates', 'Edit the headline and main message for each Social Studio post. The bot keeps the layout consistent with channel links, status, metadata, thumbnails, media previews, platform colours and footer details.\n\nUse **🧩 Variables** for the complete helper list.', who(i))], components: c };
  }
  if (name === 'variables') return { embeds: [embed(config, '🧩 Template Variables', variablesDescription(), who(i))], components: [
      row(
        btn(
          `${P}templates`,
          '⬅️ Back',
          ButtonStyle.Secondary,
        ),
        btn(
          `${P}settings`,
          '⚙️ Settings',
          ButtonStyle.Secondary,
        ),
      ),
    ] };
  if (name === 'feeds') return buildSectionPanel(i, 'channels');
  if (name === 'alerts') {
    const settings = config.settings || {};
    const monitored = accounts.filter(
      (account) => account.enabled !== false
    ).length;

    const failures =
      accounts.filter(
        (account) =>
          account.state?.lastError ||
          account.state?.lastDeliveryError
      ).length +
      Number(config.queue?.length || 0);

    const description = [
      'Manage Social Studio alert delivery from one workspace.',
      '',
      '**Status**',
      `📡 Monitoring: **${config.enabled ? 'Enabled' : 'Disabled'}**`,
      `🔗 Monitored Accounts: **${monitored}/${accounts.length}**`,
      `⚠️ Current Issues: **${failures}**`,
      '',
      '**Alert Controls**',
      '🧭 **Routing** — where alerts are delivered.',
      '⚙️ **Automation** — monitoring schedule, duplicate protection, retries and quiet hours.',
      '🔴 **LIVE Messages** — how active LIVE notifications update and finish.',
      '🧪 **Test & Diagnose** — test delivery, inspect providers and view recent responses.',
    ].join('\n');

    return {
      embeds: [
        embed(
          config,
          '📡 Alerts',
          description,
          who(i),
        ),
      ],
      components: [
        row(
          btn(
            `${P}channels`,
            '🧭 Routing',
            ButtonStyle.Primary,
          ),
          btn(
            `${P}monitoring`,
            '⚙️ Automation',
            ButtonStyle.Primary,
          ),
        ),
        row(
          btn(
            `${P}liveMessages`,
            '🔴 LIVE Messages',
            ButtonStyle.Secondary,
          ),
          btn(
            `${P}diagnostics`,
            '🧪 Test & Diagnose',
            ButtonStyle.Secondary,
          ),
        ),
        row(
          btn(
            `${P}main`,
            '⬅️ Back',
          ),
        ),
      ],
    };
  }

  if (name === 'channels') {
    const session = getFeedSession(i);
    const type = session.routeType || 'default';
    const selected = type === 'default' ? config.alertsChannelId : config.alertChannels?.[type] || null;
    const summary = [
      'Choose the server destinations used by Social Studio alerts.',
      '',
      `**Default:** ${config.alertsChannelId ? `<#${config.alertsChannelId}>` : 'Not configured'}`,
      ...ALERT_TYPES.map((alertType) => `${ALERT_EMOJI[alertType] || '🔔'} **${ALERT_LABEL[alertType] || alertType}:** ${config.alertChannels?.[alertType] ? `<#${config.alertChannels[alertType]}>` : 'Uses fallback routing'}`),
      '',
      '**Fallback order:** User → Creator/Account → Platform → Content Type → Default.',
    ].join('\n');
    return {
      embeds: [embed(config, '🎯 Routing', summary, who(i))],
      components: [
        routeTypeSelect(`${P}feed:type`, type),
        channelSelect(`${P}feed:route`, selected, `Choose destination for ${type === 'default' ? 'default alerts' : ALERT_LABEL[type] || type}`),
        row(btn('social:userroute:open', '👥 User Routing', ButtonStyle.Secondary)),
        row(btn(`${P}monitoring`, '⬅️ Back', ButtonStyle.Secondary)),
      ],
    };
  }

  if (name === 'settings') return {
    embeds: [embed(config, '⚙️ Social Studio Settings', [
      'Configure the parts of Social Studio that server managers actually need.',
      '',
      '🎭 **Roles & Access** — management access, creator access, temporary LIVE role and the LIVE notification target.',
      '🔴 **LIVE Messages** — viewer count, duration and silent refresh behaviour for the retained LIVE post.',
      '⚙️ **Setup & Diagnostics** — provider timing, Quiet Hours, retries, routing, tests and provider health.',
      '📦 **Data & Export** — export configuration/history and manage stored Social Studio data.',
    ].join('\n'), who(i))],
    components: [
      row(
        btn(`${P}permissions`, '🎭 Roles & Access', ButtonStyle.Primary),
        btn(`${P}liveMessages`, '🔴 LIVE Messages', ButtonStyle.Primary),
        btn(`${P}monitoring`, '⚙️ Setup & Diagnostics', ButtonStyle.Primary),
      ),
      row(btn(`${P}main`, '⬅️ Back', ButtonStyle.Secondary), btn(`${P}data`, '📦 Data & Export', ButtonStyle.Secondary)),
    ],
  };

  if (name === 'permissions') {
    const state = getRoleSession(i);
    const count = rolePageCount(i);
    const page = clampRolePage(state.rolePage, count);
    setRoleSession(i, { rolePage: page });
    const managerRoles = config.managerRoleIds.length ? config.managerRoleIds.map((id) => `<@&${id}>`).join(', ') : 'None';
    const userRoles = config.userRoleIds.length ? config.userRoleIds.map((id) => `<@&${id}>`).join(', ') : 'Everyone';
    const pingTarget = config.notificationMentionMode === 'everyone' ? '@everyone' : config.notificationMentionMode === 'here' ? '@here' : config.notificationMentionMode === 'role' && config.notificationRoleId ? `<@&${config.notificationRoleId}>` : 'No ping';
    const d = [
      'Configure who can use Social Studio and how LIVE roles and notifications behave.',
      '',
      '👥 **Manager Roles**', `Current: ${managerRoles}`, '',
      '👤 **User Access Roles**', `Current: ${userRoles}`, '',
      '🔴 **Temporary LIVE Creator Role**', `Current: ${config.liveRoleId ? `<@&${config.liveRoleId}>` : 'Disabled'}`, 'Assigned while a linked creator is LIVE and removed when all monitored accounts are offline.', '',
      '📣 **LIVE Notification Target**', `Current: ${pingTarget}`, 'Used only for the first notification of a genuinely new LIVE session.',
    ].join('\n');
    return {
      embeds: [embed(config, '🎭 Roles & Access', d, who(i))],
      components: [
        pagedRoleSelect(i, `${P}roles:select`, 'Manager Roles', config.managerRoleIds || [], page),
        pagedRoleSelect(i, `${P}userroles:select`, 'User Access Roles', config.userRoleIds || [], page),
        pagedRoleSelect(i, `${P}liveRole:select`, 'Temporary LIVE Creator Role', config.liveRoleId ? [config.liveRoleId] : [], page, true),
        pagedNotificationSelect(i, config, page),
        row(
          btn(`${P}settings`, '⬅️ Back', ButtonStyle.Secondary),
          btn(`${P}roles:page:prev`, '◀️', ButtonStyle.Secondary, page <= 0),
          btn(`${P}roles:page:info`, `📄 Roles ${page + 1}/${count}`, ButtonStyle.Secondary, true),
          btn(`${P}roles:page:next`, '▶️', ButtonStyle.Secondary, page >= count - 1),
        ),
      ],
    };
  }
  if (name === 'roles') return buildSectionPanel(i, 'permissions');
  if (name === 'automation') return buildSectionPanel(i, 'monitoring');
  if (name === 'testing') return buildSectionPanel(i, 'diagnostics');

  if (name === 'data') {
    const description = [
      'Manage Social Studio configuration and stored activity data.',
      '',
      `📦 **History Entries:** ${config.history.length}`,
      `📬 **Queue Items:** ${config.queue.length}`,
      '',
      '**Exports**',
      '📤 **Config Export** — download Social Studio configuration with sensitive values redacted.',
      '🗂️ **History Export** — download stored Social Studio activity history.',
      '',
      '**Maintenance**',
      '🧹 **Clear History** — permanently clear saved Social Studio history for this server.',
    ].join('\n');

    return {
      embeds: [
        embed(
          config,
          '📦 Data & Export',
          description,
          who(i),
        ),
      ],
      components: [
        row(
          btn(
            `${P}data:export:config`,
            '📤 Config Export',
            ButtonStyle.Primary,
          ),
          btn(
            `${P}data:export`,
            '🗂️ History Export',
            ButtonStyle.Secondary,
          ),
          btn(
            `${P}data:clear`,
            '🧹 Clear History',
            ButtonStyle.Danger,
            !config.history.length,
          ),
        ),
        goliathNavigation(
          `${P}settings`,
          `${P}settings`,
        ),
      ],
    };
  }

  if (name === 'monitoring' || name === 'diagnostics' || name === 'automation' || name === 'testing') {
    const settings = config.settings || {};
    const interval = Math.max(30000, Number(settings.checkIntervalMs || 300000));
    const quiet = settings.quietHours && typeof settings.quietHours === 'object' ? settings.quietHours : { enabled: false, start: '23:00', end: '08:00', timezone: 'Europe/London' };
    const enabledAccounts = accounts.filter((account) => account.enabled !== false);
    const monitored = enabledAccounts.length;
    const issueAccounts = enabledAccounts.filter((account) => account.state?.lastError || account.state?.lastDeliveryError);
    const pendingRetries = enabledAccounts.filter((account) => account.state?.pendingDelivery).length;
    const heldItems = enabledAccounts.reduce((total, account) => total + (Array.isArray(account.state?.quietHoursPending) ? account.state.quietHoursPending.length : 0), 0);
    const activeLive = enabledAccounts.filter((account) => account.state?.isLive === true).length;
    const queued = Number(config.queue?.length || 0);
    const pending = pendingRetries + heldItems + queued;
    const lastCheckMs = newestTime(enabledAccounts.map((account) => account.state?.lastCheckedAt));
    const missingRoute = !config.alertsChannelId && !Object.values(config.alertChannels || {}).some(Boolean) && !Object.values(config.platformChannels || {}).some(Boolean) && !Object.values(config.userChannelOverrides || {}).some((routes) => routes && Object.values(routes).some(Boolean));
    let health = '🟢 Operational';
    let healthReason = 'Monitoring and delivery configuration are ready.';
    if (!monitored) { health = '⚪ Not Configured'; healthReason = 'Add a monitored account to begin provider checks.'; }
    else if (issueAccounts.length) { health = '🔴 Issues Detected'; healthReason = `${issueAccounts.length} monitored account${issueAccounts.length === 1 ? '' : 's'} reported a provider or delivery failure.`; }
    else if (missingRoute) { health = '🟡 Attention Needed'; healthReason = 'Configure at least one alert destination in Routing.'; }
    else if (pendingRetries) { health = '🟡 Attention Needed'; healthReason = `${pendingRetries} delivery retr${pendingRetries === 1 ? 'y is' : 'ies are'} pending.`; }
    else if (heldItems) { health = '🟢 Operational'; healthReason = `${heldItems} notification${heldItems === 1 ? ' is' : 's are'} intentionally held by Quiet Hours.`; }
    const intervalLabel = interval < 60000 ? '30s' : interval % 3600000 === 0 ? `${interval / 3600000}h` : `${interval / 60000}m`;
    const quietLabel = quiet.enabled === true ? `${quiet.start || '23:00'}–${quiet.end || '08:00'} (${quiet.timezone || 'Europe/London'})` : 'Off';
    const d = [
      'Configure Social Studio automation, test delivery and investigate provider health.',
      '',
      `**System Health:** ${health}`,
      `↳ ${healthReason}`,
      `**Provider Checks:** Every ${intervalLabel}`,
      `**Accounts:** ${monitored} monitored`,
      `**Quiet Hours:** ${quietLabel}`,
      `**Failed Delivery Retry:** ${settings.retryDeliveries === false ? 'Off' : 'On'}`,
      ...(activeLive ? [`🔴 **Active LIVE Sessions:** ${activeLive}`] : []),
      ...(heldItems ? [`🌙 **Held by Quiet Hours:** ${heldItems}`] : []),
      ...(pendingRetries ? [`🔄 **Pending Retries:** ${pendingRetries}`] : []),
      ...(queued ? [`📬 **Queued Work:** ${queued}`] : []),
      `**Last Provider Check:** ${ts(lastCheckMs ? new Date(lastCheckMs).toISOString() : null)}`,
      '',
      '**Core Protection**',
      '📡 Monitoring stays active while Social Studio is enabled.',
      '🛡️ Duplicate protection is always active.',
    ].join('\n');
    return {
      embeds: [embed(config, '⚙️ Setup & Diagnostics', d, who(i))],
      components: [
        row(
          btn(`${P}channels`, '🎯 Routing', ButtonStyle.Secondary),
          btn(`${P}automation:interval`, `⏱️ Interval: ${intervalLabel}`, ButtonStyle.Secondary),
          btn(`${P}automation:quiet`, `🌙 Quiet Hours: ${quiet.enabled === true ? 'ON' : 'OFF'}`, quiet.enabled === true ? ButtonStyle.Success : ButtonStyle.Secondary),
          btn(`${P}automation:retry`, `🔄 Retry: ${settings.retryDeliveries === false ? 'OFF' : 'ON'}`, settings.retryDeliveries === false ? ButtonStyle.Secondary : ButtonStyle.Success),
        ),
        row(
          btn(`${P}account:check`, '🔍 Run Check', ButtonStyle.Primary, !monitored),
          btn(`${P}test`, '📨 Send Test', ButtonStyle.Primary, missingRoute),
          btn(`${P}testing:diagnostics`, '🩺 Provider Details', ButtonStyle.Secondary),
          btn(`${P}testing:last`, '📄 Last Response', ButtonStyle.Secondary),
        ),
        row(btn(`${P}settings`, '⬅️ Back', ButtonStyle.Secondary), btn(`${P}data:refresh`, '🔄 Refresh', ButtonStyle.Secondary)),
      ],
    };
  }
  if (name === 'liveMessages') {
    const settings = config.settings || {};
    const refreshEnabled = settings.liveRefreshEnabled !== false;
    const refreshMs = Number(settings.liveMessageRefreshMs) || 600000;
    const refreshLabel = refreshEnabled ? (refreshMs % 3600000 === 0 ? `${refreshMs / 3600000}h` : `${refreshMs / 60000}m`) : 'OFF';
    const d = [
      'Control the optional information shown while a creator is LIVE.',
      '',
      '**Permanent LIVE lifecycle**',
      '✏️ The original LIVE post is retained and silently updated to ENDED/OFFLINE.',
      '🔕 Refreshes, recovery and ENDED updates never create another LIVE ping.',
      '',
      `👥 **Viewer Count:** ${settings.includeViewerCount === false ? 'Off' : 'On'}`,
      `⏱️ **Live Duration:** ${settings.includeLiveDuration === false ? 'Off' : 'On'}`,
      `🔄 **Refresh:** ${refreshLabel}`,
      '',
      'Turning refresh off only stops periodic presentation refreshes. Monitoring and LIVE → ENDED still continue.',
    ].join('\n');
    return {
      embeds: [embed(config, '🔴 LIVE Messages', d, who(i))],
      components: [
        row(
          btn(`${P}automation:viewers`, settings.includeViewerCount === false ? '👥 Viewers: OFF' : '👥 Viewers: ON', settings.includeViewerCount === false ? ButtonStyle.Secondary : ButtonStyle.Success),
          btn(`${P}automation:duration`, settings.includeLiveDuration === false ? '⏱️ Duration: OFF' : '⏱️ Duration: ON', settings.includeLiveDuration === false ? ButtonStyle.Secondary : ButtonStyle.Success),
          btn(`${P}automation:liverefreshrate`, `🔄 Refresh: ${refreshLabel}`, refreshEnabled ? ButtonStyle.Success : ButtonStyle.Secondary),
        ),
        row(btn(`${P}settings`, '⬅️ Back', ButtonStyle.Secondary)),
      ],
    };
  }
  if (name === 'diagnostics') return buildSectionPanel(i, 'monitoring');

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

  if (id === `${P}creator:create`) {
    const displayName = i.fields.getTextInputValue('displayName').trim();
    if (!displayName) throw new Error('Creator display name is required.');
    const creatorId = makeId('creator');
    const creator = {
      creatorId, ownerDiscordId: null, displayName,
      group: i.fields.getTextInputValue('group').trim(),
      tags: i.fields.getTextInputValue('tags').split(',').map((value) => value.trim()).filter(Boolean),
      notes: i.fields.getTextInputValue('notes').trim(),
      adminNotes: i.fields.getTextInputValue('adminNotes').trim(),
      showProfileInLive: true, enabled: true, status: 'active', accountIds: [], profileCompleted: true, createdAt: now(), updatedAt: now(),
    };
    config.creators[creatorId] = creator;
    saveConfig(i.guildId, config, i.guild, actorId);
    setCreatorSession(i, { creatorId });
    return respond(i, buildProfileManagePanel(i, getConfig(i.guildId), getConfig(i.guildId).creators[creatorId]));
  }

  if (id === `${P}creator:clear`) {
    const creatorId = getCreatorSession(i).creatorId;
    if (!creatorId || !config.creators[creatorId]) throw new Error('Select a creator profile first.');
    const updated = store.updateCreator(i.guildId, creatorId, (current) => ({ ...current, group: '', tags: [], notes: '', adminNotes: '' }), { actorId, guild: i.guild });
    return respond(i, buildProfileManagePanel(i, getConfig(i.guildId), updated));
  }

  if (id === `${P}creator:delete`) {
    const creatorId = getCreatorSession(i).creatorId;
    const creator = config.creators[creatorId];
    if (!creator) throw new Error('Select a creator profile first.');
    if (!store.deleteCreator(i.guildId, creatorId, { actorId, guild: i.guild })) throw new Error('The selected creator profile no longer exists.');
    setCreatorSession(i, { creatorId: null });
    setAccountSession(i, { creatorId: null, accountId: null, platforms: [] });
    return respond(i, buildSectionPanel(i, 'creators'));
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

    store.updateCreator(i.guildId, creatorId, values, { actorId, guild: i.guild });

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

  if (
    id === `${P}account:check` ||
    id.startsWith(`${P}account:check:`)
  ) {
    const requestedAccountId = id.startsWith(`${P}account:check:`)
      ? id.slice(`${P}account:check:`.length)
      : null;

    if (requestedAccountId) {
      const account = context.config.accounts?.[requestedAccountId];

      if (!account) {
        throw new Error(
          'The selected social account no longer exists.',
        );
      }

      await checkGuildAccounts(
        i.client,
        i.guildId,
        {
          force: true,
          diagnosticOnly: true,
          accountIds: [requestedAccountId],
          guild: i.guild,
        },
      );

      const refreshed = getConfig(i.guildId);
      const refreshedAccount =
        refreshed.accounts?.[requestedAccountId];

      if (!refreshedAccount) {
        throw new Error(
          'The social account disappeared after the provider check.',
        );
      }

      const creator =
        Object.values(refreshed.creators || {}).find(
          (item) =>
            Array.isArray(item.accountIds) &&
            item.accountIds.includes(requestedAccountId),
        );

      if (!creator) {
        throw new Error(
          'The creator profile for this account could not be found.',
        );
      }

      return respond(
        i,
        buildAccountEditPanel(
          i,
          refreshed,
          creator,
          refreshedAccount,
        ),
      );
    }

    const result = await checkGuildAccounts(
      i.client,
      i.guildId,
      {
        force: true,
        diagnosticOnly: true,
        guild: i.guild,
      },
    );
    const checkedResults = Array.isArray(result?.results) ? result.results.filter((item) => item?.status !== 'skipped') : [];
    const failures = checkedResults.filter((item) => ['unavailable', 'configuration_required', 'error'].includes(String(item?.status || '').toLowerCase()));
    const live = checkedResults.filter((item) => item?.isLive === true).length;
    const summary = `🔍 **Provider check complete** — ${checkedResults.length} account${checkedResults.length === 1 ? '' : 's'} checked · ${checkedResults.length - failures.length} successful · ${failures.length} failed${live ? ` · ${live} LIVE` : ''}.`;
    await respond(i, buildSectionPanel(i, 'monitoring'));
    await i.followUp({ content: summary, flags: 64 }).catch(() => null);
    return true;
  }

  if (id === `${P}account:new`) {
    const cid = getCreatorSession(i).creatorId;
    const creator = config.creators[cid];
    if (!creator) throw new Error('Select a creator profile first.');

    setAccountSession(i, {
      creatorId: cid,
      accountId: null,
      platforms: [],
      routeType: 'default',
      mode: 'add',
    });

    return respond(i, buildAccountAddPanel(i, config, creator));
  }

  if (id === `${P}account:creator`) {
    const creatorId = i.values?.[0] || null;

    setAccountSession(i, {
      creatorId,
      accountId: null,
      platforms: [],
      routeType: 'default',
    });

    setCreatorSession(i, { creatorId });

    return respond(i, buildSectionPanel(i, 'accounts'));
  }

  if (id === `${P}account:select`) {
    setAccountSession(i, {
      accountId: i.values?.[0] || null,
      routeType: 'default',
    });

    return respond(i, buildSectionPanel(i, 'accounts'));
  }

  if (id === `${P}account:platforms`) {
    const platforms = (i.values || [])
      .filter((p) => PLATFORMS.includes(p))
      .slice(0, 5);

    const s = setAccountSession(i, { platforms });
    const creator = config.creators[s.creatorId];

    return s.mode === 'add' && creator
      ? respond(i, buildAccountAddPanel(i, config, creator))
      : respond(i, buildSectionPanel(i, 'accounts'));
  }

  if (id === `${P}account:reset`) {
    setAccountSession(i, {
      accountId: null,
      platforms: [],
      routeType: 'default',
    });

    return respond(i, buildSectionPanel(i, 'accounts'));
  }

  if (id === `${P}account:creator:toggle`) {
    const s = getAccountSession(i);
    const creator = config.creators[s.creatorId];

    if (!creator) throw new Error('Select a creator profile first.');

    creator.enabled = creator.enabled === false;
    creator.updatedAt = now();

    saveConfig(i.guildId, config, i.guild, actorId);
    setCreatorSession(i, { creatorId: creator.creatorId });

    return respond(i, buildSectionPanel(i, 'accounts'));
  }

  if (id === `${P}account:continue`) {
    const s = getAccountSession(i);

    if (!s.creatorId || !config.creators[s.creatorId]) {
      throw new Error('Select a creator profile first.');
    }

    if (!s.platforms.length) {
      throw new Error('Select at least one platform first.');
    }

    await i.showModal(accountModal(s.platforms));
    return true;
  }

  if (id === `${P}account:edit`) {
    const s = getAccountSession(i);
    const c = config.creators[s.creatorId];
    const a = config.accounts[s.accountId];

    if (!c || !a) throw new Error('Select an account first.');

    return respond(i, buildAccountEditPanel(i, config, c, a));
  }

  if (id === `${P}account:change`) {
    const a = config.accounts[getAccountSession(i).accountId];

    if (!a) throw new Error('The selected account no longer exists.');

    await i.showModal(accountEditModal(a));
    return true;
  }

  if (id === `${P}account:move`) {
    const s = getAccountSession(i);
    const c = config.creators[s.creatorId];
    const a = config.accounts[s.accountId];

    if (!c || !a) throw new Error('Select an account first.');

    return respond(i, buildAccountMovePanel(i, config, c, a));
  }

  if (id === `${P}account:move:new`) {
    const a = config.accounts[getAccountSession(i).accountId];

    if (!a) throw new Error('Select an account first.');

    await i.showModal(accountMoveNewProfileModal(a));
    return true;
  }

  if (id === `${P}account:move:creator`) {
    const s = getAccountSession(i);
    const a = config.accounts[s.accountId];
    const target = config.creators[i.values?.[0]];

    if (!a || !target) {
      throw new Error('Select a valid account and creator profile.');
    }

    moveAccountToCreator(config, a, target);
    saveConfig(i.guildId, config, i.guild, actorId);

    setAccountSession(i, {
      creatorId: target.creatorId,
      accountId: a.accountId,
      routeType: 'default',
    });

    setCreatorSession(i, {
      creatorId: target.creatorId,
    });

    const fresh = getConfig(i.guildId);

    return respond(
      i,
      buildAccountEditPanel(
        i,
        fresh,
        fresh.creators[target.creatorId],
        fresh.accounts[a.accountId],
      ),
    );
  }

  if (id === `${P}account:toggle`) {
    const s = getAccountSession(i);
    const c = config.creators[s.creatorId];
    const account = config.accounts[s.accountId];

    if (!c || !account) {
      throw new Error('The selected account no longer exists.');
    }

    account.enabled = account.enabled === false;
    account.updatedAt = now();

    saveConfig(i.guildId, config, i.guild, actorId);

    const fresh = getConfig(i.guildId);

    return respond(
      i,
      buildAccountEditPanel(
        i,
        fresh,
        fresh.creators[s.creatorId],
        fresh.accounts[account.accountId],
      ),
    );
  }

  if (id === `${P}account:delete`) {
    const a = config.accounts[getAccountSession(i).accountId];

    if (!a) throw new Error('The selected account no longer exists.');

    return respond(i, {
      embeds: [
        embed(
          config,
          '⚠️ Delete Social Account',
          `Delete **${LABEL[a.platform]} · ${a.username || a.externalId}**?`,
          who(i),
        ),
      ],
      components: [
        row(
          btn(`${P}account:delete:cancel`, '⬅️ Back'),
          btn(
            `${P}account:delete:confirm`,
            '🗑️ Delete Account',
            ButtonStyle.Danger,
          ),
        ),
      ],
    });
  }

  if (id === `${P}account:delete:cancel`) {
    return respond(i, buildSectionPanel(i, 'accounts'));
  }

  if (id === `${P}account:delete:confirm`) {
    const s = getAccountSession(i);
    const a = config.accounts[s.accountId];

    if (!a) throw new Error('The selected account no longer exists.');

    removeAccountReferences(config, [a.accountId]);
    delete config.accounts[a.accountId];

    saveConfig(i.guildId, config, i.guild, actorId);

    setAccountSession(i, {
      accountId: null,
    });

    return respond(i, buildSectionPanel(i, 'accounts'));
  }

  if (id.startsWith(`${P}account:update:`)) {
    const aid = id.slice(`${P}account:update:`.length);
    const old = config.accounts[aid];
    const s = getAccountSession(i);
    const c = config.creators[s.creatorId];

    if (!old || !c) {
      throw new Error('The selected account no longer exists.');
    }

    const raw = i.fields.getTextInputValue('accountValue').trim();

    removeAccountReferences(config, [old.accountId]);
    delete config.accounts[old.accountId];

    const r = upsertAccount(config, c, old.platform, raw);
    const a = config.accounts[r.accountId];

    a.enabled = old.enabled !== false;
    a.alertTypes = Array.isArray(old.alertTypes)
      ? old.alertTypes
      : supportedAlerts(old.platform);

    a.alertChannelId = old.alertChannelId || null;

    a.alertChannels =
      old.alertChannels && typeof old.alertChannels === 'object'
        ? old.alertChannels
        : {};

    a.mentionMode =
      old.mentionMode ||
      config.notificationMentionMode ||
      'none';

    a.mentionRoleId =
      old.mentionRoleId ||
      (config.notificationMentionMode === 'role'
        ? config.notificationRoleId || null
        : null);

    saveConfig(i.guildId, config, i.guild, actorId);

    setAccountSession(i, {
      accountId: r.accountId,
      platforms: [],
      routeType: 'default',
    });

    return afterModal(
      i,
      'accounts',
      `✅ ${LABEL[old.platform]} account updated.`,
    );
  }

  if (id === `${P}account:move:create`) {
    const s = getAccountSession(i);
    const account = config.accounts[s.accountId];

    if (!account) {
      throw new Error('The selected account no longer exists.');
    }

    const name = i.fields.getTextInputValue('displayName').trim();

    if (!name) {
      throw new Error('Creator display name is required.');
    }

    const cid = makeId('creator');

    const creator = {
      creatorId: cid,
      displayName: name,
      group: i.fields.getTextInputValue('group').trim(),
      tags: i.fields
        .getTextInputValue('tags')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
      notes: i.fields.getTextInputValue('notes').trim(),
      enabled: true,
      accountIds: [],
      createdAt: now(),
      updatedAt: now(),
    };

    config.creators[cid] = creator;

    moveAccountToCreator(config, account, creator);
    saveConfig(i.guildId, config, i.guild, actorId);

    setCreatorSession(i, {
      creatorId: cid,
    });

    setAccountSession(i, {
      creatorId: cid,
      accountId: account.accountId,
      platforms: [],
      routeType: 'default',
    });

    return afterModal(
      i,
      'accounts',
      `✅ Account moved to ${name}.`,
    );
  }

  if (id === `${P}account:create-multi`) {
    const s = getAccountSession(i);
    const c = config.creators[s.creatorId];

    if (!c) {
      throw new Error('The selected creator profile no longer exists.');
    }

    let created = 0;
    let updated = 0;
    let dupes = 0;
    let selected = null;

    for (const p of s.platforms.slice(0, 5)) {
      const raw = i.fields
        .getTextInputValue(`account_${p}`)
        .trim();

      if (!raw) continue;

      const r = upsertAccount(config, c, p, raw);

      selected = r.accountId;

      if (r.created) created++;
      else updated++;

      dupes += r.removedDuplicates;
    }

    saveConfig(i.guildId, config, i.guild, actorId);

    setCreatorSession(i, {
      creatorId: c.creatorId,
    });

    setAccountSession(i, {
      creatorId: c.creatorId,
      platforms: [],
      accountId: selected,
      routeType: 'default',
      mode: null,
    });

    return afterModal(
      i,
      'creators',
      `✅ ${created} added, ${updated} updated${
        dupes ? `, ${dupes} duplicates merged` : ''
      }.`,
    );
  }

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

  // Legacy feed:* aliases remain here for compatibility.
  // Modern channel:* routing is owned by
  // socialStudioCreatorRoutingCompat.js.
  if (id === `${P}feed:type`) {
    setFeedSession(i, {
      routeType: i.values?.[0] || 'default',
    });

    return respond(
      i,
      buildSectionPanel(i, 'channels'),
    );
  }

  if (id === `${P}feed:route`) {
    const type = getFeedSession(i).routeType || 'default';
    const channelId = i.values?.[0] || null;

    if (type === 'default') {
      config.alertsChannelId = channelId;
    } else {
      config.alertChannels =
        config.alertChannels &&
        typeof config.alertChannels === 'object'
          ? config.alertChannels
          : {};

      config.alertChannels[type] = channelId;
    }

    saveConfig(
      i.guildId,
      config,
      i.guild,
      actorId,
    );

    return respond(
      i,
      buildSectionPanel(i, 'channels'),
    );
  }

  if (id === `${P}feed:channel`) {
    config.alertsChannelId = i.values?.[0] || null;

    saveConfig(
      i.guildId,
      config,
      i.guild,
      actorId,
    );

    return respond(
      i,
      buildSectionPanel(i, 'channels'),
    );
  }

  return false;
}


async function handlePermissionInteraction(i, context) {
  const { id, config, actorId } = context;
  const state = getRoleSession(i);
  if (id === `${P}roles:page:prev` || id === `${P}roles:page:next`) {
    const delta = id.endsWith(':next') ? 1 : -1;
    setRoleSession(i, { rolePage: clampRolePage(state.rolePage + delta, rolePageCount(i)) });
    return respond(i, buildSectionPanel(i, 'permissions'));
  }
  if (id === `${P}roles:page:info`) return respond(i, buildSectionPanel(i, 'permissions'));
  if (id === `${P}roles:select`) { config.managerRoleIds = mergeRolePageSelection(i, config.managerRoleIds || [], i.values || [], state.rolePage); saveConfig(i.guildId, config, i.guild, actorId); return respond(i, buildSectionPanel(i, 'permissions')); }
  if (id === `${P}userroles:select`) { config.userRoleIds = mergeRolePageSelection(i, config.userRoleIds || [], i.values || [], state.rolePage); saveConfig(i.guildId, config, i.guild, actorId); return respond(i, buildSectionPanel(i, 'permissions')); }
  if (id === `${P}liveRole:select`) {
    config.liveRoleId = i.values?.[0] && i.values[0] !== '__none__' ? i.values[0] : null;
    saveConfig(i.guildId, config, i.guild, actorId);
    return respond(i, buildSectionPanel(i, 'permissions'));
  }
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

  if (id === `${P}automation:viewers`) {
    config.settings = config.settings && typeof config.settings === 'object' ? config.settings : {};
    config.settings.includeViewerCount = config.settings.includeViewerCount === false;
    saveConfig(i.guildId, config, i.guild, actorId);
    return respond(i, buildSectionPanel(i, 'liveMessages'));
  }

  if (id === `${P}automation:duration`) {
    config.settings = config.settings && typeof config.settings === 'object' ? config.settings : {};
    config.settings.includeLiveDuration = config.settings.includeLiveDuration === false;
    saveConfig(i.guildId, config, i.guild, actorId);
    return respond(i, buildSectionPanel(i, 'liveMessages'));
  }

  if (id === `${P}automation:liverefreshrate`) {
    config.settings = config.settings && typeof config.settings === 'object' ? config.settings : {};
    const values = [600000, 900000, 1200000, 1800000, 2700000, 3600000];
    if (config.settings.liveRefreshEnabled === false) {
      config.settings.liveRefreshEnabled = true;
      config.settings.liveMessageRefreshMs = values[0];
    } else {
      const current = Number(config.settings.liveMessageRefreshMs || values[0]);
      const index = values.indexOf(current);
      if (index < 0) config.settings.liveMessageRefreshMs = values[0];
      else if (index >= values.length - 1) config.settings.liveRefreshEnabled = false;
      else config.settings.liveMessageRefreshMs = values[index + 1];
    }
    saveConfig(i.guildId, config, i.guild, actorId);
    return respond(i, buildSectionPanel(i, 'liveMessages'));
  }

  if (id === `${P}automation:interval`) {
    config.settings = config.settings && typeof config.settings === 'object' ? config.settings : {};
    const values = MONITORING_INTERVALS.map((option) => Number(option.value));
    const current = Number(config.settings.checkIntervalMs || 300000);
    const index = values.indexOf(current);
    config.settings.checkIntervalMs = values[(index < 0 ? 0 : index + 1) % values.length];
    config.settings.suppressDuplicates = true;
    saveConfig(i.guildId, config, i.guild, actorId);
    return respond(i, buildSectionPanel(i, 'monitoring'));
  }

  if (id === `${P}automation:retry`) {
    config.settings = config.settings && typeof config.settings === 'object' ? config.settings : {};
    config.settings.retryDeliveries = config.settings.retryDeliveries === false;
    config.settings.suppressDuplicates = true;
    saveConfig(i.guildId, config, i.guild, actorId);
    return respond(i, buildSectionPanel(i, 'monitoring'));
  }

  if (id === `${P}automation:quiet`) {
    config.settings = config.settings && typeof config.settings === 'object' ? config.settings : {};
    if (i.isButton?.()) { await i.showModal(quietHoursModal(config)); return true; }
    if (i.isModalSubmit?.()) {
      const enabledRaw = String(i.fields.getTextInputValue('enabled') || '').trim().toLowerCase();
      const start = String(i.fields.getTextInputValue('start') || '').trim();
      const end = String(i.fields.getTextInputValue('end') || '').trim();
      const timezone = String(i.fields.getTextInputValue('timezone') || '').trim();
      if (!['yes', 'no'].includes(enabledRaw)) throw new Error('Quiet Hours enabled must be yes or no.');
      if (!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(start) || !/^([01]\\d|2[0-3]):[0-5]\\d$/.test(end)) throw new Error('Quiet Hours times must use 24-hour HH:MM format.');
      if (start === end) throw new Error('Quiet Hours start and end times must be different.');
      try { new Intl.DateTimeFormat('en-GB', { timeZone: timezone }).format(new Date()); } catch { throw new Error('Quiet Hours timezone must be a valid IANA timezone, for example Europe/London.'); }
      config.settings.quietHours = { enabled: enabledRaw === 'yes', start, end, timezone };
      config.settings.suppressDuplicates = true;
      saveConfig(i.guildId, config, i.guild, actorId);
      if (!i.deferred && !i.replied) await i.deferUpdate();
      return respond(i, buildSectionPanel(i, 'monitoring'));
    }
  }
  const section = id.slice(P.length);
  if (section === 'templates') {
    config.templates = normalizeTemplates(config.templates);
    saveConfig(i.guildId, config, i.guild, actorId);
    return respond(i, buildSectionPanel(i, section));
  }
  if (NAV.has(section)) return respond(i, buildSectionPanel(i, section));
  return false;
}



async function handleDiagnosticsInteraction(i, context) {
  const {
    id,
    config,
    actorId,
  } = context;

  if (id === `${P}test`) {
    const accounts = Object.values(config.accounts || {}).filter((account) => account?.enabled !== false);
    const liveAccount = accounts.find((account) => account.state?.isLive === true) || accounts[0] || null;
    const resolved = liveAccount ? resolveSocialRoute(config, liveAccount, 'live') : { channelId: config.alertsChannelId || null, source: config.alertsChannelId ? 'Server Default' : 'Not configured' };
    if (!resolved.channelId) throw new Error('Configure an alert destination in Routing first.');
    const channel = i.guild?.channels?.cache?.get(resolved.channelId) || await i.guild?.channels?.fetch?.(resolved.channelId).catch(() => null);
    if (!channel?.isTextBased?.() || typeof channel.send !== 'function') throw new Error('The resolved Social Studio alert destination is unavailable or not text based.');
    const target = config.notificationMentionMode === 'role' && config.notificationRoleId ? `<@&${config.notificationRoleId}>` : config.notificationMentionMode === 'everyone' ? '@everyone' : config.notificationMentionMode === 'here' ? '@here' : 'No notification ping';
    const message = await channel.send({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🧪 Social Studio Delivery Test').setDescription(`✅ Test delivery reached this channel successfully.\n\n**Resolved LIVE route:** <#${channel.id}>\n**Route source:** ${resolved.source || 'Unknown'}\n**Configured LIVE notification target:** ${target}\n**Ping safety:** No members were pinged by this test.`).setFooter({ text: 'Goliath Social Studio • Safe Test' }).setTimestamp()], allowedMentions: { parse: [], roles: [] } });
    const notice = `📨 Test delivered to <#${channel.id}> via **${resolved.source || 'resolved route'}** without pinging members. Message ID: ${message.id}.`;
    if (i.deferred || i.replied) await i.followUp({ content: notice, flags: 64 }).catch(() => null);
    else await i.reply({ content: notice, flags: 64 });
    return true;
  }

  if (id === `${P}data:refresh`) return respond(i, buildSectionPanel(i, 'monitoring'));

  if (id === `${P}testing:last`) {
    const accounts = Object.values(config.accounts || {}).filter((account) => account?.enabled !== false);
    const latest = accounts.map((account) => ({ account, checkedAt: Date.parse(String(account.state?.lastCheckedAt || 0)) || 0 })).sort((x, y) => y.checkedAt - x.checkedAt)[0]?.account || null;
    let content = '📄 **Latest Provider Response**\n\nNo provider check has been recorded yet.';
    if (latest?.state?.lastCheckedAt) {
      const state = latest.state || {};
      const creator = Object.values(config.creators || {}).find((item) => Array.isArray(item?.accountIds) && item.accountIds.map(String).includes(String(latest.accountId || '')));
      const label = creator?.displayName || latest.displayName || latest.username || latest.accountId || 'Unknown account';
      const result = state.lastStatus || (state.isLive === true ? 'live' : state.isLive === false ? 'offline' : 'unknown');
      content = [
        '📄 **Latest Provider Response**', '',
        `**Provider:** ${LABEL[String(latest.platform || '').toLowerCase()] || latest.platform || 'Unknown'}`,
        `**Account:** ${String(label).slice(0, 120)}`,
        `**Checked:** ${ts(state.lastCheckedAt)}`,
        `**Result:** ${String(result).toUpperCase()}`,
        `**LIVE:** ${state.isLive === true ? 'Yes' : state.isLive === false ? 'No' : 'Unknown'}`,
        ...(state.lastError ? [`**Provider Error:** ${String(state.lastError).slice(0, 400)}`] : []),
        ...(state.lastDeliveryError ? [`**Delivery Error:** ${String(state.lastDeliveryError).slice(0, 400)}`] : []),
      ].join('\n');
    }
    if (i.deferred || i.replied) await i.followUp({ content, flags: 64 }).catch(() => null); else await i.reply({ content, flags: 64 });
    return true;
  }

  if (id === `${P}testing:diagnostics`) {
    const accounts = Object.values(config.accounts || {}).filter((account) => account?.enabled !== false);
    const lines = accounts.length ? accounts.map((account) => {
      const platform = String(account.platform || '').toLowerCase();
      let info = {};
      try { info = providerInfo(platform) || {}; } catch { info = {}; }
      const supported = Array.isArray(info.supportedAlertTypes) && info.supportedAlertTypes.length ? info.supportedAlertTypes.map((type) => ALERT_LABEL[type] || type).join('/') : 'No alert types reported';
      const state = account.state || {};
      const failed = Boolean(state.lastError || state.lastDeliveryError);
      const status = failed ? '🔴 Issue' : state.lastCheckedAt ? '🟢 Checked' : '⚪ Not checked';
      const name = account.displayName || account.username || account.accountId || 'Unknown account';
      return `${status} **${LABEL[platform] || platform || 'Unknown'}** — ${String(name).slice(0, 80)} · ${supported} · Last: ${ts(state.lastCheckedAt)}${state.isLive === true ? ' · 🔴 LIVE' : ''}${state.lastError ? ` · ${String(state.lastError).slice(0, 120)}` : ''}`;
    }) : ['⚪ No monitored accounts are available to inspect.'];
    const content = `🩺 **Social Studio Provider Details**\n\n${lines.join('\n').slice(0, 1850)}`;
    if (i.deferred || i.replied) await i.followUp({ content, flags: 64 }).catch(() => null); else await i.reply({ content, flags: 64 });
    return true;
  }

  if (id === `${P}data:export:config`) {
    const safe = redactExportSecrets(config);
    const file = new AttachmentBuilder(Buffer.from(JSON.stringify(safe, null, 2), 'utf8'), { name: `social-studio-config-${i.guildId}.json` });
    const payload = { content: '📤 Social Studio configuration export. Sensitive values have been redacted.', files: [file], flags: 64 };
    if (i.deferred || i.replied) await i.followUp(payload); else await i.reply(payload);
    return true;
  }

  if (id === `${P}data:export`) {
    const history = Array.isArray(config.history) ? config.history : [];
    const file = new AttachmentBuilder(Buffer.from(JSON.stringify(history, null, 2), 'utf8'), { name: `social-studio-history-${i.guildId}.json` });
    const payload = { content: '🗂️ Social Studio history export.', files: [file], flags: 64 };
    if (i.deferred || i.replied) await i.followUp(payload); else await i.reply(payload);
    return true;
  }

  if (id === `${P}data:clear`) {
    if (!Array.isArray(config.history) || !config.history.length) return respond(i, buildSectionPanel(i, 'data'));
    config.history = [];
    saveConfig(i.guildId, config, i.guild, actorId);
    await respond(i, buildSectionPanel(i, 'data'));
    await i.followUp({ content: '🧹 Social Studio history cleared.', flags: 64 }).catch(() => null);
    return true;
  }
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
  const id = String(i?.customId || '');
  if (id !== 'admin:social' && !id.startsWith(P)) return false;

  const config = getConfig(i.guildId);
  const actorId = i.user?.id;

  // Every admin Social Studio component is privileged. Do not rely on
  // the panel that originally rendered the component; custom IDs can be
  // invoked directly or from stale messages.
  if (!canManageSocialStudio(i, config)) {
    return denySocialAccess(i);
  }

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

  if (id.startsWith(`${P}userroute:`)) {
    const routingCore = require('../../../events/client/socialStudioCreatorRoutingCompatCore');
    if (await routingCore.handle(i)) return true;
  }
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
      row(
        new TextInputBuilder()
          .setCustomId('showProfileInLive')
          .setLabel('Show profile info in LIVE alerts?')
          .setPlaceholder('yes or no')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(3)
          .setRequired(true)
          .setValue(creator?.showProfileInLive === false ? 'no' : 'yes'),
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
        '**Group / Team**',
        creator.group || 'Not set',
        '',
        '**Tags**',
        Array.isArray(creator.tags) && creator.tags.length ? creator.tags.join(', ') : 'Not set',
        '',
        '**Notes**',
        creator.notes || 'Not set',
        '',
        '**LIVE Profile Info**',
        creator.showProfileInLive === false ? 'Hidden from LIVE alerts' : 'Shown in LIVE alerts when profile information is available.',
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
    components: section === 'details'
      ? [
          row(
            btn('user:social:profile:edit', '✏️ Edit Profile', ButtonStyle.Primary),
            btn(
              'user:social:profile:toggleLiveInfo',
              creator.showProfileInLive === false ? '📣 LIVE Profile Info: OFF' : '📣 LIVE Profile Info: ON',
              creator.showProfileInLive === false ? ButtonStyle.Secondary : ButtonStyle.Success,
            ),
          ),
          userSectionNavigation(),
        ]
      : [userSectionNavigation()],
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
