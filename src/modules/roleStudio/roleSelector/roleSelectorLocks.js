'use strict';

// Process-local keyed queue for Role Selector mutations. Goliath currently runs
// one PM2 process per environment, so this is the correct coordination boundary.
// Keys are deliberately scoped by guild and concern so callers can serialize
// conflicting work without blocking unrelated guilds.
const tails = new Map();
const HARDENING_PATCH_KEY = Symbol.for('goliath.roleSelector.hardeningPatchInstalled');

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
        return originalApplyStandardSelection(guild, member, groupId, optionIds);
      };

      service.handleRoleDelete = async function hardenedRoleDelete(role) {
        return service.withMutationLock(role.guild.id, async () => {
          service.updateSection(role.guild.id, (current) => {
            const groups = JSON.parse(JSON.stringify(current.groups || {}));
            for (const group of Object.values(groups)) {
              if (group.type === 'colour') {
                for (const [hex, record] of Object.entries(group.managedRoles || {})) {
                  if (record.roleId === role.id) delete group.managedRoles[hex];
                }
              } else {
                group.options = (group.options || []).map((option) => option.roleId === role.id ? { ...option, roleId: null, unusedSince: null } : option);
              }
            }
            const identity = current.identity && typeof current.identity === 'object' ? JSON.parse(JSON.stringify(current.identity)) : {};
            identity.retiredManagedRoles = Array.isArray(identity.retiredManagedRoles) ? identity.retiredManagedRoles.filter((entry) => entry.roleId !== role.id) : [];
            const style = current.style?.anchorRoleId === role.id ? { ...current.style, anchorRoleId: null, anchorManaged: false } : current.style;
            return { ...current, groups, identity, style };
          }, { action: 'role_selector_role_deleted' });
          return true;
        });
      };

      Object.assign(roleSelector, service);

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

installHardeningPatch();

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