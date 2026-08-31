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
const wiredClients = new WeakSet();

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

function ownerHomePayload(interaction, notice = null) {
  const currentMode = mode();
  const devState = devOverride.readState();
  const billing = devOverride.getPaywallBypassState();
  const isDev = currentMode === 'DEV';
  const ownersLoaded = security.getBotOwnerIds().length;

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('👑 Goliath Owner Control Panel')
    .setDescription([
      'Private owner-only controls for Goliath development, security testing, server tooling and the Command Center.',
      '',
      notice ? `**Status:** ${notice}` : null,
    ].filter(Boolean).join('\n'))
    .addFields(
      { name: 'Environment', value: `\`${currentMode}\``, inline: true },
      { name: 'Owner Gate', value: `**${ownersLoaded}** configured owner IDs`, inline: true },
      { name: 'Panel Visibility', value: 'Ephemeral • owner ID checked on every action', inline: true },
      { name: 'DEV Override', value: isDev ? (devState.enabled ? '🟢 Enabled' : '🔴 Disabled') : '⚪ DEV only', inline: true },
      { name: 'DEV Billing Unlock', value: isDev ? (billing.active ? `🟢 ${billing.plan || 'enabled'}` : '🔴 Disabled') : '⚪ DEV only', inline: true },
      { name: 'Owner Tools', value: isDev ? '🟢 Security • Server Tools • Command Center' : '⚪ DEV only', inline: true },
    )
    .setFooter({ text: 'Goliath Owner • OWNER_IDS protected' })
    .setTimestamp();

  const primary = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${OWNER_PREFIX}dev-toggle`)
      .setLabel(devState.enabled ? 'Disable DEV Override' : 'Enable DEV Override')
      .setEmoji('🧪')
      .setStyle(devState.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
      .setDisabled(!isDev),
    new ButtonBuilder()
      .setCustomId(`${OWNER_PREFIX}security`)
      .setLabel('Security Tests')
      .setEmoji('🛡️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!isDev),
    new ButtonBuilder()
      .setCustomId(`${OWNER_PREFIX}server-tools`)
      .setLabel('Server Tools')
      .setEmoji('🧰')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!isDev),
    new ButtonBuilder()
      .setCustomId(`${OWNER_PREFIX}commandcenter`)
      .setLabel('Command Center')
      .setEmoji('📡')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!isDev)
  );

  const navigation = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${OWNER_PREFIX}refresh`)
      .setLabel('Refresh')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [primary, navigation] };
}

function serverToolsPayload() {
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🧰 Owner Server Tools')
    .setDescription([
      'The original owner-only server developer tools are consolidated here.',
      '',
      '**Copy** — copy selected server structure/settings.',
      '**Analyse** — compare a source and destination server.',
      '**Export** — save a server as a reusable Duplicator template.',
      '**Build** — build from a saved/default template.',
    ].join('\n'))
    .setFooter({ text: 'DEV only • Duplicator retains its own owner and safety checks' });

  const tools = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${OWNER_PREFIX}server-copy`).setLabel('Copy').setEmoji('📋').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${OWNER_PREFIX}server-analyse`).setLabel('Analyse').setEmoji('🔎').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${OWNER_PREFIX}server-export`).setLabel('Export').setEmoji('📤').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${OWNER_PREFIX}server-build`).setLabel('Build').setEmoji('🏗️').setStyle(ButtonStyle.Secondary)
  );
  const navigation = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${OWNER_PREFIX}home`).setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [tools, navigation] };
}

function analyseModal() {
  return new ModalBuilder()
    .setCustomId(`${OWNER_PREFIX}server-analyse-submit`)
    .setTitle('Analyse Servers')
    .addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('source_server').setLabel('Source server ID').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(25)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('destination_server').setLabel('Destination server ID').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(25))
    );
}

function exportModal() {
  return new ModalBuilder()
    .setCustomId(`${OWNER_PREFIX}server-export-submit`)
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
  try { return String(interaction.fields.getTextInputValue(key) || '').trim() || null; }
  catch { return null; }
}

function withOwnerOptions(interaction, values = {}) {
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
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function runDuplicator(interaction, values) {
  return duplicator.run(withOwnerOptions(interaction, values));
}

async function handleOwnerPanelInteraction(interaction) {
  const id = String(interaction?.customId || '');
  if (!id.startsWith(OWNER_PREFIX) && !id.startsWith('testsecurity:')) return false;

  if (!ownerAllowed(interaction)) {
    if (interaction.deferred || interaction.replied) await interaction.editReply(ownerDeniedPayload()).catch(() => null);
    else await interaction.reply(ownerDeniedPayload()).catch(() => null);
    return true;
  }

  if (id.startsWith('testsecurity:')) {
    await testSecurity.handleButton(interaction);
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
    await interaction.update(ownerHomePayload(interaction, state.blocked ? `❌ ${state.reason || 'Toggle blocked.'}` : (state.enabled ? '🟢 DEV Override enabled.' : '🔴 DEV Override disabled.')));
    return true;
  }

  if (id === `${OWNER_PREFIX}security`) {
    if (!devOverride.isDevMode()) {
      await interaction.update(ownerHomePayload(interaction, 'Security test controls are DEV only.'));
      return true;
    }
    await testSecurity.execute(interaction);
    return true;
  }

  if (id === `${OWNER_PREFIX}server-tools`) {
    if (!devOverride.isDevMode()) {
      await interaction.update(ownerHomePayload(interaction, 'Server developer tools are DEV only.'));
      return true;
    }
    await interaction.update(serverToolsPayload());
    return true;
  }

  if (id === `${OWNER_PREFIX}server-copy`) {
    await runDuplicator(interaction, { action: 'copy' });
    return true;
  }
  if (id === `${OWNER_PREFIX}server-build`) {
    await runDuplicator(interaction, { action: 'build' });
    return true;
  }
  if (id === `${OWNER_PREFIX}server-analyse`) {
    await interaction.showModal(analyseModal());
    return true;
  }
  if (id === `${OWNER_PREFIX}server-export`) {
    await interaction.showModal(exportModal());
    return true;
  }
  if (id === `${OWNER_PREFIX}server-analyse-submit`) {
    await runDuplicator(interaction, {
      action: 'analyse',
      source_server: readModalValue(interaction, 'source_server'),
      destination_server: readModalValue(interaction, 'destination_server'),
    });
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
    });
    return true;
  }

  if (id === `${OWNER_PREFIX}commandcenter`) {
    if (!devOverride.isDevMode()) {
      await interaction.update(ownerHomePayload(interaction, 'Command Center controls are owned by the DEV control plane.'));
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
        await interaction?.reply?.({ content: '❌ Owner control action failed.', flags: MessageFlags.Ephemeral }).catch(() => null);
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

    if (!interaction.guild) {
      return interaction.reply({ content: '❌ /owner can only be used inside a server.', flags: MessageFlags.Ephemeral });
    }

    if (!ownerAllowed(interaction)) {
      return interaction.reply(ownerDeniedPayload());
    }

    return interaction.reply({ ...ownerHomePayload(interaction), flags: MessageFlags.Ephemeral });
  },
};
