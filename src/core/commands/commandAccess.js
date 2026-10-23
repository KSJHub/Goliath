const security = require('../security/protection/core');
 
// Resolve configured guild authority before falling back to legacy Discord levels.
// Lazy loading avoids a dependency cycle with administration command modules.
function configuredCommandPermission(interaction, access) {
  if (!interaction?.guild || !interaction?.member || access.ownerOnly) return null;
  const key = access.permissionKey || (access.level === 'mod' ? 'mod.panel.view' : null);
  if (!key) return null;
  const panel = require('../administration/admin/panel');
  const context = panel.getAuthorityContext(interaction);
  if (!context || context.source === 'legacy' || context.source === 'none') return null;
  return panel.hasGuildPermission(interaction, key);
}


function canAccessCommand(interaction, command) {
  if (!command) return false;

  const access = command.access || {};

  // 🔥 GOLIATH OWNER ALWAYS PASSES
  if (security.isBotOwner(interaction.user.id)) return true;

  // Owner-only commands
  if (access.ownerOnly) {
    return security.isBotOwner(interaction.user.id);
  }

  const configured = configuredCommandPermission(interaction, access);
  if (configured !== null) return configured;

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

  const configured = configuredCommandPermission(interaction, access);
  if (configured !== null) {
    if (!configured) {
      await reply(interaction, '❌ You do not have permission to use this command.');
      return true;
    }
    return false;
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
