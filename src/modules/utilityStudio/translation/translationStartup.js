'use strict';

const translationThreadManager = require('./translationThreadManager');
const { isModuleEnabled } = require('../../../core/guild/guildManager');

const startupRuns = new WeakMap();

async function recoverTranslationPanels(client) {
  const guilds = [...(client.guilds?.cache?.values?.() || [])];
  const results = [];

  for (const guild of guilds) {
    if (!isModuleEnabled(guild.id, 'translation')) continue;
    const guildResults = await translationThreadManager.recoverGuildThreads(guild);
    results.push({ guildId: guild.id, guildName: guild.name, results: guildResults });
  }

  const summary = {
    ok: true,
    guildsChecked: results.length,
    channelsRecovered: results.reduce((total, guildResult) => total + guildResult.results.length, 0),
    results,
  };

  console.log(
    `[Translation] Startup recovery complete: ${summary.guildsChecked} guild(s), ${summary.channelsRecovered} channel(s).`
  );

  return summary;
}

function startupTranslation(client) {
  const existingRun = startupRuns.get(client);
  if (existingRun) return existingRun;

  const startupRun = recoverTranslationPanels(client).catch((error) => {
    startupRuns.delete(client);
    throw error;
  });

  startupRuns.set(client, startupRun);
  return startupRun;
}

module.exports = {
  startupTranslation,
  recoverTranslationPanels,
};
