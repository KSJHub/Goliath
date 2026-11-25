'use strict';

const security = require('../../../core/security/protection/core');
const { validateRoleSelection } = require('../../../core/security/protection/permissions');
const base = require('./timedRoles');
const service = require('./timedRolesService');

const PATCH_KEY = Symbol.for('goliath.timedRoles.compatPatchInstalled');

function installTimedRolesCompat() {
  if (globalThis[PATCH_KEY]) return;
  globalThis[PATCH_KEY] = true;

  const originalSaveRule = base.saveRule;
  base.saveRule = function validatedTimedRoleSave(guildId, input = {}, meta = {}) {
    const value = Number(input.value ?? input.durationValue ?? 1);
    const unit = String(input.unit || input.durationUnit || 'days').toLowerCase();
    if (!Number.isInteger(value) || value < 1 || value > 1_000_000) throw new Error('Timed Roles duration must be a whole number between 1 and 1,000,000.');
    if (!base.UNITS.includes(unit)) throw new Error('Timed Roles duration unit is invalid.');
    return originalSaveRule(guildId, input, meta);
  };

  base.applyProgressionToMember = service.applyProgressionToMember;
  base.scanGuild = service.scanGuild;
  base.simulateGuild = service.simulateGuild;
  base.startup = service.startup;

  try {
    const panel = require('./timedRolesPanel');
    if (!panel.__timedRolesSecurityWrapped && typeof panel.handleTimedRolesInteraction === 'function') {
      const original = panel.handleTimedRolesInteraction;
      panel.handleTimedRolesInteraction = async function hardenedTimedRolesInteraction(interaction) {
        try {
          const customId = String(interaction.customId || '');
          const recordsRead = /^admin:timedRoles:(?:records|recordMember|recordHistorical|recordSearch|recordSearchSubmit|recordsPage:-?\d+|recordAchievements:\d{15,25}(?::-?\d+)?)$/.test(customId);
          const allowed = await security.enforceInteractionSecurity(interaction, { level: recordsRead ? null : 'admin', guildOnly: true });
          if (!allowed?.allowed) return true;
          // The records panel independently checks the guild's configured access roles.
          // No other administrative action bypasses the admin permission check.
          if (customId.startsWith('admin:timedRoles:createSubmit:')) {
            const roleId = customId.split(':').pop();
            const duplicate = base.listRules(interaction.guild.id).find((rule) => rule.roleId === roleId);
            if (duplicate) throw new Error(`That Discord role is already used by the Timed Roles milestone “${duplicate.name}”.`);
            const validation = await validateRoleSelection(interaction.guild, [roleId], { scope: 'timed_roles.discord_create', requireManageable: true });
            if (!validation.ok) throw validation.toError();
          }
          if (customId.startsWith('admin:timedRoles:cleanup:') && interaction.isRoleSelectMenu?.()) {
            const validation = await validateRoleSelection(interaction.guild, interaction.values || [], { scope: 'timed_roles.discord_cleanup', requireManageable: true });
            if (!validation.ok) throw validation.toError();
          }
          if (customId.startsWith('admin:timedRoles:duplicate:')) {
            const payload = { content: '❌ A Timed Roles milestone cannot duplicate the same award role. Choose a different role for the new milestone.', ephemeral: true };
            if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => null);
            else await interaction.reply(payload).catch(() => null);
            return true;
          }
          return original(interaction);
        } catch (error) {
          const payload = { content: `❌ Timed Roles setup failed: ${error.message || 'Request rejected.'}`, ephemeral: true };
          if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => null);
          else await interaction.reply(payload).catch(() => null);
          return true;
        }
      };
      Object.defineProperty(panel, '__timedRolesSecurityWrapped', { value: true });
    }
  } catch (error) {
    globalThis[PATCH_KEY] = false;
    console.error('[TimedRoles] Compatibility hardening failed:', error);
  }
}

installTimedRolesCompat();

module.exports = { installTimedRolesCompat };
