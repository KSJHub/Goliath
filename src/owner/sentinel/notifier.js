'use strict';

const { INCIDENT_REMINDER_EVERY } = require('./constants');
const pipeline = require('./eventPipeline');

const environment = (client) => String(client?.botMode || process.env.BOT_MODE || 'DEV').toUpperCase();

function firstOwnerId() {
  const explicit = process.env.GOLIATH_SENTINEL_OWNER_ID || process.env.GOLIATH_HEALTH_OWNER_ID || process.env.BOT_OWNER_ID || process.env.OWNER_USER_ID;
  if (explicit) return String(explicit).trim();
  return String(process.env.OWNER_IDS || '').split(',').map((value) => value.trim()).find(Boolean) || null;
}

// Legacy/fallback destination only. Primary Sentinel delivery is now the
// Sentinel -> Audit Intelligence -> Goliath Control pipeline below.
async function destination(client) {
  const env = environment(client);
  const channelId = process.env[`${env}_SENTINEL_CHANNEL_ID`] || process.env.GOLIATH_SENTINEL_CHANNEL_ID || process.env[`${env}_HEALTH_CHANNEL_ID`] || process.env.GOLIATH_HEALTH_CHANNEL_ID;
  if (channelId) {
    const channel = client.channels.cache.get(channelId) || await client.channels.fetch(channelId).catch(() => null);
    if (channel?.isTextBased?.()) return channel;
  }
  const ownerId = firstOwnerId();
  if (ownerId) return client.users.fetch(ownerId).catch(() => null);
  return null;
}

function detailsLines(details = {}) {
  return Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .slice(0, 12)
    .map(([key, value]) => `**${key}:** ${String(typeof value === 'object' ? JSON.stringify(value) : value).slice(0, 700)}`);
}

function incidentCategory(incident = {}) {
  const moduleName = String(incident.module || '').toLowerCase();
  const component = String(incident.component || '').toLowerCase();
  const code = String(incident.code || '').toLowerCase();
  if (/security|automod|anti-nuke|quarantine|verification/.test(`${moduleName} ${component} ${code}`)) return 'security';
  return 'goliath';
}

function incidentInput(client, incident, kind) {
  const resolved = kind === 'resolved';
  const guild = incident.guildId ? client.guilds.cache.get(String(incident.guildId)) || null : null;
  const details = resolved ? incident.recoveryDetails : incident.details;
  return {
    sentinelKind: resolved ? 'recovery' : 'incident',
    type: resolved ? 'sentinel.incident.recovered' : 'sentinel.incident.open',
    category: incidentCategory(incident),
    action: resolved ? 'recover' : 'observe',
    title: resolved ? 'Sentinel Incident Recovered' : 'Sentinel Incident',
    icon: resolved ? '✅' : incident.severity === 'critical' ? '🚨' : incident.severity === 'error' ? '🟠' : '🟡',
    guild,
    guildId: incident.guildId || null,
    guildName: incident.guildName || guild?.name || null,
    source: 'Goliath Sentinel',
    result: resolved ? 'Recovered' : String(incident.severity || 'warning').toUpperCase(),
    target: { id: incident.id, label: incident.component || incident.module || 'Sentinel incident' },
    summary: resolved
      ? `Sentinel incident ${incident.id} recovered: ${incident.message}`
      : `Sentinel detected ${incident.severity || 'warning'} incident ${incident.id}: ${incident.message}`,
    before: resolved ? { status: 'open', occurrences: incident.occurrences, details: incident.details || {} } : undefined,
    after: resolved
      ? { status: 'resolved', resolvedAt: incident.resolvedAt, recoveryDetails: details || {} }
      : { status: 'open', occurrences: incident.occurrences, details: details || {} },
    metadata: {
      environment: incident.environment || environment(client),
      sentinelIncidentId: incident.id,
      sentinelIncidentKey: incident.key || null,
      module: incident.module || 'runtime',
      component: incident.component || 'general',
      code: incident.code || 'unknown',
      severity: incident.severity || 'warning',
      occurrences: Number(incident.occurrences || 0),
      firstSeenAt: incident.firstSeenAt || null,
      lastSeenAt: incident.lastSeenAt || null,
      resolvedAt: incident.resolvedAt || null,
    },
  };
}

async function sendFallback(client, incident, kind) {
  const target = await destination(client);
  if (!target) return false;
  const icon = kind === 'resolved' ? '✅' : incident.severity === 'critical' ? '🚨' : incident.severity === 'error' ? '🟠' : '🟡';
  const title = kind === 'resolved' ? 'RECOVERED' : String(incident.severity || 'warning').toUpperCase();
  const lines = [
    `${icon} **${title} — Goliath Sentinel**`,
    `**Incident:** \`${incident.id}\``,
    `**Environment:** ${incident.environment}`,
    incident.guildName || incident.guildId ? `**Guild:** ${incident.guildName || 'Unknown'}${incident.guildId ? ` (\`${incident.guildId}\`)` : ''}` : null,
    `**Module:** ${incident.module}`,
    `**Component:** ${incident.component}`,
    `**Problem:** ${incident.message}`,
    kind === 'resolved' ? `**Recovered:** ${incident.resolvedAt || new Date().toISOString()}` : `**Occurrences:** ${incident.occurrences}`,
    ...detailsLines(kind === 'resolved' ? incident.recoveryDetails : incident.details),
  ].filter(Boolean);
  return Boolean(await target.send({ content: lines.join('\n').slice(0, 1900), allowedMentions: { parse: [] } }).catch(() => null));
}

async function send(client, incident, kind = 'open') {
  // Guild-scoped incidents go to the private Goliath Control audit category
  // first. The legacy Sentinel channel/owner DM remains fallback only.
  if (incident?.guildId) {
    try {
      const event = await pipeline.capture(client, incidentInput(client, incident, kind));
      if (event) return true;
    } catch (error) {
      console.warn('[Sentinel] Goliath Control delivery failed; using fallback:', error?.message || error);
    }
  }
  return sendFallback(client, incident, kind);
}

function shouldRemind(incident, opened) {
  return opened || (Number(incident?.occurrences || 0) > 0 && Number(incident.occurrences) % INCIDENT_REMINDER_EVERY === 0);
}

module.exports = { send, sendFallback, shouldRemind, destination, firstOwnerId, incidentInput, incidentCategory };
