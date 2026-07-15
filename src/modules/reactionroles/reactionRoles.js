'use strict';

const crypto = require('crypto');
const { getModuleSection, saveModuleSection, updateModuleSection } = require('../../core/guild/moduleSectionManager');
const embedTemplateManager = require('../embed/embedTemplateManager');

const SECTION = 'reactionRoles';
const MODES = Object.freeze({ TOGGLE: 'toggle', ADD: 'add', REMOVE: 'remove' });
const DRAFT_TYPES = Object.freeze({ EXISTING: 'existing', TEMPLATE: 'template' });
const now = () => new Date().toISOString();
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const cleanText = (value, max = 200) => String(value ?? '').trim().slice(0, max);
const cleanId = (value) => {
  const id = String(value || '').replace(/[<@&#!>]/g, '').trim();
  return /^\d{15,25}$/.test(id) ? id : null;
};
const createId = (prefix) => `${prefix}_${crypto.randomUUID().slice(0, 8)}`;

function defaultDraft(userId = null) {
  return {
    userId: cleanId(userId), type: DRAFT_TYPES.EXISTING, channelId: null, messageId: null,
    panelId: null, name: 'Reaction Roles', templateId: null, applyTemplate: false,
    selectedRoleId: null, selectedMode: MODES.TOGGLE, mappings: [], step: 'source', updatedAt: now(),
  };
}

function defaultSection() {
  return {
    enabled: true,
    settings: { removeOnUnreact: true, ignoreBots: true },
    panels: {}, drafts: {},
    analytics: { attached: 0, created: 0, assigned: 0, removed: 0, failed: 0, repaired: 0, lastActionAt: null },
    createdAt: now(), updatedAt: now(),
  };
}

function normalizeEmoji(value) {
  const raw = cleanText(value, 100);
  const custom = raw.match(/^<a?:([A-Za-z0-9_]+):(\d{15,25})>$/);
  if (custom) return { raw, key: custom[2], reaction: custom[2], name: custom[1], id: custom[2] };
  if (/^\d{15,25}$/.test(raw)) return { raw, key: raw, reaction: raw, name: null, id: raw };
  return { raw, key: raw, reaction: raw, name: raw, id: null };
}

function normalizeMapping(mapping = {}) {
  const emoji = normalizeEmoji(mapping.emoji || mapping.emojiKey);
  return {
    mappingId: cleanText(mapping.mappingId || mapping.id, 80) || createId('rr_map'),
    roleId: cleanId(mapping.roleId), emoji: emoji.raw, emojiKey: emoji.key,
    label: cleanText(mapping.label, 80),
    mode: Object.values(MODES).includes(mapping.mode) ? mapping.mode : MODES.TOGGLE,
    removeOnUnreact: mapping.removeOnUnreact !== false,
    enabled: mapping.enabled !== false,
    createdAt: mapping.createdAt || now(), updatedAt: now(),
  };
}

function parseMessageReference(value, channelId = null) {
  const raw = cleanText(value, 300);
  const link = raw.match(/discord(?:app)?\.com\/channels\/(\d{15,25})\/(\d{15,25})\/(\d{15,25})/i);
  if (link) return { guildId: link[1], channelId: link[2], messageId: link[3] };
  const messageId = cleanId(raw);
  const parsedChannelId = cleanId(channelId);
  if (!messageId || !parsedChannelId) throw new Error('Choose a channel and provide the message ID, or paste a full Discord message link.');
  return { guildId: null, channelId: parsedChannelId, messageId };
}

function normalizePanel(panel = {}) {
  const panelId = cleanText(panel.panelId || panel.id, 80) || createId('rr_panel');
  const mappings = Array.isArray(panel.mappings || panel.roles)
    ? (panel.mappings || panel.roles).map(normalizeMapping).filter((item) => item.roleId && item.emojiKey)
    : [];
  return {
    panelId,
    enabled: panel.enabled !== false,
    name: cleanText(panel.name || panel.title || 'Reaction Roles', 100),
    source: panel.source === DRAFT_TYPES.TEMPLATE ? DRAFT_TYPES.TEMPLATE : DRAFT_TYPES.EXISTING,
    templateId: cleanText(panel.templateId, 80) || null,
    channelId: cleanId(panel.channelId), messageId: cleanId(panel.messageId), mappings,
    status: cleanText(panel.status || 'attached', 30),
    lastHealthAt: panel.lastHealthAt || null,
    lastError: cleanText(panel.lastError, 500) || null,
    createdAt: panel.createdAt || now(), updatedAt: now(), createdBy: cleanId(panel.createdBy),
  };
}

function normalizeDraft(draft = {}, userId = null) {
  const base = defaultDraft(userId || draft.userId);
  return {
    ...base, ...draft,
    userId: cleanId(userId || draft.userId),
    type: Object.values(DRAFT_TYPES).includes(draft.type) ? draft.type : base.type,
    channelId: cleanId(draft.channelId), messageId: cleanId(draft.messageId),
    panelId: cleanText(draft.panelId, 80) || null,
    name: cleanText(draft.name || base.name, 100),
    templateId: cleanText(draft.templateId, 80) || null,
    applyTemplate: draft.applyTemplate === true,
    selectedRoleId: cleanId(draft.selectedRoleId),
    selectedMode: Object.values(MODES).includes(draft.selectedMode) ? draft.selectedMode : MODES.TOGGLE,
    mappings: Array.isArray(draft.mappings) ? draft.mappings.map(normalizeMapping).filter((item) => item.roleId && item.emojiKey) : [],
    step: cleanText(draft.step || base.step, 30), updatedAt: now(),
  };
}

function normalizeSection(section = {}) {
  const base = defaultSection();
  const panels = section.panels && typeof section.panels === 'object' ? section.panels : {};
  const drafts = section.drafts && typeof section.drafts === 'object' ? section.drafts : {};
  return {
    ...base, ...section,
    enabled: section.enabled !== false,
    settings: { ...base.settings, ...(section.settings || {}) },
    panels: Object.fromEntries(Object.entries(panels).map(([id, panel]) => {
      const normalized = normalizePanel({ ...panel, panelId: panel.panelId || id });
      return [normalized.panelId, normalized];
    })),
    drafts: Object.fromEntries(Object.entries(drafts).map(([id, draft]) => [id, normalizeDraft(draft, id)])),
    analytics: { ...base.analytics, ...(section.analytics || {}) },
    updatedAt: section.updatedAt || now(),
  };
}

function getSection(guildId) { return normalizeSection(getModuleSection(guildId, SECTION, defaultSection())); }
function saveSection(guildId, section, meta = {}) { return normalizeSection(saveModuleSection(guildId, SECTION, normalizeSection(section), meta)); }
function updateSection(guildId, updater, meta = {}) {
  return normalizeSection(updateModuleSection(
    guildId, SECTION,
    (current) => normalizeSection(typeof updater === 'function' ? updater(clone(normalizeSection(current))) : updater),
    defaultSection(), meta
  ));
}
function setEnabled(guildId, enabled, meta = {}) { return updateSection(guildId, (section) => ({ ...section, enabled: Boolean(enabled), updatedAt: now() }), meta); }
function listPanels(guildId) { return Object.values(getSection(guildId).panels); }
function getPanel(guildId, panelId) { return getSection(guildId).panels[cleanText(panelId, 80)] || null; }
function findPanelByMessage(guildId, messageId) { return listPanels(guildId).find((panel) => panel.enabled !== false && panel.messageId === String(messageId)) || null; }

function savePanel(guildId, panel, meta = {}) {
  const normalized = normalizePanel(panel);
  return updateSection(guildId, (section) => ({
    ...section,
    panels: { ...section.panels, [normalized.panelId]: { ...(section.panels[normalized.panelId] || {}), ...normalized, updatedAt: now() } },
    updatedAt: now(),
  }), meta).panels[normalized.panelId];
}

function removePanel(guildId, panelId, meta = {}) {
  return updateSection(guildId, (section) => {
    const panels = { ...section.panels };
    delete panels[panelId];
    return { ...section, panels, updatedAt: now() };
  }, meta);
}

function getDraft(guildId, userId) {
  const id = cleanId(userId);
  return id ? normalizeDraft(getSection(guildId).drafts[id] || {}, id) : null;
}
function saveDraft(guildId, userId, patch = {}, meta = {}) {
  const id = cleanId(userId);
  if (!id) throw new Error('A valid user is required for the setup draft.');
  return updateSection(guildId, (section) => {
    const current = normalizeDraft(section.drafts[id] || {}, id);
    return { ...section, drafts: { ...section.drafts, [id]: normalizeDraft({ ...current, ...patch }, id) }, updatedAt: now() };
  }, meta).drafts[id];
}
function clearDraft(guildId, userId, meta = {}) {
  const id = cleanId(userId);
  if (!id) return getSection(guildId);
  return updateSection(guildId, (section) => {
    const drafts = { ...section.drafts };
    delete drafts[id];
    return { ...section, drafts, updatedAt: now() };
  }, meta);
}
function addDraftMapping(guildId, userId, mapping, meta = {}) {
  const draft = getDraft(guildId, userId) || defaultDraft(userId);
  const normalized = normalizeMapping(mapping);
  if (!normalized.roleId || !normalized.emojiKey) throw new Error('Choose a role and provide an emoji first.');
  const duplicate = draft.mappings.some((item) => item.emojiKey === normalized.emojiKey);
  const mappings = duplicate ? draft.mappings.map((item) => item.emojiKey === normalized.emojiKey ? normalized : item) : [...draft.mappings, normalized];
  return saveDraft(guildId, userId, { mappings, selectedRoleId: null }, meta);
}
function removeDraftMapping(guildId, userId, mappingId, meta = {}) {
  const draft = getDraft(guildId, userId) || defaultDraft(userId);
  return saveDraft(guildId, userId, { mappings: draft.mappings.filter((item) => item.mappingId !== mappingId) }, meta);
}

function addAnalytics(guildId, patch, meta = {}) {
  return updateSection(guildId, (section) => {
    const analytics = { ...section.analytics };
    for (const [key, value] of Object.entries(patch || {})) analytics[key] = typeof value === 'number' ? Number(analytics[key] || 0) + value : value;
    analytics.lastActionAt = now();
    return { ...section, analytics, updatedAt: now() };
  }, meta).analytics;
}

function listReactionTemplates(guildId) {
  return Object.values(embedTemplateManager.listTemplates(guildId))
    .filter((template) => ['reactionroles', 'reaction_roles', 'global'].includes(String(template.module || template.templateType || '').toLowerCase()))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}
function getReactionTemplate(guildId, templateId) {
  if (!templateId) return null;
  const template = embedTemplateManager.getTemplate(guildId, templateId);
  if (!template) throw new Error('The selected Embed Studio template no longer exists.');
  return template;
}
function templatePayload(template) {
  if (!template) return { content: '', embeds: [] };
  const embed = template.embed || {};
  return {
    content: template.content || '',
    embeds: [{
      title: embed.title || undefined,
      description: embed.description || undefined,
      color: typeof embed.color === 'number' ? embed.color : parseInt(String(embed.color || '#5865F2').replace('#', ''), 16),
      fields: Array.isArray(embed.fields) ? embed.fields : [],
      author: embed.author?.name ? { name: embed.author.name, icon_url: embed.author.iconURL || undefined, url: embed.author.url || undefined } : undefined,
      footer: embed.footer?.text ? { text: embed.footer.text, icon_url: embed.footer.iconURL || undefined } : undefined,
      thumbnail: embed.thumbnailURL ? { url: embed.thumbnailURL } : undefined,
      image: embed.imageURL ? { url: embed.imageURL } : undefined,
    }],
  };
}

async function resolveMessage(guild, reference, channelId = null) {
  const parsed = parseMessageReference(reference, channelId);
  if (parsed.guildId && parsed.guildId !== guild.id) throw new Error('The message link belongs to a different server.');
  const channel = guild.channels.cache.get(parsed.channelId) || await guild.channels.fetch(parsed.channelId).catch(() => null);
  if (!channel?.messages?.fetch) throw new Error('The selected channel does not support messages or is inaccessible.');
  const message = await channel.messages.fetch(parsed.messageId).catch(() => null);
  if (!message) throw new Error('The message could not be found or Goliath cannot access it.');
  return message;
}
function validateRole(guild, roleId) {
  const role = guild.roles.cache.get(roleId);
  if (!role) throw new Error(`Role ${roleId} does not exist.`);
  if (role.managed) throw new Error(`${role.name} is managed by an integration.`);
  const me = guild.members.me;
  if (!me?.permissions.has('ManageRoles')) throw new Error('Goliath requires Manage Roles.');
  if (role.position >= me.roles.highest.position) throw new Error(`${role.name} is above Goliath's highest role.`);
  return role;
}
function findMessageReaction(message, mapping) {
  const emoji = normalizeEmoji(mapping.emoji);
  return message.reactions.cache.find((reaction) => reaction.emoji.id === emoji.id || (!emoji.id && reaction.emoji.name === emoji.name)) || null;
}
function mappingConflicts(mappings) {
  const seen = new Map();
  const conflicts = [];
  for (const mapping of mappings.filter((item) => item.enabled !== false)) {
    const existing = seen.get(mapping.emojiKey);
    if (existing && existing.roleId !== mapping.roleId) conflicts.push(`Emoji ${mapping.emoji} is mapped to multiple roles.`);
    else seen.set(mapping.emojiKey, mapping);
  }
  return [...new Set(conflicts)];
}
async function removeObsoleteBotReactions(guild, message, previousMappings, nextMappings) {
  const nextKeys = new Set(nextMappings.filter((item) => item.enabled !== false).map((item) => item.emojiKey));
  const removed = [];
  for (const mapping of previousMappings.filter((item) => item.enabled !== false && !nextKeys.has(item.emojiKey))) {
    const reaction = findMessageReaction(message, mapping);
    if (!reaction?.me) continue;
    await reaction.users.remove(guild.members.me.id);
    removed.push(mapping.emojiKey);
  }
  return removed;
}

async function syncPanelReactions(guild, panel) {
  if (!panel) throw new Error('Reaction-role panel not found.');
  if (panel.enabled === false) return { panel: savePanel(guild.id, { ...panel, status: 'disabled', lastHealthAt: now(), lastError: null }, guild), message: null };
  const conflicts = mappingConflicts(panel.mappings);
  if (conflicts.length) throw new Error(conflicts.join(' '));
  const message = await resolveMessage(guild, panel.messageId, panel.channelId);
  for (const mapping of panel.mappings.filter((item) => item.enabled !== false)) {
    validateRole(guild, mapping.roleId);
    if (!findMessageReaction(message, mapping)) await message.react(normalizeEmoji(mapping.emoji).reaction);
  }
  return { panel: savePanel(guild.id, { ...panel, status: 'healthy', lastHealthAt: now(), lastError: null }, guild), message };
}

function savePanelFailure(guild, panel, error, meta = {}) {
  return savePanel(guild.id, { ...panel, status: 'error', lastHealthAt: now(), lastError: error.message }, meta);
}

async function setPanelEnabled(guild, panelId, enabled, meta = {}) {
  const current = getPanel(guild.id, panelId);
  if (!current) throw new Error('Reaction-role panel not found.');
  const nextEnabled = enabled === true;
  let panel = savePanel(guild.id, { ...current, enabled: nextEnabled, status: nextEnabled ? 'pending' : 'disabled', lastHealthAt: nextEnabled ? current.lastHealthAt : now(), lastError: null }, meta);
  if (!nextEnabled) return panel;
  try { return (await syncPanelReactions(guild, panel)).panel; }
  catch (error) { savePanelFailure(guild, panel, error, meta); throw error; }
}

async function repairPanel(guild, panelId, meta = {}) {
  const panel = getPanel(guild.id, panelId);
  if (!panel) throw new Error('Reaction-role panel not found.');
  if (panel.enabled === false) throw new Error('Enable this deployment before repairing it.');
  try {
    const repaired = (await syncPanelReactions(guild, panel)).panel;
    addAnalytics(guild.id, { repaired: 1 }, meta);
    return repaired;
  } catch (error) {
    savePanelFailure(guild, panel, error, meta);
    throw error;
  }
}

async function redeployPanel(guild, panelId, meta = {}) {
  const panel = getPanel(guild.id, panelId);
  if (!panel) throw new Error('Reaction-role panel not found.');
  if (!panel.templateId) throw new Error('This deployment is not linked to an Embed Studio template.');
  try {
    const message = await resolveMessage(guild, panel.messageId, panel.channelId);
    await message.edit(templatePayload(getReactionTemplate(guild.id, panel.templateId)));
    return await repairPanel(guild, panel.panelId, meta);
  } catch (error) {
    savePanelFailure(guild, panel, error, meta);
    throw error;
  }
}

async function attachExistingMessage({ guild, messageReference, channelId, name, templateId = null, applyTemplate = false, mappings = [], createdBy }) {
  if (!guild) throw new Error('Guild is required.');
  const message = await resolveMessage(guild, messageReference, channelId);
  if (applyTemplate && templateId) await message.edit(templatePayload(getReactionTemplate(guild.id, templateId)));
  const panel = savePanel(guild.id, { name, source: DRAFT_TYPES.EXISTING, templateId, channelId: message.channel.id, messageId: message.id, mappings, createdBy, status: 'attached' }, guild);
  await syncPanelReactions(guild, panel);
  addAnalytics(guild.id, { attached: 1 }, guild);
  return getPanel(guild.id, panel.panelId);
}
async function createFromTemplate({ guild, channelId, templateId, name, mappings = [], createdBy }) {
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.send) throw new Error('Choose a text channel where Goliath can send messages.');
  const template = getReactionTemplate(guild.id, templateId);
  const message = await channel.send(templatePayload(template));
  const panel = savePanel(guild.id, { name: name || template.name, source: DRAFT_TYPES.TEMPLATE, templateId, channelId: channel.id, messageId: message.id, mappings, createdBy, status: 'created' }, guild);
  await syncPanelReactions(guild, panel);
  addAnalytics(guild.id, { created: 1 }, guild);
  return getPanel(guild.id, panel.panelId);
}
async function applyTemplateToPanel(guild, panelId, templateId, meta = {}) {
  const panel = getPanel(guild.id, panelId);
  if (!panel) throw new Error('Reaction-role panel not found.');
  if (panel.enabled === false) throw new Error('Enable this deployment before applying a template.');
  try {
    const template = getReactionTemplate(guild.id, templateId);
    const message = await resolveMessage(guild, panel.messageId, panel.channelId);
    await message.edit(templatePayload(template));
    const updated = savePanel(guild.id, { ...panel, templateId, status: 'pending', lastError: null }, meta);
    return await repairPanel(guild, updated.panelId, meta);
  } catch (error) {
    savePanelFailure(guild, panel, error, meta);
    throw error;
  }
}
async function updatePanelMappings(guild, panelId, mappings, actorId) {
  const current = getPanel(guild.id, panelId);
  if (!current) throw new Error('Reaction-role panel not found.');
  const nextMappings = mappings.map(normalizeMapping).filter((item) => item.roleId && item.emojiKey);
  const conflicts = mappingConflicts(nextMappings);
  if (conflicts.length) throw new Error(conflicts.join(' '));
  const message = await resolveMessage(guild, current.messageId, current.channelId);
  await removeObsoleteBotReactions(guild, message, current.mappings, nextMappings);
  const panel = savePanel(guild.id, { ...current, mappings: nextMappings, createdBy: current.createdBy || actorId }, guild);
  await syncPanelReactions(guild, panel);
  return getPanel(guild.id, panelId);
}
async function detachPanel(guild, panelId, { clearReactions = false } = {}) {
  const panel = getPanel(guild.id, panelId);
  if (!panel) throw new Error('Reaction-role panel not found.');
  let reactionsCleared = false;
  if (clearReactions) {
    const message = await resolveMessage(guild, panel.messageId, panel.channelId).catch(() => null);
    if (message) { await removeObsoleteBotReactions(guild, message, panel.mappings, []); reactionsCleared = true; }
  }
  removePanel(guild.id, panelId, guild);
  return { detached: true, reactionsCleared, messageDeleted: false };
}
async function deleteDeploymentMessage(guild, panelId, meta = {}) {
  const panel = getPanel(guild.id, panelId);
  if (!panel) throw new Error('Reaction-role panel not found.');
  if (panel.source !== DRAFT_TYPES.TEMPLATE) throw new Error('Only messages created by Goliath can be deleted through Reaction Roles.');
  const message = await resolveMessage(guild, panel.messageId, panel.channelId);
  if (message.author?.id !== guild.members.me?.id) throw new Error('Goliath can only delete messages it created.');
  await message.delete();
  removePanel(guild.id, panel.panelId, meta);
  return { detached: true, reactionsCleared: false, messageDeleted: true };
}

function emojiMatches(mapping, emoji) {
  const normalized = normalizeEmoji(mapping.emoji);
  return Boolean((emoji.id && normalized.id === emoji.id) || (!emoji.id && normalized.name === emoji.name));
}
async function handleReaction(reaction, user, removing = false) {
  if (!user || user.bot) return null;
  if (reaction.partial) await reaction.fetch().catch(() => null);
  if (reaction.message?.partial) await reaction.message.fetch().catch(() => null);
  const guild = reaction.message?.guild;
  if (!guild || getSection(guild.id).enabled === false) return null;
  const panel = findPanelByMessage(guild.id, reaction.message.id);
  if (!panel) return null;
  const mapping = panel.mappings.find((item) => item.enabled !== false && emojiMatches(item, reaction.emoji));
  if (!mapping) return null;
  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) return null;
  try {
    const role = validateRole(guild, mapping.roleId);
    if (removing) {
      if (mapping.mode !== MODES.TOGGLE || mapping.removeOnUnreact === false || !member.roles.cache.has(role.id)) return null;
      await member.roles.remove(role, 'Goliath reaction role removed');
      addAnalytics(guild.id, { removed: 1 }, guild);
      return { action: 'removed', roleId: role.id };
    }
    if (mapping.mode === MODES.REMOVE) {
      if (member.roles.cache.has(role.id)) await member.roles.remove(role, 'Goliath reaction role removal mapping');
      addAnalytics(guild.id, { removed: 1 }, guild);
      return { action: 'removed', roleId: role.id };
    }
    if (!member.roles.cache.has(role.id)) await member.roles.add(role, 'Goliath reaction role assigned');
    addAnalytics(guild.id, { assigned: 1 }, guild);
    return { action: 'assigned', roleId: role.id };
  } catch (error) {
    addAnalytics(guild.id, { failed: 1 }, guild);
    throw error;
  }
}

async function inspectPanelHealth(guild, panel) {
  const issues = [];
  const warnings = [];
  if (panel.enabled === false) {
    warnings.push('Deployment is disabled.');
    return { panelId: panel.panelId, enabled: false, healthy: true, status: 'disabled', issues, warnings, checkedAt: now() };
  }
  if (!panel.mappings.length) issues.push('No reaction-role mappings are configured.');
  issues.push(...mappingConflicts(panel.mappings));
  let message = null;
  try { message = await resolveMessage(guild, panel.messageId, panel.channelId); }
  catch (error) { issues.push(error.message); }
  if (panel.templateId) {
    try { getReactionTemplate(guild.id, panel.templateId); }
    catch (error) { issues.push(error.message); }
  }
  for (const mapping of panel.mappings) {
    if (mapping.enabled === false) { warnings.push(`Mapping ${mapping.emoji} is disabled.`); continue; }
    try { validateRole(guild, mapping.roleId); }
    catch (error) { issues.push(error.message); }
    if (message && !findMessageReaction(message, mapping)) issues.push(`Reaction ${mapping.emoji} is missing from the tracked message.`);
  }
  return { panelId: panel.panelId, enabled: true, healthy: issues.length === 0, status: issues.length ? 'error' : 'healthy', issues: [...new Set(issues)], warnings: [...new Set(warnings)], checkedAt: now() };
}
async function buildHealth(guild) {
  const results = [];
  for (const panel of listPanels(guild.id)) {
    const result = await inspectPanelHealth(guild, panel);
    results.push(result);
    savePanel(guild.id, { ...panel, status: result.status, lastHealthAt: result.checkedAt, lastError: result.issues.join(' ').slice(0, 500) || null }, guild);
  }
  const active = results.filter((item) => item.enabled);
  return { healthy: active.every((item) => item.healthy), total: results.length, active: active.length, disabled: results.length - active.length, unhealthy: active.filter((item) => !item.healthy).length, panels: results, checkedAt: now() };
}
async function repairAll(guild) {
  const repaired = [];
  const skipped = [];
  const failed = [];
  for (const panel of listPanels(guild.id)) {
    if (panel.enabled === false) { skipped.push(panel.panelId); continue; }
    try { await repairPanel(guild, panel.panelId, guild); repaired.push(panel.panelId); }
    catch (error) { failed.push({ panelId: panel.panelId, error: error.message }); }
  }
  return { repaired, skipped, failed };
}
async function startup(client) {
  for (const guild of client.guilds.cache.values()) await repairAll(guild).catch((error) => console.warn(`[ReactionRoles] ${guild.id}: ${error.message}`));
}
function exportConfiguration(guildId) { return getSection(guildId); }
function reset(guildId, meta = {}) { return saveSection(guildId, defaultSection(), meta); }

module.exports = {
  SECTION, MODES, DRAFT_TYPES,
  getSection, setEnabled, listPanels, getPanel, findPanelByMessage, savePanel, removePanel,
  getDraft, saveDraft, clearDraft, addDraftMapping, removeDraftMapping,
  listReactionTemplates, getReactionTemplate, templatePayload,
  parseMessageReference, attachExistingMessage, createFromTemplate, applyTemplateToPanel,
  updatePanelMappings, detachPanel, deleteDeploymentMessage, syncPanelReactions,
  setPanelEnabled, repairPanel, redeployPanel,
  handleReactionAdd: (reaction, user) => handleReaction(reaction, user, false),
  handleReactionRemove: (reaction, user) => handleReaction(reaction, user, true),
  buildHealth, repairAll, startup, exportConfiguration, reset,
};
