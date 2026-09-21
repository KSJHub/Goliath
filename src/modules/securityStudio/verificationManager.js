'use strict';

// src/modules/securityStudio/verificationManager.js

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');

const verificationStore = require('./verificationStore');
const guildManager = require('../../core/guild/guildManager');
const guildVariables = require('../../core/guild/guildVariables');
const testDevOverride = require('../../owner/dev/DevOverrideManager');
const emojiPayload = require('../utilityStudio/emojis/emojiPayload');

const CUSTOM_ID_PREFIX = 'verify';
const SCREENING_FEATURE = 'MEMBER_VERIFICATION_GATE_ENABLED';
const MODULE = 'verification';
const BUTTON_STYLES = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
};

// Backwards-compatible export for Verification Panel consumers. The catalogue
// itself is owned by core/guild/guildVariables and is no longer duplicated here.
const DEFAULT_HELPERS = guildVariables.HELPERS;

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
  const { isBotOwner } = require('../../core/security/protection/core');
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

function formatDate(value) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return '';
  }
}

function formatTimestamp(value) {
  const milliseconds = value instanceof Date ? value.getTime() : Number(value);
  const seconds = Math.floor(milliseconds / 1000);
  return Number.isFinite(seconds) && seconds > 0 ? `<t:${seconds}:R>` : '';
}

function formatDuration(milliseconds) {
  const total = Math.max(0, Number(milliseconds) || 0);
  const days = Math.floor(total / 86400000);
  const years = Math.floor(days / 365);
  const months = Math.floor((days % 365) / 30);
  const remainingDays = (days % 365) % 30;
  const parts = [];
  if (years) parts.push(`${years} year${years === 1 ? '' : 's'}`);
  if (months) parts.push(`${months} month${months === 1 ? '' : 's'}`);
  if (!years && remainingDays) parts.push(`${remainingDays} day${remainingDays === 1 ? '' : 's'}`);
  return parts.length ? parts.join(', ') : 'less than a day';
}

function userAvatar(user) {
  return user?.displayAvatarURL?.({ extension: 'png', size: 256 }) || '';
}

function serverAvatar(member, user) {
  return member?.displayAvatarURL?.({ extension: 'png', size: 256 }) || userAvatar(user);
}

function guildIcon(guild) {
  return guild?.iconURL?.({ extension: 'png', size: 256 }) || '';
}

function guildBanner(guild) {
  return guild?.bannerURL?.({ extension: 'png', size: 1024 }) || '';
}

function templateReplacements(member, guildInput, values = {}) {
  const guild = guildInput || member?.guild || null;
  const user = member?.user || values.user || null;
  const userId = member?.id || user?.id || '';
  const nowMs = Date.now();
  const now = `<t:${Math.floor(nowMs / 1000)}:R>`;
  const icon = guildIcon(guild);
  const banner = guildBanner(guild);
  const createdTimestamp = user?.createdTimestamp || 0;
  const joinedTimestamp = member?.joinedTimestamp || 0;
  const display = member?.displayName || user?.globalName || user?.displayName || user?.username || '';
  const nickname = member?.nickname || display;
  const avatar = userAvatar(user);
  const serverUserAvatar = serverAvatar(member, user);
  const unavailable = undefined;

  return {
    user: userId ? `<@${userId}>` : unavailable,
    username: user?.username || unavailable,
    serverId: guild?.id || unavailable,
    userId: userId || unavailable,
    userTag: user ? (user.tag || user.username || '') : unavailable,
    userName: user?.username || unavailable,
    userGlobalName: user ? (user.globalName || user.username || '') : unavailable,
    userMention: userId ? `<@${userId}>` : unavailable,
    userNoPing: userId ? `<@${userId}>` : unavailable,
    userAvatar: avatar || unavailable,
    userServerAvatar: serverUserAvatar || unavailable,
    userNickname: nickname || unavailable,
    userDisplay: display || unavailable,
    userCreatedAt: user ? formatDate(user.createdAt) : unavailable,
    userCreatedTimestamp: createdTimestamp ? formatTimestamp(createdTimestamp) : unavailable,
    userJoinedAt: member ? formatDate(member.joinedAt) : unavailable,
    userJoinedTimestamp: joinedTimestamp ? formatTimestamp(joinedTimestamp) : unavailable,
    createdAt: createdTimestamp ? formatTimestamp(createdTimestamp) : unavailable,
    joinedAt: joinedTimestamp ? formatTimestamp(joinedTimestamp) : unavailable,
    leftAt: values.leftAt || now,
    timestamp: values.timestamp || now,
    accountAge: user && createdTimestamp ? formatDuration(nowMs - createdTimestamp) : unavailable,
    membershipDuration: member && joinedTimestamp ? formatDuration(nowMs - joinedTimestamp) : unavailable,
    departureIcon: values.departureIcon ?? '👋',
    departureType: values.departureType ?? 'left',
    departureLabel: values.departureLabel ?? 'Left Voluntarily',
    departureReason: values.departureReason ?? 'No reason — the member left voluntarily.',
    departureModerator: values.departureModerator ?? 'Not applicable',
    departureModeratorId: values.departureModeratorId ?? 'Not applicable',
    nowTimestamp: now,
    successEmoji: '✅',
    warningEmoji: '⚠️',
    errorEmoji: '❌',
    proofVerifiedEmoji: '💎',
    successColor: '#57F287',
    warningColor: '#FEE75C',
    errorColor: '#ED4245',
    proofVerifiedColor: '#00D4FF',
    guildId: guild?.id || unavailable,
    guildName: guild?.name || unavailable,
    server: guild?.name || unavailable,
    guildIcon: icon || unavailable,
    serverIcon: icon || unavailable,
    guildBanner: banner || unavailable,
    guildMemberCount: guild ? String(guild.memberCount || 0) : unavailable,
    memberCount: guild ? String(guild.memberCount || 0) : unavailable,
    guildVanityCode: guild ? (guild.vanityURLCode || '') : unavailable,
    verifiedRoles: values.verifiedRoles ?? '',
    pendingRoles: values.pendingRoles ?? '',
    minimumAccountAgeDays: values.minimumAccountAgeDays ?? '',
    minimumMembershipAgeMinutes: values.minimumMembershipAgeMinutes ?? '',
    cooldownSeconds: values.cooldownSeconds ?? '',
    attempts: values.attempts ?? '',
    reason: values.reason ?? '',
    ...values,
  };
}

function renderTemplate(template, member = null, guild = null, values = {}) {
  const replacements = templateReplacements(member, guild, values);
  return String(template || '').replace(/\{([a-zA-Z0-9_]+)\}/g, (token, key) => {
    if (!Object.prototype.hasOwnProperty.call(replacements, key)) return token;
    const value = replacements[key];
    return value === undefined || value === null ? token : String(value);
  });
}

function buildVerificationEmbed(panel = {}, guild = null, member = null, values = {}) {
  const color = renderTemplate(panel.color || '#57f287', member, guild, values);
  const title = renderTemplate(panel.title || 'Member Verification', member, guild, values);
  const description = renderTemplate(
    panel.description || 'Press the button below to complete server onboarding.',
    member,
    guild,
    values
  );
  const footer = renderTemplate(panel.footer || 'Goliath Verification', member, guild, values);
  const thumbnailUrl = renderTemplate(panel.thumbnailUrl || '', member, guild, values);
  const imageUrl = renderTemplate(panel.imageUrl || '', member, guild, values);

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: footer })
    .setTimestamp(new Date());
  if (/^https?:\/\//i.test(thumbnailUrl)) embed.setThumbnail(thumbnailUrl);
  if (/^https?:\/\//i.test(imageUrl)) embed.setImage(imageUrl);
  return embed;
}

function buildVerificationRows(panel = {}, guild = null, member = null, values = {}) {
  const button = new ButtonBuilder()
    .setCustomId(buildVerifyCustomId(panel.panelId || panel.id))
    .setLabel(renderTemplate(panel.buttonLabel || 'Verify', member, guild, values).slice(0, 80))
    .setStyle(BUTTON_STYLES[panel.buttonStyle] || ButtonStyle.Success);
  const emoji = renderTemplate(panel.buttonEmoji || '', member, guild, values).trim();
  if (emoji) button.setEmoji(emoji);
  return [new ActionRowBuilder().addComponents(button)];
}

async function resolveVerificationPanelPayload(guild, payload) {
  if (!guild?.client || !guild?.id) return payload;
  return emojiPayload.resolveMessagePayload(guild.client, guild.id, payload, 'verification');
}

function getEffectiveVerificationSection(guildId) {
  const section = verificationStore.getVerificationSection(guildId);
  const settings = verificationStore.normalizeSettings(section.settings || {});
  return {
    ...section,
    enabled: guildManager.isModuleEnabled(guildId, MODULE),
    settings,
  };
}

function toggleVerification(guildId, meta = {}) {
  return setVerificationEnabled(guildId, !guildManager.isModuleEnabled(guildId, MODULE), {
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
  return verificationStore.updateVerificationSection(guildId, (section) => ({
    ...section,
    messages: { ...(section.messages || {}), ...(messages || {}) },
    updatedAt: new Date().toISOString(),
  }), { action: 'verification_messages_update', ...meta });
}

function updatePanelTemplate(guildId, panelId, patch = {}, meta = {}) {
  const current = verificationStore.getPanel(guildId, panelId);
  if (!current) throw new Error('Verification panel not found.');
  return verificationStore.savePanel(guildId, { ...current, ...patch, panelId: current.panelId }, {
    action: 'verification_panel_template_update',
    ...meta,
  });
}

async function fetchRoles(guild, roleIds = []) {
  const roles = [];
  for (const roleId of cleanDiscordIds(roleIds)) {
    const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
    if (role) roles.push(role);
  }
  return roles;
}

async function assignRoles(member, roles) {
  const assigned = [];
  for (const role of roles) {
    if (!canBotManageRole(member.guild, role)) continue;
    await member.roles.add(role);
    assigned.push(role.id);
  }
  return assigned;
}

async function removeRoles(member, roles) {
  const removed = [];
  for (const role of roles) {
    if (!canBotManageRole(member.guild, role)) continue;
    if (!member.roles.cache.has(role.id)) continue;
    await member.roles.remove(role);
    removed.push(role.id);
  }
  return removed;
}

function roleMentions(roles = []) {
  return roles.map((role) => `<@&${role.id}>`).join(', ');
}

function renderMessage(template, member, values = {}) {
  return renderTemplate(template, member, member?.guild, values);
}

async function assignPendingRoles(member, meta = {}) {
  const section = getEffectiveVerificationSection(member.guild.id);
  const settings = section.settings;
  if (section.enabled !== true || !settings.usePendingRoles || !settings.assignPendingRoles) return [];
  const roles = await fetchRoles(member.guild, settings.pendingRoleIds);
  const assigned = await assignRoles(member, roles);
  if (assigned.length) {
    verificationStore.appendVerificationLog(member.guild.id, {
      type: 'pending_roles_assigned',
      userId: member.id,
      roleIds: assigned,
      ...meta,
    });
  }
  return assigned;
}

async function handleMemberJoin(member) {
  if (!member?.guild?.id) return;
  const section = getEffectiveVerificationSection(member.guild.id);
  if (section.enabled !== true) return;
  await assignPendingRoles(member, { source: 'guildMemberAdd' });
}

async function handleMemberUpdate(oldMember, newMember) {
  if (!newMember?.guild?.id) return;
  const section = getEffectiveVerificationSection(newMember.guild.id);
  if (section.enabled !== true || !section.settings.waitForDiscordScreening) return;
  if (oldMember?.pending === true && newMember.pending === false) {
    await assignPendingRoles(newMember, { source: 'guildMemberUpdate_screening_complete' });
  }
}

function verificationValues(member, section, extra = {}) {
  const settings = section.settings;
  return {
    verifiedRoles: settings.verifiedRoleIds.map((id) => `<@&${id}>`).join(', '),
    pendingRoles: settings.pendingRoleIds.map((id) => `<@&${id}>`).join(', '),
    minimumAccountAgeDays: settings.minimumAccountAgeDays,
    minimumMembershipAgeMinutes: settings.minimumMembershipAgeMinutes,
    cooldownSeconds: settings.cooldownSeconds,
    attempts: verificationStore.getAttemptCount(member.guild.id, member.id),
    ...extra,
  };
}

async function configureVerification(guild, input = {}, meta = {}) {
  if (!guild?.id) throw new Error('Guild is unavailable.');
  const settings = verificationStore.normalizeSettings(input);
  const verifiedRoles = await fetchRoles(guild, settings.verifiedRoleIds);
  const pendingRoles = await fetchRoles(guild, settings.pendingRoleIds);
  const invalidVerified = verifiedRoles.filter((role) => !canBotManageRole(guild, role));
  const invalidPending = pendingRoles.filter((role) => !canBotManageRole(guild, role));

  if (!verifiedRoles.length) throw new Error('At least one valid verified role is required.');
  if (verifiedRoles.length !== settings.verifiedRoleIds.length) throw new Error('One or more verified roles do not exist.');
  if (invalidVerified.length) throw new Error('Goliath cannot manage one or more verified roles.');
  if (settings.usePendingRoles && !pendingRoles.length) throw new Error('At least one valid pending role is required when Pending Roles is enabled.');
  if (settings.usePendingRoles && pendingRoles.length !== settings.pendingRoleIds.length) throw new Error('One or more pending roles do not exist.');
  if (invalidPending.length) throw new Error('Goliath cannot manage one or more pending roles.');
  if (settings.requirePendingRole && !settings.usePendingRoles) throw new Error('Require Pending Role requires Pending Roles to be enabled.');
  if (settings.assignPendingRoles && !settings.usePendingRoles) throw new Error('Assign Pending Roles requires Pending Roles to be enabled.');
  if (settings.waitForDiscordScreening && !hasDiscordScreening(guild) && !settings.skipScreeningIfUnavailable) {
    throw new Error('Discord Membership Screening is required but is not enabled for this server.');
  }

  return verificationStore.updateVerificationSection(guild.id, (section) => ({
    ...section,
    settings,
    updatedAt: new Date().toISOString(),
  }), { action: 'verification_configure', ...meta });
}

function setVerificationEnabled(guildId, enabled, meta = {}) {
  return guildManager.setModuleEnabled(guildId, MODULE, enabled === true, {
    action: enabled === true ? 'verification_enable' : 'verification_disable',
    ...meta,
  });
}

async function verifyMember(interaction) {
  const member = interaction?.member;
  const guild = interaction?.guild;
  if (!member || !guild) return { ok: false, message: 'Verification is unavailable outside a server.' };
  const section = getEffectiveVerificationSection(guild.id);
  if (section.enabled !== true) return { ok: false, message: 'Verification is currently disabled.' };
  const settings = section.settings;
  const now = Date.now();
  const values = verificationValues(member, section);

  if (settings.waitForDiscordScreening && member.pending === true) {
    return { ok: false, message: renderMessage(section.messages.screeningPending, member, values) };
  }
  if (settings.requirePendingRole && !settings.pendingRoleIds.some((roleId) => member.roles.cache.has(roleId))) {
    return { ok: false, message: renderMessage(section.messages.pendingRoleRequired, member, values) };
  }
  if (settings.minimumAccountAgeDays > 0) {
    const accountAgeMs = now - (member.user?.createdTimestamp || 0);
    if (accountAgeMs < settings.minimumAccountAgeDays * 86400000) {
      return { ok: false, message: renderMessage(section.messages.accountTooNew, member, values) };
    }
  }
  if (settings.minimumMembershipAgeMinutes > 0) {
    const membershipAgeMs = now - (member.joinedTimestamp || 0);
    if (membershipAgeMs < settings.minimumMembershipAgeMinutes * 60000) {
      return { ok: false, message: renderMessage(section.messages.membershipTooNew, member, values) };
    }
  }

  const attempt = verificationStore.recordAttempt(guild.id, member.id, settings.cooldownSeconds);
  if (!attempt.allowed) {
    return { ok: false, message: renderMessage(section.messages.cooldown, member, {
      ...values,
      cooldownSeconds: attempt.retryAfterSeconds,
      attempts: attempt.attempts,
    }) };
  }

  const verifiedRoles = await fetchRoles(guild, settings.verifiedRoleIds);
  const pendingRoles = await fetchRoles(guild, settings.pendingRoleIds);
  const assigned = await assignRoles(member, verifiedRoles);
  const removed = settings.removePendingRolesOnVerify ? await removeRoles(member, pendingRoles) : [];

  if (!assigned.length && !settings.verifiedRoleIds.every((id) => member.roles.cache.has(id))) {
    return { ok: false, message: renderMessage(section.messages.failed, member, {
      ...values,
      reason: 'Goliath could not assign the configured verified roles.',
    }) };
  }

  verificationStore.appendVerificationLog(guild.id, {
    type: 'verified',
    userId: member.id,
    verifiedRoleIds: settings.verifiedRoleIds,
    removedPendingRoleIds: removed,
    attempts: attempt.attempts,
  });

  return { ok: true, message: renderMessage(section.messages.success, member, {
    ...values,
    verifiedRoles: roleMentions(verifiedRoles),
    pendingRoles: roleMentions(pendingRoles),
    attempts: attempt.attempts,
  }) };
}

async function fetchPanelMessage(guild, panel) {
  if (!panel?.channelId || !panel?.messageId) return null;
  const channel = guild.channels.cache.get(panel.channelId) || await guild.channels.fetch(panel.channelId).catch(() => null);
  if (!channel?.messages?.fetch) return null;
  return channel.messages.fetch(panel.messageId).catch(() => null);
}

async function restoreMissingVerificationPanel(guild, panelId, meta = {}) {
  if (!guild?.id) throw new Error('Guild is unavailable.');
  const panel = verificationStore.getPanel(guild.id, panelId);
  if (!panel) throw new Error('Verification panel not found.');
  const channel = panel.channelId
    ? guild.channels.cache.get(panel.channelId) || await guild.channels.fetch(panel.channelId).catch(() => null)
    : null;
  if (!channel?.send) throw new Error('Panel channel is unavailable or not sendable.');

  const payload = await resolveVerificationPanelPayload(guild, {
    embeds: [buildVerificationEmbed(panel, guild)],
    components: buildVerificationRows(panel, guild),
  });
  const message = await channel.send(payload);
  return verificationStore.savePanel(guild.id, {
    ...panel,
    channelId: message.channelId || channel.id,
    messageId: message.id,
    enabled: true,
    lastDeployedAt: new Date().toISOString(),
  }, { action: 'verification_panel_restore', ...meta });
}

async function deployVerificationPanel(channel, input = {}, meta = {}) {
  if (!channel?.guild?.id || !channel?.send) throw new Error('A sendable guild channel is required.');
  const guild = channel.guild;
  const panelId = String(input.panelId || input.id || `panel-${Date.now()}`).trim();
  const existing = verificationStore.getPanel(guild.id, panelId);
  const candidate = {
    ...(existing || {}),
    ...input,
    panelId,
    channelId: channel.id,
  };
  const payload = await resolveVerificationPanelPayload(guild, {
    embeds: [buildVerificationEmbed(candidate, guild)],
    components: buildVerificationRows(candidate, guild),
  });

  if (existing?.messageId) {
    const oldMessage = await fetchPanelMessage(guild, existing);
    if (oldMessage) {
      try {
        await oldMessage.edit(payload);
        return verificationStore.savePanel(guild.id, {
          ...candidate,
          messageId: oldMessage.id,
          enabled: true,
          lastDeployedAt: new Date().toISOString(),
        }, { action: 'verification_panel_redeploy', ...meta });
      } catch (error) {
        throw new Error(`Verification panel redeploy failed; existing deployment preserved: ${error.message}`);
      }
    }
  }

  let stagedPanel;
  try {
    stagedPanel = verificationStore.savePanel(guild.id, {
      ...candidate,
      messageId: null,
      enabled: false,
    }, { action: 'verification_panel_stage', ...meta });
  } catch (error) {
    throw new Error(`Verification panel deployment aborted before Discord send: ${error.message}`);
  }

  let message = null;
  try {
    message = await channel.send(payload);
    return verificationStore.savePanel(guild.id, {
      ...stagedPanel,
      ...candidate,
      channelId: message.channelId || channel.id,
      messageId: message.id,
      enabled: true,
      lastDeployedAt: new Date().toISOString(),
    }, { action: 'verification_panel_activate', ...meta });
  } catch (error) {
    if (message?.deletable) {
      await message.delete().catch((cleanupError) => {
        console.error('[Verification] Failed to remove uncommitted replacement panel message', {
          guildId,
          panelId,
          messageId: message.id,
          error: cleanupError,
        });
      });
    }
    try {
      verificationStore.deletePanel(guild.id, panelId, { action: 'verification_panel_stage_rollback', ...meta });
    } catch (cleanupError) {
      console.error('[Verification] Failed to remove staged panel record after deployment failure', {
        guildId,
        panelId,
        error: cleanupError,
      });
    }
    throw error;
  }
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
  if (!guild?.id) throw new Error('Guild is unavailable.');
  const section = getEffectiveVerificationSection(guild.id);
  const panel = section.panels?.[String(panelId || '')] || verificationStore.getPanel(guild.id, panelId);
  if (!panel) throw new Error('Verification panel not found.');

  if (section.enabled === true && section.activePanelId === panel.panelId) {
    throw new Error('Cannot delete the active verification panel while Verification is enabled. Deploy a replacement first or disable Verification.');
  }

  const message = await fetchPanelMessage(guild, panel);
  if (message && !message.deletable) {
    throw new Error('Verification panel message cannot be deleted. The saved panel record was preserved.');
  }
  if (message) await message.delete();
  return verificationStore.deletePanel(guild.id, panel.panelId, meta);
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
  const panels = Object.values(section.panels || {});
  const [verifiedRoles, pendingRoles, panelHealth] = await Promise.all([
    fetchRoles(guild, settings.verifiedRoleIds),
    fetchRoles(guild, settings.pendingRoleIds),
    Promise.all(panels.map(async (panel) => ({
      panelId: panel.panelId,
      ...(await getPanelHealth(guild, panel)),
    }))),
  ]);

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
    content: result.ok ? `\u2705 ${result.message}` : `\u274C ${result.message}`,
    flags: 64,
  }).catch(() => null);
  return true;
}

module.exports = {
  CUSTOM_ID_PREFIX,
  SCREENING_FEATURE,
  DEFAULT_HELPERS,
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
  restoreMissingVerificationPanel,
  deleteVerificationPanel,
  getPanelHealth,
  buildHealthReport,
  verifyMember,
  handleVerificationInteraction,
  renderMessage,
  renderTemplate,
};