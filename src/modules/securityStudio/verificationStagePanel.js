'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  RoleSelectMenuBuilder,
} = require('discord.js');

function row(...components) {
  return new ActionRowBuilder().addComponents(...components.filter(Boolean));
}

function toggleButton(customId, label, enabled) {
  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(`${enabled ? '🟢' : '🔴'} ${label} ${enabled ? 'ON' : 'OFF'}`)
    .setStyle(enabled ? ButtonStyle.Success : ButtonStyle.Danger);
}

function formatRoles(guild, ids = []) {
  if (!Array.isArray(ids) || !ids.length) return '`Not set`';
  return ids.map((id) => {
    const role = guild.roles.cache.get(id);
    return role ? `<@&${role.id}> (${role.name})` : `Unknown (${id})`;
  }).join(', ');
}

function buildStageSummary(guild, config) {
  if (!config.stagedRoleFlow) {
    return [
      '**Staged Onboarding:** Disabled ❌',
      '',
      'Enable staged onboarding to use the Visitor → Member → Verified role journey.',
    ].join('\n');
  }

  return [
    '**Staged Onboarding:** Enabled ✅',
    '',
    `👋 **Arrival / Visitor:** ${formatRoles(guild, config.arrivalRoleIds)}`,
    `🛡️ **Screened / Member:** ${formatRoles(guild, config.pendingRoleIds)}`,
    `💎 **Agreement / Verified:** ${formatRoles(guild, config.verifiedRoleIds)}`,
    '',
    '**Journey**',
    '`Join` → Visitor → `Discord Screening` → Member → `Agreement` → Verified',
    '',
    'Role transitions are atomic: Goliath adds the next stage and removes the previous stage together. If Discord rejects a transition, Goliath rolls it back instead of leaving the member between stages.',
  ].join('\n');
}

function buildStageWorkflowComponents(config) {
  return [
    row(
      toggleButton(
        'admin:verification:toggle:stagedRoleFlow',
        'Staged Onboarding',
        config.stagedRoleFlow
      ),
      toggleButton(
        'admin:verification:toggle:logScreeningCompletion',
        'Screening Log',
        config.logScreeningCompletion
      )
    ),
  ];
}

function buildStageRoleComponents() {
  return [
    row(
      new RoleSelectMenuBuilder()
        .setCustomId('admin:verification:arrivalRoles')
        .setPlaceholder('👋 Arrival / Visitor role(s)')
        .setMinValues(0)
        .setMaxValues(10)
    ),
    row(
      new RoleSelectMenuBuilder()
        .setCustomId('admin:verification:pendingRoles')
        .setPlaceholder('🛡️ Screened / Member role(s)')
        .setMinValues(0)
        .setMaxValues(10)
    ),
    row(
      new RoleSelectMenuBuilder()
        .setCustomId('admin:verification:verifiedRoles')
        .setPlaceholder('💎 Agreement / Verified role(s)')
        .setMinValues(0)
        .setMaxValues(10)
    ),
  ];
}

function saveStageRoleSelection(customId, values = []) {
  const clean = Array.isArray(values) ? [...new Set(values.filter(Boolean))] : [];
  if (customId === 'admin:verification:arrivalRoles') return { arrivalRoleIds: clean };
  if (customId === 'admin:verification:pendingRoles') return { pendingRoleIds: clean };
  if (customId === 'admin:verification:verifiedRoles') return { verifiedRoleIds: clean };
  return null;
}

module.exports = {
  buildStageSummary,
  buildStageWorkflowComponents,
  buildStageRoleComponents,
  saveStageRoleSelection,
};
