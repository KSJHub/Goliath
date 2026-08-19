'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');

const guildManager = require('../../core/guild/guildManager');
const autoroles = require('./autoRoles/autoRoles');
const timedRoles = require('./timedRoles/timedRoles');
const timedRolesHealth = require('./timedRoles/timedRolesHealth');
const reactionRoles = require('./reactionRoles/reactionRoles');
const temporaryRoles = require('./temporaryRoles/temporaryRoles');
const temporaryRolesHealth = require('./temporaryRoles/temporaryRolesHealth');
const roleSelector = require('./roleSelector/roleSelector');
const roleSelectorHealth = require('./roleSelector/roleSelectorHealth');

const row = (...components) => new ActionRowBuilder().addComponents(...components.filter(Boolean));
const button = (customId, label, style = ButtonStyle.Primary, disabled = false) => new ButtonBuilder()
  .setCustomId(customId)
  .setLabel(label)
  .setStyle(style)
  .setDisabled(Boolean(disabled));

const statusLabel = (enabled) => enabled ? 'Enabled' : 'Disabled';
const statusIcon = (enabled) => enabled ? '🟢' : '⏸️';
const healthLabel = (healthy, detail = '') => healthy ? '✅ Healthy' : `⚠️ Needs attention${detail ? ` — ${detail}` : ''}`;

async function getRoleStudioState(guild) {
  const auto = autoroles.getAutoRolesSection(guild.id);
  const reaction = reactionRoles.getSection(guild.id);
  const timed = timedRoles.getSection(guild.id);
  const temporary = temporaryRoles.getSection(guild.id);
  const selector = roleSelector.getSection(guild.id);

  const [autoHealth, reactionHealth, timedHealth, temporaryHealth, selectorHealth] = await Promise.all([
    autoroles.buildHealthReport(guild),
    reactionRoles.buildHealth(guild),
    timedRolesHealth.buildTimedRolesHealth(guild),
    temporaryRolesHealth.buildHealth(guild),
    roleSelectorHealth.buildHealth(guild),
  ]);

  const reactionDeployments = reactionRoles.listPanels(guild.id);
  const timedRules = timedRoles.listRules(guild.id);
  const tempAssignments = temporaryRoles.listAssignments(guild.id, { activeOnly: true });

  return {
    auto,
    reaction,
    timed,
    temporary,
    selector,
    autoHealth,
    reactionHealth,
    timedHealth,
    temporaryHealth,
    selectorHealth,
    reactionDeployments,
    timedRules,
    tempAssignments,
    autoRoleCount: (auto.joinRoles || []).length + (auto.botRoles || []).length,
    autoEnabled: guildManager.isModuleEnabled(guild.id, 'autoRoles'),
    reactionEnabled: guildManager.isModuleEnabled(guild.id, reactionRoles.SECTION),
    timedEnabled: guildManager.isModuleEnabled(guild.id, 'timedRoles'),
    temporaryEnabled: guildManager.isModuleEnabled(guild.id, 'temporaryRoles'),
    selectorEnabled: guildManager.isModuleEnabled(guild.id, roleSelector.MODULE),
    canManageRoles: Boolean(guild.members.me?.permissions.has('ManageRoles')),
  };
}

function moduleHealthLabel({ enabled, configured, healthy, detail = '' }) {
  if (!enabled) return '⏸️ Not active while disabled';
  if (!configured) return 'ℹ️ Ready — nothing configured yet';
  return healthLabel(healthy, detail);
}

async function buildRoleStudioPanel(guild, memberDisplayName = 'Unknown User') {
  const state = await getRoleStudioState(guild);
  const autoConfigured = state.autoRoleCount > 0;
  const reactionConfigured = state.reactionDeployments.length > 0;
  const timedConfigured = state.timedRules.length > 0;
  const temporaryConfigured = state.tempAssignments.length > 0;
  const selectorConfigured = Boolean(state.selector.deployment?.messageId || state.selectorHealth.managedRoleCount || roleSelector.listGroups(guild.id).length > 1);

  const activeSystemsHealthy = [
    !state.autoEnabled || !autoConfigured || state.autoHealth.healthy,
    !state.reactionEnabled || !reactionConfigured || state.reactionHealth.healthy,
    !state.timedEnabled || !timedConfigured || state.timedHealth.healthy,
    !state.temporaryEnabled || !temporaryConfigured || state.temporaryHealth.healthy,
    !state.selectorEnabled || !selectorConfigured || state.selectorHealth.healthy,
  ].every(Boolean);
  const overallHealthy = state.canManageRoles && activeSystemsHealthy;

  const embed = new EmbedBuilder()
    .setColor(!state.canManageRoles ? 0xED4245 : overallHealthy ? 0x57F287 : 0xFAA61A)
    .setTitle('🎭 Role Studio')
    .setDescription([
      'Choose a role system to configure. Current status, health and recent activity are shown below.',
      '',
      `**👥 Auto Roles** — ${statusIcon(state.autoEnabled)} ${statusLabel(state.autoEnabled)}`,
      `Configured: \`${state.autoRoleCount}\` • Assigned: \`${state.auto.analytics?.assigned || 0}\``,
      `Health: ${moduleHealthLabel({ enabled: state.autoEnabled, configured: autoConfigured, healthy: state.autoHealth.healthy })}`,
      '',
      `**😊 Reaction Roles** — ${statusIcon(state.reactionEnabled)} ${statusLabel(state.reactionEnabled)}`,
      `Panels: \`${state.reactionDeployments.length}\` • Added: \`${state.reaction.analytics?.assigned || 0}\` • Removed: \`${state.reaction.analytics?.removed || 0}\``,
      `Health: ${moduleHealthLabel({ enabled: state.reactionEnabled, configured: reactionConfigured, healthy: state.reactionHealth.healthy, detail: `${state.reactionHealth.unhealthy || 0} panel(s)` })}`,
      '',
      `**⏳ Timed Roles** — ${statusIcon(state.timedEnabled)} ${statusLabel(state.timedEnabled)}`,
      `Milestones: \`${state.timedRules.length}\` • Awarded: \`${state.timed.analytics?.awarded || 0}\``,
      `Health: ${moduleHealthLabel({ enabled: state.timedEnabled, configured: timedConfigured, healthy: state.timedHealth.healthy, detail: `${state.timedHealth.issues?.length || 0} issue(s)` })}`,
      '',
      `**⚡ Temporary Roles** — ${statusIcon(state.temporaryEnabled)} ${statusLabel(state.temporaryEnabled)}`,
      `Active: \`${state.tempAssignments.length}\` • Assigned: \`${state.temporary.analytics?.assigned || 0}\` • Expired: \`${state.temporary.analytics?.expired || 0}\``,
      `Health: ${moduleHealthLabel({ enabled: state.temporaryEnabled, configured: temporaryConfigured, healthy: state.temporaryHealth.healthy, detail: `${state.temporaryHealth.issues?.length || 0} issue(s) • ${state.temporaryHealth.warnings?.length || 0} warning(s)` })}`,
      '',
      `**🎭 Role Selector** — ${statusIcon(state.selectorEnabled)} ${statusLabel(state.selectorEnabled)}`,
      `Groups: \`${roleSelector.listGroups(guild.id).length}\` • Using selectors: \`${state.selectorHealth.totalUsing || 0}\` • Managed roles: \`${state.selectorHealth.managedRoleCount || 0}\``,
      `Health: ${moduleHealthLabel({ enabled: state.selectorEnabled, configured: selectorConfigured, healthy: state.selectorHealth.healthy, detail: `${state.selectorHealth.issues?.length || 0} issue(s)` })}`,
      '',
      state.canManageRoles
        ? `> Overall: ${activeSystemsHealthy ? '✅ All active role systems are healthy.' : '⚠️ One or more active role systems need attention.'}`
        : '❌ **Goliath is missing Manage Roles.** Enable this permission on the Goliath role, then press **Refresh Status**.',
    ].join('\n'))
    .setFooter({ text: `Requested by ${memberDisplayName}` })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      row(
        button('admin:autoRoles', '👥 Auto Roles', ButtonStyle.Primary),
        button('admin:reactionRoles:open', '😊 Reaction Roles', ButtonStyle.Primary),
        button('admin:temporaryRoles', '⚡ Temporary Roles', ButtonStyle.Primary),
      ),
      row(
        button('admin:timedRoles', '⏳ Timed Roles', ButtonStyle.Primary),
        button('admin:roleSelector', '🎭 Role Selector', ButtonStyle.Primary),
      ),
      row(
        button('admin:studio:roleStudio', '🔄 Refresh Status', ButtonStyle.Secondary),
        button('admin:modules', '⬅️ Back to Modules', ButtonStyle.Secondary),
      ),
    ],
  };
}

async function buildRoleAnalyticsPanel(guild, memberDisplayName = 'Unknown User') {
  const state = await getRoleStudioState(guild);
  return {
    embeds: [new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('📊 Role Studio Activity')
      .setDescription([
        `**Auto Roles assigned:** \`${state.auto.analytics?.assigned || 0}\``,
        `**Reaction Roles added:** \`${state.reaction.analytics?.assigned || 0}\``,
        `**Reaction Roles removed:** \`${state.reaction.analytics?.removed || 0}\``,
        `**Timed Roles awarded:** \`${state.timed.analytics?.awarded || 0}\``,
        `**Temporary Roles assigned:** \`${state.temporary.analytics?.assigned || 0}\``,
        `**Temporary Roles expired:** \`${state.temporary.analytics?.expired || 0}\``,
        `**Temporary Roles removed early:** \`${state.temporary.analytics?.removed || 0}\``,
        `**Role Selector selections:** \`${state.selector.analytics?.selections || 0}\``,
        `**Role Selector switches:** \`${state.selector.analytics?.switches || 0}\``,
        `**Role Selector removals:** \`${state.selector.analytics?.removals || 0}\``,
      ].join('\n'))
      .setFooter({ text: `Requested by ${memberDisplayName}` })
      .setTimestamp()],
    components: [row(button('admin:studio:roleStudio', '⬅️ Back to Role Studio', ButtonStyle.Secondary))],
  };
}

async function buildRoleHealthPanel(guild, memberDisplayName = 'Unknown User') {
  const state = await getRoleStudioState(guild);
  const healthy = state.canManageRoles
    && state.autoHealth.healthy
    && state.reactionHealth.healthy
    && state.timedHealth.healthy
    && state.temporaryHealth.healthy
    && state.selectorHealth.healthy;

  return {
    embeds: [new EmbedBuilder()
      .setColor(healthy ? 0x57F287 : 0xFAA61A)
      .setTitle('🩺 Role Studio Health')
      .setDescription([
        `**Overall status:** ${healthy ? '✅ Healthy' : '⚠️ Needs attention'}`,
        '',
        `**Auto Roles:** ${healthLabel(state.autoHealth.healthy)}`,
        `**Reaction Roles:** ${healthLabel(state.reactionHealth.healthy, state.reactionHealth.healthy ? '' : `${state.reactionHealth.unhealthy || 0} panel(s)`)}`,
        `**Timed Roles:** ${healthLabel(state.timedHealth.healthy, state.timedHealth.healthy ? '' : `${state.timedHealth.issues?.length || 0} issue(s)`)}`,
        `**Temporary Roles:** ${healthLabel(state.temporaryHealth.healthy, state.temporaryHealth.healthy ? '' : `${state.temporaryHealth.issues?.length || 0} issue(s)`)}`,
        `**Role Selector:** ${healthLabel(state.selectorHealth.healthy, state.selectorHealth.healthy ? '' : `${state.selectorHealth.issues?.length || 0} issue(s)`)}`,
        '',
        `**Goliath highest role:** ${guild.members.me?.roles.highest ? `<@&${guild.members.me.roles.highest.id}>` : 'Unavailable'}`,
        `**Manage Roles permission:** ${state.canManageRoles ? '✅ Granted' : '❌ Missing'}`,
      ].join('\n'))
      .setFooter({ text: `Requested by ${memberDisplayName}` })
      .setTimestamp()],
    components: [row(button('admin:studio:roleStudio', '⬅️ Back to Role Studio', ButtonStyle.Secondary))],
  };
}

module.exports = {
  buildRoleStudioPanel,
  buildRoleAnalyticsPanel,
  buildRoleHealthPanel,
};
