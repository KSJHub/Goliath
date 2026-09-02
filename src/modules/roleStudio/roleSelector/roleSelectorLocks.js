'use strict';

// Process-local keyed queue for Role Selector mutations. Goliath currently runs
// one PM2 process per environment, so this is the correct coordination boundary.
const tails = new Map();
const HARDENING_PATCH_KEY = Symbol.for('goliath.roleSelector.hardeningPatchInstalled');
const STATS_POLISH_PATCH_KEY = Symbol.for('goliath.roleSelector.statsPolishPatchInstalled');

function cleanPart(value, fallback = 'global') {
  const cleaned = String(value ?? '').trim();
  return cleaned || fallback;
}

function lockKey(guildId, scope = 'guild', identity = '') {
  return [cleanPart(guildId), cleanPart(scope), cleanPart(identity, '-')].join(':');
}

async function withKeyedLock(key, task) {
  if (typeof task !== 'function') throw new TypeError('Role Selector lock task must be a function.');
  const safeKey = cleanPart(key);
  const previous = tails.get(safeKey) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  const tail = previous.catch(() => undefined).then(() => current);
  tails.set(safeKey, tail);
  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (tails.get(safeKey) === tail) tails.delete(safeKey);
  }
}

function withRoleSelectorLock(guildId, scope, task, identity = '') { return withKeyedLock(lockKey(guildId, scope, identity), task); }
function withGuildLock(guildId, task) { return withRoleSelectorLock(guildId, 'guild', task); }
function withMemberGroupLock(guildId, memberId, groupId, task) { return withRoleSelectorLock(guildId, 'member-group', task, `${cleanPart(memberId)}:${cleanPart(groupId)}`); }
function withManagedRoleLock(guildId, identity, task) { return withRoleSelectorLock(guildId, 'managed-role', task, identity); }
function withDeploymentLock(guildId, task) { return withRoleSelectorLock(guildId, 'deployment', task); }
function pendingLockCount() { return tails.size; }

async function drainRetiredManagedRoles(service, guild) {
  const section = service.getSection(guild.id);
  const retired = Array.isArray(section.identity?.retiredManagedRoles) ? section.identity.retiredManagedRoles : [];
  for (const entry of retired) {
    if (!entry?.roleId) continue;
    const role = guild.roles.cache.get(entry.roleId) || await guild.roles.fetch(entry.roleId).catch(() => null);
    if (!role || !service.canManageRole(guild, role)) continue;
    for (const member of [...role.members.values()]) {
      if (member.user?.bot) continue;
      await member.roles.remove(role, 'Goliath Role Selector retired managed role').catch(() => null);
    }
  }
}

function assertGroupCapacity(service, guildId, input = {}) {
  const requestedId = String(input.id || input.key || '').trim();
  const existing = requestedId ? service.getGroup(guildId, requestedId) : null;
  if (!existing && service.listGroups(guildId).length >= service.MAX_COMPONENT_OPTIONS) {
    throw new Error(`Role Selector supports up to ${service.MAX_COMPONENT_OPTIONS} total categories, including Colours.`);
  }
}

async function eagerPruneUnusedManagedRoles(roleSelector, service, guild, groupId) {
  const section = roleSelector.getSection(guild.id);
  if (section.cleanup?.deleteUnusedRoles === false) return { deleted: 0, cleared: 0 };
  const group = section.groups?.[groupId];
  if (!group) return { deleted: 0, cleared: 0 };

  let deleted = 0;
  let cleared = 0;

  if (group.type === 'colour') {
    const managedRoles = JSON.parse(JSON.stringify(group.managedRoles || {}));
    let changed = false;

    for (const [hex, record] of Object.entries(managedRoles)) {
      if (!record?.roleId) continue;
      const role = guild.roles.cache.get(record.roleId) || await guild.roles.fetch(record.roleId).catch(() => null);
      if (!role) {
        delete managedRoles[hex];
        cleared += 1;
        changed = true;
        continue;
      }
      const members = role.members.filter((member) => !member.user?.bot).size;
      if (members > 0 || !roleSelector.canManageRole(guild, role)) continue;
      const removed = await role.delete('Goliath Role Selector unused role after member selection change').then(() => true).catch(() => false);
      if (!removed) continue;
      delete managedRoles[hex];
      deleted += 1;
      changed = true;
    }

    if (changed) roleSelector.saveGroup(guild.id, { ...group, managedRoles }, { action: 'role_selector_eager_unused_cleanup' });
  } else {
    const options = JSON.parse(JSON.stringify(group.options || []));
    let changed = false;

    for (const option of options) {
      if (!option?.roleId || option.managed === false) continue;
      const role = guild.roles.cache.get(option.roleId) || await guild.roles.fetch(option.roleId).catch(() => null);
      if (!role) {
        option.roleId = null;
        option.unusedSince = null;
        cleared += 1;
        changed = true;
        continue;
      }
      const members = role.members.filter((member) => !member.user?.bot).size;
      if (members > 0 || !roleSelector.canManageRole(guild, role)) continue;
      const removed = await role.delete('Goliath Role Selector unused role after member selection change').then(() => true).catch(() => false);
      if (!removed) continue;
      option.roleId = null;
      option.unusedSince = null;
      deleted += 1;
      changed = true;
    }

    if (changed) roleSelector.saveGroup(guild.id, { ...group, options }, { action: 'role_selector_eager_unused_cleanup' });
  }

  if (deleted > 0) {
    roleSelector.updateSection(guild.id, (current) => ({
      ...current,
      analytics: {
        ...current.analytics,
        rolesDeleted: Number(current.analytics?.rolesDeleted || 0) + deleted,
      },
    }), { action: 'role_selector_eager_unused_cleanup_analytics' });
  }

  return { deleted, cleared };
}

async function modernDeploymentReadiness(guild, section) {
  const deployments = Array.isArray(section.deployments)
    ? section.deployments.filter((entry) => entry && entry.status !== 'retired')
    : [];
  if (!deployments.length) return null;

  let channelReady = false;
  let messageReady = false;
  for (const deployment of deployments) {
    if (!deployment.channelId) continue;
    const channel = guild.channels.cache.get(deployment.channelId) || await guild.channels.fetch(deployment.channelId).catch(() => null);
    if (!channel?.send) continue;
    channelReady = true;
    if (!deployment.messageId || !channel.messages?.fetch) continue;
    const message = await channel.messages.fetch(deployment.messageId).catch(() => null);
    if (message && (!guild.client?.user?.id || message.author?.id === guild.client.user.id)) {
      messageReady = true;
      break;
    }
  }
  return { channelReady, messageReady };
}

function repairAcceptanceForModernDeployments(result, readiness) {
  if (!readiness || !result.acceptance?.checks) return;
  const checks = result.acceptance.checks;
  const channelCheck = checks.find((check) => check.id === 'deployment_channel');
  const messageCheck = checks.find((check) => check.id === 'deployment_message');
  if (channelCheck) {
    channelCheck.passed = readiness.channelReady;
    channelCheck.detail = readiness.channelReady
      ? 'At least one active Role Selector deployment channel is available.'
      : 'No active Role Selector deployment has a sendable channel.';
  }
  if (messageCheck) {
    messageCheck.passed = readiness.messageReady;
    messageCheck.detail = readiness.messageReady
      ? 'At least one active Role Selector deployment message is present and owned by Goliath.'
      : 'No active Role Selector deployment message is currently present and owned by Goliath.';
  }
  const required = new Set(['module_enabled', 'manage_roles', 'anchor_valid', 'colour_group', 'custom_group', 'deployment_channel', 'deployment_message']);
  result.acceptance.failed = checks.filter((check) => required.has(check.id) && !check.passed).map((check) => check.id);
  result.acceptance.ready = result.acceptance.failed.length === 0;
}

function installHardeningPatch() {
  if (globalThis[HARDENING_PATCH_KEY]) return;
  globalThis[HARDENING_PATCH_KEY] = true;

  queueMicrotask(() => {
    try {
      const roleSelector = require('./roleSelector');
      const service = require('./roleSelectorService');

      const originalSaveGroup = service.saveGroup;
      service.saveGroup = function capacitySafeGroupSave(guildId, input, meta = {}) {
        assertGroupCapacity(service, guildId, input);
        return originalSaveGroup(guildId, input, meta);
      };

      const originalSaveGroupSafe = service.saveGroupSafe;
      service.saveGroupSafe = async function fullySafeGroupSave(guild, input, meta = {}) {
        assertGroupCapacity(service, guild.id, input);
        const result = await originalSaveGroupSafe(guild, input, meta);
        await drainRetiredManagedRoles(service, guild);
        await service.cleanupUnused(guild).catch(() => null);
        return result;
      };

      const originalApplyStandardSelection = service.applyStandardSelection;
      service.applyStandardSelection = async function guardedStandardSelection(guild, member, groupId, optionIds = []) {
        const group = service.getGroup(guild.id, groupId);
        if (group && !group.allowRemove && (!Array.isArray(optionIds) || optionIds.length === 0)) {
          const hasCurrentSelectorRole = service.roleIdsForGroup(group).some((roleId) => member.roles?.cache?.has(roleId));
          if (hasCurrentSelectorRole) throw new Error('This selector does not allow clearing your selection.');
        }
        const result = await originalApplyStandardSelection(guild, member, groupId, optionIds);
        await service.withMutationLock(guild.id, () => eagerPruneUnusedManagedRoles(roleSelector, service, guild, String(groupId || '')));
        return result;
      };

      const originalApplyColourSelection = service.applyColourSelection;
      service.applyColourSelection = async function eagerCleanupColourSelection(guild, member, hexValue, label = null) {
        const result = await originalApplyColourSelection(guild, member, hexValue, label);
        await service.withMutationLock(guild.id, () => eagerPruneUnusedManagedRoles(roleSelector, service, guild, service.COLOUR_GROUP_ID));
        return result;
      };

      const originalClearSelection = service.clearSelection;
      service.clearSelection = async function eagerCleanupClearSelection(guild, member, groupId) {
        const result = await originalClearSelection(guild, member, groupId);
        await service.withMutationLock(guild.id, () => eagerPruneUnusedManagedRoles(roleSelector, service, guild, String(groupId || '')));
        return result;
      };

      // Keep roleSelector as the compatibility entry-point without replacing base
      // primitives that roleSelectorService itself deliberately calls.
      const safeCompatibilityMethods = [
        'applyColourSelection',
        'applyStandardSelection',
        'clearSelection',
        'countManagedRoleReferences',
        'handleMemberRemove',
        'handleRoleDelete',
        'handleRoleUpdate',
        'isGroupMemberUsable',
        'reconcileAllMembers',
        'reconcileMemberFromDiscord',
        'runMaintenance',
        'saveGroupSafe',
        'setAnchorRole',
        'withMaintenanceLock',
        'withMutationLock',
      ];
      roleSelector.MAX_COMPONENT_OPTIONS = service.MAX_COMPONENT_OPTIONS;
      for (const name of safeCompatibilityMethods) {
        if (typeof service[name] === 'function') roleSelector[name] = service[name];
      }

      try {
        const health = require('./roleSelectorHealth');
        if (!health.__roleSelectorHardeningWrapped) {
          const originalBuildHealth = health.buildHealth;
          const originalRepair = health.repair;

          health.buildHealth = async function hardenedBuildHealth(guild) {
            const result = await originalBuildHealth(guild);
            const section = service.getSection(guild.id);
            result.managedRoleCount = service.countManagedRoleReferences(section);

            const usableGroups = service.listGroups(guild.id).filter(service.isGroupMemberUsable).length;
            if (usableGroups > service.MAX_COMPONENT_OPTIONS) result.warnings.push(`${usableGroups} member-usable selector groups exceed Discord's ${service.MAX_COMPONENT_OPTIONS}-category limit.`);
            if (service.listGroups(guild.id).length > service.MAX_COMPONENT_OPTIONS) result.warnings.push(`${service.listGroups(guild.id).length} stored selector groups exceed the Discord admin/member menu limit of ${service.MAX_COMPONENT_OPTIONS}.`);

            repairAcceptanceForModernDeployments(result, await modernDeploymentReadiness(guild, section));
            result.healthy = result.issues.length === 0 && result.warnings.length === 0;
            return result;
          };

          health.repair = async function hardenedRepair(guild) {
            await originalRepair(guild);
            await service.reconcileAllMembers(guild);
            await drainRetiredManagedRoles(service, guild);
            await service.cleanupUnused(guild);
            return health.buildHealth(guild);
          };

          Object.defineProperty(health, '__roleSelectorHardeningWrapped', { value: true });
        }
      } catch (error) {
        console.warn('[RoleSelector] Health hardening patch failed:', error.message || error);
      }
    } catch (error) {
      globalThis[HARDENING_PATCH_KEY] = false;
      console.error('[RoleSelector] Failed to install hardening service:', error);
    }
  });
}

function retryStatsExtensionAfterPanelLoad() {
  // roleSelectorHealth is first loaded while roleSelectorPanel is still evaluating.
  // Re-evaluate it once after the panel exists so the stats v2 router can wrap the
  // completed exported interaction handler. Restore the original health cache entry
  // immediately so callers retain the same hardened health-service instance.
  setImmediate(() => {
    let healthPath;
    let cached;
    try {
      healthPath = require.resolve('./roleSelectorHealth');
      cached = require.cache[healthPath];
      if (!cached) return;
      delete require.cache[healthPath];
      require(healthPath);
    } catch (error) {
      console.warn('[RoleSelector] Stats routing retry failed:', error.message || error);
    } finally {
      if (healthPath && cached) require.cache[healthPath] = cached;
    }
  });
}

function componentData(component) {
  return typeof component?.toJSON === 'function' ? component.toJSON() : component;
}

function componentId(component) {
  const data = componentData(component) || {};
  return String(data.custom_id || data.customId || '');
}

function rawButton(customId, label, style) {
  return { type: 2, custom_id: customId, label, style };
}

function rawRow(components) {
  return { type: 1, components: components.filter(Boolean) };
}

function polishStatsPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const next = { ...payload };
  const embeds = Array.isArray(payload.embeds) ? payload.embeds.map(componentData) : [];
  const components = Array.isArray(payload.components) ? payload.components.map(componentData) : [];
  const title = String(embeds[0]?.title || '');

  if (title === '📊 Role Selector · Manage Stats Panel') {
    const embed = { ...embeds[0] };
    embed.description = String(embed.description || '').replace(
      'Public panels update automatically and include member drill-down controls for normal users.',
      'Changes save automatically and update the deployed panel. Create additional panels for different channels, groups or leaderboard layouts.',
    );
    next.embeds = [embed, ...embeds.slice(1)];

    const actionIndex = components.findIndex((entry) => Array.isArray(entry?.components)
      && entry.components.some((component) => componentId(component).startsWith('admin:roleSelector:statsDeploymentLimit:')));
    const navIndex = components.findIndex((entry) => Array.isArray(entry?.components)
      && entry.components.some((component) => componentId(component) === 'admin:roleSelector:settings'));

    if (actionIndex >= 0) {
      const action = components[actionIndex].components.map(componentData);
      const limit = action.find((component) => componentId(component).startsWith('admin:roleSelector:statsDeploymentLimit:'));
      const deploy = action.find((component) => componentId(component).startsWith('admin:roleSelector:statsDeploy:'));
      const jump = action.find((component) => Number(component?.style) === 5);
      const remove = action.find((component) => componentId(component).startsWith('admin:roleSelector:statsDeploymentDelete:'));
      const deployed = !deploy || /^🔄\s*Update Stats Panel$/i.test(String(deploy.label || ''));

      components[actionIndex] = rawRow([
        rawButton('admin:roleSelector:statsDeploymentCreate', '➕ New Stats Panel', 3),
        limit,
        deployed ? null : deploy,
        jump,
      ]);

      if (navIndex >= 0 && remove) {
        const nav = components[navIndex].components.map(componentData)
          .filter((component) => !componentId(component).startsWith('admin:roleSelector:statsDeploymentDelete:'));
        components[navIndex] = rawRow([...nav, remove]);
      }
    }
    next.components = components;
    return next;
  }

  if (title === '👥 Role Selector · Member Leaderboard' && components.length >= 2) {
    const first = components[0]?.components?.map(componentData) || [];
    const previous = first.find((component) => /statsMemberLeaderboardPage/.test(componentId(component)) && /Previous/.test(String(component.label || '')));
    const nextPage = first.find((component) => /statsMemberLeaderboardPage/.test(componentId(component)) && /Next/.test(String(component.label || '')));
    if (previous?.disabled && nextPage?.disabled) {
      const choice = first.find((component) => componentId(component).includes('statsChoicePicker'));
      const breakdown = (components[1]?.components || []).map(componentData)
        .find((component) => componentId(component).includes('statsBreakdown'));
      next.components = [rawRow([choice, breakdown]), ...components.slice(2)];
      next.embeds = embeds;
      return next;
    }
  }

  return payload;
}

function installStatsInteractionPolishPatch() {
  if (globalThis[STATS_POLISH_PATCH_KEY]) return;
  globalThis[STATS_POLISH_PATCH_KEY] = true;

  setImmediate(() => {
    try {
      const panel = require('./roleSelectorPanel');
      if (!panel || panel.__statsInteractionPolishPatched || typeof panel.handleRoleSelectorInteraction !== 'function') return;

      const original = panel.handleRoleSelectorInteraction;
      panel.handleRoleSelectorInteraction = async function handleRoleSelectorInteractionWithStatsPolish(i) {
        const id = String(i.customId || '');
        const isStats = id.startsWith('admin:roleSelector:stats') || id.startsWith('roleSelector:stats');
        if (!isStats) return original(i);

        const originalReply = typeof i.reply === 'function' ? i.reply.bind(i) : null;
        const originalUpdate = typeof i.update === 'function' ? i.update.bind(i) : null;
        const originalEditReply = typeof i.editReply === 'function' ? i.editReply.bind(i) : null;
        const isEphemeralMessage = Boolean(i.isMessageComponent?.() && i.message?.flags?.has?.(64));
        const switchExistingEphemeral = isEphemeralMessage
          && (id.startsWith('roleSelector:statsMembers:') || id.startsWith('roleSelector:statsBreakdown:'));

        if (originalReply) {
          i.reply = async (payload = {}) => {
            const polished = polishStatsPayload(payload);
            if (switchExistingEphemeral && originalUpdate) {
              const next = { ...polished };
              delete next.flags;
              return originalUpdate(next);
            }
            return originalReply(polished);
          };
        }
        if (originalUpdate) i.update = async (payload = {}) => originalUpdate(polishStatsPayload(payload));
        if (originalEditReply) i.editReply = async (payload = {}) => originalEditReply(polishStatsPayload(payload));

        // Ranking is the slowest config mutation because it also edits the public
        // leaderboard. Acknowledge it immediately, then let the existing handler
        // persist the value and refresh both panels.
        if (id.startsWith('admin:roleSelector:statsDeploymentLimit:')
          && !i.deferred && !i.replied && typeof i.deferUpdate === 'function') {
          await i.deferUpdate();
        }

        try {
          return await original(i);
        } finally {
          if (originalReply) i.reply = originalReply;
          if (originalUpdate) i.update = originalUpdate;
          if (originalEditReply) i.editReply = originalEditReply;
        }
      };

      panel.__statsInteractionPolishPatched = true;
    } catch (error) {
      globalThis[STATS_POLISH_PATCH_KEY] = false;
      console.warn('[RoleSelector] Stats interaction polish patch failed:', error.message || error);
    }
  });
}

installHardeningPatch();
retryStatsExtensionAfterPanelLoad();
installStatsInteractionPolishPatch();

module.exports = {
  lockKey,
  pendingLockCount,
  withDeploymentLock,
  withGuildLock,
  withKeyedLock,
  withManagedRoleLock,
  withMemberGroupLock,
  withRoleSelectorLock,
};
