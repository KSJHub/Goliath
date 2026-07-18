'use strict';

// src/modules/verification/verificationManager.js

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');

const verificationStore = require('./verificationStore');
const guildManager = require('../../core/guild/guildManager');
const testDevOverride = require('../../core/dev/testDevOverrideManager');

const CUSTOM_ID_PREFIX = 'verify';
const SCREENING_FEATURE = 'MEMBER_VERIFICATION_GATE_ENABLED';
const BUTTON_STYLES = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
};

function cleanDiscordId(value) {
  const id = String(value || '').replace(/[<@&#!>]/g, '').trim();
  return /^\d{15,25}$/.test(id) ? id : null;
}

function cleanDiscordIds(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(values.map(cleanDiscordId).filter(Boolean))];
}

function canManageVerification(member) {
  return Boolean(
    member?.permissions?.has(PermissionFlagsBits.Administrator) ||
    member?.permissions?.has(PermissionFlagsBits.ManageGuild)
  );
}

function getBotMember(guild) {
  return guild?.members?.me || guild?.members?.cache?.get(guild.client.user.id) || null;
}

function isDevOwnerTestMember(member) {
  return testDevOverride.isDevOwnerHierarchyOverride({
    guild: member?.guild,
    member,
    user: member?.user,
    userId: member?.id,
  });
}

function canBotManageMember(member) {
  const botMember = getBotMember(member?.guild);
  if (!botMember || !member || member.id === botMember.id) return false;
  if (isDevOwnerTestMember(member)) return true;
  const { isBotOwner } = require('../../core/security/securityCore');
  return !isBotOwner(member.id);
}

function canBotManageRole(guild, role) {
  const botMember = getBotMember(guild);
  if (!botMember || !role || role.managed || role.id === guild.id) return false;
  return Boolean(
    botMember.permissions.has(PermissionFlagsBits.ManageRoles) &&
    botMember.roles.highest.position > role.position
  );
}

function hasDiscordScreening(guild) {
  return Boolean(guild?.features?.includes?.(SCREENING_FEATURE));
}

function buildVerifyCustomId(panelId) {
  return `${CUSTOM_ID_PREFIX}:button:${panelId}`;
}

function parseVerifyCustomId(customId = '') {
  const [prefix, action, panelId] = String(customId || '').split(':');
  return prefix === CUSTOM_ID_PREFIX && action === 'button' && panelId ? { panelId } : null;
}

function buildVerificationEmbed(panel = {}) {
  const embed = new EmbedBuilder()
    .setColor(panel.color || '#57f287')
    .setTitle(panel.title || 'Member Verification')
    .setDescription(panel.description || 'Press the button below to complete server onboarding.')
    .setFooter({ text: panel.footer || 'Goliath Verification' })
    .setTimestamp(new Date());
  if (panel.thumbnailUrl) embed.setThumbnail(panel.thumbnailUrl);
  if (panel.imageUrl) embed.setImage(panel.imageUrl);
  return embed;
}

function buildVerificationRows(panel = {}) {
  const button = new ButtonBuilder()
    .setCustomId(buildVerifyCustomId(panel.panelId || panel.id))
    .setLabel(panel.buttonLabel || 'Verify')
    .setStyle(BUTTON_STYLES[panel.buttonStyle] || ButtonStyle.Success);
  if (panel.buttonEmoji) button.setEmoji(panel.buttonEmoji);
  return [new ActionRowBuilder().addComponents(button)];
}

function getAdminVerificationConfig(guildId) {
  const modules = guildManager.getGuildSection(guildId, 'modules', {});
  const config = modules?.verification;
  return config && typeof config === 'object' ? config : {};
}

function getEffectiveVerificationSection(guildId) {
  const section = verificationStore.getVerificationSection(guildId);
  const adminConfig = getAdminVerificationConfig(guildId);
  const settings = verificationStore.normalizeSettings({
    ...(section.settings || {}),
    ...adminConfig,
    ...(adminConfig.settings || {}),
    verificationChannelId: adminConfig.verificationChannelId ?? section.settings?.verificationChannelId,
    logChannelId: adminConfig.logChannelId ?? section.settings?.logChannelId,
    verifiedRoleIds: adminConfig.verifiedRoleIds?.length
      ? adminConfig.verifiedRoleIds
      : section.settings?.verifiedRoleIds,
    pendingRoleIds: adminConfig.pendingRoleIds?.length
      ? adminConfig.pendingRoleIds
      : section.settings?.pendingRoleIds,
  });

  return {
    ...section,
    enabled: typeof adminConfig.enabled === 'boolean' ? adminConfig.enabled : section.enabled,
    settings,
  };
}

function toggleVerification(guildId, meta = {}) {
  const section = getEffectiveVerificationSection(guildId);
  return configureVerification(guildId, { enabled: section.enabled !== true }, {
    action: 'verification_toggle',
    ...meta,
  });
}

function getVerificationStatus(guildId) {
  return getEffectiveVerificationSection(guildId);
}

function updateVerificationSettings(guildId, settings = {}, meta = {}) {
  return verificationStore.updateVerificationSection(guildId, (section) => ({
    ...section,
    settings: verificationStore.normalizeSettings({ ...(section.settings || {}), ...(settings || {}) }),
    updatedAt: new Date().toISOString(),
  }), { action: 'verification_settings_update', ...meta });
}

function updateVerificationMessages(guildId, messages = {}, meta = {}) {
  return verificationStore.updateMessages(guildId, messages, {
    action: 'verification_messages_update',
    ...meta,
  });
}

function updatePanelTemplate(guildId, template = {}, meta = {}) {
  return verificationStore.updatePanelTemplate(guildId, template, {
    action: 'verification_panel_template_update',
    ...meta,
  });
}

function renderMessage(template, member, values = {}) {
  const guild = member?.guild;
  const replacements = {
    user: member ? `<@${member.id}>` : '',
    username: member?.user?.username || '',
    userId: member?.id || '',
    server: guild?.name || '',
    serverId: guild?.id || '',
    memberCount: String(guild?.memberCount || 0),
    verifiedRoles: values.verifiedRoles || '',
    pendingRoles: values.pendingRoles || '',
    minimumAccountAgeDays: values.minimumAccountAgeDays ?? '',
    minimumMembershipAgeMinutes: values.minimumMembershipAgeMinutes ?? '',
    cooldownSeconds: values.cooldownSeconds ?? '',
    attempts: values.attempts ?? '',
    reason: values.reason || '',
  };

  return String(template || '').replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => String(replacements[key] ?? `{${key}}`));
}

async function fetchRole(guild, roleId) {
  if (!guild || !roleId) return null;
  return guild.roles.cache.get(roleId) || guild.roles.fetch(roleId).catch(() => null);
}

async function fetchRoles(guild, roleIds = []) {
  const roles = [];
  for (const roleId of cleanDiscordIds(roleIds)) {
    const role = await fetchRole(guild, roleId);
    if (role) roles.push(role);
  }
  return roles;
}

function roleMentions(roles = []) {
  return roles.map((role) => `<@&${role.id}>`).join(', ');
}

function resolveRoleActionStatus(guild, member, role, action) {
  if (!role || role.id === guild.id) return { ok: true, skipped: true };
  if (action === 'add' && member.roles.cache.has(role.id)) return { ok: true, skipped: true };
  if (action === 'remove' && !member.roles.cache.has(role.id)) return { ok: true, skipped: true };
  if (!canBotManageRole(guild, role)) {
    return {
      ok: false,
      message: `I cannot manage the ${role.name} role. Move my role above it and make sure I have Manage Roles.`,
    };
  }
  return { ok: true, skipped: false };
}

async function sendVerificationLog(guild, section, content) {
  const channelId = section.settings?.logChannelId;
  if (!channelId || !content) return false;
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.send) return false;
  await channel.send({ content, allowedMentions: { users: [], roles: [], parse: [] } }).catch(() => null);
  return true;
}

function isStaffBypass(member, settings) {
  return Boolean(settings.allowStaffBypass && canManageVerification(member));
}

function getAttemptBlock(section, member) {
  const settings = section.settings;
  const attempt = section.attempts?.[member.id] || null;
  if (!attempt) return null;

  const max = Number(settings.maximumFailedAttempts || 0);
  if (max > 0 && Number(attempt.failed || 0) >= max) {
    return { key: 'failed', reason: `maximum failed attempts reached (${max})` };
  }

  const cooldown = Number(settings.attemptCooldownSeconds || 0);
  if (cooldown > 0 && attempt.lastAttemptAt) {
    const elapsed = Date.now() - new Date(attempt.lastAttemptAt).getTime();
    const remaining = Math.ceil((cooldown * 1000 - elapsed) / 1000);
    if (remaining > 0) return { key: 'cooldown', remaining };
  }

  return null;
}

function accountAgeDays(member) {
  return (Date.now() - Number(member?.user?.createdTimestamp || Date.now())) / 86400000;
}

function membershipAgeMinutes(member) {
  return (Date.now() - Number(member?.joinedTimestamp || Date.now())) / 60000;
}

async function assignPendingRoles(member, reason = 'Goliath pending verification role assignment') {
  if (!member?.guild?.id || member.user?.bot) return { assigned: [], skipped: true };
  const section = getEffectiveVerificationSection(member.guild.id);
  const settings = section.settings;

  if (section.enabled !== true || !settings.usePendingRoles || !settings.assignPendingRoles) {
    return { assigned: [], skipped: true };
  }

  if (settings.pendingRoleTiming === 'manual') return { assigned: [], skipped: true };
  if (settings.pendingRoleTiming === 'after_screening' && member.pending === true) {
    return { assigned: [], skipped: true, waitingForScreening: true };
  }

  const roles = await fetchRoles(member.guild, settings.pendingRoleIds);
  const assigned = [];

  for (const role of roles) {
    const status = resolveRoleActionStatus(member.guild, member, role, 'add');
    if (!status.ok || status.skipped) continue;
    await member.roles.add(role, reason).catch(() => null);
    if (member.roles.cache.has(role.id)) assigned.push(role);
  }

  if (assigned.length) {
    verificationStore.incrementAnalytics(member.guild.id, {
      pendingRolesAssigned: assigned.length,
    });

    if (settings.dmOnPendingRole) {
      const message = renderMessage(section.messages.pendingAssigned, member, {
        pendingRoles: roleMentions(assigned),
      });
      await member.send(message).catch(() => null);
    }
  }

  return { assigned, skipped: false };
}

async function handleMemberJoin(member) {
  const section = getEffectiveVerificationSection(member.guild.id);
  if (section.enabled !== true || member.user?.bot) return { handled: false };
  if (!section.settings.assignPendingRoles || !section.settings.usePendingRoles) return { handled: false };
  if (section.settings.pendingRoleTiming !== 'on_join') return assignPendingRoles(member);
  return assignPendingRoles(member, 'Goliath pending role assigned on join');
}

async function handleMemberUpdate(oldMember, newMember) {
  if (!newMember?.guild?.id || newMember.user?.bot) return { handled: false };
  const screeningCompleted = oldMember?.pending === true && newMember.pending === false;
  if (!screeningCompleted) return { handled: false };

  const section = getEffectiveVerificationSection(newMember.guild.id);
  if (section.enabled !== true) return { handled: false };

  verificationStore.incrementAnalytics(newMember.guild.id, { screeningCompleted: 1 });

  if (section.settings.logScreeningCompletion) {
    await sendVerificationLog(
      newMember.guild,
      section,
      renderMessage(section.messages.screeningCompletedLog, newMember)
    );
  }

  const result = section.settings.pendingRoleTiming === 'after_screening'
    ? await assignPendingRoles(newMember, 'Goliath pending role assigned after Discord screening')
    : { assigned: [], skipped: true };

  return { handled: true, screeningCompleted: true, ...result };
}

async function failVerification(guildId, section, member, messageKey, values = {}, analytics = {}) {
  const reason = renderMessage(section.messages[messageKey] || section.messages.failed, member, values);
  verificationStore.recordAttempt(guildId, member.id, { failed: true });
  verificationStore.incrementAnalytics(guildId, { failed: 1, ...analytics });

  if (section.settings.logFailure) {
    await sendVerificationLog(member.guild, section, renderMessage(section.messages.failureLog, member, {
      ...values,
      reason: values.reason || reason,
    }));
  }

  return { ok: false, message: reason };
}

async function verifyMember(interaction) {
  const guild = interaction?.guild;
  const guildId = interaction?.guildId || guild?.id;
  if (!guildId || !guild) return { ok: false, message: 'Server unavailable.' };

  const section = getEffectiveVerificationSection(guildId);
  const member = await guild.members.fetch({
    user: interaction.user.id,
    force: true,
  }).catch(() => null);
  if (!member) return { ok: false, message: 'Member not found.' };

  const settings = section.settings;
  const messages = section.messages;
  const bypass = isStaffBypass(member, settings);
  const verifiedRoles = await fetchRoles(guild, settings.verifiedRoleIds);
  const pendingRoles = await fetchRoles(guild, settings.pendingRoleIds);
  const alreadyVerified = verifiedRoles.length > 0 && verifiedRoles.every((role) => member.roles.cache.has(role.id));

  if (section.enabled !== true) {
    return failVerification(guildId, section, member, 'unavailable', {}, { unavailable: 1 });
  }

  if (settings.blockBots && member.user?.bot && !bypass) {
    return failVerification(guildId, section, member, 'botBlocked', {}, { botBlocked: 1 });
  }

  if (alreadyVerified && !settings.allowReverification) {
    verificationStore.incrementAnalytics(guildId, { alreadyVerified: 1 });
    return { ok: true, message: renderMessage(messages.alreadyVerified, member) };
  }

  if (!verifiedRoles.length) {
    return failVerification(guildId, section, member, 'unavailable', {
      reason: 'no verified roles configured',
    }, { unavailable: 1 });
  }

  if (!bypass) {
    const attemptBlock = getAttemptBlock(section, member);
    if (attemptBlock?.key === 'cooldown') {
      verificationStore.incrementAnalytics(guildId, { cooldownBlocked: 1 });
      return {
        ok: false,
        message: renderMessage(messages.cooldown, member, { cooldownSeconds: attemptBlock.remaining }),
      };
    }
    if (attemptBlock?.key === 'failed') {
      return failVerification(guildId, section, member, 'failed', { reason: attemptBlock.reason }, { requirementBlocked: 1 });
    }

    const screeningAvailable = hasDiscordScreening(guild);
    if (settings.waitForDiscordScreening) {
      if (screeningAvailable && member.pending === true) {
        return failVerification(guildId, section, member, 'screeningRequired', {}, { screeningBlocked: 1 });
      }
      if (!screeningAvailable && !settings.skipScreeningIfUnavailable) {
        return failVerification(guildId, section, member, 'screeningRequired', {
          reason: 'Discord Membership Screening is not configured',
        }, { screeningBlocked: 1 });
      }
    }

    if (settings.usePendingRoles && settings.requirePendingRole) {
      const hasRequiredPendingRole = pendingRoles.some((role) => member.roles.cache.has(role.id));
      if (!hasRequiredPendingRole) {
        return failVerification(guildId, section, member, 'pendingRoleRequired', {
          pendingRoles: roleMentions(pendingRoles),
        }, { requirementBlocked: 1 });
      }
    }

    if (settings.minimumAccountAgeDays > 0 && accountAgeDays(member) < settings.minimumAccountAgeDays) {
      return failVerification(guildId, section, member, 'accountTooNew', {
        minimumAccountAgeDays: settings.minimumAccountAgeDays,
      }, { accountAgeBlocked: 1, requirementBlocked: 1 });
    }

    if (settings.minimumMembershipAgeMinutes > 0 && membershipAgeMinutes(member) < settings.minimumMembershipAgeMinutes) {
      return failVerification(guildId, section, member, 'membershipTooNew', {
        minimumMembershipAgeMinutes: settings.minimumMembershipAgeMinutes,
      }, { membershipAgeBlocked: 1, requirementBlocked: 1 });
    }
  }

  if (!canBotManageMember(member)) {
    return failVerification(guildId, section, member, 'failed', {
      reason: 'Goliath cannot manage this member',
    }, { roleManageFailed: 1 });
  }

  for (const role of verifiedRoles) {
    const status = resolveRoleActionStatus(guild, member, role, 'add');
    if (!status.ok) {
      return failVerification(guildId, section, member, 'failed', { reason: status.message }, { roleManageFailed: 1 });
    }
  }

  if (settings.usePendingRoles && settings.removePendingRoles) {
    for (const role of pendingRoles) {
      const status = resolveRoleActionStatus(guild, member, role, 'remove');
      if (!status.ok) {
        return failVerification(guildId, section, member, 'failed', { reason: status.message }, { roleManageFailed: 1 });
      }
    }
  }

  try {
    for (const role of verifiedRoles) {
      if (!member.roles.cache.has(role.id)) await member.roles.add(role, 'Goliath verification completed');
    }

    if (settings.usePendingRoles && settings.removePendingRoles) {
      for (const role of pendingRoles) {
        if (member.roles.cache.has(role.id)) await member.roles.remove(role, 'Goliath verification completed');
      }
    }

    const refreshedMember = await guild.members.fetch({
      user: member.id,
      force: true,
    });

    const missingVerifiedRoles = verifiedRoles.filter(
      (role) => !refreshedMember.roles.cache.has(role.id)
    );
    const remainingPendingRoles = settings.usePendingRoles && settings.removePendingRoles
      ? pendingRoles.filter((role) => refreshedMember.roles.cache.has(role.id))
      : [];

    if (missingVerifiedRoles.length || remainingPendingRoles.length) {
      const problems = [];
      if (missingVerifiedRoles.length) {
        problems.push(`verified role not added: ${missingVerifiedRoles.map((role) => role.name).join(', ')}`);
      }
      if (remainingPendingRoles.length) {
        problems.push(`pending role not removed: ${remainingPendingRoles.map((role) => role.name).join(', ')}`);
      }
      throw new Error(problems.join('; '));
    }

    verificationStore.clearAttempts(guildId, member.id);
    verificationStore.incrementAnalytics(guildId, { verified: 1 });

    const values = {
      verifiedRoles: roleMentions(verifiedRoles),
      pendingRoles: roleMentions(pendingRoles),
    };

    if (settings.logSuccess) {
      await sendVerificationLog(guild, section, renderMessage(messages.successLog, refreshedMember, values));
    }

    if (settings.dmOnVerify) {
      await refreshedMember.send(renderMessage(messages.dmSuccess, refreshedMember, values)).catch(() => null);
    }

    return { ok: true, message: renderMessage(messages.success, refreshedMember, values) };
  } catch (error) {
    const reason = error?.rawError?.message || error?.message || 'Discord rejected the role update';
    console.error('[Verification] Role update failed', {
      guildId,
      userId: member.id,
      error,
    });
    return failVerification(guildId, section, member, 'failed', {
      reason,
    }, { roleManageFailed: 1 });
  }
}

function configureVerification(guildId, input = {}, meta = {}) {
  const settingsInput = input.settings && typeof input.settings === 'object' ? input.settings : {};
  return verificationStore.updateVerificationSection(guildId, (section) => ({
    ...section,
    enabled: typeof input.enabled === 'boolean' ? input.enabled : section.enabled,
    settings: verificationStore.normalizeSettings({ ...(section.settings || {}), ...settingsInput }),
    messages: input.messages
      ? verificationStore.normalizeMessages({ ...(section.messages || {}), ...input.messages })
      : section.messages,
    updatedAt: new Date().toISOString(),
  }), meta);
}

function setVerificationEnabled(guildId, enabled = true, meta = {}) {
  return configureVerification(guildId, { enabled: enabled === true }, meta);
}

async function fetchPanelMessage(guild, panel) {
  if (!guild || !panel?.channelId || !panel?.messageId) return null;
  const channel = guild.channels.cache.get(panel.channelId) || await guild.channels.fetch(panel.channelId).catch(() => null);
  if (!channel?.messages?.fetch) return null;
  return channel.messages.fetch(panel.messageId).catch(() => null);
}

async function deployVerificationPanel(channel, input = {}, meta = {}) {
  if (!channel?.guild?.id || !channel?.send) throw new Error('A sendable channel is required.');
  const section = getEffectiveVerificationSection(channel.guild.id);
  if (section.enabled !== true) throw new Error('Verification module is disabled.');
  if (!section.settings?.verifiedRoleIds?.length) throw new Error('Choose at least one verified role before deploying verification.');

  const existingPanel = input.panelId ? verificationStore.getPanel(channel.guild.id, input.panelId) : null;
  const template = verificationStore.normalizePanelTemplate({
    ...(section.panelTemplate || {}),
    ...(existingPanel || {}),
    ...(input || {}),
  });
  const panel = verificationStore.savePanel(channel.guild.id, {
    ...(existingPanel || {}),
    ...template,
    panelId: input.panelId || existingPanel?.panelId,
    channelId: channel.id,
    createdBy: input.createdBy || existingPanel?.createdBy,
  }, meta);

  const existingMessage = await fetchPanelMessage(channel.guild, panel);
  const payload = { embeds: [buildVerificationEmbed(panel)], components: buildVerificationRows(panel) };
  const message = existingMessage?.editable ? await existingMessage.edit(payload) : await channel.send(payload);

  return verificationStore.savePanel(channel.guild.id, {
    ...panel,
    channelId: message.channelId || channel.id,
    messageId: message.id,
    lastDeployedAt: new Date().toISOString(),
  }, meta);
}

async function refreshVerificationPanel(guild, panelId, input = {}, meta = {}) {
  if (!guild?.id) throw new Error('Guild is unavailable.');
  const panel = verificationStore.getPanel(guild.id, panelId);
  if (!panel) throw new Error('Verification panel not found.');
  const channelId = input.channelId || panel.channelId;
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.send) throw new Error('Panel channel is unavailable or not sendable.');
  return deployVerificationPanel(channel, { ...panel, ...input, panelId: panel.panelId }, meta);
}

async function deleteVerificationPanel(guild, panelId, meta = {}) {
  const panel = verificationStore.getPanel(guild.id, panelId);
  if (!panel) throw new Error('Verification panel not found.');
  const message = await fetchPanelMessage(guild, panel);
  if (message?.deletable) await message.delete().catch(() => null);
  return verificationStore.deletePanel(guild.id, panelId, meta);
}

async function getPanelHealth(guild, panel) {
  if (!panel) return { ok: false, status: 'Missing panel record' };
  const channel = panel.channelId
    ? guild.channels.cache.get(panel.channelId) || await guild.channels.fetch(panel.channelId).catch(() => null)
    : null;
  if (!channel) return { ok: false, status: 'Missing channel' };
  const message = await fetchPanelMessage(guild, panel);
  if (!message) return { ok: false, status: 'Missing message' };
  return { ok: true, status: 'Healthy' };
}

async function buildHealthReport(guild) {
  const section = getEffectiveVerificationSection(guild.id);
  const settings = section.settings;
  const verifiedRoles = await fetchRoles(guild, settings.verifiedRoleIds);
  const pendingRoles = await fetchRoles(guild, settings.pendingRoleIds);
  const panels = Object.values(section.panels || {});
  const panelHealth = [];
  for (const panel of panels) panelHealth.push({ panelId: panel.panelId, ...(await getPanelHealth(guild, panel)) });

  const invalidVerified = verifiedRoles.filter((role) => !canBotManageRole(guild, role));
  const invalidPending = pendingRoles.filter((role) => !canBotManageRole(guild, role));
  const screeningEnabled = hasDiscordScreening(guild);
  const warnings = [
    section.enabled !== true ? 'Verification is disabled.' : null,
    !settings.verifiedRoleIds.length ? 'No verified roles are configured.' : null,
    settings.verifiedRoleIds.length !== verifiedRoles.length ? 'One or more verified roles are missing.' : null,
    invalidVerified.length ? 'Goliath cannot manage one or more verified roles.' : null,
    settings.usePendingRoles && !settings.pendingRoleIds.length ? 'Pending roles are enabled but no pending roles are selected.' : null,
    settings.requirePendingRole && !settings.usePendingRoles ? 'Require Pending Role is enabled while Pending Roles are disabled.' : null,
    settings.assignPendingRoles && !settings.usePendingRoles ? 'Assign Pending Roles is enabled while Pending Roles are disabled.' : null,
    settings.usePendingRoles && settings.pendingRoleIds.length !== pendingRoles.length ? 'One or more pending roles are missing.' : null,
    invalidPending.length ? 'Goliath cannot manage one or more pending roles.' : null,
    settings.waitForDiscordScreening && !screeningEnabled && !settings.skipScreeningIfUnavailable
      ? 'Discord Membership Screening is required but not configured.'
      : null,
    panels.length === 0 ? 'No verification panel deployed.' : null,
    ...panelHealth.filter((panel) => !panel.ok).map((panel) => `${panel.panelId}: ${panel.status}`),
  ].filter(Boolean);

  return {
    enabled: section.enabled === true,
    screeningEnabled,
    waitForDiscordScreening: settings.waitForDiscordScreening,
    hasVerifiedRole: verifiedRoles.length > 0,
    verifiedRoleCount: verifiedRoles.length,
    hasPendingRole: pendingRoles.length > 0,
    pendingRoleCount: pendingRoles.length,
    hasLogChannel: Boolean(settings.logChannelId),
    panels: panelHealth,
    warnings,
  };
}

async function handleVerificationInteraction(interaction) {
  const parsed = parseVerifyCustomId(interaction?.customId);
  if (!parsed || !interaction?.guildId) return false;
  const result = await verifyMember(interaction);
  await interaction.reply({
    content: result.ok ? `✅ ${result.message}` : `❌ ${result.message}`,
    flags: 64,
  }).catch(() => null);
  return true;
}

module.exports = {
  CUSTOM_ID_PREFIX,
  SCREENING_FEATURE,
  canManageVerification,
  canBotManageRole,
  canBotManageMember,
  hasDiscordScreening,
  buildVerifyCustomId,
  parseVerifyCustomId,
  buildVerificationEmbed,
  buildVerificationRows,
  configureVerification,
  setVerificationEnabled,
  toggleVerification,
  getVerificationStatus,
  updateVerificationSettings,
  updateVerificationMessages,
  updatePanelTemplate,
  assignPendingRoles,
  handleMemberJoin,
  handleMemberUpdate,
  deployVerificationPanel,
  refreshVerificationPanel,
  deleteVerificationPanel,
  getPanelHealth,
  buildHealthReport,
  verifyMember,
  handleVerificationInteraction,
  renderMessage,
};
