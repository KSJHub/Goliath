const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');

const PANEL_COLOR = '#5865F2';
const DEV_COLOR = '#FEE75C';
const ITEMS_PER_ROW = 4;
const ACCOUNT_RECORD_KEYS = new Set(['warnings', 'cases', 'infractions', 'appeals']);

const CATEGORY_CATALOG = [
  { key: 'account', label: 'Account', emoji: '👤', summary: 'Review your moderation and appeal information.' },
  { key: 'community', label: 'Community', emoji: '🏘️', summary: 'Birthdays, giveaways, invites, leveling and polls.' },
  { key: 'feedback', label: 'Feedback', emoji: '💬', summary: 'Forms, suggestions and tickets.' },
  { key: 'messages', label: 'Messages', emoji: '✉️', summary: 'Member-visible message tools when approved.' },
  { key: 'roles', label: 'Roles', emoji: '🎭', summary: 'Self-assignable roles, role history and requests.' },
  { key: 'security', label: 'Security', emoji: '🛡️', summary: 'Verification status and member security tools.' },
  { key: 'social', label: 'Social', emoji: '📣', summary: 'Open your own Social Studio Creator Profile.' },
  { key: 'utility', label: 'Utility', emoji: '🧰', summary: 'Help, ping, server info, translate and future utility tools.' },
];

const MODULE_CATALOG = [
  { key: 'warnings', category: 'account', label: 'Warnings', emoji: '⚠️', summary: 'Planned personal warning view.', status: 'planned' },
  { key: 'cases', category: 'account', label: 'Cases', emoji: '📁', summary: 'Planned view of your own cases.', status: 'planned' },
  { key: 'infractions', category: 'account', label: 'Infractions', emoji: '📋', summary: 'Planned personal infraction history.', status: 'planned' },
  { key: 'appeals', category: 'account', label: 'Appeals', emoji: '📝', summary: 'Planned personal appeal access.', status: 'planned' },
  { key: 'birthdays', category: 'community', label: 'Birthdays', emoji: '🎂', summary: 'Manage your birthday and privacy settings.', status: 'live' },
  { key: 'giveaways', category: 'community', label: 'Giveaways', emoji: '🎉', summary: 'Member giveaway dashboard plan.', status: 'locked' },
  { key: 'invites', category: 'community', label: 'Invites', emoji: '📨', summary: 'Planned member invite view.', status: 'planned' },
  { key: 'leveling', category: 'community', label: 'Leveling', emoji: '🏆', summary: 'View your XP, rank, rewards and earning rules.', status: 'live' },
  { key: 'polls', category: 'community', label: 'Polls', emoji: '📊', summary: 'Planned member poll view.', status: 'planned' },
  { key: 'forms', category: 'feedback', label: 'Forms', emoji: '📝', summary: 'Planned member form access.', status: 'planned' },
  { key: 'suggestions', category: 'feedback', label: 'Suggestions', emoji: '💡', summary: 'Planned member suggestion access.', status: 'planned' },
  { key: 'tickets', category: 'feedback', label: 'Tickets', emoji: '🎫', summary: 'Planned member ticket access.', status: 'planned' },
  { key: 'starboard', category: 'messages', label: 'Starboard', emoji: '⭐', summary: 'Planned member starboard view.', status: 'planned' },
  { key: 'roles', category: 'roles', label: 'Roles', emoji: '🎭', summary: 'Planned self-assignable roles, history and requests.', status: 'planned' },
  { key: 'security', category: 'security', label: 'Security', emoji: '🛡️', summary: 'Planned verification status and security notifications.', status: 'planned' },
  { key: 'social', category: 'social', label: 'Social Studio', emoji: '📣', summary: 'Open or create your own Creator Profile.', status: 'live' },
  { key: 'help', category: 'utility', label: 'Help', emoji: '📚', summary: 'User Panel help and navigation.', status: 'approved' },
  { key: 'ping', category: 'utility', label: 'Ping', emoji: '🏓', summary: 'Existing /ping command.', status: 'approved' },
  { key: 'serverinfo', category: 'utility', label: 'Server Info', emoji: '🏰', summary: 'Existing /serverinfo command.', status: 'approved' },
  { key: 'translate', category: 'utility', label: 'Translate', emoji: '🌐', summary: 'Existing /translate command.', status: 'approved' },
  { key: 'schedule', category: 'utility', label: 'Schedule', emoji: '📅', summary: 'Future member schedule tools.', status: 'planned' },
  { key: 'stats', category: 'utility', label: 'Stats', emoji: '📈', summary: 'Future member statistics view.', status: 'planned' },
  { key: 'tempvoice', category: 'utility', label: 'Temporary Voice', emoji: '🔊', summary: 'Future temporary voice controls.', status: 'planned' },
];

const IN_PROGRESS_PAGES = [
  {
    title: '🏘️ Community',
    lines: [
      '**🎉 Giveaways — Locked**',
      '• View active giveaways',
      '• View giveaway history',
      '• View previous winners',
      '• View my entries',
      '• View my wins',
      '• View my giveaway statistics',
      '• Jump to giveaway message',
      '• Notification preferences (future)',
      '',
      '**📨 Invites — Discussion**',
      '• My invite code',
      '• Total and successful invites',
      '• Left-server and fake-invite counts',
      '• Invite leaderboard, rewards and history',
      '',
      '**📊 Polls — Discussion**',
      '• Active polls, my votes, results and history',
    ],
  },
  {
    title: '💬 Feedback & Messages',
    lines: [
      '**📝 Forms — Discussion**',
      '• View available forms',
      '• Track my submissions and status',
      '',
      '**💡 Suggestions — Discussion**',
      '• Submit and track suggestions',
      '• View voting and decision status',
      '',
      '**🎫 Tickets — Discussion**',
      '• Open tickets and view my ticket history',
      '• Jump to active ticket channels',
      '',
      '**⭐ Starboard — Discussion**',
      '• My starred messages',
      '• Top starred posts and jump-to-message access',
    ],
  },
  {
    title: '🎭 Roles, Security & Social',
    lines: [
      '**🎭 Roles — Discussion**',
      '• Self-assignable roles',
      '• Role history and role requests',
      '',
      '**🛡️ Security — Discussion**',
      '• Verification status',
      '• Member security notifications',
      '',
      '**📣 Social Studio — Phase 1**',
      '• Permission-controlled Creator Profile access',
      '• Open or create your own Creator Profile',
    ],
  },
  {
    title: '👤 Account & Utility',
    lines: [
      '**🗂️ Account Record — Planned**',
      '• Warnings, cases, infractions and appeals (own only)',
      '',
      '**🧰 Utility — Approved / Future**',
      '• Help, ping, server info and translate',
      '• Schedule, stats and temporary voice (future)',
    ],
  },
];

const CATEGORY_BY_KEY = Object.fromEntries(CATEGORY_CATALOG.map((category) => [category.key, category]));
const MODULE_BY_KEY = Object.fromEntries(MODULE_CATALOG.map((module) => [module.key, module]));

function getMemberDisplayName(interactionOrName = 'Unknown User') {
  if (typeof interactionOrName === 'string') return interactionOrName || 'Unknown User';
  return interactionOrName?.member?.displayName || interactionOrName?.user?.displayName || interactionOrName?.user?.username || 'Unknown User';
}

function row(...components) {
  return new ActionRowBuilder().addComponents(...components);
}

function button(customId, label, style = ButtonStyle.Primary, disabled = false, emoji = null) {
  const component = new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style).setDisabled(disabled);
  if (emoji) component.setEmoji(emoji);
  return component;
}

function chunk(items, size) {
  const rows = [];
  for (let index = 0; index < items.length; index += size) rows.push(items.slice(index, index + size));
  return rows;
}

function createEmbed(title, description, memberDisplayName, color = PANEL_COLOR) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: `Requested by ${memberDisplayName}` })
    .setTimestamp();
}

function markLiveEmbed(embed) {
  return embed.setFooter({ text: 'Last refreshed' }).setTimestamp();
}

function discordTimestamp(timestamp, style = 'R') {
  const value = Number(timestamp || 0);
  if (!Number.isFinite(value) || value <= 0) return null;
  return `<t:${Math.floor(value / 1000)}:${style}>`;
}

function compactDate(timestamp) {
  const value = Number(timestamp || 0);
  if (!Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date).replace(',', ' •');
}

function progressDetails(levelingProfile = {}) {
  const level = Math.max(0, Number(levelingProfile.level || 0));
  const xp = Math.max(0, Number(levelingProfile.xp || 0));
  const currentLevelXp = Math.max(0, Number(levelingProfile.currentLevelXp || 0));
  const nextLevelXp = Math.max(currentLevelXp + 1, Number(levelingProfile.nextLevelXp || currentLevelXp + 1));
  const earnedThisLevel = Math.max(0, xp - currentLevelXp);
  const neededThisLevel = Math.max(1, nextLevelXp - currentLevelXp);
  const percent = Math.min(100, Math.floor((earnedThisLevel / neededThisLevel) * 100));
  const filled = Math.min(10, Math.floor(percent / 10));
  return { level, xp, earnedThisLevel, neededThisLevel, percent, bar: `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}` };
}

function navigationRow({ backId = null, home = true, nextId = null } = {}) {
  const components = [];
  if (backId) components.push(button(backId, 'Back', ButtonStyle.Secondary, false, '⬅️'));
  if (home) components.push(button('user:home', 'User Panel', ButtonStyle.Secondary, false, '🏠'));
  if (nextId) components.push(button(nextId, 'Next', ButtonStyle.Primary, false, '➡️'));
  return row(...components);
}

function buildSearchRow(selectedModule = null) {
  return row(new StringSelectMenuBuilder()
    .setCustomId('user:search')
    .setPlaceholder('🔎 Search or jump to a user tool')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(MODULE_CATALOG.slice(0, 25).map((module) => ({
      label: module.label,
      description: module.summary.slice(0, 100),
      value: module.key,
      emoji: module.emoji,
      default: selectedModule === module.key,
    }))));
}

function buildCategoryButtons(style = ButtonStyle.Secondary) {
  return chunk(CATEGORY_CATALOG.map((category) => button(
    `user:category:${category.key}`, category.label, style, false, category.emoji,
  )), ITEMS_PER_ROW).map((items) => row(...items));
}

function buildMainPanel(interactionOrName = 'Unknown User') {
  const memberDisplayName = getMemberDisplayName(interactionOrName);
  const description = [
    'Select a category to access member tools.',
    '',
    CATEGORY_CATALOG.map((category) => `${category.emoji} **${category.label}** - ${category.summary}`).join('\n'),
  ].join('\n');
  return {
    embeds: [createEmbed('👤 Goliath User Panel', description, memberDisplayName)],
    components: [buildSearchRow(), ...buildCategoryButtons(ButtonStyle.Primary)].slice(0, 5),
  };
}

function buildCategoryPanel(categoryKey, interactionOrName = 'Unknown User') {
  if (categoryKey === 'account') return buildAccountRecordPanel(interactionOrName);
  const memberDisplayName = getMemberDisplayName(interactionOrName);
  const category = CATEGORY_BY_KEY[categoryKey] || CATEGORY_BY_KEY.community;
  const modules = MODULE_CATALOG.filter((module) => module.category === category.key);
  const description = [
    category.summary,
    '',
    modules.length ? modules.map((module) => `${module.emoji} **${module.label}** - ${module.summary}`).join('\n') : 'No user tools are approved in this category yet.',
  ].join('\n');
  const moduleButtons = modules.map((module) => button(
    `user:module:${module.key}`,
    module.label,
    ButtonStyle.Primary,
    false,
    module.emoji,
  ));
  return {
    embeds: [createEmbed(`${category.emoji} ${category.label}`, description, memberDisplayName)],
    components: [
      buildSearchRow(),
      ...chunk(moduleButtons, ITEMS_PER_ROW).map((items) => row(...items)),
      navigationRow({ backId: 'user:home', home: false }),
    ].slice(0, 5),
  };
}

function buildProfilePanel(interaction, profile = {}, options = {}) {
  const memberDisplayName = getMemberDisplayName(interaction);
  const user = interaction.user;
  const member = interaction.member;
  const created = compactDate(user?.createdTimestamp);
  const joined = compactDate(member?.joinedTimestamp);
  const joinedRelative = discordTimestamp(member?.joinedTimestamp, 'R');

  const identity = [`<@${user?.id || '0'}>`, `${user?.username || 'unknown'}`, `User ID: \`${user?.id || 'unknown'}\``];
  const membership = [
    created ? `Discord Account Created: **${created}**` : null,
    joined ? `Joined This Server: **${joined}**` : null,
    joinedRelative ? `Member For: **${joinedRelative}**` : null,
  ].filter(Boolean);

  const progress = [];
  if (profile.leveling && options.showProgressSummary !== false) {
    const details = progressDetails(profile.leveling);
    progress.push(`Level: **${details.level}**`);
    progress.push(`XP: **${details.earnedThisLevel.toLocaleString()} / ${details.neededThisLevel.toLocaleString()}**`);
    progress.push(`\`${details.bar}\` **${details.percent}%**`);
    if (profile.leveling.rank) progress.push(`Server Rank: **#${profile.leveling.rank}**`);
  }

  const community = [];
  if (Number.isFinite(profile.invites)) community.push(`Invites: **${profile.invites.toLocaleString()}**`);
  if (Number.isFinite(profile.giveawayEntries)) community.push(`Giveaway Entries: **${profile.giveawayEntries.toLocaleString()}**`);
  if (Number.isFinite(profile.giveawayWins)) community.push(`Giveaway Wins: **${profile.giveawayWins.toLocaleString()}**`);

  const sections = [identity.join('\n')];
  if (membership.length) sections.push(`📅 **Membership**\n${membership.join('\n')}`);
  if (progress.length) sections.push(`🏆 **Progress**\n${progress.join('\n')}`);
  if (community.length) sections.push(`📊 **Community**\n${community.join('\n')}`);

  const embed = markLiveEmbed(createEmbed('👤 Your Profile', sections.join('\n\n'), memberDisplayName))
    .setThumbnail(user?.displayAvatarURL?.({ extension: 'png', size: 256 }) || null);

  const actionButtons = [];
  if (options.rolesEnabled !== false) actionButtons.push(button('user:profile:roles', 'View Roles', ButtonStyle.Primary, false, '🎭'));
  actionButtons.push(button('user:account:record', 'Account Record', ButtonStyle.Secondary, false, '🗂️'));
  actionButtons.push(button('user:help', 'Help', ButtonStyle.Secondary, false, '❓'));

  return {
    embeds: [embed],
    components: [
      buildSearchRow(),
      row(...actionButtons),
      ...buildCategoryButtons(),
      row(
        button('user:close', 'Back', ButtonStyle.Secondary, false, '⬅️'),
        button('user:profile:refresh', 'Refresh', ButtonStyle.Success, false, '🔄'),
        button('user:in-progress:0', 'In Progress', ButtonStyle.Secondary, false, '🚧'),
      ),
    ],
  };
}

function buildAccountRecordPanel(interactionOrName = 'Unknown User') {
  const memberDisplayName = getMemberDisplayName(interactionOrName);
  const modules = MODULE_CATALOG.filter((module) => ACCOUNT_RECORD_KEYS.has(module.key));
  const description = [
    'Review your own moderation and appeal information.',
    '',
    ...modules.map((module) => `${module.emoji} **${module.label}** — ${module.summary}`),
  ].join('\n');

  return {
    embeds: [createEmbed('🗂️ Your Account Record', description, memberDisplayName)],
    components: [
      row(...modules.map((module) => button(
        `user:module:${module.key}`,
        module.label,
        ButtonStyle.Secondary,
        false,
        module.emoji,
      ))),
      navigationRow({ backId: 'user:home' }),
    ],
  };
}

function formatXpSource(id, source) {
  const amount = Number(source.amount || 0) > 0 ? `**${source.amount} XP**` : '**Variable XP**';
  const timing = id === 'message'
    ? ` · ${source.cooldownSeconds}s cooldown`
    : id === 'voice'
      ? ` · every ${source.intervalMinutes} minutes`
      : '';
  return `${source.enabled ? '✅' : '❌'} **${source.label}** — ${amount}${timing}\n${source.description}`;
}

function buildRewardProgressLines(section, currentLevel = 0) {
  const rewards = Array.isArray(section.levelRewards) ? section.levelRewards : [];
  if (!rewards.length) return ['No level reward roles are currently configured.'];
  const level = Math.max(0, Number(currentLevel || 0));
  const nextReward = rewards.find((reward) => Number(reward.level) > level) || null;
  const lines = rewards.slice(0, 15).map((reward) => {
    const unlocked = level >= Number(reward.level);
    return `${unlocked ? '✅' : '⬜'} Level **${reward.level}** → <@&${reward.roleId}>`;
  });
  if (nextReward) {
    lines.push('', `**Next Reward:** Level ${nextReward.level} → <@&${nextReward.roleId}>`);
    lines.push(`**Levels Remaining:** ${Math.max(0, Number(nextReward.level) - level)}`);
  } else {
    lines.push('', '🏁 **All configured level rewards unlocked.**');
  }
  return lines;
}

function memberHistoryLines(user, limit = 15) {
  const entries = (Array.isArray(user?.history) ? user.history : []).slice(-limit).reverse();
  if (!entries.length) return ['No XP history has been recorded yet.'];
  return entries.map((entry) => {
    const timestamp = Math.floor(new Date(entry.createdAt || Date.now()).getTime() / 1000);
    const delta = Number(entry.delta || 0);
    const sign = delta > 0 ? '+' : '';
    const multiplier = Number(entry.multiplier || 1) > 1 ? ` · ${Number(entry.multiplier)}×` : '';
    const reason = entry.reason ? `\n↳ ${entry.reason}` : '';
    return `<t:${timestamp}:R> · **${sign}${delta.toLocaleString()} XP** · ${entry.source || 'other'}${multiplier}\n${Number(entry.beforeXp || 0).toLocaleString()} XP / Lv ${Number(entry.beforeLevel || 0)} → ${Number(entry.afterXp || 0).toLocaleString()} XP / Lv ${Number(entry.afterLevel || 0)}${reason}`;
  });
}

function buildLevelingUserPanel(interaction, section, user, rank, participating, activeMultiplier) {
  const memberDisplayName = getMemberDisplayName(interaction);
  const currentUser = user || { xp: 0, level: 0, messages: 0, voiceMinutes: 0 };
  const details = progressDetails({
    ...currentUser,
    currentLevelXp: Math.max(0, Number(currentUser.level || 0)) ** 2 * 100,
    nextLevelXp: (Math.max(0, Number(currentUser.level || 0)) + 1) ** 2 * 100,
  });
  const progressLines = participating
    ? [
      `Level: **${details.level}**`,
      `Total XP: **${details.xp.toLocaleString()}**`,
      rank ? `Server Rank: **#${rank}**` : 'Server Rank: **Unranked**',
      `Next Level: **${details.earnedThisLevel.toLocaleString()} / ${details.neededThisLevel.toLocaleString()} XP**`,
      `\`${details.bar}\` **${details.percent}%**`,
      `Messages Tracked: **${Number(currentUser.messages || 0).toLocaleString()}**`,
      `Voice Activity: **${Number(currentUser.voiceMinutes || 0).toLocaleString()} minutes**`,
    ]
    : [
      '**Leveling is paused for your account.**',
      `Saved Level: **${details.level}**`,
      `Saved XP: **${details.xp.toLocaleString()}**`,
      'You will not gain XP until Leveling is enabled again.',
    ];

  const configuredMultiplier = section.multiplier || {};
  const configuredStartsAt = configuredMultiplier.startsAt ? new Date(configuredMultiplier.startsAt).getTime() : null;
  const configuredEndsAt = configuredMultiplier.endsAt ? new Date(configuredMultiplier.endsAt).getTime() : null;
  const scheduledMultiplier = configuredMultiplier.enabled === true
    && Number(configuredMultiplier.value || 1) > 1
    && Number.isFinite(configuredStartsAt)
    && configuredStartsAt > Date.now()
    && (!Number.isFinite(configuredEndsAt) || configuredEndsAt > Date.now());

  const multiplierLines = activeMultiplier
    ? [
      `🟢 **${activeMultiplier.name || 'Active XP Multiplier'}**`,
      `Multiplier: **${activeMultiplier.value}×**`,
      `Applies to: ${activeMultiplier.sourceIds?.length ? activeMultiplier.sourceIds.map((id) => `\`${id}\``).join(', ') : 'All enabled XP sources'}`,
      activeMultiplier.endsAt ? `Ends: <t:${Math.floor(new Date(activeMultiplier.endsAt).getTime() / 1000)}:R>` : 'Ends: No scheduled end',
    ]
    : scheduledMultiplier
      ? [
        `🟡 **${configuredMultiplier.name || 'Scheduled XP Event'}**`,
        `Multiplier: **${configuredMultiplier.value}×**`,
        `Applies to: ${configuredMultiplier.sourceIds?.length ? configuredMultiplier.sourceIds.map((id) => `\`${id}\``).join(', ') : 'All enabled XP sources'}`,
        `Starts: <t:${Math.floor(configuredStartsAt / 1000)}:R>`,
        Number.isFinite(configuredEndsAt) ? `Ends: <t:${Math.floor(configuredEndsAt / 1000)}:R>` : 'Ends: No scheduled end',
        '_The multiplier will not affect XP until the scheduled start time._',
      ]
      : ['No XP multiplier is currently active or scheduled.'];

  return {
    embeds: [markLiveEmbed(createEmbed('🏆 Your Leveling', [
      '**Your Progress**',
      ...progressLines,
      '',
      '**Ways to Earn XP**',
      ...Object.entries(section.xpSources).map(([id, source]) => formatXpSource(id, source)),
      '',
      '**XP Multiplier**',
      ...multiplierLines,
      '',
      '**Rank Rewards**',
      ...buildRewardProgressLines(section, details.level),
    ].join('\n'), memberDisplayName, participating ? PANEL_COLOR : DEV_COLOR))],
    components: [
      row(
        button('user:module:leveling', 'Refresh', ButtonStyle.Success, false, '🔄'),
        button('user:leveling:leaderboard:xp:0', 'Leaderboard', ButtonStyle.Primary, false, '🏆'),
        button('user:leveling:history', 'XP History', ButtonStyle.Primary, false, '📈'),
        button('user:leveling:toggle', participating ? 'Disable Leveling' : 'Enable Leveling', participating ? ButtonStyle.Secondary : ButtonStyle.Success, false, participating ? '⏸️' : '▶️'),
      ),
      row(button('user:preferences', 'Preferences', ButtonStyle.Secondary, false, '⚙️')),
      navigationRow({ backId: 'user:category:community' }),
    ],
  };
}

function buildLevelingHistoryPanel(interaction, user = {}) {
  const memberDisplayName = getMemberDisplayName(interaction);
  return {
    embeds: [markLiveEmbed(createEmbed('📈 Your XP History', [
      `Current XP: **${Number(user.xp || 0).toLocaleString()}**`,
      `Current Level: **${Number(user.level || 0)}**`,
      '',
      ...memberHistoryLines(user, 15),
    ].join('\n'), memberDisplayName))],
    components: [
      row(
        button('user:leveling:history', 'Refresh', ButtonStyle.Success, false, '🔄'),
        button('user:module:leveling', 'Back', ButtonStyle.Secondary, false, '⬅️'),
      ),
    ],
  };
}

function buildInProgressPanel(interactionOrName = 'Unknown User', pageIndex = 0) {
  const memberDisplayName = getMemberDisplayName(interactionOrName);
  const safeIndex = Math.min(Math.max(Number(pageIndex) || 0, 0), IN_PROGRESS_PAGES.length - 1);
  const page = IN_PROGRESS_PAGES[safeIndex];
  const description = [
    '**DEV planning notebook**',
    'These are the currently agreed ideas for member access and controls. They remain development notes until replaced by live functionality.',
    '',
    ...page.lines,
    '',
    `Page **${safeIndex + 1} / ${IN_PROGRESS_PAGES.length}**`,
  ].join('\n');

  const controls = [
    button('user:home', 'Back', ButtonStyle.Secondary, false, '⬅️'),
    button(`user:in-progress:${safeIndex}`, 'Refresh', ButtonStyle.Success, false, '🔄'),
  ];
  if (safeIndex < IN_PROGRESS_PAGES.length - 1) controls.push(button(`user:in-progress:${safeIndex + 1}`, 'Next', ButtonStyle.Primary, false, '➡️'));
  if (safeIndex > 0) controls.unshift(button(`user:in-progress:${safeIndex - 1}`, 'Previous', ButtonStyle.Secondary, false, '⬅️'));

  return {
    embeds: [createEmbed(`🚧 User Panel Development — ${page.title}`, description, memberDisplayName, DEV_COLOR)],
    components: [row(...controls)],
  };
}

function buildHelpPanel(interactionOrName = 'Unknown User') {
  const memberDisplayName = getMemberDisplayName(interactionOrName);
  const description = [
    'Welcome to your personal Goliath User Panel.',
    '',
    '**🧭 Navigation**',
    '⬅️ **Back** — Return to the previous page.',
    '🏠 **User Panel** — Return to your live profile home.',
    '➡️ **Next** — Open the next page when one is available.',
    '',
    '**📂 Categories**',
    ...CATEGORY_CATALOG.map((category) => `${category.emoji} **${category.label}** — ${category.summary}`),
    '',
    '**🔎 Search**',
    'Use the search menu at the top of your profile to jump directly to any available user tool.',
    '',
    '**💡 Tips**',
    '• Your panel is private and only visible to you.',
    '• Some tools may require a server role or permission.',
    '• Use Refresh on live pages to load the latest information.',
  ].join('\n');

  return {
    embeds: [createEmbed('❓ Goliath User Panel Help', description, memberDisplayName)],
    components: [navigationRow({ backId: 'user:home', home: false })],
  };
}

function buildProgressPanel(interaction, levelingProfile = {}) {
  const memberDisplayName = getMemberDisplayName(interaction);
  const details = progressDetails(levelingProfile);
  const lines = [
    `Level: **${details.level}**`,
    `Total XP: **${details.xp.toLocaleString()}**`,
    levelingProfile.rank ? `Server Rank: **#${levelingProfile.rank}**` : null,
    '',
    `Next Level: **${details.earnedThisLevel.toLocaleString()} / ${details.neededThisLevel.toLocaleString()} XP**`,
    `\`${details.bar}\` **${details.percent}%**`,
    Number.isFinite(levelingProfile.messages) ? `Messages Tracked: **${levelingProfile.messages.toLocaleString()}**` : null,
    Number.isFinite(levelingProfile.voiceMinutes) ? `Voice Activity: **${levelingProfile.voiceMinutes.toLocaleString()} minutes**` : null,
  ].filter((line) => line !== null);
  return {
    embeds: [markLiveEmbed(createEmbed('🏆 Your Progress', lines.join('\n'), memberDisplayName))],
    components: [
      row(button('user:profile:progress', 'Refresh', ButtonStyle.Success, false, '🔄')),
      navigationRow({ backId: 'user:home', home: false }),
    ],
  };
}

function buildRolesPanel(interaction, options = {}) {
  const memberDisplayName = getMemberDisplayName(interaction);
  const roles = [...(interaction.member?.roles?.cache?.values?.() || [])]
    .filter((role) => role.id !== interaction.guildId)
    .sort((a, b) => b.position - a.position);
  const highest = roles[0] || null;
  const roleMentions = roles.map((role) => `<@&${role.id}>`);
  const visible = roleMentions.slice(0, 30);
  const remaining = Math.max(0, roleMentions.length - visible.length);
  const description = [
    options.showHighestRole === false ? null : `**Highest Role**\n${highest ? `<@&${highest.id}>` : 'None'}`,
    options.showRoleCount === false ? null : `**Role Count**\n${roles.length}`,
    options.showRoleList === false ? null : `**Current Roles**\n${visible.length ? visible.join('\n') : 'No roles assigned.'}${remaining ? `\n\n+${remaining} more` : ''}`,
  ].filter(Boolean).join('\n\n');
  return {
    embeds: [markLiveEmbed(createEmbed('🎭 Your Roles', description || 'Role visibility is disabled for this server.', memberDisplayName))],
    components: [
      row(button('user:profile:roles', 'Refresh', ButtonStyle.Success, false, '🔄')),
      navigationRow({ backId: 'user:home', home: false }),
    ],
  };
}

function buildGiveawaysMemoPanel(interactionOrName = 'Unknown User') {
  const memberDisplayName = getMemberDisplayName(interactionOrName);
  const description = [
    '**DEV placeholder / memo panel**', '', 'Planned member features:',
    '• View active giveaways', '• View giveaway history', '• View previous winners', '• View my entries', '• View my wins',
    '• View my giveaway statistics', '• Jump to giveaway message', '• Notification preferences (future)', '',
    '**Admin giveaway creation and management remain separate and are not exposed here.**',
  ].join('\n');
  return {
    embeds: [createEmbed('🎉 Giveaways - User Panel Plan', description, memberDisplayName, DEV_COLOR)],
    components: [navigationRow({ backId: 'user:category:community' })],
  };
}

function buildSocialAccessDeniedPanel(interactionOrName = 'Unknown User') {
  const memberDisplayName = getMemberDisplayName(interactionOrName);
  return {
    embeds: [createEmbed('Social Studio', [
      'This server only allows selected roles to use Social Studio from `/user`.', '',
      'Ask a server admin if you should have access.',
    ].join('\n'), memberDisplayName, DEV_COLOR)],
    components: [navigationRow({ backId: 'user:category:social' })],
  };
}

function buildPlannedModulePanel(moduleKey, interactionOrName = 'Unknown User') {
  const memberDisplayName = getMemberDisplayName(interactionOrName);
  const module = MODULE_BY_KEY[moduleKey];
  if (!module) return buildMainPanel(memberDisplayName);
  const category = CATEGORY_BY_KEY[module.category];
  const utilityHint = module.category === 'utility'
    ? `This tool is approved for the User Panel and currently remains available through \`/${module.key}\`.`
    : 'This module button is reserved for a future user-only view.';
  const backId = ACCOUNT_RECORD_KEYS.has(module.key)
    ? 'user:account:record'
    : `user:category:${category.key}`;
  return {
    embeds: [createEmbed(`${module.emoji} ${module.label}`, [
      '**DEV placeholder / memo panel**', '', utilityHint, '', 'No admin controls are exposed from this panel.',
    ].join('\n'), memberDisplayName, DEV_COLOR)],
    components: [navigationRow({ backId })],
  };
}

function buildModulePanel(moduleKey, interactionOrName = 'Unknown User') {
  if (moduleKey === 'giveaways') return buildGiveawaysMemoPanel(interactionOrName);
  return buildPlannedModulePanel(moduleKey, interactionOrName);
}

module.exports = {
  CATEGORY_CATALOG,
  MODULE_CATALOG,
  buildMainPanel,
  buildCategoryPanel,
  buildModulePanel,
  buildProfilePanel,
  buildAccountRecordPanel,
  buildInProgressPanel,
  buildHelpPanel,
  buildProgressPanel,
  buildLevelingUserPanel,
  buildLevelingHistoryPanel,
  buildRolesPanel,
  buildSocialAccessDeniedPanel,
};
