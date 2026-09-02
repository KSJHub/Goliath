'use strict';

const guildManager = require('../../../core/guild/guildManager');
const base = require('./roleSelector');
const {
  withMemberGroupLock,
  withRoleSelectorLock,
} = require('./roleSelectorLocks');

const MAX_COMPONENT_OPTIONS = 25;
const SESSION_REVISION_KEY = 'hardeningRevision';
const now = () => new Date().toISOString();
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

function slug(value, fallback = 'item') {
  const cleaned = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return cleaned || `${fallback}-${Math.random().toString(36).slice(2, 7)}`;
}
function cleanText(value, max = 100) { return String(value || '').trim().slice(0, max); }
function cleanId(value) {
  const id = String(value || '').replace(/[^0-9]/g, '');
  return /^\d{15,25}$/.test(id) ? id : null;
}
function setEquals(a, b) {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}
function identityState(section) {
  const identity = section?.identity && typeof section.identity === 'object' ? clone(section.identity) : {};
  return {
    retiredGroupIds: Array.isArray(identity.retiredGroupIds) ? [...new Set(identity.retiredGroupIds.map((id) => slug(id)))] : [],
    retiredOptionIds: identity.retiredOptionIds && typeof identity.retiredOptionIds === 'object' ? clone(identity.retiredOptionIds) : {},
    retiredManagedRoles: Array.isArray(identity.retiredManagedRoles) ? clone(identity.retiredManagedRoles) : [],
  };
}
function sanitizeStyle(style = {}) {
  let format = cleanText(style.format || '🎭 | {role}', 100);
  if (!/{role}|{colour}/.test(format)) format = `${format} {role}`.trim().slice(0, 100);
  return {
    ...style,
    format,
    icon: cleanText(style.icon || '', 100),
    separator: cleanText(style.separator || '|', 20) || '|',
    anchorRoleId: cleanId(style.anchorRoleId),
    anchorManaged: style.anchorManaged === true,
    placement: style.placement === 'above' ? 'above' : 'below',
    keepGrouped: style.keepGrouped !== false,
  };
}
function normalizePaletteInput(value) {
  const source = Array.isArray(value) ? value : [];
  const out = [];
  const seenIds = new Set();
  const seenHex = new Set();
  for (let i = 0; i < source.length && out.length < MAX_COMPONENT_OPTIONS; i += 1) {
    const item = source[i] || {};
    const hex = base.normalizeHex(item.hex);
    const id = slug(item.id || item.key || item.label, 'colour');
    if (!hex || seenIds.has(id) || seenHex.has(hex)) continue;
    seenIds.add(id); seenHex.add(hex);
    out.push({ ...item, id, key: id, hex, order: (out.length + 1) * 10 });
  }
  return out;
}
function isGroupMemberUsable(group) {
  if (!group?.enabled) return false;
  if (group.type === 'colour') return Boolean((group.palette || []).some((item) => item.enabled) || group.customHexEnabled);
  return Boolean((group.options || []).some((item) => item.enabled));
}
function validateRoleReferences(section, candidate) {
  const owners = new Map();
  const add = (roleId, owner) => {
    if (!roleId) return;
    const current = owners.get(roleId);
    if (current && current !== owner) throw new Error(`Discord role ${roleId} is already bound to another Role Selector option.`);
    owners.set(roleId, owner);
  };
  for (const group of Object.values(section.groups || {})) {
    if (!group || group.id === candidate.id) continue;
    if (group.type === 'colour') for (const [hex, record] of Object.entries(group.managedRoles || {})) add(record.roleId, `${group.id}:${hex}`);
    else for (const option of group.options || []) add(option.roleId, `${group.id}:${option.id}`);
  }
  if (candidate.type === 'colour') for (const [hex, record] of Object.entries(candidate.managedRoles || {})) add(record.roleId, `${candidate.id}:${hex}`);
  else for (const option of candidate.options || []) add(option.roleId, `${candidate.id}:${option.id}`);
}
function uniqueGroupId(section, requested, retired) {
  const baseId = slug(requested, 'group');
  if (baseId === base.COLOUR_GROUP_ID) throw new Error('Colours is reserved for the built-in selector.');
  const used = new Set([...Object.keys(section.groups || {}), ...(retired || [])]);
  if (!used.has(baseId)) return baseId;
  for (let i = 2; i < 10000; i += 1) {
    const suffix = `-${i}`;
    const candidate = `${baseId.slice(0, Math.max(1, 40 - suffix.length))}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error('Could not allocate a unique Role Selector group ID.');
}
function stabilizeOptions(existingGroup, incoming, retiredIds = []) {
  const existing = Array.isArray(existingGroup?.options) ? existingGroup.options : [];
  const existingById = new Map(existing.map((item) => [item.id, item]));
  const existingByLabel = new Map(existing.map((item) => [String(item.label || '').toLowerCase(), item]));
  const used = new Set(retiredIds.map((id) => slug(id)));
  const consumedExisting = new Set();
  const out = [];
  for (let index = 0; index < (Array.isArray(incoming) ? incoming : []).length && out.length < MAX_COMPONENT_OPTIONS; index += 1) {
    const item = incoming[index] || {};
    const requestedId = item.id ? slug(item.id, 'option') : null;
    let prior = requestedId && existingById.has(requestedId) ? existingById.get(requestedId) : null;
    if (!prior) prior = existingByLabel.get(String(item.label || '').toLowerCase()) || null;
    if (!prior && !requestedId && existing[index] && !consumedExisting.has(existing[index].id)) prior = existing[index];
    if (prior) consumedExisting.add(prior.id);
    let id = prior?.id || requestedId || slug(item.label, 'option');
    if (!prior) {
      const baseId = id;
      let n = 2;
      while (used.has(id) || out.some((entry) => entry.id === id) || existingById.has(id)) {
        const suffix = `-${n++}`;
        id = `${baseId.slice(0, Math.max(1, 40 - suffix.length))}${suffix}`;
      }
    }
    used.add(id);
    out.push({ ...(prior || {}), ...item, id, key: id, order: (out.length + 1) * 10 });
  }
  return out;
}
function collectRetiredManagedRoles(beforeGroup, afterGroup) {
  if (!beforeGroup || beforeGroup.type !== 'standard') return [];
  const afterById = new Map((afterGroup?.options || []).map((item) => [item.id, item]));
  const retired = [];
  for (const oldOption of beforeGroup.options || []) {
    if (!oldOption.roleId || oldOption.managed === false) continue;
    const next = afterById.get(oldOption.id);
    if (!next || next.roleId !== oldOption.roleId || next.managed === false) retired.push({ roleId: oldOption.roleId, groupId: beforeGroup.id, optionId: oldOption.id, kind: 'option', queuedAt: now() });
  }
  return retired;
}
function normalizeIncomingGroup(section, input = {}) {
  const identity = identityState(section);
  const requestedId = input.id || input.key ? slug(input.id || input.key) : null;
  const existing = requestedId ? section.groups?.[requestedId] || null : null;
  if (existing?.builtIn || requestedId === base.COLOUR_GROUP_ID || input.type === 'colour' || input.builtIn === true) {
    if (!existing?.builtIn && requestedId !== base.COLOUR_GROUP_ID) throw new Error('Custom groups cannot become the built-in Colours selector.');
    if (requestedId === base.COLOUR_GROUP_ID && input.builtIn === false) throw new Error('Colours is reserved for the built-in selector.');
    return { ...input, id: base.COLOUR_GROUP_ID, key: base.COLOUR_GROUP_ID, type: 'colour', builtIn: true, palette: Array.isArray(input.palette) ? normalizePaletteInput(input.palette) : input.palette };
  }
  const id = existing?.id || uniqueGroupId(section, requestedId || input.name, identity.retiredGroupIds);
  return { ...input, id, key: id, type: 'standard', builtIn: false, options: stabilizeOptions(existing, input.options || [], identity.retiredOptionIds[id] || []) };
}
function enforceUsableGroupLimit(section, candidate) {
  const groups = { ...(section.groups || {}), [candidate.id]: candidate };
  if (Object.values(groups).filter(isGroupMemberUsable).length > MAX_COMPONENT_OPTIONS) throw new Error(`Role Selector supports up to ${MAX_COMPONENT_OPTIONS} active member categories.`);
}
function saveGroup(guildId, input, meta = {}) {
  const section = base.getSection(guildId);
  const before = input?.id ? section.groups?.[slug(input.id)] || null : null;
  const prepared = normalizeIncomingGroup(section, input);
  validateRoleReferences(section, prepared);
  enforceUsableGroupLimit(section, prepared);
  const saved = base.saveGroup(guildId, prepared, meta);
  const removedIds = before?.type === 'standard' ? (before.options || []).filter((oldItem) => !(saved.options || []).some((item) => item.id === oldItem.id)).map((item) => item.id) : [];
  const retiredManaged = collectRetiredManagedRoles(before, saved);
  base.updateSection(guildId, (current) => {
    const identity = identityState(current);
    if (removedIds.length) identity.retiredOptionIds[saved.id] = [...new Set([...(identity.retiredOptionIds[saved.id] || []), ...removedIds])];
    if (retiredManaged.length) {
      const seen = new Set(identity.retiredManagedRoles.map((item) => item.roleId));
      for (const entry of retiredManaged) if (!seen.has(entry.roleId)) identity.retiredManagedRoles.push(entry);
    }
    return { ...current, identity, [SESSION_REVISION_KEY]: Number(current[SESSION_REVISION_KEY] || 0) + 1 };
  }, { ...meta, action: meta.action || 'role_selector_hardened_save_group' });
  return base.getGroup(guildId, saved.id);
}
function removeGroup(guildId, groupId, meta = {}) {
  const id = slug(groupId);
  const section = base.getSection(guildId);
  const group = section.groups?.[id];
  const removed = base.removeGroup(guildId, id, meta);
  if (!removed) return false;
  base.updateSection(guildId, (current) => {
    const identity = identityState(current);
    identity.retiredGroupIds = [...new Set([...identity.retiredGroupIds, id])];
    if (group?.options?.length) identity.retiredOptionIds[id] = [...new Set([...(identity.retiredOptionIds[id] || []), ...group.options.map((item) => item.id)])];
    return { ...current, identity, [SESSION_REVISION_KEY]: Number(current[SESSION_REVISION_KEY] || 0) + 1 };
  }, { ...meta, action: meta.action || 'role_selector_hardened_remove_group' });
  return true;
}
function updateSection(guildId, updater, meta = {}) {
  return base.updateSection(guildId, (current) => {
    const next = typeof updater === 'function' ? updater(clone(current)) : { ...current, ...(updater || {}) };
    const beforeAnchor = current.style?.anchorRoleId || null;
    const afterAnchor = cleanId(next.style?.anchorRoleId);
    const identity = identityState(next);
    if (beforeAnchor !== afterAnchor) {
      if (current.style?.anchorManaged === true && beforeAnchor) {
        if (!identity.retiredManagedRoles.some((item) => item.roleId === beforeAnchor)) identity.retiredManagedRoles.push({ roleId: beforeAnchor, kind: 'anchor', queuedAt: now() });
      }
      next.style = { ...(next.style || {}), anchorManaged: /create_divider/.test(String(meta.action || '')) };
    }
    next.style = sanitizeStyle(next.style || current.style || {});
    next.identity = identity;
    next[SESSION_REVISION_KEY] = Number(current[SESSION_REVISION_KEY] || 0) + 1;
    return next;
  }, meta);
}
function saveSection(guildId, section, meta = {}) {
  const next = clone(section || {});
  next.style = sanitizeStyle(next.style || {});
  next[SESSION_REVISION_KEY] = Number(base.getSection(guildId)?.[SESSION_REVISION_KEY] || 0) + 1;
  return base.saveSection(guildId, next, meta);
}

function withMutationLock(guildId, task) { return withRoleSelectorLock(guildId, 'mutation', task); }
function withMaintenanceLock(guildId, task) { return withRoleSelectorLock(guildId, 'maintenance', task); }
async function fetchFreshMember(guild, member) { return member?.id ? await guild.members.fetch(member.id).catch(() => member) : member; }
async function convergeGroupRoles(guild, member, groupRoleIds, desiredRoles, reason) {
  const desiredIds = new Set(desiredRoles.map((role) => role.id));
  const groupIds = new Set(groupRoleIds);
  let live = member;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    live = await fetchFreshMember(guild, live);
    for (const roleId of groupIds) if (live.roles.cache.has(roleId) && !desiredIds.has(roleId)) await live.roles.remove(roleId, reason);
    for (const role of desiredRoles) if (!live.roles.cache.has(role.id)) await live.roles.add(role, reason);
    live = await fetchFreshMember(guild, live);
    const actual = new Set([...groupIds].filter((roleId) => live.roles.cache.has(roleId)));
    if (setEquals(actual, desiredIds)) return live;
  }
  throw new Error('Discord did not converge to the requested Role Selector state.');
}
function selectionFor(section, userId, groupId) {
  const raw = section.memberSelections?.[userId]?.[groupId];
  return Array.isArray(raw) ? raw : raw ? [raw] : [];
}
function recordFailure(guildId) {
  try { base.updateSection(guildId, (current) => ({ ...current, analytics: { ...current.analytics, failed: Number(current.analytics?.failed || 0) + 1 } }), { action: 'role_selector_failed_mutation' }); } catch (_) {}
}
async function ensureStandardRoleSafe(guild, group, optionId) {
  const option = (group.options || []).find((item) => item.id === optionId);
  if (!option || !option.enabled) throw new Error('Selector option is unavailable.');
  if (option.managed === false) {
    if (!option.roleId) throw new Error(`The existing role for ${option.label} must be rebound by an administrator.`);
    const role = guild.roles.cache.get(option.roleId) || await guild.roles.fetch(option.roleId).catch(() => null);
    return { role: base.assertSafeSelectorRole(guild, role), option };
  }
  return base.ensureStandardOptionRole(guild, group.id, optionId);
}
async function refreshUnusedStateForGroup(guild, groupId) {
  const group = base.getSection(guild.id).groups?.[groupId];
  if (!group) return;
  const stamp = now();
  if (group.type === 'colour') {
    const managedRoles = clone(group.managedRoles || {}); let changed = false;
    for (const record of Object.values(managedRoles)) {
      const role = guild.roles.cache.get(record.roleId); if (!role) continue;
      const next = role.members.filter((member) => !member.user.bot).size ? null : (record.unusedSince || stamp);
      if (record.unusedSince !== next) { record.unusedSince = next; changed = true; }
    }
    if (changed) base.saveGroup(guild.id, { ...group, managedRoles }, { action: 'role_selector_unused_state_refresh' });
    return;
  }
  const options = clone(group.options || []); let changed = false;
  for (const option of options) {
    if (!option.roleId || option.managed === false) continue;
    const role = guild.roles.cache.get(option.roleId); if (!role) continue;
    const next = role.members.filter((member) => !member.user.bot).size ? null : (option.unusedSince || stamp);
    if (option.unusedSince !== next) { option.unusedSince = next; changed = true; }
  }
  if (changed) base.saveGroup(guild.id, { ...group, options }, { action: 'role_selector_unused_state_refresh' });
}
async function applyStandardSelection(guild, member, groupId, optionIds = []) {
  const id = slug(groupId);
  try {
    return await withMemberGroupLock(guild.id, member.id, id, () => withMutationLock(guild.id, async () => {
      base.assertModuleEnabled(guild.id);
      let section = base.getSection(guild.id); let group = section.groups?.[id];
      if (!group || group.type !== 'standard' || !group.enabled) throw new Error('Selector group is unavailable.');
      let desired = [...new Set(optionIds.map((value) => slug(value)))].filter((optionId) => (group.options || []).some((option) => option.id === optionId && option.enabled));
      if (group.selectionMode === 'single') desired = desired.slice(0, 1);
      const previous = selectionFor(section, member.id, id);
      if (!desired.length && previous.length && !group.allowRemove) throw new Error('This selector does not allow clearing your selection.');
      const desiredRoles = [];
      for (const optionId of desired) desiredRoles.push((await ensureStandardRoleSafe(guild, group, optionId)).role);
      base.assertModuleEnabled(guild.id);
      section = base.getSection(guild.id); group = section.groups?.[id];
      if (!group || !group.enabled || desired.some((optionId) => !(group.options || []).some((option) => option.id === optionId && option.enabled))) throw new Error('Selector configuration changed while your selection was being applied.');
      await convergeGroupRoles(guild, member, base.roleIdsForGroup(group), desiredRoles, `Goliath Role Selector · ${group.name}`);
      base.updateSection(guild.id, (current) => {
        const memberSelections = clone(current.memberSelections || {});
        memberSelections[member.id] = { ...(memberSelections[member.id] || {}), [id]: desired };
        const changed = previous.join('|') !== desired.join('|'); const switched = previous.length && desired.length && changed;
        return { ...current, memberSelections, analytics: { ...current.analytics, selections: Number(current.analytics?.selections || 0) + (changed && desired.length ? 1 : 0), switches: Number(current.analytics?.switches || 0) + (switched ? 1 : 0), removals: Number(current.analytics?.removals || 0) + (changed && !desired.length && previous.length ? 1 : 0), lastSelectionAt: changed ? now() : current.analytics?.lastSelectionAt } };
      }, { actorId: member.id, action: 'role_selector_member_selection' });
      await refreshUnusedStateForGroup(guild, id);
      return desired;
    }));
  } catch (error) { recordFailure(guild.id); throw error; }
}
async function applyColourSelection(guild, member, hexValue, label = null) {
  try {
    return await withMemberGroupLock(guild.id, member.id, base.COLOUR_GROUP_ID, () => withMutationLock(guild.id, async () => {
      base.assertModuleEnabled(guild.id);
      let section = base.getSection(guild.id); let group = section.groups?.[base.COLOUR_GROUP_ID];
      if (!group?.enabled) throw new Error('Colours are disabled.');
      const hex = base.normalizeHex(hexValue); if (!hex) throw new Error('Invalid colour.');
      const builtIn = (group.palette || []).find((item) => item.hex === hex && item.enabled);
      if (!builtIn && !group.customHexEnabled) throw new Error('Custom HEX colours are disabled.');
      const previous = selectionFor(section, member.id, base.COLOUR_GROUP_ID);
      const { role } = await base.ensureColourRole(guild, hex, label || builtIn?.label);
      base.assertModuleEnabled(guild.id);
      section = base.getSection(guild.id); group = section.groups?.[base.COLOUR_GROUP_ID];
      if (!group?.enabled || !((group.palette || []).some((item) => item.hex === hex && item.enabled) || group.customHexEnabled)) throw new Error('Colour configuration changed while your selection was being applied.');
      await convergeGroupRoles(guild, member, base.roleIdsForGroup(group), [role], 'Goliath Role Selector · Colours');
      base.updateSection(guild.id, (current) => {
        const memberSelections = clone(current.memberSelections || {}); memberSelections[member.id] = { ...(memberSelections[member.id] || {}), [base.COLOUR_GROUP_ID]: [hex] };
        const changed = previous[0] !== hex;
        return { ...current, memberSelections, analytics: { ...current.analytics, selections: Number(current.analytics?.selections || 0) + (changed ? 1 : 0), switches: Number(current.analytics?.switches || 0) + (previous.length && changed ? 1 : 0), lastSelectionAt: changed ? now() : current.analytics?.lastSelectionAt } };
      }, { actorId: member.id, action: 'role_selector_colour_selection' });
      await refreshUnusedStateForGroup(guild, base.COLOUR_GROUP_ID);
      return hex;
    }));
  } catch (error) { recordFailure(guild.id); throw error; }
}
async function clearSelection(guild, member, groupId) {
  const id = slug(groupId);
  try {
    return await withMemberGroupLock(guild.id, member.id, id, () => withMutationLock(guild.id, async () => {
      base.assertModuleEnabled(guild.id);
      const section = base.getSection(guild.id); const group = section.groups?.[id];
      if (!group) throw new Error('Selector group not found.'); if (!group.allowRemove) throw new Error('This selector does not allow clearing your selection.');
      const previous = selectionFor(section, member.id, id);
      await convergeGroupRoles(guild, member, base.roleIdsForGroup(group), [], `Goliath Role Selector · ${group.name}`);
      base.updateSection(guild.id, (current) => { const memberSelections = clone(current.memberSelections || {}); memberSelections[member.id] = { ...(memberSelections[member.id] || {}), [id]: [] }; return { ...current, memberSelections, analytics: { ...current.analytics, removals: Number(current.analytics?.removals || 0) + (previous.length ? 1 : 0) } }; }, { actorId: member.id, action: 'role_selector_clear_selection' });
      await refreshUnusedStateForGroup(guild, id);
      return true;
    }));
  } catch (error) { recordFailure(guild.id); throw error; }
}

async function cleanupRetiredManagedRoles(guild) {
  const section = base.getSection(guild.id); const identity = identityState(section);
  if (!identity.retiredManagedRoles.length) return { deleted: 0, retained: 0 };
  const referenced = new Set();
  for (const group of Object.values(section.groups || {})) {
    if (group.type === 'colour') for (const record of Object.values(group.managedRoles || {})) if (record.roleId) referenced.add(record.roleId);
    else for (const option of group.options || []) if (option.roleId) referenced.add(option.roleId);
  }
  const keep = []; let deleted = 0;
  for (const entry of identity.retiredManagedRoles) {
    if (!entry?.roleId || referenced.has(entry.roleId)) continue;
    const role = guild.roles.cache.get(entry.roleId) || await guild.roles.fetch(entry.roleId).catch(() => null);
    if (!role) continue;
    if (role.members.filter((member) => !member.user.bot).size || !base.canManageRole(guild, role)) { keep.push(entry); continue; }
    if (await role.delete(`Goliath Role Selector retired ${entry.kind || 'managed'} role`).then(() => true).catch(() => false)) deleted += 1; else keep.push(entry);
  }
  base.updateSection(guild.id, (current) => { const nextIdentity = identityState(current); nextIdentity.retiredManagedRoles = keep; return { ...current, identity: nextIdentity, analytics: { ...current.analytics, rolesDeleted: Number(current.analytics?.rolesDeleted || 0) + deleted } }; }, { action: 'role_selector_retired_role_cleanup' });
  return { deleted, retained: keep.length };
}
async function cleanupUnused(guild) {
  return withMutationLock(guild.id, async () => {
    await cleanupRetiredManagedRoles(guild);
    const section = base.getSection(guild.id);
    for (const group of Object.values(section.groups || {})) {
      if (group.type === 'colour') {
        let changed = false; const managedRoles = clone(group.managedRoles || {});
        for (const record of Object.values(managedRoles)) if (record.unusedSince && !Number.isFinite(new Date(record.unusedSince).getTime())) { record.unusedSince = null; changed = true; }
        if (changed) base.saveGroup(guild.id, { ...group, managedRoles }, { action: 'role_selector_repair_unused_timestamp' });
      } else {
        let changed = false; const options = clone(group.options || []);
        for (const option of options) if (option.unusedSince && !Number.isFinite(new Date(option.unusedSince).getTime())) { option.unusedSince = null; changed = true; }
        if (changed) base.saveGroup(guild.id, { ...group, options }, { action: 'role_selector_repair_unused_timestamp' });
      }
    }
    return base.cleanupUnused(guild);
  });
}
async function deleteManagedGroupRoles(guild, groupId) { return withMutationLock(guild.id, () => base.deleteManagedGroupRoles(guild, groupId)); }

async function reconcileMemberFromDiscord(guild, member) {
  return withMutationLock(guild.id, async () => {
    const live = await fetchFreshMember(guild, member); const section = base.getSection(guild.id); const nextSelections = { ...(section.memberSelections?.[live.id] || {}) };
    for (const group of Object.values(section.groups || {})) {
      if (group.type === 'colour') {
        const matches = Object.entries(group.managedRoles || {}).filter(([, record]) => live.roles.cache.has(record.roleId));
        if (matches.length > 1) {
          const [hex, record] = matches[0]; const role = guild.roles.cache.get(record.roleId);
          await convergeGroupRoles(guild, live, base.roleIdsForGroup(group), role ? [role] : [], 'Goliath Role Selector · reconcile colours'); nextSelections[group.id] = role ? [hex] : [];
        } else nextSelections[group.id] = matches.map(([hex]) => hex);
      } else {
        const ordered = [...(group.options || [])].sort((a, b) => Number(a.order || 0) - Number(b.order || 0)); const matches = ordered.filter((option) => option.roleId && live.roles.cache.has(option.roleId));
        if (group.selectionMode === 'single' && matches.length > 1) {
          const winner = matches[0]; const role = guild.roles.cache.get(winner.roleId);
          await convergeGroupRoles(guild, live, base.roleIdsForGroup(group), role ? [role] : [], `Goliath Role Selector · reconcile ${group.name}`); nextSelections[group.id] = role ? [winner.id] : [];
        } else nextSelections[group.id] = matches.map((option) => option.id);
      }
      await refreshUnusedStateForGroup(guild, group.id);
    }
    base.updateSection(guild.id, (current) => { const memberSelections = clone(current.memberSelections || {}); if (Object.values(nextSelections).some((value) => Array.isArray(value) ? value.length : Boolean(value))) memberSelections[live.id] = nextSelections; else delete memberSelections[live.id]; return { ...current, memberSelections }; }, { actorId: live.id, action: 'role_selector_member_role_reconcile' });
    return nextSelections;
  });
}
async function handleMemberRemove(member) {
  return withMutationLock(member.guild.id, async () => {
    const section = base.getSection(member.guild.id);
    base.updateSection(member.guild.id, (current) => { const memberSelections = clone(current.memberSelections || {}); delete memberSelections[member.id]; return { ...current, memberSelections }; }, { actorId: member.id, action: 'role_selector_member_departed' });
    for (const group of Object.values(section.groups || {})) if (base.roleIdsForGroup(group).some((roleId) => member.roles.cache.has(roleId))) await refreshUnusedStateForGroup(member.guild, group.id);
    return true;
  });
}
async function handleRoleDelete(role) {
  return withMutationLock(role.guild.id, async () => {
    base.updateSection(role.guild.id, (current) => {
      const groups = clone(current.groups || {});
      for (const group of Object.values(groups)) {
        if (group.type === 'colour') for (const [hex, record] of Object.entries(group.managedRoles || {})) if (record.roleId === role.id) delete group.managedRoles[hex];
        else group.options = (group.options || []).map((option) => option.roleId === role.id ? { ...option, roleId: null, unusedSince: null } : option);
      }
      const identity = identityState(current); identity.retiredManagedRoles = identity.retiredManagedRoles.filter((entry) => entry.roleId !== role.id);
      const style = current.style?.anchorRoleId === role.id ? { ...current.style, anchorRoleId: null, anchorManaged: false } : current.style;
      return { ...current, groups, identity, style, [SESSION_REVISION_KEY]: Number(current[SESSION_REVISION_KEY] || 0) + 1 };
    }, { action: 'role_selector_role_deleted' });
    return true;
  });
}
async function syncManagedAppearanceUnlocked(guild) {
  const section = base.getSection(guild.id);
  for (const group of Object.values(section.groups || {})) {
    const records = group.type === 'colour'
      ? Object.values(group.managedRoles || {}).map((record) => ({ roleId: record.roleId }))
      : (group.options || []).filter((option) => option.roleId && option.managed !== false).map((option) => ({ roleId: option.roleId }));
    for (const record of records) {
      const role = guild.roles.cache.get(record.roleId) || await guild.roles.fetch(record.roleId).catch(() => null);
      if (!base.canManageRole(guild, role)) continue;
      const patch = {};
      if (role.permissions.bitfield !== 0n) patch.permissions = [];
      if (role.hoist) patch.hoist = false;
      if (role.mentionable) patch.mentionable = false;
      if (Object.keys(patch).length) await role.edit({ ...patch, reason: 'Goliath Role Selector safety sync' });
    }
  }
  return base.syncManagedRoleAppearance(guild);
}
async function handleRoleUpdate(role) {
  const section = base.getSection(role.guild.id); let managed = false;
  for (const group of Object.values(section.groups || {})) {
    if (group.type === 'colour') managed ||= Object.values(group.managedRoles || {}).some((record) => record.roleId === role.id);
    else managed ||= (group.options || []).some((option) => option.roleId === role.id && option.managed !== false);
  }
  if (!managed && section.style?.anchorRoleId !== role.id) return false;
  await withMaintenanceLock(role.guild.id, async () => { await syncManagedAppearanceUnlocked(role.guild).catch(() => null); await base.syncManagedRoleHierarchy(role.guild).catch(() => null); });
  return true;
}
async function reconcileAllMembers(guild) {
  const section = base.getSection(guild.id); const ids = new Set(Object.keys(section.memberSelections || {}));
  for (const group of Object.values(section.groups || {})) for (const roleId of base.roleIdsForGroup(group)) { const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null); if (role) for (const member of role.members.values()) if (!member.user.bot) ids.add(member.id); }
  let reconciled = 0;
  for (const memberId of ids) {
    const member = guild.members.cache.get(memberId) || await guild.members.fetch(memberId).catch(() => null);
    if (!member) { base.updateSection(guild.id, (current) => { const memberSelections = clone(current.memberSelections || {}); delete memberSelections[memberId]; return { ...current, memberSelections }; }, { action: 'role_selector_reconcile_missing_member' }); continue; }
    await reconcileMemberFromDiscord(guild, member); reconciled += 1;
  }
  return { reconciled };
}
async function reconcileStoredSelectionsForGroup(guild, groupId) {
  const section = base.getSection(guild.id); const group = section.groups?.[groupId]; if (!group || group.type !== 'standard') return { reconciled: 0 };
  let reconciled = 0;
  for (const [memberId, selections] of Object.entries(section.memberSelections || {})) {
    const desiredIds = Array.isArray(selections?.[groupId]) ? selections[groupId] : selections?.[groupId] ? [selections[groupId]] : []; if (!desiredIds.length) continue;
    const member = guild.members.cache.get(memberId) || await guild.members.fetch(memberId).catch(() => null); if (!member) continue;
    const desiredRoles = [];
    for (const optionId of desiredIds) { const latest = base.getGroup(guild.id, groupId); const option = latest?.options?.find((item) => item.id === optionId && item.enabled); if (option) desiredRoles.push((await ensureStandardRoleSafe(guild, latest, optionId)).role); }
    const latest = base.getGroup(guild.id, groupId); await convergeGroupRoles(guild, member, base.roleIdsForGroup(latest), desiredRoles, `Goliath Role Selector · reconcile ${latest.name}`); reconciled += 1;
  }
  await refreshUnusedStateForGroup(guild, groupId); return { reconciled };
}
async function saveGroupSafe(guild, input, meta = {}) {
  const saved = saveGroup(guild.id, input, meta);
  if (saved.type === 'standard') await withMutationLock(guild.id, () => reconcileStoredSelectionsForGroup(guild, saved.id));
  await withMutationLock(guild.id, () => cleanupRetiredManagedRoles(guild));
  return base.getGroup(guild.id, saved.id);
}
async function setAnchorRole(guild, roleId, options = {}) {
  const result = await withMutationLock(guild.id, async () => {
    const section = base.getSection(guild.id); const previousId = section.style?.anchorRoleId || null; const previousManaged = section.style?.anchorManaged === true; const nextId = cleanId(roleId);
    let role = null;
    if (nextId) { role = guild.roles.cache.get(nextId) || await guild.roles.fetch(nextId).catch(() => null); if (!role || !base.canManageRole(guild, role)) throw new Error('The selected divider / anchor must be below Goliath and manageable.'); }
    updateSection(guild.id, (current) => ({ ...current, style: { ...current.style, anchorRoleId: nextId, anchorManaged: options.managed === true } }), { ...(options.meta || {}), action: options.meta?.action || (options.managed ? 'role_selector_create_divider' : 'role_selector_anchor') });
    if (previousManaged && previousId && previousId !== nextId) { const previous = guild.roles.cache.get(previousId) || await guild.roles.fetch(previousId).catch(() => null); if (previous && base.canManageRole(guild, previous)) await previous.delete('Goliath Role Selector replaced divider').catch(() => null); }
    return role;
  });
  void syncManagedRoleHierarchy(guild).catch((error) => {
    console.error('[RoleSelector] Deferred hierarchy sync failed:', error);
  });
  return result;
}
async function runMaintenance(guild) {
  if (!guildManager.isModuleEnabled(guild.id, base.MODULE)) return { skipped: true, failures: 0 };
  let failures = 0;
  await withMaintenanceLock(guild.id, async () => {
    await syncManagedAppearanceUnlocked(guild).catch(() => { failures += 1; });
    await base.syncManagedRoleHierarchy(guild).catch(() => { failures += 1; });
  });
  await cleanupUnused(guild).catch(() => { failures += 1; });
  return { skipped: false, failures };
}
async function syncManagedRoleAppearance(guild) { return withMaintenanceLock(guild.id, () => syncManagedAppearanceUnlocked(guild)); }
async function syncManagedRoleHierarchy(guild) { return withMaintenanceLock(guild.id, () => base.syncManagedRoleHierarchy(guild)); }
function countManagedRoleReferences(section) {
  let count = 0;
  for (const group of Object.values(section?.groups || {})) {
    if (group.type === 'colour') count += Object.values(group.managedRoles || {}).filter((record) => record.roleId).length;
    else count += (group.options || []).filter((option) => option.roleId && option.managed !== false).length;
  }
  return count;
}

module.exports = {
  ...base,
  MAX_COMPONENT_OPTIONS,
  applyColourSelection,
  applyStandardSelection,
  cleanupUnused,
  clearSelection,
  countManagedRoleReferences,
  deleteManagedGroupRoles,
  handleMemberRemove,
  handleRoleDelete,
  handleRoleUpdate,
  isGroupMemberUsable,
  reconcileAllMembers,
  reconcileMemberFromDiscord,
  removeGroup,
  runMaintenance,
  saveGroup,
  saveGroupSafe,
  saveSection,
  setAnchorRole,
  syncManagedRoleAppearance,
  syncManagedRoleHierarchy,
  updateSection,
  withMaintenanceLock,
  withMutationLock,
};
