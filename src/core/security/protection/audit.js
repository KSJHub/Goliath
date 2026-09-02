'use strict';

const { EmbedBuilder } = require('discord.js');
const guildManager = require('../../guild/guildManager');
const { SEVERITY } = require('./events');

function safeString(value, fallback = 'Unknown') {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function createIncidentId() {
  return `inc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getSeverityColor(severity) {
  switch (severity) {
    case SEVERITY.CRITICAL: return 0xff0000;
    case SEVERITY.HIGH: return 0xff7a00;
    case SEVERITY.MEDIUM: return 0xffcc00;
    case SEVERITY.LOW:
    default: return 0x5865f2;
  }
}

function resolveSecurityLogChannelId(guildId) {
  const security = guildManager.getGuildSection(guildId, 'security', {});
  const logs = guildManager.getGuildSection(guildId, 'logs', {});
  return security?.incidentLogChannelId || security?.securityLogChannelId || logs?.channels?.admin || logs?.channels?.moderation || logs?.channels?.general || logs?.adminLogChannelId || logs?.modLogChannelId || logs?.logsChannelId || null;
}

function readIncidents(guildId) {
  try {
    const security = guildManager.getGuildSection(guildId, 'security', {});
    return Array.isArray(security.incidents) ? security.incidents : [];
  } catch {
    return [];
  }
}

function writeIncidents(guildId, incidents = [], options = {}) {
  try {
    const security = guildManager.getGuildSection(guildId, 'security', {});
    const maxStored = Number(options.maxStored || 250);
    guildManager.saveGuildSection(guildId, 'security', {
      ...security,
      incidents: incidents.slice(0, maxStored),
    });
    return true;
  } catch {
    return false;
  }
}

function buildIncidentEmbed(incident, options = {}) {
  const severity = safeString(incident.severity, SEVERITY.LOW).toUpperCase();
  return new EmbedBuilder()
    .setColor(getSeverityColor(incident.severity))
    .setTitle(options.ownerMirror ? '🚨 Goliath Security Network Alert' : '🚨 Security Incident Logged')
    .setDescription(`**Type:** \`${incident.type}\`\n**Severity:** \`${severity}\``)
    .setTimestamp(new Date(incident.createdAt));
}

async function logIncident(guild, options = {}) {
  const guildId = safeString(options.guildId || guild?.id);
  const guildName = safeString(options.guildName || guild?.name);
  const incident = {
    id: options.id || createIncidentId(),
    type: options.type || 'unknown_security_incident',
    severity: options.severity || SEVERITY.LOW,
    guildId,
    guildName,
    actorId: options.actorId || null,
    actorTag: options.actorTag || null,
    targetId: options.targetId || null,
    targetName: options.targetName || null,
    targetType: options.targetType || null,
    reason: options.reason || null,
    actionTaken: options.actionTaken || null,
    metadata: options.metadata || {},
    createdAt: options.createdAt || new Date().toISOString(),
  };
  const current = readIncidents(guildId);
  writeIncidents(guildId, [incident, ...current]);
  return incident;
}

module.exports = {
  resolveSecurityLogChannelId,
  readIncidents,
  writeIncidents,
  buildIncidentEmbed,
  logIncident,
};
