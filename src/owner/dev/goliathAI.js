'use strict';

// Private developer assistant. No external AI provider, shell access or Discord mutations.
const express = require('express');
const { getBotOwnerIds } = require('../../core/security/protection/core');

const router = express.Router();
const MAX_MESSAGES = 16;
const MAX_CONTENT = 4000;
const TIMEOUT_MS = 90000;
const LOCAL_AI_URL = 'http://127.0.0.1:8081/v1/chat/completions';
let requestInProgress = false;

function authorised(req) {
  const ids = getBotOwnerIds();
  return ids.length === 2 && new Set(ids).size === 2 && ids.includes(String(req.session?.user?.id || ''));
}
function isEnabled() {
  return String(process.env.BOT_MODE || '').toUpperCase() === 'DEV' &&
    process.env.GOLIATH_AI_ENABLED === 'true';
}
function requirePrivateAI(req, res, next) {
  res.set('Cache-Control', 'no-store');
  if (!authorised(req)) return res.status(403).json({ error: 'Goliath AI is restricted to the two configured developer accounts.' });
  if (req.method !== 'GET') {
    const origin = req.get('origin');
    const host = req.get('host');
    if (origin) {
      try { if (new URL(origin).host !== host) return res.status(403).json({ error: 'Cross-origin request denied.' }); }
      catch { return res.status(403).json({ error: 'Invalid request origin.' }); }
    }
    if (!req.is('application/json')) return res.status(415).json({ error: 'JSON request required.' });
  }
  next();
}
// Each route enforces its own identity or loopback-service access. Never grant one via the other.
router.get('/status', requirePrivateAI, (_req, res) => res.json({
  enabled: isEnabled(),
  configured: isEnabled(),
  backend: 'local',
  model: String(process.env.GOLIATH_AI_MODEL || 'local-model').slice(0, 80),
  notice: isEnabled() ? 'Local inference configured. Model availability is checked when you send a message.' :
    'AI is disabled until the local model is installed and GOLIATH_AI_ENABLED=true is set in DEV.'
}));

const SNOWFLAKE = /^\d{16,20}$/;
const { timingSafeEqual } = require('node:crypto');
const ENVIRONMENTS = Object.freeze([
  { environment: 'DEV', port: 3001 },
  { environment: 'BETA', port: 3011 },
  { environment: 'PRODUCTION', port: 3021 }
]);

function localMode() {
  return String(process.env.BOT_MODE || '').toUpperCase();
}
function isLoopback(req) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(String(req.socket?.remoteAddress || ''));
}
function hasInternalAccess(req) {
  const expected = String(process.env.OWNER_INTERNAL_TOKEN || '');
  const received = String(req.get('x-goliath-owner-token') || '');
  if (!isLoopback(req) || expected.length < 24 || !received || expected.length !== received.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}
function localGuilds(req) {
  return [...(req.client?.guilds?.cache?.values() || [])].map(guild => ({
    id: guild.id, name: guild.name, memberCount: guild.memberCount || 0,
    environment: localMode()
  })).sort((a, b) => a.name.localeCompare(b.name));
}
async function readAudit(req, id) {
  const guild = req.client?.guilds?.cache?.get(id);
  if (!guild) return null;
  await Promise.all([guild.roles.fetch(), guild.channels.fetch()]);
  const roles = [...guild.roles.cache.values()].sort((a, b) => b.position - a.position)
    .map(role => ({ id: role.id, name: role.name, position: role.position,
      permissions: role.permissions.bitfield.toString(), managed: role.managed,
      mentionable: role.mentionable }));
  const channels = [...guild.channels.cache.values()]
    .sort((a,b) => (a.rawPosition || 0) - (b.rawPosition || 0))
    .map(channel => ({ id: channel.id, name: channel.name, type: channel.type,
      parentId: channel.parentId || null, position: channel.rawPosition || 0,
      permissionOverwrites: [...(channel.permissionOverwrites?.cache?.values() || [])]
        .map(entry => ({ id: entry.id, type: entry.type,
          allow: entry.allow.bitfield.toString(), deny: entry.deny.bitfield.toString() })) }));
  return {
    guild: { id: guild.id, name: guild.name, memberCount: guild.memberCount || 0 },
    environment: localMode(), timestamp: new Date().toISOString(), readOnly: true,
    summary: { roles: roles.length, channels: channels.length,
      categories: channels.filter(c => c.type === 4).length,
      unsyncedChannels: channels.filter(c => c.parentId &&
        guild.channels.cache.get(c.id)?.permissionsLocked === false).length },
    roles, channels
  };
}
function requireAIIdentity(req, res, next) {
  res.set('Cache-Control', 'no-store');
  if (!authorised(req)) return res.status(403).json({ error: 'Only the two configured developer accounts may access Goliath AI.' });
  next();
}
function requireLocalInternal(req, res, next) {
  res.set('Cache-Control', 'no-store');
  if (!hasInternalAccess(req)) return res.status(403).json({ error: 'Internal audit access denied.' });
  next();
}
// Local-only endpoints are served by each environment once the feature is deliberately promoted.
// They never require/accept a browser session or grant AI/model access.
router.get('/guilds/local', requireLocalInternal, (req, res) =>
  res.json({ environment: localMode(), guilds: localGuilds(req) }));
router.get('/audit/local/:guildId', requireLocalInternal, async (req, res) => {
  if (!SNOWFLAKE.test(req.params.guildId)) return res.status(400).json({ error: 'Invalid guild ID.' });
  try {
    const report = await readAudit(req, req.params.guildId);
    return report ? res.json(report) : res.status(404).json({ error: 'Guild is not connected to this environment.' });
  } catch (error) {
    console.error('[GoliathAI] Local audit failed:', error?.message);
    return res.status(503).json({ error: 'Unable to read guild structure.' });
  }
});

async function internalGet(port, endpoint) {
  const token = String(process.env.OWNER_INTERNAL_TOKEN || '');
  if (token.length < 24) throw new Error('Shared internal owner token not configured.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch('http://127.0.0.1:' + port + endpoint, {
      headers: { 'x-goliath-owner-token': token }, signal: controller.signal
    });
    if (!response.ok) throw new Error('Internal service returned HTTP ' + response.status);
    return await response.json();
  } finally { clearTimeout(timer); }
}

router.get('/guilds', requireAIIdentity, async (req, res) => {
  // In non-DEV runtime, an AI dashboard isn't needed; the central controller
  // connects to each environment through the local read-only APIs.
  if (localMode() !== 'DEV') return res.status(503).json({ error: 'Goliath AI controller is hosted in DEV.' });
  const results = await Promise.all(ENVIRONMENTS.map(async target => {
    try {
      if (target.environment === 'DEV') return { environment: 'DEV', guilds: localGuilds(req) };
      return await internalGet(target.port, '/api/owner/ai/guilds/local');
    } catch (error) {
      return { environment: target.environment, guilds: [], unavailable: true,
        error: 'Environment audit endpoint not available or not yet promoted.' };
    }
  }));
  return res.json({ guilds: results.flatMap(result => result.guilds), environments: results.map(
    result => ({ environment: result.environment, available: !result.unavailable,
      guildCount: result.guilds.length, error: result.error || null })) });
});

router.get('/audit/:environment/:guildId', requireAIIdentity, async (req, res) => {
  if (localMode() !== 'DEV') return res.status(503).json({ error: 'Goliath AI controller is hosted in DEV.' });
  const environment = String(req.params.environment || '').toUpperCase();
  const target = ENVIRONMENTS.find(item => item.environment === environment);
  const id = String(req.params.guildId || '');
  if (!target || !SNOWFLAKE.test(id)) return res.status(400).json({ error: 'Invalid environment or guild ID.' });
  try {
    if (environment === 'DEV') {
      const result = await readAudit(req, id);
      return result ? res.json(result) : res.status(404).json({ error: 'Guild not connected to DEV.' });
    }
    const result = await internalGet(target.port, '/api/owner/ai/audit/local/' + id);
    if (result?.environment !== environment || result?.guild?.id !== id || result?.readOnly !== true) {
      return res.status(502).json({ error: 'Environment audit response failed verification.' });
    }
    return res.json(result);
  } catch (error) {
    return res.status(503).json({ error: 'Selected environment is unavailable or not yet equipped with Goliath AI auditing.' });
  }
});
router.get('/audit/:guildId', requireAIIdentity, async (req, res) =>
  res.status(400).json({ error: 'Select both the environment and the guild to avoid ambiguity.' }));

router.post('/chat', requirePrivateAI, async (req, res) => {
  if (!isEnabled()) return res.status(503).json({ error: 'Goliath AI is disabled until local inference is configured.' });
  const incoming = req.body?.messages;
  if (!Array.isArray(incoming) || incoming.length < 1 || incoming.length > MAX_MESSAGES ||
      incoming.some((m) => !m || !['user', 'assistant'].includes(m.role) ||
        typeof m.content !== 'string' || !m.content.trim() || m.content.length > MAX_CONTENT)) {
    return res.status(400).json({ error: 'Invalid chat messages or conversation length.' });
  }
  if (incoming[incoming.length - 1].role !== 'user') return res.status(400).json({ error: 'Last message must be from you.' });
  if (requestInProgress) return res.status(429).json({ error: 'Goliath AI is busy with another request. Please try again shortly.' });
  requestInProgress = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(LOCAL_AI_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: String(process.env.GOLIATH_AI_MODEL || 'local-model'),
        stream: false,
        temperature: 0.3,
        max_tokens: 512,
        messages: [
          { role: 'system', content: 'You are Goliath AI, a private assistant for the Goliath developer. Be concise and truthful. You have no access to Discord, computers, files, websites or tools in this chat version. Never claim that you executed an action.' },
          ...incoming.map((m) => ({ role: m.role, content: m.content }))
        ]
      })
    });
    if (!response.ok) return res.status(502).json({ error: 'Local AI model returned an error.' });
    const data = await response.json();
    const message = data?.choices?.[0]?.message?.content;
    if (typeof message !== 'string' || !message.trim()) return res.status(502).json({ error: 'Local AI returned no message.' });
    return res.json({ reply: message.slice(0, 12000) });
  } catch (error) {
    return res.status(503).json({ error: error?.name === 'AbortError' ? 'Local AI timed out.' : 'Local AI is not available. Goliath itself is unaffected.' });
  } finally { clearTimeout(timeout); requestInProgress = false; }
});
module.exports = router;
