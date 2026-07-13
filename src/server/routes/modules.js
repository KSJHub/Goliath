'use strict';

const express = require('express');

const {
  getGuildData,
  getGuildSection,
  saveEmbedPreset,
  deleteEmbedPreset,
  saveEmbedBuilderDraft,
  setModuleEnabled,
} = require('../../core/guild/guildManager');

const autoRoleStore = require('../../modules/autoRoles/autoRoleStore');
const autoRoleManager = require('../../modules/autoRoles/autoRoleManager');
const verificationStore = require('../../modules/verification/verificationStore');
const verificationManager = require('../../modules/verification/verificationManager');
const embedTemplateManager = require('../../modules/embed/embedTemplateManager');
const {
  getAllEmbedDeployments,
  deleteEmbedDeployment,
} = require('../../modules/embed/embedDeploymentStore');
const {
  isGoliathPermissionError,
  validateRoleSelection,
} = require('../../core/security/goliathPermissionGuard');
const { requirePlanLimit } = require('../middleware/requirePlanLimit');

const router = express.Router();

const MODULE_CATALOG = Object.freeze({
  verification: {
    key: 'verification',
    name: 'Verification',
    icon: '✅',
    category: 'Security',
    summary: 'Verify members, assign roles and deploy a custom verification panel.',
    apiBase: '/api/verification',
    dashboardPath: '/modules/verification',
    maturity: 'in_progress',
    configurable: true,
  },
  autoRoles: {
    key: 'autoRoles',
    name: 'Auto Roles',
    icon: '🤖',
    category: 'Automation',
    summary: 'Automatically assign roles to members and bots when they join.',
    apiBase: '/api/modules/:guildId/auto-roles',
    dashboardPath: '/modules/auto-roles',
    maturity: 'in_progress',
    configurable: true,
  },
  embedStudio: {
    key: 'embedStudio',
    name: 'Embed Studio',
    icon: '🖼️',
    category: 'Utilities',
    summary: 'Create, save and deploy reusable embed templates.',
    apiBase: '/api/modules/:guildId/embed-studio',
    dashboardPath: '/modules/embed-studio',
    maturity: 'in_progress',
    configurable: true,
  },
});

function success(res, payload = {}) {
  return res.json({ success: true, ...payload });
}

function failure(res, error, status = 500) {
  console.error('[Modules API]', error);

  if (isGoliathPermissionError(error)) {
    const details = error.details || {};

    return res.status(403).json({
      success: false,
      code: error.code,
      error: error.message,
      message: details.message || error.message,
      scope: details.scope || null,
      guildId: details.guildId || null,
      failures: details.failures || [],
      missingPermissions: details.missingPermissions || [],
      metadata: details.metadata || {},
      autoFixAvailable: Boolean(details.autoFixAvailable),
      confirmationRequired: Boolean(details.confirmationRequired),
    });
  }

  return res.status(status).json({
    success: false,
    error: error.message || 'Modules API request failed.',
  });
}

function getGuildId(req) {
  const guildId = String(req.params.guildId || '').trim();
  if (!/^\d{15,25}$/.test(guildId)) throw new Error('Invalid guild ID.');
  return guildId;
}

function cleanModuleKey(value) {
  const key = String(value || '').trim();
  if (!/^[a-zA-Z0-9_-]{2,80}$/.test(key)) throw new Error('Invalid module key.');
  return key;
}

function cleanPresetName(value) {
  const name = String(value || '').trim().slice(0, 50);
  if (!name) throw new Error('Preset name is required.');
  return name;
}

function cleanDeploymentKey(value) {
  const key = String(value || '').trim().slice(0, 100);
  if (!key) throw new Error('Deployment key is required.');
  return key;
}

function countEmbedPresetsForLimit(req) {
  const guildId = getGuildId(req);
  const name = cleanPresetName(req.body?.name);
  const presets = getGuildSection(guildId, 'embedPresets', {});
  return Object.keys(presets || {}).filter((key) => key !== 'updatedAt' && key !== name).length;
}

function normalizeModuleMap(modules = {}) {
  const output = {};
  if (modules && typeof modules === 'object' && !Array.isArray(modules)) {
    for (const [key, value] of Object.entries(modules)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        output[key] = { ...value, enabled: value.enabled !== false };
      } else if (typeof value === 'boolean') {
        output[key] = { enabled: value !== false };
      } else {
        output[key] = { enabled: true };
      }
    }
  }

  for (const [key, meta] of Object.entries(MODULE_CATALOG)) {
    output[key] = {
      ...(output[key] || {}),
      enabled: output[key]?.enabled === undefined ? false : output[key].enabled !== false,
      meta,
    };
  }

  return output;
}

function getDiscordClient(req) {
  return req.client || req.app?.get?.('goliath.client') || req.app?.locals?.client || req.app?.locals?.discordClient || global.client || global.discordClient || null;
}

async function fetchGuild(req, guildId) {
  const client = getDiscordClient(req);
  if (!client?.guilds) return null;
  return client.guilds.cache.get(guildId) || client.guilds.fetch(guildId).catch(() => null);
}

async function guardManageableRoles(guild, roleIds = [], scope = 'roles') {
  const cleanRoleIds = autoRoleStore.cleanRoleIds(roleIds);
  if (!cleanRoleIds.length) return null;

  const result = await validateRoleSelection(guild, cleanRoleIds, { scope, requireManageable: true });
  if (!result.ok) throw result.toError();
  return result;
}

async function guardAutoRoleConfig(req, guildId, input = {}) {
  const roleIds = [
    ...(Array.isArray(input.joinRoles) ? input.joinRoles : []),
    ...(Array.isArray(input.botRoles) ? input.botRoles : []),
  ];
  if (!roleIds.length) return null;

  const guild = await fetchGuild(req, guildId);
  if (!guild) throw new Error('Guild is unavailable.');
  return guardManageableRoles(guild, roleIds, 'auto_roles.config_roles');
}

async function guardVerificationRoles(req, guildId, input = {}) {
  const settings = input.settings && typeof input.settings === 'object' ? input.settings : input;
  const roleIds = [settings?.verifiedRoleId, settings?.unverifiedRoleId].filter(Boolean);
  if (!roleIds.length) return null;

  const guild = await fetchGuild(req, guildId);
  if (!guild) throw new Error('Guild is unavailable.');
  return guardManageableRoles(guild, roleIds, 'verification.roles');
}

function getEmbedStudioPayload(guildId) {
  const builder = getGuildSection(guildId, 'embedBuilder', { draft: {}, templates: {}, deployments: {} });
  const presets = getGuildSection(guildId, 'embedPresets', {});
  const deployments = getAllEmbedDeployments(guildId);
  const templateSection = embedTemplateManager.getEmbedSection(guildId);
  const templates = embedTemplateManager.listTemplates(guildId);

  return {
    guildId,
    builder: {
      ...builder,
      deployments,
    },
    draft: builder.draft || {},
    presets,
    deployments,
    templates,
    bindings: templateSection.bindings || {},
    variables: embedTemplateManager.MODULE_VARIABLES,
    defaults: embedTemplateManager.DEFAULT_TEMPLATES,
    summary: {
      presetCount: Object.keys(presets || {}).filter((key) => key !== 'updatedAt').length,
      templateCount: Object.keys(templates || {}).length,
      deploymentCount: Object.keys(deployments || {}).length,
      bindingCount: Object.values(templateSection.bindings || {}).reduce((total, map) => total + Object.keys(map || {}).length, 0),
    },
  };
}

function getVerificationPayload(guildId) {
  const status = verificationManager.getVerificationStatus(guildId);
  const section = verificationStore.getVerificationSection(guildId);
  const panels = Object.values(section.panels || {});
  return {
    guildId,
    config: section,
    overview: {
      enabled: status.enabled === true,
      panels: panels.length,
      deployedPanels: panels.filter((panel) => panel?.channelId && panel?.messageId).length,
      analytics: section.analytics || {},
      hasTemplate: Boolean(section.panelTemplate),
    },
  };
}

router.get('/:guildId', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const data = getGuildData(guildId) || {};
    const modules = normalizeModuleMap(data.modules || {});
    return success(res, {
      guildId,
      catalog: MODULE_CATALOG,
      modules,
      summary: {
        total: Object.keys(modules).length,
        enabled: Object.values(modules).filter((module) => module?.enabled !== false).length,
      },
    });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.patch('/:guildId/:moduleKey/enabled', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const moduleKey = cleanModuleKey(req.params.moduleKey);
    const enabled = req.body?.enabled === true;
    setModuleEnabled(guildId, moduleKey, enabled);
    const modules = normalizeModuleMap(getGuildSection(guildId, 'modules', {}));
    return success(res, { guildId, moduleKey, enabled, modules });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.get('/:guildId/verification', (req, res) => {
  try {
    const guildId = getGuildId(req);
    return success(res, getVerificationPayload(guildId));
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.patch('/:guildId/verification/enabled', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const enabled = req.body?.enabled === true;
    verificationManager.setVerificationEnabled(guildId, enabled, { actorId: req.body?.actorId });
    setModuleEnabled(guildId, 'verification', enabled);
    return success(res, { guildId, enabled, ...getVerificationPayload(guildId) });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.patch('/:guildId/verification/settings', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    await guardVerificationRoles(req, guildId, req.body || {});
    const settings = req.body?.settings || req.body || {};
    const config = verificationManager.updateVerificationSettings(guildId, settings, { actorId: req.body?.actorId });
    return success(res, { guildId, config, ...getVerificationPayload(guildId) });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.get('/:guildId/embed-studio', (req, res) => {
  try {
    const guildId = getGuildId(req);
    return success(res, getEmbedStudioPayload(guildId));
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.post('/:guildId/embed-studio/draft', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const draft = saveEmbedBuilderDraft(guildId, req.body?.embed ? { ...req.body.embed, content: req.body.content || '' } : req.body || {});
    return success(res, { guildId, draft, ...getEmbedStudioPayload(guildId) });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.post('/:guildId/embed-studio/presets', requirePlanLimit('embedPresets', countEmbedPresetsForLimit), (req, res) => {
  try {
    const guildId = getGuildId(req);
    const name = cleanPresetName(req.body?.name);
    const preset = saveEmbedPreset(guildId, name, req.body?.embed ? { ...req.body.embed, content: req.body.content || '' } : req.body || {});
    const template = embedTemplateManager.saveTemplate(guildId, {
      templateId: name,
      name,
      module: req.body?.module || 'global',
      templateType: req.body?.templateType || req.body?.module || 'global',
      content: req.body?.content || '',
      embed: req.body?.embed || req.body || {},
      tags: req.body?.tags || [],
    });
    return success(res, { guildId, preset, template, ...getEmbedStudioPayload(guildId) });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.delete('/:guildId/embed-studio/presets/:name', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const name = cleanPresetName(req.params.name);
    const deleted = deleteEmbedPreset(guildId, name);
    embedTemplateManager.deleteTemplate(guildId, name);
    return success(res, { guildId, deleted, ...getEmbedStudioPayload(guildId) });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.get('/:guildId/embed-studio/templates', (req, res) => {
  try {
    const guildId = getGuildId(req);
    return success(res, { guildId, templates: embedTemplateManager.listTemplates(guildId), variables: embedTemplateManager.MODULE_VARIABLES });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.post('/:guildId/embed-studio/templates', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const template = embedTemplateManager.saveTemplate(guildId, req.body || {});
    return success(res, { guildId, template, ...getEmbedStudioPayload(guildId) });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.post('/:guildId/embed-studio/bindings/:moduleKey/:slot', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const moduleKey = cleanModuleKey(req.params.moduleKey);
    const slot = cleanModuleKey(req.params.slot);
    const binding = embedTemplateManager.bindTemplate(guildId, moduleKey, slot, req.body?.templateId || req.body?.presetName || req.body?.name);
    return success(res, { guildId, binding, ...getEmbedStudioPayload(guildId) });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.delete('/:guildId/embed-studio/deployments/:key', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const key = cleanDeploymentKey(req.params.key);
    const deleted = deleteEmbedDeployment(guildId, key);
    return success(res, { guildId, deleted, ...getEmbedStudioPayload(guildId) });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.get('/:guildId/auto-roles', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const config = autoRoleStore.getAutoRolesSection(guildId);
    return success(res, { guildId, config, overview: { enabled: config.enabled !== false, joinRoleCount: (config.joinRoles || []).length, botRoleCount: (config.botRoles || []).length, applyToBots: config.settings?.applyToBots === true, analytics: config.analytics || {} } });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.patch('/:guildId/auto-roles/enabled', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const config = autoRoleManager.setAutoRolesEnabled(guildId, req.body?.enabled === true, { actorId: req.body?.actorId });
    return success(res, { guildId, config });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.patch('/:guildId/auto-roles/settings', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const config = autoRoleStore.updateSettings(guildId, req.body?.settings || req.body || {}, { actorId: req.body?.actorId });
    return success(res, { guildId, config });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.put('/:guildId/auto-roles', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    await guardAutoRoleConfig(req, guildId, req.body || {});
    const config = autoRoleManager.configureAutoRoles(guildId, req.body || {}, { actorId: req.body?.actorId });
    return success(res, { guildId, config });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.post('/:guildId/auto-roles/join', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    const guild = await fetchGuild(req, guildId);
    if (!guild) throw new Error('Guild is unavailable.');
    await guardManageableRoles(guild, [req.body?.roleId], 'auto_roles.join_role');
    const config = autoRoleManager.addJoinRole(guildId, req.body?.roleId, { actorId: req.body?.actorId });
    return success(res, { guildId, config });
  } catch (error) {
    return failure(res, error, 400);
  }
});

module.exports = router;
