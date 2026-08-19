'use strict';

const { PermissionFlagsBits } = require('discord.js');
const guildManager = require('../../../core/guild/guildManager');
const { getModuleSection, saveModuleSection, updateModuleSection } = require('../../../core/guild/moduleSectionManager');

const MODULE = 'roleSelector';
const COLOUR_GROUP_ID = 'colours';
const now = () => new Date().toISOString();
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

const DEFAULT_PALETTE = Object.freeze([
  { id: 'red', label: 'Red', emoji: '🔴', hex: '#E74C3C', family: 'red', order: 10, enabled: true },
  { id: 'orange', label: 'Orange', emoji: '🟠', hex: '#E67E22', family: 'orange', order: 20, enabled: true },
  { id: 'yellow', label: 'Yellow', emoji: '🟡', hex: '#F1C40F', family: 'yellow', order: 30, enabled: true },
  { id: 'green', label: 'Green', emoji: '🟢', hex: '#2ECC71', family: 'green', order: 40, enabled: true },
  { id: 'blue', label: 'Blue', emoji: '🔵', hex: '#3498DB', family: 'blue', order: 50, enabled: true },
  { id: 'purple', label: 'Purple', emoji: '🟣', hex: '#9B59B6', family: 'purple', order: 60, enabled: true },
  { id: 'pink', label: 'Pink', emoji: '🩷', hex: '#E84393', family: 'pink', order: 70, enabled: true },
  { id: 'black', label: 'Black', emoji: '⚫', hex: '#23272A', family: 'black', order: 80, enabled: true },
  { id: 'white', label: 'White', emoji: '⚪', hex: '#F5F5F5', family: 'white', order: 90, enabled: true },
]);

const FAMILY_ORDER = Object.freeze({ red: 10, orange: 20, yellow: 30, green: 40, blue: 50, purple: 60, pink: 70, black: 80, white: 90 });

function slug(value, fallback = 'item') {
  const cleaned = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return cleaned || `${fallback}-${Math.random().toString(36).slice(2, 7)}`;
}
function cleanId(value) {
  const id = String(value || '').replace(/[^0-9]/g, '');
  return /^\d{15,25}$/.test(id) ? id : null;
}
function cleanText(value, max = 100) { return String(value || '').trim().slice(0, max); }
function normalizeHex(value, fallback = null) {
  const raw = String(value || '').trim().replace(/^#/, '').toUpperCase();
  return /^[0-9A-F]{6}$/.test(raw) ? `#${raw}` : fallback;
}
function hexToInt(hex) { return parseInt(normalizeHex(hex, '#000000').slice(1), 16); }
function rgbFromHex(hex) {
  const value = normalizeHex(hex, '#000000').slice(1);
  return { r: parseInt(value.slice(0, 2), 16), g: parseInt(value.slice(2, 4), 16), b: parseInt(value.slice(4, 6), 16) };
}
function rgbToHsl({ r, g, b }) {
  const rn = r / 255; const gn = g / 255; const bn = b / 255;
  const max = Math.max(rn, gn, bn); const min = Math.min(rn, gn, bn);
  let h = 0; let s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min; s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}
function classifyHex(hex) {
  const normalized = normalizeHex(hex, '#000000');
  const { h, s, l } = rgbToHsl(rgbFromHex(normalized));
  if (l <= 16) return { family: 'black', familyOrder: FAMILY_ORDER.black, hue: h, lightness: l };
  if (l >= 92 && s <= 20) return { family: 'white', familyOrder: FAMILY_ORDER.white, hue: h, lightness: l };
  let family = 'red';
  if (h < 15 || h >= 345) family = 'red'; else if (h < 45) family = 'orange'; else if (h < 75) family = 'yellow'; else if (h < 165) family = 'green'; else if (h < 255) family = 'blue'; else if (h < 315) family = 'purple'; else family = 'pink';
  return { family, familyOrder: FAMILY_ORDER[family], hue: h, lightness: l };
}

function defaultColourGroup() {
  return {
    id: COLOUR_GROUP_ID,
    key: COLOUR_GROUP_ID,
    name: 'Colours',
    emoji: '🌈',
    description: 'Choose a cosmetic Discord name colour.',
    type: 'colour',
    builtIn: true,
    enabled: true,
    selectionMode: 'single',
    allowRemove: true,
    palette: DEFAULT_PALETTE.map(clone),
    customHexEnabled: true,
    managedRoles: {},
  };
}
function defaultAnalytics() {
  return { selections: 0, switches: 0, removals: 0, rolesCreated: 0, rolesDeleted: 0, failed: 0, lastSelectionAt: null };
}
function defaultSection() {
  return {
    groups: { [COLOUR_GROUP_ID]: defaultColourGroup() },
    groupOrder: [COLOUR_GROUP_ID],
    memberSelections: {},
    style: { format: '🎭 | {role}', icon: '🎭', separator: '|', anchorRoleId: null, placement: 'below', keepGrouped: true, detectedFormat: null, detectedIcon: null, detectedSeparator: null, detectedConfidence: 0 },
    deployment: { channelId: null, messageId: null },
    cleanup: { deleteUnusedRoles: true, unusedGraceHours: 168 },
    analytics: defaultAnalytics(),
    createdAt: now(),
    updatedAt: now(),
  };
}

function normalizePalette(value) {
  const source = Array.isArray(value) && value.length ? value : DEFAULT_PALETTE;
  const out = []; const seen = new Set();
  for (const item of source) {
    const hex = normalizeHex(item?.hex); const id = slug(item?.id || item?.key || item?.label, 'colour');
    if (!hex || seen.has(id)) continue; seen.add(id);
    const c = classifyHex(hex);
    out.push({ id, key: id, label: cleanText(item?.label || id, 60), emoji: cleanText(item?.emoji || '🎨', 16), hex, family: cleanText(item?.family || c.family, 20), order: Number.isFinite(Number(item?.order)) ? Number(item.order) : c.familyOrder, enabled: item?.enabled !== false });
  }
  return out.length ? out : DEFAULT_PALETTE.map(clone);
}
function normalizeStandardOptions(value) {
  const source = Array.isArray(value) ? value : [];
  const out = []; const seen = new Set();
  for (let i = 0; i < source.length && out.length < 25; i += 1) {
    const item = source[i] || {}; const id = slug(item.id || item.key || item.label, 'option');
    if (seen.has(id)) continue; seen.add(id);
    out.push({ id, key: id, label: cleanText(item.label || id, 80), emoji: cleanText(item.emoji || '', 16), description: cleanText(item.description || '', 100), roleId: cleanId(item.roleId), enabled: item.enabled !== false, order: Number.isFinite(Number(item.order)) ? Number(item.order) : (i + 1) * 10, managed: item.managed !== false, unusedSince: item.unusedSince || null });
  }
  return out;
}
function normalizeGroup(input = {}, idHint = '') {
  const id = slug(input.id || input.key || idHint || input.name, 'group');
  const isColour = id === COLOUR_GROUP_ID || input.type === 'colour' || input.builtIn === true && /colou?r/i.test(input.name || '');
  if (isColour) {
    const base = defaultColourGroup();
    const managedRoles = {};
    const sourceManaged = input.managedRoles && typeof input.managedRoles === 'object' ? input.managedRoles : {};
    for (const [hexKey, record] of Object.entries(sourceManaged)) {
      const hex = normalizeHex(record?.hex || hexKey); const roleId = cleanId(record?.roleId); if (!hex || !roleId) continue;
      const c = classifyHex(hex);
      managedRoles[hex] = { roleId, hex, label: cleanText(record?.label || hex, 60), family: cleanText(record?.family || c.family, 20), hue: Number.isFinite(Number(record?.hue)) ? Number(record.hue) : c.hue, createdAt: record?.createdAt || now(), unusedSince: record?.unusedSince || null };
    }
    return { ...base, ...clone(input), id: COLOUR_GROUP_ID, key: COLOUR_GROUP_ID, name: 'Colours', emoji: input.emoji || '🌈', type: 'colour', builtIn: true, enabled: input.enabled !== false, selectionMode: 'single', allowRemove: input.allowRemove !== false, palette: normalizePalette(input.palette), customHexEnabled: input.customHexEnabled !== false, managedRoles };
  }
  return { id, key: id, name: cleanText(input.name || id, 80), emoji: cleanText(input.emoji || '🏷️', 16), description: cleanText(input.description || '', 200), type: 'standard', builtIn: false, enabled: input.enabled !== false, selectionMode: input.selectionMode === 'multiple' ? 'multiple' : 'single', allowRemove: input.allowRemove !== false, options: normalizeStandardOptions(input.options), createdAt: input.createdAt || now(), updatedAt: input.updatedAt || now() };
}
function normalizeSection(value = {}) {
  const base = defaultSection(); const source = value && typeof value === 'object' ? value : {};
  const rawGroups = source.groups && typeof source.groups === 'object' ? source.groups : {};
  const groups = {};
  for (const [id, group] of Object.entries(rawGroups)) { const normalized = normalizeGroup(group, id); groups[normalized.id] = normalized; }
  if (!groups[COLOUR_GROUP_ID]) groups[COLOUR_GROUP_ID] = defaultColourGroup();
  const groupOrder = [...new Set([...(Array.isArray(source.groupOrder) ? source.groupOrder.map((id) => slug(id)) : []), COLOUR_GROUP_ID, ...Object.keys(groups)])].filter((id) => groups[id]);
  return {
    ...base,
    ...clone(source),
    groups,
    groupOrder,
    memberSelections: source.memberSelections && typeof source.memberSelections === 'object' ? clone(source.memberSelections) : {},
    style: { ...base.style, ...(source.style || {}), anchorRoleId: cleanId(source.style?.anchorRoleId), placement: source.style?.placement === 'above' ? 'above' : 'below', keepGrouped: source.style?.keepGrouped !== false },
    deployment: { channelId: cleanId(source.deployment?.channelId), messageId: cleanId(source.deployment?.messageId) },
    cleanup: { deleteUnusedRoles: source.cleanup?.deleteUnusedRoles !== false, unusedGraceHours: Math.min(720, Math.max(1, Number(source.cleanup?.unusedGraceHours || 168))) },
    analytics: { ...defaultAnalytics(), ...(source.analytics || {}) },
    createdAt: source.createdAt || base.createdAt,
    updatedAt: source.updatedAt || now(),
  };
}
function getSection(guildId) { return normalizeSection(getModuleSection(guildId, MODULE, defaultSection())); }
function saveSection(guildId, section, meta = {}) { return normalizeSection(saveModuleSection(guildId, MODULE, normalizeSection(section), meta)); }
function updateSection(guildId, updater, meta = {}) { return normalizeSection(updateModuleSection(guildId, MODULE, (current) => { const normalized = normalizeSection(current); const next = typeof updater === 'function' ? updater(clone(normalized)) : { ...normalized, ...(updater || {}) }; return { ...normalizeSection(next), updatedAt: now() }; }, defaultSection(), meta)); }
function listGroups(guildId) { const section = getSection(guildId); return section.groupOrder.map((id) => section.groups[id]).filter(Boolean); }
function getGroup(guildId, groupId) { return getSection(guildId).groups[slug(groupId)] || null; }
function saveGroup(guildId, input, meta = {}) {
  const group = normalizeGroup(input, input?.id); if (group.id === COLOUR_GROUP_ID && input?.builtIn === false) throw new Error('The built-in Colours selector cannot be replaced.');
  updateSection(guildId, (section) => ({ ...section, groups: { ...section.groups, [group.id]: { ...(section.groups[group.id] || {}), ...group, updatedAt: now() } }, groupOrder: [...new Set([...section.groupOrder, group.id])] }), meta);
  return getGroup(guildId, group.id);
}
function removeGroup(guildId, groupId, meta = {}) {
  const id = slug(groupId); if (id === COLOUR_GROUP_ID) throw new Error('The built-in Colours selector cannot be deleted.');
  let removed = false;
  updateSection(guildId, (section) => { const groups = { ...section.groups }; removed = Boolean(groups[id]); delete groups[id]; const memberSelections = clone(section.memberSelections); for (const user of Object.values(memberSelections)) if (user && typeof user === 'object') delete user[id]; return { ...section, groups, groupOrder: section.groupOrder.filter((key) => key !== id), memberSelections }; }, meta);
  return removed;
}

function roleNameFor(section, label, group = null) {
  const style = section.style || defaultSection().style;
  return String(style.format || '{role}')
    .replaceAll('{icon}', style.icon || '')
    .replaceAll('{separator}', style.separator || '|')
    .replaceAll('{role}', String(label || 'Role'))
    .replaceAll('{colour}', String(label || 'Role'))
    .replaceAll('{group}', String(group?.name || ''))
    .replace(/\s{2,}/g, ' ').trim().slice(0, 100);
}
function canManageRole(guild, role) { const me = guild?.members?.me; return Boolean(me && me.permissions.has(PermissionFlagsBits.ManageRoles) && role && !role.managed && role.position < me.roles.highest.position); }
function assertSafeSelectorRole(guild, role) {
  if (!role) throw new Error('The selected existing role no longer exists.');
  if (!canManageRole(guild, role)) throw new Error(`Goliath cannot safely manage @${role.name}; move it below Goliath first.`);
  if (role.permissions.bitfield !== 0n) throw new Error(`@${role.name} has Discord permissions. Self-service selector roles must not grant permissions.`);
  return role;
}
function suggestRoleStyle(guild) {
  const names = [...(guild?.roles?.cache?.values?.() || [])].filter((role) => role.id !== guild.id && !role.managed).map((role) => role.name).filter(Boolean).slice(0, 100);
  const candidates = [' | ', ' • ', '・', ' ┃ ', ' - ', ' » ']; let best = { separator: ' | ', count: 0 };
  for (const separator of candidates) { const count = names.filter((name) => name.includes(separator)).length; if (count > best.count) best = { separator, count }; }
  const separator = best.count >= 2 ? best.separator.trim() : '|';
  const examples = names.filter((name) => name.includes(best.separator)).slice(0, 5);
  const first = examples[0] || ''; const prefix = first.includes(best.separator) ? first.split(best.separator)[0].trim() : '';
  const icon = /^\p{Extended_Pictographic}/u.test(prefix) ? [...prefix][0] : '';
  return { format: icon ? `{icon} ${separator} {role}` : `{role}`, icon, separator, confidence: Math.min(1, best.count / Math.max(1, names.length)), examples };
}

async function ensureStandardOptionRole(guild, groupId, optionId) {
  const section = getSection(guild.id); const group = section.groups[slug(groupId)]; if (!group || group.type !== 'standard') throw new Error('Selector group not found.');
  const option = group.options.find((item) => item.id === slug(optionId)); if (!option || !option.enabled) throw new Error('Selector option not found or disabled.');
  let role = option.roleId ? guild.roles.cache.get(option.roleId) || await guild.roles.fetch(option.roleId).catch(() => null) : null;
  if (role) return { role: assertSafeSelectorRole(guild, role), option };
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) throw new Error('Goliath needs Manage Roles to create selector roles.');
  role = await guild.roles.create({ name: roleNameFor(section, option.label, group), permissions: [], hoist: false, mentionable: false, reason: `Goliath Role Selector · ${group.name}` });
  saveGroup(guild.id, { ...group, options: group.options.map((item) => item.id === option.id ? { ...item, roleId: role.id, managed: true, unusedSince: null } : item) }, { actorId: guild.members.me?.id, action: 'role_selector_create_option_role' });
  updateSection(guild.id, (current) => ({ ...current, analytics: { ...current.analytics, rolesCreated: Number(current.analytics.rolesCreated || 0) + 1 } }));
  return { role, option: { ...option, roleId: role.id } };
}
async function ensureColourRole(guild, hexValue, label = null) {
  const hex = normalizeHex(hexValue); if (!hex) throw new Error('Enter a valid six-digit HEX colour.');
  const section = getSection(guild.id); const group = section.groups[COLOUR_GROUP_ID]; const existing = group.managedRoles?.[hex];
  let role = existing?.roleId ? guild.roles.cache.get(existing.roleId) || await guild.roles.fetch(existing.roleId).catch(() => null) : null;
  if (role) return { role, hex };
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) throw new Error('Goliath needs Manage Roles to create colour roles.');
  const builtIn = group.palette.find((item) => item.hex === hex); const finalLabel = cleanText(label || builtIn?.label || hex, 60); const c = classifyHex(hex);
  role = await guild.roles.create({ name: roleNameFor(section, finalLabel, group), color: hexToInt(hex), permissions: [], hoist: false, mentionable: false, reason: 'Goliath Role Selector · Colours' });
  const nextGroup = { ...group, managedRoles: { ...(group.managedRoles || {}), [hex]: { roleId: role.id, hex, label: finalLabel, family: c.family, hue: c.hue, createdAt: now(), unusedSince: null } } };
  saveGroup(guild.id, nextGroup, { actorId: guild.members.me?.id, action: 'role_selector_create_colour_role' });
  updateSection(guild.id, (current) => ({ ...current, analytics: { ...current.analytics, rolesCreated: Number(current.analytics.rolesCreated || 0) + 1 } }));
  return { role, hex };
}

function roleIdsForGroup(group) {
  if (!group) return [];
  if (group.type === 'colour') return Object.values(group.managedRoles || {}).map((record) => record.roleId).filter(Boolean);
  return (group.options || []).map((option) => option.roleId).filter(Boolean);
}
async function deleteManagedGroupRoles(guild, groupId) {
  const group = getGroup(guild.id, groupId);
  if (!group || group.builtIn) return { deleted: 0, skipped: 0 };
  let deleted = 0; let skipped = 0;
  for (const option of group.options || []) {
    if (!option.roleId || option.managed === false) { skipped += option.roleId ? 1 : 0; continue; }
    const role = guild.roles.cache.get(option.roleId) || await guild.roles.fetch(option.roleId).catch(() => null);
    if (!role) continue;
    if (!canManageRole(guild, role)) { skipped += 1; continue; }
    if (await role.delete(`Goliath Role Selector group deleted · ${group.name}`).then(() => true).catch(() => false)) deleted += 1;
  }
  if (deleted) updateSection(guild.id, (current) => ({ ...current, analytics: { ...current.analytics, rolesDeleted: Number(current.analytics.rolesDeleted || 0) + deleted } }));
  return { deleted, skipped };
}
function selectionFor(section, userId, groupId) {
  const value = section.memberSelections?.[userId]?.[groupId]; return Array.isArray(value) ? value : value ? [value] : [];
}
async function applyStandardSelection(guild, member, groupId, optionIds = []) {
  const id = slug(groupId); let section = getSection(guild.id); const group = section.groups[id]; if (!group || group.type !== 'standard' || !group.enabled) throw new Error('Selector group is unavailable.');
  let desired = [...new Set(optionIds.map(slug))].filter((optionId) => group.options.some((option) => option.id === optionId && option.enabled));
  if (group.selectionMode === 'single') desired = desired.slice(0, 1);
  const previous = selectionFor(section, member.id, id); const desiredRoles = [];
  for (const optionId of desired) desiredRoles.push((await ensureStandardOptionRole(guild, id, optionId)).role);
  section = getSection(guild.id); const refreshed = section.groups[id]; const groupRoleIds = roleIdsForGroup(refreshed);
  const desiredRoleIds = new Set(desiredRoles.map((role) => role.id));
  for (const roleId of groupRoleIds) if (member.roles.cache.has(roleId) && !desiredRoleIds.has(roleId)) await member.roles.remove(roleId, `Goliath Role Selector · ${refreshed.name}`).catch(() => null);
  for (const role of desiredRoles) if (!member.roles.cache.has(role.id)) await member.roles.add(role, `Goliath Role Selector · ${refreshed.name}`);
  updateSection(guild.id, (current) => {
    const memberSelections = clone(current.memberSelections); memberSelections[member.id] = { ...(memberSelections[member.id] || {}), [id]: desired };
    const switched = previous.length && desired.length && previous.join('|') !== desired.join('|');
    return { ...current, memberSelections, analytics: { ...current.analytics, selections: Number(current.analytics.selections || 0) + (desired.length ? 1 : 0), switches: Number(current.analytics.switches || 0) + (switched ? 1 : 0), removals: Number(current.analytics.removals || 0) + (!desired.length && previous.length ? 1 : 0), lastSelectionAt: now() } };
  }, { actorId: member.id, action: 'role_selector_member_selection' });
  await syncManagedRoleHierarchy(guild).catch(() => null);
  return desired;
}
async function applyColourSelection(guild, member, hexValue, label = null) {
  const section = getSection(guild.id); const group = section.groups[COLOUR_GROUP_ID]; if (!group.enabled) throw new Error('Colours are disabled.');
  const hex = normalizeHex(hexValue); if (!hex) throw new Error('Invalid colour.');
  const builtIn = group.palette.find((item) => item.hex === hex && item.enabled); if (!builtIn && !group.customHexEnabled) throw new Error('Custom HEX colours are disabled.');
  const previous = selectionFor(section, member.id, COLOUR_GROUP_ID); const { role } = await ensureColourRole(guild, hex, label || builtIn?.label);
  const currentSection = getSection(guild.id); for (const roleId of roleIdsForGroup(currentSection.groups[COLOUR_GROUP_ID])) if (roleId !== role.id && member.roles.cache.has(roleId)) await member.roles.remove(roleId, 'Goliath Role Selector · Colours').catch(() => null);
  if (!member.roles.cache.has(role.id)) await member.roles.add(role, 'Goliath Role Selector · Colours');
  updateSection(guild.id, (current) => { const memberSelections = clone(current.memberSelections); memberSelections[member.id] = { ...(memberSelections[member.id] || {}), [COLOUR_GROUP_ID]: [hex] }; return { ...current, memberSelections, analytics: { ...current.analytics, selections: Number(current.analytics.selections || 0) + 1, switches: Number(current.analytics.switches || 0) + (previous.length && previous[0] !== hex ? 1 : 0), lastSelectionAt: now() } }; }, { actorId: member.id, action: 'role_selector_colour_selection' });
  await syncManagedRoleHierarchy(guild).catch(() => null); return hex;
}
async function clearSelection(guild, member, groupId) {
  const id = slug(groupId); const section = getSection(guild.id); const group = section.groups[id]; if (!group) throw new Error('Selector group not found.'); if (!group.allowRemove) throw new Error('This selector does not allow clearing your selection.');
  const previous = selectionFor(section, member.id, id);
  for (const roleId of roleIdsForGroup(group)) if (member.roles.cache.has(roleId)) await member.roles.remove(roleId, `Goliath Role Selector · ${group.name}`).catch(() => null);
  updateSection(guild.id, (current) => { const memberSelections = clone(current.memberSelections); memberSelections[member.id] = { ...(memberSelections[member.id] || {}), [id]: [] }; return { ...current, memberSelections, analytics: { ...current.analytics, removals: Number(current.analytics.removals || 0) + (previous.length ? 1 : 0) } }; }, { actorId: member.id, action: 'role_selector_clear_selection' });
  return true;
}

function managedRoleRecords(section) {
  const records = [];
  for (const groupId of section.groupOrder) {
    const group = section.groups[groupId]; if (!group) continue;
    if (group.type === 'colour') {
      for (const record of Object.values(group.managedRoles || {})) { const c = classifyHex(record.hex); records.push({ groupId, group, roleId: record.roleId, label: record.label, order: c.familyOrder * 1000 + c.hue * 2 + c.lightness, kind: 'colour', record }); }
    } else {
      for (const option of group.options || []) if (option.roleId && option.managed !== false) records.push({ groupId, group, roleId: option.roleId, label: option.label, order: section.groupOrder.indexOf(groupId) * 10000 + Number(option.order || 0), kind: 'standard', option });
    }
  }
  return records.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}
async function syncManagedRoleHierarchy(guild) {
  const section = getSection(guild.id); if (!section.style.keepGrouped || !section.style.anchorRoleId) return { moved: 0, skipped: true };
  const anchor = guild.roles.cache.get(section.style.anchorRoleId) || await guild.roles.fetch(section.style.anchorRoleId).catch(() => null); if (!anchor) return { moved: 0, skipped: true, reason: 'anchor_missing' };
  const roles = managedRoleRecords(section).map((item) => guild.roles.cache.get(item.roleId)).filter((role) => canManageRole(guild, role)); if (!roles.length) return { moved: 0, skipped: true };
  const maxPosition = Math.max(1, guild.members.me.roles.highest.position - 1); const updates = [];
  for (let i = 0; i < roles.length; i += 1) { const raw = section.style.placement === 'above' ? anchor.position + roles.length - i : anchor.position - 1 - i; updates.push({ role: roles[i], position: Math.min(maxPosition, Math.max(1, raw)) }); }
  await guild.roles.setPositions(updates); return { moved: updates.length };
}
async function syncManagedRoleAppearance(guild) {
  const section = getSection(guild.id); let changed = 0;
  for (const item of managedRoleRecords(section)) { const role = guild.roles.cache.get(item.roleId) || await guild.roles.fetch(item.roleId).catch(() => null); if (!canManageRole(guild, role)) continue; const desiredName = roleNameFor(section, item.label, item.group); const patch = {}; if (role.name !== desiredName) patch.name = desiredName; if (item.kind === 'colour' && role.color !== hexToInt(item.record.hex)) patch.color = hexToInt(item.record.hex); if (Object.keys(patch).length) { await role.edit({ ...patch, reason: 'Goliath Role Selector appearance sync' }); changed += 1; } }
  return { changed };
}
async function getUsage(guild, groupId = null) {
  const section = getSection(guild.id); const groups = groupId ? [section.groups[slug(groupId)]].filter(Boolean) : section.groupOrder.map((id) => section.groups[id]).filter(Boolean); const resultGroups = [];
  for (const group of groups) {
    const rows = [];
    if (group.type === 'colour') {
      for (const record of Object.values(group.managedRoles || {})) { const role = guild.roles.cache.get(record.roleId); const members = role ? [...role.members.values()].filter((m) => !m.user.bot).map((m) => ({ id: m.id, name: m.displayName })) : []; rows.push({ id: record.hex, label: record.label, hex: record.hex, count: members.length, members }); }
    } else {
      for (const option of group.options || []) { const role = option.roleId ? guild.roles.cache.get(option.roleId) : null; const members = role ? [...role.members.values()].filter((m) => !m.user.bot).map((m) => ({ id: m.id, name: m.displayName })) : []; rows.push({ id: option.id, label: option.label, emoji: option.emoji, count: members.length, members }); }
    }
    rows.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)); resultGroups.push({ groupId: group.id, name: group.name, emoji: group.emoji, rows, totalUsing: new Set(rows.flatMap((row) => row.members.map((m) => m.id))).size });
  }
  const totalMembers = guild.members.cache.filter((member) => !member.user.bot).size; return { groups: resultGroups, totalMembers, totalUsing: new Set(resultGroups.flatMap((g) => g.rows.flatMap((r) => r.members.map((m) => m.id)))).size };
}
async function cleanupUnused(guild) {
  const section = getSection(guild.id); if (!section.cleanup.deleteUnusedRoles) return { deleted: 0, marked: 0 };
  const cutoff = Date.now() - section.cleanup.unusedGraceHours * 3600000; let deleted = 0; let marked = 0;
  for (const group of listGroups(guild.id)) {
    if (group.type === 'colour') {
      const managedRoles = { ...(group.managedRoles || {}) }; let changed = false;
      for (const [hex, record] of Object.entries(managedRoles)) { const role = guild.roles.cache.get(record.roleId) || await guild.roles.fetch(record.roleId).catch(() => null); const count = role?.members?.filter?.((m) => !m.user.bot)?.size || 0; if (count) { if (record.unusedSince) { record.unusedSince = null; changed = true; } continue; } if (!record.unusedSince) { record.unusedSince = now(); marked += 1; changed = true; continue; } if (new Date(record.unusedSince).getTime() <= cutoff && canManageRole(guild, role)) { await role.delete('Goliath Role Selector unused role cleanup').catch(() => null); delete managedRoles[hex]; deleted += 1; changed = true; } }
      if (changed) saveGroup(guild.id, { ...group, managedRoles });
    } else {
      const options = clone(group.options); let changed = false;
      for (const option of options) { if (!option.roleId || option.managed === false) continue; const role = guild.roles.cache.get(option.roleId) || await guild.roles.fetch(option.roleId).catch(() => null); const count = role?.members?.filter?.((m) => !m.user.bot)?.size || 0; if (count) { if (option.unusedSince) { option.unusedSince = null; changed = true; } continue; } if (!option.unusedSince) { option.unusedSince = now(); marked += 1; changed = true; continue; } if (new Date(option.unusedSince).getTime() <= cutoff && canManageRole(guild, role)) { await role.delete('Goliath Role Selector unused role cleanup').catch(() => null); option.roleId = null; option.unusedSince = null; deleted += 1; changed = true; } }
      if (changed) saveGroup(guild.id, { ...group, options });
    }
  }
  if (deleted) updateSection(guild.id, (current) => ({ ...current, analytics: { ...current.analytics, rolesDeleted: Number(current.analytics.rolesDeleted || 0) + deleted } })); return { deleted, marked };
}

module.exports = { MODULE, COLOUR_GROUP_ID, DEFAULT_PALETTE, defaultSection, normalizeHex, hexToInt, classifyHex, getSection, saveSection, updateSection, listGroups, getGroup, saveGroup, removeGroup, roleNameFor, suggestRoleStyle, canManageRole, assertSafeSelectorRole, ensureColourRole, ensureStandardOptionRole, deleteManagedGroupRoles, applyColourSelection, applyStandardSelection, clearSelection, getUsage, syncManagedRoleHierarchy, syncManagedRoleAppearance, cleanupUnused, roleIdsForGroup };
