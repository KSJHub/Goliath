'use strict';

const express = require('express');
const { PermissionFlagsBits } = require('discord.js');
const guildManager = require('../../../../core/guild/guildManager');
const security = require('../../../../core/security/protection/core');
const emojiPayload = require('../../../../modules/utilityStudio/emojis/emojiPayload');
const roleSelector = require('../../../../modules/roleStudio/roleSelector/roleSelector');
const healthService = require('../../../../modules/roleStudio/roleSelector/roleSelectorHealth');
const panel = require('../../../../modules/roleStudio/roleSelector/roleSelectorPanel');
const { withDeploymentLock } = require('../../../../modules/roleStudio/roleSelector/roleSelectorLocks');

const router = express.Router();

function guildId(req) {
  const value = String(req.params.guildId || '').trim();
  if (!/^\d{15,25}$/.test(value)) throw new Error('Invalid guild ID.');
  return value;
}
function cleanDiscordId(value) {
  const id = String(value || '').replace(/[<@#!&>]/g, '').trim();
  return /^\d{15,25}$/.test(id) ? id : null;
}
function actorId(req) { return cleanDiscordId(req.roleSelectorActorId || req.session?.user?.id); }
function client(req) { return req.client || req.app?.get?.('goliath.client') || req.app?.locals?.client || null; }
async function guild(req, id) { const c = client(req); return c?.guilds?.cache?.get(id) || await c?.guilds?.fetch?.(id).catch(() => null); }
function success(res, payload = {}) { return res.json({ success: true, ...payload }); }
function failure(res, error, status = 400) { return res.status(status).json({ success: false, error: error.message || 'Role Selector request failed.' }); }

async function resolveDashboardMemberPayload(g, payload = {}) {
  return emojiPayload.resolveMessagePayload(g.client, g.id, payload, 'roleSelector');
}

async function requireRoleSelectorGuildAccess(req, res, next) {
  try {
    const userId = cleanDiscordId(req.session?.user?.id);
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required.' });

    const id = guildId(req);
    req.roleSelectorActorId = userId;
    if (security.isBotOwner(userId)) return next();

    const g = await guild(req, id);
    if (!g) return res.status(403).json({ success: false, error: 'Guild is unavailable or not accessible.' });

    const member = g.members.cache.get(userId) || await g.members.fetch(userId).catch(() => null);
    const allowed = Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator) || member?.permissions?.has(PermissionFlagsBits.ManageGuild));
    if (!allowed) return res.status(403).json({ success: false, error: 'Manage Server permission is required.' });
    return next();
  } catch (error) {
    return failure(res, error, 403);
  }
}

router.use('/:guildId', requireRoleSelectorGuildAccess);

async function overview(req, id) {
  const g = await guild(req, id);
  return {
    guildId: id,
    enabled: guildManager.isModuleEnabled(id, roleSelector.MODULE),
    config: roleSelector.getSection(id),
    groups: roleSelector.listGroups(id),
    deployments: panel.deploymentList(roleSelector.getSection(id)),
    styleSuggestion: g ? roleSelector.suggestRoleStyle(g) : null,
    usage: g ? await roleSelector.getUsage(g) : { groups: [], totalUsing: 0, totalMembers: 0 },
    health: g ? await healthService.buildHealth(g) : null,
  };
}
async function validateExistingRoles(g, options = []) {
  if (!g) return options;
  const output = [];
  for (const option of Array.isArray(options) ? options : []) {
    if (!option?.roleId) { output.push(option); continue; }
    const role = g.roles.cache.get(String(option.roleId)) || await g.roles.fetch(String(option.roleId)).catch(() => null);
    roleSelector.assertSafeSelectorRole(g, role);
    output.push({ ...option, roleId: role.id, managed: option.managed === true });
  }
  return output;
}
function ownedByGoliath(g, message) { return Boolean(message && g.client?.user?.id && message.author?.id === g.client.user.id); }
async function retireDeploymentUnlocked(g, deployment) {
  if (!deployment?.channelId || !deployment?.messageId) return false;
  const channel = g.channels.cache.get(deployment.channelId) || await g.channels.fetch(deployment.channelId).catch(() => null);
  const message = channel?.messages?.fetch ? await channel.messages.fetch(deployment.messageId).catch(() => null) : null;
  if (!ownedByGoliath(g, message)) return false;
  try { await message.edit(panel.memberDisabledPayload()); return true; } catch { return false; }
}

router.get('/:guildId/overview', async (req, res) => {
  try { return success(res, await overview(req, guildId(req))); } catch (error) { return failure(res, error); }
});

router.put('/:guildId/config', async (req, res) => {
  try {
    const id = guildId(req); const patch = req.body || {};
    const before = roleSelector.getSection(id);
    const g = await guild(req, id);
    const actor = { actorId: actorId(req) };

    const nextChannelId = patch.deployment && Object.prototype.hasOwnProperty.call(patch.deployment, 'channelId') ? cleanDiscordId(patch.deployment.channelId) : before.deployment?.channelId || null;
    const deploymentChannelChanged = Boolean(patch.deployment && Object.prototype.hasOwnProperty.call(patch.deployment, 'channelId') && nextChannelId !== (before.deployment?.channelId || null));
    if (deploymentChannelChanged && g && before.deployment?.messageId) await panel.retireDeployment(g, before.deployment).catch(() => null);

    if (typeof patch.enabled === 'boolean') guildManager.setModuleEnabled(id, roleSelector.MODULE, patch.enabled, { ...actor, action: 'role_selector_dashboard_toggle' });

    const stylePatch = patch.style && typeof patch.style === 'object' ? { ...patch.style } : null;
    const hasAnchorPatch = Boolean(stylePatch && Object.prototype.hasOwnProperty.call(stylePatch, 'anchorRoleId'));
    const requestedAnchor = hasAnchorPatch ? cleanDiscordId(stylePatch.anchorRoleId) : null;
    if (stylePatch) delete stylePatch.anchorRoleId;

    roleSelector.updateSection(id, (current) => ({
      ...current,
      ...(stylePatch ? { style: { ...current.style, ...stylePatch } } : {}),
      ...(patch.deployment ? { deployment: { ...current.deployment, channelId: nextChannelId, messageId: deploymentChannelChanged ? null : current.deployment?.messageId || null } } : {}),
      ...(patch.cleanup ? { cleanup: { ...current.cleanup, ...patch.cleanup } } : {}),
    }), { ...actor, action: 'role_selector_dashboard_config' });

    if (hasAnchorPatch) {
      if (!g) throw new Error('Guild is unavailable for anchor validation.');
      await roleSelector.setAnchorRole(g, requestedAnchor, { managed: false, meta: { ...actor, action: 'role_selector_dashboard_anchor' } });
    }

    if (g) {
      await roleSelector.syncManagedRoleAppearance(g).catch(() => null);
      await roleSelector.syncManagedRoleHierarchy(g).catch(() => null);
      if (!deploymentChannelChanged) await panel.syncDeploymentState(g).catch(() => null);
    }
    return success(res, await overview(req, id));
  } catch (error) { return failure(res, error); }
});

router.post('/:guildId/groups', async (req, res) => {
  try {
    const id = guildId(req); const body = req.body || {};
    if (String(body.id || '').toLowerCase() === roleSelector.COLOUR_GROUP_ID || body.type === 'colour') throw new Error('Use the Colours settings endpoint for the built-in Colours selector.');
    const g = await guild(req, id);
    if (!g) throw new Error('Guild is unavailable for selector validation. Retry when connected.');
    const options = await validateExistingRoles(g, body.options || []);
    const input = { ...body, options, selectionMode: body.selectionMode === 'multiple' ? 'multiple' : 'single', allowRemove: body.allowRemove !== false, builtIn: false, type: 'standard' };
    const meta = { actorId: actorId(req), action: 'role_selector_dashboard_save_group' };
    const group = await roleSelector.saveGroupSafe(g, input, meta);
    await panel.syncDeploymentState(g);
    return success(res, { group, ...(await overview(req, id)) });
  } catch (error) { return failure(res, error); }
});

router.delete('/:guildId/groups/:groupId', async (req, res) => {
  try {
    const id = guildId(req); const g = await guild(req, id);
    if (!g) throw new Error('Guild is unavailable.');
    const result = await roleSelector.deleteManagedGroupRoles(g, req.params.groupId);
    if (result.unresolved) return res.status(409).json({ success: false, error: 'Group was not deleted because one or more Goliath-managed roles could not be removed.', unresolved: result.unresolved, unresolvedRoles: result.unresolvedRoles, deletedRoles: result.deleted });
    roleSelector.removeGroup(id, req.params.groupId, { actorId: actorId(req), action: 'role_selector_dashboard_delete_group' });
    await panel.syncDeploymentState(g);
    return success(res, { deletion: result, ...(await overview(req, id)) });
  } catch (error) { return failure(res, error); }
});

router.put('/:guildId/colours', async (req, res) => {
  try {
    const id = guildId(req); const current = roleSelector.getGroup(id, roleSelector.COLOUR_GROUP_ID); const patch = req.body || {}; const g = await guild(req, id);
    const input = { ...current, ...(Array.isArray(patch.palette) ? { palette: patch.palette } : {}), ...(patch.customHexEnabled === undefined ? {} : { customHexEnabled: patch.customHexEnabled === true }), ...(patch.allowRemove === undefined ? {} : { allowRemove: patch.allowRemove !== false }) };
    const meta = { actorId: actorId(req), action: 'role_selector_dashboard_colours' };
    if (!g) throw new Error('Guild is unavailable for Colours validation. Retry when connected.');
    await roleSelector.saveGroupSafe(g, input, meta);
    await panel.syncDeploymentState(g);
    return success(res, await overview(req, id));
  } catch (error) { return failure(res, error); }
});

router.post('/:guildId/scan-style', async (req, res) => {
  try {
    const id = guildId(req); const g = await guild(req, id); if (!g) throw new Error('Guild is unavailable.');
    const suggestion = roleSelector.suggestRoleStyle(g);
    roleSelector.updateSection(id, (current) => ({ ...current, style: { ...current.style, detectedFormat: suggestion.format, detectedIcon: suggestion.icon, detectedSeparator: suggestion.separator, detectedConfidence: suggestion.confidence } }), { actorId: actorId(req), action: 'role_selector_dashboard_style_scan' });
    return success(res, { suggestion, ...(await overview(req, id)) });
  } catch (error) { return failure(res, error); }
});

router.post('/:guildId/apply-style', async (req, res) => {
  try {
    const id = guildId(req); const g = await guild(req, id); if (!g) throw new Error('Guild is unavailable.');
    roleSelector.updateSection(id, (current) => ({ ...current, style: { ...current.style, format: current.style.detectedFormat || current.style.format, icon: current.style.detectedIcon || '', separator: current.style.detectedSeparator || current.style.separator } }), { actorId: actorId(req), action: 'role_selector_dashboard_style_apply' });
    await roleSelector.syncManagedRoleAppearance(g); await roleSelector.syncManagedRoleHierarchy(g);
    return success(res, await overview(req, id));
  } catch (error) { return failure(res, error); }
});

router.post('/:guildId/create-divider', async (req, res) => {
  try {
    const id = guildId(req); const g = await guild(req, id); if (!g) throw new Error('Guild is unavailable.');
    const name = String(req.body?.name || '🎭 | ROLE SELECTOR').trim().slice(0, 100);
    const divider = await g.roles.create({ name, permissions: [], hoist: false, mentionable: false, reason: 'Goliath Role Selector divider' });
    try { await roleSelector.setAnchorRole(g, divider.id, { managed: true, meta: { actorId: actorId(req), action: 'role_selector_dashboard_create_divider' } }); }
    catch (error) { await divider.delete('Unsafe Role Selector divider').catch(() => null); throw error; }
    return success(res, { divider: { id: divider.id, name: divider.name }, ...(await overview(req, id)) });
  } catch (error) { return failure(res, error); }
});

router.post('/:guildId/deploy', async (req, res) => {
  try {
    const id = guildId(req); const g = await guild(req, id); if (!g) throw new Error('Guild is unavailable.');
    const result = await withDeploymentLock(id, async () => {
      const section = roleSelector.getSection(id);
      roleSelector.assertModuleEnabled(id);
      if (Array.isArray(section.deployments) && section.deployments.length) throw new Error('Manage existing multi-panel deployments in Discord Role Selector Studio. Legacy publishing cannot replace them.');
      const channelId = cleanDiscordId(req.body?.channelId || section.deployment?.channelId); if (!channelId) throw new Error('Select a deployment channel.');
      const channel = g.channels.cache.get(channelId) || await g.channels.fetch(channelId).catch(() => null); if (!channel?.send) throw new Error('Selected channel is unavailable.');
      let message = section.deployment?.messageId && section.deployment?.channelId === channel.id ? await channel.messages.fetch(section.deployment.messageId).catch(() => null) : null;
      if (message && !ownedByGoliath(g, message)) message = null;
      if (section.deployment?.messageId && section.deployment?.channelId && section.deployment.channelId !== channel.id) await retireDeploymentUnlocked(g, section.deployment);
      const payload = await resolveDashboardMemberPayload(g, panel.memberLauncherPayload(g));
      message = message ? await message.edit(payload) : await channel.send(payload);
      roleSelector.updateSection(id, (current) => ({ ...current, deployment: { channelId: channel.id, messageId: message.id } }), { actorId: actorId(req), action: 'role_selector_dashboard_deploy' });
      return message;
    });
    return success(res, { messageId: result.id, ...(await overview(req, id)) });
  } catch (error) { return failure(res, error); }
});

router.post('/:guildId/deployments', async (req,res) => {
  try { const id = guildId(req); const g = await guild(req,id); if (!g) throw new Error('Guild is unavailable.'); await panel.configureDeployment(g,actorId(req),req.body); return success(res,await overview(req,id)); } catch(error) { return failure(res,error); }
});
router.put('/:guildId/deployments/:deploymentId', async (req,res) => {
  try { const id = guildId(req); const g = await guild(req,id); if (!g) throw new Error('Guild is unavailable.'); await panel.configureDeployment(g,actorId(req),req.body,req.params.deploymentId); return success(res,await overview(req,id)); } catch(error) { return failure(res,error); }
});
router.delete('/:guildId/deployments/:deploymentId', async (req,res) => {
  try { const id = guildId(req); const g = await guild(req,id); if (!g) throw new Error('Guild is unavailable.'); await panel.deleteSelectedDeployment({guildId:id,guild:g,user:{id:actorId(req)}},req.params.deploymentId); return success(res,await overview(req,id)); } catch(error) { return failure(res,error); }
});

router.post('/:guildId/deployments/:deploymentId/retire', async (req,res) => {
  try { const id = guildId(req); const g = await guild(req,id); if (!g) throw new Error('Guild is unavailable.'); await panel.retireSelectedDeployment({guildId:id,guild:g,user:{id:actorId(req)}},req.params.deploymentId); return success(res,await overview(req,id)); } catch(error) { return failure(res,error); }
});
router.post('/:guildId/deployments/:deploymentId/publish', async (req, res) => {
  try {
    const id = guildId(req); const g = await guild(req, id); if (!g) throw new Error('Guild is unavailable.');
    const message = await panel.deploySelected({ guildId: id, guild: g, user: { id: actorId(req) } }, req.params.deploymentId);
    return success(res, { messageId: message.id, ...(await overview(req, id)) });
  } catch (error) { return failure(res, error); }
});

router.post('/:guildId/repair', async (req, res) => {
  try { const id = guildId(req); const g = await guild(req, id); if (!g) throw new Error('Guild is unavailable.'); const repair = await healthService.repair(g); await panel.syncDeploymentState(g).catch(() => null); return success(res, { repair, ...(await overview(req, id)) }); } catch (error) { return failure(res, error); }
});
router.post('/:guildId/cleanup', async (req, res) => {
  try { const id = guildId(req); const g = await guild(req, id); if (!g) throw new Error('Guild is unavailable.'); const cleanup = await roleSelector.cleanupUnused(g); return success(res, { cleanup, ...(await overview(req, id)) }); } catch (error) { return failure(res, error); }
});
router.get('/:guildId/usage', async (req, res) => {
  try { const id = guildId(req); const g = await guild(req, id); if (!g) throw new Error('Guild is unavailable.'); return success(res, { usage: await roleSelector.getUsage(g) }); } catch (error) { return failure(res, error); }
});

module.exports = router;
