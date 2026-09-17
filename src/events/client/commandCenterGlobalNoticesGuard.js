'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, Events } = require('discord.js');
const auditStore = require('../../owner/auditIntelligence/auditStore');
const schedulerRegistry = require('../../owner/sentinel/schedulerRegistry');

const OPEN_ID = 'owner:commandcenter:globalnotices:open';
const REFRESH_INTERVAL_MS = 10 * 1000;
const SCHEDULER_ID = 'commandCenter:global-notices-guard:global';
let guardWired = false;
let refreshTimer = null;

function runtimeMode() {
  return String(auditStore.runtimeMode?.() || process.env.BOT_MODE || 'DEV').toUpperCase();
}

async function commandCenterMessage(client) {
  if (runtimeMode() !== 'DEV') return null;
  const config = auditStore.getConfig();
  const guildId = String(config.commandCenter?.guildId || '');
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return null;

  let channel = config.commandCenter?.channelId
    ? guild.channels.cache.get(String(config.commandCenter.channelId))
    : null;
  if (!channel?.isTextBased?.()) {
    channel = guild.channels.cache.find((item) => item.isTextBased?.() && item.name === 'command-center') || null;
  }
  if (!channel?.isTextBased?.()) return null;

  const configuredMessageId = String(config.commandCenter?.messageId || '');
  if (configuredMessageId) {
    const configured = await channel.messages.fetch(configuredMessageId).catch(() => null);
    if (configured?.author?.id === client.user?.id && configured.embeds?.some((embed) => String(embed.title || '').includes('GOLIATH COMMAND CENTER'))) return configured;
  }

  const messages = await channel.messages.fetch({ limit: 25 }).catch(() => null);
  return messages?.find((message) => message.author?.id === client.user?.id && message.embeds?.some((embed) => String(embed.title || '').includes('GOLIATH COMMAND CENTER'))) || null;
}

async function ensureGlobalNoticesButton(client) {
  const message = await commandCenterMessage(client);
  if (!message) return { ok: false, reason: 'command-center-message-unavailable', restored: false };

  const rows = message.components.map((row) => ActionRowBuilder.from(row));
  const exists = rows.some((row) => row.components.some((component) => {
    const id = component.customId || component.data?.custom_id;
    return id === OPEN_ID;
  }));
  if (exists) return { ok: true, restored: false, messageId: message.id };

  const button = new ButtonBuilder()
    .setCustomId(OPEN_ID)
    .setLabel('Global Notices')
    .setEmoji('🚨')
    .setStyle(ButtonStyle.Danger);

  const row = [...rows].reverse().find((item) => item.components.length < 5);
  if (row) row.addComponents(button);
  else if (rows.length < 5) rows.push(new ActionRowBuilder().addComponents(button));
  else {
    console.warn('[Global Notice Controls] Command Center has no component slot for Global Notices.');
    return { ok: false, reason: 'no-component-slot', restored: false, messageId: message.id };
  }

  await message.edit({ components: rows });
  console.log('[Global Notice Controls] Global Notices button restored on Command Center home.');
  return { ok: true, restored: true, messageId: message.id };
}

async function runGuard(client, phase) {
  try {
    const result = await ensureGlobalNoticesButton(client);
    if (result.ok) schedulerRegistry.beat(SCHEDULER_ID, { phase, restored: result.restored, messageId: result.messageId || null });
    else schedulerRegistry.fail(SCHEDULER_ID, new Error(`Global Notices guard unavailable: ${result.reason || 'unknown'}`), { phase, reason: result.reason || 'unknown' });
    return result;
  } catch (error) {
    schedulerRegistry.fail(SCHEDULER_ID, error, { phase });
    throw error;
  }
}

function scheduleEnsure(client, delay = 250) {
  const timer = setTimeout(() => {
    runGuard(client, 'navigation-refresh').catch((error) => {
      console.warn('[Global Notice Controls] Home button guard failed:', error?.message || error);
    });
  }, delay);
  timer.unref?.();
}

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    if (runtimeMode() !== 'DEV') return;

    schedulerRegistry.register({
      id: SCHEDULER_ID,
      module: 'commandCenter',
      component: 'global-notices-guard',
      intervalMs: REFRESH_INTERVAL_MS,
      staleAfterMs: REFRESH_INTERVAL_MS * 3,
      environment: runtimeMode(),
    });

    await runGuard(client, 'startup').catch((error) => {
      console.warn('[Global Notice Controls] Initial home button guard failed:', error?.message || error);
    });

    if (!guardWired) {
      guardWired = true;
      client.prependListener(Events.InteractionCreate, (interaction) => {
        const id = String(interaction?.customId || '');
        if (!id.startsWith('owner:commandcenter:')) return;
        scheduleEnsure(client, 350);
      });
    }

    if (!refreshTimer) {
      refreshTimer = setInterval(() => {
        runGuard(client, 'scheduled').catch((error) => {
          console.warn('[Global Notice Controls] Scheduled guard failed:', error?.message || error);
        });
      }, REFRESH_INTERVAL_MS);
      refreshTimer.unref?.();
    }
  },
};
