'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const guildManager = require('../../guild/guildManager');
const antiNuke = require('../../security/protection/antiNuke');
const securitySystem = require('../../security/protection/system');
const automodPanel = require('../automod/panel');
const { getLockdownState } = require('../../security/protection/lockdown');
const { getEmergencyControlState } = require('../../security/protection/emergencyControls');
const { QUARANTINE_MODES, getQuarantineState, getQuarantineMode } = require('../../security/protection/quarantine');

const HUB_ID = 'admin:security-hub';
const REFRESH = {
  threat: 'admin:security-hub:threat',
  antinuke: 'admin:security-hub:antinuke',
  automod: 'admin:security-hub:automod',
  member: 'admin:security-hub:member',
  verification: 'admin:security-hub:verification',
  health: 'admin:security-hub:health',
  recovery: 'admin:security-hub:recovery',
};

function displayName(interaction) { return interaction.member?.displayName || interaction.user?.displayName || interaction.user?.username || 'Unknown User'; }
function bool(value) { return value ? '🟢 Enabled' : '🔴 Disabled'; }
function countModes(guildId) {
  const state = getQuarantineState(guildId);
  const entries = Object.values(state.users || {});
  return {
    investigations: entries.filter((entry) => getQuarantineMode(entry) === QUARANTINE_MODES.INVESTIGATION).length,
    isolation: entries.filter((entry) => getQuarantineMode(entry) === QUARANTINE_MODES.SECURITY).length,
  };
}
function nav(refreshId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(HUB_ID).setLabel('Back').setEmoji('⬅️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(refreshId).setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
  );
}
function managementButton(customId, label, emoji, style = ButtonStyle.Primary) {
  return new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(customId).setLabel(label).setEmoji(emoji).setStyle(style));
}
function managementRow(buttons) {
  return new ActionRowBuilder().addComponents(...buttons.map(({ customId, label, emoji, style = ButtonStyle.Primary, disabled = false }) =>
    new ButtonBuilder().setCustomId(customId).setLabel(label).setEmoji(emoji).setStyle(style).setDisabled(disabled)));
}
function base(interaction, title, description, color = 0x5865F2) {
  return new EmbedBuilder().setColor(color).setTitle(title).setDescription(description)
    .setFooter({ text: `Security Hub • Requested by ${displayName(interaction)}` }).setTimestamp();
}
function formatDuration(ms) {
  const minutes = Math.round(Number(ms || 0) / 60000);
  if (!minutes) return 'Not configured';
  if (minutes % 1440 === 0) return `${minutes / 1440} day(s)`;
  if (minutes % 60 === 0) return `${minutes / 60} hour(s)`;
  return `${minutes} minute(s)`;
}
function discordTime(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? `<t:${Math.floor(number / 1000)}:R>` : 'Not set';
}
function incidentActor(item) { return item?.executorId || item?.userId || item?.actorId || item?.metadata?.executorId || null; }
function incidentLine(item) {
  const severity = String(item?.severity || 'low').toUpperCase();
  const type = String(item?.type || 'unknown').replace(/[_-]+/g, ' ').slice(0, 55);
  const actor = incidentActor(item);
  const action = String(item?.actionTaken || item?.metadata?.actionTaken || '').slice(0, 70);
  return `• **${severity}** — ${type}${actor ? ` • <@${actor}>` : ''}${action ? `\n  ↳ ${action}` : ''}`;
}
function botPermissionHealth(guild) {
  const me = guild?.members?.me;
  const checks = [
    ['Manage Channels', PermissionFlagsBits.ManageChannels],
    ['Manage Roles', PermissionFlagsBits.ManageRoles],
    ['View Audit Log', PermissionFlagsBits.ViewAuditLog],
    ['Moderate Members', PermissionFlagsBits.ModerateMembers],
    ['Kick Members', PermissionFlagsBits.KickMembers],
    ['Ban Members', PermissionFlagsBits.BanMembers],
  ];
  return checks.map(([name, flag]) => `${me?.permissions?.has(flag) ? '🟢' : '🔴'} ${name}`).join('\n');
}
function missingConfiguredResources(guild, verification, pending) {
  const problems = [];
  const verifiedRoleId = verification.roleId || verification.verifiedRoleId;
  const pendingRoleId = pending.roleId || verification.pendingRoleId;
  if (verifiedRoleId && !guild.roles.cache.has(String(verifiedRoleId))) problems.push('Verified role is missing');
  if (pendingRoleId && !guild.roles.cache.has(String(pendingRoleId))) problems.push('Pending role is missing');
  const channelIds = [verification.channelId, verification.verificationChannelId, pending.channelId].filter(Boolean);
  for (const channelId of channelIds) if (!guild.channels.cache.has(String(channelId))) problems.push(`Configured channel ${channelId} is missing`);
  return problems;
}

function buildThreatPanel(interaction) {
  const incidents = securitySystem.readIncidents(interaction.guild.id) || [];
  const packages = guildManager.getSecurityConfig(interaction.guild.id)?.incidentPackages || [];
  const recent = incidents.slice(0, 5);
  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const incident of incidents) {
    const key = String(incident?.severity || 'low').toLowerCase();
    if (Object.hasOwn(severityCounts, key)) severityCounts[key] += 1;
  }
  const highest = severityCounts.critical ? 'Critical' : severityCounts.high ? 'High' : severityCounts.medium ? 'Medium' : severityCounts.low ? 'Low' : 'None';
  const actors = new Set(incidents.map(incidentActor).filter(Boolean));
  const embed = base(interaction, '⚡ Threat Protection', '**Live correlated threat intelligence and incident response status.**', severityCounts.critical ? 0xED4245 : severityCounts.high ? 0xFEE75C : 0x5865F2)
    .addFields(
      { name: 'Incident Store', value: `**${incidents.length}** recorded\n**${packages.length}** evidence package(s)`, inline: true },
      { name: 'Highest Severity', value: `**${highest}**`, inline: true },
      { name: 'Known Actors', value: `**${actors.size}**`, inline: true },
      { name: 'Severity Totals', value: `🔴 Critical **${severityCounts.critical}**\n🟠 High **${severityCounts.high}**\n🟡 Medium **${severityCounts.medium}**\n🔵 Low **${severityCounts.low}**`, inline: true },
      { name: 'Correlation', value: '**60 second window**\nCross-event escalation enabled', inline: true },
      { name: 'Recent Incidents', value: recent.length ? recent.map(incidentLine).join('\n').slice(0, 1024) : 'No security incidents recorded.', inline: false },
      { name: 'Response', value: 'Investigate a suspected actor through Goliath member intelligence, or open Restrictions for guild-wide emergency response.', inline: false },
    );
  return { embeds: [embed], components: [managementRow([
    { customId: 'mod_scan_user', label: 'Investigate Member', emoji: '🔎' },
    { customId: 'admin:server-security', label: 'Restrictions', emoji: '🔒', style: ButtonStyle.Secondary },
  ]), nav(REFRESH.threat)] };
}

function buildAntiNukePanel(interaction) {
  const config = antiNuke.getAntiNukeConfig(interaction.guild.id);
  const channel = config.thresholds?.channelDelete || {};
  const role = config.thresholds?.roleDelete || {};
  const responseEnabled = [config.lockdown?.enabled !== false, config.quarantine?.enabled !== false, config.emergencyControls?.disableInvites !== false, config.emergencyControls?.freezeRoles !== false].filter(Boolean).length;
  const embed = base(interaction, '💥 Anti-Nuke', '**Live destructive-action protection configuration and response readiness.**', config.enabled === false ? 0xED4245 : 0x57F287)
    .addFields(
      { name: 'Protection', value: bool(config.enabled !== false), inline: true },
      { name: 'Response Layers', value: `**${responseEnabled}/4** enabled`, inline: true },
      { name: 'Response Duration', value: `**${formatDuration(config.emergencyControls?.durationMs)}**`, inline: true },
      { name: 'Destructive Thresholds', value: `Channel delete: **${channel.maxActions || 0}** / **${Math.round((channel.windowMs || 0) / 1000)}s**\nRole delete: **${role.maxActions || 0}** / **${Math.round((role.windowMs || 0) / 1000)}s**`, inline: false },
      { name: 'Automatic Response', value: [`Lockdown: ${bool(config.lockdown?.enabled !== false)}`, `Isolation: ${bool(config.quarantine?.enabled !== false)}`, `Invite freeze: ${bool(config.emergencyControls?.enabled !== false && config.emergencyControls?.disableInvites !== false)}`, `Role freeze: ${bool(config.emergencyControls?.enabled !== false && config.emergencyControls?.freezeRoles !== false)}`].join('\n'), inline: true },
      { name: 'Incident Safety', value: [`Owner alerts: ${bool(config.ownerAlerts?.enabled !== false)}`, `Pre-incident backup: ${bool(config.backups?.beforeIncident !== false)}`, `Post-incident backup: ${bool(config.backups?.afterIncident !== false)}`].join('\n'), inline: true },
      { name: 'Trust Configuration', value: `Trusted users: **${(config.trustedUserIds || []).length}**\nTrusted roles: **${(config.trustedRoleIds || []).length}**\nIgnore bots: **${config.ignoreBots ? 'Yes' : 'No'}**`, inline: true },
      { name: 'Response Controls', value: 'Restrictions manages live lockdown/invite/role recovery. Full Isolation remains owner-only. Anti-Nuke continues to use the persisted automatic policy shown above.', inline: false },
    );
  return { embeds: [embed], components: [managementRow([
    { customId: 'admin:server-security', label: 'Restrictions', emoji: '🔒' },
    { customId: 'admin:security-isolation', label: 'Full Isolation', emoji: '🚨', style: ButtonStyle.Danger, disabled: interaction.guild?.ownerId !== interaction.user?.id },
  ]), nav(REFRESH.antinuke)] };
}

function buildAutoModPanel(interaction) {
  const config = automodPanel.getAutomodConfig(interaction.guild.id);
  const rules = automodPanel.AUTOMOD_RULES || {};
  const keys = Object.keys(rules);
  const enabled = keys.filter((key) => config[key]?.enabled).length;
  const actions = [...new Set(keys.filter((key) => config[key]?.enabled).flatMap((key) => Array.isArray(config[key]?.actions) ? config[key].actions : []))];
  const embed = base(interaction, '🤖 AutoMod', '**Live automated message and member protection status.**', config.enabled ? 0x57F287 : 0xED4245)
    .addFields(
      { name: 'System', value: bool(config.enabled), inline: true },
      { name: 'Protection Rules', value: `**${enabled}/${keys.length}** enabled`, inline: true },
      { name: 'Member DMs', value: bool(config.dmUser !== false), inline: true },
      { name: 'Rules', value: keys.map((key) => `${config[key]?.enabled ? '🟢' : '⚫'} **${rules[key].title.replace(/^\S+\s*/, '')}**`).join('\n') || 'No AutoMod rules configured.', inline: false },
      { name: 'Active Enforcement', value: actions.length ? actions.map((action) => `• ${action}`).join('\n') : 'No enforcement actions configured on enabled rules.', inline: true },
      { name: 'Exceptions', value: `Ignored roles: **${(config.ignoredRoles || []).length}**\nIgnored channels: **${(config.ignoredChannels || []).length}**`, inline: true },
      { name: 'Management', value: 'Open the existing AutoMod administration panel to edit rules, actions, thresholds, domains, messages and logging.', inline: false },
    );
  return { embeds: [embed], components: [managementButton('admin:automod', 'Manage AutoMod', '🤖'), nav(REFRESH.automod)] };
}

function buildMemberPanel(interaction) {
  const modes = countModes(interaction.guild.id);
  const state = getQuarantineState(interaction.guild.id);
  const entries = Object.entries(state.users || {}).slice(0, 10);
  const embed = base(interaction, '👤 Member Security', '**Live member containment and investigation state.**')
    .addFields(
      { name: 'Investigations', value: `**${modes.investigations}** active`, inline: true },
      { name: 'Full Security', value: `**${modes.isolation}** active`, inline: true },
      { name: 'Contained Members', value: entries.length ? entries.map(([id, entry]) => `• <@${id}> — **${getQuarantineMode(entry) || 'unknown'}**${entry.caseId ? ` • Case #${entry.caseId}` : ''}${entry.expiresAt ? ` • ${discordTime(entry.expiresAt)}` : ''}`).join('\n').slice(0, 1024) : 'No members are currently contained.', inline: false },
      { name: 'Management', value: 'Investigate members through the existing intelligence workflow. Full Security Isolation remains a separate owner-only emergency action.', inline: false },
    );
  return { embeds: [embed], components: [managementRow([
    { customId: 'mod_scan_user', label: 'Investigate Member', emoji: '🔎' },
    { customId: 'admin:security-isolation', label: 'Full Isolation', emoji: '🚨', style: ButtonStyle.Danger, disabled: interaction.guild?.ownerId !== interaction.user?.id },
  ]), nav(REFRESH.member)] };
}

function buildVerificationPanel(interaction) {
  const verification = guildManager.getGuildSection(interaction.guild.id, 'verification', {}) || {};
  const pending = guildManager.getGuildSection(interaction.guild.id, 'pending', {}) || {};
  const roleId = verification.roleId || verification.verifiedRoleId || null;
  const pendingRoleId = pending.roleId || verification.pendingRoleId || null;
  const problems = missingConfiguredResources(interaction.guild, verification, pending);
  const embed = base(interaction, '🛂 Verification', '**Admission, pending-member and verification security status.**', problems.length ? 0xFEE75C : 0x5865F2)
    .addFields(
      { name: 'Verification', value: bool(verification.enabled !== false), inline: true },
      { name: 'Verified Role', value: roleId ? `<@&${roleId}>` : 'Not configured', inline: true },
      { name: 'Pending Role', value: pendingRoleId ? `<@&${pendingRoleId}>` : 'Not configured', inline: true },
      { name: 'Resource Health', value: problems.length ? problems.map((problem) => `🔴 ${problem}`).join('\n') : '🟢 Configured resources resolve correctly', inline: false },
      { name: 'Management', value: 'Open the existing Verification Studio to manage workflow, assignment timing, roles/channels, requirements, messages, panels, settings and health.', inline: false },
    );
  return { embeds: [embed], components: [managementButton('admin:verification', 'Manage Verification', '🛂'), nav(REFRESH.verification)] };
}

function buildHealthPanel(interaction) {
  const lockdown = getLockdownState(interaction.guild.id);
  const emergency = getEmergencyControlState(interaction.guild.id);
  const modes = countModes(interaction.guild.id);
  const antiNukeConfig = antiNuke.getAntiNukeConfig(interaction.guild.id);
  const automod = automodPanel.getAutomodConfig(interaction.guild.id);
  const verification = guildManager.getGuildSection(interaction.guild.id, 'verification', {}) || {};
  const pending = guildManager.getGuildSection(interaction.guild.id, 'pending', {}) || {};
  const incidents = securitySystem.readIncidents(interaction.guild.id) || [];
  const failures = (lockdown.failedChannels || []).length;
  const resourceProblems = missingConfiguredResources(interaction.guild, verification, pending);
  const me = interaction.guild.members?.me;
  const criticalPermissions = [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ViewAuditLog];
  const permissionProblems = criticalPermissions.filter((flag) => !me?.permissions?.has(flag)).length;
  const degraded = antiNukeConfig.enabled === false || automod.enabled === false || failures > 0 || resourceProblems.length > 0 || permissionProblems > 0;
  const embed = base(interaction, '🩺 Security Health', '**Live security runtime, permission and configuration diagnostics.**', degraded ? 0xFEE75C : 0x57F287)
    .addFields(
      { name: 'Overall', value: degraded ? '🟠 Attention required' : '🟢 Operational', inline: true },
      { name: 'Recorded Incidents', value: `**${incidents.length}**`, inline: true },
      { name: 'Restore Failures', value: `**${failures}**`, inline: true },
      { name: 'Protection Engines', value: `Anti-Nuke: ${bool(antiNukeConfig.enabled !== false)}\nAutoMod: ${bool(automod.enabled !== false)}\nVerification: ${bool(verification.enabled !== false)}`, inline: true },
      { name: 'Bot Permission Health', value: botPermissionHealth(interaction.guild), inline: true },
      { name: 'Configured Resources', value: resourceProblems.length ? resourceProblems.map((problem) => `🔴 ${problem}`).join('\n').slice(0, 1024) : '🟢 No missing verification resources detected', inline: true },
      { name: 'Active Restrictions', value: `Lockdown: **${lockdown.active ? 'Active' : 'Standby'}**\nInvites: **${emergency.invites.active ? 'Frozen' : 'Normal'}**\nRoles: **${emergency.roles.active ? 'Frozen' : 'Normal'}**`, inline: true },
      { name: 'Containment', value: `Investigations: **${modes.investigations}**\nFull isolation: **${modes.isolation}**`, inline: true },
    );
  return { embeds: [embed], components: [managementRow([
    { customId: 'admin:server-security', label: 'Restrictions', emoji: '🔒' },
    { customId: 'admin:automod', label: 'AutoMod', emoji: '🤖', style: ButtonStyle.Secondary },
    { customId: 'admin:verification', label: 'Verification', emoji: '🛂', style: ButtonStyle.Secondary },
  ]), nav(REFRESH.health)] };
}

function buildRecoveryPanel(interaction) {
  const lockdown = getLockdownState(interaction.guild.id);
  const emergency = getEmergencyControlState(interaction.guild.id);
  const modes = countModes(interaction.guild.id);
  const active = [lockdown.active, emergency.invites.active, emergency.roles.active].filter(Boolean).length;
  const failures = lockdown.failedChannels || [];
  const failedPreview = failures.slice(0, 5).map((entry) => `• <#${entry.channelId || entry.id || 'unknown'}> — ${String(entry.error || entry.reason || 'restore failed').slice(0, 100)}`).join('\n');
  const embed = base(interaction, '🧰 Recovery Controls', '**Recovery readiness, snapshots and failed restoration state.**', active || failures.length ? 0xFEE75C : 0x57F287)
    .addFields(
      { name: 'Active Restrictions', value: `**${active}**`, inline: true },
      { name: 'Restore Failures', value: `**${failures.length}**`, inline: true },
      { name: 'Contained Members', value: `Investigations: **${modes.investigations}**\nFull isolation: **${modes.isolation}**`, inline: true },
      { name: 'Lockdown Snapshot', value: lockdown.active ? `**${(lockdown.channels || []).length}** channel(s) tracked\nExpires: ${discordTime(lockdown.lockdownExpiresAt)}` : 'No active lockdown', inline: true },
      { name: 'Emergency Snapshots', value: `Invites: **${(emergency.invites.channelSnapshots || []).length}**\nRoles: **${(emergency.roles.roleSnapshots || []).length}**`, inline: true },
      { name: 'Failed Restore Preview', value: failedPreview || '🟢 No failed channel restores', inline: false },
      { name: 'Recovery Actions', value: 'Restriction Recovery can end lockdown, restore invites, restore roles, or run confirmed Restore All. Member Recovery remains owner-only and preserves containment separation.', inline: false },
    );
  return { embeds: [embed], components: [managementRow([
    { customId: 'admin:server-security', label: 'Restriction Recovery', emoji: '🧰' },
    { customId: 'admin:security-isolation', label: 'Member Recovery', emoji: '👤', style: ButtonStyle.Secondary, disabled: interaction.guild?.ownerId !== interaction.user?.id },
  ]), nav(REFRESH.recovery)] };
}

module.exports = {
  buildThreatPanel,
  buildAntiNukePanel,
  buildAutoModPanel,
  buildMemberPanel,
  buildVerificationPanel,
  buildHealthPanel,
  buildRecoveryPanel,
};