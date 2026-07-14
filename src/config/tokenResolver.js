'use strict';

function resolveToken(config = {}) {
  return config?.token || process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN || process.env.TOKEN || null;
}

module.exports = { resolveToken };
