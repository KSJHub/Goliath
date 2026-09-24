'use strict';

const { PermissionFlagsBits } = require('discord.js');
const guildManager = require('../../../core/guild/guildManager');
const guildVariables = require('../../../core/guild/guildVariables');
const {
  getModuleSection,
  saveModuleSection,
  updateModuleSection,
} = require('../../../core/guild/moduleSectionManager');
const embedTemplateManager = require('../embed/embedTemplates');
const { buildTemplateDeliveryPayload, templateToState } = require('../embed/embedTemplateDelivery');

const MODULE = 'welcome';
const MESSAGE_SOURCES = Object.freeze(['embedStudio', 'preset', 'custom']);
const BUILT_IN_PRESET_IDS = new Set(['welcome_default', 'dm_welcome_default']);

function now() { return new Date().toISOString(); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function cleanDiscordId(value) { const id = String(value || '').replace(/[<@&#!>]/g, '').trim(); return /^\d{15,25}$/.test(id) ? id : null; }
function cleanDiscordIds(value, max = 10) { if (!Array.isArray(value)) return []; return [...new Set(value.map(cleanDiscordId).filter(Boolean))].slice(0, max); }
function cleanString(value, fallback = '', maxLength = 1000) { return String(value ?? fallback).trim().slice(0, maxLength); }
function cleanCount(value) { const parsed = Number(value); return Number.isFinite(parsed) ? Math.max(0, parsed) : 0; }
function cleanDate(value) { if (!value) return null; const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString() : null; }
function normalizeMessageSource(value, templateId = 'welcome_default') { const source = String(value || '').trim(); if (MESSAGE_SOURCES.includes(source)) return source; return BUILT_IN_PRESET_IDS.has(String(templateId || '').trim()) ? 'preset' : 'embedStudio'; }
function defaultAnalytics() { return { publicSent: 0, publicFailed: 0, dmSent: 0, dmFailed: 0, skipped: 0, lastPublicSentAt: null, lastDmSentAt: null, lastFailedAt: null }; }
function defaultWelcomeSection() { return { channelId: null, messageSource: 'preset', templateId: 'welcome_default', dmEnabled: false, dmMessageSource: 'inherit', dmTemplateId: null, allowUserPing: true, allowRolePings: false, mentionRoleIds: [], ignoreBots: true, analytics: defaultAnalytics(), createdAt: now(), updatedAt: now() }; }
function normalizeAnalytics(value = {}) { const source = value && typeof value === 'object' ? value : {}; return { ...defaultAnalytics(), ...clone(source), publicSent: cleanCount(source.publicSent), publicFailed: cleanCount(source.publicFailed), dmSent: cleanCount(source.dmSent), dmFailed: cleanCount(source.dmFailed), skipped: cleanCount(source.skipped), lastPublicSentAt: cleanDate(source.lastPublicSentAt), lastDmSentAt: cleanDate(source.lastDmSentAt), lastFailedAt: cleanDate(source.lastFailedAt) }; }
function normalizeWelcomeSection(section = {}) {
  const base = defaultWelcomeSection(); const source = section && typeof section === 'object' ? section : {}; const channelId = cleanDiscordId(source.channelId || source.welcomeChannelId); const legacyDmTemplate = String(source.dmTemplateId || '').trim(); const templateId = cleanString(source.templateId || base.templateId, base.templateId, 120); const dmTemplateId = legacyDmTemplate && legacyDmTemplate !== 'dm_welcome_default' ? cleanString(legacyDmTemplate, '', 120) : null;
  const normalized = { ...base, ...clone(source), channelId, messageSource: normalizeMessageSource(source.messageSource, templateId), templateId, dmEnabled: source.dmEnabled === true || source.sendDm === true, dmMessageSource: dmTemplateId ? normalizeMessageSource(source.dmMessageSource, dmTemplateId) : 'inherit', dmTemplateId, allowUserPing: source.allowUserPing !== false, allowRolePings: source.allowRolePings === true, mentionRoleIds: cleanDiscordIds(source.mentionRoleIds), ignoreBots: source.ignoreBots !== false, analytics: normalizeAnalytics(source.analytics), createdAt: source.createdAt || base.createdAt, updatedAt: source.updatedAt || now() };
  delete normalized.enabled; return normalized;
}
function getWelcomeSection(guildId) { return normalizeWelcomeSection(getModuleSection(guildId, MODULE, defaultWelcomeSection())); }
function saveWelcomeSection(guildId, section, meta = {}) { return normalizeWelcomeSection(saveModuleSection(guildId, MODULE, normalizeWelcomeSection(section), meta)); }
function updateWelcomeSection(guildId, updater, meta = {}) { return normalizeWelcomeSection(updateModuleSection(guildId, MODULE, (current) => { const normalized = normalizeWelcomeSection(current); const next = typeof updater === 'function' ? updater(clone(normalized)) : updater; return normalizeWelcomeSection(next); }, defaultWelcomeSection(), meta)); }
function updateConfig(guildId, patch = {}, meta = {}) {
  const { enabled, ...configPatch } = patch || {}; if (typeof enabled === 'boolean') guildManager.setModuleEnabled(guildId, MODULE, enabled, meta);
  return updateWelcomeSection(guildId, (section) => { const templateId = configPatch.templateId === undefined ? section.templateId : cleanString(configPatch.templateId, section.templateId, 120); const dmTemplateId = configPatch.dmTemplateId === undefined ? section.dmTemplateId : (configPatch.dmTemplateId ? cleanString(configPatch.dmTemplateId, '', 120) : null); return { ...section, ...configPatch, channelId: configPatch.channelId === undefined ? section.channelId : cleanDiscordId(configPatch.channelId), messageSource: configPatch.messageSource === undefined ? section.messageSource : normalizeMessageSource(configPatch.messageSource, templateId), templateId, dmTemplateId, dmMessageSource: dmTemplateId ? (configPatch.dmMessageSource === undefined ? normalizeMessageSource(section.dmMessageSource, dmTemplateId) : normalizeMessageSource(configPatch.dmMessageSource, dmTemplateId)) : 'inherit', dmEnabled: typeof configPatch.dmEnabled === 'boolean' ? configPatch.dmEnabled : section.dmEnabled, allowUserPing: typeof configPatch.allowUserPing === 'boolean' ? configPatch.allowUserPing : section.allowUserPing, allowRolePings: typeof configPatch.allowRolePings === 'boolean' ? configPatch.allowRolePings : section.allowRolePings, mentionRoleIds: configPatch.mentionRoleIds === undefined ? section.mentionRoleIds : cleanDiscordIds(configPatch.mentionRoleIds), ignoreBots: typeof configPatch.ignoreBots === 'boolean' ? configPatch.ignoreBots : section.ignoreBots, updatedAt: now() }; }, meta);
}
function incrementAnalytics(guildId, increments = {}, meta = {}) {
  const timestamp = now(); return updateWelcomeSection(guildId, (section) => { const analytics = normalizeAnalytics(section.analytics); const next = { ...analytics }; for (const key of ['publicSent', 'publicFailed', 'dmSent', 'dmFailed', 'skipped']) next[key] = cleanCount(analytics[key] + cleanCount(increments[key])); if (cleanCount(increments.publicSent) > 0) next.lastPublicSentAt = timestamp; if (cleanCount(increments.dmSent) > 0) next.lastDmSentAt = timestamp; if (cleanCount(increments.publicFailed) > 0 || cleanCount(increments.dmFailed) > 0) next.lastFailedAt = timestamp; return { ...section, analytics: next, updatedAt: timestamp }; }, meta).analytics;
}
function resetWelcomeSection(guildId, meta = {}) { return saveWelcomeSection(guildId, defaultWelcomeSection(), { action: 'welcome_reset', ...meta }); }
function formatTimestamp(timestamp, style = 'F') { return timestamp ? `<t:${Math.floor(timestamp / 1000)}:${style}>` : 'Unknown'; }
async function refreshMemberCache(guild) { if (!guild?.members?.fetch) return; try { await guild.members.fetch(); } catch (error) { console.warn('[Welcome] Could not refresh member cache:', error.message || error); } }
function eligibleMembers(guild, ignoreBots = true) { const cache = guild?.members?.cache; if (!cache?.size) return []; return [...cache.values()].filter((member) => !ignoreBots || !member.user?.bot); }
function getMemberCount(guild, ignoreBots = true) { if (!ignoreBots) return Math.max(0, Number(guild?.memberCount || 0)); const members = eligibleMembers(guild, true); return members.length || Math.max(0, Number(guild?.memberCount || 0) - 1); }
function getMemberJoinNumber(member, ignoreBots = true) {
  const candidates = eligibleMembers(member.guild, ignoreBots); if (!candidates.some((candidate) => candidate.id === member.id) && (!ignoreBots || !member.user?.bot)) candidates.push(member);
  candidates.sort((a, b) => { const aJoined = Number(a.joinedTimestamp || Number.MAX_SAFE_INTEGER); const bJoined = Number(b.joinedTimestamp || Number.MAX_SAFE_INTEGER); return aJoined - bJoined || String(a.id).localeCompare(String(b.id)); });
  const index = candidates.findIndex((candidate) => candidate.id === member.id); return index >= 0 ? index + 1 : Math.max(1, candidates.length);
}
function getWelcomeRoleState(guild, config) { const roleIds = cleanDiscordIds(config?.mentionRoleIds).filter((roleId) => roleId !== guild.id); const roles = roleIds.map((roleId) => guild.roles?.cache?.get(roleId)).filter(Boolean); return { roleIds: roles.map((role) => role.id), mentions: roles.map((role) => `<@&${role.id}>`).join(' '), display: roles.map((role) => `@${role.name}`).join(' ') }; }
function renderGuildForNumber(guild, number) { return new Proxy(guild, { get(target, property, receiver) { if (property === 'memberCount') return number; return Reflect.get(target, property, receiver); } }); }
function buildTemplateVariables(member, config = getWelcomeSection(member.guild.id)) {
  const guild = member.guild; const totalMembers = getMemberCount(guild, config.ignoreBots); const joinNumber = getMemberJoinNumber(member, config.ignoreBots); const welcomeRoles = getWelcomeRoleState(guild, config);
  const interaction = { guild: renderGuildForNumber(guild, joinNumber), guildId: guild.id, user: member.user, member };
  const central = guildVariables.buildVariableMap(interaction, true, {
    '{memberCount}': String(joinNumber), '{guildMemberCount}': String(joinNumber), '{totalMemberCount}': String(totalMembers),
    '{welcomeRoles}': welcomeRoles.mentions, '{welcomeRoleMentions}': welcomeRoles.mentions, '{welcomeRolesNoPing}': welcomeRoles.display,
    '{createdAt}': formatTimestamp(member.user.createdTimestamp, 'F'), '{joinedAt}': formatTimestamp(member.joinedTimestamp, 'F'), '{timestamp}': formatTimestamp(Date.now(), 'F'),
  });
  return Object.fromEntries(Object.entries(central).map(([key, value]) => [String(key).replace(/^\{|\}$/g, ''), value]));
}
function getWelcomeTemplates(guildId) { return Object.values(embedTemplateManager.listTemplates(guildId)).filter(Boolean).sort((a, b) => String(a.name || a.templateId).localeCompare(String(b.name || b.templateId))); }
function getWelcomeBinding(guildId, slot = 'welcome') { return embedTemplateManager.getBinding(guildId, MODULE, slot); }
function bindWelcomeTemplate(guildId, templateId, slot = 'welcome', meta = {}) { const template = embedTemplateManager.getTemplate(guildId, templateId); if (!template) throw new Error('Template not found in Embed Studio.'); const binding = embedTemplateManager.bindTemplate(guildId, MODULE, slot, templateId); const patch = slot === 'dm_welcome' ? { dmTemplateId: binding.templateId, dmMessageSource: BUILT_IN_PRESET_IDS.has(binding.templateId) ? 'preset' : 'embedStudio' } : { templateId: binding.templateId, messageSource: BUILT_IN_PRESET_IDS.has(binding.templateId) ? 'preset' : 'embedStudio' }; const config = updateConfig(guildId, patch, { action: 'welcome_template_bind', ...meta }); return { binding, config }; }
function clearDmTemplate(guildId, meta = {}) { embedTemplateManager.unbindTemplate(guildId, MODULE, 'dm_welcome'); return updateConfig(guildId, { dmTemplateId: null, dmMessageSource: 'inherit' }, { action: 'welcome_dm_template_clear', ...meta }); }
function getAssignedTemplate(guildId, type, config = getWelcomeSection(guildId)) { const isDm = type === 'dmWelcome'; if (!isDm) return getWelcomeBinding(guildId, 'welcome') || embedTemplateManager.getTemplate(guildId, config.templateId); return getWelcomeBinding(guildId, 'dm_welcome') || (config.dmTemplateId ? embedTemplateManager.getTemplate(guildId, config.dmTemplateId) : null) || getWelcomeBinding(guildId, 'welcome') || embedTemplateManager.getTemplate(guildId, config.templateId); }
function templateToPreviewState(template = {}) { return templateToState(template); }
function replaceTemplateText(text, variables, replacements = {}) { return guildVariables.replaceVariables(String(text || ''), { ...variables, ...replacements }); }
function displayOnlyMentionState(state, variables) { const cleaned = clone(state); const replacements = { userMention: variables.userNoPing, usermention: variables.userNoPing, user: variables.userDisplay, welcomeRoles: variables.welcomeRolesNoPing, welcomeRoleMentions: variables.welcomeRolesNoPing }; cleaned.panels = cleaned.panels.map((panelData) => ({ ...panelData, title: replaceTemplateText(panelData.title, variables, replacements), description: replaceTemplateText(panelData.description, variables, replacements), authorName: replaceTemplateText(panelData.authorName, variables, replacements), footer: replaceTemplateText(panelData.footer, variables, replacements), fields: (panelData.fields || []).map((field) => ({ ...field, name: replaceTemplateText(field.name, variables, replacements), value: replaceTemplateText(field.value, variables, replacements) })) })); return cleaned; }
async function buildDiscordPayload(member, type, config = getWelcomeSection(member.guild.id), options = {}) {
  const isDm = type === 'dmWelcome'; const template = getAssignedTemplate(member.guild.id, type, config); if (!template) throw new Error(`No ${isDm ? 'DM welcome' : 'welcome'} template is assigned.`);
  const variables = buildTemplateVariables(member, config); const joinNumber = Number(variables.memberCount || member.guild.memberCount || 0); const renderInteraction = { guild: renderGuildForNumber(member.guild, joinNumber), guildId: member.guild.id, user: member.user, member, client: member.client };
  const userPingEnabled = !isDm && config.allowUserPing !== false && options.suppressPing !== true; const rolePingEnabled = !isDm && config.allowRolePings === true && options.suppressPing !== true; const welcomeRoles = getWelcomeRoleState(member.guild, config); const roleIds = rolePingEnabled ? welcomeRoles.roleIds : [];
  const deliveryVariables = { ...variables, guild: variables.guildName, username: variables.username, userMention: isDm ? variables.userNoPing : (userPingEnabled ? `<@${member.user.id}>` : variables.userNoPing), welcomeRoles: rolePingEnabled ? welcomeRoles.mentions : welcomeRoles.display, welcomeRoleMentions: rolePingEnabled ? welcomeRoles.mentions : welcomeRoles.display };
  const allowedMentions = { parse: [], users: userPingEnabled ? [member.user.id] : [], roles: roleIds, repliedUser: false };
  return buildTemplateDeliveryPayload({ template, variables: deliveryVariables, interaction: renderInteraction, includeComponents: options.includeComponents !== false, allowUserPing: userPingEnabled, userId: member.user.id, ephemeral: options.ephemeral === true, allowedMentions });
}
async function resolveWelcomeChannel(guild, channelId) { if (!guild || !channelId) return null; const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null); return channel?.isTextBased?.() ? channel : null; }
async function sendWelcome(member, options = {}) {
  if (!member?.guild?.id || !member?.user?.id) return { publicSent: false, dmSent: false, skipped: true, reason: 'invalid_member', errors: [] };
  const config = getWelcomeSection(member.guild.id); if (!options.force && !guildManager.isModuleEnabled(member.guild.id, MODULE)) { if (!options.previewOnly) incrementAnalytics(member.guild.id, { skipped: 1 }); return { publicSent: false, dmSent: false, skipped: true, reason: 'disabled', errors: [] }; } if (config.ignoreBots && member.user.bot) { if (!options.previewOnly) incrementAnalytics(member.guild.id, { skipped: 1 }); return { publicSent: false, dmSent: false, skipped: true, reason: 'ignored_bot', errors: [] }; }
  await refreshMemberCache(member.guild); let publicSent = false; let dmSent = false; let publicFailed = false; let dmFailed = false; const errors = [];
  if (config.channelId && options.skipPublic !== true) { const channel = await resolveWelcomeChannel(member.guild, config.channelId); if (!channel) { publicFailed = true; errors.push('Welcome channel is unavailable.'); } else { try { const payload = await buildDiscordPayload(member, 'welcome', config); await channel.send(payload); publicSent = true; } catch (error) { publicFailed = true; errors.push(`Public welcome failed: ${error.message || error}`); if (!options.silent) console.error('[Welcome] Failed to send public welcome:', error); } } }
  if (config.dmEnabled && options.skipDm !== true && !member.user.bot) { try { const payload = await buildDiscordPayload(member, 'dmWelcome', config, { includeComponents: false, suppressPing: true }); await member.send(payload); dmSent = true; } catch (error) { dmFailed = true; errors.push(`Welcome DM failed: ${error.message || error}`); if (!options.silent) console.warn('[Welcome] Failed to send welcome DM:', error.message || error); } }
  if (!options.previewOnly) incrementAnalytics(member.guild.id, { publicSent: publicSent ? 1 : 0, publicFailed: publicFailed ? 1 : 0, dmSent: dmSent ? 1 : 0, dmFailed: dmFailed ? 1 : 0, skipped: !publicSent && !dmSent && !publicFailed && !dmFailed ? 1 : 0 });
  return { publicSent, dmSent, publicFailed, dmFailed, skipped: false, errors };
}
async function buildHealthReport(guild) {
  if (!guild?.id) throw new Error('Guild is required.');
  const config = getWelcomeSection(guild.id);
  const moduleEnabled = guildManager.isModuleEnabled(guild.id, MODULE);
  const channel = config.channelId ? await resolveWelcomeChannel(guild, config.channelId) : null;
  const botMember = guild.members?.me || guild.members?.cache?.get(guild.client?.user?.id) || null;
  const permissions = channel && botMember ? channel.permissionsFor(botMember) : null;
  const canView = Boolean(permissions?.has(PermissionFlagsBits.ViewChannel));
  const canSend = Boolean(permissions?.has(PermissionFlagsBits.SendMessages));
  const canEmbed = Boolean(permissions?.has(PermissionFlagsBits.EmbedLinks));
  const canMentionEveryone = Boolean(permissions?.has(PermissionFlagsBits.MentionEveryone));

  const publicBinding = getWelcomeBinding(guild.id, 'welcome');
  const publicBoundTemplate = publicBinding ? embedTemplateManager.getTemplate(guild.id, publicBinding.templateId) : null;
  const configuredPublicTemplate = embedTemplateManager.getTemplate(guild.id, config.templateId);
  const publicTemplate = publicBoundTemplate || configuredPublicTemplate;
  const publicBindingMissingTemplate = Boolean(publicBinding && !publicBoundTemplate);
  const publicBindingMismatch = Boolean(publicBinding && publicBoundTemplate && config.templateId && publicBinding.templateId !== config.templateId);
  const publicSourceMismatch = Boolean(publicTemplate && normalizeMessageSource(config.messageSource, publicTemplate.templateId) !== config.messageSource);

  const dmBinding = getWelcomeBinding(guild.id, 'dm_welcome');
  const dmBoundTemplate = dmBinding ? embedTemplateManager.getTemplate(guild.id, dmBinding.templateId) : null;
  const configuredDmTemplate = config.dmTemplateId ? embedTemplateManager.getTemplate(guild.id, config.dmTemplateId) : null;
  const dmUsesPublicTemplate = config.dmMessageSource === 'inherit';
  const dmTemplate = dmUsesPublicTemplate ? publicTemplate : (dmBoundTemplate || configuredDmTemplate);
  const staleInheritedDmBinding = Boolean(dmUsesPublicTemplate && dmBinding);
  const dmBindingMissingTemplate = Boolean(!dmUsesPublicTemplate && dmBinding && !dmBoundTemplate);
  const dmBindingMismatch = Boolean(!dmUsesPublicTemplate && dmBinding && dmBoundTemplate && config.dmTemplateId && dmBinding.templateId !== config.dmTemplateId);
  const dmMissingBinding = Boolean(!dmUsesPublicTemplate && configuredDmTemplate && (!dmBinding || dmBinding.templateId !== configuredDmTemplate.templateId));
  const dmSourceMismatch = Boolean(!dmUsesPublicTemplate && dmTemplate && normalizeMessageSource(config.dmMessageSource, dmTemplate.templateId) !== config.dmMessageSource);

  const mentionRoles = cleanDiscordIds(config.mentionRoleIds).map((roleId) => ({ roleId, role: guild.roles.cache.get(roleId) || null }));
  const missingMentionRoles = mentionRoles.filter(({ role }) => !role);
  const blockedMentionRoles = mentionRoles.filter(({ role }) => role && !role.mentionable && !canMentionEveryone);

  const warnings = [
    !moduleEnabled ? 'Welcome is disabled.' : null,
    moduleEnabled && !config.channelId && !config.dmEnabled ? 'No welcome channel or welcome DM is configured.' : null,
    config.channelId && !channel ? `Configured welcome channel ${config.channelId} no longer exists or is not text-based.` : null,
    channel && !canView ? 'Goliath cannot view the welcome channel.' : null,
    channel && !canSend ? 'Goliath cannot send messages in the welcome channel.' : null,
    channel && !canEmbed ? 'Goliath cannot embed links in the welcome channel.' : null,
    config.channelId && !publicTemplate ? `Welcome template ${config.templateId} could not be found.` : null,
    publicBindingMissingTemplate ? `Public Welcome binding points to missing template ${publicBinding.templateId}.` : null,
    publicBindingMismatch ? `Public Welcome binding (${publicBinding.templateId}) does not match configured template (${config.templateId}).` : null,
    publicSourceMismatch ? `Public Welcome source ${config.messageSource} does not match template ${publicTemplate.templateId}.` : null,
    config.dmEnabled && !dmTemplate ? 'Welcome DM is enabled, but no usable template is assigned.' : null,
    staleInheritedDmBinding ? `DM Welcome is set to Same as Public but still has a stale binding to ${dmBinding.templateId}.` : null,
    dmBindingMissingTemplate ? `DM Welcome binding points to missing template ${dmBinding.templateId}.` : null,
    dmBindingMismatch ? `DM Welcome binding (${dmBinding.templateId}) does not match configured template (${config.dmTemplateId}).` : null,
    dmMissingBinding ? `DM Welcome template ${configuredDmTemplate.templateId} is configured but not canonically bound.` : null,
    dmSourceMismatch ? `DM Welcome source ${config.dmMessageSource} does not match template ${dmTemplate.templateId}.` : null,
    config.allowRolePings && !config.mentionRoleIds.length ? 'Role notifications are enabled but no roles are selected.' : null,
    ...missingMentionRoles.map(({ roleId }) => `Welcome notification role ${roleId} no longer exists.`),
    ...blockedMentionRoles.map(({ role }) => `${role.name}: role is not mentionable and Goliath lacks Mention Everyone in the welcome channel.`),
  ].filter(Boolean);

  return {
    enabled: moduleEnabled,
    channelId: config.channelId,
    channelExists: Boolean(channel),
    channelName: channel?.name || null,
    dmEnabled: config.dmEnabled === true,
    messageSource: config.messageSource,
    dmMessageSource: config.dmMessageSource,
    allowRolePings: config.allowRolePings === true,
    mentionRoleIds: config.mentionRoleIds,
    mentionRoles: mentionRoles.filter(({ role }) => role).map(({ role }) => ({ id: role.id, name: role.name, mentionable: role.mentionable })),
    canView,
    canSend,
    canEmbed,
    canMentionEveryone,
    templateId: publicTemplate?.templateId || config.templateId,
    templateName: publicTemplate?.name || null,
    templateBound: Boolean(publicBinding),
    publicBindingId: publicBinding?.templateId || null,
    publicBindingHealthy: !publicBindingMissingTemplate && !publicBindingMismatch && !publicSourceMismatch,
    dmTemplateId: dmTemplate?.templateId || config.dmTemplateId || config.templateId,
    dmTemplateName: dmTemplate?.name || null,
    dmBindingId: dmBinding?.templateId || null,
    dmUsesPublicTemplate,
    dmBindingHealthy: !staleInheritedDmBinding && !dmBindingMissingTemplate && !dmBindingMismatch && !dmMissingBinding && !dmSourceMismatch,
    countMode: config.ignoreBots ? 'humans_only' : 'all_members',
    warnings,
    healthy: warnings.length === 0,
  };
}
async function repairConfiguration(guild, meta = {}) {
  const config = getWelcomeSection(guild.id);
  const channel = config.channelId ? await resolveWelcomeChannel(guild, config.channelId) : null;
  const publicBinding = getWelcomeBinding(guild.id, 'welcome');
  const publicBoundTemplate = publicBinding ? embedTemplateManager.getTemplate(guild.id, publicBinding.templateId) : null;
  if (publicBinding && !publicBoundTemplate) embedTemplateManager.unbindTemplate(guild.id, MODULE, 'welcome');
  const publicTemplate = publicBoundTemplate || embedTemplateManager.getTemplate(guild.id, config.templateId);

  let dmTemplate = null;
  let dmTemplateId = null;
  let dmMessageSource = 'inherit';
  const dmBinding = getWelcomeBinding(guild.id, 'dm_welcome');

  if (config.dmMessageSource === 'inherit') {
    if (dmBinding) embedTemplateManager.unbindTemplate(guild.id, MODULE, 'dm_welcome');
  } else {
    const boundDmTemplate = dmBinding ? embedTemplateManager.getTemplate(guild.id, dmBinding.templateId) : null;
    if (dmBinding && !boundDmTemplate) embedTemplateManager.unbindTemplate(guild.id, MODULE, 'dm_welcome');
    dmTemplate = boundDmTemplate || (config.dmTemplateId ? embedTemplateManager.getTemplate(guild.id, config.dmTemplateId) : null);
    if (dmTemplate) {
      dmTemplateId = dmTemplate.templateId;
      dmMessageSource = normalizeMessageSource(config.dmMessageSource, dmTemplateId);
      const currentBinding = getWelcomeBinding(guild.id, 'dm_welcome');
      if (!currentBinding || currentBinding.templateId !== dmTemplateId) embedTemplateManager.bindTemplate(guild.id, MODULE, 'dm_welcome', dmTemplateId);
    }
  }

  const mentionRoleIds = cleanDiscordIds(config.mentionRoleIds).filter((roleId) => roleId !== guild.id && guild.roles.cache.has(roleId));
  return updateConfig(guild.id, {
    channelId: channel ? config.channelId : null,
    messageSource: normalizeMessageSource(config.messageSource, publicTemplate?.templateId || config.templateId),
    templateId: publicTemplate?.templateId || config.templateId,
    dmTemplateId,
    dmMessageSource,
    mentionRoleIds,
    allowRolePings: config.allowRolePings && mentionRoleIds.length > 0,
  }, { action: 'welcome_repair', ...meta });
}
function exportConfiguration(guildId) { return { exportedAt: now(), guildId, module: MODULE, config: { ...getWelcomeSection(guildId), enabled: guildManager.isModuleEnabled(guildId, MODULE) }, publicBinding: getWelcomeBinding(guildId, 'welcome'), dmBinding: getWelcomeBinding(guildId, 'dm_welcome') }; }
function resetWelcome(guildId, meta = {}) { return resetWelcomeSection(guildId, meta); }
async function startupWelcome(client) {
  if (!client?.guilds?.cache) return { ok: false, guildsChecked: 0, warnings: 1, results: [] }; const results = [];
  for (const guild of client.guilds.cache.values()) { try { const enabled = guildManager.isModuleEnabled(guild.id, MODULE); const health = await buildHealthReport(guild); results.push({ guildId: guild.id, guildName: guild.name, enabled, healthy: health.healthy, warnings: health.warnings }); } catch (error) { results.push({ guildId: guild.id, guildName: guild.name, enabled: false, healthy: false, warnings: [error.message || 'Welcome startup check failed.'] }); } }
  const summary = { ok: results.every((result) => result.healthy || result.enabled === false), guildsChecked: results.length, enabledGuilds: results.filter((result) => result.enabled).length, warnings: results.reduce((total, result) => total + result.warnings.length, 0), results }; console.log(`[Welcome] Startup check complete: ${summary.guildsChecked} guild(s), ${summary.enabledGuilds} enabled, ${summary.warnings} warning(s).`); return summary;
}

module.exports = { MODULE, MESSAGE_SOURCES, BUILT_IN_PRESET_IDS, cleanDiscordId, cleanDiscordIds, normalizeMessageSource, defaultAnalytics, defaultWelcomeSection, normalizeAnalytics, normalizeWelcomeSection, getWelcomeSection, saveWelcomeSection, updateWelcomeSection, updateConfig, incrementAnalytics, resetWelcomeSection, formatTimestamp, getMemberCount, getMemberJoinNumber, getWelcomeRoleState, buildTemplateVariables, getWelcomeTemplates, getWelcomeBinding, bindWelcomeTemplate, clearDmTemplate, getAssignedTemplate, templateToPreviewState, buildDiscordPayload, resolveWelcomeChannel, sendWelcome, buildHealthReport, repairConfiguration, exportConfiguration, resetWelcome, startupWelcome };