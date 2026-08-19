'use strict';

const HELPERS = [
  '{userId}', '{userTag}', '{userName}', '{userGlobalName}', '{userMention}', '{userNoPing}',
  '{userAvatar}', '{userServerAvatar}', '{userNickname}', '{userDisplay}', '{userCreatedAt}',
  '{userCreatedTimestamp}', '{userJoinedAt}', '{userJoinedTimestamp}', '{createdAt}', '{joinedAt}',
  '{leftAt}', '{timestamp}', '{accountAge}', '{membershipDuration}', '{departureIcon}',
  '{departureType}', '{departureLabel}', '{departureReason}', '{departureModerator}',
  '{departureModeratorId}', '{nowTimestamp}', '{successEmoji}', '{warningEmoji}', '{errorEmoji}',
  '{proofVerifiedEmoji}', '{successColor}', '{warningColor}', '{errorColor}', '{proofVerifiedColor}',
  '{guildId}', '{guildName}', '{server}', '{guildIcon}', '{serverIcon}', '{guildBanner}',
  '{guildMemberCount}', '{memberCount}', '{guildVanityCode}', '{channelId}', '{channelName}',
  '{channelMention}', '{guildOwnerId}', '{guildOwnerMention}', '{guildCreatedAt}',
  '{guildCreatedTimestamp}', '{guildBoostCount}', '{guildBoostTier}', '{guildSplash}',
  '{guildDiscoverySplash}', '{userBot}', '{userTopRoleId}', '{userTopRoleMention}',
];

const sessions = new Map();
let defaultStateFactory = null;
let stateSync = (state) => state;
let basePanelFactory = null;

function configure({ defaultState, sync, basePanel } = {}) {
  if (typeof defaultState === 'function') defaultStateFactory = defaultState;
  if (typeof sync === 'function') stateSync = sync;
  if (typeof basePanel === 'function') basePanelFactory = basePanel;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function trim(value, max = 4096) {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function fmtDate(value) {
  if (!value) return 'Unknown';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toISOString();
}

function fmtTs(value, style = 'F') {
  if (!value) return 'Unknown';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

function durationFrom(timestamp) {
  const started = Number(timestamp || 0);
  if (!started || started > Date.now()) return 'Unknown';
  let months = Math.max(0, Math.floor((Date.now() - started) / (1000 * 60 * 60 * 24 * 30.4375)));
  const years = Math.floor(months / 12);
  months %= 12;
  const parts = [];
  if (years) parts.push(`${years} year${years === 1 ? '' : 's'}`);
  if (months || !parts.length) parts.push(`${months} month${months === 1 ? '' : 's'}`);
  return parts.join(', ');
}

function avatar(member) {
  return member?.displayAvatarURL?.({ size: 1024 })
    || member?.user?.displayAvatarURL?.({ size: 1024 })
    || undefined;
}

function guildIcon(guild) {
  return guild?.iconURL?.({ size: 1024 }) || undefined;
}

function guildBanner(guild) {
  return guild?.bannerURL?.({ size: 2048 }) || undefined;
}

function safeAsset(fn, fallback = '') {
  try { return fn?.() || fallback; } catch { return fallback; }
}

function memberName(interaction) {
  return interaction?.member?.displayName
    || interaction?.user?.globalName
    || interaction?.user?.username
    || 'Unknown User';
}

function displayName(member) {
  return member?.displayName
    || member?.user?.globalName
    || member?.user?.username
    || 'Unknown User';
}

function refreshGuild(interaction) {
  return interaction?.guild || null;
}

function sessionKey(interaction) {
  return `${interaction?.guildId || interaction?.guild?.id || 'global'}:${interaction?.user?.id || 'system'}`;
}

function replaceVars(value, interaction, allowUserPing = false) {
  let output = String(value ?? '');
  const guild = interaction?.guild;
  const user = interaction?.user || interaction?.member?.user;
  const member = interaction?.member;
  const channel = interaction?.channel || {};
  const channelId = interaction?.channelId || channel?.id || '';
  const memberCount = guild?.memberCount ?? 0;
  const ownerId = guild?.ownerId || '';
  const topRole = member?.roles?.highest || null;
  const guildCreatedTimestamp = guild?.createdTimestamp || 0;
  const vars = {
    '{userId}': user?.id || '',
    '{userTag}': user?.tag || user?.username || '',
    '{userName}': user?.username || '',
    '{userGlobalName}': user?.globalName || '',
    '{userMention}': user?.id ? (allowUserPing ? `<@${user.id}>` : `@${displayName(member)}`) : '',
    '{userNoPing}': user?.id ? `@${displayName(member)}` : '',
    '{userAvatar}': avatar(member) || user?.displayAvatarURL?.({ size: 1024 }) || '',
    '{userServerAvatar}': avatar(member) || '',
    '{userNickname}': member?.nickname || '',
    '{userDisplay}': displayName(member),
    '{userCreatedAt}': fmtDate(user?.createdAt),
    '{userCreatedTimestamp}': fmtTs(user?.createdAt),
    '{userJoinedAt}': fmtDate(member?.joinedAt),
    '{userJoinedTimestamp}': fmtTs(member?.joinedAt),
    '{createdAt}': fmtDate(user?.createdAt),
    '{joinedAt}': fmtDate(member?.joinedAt),
    '{leftAt}': fmtDate(new Date()),
    '{timestamp}': fmtTs(new Date()),
    '{accountAge}': durationFrom(user?.createdTimestamp),
    '{membershipDuration}': durationFrom(member?.joinedTimestamp),
    '{departureIcon}': '',
    '{departureType}': '',
    '{departureLabel}': '',
    '{departureReason}': '',
    '{departureModerator}': '',
    '{departureModeratorId}': '',
    '{nowTimestamp}': fmtTs(new Date()),
    '{successEmoji}': '✅',
    '{warningEmoji}': '⚠️',
    '{errorEmoji}': '❌',
    '{proofVerifiedEmoji}': '✅',
    '{successColor}': '#57F287',
    '{warningColor}': '#FEE75C',
    '{errorColor}': '#ED4245',
    '{proofVerifiedColor}': '#57F287',
    '{guildId}': guild?.id || '',
    '{guildName}': guild?.name || '',
    '{server}': guild?.name || '',
    '{guildIcon}': guildIcon(guild) || '',
    '{serverIcon}': guildIcon(guild) || '',
    '{guildBanner}': guildBanner(guild) || '',
    '{guildMemberCount}': String(memberCount),
    '{memberCount}': String(memberCount),
    '{guildVanityCode}': guild?.vanityURLCode || '',
    '{channelId}': channelId,
    '{channelName}': channel?.name || 'Unknown Channel',
    '{channelMention}': channelId ? `<#${channelId}>` : '',
    '{guildOwnerId}': ownerId,
    '{guildOwnerMention}': ownerId ? `<@${ownerId}>` : '',
    '{guildCreatedAt}': fmtTs(guildCreatedTimestamp, 'F'),
    '{guildCreatedTimestamp}': fmtTs(guildCreatedTimestamp, 'R'),
    '{guildBoostCount}': String(guild?.premiumSubscriptionCount || 0),
    '{guildBoostTier}': String(guild?.premiumTier ?? 0),
    '{guildSplash}': safeAsset(() => guild?.splashURL?.({ extension: 'png', size: 2048 })),
    '{guildDiscoverySplash}': safeAsset(() => guild?.discoverySplashURL?.({ extension: 'png', size: 2048 })),
    '{userBot}': user?.bot ? 'Yes' : 'No',
    '{userTopRoleId}': topRole?.id || '',
    '{userTopRoleMention}': topRole?.id ? `<@&${topRole.id}>` : '',
  };

  for (const [key, replacement] of Object.entries(vars)) {
    output = output.split(key).join(String(replacement ?? ''));
    output = output.split(key.toLowerCase()).join(String(replacement ?? ''));
  }
  return output;
}

function getSession(interaction) {
  const key = sessionKey(interaction);
  if (!sessions.has(key)) {
    if (typeof defaultStateFactory !== 'function') {
      throw new Error('Embed state is not configured with a defaultState factory.');
    }
    sessions.set(key, stateSync(defaultStateFactory()));
  }
  return sessions.get(key);
}

function saveSession(interaction, state) {
  const synced = stateSync(state);
  sessions.set(sessionKey(interaction), synced);
  return synced;
}

function saveSelected(state, patch = {}) {
  const panels = clone(state?.panels || []);
  const selectedPanelIndex = Math.max(0, Number(state?.selectedPanelIndex) || 0);
  if (!panels[selectedPanelIndex]) return stateSync(state);
  panels[selectedPanelIndex] = { ...panels[selectedPanelIndex], ...clone(patch) };
  return stateSync({ ...state, panels });
}

function markUnsaved(interaction, state) {
  return saveSession(interaction, { ...state, hasUnsavedChanges: true });
}

function clearUnsaved(interaction, state) {
  return saveSession(interaction, { ...state, hasUnsavedChanges: false });
}

function resetSession(interaction) {
  if (typeof defaultStateFactory !== 'function') {
    throw new Error('Embed state is not configured with a defaultState factory.');
  }
  const next = stateSync(defaultStateFactory());
  sessions.set(sessionKey(interaction), next);
  return next;
}

function clearSession(interaction) {
  return sessions.delete(sessionKey(interaction));
}

function allowedMentions(state) {
  return state?.allowUserPing ? { parse: ['users', 'roles'] } : { parse: [] };
}

function presetData(state) {
  return {
    template: state?.template || 'custom',
    panels: clone(state?.panels || []),
    allowUserPing: !!state?.allowUserPing,
    showTimestamp: state?.showTimestamp !== false,
    fieldLayout: state?.fieldLayout || 'auto',
  };
}

function applyTemplate(interaction, name) {
  if (typeof basePanelFactory !== 'function') throw new Error('Embed state is not configured with a basePanel factory.');
  const current = getSession(interaction);
  const nextPanel = basePanelFactory(name);
  return markUnsaved(interaction, stateSync({
    ...current,
    template: name,
    selectedPanelIndex: 0,
    panels: [nextPanel],
    selectedPreset: null,
  }));
}

function applyPreset(interaction, name, preset = {}) {
  if (typeof basePanelFactory !== 'function') throw new Error('Embed state is not configured with a basePanel factory.');
  const current = getSession(interaction);
  const panels = Array.isArray(preset?.panels) && preset.panels.length
    ? clone(preset.panels)
    : [basePanelFactory('custom')];
  return markUnsaved(interaction, stateSync({
    ...current,
    template: preset?.template || 'custom',
    selectedPreset: name || null,
    panels,
    selectedPanelIndex: 0,
    allowUserPing: !!preset?.allowUserPing,
    showTimestamp: preset?.showTimestamp !== false,
    fieldLayout: preset?.fieldLayout || 'auto',
  }));
}

function setDefault(interaction, name) {
  const current = getSession(interaction);
  return saveSession(interaction, { ...current, selectedPreset: name || null });
}

function bindPanel(panel, { defaultState, sync, basePanel } = {}) {
  if (!panel || typeof panel !== 'object') return panel;
  configure({ defaultState, sync, basePanel });
  Object.assign(panel, {
    HELPERS,
    clone,
    trim,
    fmtDate,
    fmtTs,
    durationFrom,
    avatar,
    guildIcon,
    guildBanner,
    memberName,
    displayName,
    refreshGuild,
    sessionKey,
    replaceVars,
    getSession,
    saveSession,
    saveSelected,
    markUnsaved,
    clearUnsaved,
    resetSession,
    clearSession,
    allowedMentions,
    presetData,
    applyTemplate,
    applyPreset,
    setDefault,
  });
  return panel;
}

module.exports = {
  HELPERS,
  sessions,
  configure,
  bindPanel,
  clone,
  trim,
  fmtDate,
  fmtTs,
  durationFrom,
  avatar,
  guildIcon,
  guildBanner,
  memberName,
  displayName,
  refreshGuild,
  sessionKey,
  replaceVars,
  getSession,
  saveSession,
  saveSelected,
  markUnsaved,
  clearUnsaved,
  resetSession,
  clearSession,
  allowedMentions,
  presetData,
  applyTemplate,
  applyPreset,
  setDefault,
};
