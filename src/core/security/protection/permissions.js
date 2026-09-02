'use strict';

const { ChannelType, PermissionFlagsBits, PermissionsBitField } = require('discord.js');
const testDevOverride = require('../../../owner/dev/DevOverrideManager');

const DEFAULT_BOT_CHANNEL_PERMISSIONS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks];
const MANAGE_CHANNEL_PERMISSIONS = [...DEFAULT_BOT_CHANNEL_PERMISSIONS, PermissionFlagsBits.ManageChannels];
const TICKET_CHANNEL_PERMISSIONS = [...MANAGE_CHANNEL_PERMISSIONS, PermissionFlagsBits.ManageMessages];

class GoliathPermissionError extends Error {
  constructor(message, details = {}) {
    super(message || 'Goliath permission validation failed.');
    this.name = 'GoliathPermissionError';
    this.code = 'GOLIATH_PERMISSION_GUARD_FAILED';
    this.details = details;
  }
}

function unique(values = []) { return [...new Set((Array.isArray(values) ? values : []).filter(Boolean).map(String))]; }
function normalisePermissions(permissions = []) { return (Array.isArray(permissions) ? permissions : [permissions]).filter(Boolean); }
function permissionLabel(permission) { const key = new PermissionsBitField(permission).toArray()[0]; return key || String(permission); }
function getBotId(guild) { return guild?.members?.me?.id || guild?.client?.user?.id || null; }
async function getBotMember(guild) { if (!guild) return null; if (guild.members?.me) return guild.members.me; const fetched = await guild.members.fetchMe().catch(() => null); return fetched || guild.members?.me || null; }
async function getBotHighestRole(guild) { const botMember = await getBotMember(guild); return botMember?.roles?.highest || null; }
async function fetchRole(guild, roleId) { if (!guild || !roleId) return null; const id = String(roleId); return guild.roles?.cache?.get(id) || guild.roles?.fetch?.(id).catch(() => null) || null; }
async function fetchChannel(guild, channelId) { if (!guild || !channelId) return null; const id = String(channelId); return guild.channels?.cache?.get(id) || guild.channels?.fetch?.(id).catch(() => null) || null; }
function bypassResult(scope, guild, channel, channelId, metadata = {}) { return buildGuardResult({ scope, guild, channel, channelId, ok: true, failures: [], metadata: testDevOverride.buildBypassMetadata(metadata) }); }

async function canManageRole(guild, roleId) {
  const role = await fetchRole(guild, roleId);
  const botMember = await getBotMember(guild);
  const highestRole = botMember?.roles?.highest || null;
  if (!role) return { ok: false, roleId: String(roleId || ''), reason: 'role_not_found', message: 'The selected role could not be found in this server.' };
  if (!botMember) return { ok: false, roleId: role.id, roleName: role.name, reason: 'bot_member_not_found', message: 'Goliath could not read its own server member profile.' };
  if (role.managed) return { ok: false, roleId: role.id, roleName: role.name, reason: 'managed_role', message: `The role @${role.name} is managed by an integration and cannot be assigned manually.` };
  if (role.id === guild.id) return { ok: false, roleId: role.id, roleName: role.name, reason: 'everyone_role', message: 'The @everyone role cannot be managed as a normal assignable role.' };
  if (testDevOverride.shouldBypassGuard()) return { ok: true, roleId: role.id, roleName: role.name, bypassed: true, metadata: testDevOverride.buildBypassMetadata({ reason: 'canManageRole' }) };
  if (!botMember.permissions?.has(PermissionFlagsBits.ManageRoles)) return { ok: false, roleId: role.id, roleName: role.name, reason: 'missing_manage_roles', message: 'Goliath is missing the Manage Roles permission.' };
  if (!highestRole || Number(role.position || 0) >= Number(highestRole.position || 0)) return { ok: false, roleId: role.id, roleName: role.name, reason: 'role_hierarchy', message: `Goliath can read @${role.name}, but cannot manage it because it is above or equal to Goliath's highest role.`, fix: 'Move the Goliath bot role above this role in Server Settings > Roles.' };
  return { ok: true, roleId: role.id, roleName: role.name };
}

async function validateRoleSelection(guild, roleIds = [], options = {}) {
  const ids = unique(roleIds); const requireManageable = options.requireManageable !== false; const failures = []; const roles = [];
  for (const roleId of ids) {
    const role = await fetchRole(guild, roleId);
    if (!role) { failures.push({ type: 'role', roleId, reason: 'role_not_found', message: 'The selected role could not be found in this server.' }); continue; }
    roles.push({ id: role.id, name: role.name, position: role.position });
    if (!requireManageable) continue;
    const result = await canManageRole(guild, role.id); if (!result.ok) failures.push({ type: 'role', ...result });
  }
  if (failures.length && testDevOverride.shouldBypassGuard()) return bypassResult(options.scope || 'roles', guild, null, null, { roles, originalFailures: failures });
  return buildGuardResult({ scope: options.scope || 'roles', guild, ok: failures.length === 0, failures, metadata: { roles } });
}

async function validateChannelAccess(guild, channelId, requiredPermissions = DEFAULT_BOT_CHANNEL_PERMISSIONS, options = {}) {
  const channel = await fetchChannel(guild, channelId); const botMember = await getBotMember(guild); const permissions = normalisePermissions(requiredPermissions);
  if (!channel) return buildGuardResult({ scope: options.scope || 'channel', guild, channelId: String(channelId || ''), ok: false, failures: [{ type: 'channel', channelId: String(channelId || ''), reason: 'channel_not_found', message: 'The selected channel/category could not be found.', fix: 'Choose an existing channel/category or refresh the dashboard/server setup.' }] });
  if (!botMember) return buildGuardResult({ scope: options.scope || 'channel', guild, channel, ok: false, failures: [{ type: 'guild', reason: 'bot_member_not_found', message: 'Goliath could not read its own server member profile.' }] });
  if (testDevOverride.shouldBypassGuard()) return bypassResult(options.scope || 'channel', guild, channel, channel.id, { requiredPermissions: permissions.map(permissionLabel), channelType: channel.type });
  const channelPermissions = channel.permissionsFor(botMember);
  const failures = permissions.filter((permission) => !channelPermissions?.has(permission)).map((permission) => ({ type: 'permission', channelId: channel.id, channelName: channel.name, permissionName: permissionLabel(permission), reason: 'missing_channel_permission', message: `Goliath is missing ${permissionLabel(permission)} in ${formatChannel(channel)}.`, fix: `Give Goliath ${permissionLabel(permission)} in ${formatChannel(channel)} or its parent category.` }));
  return buildGuardResult({ scope: options.scope || 'channel', guild, channel, ok: failures.length === 0, failures, metadata: { requiredPermissions: permissions.map(permissionLabel), channelType: channel.type } });
}

async function validateCategoryAccess(guild, categoryId, requiredPermissions = MANAGE_CHANNEL_PERMISSIONS, options = {}) {
  const result = await validateChannelAccess(guild, categoryId, requiredPermissions, { ...options, scope: options.scope || 'category' });
  const category = result.channel || await fetchChannel(guild, categoryId);
  if (result.ok && !result.metadata?.testDevOverride && category?.type !== ChannelType.GuildCategory) return buildGuardResult({ scope: options.scope || 'category', guild, channel: category, ok: false, failures: [{ type: 'category', channelId: category?.id || String(categoryId || ''), channelName: category?.name || null, reason: 'not_category', message: 'The selected target is not a Discord category.', fix: 'Choose a valid category for this setup.' }] });
  return result;
}
function permissionsToOverwritePayload(permissions = [], allow = true) { const payload = {}; for (const permission of normalisePermissions(permissions)) { const resolved = new PermissionsBitField(permission).toArray()[0]; if (resolved) payload[resolved] = allow; } return payload; }
async function syncBotToChannel(guild, channelId, permissions = TICKET_CHANNEL_PERMISSIONS, options = {}) {
  const channel = await fetchChannel(guild, channelId); const botMember = await getBotMember(guild); const botId = botMember?.id || getBotId(guild);
  if (!channel || !botId) return buildGuardResult({ scope: options.scope || 'sync_channel', guild, channelId, ok: false, failures: [{ type: 'sync', reason: !channel ? 'channel_not_found' : 'bot_member_not_found', message: !channel ? 'The selected channel/category could not be found.' : 'Goliath could not read its own server member profile.' }] });
  const requiredPermissions = normalisePermissions(permissions);
  await channel.permissionOverwrites.edit(botId, permissionsToOverwritePayload(requiredPermissions, true), { reason: options.reason || 'Goliath Permission Guard sync' });
  return validateChannelAccess(guild, channel.id, requiredPermissions, { scope: options.scope || 'sync_channel' });
}
async function syncBotToCategory(guild, categoryId, permissions = TICKET_CHANNEL_PERMISSIONS, options = {}) {
  const category = await fetchChannel(guild, categoryId);
  if (!category || category.type !== ChannelType.GuildCategory) return buildGuardResult({ scope: options.scope || 'sync_category', guild, channel: category, channelId: String(categoryId || ''), ok: false, failures: [{ type: 'category', reason: !category ? 'category_not_found' : 'not_category', message: !category ? 'The selected category could not be found.' : 'The selected target is not a Discord category.' }] });
  return syncBotToChannel(guild, category.id, permissions, { ...options, scope: options.scope || 'sync_category' });
}
async function guardChannelAccess(guild, channelId, requiredPermissions = DEFAULT_BOT_CHANNEL_PERMISSIONS, options = {}) { const result = await validateChannelAccess(guild, channelId, requiredPermissions, options); return resolveGuardResult({ guild, targetId: channelId, targetType: 'channel', requiredPermissions, result, options }); }
async function guardCategoryAccess(guild, categoryId, requiredPermissions = MANAGE_CHANNEL_PERMISSIONS, options = {}) { const result = await validateCategoryAccess(guild, categoryId, requiredPermissions, options); return resolveGuardResult({ guild, targetId: categoryId, targetType: 'category', requiredPermissions, result, options }); }
async function resolveGuardResult({ guild, targetId, targetType, requiredPermissions, result, options = {} } = {}) {
  if (result?.ok) return result;
  if (testDevOverride.shouldBypassGuard()) return bypassResult(options.scope || targetType || 'global', guild, result?.channel || null, targetId, { originalResult: typeof result.toJSON === 'function' ? result.toJSON() : result, requiredPermissions: normalisePermissions(requiredPermissions).map(permissionLabel) });
  const canAttemptAutoFix = options.autoFix === true && isAutoFixableResult(result);
  if (canAttemptAutoFix && options.requireConfirmation === true) return buildAutoFixConfirmation(result, { targetId, targetType, requiredPermissions, scope: options.scope });
  if (canAttemptAutoFix) {
    const syncResult = await applyPermissionAutoFix(guild, targetId, targetType, requiredPermissions, options).catch((error) => buildGuardResult({ scope: options.scope || targetType, guild, channelId: targetId, ok: false, failures: [{ type: 'sync', reason: 'sync_failed', message: 'Goliath tried to repair its permissions but Discord rejected the update.', error: error.message, fix: 'Move the Goliath bot role higher and give it permission to manage the selected channel/category.' }], metadata: { autoFixAttempted: true } }));
    if (syncResult.ok) return syncResult; result = syncResult;
  }
  if (!result.ok && options.throwOnFail !== false) throw result.toError();
  return result;
}
async function applyPermissionAutoFix(guild, targetId, targetType = 'channel', requiredPermissions = DEFAULT_BOT_CHANNEL_PERMISSIONS, options = {}) { if (targetType === 'category') return syncBotToCategory(guild, targetId, requiredPermissions, options); return syncBotToChannel(guild, targetId, requiredPermissions, options); }
async function validateTicketDeployment(guild, config = {}) {
  const failures = [];
  const categoryIds = unique([config.categoryId, config.outputCategoryId, config.archiveCategoryId, config.panel?.outputCategoryId, config.panel?.archiveCategoryId]);
  for (const categoryId of categoryIds) { const result = await validateCategoryAccess(guild, categoryId, TICKET_CHANNEL_PERMISSIONS, { scope: 'ticket_deployment' }); if (!result.ok) failures.push(...result.failures); }
  const roleIds = unique([...(config.staffRoleIds || []), ...(config.managerRoleIds || []), ...(config.viewerRoleIds || []), ...(config.panel?.staffRoleIds || []), ...(config.panel?.managerRoleIds || []), ...(config.panel?.viewerRoleIds || [])]);
  if (roleIds.length) { const roleResult = await validateRoleSelection(guild, roleIds, { scope: 'ticket_roles', requireManageable: false }); if (!roleResult.ok) failures.push(...roleResult.failures); }
  if (failures.length && testDevOverride.shouldBypassGuard()) return bypassResult('ticket_deployment', guild, null, null, { categoryIds, roleIds, originalFailures: failures });
  return buildGuardResult({ scope: 'ticket_deployment', guild, ok: failures.length === 0, failures, metadata: { categoryIds, roleIds } });
}
function isAutoFixableResult(result = {}) { if (!result || result.ok) return false; const failures = result.failures || []; if (!failures.length) return false; return failures.every((failure) => failure.reason === 'missing_channel_permission' || failure.reason === 'missing_category_permission'); }
function buildAutoFixConfirmation(result = {}, context = {}) { const confirmation = buildGuardResult({ scope: result.scope, guild: { id: result.guildId }, channel: result.channel, channelId: result.channelId, ok: false, failures: result.failures, metadata: { ...(result.metadata || {}), autoFixAvailable: true, confirmationRequired: true, targetId: context.targetId || result.channelId, targetType: context.targetType || 'channel', requiredPermissions: normalisePermissions(context.requiredPermissions).map(permissionLabel), actionId: context.scope || result.scope || 'global_permission_guard' } }); confirmation.autoFixAvailable = true; confirmation.confirmationRequired = true; confirmation.message = buildAutoFixMessage(confirmation); return confirmation; }
function buildAutoFixMessage(result = {}) { const target = result.channel ? formatChannel(result.channel) : 'the selected Discord target'; const missing = unique((result.failures || []).map((failure) => failure.permissionName || failure.message).filter(Boolean)); const lines = ['⚠️ Goliath needs additional permissions.', '', `Target: ${target}`]; if (missing.length) { lines.push('', 'Missing:'); for (const item of missing.slice(0, 10)) lines.push(`• ${item}`); } lines.push('', 'Would you like Goliath to automatically repair this setup?', '[✅ Auto Fix] [❌ Cancel]'); return lines.join('\n'); }
function formatChannel(channel) { if (!channel) return 'the selected channel/category'; if (channel.type === ChannelType.GuildCategory) return `category "${channel.name}"`; return `#${channel.name}`; }
function buildUserMessage(result = {}) { const target = result.channel ? formatChannel(result.channel) : 'the selected Discord target'; const missing = unique((result.failures || []).map((failure) => failure.permissionName || failure.message).filter(Boolean)); const fixes = unique((result.failures || []).map((failure) => failure.fix).filter(Boolean)); const lines = ['❌ Goliath cannot complete this action.', `I do not have the required access for ${target}.`]; if (missing.length) { lines.push('', 'Missing / blocked:'); for (const item of missing.slice(0, 10)) lines.push(`- ${item}`); } lines.push('', 'Fix:'); if (fixes.length) { for (const fix of fixes.slice(0, 5)) lines.push(`- ${fix}`); } else lines.push('- Move the Goliath bot role higher and give Goliath access to the selected channel/category/role.'); return lines.join('\n'); }
function buildGuardResult({ scope, guild, channel, channelId, ok, failures = [], metadata = {} } = {}) {
  const result = { ok: Boolean(ok), scope: scope || 'global', guildId: guild?.id || null, channelId: channel?.id || channelId || null, channelName: channel?.name || null, channel, failures, missingPermissions: unique(failures.map((failure) => failure.permissionName).filter(Boolean)), metadata, autoFixAvailable: Boolean(metadata.autoFixAvailable), confirmationRequired: Boolean(metadata.confirmationRequired) };
  result.message = result.ok ? metadata.testDevOverride ? 'Goliath DEV test override bypassed this guard. Discord API permissions are still enforced.' : 'Goliath has the required access.' : buildUserMessage(result);
  result.toJSON = () => ({ ok: result.ok, scope: result.scope, guildId: result.guildId, channelId: result.channelId, channelName: result.channelName, failures: result.failures, missingPermissions: result.missingPermissions, metadata: result.metadata, autoFixAvailable: result.autoFixAvailable, confirmationRequired: result.confirmationRequired, message: result.message });
  result.toError = () => new GoliathPermissionError(result.message, result.toJSON());
  return result;
}
function isGoliathPermissionError(error) { return error?.code === 'GOLIATH_PERMISSION_GUARD_FAILED' || error instanceof GoliathPermissionError; }

module.exports = { DEFAULT_BOT_CHANNEL_PERMISSIONS, MANAGE_CHANNEL_PERMISSIONS, TICKET_CHANNEL_PERMISSIONS, GoliathPermissionError, isGoliathPermissionError, getBotId, getBotMember, getBotHighestRole, canManageRole, validateRoleSelection, validateChannelAccess, validateCategoryAccess, validateTicketDeployment, guardChannelAccess, guardCategoryAccess, syncBotToChannel, syncBotToCategory, applyPermissionAutoFix, isAutoFixableResult, buildAutoFixConfirmation, buildAutoFixMessage, permissionLabel, permissionsToOverwritePayload, buildGuardResult };
