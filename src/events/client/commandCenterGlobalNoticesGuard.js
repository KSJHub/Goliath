'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, Events } = require('discord.js');
const auditStore = require('../../owner/auditIntelligence/auditStore');

const OPEN_ID = 'owner:commandcenter:globalnotices:open';
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
  if (!message) return false;

  const rows = message.components.map((row) => ActionRowBuilder.from(row));
  const exists = rows.some((row) => row.components.some((component) => {
    const id = component.customId || component.data?.custom_id;
    return id === OPEN_ID;
  }));
  if (exists) return true;

  const button = new ButtonBuilder()
    .setCustomId(OPEN_ID)
    .setLabel('Global Notices')
    .setEmoji('🚨')
    .setStyle(ButtonStyle.Danger);

  // Prefer the final partially-filled row so the established Command Center
  // layout stays intact. Discord permits at most 5 rows and 5 buttons per row.
  const row = [...rows].reverse().find((item) => item.components.length < 5);
  if (row) row.addComponents(button);
  else if (rows.length < 5) rows.push(new ActionRowBuilder().addComponents(button));
  else {
    console.warn('[Global Notice Controls] Command Center has no component slot for Global Notices.');
    return false;
  }

  await message.edit({ components: rows });
  console.log('[Global Notice Controls] Global Notices button restored on Command Center home.');
  return true;
}

function scheduleEnsure(client, delay = 250) {
  const timer = setTimeout(() => {
    ensureGlobalNoticesButton(client).catch((error) => {
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

    await ensureGlobalNoticesButton(client).catch((error) => {
      console.warn('[Global Notice Controls] Initial home button guard failed:', error?.message || error);
    });

    if (!guardWired) {
      guardWired = true;
      client.prependListener(Events.InteractionCreate, (interaction) => {
        const id = String(interaction?.customId || '');
        if (!id.startsWith('owner:commandcenter:')) return;
        // Any Command Center navigation can rebuild the home message. Restore
        // the entry immediately afterwards instead of waiting for a restart.
        scheduleEnsure(client, 350);
      });
    }

    if (!refreshTimer) {
      refreshTimer = setInterval(() => {
        ensureGlobalNoticesButton(client).catch(() => null);
      }, 10 * 1000);
      refreshTimer.unref?.();
    }
  },
};
