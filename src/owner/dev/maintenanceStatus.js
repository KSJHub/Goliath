'use strict';

const {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');

const CHANNEL_NAME = '🚨・goliath-status';
const CHANNEL_TOPIC = 'GOLIATH_TEMP_MAINTENANCE_STATUS:v1';
const RECOVERY_DELETE_DELAY_MS = 5 * 60 * 1000;
const activeTimers = new Map();
let shutdownInProgress = false;

function unixSeconds(value = Date.now()) {
  return Math.floor(Number(value) / 1000);
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 1) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  return `${minutes} minute${minutes === 1 ? '' : 's'} ${seconds} second${seconds === 1 ? '' : 's'}`;
}

function maintenanceEmbed(startedAt = Date.now(), reason = 'Scheduled maintenance') {
  return new EmbedBuilder()
    .setColor(0xED4245)
    .setTitle('🚨 GOLIATH SYSTEM NOTICE')
    .setDescription([
      '**MAINTENANCE IN PROGRESS**',
      '',
      'Goliath is going offline for maintenance.',
      'Commands, automations and other Goliath services may be temporarily unavailable.',
    ].join('\n'))
    .addFields(
      { name: '🔴 Status', value: 'Offline / Maintenance', inline: true },
      { name: '🤖 Service', value: 'Goliath', inline: true },
      { name: '🛠️ Reason', value: String(reason || 'Scheduled maintenance').slice(0, 1024), inline: false },
      { name: '🕒 Started', value: `<t:${unixSeconds(startedAt)}:F>\n<t:${unixSeconds(startedAt)}:R>`, inline: false },
    )
    .setFooter({ text: 'Goliath System Status • Automated Notice • No action is required' })
    .setTimestamp(startedAt);
}

function operationalEmbed(startedAt = Date.now(), restoredAt = Date.now()) {
  return new EmbedBuilder()
    .setColor(0x57F287)
    .setTitle('✅ GOLIATH SYSTEM NOTICE')
    .setDescription([
      '**ALL SYSTEMS OPERATIONAL**',
      '',
      'Goliath has successfully restarted and services have been restored.',
      'This temporary status channel will remove itself automatically.',
    ].join('\n'))
    .addFields(
      { name: '🟢 Status', value: 'Online', inline: true },
      { name: '🤖 Service', value: 'Goliath', inline: true },
      { name: '⏱️ Downtime', value: formatDuration(restoredAt - startedAt), inline: false },
      { name: '🕒 Restored', value: `<t:${unixSeconds(restoredAt)}:F>\n<t:${unixSeconds(restoredAt)}:R>`, inline: false },
    )
    .setFooter({ text: 'Goliath System Status • Automated Recovery Notice' })
    .setTimestamp(restoredAt);
}

function isMaintenanceChannel(channel) {
  return Boolean(
    channel
      && channel.type === ChannelType.GuildText
      && (channel.topic === CHANNEL_TOPIC || channel.name === CHANNEL_NAME)
  );
}

function findMaintenanceChannel(guild) {
  return guild?.channels?.cache?.find?.((channel) => isMaintenanceChannel(channel)) || null;
}

function buildPermissionOverwrites(guild) {
  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
  ];

  if (guild.ownerId) {
    overwrites.push({
      id: guild.ownerId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    });
  }

  for (const role of guild.roles.cache.values()) {
    if (role.id === guild.roles.everyone.id) continue;
    if (!role.permissions.has(PermissionFlagsBits.Administrator)) continue;
    overwrites.push({
      id: role.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    });
  }

  const me = guild.members.me;
  if (me?.id) {
    overwrites.push({
      id: me.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages,
      ],
    });
  }

  return overwrites;
}

async function ensureMaintenanceChannel(guild) {
  let channel = findMaintenanceChannel(guild);
  if (channel) return channel;

  channel = await guild.channels.create({
    name: CHANNEL_NAME,
    type: ChannelType.GuildText,
    topic: CHANNEL_TOPIC,
    reason: 'Goliath maintenance status channel',
    permissionOverwrites: buildPermissionOverwrites(guild),
  });

  await channel.setPosition(0, { reason: 'Keep Goliath maintenance notice visible near the top' }).catch(() => null);
  return channel;
}

async function findStatusMessage(channel) {
  const pinned = await channel.messages.fetchPinned().catch(() => null);
  const pinnedMessage = pinned?.find?.((message) => message.author?.id === channel.client.user?.id);
  if (pinnedMessage) return pinnedMessage;

  const recent = await channel.messages.fetch({ limit: 20 }).catch(() => null);
  return recent?.find?.((message) => message.author?.id === channel.client.user?.id) || null;
}

async function beginGuildMaintenance(guild, options = {}) {
  const startedAt = Number(options.startedAt || Date.now());
  const reason = options.reason || 'Scheduled maintenance';
  const channel = await ensureMaintenanceChannel(guild);
  let message = await findStatusMessage(channel);

  if (message) {
    await message.edit({ embeds: [maintenanceEmbed(startedAt, reason)] });
  } else {
    message = await channel.send({ embeds: [maintenanceEmbed(startedAt, reason)] });
  }

  await message.pin().catch(() => null);
  return { guildId: guild.id, channelId: channel.id, messageId: message.id, startedAt };
}

async function beginMaintenanceForAll(client, options = {}) {
  const startedAt = Number(options.startedAt || Date.now());
  const results = [];

  for (const guild of client?.guilds?.cache?.values?.() || []) {
    try {
      results.push({ ok: true, ...(await beginGuildMaintenance(guild, { ...options, startedAt })) });
    } catch (error) {
      console.warn(`[MaintenanceStatus] Could not start maintenance notice in ${guild?.id}:`, error?.message || error);
      results.push({ ok: false, guildId: guild?.id || null, error: error?.message || String(error) });
    }
  }

  return results;
}

function scheduleChannelDeletion(channel, delayMs = RECOVERY_DELETE_DELAY_MS) {
  const existing = activeTimers.get(channel.id);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(async () => {
    activeTimers.delete(channel.id);
    if (!isMaintenanceChannel(channel)) return;
    await channel.delete('Goliath maintenance completed').catch((error) => {
      console.warn(`[MaintenanceStatus] Could not delete recovered status channel ${channel.id}:`, error?.message || error);
    });
  }, Math.max(1000, Number(delayMs || RECOVERY_DELETE_DELAY_MS)));

  timer.unref?.();
  activeTimers.set(channel.id, timer);
}

async function recoverGuild(guild, options = {}) {
  const channel = findMaintenanceChannel(guild);
  if (!channel) return { ok: true, guildId: guild.id, found: false };

  const restoredAt = Number(options.restoredAt || Date.now());
  let message = await findStatusMessage(channel);
  let startedAt = restoredAt;

  if (message?.createdTimestamp) startedAt = message.createdTimestamp;

  if (message) {
    await message.edit({ embeds: [operationalEmbed(startedAt, restoredAt)] });
  } else {
    message = await channel.send({ embeds: [operationalEmbed(startedAt, restoredAt)] });
    await message.pin().catch(() => null);
  }

  scheduleChannelDeletion(channel, options.deleteDelayMs);
  return { ok: true, guildId: guild.id, found: true, channelId: channel.id, messageId: message.id };
}

async function recoverAll(client, options = {}) {
  const results = [];
  for (const guild of client?.guilds?.cache?.values?.() || []) {
    try {
      results.push(await recoverGuild(guild, options));
    } catch (error) {
      console.warn(`[MaintenanceStatus] Could not recover maintenance notice in ${guild?.id}:`, error?.message || error);
      results.push({ ok: false, guildId: guild?.id || null, error: error?.message || String(error) });
    }
  }
  return results;
}

async function completeGuildMaintenance(guild, options = {}) {
  return recoverGuild(guild, options);
}

async function deleteGuildMaintenanceChannel(guild) {
  const channel = findMaintenanceChannel(guild);
  if (!channel) return { ok: true, found: false, guildId: guild.id };
  const timer = activeTimers.get(channel.id);
  if (timer) clearTimeout(timer);
  activeTimers.delete(channel.id);
  await channel.delete('Goliath maintenance channel manually cleared');
  return { ok: true, found: true, guildId: guild.id, channelId: channel.id };
}

function wireProcessHandlers(client, options = {}) {
  const server = options.server || null;
  const exitAfterMs = Number(options.exitAfterMs || 8000);

  const shutdown = async (signal) => {
    if (shutdownInProgress) return;
    shutdownInProgress = true;
    console.log(`[MaintenanceStatus] ${signal} received. Publishing maintenance notices before shutdown.`);

    const forceTimer = setTimeout(() => process.exit(0), exitAfterMs);
    forceTimer.unref?.();

    try {
      await beginMaintenanceForAll(client, {
        reason: signal === 'SIGTERM' ? 'Goliath service restart / maintenance' : 'Goliath maintenance shutdown',
      });
    } catch (error) {
      console.error('[MaintenanceStatus] Shutdown notice failed:', error?.stack || error?.message || error);
    }

    try {
      if (server?.listening) {
        await new Promise((resolve) => server.close(() => resolve()));
      }
    } catch (error) {
      console.warn('[MaintenanceStatus] HTTP server close failed:', error?.message || error);
    }

    try { client?.destroy?.(); } catch {}
    clearTimeout(forceTimer);
    process.exit(0);
  };

  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.once('SIGINT', () => { void shutdown('SIGINT'); });

  return shutdown;
}

module.exports = {
  CHANNEL_NAME,
  CHANNEL_TOPIC,
  RECOVERY_DELETE_DELAY_MS,
  findMaintenanceChannel,
  beginGuildMaintenance,
  beginMaintenanceForAll,
  completeGuildMaintenance,
  deleteGuildMaintenanceChannel,
  recoverGuild,
  recoverAll,
  wireProcessHandlers,
};
