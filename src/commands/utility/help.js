const {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');

const {
  canAccessCommand,
  enforceCommandAccess,
} = require('../../core/commands/commandAccess');

const {
  baseEmbed,
  createSecondaryButton,
  createDangerButton,
} = require('../../core/ui/embeds');

const CATEGORY_META = {
  Utility: {
    emoji: '🧰',
    label: 'Utility',
    description: 'Helpful tools, status checks, and general bot commands.',
  },
  Moderation: {
    emoji: '🔐',
    label: 'Moderation',
    description: 'Staff tools for keeping your server clean and protected.',
  },
  Logging: {
    emoji: '📜',
    label: 'Logging',
    description: 'Logging setup, moderation records, and audit tools.',
  },
  Admin: {
    emoji: '🔏',
    label: 'Admin',
    description: 'Server management, configuration, and control panels.',
  },
  Stats: {
    emoji: '📊',
    label: 'Stats',
    description: 'Server stats, counters, and tracking panels.',
  },
  Embeds: {
    emoji: '🎨',
    label: 'Embeds',
    description: 'Embed builders, welcome messages, and styled panels.',
  },
  Fun: {
    emoji: '🎉',
    label: 'Fun',
    description: 'Community games, fun extras, and social commands.',
  },
  Other: {
    emoji: '📁',
    label: 'Other',
    description: 'Extra commands that do not fit another category.',
  },
};

function normalizeCategory(category) {
  if (!category || typeof category !== 'string') return 'Other';

  const trimmed = category.trim();
  return trimmed || 'Other';
}

function getCategoryMeta(category) {
  return CATEGORY_META[category] || {
    ...CATEGORY_META.Other,
    label: category || 'Other',
  };
}

function getCommandDescription(command) {
  return (
    command.help?.description ||
    command.data?.description ||
    'No description provided.'
  );
}

function getVisibleCommands(interaction) {
  return [...interaction.client.commands.values()]
    .filter((command) => command?.data?.name)
    .filter((command) => command.hidden !== true)
    .filter((command) => canAccessCommand(interaction, command))
    .sort((a, b) => a.data.name.localeCompare(b.data.name));
}

function groupCommandsByCategory(commands) {
  return commands.reduce((grouped, command) => {
    const category = normalizeCategory(command.category);

    if (!grouped[category]) grouped[category] = [];
    grouped[category].push(command);

    return grouped;
  }, {});
}

function getSortedCategories(groupedCommands) {
  return Object.keys(groupedCommands).sort((a, b) => a.localeCompare(b));
}

function getHelpState(interaction) {
  return groupCommandsByCategory(getVisibleCommands(interaction));
}

function buildHomeEmbed(interaction, groupedCommands) {
  const categories = getSortedCategories(groupedCommands);

  const totalCommands = categories.reduce(
    (sum, category) => sum + groupedCommands[category].length,
    0
  );

  const categoryLines = categories.map((category) => {
    const meta = getCategoryMeta(category);
    const count = groupedCommands[category].length;

    return [
      `${meta.emoji} **${meta.label}**`,
      `> ${meta.description}`,
      `> \`${count}\` command${count === 1 ? '' : 's'} available`,
    ].join('\n');
  });

  return baseEmbed(interaction.client)
    .setTitle('`📚` Goliath Command Centre')
    .setDescription([
      '`💎` Browse the commands available to your Discord permissions.',
      '',
      '`📂` **Command Categories**',
      '',
      categoryLines.join('\n\n'),
      '',
      '`🔎` **Visible Commands**',
      `> \`${totalCommands}\` command${totalCommands === 1 ? '' : 's'} available to you`,
    ].join('\n'))
    .setThumbnail(interaction.client.user.displayAvatarURL({ dynamic: true }));
}

function buildCategoryEmbed(interaction, category, commands) {
  const meta = getCategoryMeta(category);

  const commandList = commands.length
    ? commands
        .map((command) => {
          const name = command.data.name;
          const description = getCommandDescription(command);

          return [
            `\`/${name}\``,
            `> ${description}`,
          ].join('\n');
        })
        .join('\n\n')
    : '*No commands available in this category.*';

  return baseEmbed(interaction.client)
    .setTitle(`\`${meta.emoji}\` ${meta.label} Commands`)
    .setDescription([
      meta.description,
      '',
      '`⚡` **Available Commands**',
      '',
      commandList,
    ].join('\n'))
    .setFooter({
      text: `${commands.length} command${commands.length === 1 ? '' : 's'} visible to you`,
      iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }),
    });
}

function buildComponents(groupedCommands, selectedCategory = null, disabled = false) {
  const categories = getSortedCategories(groupedCommands);

  const options = categories.length
    ? categories.slice(0, 25).map((category) => {
        const meta = getCategoryMeta(category);
        const count = groupedCommands[category].length;

        return {
          label: meta.label,
          description: `${count} command${count === 1 ? '' : 's'} available`,
          value: category,
          emoji: meta.emoji,
          default: selectedCategory === category,
        };
      })
    : [
        {
          label: 'Other',
          description: 'No commands available',
          value: 'Other',
          emoji: CATEGORY_META.Other.emoji,
          default: true,
        },
      ];

  const selectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('help-category-select')
      .setPlaceholder('📂 Choose a command category')
      .setDisabled(disabled || !categories.length)
      .addOptions(options)
  );

  const buttonRow = new ActionRowBuilder().addComponents(
    createSecondaryButton(
      'help-back-home',
      'Back Home',
      '🏠',
      disabled || !selectedCategory
    ),
    createDangerButton('help-close', 'Close', '✖️', disabled)
  );

  return [selectRow, buttonRow];
}

async function handleHelpSelectMenu(interaction) {
  if (interaction.customId !== 'help-category-select') return false;

  const groupedCommands = getHelpState(interaction);
  const selectedCategory = interaction.values?.[0];

  if (!selectedCategory || !groupedCommands[selectedCategory]) {
    await safeReply(interaction, {
      content: '⚠️ That help category is no longer available.',
    });

    return true;
  }

  await interaction.update({
    embeds: [
      buildCategoryEmbed(
        interaction,
        selectedCategory,
        groupedCommands[selectedCategory]
      ),
    ],
    components: buildComponents(groupedCommands, selectedCategory),
  });

  return true;
}

async function handleHelpButton(interaction) {
  if (interaction.customId === 'help-back-home') {
    const groupedCommands = getHelpState(interaction);

    await interaction.update({
      embeds: [buildHomeEmbed(interaction, groupedCommands)],
      components: buildComponents(groupedCommands),
    });

    return true;
  }

  if (interaction.customId === 'help-close') {
    await interaction.update({
      content: '`✅` Help panel closed.',
      embeds: [],
      components: [],
    });

    return true;
  }

  return false;
}

async function safeReply(interaction, payload) {
  const safePayload = {
    ...payload,
    flags: 64,
  };

  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(safePayload);
  }

  return interaction.reply(safePayload);
}

module.exports = {
  category: 'Utility',

  help: {
    name: 'help',
    description: '📚 Browse Goliath commands, modules, and tools.',
    usage: '/help',
  },

  access: {
    ownerOnly: false,
  },

  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('📚 Browse Goliath commands, modules, and tools'),

  async execute(interaction) {
    const denied = await enforceCommandAccess(interaction, module.exports);
    if (denied) return;

    const groupedCommands = getHelpState(interaction);

    if (!Object.keys(groupedCommands).length) {
      return safeReply(interaction, {
        content: '`⚠️` I could not find any commands available to you.',
      });
    }

    return safeReply(interaction, {
      embeds: [buildHomeEmbed(interaction, groupedCommands)],
      components: buildComponents(groupedCommands),
    });
  },

  handleHelpSelectMenu,
  handleHelpButton,
};
