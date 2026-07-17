'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const cors = require('cors');
const session = require('express-session');
const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');
const { loadEnvironment } = require('./src/config/envLoader');
const { resolveToken } = require('./src/config/tokenResolver');
loadEnvironment();

process.on('warning', (warning) => {
  const message = String(warning?.message || '');
  if (warning?.name === 'DeprecationWarning' && message.includes('ready event has been renamed to clientReady')) return;
  console.warn(warning);
});

function isMissingOptionalModule(error, modulePath) {
  return error?.code === 'MODULE_NOT_FOUND' && String(error.message || '').includes(modulePath.replace(/^\.\//, ''));
}
function safeRequire(label, modulePath, fallback = null, options = {}) {
  try { return require(modulePath); }
  catch (error) {
    if (options.optional !== false && isMissingOptionalModule(error, modulePath)) return fallback;
    console.warn(`⚠️ Startup module failed: ${label}`);
    console.warn(error?.stack || error?.message || error);
    return fallback;
  }
}
function emptyRouter() { return express.Router(); }

const { getBotModeConfig } = safeRequire('botModes', './src/config/botModes', { getBotModeConfig: () => ({ token: null }) }, { optional: false });
const { enforceGuildAccess } = safeRequire('guildAccess', './src/config/guildAccess', { enforceGuildAccess: async () => true }, { optional: false });
const { bootstrapRuntime, runBootValidation, safeLoad, printStartupFingerprint } = safeRequire('runtimeBootstrap', './src/runtime/runtimeBootstrap', {
  bootstrapRuntime: () => ({}), runBootValidation: () => true, safeLoad: (_label, fn) => ({ ok: true, result: fn() }), printStartupFingerprint: () => null,
}, { optional: false });
const { initSocketHub } = safeRequire('socketHub', './src/server/sockets/socketHub', { initSocketHub: () => null }, { optional: false });
safeRequire('backup notification wiring', './src/core/notifications/wireBackupNotifications', { wireBackupNotifications: () => false }).wireBackupNotifications?.();

const route = (label, modulePath, optional = false) => safeRequire(label, modulePath, emptyRouter(), { optional });
const authRoutes = route('auth routes', './src/server/routes/auth');
const discordRoutes = route('discord routes', './src/server/routes/discord');
const discordRoleEditorRoutes = route('discord role editor routes', './src/server/routes/discordRoleEditor');
const discordResourceRoutes = route('discord resource routes', './src/server/routes/discordResources');
const statusRoutes = route('status routes', './src/server/routes/status');
const ownerRoutes = route('owner routes', './src/server/routes/owner');
const ownerDiagnosticsRoutes = route('owner diagnostics routes', './src/server/routes/ownerDiagnostics');
const ownerTranslationRoutes = route('owner translation routes', './src/server/routes/ownerTranslation');
const automodRoutes = route('automod routes', './src/server/routes/config/automod');
const generalSettingsRoutes = route('general settings routes', './src/server/routes/config/generalSettings');
const logsRoutes = route('logs routes', './src/server/routes/config/logs');
const messagesRoutes = route('messages routes', './src/server/routes/config/messages');
const embedsRoutes = route('embeds routes', './src/server/routes/config/embeds');
const billingRoutes = route('billing routes', './src/server/routes/billing');
const moderationRoutes = route('moderation routes', './src/server/routes/moderation');
const serverRestoreRoutes = route('restore routes', './src/server/routes/serverRestoreRoutes');
const securityRoutes = route('security routes', './src/server/routes/security');
const ticketRoutes = route('ticket routes', './src/modules/tickets/ticketsRoute');
const formsRoutes = route('forms routes', './src/server/routes/forms');
const transcriptRoutes = route('transcript routes', './src/server/routes/transcripts');
const translationRoutes = route('translation routes', './src/server/routes/translation');
const permissionHealthRoutes = route('permission health routes', './src/server/routes/permissionHealth');
const socialRoutes = route('social routes', './src/modules/social/socialRoute');
const scheduleRoutes = route('schedule routes', './src/modules/schedule/scheduleRoute');
const invitesRoutes = route('invite routes', './src/modules/invites/invitesRoute');
const verificationRoutes = route('verification routes', './src/modules/verification/verificationRoute');
const autoRolesRoutes = route('auto roles routes', './src/modules/autoroles/autorolesRoute');
const welcomeRoutes = route('welcome routes', './src/modules/welcome/welcomeRoute');
const goodbyeRoutes = route('goodbye routes', './src/modules/goodbye/goodbyeRoute');
const reactionRolesRoutes = route('reaction roles routes', './src/modules/reactionroles/reactionRolesRoute');
const timedRolesRoutes = route('timed roles routes', './src/modules/timedroles/timedRolesRoute');
const modulesRoutes = route('modules routes', './src/server/routes/modules');
const automationRoutes = route('automation routes', './src/server/routes/automation');
const notificationRoutes = route('notification routes', './src/server/routes/notifications');
const activityRoutes = route('activity routes', './src/server/routes/activity');
const pollsRoutes = route('polls routes', './src/modules/polls/pollsRoute');
const statsRoutes = route('stats routes', './src/server/routes/stats');
const tempVoiceRoutes = route('temp voice routes', './src/server/routes/tempVoice');
const starboardRoutes = route('starboard routes', './src/server/routes/starboard');
const mediaRoutes = route('media routes', './src/server/routes/media');
const deploymentRoutes = route('deployment routes', './src/server/routes/deployments', true);
const ownerDeploymentRoutes = route('owner deployment routes', './src/server/routes/ownerDeployments');
const ownerEmbedRoutes = route('owner embed routes', './src/server/routes/ownerEmbeds', true);
const ownerTicketRoutes = route('owner ticket routes', './src/server/routes/ownerTickets', true);
const ownerOperationsRoutes = route('owner operations routes', './src/server/routes/ownerOperations', true);
const ownerPermissionsRoutes = route('owner permissions routes', './src/server/routes/ownerPermissions', true);
const ownerSecurityRoutes = route('owner security routes', './src/server/routes/ownerSecurity', true);
const ownerSubscriptionRoutes = route('owner subscription routes', './src/server/routes/ownerSubscription', true);
const publicCommunityRoutes = route('public community routes', './src/server/routes/publicCommunity');

const commandHandler = safeRequire('command handler', './src/handlers/commandHandler', { loadCommands: () => null });
const backupScheduler = safeRequire('backup scheduler', './src/core/backup/backupScheduler', { startBackupScheduler: () => null });
const defaultModules = safeRequire('default modules', './src/core/guild/defaultModules', { initializeDefaultModules: () => null });
const guildManager = safeRequire('guild manager', './src/core/guild/guildManager', { syncGuildMeta: () => null }, { optional: false });
const resourceManager = safeRequire('discord resource manager', './src/core/guild/discordResourceManager', { syncDiscordResources: async () => null }, { optional: false });

const config = getBotModeConfig(process.env.BOT_MODE);
const botMode = String(process.env.BOT_MODE || config?.name || 'DEV').toUpperCase();
const PORT = Number(process.env.PORT || process.env.BOT_API_PORT || 3001);
const SESSION_SECRET = process.env.SESSION_SECRET || process.env.DASHBOARD_SESSION_SECRET || 'goliath-dev-session-secret';
const isProduction = process.env.NODE_ENV === 'production';
const runtimePaths = bootstrapRuntime(botMode);
printStartupFingerprint(config, runtimePaths);
runBootValidation({ requiredPaths: [], requiredEnv: [] });

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.GuildInvites, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.MessageContent],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});
client.commands = new Collection();
const app = express();
const server = http.createServer(app);
const io = initSocketHub(server) || null;
app.set('trust proxy', 1);
app.set('goliath.client', client);
app.set('goliath.io', io);

const allowedOrigins = new Set(['https://goliath.ksjdigital.co.uk', 'https://dev.goliath.ksjdigital.co.uk', 'https://twotonetaj.ksjdigital.co.uk', 'http://localhost:5173', 'http://localhost:5174']);
[process.env.CLIENT_URL, process.env.DASHBOARD_CLIENT_URL, process.env.DASHBOARD_URL, process.env.VITE_CLIENT_URL, process.env.TWOTONETAJ_CLIENT_URL].filter(Boolean).forEach((origin) => allowedOrigins.add(String(origin).trim()));
app.use(cors({ origin(origin, callback) { if (!origin || allowedOrigins.has(origin)) return callback(null, true); return callback(new Error(`CORS blocked origin: ${origin}`)); }, credentials: true }));
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: isProduction, httpOnly: true, sameSite: isProduction ? 'none' : 'lax', maxAge: 604800000 } }));
app.use((req, _res, next) => { req.client = client; req.io = io; next(); });

const mounts = [
  ['/auth', authRoutes], ['/api/auth', authRoutes], ['/api/discord', discordRoutes], ['/api/discord', discordRoleEditorRoutes], ['/api/discord', discordResourceRoutes], ['/api/status', statusRoutes], ['/api/public/community', publicCommunityRoutes], ['/api/owner', ownerRoutes], ['/api/owner/diagnostics', ownerDiagnosticsRoutes], ['/api/owner/translation', ownerTranslationRoutes], ['/api/config/automod', automodRoutes], ['/api/config/general', generalSettingsRoutes], ['/api/config/logs', logsRoutes], ['/api/config/messages', messagesRoutes], ['/api/config/embeds', embedsRoutes], ['/api/billing', billingRoutes], ['/api/moderation', moderationRoutes], ['/api/cases', moderationRoutes], ['/api/restore', serverRestoreRoutes], ['/api/security', securityRoutes], ['/api/tickets', ticketRoutes], ['/api/forms', formsRoutes], ['/api/transcripts', transcriptRoutes], ['/api/translation', translationRoutes], ['/api/permissions', permissionHealthRoutes], ['/api/social', socialRoutes], ['/api/schedule', scheduleRoutes], ['/api/invites', invitesRoutes], ['/api/verification', verificationRoutes], ['/api/auto-roles', autoRolesRoutes], ['/api/welcome', welcomeRoutes], ['/api/goodbye', goodbyeRoutes], ['/api/reaction-roles', reactionRolesRoutes], ['/api/timed-roles', timedRolesRoutes], ['/api/modules', modulesRoutes], ['/api/automation', automationRoutes], ['/api/notifications', notificationRoutes], ['/api/activity', activityRoutes], ['/api/polls', pollsRoutes], ['/api/stats', statsRoutes], ['/api/temp-voice', tempVoiceRoutes], ['/api/starboard', starboardRoutes], ['/api/media', mediaRoutes], ['/api/deployments', deploymentRoutes], ['/api/owner/deployments', ownerDeploymentRoutes], ['/api/resources', discordResourceRoutes], ['/api/owner/embeds', ownerEmbedRoutes], ['/api/owner/tickets', ownerTicketRoutes], ['/api/owner/operations', ownerOperationsRoutes], ['/api/owner/permissions', ownerPermissionsRoutes], ['/api/owner/security', ownerSecurityRoutes], ['/api/owner/subscription', ownerSubscriptionRoutes],
];
for (const [base, router] of mounts) app.use(base, router);

const dashboardDist = path.join(process.cwd(), 'dist');
if (fs.existsSync(dashboardDist)) {
  app.use(express.static(dashboardDist));
  app.get('*', (req, res) => req.path.startsWith('/api/') ? res.status(404).json({ error: 'Not found' }) : res.sendFile(path.join(dashboardDist, 'index.html')));
}

safeLoad('commands', () => commandHandler.loadCommands(client));
function registerEvents() {
  const eventsPath = path.join(process.cwd(), 'src', 'events');
  if (!fs.existsSync(eventsPath)) return;
  const files = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => { const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full); else if (entry.isFile() && entry.name.endsWith('.js')) files.push(full); });
  walk(eventsPath);
  for (const file of files) {
    try {
      const loaded = require(file);
      for (const handler of (Array.isArray(loaded) ? loaded : [loaded])) {
        if (!handler?.name || typeof handler.execute !== 'function') continue;
        const listener = (...args) => handler.execute(...args, client);
        if (handler.once === true) client.once(handler.name, listener); else client.on(handler.name, listener);
      }
    } catch (error) { console.warn(`⚠️ Event skipped: ${file}`); console.warn(error?.message || error); }
  }
}
registerEvents();
async function runStartupTask(label, fn) {
  try { await fn(); console.log(`✅ ${label} startup complete`); }
  catch (error) { console.error(`❌ ${label} startup failed`); console.error(error?.stack || error?.message || error); }
}
client.once('clientReady', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`ℹ Guilds cached: ${client.guilds.cache.size}`);
  for (const guild of client.guilds.cache.values()) {
    try { await enforceGuildAccess(guild, botMode, config); defaultModules.initializeDefaultModules?.(guild.id); guildManager.syncGuildMeta?.(guild); await resourceManager.syncDiscordResources?.(guild); }
    catch (error) { console.error(`Guild startup sync failed for ${guild?.id}:`, error?.message || error); }
  }
  await Promise.all([
    runStartupTask('Tickets', () => require('./src/modules/tickets/tickets').startup.startupTickets(client)),
    runStartupTask('Timed Roles', () => require('./src/modules/timedroles/timedRoles').startup(client)),
    runStartupTask('Translation', () => require('./src/modules/translation/translationStartup').startupTranslation(client)),
    runStartupTask('Verification', () => require('./src/modules/verification/verification').startupVerification(client)),
    runStartupTask('Goodbye', () => require('./src/modules/goodbye/goodbye').startupGoodbye(client)),
    runStartupTask('Reaction Roles', () => require('./src/modules/reactionroles/reactionRoles').startup(client)),
    runStartupTask('Giveaways', () => require('./src/modules/giveaways/giveawayScheduler').start(client)),
  ]);
  backupScheduler.startBackupScheduler?.();
});
server.listen(PORT, () => console.log(`🌐 Dashboard server running on port ${PORT}`));
const token = resolveToken(config);
if (!token) { console.error('❌ Missing Discord token for current BOT_MODE.'); process.exit(1); }
client.login(token);
