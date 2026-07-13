'use strict';

// src/server/routes/permissionHealth.js

const express = require('express');
const { PermissionFlagsBits } = require('discord.js');

const autoRoleStore = require('../../modules/autoRoles/autoRoleStore');
const verificationStore = require('../../modules/verification/verificationStore');
const formStore = require('../../modules/forms/formStore');
const ticketStore = require('../../modules/tickets/ticketStore');
const translationStore = require('../../modules/translation/translationStore');
const { getAllEmbedDeployments } = require('../../modules/embed/embedDeploymentStore');

const {
  DEFAULT_BOT_CHANNEL_PERMISSIONS,
  canManageRole,
  getBotMember,
  permissionLabel,
  validateChannelAccess,
} = require('../../core/security/goliathPermissionGuard');

const router = express.Router();

function success(res, payload = {}) {
  return res.json({ success: true, ...payload });
}

function failure(res, error, status = 500) {
  console.error('[PermissionHealth API]', error);
  return res.status(status).json({ success: false, error: error.message || 'Permission health check failed.' });
}

function cleanDiscordId(value, label = 'Discord ID') {
  const id = String(value || '').replace(/\D/g, '');
  if (!id || id.length < 15) throw new Error(`Invalid ${label}.`);
  return id;
}

function cleanId(value) {
  const id = String(value || '').replace(/[<@#!&>]/g, '').trim();
  return /^\d{15,25}$/.test(id) ? id : null;
}

function uniqueIds(values = []) {
  return [...new Set((Array.isArray(values) ? values : [values]).map(cleanId).filter(Boolean))];
}

function uniqueFromObjects(items = [], getter) {
  return uniqueIds(items.flatMap((item) => getter(item) || []));
}

function getDiscordClient(req) {
  return (
    req.client ||
    req.app?.get?.('goliath.client') ||
    req.app?.locals?.client ||
    req.app?.locals?.discordClient ||
    global.client ||
    global.discordClient ||
    null
  );
}

async function getGuild(req, guildId) {
  const client = getDiscordClient(req);
  const cachedGuild = client?.guilds?.cache?.get?.(guildId);
  if (cachedGuild) return cachedGuild;

  const fetchedGuild = typeof client?.guilds?.fetch === 'function'
    ? await client.guilds.fetch(guildId).catch(() => null)
    : null;

  if (!fetchedGuild) throw new Error('Guild is not available to the Discord client.');
  return fetchedGuild;
}

function summariseGuardResult(result) {
  return {
    ok: result.ok,
    scope: result.scope,
    channelId: result.channelId,
    channelName: result.channelName,
    missingPermissions: result.missingPermissions || [],
    failures: result.failures || [],
    autoFixAvailable: result.autoFixAvailable === true,
    message: result.message,
  };
}

function getOverallStatus(issueCount = 0, warningCount = 0) {
  if (issueCount > 0) return 'critical';
  if (warningCount > 0) return 'warning';
  return 'healthy';
}

function getSectionStatus(issueCount = 0, configuredCount = 0) {
  if (issueCount > 0) return 'critical';
  if (configuredCount > 0) return 'healthy';
  return 'idle';
}

function scoreFromCounts({ basePermissionIssueCount = 0, channelIssueCount = 0, roleIssueCount = 0, moduleIssueCount = 0 }) {
  const penalty =
    (basePermissionIssueCount * 14) +
    (roleIssueCount * 4) +
    (channelIssueCount * 3) +
    (moduleIssueCount * 2);
  return Math.max(0, Math.min(100, 100 - penalty));
}

function scoreStatus(score) {
  if (score >= 90) return 'healthy';
  if (score >= 70) return 'warning';
  return 'critical';
}

function buildCategory(key, label, issueCount, checkedCount, description, recommendations = []) {
  return {
    key,
    label,
    status: issueCount > 0 ? 'critical' : checkedCount > 0 ? 'healthy' : 'idle',
    issueCount,
    checkedCount,
    description,
    recommendations: recommendations.filter(Boolean),
  };
}

function buildModuleDiagnostic({ key, label, configuredCount, channelIds = [], roleIds = [], channelIssueMap, roleIssueMap, notes = [] }) {
  const channelIssues = uniqueIds(channelIds).map((id) => channelIssueMap.get(id)).filter(Boolean);
  const roleIssues = uniqueIds(roleIds).map((id) => roleIssueMap.get(id)).filter(Boolean);
  const issueCount = channelIssues.length + roleIssues.length;

  return {
    key,
    label,
    status: getSectionStatus(issueCount, configuredCount),
    configuredCount,
    issueCount,
    channelIssueCount: channelIssues.length,
    roleIssueCount: roleIssues.length,
    channelIds: uniqueIds(channelIds),
    roleIds: uniqueIds(roleIds),
    channelIssues,
    roleIssues,
    notes: notes.filter(Boolean),
    recommendation: issueCount
      ? 'Fix the affected channel permissions or move Goliath above the affected roles.'
      : configuredCount
        ? 'No configured permission issues found for this module.'
        : 'No active configuration found yet.',
  };
}

async function checkGuildBasePermissions(guild) {
  const botMember = await getBotMember(guild);

  if (!botMember) {
    return { ok: false, missingPermissions: [], message: 'Goliath could not read its own server member profile.' };
  }

  const required = [
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.ManageRoles,
    PermissionFlagsBits.ManageMessages,
    PermissionFlagsBits.ViewAuditLog,
  ];

  const recommended = [
    PermissionFlagsBits.ManageWebhooks,
    PermissionFlagsBits.ModerateMembers,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.ReadMessageHistory,
  ];

  const missingPermissions = required.filter((permission) => !botMember.permissions?.has(permission)).map(permissionLabel);
  const missingRecommendedPermissions = recommended.filter((permission) => !botMember.permissions?.has(permission)).map(permissionLabel);

  return {
    ok: missingPermissions.length === 0,
    missingPermissions,
    missingRecommendedPermissions,
    botRoleId: botMember.roles?.highest?.id || null,
    botRoleName: botMember.roles?.highest?.name || null,
    botRolePosition: botMember.roles?.highest?.position || null,
    message: missingPermissions.length
      ? 'Goliath is missing one or more required server-level permissions.'
      : missingRecommendedPermissions.length
        ? 'Goliath has required permissions but is missing recommended permissions.'
        : 'Goliath has the recommended server-level permissions.',
  };
}

async function checkChannels(guild, limit = 50) {
  const channels = [...(guild.channels?.cache?.values?.() || [])]
    .filter((channel) => channel?.isTextBased?.() || channel?.type === 4)
    .slice(0, Math.max(1, Math.min(Number(limit) || 50, 200)));

  const checks = [];

  for (const channel of channels) {
    const result = await validateChannelAccess(guild, channel.id, DEFAULT_BOT_CHANNEL_PERMISSIONS, { scope: 'permission_health.channel' });
    if (!result.ok) {
      checks.push({ type: 'channel', channelId: channel.id, channelName: channel.name, channelType: channel.type, result: summariseGuardResult(result) });
    }
  }

  return { checked: channels.length, issueCount: checks.length, issues: checks };
}

async function checkRoles(guild, limit = 100) {
  const roles = [...(guild.roles?.cache?.values?.() || [])]
    .filter((role) => role && role.id !== guild.id)
    .sort((a, b) => Number(b.position || 0) - Number(a.position || 0))
    .slice(0, Math.max(1, Math.min(Number(limit) || 100, 250)));

  const issues = [];
  const dangerousRoles = [];

  for (const role of roles) {
    const result = await canManageRole(guild, role.id);
    if (!result.ok && ['role_hierarchy', 'missing_manage_roles', 'managed_role'].includes(result.reason)) {
      issues.push({ type: 'role', roleId: role.id, roleName: role.name, rolePosition: role.position, reason: result.reason, message: result.message, fix: result.fix || null });
    }
    if (role.permissions?.has?.(PermissionFlagsBits.Administrator) && !role.managed) {
      dangerousRoles.push({ roleId: role.id, roleName: role.name, rolePosition: role.position, reason: 'administrator_permission', message: 'This role has Administrator permission.' });
    }
  }

  return { checked: roles.length, issueCount: issues.length, issues, dangerousRoleCount: dangerousRoles.length, dangerousRoles };
}

function buildModuleDiagnostics(guildId, channelHealth, roleHealth) {
  const channelIssueMap = new Map((channelHealth.issues || []).map((issue) => [issue.channelId, issue]));
  const roleIssueMap = new Map((roleHealth.issues || []).map((issue) => [issue.roleId, issue]));

  const autoRoles = autoRoleStore.getAutoRolesSection(guildId);
  const verification = verificationStore.getVerificationSection(guildId);
  const forms = formStore.getFormsSection(guildId);
  const ticketSettings = ticketStore.getTicketSettings(guildId) || {};
  const ticketPanels = ticketStore.getPanels(guildId)?.panels || [];
  const ticketList = ticketStore.getAllTickets(guildId) || [];
  const translation = translationStore.getTranslationSection(guildId);
  const embedDeployments = Object.values(getAllEmbedDeployments(guildId) || {});

  const formList = Object.values(forms.forms || {});
  const formPanels = Object.values(forms.panels || {});
  const translationChannels = Object.values(translation.channels || translation.threadChannels || {});
  const ticketPermissions = ticketSettings.permissions || {};
  const ticketCategorySettings = ticketSettings.tickets || ticketSettings.discord || {};

  const sections = [
    buildModuleDiagnostic({ key: 'autoRoles', label: 'Auto Roles', configuredCount: (autoRoles.joinRoles || []).length + (autoRoles.botRoles || []).length, roleIds: [...(autoRoles.joinRoles || []), ...(autoRoles.botRoles || [])], channelIssueMap, roleIssueMap, notes: [autoRoles.enabled === false ? 'Auto Roles is disabled.' : 'Auto Roles is enabled.'] }),
    buildModuleDiagnostic({ key: 'verification', label: 'Verification', configuredCount: Object.keys(verification.panels || {}).length + uniqueIds([verification.settings?.verifiedRoleId, verification.settings?.unverifiedRoleId, verification.settings?.logChannelId]).length, roleIds: [verification.settings?.verifiedRoleId, verification.settings?.unverifiedRoleId], channelIds: [verification.settings?.logChannelId, ...Object.values(verification.panels || {}).map((panel) => panel.channelId)], channelIssueMap, roleIssueMap, notes: [verification.enabled === false ? 'Verification is disabled.' : 'Verification is enabled.'] }),
    buildModuleDiagnostic({ key: 'forms', label: 'Forms', configuredCount: formList.length + formPanels.length, roleIds: uniqueFromObjects(formList, (form) => [...(form.staffRoleIds || []), ...(form.managerRoleIds || []), ...(form.viewerRoleIds || [])]), channelIds: [...formList.map((form) => form.outputCategoryId), ...formPanels.flatMap((panel) => [panel.channelId, panel.outputCategoryId])], channelIssueMap, roleIssueMap, notes: [forms.enabled === false ? 'Forms is disabled.' : 'Forms is enabled.'] }),
    buildModuleDiagnostic({ key: 'tickets', label: 'Tickets', configuredCount: ticketPanels.length + uniqueIds([ticketSettings.categoryId, ticketSettings.outputCategoryId, ticketSettings.archiveCategoryId, ticketCategorySettings.categoryId, ticketCategorySettings.outputCategoryId, ticketCategorySettings.archiveCategoryId]).length, roleIds: uniqueIds([...(ticketSettings.staffRoleIds || []), ...(ticketSettings.managerRoleIds || []), ...(ticketSettings.viewerRoleIds || []), ...(ticketPermissions.staffRoleIds || ticketPermissions.staffRoles || []), ...(ticketPermissions.managerRoleIds || ticketPermissions.managerRoles || []), ...(ticketPermissions.viewerRoleIds || ticketPermissions.viewerRoles || []), ...ticketPanels.flatMap((panel) => [...(panel.staffRoleIds || []), ...(panel.managerRoleIds || []), ...(panel.viewerRoleIds || [])])]), channelIds: uniqueIds([ticketSettings.categoryId, ticketSettings.outputCategoryId, ticketSettings.archiveCategoryId, ticketCategorySettings.categoryId, ticketCategorySettings.outputCategoryId, ticketCategorySettings.archiveCategoryId, ...ticketPanels.flatMap((panel) => [panel.channelId, panel.deployChannelId, panel.outputCategoryId, panel.archiveCategoryId, panel.logsChannelId, panel.transcriptsChannelId])]), channelIssueMap, roleIssueMap, notes: [`${ticketList.length} tickets stored.`] }),
    buildModuleDiagnostic({ key: 'translation', label: 'Translation', configuredCount: translationChannels.length, channelIds: [...Object.keys(translation.channels || {}), ...Object.keys(translation.threadChannels || {})], channelIssueMap, roleIssueMap, notes: [translation.enabled === false ? 'Translation is disabled.' : 'Translation is enabled.'] }),
    buildModuleDiagnostic({ key: 'embeds', label: 'Embed Studio', configuredCount: embedDeployments.length, channelIds: embedDeployments.map((deployment) => deployment.channelId), channelIssueMap, roleIssueMap, notes: [`${embedDeployments.length} embed deployment records found.`] }),
  ];

  return {
    sectionCount: sections.length,
    issueCount: sections.reduce((total, section) => total + section.issueCount, 0),
    configuredCount: sections.reduce((total, section) => total + section.configuredCount, 0),
    sections,
  };
}

router.get('/:guildId', async (req, res) => {
  try {
    const guildId = cleanDiscordId(req.params.guildId, 'guild ID');
    const guild = await getGuild(req, guildId);

    const [basePermissions, channelHealth, roleHealth] = await Promise.all([
      checkGuildBasePermissions(guild),
      checkChannels(guild, req.query.channelLimit),
      checkRoles(guild, req.query.roleLimit),
    ]);

    const modules = buildModuleDiagnostics(guildId, channelHealth, roleHealth);
    const basePermissionIssueCount = basePermissions.ok ? 0 : basePermissions.missingPermissions.length || 1;
    const issueCount = basePermissionIssueCount + channelHealth.issueCount + roleHealth.issueCount;
    const warningCount = (basePermissions.missingRecommendedPermissions || []).length + (roleHealth.dangerousRoleCount || 0) + modules.issueCount;
    const healthScore = scoreFromCounts({ basePermissionIssueCount, channelIssueCount: channelHealth.issueCount, roleIssueCount: roleHealth.issueCount, moduleIssueCount: modules.issueCount });

    const categories = [
      buildCategory('basePermissions', 'Bot Permissions', basePermissionIssueCount, 1, 'Checks Goliath server-level permissions.', basePermissions.missingPermissions.map((permission) => `Grant ${permission} to the Goliath role.`)),
      buildCategory('channelPermissions', 'Channel Permissions', channelHealth.issueCount, channelHealth.checked, 'Checks configured text/category permissions.', ['Refresh Discord resources after permission changes.']),
      buildCategory('roleHierarchy', 'Role Hierarchy', roleHealth.issueCount, roleHealth.checked, 'Checks whether Goliath can manage configured roles.', ['Move Goliath above roles it needs to assign.']),
      buildCategory('securityRisks', 'Security Risks', roleHealth.dangerousRoleCount, roleHealth.checked, 'Highlights Administrator roles and risky role setup.', ['Review roles with Administrator permission.']),
      buildCategory('moduleReadiness', 'Module Readiness', modules.issueCount, modules.configuredCount, 'Checks configured module channels and roles.', ['Open affected module pages and repair missing resources.']),
    ];

    return success(res, {
      guildId,
      checkedAt: new Date().toISOString(),
      status: scoreStatus(healthScore),
      healthScore,
      summary: {
        issueCount,
        warningCount,
        basePermissionIssueCount,
        recommendedPermissionWarningCount: (basePermissions.missingRecommendedPermissions || []).length,
        channelIssueCount: channelHealth.issueCount,
        roleIssueCount: roleHealth.issueCount,
        dangerousRoleCount: roleHealth.dangerousRoleCount || 0,
        moduleIssueCount: modules.issueCount,
        moduleConfiguredCount: modules.configuredCount,
      },
      categories,
      recommendations: categories.flatMap((category) => category.recommendations || []).slice(0, 12),
      basePermissions,
      channels: channelHealth,
      roles: roleHealth,
      modules,
    });
  } catch (error) {
    return failure(res, error, 400);
  }
});

module.exports = router;
