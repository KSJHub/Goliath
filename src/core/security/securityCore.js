const { PermissionFlagsBits, MessageFlags } = require('discord.js');
const { isDevOwnerHierarchyOverride } = require('../../owner/dev/DevOverrideManager');

const DEFAULT_COOLDOWN_MS = Number(process.env.SECURITY_COOLDOWN_MS || 2500);
const MAX_COOLDOWN_MS = 60 * 60 * 1000;
const MAX_COOLDOWN_ENTRIES = 5000;

const cooldowns = new Map();

const OWNER_IDS = (process.env.OWNER_IDS || '')
  .split(',')
  .map((id) => String(id).trim())
  .filter((id) => /^\d{15,25}$/.test(id));

function getBotOwnerIds() {
  return [...new Set(OWNER_IDS)];
}

function getBotOwnerId() {
  return OWNER_IDS[0] || null;
}

function isBotOwner(userId) {
  return OWNER_IDS.includes(String(userId));
}

function isGuildOwner(interaction) {
  return Boolean(
    interaction?.guild &&
      interaction?.user &&
      interaction.guild.ownerId === interaction.user.id
  );
}

function isDevOwnerHierarchyInteraction(interaction) {
  return isDevOwnerHierarchyOverride({
    guild: interaction?.guild,
    member: interaction?.member,
    user: interaction?.user,
  });
}

function isDevOwnerHierarchyTarget(guild, targetMember) {
  return isDevOwnerHierarchyOverride({
    guild,
    member: targetMember,
    user: targetMember?.user,
    userId: targetMember?.id,
  });
}

function hasPermission(interaction, level = 'mod') {
  if (!interaction?.user) return false;

  if (isBotOwner(interaction.user.id)) return true;

  if (!interaction.guild || !interaction.member) return false;

  const member = interaction.member;
  const permissions = member.permissions;

  switch (level) {
    case 'botOwner':
      return isBotOwner(interaction.user.id);

    case 'guildOwner':
      return isGuildOwner(interaction);

    case 'owner':
      return isBotOwner(interaction.user.id) || isGuildOwner(interaction);

    case 'admin':
      return (
        isGuildOwner(interaction) ||
        permissions?.has(PermissionFlagsBits.Administrator)
      );

    case 'mod':
      return (
        isGuildOwner(interaction) ||
        permissions?.has(PermissionFlagsBits.Administrator) ||
        permissions?.has(PermissionFlagsBits.ModerateMembers) ||
        permissions?.has(PermissionFlagsBits.KickMembers) ||
        permissions?.has(PermissionFlagsBits.BanMembers) ||
        permissions?.has(PermissionFlagsBits.ManageMessages)
      );

    default:
      return false;
  }
}

function canModerateTarget(interaction, targetMember) {
  if (!interaction?.guild || !interaction?.member || !targetMember) {
    return {
      allowed: false,
      reason: 'Missing guild, moderator, or target member.',
    };
  }

  const guild = interaction.guild;
  const moderator = interaction.member;
  const botMember = guild.members.me;
  const hierarchyOverride =
    isDevOwnerHierarchyInteraction(interaction) ||
    isDevOwnerHierarchyTarget(guild, targetMember);

  if (isBotOwner(interaction.user.id)) {
    return {
      allowed: true,
      reason: null,
    };
  }

  if (!hierarchyOverride && targetMember.id === guild.ownerId) {
    return {
      allowed: false,
      reason: 'You cannot moderate the server owner.',
    };
  }

  if (!hierarchyOverride && targetMember.id === interaction.user.id) {
    return {
      allowed: false,
      reason: 'You cannot moderate yourself.',
    };
  }

  if (botMember && targetMember.id === botMember.id) {
    return {
      allowed: false,
      reason: 'You cannot moderate the bot.',
    };
  }

  const moderatorHighest = moderator.roles?.highest?.position ?? 0;
  const targetHighest = targetMember.roles?.highest?.position ?? 0;
  const botHighest = botMember?.roles?.highest?.position ?? 0;

  if (!hierarchyOverride && moderator.id !== guild.ownerId && moderatorHighest <= targetHighest) {
    return {
      allowed: false,
      reason: 'That user has an equal or higher role than you.',
    };
  }

  if (!hierarchyOverride && botMember && botHighest <= targetHighest) {
    return {
      allowed: false,
      reason: 'That user has an equal or higher role than the bot.',
    };
  }

  return {
    allowed: true,
    reason: null,
    hierarchyOverride,
  };
}

function normalizeCooldownMs(ms = DEFAULT_COOLDOWN_MS) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_COOLDOWN_MS;
  return Math.min(Math.floor(value), MAX_COOLDOWN_MS);
}

function pruneCooldowns(now = Date.now()) {
  if (cooldowns.size <= MAX_COOLDOWN_ENTRIES) return;

  for (const [key, expiresAt] of cooldowns.entries()) {
    if (expiresAt <= now || cooldowns.size > MAX_COOLDOWN_ENTRIES) {
      cooldowns.delete(key);
    }

    if (cooldowns.size <= MAX_COOLDOWN_ENTRIES) break;
  }
}

function checkCooldown(userId, key = 'global', ms = DEFAULT_COOLDOWN_MS) {
  const safeUserId = String(userId || '');
  const safeKey = String(key || 'global').slice(0, 120);
  const cooldownMs = normalizeCooldownMs(ms);

  if (!safeUserId) {
    return {
      allowed: false,
      remainingMs: cooldownMs,
    };
  }

  if (isBotOwner(safeUserId)) {
    return {
      allowed: true,
      remainingMs: 0,
    };
  }

  const now = Date.now();
  pruneCooldowns(now);

  const cooldownKey = `${safeUserId}:${safeKey}`;
  const expiresAt = cooldowns.get(cooldownKey) || 0;

  if (expiresAt > now) {
    return {
      allowed: false,
      remainingMs: expiresAt - now,
    };
  }

  cooldowns.set(cooldownKey, now + cooldownMs);

  return {
    allowed: true,
    remainingMs: 0,
  };
}

async function safeDeny(interaction, message) {
  if (!interaction) return null;

  const payload = {
    content: message,
    embeds: [],
    components: [],
    flags: MessageFlags.Ephemeral,
  };

  try {
    if (interaction.deferred || interaction.replied) {
      return await interaction.editReply(payload);
    }

    return await interaction.reply(payload);
  } catch (error) {
    console.warn('[SecurityCore] Failed to send denial response:', error?.message || error);
    return null;
  }
}

async function enforceInteractionSecurity(interaction, options = {}) {
  const {
    level = null,
    cooldownKey = null,
    cooldownMs = DEFAULT_COOLDOWN_MS,
    guildOnly = true,
    ownerOnly = false,
    allowGuildOwner = true,
  } = options;

  if (!interaction?.user) {
    return {
      allowed: false,
      reason: 'Invalid interaction.',
    };
  }

  if (guildOnly && !interaction.guild) {
    await safeDeny(interaction, '❌ This can only be used inside a server.');

    return {
      allowed: false,
      reason: 'Guild only.',
    };
  }

  if (ownerOnly) {
    const allowed =
      isBotOwner(interaction.user.id) ||
      (allowGuildOwner && isGuildOwner(interaction));

    if (!allowed) {
      await safeDeny(
        interaction,
        '❌ Only the Goliath Owner or Guild Owner can do this.'
      );

      return {
        allowed: false,
        reason: 'Owner only.',
      };
    }
  }

  if (level && !hasPermission(interaction, level)) {
    await safeDeny(interaction, '❌ You do not have permission to do this.');

    return {
      allowed: false,
      reason: `Missing permission level: ${level}`,
    };
  }

  if (cooldownKey) {
    const cooldown = checkCooldown(interaction.user.id, cooldownKey, cooldownMs);

    if (!cooldown.allowed) {
      const seconds = Math.ceil(cooldown.remainingMs / 1000);

      await safeDeny(interaction, `⏱️ Slow down. Try again in ${seconds}s.`);

      return {
        allowed: false,
        reason: 'Cooldown active.',
        remainingMs: cooldown.remainingMs,
      };
    }
  }

  return {
    allowed: true,
    reason: null,
  };
}

function canUseRestore(interaction) {
  if (!interaction?.user) {
    return {
      allowed: false,
      reason: 'Invalid restore request.',
    };
  }

  if (isBotOwner(interaction.user.id)) {
    return {
      allowed: true,
      level: 'BOT_OWNER',
    };
  }

  return {
    allowed: false,
    reason: 'Only the Goliath Owner can use restore systems.',
  };
}

function checkRestoreCooldown(guildId) {
  return checkCooldown(
    String(guildId),
    'server_restore',
    Number(process.env.RESTORE_COOLDOWN_MS || 10 * 60 * 1000)
  );
}

function validateBotHierarchy(guild) {
  if (!guild?.members?.me) {
    return {
      valid: false,
      reason: 'Bot member not found.',
    };
  }

  const botMember = guild.members.me;

  if (botMember.roles.highest.position <= 1) {
    return {
      valid: false,
      reason: 'Bot role is too low in hierarchy.',
    };
  }

  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return {
      valid: false,
      reason: 'Bot is missing ManageRoles permission.',
    };
  }

  if (!botMember.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return {
      valid: false,
      reason: 'Bot is missing ManageChannels permission.',
    };
  }

  return {
    valid: true,
    reason: null,
  };
}

function hasDangerousPermissions(member) {
  if (!member?.permissions) return false;

  return (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild) ||
    member.permissions.has(PermissionFlagsBits.ManageRoles) ||
    member.permissions.has(PermissionFlagsBits.ManageChannels) ||
    member.permissions.has(PermissionFlagsBits.BanMembers) ||
    member.permissions.has(PermissionFlagsBits.KickMembers) ||
    member.permissions.has(PermissionFlagsBits.ManageWebhooks)
  );
}

function canManageTargetRole(guild, role, actor = null) {
  if (!guild?.members?.me || !role) {
    return {
      allowed: false,
      reason: 'Invalid guild or role.',
    };
  }

  const hierarchyOverride = isDevOwnerHierarchyOverride({
    guild,
    member: actor,
    user: actor?.user || actor,
    userId: actor?.id,
  });

  const botHighest = guild.members.me.roles.highest.position;

  if (role.managed) {
    return {
      allowed: false,
      reason: 'Cannot manage integration roles.',
    };
  }

  if (!hierarchyOverride && role.position >= botHighest) {
    return {
      allowed: false,
      reason: 'Role is above bot hierarchy.',
    };
  }

  return {
    allowed: true,
    reason: null,
    hierarchyOverride,
  };
}

function canManageTargetMember(guild, targetMember) {
  if (!guild?.members?.me || !targetMember) {
    return { allowed: false, reason: 'Invalid guild or target member.' };
  }

  const hierarchyOverride = isDevOwnerHierarchyTarget(guild, targetMember);

  if (!hierarchyOverride && isBotOwner(targetMember.id)) {
    return { allowed: false, reason: 'Cannot manage the Goliath owner.' };
  }

  if (!hierarchyOverride && targetMember.id === guild.ownerId) {
    return { allowed: false, reason: 'Cannot manage server owner.' };
  }

  const botHighest = guild.members.me.roles.highest.position;
  const targetHighest = targetMember.roles.highest.position;

  if (!hierarchyOverride && targetHighest >= botHighest) {
    return { allowed: false, reason: 'Target is above bot hierarchy.' };
  }

  return { allowed: true, reason: null, hierarchyOverride };
}

module.exports = {
  PermissionFlagsBits,

  getBotOwnerIds,
  getBotOwnerId,
  isBotOwner,
  isGuildOwner,
  isDevOwnerHierarchyInteraction,
  isDevOwnerHierarchyTarget,
  hasPermission,
  canModerateTarget,
  checkCooldown,
  enforceInteractionSecurity,
  safeDeny,

  canUseRestore,
  checkRestoreCooldown,

  validateBotHierarchy,
  hasDangerousPermissions,
  canManageTargetRole,
  canManageTargetMember,
};
