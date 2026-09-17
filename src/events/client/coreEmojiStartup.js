'use strict';

const { Events } = require('discord.js');
const terminal = require('../../core/logging/terminalLogger').createLogger('bot');
const emojis = require('../../modules/utilityStudio/emojis/emojis');
const emojiApi = require('../../modules/utilityStudio/emojis/emojisApi');
const schedulerRegistry = require('../../owner/sentinel/schedulerRegistry');

const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;
const SCHEDULER_ID = 'emojiStudio:maintenance:global';

async function runStudioMaintenance(client, { logHealthy = false, phase = 'scheduled' } = {}) {
  let expiredCount = 0;
  let unhealthyCount = 0;
  for (const guild of client.guilds.cache.values()) {
    try {
      const expired = await emojis.processExpiredTemporary(client, guild.id);
      expiredCount += expired.length;
      const health = await emojis.health(client, guild.id);
      if (!health.healthy) {
        unhealthyCount += 1;
        terminal.warn(`Emoji Studio health warning for ${guild.name} (${guild.id}): ${health.brokenFavourites.length} broken favourite(s), ${health.brokenAliases.length} broken alias(es), ${health.brokenPackEntries.length} broken pack reference(s), ${health.expiredTemporary.length} expired temporary emoji(s).`);
      }
    } catch (error) {
      unhealthyCount += 1;
      terminal.warn(`Emoji Studio maintenance failed for ${guild.name} (${guild.id}): ${error?.message || error}`);
    }
  }
  const details = { phase, guildsChecked: client.guilds.cache.size, expiredCount, unhealthyCount };
  if (unhealthyCount > 0) schedulerRegistry.fail(SCHEDULER_ID, new Error(`${unhealthyCount} Emoji Studio guild health/maintenance check(s) failed.`), details);
  else schedulerRegistry.beat(SCHEDULER_ID, details);
  if (expiredCount > 0) terminal.info(`Emoji Studio expiry maintenance processed ${expiredCount} temporary emoji entr${expiredCount === 1 ? 'y' : 'ies'}.`);
  if (logHealthy && unhealthyCount === 0) terminal.success(`Emoji Studio health ready: ${client.guilds.cache.size} guild(s) healthy.`);
  return { expiredCount, unhealthyCount };
}

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    schedulerRegistry.register({
      id: SCHEDULER_ID,
      module: 'emojiStudio',
      component: 'maintenance',
      intervalMs: MAINTENANCE_INTERVAL_MS,
      staleAfterMs: MAINTENANCE_INTERVAL_MS * 3,
      details: { scope: 'all-guilds' },
    });
    try {
      const result = await emojiApi.syncCoreAssets(client, emojis.CORE_EMOJI_ALIASES, emojis.CORE_EMOJI_PREFIX);

      if (!result.assetDirectoryPresent) {
        const error = new Error(`Goliath Core emoji asset directory is missing: ${result.assetDirectory}`);
        schedulerRegistry.fail(SCHEDULER_ID, error, { phase: 'core-assets' });
        terminal.warn(error.message);
        return;
      }
      if (result.created.length > 0) terminal.success(`Goliath Core emoji seed created ${result.created.length} missing application emoji(s) from repo assets.`);
      if (result.missingAssets.length > 0) terminal.warn(`Goliath Core emoji assets missing for: ${result.missingAssets.join(', ')}`);
      if (result.failed.length > 0) terminal.error(`Goliath Core emoji seed failed for ${result.failed.length} asset(s): ${result.failed.map((entry) => `${entry.alias}: ${entry.error}`).join(' | ')}`);
      if (result.healthy) terminal.success(`Goliath Core emojis ready: ${result.installed}/${result.expected} application emojis available globally.`);
      else terminal.warn(`Goliath Core emojis incomplete: ${result.installed}/${result.expected} available; ${result.missingAssets.length} source asset(s) missing; ${result.failed.length} failed.`);

      if (!result.healthy) schedulerRegistry.fail(SCHEDULER_ID, new Error('Goliath Core emoji assets are incomplete.'), { phase: 'core-assets', installed: result.installed, expected: result.expected, missingAssets: result.missingAssets.length, failedAssets: result.failed.length });
      await runStudioMaintenance(client, { logHealthy: true, phase: 'startup' });
      const timer = setInterval(() => runStudioMaintenance(client, { phase: 'scheduled' }).catch((error) => {
        schedulerRegistry.fail(SCHEDULER_ID, error, { phase: 'scheduled' });
        terminal.warn(`Emoji Studio scheduled maintenance failed: ${error?.message || error}`);
      }), MAINTENANCE_INTERVAL_MS);
      timer.unref?.();
      terminal.info('Emoji Studio maintenance scheduler started (hourly).');
    } catch (error) {
      schedulerRegistry.fail(SCHEDULER_ID, error, { phase: 'startup' });
      terminal.error(`Failed to initialise Goliath Core/Emoji Studio: ${error?.message || error}`);
    }
  },
};
