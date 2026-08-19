'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const http = require('node:http');
const cors = require('cors');
const session = require('express-session');
const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');
const { loadEnvironment } = require('./src/config/envLoader');
const { resolveToken } = require('./src/config/tokenResolver');
const { loginWithRetry } = require('./src/runtime/discordLogin');
const { createSQLiteSessionStore } = require('./src/server/session/sqliteSessionStore');
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
const { bootstrapRuntime, runBootValidation, safeLoad, registerEvents, syncStartupGuilds, runStartupTask, printStartupFingerprint } = safeRequire('runtimeBootstrap', './src/runtime/runtimeBootstrap', {
  bootstrapRuntime: () => ({}), runBootValidation: () => true, safeLoad: (_label, fn) => ({ ok: true, result: fn() }), registerEvents: () => ({ files: 0, groups: 0 }), syncStartupGuilds: async () => [], runStartupTask: async (_label, fn) => fn(), printStartupFingerprint: () => null,
}, { optional: false });
const { initSocketHub } = safeRequire('socketHub', './src/server/sockets/socketHub', { initSocketHub: () => null }, { optional: false });
const { prepareInteraction } = safeRequire('interaction response guard', './src/runtime/interactionResponseGuard', { prepareInteraction: async () => null }, { optional: false });
safeRequire('backup notification wiring', './src/core/notifications/wireBackupNotifications', { wireBackupNotifications: () => false }).wireBackupNotifications?.();

const route = (label, modulePath, optional = false) => safeRequire(label, modulePath, emptyRouter(), { optional });
const authRoutes = route('auth routes', './src/server/routes/auth');
const discordRoutes = route('discord routes', './src/server/routes/discord/discord');
const discordRoleEditorRoutes = route('discord role editor routes', './src/server/routes/discord/discordRoleEditor');
const discordResourceRoutes = route('discord resource routes', './src/server/routes/discord/discordResources');
const statusRoutes = route('status routes', './src/server/routes/status');
const ownerRoutes = route('owner routes', './src/server/routes/owner/owner');
const ownerDiagnosticsRoutes = route('owner diagnostics routes', './src/server/routes/owner/diagnostics');
const ownerTranslationRoutes = route('owner translation routes', './src/server/routes/owner/translation');
const automodRoutes = route('automod routes', './src/server/routes/config/automod');
const generalSettingsRoutes = route('general settings routes', './src/server/routes/config/generalSettings');
const logsRoutes = route('logs routes', './src/server/routes/config/logs');
const messagesRoutes = route('messages routes', './src/server/routes/config/messages');
const embedsRoutes = route('embeds routes', './src/server/routes/modules/messageStudio/embeds');
const billingRoutes = route('billing routes', './src/server/routes/billing');
const moderationRoutes = route('moderation routes', './src/server/routes/discord/moderation');
const serverRestoreRoutes = route('restore routes', './src/server/routes/discord/serverRestoreRoutes');
const securityRoutes = route('security routes', './src/server/routes/discord/security');
const ticketRoutes = route('ticket routes', './src/server/routes/modules/feedbackStudio/tickets');
const formsRoutes = route('forms routes', './src/server/routes/modules/feedbackStudio/forms');
const transcriptRoutes = route('transcript routes', './src/server/routes/modules/feedbackStudio/transcripts');
const suggestionsRoutes = route('suggestions routes', './src/server/routes/modules/feedbackStudio/suggestions');
const translationRoutes = route('translation routes', './src/server/routes/modules/utilityStudio/translation');
const permissionHealthRoutes = route('permission health routes', './src/server/routes/discord/permissionHealth');
const socialRoutes = route('social routes', './src/server/routes/modules/socialStudio/social');
const scheduleRoutes = route('schedule routes', './src/server/routes/modules/utilityStudio/schedule');
const invitesRoutes = route('invite routes', './src/server/routes/modules/communityStudio/invites');
const birthdaysRoutes = route('birthdays routes', './src/server/routes/modules/communityStudio/birthdays');
const privateRoomsRoutes = route('private rooms routes', './src/server/routes/modules/utilityStudio/privateRooms');
const emojisRoutes = route('emoji routes', './src/modules/utilityStudio/emojis/emojisPanel');
const verificationRoutes = route('verification routes', './src/server/routes/modules/securityStudio/verification');
const autoRolesRoutes = route('auto roles routes', './src/server/routes/modules/roleStudio/autoRoles');
const welcomeRoutes = route('welcome routes', './src/server/routes/modules/messageStudio/welcome');
const goodbyeRoutes = route('goodbye routes', './src/server/routes/modules/messageStudio/goodbye');
const reactionRolesRoutes = route('reaction roles routes', './src/server/routes/modules/roleStudio/reactionRoles');
const timedRolesRoutes = route('timed roles routes', './src/server/routes/modules/roleStudio/timedRoles');
const temporaryRolesRoutes = route('temporary roles routes', './src/server/routes/modules/roleStudio/temporaryRoles');
const roleSelectorRoutes = route('role selector routes', './src/server/routes/modules/roleStudio/roleSelector');
const modulesRoutes = route('modules routes', './src/server/routes/modules');
const automationRoutes = route('automation routes', './src/server/routes/automation');
const notificationRoutes = route('notification routes', './src/server/routes/notifications');
const activityRoutes = route('activity routes', './src/server/routes/activity');
const pollsRoutes = route('polls routes', './src/server/routes/modules/communityStudio/polls');
const statsRoutes = route('stats routes', './src/server/routes/modules/utilityStudio/stats');
const tempVoiceRoutes = route('temp voice routes', './src/server/routes/modules/utilityStudio/tempVoice');
const starboardRoutes = route('starboard routes', './src/server/routes/modules/messageStudio/starboard');
const mediaRoutes = route('media routes', './src/server/routes/modules/messageStudio/media');
const ownerDeploymentRoutes = route('owner deployment routes', './src/server/routes/owner/deployments');
const publicCommunityRoutes = route('public community routes', './src/server/routes/publicCommunity');

const commandHandler = safeRequire('command handler', './src/core/commands/commandLoader', { loadCommands: () => null });
const backupScheduler = safeRequire('backup scheduler', './src/core/security/serverBackupScheduler', { startServerBackupScheduler: () => null });
const guildManager = safeRequire('guild manager', './src/core/guild/guildManager', { syncGuildMeta: () => null }, { optional: false });
const resourceManager = safeRequire('discord resource manager', './src/core/guild/discordResourceManager', { syncDiscordResources: async () => null }, { optional: false });
const auditEvents = safeRequire('owner audit intelligence', './src/owner/auditIntelligence/auditEvents', { registerAuditEvents: () => false }, { optional: false });

const config = getBotModeConfig(process.env.BOT_MODE);
const botMode = String(process.env.BOT_MODE || config?.name || 'DEV').toUpperCase();
const PORT = Number(process.env.PORT || process.env.BOT_API_PORT || 3001);
const isProduction = process.env.NODE_ENV === 'production';
const runtimePaths = bootstrapRuntime(botMode);
const configuredSessionSecret = process.env.SESSION_SECRET || process.env.DASHBOARD_SESSION_SECRET || '';
if (isProduction && !configuredSessionSecret) {
  throw new Error('SESSION_SECRET or DASHBOARD_SESSION_SECRET is required when NODE_ENV=production');
}
const SESSION_SECRET = configuredSessionSecret || 'goliath-dev-session-secret';
const sessionStore = createSQLiteSessionStore(runtimePaths);
printStartupFingerprint(config, runtimePaths);
runBootValidation({ requiredPaths: [], requiredEnv: [] });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildExpressions,
    GatewayIntentBits.GuildIntegrations,
    GatewayIntentBits.GuildWebhooks,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildScheduledEvents,
    GatewayIntentBits.AutoModerationConfiguration,
    GatewayIntentBits.AutoModerationExecution,
    GatewayIntentBits.MessageContent,
  ].filter((intent) => intent !== undefined),
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});
client.commands = new Collection();
const app = express();
const server = http.createServer(app);
const io = initSocketHub(server) || null;
app.set('trust proxy', 1);
app.set('goliath.client', client);
app.set('goliath.io', io);

const allowedOrigins = new Set(['https://goliath.ksjdigital.co.uk', 'https://dev.goliath.ksjdigital.co.uk', 'https://twotonetaj.ksjdigital.co.uk', 'http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175']);
[process.env.CLIENT_URL, process.env.DASHBOARD_CLIENT_URL, process.env.DASHBOARD_URL, process.env.VITE_CLIENT_URL, process.env.TWOTONETAJ_CLIENT_URL].filter(Boolean).forEach((origin) => allowedOrigins.add(String(origin).trim()));
app.use(cors({ origin(origin, callback) { if (!origin || allowedOrigins.has(origin)) return callback(null, true); return callback(null, false); }, credentials: true }));
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({ store: sessionStore, secret: SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: isProduction, httpOnly: true, sameSite: isProduction ? 'none' : 'lax', maxAge: 604800000 } }));
app.use((req, _res, next) => { req.client = client; req.io = io; next(); });

const mounts = [
  ['/auth', authRoutes], ['/api/auth', authRoutes], ['/api/discord', discordRoutes], ['/api/discord', discordRoleEditorRoutes], ['/api/discord', discordResourceRoutes], ['/api/status', statusRoutes], ['/api/public/community', publicCommunityRoutes], ['/api/owner', ownerRoutes], ['/api/owner/diagnostics', ownerDiagnosticsRoutes], ['/api/owner/translation', ownerTranslationRoutes], ['/api/config/automod', automodRoutes], ['/api/config/general', generalSettingsRoutes], ['/api/config/logs', logsRoutes], ['/api/config/messages', messagesRoutes], ['/api/config/embeds', embedsRoutes], ['/api/billing', billingRoutes], ['/api/moderation', moderationRoutes], ['/api/cases', moderationRoutes], ['/api/restore', serverRestoreRoutes], ['/api/security', securityRoutes], ['/api/tickets', ticketRoutes], ['/api/forms', formsRoutes], ['/api/transcripts', transcriptRoutes], ['/api/suggestions', suggestionsRoutes], ['/api/translation', translationRoutes], ['/api/permissions', permissionHealthRoutes], ['/api/social', socialRoutes], ['/api/schedule', scheduleRoutes], ['/api/invites', invitesRoutes], ['/api/birthdays', birthdaysRoutes], ['/api/private-rooms', privateRoomsRoutes], ['/api/emojis', emojisRoutes], ['/api/verification', verificationRoutes], ['/api/auto-roles', autoRolesRoutes], ['/api/welcome', welcomeRoutes], ['/api/goodbye', goodbyeRoutes], ['/api/reaction-roles', reactionRolesRoutes], ['/api/timed-roles', timedRolesRoutes], ['/api/temporary-roles', temporaryRolesRoutes], ['/api/role-selector', roleSelectorRoutes], ['/api/colour-roles', roleSelectorRoutes], ['/api/modules', modulesRoutes], ['/api/automation', automationRoutes], ['/api/notifications', notificationRoutes], ['/api/activity', activityRoutes], ['/api/polls', pollsRoutes], ['/api/stats', statsRoutes], ['/api/temp-voice', tempVoiceRoutes], ['/api/starboard', starboardRoutes], ['/api/media', mediaRoutes], ['/api/owner/deployments', ownerDeploymentRoutes], ['/api/resources', discordResourceRoutes],
];
for (const [base, router] of mounts) app.use(base, router);

const dashboardDist = path.join(process.cwd(), 'dist');
if (fs.existsSync(dashboardDist)) {
  app.use(express.static(dashboardDist));
  app.get('*', (req, res) => req.path.startsWith('/api/') ? res.status(404).json({ error: 'Not found' }) : res.sendFile(path.join(dashboardDist, 'index.html')));
}

safeLoad('commands', () => commandHandler.loadCommands(client));
registerEvents(client, { prepareInteraction });
auditEvents.registerAuditEvents?.(client);

async function startConfiguredModules(client) {
  await Promise.all([
    runStartupTask('Tickets', () => require('./src/modules/feedbackStudio/tickets/tickets').startup.startupTickets(client)),
    runStartupTask('Translation', () => require('./src/modules/utilityStudio/translation/translationStartup').startupTranslation(client)),
    runStartupTask('Goodbye', () => {
      const enabledGuilds = client.guilds.cache.filter((guild) => guildManager.isModuleEnabled(guild.id, 'goodbye'));
      if (!enabledGuilds.size) {
        console.log('[Goodbye] Startup check skipped: no enabled guilds.');
        return null;
      }
      return require('./src/modules/messageStudio/goodbye/goodbye').startupGoodbye({ guilds: { cache: enabledGuilds } });
    }),
    runStartupTask('Reaction Roles', () => {
      const enabledGuilds = client.guilds.cache.filter((guild) => guildManager.isModuleEnabled(guild.id, 'reactionRoles'));
      return require('./src/modules/roleStudio/reactionRoles/reactionRoles').startup({ guilds: { cache: enabledGuilds } });
    }),
    runStartupTask('Verification', () => require('./src/modules/securityStudio/verification').startupVerification(client)),
    runStartupTask('Birthdays', async () => {
      const birthdays = require('./src/modules/communityStudio/birthdays/birthdays');
      const runSweep = async () => {
        const enabledGuilds = client.guilds.cache.filter((guild) => guildManager.isModuleEnabled(guild.id, 'birthdays'));
        for (const guild of enabledGuilds.values()) {
          await birthdays.processGuild(guild, { action: 'birthday_scheduler_tick' }).catch((error) => {
            console.warn(`[Birthdays] ${guild.id}: ${error?.message || error}`);
          });
        }
      };
      await runSweep();
      const timer = setInterval(runSweep, birthdays.TICK_MS);
      timer.unref?.();
      return timer;
    }),
  ]);
}

client.once('clientReady', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`ℹ️ Guilds cached: ${client.guilds.cache.size}`);
  await syncStartupGuilds(client, { enforceGuildAccess, guildManager, resourceManager, botMode, config });
  await startConfiguredModules(client);
  backupScheduler.startServerBackupScheduler?.(client);
});

const token = resolveToken(botMode, config);
loginWithRetry(client, token, { label: `Discord:${botMode}` }).catch((error) => {
  console.error(`[Discord:${botMode}] Unable to establish a Discord connection. Exiting so the process manager can recover.`);
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 250).unref();
});
server.listen(PORT, '0.0.0.0', () => console.log(`🌐 Dashboard server running on port ${PORT}`));