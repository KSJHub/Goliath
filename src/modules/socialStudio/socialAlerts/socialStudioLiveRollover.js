'use strict';

const guildManager = require('../../../core/guild/guildManager');
const sentinel = require('../../../owner/sentinel');

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
  const channelId = previous?.lastLiveMessageChannelId || previous?.lastAlertChannelId;
  const messageId = previous?.lastLiveMessageId || previous?.lastAlertMessageId;
  if (!channelId || !messageId) return false;
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return false;
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.messages?.fetch) return false;
  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message) return false;
  await message.delete();
  return true;
}

async function repairLiveRollovers(client, guildId, beforeConfig, result, { checkCore, projectedOptions }) {
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
        previousMessageId: previous.lastLiveMessageId || previous.lastAlertMessageId || null,
        previousChannelId: previous.lastLiveMessageChannelId || previous.lastAlertChannelId || null,
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
                  lastLiveMessageId: null,
                  lastLiveMessageChannelId: null,
                },
              },
            },
          },
        },
      };
      const repaired = await checkCore(client, guildId, projectedOptions(guildId, { force: true, accountIds: [item.accountId], guildConfig: patchedGuild }));
      const repairedItem = (repaired.results || []).find((entry) => String(entry.accountId) === String(item.accountId));
      const liveDelivery = (repairedItem?.delivered || []).find((entry) => entry.type === 'live' && String(entry.id || '') === currentEventId);
      if (!liveDelivery) throw new Error('Rollover repair completed without delivering the new LIVE event.');
      const stalePostRemoved = await removeStaleLivePost(client, guildId, previous).catch(() => false);
      repairs.push({ accountId: item.accountId, previousEventId, currentEventId, stalePostRemoved, repaired: true });
      await sentinel.recover(client, incident, { accountId: item.accountId, previousEventId, currentEventId, stalePostRemoved, deliveredMessageId: liveDelivery.messageId || null });
    } catch (error) {
      repairs.push({ accountId: item.accountId, previousEventId, currentEventId, repaired: false, error: error?.message || String(error) });
      await sentinel.report(client, {
        ...incident,
        severity: 'error',
        message: 'Social Studio detected a LIVE event rollover but automatic repair failed.',
        details: { accountId: item.accountId, previousEventId, currentEventId, error: error?.stack || error?.message || String(error) },
      });
    }
  }
  return repairs.length ? { ...result, rolloverRepairs: repairs } : result;
}

module.exports = { rolloverIncident, removeStaleLivePost, repairLiveRollovers };
