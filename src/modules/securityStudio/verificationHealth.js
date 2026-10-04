'use strict';

const guildManager = require('../../core/guild/guildManager');
const verificationManager = require('./verificationManager');
const verificationStore = require('./verificationStore');

const MODULE = 'verification';

function requireGuild(guild) {
  if (!guild?.id) {
    throw new Error('Guild is unavailable.');
  }

  return guild;
}

function appendUniqueWarning(warnings, warning) {
  if (warning && !warnings.includes(warning)) warnings.push(warning);
}

function addStagedWorkflowHealth(guild, report) {
  const section = verificationStore.getVerificationSection(guild.id);
  const settings = section.settings || {};
  const warnings = Array.isArray(report.warnings) ? [...report.warnings] : [];
  const staged = settings.stagedRoleFlow === true;

  if (!staged) {
    return {
      ...report,
      warnings,
      stagedRoleFlow: false,
      arrivalRoleCount: 0,
      screenedRoleCount: 0,
    };
  }

  const arrivalRoleIds = Array.isArray(settings.arrivalRoleIds) ? settings.arrivalRoleIds : [];
  const screenedRoleIds = Array.isArray(settings.pendingRoleIds) ? settings.pendingRoleIds : [];
  const verifiedRoleIds = Array.isArray(settings.verifiedRoleIds) ? settings.verifiedRoleIds : [];

  if (!arrivalRoleIds.length) {
    appendUniqueWarning(warnings, 'Staged verification is enabled but no Arrival role is configured.');
  }
  if (!screenedRoleIds.length) {
    appendUniqueWarning(warnings, 'Staged verification is enabled but no Screened/Member role is configured.');
  }
  if (!verifiedRoleIds.length) {
    appendUniqueWarning(warnings, 'Staged verification is enabled but no Verified role is configured.');
  }
  if (!report.screeningEnabled) {
    appendUniqueWarning(warnings, 'Staged verification requires Discord Membership Screening, but screening was not detected.');
  }

  const stages = [
    ['Arrival', arrivalRoleIds],
    ['Screened/Member', screenedRoleIds],
    ['Verified', verifiedRoleIds],
  ];

  for (const [label, roleIds] of stages) {
    for (const roleId of roleIds) {
      const role = guild.roles.cache.get(roleId);
      if (!role) {
        appendUniqueWarning(warnings, `${label} role ${roleId} no longer exists.`);
      }
    }
  }

  const allStageIds = [...arrivalRoleIds, ...screenedRoleIds, ...verifiedRoleIds];
  const duplicateIds = [...new Set(allStageIds.filter((id, index) => allStageIds.indexOf(id) !== index))];
  if (duplicateIds.length) {
    appendUniqueWarning(warnings, 'The same Discord role is configured in more than one verification stage. Each stage should use a distinct role.');
  }

  return {
    ...report,
    warnings,
    stagedRoleFlow: true,
    arrivalRoleCount: arrivalRoleIds.length,
    screenedRoleCount: screenedRoleIds.length,
  };
}

async function buildHealthReport(guild) {
  const targetGuild = requireGuild(guild);
  const report = await verificationManager.buildHealthReport(targetGuild);
  const stagedReport = addStagedWorkflowHealth(targetGuild, report);

  return {
    ...stagedReport,
    enabled: guildManager.isModuleEnabled(targetGuild.id, MODULE),
  };
}

async function repairMissingPanelMessages(guild, report, meta = {}) {
  const missingPanels = (report?.panels || []).filter(
    (panel) => panel?.ok === false && panel?.status === 'Missing message' && panel?.panelId
  );

  if (!missingPanels.length) return { repaired: 0, failed: [] };

  let repaired = 0;
  const failed = [];

  for (const health of missingPanels) {
    const panel = verificationStore.getPanel(guild.id, health.panelId);
    if (!panel?.channelId) {
      failed.push({ panelId: health.panelId, reason: 'Missing panel channel.' });
      continue;
    }

    try {
      await verificationManager.restoreMissingVerificationPanel(
        guild,
        health.panelId,
        {
          action: 'verification_health_restore_missing_message',
          actorId: 'system:verification-health',
          ...meta,
        }
      );
      repaired += 1;
    } catch (error) {
      failed.push({
        panelId: health.panelId,
        reason: error?.message || 'Panel restore failed.',
      });
    }
  }

  return { repaired, failed };
}

async function repair(guild, meta = {}) {
  const targetGuild = requireGuild(guild);

  // Health repair is intentionally non-destructive. Runtime reads already
  // normalize verification configuration; repair should only change state
  // when it has identified a concrete recoverable fault.
  const before = await buildHealthReport(targetGuild);
  const recovery = await repairMissingPanelMessages(targetGuild, before, meta);
  const after = recovery.repaired ? await buildHealthReport(targetGuild) : before;

  return {
    ...after,
    repair: recovery,
  };
}

module.exports = {
  buildHealthReport,
  repair,
  repairMissingPanelMessages,
};
