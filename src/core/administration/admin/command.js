'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Events,
  SlashCommandBuilder,
} = require('discord.js');

const adminPanel = require('./panel');
const socialStudioPanel = require('../../../modules/socialStudio/socialAlerts/socialStudioPanel');
const { errorEmbed } = require('../../ui/embeds');
const { safeEditReply } = require('../../ui/interactionResponse');
const { enforceCommandAccess } = require('../../commands/commandAccess');
const security = require('../../security/protection/core');

const SETTINGS_ID = 'admin:settings';
const SETTINGS_BACK_ID = 'admin:settings:back';
const wiredClients = new WeakSet();

function memberDisplayName(interaction) {
  return interaction.member?.displayName || interaction.user?.displayName || interaction.user?.username || 'Unknown User';
}

function canUseSettings(interaction) {
  if (!interaction?.guild || !interaction?.user?.id) return false;
  return security.isBotOwner(interaction.user.id)
    || interaction.guild.ownerId === interaction.user.id
    || adminPanel.hasGuildPermission(interaction, 'admin.dashboard.view');
}

function addSettingsControl(panel, interaction) {
  if (!panel || !canUseSettings(interaction)) return panel;

  const embeds = [...(panel.embeds || [])];
  if (embeds[0]) {
    embeds[0] = EmbedBuilder.from(embeds[0]).addFields({
      name: '⚙️ Settings',
      value: 'General Goliath server configuration and administration defaults',
      inline: true,
    });
  }

  const components = [...(panel.components || [])];
  if (components.length < 5) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(SETTINGS_ID)
          .setLabel('Settings')
          .setEmoji('⚙️')
          .setStyle(ButtonStyle.Secondary),
      ),
    );
  }

  return { ...panel, embeds, components };
}

function buildSettingsPanel(interaction) {
  const authority = adminPanel.getAuthorityConfig(interaction.guild.id);
  const configuredLogs = Object.values(adminPanel.LOG_TYPES || {})
    .filter((entry) => adminPanel.getLogChannelId(interaction.guild.id, entry.key))
    .length;

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('⚙️ Goliath Settings')
    .setDescription('General server-level Goliath configuration lives here. This gives the Admin Hub a dedicated settings home without mixing configuration into operational controls.')
    .addFields(
      { name: 'Server', value: `${interaction.guild.name}\n\`${interaction.guild.id}\``, inline: true },
      { name: 'Authority', value: authority.configured ? 'Configured ✅' : 'Legacy fallback ⚠️', inline: true },
      { name: 'Log Channels', value: `${configuredLogs}/5 configured`, inline: true },
    )
    .setFooter({ text: `Requested by ${memberDisplayName(interaction)}` })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(SETTINGS_BACK_ID)
          .setLabel('Back to Administration')
          .setEmoji('⬅️')
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

async function handleSettingsInteraction(interaction) {
  const id = String(interaction?.customId || '');
  if (id !== SETTINGS_ID && id !== SETTINGS_BACK_ID) return false;

  if (!canUseSettings(interaction)) {
    await interaction.reply({ content: '❌ You do not have permission to open Goliath Settings.', flags: 64 }).catch(() => null);
    return true;
  }

  if (id === SETTINGS_ID) {
    await interaction.update(buildSettingsPanel(interaction));
    return true;
  }

  const isGoliathOwner = security.isBotOwner(interaction.user?.id);
  const panel = adminPanel.buildAdminPanel(
    interaction.guild,
    memberDisplayName(interaction),
    isGoliathOwner ? null : interaction,
  );
  await interaction.update(addSettingsControl(panel, interaction));
  return true;
}

function wireClient(client) {
  if (!client || wiredClients.has(client)) return false;
  wiredClients.add(client);
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      await handleSettingsInteraction(interaction);
    } catch (error) {
      console.error('❌ Admin settings interaction failed:', error?.stack || error?.message || error);
      if (!interaction?.replied && !interaction?.deferred) {
        await interaction?.reply?.({ content: '❌ Failed to open Goliath Settings.', flags: 64 }).catch(() => null);
      }
    }
  });
  return true;
}

const command = {
  category: 'Admin',

  help: {
    name: 'admin',
    description: 'Open admin controls and server tools.',
    usage: '/admin',
  },

  access: {
    level: 'admin',
    ownerOnly: false,
  },

  data: new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Open Goliath admin controls and server tools')
    .setDMPermission(false),

  wireClient,

  async execute(interaction) {
    try {
      if (!interaction.guild) {
        return safeEditReply(interaction, {
          embeds: [errorEmbed('This command can only be used inside a server.')],
        });
      }

      const displayName = memberDisplayName(interaction);

      const isGoliathOwner = security.isBotOwner(interaction.user?.id);
      const isLegacyAdmin = security.hasPermission(interaction, 'admin');
      const hasConfiguredAdminAccess =
        adminPanel.hasGuildPermission(interaction, 'admin.dashboard.view');
      const canManageAuthority = adminPanel.canManageGuildAuthority(interaction);
      const canManageSocial =
        typeof socialStudioPanel.canManageSocialStudio === 'function' &&
        socialStudioPanel.canManageSocialStudio(interaction);

      if (!isLegacyAdmin && !hasConfiguredAdminAccess && !canManageAuthority && canManageSocial) {
        return safeEditReply(
          interaction,
          socialStudioPanel.buildSocialAdminPanel(interaction.guild, displayName),
        );
      }

      if (!isLegacyAdmin && !hasConfiguredAdminAccess && !canManageAuthority) {
        const denied = await enforceCommandAccess(interaction, command);
        if (denied) return;
      }

      // The Goliath Owner must always retain the complete Admin Hub while the
      // guild-configurable authority layer is being built and tested. Passing
      // no viewer filter keeps every guild-manageable control visible without
      // exposing or delegating any Goliath-owner-only capability.
      const panel = adminPanel.buildAdminPanel(
        interaction.guild,
        displayName,
        isGoliathOwner ? null : interaction,
      );

      return safeEditReply(interaction, addSettingsControl(panel, interaction));
    } catch (error) {
      if (error?.code === 10062 || error?.code === 40060) return;
      console.error('❌ Admin command failed:', error);
      return safeEditReply(interaction, {
        embeds: [errorEmbed('Failed to open the admin panel. Please try again.')],
        components: [],
      });
    }
  },
};

module.exports = command;
