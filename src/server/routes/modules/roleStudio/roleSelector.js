'use strict';

const express = require('express');
const { PermissionFlagsBits } = require('discord.js');
const guildManager = require('../../../../core/guild/guildManager');
const security = require('../../../../core/security/securityCore');
const emojis = require('../../../../modules/utilityStudio/emojis/emojis');
const roleSelector = require('../../../../modules/roleStudio/roleSelector/roleSelector');
const healthService = require('../../../../modules/roleStudio/roleSelector/roleSelectorHealth');
const panel = require('../../../../modules/roleStudio/roleSelector/roleSelectorPanel');

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
  const allowed = await emojis.allowedGuildEmojis(g.client, g.id);
  const components = (payload.components || []).map((entry) => {
    const data = typeof entry?.toJSON === 'function' ? entry.toJSON() : entry;
    if (!data || typeof data !== 'object' || !Array.isArray(data.components)) return entry;
    return {
      ...data,
      components: data.components.map((component) => {
        if (!component || component.type !== 3 || !Array.isArray(component.options)) return component;
        return {
          ...component,
          options: component.options.map((option) => {
            const rawName = String(option?.emoji?.name || '');
            const shortcode = rawName.match(/^:([A-Za-z0-9_]{2,32}):$/);
            if (!shortcode) return option;
            const emoji = allowed.get(shortcode[1].toLowerCase());
            if (emoji) return { ...option, emoji: emojis.componentPayload(emoji) };
            const next = { ...option };
            delete next.emoji;
            return next;
          }),
        };
      }),
    };
  });
  return {
    ...payload,
    content: payload.content == null ? payload.content : await emojis.resolveText(g.client, g.id, payload.content),
    embeds: await emojis.resolveEmbeds(g.client, g.id, payload.embeds || []),
    components,
  };
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
    const allowed = Boolean(
      member?.permissions?.has(PermissionFlagsBits.Administrator) ||
      member?.permissions?.has(PermissionFlagsBits.ManageGuild)
    );
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
    output.push({ ...option, roleId: role.id, managed: false });
  }
  return output;
}

router.get('/:guildId/overview', async (req, res) => {
  try { return success(res, await overview(req, guildId(req))); } catch (error) { return failure(res, error); }
});

router.put('/:guildId/config', async (req, res) => {
  try {
    const id = guildId(req); const patch = req.body || {};
    const before = roleSelector.getSection(id);
    const g = await guild(req, id);
    const nextChannelId = patch.deployment && Object.prototype.hasOwnProperty.call(patch.deployment, 'channelId')
      ? cleanDiscordId(patch.deployment.channelId)
      : before.deployment?.channelId || null;
    const deploymentChannelChanged = Boolean(
      patch.deployment &&
      Object.prototype.hasOwnProperty.call(patch.deployment, 'channelId') &&
      nextChannelId !== (before.deployment?.channelId || null)
    );

    if (deploymentChannelChanged && g && before.deployment?.messageId) {
      await panel.retireDeployment(g, before.deployment).catch(() => null);
    }

    if (typeof patch.enabled === 'boolean') guildManager.setModuleEnabled(id, roleSelector.MODULE, patch.enabled, { actorId: actorId(req), action: 'role_selector_dashboard_toggle' });
    roleSelector.updateSection(id, (current) => ({
      ...current,
      ...(patch.style ? { style: { ...current.style, ...patch.style } } : {}),
      ...(patch.deployment ? {
        deployment: deploymentChannelChanged
          ? { ...current.deployment, ...patch.deployment, channelId: nextChannelId, messageId: null }
          : { ...current.deployment, ...patch.deployment },
      } : {}),
      ...(patch.cleanup ? { cleanup: { ...current.cleanup, ...patch.cleanup } } : {}),
    }), { actorId: actorId(req), action: 'role_selector_dashboard_config' });

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
    if (body.id === roleSelector.COLOUR_GROUP_ID || body.type === 'colour') throw new Error('Use the Colours settings endpoint for the built-in Colours selector.');
    const g = await guild(req, id);
    const options = await validateExistingRoles(g, body.options || []);
    const group = roleSelector.saveGroup(id, {
      ...body,
      options,
      selectionMode: body.selectionMode === 'multiple' ? 'multiple' : 'single',
      allowRemove: body.allowRemove !== false,
      builtIn: false,
      type: 'standard',
    }, { actorId: actorId(req), action: 'role_selector_dashboard_save_group' });
    return success(res, { group, ...(await overview(req, id)) });
  } catch (error) { return failure(res, error); }
});

router.delete('/:guildId/groups/:groupId', async (req, res) => {
  try {
    const id = guildId(req); const g = await guild(req, id);
    if (!g) throw new Error('Guild is unavailable.');

    const result = await roleSelector.deleteManagedGroupRoles(g, req.params.groupId);
    if (result.unresolved) {
      return res.status(409).json({
        success: false,
        error: 'Group was not deleted because one or more Goliath-managed roles could not be removed.',
        unresolved: result.unresolved,
        unresolvedRoles: result.unresolvedRoles,
        deletedRoles: result.deleted,
      });
    }

    roleSelector.removeGroup(id, req.params.groupId, { actorId: actorId(req), action: 'role_selector_dashboard_delete_group' });
    return success(res, { deletion: result, ...(await overview(req, id)) });
  } catch (error) { return failure(res, error); }
});

router.put('/:guildId/colours', async (req, res) => {
  try {
    const id = guildId(req); const current = roleSelector.getGroup(id, roleSelector.COLOUR_GROUP_ID); const patch = req.body || {};
    roleSelector.saveGroup(id, {
      ...current,
      ...(Array.isArray(patch.palette) ? { palette: patch.palette } : {}),
      ...(patch.customHexEnabled === undefined ? {} : { customHexEnabled: patch.customHexEnabled === true }),
      ...(patch.allowRemove === undefined ? {} : { allowRemove: patch.allowRemove !== false }),
    }, { actorId: actorId(req), action: 'role_selector_dashboard_colours' });
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
    if (!roleSelector.canManageRole(g, divider)) {
      await divider.delete('Unsafe Role Selector divider').catch(() => null);
      throw new Error('Goliath cannot safely manage the new divider because of role hierarchy.');
    }
    roleSelector.updateSection(id, (current) => ({ ...current, style: { ...current.style, anchorRoleId: divider.id } }), { actorId: actorId(req), action: 'role_selector_dashboard_create_divider' });
    await roleSelector.syncManagedRoleHierarchy(g);
    return success(res, { divider: { id: divider.id, name: divider.name }, ...(await overview(req, id)) });
  } catch (error) { return failure(res, error); }
});

router.post('/:guildId/deploy', async (req, res) => {
  try {
    const id = guildId(req); const g = await guild(req, id); if (!g) throw new Error('Guild is unavailable.');
    const section = roleSelector.getSection(id);
    const channelId = String(req.body?.channelId || section.deployment?.channelId || '').trim(); if (!channelId) throw new Error('Select a deployment channel.');
    const channel = g.channels.cache.get(channelId) || await g.channels.fetch(channelId).catch(() => null); if (!channel?.send) throw new Error('Selected channel is unavailable.');

    let message = section.deployment?.messageId && section.deployment?.channelId === channel.id
      ? await channel.messages.fetch(section.deployment.messageId).catch(() => null)
      : null;

    if (section.deployment?.messageId && section.deployment?.channelId && section.deployment.channelId !== channel.id) {
      await panel.retireDeployment(g, section.deployment).catch(() => null);
    }

    const payload = await resolveDashboardMemberPayload(g, panel.memberLauncherPayload(g));
    if (message) await message.edit(payload); else message = await channel.send(payload);
    roleSelector.updateSection(id, (current) => ({ ...current, deployment: { channelId: channel.id, messageId: message.id } }), { actorId: actorId(req), action: 'role_selector_dashboard_deploy' });
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
