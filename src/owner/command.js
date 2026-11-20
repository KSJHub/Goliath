'use strict';
const { EMOJIS, emojiLabel } = require('../core/ui/emojis');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { getRuntimePaths } = require('../config/runtimePaths');

const {
  ActionRowBuilder,
  ButtonStyle,
  EmbedBuilder,
  Events,
  MessageFlags,
  ModalBuilder,
  PermissionsBitField,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const { navigationButton, linkButton } = require('../core/guild/goliathNavigation');
const { normalizeBotMode } = require('../config/botModes');
const security = require('../core/security/protection/core');
const devOverride = require('./dev/DevOverrideManager');
const testSecurity = require('./dev/testsecurity');
const duplicator = require('./dev/duplicator');
const maintenanceStatus = require('./dev/maintenanceStatus');
const auditEvents = require('./auditIntelligence/auditEvents');
const restartControls = require('./dev/restartControls');
const guildAccessControls = require('./dev/guildAccessControls');

const OWNER_PREFIX = 'ownerpanel:';
const SERVER_CONTEXT_MARKER = ':guild:';
const OWNER_CONTEXT_TTL_MS = 30 * 60 * 1000;
const DEVELOPMENT_TEST_GUILD_ID = process.env.TEST_GUILD_ID || '1515201360386068642';
const wiredClients = new WeakSet();
const ownerGuildContexts = new Map();
const devControlInteractions = new WeakSet();

function mode() {
  return normalizeBotMode(process.env.BOT_MODE);
}

function ownerAllowed(interaction) {
  return Boolean(interaction?.user?.id && security.isBotOwner(interaction.user.id));
}

function ownerDeniedPayload() {
  return {
    content: emojiLabel('ERROR', 'This control panel is restricted to the configured Goliath owners.'),
    flags: MessageFlags.Ephemeral,
  };
}

function validGuildId(value) {
  const id = String(value || '').trim();
  return /^\d{16,25}$/.test(id) ? id : null;
}

function embeddedGuildId(customId) {
  const id = String(customId || '');
  const match = id.match(/:guild:(\d{16,25})$/);
  return validGuildId(match?.[1]);
}

function baseOwnerCustomId(customId) {
  const id = String(customId || '');
  const index = id.lastIndexOf(SERVER_CONTEXT_MARKER);
  return index < 0 ? id : id.slice(0, index);
}

function componentCustomId(component) {
  return String(
    component?.customId
      || component?.custom_id
      || component?.data?.custom_id
      || component?.data?.customId
      || ''
  );
}

function guildIdFromMessageComponents(interaction) {
  const rows = interaction?.message?.components;
  if (!Array.isArray(rows)) return null;

  for (const row of rows) {
    const components = row?.components || row?.data?.components;
    if (!Array.isArray(components)) continue;
    for (const component of components) {
      const guildId = embeddedGuildId(componentCustomId(component));
      if (guildId) return guildId;
    }
  }
  return null;
}

function guildIdFromMessageMetadata(interaction) {
  return validGuildId(
    interaction?.message?.guildId
      || interaction?.message?.guild?.id
      || interaction?.message?.interactionMetadata?.guildId
      || interaction?.message?.interaction?.guildId
  );
}

function pruneOwnerGuildContexts() {
  const now = Date.now();
  for (const [ownerId, entry] of ownerGuildContexts.entries()) {
    if (!entry || entry.expiresAt <= now) ownerGuildContexts.delete(ownerId);
  }
}

function rememberOwnerGuild(interaction, guildId) {
  const ownerId = String(interaction?.user?.id || '').trim();
  const resolvedGuildId = validGuildId(guildId);
  if (!ownerId || !resolvedGuildId) return resolvedGuildId;
  ownerGuildContexts.set(ownerId, {
    guildId: resolvedGuildId,
    expiresAt: Date.now() + OWNER_CONTEXT_TTL_MS,
  });
  return resolvedGuildId;
}

function rememberedOwnerGuildId(interaction) {
  pruneOwnerGuildContexts();
  const ownerId = String(interaction?.user?.id || '').trim();
  if (!ownerId) return null;
  return validGuildId(ownerGuildContexts.get(ownerId)?.guildId);
}

function guildIdFromChannel(interaction) {
  const direct = validGuildId(
    interaction?.channel?.guildId
      || interaction?.channel?.guild?.id
      || interaction?.message?.channel?.guildId
      || interaction?.message?.channel?.guild?.id
  );
  if (direct) return direct;

  const channelId = String(interaction?.channelId || interaction?.channel?.id || '').trim();
  if (!channelId) return null;

  const directChannel = interaction?.client?.channels?.cache?.get?.(channelId);
  const directChannelGuildId = validGuildId(directChannel?.guildId || directChannel?.guild?.id);
  if (directChannelGuildId) return directChannelGuildId;

  const guilds = interaction?.client?.guilds?.cache;
  if (!guilds?.values) return null;

  for (const guild of guilds.values()) {
    if (guild?.channels?.cache?.has?.(channelId)) return validGuildId(guild.id);
  }
  return null;
}

function interactionGuildId(interaction, explicitGuildId = null) {
  const guildId = validGuildId(explicitGuildId)
    || validGuildId(interaction?.guildId)
    || validGuildId(interaction?.guild?.id)
    || embeddedGuildId(interaction?.customId)
    || guildIdFromMessageComponents(interaction)
    || guildIdFromMessageMetadata(interaction)
    || guildIdFromChannel(interaction)
    || rememberedOwnerGuildId(interaction);

  if (guildId) rememberOwnerGuild(interaction, guildId);
  return guildId;
}

function contextualOwnerId(action, interactionOrGuildId) {
  const guildId = typeof interactionOrGuildId === 'string'
    ? validGuildId(interactionOrGuildId)
    : interactionGuildId(interactionOrGuildId);
  return guildId
    ? `${OWNER_PREFIX}${action}${SERVER_CONTEXT_MARKER}${guildId}`
    : `${OWNER_PREFIX}${action}`;
}

function cachedInteractionGuild(interaction, explicitGuildId = null) {
  if (interaction?.guild) return interaction.guild;
  const guildId = interactionGuildId(interaction, explicitGuildId);
  return guildId ? interaction?.client?.guilds?.cache?.get?.(guildId) || null : null;
}

async function resolveInteractionGuild(interaction, explicitGuildId = null) {
  const guildId = interactionGuildId(interaction, explicitGuildId);
  if (!guildId) return { guild: null, guildId: null, error: null };

  const cached = cachedInteractionGuild(interaction, guildId);
  if (cached) {
    rememberOwnerGuild(interaction, cached.id);
    return { guild: cached, guildId, error: null };
  }

  if (!interaction?.client?.guilds?.fetch) {
    return { guild: null, guildId, error: new Error('Guild manager fetch is unavailable.') };
  }

  try {
    const guild = await interaction.client.guilds.fetch(guildId);
    if (guild) rememberOwnerGuild(interaction, guild.id);
    return { guild: guild || null, guildId, error: null };
  } catch (error) {
    return { guild: null, guildId, error };
  }
}

function isDevelopmentGuild(interaction, explicitGuildId = null) {
  return interactionGuildId(interaction, explicitGuildId) === validGuildId(DEVELOPMENT_TEST_GUILD_ID);
}

function ownerHomePayload(interaction, notice = null) {
  const currentMode = mode();
  const devState = devOverride.readState();
  const billing = devOverride.getPaywallBypassState();
  const isDev = currentMode === 'DEV';
  const ownersLoaded = security.getBotOwnerIds().length;
  const guild = cachedInteractionGuild(interaction);
  const guildId = interactionGuildId(interaction);
  const showCommandCenter = isDev && isDevelopmentGuild(interaction, guildId);
  const guildContext = guild
    ? `${guild.name} • ${guild.id}`
    : guildId
      ? `Server • ${guildId}`
      : 'User-installed external context';

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(emojiLabel('ADMIN_CROWN', 'Goliath Owner Control Panel'))
    .setDescription([
      'Private owner-only controls for Goliath development, security testing and server tooling.',
      '',
      notice ? `**Status:** ${notice}` : null,
    ].filter(Boolean).join('\n'))
    .addFields(
      { name: 'Environment', value: `\`${currentMode}\``, inline: true },
      { name: 'Owner Gate', value: `**${ownersLoaded}** configured owner IDs`, inline: true },
      { name: 'Panel Visibility', value: 'Ephemeral • owner ID checked on every action', inline: true },
      { name: 'Context', value: guildContext, inline: false },
      { name: 'DEV Override', value: isDev ? (devState.enabled ? emojiLabel('ENABLED', 'Enabled') : emojiLabel('DISABLED', 'Disabled')) : emojiLabel('INACTIVE', 'DEV only'), inline: true },
      { name: 'DEV Billing Unlock', value: isDev ? (billing.active ? `${EMOJIS.ACTIVE} ${billing.plan || 'enabled'}` : emojiLabel('DISABLED', 'Disabled')) : emojiLabel('INACTIVE', 'DEV only'), inline: true },
      { name: 'Owner Tools', value: showCommandCenter ? emojiLabel('ENABLED', 'Server Tools • Security • Maintenance • DEV Sync • Command Center') : (isDev ? emojiLabel('ENABLED', 'Server Tools • Security • Maintenance • DEV Sync') : emojiLabel('ENABLED', 'Server Tools • Security • Maintenance')), inline: true },
    )
    .setFooter({ text: 'Goliath Owner • OWNER_IDS protected' })
    .setTimestamp();

  const primaryComponents = [
    navigationButton(`${OWNER_PREFIX}dev-toggle`, devState.enabled ? 'Disable DEV Override' : 'Enable DEV Override', devState.enabled ? ButtonStyle.Danger : ButtonStyle.Success, !isDev).setEmoji(EMOJIS.TEST_SEND),
    navigationButton(contextualOwnerId('security', guildId), 'Security Tests', ButtonStyle.Secondary).setEmoji(EMOJIS.SECURITY),
    navigationButton(contextualOwnerId('server-tools', interaction), 'Server Tools', ButtonStyle.Secondary).setEmoji(EMOJIS.TOOLS),
    navigationButton(contextualOwnerId('maintenance', guildId), 'Maintenance', ButtonStyle.Secondary).setEmoji(EMOJIS.ISOLATION),
  ];

  if (showCommandCenter) {
    primaryComponents.push(
      navigationButton(contextualOwnerId('commandcenter', guildId), 'Command Center', ButtonStyle.Secondary).setEmoji(EMOJIS.SOCIAL_BROADCAST)
    );
  }

  const primary = new ActionRowBuilder().addComponents(...primaryComponents);

  const navigationComponents = [
    navigationButton(contextualOwnerId('refresh', interaction), 'Refresh', ButtonStyle.Secondary).setEmoji(EMOJIS.REFRESH),
    ...(security.getBotOwnerIds().length === 2 && new Set(security.getBotOwnerIds()).size === 2 ? [
      ...(isDev ? [navigationButton(contextualOwnerId('ai-home', guildId), 'Goliath AI', ButtonStyle.Primary).setEmoji(EMOJIS.TOOLS)] : [linkButton('Goliath AI', 'https://dev.goliath.ksjdigital.co.uk/owner/ai', { emoji: EMOJIS.TOOLS })])
    ] : []),
  ];

  if (isDev) {
    navigationComponents.push(
      linkButton('Sync DEV Now', 'https://github.com/KSJHub/Goliath/actions/workflows/sync-dev-now.yml', { emoji: EMOJIS.DEPLOY })
    );
  }

  const navigation = new ActionRowBuilder().addComponents(...navigationComponents);

  const components = [primary, navigation];
  if (isDev) components.push(restartControls.buildRow());
  if (isDev) components.push(guildAccessControls.buildRow());
  return { embeds: [embed], components };
}

function serverToolsPayload(interaction, explicitGuildId = null) {
  const guildId = interactionGuildId(interaction, explicitGuildId);
  const guildContextAvailable = Boolean(guildId);
  if (guildId) rememberOwnerGuild(interaction, guildId);

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(emojiLabel('TOOLS', 'Owner Server Tools'))
    .setDescription([
      'Developer-only server tools. Access is restricted to configured Goliath owner IDs.',
      '',
      '**Server Duplicator**',
      emojiLabel('INCIDENT_AUDIT', '**Copy Structure** — selectively copy server structure, roles and permissions.'),
      emojiLabel('INVESTIGATE', '**Analyse Servers** — compare a source and destination before copying.'),
      '',
      '**Templates**',
      emojiLabel('MOD_EXPORT', '**Export Template** — save a server as a reusable Duplicator template.'),
      emojiLabel('OWNER_BUILD', '**Build Template** — build from a saved/default template.'),
      '',
      '**Permissions Studio**',
      emojiLabel('SECURITY', 'Audit, edit, compare, copy and restore server permissions.'),
      '',
      guildContextAvailable ? null : emojiLabel('WARNING', '**Server context required.** Open `/owner` from a server channel to use these tools.'),
    ].filter(Boolean).join('\n'))
    .setFooter({ text: 'Owner only • Server tooling retains owner and safety checks' });

  const primaryTools = new ActionRowBuilder().addComponents(
    navigationButton(contextualOwnerId('server-copy', guildId), 'Copy Structure', ButtonStyle.Primary, !guildContextAvailable).setEmoji(EMOJIS.REVIEW),
    navigationButton(contextualOwnerId('server-analyse', guildId), 'Analyse Servers', ButtonStyle.Secondary, !guildContextAvailable).setEmoji(EMOJIS.INVESTIGATE),
    navigationButton(contextualOwnerId('server-export', guildId), 'Export Template', ButtonStyle.Secondary, !guildContextAvailable).setEmoji(EMOJIS.MOD_EXPORT)
  );

  const secondaryTools = new ActionRowBuilder().addComponents(
    navigationButton(contextualOwnerId('server-build', guildId), 'Build Template', ButtonStyle.Secondary, !guildContextAvailable).setEmoji(EMOJIS.OWNER_BUILD),
    navigationButton(`permstudio:home:guild:${guildId}`, 'Permissions Studio', ButtonStyle.Primary, !guildContextAvailable).setEmoji(EMOJIS.SECURITY)
  );

  const navigation = new ActionRowBuilder().addComponents(
    navigationButton(contextualOwnerId('home', guildId), emojiLabel('BACK', 'Back'), ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [primaryTools, secondaryTools, navigation] };
}

function maintenancePayload(interaction, explicitGuildId = null, notice = null) {
  const guildId = interactionGuildId(interaction, explicitGuildId);
  const guild = cachedInteractionGuild(interaction, guildId);
  const currentChannel = guild ? maintenanceStatus.findMaintenanceChannel(guild) : null;
  const connectedGuilds = interaction?.client?.guilds?.cache?.size || 0;

  const embed = new EmbedBuilder()
    .setColor(currentChannel ? 0xED4245 : 0x5865F2)
    .setTitle(emojiLabel('AUTOMOD_SUSPICIOUS', 'Goliath Maintenance Control'))
    .setDescription([
      'Owner-only controls for Goliath maintenance notices and recovery.',
      '',
      'Automatic mode is wired to controlled `SIGTERM` / `SIGINT` shutdowns. On restart, Goliath converts existing maintenance notices to **All Systems Operational** and removes the temporary channel after 5 minutes.',
      '',
      notice ? `**Status:** ${notice}` : null,
    ].filter(Boolean).join('\n'))
    .addFields(
      { name: 'Automatic shutdown notices', value: emojiLabel('ENABLED', 'Enabled'), inline: true },
      { name: 'Connected guilds', value: `**${connectedGuilds}**`, inline: true },
      { name: 'Current server', value: guild ? `${guild.name}\n\`${guild.id}\`` : 'No server context', inline: false },
      { name: 'Current server notice', value: currentChannel ? `${EMOJIS.OWNER_RED} Active • <#${currentChannel.id}>` : emojiLabel('ENABLED', 'No temporary maintenance channel'), inline: false },
      { name: 'Private visibility', value: 'Guild owner + every role with the Discord **Administrator** permission + Goliath. `@everyone` is denied.', inline: false },
    )
    .setFooter({ text: 'Owner only • Temporary channels self-delete after recovery' })
    .setTimestamp();

  const currentGuildActions = new ActionRowBuilder().addComponents(
    navigationButton(contextualOwnerId('maintenance-start-guild', guildId), 'Start This Server', ButtonStyle.Danger, !guild).setEmoji(EMOJIS.DISABLED),
    navigationButton(contextualOwnerId('maintenance-complete-guild', guildId), 'Restore This Server', ButtonStyle.Success, !guild).setEmoji(EMOJIS.ENABLED),
    navigationButton(contextualOwnerId('maintenance-clear-guild', guildId), 'Delete Status Channel', ButtonStyle.Secondary, !guild).setEmoji(EMOJIS.DELETE)
  );

  const globalActions = new ActionRowBuilder().addComponents(
    navigationButton(contextualOwnerId('maintenance-start-all', guildId), 'Start All Guilds', ButtonStyle.Danger).setEmoji(EMOJIS.ISOLATION),
    navigationButton(contextualOwnerId('maintenance-complete-all', guildId), 'Restore All Guilds', ButtonStyle.Success).setEmoji(EMOJIS.SUCCESS)
  );

  const navigation = new ActionRowBuilder().addComponents(
    navigationButton(contextualOwnerId('home', guildId), emojiLabel('BACK', 'Back'), ButtonStyle.Secondary),
    navigationButton(contextualOwnerId('maintenance', guildId), 'Refresh', ButtonStyle.Secondary).setEmoji(EMOJIS.REFRESH)
  );

  return { embeds: [embed], components: [currentGuildActions, globalActions, navigation] };
}

function serverContextRequiredPayload() {
  return {
    content: emojiLabel('ERROR', 'Server Tools require a server context. Open `/owner` from the server you want to manage, then open **Server Tools** again.'),
    flags: MessageFlags.Ephemeral,
  };
}

function noConnectedGuildsPayload(guildId = null) {
  return {
    content: guildId
      ? `❌ Goliath can identify server \`${guildId}\`, but this bot instance cannot access it and is not connected to any other guild it can use for Server Tools.`
      : emojiLabel('ERROR', 'This Goliath bot instance is not connected to any guilds available to Server Tools.'),
    flags: MessageFlags.Ephemeral,
  };
}

function securityUnavailablePayload(guildId = null) {
  return {
    content: guildId
      ? `❌ Goliath can identify server \`${guildId}\`, but this bot instance cannot access a connected guild for Security Tests.`
      : emojiLabel('ERROR', 'This Goliath bot instance is not connected to a guild available for Security Tests.'),
    flags: MessageFlags.Ephemeral,
  };
}

function exportModal(interaction, explicitGuildId = null) {
  const guildId = interactionGuildId(interaction, explicitGuildId);
  return new ModalBuilder()
    .setCustomId(contextualOwnerId('server-export-submit', guildId))
    .setTitle('Export Server Template')
    .addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('source_server').setLabel('Source server ID (blank = current)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(25)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Template name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('template_id').setLabel('Template ID (optional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(60)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('version').setLabel('Version (optional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(30)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('Description (optional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100))
    );
}

function readModalValue(interaction, key) {
  try {
    return String(interaction.fields.getTextInputValue(key) || '').trim() || null;
  } catch {
    return null;
  }
}

function withOwnerOptions(interaction, values = {}, guildOverride = null, explicitGuildId = null) {
  const options = {
    getString(name, required = false) {
      const value = values[name] === undefined || values[name] === null ? null : String(values[name]);
      if (required && !value) throw new Error(`Missing owner tool option: ${name}`);
      return value;
    },
  };

  return new Proxy(interaction, {
    get(target, property) {
      if (property === 'options') return options;
      if (property === 'guild') return guildOverride || cachedInteractionGuild(target, explicitGuildId);
      if (property === 'guildId') return validGuildId(guildOverride?.id) || interactionGuildId(target, explicitGuildId);
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function firstConnectedGuild(interaction) {
  const cache = interaction?.client?.guilds?.cache;
  if (!cache?.values) return null;
  return cache.values().next().value || null;
}

async function preferredOwnerControlGuild(interaction, explicitGuildId = null) {
  const requestedGuildId = interactionGuildId(interaction, explicitGuildId);
  const requested = await resolveInteractionGuild(interaction, requestedGuildId);
  if (requested.guild) return { guild: requested.guild, requestedGuildId, error: null };

  const devGuildId = validGuildId(DEVELOPMENT_TEST_GUILD_ID);
  if (devGuildId && devGuildId !== requestedGuildId) {
    const cachedDev = interaction?.client?.guilds?.cache?.get?.(devGuildId) || null;
    if (cachedDev) return { guild: cachedDev, requestedGuildId, error: requested.error };
    if (interaction?.client?.guilds?.fetch) {
      try {
        const fetchedDev = await interaction.client.guilds.fetch(devGuildId);
        if (fetchedDev) return { guild: fetchedDev, requestedGuildId, error: requested.error };
      } catch {
        // Fall through to any connected guild.
      }
    }
  }

  return { guild: firstConnectedGuild(interaction), requestedGuildId, error: requested.error };
}

async function runSecurityTests(interaction, explicitGuildId = null, button = false) {
  const resolved = await preferredOwnerControlGuild(interaction, explicitGuildId);
  const controlGuild = resolved.guild;

  if (!controlGuild) {
    const payload = securityUnavailablePayload(resolved.requestedGuildId);
    if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => null);
    else await interaction.reply(payload).catch(() => null);
    return null;
  }

  if (resolved.requestedGuildId && resolved.requestedGuildId !== controlGuild.id) {
    console.warn('[OwnerPanel] Requested guild is unavailable to this bot instance; using a connected guild as Security Test control context.', {
      mode: mode(),
      requestedGuildId: resolved.requestedGuildId,
      fallbackGuildId: controlGuild.id,
      errorCode: resolved.error?.code || resolved.error?.rawError?.code || null,
      errorStatus: resolved.error?.status || null,
      errorMessage: resolved.error?.message || null,
    });
  }

  const proxied = withOwnerOptions(interaction, {}, controlGuild, controlGuild.id);
  return button ? testSecurity.handleButton(proxied) : testSecurity.execute(proxied);
}

async function runDuplicator(interaction, values, explicitGuildId = null) {
  const requestedGuildId = interactionGuildId(interaction, explicitGuildId);
  const resolved = await resolveInteractionGuild(interaction, requestedGuildId);
  let controlGuild = resolved.guild;

  if (!controlGuild) {
    controlGuild = firstConnectedGuild(interaction);
    console.warn('[OwnerPanel] Requested guild is unavailable to this bot instance; using a connected guild as Duplicator control context.', {
      mode: mode(),
      requestedGuildId,
      fallbackGuildId: controlGuild?.id || null,
      errorCode: resolved.error?.code || resolved.error?.rawError?.code || null,
      errorStatus: resolved.error?.status || null,
      errorMessage: resolved.error?.message || null,
      customId: String(interaction?.customId || ''),
      channelId: String(interaction?.channelId || ''),
    });
  }

  if (!controlGuild) {
    const payload = noConnectedGuildsPayload(requestedGuildId);
    if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => null);
    else await interaction.reply(payload).catch(() => null);
    return null;
  }

  rememberOwnerGuild(interaction, requestedGuildId || controlGuild.id);
  return duplicator.run(withOwnerOptions(interaction, values, controlGuild, controlGuild.id));
}

async function resolveMaintenanceGuild(interaction, explicitGuildId = null) {
  const resolved = await resolveInteractionGuild(interaction, explicitGuildId);
  return resolved.guild || null;
}

// DEV-only Discord entry point for the permission architect. Read-only until
// a separately reviewed execution engine and rollback support are available.
const AI_ROLE_TEMPLATES = Object.freeze({
  admin: ['ViewChannel', 'SendMessages', 'ManageChannels', 'ManageRoles', 'ManageMessages', 'ManageThreads', 'KickMembers', 'BanMembers', 'ModerateMembers', 'ViewAuditLog'],
  moderator: ['ViewChannel', 'SendMessages', 'ManageMessages', 'ManageThreads', 'KickMembers', 'ModerateMembers', 'ViewAuditLog'],
  member: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'AddReactions', 'Connect', 'Speak'],
  newcomer: ['ViewChannel', 'ReadMessageHistory'],
  bot: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'EmbedLinks', 'AttachFiles'],
});

// One pending operation per owner; short-lived, bound to a single guild and role.
// Never trust role IDs or permission values from Discord component payloads.
const aiPendingRolePlans = new Map();
const aiPendingChannelPlans = new Map();
// Durable DEV-local recovery snapshots, never shared with BETA or PRODUCTION.
function aiRecoveryFile() {
  return path.join(getRuntimePaths('DEV').data, 'goliath-ai-permission-recovery.json');
}
function aiRecoveryRead() {
  if (mode() !== 'DEV') throw new Error('DEV-only recovery');
  const file = aiRecoveryFile();
  if (!fs.existsSync(file)) return [];
  if (fs.statSync(file).size > 262144) throw new Error('Recovery storage limit exceeded');
  const entries = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(entries) || entries.length > 100 ||
      entries.some(item => !aiRecoverySnapshotValid(item))) throw new Error('Invalid recovery storage');
  return entries;
}
function aiRecoveryWrite(entries) {
  if (mode() !== 'DEV' || !Array.isArray(entries) || entries.length > 100 ||
      entries.some(item => !aiRecoverySnapshotValid(item)))
    throw new Error('Invalid DEV recovery write');
  const file = aiRecoveryFile();
  const raw = JSON.stringify(entries);
  if (Buffer.byteLength(raw) > 262144) throw new Error('Recovery storage limit exceeded');
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + '.' + randomUUID() + '.tmp';
  try {
    // Flush the write-ahead journal before exposing it via atomic rename.
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, raw, { encoding: 'utf8' });
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
    // Persist the directory entry as well, so a restart cannot silently lose
    // a journal that was acknowledged before the Discord mutation.
    const dirFd = fs.openSync(path.dirname(file), 'r');
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
  } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
// Exclusive cross-process lock for recovery record mutations. A crashed process
// leaves the lock behind deliberately: fail closed until an operator investigates.
function aiRecoveryLocked(mutator) {
  if (mode() !== 'DEV') throw new Error('DEV-only recovery');
  const lock = aiRecoveryFile() + '.lock';
  fs.mkdirSync(path.dirname(lock), { recursive: true, mode: 0o700 });
  try {
    fs.mkdirSync(lock, { mode: 0o700 });
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error('Recovery store locked; investigate before retrying');
    throw error;
  }
  try {
    return mutator();
  } finally {
    // Never delete a lock owned by another process.
    fs.rmdirSync(lock);
  }
}
function aiRecoveryReady(ownerId, kind, guildId, roleId, channelId = null) {
  const entries = aiRecoveryRead();
  const targetBusy = entries.some(item => (item.status === 'pending' || item.expiresAt > Date.now()) &&
    item.guildId === guildId && item.kind === kind && item.roleId === roleId &&
    (kind === 'role' || item.channelId === channelId));
  if (targetBusy) throw new Error('Target has an unresolved permission transaction');
  if (entries.some(item => item.ownerId === ownerId && item.kind === kind && item.status === 'pending'))
    throw new Error('Previous permission operation requires reconciliation');
  if (entries.some(item => item.ownerId === ownerId && item.kind === kind &&
      item.status !== 'pending' && item.expiresAt > Date.now()))
    throw new Error('Existing recovery snapshot must be restored or allowed to expire before another operation');
  const retained = entries.filter(item => item.expiresAt > Date.now() || item.status === 'pending');
  if (retained.length >= 100 && !retained.some(item => item.ownerId === ownerId && item.kind === kind))
    throw new Error('Recovery storage full');
  // Journal insertion is separately locked and rechecks conflicts.
  if (entries.length > 100) throw new Error('Recovery storage full');
}
function aiRecoverySnapshotValid(item) {
  if (!item || !['role', 'channel'].includes(item.kind) ||
      (item.status && !['pending', 'verified'].includes(item.status)) ||
      !/^\d{16,25}$/.test(String(item.ownerId || '')) ||
      !/^\d{16,25}$/.test(String(item.guildId || '')) ||
      !/^\d{16,25}$/.test(String(item.roleId || '')) ||
      !Number.isFinite(item.expiresAt) || !Number.isFinite(Date.parse(item.createdAt))) return false;
  const bits = value => typeof value === 'string' && /^\d{1,25}$/.test(value);
  if (item.kind === 'role') return bits(item.before) && bits(item.after);
  return /^\d{16,25}$/.test(String(item.channelId || '')) &&
    [item.before, item.after].every(state => state &&
      typeof state.exists === 'boolean' && bits(state.allow) && bits(state.deny));
}
function aiRecoveryGet(ownerId, kind) {
  return aiRecoveryRead().filter(item => item.ownerId === ownerId && item.kind === kind &&
    item.status !== 'pending' &&
    Number.isFinite(item.expiresAt) && item.expiresAt > Date.now()).at(-1) || null;
}
function aiRecoverySave(ownerId, kind, snapshot) {
  return aiRecoveryLocked(() => {
  const entries = aiRecoveryRead();
  const prior = entries.find(item => item.ownerId === ownerId && item.kind === kind &&
    item.status === 'pending');
  if (prior && (snapshot.status !== 'verified' || prior.guildId !== snapshot.guildId ||
      prior.roleId !== snapshot.roleId || (kind === 'channel' && prior.channelId !== snapshot.channelId) ||
      JSON.stringify(prior.before) !== JSON.stringify(snapshot.before) ||
      JSON.stringify(prior.after) !== JSON.stringify(snapshot.after)))
    throw new Error('Pending transaction cannot be overwritten with a different operation');
  if (snapshot.status === 'pending' && entries.some(item => item.ownerId === ownerId &&
      item.kind === kind && item.status !== 'pending' && item.expiresAt > Date.now()))
    throw new Error('Active recovery snapshot cannot be replaced by a new operation');
  if (snapshot.status === 'pending' && entries.some(item => (item.status === 'pending' || item.expiresAt > Date.now()) &&
      item.guildId === snapshot.guildId && item.kind === kind && item.roleId === snapshot.roleId &&
      (kind === 'role' || item.channelId === snapshot.channelId)))
    throw new Error('Target already has an active recovery or pending transaction');
  const retained = entries.filter(item => (item.expiresAt > Date.now() || item.status === 'pending') &&
    !(item.ownerId === ownerId && item.kind === kind));
  retained.push({ ...snapshot, ownerId, kind, createdAt: prior?.createdAt || new Date().toISOString() });
  if (retained.length > 100) throw new Error('Recovery storage full');
  aiRecoveryWrite(retained);
  });
}
function aiRecoveryResolvePending(ownerId, kind, resolution, expectedSnapshot) {
  return aiRecoveryLocked(() => {
  const entries = aiRecoveryRead();
  const index = entries.findIndex(item => item.ownerId === ownerId && item.kind === kind &&
    item.status === 'pending');
  if (index < 0) throw new Error('Pending transaction disappeared; retry reconciliation');
  // Discord was read before acquiring the journal lock. Refuse to resolve a
  // different transaction that may have replaced it in the meantime.
  const current = entries[index];
  if (!expectedSnapshot || current.guildId !== expectedSnapshot.guildId ||
      current.roleId !== expectedSnapshot.roleId ||
      current.channelId !== expectedSnapshot.channelId ||
      current.createdAt !== expectedSnapshot.createdAt ||
      JSON.stringify(current.before) !== JSON.stringify(expectedSnapshot.before) ||
      JSON.stringify(current.after) !== JSON.stringify(expectedSnapshot.after))
    throw new Error('Pending transaction changed; retry reconciliation');
  if (resolution === 'unchanged') entries.splice(index, 1);
  else if (resolution === 'applied') {
    entries[index] = { ...entries[index], status: 'verified',
      expiresAt: Math.max(entries[index].expiresAt, Date.now() + 30 * 60 * 1000) };
  } else throw new Error('Invalid reconciliation outcome');
  aiRecoveryWrite(entries);
  });
}
async function aiReconcilePending(interaction, guildId) {
  await interaction.deferUpdate();
  if (mode() !== 'DEV') return interaction.editReply({ content: 'DEV only.', embeds: [], components: [] });
  const returnControls = [new ActionRowBuilder().addComponents(
    navigationButton(contextualOwnerId('ai-home', guildId), 'Permission Architect', ButtonStyle.Primary),
    navigationButton(contextualOwnerId('home', guildId), 'Back', ButtonStyle.Secondary)
  )];
  const entries = aiRecoveryRead().filter(item => item.ownerId === interaction.user.id &&
    item.guildId === guildId && item.status === 'pending');
  if (!entries.length) return interaction.editReply({ content: 'No pending permission transactions for this guild.', embeds: [], components: returnControls });
  const { guild } = await resolveInteractionGuild(interaction, guildId);
  if (!guild) return interaction.editReply({ content: 'Guild unavailable; pending transactions retained.', embeds: [], components: returnControls });
  const results = [];
  for (const item of entries) {
    try {
      const target = item.kind === 'role'
        ? await guild.roles.fetch(item.roleId, { force: true })
        : await guild.channels.fetch(item.channelId, { force: true });
      const actual = item.kind === 'role'
        ? target?.permissions?.bitfield?.toString()
        : target && aiOverwriteSnapshot(target, item.roleId);
      const equal = (expected) => item.kind === 'role'
        ? actual === expected : actual && aiOverwriteMatches(actual, expected);
      if (equal(item.after)) {
        aiRecoveryResolvePending(interaction.user.id, item.kind, 'applied', item);
        results.push(item.kind + ': applied state verified; recovery enabled');
      } else if (equal(item.before)) {
        aiRecoveryResolvePending(interaction.user.id, item.kind, 'unchanged', item);
        results.push(item.kind + ': original state verified; pending record cleared');
      } else {
        results.push(item.kind + ': drift or unavailable target; pending record retained for manual review');
      }
    } catch (error) {
      results.push(item.kind + ': unable to verify; pending record retained (' + String(error?.message || 'error').slice(0, 100) + ')');
    }
  }
  return interaction.editReply({ content: 'Goliath AI • DEV transaction reconciliation\n' +
    results.join('\n'), embeds: [], components: returnControls });
}
function aiRecoveryDelete(ownerId, kind) {
  return aiRecoveryLocked(() => {
  aiRecoveryWrite(aiRecoveryRead().filter(item => !(item.ownerId === ownerId && item.kind === kind && item.status !== 'pending')));
  });
}
const AI_PLAN_TTL = 10 * 60 * 1000;
function aiRoleCanEdit(guild, role, bot, grants) {
  return Boolean(role && bot && !role.managed && role.id !== guild.id &&
    bot.permissions.has('ManageRoles') &&
    bot.roles.highest.comparePositionTo(role) > 0 &&
    grants.every(permission => bot.permissions.has(permission)));
}
function aiPlanPayload(guild, plan, message) {
  const role = guild?.roles?.cache?.get(plan.roleId);
  const add = plan.grants;
  const embed = new EmbedBuilder().setColor(0xF0B232)
    .setTitle('Goliath AI • Confirm Role Permission Grants')
    .setDescription([
      '**Guild:** ' + (guild?.name || plan.guildId),
      '**Role:** ' + (role ? '<@&' + role.id + '>' : plan.roleId),
      '**Template:** ' + plan.template,
      '**Permissions to GRANT (' + add.length + '):** ' + (add.join(', ') || 'None'),
      '**Permissions to REMOVE:** None',
      '',
      message || 'Confirm to grant only these permissions. Existing grants are retained.',
      'The bot must hold each granted permission and outrank the target role.',
      'Plan expires after 10 minutes. If the role changes before confirmation, the plan is rejected.'
    ].join('\n').slice(0, 3900))
    .setFooter({ text: 'DEV • Owner-only • Explicit approval required' });
  const row = new ActionRowBuilder().addComponents(
    navigationButton(contextualOwnerId('ai-apply-role', plan.guildId), 'Confirm Grants', ButtonStyle.Danger, !add.length),
    navigationButton(contextualOwnerId('ai-cancel-role', plan.guildId), 'Cancel', ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [row] };
}
async function aiStageRolePlan(interaction, guildId, roleId, templateName) {
  if (mode() !== 'DEV') return interaction.reply({ content: 'DEV only.', flags: MessageFlags.Ephemeral });
  await interaction.deferUpdate();
  const { guild } = await resolveInteractionGuild(interaction, guildId);
  if (!guild) return interaction.editReply({ content: 'Guild unavailable.', embeds: [], components: [] });
  await Promise.all([guild.roles.fetch(), guild.members.fetchMe()]);
  const role = guild.roles.cache.get(roleId);
  const template = AI_ROLE_TEMPLATES[templateName];
  if (!role || !template) return interaction.editReply({ content: 'Invalid role or template.', embeds: [], components: [] });
  const grants = template.filter(permission => !role.permissions.has(permission));
  if (grants.includes('Administrator'))
    return interaction.editReply({ content: 'Administrator cannot be granted through AI plans.', embeds: [], components: [] });
  if (!aiRoleCanEdit(guild, role, guild.members.me, grants))
    return interaction.editReply({ content: 'Goliath cannot safely grant these permissions. Check its permissions and role hierarchy.', embeds: [], components: [] });
  const plan = { ownerId: interaction.user.id, guildId: guild.id, roleId: role.id,
    template: templateName, grants, original: role.permissions.bitfield.toString(),
    expiresAt: Date.now() + AI_PLAN_TTL };
  aiPendingRolePlans.set(interaction.user.id, plan);
  return interaction.editReply(aiPlanPayload(guild, plan));
}
async function aiApplyRolePlan(interaction, guildId) {
  await interaction.deferUpdate();
  const plan = aiPendingRolePlans.get(interaction.user.id);
  // A second confirmation cannot race the first write.
  aiPendingRolePlans.delete(interaction.user.id);
  if (mode() !== 'DEV' || !plan || plan.guildId !== guildId || Date.now() > plan.expiresAt)
    return interaction.editReply({ content: 'Permission plan expired or invalid. Create a new preview.', embeds: [], components: [] });
  const { guild } = await resolveInteractionGuild(interaction, plan.guildId);
  if (!guild) return interaction.editReply({ content: 'Guild unavailable.', embeds: [], components: [] });
  await Promise.all([guild.roles.fetch(), guild.members.fetchMe()]);
  const role = await guild.roles.fetch(plan.roleId, { force: true }).catch(() => null);
  if (!role || role.permissions.bitfield.toString() !== plan.original ||
      plan.grants.includes('Administrator') ||
      !aiRoleCanEdit(guild, role, guild.members.me, plan.grants))
    return interaction.editReply({ content: 'Permissions or hierarchy changed. Nothing applied; prepare a new plan.', embeds: [], components: [] });
  if (!plan.grants.length) return interaction.editReply({ content: 'No changes required.', embeds: [], components: [] });
  const expected = new PermissionsBitField(role.permissions.bitfield).add(...plan.grants);
  try {
    aiRecoveryReady(interaction.user.id, 'role', guild.id, role.id);
    aiRecoverySave(interaction.user.id, 'role', {
      guildId: guild.id, roleId: role.id, before: plan.original,
      after: expected.bitfield.toString(), status: 'pending',
      expiresAt: Date.now() + 30 * 60 * 1000
    });
    await role.setPermissions(expected, 'Goliath AI DEV owner-approved role grants by ' + interaction.user.id);
    const verified = await guild.roles.fetch(role.id, { force: true });
    if (!verified || verified.permissions.bitfield.toString() !== expected.bitfield.toString())
      throw new Error('Permission verification failed after Discord update.');
    const after = verified.permissions.bitfield.toString();
    aiRecoverySave(interaction.user.id, 'role', {
      guildId: guild.id, roleId: role.id, before: plan.original, after,
      status: 'verified', expiresAt: Date.now() + 30 * 60 * 1000
    });
    console.info('[Goliath AI] Owner-approved role grants', { guildId: guild.id, roleId: role.id,
      ownerId: interaction.user.id, grants: plan.grants });
    return interaction.editReply({
      content: 'Applied and verified ' + plan.grants.length +
        ' permission grants for <@&' + role.id + '>. No existing permissions removed. ' +
        'A 30-minute recovery snapshot is saved in DEV runtime storage.',
      embeds: [],
      components: [new ActionRowBuilder().addComponents(
        navigationButton(contextualOwnerId('ai-recovery-preview', guild.id), 'Review Recovery', ButtonStyle.Secondary)
      )]
    });
  } catch (error) {
    console.error('[Goliath AI] Role grant failed', { guildId: guild.id, roleId: plan.roleId,
      ownerId: interaction.user.id, error: error?.message });
    return interaction.editReply({ content: 'Permission update or verification failed. Review Discord role permissions before retrying. ' +
      'The original permissions were: ' + plan.original, embeds: [], components: [] });
  }
}

async function aiRecoverRole(interaction, guildId, confirm = false) {
  await interaction.deferUpdate();
  const snapshot = aiRecoveryGet(interaction.user.id, 'role');
  if (mode() !== 'DEV' || !snapshot || snapshot.guildId !== guildId ||
      Date.now() > snapshot.expiresAt) {
    aiRecoveryDelete(interaction.user.id, 'role');
    return interaction.editReply({ content: 'No active recovery snapshot. Recovery expires after 30 minutes.',
      embeds: [], components: [] });
  }
  const { guild } = await resolveInteractionGuild(interaction, guildId);
  if (!guild) return interaction.editReply({ content: 'Guild unavailable.', embeds: [], components: [] });
  await Promise.all([guild.roles.fetch(), guild.members.fetchMe()]);
  const role = await guild.roles.fetch(snapshot.roleId, { force: true }).catch(() => null);
  if (!role || role.permissions.bitfield.toString() !== snapshot.after) {
    return interaction.editReply({ content: 'Role permissions have changed since the operation. Recovery blocked to avoid overwriting newer changes.',
      embeds: [], components: [] });
  }
  const oldPermissions = new PermissionsBitField(BigInt(snapshot.before));
  const currentPermissions = new PermissionsBitField(BigInt(snapshot.after));
  // Restoring a snapshot must not grant permissions Goliath cannot itself grant.
  const restoreGrants = oldPermissions.toArray().filter(permission => !currentPermissions.has(permission));
  if (!aiRoleCanEdit(guild, role, guild.members.me, restoreGrants)) {
    return interaction.editReply({ content: 'Goliath lacks permission or hierarchy to restore the previous role settings.',
      embeds: [], components: [] });
  }
  if (!confirm) {
    const embed = new EmbedBuilder().setColor(0xF0B232)
      .setTitle('Goliath AI • Recovery Confirmation')
      .setDescription('Restore the previous permission bitfield for <@&' + role.id +
        '>? This replaces the current role permission set. It is only permitted if the role is unchanged since the AI operation.')
      .setFooter({ text: 'DEV • Recovery expires after 30 minutes' });
    return interaction.editReply({ embeds: [embed], content: '',
      components: [new ActionRowBuilder().addComponents(
        navigationButton(contextualOwnerId('ai-recovery-confirm', guildId), 'Confirm Restore', ButtonStyle.Danger),
        navigationButton(contextualOwnerId('ai-recovery-cancel', guildId), 'Cancel', ButtonStyle.Secondary)
      )] });
  }
  // Keep the durable recovery record until Discord confirms restoration.
  try {
    await role.setPermissions(oldPermissions, 'Goliath AI DEV owner-approved recovery by ' + interaction.user.id);
    const verified = await guild.roles.fetch(role.id, { force: true });
    if (!verified || verified.permissions.bitfield.toString() !== snapshot.before)
      throw new Error('Recovery verification mismatch');
    aiRecoveryDelete(interaction.user.id, 'role');
    console.info('[Goliath AI] Role recovery verified', { guildId, roleId: role.id, ownerId: interaction.user.id });
    return interaction.editReply({ content: 'Original permissions restored and verified for <@&' + role.id + '>.', embeds: [], components: [] });
  } catch (error) {
    console.error('[Goliath AI] Role recovery failed', { guildId, roleId: role.id, error: error?.message });
    return interaction.editReply({ content: 'Recovery failed or could not be verified. Check the role manually. Original bitfield: ' +
      snapshot.before, embeds: [], components: [] });
  }
}

function aiRoleTemplateComparison(guild, roleId, templateName) {
  const role = guild?.roles?.cache?.get(roleId);
  const expected = AI_ROLE_TEMPLATES[templateName];
  if (!role || !expected) return ['Role or template unavailable. Refresh and select again.'];
  const actual = new Set(role.permissions.toArray());
  const target = new Set(expected);
  const add = [...target].filter(permission => !actual.has(permission));
  const remove = [...actual].filter(permission => !target.has(permission));
  const bot = guild.members.me;
  const editable = Boolean(bot?.permissions?.has('ManageRoles') &&
    bot.roles.highest.comparePositionTo(role) > 0 && !role.managed && role.id !== guild.id);
  return [
    '**Role:** <@&' + role.id + '> • **Template:** ' + templateName,
    '**Suggested grants (' + add.length + '):** ' + (add.join(', ') || 'None'),
    '**Existing permissions outside template (' + remove.length + '):** ' + (remove.join(', ') || 'None'),
    '',
    '**Goliath can manage this role:** ' + (editable ? 'Yes (subject to permission hierarchy)' : 'No — check Manage Roles, hierarchy or managed-role restrictions'),
    '**Administrator currently granted:** ' + (actual.has('Administrator') ? 'Yes — bypasses channel restrictions' : 'No'),
    '',
    'This is a proposed difference, NOT an instruction to remove every extra permission. Review every grant and removal before execution.',
    'No permissions have been changed.'
  ];
}

function aiTemplateSelectRow(guildId, roleId) {
  const select = new StringSelectMenuBuilder()
    .setCustomId('ownerpanel:ai-compare:' + roleId + ':guild:' + guildId)
    .setPlaceholder('Compare selected role with a template')
    .addOptions(Object.keys(AI_ROLE_TEMPLATES).map(name => ({
      label: name[0].toUpperCase() + name.slice(1),
      value: name,
      description: 'Preview grants and extra permissions'
    })));
  return new ActionRowBuilder().addComponents(select);
}

// Channel overwrites must never be used to escalate guild-wide privileges.
// Templates can contain guild-level bits; those belong in the separate role plan.
const AI_CHANNEL_GRANTS = new Set([
  'ViewChannel', 'SendMessages', 'ReadMessageHistory', 'AddReactions',
  'Connect', 'Speak', 'EmbedLinks', 'AttachFiles', 'ManageMessages',
  'ManageThreads', 'SendMessagesInThreads', 'UseApplicationCommands',
  'CreatePublicThreads', 'CreatePrivateThreads'
]);
function aiChannelTemplatePermissions(template) {
  return template.filter(permission => AI_CHANNEL_GRANTS.has(permission));
}
function aiChannelCanEdit(guild, channel, role, bot, grants) {
  const access = bot && channel?.permissionsFor(bot);
  return Boolean(channel?.permissionOverwrites && role && bot && !role.managed &&
    role.id !== guild.id && bot.roles.highest.comparePositionTo(role) > 0 &&
    access?.has('ManageRoles') && grants.every(permission => bot.permissions.has(permission)));
}
function aiOverwriteSnapshot(channel, roleId) {
  const entry = channel.permissionOverwrites.cache.get(roleId);
  return { exists: Boolean(entry), allow: entry?.allow?.bitfield?.toString() || '0',
    deny: entry?.deny?.bitfield?.toString() || '0' };
}
function aiOverwriteMatches(a, b) {
  return a.exists === b.exists && a.allow === b.allow && a.deny === b.deny;
}
async function aiStageChannelPlan(interaction, guildId, channelId, roleId, templateName) {
  await interaction.deferUpdate();
  if (mode() !== 'DEV') return interaction.editReply({ content: 'DEV only.', embeds: [], components: [] });
  const { guild } = await resolveInteractionGuild(interaction, guildId);
  if (!guild) return interaction.editReply({ content: 'Guild unavailable.', embeds: [], components: [] });
  await Promise.all([guild.channels.fetch(), guild.roles.fetch(), guild.members.fetchMe()]);
  const channel = await guild.channels.fetch(channelId, { force: true }).catch(() => null);
  const role = await guild.roles.fetch(roleId, { force: true }).catch(() => null);
  const template = AI_ROLE_TEMPLATES[templateName];
  if (!channel || !role || !template)
    return interaction.editReply({ content: 'Invalid channel, role or template.', embeds: [], components: [] });
  const before = aiOverwriteSnapshot(channel, role.id);
  const grants = aiChannelTemplatePermissions(template).filter(permission =>
    !(new PermissionsBitField(BigInt(before.allow))).has(permission));
  if (!grants.length) return interaction.editReply({ content: 'All eligible channel permissions are already allowed. No changes needed.', embeds: [], components: [] });
  if (!aiChannelCanEdit(guild, channel, role, guild.members.me, grants))
    return interaction.editReply({ content: 'Goliath cannot safely edit this role overwrite.', embeds: [], components: [] });
  const plan = { guildId: guild.id, channelId: channel.id, roleId: role.id, template: templateName,
    grants, before, expiresAt: Date.now() + AI_PLAN_TTL };
  aiPendingChannelPlans.set(interaction.user.id, plan);
  const embed = new EmbedBuilder().setColor(0xF0B232).setTitle('Goliath AI • Confirm Channel Grants')
    .setDescription([
      '**Channel/category:** <#' + channel.id + '>',
      '**Role:** <@&' + role.id + '>',
      '**Template:** ' + templateName,
      '**Guild-only permissions excluded:** ' + (template.filter(permission => !AI_CHANNEL_GRANTS.has(permission)).join(', ') || 'None'),
      '**Explicit permissions to grant:** ' + (grants.join(', ') || 'None'),
      '**Conflicting denies to clear:** ' + grants.filter(permission =>
        new PermissionsBitField(BigInt(before.deny)).has(permission)).join(', '),
      '**Other allows and denies:** Preserved',
      '',
      'This modifies a channel overwrite, not the server-wide role. Category changes may affect synced children.',
      'Expires in 10 minutes. Any overwrite drift blocks execution.'
    ].join('\n').slice(0, 3900));
  return interaction.editReply({ embeds: [embed], content: '',
    components: [new ActionRowBuilder().addComponents(
      navigationButton(contextualOwnerId('ai-apply-channel', guild.id), 'Confirm Channel Grants', ButtonStyle.Danger, !grants.length),
      navigationButton(contextualOwnerId('ai-cancel-channel', guild.id), 'Cancel', ButtonStyle.Secondary)
    )] });
}
async function aiApplyChannelPlan(interaction, guildId) {
  await interaction.deferUpdate();
  const plan = aiPendingChannelPlans.get(interaction.user.id);
  aiPendingChannelPlans.delete(interaction.user.id);
  if (mode() !== 'DEV' || !plan || plan.guildId !== guildId || Date.now() > plan.expiresAt)
    return interaction.editReply({ content: 'Channel plan expired or invalid.', embeds: [], components: [] });
  const { guild } = await resolveInteractionGuild(interaction, guildId);
  if (!guild) return interaction.editReply({ content: 'Guild unavailable.', embeds: [], components: [] });
  await Promise.all([guild.members.fetchMe(), guild.roles.fetch()]);
  const channel = await guild.channels.fetch(plan.channelId, { force: true }).catch(() => null);
  const role = await guild.roles.fetch(plan.roleId, { force: true }).catch(() => null);
  if (!channel || !role || plan.grants.some(permission => !AI_CHANNEL_GRANTS.has(permission)) ||
      !aiOverwriteMatches(aiOverwriteSnapshot(channel, plan.roleId), plan.before) ||
      !aiChannelCanEdit(guild, channel, role, guild.members.me, plan.grants))
    return interaction.editReply({ content: 'Overwrite, bot access or hierarchy changed. No changes applied.', embeds: [], components: [] });
  if (!plan.grants.length) return interaction.editReply({ content: 'No changes required.', embeds: [], components: [] });
  const allow = new PermissionsBitField(BigInt(plan.before.allow)).add(...plan.grants);
  const deny = new PermissionsBitField(BigInt(plan.before.deny)).remove(...plan.grants);
  const changes = {};
  for (const permission of plan.grants) changes[permission] = true;
  try {
    aiRecoveryReady(interaction.user.id, 'channel', guildId, role.id, channel.id);
    aiRecoverySave(interaction.user.id, 'channel', {
      guildId, channelId: channel.id, roleId: role.id, before: plan.before,
      after: { exists: true, allow: allow.bitfield.toString(), deny: deny.bitfield.toString() },
      status: 'pending', expiresAt: Date.now() + 30 * 60 * 1000
    });
    await channel.permissionOverwrites.edit(role, changes, { reason: 'Goliath AI DEV approved channel grants by ' + interaction.user.id });
    const updated = await guild.channels.fetch(channel.id, { force: true });
    const after = aiOverwriteSnapshot(updated, role.id);
    if (!after.exists || after.allow !== allow.bitfield.toString() || after.deny !== deny.bitfield.toString())
      throw new Error('Channel overwrite verification mismatch');
    aiRecoverySave(interaction.user.id, 'channel', { guildId, channelId: channel.id, roleId: role.id,
      before: plan.before, after, status: 'verified', expiresAt: Date.now() + 30 * 60 * 1000 });
    console.info('[Goliath AI] Channel grants verified', { guildId, channelId: channel.id,
      roleId: role.id, ownerId: interaction.user.id, grants: plan.grants, before: plan.before, after });
    return interaction.editReply({ content: 'Channel overwrite applied and verified for <@&' + role.id +
      '> in <#' + channel.id + '>. A 30-minute recovery snapshot is saved in DEV runtime storage.',
      embeds: [], components: [new ActionRowBuilder().addComponents(
        navigationButton(contextualOwnerId('ai-channel-recover', guild.id), 'Review Channel Recovery', ButtonStyle.Secondary)
      )] });
  } catch (error) {
    console.error('[Goliath AI] Channel grants failed', { guildId, channelId: plan.channelId,
      roleId: plan.roleId, error: error?.message, before: plan.before });
    return interaction.editReply({ content: 'Channel update or verification failed. Review the overwrite manually; prior state: ' +
      JSON.stringify(plan.before), embeds: [], components: [] });
  }
}

async function aiRecoverChannel(interaction, guildId, confirm = false) {
  await interaction.deferUpdate();
  const snapshot = aiRecoveryGet(interaction.user.id, 'channel');
  if (mode() !== 'DEV' || !snapshot || snapshot.guildId !== guildId || Date.now() > snapshot.expiresAt) {
    aiRecoveryDelete(interaction.user.id, 'channel');
    return interaction.editReply({ content: 'No active channel recovery snapshot.', embeds: [], components: [] });
  }
  const { guild } = await resolveInteractionGuild(interaction, guildId);
  if (!guild) return interaction.editReply({ content: 'Guild unavailable.', embeds: [], components: [] });
  await Promise.all([guild.members.fetchMe(), guild.roles.fetch()]);
  const channel = await guild.channels.fetch(snapshot.channelId, { force: true }).catch(() => null);
  const role = await guild.roles.fetch(snapshot.roleId, { force: true }).catch(() => null);
  if (!channel || !role || !aiOverwriteMatches(aiOverwriteSnapshot(channel, role.id), snapshot.after))
    return interaction.editReply({ content: 'Channel overwrite changed since execution. Recovery blocked.', embeds: [], components: [] });
  const previousAllow = new PermissionsBitField(BigInt(snapshot.before.allow));
  const currentAllow = new PermissionsBitField(BigInt(snapshot.after.allow));
  const restoreGrants = previousAllow.toArray().filter(permission => !currentAllow.has(permission));
  if (!aiChannelCanEdit(guild, channel, role, guild.members.me, restoreGrants))
    return interaction.editReply({ content: 'Goliath cannot safely restore this channel overwrite.', embeds: [], components: [] });
  if (!confirm) {
    return interaction.editReply({ content: 'Restore the previous overwrite for <@&' + role.id +
      '> in <#' + channel.id + '>?' + (snapshot.before.exists ? ' Existing allows and denies will be restored.' :
      ' The AI-created overwrite will be removed.'), embeds: [],
      components: [new ActionRowBuilder().addComponents(
        navigationButton(contextualOwnerId('ai-channel-restore', guildId), 'Confirm Restore', ButtonStyle.Danger),
        navigationButton(contextualOwnerId('ai-channel-abort', guildId), 'Cancel', ButtonStyle.Secondary)
      )] });
  }
  // Preserve the recovery record if the Discord write or verification fails.
  try {
    if (!snapshot.before.exists) {
      await channel.permissionOverwrites.delete(role, 'Goliath AI DEV approved channel recovery by ' + interaction.user.id);
    } else {
      const values = {};
      // Reset only permissions changed by this operation. Never replace the
      // channel-wide overwrite collection, which may contain other users/roles.
      const allBits = new PermissionsBitField(
        BigInt(snapshot.after.allow) | BigInt(snapshot.after.deny) |
        BigInt(snapshot.before.allow) | BigInt(snapshot.before.deny)
      );
      const previousDeny = new PermissionsBitField(BigInt(snapshot.before.deny));
      for (const permission of allBits.toArray()) {
        values[permission] = previousAllow.has(permission) ? true :
          previousDeny.has(permission) ? false : null;
      }
      await channel.permissionOverwrites.edit(role, values, {
        reason: 'Goliath AI DEV approved channel recovery by ' + interaction.user.id
      });
    }
    const refreshed = await guild.channels.fetch(channel.id, { force: true });
    if (!aiOverwriteMatches(aiOverwriteSnapshot(refreshed, role.id), snapshot.before))
      throw new Error('Channel recovery verification mismatch');
    aiRecoveryDelete(interaction.user.id, 'channel');
    console.info('[Goliath AI] Channel recovery verified', { guildId, channelId: channel.id, roleId: role.id,
      ownerId: interaction.user.id });
    return interaction.editReply({ content: 'Previous channel overwrite restored and verified.', embeds: [], components: [] });
  } catch (error) {
    console.error('[Goliath AI] Channel recovery failed', { guildId, channelId: snapshot.channelId,
      roleId: snapshot.roleId, error: error?.message, before: snapshot.before });
    return interaction.editReply({ content: 'Recovery failed or verification mismatched. Review manually. Previous overwrite: ' +
      JSON.stringify(snapshot.before), embeds: [], components: [] });
  }
}

function aiChannelPermissionPlan(guild, channelId, roleId, templateName) {
  const channel = guild?.channels?.cache?.get(channelId);
  const role = guild?.roles?.cache?.get(roleId);
  const template = AI_ROLE_TEMPLATES[templateName];
  if (!channel || !role || !template) return ['Channel, role or template unavailable.'];
  const overwrite = channel.permissionOverwrites.cache.get(role.id);
  const currentAllow = new Set(overwrite?.allow?.toArray() || []);
  const currentDeny = new Set(overwrite?.deny?.toArray() || []);
  const channelTemplate = aiChannelTemplatePermissions(template);
  const grants = channelTemplate.filter(permission => !currentAllow.has(permission));
  const conflicting = channelTemplate.filter(permission => currentDeny.has(permission));
  const bot = guild.members.me;
  const botAccess = channel.permissionsFor(bot);
  const canEdit = Boolean(bot?.permissions?.has('ManageRoles') &&
    botAccess?.has('ManageRoles') && bot.roles.highest.comparePositionTo(role) > 0 &&
    !role.managed && role.id !== guild.id);
  return [
    '**Channel/category:** <#' + channel.id + '> • **Target role:** <@&' + role.id + '>',
    '**Requested template:** ' + templateName,
    '**Explicit grants already set:** ' + (channelTemplate.length - grants.length) + '/' + channelTemplate.length,
    '**Guild-only permissions excluded:** ' + (template.filter(permission => !AI_CHANNEL_GRANTS.has(permission)).join(', ') || 'None'),
    '**Grants to add (' + grants.length + '):** ' + (grants.join(', ') || 'None'),
    '**Explicit denies conflicting with template (' + conflicting.length + '):** ' + (conflicting.join(', ') || 'None'),
    '**Other existing allows:** ' + ([...currentAllow].filter(p => !template.includes(p)).join(', ') || 'None'),
    '**Other existing denies:** ' + ([...currentDeny].filter(p => !template.includes(p)).join(', ') || 'None'),
    '**Goliath can edit this overwrite:** ' + (canEdit ? 'Likely (Discord permissions still apply)' : 'No — verify bot permissions and role hierarchy'),
    '',
    'Preview only. A role may inherit access from other roles or category settings. Explicit grants do not guarantee effective access.',
    'No permission overwrites have been changed.'
  ];
}

function aiChannelRoleSelectRow(guild, channelId) {
  const roles = [...guild.roles.cache.values()].filter(role => !role.managed && role.id !== guild.id)
    .sort((a, b) => b.position - a.position).slice(0, 25);
  if (!roles.length) return null;
  return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
    .setCustomId('ownerpanel:ai-target-role:' + channelId + ':guild:' + guild.id)
    .setPlaceholder('Select role for channel permission plan')
    .addOptions(roles.map(role => ({ label: role.name.slice(0, 100), value: role.id }))));
}

function aiChannelTemplateRow(guildId, channelId, roleId) {
  return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
    .setCustomId('ownerpanel:ai-channel-template:' + channelId + ':' + roleId + ':guild:' + guildId)
    .setPlaceholder('Choose channel permission template')
    .addOptions(Object.keys(AI_ROLE_TEMPLATES).map(name => ({
      label: name[0].toUpperCase() + name.slice(1), value: name
    }))));
}

function aiPermissionDetails(guild, kind, id) {
  if (!guild) return ['Guild unavailable.'];
  if (kind === 'role') {
    const role = guild.roles.cache.get(id);
    if (!role) return ['Role not found. Refresh the scan.'];
    const enabled = role.permissions.toArray().sort();
    return [
      '**Role:** <@&' + role.id + '> (ID: ' + role.id + ')',
      '**Position:** ' + role.position + ' • **Managed:** ' + (role.managed ? 'Yes' : 'No'),
      '**Permissions (' + enabled.length + '):** ' + (enabled.map(p => '\`' + p + '\`').join(', ') || 'None'),
      '',
      'Choose a template below to preview differences for this specific role. No changes are made.'
    ];
  }
  const channel = guild.channels.cache.get(id);
  if (!channel) return ['Channel not found. Refresh the scan.'];
  const entries = [...channel.permissionOverwrites.cache.values()];
  const lines = [
    '**Channel:** <#' + channel.id + '> (ID: ' + channel.id + ')',
    '**Category:** ' + (channel.parent ? channel.parent.name : 'None'),
    '**Overwrites:** ' + entries.length,
    '**Category-synced:** ' + (channel.permissionsLocked === null ? 'N/A' : channel.permissionsLocked ? 'Yes' : 'No'),
    ''
  ];
  for (const overwrite of entries.slice(0, 18)) {
    const label = overwrite.type === 0 ? '<@&' + overwrite.id + '>' : '<@' + overwrite.id + '>';
    const allow = overwrite.allow.toArray().join(', ') || 'None';
    const deny = overwrite.deny.toArray().join(', ') || 'None';
    lines.push('**' + label + '**', 'Allow: ' + allow, 'Deny: ' + deny);
  }
  if (entries.length > 18) lines.push('+' + (entries.length - 18) + ' additional overwrites not shown.');
  return lines;
}

function aiSelectRow(guild, kind, page) {
  const collection = kind === 'role' ? guild?.roles?.cache : guild?.channels?.cache;
  if (!collection?.size) return null;
  const items = [...collection.values()].sort((a, b) => a.name.localeCompare(b.name));
  const pages = Math.max(1, Math.ceil(items.length / 25));
  const current = Math.max(0, Math.min(page, pages - 1));
  const slice = items.slice(current * 25, (current + 1) * 25);
  const select = new StringSelectMenuBuilder()
    .setCustomId('ownerpanel:ai-select-' + kind + ':' + current + ':guild:' + guild.id)
    .setPlaceholder('Inspect ' + kind + ' (' + (current + 1) + '/' + pages + ')')
    .addOptions(slice.map(item => ({
      label: item.name.slice(0, 100) || item.id,
      value: item.id,
      description: ('ID ' + item.id).slice(0, 100)
    })));
  return new ActionRowBuilder().addComponents(select);
}

function aiPanelPayload(interaction, guild, detail = 'overview', selectedId = null, page = 0) {
  const guildId = validGuildId(guild?.id) || interactionGuildId(interaction);
  const roles = guild?.roles?.cache;
  const channels = guild?.channels?.cache;
  const botMember = guild?.members?.me || guild?.members?.cache?.get?.(interaction.client.user?.id);
  const botRole = botMember?.roles?.highest;
  const categoryCount = channels ? [...channels.values()].filter(channel => channel.type === 4).length : 0;
  const lines = [];
  if (!guild) {
    lines.push('Select a guild where the DEV bot is present, then run the scan. No changes will be made.');
  } else if (detail === 'bot') {
    const permissions = botMember?.permissions;
    lines.push(
      '**Goliath bot identity:** ' + (botMember ? '<@' + botMember.id + '>' : 'Not available'),
      '**Highest role:** ' + (botRole ? '<@&' + botRole.id + '>' : 'Unavailable'),
      '**Administrator:** ' + (permissions?.has('Administrator') ? 'Granted (bypasses channel overwrites)' : 'Not granted'),
      '**Manage Roles:** ' + (permissions?.has('ManageRoles') ? 'Granted' : 'Missing'),
      '**Manage Channels:** ' + (permissions?.has('ManageChannels') ? 'Granted' : 'Missing'),
      '**View Audit Log:** ' + (permissions?.has('ViewAuditLog') ? 'Granted' : 'Missing'),
      '',
      'Discord role hierarchy limits which roles Goliath can edit. Category and channel overwrites may further restrict access.'
    );
  } else if (detail === 'channel-plan') {
    lines.push(...aiChannelPermissionPlan(guild, selectedId?.channelId, selectedId?.roleId, selectedId?.template));
  } else if (detail === 'channel-target') {
    lines.push('**Selected channel:** <#' + selectedId?.channelId + '>', 'Choose a role below, then select the template to preview the exact channel overwrite differences.');
  } else if (detail === 'comparison') {
    lines.push(...aiRoleTemplateComparison(guild, selectedId?.roleId, selectedId?.template));
  } else if (detail === 'role' || detail === 'channel') {
    lines.push(...(selectedId ? aiPermissionDetails(guild, detail, selectedId) : ['Select a ' + detail + ' to inspect its permissions and channel overwrites.']));
  } else if (detail === 'templates') {
    for (const [name, permissions] of Object.entries(AI_ROLE_TEMPLATES)) {
      lines.push('**' + name[0].toUpperCase() + name.slice(1) + ':** ' + permissions.map(p => '\`' + p + '\`').join(', '));
    }
    lines.push('', 'Advisory baselines only. Bot permissions must be adjusted per enabled module and channel. Administrator is intentionally excluded.');
  } else {
    lines.push(
      '**Roles:** ' + (roles?.size ?? 'Unavailable'),
      '**Channels:** ' + (channels?.size ?? 'Unavailable'),
      '**Categories:** ' + categoryCount,
      '**Goliath bot role:** ' + (botRole ? '<@&' + botRole.id + '>' : 'Unavailable'),
      '',
      'Choose **Scan Goliath** for the bot permission baseline or **Role Templates** for recommended starting permissions.',
      'Role and channel permission plans require explicit owner approval. Execution is DEV-only and not yet validated for production use.'
    );
  }
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('Goliath AI • Permission Architect')
    .setDescription(lines.join('\n').slice(0, 3900))
    .addFields({ name: 'Selected guild', value: guild ? guild.name + ' • ' + guild.id : (guildId || 'No guild selected') })
    .setFooter({ text: 'DEV • Owner-only • Inspection is read-only; approved plans can change Discord permissions' });
  if (guild && mode() === 'DEV') lines.push('', 'Interrupted permission transactions can be inspected using **Reconcile Pending**.');
  const controls = new ActionRowBuilder().addComponents(
    navigationButton(contextualOwnerId('ai-scan', guildId), 'Scan Goliath', ButtonStyle.Primary, !guildId),
    navigationButton(contextualOwnerId('ai-templates', guildId), 'Role Templates', ButtonStyle.Secondary),
    navigationButton(contextualOwnerId('ai-roles', guildId), 'Inspect Roles', ButtonStyle.Secondary, !guildId),
    navigationButton(contextualOwnerId('ai-channels', guildId), 'Inspect Channels', ButtonStyle.Secondary, !guildId),
    navigationButton(contextualOwnerId('home', guildId), 'Back', ButtonStyle.Secondary)
  );
  const rows = [controls];
  if (guild && mode() === 'DEV') rows.push(new ActionRowBuilder().addComponents(
    navigationButton(contextualOwnerId('ai-reconcile', guild.id), 'Reconcile Pending', ButtonStyle.Secondary)
  ));
  if (guild && detail === 'channel' && typeof selectedId === 'string') {
    const selector = aiChannelRoleSelectRow(guild, selectedId);
    if (selector) rows.push(selector);
  }
  if (guild && detail === 'channel-target' && selectedId?.channelId && selectedId?.roleId) {
    rows.push(aiChannelTemplateRow(guild.id, selectedId.channelId, selectedId.roleId));
  }
  if (guild && detail === 'channel-plan' && selectedId?.channelId && selectedId?.roleId && selectedId?.template) {
    rows.push(new ActionRowBuilder().addComponents(
      navigationButton(contextualOwnerId('acs:' + selectedId.channelId + ':' + selectedId.roleId + ':' + selectedId.template, guild.id), 'Prepare Channel Plan', ButtonStyle.Primary)
    ));
  }
  if (guild && detail === 'comparison' && selectedId?.roleId && selectedId?.template) {
    rows.push(new ActionRowBuilder().addComponents(
      navigationButton(contextualOwnerId('ai-stage-' + selectedId.roleId + '-' + selectedId.template, guild.id), 'Prepare Grant Plan', ButtonStyle.Primary)
    ));
  }
  if (guild && detail === 'role' && selectedId && typeof selectedId === 'string') {
    rows.push(aiTemplateSelectRow(guild.id, selectedId));
  }
  if (guild && (detail === 'role' || detail === 'channel')) {
    const selector = aiSelectRow(guild, detail, page);
    if (selector) rows.push(selector);
    const total = detail === 'role' ? guild.roles.cache.size : guild.channels.cache.size;
    if (total > 25) rows.push(new ActionRowBuilder().addComponents(
      navigationButton(contextualOwnerId('ai-page-' + detail + '-' + Math.max(0, page - 1), guildId), 'Previous', ButtonStyle.Secondary, page <= 0),
      navigationButton(contextualOwnerId('ai-page-' + detail + '-' + (page + 1), guildId), 'Next', ButtonStyle.Secondary, (page + 1) * 25 >= total)
    ));
  }
  return { content: null, embeds: [embed], components: rows };
}

async function handleOwnerAI(interaction, action, guildId, selectedId = null, page = 0) {
  if (mode() !== 'DEV') {
    await interaction.update(ownerHomePayload(interaction, 'Goliath AI Discord controls are DEV-only.'));
    return;
  }
  await interaction.deferUpdate();
  const resolved = await resolveInteractionGuild(interaction, guildId);
  const guild = resolved.guild;
  if (guild) {
    await Promise.all([guild.roles.fetch(), guild.channels.fetch(), guild.members.fetchMe()]).catch(() => null);
  }
  const detail = action === 'ai-scan' ? 'bot' : action === 'ai-templates' ? 'templates' :
    action === 'ai-roles' ? 'role' : action === 'ai-channels' ? 'channel' : action;
  await interaction.editReply(aiPanelPayload(interaction, guild, detail, selectedId, page));
}

async function handleOwnerPanelInteraction(interaction) {
  const rawId = String(interaction?.customId || '');
  if (rawId.startsWith('ownerpanel:restart:') ||
      rawId.startsWith('ownerpanel:guildaccess:') ||
      /^ownerpanel:(?:home|refresh)(?::guild:\d+)?$/.test(rawId)) {
    if (devControlInteractions.has(interaction)) return true;
    devControlInteractions.add(interaction);
  }

  const id = baseOwnerCustomId(rawId);
  if (!id.startsWith(OWNER_PREFIX) && !id.startsWith('testsecurity:')) return false;

  if (!ownerAllowed(interaction)) {
    if (interaction.deferred || interaction.replied) await interaction.editReply(ownerDeniedPayload()).catch(() => null);
    else await interaction.reply(ownerDeniedPayload()).catch(() => null);
    return true;
  }

  if (await restartControls.handle(interaction)) return true;
  if (await guildAccessControls.handle(interaction)) return true;

  const contextGuildId = interactionGuildId(interaction, embeddedGuildId(rawId));
  if (contextGuildId) rememberOwnerGuild(interaction, contextGuildId);

  if (id.startsWith('testsecurity:')) {
    await runSecurityTests(interaction, contextGuildId, true);
    return true;
  }

  if (id === `${OWNER_PREFIX}home` || id === `${OWNER_PREFIX}refresh`) {
    await interaction.update(ownerHomePayload(interaction));
    return true;
  }

  if (id === `${OWNER_PREFIX}dev-toggle`) {
    if (!devOverride.isDevMode()) {
      await interaction.update(ownerHomePayload(interaction, 'DEV Override is unavailable outside DEV.'));
      return true;
    }
    const state = devOverride.toggle(interaction.user.id);
    await interaction.update(ownerHomePayload(
      interaction,
      state.blocked
        ? `❌ ${state.reason || 'Toggle blocked.'}`
        : (state.enabled ? emojiLabel('ENABLED', 'DEV Override enabled.') : emojiLabel('DISABLED', 'DEV Override disabled.'))
    ));
    return true;
  }

  if (id === `${OWNER_PREFIX}security`) {
    await runSecurityTests(interaction, contextGuildId, false);
    return true;
  }

  if (id === `${OWNER_PREFIX}maintenance`) {
    await interaction.update(maintenancePayload(interaction, contextGuildId));
    return true;
  }

  if (id === `${OWNER_PREFIX}maintenance-start-guild`) {
    const guild = await resolveMaintenanceGuild(interaction, contextGuildId);
    if (!guild) {
      await interaction.update(maintenancePayload(interaction, contextGuildId, emojiLabel('ERROR', 'Current server is unavailable.')));
      return true;
    }
    await maintenanceStatus.beginGuildMaintenance(guild, { reason: `Manual maintenance triggered by ${interaction.user.tag || interaction.user.id}` });
    await interaction.update(maintenancePayload(interaction, guild.id, `${EMOJIS.OWNER_RED} Maintenance notice started in **${guild.name}**.`));
    return true;
  }

  if (id === `${OWNER_PREFIX}maintenance-complete-guild`) {
    const guild = await resolveMaintenanceGuild(interaction, contextGuildId);
    if (!guild) {
      await interaction.update(maintenancePayload(interaction, contextGuildId, emojiLabel('ERROR', 'Current server is unavailable.')));
      return true;
    }
    const result = await maintenanceStatus.completeGuildMaintenance(guild);
    await interaction.update(maintenancePayload(interaction, guild.id, result.found ? `✅ **${guild.name}** marked operational. Channel deletion scheduled in 5 minutes.` : `${EMOJIS.INFO} **${guild.name}** has no active maintenance channel.`));
    return true;
  }

  if (id === `${OWNER_PREFIX}maintenance-clear-guild`) {
    const guild = await resolveMaintenanceGuild(interaction, contextGuildId);
    if (!guild) {
      await interaction.update(maintenancePayload(interaction, contextGuildId, emojiLabel('ERROR', 'Current server is unavailable.')));
      return true;
    }
    const result = await maintenanceStatus.deleteGuildMaintenanceChannel(guild);
    await interaction.update(maintenancePayload(interaction, guild.id, result.found ? `${EMOJIS.DELETE} Temporary status channel deleted from **${guild.name}**.` : `${EMOJIS.INFO} **${guild.name}** has no active maintenance channel.`));
    return true;
  }

  if (id === `${OWNER_PREFIX}maintenance-start-all`) {
    await interaction.deferUpdate();
    const results = await maintenanceStatus.beginMaintenanceForAll(interaction.client, { reason: `Manual global maintenance triggered by ${interaction.user.tag || interaction.user.id}` });
    const ok = results.filter((result) => result.ok).length;
    const failed = results.length - ok;
    await interaction.editReply(maintenancePayload(interaction, contextGuildId, `${EMOJIS.OWNER_RED} Maintenance notices started in **${ok}/${results.length}** guilds${failed ? ` • **${failed}** failed` : ''}.`));
    return true;
  }

  if (id === `${OWNER_PREFIX}maintenance-complete-all`) {
    await interaction.deferUpdate();
    const results = await maintenanceStatus.recoverAll(interaction.client);
    const recovered = results.filter((result) => result?.found).length;
    const failed = results.filter((result) => result?.ok === false).length;
    await interaction.editReply(maintenancePayload(interaction, contextGuildId, `✅ **${recovered}** active maintenance channel(s) marked operational and scheduled for deletion${failed ? ` • **${failed}** failed` : ''}.`));
    return true;
  }

  if (id === `${OWNER_PREFIX}ai-recovery-preview` || id === `${OWNER_PREFIX}ai-recovery-confirm`) {
    await aiRecoverRole(interaction, contextGuildId, id.endsWith('confirm'));
    return true;
  }
  if (id === `${OWNER_PREFIX}ai-recovery-cancel`) {
    await interaction.update(ownerHomePayload(interaction, 'Recovery cancelled. Snapshot remains available until expiry.'));
    return true;
  }
  if (id === `${OWNER_PREFIX}ai-reconcile`) {
    await aiReconcilePending(interaction, contextGuildId);
    return true;
  }
  if (id === `${OWNER_PREFIX}ai-channel-recover` || id === `${OWNER_PREFIX}ai-channel-restore`) {
    await aiRecoverChannel(interaction, contextGuildId, id.endsWith('restore'));
    return true;
  }
  if (id === `${OWNER_PREFIX}ai-channel-abort`) {
    await interaction.update(ownerHomePayload(interaction, 'Channel recovery cancelled. Snapshot remains available until expiry.'));
    return true;
  }
  if (id.startsWith(`${OWNER_PREFIX}acs:`)) {
    const match = id.match(/^ownerpanel:acs:(\d{16,25}):(\d{16,25}):(admin|moderator|member|newcomer|bot)$/);
    if (!match) return true;
    await aiStageChannelPlan(interaction, contextGuildId, match[1], match[2], match[3]);
    return true;
  }
  if (id === `${OWNER_PREFIX}ai-apply-channel`) {
    await aiApplyChannelPlan(interaction, contextGuildId);
    return true;
  }
  if (id === `${OWNER_PREFIX}ai-cancel-channel`) {
    aiPendingChannelPlans.delete(interaction.user.id);
    await interaction.update(ownerHomePayload(interaction, 'Channel plan cancelled; no changes applied.'));
    return true;
  }
  if (id.startsWith(`${OWNER_PREFIX}ai-stage-`)) {
    const match = id.match(/^ownerpanel:ai-stage-(\d{16,25})-(admin|moderator|member|newcomer|bot)$/);
    if (!match) return true;
    await aiStageRolePlan(interaction, contextGuildId, match[1], match[2]);
    return true;
  }
  if (id === `${OWNER_PREFIX}ai-apply-role`) {
    await aiApplyRolePlan(interaction, contextGuildId);
    return true;
  }
  if (id === `${OWNER_PREFIX}ai-cancel-role`) {
    aiPendingRolePlans.delete(interaction.user.id);
    await interaction.update(ownerHomePayload(interaction, 'AI permission plan cancelled; no changes applied.'));
    return true;
  }
  if (id.startsWith(`${OWNER_PREFIX}ai-target-role:`)) {
    const match = id.match(/^ownerpanel:ai-target-role:(\d{16,25})$/);
    if (!match || !interaction.isStringSelectMenu?.()) return true;
    const roleId = validGuildId(interaction.values?.[0]);
    await handleOwnerAI(interaction, 'channel-target', contextGuildId, { channelId: match[1], roleId });
    return true;
  }
  if (id.startsWith(`${OWNER_PREFIX}ai-channel-template:`)) {
    const match = id.match(/^ownerpanel:ai-channel-template:(\d{16,25}):(\d{16,25})$/);
    if (!match || !interaction.isStringSelectMenu?.()) return true;
    const template = String(interaction.values?.[0] || '');
    if (!Object.hasOwn(AI_ROLE_TEMPLATES, template)) return true;
    await handleOwnerAI(interaction, 'channel-plan', contextGuildId, { channelId: match[1], roleId: match[2], template });
    return true;
  }
  if (id.startsWith(`${OWNER_PREFIX}ai-compare:`)) {
    const match = id.match(/^ownerpanel:ai-compare:(\d{16,25})$/);
    if (!match || !interaction.isStringSelectMenu?.()) return true;
    const template = String(interaction.values?.[0] || '');
    if (!Object.hasOwn(AI_ROLE_TEMPLATES, template)) return true;
    await handleOwnerAI(interaction, 'comparison', contextGuildId, { roleId: match[1], template });
    return true;
  }
  if (id.startsWith(`${OWNER_PREFIX}ai-select-`)) {
    const match = id.match(/^ownerpanel:ai-select-(role|channel):(\d+)$/);
    if (!match || !interaction.isStringSelectMenu?.()) return true;
    const selectedId = validGuildId(interaction.values?.[0]);
    await handleOwnerAI(interaction, match[1], contextGuildId, selectedId, Number(match[2]));
    return true;
  }
  if (id.startsWith(`${OWNER_PREFIX}ai-page-`)) {
    const match = id.match(/^ownerpanel:ai-page-(role|channel)-(\d+)$/);
    if (!match) return true;
    await handleOwnerAI(interaction, match[1], contextGuildId, null, Number(match[2]));
    return true;
  }
  if ([`${OWNER_PREFIX}ai-home`, `${OWNER_PREFIX}ai-scan`, `${OWNER_PREFIX}ai-templates`,
       `${OWNER_PREFIX}ai-roles`, `${OWNER_PREFIX}ai-channels`].includes(id)) {
    await handleOwnerAI(interaction, id.slice(OWNER_PREFIX.length), contextGuildId);
    return true;
  }

  if (id === `${OWNER_PREFIX}server-tools`) {
    await interaction.update(serverToolsPayload(interaction, contextGuildId));
    return true;
  }

  if (id === `${OWNER_PREFIX}server-copy`) {
    await runDuplicator(interaction, { action: 'copy' }, contextGuildId);
    return true;
  }

  if (id === `${OWNER_PREFIX}server-build`) {
    await runDuplicator(interaction, { action: 'build' }, contextGuildId);
    return true;
  }

  if (id === `${OWNER_PREFIX}server-analyse`) {
    await runDuplicator(interaction, { action: 'analyse' }, contextGuildId);
    return true;
  }

  if (id === `${OWNER_PREFIX}server-export`) {
    if (!contextGuildId) {
      await interaction.reply(serverContextRequiredPayload());
      return true;
    }
    await interaction.showModal(exportModal(interaction, contextGuildId));
    return true;
  }

  if (id === `${OWNER_PREFIX}server-export-submit`) {
    await runDuplicator(interaction, {
      action: 'export',
      source_server: readModalValue(interaction, 'source_server'),
      name: readModalValue(interaction, 'name'),
      template_id: readModalValue(interaction, 'template_id'),
      version: readModalValue(interaction, 'version'),
      description: readModalValue(interaction, 'description'),
    }, contextGuildId);
    return true;
  }

  if (id === `${OWNER_PREFIX}commandcenter`) {
    if (!devOverride.isDevMode() || !isDevelopmentGuild(interaction, contextGuildId)) {
      await interaction.update(ownerHomePayload(interaction, 'Command Center is only available inside the configured DEV guild.'));
      return true;
    }
    await auditEvents.execute(interaction);
    return true;
  }

  return false;
}

function wireClient(client) {
  if (!client || wiredClients.has(client)) return false;
  wiredClients.add(client);

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      await handleOwnerPanelInteraction(interaction);
    } catch (error) {
      console.error('[OwnerPanel] Interaction failed:', error?.stack || error?.message || error);
      if (!interaction?.replied && !interaction?.deferred) {
        await interaction?.reply?.({
          content: emojiLabel('ERROR', 'Owner control action failed.'),
          flags: MessageFlags.Ephemeral,
        }).catch(() => null);
      }
    }
  });

  return true;
}

module.exports = {
  category: 'Owner',
  access: { ownerOnly: true },
  data: new SlashCommandBuilder()
    .setName('owner')
    .setDescription('Open the private Goliath owner control panel.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(0n),

  wireClient,
  handleOwnerPanelInteraction,

  async execute(interaction, client) {
    wireClient(client || interaction.client);

    if (!ownerAllowed(interaction)) {
      return interaction.reply(ownerDeniedPayload());
    }

    const guildId = interactionGuildId(interaction);
    if (guildId) rememberOwnerGuild(interaction, guildId);

    return interaction.reply({
      ...ownerHomePayload(interaction),
      flags: MessageFlags.Ephemeral,
    });
  },
};
