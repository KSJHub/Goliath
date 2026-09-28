'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Events,
} = require('discord.js');

const adminPanel = require('../../core/administration/admin/panel');
const security = require('../../core/security/protection/core');
const {
  getLockdownState,
  disableLockdown,
} = require('../../core/security/protection/lockdown');
const {
  getEmergencyControlState,
  restoreInvites,
  restoreRoles,
} = require('../../core/security/protection/emergencyControls');

const ROOT_ID = 'admin:server-security';
const BACK_ID = 'admin:server-security:back';
const REFRESH_ID = 'admin:server-security:refresh';
const RESTORE_LOCKDOWN_ID = 'admin:server-security:restore-lockdown';
const RESTORE_INVITES_ID = 'admin:server-security:restore-invites';
const RESTORE_ROLES_ID = 'admin:server-security:restore-roles';
const RESTORE_ALL_ID = 'admin:server-security:restore-all';
const CONFIRM_ALL_ID = 'admin:server-security:confirm-all';

const PATCH_MARK = Symbol.for('goliath.admin.serverSecurityControls.patched');

function displayName(interaction) {
  return interaction.member?.displayName || interaction.user?.displayName || interaction.user?.username || 'Unknown User';
}

function canUse(interaction) {
  if (!interaction?.guild || !interaction?.user?.id) return false;
  return security.isBotOwner(interaction.user.id)
    || interaction.guild.ownerId === interaction.user.id
    || adminPanel.hasGuildPermission(interaction, 'admin.dashboard.view');
}

function status(active) {
  return active ? '🔴 **ACTIVE**' : '🟢 Standby';
}

function discordTime(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return 'Not set';
  return `<t:${Math.floor(ms / 1000)}:R>`;
}

function lockdownSlowmode(state) {
  const values = (state.channels || [])
    .map((entry) => Number(entry?.slowmode))
    .filter(Number.isFinite);
  if (!state.active) return 'Not imposed';
  const severity = String(state.severity || '').toLowerCase();
  if (severity === 'critical') return '6 hours';
  if (severity === 'high') return '1 hour';
  if (severity === 'medium') return '10 minutes';
  if (severity === 'low') return '1 minute';
  return values.length ? 'Lockdown managed' : 'Unknown';
}

function buildPanel(interaction, notice = null) {
  const lockdown = getLockdownState(interaction.guild.id);
  const emergency = getEmergencyControlState(interaction.guild.id);
  const anyActive = Boolean(lockdown.active || emergency.invites.active || emergency.roles.active);

  const lines = [
    `🔒 **Guild Lockdown:** ${status(lockdown.active)}`,
    `🐢 **Lockdown Slowmode:** ${lockdownSlowmode(lockdown)}`,
    `📨 **Invite Freeze:** ${status(emergency.invites.active)}`,
    `🎭 **Role Freeze:** ${status(emergency.roles.active)}`,
  ];

  const embed = new EmbedBuilder()
    .setColor(anyActive ? 0xFEE75C : 0x57F287)
    .setTitle('🛡️ Server Security Controls')
    .setDescription([
      'Guild-wide operational security and recovery controls.',
      '',
      ...lines,
      notice ? `\n${notice}` : '',
    ].filter(Boolean).join('\n'))
    .addFields(
      {
        name: '🔒 Lockdown State',
        value: lockdown.active
          ? [
              `**Severity:** ${lockdown.severity || 'Unknown'}`,
              `**Mode:** ${lockdown.lockdownMode || 'Unknown'}`,
              `**Reason:** ${String(lockdown.reason || 'No reason recorded').slice(0, 500)}`,
              `**Started:** ${discordTime(lockdown.lockdownStartedAt || lockdown.enabledAt)}`,
              `**Expires:** ${discordTime(lockdown.lockdownExpiresAt)}`,
              `**Affected channels:** ${(lockdown.channels || []).length}`,
              `**Restore failures:** ${(lockdown.failedChannels || []).length}`,
            ].join('\n')
          : 'No guild lockdown is currently active.',
        inline: false,
      },
      {
        name: '📨 Invite Protection',
        value: emergency.invites.active
          ? `Active • ${(emergency.invites.channelSnapshots || []).length} channel snapshots • expires ${discordTime(emergency.invites.expiresAt)}`
          : 'No emergency invite freeze is active.',
        inline: true,
      },
      {
        name: '🎭 Role Protection',
        value: emergency.roles.active
          ? `Active • ${(emergency.roles.roleSnapshots || []).length} role snapshots • expires ${discordTime(emergency.roles.expiresAt)}`
          : 'No emergency role freeze is active.',
        inline: true,
      },
    )
    .setFooter({ text: `Guild security controls • Requested by ${displayName(interaction)}` })
    .setTimestamp();

  const recoveryRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(RESTORE_LOCKDOWN_ID)
      .setLabel('End Lockdown')
      .setEmoji('🔓')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!lockdown.active),
    new ButtonBuilder()
      .setCustomId(RESTORE_INVITES_ID)
      .setLabel('Restore Invites')
      .setEmoji('📨')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!emergency.invites.active),
    new ButtonBuilder()
      .setCustomId(RESTORE_ROLES_ID)
      .setLabel('Restore Roles')
      .setEmoji('🎭')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!emergency.roles.active),
  );

  const controlRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(RESTORE_ALL_ID)
      .setLabel('Restore All Guild Restrictions')
      .setEmoji('🚨')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!anyActive),
    new ButtonBuilder()
      .setCustomId(REFRESH_ID)
      .setLabel('Refresh')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(BACK_ID)
      .setLabel('Back')
      .setEmoji('⬅️')
      .setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [recoveryRow, controlRow] };
}

function buildRestoreAllConfirmation(interaction) {
  const lockdown = getLockdownState(interaction.guild.id);
  const emergency = getEmergencyControlState(interaction.guild.id);
  const active = [
    lockdown.active ? 'Guild Lockdown' : null,
    emergency.invites.active ? 'Invite Freeze' : null,
    emergency.roles.active ? 'Role Freeze' : null,
  ].filter(Boolean);

  const embed = new EmbedBuilder()
    .setColor(0xED4245)
    .setTitle('🚨 Restore All Guild Restrictions?')
    .setDescription([
      'Goliath will use its saved recovery snapshots to restore the guild.',
      '',
      `**Active controls:** ${active.join(', ') || 'None'}`,
      '',
      '**This does not clear member Investigation Isolation or owner-only Full Security Isolation.**',
    ].join('\n'))
    .setFooter({ text: `Requested by ${displayName(interaction)}` });

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(CONFIRM_ALL_ID).setLabel('Confirm Restore All').setEmoji('🚨').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(ROOT_ID).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function patchAdminPanel() {
  if (adminPanel[PATCH_MARK]) return;
  const original = adminPanel.buildAdminPanel;
  if (typeof original !== 'function') return;

  adminPanel.buildAdminPanel = function patchedBuildAdminPanel(guild, requestedBy, interaction, ...rest) {
    const panel = original.call(this, guild, requestedBy, interaction, ...rest);
    if (!interaction || !canUse(interaction) || !panel) return panel;

    const embeds = [...(panel.embeds || [])];
    if (embeds[0]) {
      embeds[0] = EmbedBuilder.from(embeds[0]).addFields({
        name: '🛡️ Server Security Controls',
        value: 'Guild-wide lockdown, invite freeze, role freeze and recovery controls',
        inline: true,
      });
    }

    const components = [...(panel.components || [])];
    const button = new ButtonBuilder()
      .setCustomId(ROOT_ID)
      .setLabel('Server Security')
      .setEmoji('🛡️')
      .setStyle(ButtonStyle.Primary);

    let inserted = false;
    for (let index = components.length - 1; index >= 0; index -= 1) {
      const row = components[index];
      if (Array.isArray(row?.components) && row.components.length < 5) {
        const rebuilt = ActionRowBuilder.from(row).addComponents(button);
        components[index] = rebuilt;
        inserted = true;
        break;
      }
    }
    if (!inserted && components.length < 5) components.push(new ActionRowBuilder().addComponents(button));

    return { ...panel, embeds, components };
  };

  adminPanel[PATCH_MARK] = true;
}

patchAdminPanel();

async function deny(interaction) {
  const payload = { content: '❌ You do not have permission to use Server Security Controls.', flags: 64 };
  if (interaction.replied || interaction.deferred) await interaction.editReply(payload).catch(() => null);
  else await interaction.reply(payload).catch(() => null);
}

async function updatePanel(interaction, notice = null) {
  if (interaction.replied || interaction.deferred) return interaction.editReply(buildPanel(interaction, notice));
  return interaction.update(buildPanel(interaction, notice));
}

async function runRestore(interaction, type) {
  if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();
  const reason = `Manual guild security recovery by ${interaction.user.tag || interaction.user.id}`;
  let result;

  if (type === 'lockdown') {
    result = await disableLockdown(interaction.guild, { reason, disabledByTag: interaction.user.tag || interaction.user.id });
  } else if (type === 'invites') {
    result = await restoreInvites(interaction.guild, { reason });
  } else if (type === 'roles') {
    result = await restoreRoles(interaction.guild, { reason });
  }

  const ok = Boolean(result?.success);
  const detail = result?.reason || (ok ? 'Recovery completed successfully.' : 'Recovery failed.');
  await interaction.editReply(buildPanel(interaction, `${ok ? '✅' : '❌'} **${type} recovery:** ${detail}`));
}

async function restoreAll(interaction) {
  if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();
  const reason = `Manual full guild security recovery by ${interaction.user.tag || interaction.user.id}`;
  const results = [];

  const lockdown = getLockdownState(interaction.guild.id);
  if (lockdown.active) {
    const result = await disableLockdown(interaction.guild, { reason, disabledByTag: interaction.user.tag || interaction.user.id });
    results.push(['Lockdown', result]);
  }

  const emergencyBeforeInvites = getEmergencyControlState(interaction.guild.id);
  if (emergencyBeforeInvites.invites.active) {
    results.push(['Invites', await restoreInvites(interaction.guild, { reason })]);
  }

  const emergencyBeforeRoles = getEmergencyControlState(interaction.guild.id);
  if (emergencyBeforeRoles.roles.active) {
    results.push(['Roles', await restoreRoles(interaction.guild, { reason })]);
  }

  const failed = results.filter(([, result]) => !result?.success);
  const notice = failed.length
    ? `⚠️ **Recovery completed with ${failed.length} failure(s).** Goliath retained any recovery state that could not be safely restored.`
    : `✅ **Guild security recovery complete.** ${results.length || 'No'} active restriction${results.length === 1 ? '' : 's'} processed.`;

  await interaction.editReply(buildPanel(interaction, notice));
}

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    const id = String(interaction?.customId || '');
    if (!id.startsWith('admin:server-security')) return;
    if (!interaction.guild) return;
    if (!canUse(interaction)) return deny(interaction);

    try {
      if (id === ROOT_ID || id === REFRESH_ID) {
        await interaction.update(buildPanel(interaction));
        return;
      }
      if (id === BACK_ID) {
        const panel = adminPanel.buildAdminPanel(interaction.guild, displayName(interaction), interaction);
        await interaction.update(panel);
        return;
      }
      if (id === RESTORE_LOCKDOWN_ID) return runRestore(interaction, 'lockdown');
      if (id === RESTORE_INVITES_ID) return runRestore(interaction, 'invites');
      if (id === RESTORE_ROLES_ID) return runRestore(interaction, 'roles');
      if (id === RESTORE_ALL_ID) {
        await interaction.update(buildRestoreAllConfirmation(interaction));
        return;
      }
      if (id === CONFIRM_ALL_ID) return restoreAll(interaction);
    } catch (error) {
      console.error('[AdminServerSecurityControls] Interaction failed:', error);
      const payload = { content: `❌ Server Security Controls failed: ${String(error?.message || error).slice(0, 500)}`, flags: 64 };
      if (interaction.replied || interaction.deferred) await interaction.editReply(payload).catch(() => null);
      else await interaction.reply(payload).catch(() => null);
    }
  },
};
