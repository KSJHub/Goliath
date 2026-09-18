'use strict';

const { EmbedBuilder } = require('discord.js');
const guildManager = require('../../../core/guild/guildManager');
const { buildLiveFields } = require('./socialStudioLiveCard');

function clean(value, max = 2000) {
  return String(value ?? '').trim().slice(0, max);
}

function intText(value) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-GB') : '';
}

function discordTimestamp(value, style = 'R') {
  const ms = new Date(value).getTime();
  const earliest = Date.UTC(2020, 0, 1);
  const latest = Date.now() + 24 * 60 * 60 * 1000;
  return Number.isFinite(ms) && ms >= earliest && ms <= latest
    ? `<t:${Math.floor(ms / 1000)}:${style}>`
    : '';
}

function humanDuration(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return '';
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = Math.floor(value % 60);
  return [h ? `${h}h` : '', m ? `${m}m` : '', !h && s ? `${s}s` : ''].filter(Boolean).join(' ');
}

function secondsBetween(start, end) {
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.floor((b - a) / 1000) : null;
}

function cacheBust(value) {
  const raw = clean(value, 1000);
  if (!/^https?:\/\//i.test(raw)) return raw;
  try {
    const url = new URL(raw);
    url.searchParams.set('goliathPreview', String(Date.now()));
    return url.toString();
  } catch {
    const separator = raw.includes('?') ? '&' : '?';
    return `${raw}${separator}goliathPreview=${Date.now()}`;
  }
}

function accountFromConfig(config, accountId) {
  return config?.modules?.social?.accounts?.[accountId]
    || config?.accounts?.[accountId]
    || null;
}

function socialSettings(config) {
  return config?.modules?.social?.settings
    || config?.settings
    || {};
}

function updateStamp(account) {
  return account?.state?.lastLiveMessageUpdatedAt
    || account?.state?.lastLiveMessageUpdateAt
    || null;
}

function stampChanged(beforeAccount, afterAccount) {
  const before = updateStamp(beforeAccount);
  const after = updateStamp(afterAccount);
  if (!after) return false;
  if (!before) return true;
  return String(before) !== String(after);
}

async function fetchMessage(client, guildId, state) {
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return null;
  const channelId = state?.lastLiveMessageChannelId || state?.lastAlertChannelId;
  const messageId = state?.lastLiveMessageId || state?.lastAlertMessageId;
  if (!channelId || !messageId) return null;
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.messages?.fetch) return null;
  return channel.messages.fetch(messageId).catch(() => null);
}

function liveEventFor(result, beforeAccount, afterAccount) {
  if (result?.isLive === true) {
    return result.live
      || afterAccount?.state?.lastLiveEvent
      || beforeAccount?.state?.lastLiveEvent
      || null;
  }
  if (beforeAccount?.state?.isLive === true && result?.isLive === false) {
    return {
      ...(beforeAccount.state.lastLiveEvent || {}),
      endedAt: afterAccount?.state?.lastLiveEndedAt || new Date().toISOString(),
    };
  }
  return null;
}

function liveStatusFor(result, beforeAccount) {
  if (result?.isLive === true) return 'LIVE';
  if (beforeAccount?.state?.isLive === true && result?.isLive === false) return 'OFFLINE';
  return null;
}

function parityFields(account, event, liveStatus, settings) {
  const startedAt = event?.startedAt || account?.state?.liveStartedAt || null;
  const endedAt = liveStatus === 'OFFLINE' ? event?.endedAt || account?.state?.lastLiveEndedAt || new Date().toISOString() : null;
  const durationSeconds = Number.isFinite(Number(event?.durationSeconds))
    ? Number(event.durationSeconds)
    : secondsBetween(startedAt, endedAt || new Date().toISOString());
  const durationText = settings.includeLiveDuration === false ? '' : humanDuration(durationSeconds);
  const viewers = settings.includeViewerCount === false || Number(event?.viewerCount) <= 0
    ? ''
    : intText(event.viewerCount);
  const peak = Number(account?.state?.peakViewers || event?.peakViewers || event?.viewerCount || 0);

  return buildLiveFields({
    account,
    event,
    vars: {
      viewers,
      peakViewers: peak > 0 ? intText(peak) : '',
    },
    liveStatus,
    durationText,
    started: discordTimestamp(startedAt),
    ended: discordTimestamp(endedAt),
  });
}

function retainedExtraFields(embed) {
  return (embed?.data?.fields || []).filter((field) => {
    const name = String(field?.name || '');
    return name === '\u200B' || /VOD|Replay/i.test(name);
  });
}

async function applyOne(client, guildId, account, event, liveStatus, settings) {
  const message = await fetchMessage(client, guildId, account?.state);
  if (!message?.embeds?.length) return false;

  const embed = EmbedBuilder.from(message.embeds[0]);
  const fields = parityFields(account, event, liveStatus, settings);
  const extras = retainedExtraFields(embed);
  embed.setFields([...fields, ...extras].slice(0, 25));

  // Kick already uploads a fresh attachment in monitor core. For providers
  // using remote thumbnails, force a unique URL only when the configured LIVE
  // refresh actually runs, preventing Discord/CDN cache reuse.
  const imageUrl = embed.data?.image?.url;
  if (liveStatus === 'LIVE' && /^https?:\/\//i.test(imageUrl || '')) {
    embed.setImage(cacheBust(event?.thumbnail || imageUrl));
  }

  await message.edit({ embeds: [embed] });
  return true;
}

async function applyLiveMessageParity(client, guildId, beforeConfig, monitorResult) {
  const results = Array.isArray(monitorResult?.results) ? monitorResult.results : [];
  if (!results.length) return monitorResult;

  const afterConfig = guildManager.reloadGuild(guildId);
  const settings = socialSettings(afterConfig);

  for (const result of results) {
    const beforeAccount = accountFromConfig(beforeConfig, result.accountId);
    const afterAccount = accountFromConfig(afterConfig, result.accountId);
    const account = afterAccount || beforeAccount;
    if (!account) continue;

    const liveStatus = liveStatusFor(result, beforeAccount);
    if (!liveStatus) continue;

    // Only touch Discord when monitor core actually created/updated the LIVE
    // message. This preserves Refresh Off and every configured 10-60m cadence.
    const deliveredLive = Array.isArray(result.delivered)
      && result.delivered.some((item) => item?.type === 'live');
    const offlineTransition = beforeAccount?.state?.isLive === true && result?.isLive === false;
    if (!deliveredLive && !offlineTransition && !stampChanged(beforeAccount, afterAccount)) continue;

    const event = liveEventFor(result, beforeAccount, afterAccount);
    if (!event) continue;

    try {
      await applyOne(client, guildId, account, event, liveStatus, settings);
    } catch (error) {
      console.error(`[Social Studio] LIVE parity update failed for ${result.accountId}:`, error?.message || error);
    }
  }

  return monitorResult;
}

module.exports = {
  applyLiveMessageParity,
  parityFields,
};
