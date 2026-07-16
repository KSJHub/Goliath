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
  const isDiscordReadyRenameWarning = warning?.name === 'DeprecationWarning' && message.includes('ready event has been renamed to clientReady');
  if (isDiscordReadyRenameWarning) return;
  console.warn(warning);
});

function isMissingOptionalModule(error, modulePath) {
  if (error?.code !== 'MODULE_NOT_FOUND') return false;
  const message = String(error.message || '');
  return message.includes(modulePath) || message.includes(modulePath.replace(/^\.\//, ''));
}
function safeRequire(label, modulePath, fallback = null, options = {}) {
  try { return require(modulePath); }
  catch (error) {
    const optional = options.optional !== false;
    const missingOptionalModule = optional && isMissingOptionalModule(error, modulePath);
    if (missingOptionalModule) { if (process.env.GOLIATH_VERBOSE_OPTIONAL_MODULES === 'true') console.info(`ℹ️ Optional startup module unavailable: ${label}`); return fallback; }
    console.warn(`⚠️ Startup module failed: ${label}`);
    console.warn(error?.stack || error?.message || error);
    return fallback;
  }
}
function emptyRouter() { return express.Router(); }

const { getBotModeConfig } = safeRequire('botModes', './src/config/botModes', { getBotModeConfig: () => ({ token: null }) }, { optional: false });
const { enforceGuildAccess } = safeRequire('guildAccess', './src/config/guildAccess', { enforceGuildAccess: async () => true }, { optional: false });
const { bootstrapRuntime, runBootValidation, safeLoad, printStartupFingerprint } = safeRequire('runtimeBootstrap', './src/runtime/runtimeBootstrap', {
  bootstrapRuntime: () => ({}), runBootValidation: () => true,
  safeLoad: (label, fn) => { try { return { ok: true, result: fn() }; } catch (error) { console.warn(`⚠️ ${label} skipped`, error?.message || error); return { ok: false, result: null, error }; } },
  printStartupFingerprint: () => null,
}, { optional: false });
const { initSocketHub } = safeRequire('socketHub', './src/server/sockets/socketHub', { initSocketHub: () => null }, { optional: false });
safeRequire('backup notification wiring', './src/core/notifications/wireBackupNotifications', { wireBackupNotifications: () => false }).wireBackupNotifications?.();

const authRoutes = safeRequire('auth routes', './src/server/routes/auth', emptyRouter(), { optional: false });
const discordRoutes = safeRequire('discord routes', './src/server/routes/discord', emptyRouter(), { optional: false });
const discordRoleEditorRoutes = safeRequire('discord role editor routes', './src/server/routes/discordRoleEditor', emptyRouter(), { optional: false });
const discordResourceRoutes = safeRequire('discord resource routes', './src/server/routes/discordResources', emptyRouter(), { optional: false });
const statusRoutes = safeRequire('status routes', './src/server/routes/status', emptyRouter(), { optional: false });
const ownerRoutes = safeRequire('owner routes', './src/server/routes/owner', emptyRouter(), { optional: false });
const ownerDiagnosticsRoutes = safeRequire('owner diagnostics routes', './src/server/routes/ownerDiagnostics', emptyRouter(), { optional: false });
const ownerTranslationRoutes = safeRequire('owner translation routes', './src/server/routes/ownerTranslation', emptyRouter(), { optional: false });
const automodRoutes = safeRequire('automod routes', './src/server/routes/config/automod', emptyRouter(), { optional: false });
const generalSettingsRoutes = safeRequire('general settings routes', './src/server/routes/config/generalSettings', emptyRouter(), { optional: false });
const logsRoutes = safeRequire('logs routes', './src/server/routes/config/logs', emptyRouter(), { optional: false });
const messagesRoutes = safeRequire('messages routes', './src/server/routes/config/messages', emptyRouter(), { optional: false });
const embedsRoutes = safeRequire('embeds routes', './src/server/routes/config/embeds', emptyRouter(), { optional: false });
const billingRoutes = safeRequire('billing routes', './src/server/routes/billing', emptyRouter(), { optional: false });
const moderationRoutes = safeRequire('moderation routes', './src/server/routes/moderation', emptyRouter(), { optional: false });
const serverRestoreRoutes = safeRequire('restore routes', './src/server/routes/serverRestoreRoutes', emptyRouter(), { optional: false });
const securityRoutes = safeRequire('security routes', './src/server/routes/security', emptyRouter(), { optional: false });
const ticketRoutes = safeRequire('ticket routes', './src/modules/tickets/ticketsRoute', emptyRouter(), { optional: false });
const formsRoutes = safeRequire('forms routes', './src/server/routes/forms', emptyRouter(), { optional: false });
const transcriptRoutes = safeRequire('transcript routes', './src/server/routes/transcripts', emptyRouter(), { optional: false });
const translationRoutes = safeRequire('translation routes', './src/server/routes/translation', emptyRouter(), { optional: false });
const permissionHealthRoutes = safeRequire('permission health routes', './src/server/routes/permissionHealth', emptyRouter(), { optional: false });
const socialRoutes = safeRequire('social routes', './src/modules/social/socialRoute', emptyRouter(), { optional: false });
const scheduleRoutes = safeRequire('schedule routes', './src/modules/schedule/scheduleRoute', emptyRouter(), { optional: false });
const verificationRoutes = safeRequire('verification routes', './src/modules/verification/verificationRoute', emptyRouter(), { optional: false });
const autoRolesRoutes = safeRequire('auto roles routes', './src/modules/autoroles/autorolesRoute', emptyRouter(), { optional: false });
const welcomeRoutes = safeRequire('welcome routes', './src/modules/welcome/welcomeRoute', emptyRouter(), { optional: false });
const goodbyeRoutes = safeRequire('goodbye routes', './src/modules/goodbye/goodbyeRoute', emptyRouter(), { optional: false });
const reactionRolesRoutes = safeRequire('reaction roles routes', './src/modules/reactionroles/reactionRolesRoute', emptyRouter(), { optional: false });
const timedRolesRoutes = safeRequire('timed roles routes', './src/modules/timedroles/timedRolesRoute', emptyRouter(), { optional: false });
const modulesRoutes = safeRequire('modules routes', './src/server/routes/modules', emptyRouter(), { optional: false });
const automationRoutes = safeRequire('automation routes', './src/server/routes/automation', emptyRouter(), { optional: false });
const notificationRoutes = safeRequire('notification routes', './src/server/routes/notifications', emptyRouter(), { optional: false });
const activityRoutes = safeRequire('activity routes', './src/server/routes/activity', emptyRouter(), { optional: false });
const pollsRoutes = safeRequire('polls routes', './src/modules/polls/pollsRoute', emptyRouter(), { optional: false });
const statsRoutes = safeRequire('stats routes', './src/server/routes/stats', emptyRouter(), { optional: false });
const tempVoiceRoutes = safeRequire('temp voice routes', './src/server/routes/tempVoice', emptyRouter(), { optional: false });
const starboardRoutes = safeRequire('starboard routes', './src/server/routes/starboard', emptyRouter(), { optional: false });
const mediaRoutes = safeRequire('media routes', './src/server/routes/media', emptyRouter(), { optional: false });
const deploymentRoutes = safeRequire('deployment routes', './src/server/routes/deployments', emptyRouter());
const ownerDeploymentRoutes = safeRequire('owner deployment routes', './src/server/routes/ownerDeployments', emptyRouter(), { optional: false });
const ownerEmbedRoutes = safeRequire('owner embed routes', './src/server/routes/ownerEmbeds', emptyRouter());
const ownerTicketRoutes = safeRequire('owner ticket routes', './src/server/routes/ownerTickets', emptyRouter());
const ownerOperationsRoutes = safeRequire('owner operations routes', './src/server/routes/ownerOperations', emptyRouter());
const ownerPermissionsRoutes = safeRequire('owner permissions routes', './src/server/routes/ownerPermissions', emptyRouter());
const ownerSecurityRoutes = safeRequire('owner security routes', './src/server/routes/ownerSecurity', emptyRouter());
const ownerSubscriptionRoutes = safeRequire('owner subscription routes', './src/server/routes/ownerSubscription', emptyRouter());
const publicCommunityRoutes = safeRequire('public community routes', './src/server/routes/publicCommunity', emptyRouter(), { optional: false });

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
app.use(session({ secret: SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: isProduction, httpOnly: true, sameSite: isProduction ? 'none' : 'lax', maxAge: 1000 * 60 * 60 * 24 * 7 } }));
app.use((req, res, next) => { req.client = client; req.io = io; next(); });

app.use('/auth', authRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/discord', discordRoutes);
app.use('/api/discord', discordRoleEditorRoutes);
app.use('/api/discord', discordResourceRoutes);
app.use('/api/status', statusRoutes);
app.use('/api/public/community', publicCommunityRoutes);
app.use('/api/owner', ownerRoutes);
app.use('/api/owner/diagnostics', ownerDiagnosticsRoutes);
app.use('/api/owner/translation', ownerTranslationRoutes);
app.use('/api/config/automod', automodRoutes);
app.use('/api/config/general', generalSettingsRoutes);
app.use('/api/config/logs', logsRoutes);
app.use('/api/config/messages', messagesRoutes);
app.use('/api/config/embeds', embedsRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/moderation', moderationRoutes);
app.use('/api/cases', moderationRoutes);
app.use('/api/restore', serverRestoreRoutes);
app.use('/api/security', securityRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/forms', formsRoutes);
app.use('/api/transcripts', transcriptRoutes);
app.use('/api/translation', translationRoutes);
app.use('/api/permissions', permissionHealthRoutes);
app.use('/api/social', socialRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/verification', verificationRoutes);
app.use('/api/auto-roles', autoRolesRoutes);
app.use('/api/welcome', welcomeRoutes);
app.use('/api/goodbye', goodbyeRoutes);
app.use('/api/reaction-roles', reactionRolesRoutes);
app.use('/api/timed-roles', timedRolesRoutes);
app.use('/api/modules', modulesRoutes);
app.use('/api/automation', automationRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/polls', pollsRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/temp-voice', tempVoiceRoutes);
app.use('/api/starboard', starboardRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/deployments', deploymentRoutes);
app.use('/api/owner/deployments', ownerDeploymentRoutes);
app.use('/api/resources', discordResourceRoutes);
app.use('/api/owner/embeds', ownerEmbedRoutes);
app.use('/api/owner/tickets', ownerTicketRoutes);
app.use('/api/owner/operations', ownerOperationsRoutes);
app.use('/api/owner/permissions', ownerPermissionsRoutes);
app.use('/api/owner/security', ownerSecurityRoutes);
app.use('/api/owner/subscription', ownerSubscriptionRoutes);

const dashboardDist = path.join(process.cwd(), 'dist');
if (fs.existsSync(dashboardDist)) {
  app.use(express.static(dashboardDist));
  app.get('*', (req, res) => { if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' }); return res.sendFile(path.join(dashboardDist, 'index.html')); });
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
      const handlers = Array.isArray(loaded) ? loaded : [loaded];
      for (const handler of handlers) { if (!handler?.name || typeof handler.execute !== 'function') continue; const listener = (...args) => handler.execute(...args, client); if (handler.once === true) client.once(handler.name, listener); else client.on(handler.name, listener); }
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
