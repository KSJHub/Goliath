'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Events,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const { normalizeBotMode } = require('../config/botModes');
const security = require('../core/security/protection/core');
const devOverride = require('./dev/DevOverrideManager');
const testSecurity = require('./dev/testsecurity');
const duplicator = require('./dev/duplicator');
const auditEvents = require('./auditIntelligence/auditEvents');

const OWNER_PREFIX = 'ownerpanel:';
const SERVER_CONTEXT_MARKER = ':guild:';
const OWNER_CONTEXT_TTL_MS = 30 * 60 * 1000;
const DEVELOPMENT_TEST_GUILD_ID = process.env.TEST_GUILD_ID || '1515201360386068642';
const wiredClients = new WeakSet();
const ownerGuildContexts = new Map();

function mode() {
  return normalizeBotMode(process.env.BOT_MODE);
}

function ownerAllowed(interaction) {
  return Boolean(interaction?.user?.id && security.isBotOwner(interaction.user.id));
}

function ownerDeniedPayload() {
  return {
    content: '❌ This control panel is restricted to the configured Goliath owners.',
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
    .setTitle('👑 Goliath Owner Control Panel')
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
      { name: 'DEV Override', value: isDev ? (devState.enabled ? '🟢 Enabled' : '🔴 Disabled') : '⚪ DEV only', inline: true },
      { name: 'DEV Billing Unlock', value: isDev ? (billing.active ? `🟢 ${billing.plan || 'enabled'}` : '🔴 Disabled') : '⚪ DEV only', inline: true },
      { name: 'Owner Tools', value: showCommandCenter ? '🟢 Server Tools • Security • Command Center' : '🟢 Server Tools • Security', inline: true },
    )
    .setFooter({ text: 'Goliath Owner • OWNER_IDS protected' })
    .setTimestamp();

  const primaryComponents = [
    new ButtonBuilder()
      .setCustomId(`${OWNER_PREFIX}dev-toggle`)
      .setLabel(devState.enabled ? 'Disable DEV Override' : 'Enable DEV Override')
      .setEmoji('🧪')
      .setStyle(devState.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
      .setDisabled(!isDev),
    new ButtonBuilder()
      .setCustomId(contextualOwnerId('security', guildId))
      .setLabel('Security Tests')
      .setEmoji('🛡️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(contextualOwnerId('server-tools', interaction))
      .setLabel('Server Tools')
      .setEmoji('🧰')
      .setStyle(ButtonStyle.Secondary),
  ];

  if (showCommandCenter) {
    primaryComponents.push(
      new ButtonBuilder()
        .setCustomId(contextualOwnerId('commandcenter', guildId))
        .setLabel('Command Center')
        .setEmoji('📡')
        .setStyle(ButtonStyle.Secondary)
    );
  }

  const primary = new ActionRowBuilder().addComponents(...primaryComponents);

  const navigation = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(contextualOwnerId('refresh', interaction))
      .setLabel('Refresh')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [primary, navigation] };
}

function serverToolsPayload(interaction, explicitGuildId = null) {
  const guildId = interactionGuildId(interaction, explicitGuildId);
  const guildContextAvailable = Boolean(guildId);
  if (guildId) rememberOwnerGuild(interaction, guildId);

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🧰 Owner Server Tools')
    .setDescription([
      'Developer-only server tools. Access is restricted to configured Goliath owner IDs.',
      '',
      '**Copy** — copy selected server structure/settings.',
      '**Analyse** — compare a source and destination server.',
      '**Export** — save a server as a reusable Duplicator template.',
      '**Build** — build from a saved/default template.',
      '',
      guildContextAvailable ? null : '⚠️ **Server context required.** Open `/owner` from a server channel to use these tools.',
    ].filter(Boolean).join('\n'))
    .setFooter({ text: 'Owner only • Duplicator retains its own owner and safety checks' });

  const tools = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(contextualOwnerId('server-copy', guildId)).setLabel('Copy').setEmoji('📋').setStyle(ButtonStyle.Secondary).setDisabled(!guildContextAvailable),
    new ButtonBuilder().setCustomId(contextualOwnerId('server-analyse', guildId)).setLabel('Analyse').setEmoji('🔎').setStyle(ButtonStyle.Secondary).setDisabled(!guildContextAvailable),
    new ButtonBuilder().setCustomId(contextualOwnerId('server-export', guildId)).setLabel('Export').setEmoji('📤').setStyle(ButtonStyle.Secondary).setDisabled(!guildContextAvailable),
    new ButtonBuilder().setCustomId(contextualOwnerId('server-build', guildId)).setLabel('Build').setEmoji('🏗️').setStyle(ButtonStyle.Secondary).setDisabled(!guildContextAvailable)
  );

  const navigation = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(contextualOwnerId('home', guildId)).setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [tools, navigation] };
}

function serverContextRequiredPayload() {
  return {
    content: '❌ Server Tools require a server context. Open `/owner` from the server you want to manage, then open **Server Tools** again.',
    flags: MessageFlags.Ephemeral,
  };
}

function noConnectedGuildsPayload(guildId = null) {
  return {
    content: guildId
      ? `❌ Goliath can identify server \`${guildId}\`, but this bot instance cannot access it and is not connected to any other guild it can use for Server Tools.`
      : '❌ This Goliath bot instance is not connected to any guilds available to Server Tools.',
    flags: MessageFlags.Ephemeral,
  };
}

function securityUnavailablePayload(guildId = null) {
  return {
    content: guildId
      ? `❌ Goliath can identify server \`${guildId}\`, but this bot instance cannot access a connected guild for Security Tests.`
      : '❌ This Goliath bot instance is not connected to a guild available for Security Tests.',
    flags: MessageFlags.Ephemeral,
  };
}

function analyseModal(interaction, explicitGuildId = null) {
  const guildId = interactionGuildId(interaction, explicitGuildId);
  return new ModalBuilder()
    .setCustomId(contextualOwnerId('server-analyse-submit', guildId))
    .setTitle('Analyse Servers')
    .addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('source_server').setLabel('Source server ID').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(25)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('destination_server').setLabel('Destination server ID').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(25))
    );
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

async function handleOwnerPanelInteraction(interaction) {
  const rawId = String(interaction?.customId || '');
  const id = baseOwnerCustomId(rawId);
  if (!id.startsWith(OWNER_PREFIX) && !id.startsWith('testsecurity:')) return false;

  if (!ownerAllowed(interaction)) {
    if (interaction.deferred || interaction.replied) await interaction.editReply(ownerDeniedPayload()).catch(() => null);
    else await interaction.reply(ownerDeniedPayload()).catch(() => null);
    return true;
  }

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
        : (state.enabled ? '🟢 DEV Override enabled.' : '🔴 DEV Override disabled.')
    ));
    return true;
  }

  if (id === `${OWNER_PREFIX}security`) {
    await runSecurityTests(interaction, contextGuildId, false);
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

  if (id === `${OWNER_PREFIX}server-analyse-submit`) {
    await runDuplicator(interaction, {
      action: 'analyse',
      source_server: readModalValue(interaction, 'source_server'),
      destination_server: readModalValue(interaction, 'destination_server'),
    }, contextGuildId);
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
          content: '❌ Owner control action failed.',
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
