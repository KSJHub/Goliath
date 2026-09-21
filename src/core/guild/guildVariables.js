'use strict';

/**
 * Canonical Goliath Discord/guild template-variable registry and resolver.
 * Modules must consume this registry instead of maintaining local variable lists.
 */

const HELPERS = Object.freeze([
  '{userId}', '{userTag}', '{userName}', '{userGlobalName}', '{userMention}', '{userNoPing}',
  '{userAvatar}', '{userServerAvatar}', '{userNickname}', '{userDisplay}', '{userCreatedAt}',
  '{userCreatedTimestamp}', '{userJoinedAt}', '{userJoinedTimestamp}', '{createdAt}', '{joinedAt}',
  '{leftAt}', '{timestamp}', '{accountAge}', '{membershipDuration}', '{departureIcon}',
  '{departureType}', '{departureLabel}', '{departureReason}', '{departureModerator}',
  '{departureModeratorId}', '{nowTimestamp}', '{successEmoji}', '{warningEmoji}', '{errorEmoji}',
  '{proofVerifiedEmoji}', '{successColor}', '{warningColor}', '{errorColor}', '{proofVerifiedColor}',
  '{guildId}', '{guildName}', '{server}', '{server.cleanName}', '{guildIcon}', '{serverIcon}', '{guildBanner}',
  '{guildMemberCount}', '{memberCount}', '{guildVanityCode}', '{channelId}', '{channelName}',
  '{channelMention}', '{guildOwnerId}', '{guildOwnerMention}', '{guildCreatedAt}',
  '{guildCreatedTimestamp}', '{guildBoostCount}', '{guildBoostTier}', '{guildSplash}',
  '{guildDiscoverySplash}', '{userBot}', '{userTopRoleId}', '{userTopRoleMention}',
  '{verifiedRoles}', '{pendingRoles}', '{minimumAccountAgeDays}', '{minimumMembershipAgeMinutes}',
  '{cooldownSeconds}', '{attempts}', '{reason}',
]);

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
  const years = Math.floor(months / 12); months %= 12;
  const parts = [];
  if (years) parts.push(`${years} year${years === 1 ? '' : 's'}`);
  if (months || !parts.length) parts.push(`${months} month${months === 1 ? '' : 's'}`);
  return parts.join(', ');
}
function avatar(member) { return member?.displayAvatarURL?.({ size: 1024 }) || member?.user?.displayAvatarURL?.({ size: 1024 }) || undefined; }
function guildIcon(guild) { return guild?.iconURL?.({ size: 1024 }) || undefined; }
function guildBanner(guild) { return guild?.bannerURL?.({ size: 2048 }) || undefined; }
function safeAsset(fn, fallback = '') { try { return fn?.() || fallback; } catch { return fallback; } }
function displayName(member) { return member?.displayName || member?.user?.globalName || member?.user?.username || 'Unknown User'; }
function cleanServerName(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const cleaned = raw.replace(/^[\p{Extended_Pictographic}\p{Symbol}\p{Punctuation}\s]+/gu, '').replace(/[\p{Extended_Pictographic}\p{Symbol}\p{Punctuation}\s]+$/gu, '').trim();
  return cleaned || raw;
}

function buildVariableMap(interaction, allowUserPing = false, overrides = {}) {
  const guild = interaction?.guild;
  const user = interaction?.user || interaction?.member?.user;
  const member = interaction?.member;
  const channel = interaction?.channel || {};
  const channelId = interaction?.channelId || channel?.id || '';
  const memberCount = guild?.memberCount ?? 0;
  const ownerId = guild?.ownerId || '';
  const topRole = member?.roles?.highest || null;
  const guildCreatedTimestamp = guild?.createdTimestamp || 0;
  return {
    '{userId}': user?.id || '', '{userTag}': user?.tag || user?.username || '', '{userName}': user?.username || '',
    '{userGlobalName}': user?.globalName || '', '{userMention}': user?.id ? (allowUserPing ? `<@${user.id}>` : `@${displayName(member)}`) : '',
    '{userNoPing}': user?.id ? `@${displayName(member)}` : '', '{userAvatar}': avatar(member) || user?.displayAvatarURL?.({ size: 1024 }) || '',
    '{userServerAvatar}': avatar(member) || '', '{userNickname}': member?.nickname || '', '{userDisplay}': displayName(member),
    '{userCreatedAt}': fmtDate(user?.createdAt), '{userCreatedTimestamp}': fmtTs(user?.createdAt), '{userJoinedAt}': fmtDate(member?.joinedAt),
    '{userJoinedTimestamp}': fmtTs(member?.joinedAt), '{createdAt}': fmtDate(user?.createdAt), '{joinedAt}': fmtDate(member?.joinedAt),
    '{leftAt}': fmtDate(new Date()), '{timestamp}': fmtTs(new Date()), '{accountAge}': durationFrom(user?.createdTimestamp),
    '{membershipDuration}': durationFrom(member?.joinedTimestamp), '{departureIcon}': '', '{departureType}': '', '{departureLabel}': '',
    '{departureReason}': '', '{departureModerator}': '', '{departureModeratorId}': '', '{nowTimestamp}': fmtTs(new Date()),
    '{successEmoji}': '✅', '{warningEmoji}': '⚠️', '{errorEmoji}': '❌', '{proofVerifiedEmoji}': '✅',
    '{successColor}': '#57F287', '{warningColor}': '#FEE75C', '{errorColor}': '#ED4245', '{proofVerifiedColor}': '#57F287',
    '{guildId}': guild?.id || '', '{guildName}': guild?.name || '', '{server}': guild?.name || '', '{server.cleanName}': cleanServerName(guild?.name),
    '{guildIcon}': guildIcon(guild) || '', '{serverIcon}': guildIcon(guild) || '', '{guildBanner}': guildBanner(guild) || '',
    '{guildMemberCount}': String(memberCount), '{memberCount}': String(memberCount), '{guildVanityCode}': guild?.vanityURLCode || '',
    '{channelId}': channelId, '{channelName}': channel?.name || 'Unknown Channel', '{channelMention}': channelId ? `<#${channelId}>` : '',
    '{guildOwnerId}': ownerId, '{guildOwnerMention}': ownerId ? `<@${ownerId}>` : '', '{guildCreatedAt}': fmtTs(guildCreatedTimestamp, 'F'),
    '{guildCreatedTimestamp}': fmtTs(guildCreatedTimestamp, 'R'), '{guildBoostCount}': String(guild?.premiumSubscriptionCount || 0),
    '{guildBoostTier}': String(guild?.premiumTier ?? 0), '{guildSplash}': safeAsset(() => guild?.splashURL?.({ extension: 'png', size: 2048 })),
    '{guildDiscoverySplash}': safeAsset(() => guild?.discoverySplashURL?.({ extension: 'png', size: 2048 })), '{userBot}': user?.bot ? 'Yes' : 'No',
    '{userTopRoleId}': topRole?.id || '', '{userTopRoleMention}': topRole?.id ? `<@&${topRole.id}>` : '',
    '{verifiedRoles}': '', '{pendingRoles}': '', '{minimumAccountAgeDays}': '', '{minimumMembershipAgeMinutes}': '',
    '{cooldownSeconds}': '', '{attempts}': '', '{reason}': '',
    ...overrides,
  };
}

function replaceVars(value, interaction, allowUserPing = false, overrides = {}) {
  let output = String(value ?? '');
  const vars = buildVariableMap(interaction, allowUserPing, overrides);
  for (const [key, replacement] of Object.entries(vars)) {
    output = output.split(key).join(String(replacement ?? ''));
    output = output.split(key.toLowerCase()).join(String(replacement ?? ''));
  }
  return output;
}

// Verification keeps its established presentation semantics while sourcing
// values from the same global registry. This adapter can also serve other
// member-event modules that require relative timestamps and preserve unknown
// placeholders rather than replacing them with empty strings.
function verificationFormatDate(value) {
  if (!value) return '';
  try { return new Date(value).toLocaleString(); } catch { return ''; }
}
function verificationTimestamp(value) {
  const milliseconds = value instanceof Date ? value.getTime() : Number(value);
  const seconds = Math.floor(milliseconds / 1000);
  return Number.isFinite(seconds) && seconds > 0 ? `<t:${seconds}:R>` : '';
}
function verificationDuration(milliseconds) {
  const total = Math.max(0, Number(milliseconds) || 0);
  const days = Math.floor(total / 86400000);
  const years = Math.floor(days / 365);
  const months = Math.floor((days % 365) / 30);
  const remainingDays = (days % 365) % 30;
  const parts = [];
  if (years) parts.push(`${years} year${years === 1 ? '' : 's'}`);
  if (months) parts.push(`${months} month${months === 1 ? '' : 's'}`);
  if (!years && remainingDays) parts.push(`${remainingDays} day${remainingDays === 1 ? '' : 's'}`);
  return parts.length ? parts.join(', ') : 'less than a day';
}
function buildVerificationVariableMap(member, guildInput, values = {}) {
  const guild = guildInput || member?.guild || null;
  const user = member?.user || values.user || null;
  const userId = member?.id || user?.id || '';
  const nowMs = Date.now();
  const now = `<t:${Math.floor(nowMs / 1000)}:R>`;
  const icon = guild?.iconURL?.({ extension: 'png', size: 256 }) || '';
  const banner = guild?.bannerURL?.({ extension: 'png', size: 1024 }) || '';
  const createdTimestamp = user?.createdTimestamp || 0;
  const joinedTimestamp = member?.joinedTimestamp || 0;
  const display = member?.displayName || user?.globalName || user?.displayName || user?.username || '';
  const nickname = member?.nickname || display;
  const userImage = user?.displayAvatarURL?.({ extension: 'png', size: 256 }) || '';
  const serverUserImage = member?.displayAvatarURL?.({ extension: 'png', size: 256 }) || userImage;
  const unavailable = undefined;
  return {
    user: userId ? `<@${userId}>` : unavailable,
    username: user?.username || unavailable,
    serverId: guild?.id || unavailable,
    userId: userId || unavailable,
    userTag: user ? (user.tag || user.username || '') : unavailable,
    userName: user?.username || unavailable,
    userGlobalName: user ? (user.globalName || user.username || '') : unavailable,
    userMention: userId ? `<@${userId}>` : unavailable,
    userNoPing: userId ? `<@${userId}>` : unavailable,
    userAvatar: userImage || unavailable,
    userServerAvatar: serverUserImage || unavailable,
    userNickname: nickname || unavailable,
    userDisplay: display || unavailable,
    userCreatedAt: user ? verificationFormatDate(user.createdAt) : unavailable,
    userCreatedTimestamp: createdTimestamp ? verificationTimestamp(createdTimestamp) : unavailable,
    userJoinedAt: member ? verificationFormatDate(member.joinedAt) : unavailable,
    userJoinedTimestamp: joinedTimestamp ? verificationTimestamp(joinedTimestamp) : unavailable,
    createdAt: createdTimestamp ? verificationTimestamp(createdTimestamp) : unavailable,
    joinedAt: joinedTimestamp ? verificationTimestamp(joinedTimestamp) : unavailable,
    leftAt: values.leftAt || now,
    timestamp: values.timestamp || now,
    accountAge: user && createdTimestamp ? verificationDuration(nowMs - createdTimestamp) : unavailable,
    membershipDuration: member && joinedTimestamp ? verificationDuration(nowMs - joinedTimestamp) : unavailable,
    departureIcon: values.departureIcon ?? '👋',
    departureType: values.departureType ?? 'left',
    departureLabel: values.departureLabel ?? 'Left Voluntarily',
    departureReason: values.departureReason ?? 'No reason — the member left voluntarily.',
    departureModerator: values.departureModerator ?? 'Not applicable',
    departureModeratorId: values.departureModeratorId ?? 'Not applicable',
    nowTimestamp: now,
    successEmoji: '✅', warningEmoji: '⚠️', errorEmoji: '❌', proofVerifiedEmoji: '💎',
    successColor: '#57F287', warningColor: '#FEE75C', errorColor: '#ED4245', proofVerifiedColor: '#00D4FF',
    guildId: guild?.id || unavailable,
    guildName: guild?.name || unavailable,
    server: guild?.name || unavailable,
    guildIcon: icon || unavailable,
    serverIcon: icon || unavailable,
    guildBanner: banner || unavailable,
    guildMemberCount: guild ? String(guild.memberCount || 0) : unavailable,
    memberCount: guild ? String(guild.memberCount || 0) : unavailable,
    guildVanityCode: guild ? (guild.vanityURLCode || '') : unavailable,
    verifiedRoles: values.verifiedRoles ?? '', pendingRoles: values.pendingRoles ?? '',
    minimumAccountAgeDays: values.minimumAccountAgeDays ?? '',
    minimumMembershipAgeMinutes: values.minimumMembershipAgeMinutes ?? '',
    cooldownSeconds: values.cooldownSeconds ?? '', attempts: values.attempts ?? '', reason: values.reason ?? '',
    ...values,
  };
}
function renderVerificationTemplate(template, member = null, guild = null, values = {}) {
  const replacements = buildVerificationVariableMap(member, guild, values);
  return String(template || '').replace(/\{([a-zA-Z0-9_]+)\}/g, (token, key) => {
    if (!Object.prototype.hasOwnProperty.call(replacements, key)) return token;
    const value = replacements[key];
    return value === undefined || value === null ? token : String(value);
  });
}

function getVariables() { return [...HELPERS]; }
module.exports = {
  HELPERS,
  getVariables,
  buildVariableMap,
  replaceVars,
  replaceVariables: replaceVars,
  buildVerificationVariableMap,
  renderVerificationTemplate,
};
