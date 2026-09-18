'use strict';

const { EmbedBuilder } = require('discord.js');
const guildManager = require('../../../core/guild/guildManager');
const emojis = require('../../utilityStudio/emojis/emojis');
const { deleteExpiredCreators } = require('./socialStudioStore');
const { checkAccount, providerInfo } = require('./socialStudioProviders');
const { normalizeTemplates, resolveTemplate } = require('./socialStudioTemplates');

const runningGuilds = new Set();
const LIVE_MESSAGE_REFRESH_MS = 10 * 60 * 1000;
let timer = null;

const PLATFORM = {
  twitch: { label: 'Twitch', icon: '🟣', color: 0x9146FF },
  youtube: { label: 'YouTube', icon: '🔴', color: 0xFF0000 },
  tiktok: { label: 'TikTok', icon: '⚫', color: 0x2F3136 },
  kick: { label: 'Kick', icon: '🟢', color: 0x53FC18 },
  facebook: { label: 'Facebook', icon: '🔵', color: 0x1877F2 },
  instagram: { label: 'Instagram', icon: '🟠', color: 0xE1306C },
  x: { label: 'X', icon: '⚪', color: 0x000000 },
};

const EMBED_WIDTH_DIVIDER = '\u2500'.repeat(28);

const now = () => new Date().toISOString();
const clean = (value, max = 2000) => String(value ?? '').trim().slice(0, max);
const intText = (value) => Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-GB') : '';

function validTimeZone(value) {
  const timezone = String(value || '').trim();
  if (!timezone) return false;
  try { new Intl.DateTimeFormat('en-GB', { timeZone: timezone }).format(new Date()); return true; }
  catch { return false; }
}

function quietHoursActive(settings, date = new Date()) {
  const quiet = settings?.quietHours && typeof settings.quietHours === 'object' ? settings.quietHours : null;
  if (!quiet || quiet.enabled !== true) return false;
  const timezone = String(quiet.timezone || '').trim();
  if (!validTimeZone(timezone)) return false;
  const parseTime = (value) => {
    const match = String(value || '').trim().match(/^(\d{2}):(\d{2})$/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return hours * 60 + minutes;
  };
  const start = parseTime(quiet.start);
  const end = parseTime(quiet.end);
  if (start === null || end === null || start === end) return false;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return false;
  const current = hour * 60 + minute;
  return start < end ? current >= start && current < end : current >= start || current < end;
}

function stripTrailingDivider(value) {
  return String(value || '').replace(/(?:\n\s*)+(?:[\u2500\-_]{8,}\s*)+$/u, '').trim();
}

function cacheBustedImageUrl(value) {
  const raw = clean(value, 1000);
  if (!/^https?:\/\//i.test(raw)) return '';
  if (/static-cdn\.jtvnw\.net|static-cdn\.twitchcdn\.net|images\.kick\.com/i.test(raw)) return raw;
  const separator = raw.includes('?') ? '&' : '?';
  return `${raw}${separator}snapshot=${Date.now()}`;
}

async function fetchKickPreviewAttachment(account, event) {
  if (
    String(account?.platform || '').toLowerCase() !== 'kick' ||
    event?.type !== 'live'
  ) return null;

  const raw = clean(event?.thumbnail, 1000);
  if (!/^https?:\/\//i.test(raw)) return null;

  const separator = raw.includes('?') ? '&' : '?';

  const urls = [
    `${raw}${separator}goliathPreview=${Date.now()}`,
    raw,
  ];

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: {
          'cache-control': 'no-cache',
          'pragma': 'no-cache',
          'user-agent': 'Goliath Social Studio',
        },
      });

      if (!response.ok) continue;

      const contentType =
        String(response.headers.get('content-type') || '').toLowerCase();

      if (!contentType.startsWith('image/')) continue;

      const buffer = Buffer.from(await response.arrayBuffer());

      if (!buffer.length || buffer.length > 8 * 1024 * 1024) continue;

      let ext = 'webp';

      if (contentType.includes('png')) ext = 'png';
      else if (contentType.includes('jpeg') || contentType.includes('jpg')) ext = 'jpg';
      else if (contentType.includes('gif')) ext = 'gif';

      return {
        attachment: buffer,
        name: `kick-live-${Date.now()}.${ext}`,
      };
    } catch {
      // Fall back to the remote thumbnail URL.
    }
  }

  return null;
}


function embedActionBlock(lines = []) {
  const actions = lines.map((line) => clean(line, 300)).filter(Boolean);
  return actions.length ? `\n\n${actions.join('\n')}\n${EMBED_WIDTH_DIVIDER}` : '';
}

function configFor(guildId, guildConfig = null) {
  const guild = guildConfig && typeof guildConfig === 'object' ? guildConfig : guildManager.reloadGuild(guildId);
  const social = guild?.modules?.social && typeof guild.modules.social === 'object' ? guild.modules.social : {};
  return {
    ...social,
    enabled: guildManager.isModuleEnabled(guildId, 'social'),
    alertsChannelId: social.alertsChannelId || null,
    alertChannels: social.alertChannels && typeof social.alertChannels === 'object' ? social.alertChannels : {},
    platformChannels: social.platformChannels && typeof social.platformChannels === 'object' ? social.platformChannels : {},
    accounts: social.accounts && typeof social.accounts === 'object' ? social.accounts : {},
    creators: social.creators && typeof social.creators === 'object' ? social.creators : {},
    templates: normalizeTemplates(social.templates),
    settings: social.settings && typeof social.settings === 'object' ? social.settings : {},
    history: Array.isArray(social.history) ? social.history : [],
    analytics: social.analytics && typeof social.analytics === 'object' ? social.analytics : {},
  };
}

function saveMonitorState(guildId, config, monitorUpdates, analyticsDelta, historyEntries, guild = null, duplicateMerges = new Map()) {
  const updated = guildManager.updateGuildSection(
    guildId,
    'social',
    (latest = {}) => {
      const latestAccounts = latest.accounts && typeof latest.accounts === 'object' ? latest.accounts : {};
      const accounts = { ...latestAccounts };
      const latestCreators = latest.creators && typeof latest.creators === 'object' ? latest.creators : {};
      const creators = Object.fromEntries(Object.entries(latestCreators).map(([id, creator]) => [id, { ...creator, accountIds: Array.isArray(creator?.accountIds) ? [...creator.accountIds] : [] }]));

      for (const [accountId, update] of monitorUpdates.entries()) {
        const current = accounts[accountId];
        if (!current || typeof current !== 'object') continue;
        accounts[accountId] = {
          ...current,
          state: update.state,
          ...(update.externalId ? { externalId: update.externalId } : {}),
          ...(update.resolvedUsername ? { username: update.resolvedUsername, normalizedUsername: update.resolvedUsername.toLowerCase() } : {}),
          ...(update.profileUrl ? { profileUrl: update.profileUrl } : {}),
          ...(update.avatar ? { avatar: update.avatar } : {}),
          updatedAt: update.updatedAt,
        };
      }

      for (const [duplicateId, survivorId] of duplicateMerges.entries()) {
        if (duplicateId === survivorId) continue;
        const duplicate = accounts[duplicateId];
        const survivor = accounts[survivorId];
        if (!duplicate || !survivor) continue;

        const alertTypes = [...new Set([
          ...(Array.isArray(survivor.alertTypes) ? survivor.alertTypes : []),
          ...(Array.isArray(duplicate.alertTypes) ? duplicate.alertTypes : []),
        ])];
        accounts[survivorId] = {
          ...survivor,
          ...(alertTypes.length ? { alertTypes } : {}),
          alertChannelId: survivor.alertChannelId || duplicate.alertChannelId || null,
          alertChannels: { ...(duplicate.alertChannels || {}), ...(survivor.alertChannels || {}) },
          mentionMode: survivor.mentionMode && survivor.mentionMode !== 'none' ? survivor.mentionMode : duplicate.mentionMode || survivor.mentionMode || 'none',
          mentionRoleId: survivor.mentionRoleId || duplicate.mentionRoleId || null,
          createdAt: survivor.createdAt || duplicate.createdAt,
          updatedAt: now(),
        };
        delete accounts[duplicateId];

        for (const creator of Object.values(creators)) {
          creator.accountIds = [...new Set((creator.accountIds || []).map((id) => id === duplicateId ? survivorId : id))];
        }
      }

      const latestAnalytics = latest.analytics && typeof latest.analytics === 'object' ? latest.analytics : {};
      const analytics = { ...latestAnalytics };
      for (const [key, amount] of Object.entries(analyticsDelta || {})) {
        if (!Number.isFinite(Number(amount)) || Number(amount) === 0) continue;
        analytics[key] = Number(analytics[key] || 0) + Number(amount);
      }

      const latestHistory = Array.isArray(latest.history) ? latest.history : [];
      const history = [...latestHistory, ...(historyEntries || [])].slice(-1000);
      return { ...latest, accounts, creators, analytics, history, updatedAt: now() };
    },
    {},
    guild || { guildId },
  );

  return { ...updated, enabled: guildManager.isModuleEnabled(guildId, 'social') };
}

function creatorFor(config, accountId) {
  return Object.values(config.creators).find((creator) => Array.isArray(creator.accountIds) && creator.accountIds.includes(accountId)) || null;
}

function identityToken(value) {
  return String(value || '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function validTikTokHandle(value) {
  return /^[a-z0-9._]{2,24}$/i.test(String(value || '').replace(/^@+/, ''));
}

function resolvedDuplicateIds(config, account, checked, creator) {
  if (!creator || !account?.accountId) return [];
  const platform = String(account.platform || '').toLowerCase();
  const externalId = clean(checked.externalId || account.externalId);
  const username = clean(checked.resolvedUsername || account.username).replace(/^@+/, '').toLowerCase();
  if (!externalId && !username) return [];

  const resolvedToken = identityToken(username);
  const duplicateIds = [];
  for (const otherId of creator.accountIds || []) {
    if (otherId === account.accountId) continue;
    const other = config.accounts[otherId];
    if (!other || String(other.platform || '').toLowerCase() !== platform) continue;

    const otherExternalId = clean(other.externalId);
    const otherUsername = clean(other.normalizedUsername || other.username).replace(/^@+/, '').toLowerCase();
    if (externalId && otherExternalId && externalId === otherExternalId) {
      duplicateIds.push(otherId);
      continue;
    }
    if (username && otherUsername && username === otherUsername) {
      duplicateIds.push(otherId);
      continue;
    }

    if (platform === 'tiktok' && externalId && !otherExternalId && !validTikTokHandle(otherUsername)) {
      const aliasToken = identityToken(otherUsername || other.sourceInput);
      if (aliasToken && resolvedToken.startsWith(aliasToken)) {
        const suffix = resolvedToken.slice(aliasToken.length);
        if (/^\d{2,6}$/.test(suffix)) duplicateIds.push(otherId);
      }
    }
  }
  return [...new Set(duplicateIds)];
}

function templateFor(config, type) {
  return resolveTemplate(config.templates, type);
}

function render(value, vars) {
  return String(value || '').replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (_match, key) => vars[key] ?? '');
}

function addHistory(config, event) {
  config.history = [...(config.history || []), { id: `history_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, createdAt: now(), ...event }].slice(-1000);
}

function enabledAlert(account, type) {
  const rawSupported = providerInfo(account.platform).supportedAlertTypes || [];
  const supported = rawSupported.includes('live') ? [...new Set([...rawSupported, 'ended'])] : rawSupported;
  const configured = Array.isArray(account.alertTypes) ? account.alertTypes : supported;
  return supported.includes(type) && configured.includes(type);
}

function secondsBetween(start, end) {
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.floor((b - a) / 1000) : null;
}

function vodMatchesEndedStream(item, startedAt, endedAt) {
  if (!item || item.type !== 'vod' || !item.url) return false;
  const publishedMs = new Date(item.publishedAt || item.createdAt || 0).getTime();
  const startedMs = new Date(startedAt || 0).getTime();
  const endedMs = new Date(endedAt || 0).getTime();
  if (!Number.isFinite(publishedMs) || !Number.isFinite(startedMs) || !Number.isFinite(endedMs)) return false;
  const margin = 15 * 60 * 1000;
  return publishedMs >= startedMs - margin && publishedMs <= endedMs + margin;
}

function eventCandidates(account, previous, checked) {
  const events = [];
  const contentItems = Array.isArray(checked.contentItems) && checked.contentItems.length
    ? checked.contentItems
    : checked.latestContent ? [checked.latestContent] : [];
  let endedVodId = null;
  if (checked.isLive === true && previous.isLive !== true && checked.event) events.push(checked.event);

  if (checked.isLive === false && previous.isLive === true && enabledAlert(account, 'ended')) {
    const prior = previous.lastLiveEvent && typeof previous.lastLiveEvent === 'object' ? previous.lastLiveEvent : {};
    const endedAt = checked.checkedAt || now();
    const startedAt = previous.liveStartedAt || prior.startedAt || null;
    const currentVod = contentItems.find((item) => vodMatchesEndedStream(item, startedAt, endedAt)) || null;
    endedVodId = currentVod?.id ? String(currentVod.id) : null;
    events.push({
      type: 'ended',
      id: `ended:${previous.liveEventId || prior.id || account.accountId}:${endedAt}`,
      title: prior.title || `${account.username || account.displayName || 'Creator'} stream ended`,
      url: prior.url || account.profileUrl || account.url || '',
      thumbnail: currentVod?.thumbnail || prior.thumbnail || null,
      category: prior.category || currentVod?.category || null,
      startedAt,
      endedAt,
      durationSeconds: durationToSeconds(currentVod?.durationSeconds ?? currentVod?.duration) || secondsBetween(startedAt, endedAt),
      vod: currentVod,
    });
  }

  for (const item of contentItems) {
    if (!item?.type || !item?.id) continue;
    if (endedVodId && item.type === 'vod' && String(item.id) === endedVodId) continue;
    if (item.type === 'live' || item.type === 'ended') continue;
    if (!enabledAlert(account, item.type)) continue;
    events.push(item);
  }
  return events;
}

function eventKey(event) {
  return `${event.type}:${event.id}`;
}

function accountChannelOverride(account, type) {
  return account.alertChannels?.[type] || account.alertChannelId || null;
}

function alertChannelId(config, account, type) {
  return accountChannelOverride(account, type)
    || config.alertChannels?.[type]
    || config.platformChannels?.[account.platform]
    || config.alertsChannelId
    || null;
}

function mentionFor(account) {
  if (account.mentionMode === 'everyone') return '@everyone';
  if (account.mentionMode === 'here') return '@here';
  if (account.mentionMode === 'role' && account.mentionRoleId) return `<@&${account.mentionRoleId}>`;
  return '';
}

function durationToSeconds(value) {
  if (Number.isFinite(Number(value))) return Number(value);
  const match = String(value || '').match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
  if (!match) return null;
  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
}

function humanDuration(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return '';
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = Math.floor(value % 60);
  return [hours ? `${hours}h` : '', minutes ? `${minutes}m` : '', !hours && secs ? `${secs}s` : ''].filter(Boolean).join(' ');
}

function discordTimestamp(value, style = 'R') {
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms) || ms < Date.UTC(2020, 0, 1) || ms > Date.now() + 86400000) return '';
  return `<t:${Math.floor(ms / 1000)}:${style}>`;
}

function buildLiveFields({ account, event, vars, liveStatus, durationText, started, ended }) {
  const fields = [];
  const platform = String(account?.platform || '').toLowerCase();
  const offline = liveStatus === 'OFFLINE';
  if (platform !== 'tiktok' && vars.game) fields.push({ name: '🎮 Game', value: vars.game, inline: true });
  if (platform === 'kick') fields.push({ name: '🟢 Kick', value: vars.kickUsername ? `@${vars.kickUsername}` : (vars.creator || 'Kick'), inline: true });
  else if (platform === 'twitch') fields.push({ name: '🟣 Twitch', value: vars.username ? `@${vars.username}` : (vars.creator || 'Twitch'), inline: true });
  else if (platform === 'youtube') fields.push({ name: '🔴 YouTube', value: vars.username ? `@${vars.username}` : (vars.creator || 'YouTube'), inline: true });
  else if (platform === 'tiktok') fields.push({ name: '⚫ TikTok', value: vars.username ? `@${vars.username}` : 'TikTok LIVE', inline: true });
  else if (platform === 'facebook') fields.push({ name: '🔵 Facebook', value: vars.username ? `@${vars.username}` : (vars.creator || 'Facebook'), inline: true });
  else if (platform === 'instagram') fields.push({ name: '🟠 Instagram', value: vars.username ? `@${vars.username}` : (vars.creator || 'Instagram'), inline: true });
  else if (platform === 'x') fields.push({ name: '⚪ X', value: vars.username ? `@${vars.username}` : (vars.creator || 'X'), inline: true });
  if (offline) {
    const peak = Number(account?.state?.peakViewers || vars.peakViewers || event?.viewerCount || 0);
    if (peak > 0) fields.push({ name: '📈 Peak Viewers', value: intText(peak), inline: true });
  } else if (vars.viewers) fields.push({ name: '👥 Viewers', value: vars.viewers, inline: true });
  if (started) fields.push({ name: '🕐 Started', value: started, inline: true });
  if (durationText) fields.push({ name: offline ? '⏱️ Streamed For' : '⏱️ Live For', value: durationText, inline: true });
  if (offline) {
    if (ended) fields.push({ name: '⚫ Ended', value: ended, inline: true });
  } else if (event?.language) fields.push({ name: '🌐 Language', value: clean(String(event.language).toUpperCase(), 100), inline: true });
  if (!offline && event?.hasMatureContent === true) fields.push({ name: '🔞 Mature', value: 'Yes', inline: true });
  return fields;
}

function eventVars(account, event, creator, options = {}) {
  const username = clean(event.kickUsername || account.username || account.normalizedUsername || account.externalId, 100).replace(/^@/, '');
  const creatorName = creator?.displayName || account.displayName || username || 'Creator';
  const title = clean(event.title || `${creatorName} has a new ${event.type}`, 256);
  const url = clean(event.url || account.profileUrl || account.url, 1000);
  const game = clean(event.category || event.game || '', 200);
  const viewers = options.includeViewerCount === false || !Number.isFinite(Number(event.viewerCount)) || Number(event.viewerCount) <= 0 ? '' : intText(event.viewerCount);
  const durationSeconds = Number.isFinite(Number(event.durationSeconds)) ? Number(event.durationSeconds) : secondsBetween(event.startedAt, event.endedAt || new Date().toISOString());
  const duration = options.includeLiveDuration === false ? '' : humanDuration(durationSeconds);
  return {
    creator: creatorName,
    username,
    platform: PLATFORM[account.platform]?.label || account.platform,
    platformIcon: PLATFORM[account.platform]?.icon || '🔔',
    type: event.type,
    title,
    url,
    game,
    category: game,
    viewers,
    peakViewers: intText(account.state?.peakViewers || event.peakViewers || event.viewerCount || 0),
    duration,
    started: discordTimestamp(event.startedAt),
    ended: discordTimestamp(event.endedAt),
    published: discordTimestamp(event.publishedAt),
    kickUsername: String(account.platform || '').toLowerCase() === 'kick' ? username : '',
  };
}

function buildEmbed(account, event, template, creator, settings = {}, options = {}) {
  const vars = eventVars(account, event, creator, settings);
  const platform = PLATFORM[account.platform] || { color: 0x5865F2, icon: '🔔', label: account.platform || 'Social' };
  const embed = new EmbedBuilder().setColor(event.type === 'ended' ? 0x747F8D : platform.color);
  const liveStatus = event.type === 'ended' ? 'OFFLINE' : event.type === 'live' ? 'LIVE' : '';
  const creatorName = vars.creator || vars.username || 'Creator';
  const authorIcon = clean(creator?.avatar || account.avatar || event.avatar || '', 1000);
  const author = { name: creatorName };
  if (/^https?:\/\//i.test(authorIcon)) author.iconURL = authorIcon;
  if (/^https?:\/\//i.test(vars.url)) author.url = vars.url;
  embed.setAuthor(author);

  if (liveStatus) {
    const headline = liveStatus === 'LIVE' ? '🔴 **LIVE NOW**' : '⚫ **STREAM ENDED**';
    const actionLines = [];
    if (liveStatus === 'LIVE' && vars.url) actionLines.push(`▶️ **[Watch Live](${vars.url})** · 🔴 **LIVE**`);
    if (liveStatus === 'OFFLINE' && event.vod?.url) actionLines.push(`▶️ **[Watch VOD](${event.vod.url})** · ⚫ **OFFLINE**`);
    embed.setDescription(`${headline}\n${stripTrailingDivider(vars.title)}${embedActionBlock(actionLines)}`);
    embed.addFields(buildLiveFields({ account, event, vars, liveStatus, durationText: vars.duration, started: vars.started, ended: vars.ended }));
    if (event.vod?.url) embed.addFields({ name: '📼 VOD', value: `[Watch the recording](${event.vod.url})`, inline: false });
  } else {
    const renderedTitle = render(template.title, vars) || `${platform.icon} ${platform.label}`;
    embed.setTitle(renderedTitle.slice(0, 256));
    const description = render(template.description, vars) || vars.title;
    embed.setDescription(description.slice(0, 4096));
  }

  const thumbnail = liveStatus === 'LIVE' ? cacheBustedImageUrl(event.thumbnail) : clean(event.thumbnail, 1000);
  if (thumbnail && /^https?:\/\//i.test(thumbnail)) embed.setImage(thumbnail);
  if (!liveStatus && vars.url && /^https?:\/\//i.test(vars.url)) embed.setURL(vars.url);
  embed.setFooter({ text: `Goliath Social Studio • ${platform.label} • ${liveStatus || event.type.toUpperCase()}` });
  embed.setTimestamp(new Date(event.endedAt || event.publishedAt || event.startedAt || Date.now()));
  return embed;
}

async function sendAlert(client, guildId, config, account, event, options = {}) {
  const channelId = alertChannelId(config, account, event.type);
  if (!channelId) throw new Error(`No alert channel configured for ${account.platform}/${event.type}.`);
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId);
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId);
  if (!channel?.isTextBased?.()) throw new Error('Configured alert channel is not text based.');
  const creator = creatorFor(config, account.accountId);
  const template = templateFor(config, event.type);
  const embed = buildEmbed(account, event, template, creator, config.settings);
  const content = mentionFor(account);
  const payload = { content: content || null, embeds: [embed] };
  const previewAttachment = await fetchKickPreviewAttachment(account, event);
  if (previewAttachment) {
    embed.setImage(`attachment://${previewAttachment.name}`);
    payload.files = [previewAttachment];
  }
  const message = await channel.send(payload);
  return { channelId, messageId: message.id };
}

async function updateLiveAlert(client, guildId, config, account, event, previous) {
  const channelId = previous.lastLiveMessageChannelId || previous.lastAlertChannelId || alertChannelId(config, account, 'live');
  const messageId = previous.lastLiveMessageId || previous.lastAlertMessageId;
  if (!channelId || !messageId) return null;

  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId);
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId);
  if (!channel?.isTextBased?.()) return null;
  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message) return null;

  const creator = creatorFor(config, account.accountId);
  const template = templateFor(config, 'live');
  const embed = buildEmbed(account, event, template, creator, config.settings);
  const payload = { embeds: [embed] };
  const previewAttachment = await fetchKickPreviewAttachment(account, event);
  if (previewAttachment) {
    embed.setImage(`attachment://${previewAttachment.name}`);
    payload.files = [previewAttachment];
    payload.attachments = [];
  }
  await message.edit(payload);
  return { channelId, messageId };
}

async function updateEndedAlert(client, guildId, config, account, event, previous) {
  const channelId = previous.lastLiveMessageChannelId || previous.lastAlertChannelId || alertChannelId(config, account, 'ended');
  const messageId = previous.lastLiveMessageId || previous.lastAlertMessageId;
  if (!channelId || !messageId) return null;
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId);
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId);
  if (!channel?.isTextBased?.()) return null;
  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message) return null;
  const creator = creatorFor(config, account.accountId);
  const template = templateFor(config, 'ended');
  const embed = buildEmbed(account, event, template, creator, config.settings);
  await message.edit({ content: null, embeds: [embed], attachments: [] });
  return { channelId, messageId };
}

async function deleteEndedAlert(client, guildId, previous) {
  const channelId = previous.lastLiveMessageChannelId || previous.lastAlertChannelId;
  const messageId = previous.lastLiveMessageId || previous.lastAlertMessageId;
  if (!channelId || !messageId) return false;
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId);
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId);
  if (!channel?.isTextBased?.()) return false;
  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message) return false;
  await message.delete();
  return true;
}

function livePostInWindow(config, creator, windowMs = 2 * 60 * 60 * 1000) {
  const accountIds = new Set(creator?.accountIds || []);
  const cutoff = Date.now() - windowMs;
  return [...(config.history || [])].reverse().find((item) => {
    if (!accountIds.has(item.accountId)) return false;
    if (!['alert_sent', 'alert_updated'].includes(item.status) || item.alertType !== 'live') return false;
    const created = new Date(item.createdAt || 0).getTime();
    return Number.isFinite(created) && created >= cutoff;
  }) || null;
}

function liveAccountsForCreator(config, creator) {
  return (creator?.accountIds || [])
    .map((id) => config.accounts?.[id])
    .filter((account) => account && account.enabled !== false && account.state?.isLive === true && account.state?.lastLiveEvent)
    .sort((a, b) => new Date(b.state?.lastCheckedAt || 0) - new Date(a.state?.lastCheckedAt || 0));
}

function liveMessageUpdateDue(account, previous, checked, settings = {}) {
  if (
    checked.isLive !== true ||
    previous.isLive !== true ||
    !checked.event ||
    settings.liveMessageRefreshEnabled === false
  ) return false;

  const rawLast =
    previous.lastLiveMessageUpdatedAt ||
    previous.lastLiveMessageUpdateAt ||
    0;

  const numericLast = Number(rawLast);
  const parsedLast = Number.isFinite(numericLast)
    ? numericLast
    : Date.parse(String(rawLast));

  if (!Number.isFinite(parsedLast)) return true;

  const requested = Number(settings.liveMessageRefreshMs);
  const refreshMs = Number.isFinite(requested) && requested >= 60 * 1000
    ? requested
    : LIVE_MESSAGE_REFRESH_MS;

  return Date.now() - parsedLast >= refreshMs;
}

async function forcePostCreatorLive(client, guildId, creatorId, options = {}) {
  const config = configFor(guildId, options.guildConfig);
  const creator = config.creators?.[creatorId];
  if (!creator) throw new Error('Select a creator profile first.');
  if (creator.enabled === false) throw new Error('This creator profile is paused.');
  const recent = options.bypassCooldown === true ? null : livePostInWindow(config, creator);
  if (recent) throw new Error('A LIVE post was already sent for this creator in the last 2 hours.');
  const liveAccounts = liveAccountsForCreator(config, creator);
  if (!liveAccounts.length) throw new Error('No checked LIVE account is available for this creator yet.');

  const sent = [];
  for (const account of liveAccounts) {
    const event = { ...account.state.lastLiveEvent, type: 'live' };
    const delivered = await sendAlert(client, guildId, config, account, event, options);
    sent.push({ accountId: account.accountId, platform: account.platform, ...delivered });
  }
  return { creatorId, sent };
}

async function checkGuildAccounts(client, guildId, options = {}) {
  const config = configFor(guildId, options.guildConfig);
  if (!config.enabled && !options.force) return { skipped: true, reason: 'disabled' };
  const quiet = quietHoursActive(config.settings);
  const monitorUpdates = new Map();
  const duplicateMerges = new Map();
  const analyticsDelta = {};
  const historyEntries = [];
  const results = [];
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return { skipped: true, reason: 'guild_unavailable' };

  const accountIds = options.accountIds?.length ? options.accountIds : Object.keys(config.accounts);
  for (const accountId of accountIds) {
    const account = config.accounts[accountId];
    if (!account || account.enabled === false) continue;
    if (runningGuilds.has(`${guildId}:${accountId}`)) continue;
    runningGuilds.add(`${guildId}:${accountId}`);
    try {
      const previous = account.state && typeof account.state === 'object' ? { ...account.state } : {};
      const checked = await checkAccount(account);
      const state = { ...previous, lastCheckedAt: checked.checkedAt || now(), lastStatus: checked.status, lastError: checked.status === 'unavailable' || checked.status === 'configuration_required' ? checked.reason : null };
      if (checked.isLive === true) {
        state.isLive = true;
        state.liveEventId = checked.event?.id || state.liveEventId || null;
        state.liveStartedAt = checked.event?.startedAt || state.liveStartedAt || null;
        state.lastLiveEvent = checked.event || state.lastLiveEvent || null;
        const viewers = Number(checked.event?.viewerCount);
        if (Number.isFinite(viewers) && viewers >= 0) state.peakViewers = Math.max(Number(previous.peakViewers || 0), viewers);
      } else if (checked.isLive === false) {
        state.isLive = false;
        if (previous.isLive === true) state.lastLiveEndedAt = checked.checkedAt || now();
      }

      const creator = creatorFor(config, accountId);
      const duplicateIds = resolvedDuplicateIds(config, account, checked, creator);
      for (const duplicateId of duplicateIds) duplicateMerges.set(duplicateId, accountId);

      const delivered = [];
      const events = eventCandidates(account, previous, checked);
      for (const event of events) {
        const key = eventKey(event);
        if (config.settings.suppressDuplicates !== false && previous.lastAlertKey === key && event.type !== 'ended') continue;
        if (quiet && !options.manual && event.type !== 'ended') continue;

        if (event.type === 'ended' && previous.isLive === true) {
          let updated = null;
          if (config.settings.deleteEndedNotifications !== false) {
            await deleteEndedAlert(client, guildId, previous).catch(() => false);
          } else if (config.settings.editLiveNotifications !== false) {
            updated = await updateEndedAlert(client, guildId, config, account, event, previous).catch(() => null);
          }
          if (updated) delivered.push({ type: 'ended', id: event.id, ...updated });
          state.lastAlertKey = key;
          state.lastAlertAt = now();
          state.lastLiveMessageId = null;
          state.lastLiveMessageChannelId = null;
          continue;
        }

        const delivery = await sendAlert(client, guildId, config, account, event, options);
        delivered.push({ type: event.type, id: event.id, ...delivery });
        state.lastAlertKey = key;
        state.lastAlertAt = now();
        state.lastAlertMessageId = delivery.messageId;
        state.lastAlertChannelId = delivery.channelId;
        if (event.type === 'live') {
          state.lastLiveMessageId = delivery.messageId;
          state.lastLiveMessageChannelId = delivery.channelId;
          state.lastLiveMessageUpdatedAt = now();
        }
      }

      if (liveMessageUpdateDue(account, previous, checked, config.settings)) {
        const updated = config.settings.editLiveNotifications === false
          ? null
          : await updateLiveAlert(client, guildId, config, account, checked.event, previous).catch(() => null);
        if (updated) {
          state.lastLiveMessageId = updated.messageId;
          state.lastLiveMessageChannelId = updated.channelId;
          state.lastLiveMessageUpdatedAt = now();
          delivered.push({ type: 'live', id: checked.event.id, refreshed: true, ...updated });
        }
      }

      monitorUpdates.set(accountId, {
        state,
        externalId: checked.externalId || null,
        resolvedUsername: checked.resolvedUsername || null,
        profileUrl: checked.url || null,
        avatar: checked.avatar || null,
        updatedAt: now(),
      });
      results.push({ accountId, platform: account.platform, status: checked.status, isLive: checked.isLive, live: checked.event || null, delivered });
      analyticsDelta.checks = Number(analyticsDelta.checks || 0) + 1;
      if (delivered.length) analyticsDelta.alerts = Number(analyticsDelta.alerts || 0) + delivered.length;
      for (const item of delivered) {
        historyEntries.push({ id: `history_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, createdAt: now(), accountId, platform: account.platform, status: item.refreshed ? 'alert_updated' : 'alert_sent', alertType: item.type, eventId: item.id, messageId: item.messageId, channelId: item.channelId });
      }
    } catch (error) {
      analyticsDelta.errors = Number(analyticsDelta.errors || 0) + 1;
      results.push({ accountId, platform: account.platform, status: 'error', error: error?.message || String(error), delivered: [] });
    } finally {
      runningGuilds.delete(`${guildId}:${accountId}`);
    }
  }

  const saved = saveMonitorState(guildId, config, monitorUpdates, analyticsDelta, historyEntries, guild, duplicateMerges);
  return { guildId, checked: results.length, results, savedAt: saved.updatedAt || now() };
}

function startupSocialStudio(client) {
  if (timer) return timer;
  const interval = Math.max(30000, Number(process.env.SOCIAL_STUDIO_TICK_MS || 60000));
  const run = () => {
    for (const guild of client.guilds.cache.values()) {
      checkGuildAccounts(client, guild.id).catch((error) => console.error(`[Social Studio] monitor failed for guild ${guild.id}:`, error));
    }
  };
  const initial = setTimeout(run, 5000);
  initial.unref?.();
  timer = setInterval(run, interval);
  timer.unref?.();
  console.log(`✅ Social Studio monitor started (${interval}ms)`);
  return timer;
}

module.exports = {
  startupSocialStudio,
  checkGuildAccounts,
  forcePostCreatorLive,
  buildLiveFields,
};
