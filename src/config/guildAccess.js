'use strict';

const { normalizeBotMode } = require('./botModes');

function getEnvList(name) {
  const value = process.env[name];

  if (!value) return [];

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normaliseModeConfig(modeConfig) {
  return modeConfig && typeof modeConfig === 'object' ? modeConfig : {};
}

function getAllowedGuildIds(botMode = process.env.BOT_MODE) {
  const safeBotMode = normalizeBotMode(botMode);

  if (safeBotMode === 'DEV') {
    return [...new Set([
      ...getEnvList('DEV_GUILD_IDS'),
      ...getEnvList('DEV_GUILD_ID'),
    ])];
  }

  if (safeBotMode === 'BETA') {
    return getEnvList('BETA_GUILD_IDS');
  }

  if (safeBotMode === 'PRODUCTION') {
    return [...new Set([
      ...getEnvList('PRODUCTION_GUILD_IDS'),
      ...getEnvList('PRODUCTION_GUILD_ID'),
    ])];
  }

  return [];
}

function isGuildAllowed(guildId, botMode, modeConfig) {
  const safeConfig = normaliseModeConfig(modeConfig);

  if (!safeConfig.strictGuildAccess) {
    return true;
  }

  const allowedGuildIds = getAllowedGuildIds(botMode);

  if (!allowedGuildIds.length) {
    return true;
  }

  return allowedGuildIds.includes(String(guildId));
}

async function enforceGuildAccess(guild, botMode = process.env.BOT_MODE, modeConfig) {
  if (!guild) return false;

  const safeConfig = normaliseModeConfig(modeConfig);
  const safeBotMode = normalizeBotMode(botMode);

  if (!safeConfig.strictGuildAccess) {
    return true;
  }

  const allowedGuildIds = getAllowedGuildIds(safeBotMode);

  console.log('====================================');
  console.log('[Guild Access Debug]');
  console.log('Bot Mode:', safeBotMode);
  console.log('Guild Name:', guild.name);
  console.log('Guild ID:', guild.id);
  console.log('Allowed Guild IDs:', allowedGuildIds);
  console.log('====================================');

  if (!allowedGuildIds.length) {
    console.warn(
      `⚠️ ${safeBotMode} mode has strict guild access enabled, but no allowed guild IDs are configured.`
    );
    return true;
  }

  if (allowedGuildIds.includes(String(guild.id))) {
    console.log(`✅ Authorized guild: ${guild.name} (${guild.id})`);
    return true;
  }

  console.warn(
    `🚫 ${safeBotMode} bot was added to unauthorized guild: ${guild.name} (${guild.id})`
  );

  try {
    await guild.leave();
    console.warn(`👋 Left unauthorized guild: ${guild.name} (${guild.id})`);
  } catch (err) {
    console.error(
      `❌ Failed to leave unauthorized guild: ${guild.name} (${guild.id})`
    );
    console.error(err);
  }

  return false;
}

async function enforceCurrentGuilds(client, botMode, modeConfig) {
  if (!client?.guilds?.cache) return;

  const safeConfig = normaliseModeConfig(modeConfig);

  if (!safeConfig.strictGuildAccess) {
    return;
  }

  for (const guild of client.guilds.cache.values()) {
    await enforceGuildAccess(guild, botMode, safeConfig);
  }
}

module.exports = {
  getAllowedGuildIds,
  isGuildAllowed,
  enforceGuildAccess,
  enforceCurrentGuilds,
};
