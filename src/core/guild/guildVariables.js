'use strict';

/**
 * Canonical Goliath Discord/guild template-variable registry and resolver.
 *
 * Modules must consume this registry rather than maintaining their own
 * HELPERS/DEFAULT_HELPERS arrays or replacement maps. Context-specific
 * variables may resolve to an empty string when their context is unavailable.
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
  const years = Math.floor(months / 12);
  months %= 12;
  const parts = [];
  if (years) parts.push(`${years} year${years === 1 ? '' : 's'}`);
  if (months || !parts.length) parts.push(`${months} month${months === 1 ? '' : 's'}`);
  return parts.join(', ');
}

function avatar(member) {
  return member?.displayAvatarURL?.({ size: 1024 }) || member?.user?.displayAvatarURL?.({ size: 1024 }) || undefined;
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

function displayName(member) {
  return member?.displayName || member?.user?.globalName || member?.user?.username || 'Unknown User';
}

function cleanServerName(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const cleaned = raw
    .replace(/^[\p{Extended_Pictographic}\p{Symbol}\p{Punctuation}\s]+/gu, '')
    .replace(/[\p{Extended_Pictographic}\p{Symbol}\p{Punctuation}\s]+$/gu, '')
    .trim();
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
    '{server.cleanName}': cleanServerName(guild?.name),
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

function getVariables() {
  return [...HELPERS];
}

module.exports = {
  HELPERS,
  getVariables,
  buildVariableMap,
  replaceVars,
  replaceVariables: replaceVars,
};
