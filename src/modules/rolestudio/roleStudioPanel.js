'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');

const autoroles = require('../autoroles/autoroles');
const timedRoles = require('../timedroles/timedRoles');
const reactionRoles = require('../reactionroles/reactionRoles');
const temporaryRoles = require('./temporaryRoles');

const row = (...components) => new ActionRowBuilder().addComponents(...components.filter(Boolean));
const button = (customId, label, style = ButtonStyle.Primary) => new ButtonBuilder()
  .setCustomId(customId).setLabel(label).setStyle(style);

async function buildRoleStudioPanel(guild, memberDisplayName = 'Unknown User') {
  const auto = autoroles.getAutoRolesSection(guild.id);
  const reaction = reactionRoles.getSection(guild.id);
  const timed = timedRoles.getSection(guild.id);
  const temporary = temporaryRoles.getSection(guild.id);

  const reactionDeployments = reactionRoles.listPanels(guild.id);
  const timedRules = timedRoles.listRules(guild.id);
  const tempAssignments = temporaryRoles.listAssignments(guild.id, { activeOnly: true });
  const autoRoleCount = (auto.joinRoles || []).length + (auto.botRoles || []).length;

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🛡️ Role Studio')
    .setDescription([
      'Manage every automated role system in one place.',
      '',
      `### 👥 Auto Roles ${auto.enabled !== false ? '🟢' : '⏸️'}`,
      `Assign roles automatically when members or bots join. **${autoRoleCount} configured role${autoRoleCount === 1 ? '' : 's'}.**`,
      '',
      `### 😊 Reaction Roles ${reaction.enabled !== false ? '🟢' : '⏸️'}`,
      `Attach emoji role mappings to messages. **${reactionDeployments.length} deployment${reactionDeployments.length === 1 ? '' : 's'}.**`,
      '',
      `### ⏳ Timed Roles ${timed.enabled !== false ? '🟢' : '⏸️'}`,
      `Reward members for server tenure. **${timedRules.length} milestone${timedRules.length === 1 ? '' : 's'}.**`,
      '',
      `### ⚡ Temporary Roles ${temporary.enabled !== false ? '🟢' : '⏸️'}`,
      `Assign roles that expire automatically. **${tempAssignments.length} active assignment${tempAssignments.length === 1 ? '' : 's'}.**`,
      '',
      '> Role hierarchy and Manage Roles permissions are checked before assignments are made.',
    ].join('\n'))
    .setFooter({ text: `Requested by ${memberDisplayName}` })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      row(
        button('admin:autoRoles', '👥 Auto Roles'),
        button('admin:reactionRoles:open', '😊 Reaction Roles'),
      ),
      row(
        button('admin:timedRoles', '⏳ Timed Roles'),
        button('admin:reactionRoles:temporary', '⚡ Temporary Roles'),
      ),
      row(
        button('admin:reactionRoles:analytics', '📊 Role Analytics', ButtonStyle.Secondary),
        button('admin:reactionRoles:health', '🩺 Role Health', ButtonStyle.Secondary),
      ),
      row(button('admin:modules', '⬅️ Back to Modules', ButtonStyle.Secondary)),
    ],
  };
}

async function buildRoleAnalyticsPanel(guild, memberDisplayName = 'Unknown User') {
  const auto = autoroles.getAutoRolesSection(guild.id);
  const reaction = reactionRoles.getSection(guild.id);
  const timed = timedRoles.getSection(guild.id);
  const temporary = temporaryRoles.getSection(guild.id);
  return {
    embeds: [new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('📊 Role Studio Analytics')
      .setDescription([
        `**Auto Roles assigned:** \`${auto.analytics?.assigned || 0}\``,
        `**Reaction roles added:** \`${reaction.analytics?.assigned || 0}\``,
        `**Reaction roles removed:** \`${reaction.analytics?.removed || 0}\``,
        `**Tenure roles awarded:** \`${timed.analytics?.awarded || 0}\``,
        `**Temporary roles assigned:** \`${temporary.analytics?.assigned || 0}\``,
        `**Temporary roles expired:** \`${temporary.analytics?.expired || 0}\``,
        `**Temporary roles removed early:** \`${temporary.analytics?.removed || 0}\``,
      ].join('\n'))
      .setFooter({ text: `Requested by ${memberDisplayName}` })
      .setTimestamp()],
    components: [row(button('admin:reactionRoles', '⬅️ Role Studio', ButtonStyle.Secondary))],
  };
}

async function buildRoleHealthPanel(guild, memberDisplayName = 'Unknown User') {
  const [autoHealth, reactionHealth, timedHealth] = await Promise.all([
    autoroles.buildHealthReport(guild),
    reactionRoles.buildHealth(guild),
    timedRoles.buildHealth(guild),
  ]);
  const activeTemporary = temporaryRoles.listAssignments(guild.id, { activeOnly: true });
  const missingTemporaryRoles = activeTemporary.filter((item) => !guild.roles.cache.has(item.roleId)).length;
  const healthy = autoHealth.healthy && reactionHealth.healthy && timedHealth.healthy && missingTemporaryRoles === 0;

  return {
    embeds: [new EmbedBuilder()
      .setColor(healthy ? 0x57F287 : 0xFAA61A)
      .setTitle('🩺 Role Studio Health')
      .setDescription([
        `**Overall:** ${healthy ? 'Healthy ✅' : 'Needs attention ⚠️'}`,
        '',
        `**Auto Roles:** ${autoHealth.healthy ? 'Healthy ✅' : 'Needs attention ⚠️'}`,
        `**Reaction Roles:** ${reactionHealth.healthy ? 'Healthy ✅' : `${reactionHealth.unhealthy || 0} deployment(s) need attention`}`,
        `**Timed Roles:** ${timedHealth.healthy ? 'Healthy ✅' : `${timedHealth.issues?.length || 0} issue(s)`}`,
        `**Temporary Roles:** ${missingTemporaryRoles ? `${missingTemporaryRoles} missing role reference(s) ⚠️` : 'Healthy ✅'}`,
        '',
        `**Goliath highest role:** ${guild.members.me?.roles.highest ? `<@&${guild.members.me.roles.highest.id}>` : 'Unavailable'}`,
        `**Manage Roles:** ${guild.members.me?.permissions.has('ManageRoles') ? 'Granted ✅' : 'Missing ❌'}`,
      ].join('\n'))
      .setFooter({ text: `Requested by ${memberDisplayName}` })
      .setTimestamp()],
    components: [row(button('admin:reactionRoles', '⬅️ Role Studio', ButtonStyle.Secondary))],
  };
}

module.exports = {
  buildRoleStudioPanel,
  buildRoleAnalyticsPanel,
  buildRoleHealthPanel,
};