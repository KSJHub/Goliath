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

async function buildHealthReport(guild) {
  const targetGuild = requireGuild(guild);
  const report = await verificationManager.buildHealthReport(targetGuild);

  return {
    ...report,
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
