'use strict';

const {
  AttachmentBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');

const mediaTools = require('../../core/mediaTools/mediaService');
const entitlementManager = require('../../core/billing/entitlementManager');
const { FEATURE_KEYS } = require('../../config/plans');
const { enforceCommandAccess } = require('../../core/commands/commandAccess');

const MANAGE_EXPRESSIONS_PERMISSION =
  PermissionFlagsBits.ManageGuildExpressions ||
  PermissionFlagsBits.ManageEmojisAndStickers ||
  PermissionFlagsBits.ManageGuild;

function cleanAssetQuery(value) {
  return String(value || '').trim().toLowerCase();
}

function cleanEmojiName(value) {
  const name = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);

  if (name.length < 2) throw new Error('Emoji name must be at least 2 characters.');
  return name;
}

function requireMediaTools(guildId) {
  entitlementManager.requireFeature(guildId, FEATURE_KEYS.MEDIA_TOOLS);
}

function findAsset(guildId, query, allowedTools = []) {
  const cleanQuery = cleanAssetQuery(query);
  const allowed = new Set(allowedTools.filter(Boolean));
  const assets = mediaTools.listMediaAssets(guildId);

  if (!cleanQuery) return null;

  return assets.find((asset) => {
    if (allowed.size && !allowed.has(asset.tool)) return false;
    return String(asset.id || '').toLowerCase() === cleanQuery
      || String(asset.name || '').toLowerCase() === cleanQuery
      || String(asset.filename || '').toLowerCase() === cleanQuery;
  }) || null;
}

function getAssetChoices(guildId, focusedValue = '', allowedTools = []) {
  const query = cleanAssetQuery(focusedValue);
  const allowed = new Set(allowedTools.filter(Boolean));

  return mediaTools
    .listMediaAssets(guildId)
    .filter((asset) => !allowed.size || allowed.has(asset.tool))
    .filter((asset) => {
      if (!query) return true;
      return String(asset.name || '').toLowerCase().includes(query)
        || String(asset.id || '').toLowerCase().includes(query)
        || String(asset.filename || '').toLowerCase().includes(query);
    })
    .slice(0, 25)
    .map((asset) => {
      const labelParts = [asset.name || asset.id, asset.tool, asset.type].filter(Boolean);
      return {
        name: labelParts.join(' · ').slice(0, 100),
        value: String(asset.id).slice(0, 100),
      };
    });
}

function autocompleteToolsForSubcommand(subcommand) {
  if (subcommand === 'gif-send') return ['gif'];
  if (subcommand === 'emoji-install' || subcommand === 'role-icon-set') return ['emoji'];
  return [];
}

async function safeReply(interaction, payload, ephemeral = true) {
  const safePayload = ephemeral ? { ...payload, flags: 64 } : payload;

  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(safePayload);
  }

  return interaction.reply(safePayload);
}

function canManageRole(interaction, role) {
  const botMember = interaction.guild?.members?.me;
  if (!botMember || !role) return false;
  if (role.managed || role.id === interaction.guild.id) return false;
  return botMember.roles.highest.comparePositionTo(role) > 0;
}

function buildListContent(guildId, tool = 'all') {
  const assets = mediaTools
    .listMediaAssets(guildId)
    .filter((asset) => tool === 'all' || asset.tool === tool)
    .slice(0, 15);

  if (!assets.length) {
    return `No ${tool === 'all' ? 'media assets' : tool + ' assets'} saved for this guild yet.`;
  }

  const lines = assets.map((asset) => [
    `**${asset.name}**`,
    `ID: \`${asset.id}\``,
    `Type: \`${asset.tool}\``,
    asset.type ? `Preset: \`${asset.type}\`` : null,
    asset.discordReady ? '`Discord ready`' : '`Too large`',
  ].filter(Boolean).join(' · '));

  return ['`🧰` **Guild Media Library**', '', ...lines].join('\n');
}

module.exports = {
  category: 'Utility',

  help: {
    name: 'media',
    description: '🧰 Use assets created in Goliath Media Tools.',
    usage: '/media list | /media gif-send <asset> | /media emoji-install <asset> <name> | /media role-icon-set <role> <asset>',
  },

  access: {
    ownerOnly: false,
  },

  data: new SlashCommandBuilder()
    .setName('media')
    .setDescription('🧰 Use assets created in Goliath Media Tools')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('list')
        .setDescription('List saved media assets for this guild')
        .addStringOption((option) =>
          option
            .setName('type')
            .setDescription('Only show one media type')
            .addChoices(
              { name: 'All', value: 'all' },
              { name: 'GIFs', value: 'gif' },
              { name: 'Emojis / Role Icons', value: 'emoji' },
            )
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('gif-send')
        .setDescription('Send a saved GIF into this channel')
        .addStringOption((option) =>
          option
            .setName('asset')
            .setDescription('Asset ID, exact name, or filename from Media Tools')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('emoji-install')
        .setDescription('Install a saved emoji asset into this Discord server')
        .addStringOption((option) =>
          option
            .setName('asset')
            .setDescription('Asset ID, exact name, or filename from Media Tools')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption((option) =>
          option
            .setName('name')
            .setDescription('Discord emoji name, letters/numbers/underscores only')
            .setRequired(true)
            .setMinLength(2)
            .setMaxLength(32)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('role-icon-set')
        .setDescription('Set a saved Media Tools asset as a role icon')
        .addRoleOption((option) =>
          option
            .setName('role')
            .setDescription('Role to update')
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName('asset')
            .setDescription('Role-icon/emoji asset ID, exact name, or filename')
            .setRequired(true)
            .setAutocomplete(true)
        )
    ),

  async autocomplete(interaction) {
    if (!interaction.guild?.id) return interaction.respond([]);

    try {
      requireMediaTools(interaction.guild.id);
    } catch {
      return interaction.respond([]);
    }

    const focused = interaction.options.getFocused(true);
    if (focused?.name !== 'asset') return interaction.respond([]);

    const subcommand = interaction.options.getSubcommand(false);
    const choices = getAssetChoices(
      interaction.guild.id,
      focused.value,
      autocompleteToolsForSubcommand(subcommand),
    );

    return interaction.respond(choices);
  },

  async execute(interaction) {
    const denied = await enforceCommandAccess(interaction, module.exports);
    if (denied) return;

    if (!interaction.guild?.id) {
      return safeReply(interaction, { content: '`⚠️` Media commands only work inside a server.' });
    }

    const guildId = interaction.guild.id;
    const action = interaction.options.getSubcommand(false) || 'list';

    try {
      requireMediaTools(guildId);
    } catch (error) {
      return safeReply(interaction, {
        content: `🔒 Media Tools requires Goliath Plus or higher. Current plan: \`${error.currentPlan || 'free'}\`.`,
      });
    }

    if (action === 'list') {
      const type = interaction.options.getString('type') || 'all';
      return safeReply(interaction, { content: buildListContent(guildId, type) });
    }

    if (action === 'gif-send') {
      const query = interaction.options.getString('asset', true);
      const asset = findAsset(guildId, query, ['gif']);

      if (!asset) {
        return safeReply(interaction, { content: '`⚠️` I could not find that saved GIF asset.' });
      }

      const download = mediaTools.resolveAssetDownload(guildId, asset.id);
      const attachment = new AttachmentBuilder(download.path, { name: download.filename || 'goliath.gif' });

      return safeReply(interaction, {
        content: `🎞️ **${asset.name}**`,
        files: [attachment],
      }, false);
    }

    if (action === 'emoji-install') {
      if (!interaction.memberPermissions?.has(MANAGE_EXPRESSIONS_PERMISSION)) {
        return safeReply(interaction, {
          content: '`🔐` You need permission to manage server expressions/emojis to install emoji assets.',
        });
      }

      const query = interaction.options.getString('asset', true);
      const requestedName = interaction.options.getString('name', true);
      const emojiName = cleanEmojiName(requestedName);
      const asset = findAsset(guildId, query, ['emoji']);

      if (!asset) {
        return safeReply(interaction, { content: '`⚠️` I could not find that saved emoji asset.' });
      }

      const download = mediaTools.resolveAssetDownload(guildId, asset.id);
      const emoji = await interaction.guild.emojis.create({
        attachment: download.path,
        name: emojiName,
        reason: `Installed from Goliath Media Tools by ${interaction.user.tag}`,
      });

      return safeReply(interaction, {
        content: `✅ Installed emoji ${emoji} as \`:${emoji.name}:\`.`,
      });
    }

    if (action === 'role-icon-set') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
        return safeReply(interaction, {
          content: '`🔐` You need Manage Roles permission to set role icons.',
        });
      }

      const role = interaction.options.getRole('role', true);
      const query = interaction.options.getString('asset', true);
      const asset = findAsset(guildId, query, ['emoji']);

      if (!asset) {
        return safeReply(interaction, { content: '`⚠️` I could not find that saved role icon asset.' });
      }

      if (asset.type !== 'roleIcon') {
        return safeReply(interaction, {
          content: '`⚠️` That asset was not created with the Role Icon preset. Create a role icon in Media Tools first.',
        });
      }

      if (!canManageRole(interaction, role)) {
        return safeReply(interaction, {
          content: '`🔐` I cannot edit that role. Move my highest role above it and make sure the role is not managed by an integration.',
        });
      }

      const download = mediaTools.resolveAssetDownload(guildId, asset.id);
      await role.setIcon(download.path, `Role icon set from Goliath Media Tools by ${interaction.user.tag}`);

      return safeReply(interaction, {
        content: `✅ Set **${role.name}** role icon from **${asset.name}**.`,
      });
    }

    return safeReply(interaction, { content: buildListContent(guildId, 'all') });
  },
};
