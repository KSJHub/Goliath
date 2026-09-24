'use strict';

const crypto = require('node:crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const guildManager = require('../../core/guild/guildManager');
const { startupSocialStudio } = require('../../modules/socialStudio/socialAlerts/socialStudioMonitor');
const { diagnoseAccount } = require('../../modules/socialStudio/socialAlerts/socialStudioProviders');
const { buildSectionPanel } = require('../../modules/socialStudio/socialAlerts/socialStudioPanel');

const PLATFORM_LABELS = {
  twitch: 'Twitch',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  kick: 'Kick',
  facebook: 'Facebook',
  instagram: 'Instagram',
  x: 'X',
};
const PLATFORM_ORDER = Object.keys(PLATFORM_LABELS);
const statusSessions = new Map();
const STATUS_SESSION_TTL_MS = 15 * 60 * 1000;

function cleanupStatusSessions() {
  const cutoff = Date.now() - STATUS_SESSION_TTL_MS;
  for (const [id, session] of statusSessions.entries()) {
    if (!session || session.createdAt < cutoff) statusSessions.delete(id);
  }
}

function sortProviderResults(results = []) {
  return [...results].sort((a, b) => {
    const platformA = PLATFORM_ORDER.indexOf(String(a?.platform || '').toLowerCase());
    const platformB = PLATFORM_ORDER.indexOf(String(b?.platform || '').toLowerCase());
    const orderA = platformA === -1 ? PLATFORM_ORDER.length : platformA;
    const orderB = platformB === -1 ? PLATFORM_ORDER.length : platformB;
    if (orderA !== orderB) return orderA - orderB;
    const identityA = String(a?.username || a?.resolvedUsername || a?.externalId || a?.accountId || '').toLowerCase();
    const identityB = String(b?.username || b?.resolvedUsername || b?.externalId || b?.accountId || '').toLowerCase();
    return identityA.localeCompare(identityB, 'en-GB', { sensitivity: 'base', numeric: true });
  });
}

function socialConfig(guildId) {
  return guildManager.getGuildSection(guildId, 'social', {}) || {};
}

function alertChannelFor(social, account, type = 'live') {
  return account?.alertChannels?.[type]
    || account?.alertChannelId
    || social?.alertChannels?.[type]
    || social?.platformChannels?.[account?.platform]
    || social?.alertsChannelId
    || null;
}

function selectedAccountIds(social, options = {}) {
  if (Array.isArray(options.accountIds) && options.accountIds.length) {
    return [...new Set(options.accountIds.map(String))];
  }

  if (Array.isArray(options.creatorIds) && options.creatorIds.length) {
    const ids = [];
    for (const creatorId of options.creatorIds) {
      const creator = social?.creators?.[creatorId];
      if (creator && Array.isArray(creator.accountIds)) ids.push(...creator.accountIds.map(String));
    }
    return [...new Set(ids)];
  }

  return Object.keys(social?.accounts || {});
}

async function runProviderStatusCheck(guildId, options = {}) {
  const social = socialConfig(guildId);
  const accounts = social.accounts && typeof social.accounts === 'object' ? social.accounts : {};
  const results = [];

  for (const accountId of selectedAccountIds(social, options)) {
    const account = accounts[accountId];
    if (!account || account.enabled === false) continue;
    const deliveryChannelId = alertChannelFor(social, account, 'live');
    results.push(await diagnoseAccount({ ...account, accountId }, {
      includeDelivery: true,
      deliveryChannelId,
    }));
  }

  return { guildId, checked: results.length, results };
}

function enrichProviderResults(guildId, results = []) {
  const social = socialConfig(guildId);
  const accounts = social.accounts && typeof social.accounts === 'object' ? social.accounts : {};

  return results.map((item) => {
    const account = accounts[item?.accountId] || {};
    return {
      ...item,
      username: item?.username || item?.resolvedUsername || account.username || account.normalizedUsername || null,
      resolvedUsername: item?.resolvedUsername || account.normalizedUsername || account.username || null,
      externalId: item?.externalId || account.externalId || null,
      displayName: item?.displayName || account.displayName || null,
      profileUrl: item?.profileUrl || item?.url || account.profileUrl || account.url || null,
      reason: item?.reason || item?.error || account.state?.lastError || null,
    };
  });
}

function formatProviderResult(item, { showIds = false } = {}) {
  const platform = PLATFORM_LABELS[item.platform] || item.platform || 'Unknown';
  let state = '🟡 UNAVAILABLE';

  if (item.status === 'live' || item.isLive === true) state = '🔴 LIVE';
  else if (item.status === 'offline' || item.isLive === false) state = '⚫ OFFLINE';
  else if (item.status === 'configuration_required') state = '🟠 CONFIG REQUIRED';
  else if (item.status === 'unsupported') state = '⚪ UNSUPPORTED';
  else if (item.status === 'ok') state = '🟢 OK';
  else if (item.status) state = `🟡 ${String(item.status).replace(/_/g, ' ').toUpperCase()}`;

  const rawIdentity = item.username || item.resolvedUsername || item.displayName || item.externalId || item.accountId || 'Unknown account';
  const identity = item.platform === 'twitch' && rawIdentity !== 'Unknown account' && !String(rawIdentity).startsWith('@')
    ? `@${rawIdentity}`
    : rawIdentity;
  const extra = [];
  if (showIds && item.accountId) extra.push(`Account: ${item.accountId}`);
  if (showIds && item.externalId) extra.push(`Provider ID: ${item.externalId}`);
  if (Number.isFinite(Number(item.latencyMs))) extra.push(`Provider: ${Number(item.latencyMs)}ms`);
  if (item.events?.length) extra.push(`Detected: ${item.events.map((event) => event.type).join(', ')}`);
  if (item.delivered?.length) extra.push(`Posted: ${item.delivered.map((event) => event.type).join(', ')}`);
  if (item.reason) extra.push(item.reason);
  if (item.deliveryReady === false && item.deliveryReason) extra.push(`⚠️ Alert delivery: ${item.deliveryReason}`);

  return `**${platform}** — **${state}** — ${identity}${extra.length ? `\n↳ ${extra.join(' • ')}` : ''}`;
}

function statusPayload(results, sessionId, showIds = false) {
  const lines = sortProviderResults(results).map((item) => formatProviderResult(item, { showIds }));
  const summary = lines.length ? lines.join('\n').slice(0, 1900) : 'No matching enabled Social Studio accounts were available to check.';
  const button = new ButtonBuilder()
    .setCustomId(`socialStatus:ids:${sessionId}:${showIds ? 'hide' : 'show'}`)
    .setLabel(showIds ? '🙈 Hide IDs' : '🪪 Show IDs')
    .setStyle(ButtonStyle.Secondary);
  return {
    content: `🔎 **Social Studio Status Check**\n\n${summary}`,
    components: [new ActionRowBuilder().addComponents(button)],
    flags: 64,
  };
}

function checkOptions(customId) {
  if (customId === 'social:account:check') return { manual: true, force: true };
  if (customId.startsWith('social:account:check:')) {
    return { manual: true, force: true, accountIds: [customId.slice('social:account:check:'.length)] };
  }
  if (customId.startsWith('social:creator:check:')) {
    return { manual: true, force: true, creatorIds: [customId.slice('social:creator:check:'.length)] };
  }
  return null;
}

function currentPanelSection(interaction, customId) {
  const title = String(interaction.message?.embeds?.[0]?.title || '').toLowerCase();
  if (title.includes('monitoring')) return 'monitoring';
  if (title.includes('live messages')) return 'liveMessages';
  if (title.includes('diagnostics')) return 'diagnostics';
  if (title.includes('operations')) return 'operations';
  if (title.includes('automation')) return 'monitoring';
  if (title.includes('notification')) return 'operations';
  if (title.includes('testing')) return 'diagnostics';
  if (title.includes('creator')) return 'creators';
  if (title.includes('account')) return 'accounts';
  if (customId.startsWith('social:creator:check:')) return 'creators';
  return 'accounts';
}

module.exports = [
  {
    name: 'clientReady',
    once: true,
    async execute(client) {
      startupSocialStudio(client);
    },
  },
  {
    name: 'interactionCreate',
    once: false,
    async execute(interaction) {
      const customId = String(interaction?.customId || '');

      if (customId.startsWith('socialStatus:ids:')) {
        cleanupStatusSessions();
        const [, , sessionId, action] = customId.split(':');
        const session = statusSessions.get(sessionId);
        if (!session || session.userId !== interaction.user?.id) {
          if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: 'This status result has expired. Run the check again.', flags: 64 }).catch(() => null);
          return;
        }
        const showIds = action === 'show';
        await interaction.update(statusPayload(session.results, sessionId, showIds)).catch(() => null);
        return;
      }

      const options = checkOptions(customId);
      if (options && interaction.guildId) {
        if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();
        const outcome = await runProviderStatusCheck(interaction.guildId, options);

        try {
          const section = currentPanelSection(interaction, customId);
          await interaction.editReply(buildSectionPanel(interaction, section));
        } catch (error) {
          console.warn('[Social Studio] panel refresh after manual check failed:', error?.message || error);
        }

        cleanupStatusSessions();
        const sessionId = crypto.randomBytes(6).toString('hex');
        const results = sortProviderResults(enrichProviderResults(interaction.guildId, outcome.results || []));
        statusSessions.set(sessionId, { userId: interaction.user?.id || null, createdAt: Date.now(), results });
        await interaction.followUp(statusPayload(results, sessionId, false)).catch(() => null);
      }
    },
  },
];
