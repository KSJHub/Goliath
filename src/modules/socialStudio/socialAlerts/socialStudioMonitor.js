'use strict';

const guildManager = require('../../../core/guild/guildManager');
const sentinel = require('../../../owner/sentinel');
const sentinelScheduler = require('../../../owner/sentinel/schedulerRegistry.js');
const core = require('./socialStudioMonitorCore');
const { projectEffectiveAccounts } = require('./socialStudioRoutingResolver');

let timer = null;
let schedulerTickMs = 60_000;
const GLOBAL_SCHEDULER = 'social:monitor:global';

function projectLiveRefreshState(account) {
  if (!account || typeof account !== 'object') return account;
  const state = account.state && typeof account.state === 'object' ? account.state : null;
  if (!state) return account;
  const raw = state.lastLiveMessageUpdateAt || state.lastLiveMessageUpdatedAt;
  if (!raw || typeof raw !== 'string') return account;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return account;
  return {
    ...account,
    state: {
      ...state,
      ...(state.lastLiveMessageUpdateAt === raw ? { lastLiveMessageUpdateAt: new Date(parsed) } : {}),
      ...(state.lastLiveMessageUpdatedAt === raw ? { lastLiveMessageUpdatedAt: new Date(parsed) } : {}),
    },
  };
}

function projectGuildConfig(guildConfig) {
  if (!guildConfig || typeof guildConfig !== 'object') return guildConfig;
  const modules = guildConfig.modules && typeof guildConfig.modules === 'object' ? guildConfig.modules : {};
  const social = modules.social && typeof modules.social === 'object' ? modules.social : null;
  if (!social) return guildConfig;
  const effectiveAccounts = projectEffectiveAccounts(social);
  const projectedAccounts = Object.fromEntries(
    Object.entries(effectiveAccounts && typeof effectiveAccounts === 'object' ? effectiveAccounts : {})
      .map(([accountId, account]) => [accountId, projectLiveRefreshState(account)])
  );
  return {
    ...guildConfig,
    modules: { ...modules, social: { ...social, accounts: projectedAccounts } },
  };
}

function projectedOptions(guildId, options = {}) {
  const sourceGuildConfig = options.guildConfig && typeof options.guildConfig === 'object'
    ? options.guildConfig
    : guildManager.reloadGuild(guildId);
  return { ...options, guildConfig: projectGuildConfig(sourceGuildConfig) };
}

function rolloverIncident(guild, account) {
  return {
    guildId: guild?.id || null,
    guildName: guild?.name || null,
    module: 'social',
    component: `${account?.platform || 'unknown'}:${account?.username || account?.externalId || account?.accountId || 'account'}`,
    code: 'live-event-rollover-missed',
  };
}

async function removeStaleLivePost(client, guildId, previous) {
  if (!previous?.lastAlertChannelId || !previous?.lastAlertMessageId) return false;
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return false;
  const channel = guild.channels.cache.get(previous.lastAlertChannelId)
    || await guild.channels.fetch(previous.lastAlertChannelId).catch(() => null);
  if (!channel?.messages?.fetch) return false;
  const message = await channel.messages.fetch(previous.lastAlertMessageId).catch(() => null);
  if (!message) return false;
  await message.delete();
  return true;
}

async function repairLiveRollovers(client, guildId, beforeConfig, result) {
  if (!result || result.skipped) return result;
  const guild = client.guilds.cache.get(guildId) || null;
  const beforeSocial = beforeConfig?.modules?.social || {};
  const latestGuild = guildManager.reloadGuild(guildId) || {};
  const latestSocial = latestGuild?.modules?.social || {};
  const repairs = [];

  for (const item of result.results || []) {
    if (item?.isLive !== true || !item.accountId) continue;
    const beforeAccount = beforeSocial.accounts?.[item.accountId];
    const currentAccount = latestSocial.accounts?.[item.accountId];
    const previous = beforeAccount?.state || {};
    const current = currentAccount?.state || {};
    const previousEventId = previous.liveEventId ? String(previous.liveEventId) : '';
    const currentEventId = current.liveEventId ? String(current.liveEventId) : '';
    if (previous.isLive !== true || !previousEventId || !currentEventId || previousEventId === currentEventId) continue;
    if (String(current.lastAlertKey || '') === `live:${currentEventId}`) continue;

    const incident = rolloverIncident(guild || { id: guildId }, currentAccount || beforeAccount);
    await sentinel.report(client, {
      ...incident,
      severity: 'warning',
      message: 'A provider returned a new LIVE event while Social Studio still held the previous LIVE session. Automatic rollover repair started.',
      details: {
        accountId: item.accountId,
        previousEventId,
        currentEventId,
        previousMessageId: previous.lastAlertMessageId || null,
        previousChannelId: previous.lastAlertChannelId || null,
      },
    });

    try {
      const repairGuild = guildManager.reloadGuild(guildId) || latestGuild;
      const repairSocial = repairGuild?.modules?.social || {};
      const repairAccount = repairSocial.accounts?.[item.accountId];
      if (!repairAccount) throw new Error('The rollover account disappeared before repair could run.');

      const patchedGuild = {
        ...repairGuild,
        modules: {
          ...(repairGuild.modules || {}),
          social: {
            ...repairSocial,
            accounts: {
              ...(repairSocial.accounts || {}),
              [item.accountId]: {
                ...repairAccount,
                state: {
                  ...(repairAccount.state || {}),
                  isLive: false,
                  liveEventId: previousEventId,
                  lastLiveEvent: previous.lastLiveEvent || repairAccount.state?.lastLiveEvent || null,
                  lastAlertKey: previous.lastAlertKey || null,
                  lastAlertMessageId: null,
                  lastAlertChannelId: null,
                },
              },
            },
          },
        },
      };

      const repaired = await core.checkGuildAccounts(client, guildId, projectedOptions(guildId, {
        force: true,
        accountIds: [item.accountId],
        guildConfig: patchedGuild,
      }));
      const repairedItem = (repaired.results || []).find((entry) => String(entry.accountId) === String(item.accountId));
      const delivered = repairedItem?.delivered || [];
      const liveDelivery = delivered.find((entry) => entry.type === 'live' && String(entry.id || '') === currentEventId);
      if (!liveDelivery) throw new Error('Rollover repair completed without delivering the new LIVE event.');

      // Only remove the stale post after the replacement LIVE alert is safely delivered.
      const stalePostRemoved = await removeStaleLivePost(client, guildId, previous).catch(() => false);
      repairs.push({ accountId: item.accountId, previousEventId, currentEventId, stalePostRemoved, repaired: true });
      await sentinel.recover(client, incident, {
        accountId: item.accountId,
        previousEventId,
        currentEventId,
        stalePostRemoved,
        deliveredMessageId: liveDelivery.messageId || null,
      });
    } catch (error) {
      repairs.push({ accountId: item.accountId, previousEventId, currentEventId, repaired: false, error: error?.message || String(error) });
      await sentinel.report(client, {
        ...incident,
        severity: 'error',
        message: 'Social Studio detected a LIVE event rollover but automatic repair failed.',
        details: {
          accountId: item.accountId,
          previousEventId,
          currentEventId,
          error: error?.stack || error?.message || String(error),
        },
      });
    }
  }

  return repairs.length ? { ...result, rolloverRepairs: repairs } : result;
}

async function checkGuildAccounts(client, guildId, options = {}) {
  const beforeConfig = options.guildConfig && typeof options.guildConfig === 'object'
    ? options.guildConfig
    : guildManager.reloadGuild(guildId);
  const result = await core.checkGuildAccounts(client, guildId, projectedOptions(guildId, options));
  return repairLiveRollovers(client, guildId, beforeConfig, result);
}

function forcePostCreatorLive(client, guildId, creatorId, options = {}) {
  return core.forcePostCreatorLive(client, guildId, creatorId, projectedOptions(guildId, options));
}

function guildScheduler(guild) {
  return sentinelScheduler.register({
    module: 'social',
    component: 'automatic-monitor',
    guildId: guild.id,
    guildName: guild.name,
    intervalMs: schedulerTickMs,
    staleAfterMs: Math.max(schedulerTickMs * 3, 180_000),
  });
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
  sentinelScheduler.register({
    id: GLOBAL_SCHEDULER,
    module: 'social',
    component: 'automatic-monitor',
    intervalMs: schedulerTickMs,
    staleAfterMs: Math.max(schedulerTickMs * 3, 180_000),
    details: { scope: 'all-guilds' },
  });
  const initial = setTimeout(() => runSweep(client, 'initial'), 5000);
  initial.unref?.();
  timer = setInterval(() => runSweep(client, 'scheduled'), schedulerTickMs);
  timer.unref?.();
  console.log(`✅ Social Studio monitor started (${schedulerTickMs}ms scheduler tick)`);
  return timer;
}

module.exports = {
  startupSocialStudio,
  checkGuildAccounts,
  forcePostCreatorLive,
};
