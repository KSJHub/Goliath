'use strict';

const guildManager = require('../../core/guild/guildManager');
const sentinel = require('../../owner/sentinel');
const core = require('../../modules/socialStudio/socialAlerts/socialStudioMonitorCore');

const RECOVERY_INTERVAL_MS = 60_000;
const runningGuilds = new Set();
let timer = null;

function isMissingLivePostError(value) {
  const message = String(value || '').toLowerCase();
  return message.includes('saved live post could not be found')
    || message.includes('saved live post channel is unavailable');
}

function incidentFor(guild, account) {
  return {
    guildId: guild?.id || null,
    guildName: guild?.name || null,
    module: 'social',
    component: `${account?.platform || 'unknown'}:${account?.username || account?.externalId || account?.accountId || 'account'}`,
    code: 'live-message-missing',
  };
}

function patchedGuildForRecovery(guildConfig, accountId, currentEventId) {
  const social = guildConfig?.modules?.social || {};
  const account = social.accounts?.[accountId];
  if (!account) return null;
  const state = account.state || {};

  return {
    ...guildConfig,
    modules: {
      ...(guildConfig.modules || {}),
      social: {
        ...social,
        accounts: {
          ...(social.accounts || {}),
          [accountId]: {
            ...account,
            state: {
              ...state,
              isLive: false,
              liveEventId: currentEventId,
              lastAlertKey: null,
              lastAlertMessageId: null,
              lastAlertChannelId: null,
              lastLiveMessageUpdateAt: null,
              lastLiveMessageUpdatedAt: null,
              lastDeliveryError: null,
            },
          },
        },
      },
    },
  };
}

async function recoverAccount(client, guild, guildConfig, account) {
  const state = account?.state || {};
  if (state.isLive !== true || !state.lastLiveEvent || !isMissingLivePostError(state.lastDeliveryError)) return null;

  const currentEventId = state.liveEventId || state.lastLiveEvent?.id;
  if (!currentEventId) return null;

  const incident = incidentFor(guild, account);
  await sentinel.report(client, {
    ...incident,
    severity: 'warning',
    message: 'The tracked Social Studio LIVE post is missing. Automatic replacement started.',
    details: {
      accountId: account.accountId,
      currentEventId: String(currentEventId),
      missingMessageId: state.lastAlertMessageId || null,
      missingChannelId: state.lastAlertChannelId || null,
      deliveryError: state.lastDeliveryError || null,
    },
  });

  try {
    const patchedGuild = patchedGuildForRecovery(guildConfig, account.accountId, String(currentEventId));
    if (!patchedGuild) throw new Error('The LIVE account disappeared before recovery could run.');

    // Call core directly so historical stale LIVE-message IDs are not projected back into this known-bad state.
    const result = await core.checkGuildAccounts(client, guild.id, {
      force: true,
      accountIds: [account.accountId],
      guildConfig: patchedGuild,
    });

    if (result?.skipped && result.reason === 'check_already_running') return { deferred: true };

    const item = (result?.results || []).find((entry) => String(entry.accountId) === String(account.accountId));
    const delivery = (item?.delivered || []).find(
      (entry) => entry.type === 'live' && String(entry.id || '') === String(currentEventId)
    );

    if (!delivery) throw new Error('Missing LIVE post recovery completed without delivering a replacement LIVE event.');

    await sentinel.recover(client, incident, {
      accountId: account.accountId,
      currentEventId: String(currentEventId),
      deliveredMessageId: delivery.messageId || null,
      deliveredChannelId: delivery.channelId || null,
    });

    console.log(`[Social Studio] recovered missing LIVE post for ${account.platform}:${account.username || account.externalId || account.accountId}`);
    return { recovered: true };
  } catch (error) {
    await sentinel.report(client, {
      ...incident,
      severity: 'error',
      message: 'Social Studio detected a missing LIVE post but automatic replacement failed.',
      details: {
        accountId: account.accountId,
        currentEventId: String(currentEventId),
        error: error?.stack || error?.message || String(error),
      },
    });
    return { recovered: false, error: error?.message || String(error) };
  }
}

async function sweep(client) {
  for (const guild of client?.guilds?.cache?.values?.() || []) {
    if (runningGuilds.has(guild.id)) continue;
    runningGuilds.add(guild.id);
    try {
      const guildConfig = guildManager.reloadGuild(guild.id) || {};
      const social = guildConfig?.modules?.social || {};
      for (const account of Object.values(social.accounts || {})) {
        if (!account || account.enabled === false) continue;
        await recoverAccount(client, guild, guildConfig, account);
      }
    } catch (error) {
      console.error(`[Social Studio] LIVE post recovery sweep failed for guild ${guild.id}:`, error?.message || error);
    } finally {
      runningGuilds.delete(guild.id);
    }
  }
}

module.exports = {
  name: 'clientReady',
  once: true,
  async execute(client) {
    if (timer) return;
    const initial = setTimeout(() => sweep(client).catch(() => null), 15_000);
    initial.unref?.();
    timer = setInterval(() => sweep(client).catch(() => null), RECOVERY_INTERVAL_MS);
    timer.unref?.();
    console.log(`✅ Social Studio LIVE post recovery started (${RECOVERY_INTERVAL_MS}ms interval)`);
  },
};
