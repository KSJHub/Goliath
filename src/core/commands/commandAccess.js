const security = require('../security/protection/core');

function canAccessCommand(interaction, command) {
  if (!command) return false;

  const access = command.access || {};

  // 🔥 GOLIATH OWNER ALWAYS PASSES
  if (security.isBotOwner(interaction.user.id)) return true;

  // Owner-only commands
  if (access.ownerOnly) {
    return security.isBotOwner(interaction.user.id);
  }

  // Level-based access
  if (access.level) {
    return security.hasPermission(interaction, access.level);
  }

  return true;
}

async function enforceCommandAccess(interaction, command) {
  const access = command.access || {};

  // 🔥 GOLIATH OWNER ALWAYS PASSES
  if (security.isBotOwner(interaction.user.id)) return false;

  // OWNER ONLY
  if (access.ownerOnly) {
    await reply(interaction, '❌ This command is bot-owner only.');
    return true;
  }

  // LEVEL SYSTEM
  if (access.level) {
    const check = await security.enforceInteractionSecurity(interaction, {
      level: access.level,
      cooldownKey: `cmd:${interaction.commandName}`,
      cooldownMs: 2000,
      guildOnly: true,
    });

    if (!check.allowed) return true;
  }

  return false;
}

/* ---------------- SAFE REPLY ---------------- */

async function reply(interaction, content) {
  const payload = {
    content,
    embeds: [],
    components: [],
    flags: 64,
  };

  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(payload);
  }

  return interaction.reply(payload);
}

module.exports = {
  canAccessCommand,
  enforceCommandAccess,
};
