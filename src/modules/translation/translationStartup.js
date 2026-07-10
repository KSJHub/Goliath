'use strict';

const translationThreadManager = require('./translationThreadManager');

async function startupTranslation(client) {
  const guilds = [...(client.guilds?.cache?.values?.() || [])];
  const results = [];

  for (const guild of guilds) {
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

module.exports = {
  startupTranslation,
  recoverTranslationPanels: startupTranslation,
};
