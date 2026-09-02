'use strict';

const core = require('./core');
const audit = require('./audit');
const events = require('./events');
const { enableLockdown, getLockdownState } = require('./lockdown');
const guildManager = require('../../guild/guildManager');

const QUARANTINE_ROLE_NAME = 'Goliath Quarantine';

const DEFAULT_CONFIG = {
  enabled: true,
  thresholds: {
    channelDelete: { maxActions: 3, windowMs: 30000 },
    roleDelete: { maxActions: 3, windowMs: 30000 },
  },
  lockdown: {
    enabled: true,
    reason: 'Goliath Anti-Nuke emergency lockdown triggered.',
  },
  quarantine: {
    enabled: true,
    roleName: QUARANTINE_ROLE_NAME,
    reason: 'Goliath Anti-Nuke quarantine triggered.',
  },
  ownerAlerts: { enabled: true },
  backups: { beforeIncident: true, afterIncident: true },
  trustedUserIds: [],
  trustedRoleIds: [],
  ignoreBots: false,
};

function getAntiNukeConfig(guildId) {
  const saved = guildManager.getGuildSection(guildId, 'antiNuke', {});
  return {
    ...DEFAULT_CONFIG,
    ...saved,
  };
}

async function emergencyLockdown(guild, reason) {
  if (!guild) return false;
  const current = getLockdownState(guild.id);
  if (current.active) return false;

  const result = await enableLockdown(guild, {
    reason: reason || 'Emergency lockdown.',
    enabledBy: 'anti_nuke',
    enabledByTag: 'Goliath Anti-Nuke',
  });

  if (!result.success) return false;

  await audit.logIncident(guild, {
    type: events.INCIDENT_TYPES.EMERGENCY_LOCKDOWN,
    severity: events.SEVERITY.CRITICAL,
    reason,
    actionTaken: 'Emergency lockdown enabled.',
  });

  return true;
}

module.exports = {
  // constants
  SEVERITY: events.SEVERITY,
  INCIDENT_TYPES: events.INCIDENT_TYPES,
  DEFAULT_CONFIG,
  QUARANTINE_ROLE_NAME,

  // security core
  PermissionFlagsBits: core.PermissionFlagsBits,
  getBotOwnerIds: core.getBotOwnerIds,
  getBotOwnerId: core.getBotOwnerId,
  isBotOwner: core.isBotOwner,
  isGuildOwner: core.isGuildOwner,
  hasPermission: core.hasPermission,
  checkCooldown: core.checkCooldown,
  safeDeny: core.safeDeny,
  validateBotHierarchy: core.validateBotHierarchy,
  hasDangerousPermissions: core.hasDangerousPermissions,
  canManageTargetMember: core.canManageTargetMember,

  // incident audit
  logIncident: audit.logIncident,
  readIncidents: audit.readIncidents,
  writeIncidents: audit.writeIncidents,
  buildIncidentEmbed: audit.buildIncidentEmbed,

  // event/threat handling
  calculateIncidentSeverity: events.calculateIncidentSeverity,
  getRecommendedIncidentActions: events.getRecommendedIncidentActions,
  addAction: events.addAction,
  fetchAuditExecutor: events.fetchAuditExecutor,

  // anti-nuke orchestration
  getAntiNukeConfig,
  emergencyLockdown,
};
