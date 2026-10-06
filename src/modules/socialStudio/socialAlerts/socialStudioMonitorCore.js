'use strict';

const { EmbedBuilder } = require('discord.js');
const guildManager = require('../../../core/guild/guildManager');
const { replaceVariables } = require('../../../core/guild/guildVariables');
const { deleteExpiredCreators } = require('./socialStudioStore');
const { checkAccount, providerInfo } = require('./socialStudioProviders');
const { normalizeTemplates, resolveTemplate } = require('./socialStudioTemplates');

const runningGuilds = new Set();
const LIVE_MESSAGE_REFRESH_MS = 10 * 60 * 1000;
const LIVE_MESSAGE_REFRESH_INTERVALS = new Set([600000, 900000, 1200000, 1800000, 2700000, 3600000]);
const MAX_REASONABLE_LIVE_DURATION_SECONDS = 48 * 60 * 60;
let timer = null;
const PLATFORM = {
  twitch: { label: 'Twitch', icon: '🟣', color: 0x9146FF }, youtube: { label: 'YouTube', icon: '🔴', color: 0xFF0000 },
  tiktok: { label: 'TikTok', icon: '⚫', color: 0x2F3136 }, kick: { label: 'Kick', icon: '🟢', color: 0x53FC18 },
  facebook: { label: 'Facebook', icon: '🔵', color: 0x1877F2 }, instagram: { label: 'Instagram', icon: '🟠', color: 0xE1306C }, x: { label: 'X', icon: '⚪', color: 0x000000 },
};
const EMBED_WIDTH_DIVIDER = '\u2500'.repeat(28);
const now = () => new Date().toISOString();
const clean = (value, max = 2000) => String(value ?? '').trim().slice(0, max);
const intText = (value) => Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-GB') : '';

function validTimeZone(value) { const timezone = String(value || '').trim(); if (!timezone) return false; try { new Intl.DateTimeFormat('en-GB', { timeZone: timezone }).format(new Date()); return true; } catch { return false; } }
function quietHoursActive(settings, date = new Date()) {
  const quiet = settings?.quietHours && typeof settings.quietHours === 'object' ? settings.quietHours : null; if (!quiet || quiet.enabled !== true) return false;
  const timezone = String(quiet.timezone || '').trim(); if (!validTimeZone(timezone)) return false;
  const parseTime = (value) => { const match = String(value || '').trim().match(/^(\d{2}):(\d{2})$/); if (!match) return null; const h = Number(match[1]), m = Number(match[2]); return h >= 0 && h <= 23 && m >= 0 && m <= 59 ? h * 60 + m : null; };
  const start = parseTime(quiet.start), end = parseTime(quiet.end); if (start === null || end === null || start === end) return false;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value), minute = Number(parts.find((part) => part.type === 'minute')?.value); if (!Number.isInteger(hour) || !Number.isInteger(minute)) return false;
  const current = hour * 60 + minute; return start < end ? current >= start && current < end : current >= start || current < end;
}
function stripTrailingDivider(value) { return String(value || '').replace(/(?:\n\s*)+(?:[\u2500\-_]{8,}\s*)+$/u, '').trim(); }
function cacheBustedImageUrl(value) { const raw = clean(value, 1000); if (!/^https?:\/\//i.test(raw)) return ''; return `${raw}${raw.includes('?') ? '&' : '?'}snapshot=${Date.now()}`; }
function embedActionBlock(lines = []) { const actions = lines.map((line) => clean(line, 300)).filter(Boolean); return actions.length ? `\n\n${actions.join('\n')}\n${EMBED_WIDTH_DIVIDER}` : ''; }
function configFor(guildId, guildConfig = null) {
  const guild = guildConfig && typeof guildConfig === 'object' ? guildConfig : guildManager.reloadGuild(guildId); const social = guild?.modules?.social && typeof guild.modules.social === 'object' ? guild.modules.social : {};
  return { ...social, enabled: guildManager.isModuleEnabled(guildId, 'social'), alertsChannelId: social.alertsChannelId || null, alertChannels: social.alertChannels && typeof social.alertChannels === 'object' ? social.alertChannels : {}, platformChannels: social.platformChannels && typeof social.platformChannels === 'object' ? social.platformChannels : {}, accounts: social.accounts && typeof social.accounts === 'object' ? social.accounts : {}, creators: social.creators && typeof social.creators === 'object' ? social.creators : {}, templates: normalizeTemplates(social.templates), settings: social.settings && typeof social.settings === 'object' ? social.settings : {}, history: Array.isArray(social.history) ? social.history : [], analytics: social.analytics && typeof social.analytics === 'object' ? social.analytics : {} };
}
function saveMonitorState(guildId, config, monitorUpdates, analyticsDelta, historyEntries, guild = null, duplicateMerges = new Map()) {
  const updated = guildManager.updateGuildSection(guildId, 'social', (latest = {}) => {
    const latestAccounts = latest.accounts && typeof latest.accounts === 'object' ? latest.accounts : {}, accounts = { ...latestAccounts };
    const latestCreators = latest.creators && typeof latest.creators === 'object' ? latest.creators : {};
    const creators = Object.fromEntries(Object.entries(latestCreators).map(([id, creator]) => [id, { ...creator, accountIds: Array.isArray(creator?.accountIds) ? [...creator.accountIds] : [] }]));
    for (const [accountId, update] of monitorUpdates.entries()) { const current = accounts[accountId]; if (!current || typeof current !== 'object') continue; accounts[accountId] = { ...current, state: update.state, ...(update.externalId ? { externalId: update.externalId } : {}), ...(update.resolvedUsername ? { username: update.resolvedUsername, normalizedUsername: update.resolvedUsername.toLowerCase() } : {}), ...(update.profileUrl ? { profileUrl: update.profileUrl } : {}), ...(update.avatar ? { avatar: update.avatar } : {}), updatedAt: update.updatedAt }; }
    for (const [duplicateId, survivorId] of duplicateMerges.entries()) { if (duplicateId === survivorId) continue; const duplicate = accounts[duplicateId], survivor = accounts[survivorId]; if (!duplicate || !survivor) continue; const alertTypes = [...new Set([...(Array.isArray(survivor.alertTypes) ? survivor.alertTypes : []), ...(Array.isArray(duplicate.alertTypes) ? duplicate.alertTypes : [])])]; const mergedAliases = [...new Set([
      ...(Array.isArray(survivor.identityAliases) ? survivor.identityAliases : []),
      ...(Array.isArray(duplicate.identityAliases) ? duplicate.identityAliases : []),
      duplicate.canonicalIdentity,
      duplicate.externalId,
      duplicate.normalizedUsername,
      duplicate.username,
    ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean))]
      .filter((value) => value !== String(survivor.canonicalIdentity || '').trim().toLowerCase())
      .slice(-25);
    accounts[survivorId] = {
      ...survivor,
      ...(alertTypes.length ? { alertTypes } : {}),
      identityAliases: mergedAliases,
      alertChannelId: survivor.alertChannelId || duplicate.alertChannelId || null,
      alertChannels: { ...(duplicate.alertChannels || {}), ...(survivor.alertChannels || {}) },
      mentionMode: survivor.mentionMode && survivor.mentionMode !== 'none' ? survivor.mentionMode : duplicate.mentionMode || survivor.mentionMode || 'none',
      mentionRoleId: survivor.mentionRoleId || duplicate.mentionRoleId || null,
      createdAt: survivor.createdAt || duplicate.createdAt,
      updatedAt: now()
    }; delete accounts[duplicateId]; for (const creator of Object.values(creators)) creator.accountIds = [...new Set((creator.accountIds || []).map((id) => id === duplicateId ? survivorId : id))]; }
    const latestAnalytics = latest.analytics && typeof latest.analytics === 'object' ? latest.analytics : {}, analytics = { ...latestAnalytics }; for (const [key, amount] of Object.entries(analyticsDelta || {})) if (Number.isFinite(Number(amount)) && Number(amount) !== 0) analytics[key] = Number(analytics[key] || 0) + Number(amount);
    const history = [...(Array.isArray(latest.history) ? latest.history : []), ...(historyEntries || [])].slice(-1000); return { ...latest, accounts, creators, analytics, history, updatedAt: now() };
  }, {}, guild || { guildId }); return { ...updated, enabled: guildManager.isModuleEnabled(guildId, 'social') };
}
function creatorFor(config, accountId) { return Object.values(config.creators).find((creator) => Array.isArray(creator.accountIds) && creator.accountIds.includes(accountId)) || null; }
function identityToken(value) { return String(value || '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function validTikTokHandle(value) { return /^[a-z0-9._]{2,24}$/i.test(String(value || '').replace(/^@+/, '')); }
function resolvedDuplicateIds(config, account, checked, creator) {
  if (!creator || !account?.accountId) return []; const platform = String(account.platform || '').toLowerCase(), externalId = clean(checked.externalId || account.externalId), username = clean(checked.resolvedUsername || account.username).replace(/^@+/, '').toLowerCase(); if (!externalId && !username) return [];
  const resolvedToken = identityToken(username), duplicateIds = []; for (const otherId of creator.accountIds || []) { if (otherId === account.accountId) continue; const other = config.accounts[otherId]; if (!other || String(other.platform || '').toLowerCase() !== platform) continue; const otherExternalId = clean(other.externalId), otherUsername = clean(other.normalizedUsername || other.username).replace(/^@+/, '').toLowerCase(); if (externalId && otherExternalId && externalId === otherExternalId) { duplicateIds.push(otherId); continue; } if (username && otherUsername && username === otherUsername) { duplicateIds.push(otherId); continue; } if (platform === 'tiktok' && externalId && !otherExternalId && !validTikTokHandle(otherUsername)) { const aliasToken = identityToken(otherUsername || other.sourceInput); if (aliasToken && resolvedToken.startsWith(aliasToken) && /^\d{2,6}$/.test(resolvedToken.slice(aliasToken.length))) duplicateIds.push(otherId); } } return [...new Set(duplicateIds)];
}
function templateFor(config, type) { return resolveTemplate(config.templates, type); }
function render(value, vars) { return replaceVariables(String(value || ''), vars); }
function enabledAlert(account, type) { const rawSupported = providerInfo(account.platform).supportedAlertTypes || []; const supported = rawSupported.includes('live') ? [...new Set([...rawSupported, 'ended'])] : rawSupported; const configured = Array.isArray(account.alertTypes) ? account.alertTypes : supported; return supported.includes(type) && configured.includes(type); }
function secondsBetween(start, end) { const a = new Date(start).getTime(), b = new Date(end).getTime(); return Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.floor((b - a) / 1000) : null; }
function durationToSeconds(value) { if (Number.isFinite(Number(value))) return Number(value); const match = String(value || '').match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i); return match ? Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0) : null; }
function vodMatchesEndedStream(item, startedAt, endedAt) { if (!item || item.type !== 'vod' || !item.url) return false; const publishedMs = new Date(item.publishedAt || item.createdAt || 0).getTime(), startedMs = new Date(startedAt || 0).getTime(), endedMs = new Date(endedAt || 0).getTime(); if (!Number.isFinite(publishedMs) || !Number.isFinite(startedMs) || !Number.isFinite(endedMs)) return false; const margin = 15 * 60 * 1000; return publishedMs >= startedMs - margin && publishedMs <= endedMs + margin; }
function eventKey(event) { return `${event.type}:${event.id}`; }
function hasTrackedLiveMessage(state = {}) { return Boolean((state.lastLiveMessageId || state.lastAlertMessageId) && (state.lastLiveMessageChannelId || state.lastAlertMessageChannelId || state.lastAlertChannelId)); }
function deliveredKeys(state = {}) { return Array.isArray(state.deliveredEventKeys) ? state.deliveredEventKeys.map(String).filter(Boolean) : []; }
function hasDelivered(state, key) { return deliveredKeys(state).includes(String(key)); }
function rememberDelivered(state, key) { state.deliveredEventKeys = [...new Set([...deliveredKeys(state), String(key)])].slice(-100); }
function eventCandidates(account, previous, checked) {
  const events = [], contentItems = Array.isArray(checked.contentItems) && checked.contentItems.length ? checked.contentItems : checked.latestContent ? [checked.latestContent] : []; let endedVodId = null;
  if (checked.isLive === true && checked.event) { const key = eventKey(checked.event); if (previous.isLive !== true || previous.lastAlertKey !== key || !hasTrackedLiveMessage(previous)) events.push(checked.event); }
  if (enabledAlert(account, 'ended') && previous.pendingEndedEvent && typeof previous.pendingEndedEvent === 'object') { const pending = previous.pendingEndedEvent; endedVodId = pending.vod?.id ? String(pending.vod.id) : null; events.push(pending); }
  if (checked.isLive === false && previous.isLive === true && enabledAlert(account, 'ended')) { const prior = previous.lastLiveEvent && typeof previous.lastLiveEvent === 'object' ? previous.lastLiveEvent : {}, endedAt = checked.checkedAt || now(), startedAt = previous.liveStartedAt || prior.startedAt || null, currentVod = contentItems.find((item) => vodMatchesEndedStream(item, startedAt, endedAt)) || null; endedVodId = currentVod?.id ? String(currentVod.id) : null; events.push({ type: 'ended', id: `ended:${previous.liveEventId || prior.id || account.accountId}`, title: prior.title || `${account.username || account.displayName || 'Creator'} stream ended`, url: prior.url || account.profileUrl || account.url || '', thumbnail: currentVod?.thumbnail || prior.thumbnail || null, category: prior.category || currentVod?.category || null, startedAt, endedAt, durationSeconds: durationToSeconds(currentVod?.durationSeconds ?? currentVod?.duration) || secondsBetween(startedAt, endedAt), vod: currentVod }); }
  for (const item of contentItems) { if (!item?.type || !item?.id || (endedVodId && item.type === 'vod' && String(item.id) === endedVodId) || item.type === 'live' || item.type === 'ended' || !enabledAlert(account, item.type)) continue; events.push(item); } return events;
}
function accountChannelOverride(account, type) { return account.alertChannels?.[type] || account.alertChannelId || null; }
function alertChannelId(config, account, type) { return accountChannelOverride(account, type) || config.alertChannels?.[type] || config.platformChannels?.[account.platform] || config.alertsChannelId || null; }
function mentionConfig(account, config = {}, eventType = '') {
  const live = String(eventType || '').toLowerCase() === 'live';
  const mode = String(live ? (config.notificationMentionMode || 'none') : (account.mentionMode || config.notificationMentionMode || 'none')).toLowerCase();
  const rawRoleId = String(live ? (config.notificationRoleId || '') : (account.mentionRoleId || config.notificationRoleId || '')).trim();
  const roleId = /^\d{17,20}$/.test(rawRoleId) ? rawRoleId : null;
  return { mode: ['none', 'everyone', 'here', 'role'].includes(mode) ? mode : 'none', roleId };
}
async function resolveMention(guild, account, config = {}, suppress = false, eventType = '') {
  if (suppress) return { content: '', allowedMentions: { parse: [] } };
  const { mode, roleId } = mentionConfig(account, config, eventType);
  if (mode === 'everyone') return { content: '@everyone', allowedMentions: { parse: ['everyone'] } };
  if (mode === 'here') return { content: '@here', allowedMentions: { parse: ['everyone'] } };
  if (mode === 'role' && roleId) {
    const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
    if (role) return { content: `<@&${role.id}>`, allowedMentions: { parse: [], roles: [role.id] } };
  }
  return { content: '', allowedMentions: { parse: [] } };
}
function permanentDeliveryError(message, code = 'SOCIAL_DELIVERY_CONFIGURATION') {
  const error = new Error(message);
  error.code = code;
  error.permanentDeliveryFailure = true;
  return error;
}
function isPermanentDeliveryError(error) {
  return error?.permanentDeliveryFailure === true;
}
function humanDuration(seconds) { const value = Number(seconds); if (!Number.isFinite(value) || value < 0) return ''; const hours = Math.floor(value / 3600), minutes = Math.floor((value % 3600) / 60), secs = Math.floor(value % 60); return [hours ? `${hours}h` : '', minutes ? `${minutes}m` : '', !hours && secs ? `${secs}s` : ''].filter(Boolean).join(' '); }
function saneLiveDurationSeconds(event) { const supplied = Number(event?.durationSeconds), calculated = secondsBetween(event?.startedAt, event?.endedAt || new Date().toISOString()); if (Number.isFinite(supplied) && supplied >= 0 && supplied <= MAX_REASONABLE_LIVE_DURATION_SECONDS) return supplied; if (Number.isFinite(calculated) && calculated >= 0 && calculated <= MAX_REASONABLE_LIVE_DURATION_SECONDS) return calculated; return null; }
function discordTimestamp(value, style = 'R') { const ms = new Date(value).getTime(); return Number.isFinite(ms) && ms >= Date.UTC(2020, 0, 1) && ms <= Date.now() + 86400000 ? `<t:${Math.floor(ms / 1000)}:${style}>` : ''; }
function buildLiveFields({ account, event, vars, liveStatus, durationText, started, ended }) {
  const fields = [], platform = String(account?.platform || '').toLowerCase(), offline = liveStatus === 'OFFLINE';
  const labels = { kick: ['🟢','Kick'], twitch:['🟣','Twitch'], youtube:['🔴','YouTube'], tiktok:['⚫','TikTok'], facebook:['🔵','Facebook'], instagram:['🟠','Instagram'], x:['⚪','X'] };
  const meta = labels[platform];
  const platformField = meta ? { name: `${meta[0]} ${meta[1]}`, value: vars.username ? `@${vars.username}` : platform === 'tiktok' && !offline ? 'TikTok LIVE' : (vars.creator || meta[1]), inline: true } : null;

  if (offline) {
    // Keep the ENDED presentation aligned as two deliberate three-column rows:
    // Game / Platform / Started, then Language / Peak Viewers / Ended.
    if (platform !== 'tiktok' && vars.game) fields.push({ name: '🎮 Game', value: vars.game, inline: true });
    if (platformField) fields.push(platformField);
    if (started) fields.push({ name:'🕐 Started', value:started, inline:true });

    if (event?.language) fields.push({ name:'🌐 Language', value:clean(String(event.language).toUpperCase(),100), inline:true });
    const peak = Number(account?.state?.peakViewers || vars.peakViewers || event?.viewerCount || 0);
    if (peak > 0) fields.push({ name:'📈 Peak Viewers', value:intText(peak), inline:true });
    if (ended) fields.push({ name:'⚫ Ended', value:ended, inline:true });
    return fields;
  }

  if (platform !== 'tiktok' && vars.game) fields.push({ name: '🎮 Game', value: vars.game, inline: true });
  if (platformField) fields.push(platformField);
  if (vars.viewers) fields.push({ name:'👥 Viewers', value:vars.viewers, inline:true });
  if (started) fields.push({ name:'🕐 Started', value:started, inline:true });
  if (durationText) fields.push({ name:'⏱️ Live For', value:durationText, inline:true });
  if (event?.language) fields.push({ name:'🌐 Language', value:clean(String(event.language).toUpperCase(),100), inline:true });
  if (event?.hasMatureContent === true) fields.push({ name:'🔞 Mature', value:'Yes', inline:true });
  return fields;
}
function eventVars(account, event, creator, options = {}) { const username = clean(event.kickUsername || account.username || account.normalizedUsername || account.externalId, 100).replace(/^@/, ''), creatorName = creator?.displayName || account.displayName || username || 'Creator', title = clean(event.title || `${creatorName} has a new ${event.type}`, 256), url = clean(event.url || account.profileUrl || account.url, 1000), game = clean(event.category || event.game || '', 200), viewers = options.includeViewerCount === false || !Number.isFinite(Number(event.viewerCount)) || Number(event.viewerCount) <= 0 ? '' : intText(event.viewerCount), durationSeconds = event.type === 'live' ? saneLiveDurationSeconds(event) : (Number.isFinite(Number(event.durationSeconds)) ? Number(event.durationSeconds) : secondsBetween(event.startedAt, event.endedAt || new Date().toISOString())); return { creator:creatorName, username, platform:PLATFORM[account.platform]?.label || account.platform, platformIcon:PLATFORM[account.platform]?.icon || '🔔', type:event.type, title, url, game, category:game, viewers, peakViewers:intText(account.state?.peakViewers || event.peakViewers || event.viewerCount || 0), duration:options.includeLiveDuration === false ? '' : humanDuration(durationSeconds), started:discordTimestamp(event.startedAt), ended:discordTimestamp(event.endedAt), published:discordTimestamp(event.publishedAt), kickUsername:String(account.platform || '').toLowerCase() === 'kick' ? username : '' }; }
function buildEmbed(account, event, template, creator, settings = {}) { const vars = eventVars(account,event,creator,settings), platformKey=String(account.platform||'').toLowerCase(), platform = PLATFORM[account.platform] || { color:0x5865F2,icon:'🔔',label:account.platform || 'Social' }, embed = new EmbedBuilder().setColor(event.type === 'ended' ? 0x747F8D : platform.color), liveStatus = event.type === 'ended' ? 'OFFLINE' : event.type === 'live' ? ((event.paused===true||String(event.liveStatus||'').toUpperCase()==='PAUSED')?'PAUSED':'LIVE') : '', authorIcon = clean(creator?.avatar || creator?.avatarUrl || creator?.profileImage || creator?.profileImageUrl || account.avatar || account.avatarUrl || account.profileImage || account.profileImageUrl || event.avatar || event.avatarUrl || event.profileImage || event.profileImageUrl || '',1000), profileUrl = clean(account.profileUrl || account.url || event.profileUrl || vars.url || '',1000), author = { name:vars.creator || vars.username || 'Creator' }; if (/^https?:\/\//i.test(authorIcon)) author.iconURL=authorIcon; if (/^https?:\/\//i.test(profileUrl)) author.url=profileUrl; embed.setAuthor(author); if (/^https?:\/\//i.test(authorIcon)) embed.setThumbnail(authorIcon); if (liveStatus) { const headline=liveStatus==='LIVE'?'🔴 **LIVE NOW**':liveStatus==='PAUSED'?'⏸️ **LIVE PAUSED**':'⚫ **STREAM ENDED**', actions=[]; const standardLiveAction=(liveStatus==='LIVE'||liveStatus==='PAUSED')&&platformKey!=='tiktok'; if(standardLiveAction&&vars.url) actions.push(`▶️ **[Watch Live](${vars.url})**\u2003\u2003\u2003\u2003\u2003\u2003${liveStatus==='PAUSED'?'⏸️ **PAUSED**':'🔴 **LIVE**'}`); else if((liveStatus==='LIVE'||liveStatus==='PAUSED')&&vars.url) actions.push(`▶️ **[Watch Live](${vars.url})**${liveStatus==='PAUSED'?' · ⏸️ **PAUSED**':' · 🔴 **LIVE**'}`); if(liveStatus==='OFFLINE'&&event.vod?.url) actions.push(`▶️ **[Watch VOD](${event.vod.url})**\u2003\u2003\u2003\u2003\u2003\u2003⚫ **OFFLINE**`); embed.setDescription(`${headline}\n${stripTrailingDivider(vars.title)}${embedActionBlock(actions)}`); embed.addFields(buildLiveFields({account,event,vars,liveStatus,durationText:vars.duration,started:vars.started,ended:vars.ended}));
    if ((liveStatus === 'LIVE' || liveStatus === 'PAUSED') && creator?.showProfileInLive !== false) {
      const safeProfileText = (value, max) => clean(String(value || '').replace(/<@!?&?\d+>/g, '@mention').replace(/@(everyone|here)/gi, '@$1'), max);
      const group = safeProfileText(creator?.group, 200);
      const tags = Array.isArray(creator?.tags) ? safeProfileText(creator.tags.join(', '), 700) : '';
      const notes = safeProfileText(creator?.notes, 900);
      if (group) embed.addFields({ name: '\u200B', value: `**🤼‍♂️** ${group}`, inline: false });
      if (tags) embed.addFields({ name: '\u200B', value: `**🏷️** ${tags}`, inline: false });
      if (notes) embed.addFields({ name: '\u200B', value: `💬 *${notes.replace(/([*_~\\])/g, '\\$1')}*`, inline: false });
    } if(event.vod?.url) embed.addFields({name:'📼 VOD',value:`[Watch the recording](${event.vod.url})`,inline:false}); } else { embed.setTitle((render(template.title,vars)||`${platform.icon} ${platform.label}`).slice(0,256)); const description=stripTrailingDivider(render(template.description,vars)||vars.title), actionLabel=clean(template.buttonLabel||'View Post',80), actions=vars.url?[`▶️ **[${actionLabel}](${vars.url})**`]:[]; embed.setDescription(`${description}${embedActionBlock(actions)}`.slice(0,4096)); } const liveImage=liveStatus==='LIVE'||liveStatus==='PAUSED', thumbnail=liveImage?(platformKey==='tiktok'?clean(event.thumbnail,1000):cacheBustedImageUrl(event.thumbnail)):clean(event.thumbnail,1000); if(thumbnail&&/^https?:\/\//i.test(thumbnail)) embed.setImage(thumbnail); if(!liveStatus&&vars.url&&/^https?:\/\//i.test(vars.url)) embed.setURL(vars.url); embed.setFooter({text:`Goliath Social Studio • ${platform.label} • ${liveStatus || event.type.toUpperCase()}`}); embed.setTimestamp(new Date(event.endedAt||event.publishedAt||event.startedAt||Date.now())); return embed; }
async function sendAlert(client,guildId,config,account,event,options={}) {
  const channelId = alertChannelId(config,account,event.type);
  if (!channelId) throw permanentDeliveryError(`No alert channel configured for ${account.platform}/${event.type}.`);

  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) throw permanentDeliveryError('Discord guild is unavailable.');

  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) throw permanentDeliveryError('Configured alert channel does not exist.');
  if (!channel.isTextBased?.()) throw permanentDeliveryError('Configured alert channel is not text based.');

  const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
  if (!me) throw new Error('Unable to resolve Goliath guild member for delivery permission check.');

  const permissions = channel.permissionsFor(me);
  if (!permissions?.has('ViewChannel')) throw permanentDeliveryError('Goliath cannot view the configured alert channel.');
  if (!permissions?.has('SendMessages')) throw permanentDeliveryError('Goliath cannot send messages in the configured alert channel.');
  if (!permissions?.has('EmbedLinks')) throw permanentDeliveryError('Goliath cannot embed links in the configured alert channel.');

  const embed = buildEmbed(account,event,templateFor(config,event.type),creatorFor(config,account.accountId),config.settings);
  const mention = await resolveMention(guild,account,config,options.suppressMention===true,event.type);
  const message = await channel.send({
    content: mention.content || null,
    embeds: [embed],
    allowedMentions: mention.allowedMentions
  });

  if (!message?.id) throw new Error('Discord did not return a message id for the alert.');
  return {channelId,messageId:message.id};
}
async function trackedMessage(client,guildId,previous) { const channelId=previous.lastLiveMessageChannelId||previous.lastAlertChannelId, messageId=previous.lastLiveMessageId||previous.lastAlertMessageId; if(!channelId||!messageId)return null; const guild=client.guilds.cache.get(guildId)||await client.guilds.fetch(guildId).catch(()=>null); if(!guild)return null; const channel=guild.channels.cache.get(channelId)||await guild.channels.fetch(channelId).catch(()=>null); if(!channel?.isTextBased?.())return null; const message=await channel.messages.fetch(messageId).catch(()=>null); return message?{channelId,messageId,message}:null; }
async function updateLiveAlert(client,guildId,config,account,event,previous) { const tracked=await trackedMessage(client,guildId,previous); if(!tracked)return null; await tracked.message.edit({embeds:[buildEmbed(account,event,templateFor(config,'live'),creatorFor(config,account.accountId),config.settings)],attachments:[]}); return {channelId:tracked.channelId,messageId:tracked.messageId}; }
async function updateEndedAlert(client,guildId,config,account,event,previous) { const tracked=await trackedMessage(client,guildId,previous); if(!tracked)return null; await tracked.message.edit({content:null,embeds:[buildEmbed(account,event,templateFor(config,'ended'),creatorFor(config,account.accountId),config.settings)],attachments:[]}); return {channelId:tracked.channelId,messageId:tracked.messageId}; }
function livePostInWindow(config,creator,windowMs=2*60*60*1000) { const ids=new Set(creator?.accountIds||[]), cutoff=Date.now()-windowMs; return [...(config.history||[])].reverse().find((item)=>ids.has(item.accountId)&&['alert_sent','alert_updated','alert_recovered'].includes(item.status)&&item.alertType==='live'&&new Date(item.createdAt||0).getTime()>=cutoff)||null; }
function accountLivePostInWindow(config,account,windowMs=2*60*60*1000) {
  if (!account?.accountId) return null;
  const cutoff=Date.now()-windowMs, currentEventId=String(account.state?.lastLiveEvent?.id||account.state?.liveEventId||'');
  return [...(config.history||[])].reverse().find((item)=>{
    if(String(item?.accountId||'')!==String(account.accountId)||item?.status!=='alert_sent'||item?.alertType!=='live') return false;
    const sentAt=new Date(item.createdAt||item.sentAt||0).getTime();
    if(!Number.isFinite(sentAt)||sentAt<cutoff) return false;
    return !currentEventId||!item.eventId||String(item.eventId)===currentEventId;
  })||null;
}
function liveAccountsForCreator(config,creator) { return (creator?.accountIds||[]).map((id)=>config.accounts?.[id]).filter((account)=>account&&account.enabled!==false&&account.state?.isLive===true&&account.state?.lastLiveEvent).sort((a,b)=>new Date(b.state?.lastCheckedAt||0)-new Date(a.state?.lastCheckedAt||0)); }
function liveMessageUpdateDue(account,previous,checked,settings={}) { if(checked.isLive!==true||previous.isLive!==true||!checked.event)return false; if(String(account?.platform||'').toLowerCase()==='tiktok'){const before=String(previous.lastLiveEvent?.liveStatus||(previous.lastLiveEvent?.paused===true?'PAUSED':'LIVE')).toUpperCase(), current=String(checked.event?.liveStatus||(checked.event?.paused===true?'PAUSED':'LIVE')).toUpperCase(); return before!==current;} if(settings.liveMessageRefreshEnabled===false)return false; const raw=previous.lastLiveMessageUpdatedAt||previous.lastLiveMessageUpdateAt||0, numeric=Number(raw), parsed=Number.isFinite(numeric)?numeric:Date.parse(String(raw)); if(!Number.isFinite(parsed))return true; const requested=Number(settings.liveMessageRefreshMs), refresh=LIVE_MESSAGE_REFRESH_INTERVALS.has(requested)?requested:LIVE_MESSAGE_REFRESH_MS; return Date.now()-parsed>=refresh; }
async function forcePostCreatorLive(client,guildId,creatorId,options={}) {
  const config=configFor(guildId,options.guildConfig), creator=config.creators?.[creatorId]; if(!creator)throw new Error('Select a creator profile first.'); if(creator.enabled===false)throw new Error('This creator profile is paused.'); const liveAccounts=liveAccountsForCreator(config,creator); if(!liveAccounts.length)throw new Error('No checked LIVE account is available for this creator yet.'); const accounts=options.bypassCooldown===true?liveAccounts:liveAccounts.filter((account)=>!accountLivePostInWindow(config,account)); if(!accounts.length)throw new Error('Every currently LIVE account has already been posted within the cooldown window.');
  const sent=[], monitorUpdates=new Map(), historyEntries=[], stamp=now();
  for(const account of accounts){
    const event={...account.state.lastLiveEvent,type:'live'}, delivered=await sendAlert(client,guildId,config,account,event,options), key=eventKey(event), state={...(account.state||{})};
    rememberDelivered(state,key); state.lastAlertKey=key; state.lastAlertAt=stamp; state.lastAlertMessageId=delivered.messageId; state.lastAlertChannelId=delivered.channelId; state.lastLiveMessageId=delivered.messageId; state.lastLiveMessageChannelId=delivered.channelId; state.lastLiveMessageUpdatedAt=stamp;
    monitorUpdates.set(account.accountId,{state,updatedAt:stamp}); historyEntries.push({id:`history_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,createdAt:stamp,accountId:account.accountId,platform:account.platform,status:'alert_sent',alertType:'live',eventId:event.id,messageId:delivered.messageId,channelId:delivered.channelId,manual:true}); sent.push({accountId:account.accountId,platform:account.platform,...delivered});
  }
  if(monitorUpdates.size) saveMonitorState(guildId,config,monitorUpdates,{alerts:sent.length},historyEntries,options.guild||null);
  return {creatorId,sent};
}
async function checkGuildAccounts(client,guildId,options={}) {
  const config=configFor(guildId,options.guildConfig); if(!config.enabled&&!options.force)return{skipped:true,reason:'disabled'}; const quiet=quietHoursActive(config.settings), monitorUpdates=new Map(), duplicateMerges=new Map(), analyticsDelta={}, historyEntries=[], results=[]; const guild=client.guilds.cache.get(guildId)||await client.guilds.fetch(guildId).catch(()=>null); if(!guild)return{skipped:true,reason:'guild_unavailable'};
  try { const deleted=deleteExpiredCreators(guildId,Date.now(),{actorId:'social-monitor'}); if(deleted.length){analyticsDelta.expiredCreatorsDeleted=deleted.length; for(const creatorId of deleted)historyEntries.push({id:`history_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,createdAt:now(),status:'creator_expired_deleted',creatorId});} } catch(error){analyticsDelta.errors=Number(analyticsDelta.errors||0)+1; console.error(`[Social Studio] expired creator cleanup failed for guild ${guildId}:`,error);}
  const accountIds=options.accountIds?.length?options.accountIds:Object.keys(config.accounts);
  const maxConcurrent=Math.max(1,Math.min(8,Number(config.settings.maxConcurrentAccounts||4)));
  const processAccount=async(accountId)=>{const account=config.accounts[accountId]; if(!account||account.enabled===false)return; const runKey=`${guildId}:${accountId}`; if(runningGuilds.has(runKey)){results.push({accountId,platform:account.platform,status:'skipped',reason:'already_running',delivered:[]});return;} runningGuilds.add(runKey);
    let previous = account.state && typeof account.state === 'object' ? { ...account.state } : {};
    let checked = null;
    let currentState = { ...previous };
    let activeDeliveryEvent = null;
    try { checked=await checkAccount(account); const state={...previous,lastCheckedAt:checked.checkedAt||now(),lastStatus:checked.status,lastError:['unavailable','configuration_required'].includes(checked.status)?checked.reason:null}; currentState=state;
      if(checked.isLive===true){const incoming=checked.event?.id?String(checked.event.id):null, old=previous.liveEventId?String(previous.liveEventId):null, newBroadcast=Boolean(incoming&&old&&incoming!==old); state.isLive=true; state.liveEventId=incoming||state.liveEventId||null; state.liveStartedAt=checked.event?.startedAt||(newBroadcast?null:state.liveStartedAt)||null; state.lastLiveEvent=checked.event||state.lastLiveEvent||null; if(newBroadcast){state.peakViewers=0;state.lastLiveMessageId=null;state.lastLiveMessageChannelId=null;state.lastAlertMessageId=null;state.lastAlertChannelId=null;} const viewers=Number(checked.event?.viewerCount); if(Number.isFinite(viewers)&&viewers>=0)state.peakViewers=Math.max(Number(state.peakViewers||0),viewers);
      } else if(checked.isLive===false){state.isLive=false;if(previous.isLive===true)state.lastLiveEndedAt=checked.checkedAt||now();}
      const creator=creatorFor(config,accountId);
      for(const duplicateId of resolvedDuplicateIds(config,account,checked,creator))duplicateMerges.set(duplicateId,accountId);

      if(options.diagnosticOnly===true){
        monitorUpdates.set(accountId,{state,externalId:checked.externalId||null,resolvedUsername:checked.resolvedUsername||null,profileUrl:checked.url||null,avatar:checked.avatar||null,updatedAt:now()});
        results.push({accountId,platform:account.platform,status:checked.status,isLive:checked.isLive,live:checked.event||null,delivered:[],diagnosticOnly:true});
        analyticsDelta.checks=Number(analyticsDelta.checks||0)+1;
        return;
      }

      const delivered=[];
      const completedEventKeys=new Set();
      const firstContentBaseline=!previous.contentBaselineEstablishedAt;
      const checkedContentItems=Array.isArray(checked.contentItems)&&checked.contentItems.length
        ? checked.contentItems
        : checked.latestContent
          ? [checked.latestContent]
          : [];

      if(firstContentBaseline){
        for(const item of checkedContentItems){
          if(!item?.type||!item?.id||item.type==='live'||item.type==='ended')continue;
          rememberDelivered(state,eventKey(item));
        }
        state.contentBaselineEstablishedAt=checked.checkedAt||now();
      }

      let events=eventCandidates(account,firstContentBaseline?state:previous,checked);
      const held = Array.isArray(previous.quietHoursPending) ? previous.quietHoursPending.filter((item) => item?.event?.type && item?.event?.id) : [];
      if (!quiet && held.length) {
        for (const item of held) {
          const heldEvent = item.event;
          if (heldEvent.type === 'live') {
            if (checked.isLive === true && String(checked.event?.id || '') === String(heldEvent.id || '')) {
              events.unshift(heldEvent);
              historyEntries.push({id:`history_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,createdAt:now(),accountId,platform:account.platform,status:'quiet_released',alertType:heldEvent.type,eventId:heldEvent.id});
            } else {
              historyEntries.push({id:`history_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,createdAt:now(),accountId,platform:account.platform,status:'quiet_stale_discarded',alertType:heldEvent.type,eventId:heldEvent.id});
            }
          } else {
            events.unshift(heldEvent);
            historyEntries.push({id:`history_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,createdAt:now(),accountId,platform:account.platform,status:'quiet_released',alertType:heldEvent.type,eventId:heldEvent.id});
          }
        }
        state.quietHoursPending = [];
      }
      if(config.settings.retryDeliveries!==false&&previous.pendingDelivery&&typeof previous.pendingDelivery==='object'){
        const pending=previous.pendingDelivery, retryAt=Date.parse(String(pending.nextAttemptAt||0)), attempts=Number(pending.attempts||0);
        const pendingEvent=pending.event&&typeof pending.event==='object'?pending.event:null;
        const pendingLiveStale=Boolean(pendingEvent?.type==='live' && (checked.isLive!==true || String(checked.event?.id||'')!==String(pendingEvent.id||'')));
        if(pendingLiveStale){
          state.pendingDelivery=null;
          state.lastDeliveryError=null;
        } else if(attempts >= Number(config.settings.maxDeliveryAttempts||5)){
          state.pendingDelivery=null;
        } else if(!Number.isFinite(retryAt)||retryAt<=Date.now()){
          try{
            activeDeliveryEvent=pendingEvent;
            if(activeDeliveryEvent){
              const retryDelivery=await sendAlert(client,guildId,config,account,activeDeliveryEvent,{...options,suppressMention:false});
              const retryKey=eventKey(activeDeliveryEvent); rememberDelivered(state,retryKey); completedEventKeys.add(String(retryKey)); state.pendingDelivery=null; state.lastAlertKey=retryKey; state.lastAlertAt=now(); state.lastAlertMessageId=retryDelivery.messageId; state.lastAlertChannelId=retryDelivery.channelId; state.lastDeliveryError=null;
              if(activeDeliveryEvent.type==='live'){state.lastLiveMessageId=retryDelivery.messageId;state.lastLiveMessageChannelId=retryDelivery.channelId;state.lastLiveMessageUpdatedAt=now();}
              delivered.push({type:activeDeliveryEvent.type,id:activeDeliveryEvent.id,...retryDelivery,recovered:true});
            } else state.pendingDelivery=null;
          }catch(error){
            const message=String(error?.message||error).slice(0,500);
            if(isPermanentDeliveryError(error)){
              state.pendingDelivery=null;
              state.lastDeliveryError=message;
            }else{
              const nextAttempts=attempts+1, retryMs=Number(config.settings.retryIntervalMs||60000);
              state.pendingDelivery={...pending,attempts:nextAttempts,lastAttemptAt:now(),nextAttemptAt:new Date(Date.now()+retryMs).toISOString()};
              state.lastDeliveryError=message;
            }
            analyticsDelta.errors=Number(analyticsDelta.errors||0)+1;
          } finally { activeDeliveryEvent=null; }
        }
      }
      for(const event of events){
        const key=eventKey(event);
        const keyString=String(key);

        if(completedEventKeys.has(keyString))continue;

        if(
          config.settings.retryDeliveries!==false &&
          state.pendingDelivery &&
          String(eventKey(state.pendingDelivery.event))===keyString
        )continue;

        if(
          hasDelivered(state,key) &&
          event.type!=='live'
        )continue;

        if(
          state.lastAlertKey===key &&
          event.type!=='ended' &&
          event.type!=='live'
        )continue;

        if(quiet&&!options.manual&&event.type!=='ended'){
          const pending = Array.isArray(state.quietHoursPending) ? state.quietHoursPending : [];
          const pendingKey = eventKey(event);
          if (!pending.some((item) => item?.key === pendingKey)) {
            pending.push({ key: pendingKey, event, heldAt: now() });
            historyEntries.push({id:`history_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,createdAt:now(),accountId,platform:account.platform,status:'quiet_held',alertType:event.type,eventId:event.id});
          }
          state.quietHoursPending = pending.slice(-100);
          continue;
        }
        if(event.type==='ended'){let updated=null; updated=await updateEndedAlert(client,guildId,config,account,event,previous).catch(()=>null); if(updated){delivered.push({type:'ended',id:event.id,...updated}); rememberDelivered(state,key); state.lastAlertKey=key; state.lastAlertAt=now(); state.pendingEndedEvent=null; state.lastLiveMessageId=null; state.lastLiveMessageChannelId=null; state.lastAlertMessageId=null; state.lastAlertChannelId=null;} else {state.pendingEndedEvent=event;} continue;}
        if(event.type==='live'&&previous.isLive===true&&String(previous.liveEventId||'')===String(event.id||'')&&hasTrackedLiveMessage(previous)){const existing=await trackedMessage(client,guildId,previous).catch(()=>null); if(existing){state.lastAlertKey=key;rememberDelivered(state,key);continue;}}
        activeDeliveryEvent=event; const delivery=await sendAlert(client,guildId,config,account,event,options); activeDeliveryEvent=null; delivered.push({type:event.type,id:event.id,...delivery}); rememberDelivered(state,key);completedEventKeys.add(keyString);state.pendingDelivery=null;state.lastAlertKey=key;state.lastAlertAt=now();state.lastAlertMessageId=delivery.messageId;state.lastAlertChannelId=delivery.channelId;state.lastDeliveryError=null;if(event.type==='live'){state.lastLiveMessageId=delivery.messageId;state.lastLiveMessageChannelId=delivery.channelId;state.lastLiveMessageUpdatedAt=now();}
      }
      const checkedLiveId=checked.isLive===true&&checked.event?.id?String(checked.event.id):null;
      const previousLiveId=previous.isLive===true&&previous.liveEventId?String(previous.liveEventId):null;
      const currentLiveId=state.isLive===true&&state.liveEventId?String(state.liveEventId):null;
      const sameActiveBroadcast=Boolean(
        checkedLiveId &&
        previousLiveId &&
        currentLiveId &&
        checkedLiveId===previousLiveId &&
        checkedLiveId===currentLiveId
      );

      if(sameActiveBroadcast&&liveMessageUpdateDue(account,previous,checked,config.settings)){
        let updated=null,recovered=false,refreshError=null;

        try{
            updated=await updateLiveAlert(client,guildId,config,account,checked.event,previous);
          }catch(error){
            refreshError=error?.message||String(error);
          }

        if(!updated&&hasTrackedLiveMessage(previous)){
          try{
            updated=await sendAlert(
              client,
              guildId,
              config,
              account,
              checked.event,
              {...options,suppressMention:true}
            );
            recovered=Boolean(updated);
            refreshError=null;
          }catch(error){
            refreshError=error?.message||String(error);
          }
        }

        if(updated){
          const key=eventKey(checked.event);
          rememberDelivered(state,key);
          state.lastAlertKey=key;
          state.lastAlertMessageId=updated.messageId;
          state.lastAlertChannelId=updated.channelId;
          state.lastLiveMessageId=updated.messageId;
          state.lastLiveMessageChannelId=updated.channelId;
          state.lastLiveMessageUpdatedAt=now();
          state.lastDeliveryError=null;
          delivered.push({
            type:'live',
            id:checked.event.id,
            refreshed:!recovered,
            recovered,
            ...updated
          });
        }else if(refreshError){
          state.lastDeliveryError=String(refreshError).slice(0,500);
        }
      }
      monitorUpdates.set(accountId,{state,externalId:checked.externalId||null,resolvedUsername:checked.resolvedUsername||null,profileUrl:checked.url||null,avatar:checked.avatar||null,updatedAt:now()}); results.push({accountId,platform:account.platform,status:checked.status,isLive:checked.isLive,live:checked.event||null,delivered});analyticsDelta.checks=Number(analyticsDelta.checks||0)+1;if(delivered.length)analyticsDelta.alerts=Number(analyticsDelta.alerts||0)+delivered.length;for(const item of delivered)historyEntries.push({id:`history_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,createdAt:now(),accountId,platform:account.platform,status:item.recovered?'alert_recovered':item.refreshed?'alert_updated':'alert_sent',alertType:item.type,eventId:item.id,messageId:item.messageId,channelId:item.channelId});
    } catch(error){
      analyticsDelta.errors=Number(analyticsDelta.errors||0)+1;
      const message=String(error?.message||error);

      if(isPermanentDeliveryError(error)){
        monitorUpdates.set(accountId,{
          state:{
            ...currentState,
            lastDeliveryError:message.slice(0,500),
            pendingDelivery:null
          },
          updatedAt:now()
        });
      } else if(activeDeliveryEvent&&config.settings.retryDeliveries!==false){
        const priorPending=previous.pendingDelivery&&typeof previous.pendingDelivery==='object'?previous.pendingDelivery:{};
        const attempts=Number(priorPending.attempts||0)+1;

        if(attempts<=Number(config.settings.maxDeliveryAttempts||5)){
          const retryMs=Number(config.settings.retryIntervalMs||60000);
          monitorUpdates.set(accountId,{
            state:{
              ...currentState,
              pendingDelivery:{
                event:activeDeliveryEvent,
                attempts,
                lastAttemptAt:now(),
                nextAttemptAt:new Date(Date.now()+retryMs).toISOString()
              },
              lastDeliveryError:message.slice(0,500)
            },
            updatedAt:now()
          });
        } else {
          monitorUpdates.set(accountId,{
            state:{
              ...currentState,
              lastDeliveryError:message.slice(0,500),
              pendingDelivery:null
            },
            updatedAt:now()
          });
        }
      } else if(previous?.isLive===true || checked?.isLive===true){
        monitorUpdates.set(accountId,{
          state:{...currentState,lastDeliveryError:message.slice(0,500)},
          updatedAt:now()
        });
      }

      results.push({
        accountId,
        platform:account.platform,
        status:'error',
        error:error?.message||String(error),
        delivered:[]
      });
    } finally{runningGuilds.delete(runKey);}
  };
  for(let offset=0;offset<accountIds.length;offset+=maxConcurrent){
    await Promise.all(accountIds.slice(offset,offset+maxConcurrent).map((id)=>processAccount(id)));
  }
  const saved=saveMonitorState(guildId,config,monitorUpdates,analyticsDelta,historyEntries,guild,duplicateMerges);return{guildId,checked:results.filter((item)=>item.status!=='skipped').length,results,savedAt:saved.updatedAt||now()};
}
function startupSocialStudio(client){if(timer)return timer;const interval=Math.max(30000,Number(process.env.SOCIAL_STUDIO_TICK_MS||60000)),run=()=>{for(const guild of client.guilds.cache.values())checkGuildAccounts(client,guild.id).catch((error)=>console.error(`[Social Studio] monitor failed for guild ${guild.id}:`,error));};const initial=setTimeout(run,5000);initial.unref?.();timer=setInterval(run,interval);timer.unref?.();console.log(`✅ Social Studio monitor started (${interval}ms)`);return timer;}
module.exports={startupSocialStudio,checkGuildAccounts,forcePostCreatorLive,buildLiveFields};