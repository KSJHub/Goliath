'use strict';

const guildManager = require('../../core/guild/guildManager');
const verificationHealth = require('./verificationHealth');

const MODULE = 'verification';

function buildSkippedResult(guild) {
  return {
    guildId: guild.id,
    guildName: guild.name,
    ok: true,
    enabled: false,
    skipped: true,
    warnings: [],
    panels: [],
  };
}

function buildEnabledResult(guild, report) {
  return {
    guildId: guild.id,
    guildName: guild.name,
    ok: report.warnings.length === 0,
    enabled: true,
    skipped: false,
    warnings: report.warnings,
    panels: report.panels,
  };
}

function buildFailedResult(guild, error) {
  return {
    guildId: guild.id,
    guildName: guild.name,
    ok: false,
    enabled: true,
    skipped: false,
    warnings: [error.message || 'Verification startup check failed.'],
    panels: [],
  };
}

function hasMissingPanelMessage(report) {
  return (report?.panels || []).some(
    (panel) => panel?.ok === false && panel?.status === 'Missing message'
  );
}

async function checkGuild(guild) {
  const enabled = guildManager.isModuleEnabled(guild.id, MODULE) === true;
  if (!enabled) return buildSkippedResult(guild);

  try {
    let report = await verificationHealth.buildHealthReport(guild);

    if (hasMissingPanelMessage(report)) {
      const repaired = await verificationHealth.repair(guild, {
        actorId: 'system:verification-startup',
      });

      if (repaired?.repair?.repaired) {
        console.log(
          `[Verification] ${guild.name || guild.id}: restored ${repaired.repair.repaired} missing panel message(s).`
        );
      }

      for (const failure of repaired?.repair?.failed || []) {
        console.warn(
          `[Verification] ${guild.name || guild.id}: could not restore ${failure.panelId}: ${failure.reason}`
        );
      }

      report = repaired;
    }

    return buildEnabledResult(guild, report);
  } catch (error) {
    return buildFailedResult(guild, error);
  }
}

function summarizeResults(results) {
  const enabledResults = results.filter((result) => result.enabled === true);

  return {
    enabledResults,
    summary: {
      ok: enabledResults.every((result) => result.ok),
      guildsChecked: results.length,
      enabledGuilds: enabledResults.length,
      skippedGuilds: results.filter((result) => result.skipped === true).length,
      totalPanels: enabledResults.reduce(
        (total, result) => total + (result.panels?.length || 0),
        0
      ),
      totalWarnings: enabledResults.reduce(
        (total, result) => total + (result.warnings?.length || 0),
        0
      ),
      results,
    },
  };
}

function logSummary(summary, enabledResults) {
  console.log(
    `[Verification] Startup check complete: ${summary.guildsChecked} guild(s), ${summary.enabledGuilds} enabled, ${summary.skippedGuilds} skipped, ${summary.totalPanels} panel(s), ${summary.totalWarnings} warning(s).`
  );

  for (const result of enabledResults) {
    if (!result.warnings?.length) continue;
    console.warn(
      `[Verification] ${result.guildName || result.guildId}: ${result.warnings.join(' | ')}`
    );
  }
}

async function startupVerification(client) {
  if (!client?.guilds?.cache) {
    return {
      ok: false,
      reason: 'Missing Discord client.',
      guildsChecked: 0,
      results: [],
    };
  }

  const guilds = [...client.guilds.cache.values()];
  const results = await Promise.all(guilds.map(checkGuild));
  const { enabledResults, summary } = summarizeResults(results);

  logSummary(summary, enabledResults);
  return summary;
}

module.exports = {
  startupVerification,
};
