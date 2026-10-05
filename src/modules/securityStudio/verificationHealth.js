'use strict';

const { PermissionFlagsBits } = require('discord.js');
const guildManager = require('../../core/guild/guildManager');
const verificationManager = require('./verificationManager');
const verificationStore = require('./verificationStore');

const MODULE = 'verification';

function requireGuild(guild) {
  if (!guild?.id) throw new Error('Guild is unavailable.');
  return guild;
}
function add(warnings, value) { if (value && !warnings.includes(value)) warnings.push(value); }
function ids(value) { return [...new Set((Array.isArray(value) ? value : []).filter(Boolean))]; }
function roleGroups(settings) {
  const roles = settings.roles || {};
  return {
    Pending: ids(roles.pending || settings.pendingRoleIds),
    Verifying: ids(roles.verifying),
    Verified: ids(roles.verified || settings.verifiedRoleIds),
    'Auto Role': ids(roles.auto),
    'Bot Auto Role': ids(roles.bot),
    Bypass: ids(roles.bypass),
    Quarantine: ids(roles.quarantine),
    Staff: ids(roles.staff),
  };
}
function validateRoles(guild, settings, warnings) {
  const groups = roleGroups(settings);
  const used = new Map();
  const bot = guild.members.me;
  for (const [label, roleIds] of Object.entries(groups)) {
    for (const roleId of roleIds) {
      const role = guild.roles.cache.get(roleId);
      if (!role) { add(warnings, `${label} role ${roleId} no longer exists.`); continue; }
      if (role.managed) add(warnings, `${label} role ${role.name} is integration-managed and cannot be assigned by Goliath.`);
      if (bot && bot.roles.highest.position <= role.position) add(warnings, `Goliath's role must be above ${role.name} to manage the configured ${label} role.`);
      const prior = used.get(roleId);
      if (prior && prior !== label) add(warnings, `${role.name} is configured as both ${prior} and ${label}. Security lifecycle roles should be distinct.`);
      else used.set(roleId, label);
    }
  }
  if (!groups.Verified.length) add(warnings, 'No Verified role is configured. Successful verification cannot grant server access through Verification.');
  if (settings.quarantine?.enabled && !groups.Quarantine.length) add(warnings, 'Quarantine is enabled but no Quarantine role is configured.');
  return groups;
}
function validateSecurity(guild, settings, warnings) {
  const security = settings.security || {};
  const flow = settings.flow || {};
  const enabled = [];
  if (security.simple) enabled.push('simple');
  if (security.captcha) enabled.push('captcha');
  if (security.minigame) enabled.push('minigame');
  if (security.accountAge) enabled.push('account_age');
  if (security.discordScreening) enabled.push('discord_screening');
  if (security.botProtection) enabled.push('bot_protection');
  if (security.staffApproval) enabled.push('staff_approval');
  if (security.oneTimeChallenge) enabled.push('one_time_challenge');
  if (security.riskBased) enabled.push('risk_based');
  if (security.rejoinHistory) enabled.push('rejoin_history');
  if (!enabled.length) add(warnings, 'No Verification security method is enabled.');
  if (security.discordScreening && !verificationManager.hasDiscordScreening(guild)) add(warnings, 'Discord Membership Screening is enabled in Verification but is not enabled for this guild.');
  const order = Array.isArray(flow.orderedSecurity) ? flow.orderedSecurity : [];
  for (const method of order) if (!enabled.includes(method)) add(warnings, `Flow contains ${method}, but that security method is disabled.`);
  if (security.riskBased && !settings.intelligence?.enabled) add(warnings, 'Risk-Based Security is enabled while Intelligence is disabled.');
  if (security.maximumFailedAttempts > 0 && settings.quarantine?.enabled && Number(settings.quarantine.attemptThreshold || 0) <= 0) add(warnings, 'Quarantine is enabled but its failure threshold is not configured.');
  return enabled;
}
function validateChannels(guild, settings, warnings) {
  const configured = { Verification: settings.verificationChannelId, JoinLog: settings.logs?.joinChannelId, IntelligenceLog: settings.logs?.intelligenceChannelId, AttemptLog: settings.logs?.attemptChannelId, FailureLog: settings.logs?.failureChannelId, SuccessLog: settings.logs?.successChannelId, RoleLog: settings.logs?.rolesChannelId, BotLog: settings.logs?.botChannelId, RaidLog: settings.logs?.raidChannelId, QuarantineLog: settings.logs?.quarantineChannelId, StaffLog: settings.logs?.staffChannelId, ErrorLog: settings.logs?.errorChannelId };
  for (const [label, channelId] of Object.entries(configured)) if (channelId && !guild.channels.cache.has(channelId)) add(warnings, `${label} channel ${channelId} no longer exists.`);
  if (settings.quarantine?.categoryId && !guild.channels.cache.has(settings.quarantine.categoryId)) add(warnings, `Quarantine category ${settings.quarantine.categoryId} no longer exists.`);
}
function validateBotPermissions(guild, warnings) {
  const bot = guild.members.me;
  if (!bot) { add(warnings, 'Goliath member could not be resolved in this guild.'); return; }
  if (!bot.permissions.has(PermissionFlagsBits.ManageRoles)) add(warnings, 'Goliath requires Manage Roles for Verification role transitions.');
  if (!bot.permissions.has(PermissionFlagsBits.ViewChannel)) add(warnings, 'Goliath requires View Channels for Verification health and logging.');
  if (!bot.permissions.has(PermissionFlagsBits.SendMessages)) add(warnings, 'Goliath requires Send Messages for Verification panels and logs.');
}

async function buildHealthReport(guild) {
  const target = requireGuild(guild);
  const base = await verificationManager.buildHealthReport(target);
  const section = verificationStore.getVerificationSection(target.id);
  const settings = section.settings || {};
  const warnings = Array.isArray(base.warnings) ? [...base.warnings] : [];
  validateBotPermissions(target, warnings);
  const roles = validateRoles(target, settings, warnings);
  const securityMethods = validateSecurity(target, settings, warnings);
  validateChannels(target, settings, warnings);
  return { ...base, warnings, enabled: guildManager.isModuleEnabled(target.id, MODULE), roles, securityMethods, failClosed: settings.flow?.failClosed !== false };
}

async function repairMissingPanelMessages(guild, report, meta = {}) {
  const missing = (report?.panels || []).filter(panel => panel?.ok === false && panel?.status === 'Missing message' && panel?.panelId);
  if (!missing.length) return { repaired: 0, failed: [] };
  let repaired = 0; const failed = [];
  for (const health of missing) {
    const panel = verificationStore.getPanel(guild.id, health.panelId);
    if (!panel?.channelId) { failed.push({ panelId: health.panelId, reason: 'Missing panel channel.' }); continue; }
    try { await verificationManager.restoreMissingVerificationPanel(guild, health.panelId, { action: 'verification_health_restore_missing_message', actorId: 'system:verification-health', ...meta }); repaired += 1; }
    catch (error) { failed.push({ panelId: health.panelId, reason: error?.message || 'Panel restore failed.' }); }
  }
  return { repaired, failed };
}
async function repair(guild, meta = {}) {
  const target = requireGuild(guild);
  const before = await buildHealthReport(target);
  const recovery = await repairMissingPanelMessages(target, before, meta);
  const after = recovery.repaired ? await buildHealthReport(target) : before;
  return { ...after, repair: recovery };
}
module.exports = { buildHealthReport, repair, repairMissingPanelMessages };
