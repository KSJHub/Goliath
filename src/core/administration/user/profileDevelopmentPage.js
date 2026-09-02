'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const leveling = require('../../../modules/communityStudio/leveling/leveling');

function button(customId, label, style = ButtonStyle.Secondary, emoji = null) {
  const component = new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
  if (emoji) component.setEmoji(emoji);
  return component;
}

function row(...components) {
  return new ActionRowBuilder().addComponents(...components);
}

function componentId(component) {
  return component?.data?.custom_id || component?.customId || null;
}

function componentLabel(component) {
  return String(component?.data?.label || component?.label || '');
}

function alphabeticLabel(component) {
  return componentLabel(component)
    .replace(/^[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D\s]+/u, '')
    .trim();
}

function isButtonRow(actionRow) {
  return Array.isArray(actionRow?.components)
    && actionRow.components.every((component) => component?.data?.type === 2);
}

function embedTitle(payload) {
  const embed = payload?.embeds?.[0];
  return embed?.data?.title || embed?.title || '';
}

function embedDescription(payload) {
  const embed = payload?.embeds?.[0];
  return String(embed?.data?.description || embed?.description || '');
}

function interactionSourceTitle(interaction) {
  return interaction?.message?.embeds?.[0]?.title || '';
}

function cleanSearchOptions(payload) {
  for (const actionRow of payload?.components || []) {
    for (const component of actionRow?.components || []) {
      if (componentId(component) !== 'user:search' || !Array.isArray(component.options)) continue;
      component.options = component.options.filter((option) => {
        const value = option?.data?.value || option?.value;
        return !['reputation', 'profile-settings', 'notes'].includes(value);
      });
    }
  }
}

function rebuildProfileHome(payload) {
  if (embedTitle(payload) !== '👤 Your Profile') return payload;

  const searchRow = payload.components?.find((actionRow) =>
    actionRow?.components?.some((component) => componentId(component) === 'user:search'));
  const existingNavigation = payload.components?.[payload.components.length - 1];
  const existingNavigationComponents = existingNavigation?.components || [];

  const back = existingNavigationComponents.find((component) => componentLabel(component) === 'Back')
    || button('user:close', 'Back', ButtonStyle.Secondary, '⬅️');
  const refresh = existingNavigationComponents.find((component) => componentLabel(component) === 'Refresh')
    || button('user:profile:refresh', 'Refresh', ButtonStyle.Success, '🔄');
  const inProgress = existingNavigationComponents.find((component) => componentLabel(component) === 'In Progress')
    || button('user:in-progress:0', 'In Progress', ButtonStyle.Secondary, '🚧');

  const homeButtons = [
    button('user:account:record', 'Account', ButtonStyle.Secondary, '🗂️'),
    button('user:category:community', '🏘️ Community'),
    button('user:category:feedback', '💬 Feedback'),
    button('user:help', 'Help', ButtonStyle.Secondary, '❓'),
    button('user:category:messages', '✉️ Messages'),
    button('user:category:roles', '🎭 Roles'),
    button('user:category:security', '🛡️ Security'),
    button('user:category:social', '📣 Social'),
    button('user:category:utility', '🧰 Utility'),
  ];

  payload.components = [
    searchRow,
    row(...homeButtons.slice(0, 4)),
    row(...homeButtons.slice(4, 8)),
    row(...homeButtons.slice(8)),
    row(
      back,
      refresh,
      button('user:preferences', 'Preferences', ButtonStyle.Secondary, '⚙️'),
      inProgress,
    ),
  ].filter(Boolean);

  return payload;
}

function rebuildLevelingPanel(payload) {
  if (embedTitle(payload) !== '🏆 Your Leveling') return payload;

  const paused = embedDescription(payload).includes('Leveling is paused for your account.');
  const navigationRow = payload.components?.[payload.components.length - 1];
  const existingActionComponents = payload.components?.[0]?.components || [];
  const refresh = existingActionComponents.find((component) => componentLabel(component) === 'Refresh')
    || button('user:module:leveling', 'Refresh', ButtonStyle.Success, '🔄');

  payload.components = [
    row(
      button(
        'user:preferences',
        paused ? 'Enable Leveling' : 'Disable Leveling',
        paused ? ButtonStyle.Success : ButtonStyle.Danger,
        paused ? '▶️' : '⏸️',
      ),
      button('user:leveling:leaderboard:xp:0', 'Leaderboard', ButtonStyle.Primary, '🏆'),
      refresh,
    ),
    navigationRow,
  ].filter(Boolean);

  return payload;
}

function rebuildCategoryPanel(payload) {
  const title = embedTitle(payload);
  const navigationRow = payload.components?.[payload.components.length - 1];

  let moduleButtons = null;
  if (title === '🎭 Roles') {
    moduleButtons = [
      button('user:module:role-history', 'History', ButtonStyle.Secondary, '📜'),
      button('user:profile:roles', 'View Roles', ButtonStyle.Primary, '🎭'),
    ];
  } else if (title === '🛡️ Security') {
    moduleButtons = [
      button('user:module:security-notifications', 'Notifications', ButtonStyle.Secondary, '🔔'),
      button('user:module:verification', 'Verification', ButtonStyle.Secondary, '✅'),
    ];
  } else if (title === '📣 Social') {
    moduleButtons = [button('user:module:social', 'My Creator Profile', ButtonStyle.Success, '👤')];
  }

  if (moduleButtons) payload.components = [row(...moduleButtons), navigationRow].filter(Boolean);
  return payload;
}

function refreshHelpPanel(payload) {
  const embed = payload?.embeds?.[0];
  if (embedTitle(payload) !== '❓ Goliath User Panel Help') return payload;

  embed.setDescription([
    'Welcome to your personal Goliath User Panel.',
    '',
    '**👤 Profile Home**',
    'Your live Discord profile, membership, progress and community summary are displayed directly on the landing panel.',
    '',
    '**📌 Personal Tools**',
    '🗂️ **Account Record** — Your warnings, cases, infractions and appeals.',
    '❓ **Help** — User Panel guidance.',
    '⚙️ **Preferences** — Control personal participation in supported modules.',
    '',
    '**📂 Categories**',
    '🏘️ **Community** — Giveaways, invites, leveling and polls.',
    '💬 **Feedback** — Forms, suggestions and tickets.',
    '✉️ **Messages** — Starboard.',
    '🎭 **Roles** — View roles and role history.',
    '🛡️ **Security** — Verification and notifications.',
    '📣 **Social** — My Creator Profile.',
    '🧰 **Utility** — Live Help, Ping and Server Info, plus planned utility tools.',
    '',
    '**🧭 Navigation**',
    '⬅️ **Back** returns to the previous page. Multi-page menus add User Panel and page controls only when needed.',
  ].join('\n'));

  return payload;
}

function refreshInProgressPanel(payload) {
  const embed = payload?.embeds?.[0];
  const title = embedTitle(payload);
  if (!title.startsWith('🚧 User Panel Development —')) return payload;

  const pages = {
    '🚧 User Panel Development — 🏘️ Community': [
      '**Pending buttons**',
      '• Giveaways',
      '• Invites',
      '• Leveling',
      '• Polls',
    ],
    '🚧 User Panel Development — 💬 Feedback & Messages': [
      '**Pending buttons**',
      '• Forms',
      '• Starboard',
      '• Suggestions',
      '• Tickets',
    ],
    '🚧 User Panel Development — 🎭 Roles, Security & Social': [
      '**Pending buttons**',
      '• History',
      '• My Creator Profile',
      '• Notifications',
      '• Verification',
      '• View Roles',
    ],
    '🚧 User Panel Development — 👤 Account & Utility': [
      '**Pending personal tools**',
      '• Account Record',
      '',
      '**Pending utility buttons**',
      '• Schedule',
      '• Stats',
      '• Temporary Voice',
      '• Translate',
    ],
  };

  const lines = pages[title];
  if (!lines) return payload;

  if (title.endsWith('👤 Account & Utility')) embed.setTitle('🚧 User Panel Development — Personal Tools & Utility');

  embed.setDescription([
    '**DEV planning notebook**',
    'This panel lists every current User Panel button that still needs to be designed, connected or approved.',
    'Remove each entry when that button has been fully addressed.',
    '',
    ...lines,
  ].join('\n'));

  return payload;
}

function sortNonNavigationButtons(payload) {
  if (!payload || !Array.isArray(payload.components)) return payload;
  cleanSearchOptions(payload);
  refreshHelpPanel(payload);
  refreshInProgressPanel(payload);
  rebuildProfileHome(payload);
  rebuildLevelingPanel(payload);
  rebuildCategoryPanel(payload);

  const title = embedTitle(payload);
  if (title === '👤 Your Profile' || title === '👥 Creator Profiles' || title === '👥 My Creator Profile') return payload;

  const finalRowIndex = payload.components.length - 1;
  const sortableRows = [];
  const sizes = [];
  const buttons = [];

  for (let index = 0; index < finalRowIndex; index += 1) {
    const actionRow = payload.components[index];
    if (!isButtonRow(actionRow)) continue;
    sortableRows.push(index);
    sizes.push(actionRow.components.length);
    buttons.push(...actionRow.components);
  }

  buttons.sort((left, right) => alphabeticLabel(left).localeCompare(
    alphabeticLabel(right),
    'en',
    { sensitivity: 'base' },
  ));
  let offset = 0;
  sortableRows.forEach((rowIndex, index) => {
    const size = sizes[index];
    payload.components[rowIndex] = row(...buttons.slice(offset, offset + size));
    offset += size;
  });

  return payload;
}

function buildSimpleDevelopmentPanel(interaction, title, description) {
  const name = interaction.member?.displayName || interaction.user?.username || 'Unknown User';
  return {
    embeds: [new EmbedBuilder()
      .setColor('#FEE75C')
      .setTitle(title)
      .setDescription(description)
      .setFooter({ text: `Requested by ${name}` })
      .setTimestamp()],
    components: [row(button('user:home', 'Back', ButtonStyle.Secondary, '⬅️'))],
  };
}

function buildPreferencesDevelopmentPanel(interaction) {
  const guildId = interaction.guildId || interaction.guild?.id;
  const userId = interaction.user?.id;
  const sourceTitle = interactionSourceTitle(interaction);
  const shouldToggleLeveling = sourceTitle === '⚙️ Preferences' || sourceTitle === '🏆 Your Leveling';

  let participating = leveling.isUserParticipating(guildId, userId);
  let notice = null;
  if (shouldToggleLeveling) {
    participating = !participating;
    leveling.setUserParticipation(guildId, userId, participating, {
      guildId,
      actorId: userId,
      action: participating ? 'user_leveling_opt_in' : 'user_leveling_opt_out',
    });
    notice = participating
      ? '✅ Leveling enabled. XP earning and profile progress have resumed.'
      : '⏸️ Leveling disabled. Your XP is preserved and no new XP will be earned.';
  }

  const name = interaction.member?.displayName || interaction.user?.username || 'Unknown User';
  const savedUser = leveling.getUser(guildId, userId);
  const savedXp = Math.max(0, Number(savedUser?.xp || 0));
  const savedLevel = Math.max(0, Number(savedUser?.level || 0));

  return {
    embeds: [new EmbedBuilder()
      .setColor(participating ? '#57F287' : '#747F8D')
      .setTitle('⚙️ Preferences')
      .setDescription([
        notice ? `> ${notice}` : null,
        notice ? '' : null,
        '**🏆 Leveling**',
        `**Status:** ${participating ? '🟢 Participating' : '⏸️ Paused'}`,
        `**Saved level:** ${savedLevel}`,
        `**Saved XP:** ${savedXp.toLocaleString()}`,
        '',
        participating
          ? 'You are earning XP. Your level, XP progress and rank can appear on your profile.'
          : 'You are not earning XP. Your saved progress is hidden from your profile until you re-enable leveling.',
        '',
        '_Disabling leveling never deletes your existing XP or level._',
      ].filter((line) => line !== null).join('\n'))
      .setFooter({ text: `Requested by ${name}` })
      .setTimestamp()],
    components: [
      row(button(
        'user:preferences',
        participating ? 'Disable Leveling' : 'Enable Leveling',
        participating ? ButtonStyle.Danger : ButtonStyle.Success,
        participating ? '⏸️' : '▶️',
      )),
      row(button('user:home', 'Back', ButtonStyle.Secondary, '⬅️')),
    ],
  };
}

function buildProfileDevelopmentPage(interaction) {
  return buildSimpleDevelopmentPanel(
    interaction,
    '🚧 User Panel Development Tools',
    'Development roadmap only. Modules remain owned by their existing APIs.',
  );
}

module.exports = {
  buildPreferencesDevelopmentPanel,
  buildProfileDevelopmentPage,
  buildSimpleDevelopmentPanel,
  sortNonNavigationButtons,
};
