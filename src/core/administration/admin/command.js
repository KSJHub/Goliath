'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Events,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} = require('discord.js');

const adminPanel = require('./panel');
const socialStudioPanel = require('../../../modules/socialStudio/socialAlerts/socialStudioPanel');
const { errorEmbed } = require('../../ui/embeds');
const { safeEditReply } = require('../../ui/interactionResponse');
const { enforceCommandAccess } = require('../../commands/commandAccess');
const security = require('../../security/protection/core');
const {
  getLockdownState,
  disableLockdown,
} = require('../../security/protection/lockdown');
const {
  getEmergencyControlState,
  restoreInvites,
  restoreRoles,
} = require('../../security/protection/emergencyControls');
const {
  QUARANTINE_MODES,
  quarantineMember,
  restoreQuarantinedMember,
  getQuarantineState,
  getQuarantineMode,
  attachQuarantineCase,
} = require('../../security/protection/quarantine');
const {
  createCase,
  updateCaseStatus,
  recordCaseAudit,
} = require('../mod/storage');

const SETTINGS_ID = 'admin:settings';
const SETTINGS_BACK_ID = 'admin:settings:back';
const SECURITY_ID = 'admin:security-isolation';
const SECURITY_BACK_ID = 'admin:security-isolation:back';
const SECURITY_SELECT_ID = 'admin:security-isolation:select';
const SERVER_SECURITY_ID = 'admin:server-security';
const SERVER_SECURITY_BACK_ID = 'admin:server-security:back';
const SERVER_SECURITY_REFRESH_ID = 'admin:server-security:refresh';
const SERVER_SECURITY_RESTORE_LOCKDOWN_ID = 'admin:server-security:restore-lockdown';
const SERVER_SECURITY_RESTORE_INVITES_ID = 'admin:server-security:restore-invites';
const SERVER_SECURITY_RESTORE_ROLES_ID = 'admin:server-security:restore-roles';
const SERVER_SECURITY_RESTORE_ALL_ID = 'admin:server-security:restore-all';
const SERVER_SECURITY_CONFIRM_ALL_ID = 'admin:server-security:confirm-all';
const wiredClients = new WeakSet();

function memberDisplayName(interaction) {
  return interaction.member?.displayName || interaction.user?.displayName || interaction.user?.username || 'Unknown User';
}

function isGuildOwner(interaction) {
  return Boolean(
    interaction?.guild?.ownerId
    && interaction?.user?.id
    && String(interaction.guild.ownerId) === String(interaction.user.id)
  );
}

function canUseSettings(interaction) {
  if (!interaction?.guild || !interaction?.user?.id) return false;
  return security.isBotOwner(interaction.user.id)
    || interaction.guild.ownerId === interaction.user.id
    || adminPanel.hasGuildPermission(interaction, 'admin.dashboard.view');
}

function canUseServerSecurity(interaction) {
  return canUseSettings(interaction);
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
  if (!state.active) return 'Not imposed';
  const severity = String(state.severity || '').toLowerCase();
  if (severity === 'critical') return '6 hours';
  if (severity === 'high') return '1 hour';
  if (severity === 'medium') return '10 minutes';
  if (severity === 'low') return '1 minute';
  return 'Lockdown managed';
}

function addAdminControls(panel, interaction) {
  if (!panel) return panel;

  const showSettings = canUseSettings(interaction);
  const showServerSecurity = canUseServerSecurity(interaction);
  const showSecurity = isGuildOwner(interaction);
  if (!showSettings && !showServerSecurity && !showSecurity) return panel;

  const embeds = [...(panel.embeds || [])];
  if (embeds[0]) {
    const fields = [];
    if (showSettings) fields.push({ name: '⚙️ Settings', value: 'General Goliath server configuration and administration defaults', inline: true });
    if (showServerSecurity) fields.push({ name: '🛡️ Server Security Controls', value: 'Guild-wide lockdown, invite freeze, role freeze and recovery controls', inline: true });
    if (showSecurity) fields.push({ name: '🚨 Full Security Isolation', value: 'Owner-only containment, escalation and release controls', inline: true });
    embeds[0] = EmbedBuilder.from(embeds[0]).addFields(fields);
  }

  const components = [...(panel.components || [])];
  if (components.length < 5) {
    const controls = [];
    if (showSettings) controls.push(new ButtonBuilder().setCustomId(SETTINGS_ID).setLabel('Settings').setEmoji('⚙️').setStyle(ButtonStyle.Secondary));
    if (showServerSecurity) controls.push(new ButtonBuilder().setCustomId(SERVER_SECURITY_ID).setLabel('Server Security').setEmoji('🛡️').setStyle(ButtonStyle.Primary));
    if (showSecurity) controls.push(new ButtonBuilder().setCustomId(SECURITY_ID).setLabel('Full Security Isolation').setEmoji('🚨').setStyle(ButtonStyle.Danger));
    if (controls.length) components.push(new ActionRowBuilder().addComponents(controls));
  }

  return { ...panel, embeds, components };
}

function buildSettingsPanel(interaction) {
  const authority = adminPanel.getAuthorityConfig(interaction.guild.id);
  const configuredLogs = Object.values(adminPanel.LOG_TYPES || {}).filter((entry) => adminPanel.getLogChannelId(interaction.guild.id, entry.key)).length;
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('⚙️ Goliath Settings')
    .setDescription('General server-level Goliath configuration lives here. This gives the Admin Hub a dedicated settings home without mixing configuration into operational controls.')
    .addFields(
      { name: 'Server', value: `${interaction.guild.name}\n\`${interaction.guild.id}\``, inline: true },
      { name: 'Authority', value: authority.configured ? 'Configured ✅' : 'Legacy fallback ⚠️', inline: true },
      { name: 'Log Channels', value: `${configuredLogs}/5 configured`, inline: true },
    )
    .setFooter({ text: `Requested by ${memberDisplayName(interaction)}` })
    .setTimestamp();
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(SETTINGS_BACK_ID).setLabel('Back to Administration').setEmoji('⬅️').setStyle(ButtonStyle.Secondary))] };
}

function buildServerSecurityPanel(interaction, notice = null) {
  const lockdown = getLockdownState(interaction.guild.id);
  const emergency = getEmergencyControlState(interaction.guild.id);
  const anyActive = Boolean(lockdown.active || emergency.invites.active || emergency.roles.active);
  const embed = new EmbedBuilder()
    .setColor(anyActive ? 0xFEE75C : 0x57F287)
    .setTitle('🛡️ Server Security Controls')
    .setDescription([
      'Guild-wide operational security and recovery controls.',
      '',
      `🔒 **Guild Lockdown:** ${status(lockdown.active)}`,
      `🐢 **Lockdown Slowmode:** ${lockdownSlowmode(lockdown)}`,
      `📨 **Invite Freeze:** ${status(emergency.invites.active)}`,
      `🎭 **Role Freeze:** ${status(emergency.roles.active)}`,
      notice ? `\n${notice}` : '',
    ].filter(Boolean).join('\n'))
    .addFields(
      {
        name: '🔒 Lockdown State',
        value: lockdown.active ? [
          `**Severity:** ${lockdown.severity || 'Unknown'}`,
          `**Mode:** ${lockdown.lockdownMode || 'Unknown'}`,
          `**Reason:** ${String(lockdown.reason || 'No reason recorded').slice(0, 500)}`,
          `**Started:** ${discordTime(lockdown.lockdownStartedAt || lockdown.enabledAt)}`,
          `**Expires:** ${discordTime(lockdown.lockdownExpiresAt)}`,
          `**Affected channels:** ${(lockdown.channels || []).length}`,
          `**Restore failures:** ${(lockdown.failedChannels || []).length}`,
        ].join('\n') : 'No guild lockdown is currently active.',
        inline: false,
      },
      {
        name: '📨 Invite Protection',
        value: emergency.invites.active ? `Active • ${(emergency.invites.channelSnapshots || []).length} channel snapshots • expires ${discordTime(emergency.invites.expiresAt)}` : 'No emergency invite freeze is active.',
        inline: true,
      },
      {
        name: '🎭 Role Protection',
        value: emergency.roles.active ? `Active • ${(emergency.roles.roleSnapshots || []).length} role snapshots • expires ${discordTime(emergency.roles.expiresAt)}` : 'No emergency role freeze is active.',
        inline: true,
      },
    )
    .setFooter({ text: `Guild security controls • Requested by ${memberDisplayName(interaction)}` })
    .setTimestamp();

  const recoveryRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(SERVER_SECURITY_RESTORE_LOCKDOWN_ID).setLabel('End Lockdown').setEmoji('🔓').setStyle(ButtonStyle.Primary).setDisabled(!lockdown.active),
    new ButtonBuilder().setCustomId(SERVER_SECURITY_RESTORE_INVITES_ID).setLabel('Restore Invites').setEmoji('📨').setStyle(ButtonStyle.Primary).setDisabled(!emergency.invites.active),
    new ButtonBuilder().setCustomId(SERVER_SECURITY_RESTORE_ROLES_ID).setLabel('Restore Roles').setEmoji('🎭').setStyle(ButtonStyle.Primary).setDisabled(!emergency.roles.active),
  );
  const controlRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(SERVER_SECURITY_RESTORE_ALL_ID).setLabel('Restore All Guild Restrictions').setEmoji('🚨').setStyle(ButtonStyle.Danger).setDisabled(!anyActive),
    new ButtonBuilder().setCustomId(SERVER_SECURITY_REFRESH_ID).setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(SERVER_SECURITY_BACK_ID).setLabel('Back').setEmoji('⬅️').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [recoveryRow, controlRow] };
}

function buildRestoreAllConfirmation(interaction) {
  const lockdown = getLockdownState(interaction.guild.id);
  const emergency = getEmergencyControlState(interaction.guild.id);
  const active = [lockdown.active ? 'Guild Lockdown' : null, emergency.invites.active ? 'Invite Freeze' : null, emergency.roles.active ? 'Role Freeze' : null].filter(Boolean);
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
    .setFooter({ text: `Requested by ${memberDisplayName(interaction)}` });
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(SERVER_SECURITY_CONFIRM_ALL_ID).setLabel('Confirm Restore All').setEmoji('🚨').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(SERVER_SECURITY_ID).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  )] };
}

function buildSecurityIsolationPanel(interaction) {
  const state = getQuarantineState(interaction.guild.id);
  const securityEntries = Object.values(state.users || {}).filter((entry) => getQuarantineMode(entry) === QUARANTINE_MODES.SECURITY);
  const investigations = Object.values(state.users || {}).filter((entry) => getQuarantineMode(entry) === QUARANTINE_MODES.INVESTIGATION);
  const embed = new EmbedBuilder()
    .setColor(0xED4245)
    .setTitle('🚨 Full Security Isolation')
    .setDescription(['**Server-owner only emergency containment.**','','Select a member to apply Full Security Isolation. If they are already under Investigation, the existing containment is escalated without losing the original role snapshot or linked case.','','Selecting a member already in Full Security Isolation opens the owner-only release control.','','Anti-Nuke can still apply Full Security Isolation automatically when required.'].join('\n'))
    .addFields({ name: 'Full Security', value: `**${securityEntries.length}** active`, inline: true }, { name: 'Investigations', value: `**${investigations.length}** active`, inline: true })
    .setFooter({ text: `Owner control • Requested by ${memberDisplayName(interaction)}` })
    .setTimestamp();
  return { embeds: [embed], components: [
    new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(SECURITY_SELECT_ID).setPlaceholder('Select member for security isolation').setMinValues(1).setMaxValues(1)),
    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(SECURITY_BACK_ID).setLabel('Back to Administration').setEmoji('⬅️').setStyle(ButtonStyle.Secondary)),
  ] };
}

function buildSecurityIsolationModal(target, escalating = false) {
  return new ModalBuilder().setCustomId(`admin:security-isolation:submit:${target.id}`).setTitle(escalating ? 'Escalate to Full Security' : 'Full Security Isolation').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel(escalating ? 'Reason for security escalation' : 'Security isolation reason').setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(2).setMaxLength(500).setPlaceholder('Why does this member require full Security Isolation?')),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('confirmation').setLabel('Type FULL ISOLATION to confirm').setStyle(TextInputStyle.Short).setRequired(true).setMinLength(14).setMaxLength(14).setPlaceholder('FULL ISOLATION')),
  );
}

function buildSecurityReleasePanel(interaction, target, snapshot) {
  const embed = new EmbedBuilder().setColor(0xED4245).setTitle(`🚨 Security Isolation • ${target.user.tag}`).setDescription([
    `${target} is already in **Full Security Isolation**.`,'',`**Reason:** ${String(snapshot.reason || 'No reason recorded').slice(0, 1000)}`,snapshot.caseId ? `**Case:** #${snapshot.caseId}` : '**Case:** No linked case','', 'Only the server owner can release this member from security containment.',
  ].join('\n')).setTimestamp();
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`admin:security-isolation:release:${target.id}`).setLabel('Clear Full Security Isolation').setEmoji('🔓').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(SECURITY_ID).setLabel('Back').setStyle(ButtonStyle.Secondary),
  )] };
}

function buildSecurityReleaseModal(target) {
  return new ModalBuilder().setCustomId(`admin:security-isolation:release-submit:${target.id}`).setTitle('Clear Full Security Isolation').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Release reason').setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(2).setMaxLength(500).setPlaceholder('Why is Full Security Isolation being cleared?')),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('confirmation').setLabel('Type RELEASE SECURITY to confirm').setStyle(TextInputStyle.Short).setRequired(true).setMinLength(16).setMaxLength(16).setPlaceholder('RELEASE SECURITY')),
  );
}

function fieldValue(interaction, key) {
  try { return String(interaction.fields?.getTextInputValue?.(key) || '').trim(); } catch { return ''; }
}

function rootAdminPanel(interaction) {
  const panel = adminPanel.buildAdminPanel(interaction.guild, memberDisplayName(interaction), interaction);
  return addAdminControls(panel, interaction);
}

async function denyOwnerSecurity(interaction) {
  const payload = { content: '❌ Full Security Isolation is restricted to the Discord server owner.', flags: 64 };
  if (interaction.replied || interaction.deferred) await interaction.editReply(payload).catch(() => null); else await interaction.reply(payload).catch(() => null);
  return true;
}

async function denyServerSecurity(interaction) {
  const payload = { content: '❌ You do not have permission to use Server Security Controls.', flags: 64 };
  if (interaction.replied || interaction.deferred) await interaction.editReply(payload).catch(() => null); else await interaction.reply(payload).catch(() => null);
  return true;
}

async function fetchSecurityTarget(interaction, targetId) {
  if (!targetId) return null;
  return interaction.guild.members.cache.get(String(targetId)) || interaction.guild.members.fetch(String(targetId)).catch(() => null);
}

async function handleSettingsInteraction(interaction) {
  const id = String(interaction?.customId || '');
  if (id !== SETTINGS_ID && id !== SETTINGS_BACK_ID) return false;
  if (!canUseSettings(interaction)) { await interaction.reply({ content: '❌ You do not have permission to open Goliath Settings.', flags: 64 }).catch(() => null); return true; }
  if (id === SETTINGS_ID) { await interaction.update(buildSettingsPanel(interaction)); return true; }
  await interaction.update(rootAdminPanel(interaction)); return true;
}

async function runServerSecurityRestore(interaction, type) {
  if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();
  const reason = `Manual guild security recovery by ${interaction.user.tag || interaction.user.id}`;
  let result;
  if (type === 'lockdown') result = await disableLockdown(interaction.guild, { reason, disabledByTag: interaction.user.tag || interaction.user.id });
  if (type === 'invites') result = await restoreInvites(interaction.guild, { reason });
  if (type === 'roles') result = await restoreRoles(interaction.guild, { reason });
  const ok = Boolean(result?.success);
  const detail = result?.reason || (ok ? 'Recovery completed successfully.' : 'Recovery failed.');
  await interaction.editReply(buildServerSecurityPanel(interaction, `${ok ? '✅' : '❌'} **${type} recovery:** ${detail}`));
  return true;
}

async function restoreAllServerSecurity(interaction) {
  if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();
  const reason = `Manual full guild security recovery by ${interaction.user.tag || interaction.user.id}`;
  const results = [];
  const lockdown = getLockdownState(interaction.guild.id);
  if (lockdown.active) results.push(['Lockdown', await disableLockdown(interaction.guild, { reason, disabledByTag: interaction.user.tag || interaction.user.id })]);
  let emergency = getEmergencyControlState(interaction.guild.id);
  if (emergency.invites.active) results.push(['Invites', await restoreInvites(interaction.guild, { reason })]);
  emergency = getEmergencyControlState(interaction.guild.id);
  if (emergency.roles.active) results.push(['Roles', await restoreRoles(interaction.guild, { reason })]);
  const failed = results.filter(([, result]) => !result?.success);
  const notice = failed.length ? `⚠️ **Recovery completed with ${failed.length} failure(s).** Goliath retained any recovery state that could not be safely restored.` : `✅ **Guild security recovery complete.** ${results.length || 'No'} active restriction${results.length === 1 ? '' : 's'} processed.`;
  await interaction.editReply(buildServerSecurityPanel(interaction, notice));
  return true;
}

async function handleServerSecurityInteraction(interaction) {
  const id = String(interaction?.customId || '');
  if (!id.startsWith('admin:server-security')) return false;
  if (!canUseServerSecurity(interaction)) return denyServerSecurity(interaction);
  if (id === SERVER_SECURITY_ID || id === SERVER_SECURITY_REFRESH_ID) { await interaction.update(buildServerSecurityPanel(interaction)); return true; }
  if (id === SERVER_SECURITY_BACK_ID) { await interaction.update(rootAdminPanel(interaction)); return true; }
  if (id === SERVER_SECURITY_RESTORE_LOCKDOWN_ID) return runServerSecurityRestore(interaction, 'lockdown');
  if (id === SERVER_SECURITY_RESTORE_INVITES_ID) return runServerSecurityRestore(interaction, 'invites');
  if (id === SERVER_SECURITY_RESTORE_ROLES_ID) return runServerSecurityRestore(interaction, 'roles');
  if (id === SERVER_SECURITY_RESTORE_ALL_ID) { await interaction.update(buildRestoreAllConfirmation(interaction)); return true; }
  if (id === SERVER_SECURITY_CONFIRM_ALL_ID) return restoreAllServerSecurity(interaction);
  return false;
}

async function handleSecurityIsolationInteraction(interaction) {
  const id = String(interaction?.customId || '');
  if (!id.startsWith('admin:security-isolation')) return false;
  if (!isGuildOwner(interaction)) return denyOwnerSecurity(interaction);
  if (interaction.isButton?.()) {
    if (id === SECURITY_ID) { await interaction.update(buildSecurityIsolationPanel(interaction)); return true; }
    if (id === SECURITY_BACK_ID) { await interaction.update(rootAdminPanel(interaction)); return true; }
    if (id.startsWith('admin:security-isolation:release:')) {
      const targetId = id.split(':').pop();
      const target = await fetchSecurityTarget(interaction, targetId);
      if (!target) { await interaction.reply({ content: '❌ Could not find that member.', flags: 64 }); return true; }
      const snapshot = getQuarantineState(interaction.guild.id).users?.[target.id];
      if (!snapshot || getQuarantineMode(snapshot) !== QUARANTINE_MODES.SECURITY) { await interaction.reply({ content: '⚠️ That member is not currently in Full Security Isolation.', flags: 64 }); return true; }
      await interaction.showModal(buildSecurityReleaseModal(target)); return true;
    }
  }
  if (interaction.isUserSelectMenu?.() && id === SECURITY_SELECT_ID) {
    const target = await fetchSecurityTarget(interaction, interaction.values?.[0]);
    if (!target) { await interaction.reply({ content: '❌ Could not find that member.', flags: 64 }); return true; }
    if (target.id === interaction.guild.ownerId) { await interaction.reply({ content: '❌ The server owner cannot be placed in security containment.', flags: 64 }); return true; }
    const snapshot = getQuarantineState(interaction.guild.id).users?.[target.id] || null;
    if (snapshot && getQuarantineMode(snapshot) === QUARANTINE_MODES.SECURITY) { await interaction.update(buildSecurityReleasePanel(interaction, target, snapshot)); return true; }
    await interaction.showModal(buildSecurityIsolationModal(target, Boolean(snapshot && getQuarantineMode(snapshot) === QUARANTINE_MODES.INVESTIGATION))); return true;
  }
  if (interaction.isModalSubmit?.() && id.startsWith('admin:security-isolation:submit:')) {
    const targetId = id.split(':').pop();
    const target = await fetchSecurityTarget(interaction, targetId);
    if (!target) { await interaction.reply({ content: '❌ Could not find that member.', flags: 64 }); return true; }
    if (target.id === interaction.guild.ownerId) { await interaction.reply({ content: '❌ The server owner cannot be placed in security containment.', flags: 64 }); return true; }
    if (fieldValue(interaction, 'confirmation') !== 'FULL ISOLATION') { await interaction.reply({ content: '❌ Confirmation did not match `FULL ISOLATION`. No security isolation was applied.', flags: 64 }); return true; }
    const reason = fieldValue(interaction, 'reason');
    const before = getQuarantineState(interaction.guild.id).users?.[target.id] || null;
    const beforeMode = before ? getQuarantineMode(before) : null;
    if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: 64 });
    const result = await quarantineMember(interaction.guild, target, { reason, quarantinedBy: interaction.user.id, source: 'admin', mode: QUARANTINE_MODES.SECURITY });
    if (!result?.success) { await interaction.editReply({ content: `❌ Full Security Isolation failed: ${result?.error || result?.reason || 'Unknown error'}` }); return true; }
    let caseId = before?.caseId || null;
    try {
      if (result.escalated && caseId) {
        recordCaseAudit({ guildId: interaction.guild.id, caseId, actorId: interaction.user.id, event: 'case.quarantine.security_escalated', before: { containmentMode: beforeMode }, after: { containmentMode: QUARANTINE_MODES.SECURITY }, metadata: { source: 'admin', reason } });
      } else if (!caseId && !result.dryRun) {
        const created = createCase({ guildId: interaction.guild.id, userId: target.id, moderatorId: interaction.user.id, action: 'quarantine', reason, metadata: { containmentMode: QUARANTINE_MODES.SECURITY, source: 'admin', securityEscalation: Boolean(result.escalated) }, status: 'active', actorId: interaction.user.id });
        caseId = created?.caseId || null;
        if (caseId) attachQuarantineCase(interaction.guild, target.id, caseId);
      }
    } catch (error) { console.error('❌ Failed to record admin security isolation case:', error); }
    await interaction.editReply({ content: result.dryRun ? `🧪 Security isolation dry-run completed for **${target.user.tag}**.` : `${result.escalated ? '🚨 **Investigation escalated to Full Security Isolation**' : '🚨 **Full Security Isolation applied**'} for **${target.user.tag}**${caseId ? ` • Case **#${caseId}**` : ''}.` });
    return true;
  }
  if (interaction.isModalSubmit?.() && id.startsWith('admin:security-isolation:release-submit:')) {
    const targetId = id.split(':').pop();
    const target = await fetchSecurityTarget(interaction, targetId);
    if (!target) { await interaction.reply({ content: '❌ Could not find that member.', flags: 64 }); return true; }
    if (fieldValue(interaction, 'confirmation') !== 'RELEASE SECURITY') { await interaction.reply({ content: '❌ Confirmation did not match `RELEASE SECURITY`. No containment was cleared.', flags: 64 }); return true; }
    const reason = fieldValue(interaction, 'reason');
    const snapshot = getQuarantineState(interaction.guild.id).users?.[target.id] || null;
    if (!snapshot || getQuarantineMode(snapshot) !== QUARANTINE_MODES.SECURITY) { await interaction.reply({ content: '⚠️ That member is not currently in Full Security Isolation.', flags: 64 }); return true; }
    if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: 64 });
    const result = await restoreQuarantinedMember(interaction.guild, target, { reason: `Full Security Isolation cleared by ${interaction.user.tag}: ${reason}`, restoredBy: interaction.user.id, source: 'admin' });
    if (!result?.success) { await interaction.editReply({ content: `❌ Failed to clear Full Security Isolation: ${result?.error || result?.reason || 'Unknown error'}` }); return true; }
    if (snapshot.caseId) {
      try {
        updateCaseStatus(interaction.guild.id, snapshot.caseId, 'reversed', interaction.user.id);
        recordCaseAudit({ guildId: interaction.guild.id, caseId: snapshot.caseId, actorId: interaction.user.id, event: 'case.quarantine.security_released', before: { status: 'active', containmentMode: QUARANTINE_MODES.SECURITY }, after: { status: 'reversed', restoredRoles: result.restoredRoles || 0 }, metadata: { source: 'admin', reason } });
      } catch (error) { console.error(`❌ Failed to update security isolation case #${snapshot.caseId}:`, error); }
    }
    await interaction.editReply({ content: `🔓 **Full Security Isolation cleared** for **${target.user.tag}** • restored **${result.restoredRoles || 0}** role(s).` });
    return true;
  }
  return false;
}

function wireClient(client) {
  if (!client || wiredClients.has(client)) return false;
  wiredClients.add(client);
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (await handleServerSecurityInteraction(interaction)) return;
      if (await handleSecurityIsolationInteraction(interaction)) return;
      await handleSettingsInteraction(interaction);
    } catch (error) {
      console.error('❌ Admin command interaction failed:', error?.stack || error?.message || error);
      if (interaction?.deferred || interaction?.replied) await interaction?.editReply?.({ content: '❌ Failed to process the admin control.' }).catch(() => null);
      else await interaction?.reply?.({ content: '❌ Failed to process the admin control.', flags: 64 }).catch(() => null);
    }
  });
  return true;
}

const command = {
  category: 'Admin',
  help: { name: 'admin', description: 'Open admin controls and server tools.', usage: '/admin' },
  access: { level: 'admin', ownerOnly: false },
  data: new SlashCommandBuilder().setName('admin').setDescription('Open Goliath admin controls and server tools').setDMPermission(false),
  wireClient,
  async execute(interaction) {
    try {
      if (!interaction.guild) return safeEditReply(interaction, { embeds: [errorEmbed('This command can only be used inside a server.')] });
      const displayName = memberDisplayName(interaction);
      const isGoliathOwner = security.isBotOwner(interaction.user?.id);
      const isLegacyAdmin = security.hasPermission(interaction, 'admin');
      const hasConfiguredAdminAccess = adminPanel.hasGuildPermission(interaction, 'admin.dashboard.view');
      const canManageAuthority = adminPanel.canManageGuildAuthority(interaction);
      const canManageSocial = typeof socialStudioPanel.canManageSocialStudio === 'function' && socialStudioPanel.canManageSocialStudio(interaction);
      if (!isLegacyAdmin && !hasConfiguredAdminAccess && !canManageAuthority && canManageSocial) return safeEditReply(interaction, socialStudioPanel.buildSocialAdminPanel(interaction.guild, displayName));
      if (!isLegacyAdmin && !hasConfiguredAdminAccess && !canManageAuthority) { const denied = await enforceCommandAccess(interaction, command); if (denied) return; }
      const panel = adminPanel.buildAdminPanel(interaction.guild, displayName, interaction);
      return safeEditReply(interaction, addAdminControls(panel, interaction));
    } catch (error) {
      if (error?.code === 10062 || error?.code === 40060) return;
      console.error('❌ Admin command failed:', error);
      return safeEditReply(interaction, { embeds: [errorEmbed('Failed to open the admin panel. Please try again.')], components: [] });
    }
  },
};

module.exports = command;