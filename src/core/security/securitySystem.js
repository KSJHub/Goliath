// src/security/securitySystem.js

const {
  AuditLogEvent,
  PermissionsBitField,
  PermissionFlagsBits,
  MessageFlags,
  EmbedBuilder,
  WebhookClient,
} = require('discord.js');

const guildManager = require('../guild/guildManager');
const schedulerRegistry = require('../../owner/sentinel/schedulerRegistry');

const {
  enableLockdown,
  getLockdownState,
} = require('./lockdownSystem');

// ======================================================
// CORE CONSTANTS
// ======================================================

const DEFAULT_COOLDOWN_MS =
  Number(
    process.env.SECURITY_COOLDOWN_MS || 2500
  );

const OWNER_SECURITY_WEBHOOK_URL = String(
  process.env.OWNER_SECURITY_WEBHOOK_URL || ''
).trim();

const QUARANTINE_ROLE_NAME =
  'Goliath Quarantine';

// ======================================================
// OWNERS
// ======================================================

const OWNER_IDS = (
  process.env.OWNER_IDS || ''
)
  .split(',')
  .map((id) => String(id).trim())
  .filter(Boolean);

// ======================================================
// RUNTIME STATE
// ======================================================

const cooldowns = new Map();

const actionBuckets = new Map();

let ownerWebhookClient = null;

// ======================================================
// SECURITY CONSTANTS
// ======================================================

const SEVERITY = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
};

function calculateIncidentSeverity(type, metadata = {}) {
  let score = 0;

  if (type.includes('mass')) score += 40;
  if (type.includes('delete')) score += 25;
  if (type.includes('webhook')) score += 20;
  if (type.includes('dangerous_role')) score += 30;
  if (type.includes('lockdown')) score += 50;

  score += Number(metadata.actionCount || 0) * 10;
  score += Number(metadata.dangerousPermissionCount || 0) * 15;

  if (metadata.actorIsBot) score += 10;
  if (metadata.actorTrusted === false) score += 15;
  if (metadata.rollbackAvailable === false) score += 20;

  let severity = SEVERITY.LOW;

  if (score >= 80) {
    severity = SEVERITY.CRITICAL;
  } else if (score >= 50) {
    severity = SEVERITY.HIGH;
  } else if (score >= 25) {
    severity = SEVERITY.MEDIUM;
  }

  return {
    score,
    severity,
    recommendedActions: getRecommendedIncidentActions(
      score,
      type,
      metadata
    ),
  };
}

function getRecommendedIncidentActions(
  score,
  type,
  metadata = {}
) {
  const actions = [];

  if (score >= 25) {
    actions.push('Log incident');
  }

  if (score >= 50) {
    actions.push('Notify guild owner');
  }

  if (score >= 60) {
    actions.push('Create emergency backup');
  }

  if (score >= 70) {
    actions.push('Quarantine actor');
  }

  if (score >= 80) {
    actions.push('Enable emergency lockdown');
  }

  if (type.includes('webhook')) {
    actions.push('Review webhooks');
  }

  if (metadata.dangerousPermissionCount > 0) {
    actions.push('Review dangerous permissions');
  }

  return [...new Set(actions)];
}

const INCIDENT_TYPES = {
  CHANNEL_DELETE: 'channel_delete',
  ROLE_DELETE: 'role_delete',

  MASS_CHANNEL_DELETE:
    'mass_channel_delete',

  MASS_ROLE_DELETE:
    'mass_role_delete',

  LOCKDOWN_ENABLED:
    'lockdown_enabled',

  LOCKDOWN_DISABLED:
    'lockdown_disabled',

  LOCKDOWN_RECOVERY_RESTORED:
    'lockdown_recovery_restored',

  EMERGENCY_LOCKDOWN:
    'emergency_lockdown',

  MEMBER_QUARANTINED:
    'member_quarantined',

  DANGEROUS_ROLE_PERMISSION_ADDED:
    'dangerous_role_permission_added',

  DANGEROUS_ROLE_PERMISSION_REMOVED:
    'dangerous_role_permission_removed',

  DANGEROUS_ROLE_CREATE:
    'dangerous_role_create',

  WEBHOOK_UPDATE:
    'webhook_update',

  WEBHOOK_CREATE:
    'webhook_create',

  WEBHOOK_DELETE:
    'webhook_delete',

  SUSPICIOUS_WEBHOOK_ACTIVITY:
    'suspicious_webhook_activity',

  OWNER_ESCALATION:
    'owner_escalation',

  BACKUP_CREATED:
    'backup_created',

  RESTORE_ACTION:
    'restore_action',

  SUSPICIOUS_ADMIN_ACTION:
    'suspicious_admin_action',
};

// ======================================================
// ANTI NUKE DEFAULT CONFIG
// ======================================================

const DEFAULT_CONFIG = {
  enabled: true,

  thresholds: {
    channelDelete: {
      maxActions: 3,
      windowMs: 30000,
    },

    roleDelete: {
      maxActions: 3,
      windowMs: 30000,
    },
  },

  lockdown: {
    enabled: true,
    reason:
      'Goliath Anti-Nuke emergency lockdown triggered.',
  },

  quarantine: {
    enabled: true,
    roleName:
      QUARANTINE_ROLE_NAME,

    reason:
      'Goliath Anti-Nuke quarantine triggered.',
  },

  ownerAlerts: {
    enabled: true,
  },

  backups: {
    beforeIncident: true,
    afterIncident: true,
  },

  trustedUserIds: [],
  trustedRoleIds: [],
  ignoreBots: false,
};

// ======================================================
// CLEANUP LOOP
// ======================================================

const SECURITY_CLEANUP_INTERVAL_MS = 60_000;
const SECURITY_CLEANUP_SCHEDULER_ID = schedulerRegistry.register({
  module: 'security',
  component: 'action-bucket-cleanup',
  intervalMs: SECURITY_CLEANUP_INTERVAL_MS,
  staleAfterMs: SECURITY_CLEANUP_INTERVAL_MS * 3,
});

const securityCleanupTimer = setInterval(() => {
  try {
    const now = Date.now();
    const before = actionBuckets.size;

    for (const [
      key,
      timestamps,
    ] of actionBuckets.entries()) {
      const fresh =
        timestamps.filter(
          (timestamp) =>
            now - timestamp <
            SECURITY_CLEANUP_INTERVAL_MS
        );

      if (fresh.length) {
        actionBuckets.set(
          key,
          fresh
        );
      } else {
        actionBuckets.delete(
          key
        );
      }
    }

    schedulerRegistry.beat(SECURITY_CLEANUP_SCHEDULER_ID, {
      bucketsBefore: before,
      bucketsAfter: actionBuckets.size,
      bucketsRemoved: Math.max(0, before - actionBuckets.size),
    });
  } catch (error) {
    schedulerRegistry.fail(SECURITY_CLEANUP_SCHEDULER_ID, error, {
      buckets: actionBuckets.size,
    });
    console.warn('[SecuritySystem] Action bucket cleanup failed:', error?.message || error);
  }
}, SECURITY_CLEANUP_INTERVAL_MS);
securityCleanupTimer.unref?.();

// ======================================================
// UTILITIES
// ======================================================

function safeString(
  value,
  fallback = 'Unknown'
) {
  if (
    value === null ||
    value === undefined
  ) {
    return fallback;
  }

  return String(value);
}

function createIncidentId() {
  return `inc_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function getSeverityColor(
  severity
) {
  switch (severity) {
    case SEVERITY.CRITICAL:
      return 0xff0000;

    case SEVERITY.HIGH:
      return 0xff7a00;

    case SEVERITY.MEDIUM:
      return 0xffcc00;

    case SEVERITY.LOW:
    default:
      return 0x5865f2;
  }
}

function getThreatLevelFromSeverity(
  severity
) {
  switch (severity) {
    case SEVERITY.CRITICAL:
      return 'critical';

    case SEVERITY.HIGH:
      return 'high';

    case SEVERITY.MEDIUM:
      return 'medium';

    case SEVERITY.LOW:
    default:
      return 'low';
  }
}

// ======================================================
// SECURITY CORE
// ======================================================

function getBotOwnerIds() {
  return [...new Set(OWNER_IDS)];
}

function getBotOwnerId() {
  return OWNER_IDS[0] || null;
}

function isBotOwner(userId) {
  return OWNER_IDS.includes(
    String(userId)
  );
}

function isGuildOwner(
  interaction
) {
  return Boolean(
    interaction?.guild &&
      interaction?.user &&
      interaction.guild
        .ownerId ===
        interaction.user.id
  );
}

function hasPermission(
  interaction,
  level = 'mod'
) {
  if (!interaction?.user)
    return false;

  if (
    isBotOwner(
      interaction.user.id
    )
  ) {
    return true;
  }

  if (
    !interaction.guild ||
    !interaction.member
  ) {
    return false;
  }

  const permissions =
    interaction.member
      .permissions;

  switch (level) {
    case 'botOwner':
      return isBotOwner(
        interaction.user.id
      );

    case 'guildOwner':
      return isGuildOwner(
        interaction
      );

    case 'owner':
      return (
        isBotOwner(
          interaction.user.id
        ) ||
        isGuildOwner(
          interaction
        )
      );

    case 'admin':
      return (
        isGuildOwner(
          interaction
        ) ||
        permissions?.has(
          PermissionFlagsBits.Administrator
        )
      );

    case 'mod':
      return (
        isGuildOwner(
          interaction
        ) ||
        permissions?.has(
          PermissionFlagsBits.Administrator
        ) ||
        permissions?.has(
          PermissionFlagsBits.ModerateMembers
        ) ||
        permissions?.has(
          PermissionFlagsBits.KickMembers
        ) ||
        permissions?.has(
          PermissionFlagsBits.BanMembers
        ) ||
        permissions?.has(
          PermissionFlagsBits.ManageMessages
        )
      );

    default:
      return false;
  }
}

function checkCooldown(
  userId,
  key = 'global',
  ms = DEFAULT_COOLDOWN_MS
) {
  const safeUserId =
    String(userId || '');

  const safeKey =
    String(key || 'global');

  const cooldownMs =
    Number(
      ms ||
        DEFAULT_COOLDOWN_MS
    );

  if (!safeUserId) {
    return {
      allowed: false,
      remainingMs:
        cooldownMs,
    };
  }

  if (
    isBotOwner(safeUserId)
  ) {
    return {
      allowed: true,
      remainingMs: 0,
    };
  }

  const now = Date.now();

  const cooldownKey =
    `${safeUserId}:${safeKey}`;

  const expiresAt =
    cooldowns.get(
      cooldownKey
    ) || 0;

  if (expiresAt > now) {
    return {
      allowed: false,
      remainingMs:
        expiresAt - now,
    };
  }

  cooldowns.set(
    cooldownKey,
    now + cooldownMs
  );

  return {
    allowed: true,
    remainingMs: 0,
  };
}

async function safeDeny(
  interaction,
  message
) {
  if (!interaction)
    return null;

  const payload = {
    content: message,
    embeds: [],
    components: [],
    flags:
      MessageFlags.Ephemeral,
  };

  if (
    interaction.deferred ||
    interaction.replied
  ) {
    return interaction.editReply(
      payload
    );
  }

  return interaction.reply(
    payload
  );
}

function validateBotHierarchy(
  guild
) {
  if (
    !guild?.members?.me
  ) {
    return {
      valid: false,
      reason:
        'Bot member not found.',
    };
  }

  const botMember =
    guild.members.me;

  if (
    botMember.roles.highest
      .position <= 1
  ) {
    return {
      valid: false,
      reason:
        'Bot role is too low in hierarchy.',
    };
  }

  if (
    !botMember.permissions.has(
      PermissionFlagsBits.ManageRoles
    )
  ) {
    return {
      valid: false,
      reason:
        'Bot missing ManageRoles.',
    };
  }

  if (
    !botMember.permissions.has(
      PermissionFlagsBits.ManageChannels
    )
  ) {
    return {
      valid: false,
      reason:
        'Bot missing ManageChannels.',
    };
  }

  return {
    valid: true,
    reason: null,
  };
}

function hasDangerousPermissions(
  member
) {
  if (
    !member?.permissions
  ) {
    return false;
  }

  return (
    member.permissions.has(
      PermissionFlagsBits.Administrator
    ) ||
    member.permissions.has(
      PermissionFlagsBits.ManageGuild
    ) ||
    member.permissions.has(
      PermissionFlagsBits.ManageRoles
    ) ||
    member.permissions.has(
      PermissionFlagsBits.ManageChannels
    ) ||
    member.permissions.has(
      PermissionFlagsBits.BanMembers
    ) ||
    member.permissions.has(
      PermissionFlagsBits.KickMembers
    ) ||
    member.permissions.has(
      PermissionFlagsBits.ManageWebhooks
    )
  );
}

function canManageTargetMember(
  guild,
  targetMember
) {
  if (
    !guild?.members?.me ||
    !targetMember
  ) {
    return {
      allowed: false,
      reason:
        'Invalid guild or target member.',
    };
  }

  if (
    isBotOwner(
      targetMember.id
    )
  ) {
    return {
      allowed: false,
      reason:
        'Cannot manage Goliath owner.',
    };
  }

  if (
    targetMember.id ===
    guild.ownerId
  ) {
    return {
      allowed: false,
      reason:
        'Cannot manage server owner.',
    };
  }

  const botHighest =
    guild.members.me.roles
      .highest.position;

  const targetHighest =
    targetMember.roles
      .highest.position;

  if (
    targetHighest >=
    botHighest
  ) {
    return {
      allowed: false,
      reason:
        'Target is above bot hierarchy.',
    };
  }

  return {
    allowed: true,
    reason: null,
  };
}

// ======================================================
// INCIDENT LOGGER
// ======================================================

function resolveSecurityLogChannelId(
  guildId
) {
  const security =
    guildManager.getGuildSection(
      guildId,
      'security',
      {}
    );

  const logs =
    guildManager.getGuildSection(
      guildId,
      'logs',
      {}
    );

  return (
    security
      ?.incidentLogChannelId ||
    security
      ?.securityLogChannelId ||
    logs?.channels?.admin ||
    logs?.channels
      ?.moderation ||
    logs?.channels
      ?.general ||
    logs?.adminLogChannelId ||
    logs?.modLogChannelId ||
    logs?.logsChannelId ||
    null
  );
}

function readIncidents(
  guildId
) {
  try {
    const security =
      guildManager.getGuildSection(
        guildId,
        'security',
        {}
      );

    return Array.isArray(
      security.incidents
    )
      ? security.incidents
      : [];
  } catch {
    return [];
  }
}

function writeIncidents(
  guildId,
  incidents = [],
  options = {}
) {
  try {
    const security =
      guildManager.getGuildSection(
        guildId,
        'security',
        {}
      );

    const maxStored =
      Number(
        options.maxStored ||
          250
      );

    guildManager.saveGuildSection(
      guildId,
      'security',
      {
        ...security,
        incidents:
          incidents.slice(
            0,
            maxStored
          ),
      }
    );

    return true;
  } catch {
    return false;
  }
}

function buildIncidentEmbed(
  incident,
  options = {}
) {
  const severity =
    safeString(
      incident.severity,
      SEVERITY.LOW
    ).toUpperCase();

  const embed =
    new EmbedBuilder()
      .setColor(
        getSeverityColor(
          incident.severity
        )
      )
      .setTitle(
        options.ownerMirror
          ? '🚨 Goliath Security Network Alert'
          : '🚨 Security Incident Logged'
      )
      .setDescription(
        `**Type:** \`${incident.type}\`\n**Severity:** \`${severity}\``
      )
      .setTimestamp(
        new Date(
          incident.createdAt
        )
      );

  return embed;
}

async function logIncident(
  guild,
  options = {}
) {
  const guildId =
    safeString(
      options.guildId ||
        guild?.id
    );

  const guildName =
    safeString(
      options.guildName ||
        guild?.name
    );

  const incident = {
    id:
      options.id ||
      createIncidentId(),

    type:
      options.type ||
      'unknown_security_incident',

    severity:
      options.severity ||
      SEVERITY.LOW,

    guildId,
    guildName,

    actorId:
      options.actorId ||
      null,

    actorTag:
      options.actorTag ||
      null,

    targetId:
      options.targetId ||
      null,

    targetName:
      options.targetName ||
      null,

    targetType:
      options.targetType ||
      null,

    reason:
      options.reason ||
      null,

    actionTaken:
      options.actionTaken ||
      null,

    metadata:
      options.metadata ||
      {},

    createdAt:
      options.createdAt ||
      new Date().toISOString(),
  };

  const current =
    readIncidents(guildId);

  writeIncidents(
    guildId,
    [incident, ...current]
  );

  return incident;
}

// ======================================================
// ANTI NUKE
// ======================================================

function getAntiNukeConfig(
  guildId
) {
  const saved =
    guildManager.getGuildSection(
      guildId,
      'antiNuke',
      {}
    );

  return {
    ...DEFAULT_CONFIG,
    ...saved,
  };
}

function bucketKey(
  guildId,
  userId,
  actionType
) {
  return `${guildId}:${userId}:${actionType}`;
}

function addAction(
  guildId,
  userId,
  actionType,
  windowMs
) {
  const key = bucketKey(
    guildId,
    userId,
    actionType
  );

  const now = Date.now();

  const existing =
    actionBuckets.get(
      key
    ) || [];

  const fresh =
    existing.filter(
      (timestamp) =>
        now - timestamp <=
        windowMs
    );

  fresh.push(now);

  actionBuckets.set(
    key,
    fresh
  );

  return fresh.length;
}

async function fetchAuditExecutor(
  guild,
  auditType
) {
  try {
    const logs =
      await guild.fetchAuditLogs(
        {
          type: auditType,
          limit: 1,
        }
      );

    const entry =
      logs.entries.first();

    if (!entry)
      return null;

    const recent =
      Date.now() -
        entry.createdTimestamp <
      8000;

    if (!recent)
      return null;

    return {
      id:
        entry.executor?.id ||
        null,

      tag:
        entry.executor?.tag ||
        null,

      bot: Boolean(
        entry.executor?.bot
      ),

      entry,
    };
  } catch {
    return null;
  }
}

async function emergencyLockdown(
  guild,
  reason
) {
  if (!guild)
    return false;

  const current =
    getLockdownState(
      guild.id
    );

  if (current.active) {
    return false;
  }

  const result =
    await enableLockdown(
      guild,
      {
        reason:
          reason ||
          'Emergency lockdown.',

        enabledBy:
          'anti_nuke',

        enabledByTag:
          'Goliath Anti-Nuke',
      }
    );

  if (!result.success) {
    return false;
  }

  await logIncident(
    guild,
    {
      type:
        INCIDENT_TYPES.EMERGENCY_LOCKDOWN,

      severity:
        SEVERITY.CRITICAL,

      reason,

      actionTaken:
        'Emergency lockdown enabled.',
    }
  );

  return true;
}

// ======================================================
// EXPORTS
// ======================================================

module.exports = {
  // constants
  SEVERITY,
  INCIDENT_TYPES,
  DEFAULT_CONFIG,
  QUARANTINE_ROLE_NAME,

  // security core
  PermissionFlagsBits,

  getBotOwnerIds,
  getBotOwnerId,
  isBotOwner,
  isGuildOwner,

  hasPermission,
  checkCooldown,
  safeDeny,

  validateBotHierarchy,
  hasDangerousPermissions,
  canManageTargetMember,

  // incident logger
  logIncident,
  readIncidents,
  writeIncidents,
  buildIncidentEmbed,

  // anti nuke
  getAntiNukeConfig,
  fetchAuditExecutor,

  emergencyLockdown,
  addAction,
  calculateIncidentSeverity,
  getRecommendedIncidentActions,
};
