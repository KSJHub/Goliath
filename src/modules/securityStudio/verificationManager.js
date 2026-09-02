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
const testDevOverride = require('../../owner/dev/DevOverrideManager');

const CUSTOM_ID_PREFIX = 'verify';
const SCREENING_FEATURE = 'MEMBER_VERIFICATION_GATE_ENABLED';
const MODULE = 'verification';
const BUTTON_STYLES = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
};

const DEFAULT_HELPERS = [
  '{userId}',
  '{userTag}',
  '{userName}',
  '{userGlobalName}',
  '{userMention}',
  '{userNoPing}',
  '{userAvatar}',
  '{userServerAvatar}',
  '{userNickname}',
  '{userDisplay}',
  '{userCreatedAt}',
  '{userCreatedTimestamp}',
  '{userJoinedAt}',
  '{userJoinedTimestamp}',
  '{createdAt}',
  '{joinedAt}',
  '{leftAt}',
  '{timestamp}',
  '{accountAge}',
  '{membershipDuration}',
  '{departureIcon}',
  '{departureType}',
  '{departureLabel}',
  '{departureReason}',
  '{departureModerator}',
  '{departureModeratorId}',
  '{nowTimestamp}',
  '{successEmoji}',
  '{warningEmoji}',
  '{errorEmoji}',
  '{proofVerifiedEmoji}',
  '{successColor}',
  '{warningColor}',
  '{errorColor}',
  '{proofVerifiedColor}',
  '{guildId}',
  '{guildName}',
  '{server}',
  '{guildIcon}',
  '{serverIcon}',
  '{guildBanner}',
  '{guildMemberCount}',
  '{memberCount}',
  '{guildVanityCode}',
];

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
  return renderTemplate(template, member, member?.guild || null, values);
}

async function fetchRole(guild, roleId) {
  if (!guild || !roleId) return null;
  return guild.roles.cache.get(roleId) || guild.roles.fetch(roleId).catch(() => null);
}

async function fetchRoles(guild, roleIds = []) {
  const ids = cleanDiscordIds(roleIds);
  const roles = await Promise.all(ids.map((roleId) => fetchRole(guild, roleId)));
  return roles.filter(Boolean);
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

async function assignPendingRoles(member, reason = 'Goliath pending verification role assigned') {
  const section = getEffectiveVerificationSection(member.guild.id);
  const settings = section.settings;
  if (section.enabled !== true || !settings.usePendingRoles || !settings.assignPendingRoles) {
    return { assigned: [], failed: [], skipped: true };
  }
  const roles = await fetchRoles(member.guild, settings.pendingRoleIds);
  const assigned = [];
  const failed = [];
  for (const role of roles) {
    const status = resolveRoleActionStatus(member.guild, member, role, 'add');
    if (!status.ok) {
      failed.push({
        roleId: role.id,
        reason: status.message,
      });
      continue;
    }
    if (status.skipped) continue;
    try {
      await member.roles.add(role, reason);
      if (member.roles.cache.has(role.id)) assigned.push(role);
      else failed.push({ roleId: role.id, reason: 'role was not present after assignment' });
    } catch (error) {
      const failureReason = error?.message || 'Discord rejected the pending role assignment';
      failed.push({ roleId: role.id, reason: failureReason });
      console.warn('[Verification] Pending role assignment failed', {
        guildId: member.guild.id,
        userId: member.id,
        roleId: role.id,
        error: failureReason,
      });
    }
  }
  if (assigned.length) {
    verificationStore.incrementAnalytics(member.guild.id, { pendingRolesAssigned: assigned.length });
    if (settings.dmOnPendingRole) {
      const message = renderMessage(section.messages.pendingAssigned, member, {
        pendingRoles: roleMentions(assigned),
      });
      await member.send(message).catch(() => null);
    }
  }
  return { assigned, failed, skipped: false };
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
    : { assigned: [], failed: [], skipped: true };
  return { handled: true, screeningCompleted: true, ...result };
}

async function failVerification(guildId, section, member, messageKey, values = {}, analytics = {}, options = {}) {
  const reason = renderMessage(section.messages[messageKey] || section.messages.failed, member, values);
  const countFailure = options.countFailure !== false;
  const logFailure = options.logFailure !== false;

  if (countFailure) {
    verificationStore.recordAttempt(guildId, member.id, { failed: true });
    verificationStore.incrementAnalytics(guildId, { failed: 1, ...analytics });
  } else if (Object.keys(analytics || {}).length) {
    verificationStore.incrementAnalytics(guildId, analytics);
  }

  if (section.settings.logFailure && logFailure) {
    await sendVerificationLog(member.guild, section, renderMessage(section.messages.failureLog, member, {
      ...values,
      reason: values.reason || reason,
    }));
  }
  return { ok: false, message: reason };
}

function getRequestedPanelId(interaction) {
  if (interaction?.panelId) return String(interaction.panelId);
  return parseVerifyCustomId(interaction?.customId)?.panelId || null;
}

function getActivePanel(guildId, panelId, context = {}) {
  if (!panelId) return null;
  const section = verificationStore.getVerificationSection(guildId);
  if (!section.activePanelId || section.activePanelId !== panelId) return null;
  const panel = section.panels?.[panelId] || null;
  if (!panel || panel.enabled === false || panel.deletedAt || panel.retiredAt) return null;

  const messageId = cleanDiscordId(context.messageId || context.message?.id);
  const channelId = cleanDiscordId(context.channelId || context.channel?.id);
  if (panel.messageId && messageId && panel.messageId !== messageId) return null;
  if (panel.channelId && channelId && panel.channelId !== channelId) return null;
  return panel;
}

async function reconcileAlreadyVerifiedMember(member, settings, verifiedRoles, pendingRoles) {
  const guild = member.guild;
  const issues = [];
  if (!canBotManageMember(member)) {
    return { member, issues: ['member hierarchy prevents reconciliation'] };
  }

  for (const role of verifiedRoles) {
    if (member.roles.cache.has(role.id)) continue;
    const status = resolveRoleActionStatus(guild, member, role, 'add');
    if (!status.ok) {
      issues.push(status.message);
      continue;
    }
    try {
      await member.roles.add(role, 'Goliath verification state reconciliation');
    } catch (error) {
      issues.push(error?.message || `failed to add ${role.name}`);
    }
  }

  if (settings.usePendingRoles && settings.removePendingRoles) {
    for (const role of pendingRoles) {
      if (!member.roles.cache.has(role.id)) continue;
      const status = resolveRoleActionStatus(guild, member, role, 'remove');
      if (!status.ok) {
        issues.push(status.message);
        continue;
      }
      try {
        await member.roles.remove(role, 'Goliath verification state reconciliation');
      } catch (error) {
        issues.push(error?.message || `failed to remove ${role.name}`);
      }
    }
  }

  const refreshed = await guild.members.fetch({ user: member.id, force: true }).catch(() => member);
  return { member: refreshed, issues };
}

async function verifyMember(interaction) {
  const guild = interaction?.guild;
  const guildId = interaction?.guildId || guild?.id;
  if (!guildId || !guild) return { ok: false, message: 'Server unavailable.' };

  const panelId = getRequestedPanelId(interaction);
  const panel = getActivePanel(guildId, panelId, interaction);
  if (!panel) {
    return { ok: false, message: 'This verification panel is no longer active. Please use the current verification panel.' };
  }

  const section = getEffectiveVerificationSection(guildId);
  const userId = interaction?.user?.id || interaction?.member?.id;
  const member = userId
    ? await guild.members.fetch({ user: userId, force: true }).catch(() => interaction?.member || null)
    : null;
  if (!member) return { ok: false, message: 'Member not found.' };

  const settings = section.settings;
  const messages = section.messages;
  const bypass = isStaffBypass(member, settings);
  const [verifiedRoles, pendingRoles] = await Promise.all([
    fetchRoles(guild, settings.verifiedRoleIds),
    fetchRoles(guild, settings.pendingRoleIds),
  ]);
  const alreadyVerified = verifiedRoles.length > 0 && verifiedRoles.some((role) => member.roles.cache.has(role.id));

  if (section.enabled !== true) {
    return failVerification(guildId, section, member, 'unavailable', {}, { unavailable: 1 }, {
      countFailure: false,
      logFailure: false,
    });
  }

  if (settings.blockBots && member.user?.bot && !bypass) {
    return failVerification(guildId, section, member, 'botBlocked', {}, { botBlocked: 1 });
  }

  if (alreadyVerified) {
    const reconciled = await reconcileAlreadyVerifiedMember(member, settings, verifiedRoles, pendingRoles);
    if (reconciled.issues.length) {
      console.warn('[Verification] Already-verified reconciliation incomplete', {
        guildId,
        userId: member.id,
        issues: reconciled.issues,
      });
    }
    verificationStore.clearAttempts(guildId, member.id);
    verificationStore.incrementAnalytics(guildId, { alreadyVerified: 1 });
    return { ok: true, message: renderMessage(messages.alreadyVerified, reconciled.member) };
  }

  if (!settings.verifiedRoleIds.length || settings.verifiedRoleIds.length !== verifiedRoles.length) {
    return failVerification(guildId, section, member, 'unavailable', {
      reason: 'one or more configured verified roles are unavailable',
    }, { unavailable: 1 }, { countFailure: false, logFailure: false });
  }

  const pendingRolesRequiredByFlow = settings.usePendingRoles && (
    settings.requirePendingRole || settings.assignPendingRoles || settings.removePendingRoles
  );
  if (pendingRolesRequiredByFlow && settings.pendingRoleIds.length !== pendingRoles.length) {
    return failVerification(guildId, section, member, 'unavailable', {
      reason: 'one or more configured pending roles are unavailable',
    }, { unavailable: 1 }, { countFailure: false, logFailure: false });
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
      verificationStore.incrementAnalytics(guildId, { requirementBlocked: 1 });
      return {
        ok: false,
        message: renderMessage(messages.failed, member, { reason: attemptBlock.reason }),
      };
    }

    const screeningAvailable = hasDiscordScreening(guild);
    if (settings.waitForDiscordScreening) {
      if (screeningAvailable && member.pending === true) {
        return failVerification(guildId, section, member, 'screeningRequired', {}, { screeningBlocked: 1 }, {
          countFailure: false,
          logFailure: false,
        });
      }
      if (!screeningAvailable && !settings.skipScreeningIfUnavailable) {
        return failVerification(guildId, section, member, 'screeningRequired', {
          reason: 'Discord Membership Screening is not configured',
        }, { screeningBlocked: 1 }, { countFailure: false, logFailure: false });
      }
    }

    if (settings.usePendingRoles && settings.requirePendingRole) {
      const hasRequiredPendingRole = pendingRoles.some((role) => member.roles.cache.has(role.id));
      if (!hasRequiredPendingRole) {
        return failVerification(guildId, section, member, 'pendingRoleRequired', {
          pendingRoles: roleMentions(pendingRoles),
        }, { requirementBlocked: 1 }, { countFailure: false, logFailure: false });
      }
    }

    if (settings.minimumAccountAgeDays > 0 && accountAgeDays(member) < settings.minimumAccountAgeDays) {
      return failVerification(guildId, section, member, 'accountTooNew', {
        minimumAccountAgeDays: settings.minimumAccountAgeDays,
      }, { accountAgeBlocked: 1, requirementBlocked: 1 }, { countFailure: false, logFailure: false });
    }

    if (settings.minimumMembershipAgeMinutes > 0 && membershipAgeMinutes(member) < settings.minimumMembershipAgeMinutes) {
      return failVerification(guildId, section, member, 'membershipTooNew', {
        minimumMembershipAgeMinutes: settings.minimumMembershipAgeMinutes,
      }, { membershipAgeBlocked: 1, requirementBlocked: 1 }, { countFailure: false, logFailure: false });
    }
  }

  if (!canBotManageMember(member)) {
    return failVerification(guildId, section, member, 'failed', {
      reason: 'Goliath cannot manage this member',
    }, { roleManageFailed: 1 }, { countFailure: false });
  }

  for (const role of verifiedRoles) {
    const status = resolveRoleActionStatus(guild, member, role, 'add');
    if (!status.ok) {
      return failVerification(guildId, section, member, 'failed', { reason: status.message }, { roleManageFailed: 1 }, {
        countFailure: false,
      });
    }
  }

  if (settings.usePendingRoles && settings.removePendingRoles) {
    for (const role of pendingRoles) {
      const status = resolveRoleActionStatus(guild, member, role, 'remove');
      if (!status.ok) {
        return failVerification(guildId, section, member, 'failed', { reason: status.message }, { roleManageFailed: 1 }, {
          countFailure: false,
        });
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

    const refreshedMember = await guild.members.fetch({ user: member.id, force: true });
    const missingVerifiedRoles = verifiedRoles.filter((role) => !refreshedMember.roles.cache.has(role.id));
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
    console.error('[Verification] Role update failed', { guildId, userId: member.id, error });
    return failVerification(guildId, section, member, 'failed', { reason }, { roleManageFailed: 1 }, {
      countFailure: false,
    });
  }
}

function configureVerification(guildId, input = {}, meta = {}) {
  const settingsInput = input.settings && typeof input.settings === 'object' ? input.settings : {};
  if (typeof input.enabled === 'boolean') {
    guildManager.setModuleEnabled(guildId, MODULE, input.enabled, meta);
  }
  verificationStore.updateVerificationSection(guildId, (section) => ({
    ...section,
    settings: verificationStore.normalizeSettings({ ...(section.settings || {}), ...settingsInput }),
    messages: input.messages
      ? verificationStore.normalizeMessages({ ...(section.messages || {}), ...input.messages })
      : section.messages,
    updatedAt: new Date().toISOString(),
  }), meta);
  return getEffectiveVerificationSection(guildId);
}

function setVerificationEnabled(guildId, enabled = true, meta = {}) {
  guildManager.setModuleEnabled(guildId, MODULE, enabled === true, meta);
  return getEffectiveVerificationSection(guildId);
}

async function fetchPanelMessage(guild, panel) {
  if (!guild || !panel?.channelId || !panel?.messageId) return null;
  const channel = guild.channels.cache.get(panel.channelId) || await guild.channels.fetch(panel.channelId).catch(() => null);
  if (!channel?.messages?.fetch) return null;
  return channel.messages.fetch(panel.messageId).catch(() => null);
}

function snapshotMessagePayload(message) {
  if (!message) return null;
  return {
    embeds: Array.isArray(message.embeds) ? message.embeds.map((embed) => embed.toJSON()) : [],
    components: Array.isArray(message.components) ? message.components.map((component) => component.toJSON()) : [],
  };
}

async function restoreMissingVerificationPanel(guild, panelId, meta = {}) {
  if (!guild?.id) throw new Error('Guild is unavailable.');
  const section = getEffectiveVerificationSection(guild.id);
  if (section.enabled !== true) throw new Error('Verification module is disabled.');

  const panel = verificationStore.getPanel(guild.id, panelId);
  if (!panel) throw new Error('Verification panel not found.');
  if (!panel.channelId) throw new Error('Panel channel is not configured.');

  const existingMessage = await fetchPanelMessage(guild, panel);
  if (existingMessage) return panel;

  const channel = guild.channels.cache.get(panel.channelId)
    || await guild.channels.fetch(panel.channelId).catch(() => null);
  if (!channel?.send) throw new Error('Panel channel is unavailable or not sendable.');

  const candidate = {
    ...verificationStore.normalizePanelTemplate(panel),
    ...panel,
    panelId: panel.panelId,
    id: panel.panelId,
    channelId: channel.id,
    enabled: true,
    retiredAt: null,
  };
  const payload = {
    embeds: [buildVerificationEmbed(candidate, guild)],
    components: buildVerificationRows(candidate, guild),
  };

  let message = null;
  try {
    message = await channel.send(payload);
    const saved = verificationStore.savePanel(guild.id, {
      ...candidate,
      channelId: message.channelId || channel.id,
      messageId: message.id,
      enabled: true,
      retiredAt: null,
      lastDeployedAt: new Date().toISOString(),
    }, { action: 'verification_panel_restore_missing_message', skipConfigRevision: true, ...meta });

    const confirmed = await fetchPanelMessage(guild, saved);
    if (!confirmed) throw new Error('Replacement verification message could not be confirmed after save.');
    return saved;
  } catch (error) {
    if (message?.deletable) {
      await message.delete().catch(() => null);
    }
    throw error;
  }
}

async function deployVerificationPanel(channel, input = {}, meta = {}) {
  if (!channel?.guild?.id || !channel?.send) throw new Error('A sendable channel is required.');
  const guild = channel.guild;
  const guildId = guild.id;
  const section = getEffectiveVerificationSection(guildId);
  if (section.enabled !== true) throw new Error('Verification module is disabled.');
  if (!section.settings?.verifiedRoleIds?.length) throw new Error('Choose at least one verified role before deploying verification.');

  const existingPanel = input.panelId ? verificationStore.getPanel(guildId, input.panelId) : null;
  const panelId = existingPanel?.panelId || input.panelId || verificationStore.createId('verify_panel');
  const template = verificationStore.normalizePanelTemplate({
    ...(section.panelTemplate || {}),
    ...(existingPanel || {}),
    ...(input || {}),
  });
  const candidate = {
    ...(existingPanel || {}),
    ...template,
    panelId,
    id: panelId,
    channelId: channel.id,
    messageId: existingPanel?.messageId || null,
    createdBy: input.createdBy || existingPanel?.createdBy,
    createdAt: existingPanel?.createdAt || new Date().toISOString(),
  };

  const existingMessage = existingPanel ? await fetchPanelMessage(guild, existingPanel) : null;
  const payload = {
    embeds: [buildVerificationEmbed(candidate, guild)],
    components: buildVerificationRows(candidate, guild),
  };

  if (existingMessage?.editable) {
    const rollbackPayload = snapshotMessagePayload(existingMessage);
    const message = await existingMessage.edit(payload);
    try {
      return verificationStore.savePanel(guildId, {
        ...candidate,
        channelId: message.channelId || channel.id,
        messageId: message.id,
        lastDeployedAt: new Date().toISOString(),
      }, meta);
    } catch (error) {
      if (rollbackPayload) {
        await message.edit(rollbackPayload).catch((rollbackError) => {
          console.error('[Verification] Failed to roll back panel message after persistence failure', {
            guildId,
            panelId,
            messageId: message.id,
            error: rollbackError,
          });
        });
      }
      throw error;
    }
  }

  let stagedPanel;
  try {
    stagedPanel = verificationStore.savePanel(guildId, {
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
    return verificationStore.savePanel(guildId, {
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
      verificationStore.deletePanel(guildId, panelId, { action: 'verification_panel_stage_rollback', ...meta });
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
