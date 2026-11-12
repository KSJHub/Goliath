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
router.use(requirePrivateAI);
router.get('/status', (_req, res) => res.json({
  enabled: isEnabled(),
  configured: isEnabled(),
  backend: 'local',
  model: String(process.env.GOLIATH_AI_MODEL || 'local-model').slice(0, 80),
  notice: isEnabled() ? 'Local inference configured. Model availability is checked when you send a message.' :
    'AI is disabled until the local model is installed and GOLIATH_AI_ENABLED=true is set in DEV.'
}));

const SNOWFLAKE = /^\\d{16,20}$/;
// Read-only audit. Never call Discord mutation methods from this route.
router.get('/guilds', (req, res) => {
  if (String(process.env.BOT_MODE || '').toUpperCase() !== 'DEV') return res.status(503).json({ error: 'DEV environment only.' });
  const guilds = [...(req.client?.guilds?.cache?.values() || [])].map((guild) => ({
    id: guild.id, name: guild.name, memberCount: guild.memberCount || 0
  })).sort((a, b) => a.name.localeCompare(b.name));
  return res.json({ guilds });
});

router.get('/audit/:guildId', async (req, res) => {
  if (String(process.env.BOT_MODE || '').toUpperCase() !== 'DEV') return res.status(503).json({ error: 'DEV environment only.' });
  const id = String(req.params.guildId || '');
  if (!SNOWFLAKE.test(id)) return res.status(400).json({ error: 'Invalid guild ID.' });
  // Restrict to this bot instance's connected guilds. Never switch to another environment.
  const guild = req.client?.guilds?.cache?.get(id);
  if (!guild) return res.status(404).json({ error: 'Guild is not connected to the DEV bot.' });
  try {
    await Promise.all([guild.roles.fetch(), guild.channels.fetch()]);
    const roles = [...guild.roles.cache.values()]
      .sort((a, b) => b.position - a.position)
      .map((role) => ({
        id: role.id, name: role.name, position: role.position,
        permissions: role.permissions.bitfield.toString(),
        managed: role.managed, mentionable: role.mentionable
      }));
    const channels = [...guild.channels.cache.values()]
      .sort((a, b) => (a.rawPosition || 0) - (b.rawPosition || 0))
      .map((channel) => ({
        id: channel.id, name: channel.name, type: channel.type,
        parentId: channel.parentId || null, position: channel.rawPosition || 0,
        permissionOverwrites: [...(channel.permissionOverwrites?.cache?.values() || [])]
          .map((entry) => ({ id: entry.id, type: entry.type,
            allow: entry.allow.bitfield.toString(), deny: entry.deny.bitfield.toString() }))
      }));
    const categoryCount = channels.filter((channel) => channel.type === 4).length;
    const unsynced = channels.filter((channel) => {
      if (!channel.parentId) return false;
      const item = guild.channels.cache.get(channel.id);
      return item && item.permissionsLocked === false;
    }).length;
    return res.json({
      guild: { id: guild.id, name: guild.name, memberCount: guild.memberCount || 0 },
      timestamp: new Date().toISOString(), readOnly: true,
      summary: { roles: roles.length, channels: channels.length,
        categories: categoryCount, unsyncedChannels: unsynced },
      roles, channels
    });
  } catch (error) {
    console.error('[GoliathAI] Read-only audit failed:', error?.message);
    return res.status(503).json({ error: 'Unable to read Discord server structure and permissions.' });
  }
});

router.post('/chat', async (req, res) => {
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
