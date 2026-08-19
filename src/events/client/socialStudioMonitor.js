'use strict';

const crypto = require('node:crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { startupSocialStudio, checkGuildAccounts } = require('../../modules/socialStudio/socialAlerts/socialStudioMonitor');
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
    const identityA = String(a?.username || a?.externalId || '').toLowerCase();
    const identityB = String(b?.username || b?.externalId || '').toLowerCase();
    return identityA.localeCompare(identityB, 'en-GB', { sensitivity: 'base', numeric: true });
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

  const identity = item.username || item.externalId || 'Unknown account';
  const extra = [];
  if (showIds && item.externalId) extra.push(`ID: ${item.externalId}`);
  if (item.events?.length) extra.push(`Detected: ${item.events.map((event) => event.type).join(', ')}`);
  if (item.delivered?.length) extra.push(`Posted: ${item.delivered.map((event) => event.type).join(', ')}`);
  if (item.reason) extra.push(item.reason);

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
    async execute(interaction, client) {
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
        const outcome = await checkGuildAccounts(client || interaction.client, interaction.guildId, options);

        if (outcome.skipped && outcome.reason === 'check_already_running') {
          await interaction.followUp({ content: '🔎 **Social Studio Status Check**\n\n⏳ A Social Studio check is already running for this server.', flags: 64 }).catch(() => null);
          return;
        }

        try {
          const section = currentPanelSection(interaction, customId);
          await interaction.editReply(buildSectionPanel(interaction, section));
        } catch (error) {
          console.warn('[Social Studio] panel refresh after manual check failed:', error?.message || error);
        }

        cleanupStatusSessions();
        const sessionId = crypto.randomBytes(6).toString('hex');
        const results = sortProviderResults(outcome.results || []);
        statusSessions.set(sessionId, { userId: interaction.user?.id || null, createdAt: Date.now(), results });
        await interaction.followUp(statusPayload(results, sessionId, false)).catch(() => null);
      }
    },
  },
];
