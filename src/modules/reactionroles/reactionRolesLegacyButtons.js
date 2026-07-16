'use strict';

const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { getModuleSection, updateModuleSection } = require('../../core/guild/moduleSectionManager');

const SECTION = 'reactionRoles';
const CUSTOM_ID_PREFIX = 'role_toggle';
const ROLE_MODES = Object.freeze({ TOGGLE: 'toggle', ADD: 'add', REMOVE: 'remove', VERIFY: 'verify' });

function cleanKey(value, fallback = 'default') {
  return (String(value || fallback)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || fallback).slice(0, 80);
}

function getCompatibilitySection(guildId) {
  const section = getModuleSection(guildId, SECTION, {});
  return {
    enabled: section?.enabled !== false,
    panels: section?.legacyButtonPanels && typeof section.legacyButtonPanels === 'object' ? section.legacyButtonPanels : {},
    analytics: { assigned: 0, removed: 0, ...(section?.legacyButtonAnalytics || {}) },
  };
}

function getLegacyPanel(guildId, panelId) {
  const panels = getCompatibilitySection(guildId).panels;
  return panels[cleanKey(panelId)] || Object.values(panels).find((panel) => cleanKey(panel?.panelId || panel?.id) === cleanKey(panelId)) || null;
}

function addLegacyAnalytics(guildId, patch) {
  return updateModuleSection(guildId, SECTION, (section = {}) => {
    const analytics = { assigned: 0, removed: 0, ...(section.legacyButtonAnalytics || {}) };
    for (const [key, value] of Object.entries(patch || {})) analytics[key] = Number(analytics[key] || 0) + Number(value || 0);
    return { ...section, legacyButtonAnalytics: analytics, updatedAt: new Date().toISOString() };
  }, {});
}

function parseCustomId(customId = '') {
  const parts = String(customId).split(':');
  if (parts[0] !== CUSTOM_ID_PREFIX || parts.length < 3) return null;
  return { panelId: cleanKey(parts[1]), roleKey: cleanKey(parts[2]) };
}

function findPanelRole(panel, roleKey) {
  return (Array.isArray(panel?.roles) ? panel.roles : []).find((role) =>
    cleanKey(role?.id || role?.roleId) === roleKey ||
    cleanKey(role?.roleId) === roleKey ||
    cleanKey(role?.label) === roleKey
  ) || null;
}

function validateRole(guild, role) {
  const me = guild?.members?.me;
  if (!role) return 'This role no longer exists.';
  if (role.id === guild.id) return '@everyone cannot be self-assigned.';
  if (role.managed) return 'Managed integration roles cannot be self-assigned.';
  if (!me?.permissions?.has(PermissionFlagsBits.ManageRoles)) return 'Goliath requires Manage Roles.';
  if (role.position >= me.roles.highest.position) return 'This role is above Goliath’s highest role.';
  const dangerous = [
    PermissionFlagsBits.Administrator,
    PermissionFlagsBits.ManageGuild,
    PermissionFlagsBits.ManageRoles,
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.ManageWebhooks,
    PermissionFlagsBits.BanMembers,
    PermissionFlagsBits.KickMembers,
  ].some((permission) => role.permissions?.has(permission));
  return dangerous ? 'Roles with elevated management permissions cannot be self-assigned.' : null;
}

async function removeExclusiveRoles(member, panel, selectedRole) {
  if (!selectedRole?.groupId) return 0;
  let removed = 0;
  for (const role of panel.roles || []) {
    if (role.groupId !== selectedRole.groupId || role.roleId === selectedRole.roleId || !member.roles.cache.has(role.roleId)) continue;
    await member.roles.remove(role.roleId, 'Goliath legacy button role group selection');
    removed += 1;
  }
  return removed;
}

async function applyLegacyButton(interaction, panelId, roleKey) {
  const section = getCompatibilitySection(interaction.guildId);
  if (section.enabled === false) return { ok: false, message: 'This legacy role panel is disabled.' };
  const panel = getLegacyPanel(interaction.guildId, panelId);
  if (!panel || panel.enabled === false) return { ok: false, message: 'This role panel is no longer active.' };
  const config = findPanelRole(panel, roleKey);
  if (!config || config.enabled === false || !config.roleId) return { ok: false, message: 'This role option is no longer available.' };

  const role = interaction.guild.roles.cache.get(config.roleId) || await interaction.guild.roles.fetch(config.roleId).catch(() => null);
  const safetyError = validateRole(interaction.guild, role);
  if (safetyError) return { ok: false, message: safetyError };
  const member = interaction.member || await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) return { ok: false, message: 'Member not found.' };

  const mode = Object.values(ROLE_MODES).includes(config.mode) ? config.mode : ROLE_MODES.TOGGLE;
  const hasRole = member.roles.cache.has(role.id);
  if (mode === ROLE_MODES.REMOVE || (mode === ROLE_MODES.TOGGLE && hasRole)) {
    if (!hasRole) return { ok: true, message: `You do not have **${role.name}**.` };
    await member.roles.remove(role, 'Goliath legacy button role removed');
    addLegacyAnalytics(interaction.guildId, { removed: 1 });
    return { ok: true, message: `Removed **${role.name}**.` };
  }
  if (hasRole) return { ok: true, message: `You already have **${role.name}**.` };
  const removed = await removeExclusiveRoles(member, panel, config);
  await member.roles.add(role, 'Goliath legacy button role assigned');
  addLegacyAnalytics(interaction.guildId, { assigned: 1, removed });
  return { ok: true, message: `Added **${role.name}**.` };
}

async function handleLegacyButtonInteraction(interaction) {
  const parsed = parseCustomId(interaction?.customId);
  if (!parsed || !interaction?.guildId || !interaction.isButton?.()) return false;
  try {
    const result = await applyLegacyButton(interaction, parsed.panelId, parsed.roleKey);
    await interaction.reply({ content: `${result.ok ? '✅' : '❌'} ${result.message}`, flags: MessageFlags.Ephemeral }).catch(() => null);
  } catch (error) {
    console.error('[ReactionRolesLegacyButtons] Failed:', error);
    const payload = { content: '❌ This legacy role button could not be processed.', flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => null);
    else await interaction.reply(payload).catch(() => null);
  }
  return true;
}

module.exports = { CUSTOM_ID_PREFIX, handleLegacyButtonInteraction };
