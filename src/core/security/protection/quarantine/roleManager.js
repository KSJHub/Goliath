'use strict';

const { PermissionFlagsBits } = require('discord.js');
const guildManager = require('../../../guild/guildManager');
const {
  DEFAULT_QUARANTINE_ROLE_NAME,
  getQuarantineState,
  saveQuarantineState,
} = require('./state');

function cleanRoleName(value) {
  const name = String(value || '').trim().slice(0, 100);
  return name || DEFAULT_QUARANTINE_ROLE_NAME;
}

function resolveConfiguredRoleName(guildId, options = {}) {
  const antiNuke = guildManager.getGuildSection(guildId, 'antiNuke', {}) || {};
  const state = getQuarantineState(guildId);
  return cleanRoleName(
    options.roleName
    || antiNuke?.quarantine?.roleName
    || state.roleName
    || DEFAULT_QUARANTINE_ROLE_NAME
  );
}

async function ensureQuarantineRole(guild, options = {}) {
  if (!guild) throw new Error('Missing guild.');
  const state = getQuarantineState(guild.id);
  const roleName = resolveConfiguredRoleName(guild.id, options);
  const botMember = guild.members?.me || await guild.members.fetchMe().catch(() => null);
  if (!botMember?.permissions?.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error('Goliath is missing Manage Roles.');
  }

  let role = state.roleId ? guild.roles.cache.get(String(state.roleId)) : null;
  if (role && (role.managed || !role.editable)) {
    console.warn(`[QuarantineSystem] Configured quarantine role ${role.id} is not editable; replacing it below the bot hierarchy.`);
    role = null;
  }
  if (!role) {
    role = guild.roles.cache.find((entry) => entry.name === roleName && !entry.managed && entry.editable) || null;
  }

  if (!role) {
    role = await guild.roles.create({
      name: roleName,
      color: 0x991b1b,
      permissions: [],
      reason: 'Goliath quarantine containment role',
    });
  } else if (role.name !== roleName) {
    await role.setName(roleName, 'Synchronising Goliath quarantine role configuration').catch(() => null);
  }

  if (role.managed || !role.editable) {
    throw new Error('Goliath cannot manage the configured quarantine role. Move Goliath above it or allow Goliath to create a replacement.');
  }

  if (state.roleId !== role.id || state.roleName !== role.name) {
    saveQuarantineState(guild, { ...state, roleId: role.id, roleName: role.name });
  }
  return role;
}

module.exports = {
  cleanRoleName,
  resolveConfiguredRoleName,
  ensureQuarantineRole,
};
