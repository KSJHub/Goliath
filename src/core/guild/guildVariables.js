'use strict';

/**
 * Canonical Goliath Discord/guild template-variable registry and resolver.
 * Modules must consume this registry instead of maintaining local variable lists.
 * Custom variables are persisted by the DEV/owner panel and loaded here centrally.
 */

const fs = require('node:fs');
const path = require('node:path');
const { getRuntimeRoot } = require('../../config/runtimePaths');

const SYSTEM_VARIABLES = Object.freeze([
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
  '{guild}', '{serverName}', '{totalMemberCount}', '{user}', '{username}', '{memberAvatar}',
  '{welcomeRoles}', '{welcomeRoleMentions}', '{welcomeRolesNoPing}',
]);
const HELPERS = SYSTEM_VARIABLES;

let customCache = { file: '', mtimeMs: -1, variables: [] };

function variableKey(value) {
  return String(value || '').trim().replace(/^\{+|\}+$/g, '');
}
function variableToken(value) {
  const key = variableKey(value);
  return key ? `{${key}}` : '';
}
function normalizeCustomVariable(input = {}) {
  const key = variableKey(input.key || input.name || input.token);
  if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(key)) throw new Error('Variable name must start with a letter and contain only letters, numbers, dot, dash or underscore.');
  const token = `{${key}}`;
  if (SYSTEM_VARIABLES.some((item) => item.toLowerCase() === token.toLowerCase())) throw new Error(`${token} is a protected system variable.`);
  return {
    key,
    token,
    value: String(input.value ?? ''),
    category: String(input.category || 'Custom').trim().slice(0, 40) || 'Custom',
    description: String(input.description || '').trim().slice(0, 240),
    enabled: input.enabled !== false,
  };
}
function normalizeCustomVariables(input) {
  const source = Array.isArray(input) ? input : Object.entries(input || {}).map(([key, value]) => (typeof value === 'object' && value !== null ? { key, ...value } : { key, value }));
  const seen = new Set();
  const output = [];
  for (const item of source) {
    try {
      const normalized = normalizeCustomVariable(item);
      const id = normalized.key.toLowerCase();
      if (seen.has(id)) continue;
      seen.add(id);
      output.push(normalized);
    } catch { /* Invalid persisted entries are ignored; owner-panel validation blocks them on save. */ }
  }
  return output;
}
function customVariablesPath() {
  return path.join(getRuntimeRoot(process.env.BOT_MODE), 'data', 'globalVariables.json');
}
function loadPersistedCustomVariables(options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, 'customVariables')) return normalizeCustomVariables(options.customVariables);
  const file = customVariablesPath();
  try {
    const stat = fs.statSync(file);
    if (customCache.file === file && customCache.mtimeMs === stat.mtimeMs) return customCache.variables;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const variables = normalizeCustomVariables(Array.isArray(parsed) ? parsed : parsed?.variables || []);
    customCache = { file, mtimeMs: stat.mtimeMs, variables };
    return variables;
  } catch (error) {
    if (error?.code !== 'ENOENT') console.warn('[GUILD VARIABLES] Could not load custom variables:', error.message);
    customCache = { file, mtimeMs: -1, variables: [] };
    return [];
  }
}
function invalidateCustomVariableCache() {
  customCache = { file: '', mtimeMs: -1, variables: [] };
}
function buildCustomVariableMap(input) {
  const output = {};
  for (const item of normalizeCustomVariables(input)) if (item.enabled) output[item.token] = item.value;
  return output;
}
function buildGlobalCustomVariableMap(options = {}) {
  return buildCustomVariableMap(loadPersistedCustomVariables(options));
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
function buildVariableMap(interaction, allowUserPing = false, overrides = {}, options = {}) {
  const guild = interaction?.guild;
  const user = interaction?.user || interaction?.member?.user;
  const member = interaction?.member;
  const channel = interaction?.channel || {};
  const channelId = interaction?.channelId || channel?.id || '';
  const memberCount = guild?.memberCount ?? 0;
  const ownerId = guild?.ownerId || '';
  const topRole = member?.roles?.highest || null;
  const guildCreatedTimestamp = guild?.createdTimestamp || 0;
  const map = {
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
    '{guild}': guild?.name || '', '{serverName}': guild?.name || '', '{totalMemberCount}': String(memberCount),
    '{user}': user?.id ? `<@${user.id}>` : '', '{username}': user?.username || user?.tag || '', '{memberAvatar}': avatar(member) || '',
    '{welcomeRoles}': '', '{welcomeRoleMentions}': '', '{welcomeRolesNoPing}': '',
  };
  return { ...map, ...buildGlobalCustomVariableMap(options), ...overrides };
}
function replaceVars(value, interaction, allowUserPing = false, overrides = {}, options = {}) {
  let output = String(value ?? '');
  const vars = buildVariableMap(interaction, allowUserPing, overrides, options);
  for (const [key, replacement] of Object.entries(vars)) {
    output = output.split(key).join(String(replacement ?? ''));
    output = output.split(key.toLowerCase()).join(String(replacement ?? ''));
  }
  return output;
}
function buildWelcomeVariableMap(member, context = {}, options = {}) {
  const guild = member?.guild;
  const user = member?.user;
  const joinNumber = Number(context.joinNumber ?? guild?.memberCount ?? 0);
  const totalMemberCount = Number(context.totalMemberCount ?? guild?.memberCount ?? 0);
  const roleMentions = String(context.welcomeRoleMentions ?? context.welcomeRoles ?? '');
  const roleDisplay = String(context.welcomeRolesNoPing ?? '');
  const interaction = { guild, guildId: guild?.id, user, member };
  return buildVariableMap(interaction, false, {
    '{guild}': guild?.name || '', '{guildName}': guild?.name || '', '{server}': guild?.name || '', '{serverName}': guild?.name || '',
    '{memberCount}': String(joinNumber), '{guildMemberCount}': String(joinNumber), '{totalMemberCount}': String(totalMemberCount),
    '{user}': user ? String(user) : '', '{userMention}': user?.id ? `<@${user.id}>` : '', '{userNoPing}': `@${user?.username || user?.id || ''}`,
    '{username}': user?.username || user?.tag || user?.id || '', '{userDisplay}': member?.displayName || user?.globalName || user?.username || user?.id || '',
    '{userAvatar}': member?.displayAvatarURL?.({ extension: 'png', size: 256 }) || user?.displayAvatarURL?.({ extension: 'png', size: 256 }) || '',
    '{memberAvatar}': member?.displayAvatarURL?.({ extension: 'png', size: 256 }) || user?.displayAvatarURL?.({ extension: 'png', size: 256 }) || '',
    '{welcomeRoles}': roleMentions, '{welcomeRoleMentions}': roleMentions, '{welcomeRolesNoPing}': roleDisplay,
    '{createdAt}': fmtTs(user?.createdTimestamp, 'F'), '{joinedAt}': fmtTs(member?.joinedTimestamp, 'F'), '{timestamp}': fmtTs(Date.now(), 'F'),
  }, options);
}
function renderWelcomeTemplate(template, member, context = {}, replacements = {}, options = {}) {
  const values = { ...buildWelcomeVariableMap(member, context, options), ...replacements };
  let output = String(template ?? '');
  for (const [token, value] of Object.entries(values)) output = output.split(token).join(String(value ?? ''));
  return output;
}
function verificationFormatDate(value) { if (!value) return ''; try { return new Date(value).toLocaleString(); } catch { return ''; } }
function verificationTimestamp(value) { const milliseconds = value instanceof Date ? value.getTime() : Number(value); const seconds = Math.floor(milliseconds / 1000); return Number.isFinite(seconds) && seconds > 0 ? `<t:${seconds}:R>` : ''; }
function verificationDuration(milliseconds) {
  const total = Math.max(0, Number(milliseconds) || 0); const days = Math.floor(total / 86400000); const years = Math.floor(days / 365); const months = Math.floor((days % 365) / 30); const remainingDays = (days % 365) % 30; const parts = [];
  if (years) parts.push(`${years} year${years === 1 ? '' : 's'}`); if (months) parts.push(`${months} month${months === 1 ? '' : 's'}`); if (!years && remainingDays) parts.push(`${remainingDays} day${remainingDays === 1 ? '' : 's'}`); return parts.length ? parts.join(', ') : 'less than a day';
}
function buildVerificationVariableMap(member, guildInput, values = {}, options = {}) {
  const guild = guildInput || member?.guild || null; const user = member?.user || values.user || null; const userId = member?.id || user?.id || ''; const nowMs = Date.now(); const now = `<t:${Math.floor(nowMs / 1000)}:R>`; const icon = guild?.iconURL?.({ extension: 'png', size: 256 }) || ''; const banner = guild?.bannerURL?.({ extension: 'png', size: 1024 }) || ''; const createdTimestamp = user?.createdTimestamp || 0; const joinedTimestamp = member?.joinedTimestamp || 0; const display = member?.displayName || user?.globalName || user?.displayName || user?.username || ''; const nickname = member?.nickname || display; const userImage = user?.displayAvatarURL?.({ extension: 'png', size: 256 }) || ''; const serverUserImage = member?.displayAvatarURL?.({ extension: 'png', size: 256 }) || userImage; const unavailable = undefined;
  return { user: userId ? `<@${userId}>` : unavailable, username: user?.username || unavailable, serverId: guild?.id || unavailable, userId: userId || unavailable, userTag: user ? (user.tag || user.username || '') : unavailable, userName: user?.username || unavailable, userGlobalName: user ? (user.globalName || user.username || '') : unavailable, userMention: userId ? `<@${userId}>` : unavailable, userNoPing: userId ? `<@${userId}>` : unavailable, userAvatar: userImage || unavailable, userServerAvatar: serverUserImage || unavailable, userNickname: nickname || unavailable, userDisplay: display || unavailable, userCreatedAt: user ? verificationFormatDate(user.createdAt) : unavailable, userCreatedTimestamp: createdTimestamp ? verificationTimestamp(createdTimestamp) : unavailable, userJoinedAt: member ? verificationFormatDate(member.joinedAt) : unavailable, userJoinedTimestamp: joinedTimestamp ? verificationTimestamp(joinedTimestamp) : unavailable, createdAt: createdTimestamp ? verificationTimestamp(createdTimestamp) : unavailable, joinedAt: joinedTimestamp ? verificationTimestamp(joinedTimestamp) : unavailable, leftAt: values.leftAt || now, timestamp: values.timestamp || now, accountAge: user && createdTimestamp ? verificationDuration(nowMs - createdTimestamp) : unavailable, membershipDuration: member && joinedTimestamp ? verificationDuration(nowMs - joinedTimestamp) : unavailable, departureIcon: values.departureIcon ?? '👋', departureType: values.departureType ?? 'left', departureLabel: values.departureLabel ?? 'Left Voluntarily', departureReason: values.departureReason ?? 'No reason — the member left voluntarily.', departureModerator: values.departureModerator ?? 'Not applicable', departureModeratorId: values.departureModeratorId ?? 'Not applicable', nowTimestamp: now, successEmoji: '✅', warningEmoji: '⚠️', errorEmoji: '❌', proofVerifiedEmoji: '💎', successColor: '#57F287', warningColor: '#FEE75C', errorColor: '#ED4245', proofVerifiedColor: '#00D4FF', guildId: guild?.id || unavailable, guildName: guild?.name || unavailable, server: guild?.name || unavailable, guildIcon: icon || unavailable, serverIcon: icon || unavailable, guildBanner: banner || unavailable, guildMemberCount: guild ? String(guild.memberCount || 0) : unavailable, memberCount: guild ? String(guild.memberCount || 0) : unavailable, guildVanityCode: guild ? (guild.vanityURLCode || '') : unavailable, verifiedRoles: values.verifiedRoles ?? '', pendingRoles: values.pendingRoles ?? '', minimumAccountAgeDays: values.minimumAccountAgeDays ?? '', minimumMembershipAgeMinutes: values.minimumMembershipAgeMinutes ?? '', cooldownSeconds: values.cooldownSeconds ?? '', attempts: values.attempts ?? '', reason: values.reason ?? '', ...Object.fromEntries(Object.entries(buildGlobalCustomVariableMap(options)).map(([k,v]) => [variableKey(k), v])), ...values };
}
function renderVerificationTemplate(template, member = null, guild = null, values = {}, options = {}) {
  const replacements = buildVerificationVariableMap(member, guild, values, options);
  return String(template || '').replace(/\{([a-zA-Z0-9_.-]+)\}/g, (token, key) => { if (!Object.prototype.hasOwnProperty.call(replacements, key)) return token; const value = replacements[key]; return value === undefined || value === null ? token : String(value); });
}
function getVariables(customVariables) {
  const custom = customVariables === undefined ? loadPersistedCustomVariables() : normalizeCustomVariables(customVariables);
  return [...SYSTEM_VARIABLES, ...custom.filter((item) => item.enabled).map((item) => item.token)];
}
function getVariableDefinitions(customVariables) {
  const custom = customVariables === undefined ? loadPersistedCustomVariables() : normalizeCustomVariables(customVariables);
  return [
    ...SYSTEM_VARIABLES.map((token) => ({ key: variableKey(token), token, type: 'system', protected: true, enabled: true })),
    ...custom.map((item) => ({ ...item, type: 'custom', protected: false })),
  ];
}
module.exports = { SYSTEM_VARIABLES, HELPERS, getVariables, getVariableDefinitions, normalizeCustomVariable, normalizeCustomVariables, loadPersistedCustomVariables, invalidateCustomVariableCache, buildCustomVariableMap, buildVariableMap, replaceVars, replaceVariables: replaceVars, buildWelcomeVariableMap, renderWelcomeTemplate, buildVerificationVariableMap, renderVerificationTemplate };
