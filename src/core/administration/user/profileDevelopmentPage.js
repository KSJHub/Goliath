const { EMOJIS, navigationButton } = require('../../guild/goliathNavigation');
'use strict';

const { ActionRowBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const leveling = require('../../../modules/communityStudio/leveling/leveling');

function button(customId, label, style = ButtonStyle.Secondary, emoji = null) {
  const component = navigationButton(customId, label, style);
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
  if (embedTitle(payload) !== `${EMOJIS.USER} Your Profile`) return payload;

  const searchRow = payload.components?.find((actionRow) =>
    actionRow?.components?.some((component) => componentId(component) === 'user:search'));
  const existingNavigation = payload.components?.[payload.components.length - 1];
  const existingNavigationComponents = existingNavigation?.components || [];

  const back = existingNavigationComponents.find((component) => componentLabel(component) === 'Back')
    || button('user:close', 'Back', ButtonStyle.Secondary, EMOJIS.BACK);
  const refresh = existingNavigationComponents.find((component) => componentLabel(component) === 'Refresh')
    || button('user:profile:refresh', 'Refresh', ButtonStyle.Success, EMOJIS.REFRESH);
  const inProgress = existingNavigationComponents.find((component) => componentLabel(component) === 'In Progress')
    || button('user:in-progress:0', 'In Progress', ButtonStyle.Secondary, EMOJIS.QUARANTINE);

  const homeButtons = [
    button('user:account:record', 'Account', ButtonStyle.Secondary, EMOJIS.WORKSPACE),
    button('user:category:community', `${EMOJIS.COMMUNITIES} Community`),
    button('user:category:feedback', `${EMOJIS.MESSAGES} Feedback`),
    button('user:help', 'Help', ButtonStyle.Secondary, EMOJIS.HELP_QUESTION),
    button('user:category:messages', `${EMOJIS.AUTOMOD_INVITES} Messages`),
    button('user:category:roles', `${EMOJIS.ROLES} Roles`),
    button('user:category:security', `${EMOJIS.SECURITY} Security`),
    button('user:category:social', `${EMOJIS.SOCIAL} Social`),
    button('user:category:utility', `${EMOJIS.TOOLS} Utility`),
  ];

  payload.components = [
    searchRow,
    row(...homeButtons.slice(0, 4)),
    row(...homeButtons.slice(4, 8)),
    row(...homeButtons.slice(8)),
    row(
      back,
      refresh,
      button('user:preferences', 'Preferences', ButtonStyle.Secondary, EMOJIS.SETTINGS),
      inProgress,
    ),
  ].filter(Boolean);

  return payload;
}

function rebuildLevelingPanel(payload) {
  if (embedTitle(payload) !== `${EMOJIS.TROPHY} Your Leveling`) return payload;

  const paused = embedDescription(payload).includes('Leveling is paused for your account.');
  const navigationRow = payload.components?.[payload.components.length - 1];
  const existingActionComponents = payload.components?.[0]?.components || [];
  const refresh = existingActionComponents.find((component) => componentLabel(component) === 'Refresh')
    || button('user:module:leveling', 'Refresh', ButtonStyle.Success, EMOJIS.REFRESH);

  payload.components = [
    row(
      button(
        'user:preferences',
        paused ? 'Enable Leveling' : 'Disable Leveling',
        paused ? ButtonStyle.Success : ButtonStyle.Danger,
        paused ? EMOJIS.PLAY : EMOJIS.PAUSE,
      ),
      button('user:leveling:leaderboard:xp:0', 'Leaderboard', ButtonStyle.Primary, EMOJIS.TROPHY),
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
  if (title === `${EMOJIS.ROLES} Roles`) {
    moduleButtons = [
      button('user:module:role-history', 'History', ButtonStyle.Secondary, EMOJIS.SCROLL),
      button('user:profile:roles', 'View Roles', ButtonStyle.Primary, EMOJIS.ROLES),
    ];
  } else if (title === `${EMOJIS.SECURITY} Security`) {
    moduleButtons = [
      button('user:module:security-notifications', 'Notifications', ButtonStyle.Secondary, EMOJIS.BELL),
      button('user:module:verification', 'Verification', ButtonStyle.Secondary, EMOJIS.SUCCESS),
    ];
  } else if (title === `${EMOJIS.SOCIAL} Social`) {
    moduleButtons = [button('user:module:social', 'My Creator Profile', ButtonStyle.Success, EMOJIS.USER)];
  }

  if (moduleButtons) payload.components = [row(...moduleButtons), navigationRow].filter(Boolean);
  return payload;
}

function refreshHelpPanel(payload) {
  const embed = payload?.embeds?.[0];
  if (embedTitle(payload) !== `${EMOJIS.HELP_QUESTION} Goliath User Panel Help`) return payload;

  embed.setDescription([
    'Welcome to your personal Goliath User Panel.',
    '',
    `**${EMOJIS.USER} Profile Home**`,
    'Your live Discord profile, membership, progress and community summary are displayed directly on the landing panel.',
    '',
    `**${EMOJIS.ADMIN_PIN} Personal Tools**`,
    `${EMOJIS.WORKSPACE} **Account Record** — Your warnings, cases, infractions and appeals.`,
    `${EMOJIS.HELP_QUESTION} **Help** — User Panel guidance.`,
    `${EMOJIS.SETTINGS} **Preferences** — Control personal participation in supported modules.`,
    '',
    `**${EMOJIS.CHANNELS} Categories**`,
    `${EMOJIS.COMMUNITIES} **Community** — Giveaways, invites, leveling and polls.`,
    `${EMOJIS.MESSAGES} **Feedback** — Forms, suggestions and tickets.`,
    `${EMOJIS.AUTOMOD_INVITES} **Messages** — Starboard.`,
    `${EMOJIS.ROLES} **Roles** — View roles and role history.`,
    `${EMOJIS.SECURITY} **Security** — Verification and notifications.`,
    `${EMOJIS.SOCIAL} **Social** — My Creator Profile.`,
    `${EMOJIS.TOOLS} **Utility** — Live Help, Ping and Server Info, plus planned utility tools.`,
    '',
    `**${EMOJIS.USER_HELP_NAVIGATION} Navigation**`,
    `${EMOJIS.BACK} **Back** returns to the previous page. Multi-page menus add User Panel and page controls only when needed.`,
  ].join('\n'));

  return payload;
}

function refreshInProgressPanel(payload) {
  const embed = payload?.embeds?.[0];
  const title = embedTitle(payload);
  if (!title.startsWith(`${EMOJIS.QUARANTINE} User Panel Development —`)) return payload;

  const pages = {
    [`${EMOJIS.QUARANTINE} User Panel Development — ${EMOJIS.COMMUNITIES} Community`]: [
      '**Pending buttons**',
      '• Giveaways',
      '• Invites',
      '• Leveling',
      '• Polls',
    ],
    [`${EMOJIS.QUARANTINE} User Panel Development — ${EMOJIS.MESSAGES} Feedback & Messages`]: [
      '**Pending buttons**',
      '• Forms',
      '• Starboard',
      '• Suggestions',
      '• Tickets',
    ],
    [`${EMOJIS.QUARANTINE} User Panel Development — ${EMOJIS.ROLES} Roles, Security & Social`]: [
      '**Pending buttons**',
      '• History',
      '• My Creator Profile',
      '• Notifications',
      '• Verification',
      '• View Roles',
    ],
    [`${EMOJIS.QUARANTINE} User Panel Development — ${EMOJIS.USER} Account & Utility`]: [
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

  if (title.endsWith(`${EMOJIS.USER} Account & Utility`)) embed.setTitle(`${EMOJIS.QUARANTINE} User Panel Development — Personal Tools & Utility`);

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
  if (title === `${EMOJIS.USER} Your Profile` || title === `${EMOJIS.MEMBERS} Creator Profiles` || title === `${EMOJIS.MEMBERS} My Creator Profile`) return payload;

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
    components: [row(button('user:home', 'Back', ButtonStyle.Secondary, EMOJIS.BACK))],
  };
}

function buildPreferencesDevelopmentPanel(interaction) {
  const guildId = interaction.guildId || interaction.guild?.id;
  const userId = interaction.user?.id;
  const sourceTitle = interactionSourceTitle(interaction);
  const shouldToggleLeveling = sourceTitle === `${EMOJIS.SETTINGS} Preferences` || sourceTitle === `${EMOJIS.TROPHY} Your Leveling`;

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
      ? `${EMOJIS.SUCCESS} Leveling enabled. XP earning and profile progress have resumed.`
      : `${EMOJIS.PAUSE} Leveling disabled. Your XP is preserved and no new XP will be earned.`;
  }

  const name = interaction.member?.displayName || interaction.user?.username || 'Unknown User';
  const savedUser = leveling.getUser(guildId, userId);
  const savedXp = Math.max(0, Number(savedUser?.xp || 0));
  const savedLevel = Math.max(0, Number(savedUser?.level || 0));

  return {
    embeds: [new EmbedBuilder()
      .setColor(participating ? '#57F287' : '#747F8D')
      .setTitle(`${EMOJIS.SETTINGS} Preferences`)
      .setDescription([
        notice ? `> ${notice}` : null,
        notice ? '' : null,
        `**${EMOJIS.TROPHY} Leveling**`,
        `**Status:** ${participating ? `${EMOJIS.ENV_PRODUCTION} Participating` : `${EMOJIS.PAUSE} Paused`}`,
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
        participating ? EMOJIS.PAUSE : EMOJIS.PLAY,
      )),
      row(button('user:home', 'Back', ButtonStyle.Secondary, EMOJIS.BACK)),
    ],
  };
}

function buildProfileDevelopmentPage(interaction) {
  return buildSimpleDevelopmentPanel(
    interaction,
    `${EMOJIS.QUARANTINE} User Panel Development Tools`,
    'Development roadmap only. Modules remain owned by their existing APIs.',
  );
}

module.exports = {
  buildPreferencesDevelopmentPanel,
  buildProfileDevelopmentPage,
  buildSimpleDevelopmentPanel,
  sortNonNavigationButtons,
};
