'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
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

function displayName(interaction) {
  return interaction.member?.displayName || interaction.user?.displayName || interaction.user?.username || 'Unknown User';
}
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
function managementButton(customId, label, emoji) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(customId).setLabel(label).setEmoji(emoji).setStyle(ButtonStyle.Primary),
  );
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

function buildThreatPanel(interaction) {
  const incidents = securitySystem.readIncidents(interaction.guild.id) || [];
  const packages = guildManager.getSecurityConfig(interaction.guild.id)?.incidentPackages || [];
  const recent = incidents.slice(0, 5);
  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const incident of incidents) {
    const key = String(incident?.severity || 'low').toLowerCase();
    if (Object.hasOwn(severityCounts, key)) severityCounts[key] += 1;
  }
  const embed = base(interaction, '⚡ Threat Protection', '**Live correlated threat intelligence and incident response status.**')
    .addFields(
      { name: 'Incident Store', value: `**${incidents.length}** recorded\n**${packages.length}** evidence package(s)`, inline: true },
      { name: 'Severity Totals', value: `🔴 Critical **${severityCounts.critical}**\n🟠 High **${severityCounts.high}**\n🟡 Medium **${severityCounts.medium}**\n🔵 Low **${severityCounts.low}**`, inline: true },
      { name: 'Correlation Window', value: '**60 seconds**\nCross-event escalation enabled', inline: true },
      { name: 'Recent Incidents', value: recent.length ? recent.map((item) => `• **${String(item.severity || 'low').toUpperCase()}** — ${String(item.type || 'unknown').slice(0, 60)}`).join('\n') : 'No security incidents recorded.', inline: false },
    );
  return { embeds: [embed], components: [nav(REFRESH.threat)] };
}

function buildAntiNukePanel(interaction) {
  const config = antiNuke.getAntiNukeConfig(interaction.guild.id);
  const channel = config.thresholds?.channelDelete || {};
  const role = config.thresholds?.roleDelete || {};
  const embed = base(interaction, '💥 Anti-Nuke', '**Live destructive-action protection configuration.**', config.enabled === false ? 0xED4245 : 0x57F287)
    .addFields(
      { name: 'Protection', value: bool(config.enabled !== false), inline: true },
      { name: 'Channel Delete', value: `**${channel.maxActions || 0}** action(s) / **${Math.round((channel.windowMs || 0) / 1000)}s**`, inline: true },
      { name: 'Role Delete', value: `**${role.maxActions || 0}** action(s) / **${Math.round((role.windowMs || 0) / 1000)}s**`, inline: true },
      { name: 'Automatic Response', value: [`Lockdown: ${bool(config.lockdown?.enabled !== false)}`, `Isolation: ${bool(config.quarantine?.enabled !== false)}`, `Invite freeze: ${bool(config.emergencyControls?.enabled !== false && config.emergencyControls?.disableInvites !== false)}`, `Role freeze: ${bool(config.emergencyControls?.enabled !== false && config.emergencyControls?.freezeRoles !== false)}`].join('\n'), inline: false },
      { name: 'Incident Safety', value: [`Owner alerts: ${bool(config.ownerAlerts?.enabled !== false)}`, `Pre-incident backup: ${bool(config.backups?.beforeIncident !== false)}`, `Post-incident backup: ${bool(config.backups?.afterIncident !== false)}`, `Response duration: **${formatDuration(config.emergencyControls?.durationMs)}**`].join('\n'), inline: false },
      { name: 'Trust Configuration', value: `Trusted users: **${(config.trustedUserIds || []).length}**\nTrusted roles: **${(config.trustedRoleIds || []).length}**\nIgnore bots: **${config.ignoreBots ? 'Yes' : 'No'}**`, inline: true },
    );
  return { embeds: [embed], components: [nav(REFRESH.antinuke)] };
}

function buildAutoModPanel(interaction) {
  const config = automodPanel.getAutomodConfig(interaction.guild.id);
  const rules = automodPanel.AUTOMOD_RULES || {};
  const keys = Object.keys(rules);
  const enabled = keys.filter((key) => config[key]?.enabled).length;
  const actions = [...new Set(keys.flatMap((key) => Array.isArray(config[key]?.actions) ? config[key].actions : []))];
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
      { name: 'Contained Members', value: entries.length ? entries.map(([id, entry]) => `• <@${id}> — **${getQuarantineMode(entry) || 'unknown'}**${entry.caseId ? ` • Case #${entry.caseId}` : ''}`).join('\n') : 'No members are currently contained.', inline: false },
      { name: 'Management', value: 'Open Goliath’s existing Moderation controls to investigate members, review intelligence, manage investigation containment and work linked cases. Full Security Isolation remains owner-only in this Security Hub.', inline: false },
    );
  return { embeds: [embed], components: [managementButton('mod_dashboard:none:actions', 'Manage Investigations', '🔎'), nav(REFRESH.member)] };
}

function buildVerificationPanel(interaction) {
  const verification = guildManager.getGuildSection(interaction.guild.id, 'verification', {}) || {};
  const pending = guildManager.getGuildSection(interaction.guild.id, 'pending', {}) || {};
  const roleId = verification.roleId || verification.verifiedRoleId || null;
  const pendingRoleId = pending.roleId || verification.pendingRoleId || null;
  const embed = base(interaction, '🛂 Verification', '**Admission, pending-member and verification security status.**')
    .addFields(
      { name: 'Verification', value: bool(verification.enabled !== false), inline: true },
      { name: 'Verified Role', value: roleId ? `<@&${roleId}>` : 'Not configured', inline: true },
      { name: 'Pending Role', value: pendingRoleId ? `<@&${pendingRoleId}>` : 'Not configured', inline: true },
      { name: 'Management', value: 'Open the existing Verification Studio to manage workflow, assignment timing, roles and channels, requirements, messages, panels, settings and health.', inline: false },
    );
  return { embeds: [embed], components: [managementButton('admin:verification', 'Manage Verification', '🛂'), nav(REFRESH.verification)] };
}

function buildHealthPanel(interaction) {
  const lockdown = getLockdownState(interaction.guild.id);
  const emergency = getEmergencyControlState(interaction.guild.id);
  const modes = countModes(interaction.guild.id);
  const antiNukeConfig = antiNuke.getAntiNukeConfig(interaction.guild.id);
  const incidents = securitySystem.readIncidents(interaction.guild.id) || [];
  const degraded = !antiNukeConfig.enabled || lockdown.failedChannels?.length;
  const embed = base(interaction, '🩺 Security Health', '**Live security runtime health and protection state.**', degraded ? 0xFEE75C : 0x57F287)
    .addFields(
      { name: 'Overall', value: degraded ? '🟠 Attention required' : '🟢 Operational', inline: true },
      { name: 'Anti-Nuke', value: bool(antiNukeConfig.enabled !== false), inline: true },
      { name: 'Recorded Incidents', value: `**${incidents.length}**`, inline: true },
      { name: 'Active Restrictions', value: `Lockdown: **${lockdown.active ? 'Active' : 'Standby'}**\nInvites: **${emergency.invites.active ? 'Frozen' : 'Normal'}**\nRoles: **${emergency.roles.active ? 'Frozen' : 'Normal'}**`, inline: true },
      { name: 'Containment', value: `Investigations: **${modes.investigations}**\nFull isolation: **${modes.isolation}**`, inline: true },
      { name: 'Restore Health', value: `Lockdown restore failures: **${(lockdown.failedChannels || []).length}**`, inline: true },
    );
  return { embeds: [embed], components: [nav(REFRESH.health)] };
}

function buildRecoveryPanel(interaction) {
  const lockdown = getLockdownState(interaction.guild.id);
  const emergency = getEmergencyControlState(interaction.guild.id);
  const active = [lockdown.active, emergency.invites.active, emergency.roles.active].filter(Boolean).length;
  const embed = base(interaction, '🧰 Recovery Controls', '**Recovery readiness and saved emergency restriction state.**', active ? 0xFEE75C : 0x57F287)
    .addFields(
      { name: 'Active Restrictions', value: `**${active}**`, inline: true },
      { name: 'Lockdown Snapshot', value: lockdown.active ? `**${(lockdown.channels || []).length}** channel(s) tracked` : 'No active lockdown', inline: true },
      { name: 'Emergency Snapshots', value: `Invites: **${(emergency.invites.channelSnapshots || []).length}**\nRoles: **${(emergency.roles.roleSnapshots || []).length}**`, inline: true },
      { name: 'Recovery Actions', value: 'Use **Lockdown & Restrictions** from the Security Hub to end lockdown, restore invites, restore roles, or run the confirmed Restore All flow.', inline: false },
    );
  return { embeds: [embed], components: [nav(REFRESH.recovery)] };
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
