'use strict';

const guildManager = require('../../../core/guild/guildManager');
const sentinelScheduler = require('../../../owner/sentinel/schedulerRegistry.js');
const core = require('./socialStudioMonitorCore');
const { projectedOptions } = require('./socialStudioMonitorProjection');
const { repairLiveRollovers } = require('./socialStudioLiveRollover');
const { applyLiveMessageParity } = require('./socialStudioLiveMessageParity');

let timer = null;
let schedulerTickMs = 60_000;
const GLOBAL_SCHEDULER = 'social:monitor:global';

async function checkGuildAccounts(client, guildId, options = {}) {
  const beforeConfig = options.guildConfig && typeof options.guildConfig === 'object' ? options.guildConfig : guildManager.reloadGuild(guildId);
  const result = await core.checkGuildAccounts(client, guildId, projectedOptions(guildId, options));
  const repaired = await repairLiveRollovers(client, guildId, beforeConfig, result, { checkCore: core.checkGuildAccounts, projectedOptions });
  await applyLiveMessageParity(client, guildId, beforeConfig, repaired);
  return repaired;
}

async function forcePostCreatorLive(client, guildId, creatorId, options = {}) {
  const beforeConfig = options.guildConfig && typeof options.guildConfig === 'object' ? options.guildConfig : guildManager.reloadGuild(guildId);
  const result = await core.forcePostCreatorLive(client, guildId, creatorId, projectedOptions(guildId, options));

  // A forced LIVE post bypasses the normal provider-result shape, so perform a
  // focused follow-up check to bring the new message onto the same locked card
  // layout without creating another notification.
  await checkGuildAccounts(client, guildId, {
    guildConfig: guildManager.reloadGuild(guildId),
    accountIds: (result?.sent || []).map((item) => item.accountId).filter(Boolean),
    manual: true,
    force: true,
  }).catch((error) => {
    console.error('[Social Studio] forced LIVE parity check failed:', error?.message || error);
  });

  return result;
}

function guildScheduler(guild) {
  return sentinelScheduler.register({ module: 'social', component: 'automatic-monitor', guildId: guild.id, guildName: guild.name, intervalMs: schedulerTickMs, staleAfterMs: Math.max(schedulerTickMs * 3, 180_000) });
}

async function sweep(client) {
  let checked = 0;
  let failed = 0;
  for (const guild of client?.guilds?.cache?.values?.() || []) {
    const schedulerId = guildScheduler(guild);
    try {
      await checkGuildAccounts(client, guild.id);
      checked += 1;
      sentinelScheduler.beat(schedulerId, { guildsChecked: checked, lastSweepGuildId: guild.id });
    } catch (error) {
      failed += 1;
      sentinelScheduler.fail(schedulerId, error, { guildId: guild.id });
      console.error(`[Social Studio] automatic check failed for guild ${guild.id}:`, error?.message || error);
    }
  }
  sentinelScheduler.beat(GLOBAL_SCHEDULER, { guildsChecked: checked, guildFailures: failed });
  return { checked, failed };
}

function runSweep(client, label) {
  return sweep(client).catch((error) => {
    sentinelScheduler.fail(GLOBAL_SCHEDULER, error, { phase: label });
    console.error(`[Social Studio] ${label} sweep failed:`, error);
  });
}

function startupSocialStudio(client) {
  if (timer) return timer;
  schedulerTickMs = Math.max(30000, Number(process.env.SOCIAL_STUDIO_TICK_MS || 60000));
  sentinelScheduler.register({ id: GLOBAL_SCHEDULER, module: 'social', component: 'automatic-monitor', intervalMs: schedulerTickMs, staleAfterMs: Math.max(schedulerTickMs * 3, 180_000), details: { scope: 'all-guilds' } });
  const initial = setTimeout(() => runSweep(client, 'initial'), 5000);
  initial.unref?.();
  timer = setInterval(() => runSweep(client, 'scheduled'), schedulerTickMs);
  timer.unref?.();
  console.log(`✅ Social Studio monitor started (${schedulerTickMs}ms scheduler tick)`);
  return timer;
}

module.exports = { startupSocialStudio, checkGuildAccounts, forcePostCreatorLive };
