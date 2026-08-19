'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
} = require('discord.js');
const store = require('./socialStudioStore');
const { ALERT_TYPES } = require('./socialStudioTemplates');

const P = 'social:userroute:';
const TYPE_LABELS = {
  all: 'All Content',
  live: 'LIVE',
  ended: 'Stream Ended',
  vod: 'VOD',
  clip: 'Clip',
  upload: 'Upload',
  short: 'Short',
  post: 'Social Post',
};
const TYPE_EMOJI = {
  all: '🌐',
  live: '🔴',
  ended: '⚫',
  vod: '🎞️',
  clip: '🎬',
  upload: '📺',
  short: '📱',
  post: '📝',
};
const sessions = new Map();

function key(i) { return `${i.guildId}:${i.user?.id || 'unknown'}`; }
function state(i) { return sessions.get(key(i)) || { targetUserId: null, type: 'all', pendingChannelId: null }; }
function setState(i, patch) { const next = { ...state(i), ...patch }; sessions.set(key(i), next); return next; }
function row(...components) { return new ActionRowBuilder().addComponents(...components); }
function button(id, label, style = ButtonStyle.Secondary, disabled = false) {
  return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
}
function object(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
function who(i) { return i.member?.displayName || i.user?.displayName || i.user?.username || 'Unknown User'; }
function save(i, config) { return store.saveConfig(i.guildId, config, { actorId: i.user?.id || null, guild: i.guild }); }

function overrides(config) { return object(config.userChannelOverrides); }
function routesFor(config, userId) { return object(overrides(config)[String(userId || '')]); }

function userDisplay(i, userId) {
  if (!userId) return 'None';
  const member = i.guild?.members?.cache?.get?.(userId);
  return member ? `${member.displayName} (<@${userId}>)` : `<@${userId}>`;
}

function creatorAccountsForUser(config, userId) {
  const uid = String(userId || '');
  const ids = new Set();
  for (const creator of Object.values(config.creators || {})) {
    const owner = String(creator?.ownerDiscordId || creator?.discordUserId || creator?.userId || '');
    if (owner !== uid) continue;
    for (const id of creator.accountIds || []) ids.add(String(id));
  }
  for (const [id, account] of Object.entries(config.accounts || {})) {
    if (String(account?.discordUserId || account?.ownerDiscordId || '') === uid) ids.add(String(id));
  }
  return [...ids];
}

function platformsForUser(config, userId) {
  return [...new Set(creatorAccountsForUser(config, userId)
    .map((accountId) => String(config.accounts?.[accountId]?.platform || '').toLowerCase())
    .filter(Boolean))];
}

function routeSummary(routes) {
  const lines = [];
  for (const type of ['all', ...ALERT_TYPES]) {
    if (routes[type]) lines.push(`${TYPE_EMOJI[type] || '🔔'} **${TYPE_LABELS[type] || type}:** <#${routes[type]}>`);
  }
  return lines.length ? lines.join('\n') : 'No direct user overrides. This user follows the server routing.';
}

function effectiveRoute(config, routes, type, platform = '') {
  if (routes[type]) return { channelId: routes[type], source: 'User Override' };
  if (routes.all) return { channelId: routes.all, source: 'User All Content' };
  if (platform && config.platformChannels?.[platform]) {
    return { channelId: config.platformChannels[platform], source: `Server ${platform} Platform Override` };
  }
  if (config.alertChannels?.[type]) return { channelId: config.alertChannels[type], source: 'Server Dedicated' };
  if (config.alertsChannelId) return { channelId: config.alertsChannelId, source: 'Server Default' };
  return { channelId: null, source: 'Not configured' };
}

function effectivePreview(config, routes, userId) {
  const platforms = platformsForUser(config, userId);
  const samples = platforms.length ? platforms : [''];

  return ALERT_TYPES.map((type) => {
    const resolved = samples.map((platform) => ({ platform, ...effectiveRoute(config, routes, type, platform) }));
    const unique = new Map(resolved.map((item) => [`${item.channelId || ''}:${item.source}`, item]));
    if (unique.size === 1) {
      const item = [...unique.values()][0];
      const destination = item.channelId ? `<#${item.channelId}>` : 'Not configured';
      return `${TYPE_EMOJI[type] || '🔔'} **${TYPE_LABELS[type] || type}** → ${destination} *(${item.source})*`;
    }
    const details = resolved.map((item) => `${item.platform.toUpperCase()}: ${item.channelId ? `<#${item.channelId}>` : 'Not configured'} (${item.source})`).join(' • ');
    return `${TYPE_EMOJI[type] || '🔔'} **${TYPE_LABELS[type] || type}** → *varies by platform* — ${details}`;
  }).join('\n');
}

function payload(i) {
  const config = store.getConfig(i.guildId);
  const s = state(i);
  const routes = routesFor(config, s.targetUserId);
  const currentRouteChannel = routes[s.type] || null;
  const pendingChannelId = s.pendingChannelId || currentRouteChannel || null;
  const configuredUsers = Object.entries(overrides(config)).filter(([, r]) => Object.values(object(r)).some(Boolean));

  const desc = [
    'Route each creator\'s automatic Social Studio posts to their own Discord channels. Anything not overridden falls back to the server routing.',
    '',
    '**Fallback:** User content route → User All Content → Server Platform Override → Server Dedicated route → Server Default channel.',
    '',
    `**Configured Users:** ${configuredUsers.length}`,
    `**Selected User:** ${userDisplay(i, s.targetUserId)}`,
    s.targetUserId ? `\n**Current User Routes**\n${routeSummary(routes)}` : '\nSelect a Discord user below to manage their routing.',
    s.targetUserId ? `\n**Effective Routing Preview**\n${effectivePreview(config, routes, s.targetUserId)}` : '',
  ].filter(Boolean).join('\n');

  const userMenu = new UserSelectMenuBuilder()
    .setCustomId(`${P}user`)
    .setPlaceholder('1. Choose the Discord user')
    .setMinValues(1)
    .setMaxValues(1);
  if (s.targetUserId && typeof userMenu.setDefaultUsers === 'function') userMenu.setDefaultUsers([s.targetUserId]);

  const components = [row(userMenu)];

  if (s.targetUserId) {
    const typeMenu = new StringSelectMenuBuilder()
      .setCustomId(`${P}type`)
      .setPlaceholder('2. Choose the content type')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(['all', ...ALERT_TYPES].map((type) => ({
        label: `${TYPE_EMOJI[type] || '🔔'} ${TYPE_LABELS[type] || type}`,
        value: type,
        description: type === 'all'
          ? 'Send every content type for this user to one channel.'
          : `Override only ${TYPE_LABELS[type] || type} posts.`,
        default: type === s.type,
      })));
    components.push(row(typeMenu));

    const channel = new ChannelSelectMenuBuilder()
      .setCustomId(`${P}channel`)
      .setPlaceholder(`3. Choose destination for ${TYPE_LABELS[s.type] || s.type}`)
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setMinValues(1)
      .setMaxValues(1);
    if (pendingChannelId) channel.setDefaultChannels([pendingChannelId]);
    components.push(row(channel));

    const pendingChanged = Boolean(s.pendingChannelId && s.pendingChannelId !== currentRouteChannel);
    components.push(row(
      button(`${P}save`, '💾 Set Route', ButtonStyle.Primary, !s.pendingChannelId || !pendingChanged),
      button(`${P}clear`, `🧹 Clear ${TYPE_LABELS[s.type] || s.type}`, ButtonStyle.Secondary, !currentRouteChannel),
      button(`${P}clearall`, '🗑️ Clear All User Routes', ButtonStyle.Danger, !Object.values(routes).some(Boolean)),
    ));
  }

  components.push(row(button('social:channels', '⬅️ Channels'), button('social:main', '🏠 Social Studio')));

  return {
    embeds: [new EmbedBuilder()
      .setColor(config.enabled ? 0x5865F2 : 0x747F8D)
      .setTitle('👥 User Automatic Post Routing')
      .setDescription(desc)
      .setFooter({ text: `Requested by ${who(i)}` })
      .setTimestamp()],
    components,
  };
}

async function update(i) {
  const next = payload(i);
  if (i.deferred || i.replied) await i.editReply(next);
  else await i.update(next);
  return true;
}

async function handle(i) {
  const id = String(i?.customId || '');
  if (!i.guildId) return false;

  if (id === `${P}open`) {
    setState(i, { targetUserId: null, type: 'all', pendingChannelId: null });
    return update(i);
  }
  if (!id.startsWith(P)) return false;

  if (id === `${P}user`) {
    setState(i, { targetUserId: i.values?.[0] || null, type: 'all', pendingChannelId: null });
    return update(i);
  }
  if (id === `${P}type`) {
    const type = i.values?.[0] || 'all';
    setState(i, { type: ['all', ...ALERT_TYPES].includes(type) ? type : 'all', pendingChannelId: null });
    return update(i);
  }
  if (id === `${P}channel`) {
    setState(i, { pendingChannelId: i.values?.[0] || null });
    return update(i);
  }
  if (id === `${P}save`) {
    const config = store.getConfig(i.guildId);
    const s = state(i);
    if (!s.targetUserId) throw new Error('Choose a Discord user first.');
    if (!s.pendingChannelId) throw new Error('Choose a destination channel first.');
    config.userChannelOverrides = { ...overrides(config) };
    const routes = { ...routesFor(config, s.targetUserId), [s.type]: s.pendingChannelId };
    config.userChannelOverrides[s.targetUserId] = routes;
    save(i, config);
    setState(i, { pendingChannelId: null });
    return update(i);
  }
  if (id === `${P}clear` || id === `${P}clearall`) {
    const config = store.getConfig(i.guildId);
    const s = state(i);
    if (!s.targetUserId) throw new Error('Choose a Discord user first.');
    config.userChannelOverrides = { ...overrides(config) };
    if (id.endsWith('clearall')) delete config.userChannelOverrides[s.targetUserId];
    else {
      const routes = { ...routesFor(config, s.targetUserId) };
      delete routes[s.type];
      if (Object.values(routes).some(Boolean)) config.userChannelOverrides[s.targetUserId] = routes;
      else delete config.userChannelOverrides[s.targetUserId];
    }
    save(i, config);
    setState(i, { pendingChannelId: null });
    return update(i);
  }
  return false;
}

module.exports = { handle };
