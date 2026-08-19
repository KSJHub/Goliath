const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const guildManager = require('../../guild/guildManager');
const leveling = require('../../../modules/communityStudio/leveling/leveling');
const levelingTracking = require('../../../modules/communityStudio/leveling/levelingTracking');
const invites = require('../../../modules/communityStudio/invites/invites');
const socialStudio = require('../../../modules/socialStudio/socialAlerts/socialStudio');
const { normalizeAccountInput, migrateAccount } = require('../../../modules/socialStudio/socialAlerts/accountNormalizer');
const { checkGuildAccounts, forcePostCreatorLive } = require('../../../modules/socialStudio/socialAlerts/socialStudioMonitor');
const notesUserPanel = require('../../../modules/utilityStudio/notes/notesUserPanel');
const pingCommand = require('../../../commands/utility/ping');
const helpCommand = require('../../../commands/utility/help');
const serverInfoCommand = require('../../../commands/utility/serverinfo');
const translateCommand = require('../../../commands/utility/translate');
const profileDevelopmentPage = require('./profileDevelopmentPage');
const {
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
} = require('./userPanel');

const USER_MANUAL_LIVE_COOLDOWN_MS = 60 * 60 * 1000;
const userAccountManagementSessions = new Map();

function getMemberDisplayName(interaction) {
  return interaction.member?.displayName || interaction.user?.displayName || interaction.user?.username || 'Unknown User';
}

function getUserPanelSettings(guildId) {
  const section = guildManager.getGuildSection(guildId, 'userPanel', {});
  const profile = section?.profile && typeof section.profile === 'object' ? section.profile : {};
  return {
    profile: {
      rolesEnabled: profile.rolesEnabled !== false,
      showHighestRole: profile.showHighestRole !== false,
      showRoleCount: profile.showRoleCount !== false,
      showRoleList: profile.showRoleList !== false,
      showProgressSummary: profile.showProgressSummary !== false,
    },
  };
}

function countUserGiveawayActivity(guildId, userId) {
  const section = guildManager.getGuildSection(guildId, 'giveaways', {});
  const source = section.giveaways || section.items || section.records || {};
  const records = Array.isArray(source) ? source : Object.values(source && typeof source === 'object' ? source : {});
  let entries = 0;
  let wins = 0;

  for (const giveaway of records) {
    const entrants = giveaway?.entrantIds || giveaway?.entries || giveaway?.participants || giveaway?.userIds || [];
    const winners = giveaway?.winnerIds || giveaway?.winners || [];
    const entrantIds = Array.isArray(entrants)
      ? entrants.map((entry) => String(entry?.userId || entry?.id || entry))
      : Object.keys(entrants && typeof entrants === 'object' ? entrants : {});
    const winnerIds = Array.isArray(winners)
      ? winners.map((entry) => String(entry?.userId || entry?.id || entry))
      : Object.keys(winners && typeof winners === 'object' ? winners : {});
    if (entrantIds.includes(String(userId))) entries += 1;
    if (winnerIds.includes(String(userId))) wins += 1;
  }

  return { entries, wins };
}

function buildLiveProfile(interaction) {
  const section = leveling.getSection(interaction.guildId);
  const user = section.users?.[interaction.user.id] || null;
  const leaderboard = Object.values(section.users || {}).sort((a, b) => Number(b.xp || 0) - Number(a.xp || 0));
  const rankIndex = leaderboard.findIndex((entry) => entry.userId === interaction.user.id || entry.id === interaction.user.id);
  const inviteSection = invites.getSection(interaction.guildId);
  const inviteStats = inviteSection.inviters?.[interaction.user.id] || {};
  const giveawayStats = countUserGiveawayActivity(interaction.guildId, interaction.user.id);

  return {
    leveling: user ? {
      level: Math.max(0, Number(user.level || 0)),
      xp: Math.max(0, Number(user.xp || 0)),
      rank: rankIndex >= 0 ? rankIndex + 1 : null,
      messages: Math.max(0, Number(user.messages || 0)),
      voiceMinutes: Math.max(0, Number(user.voiceMinutes || 0)),
      currentLevelXp: leveling.xpForLevel(Math.max(0, Number(user.level || 0))),
      nextLevelXp: leveling.xpForLevel(Math.max(0, Number(user.level || 0)) + 1),
    } : null,
    invites: Math.max(0, Number(inviteStats.total || 0)),
    giveawayEntries: giveawayStats.entries,
    giveawayWins: giveawayStats.wins,
  };
}

function buildUserHomePanel(interaction) {
  const settings = getUserPanelSettings(interaction.guildId);
  const payload = buildProfilePanel(interaction, buildLiveProfile(interaction), settings.profile);
  return profileDevelopmentPage.sortNonNavigationButtons(payload);
}

async function updatePanel(interaction, payload) {
  const sortedPayload = profileDevelopmentPage.sortNonNavigationButtons(payload);
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(sortedPayload);
    return true;
  }
  await interaction.update(sortedPayload);
  return true;
}

async function executeUtilityCommand(interaction, command) {
  await command.execute(interaction);
  return true;
}

async function showProfile(interaction) {
  return updatePanel(interaction, buildUserHomePanel(interaction));
}

async function showProgress(interaction) {
  const profile = buildLiveProfile(interaction);
  if (!profile.leveling) return showProfile(interaction);
  return updatePanel(interaction, buildProgressPanel(interaction, profile.leveling));
}

async function showLeveling(interaction) {
  const section = leveling.getSection(interaction.guildId);
  const participating = leveling.isUserParticipating(interaction.guildId, interaction.user.id);
  const user = leveling.getUser(interaction.guildId, interaction.user.id);
  const leaderboard = leveling.getLeaderboard(interaction.guildId, 100);
  const rankIndex = leaderboard.findIndex((entry) => String(entry.userId || entry.id) === String(interaction.user.id));
  const rank = participating && rankIndex >= 0 ? rankIndex + 1 : null;
  const activeMultiplier = leveling.getActiveMultiplier(interaction.guildId);
  return updatePanel(interaction, buildLevelingUserPanel(
    interaction,
    section,
    user,
    rank,
    participating,
    activeMultiplier,
  ));
}

async function showLevelingHistory(interaction) {
  const user = leveling.getUser(interaction.guildId, interaction.user.id)
    || leveling.normalizeUser({ userId: interaction.user.id });
  return updatePanel(interaction, buildLevelingHistoryPanel(interaction, user));
}

async function toggleLevelingParticipation(interaction) {
  const current = leveling.isUserParticipating(interaction.guildId, interaction.user.id);
  leveling.setUserParticipation(interaction.guildId, interaction.user.id, !current, {
    actorId: interaction.user.id,
    action: 'user_leveling_toggle',
  });
  try { levelingTracking.refreshGuildVoiceSessions(interaction.guild); } catch {}
  return showLeveling(interaction);
}

async function showLevelingLeaderboard(interaction, sortBy = 'xp', pageIndex = 0) {
  const allowedSorts = new Set(['xp', 'level', 'messages', 'voice']);
  const safeSort = allowedSorts.has(sortBy) ? sortBy : 'xp';
  const records = leveling.getLeaderboard(interaction.guildId, 500, { includePaused: false, sortBy: safeSort });
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(records.length / pageSize));
  const safePage = Math.min(Math.max(0, Number(pageIndex) || 0), totalPages - 1);
  const start = safePage * pageSize;
  const page = records.slice(start, start + pageSize);
  const userIndex = records.findIndex((entry) => String(entry.userId || entry.id) === String(interaction.user.id));
  const label = safeSort === 'voice' ? 'Voice Minutes' : safeSort === 'messages' ? 'Messages' : safeSort === 'level' ? 'Level' : 'XP';
  const valueFor = (user) => safeSort === 'voice'
    ? Number(user.voiceMinutes || 0).toLocaleString()
    : safeSort === 'messages'
      ? Number(user.messages || 0).toLocaleString()
      : safeSort === 'level'
        ? Number(user.level || 0).toLocaleString()
        : Number(user.xp || 0).toLocaleString();
  const lines = page.length
    ? page.map((user, index) => {
      const rank = start + index + 1;
      const me = String(user.userId) === String(interaction.user.id) ? ' ← **You**' : '';
      return `**#${rank}** <@${user.userId}> — ${label}: **${valueFor(user)}** · Lv **${Number(user.level || 0)}**${me}`;
    })
    : ['No active leveling participants yet.'];

  const components = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`user:leveling:leaderboard:xp:0`).setLabel('XP').setStyle(safeSort === 'xp' ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`user:leveling:leaderboard:level:0`).setLabel('Level').setStyle(safeSort === 'level' ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`user:leveling:leaderboard:messages:0`).setLabel('Messages').setStyle(safeSort === 'messages' ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`user:leveling:leaderboard:voice:0`).setLabel('Voice').setStyle(safeSort === 'voice' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`user:leveling:leaderboard:${safeSort}:${Math.max(0, safePage - 1)}`).setLabel('Previous').setEmoji('⬅️').setStyle(ButtonStyle.Secondary).setDisabled(safePage === 0),
      new ButtonBuilder().setCustomId(`user:leveling:leaderboard:${safeSort}:${Math.min(totalPages - 1, safePage + 1)}`).setLabel('Next').setEmoji('➡️').setStyle(ButtonStyle.Primary).setDisabled(safePage >= totalPages - 1),
      new ButtonBuilder().setCustomId('user:module:leveling').setLabel('Back').setEmoji('⬅️').setStyle(ButtonStyle.Secondary),
    ),
  ];

  const position = userIndex >= 0
    ? `Your position: **#${userIndex + 1}** of **${records.length}** active participants.`
    : 'You are not currently ranked because Leveling is paused or you have not earned XP yet.';

  return updatePanel(interaction, {
    embeds: [new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🏆 Server Leveling Leaderboard')
      .setDescription([
        `Sorted by **${label}**`,
        position,
        '',
        ...lines,
        '',
        `Page **${safePage + 1} / ${totalPages}**`,
      ].join('\n'))
      .setFooter({ text: 'Active leveling participants only' })
      .setTimestamp()],
    components,
  });
}

function modalRow(component) {
  return new ActionRowBuilder().addComponents(component);
}

function buildUserManageProfileModal(creator) {
  return new ModalBuilder()
    .setCustomId('user:social:manage-profile:submit')
    .setTitle('Manage Creator Profile')
    .addComponents(
      modalRow(new TextInputBuilder().setCustomId('displayName').setLabel('Creator display name').setPlaceholder('Enter the public creator name here').setStyle(TextInputStyle.Short).setMaxLength(120).setRequired(true).setValue(String(creator?.displayName || '').slice(0, 120))),
      modalRow(new TextInputBuilder().setCustomId('group').setLabel('Group or team').setPlaceholder('Add your team, brand or category here').setStyle(TextInputStyle.Short).setMaxLength(120).setRequired(false).setValue(String(creator?.group || '').slice(0, 120))),
      modalRow(new TextInputBuilder().setCustomId('tags').setLabel('Tags (comma separated)').setPlaceholder('Example: streamer, ksj, twitch').setStyle(TextInputStyle.Short).setMaxLength(300).setRequired(false).setValue(Array.isArray(creator?.tags) ? creator.tags.join(', ').slice(0, 300) : '')),
      modalRow(new TextInputBuilder().setCustomId('notes').setLabel('Notes').setPlaceholder('Anything you want staff to know about your creator profile').setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(false).setValue(String(creator?.notes || '').slice(0, 1000))),
    );
}

async function handleUserManageProfile(interaction) {
  const access = socialStudio.getAccess(interaction);
  if (!access.allowed) {
    await interaction.reply({ content: 'You do not currently have access to Social Studio.', flags: 64 });
    return true;
  }
  const creator = socialStudio.findByOwnerDiscordId(interaction.guildId, interaction.user.id);
  if (!creator || String(creator.ownerDiscordId) !== String(interaction.user.id)) {
    await interaction.reply({ content: 'Your Creator Profile could not be verified.', flags: 64 });
    return true;
  }
  await interaction.showModal(buildUserManageProfileModal(creator));
  return true;
}

async function handleUserManageProfileSubmit(interaction) {
  const access = socialStudio.getAccess(interaction);
  if (!access.allowed) {
    await interaction.reply({ content: 'You no longer have access to Social Studio.', flags: 64 });
    return true;
  }
  const current = socialStudio.findByOwnerDiscordId(interaction.guildId, interaction.user.id);
  if (!current || String(current.ownerDiscordId) !== String(interaction.user.id)) {
    await interaction.reply({ content: 'Your Creator Profile could not be verified.', flags: 64 });
    return true;
  }
  const displayName = interaction.fields.getTextInputValue('displayName').trim();
  if (!displayName) {
    await interaction.reply({ content: 'Creator display name is required.', flags: 64 });
    return true;
  }
  const result = socialStudio.completeCreatorProfile(interaction.member, {
    displayName,
    group: interaction.fields.getTextInputValue('group'),
    tags: interaction.fields.getTextInputValue('tags'),
    notes: interaction.fields.getTextInputValue('notes'),
  });
  if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();
  await interaction.followUp({ content: '✅ Creator profile updated.', flags: 64 }).catch(() => null);
  return updatePanel(interaction, socialStudio.user.buildProfile(interaction, result.creator, socialStudio.getAccountsForCreator(interaction.guildId, result.creator)));
}

function accountSessionKey(interaction) {
  return `${interaction.guildId}:${interaction.user.id}`;
}

function setManagedAccount(interaction, accountId = null) {
  userAccountManagementSessions.set(accountSessionKey(interaction), accountId ? String(accountId) : null);
}

function getManagedAccountId(interaction) {
  return userAccountManagementSessions.get(accountSessionKey(interaction)) || null;
}

function getOwnedCreatorAndAccounts(interaction) {
  const access = socialStudio.getAccess(interaction);
  if (!access.allowed) return { error: 'You do not currently have access to Social Studio.' };
  const creator = socialStudio.findByOwnerDiscordId(interaction.guildId, interaction.user.id);
  if (!creator || String(creator.ownerDiscordId) !== String(interaction.user.id)) {
    return { error: 'Your Creator Profile could not be verified.' };
  }
  return { creator, accounts: socialStudio.getAccountsForCreator(interaction.guildId, creator) };
}

function userAccountButton(customId, label, style = ButtonStyle.Secondary, disabled = false) {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style).setDisabled(disabled);
}

function accountDisplayName(account) {
  const platform = String(account?.platform || 'Account');
  const label = platform.charAt(0).toUpperCase() + platform.slice(1);
  return `${label} · ${account?.username || account?.externalId || 'Resolving'}`;
}

function buildUserManageAccountPanel(interaction, creator, accounts, selectedId = null) {
  const selected = accounts.find((account) => String(account.accountId) === String(selectedId)) || null;
  const components = [];
  if (accounts.length) {
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('user:social:manage-account:select')
        .setPlaceholder('Select an account to manage')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(accounts.slice(0, 25).map((account) => ({
          label: accountDisplayName(account).slice(0, 100),
          value: String(account.accountId),
          description: String(account.profileUrl || account.externalId || 'Linked social account').slice(0, 100),
          default: selected?.accountId === account.accountId,
        }))),
    ));
  }
  if (selected) {
    components.push(new ActionRowBuilder().addComponents(
      userAccountButton('user:social:manage-account:edit', '✏️ Edit Account', ButtonStyle.Primary),
      userAccountButton('user:social:manage-account:toggle', selected.enabled === false ? '▶️ Resume Account' : '⏸️ Pause Account', selected.enabled === false ? ButtonStyle.Success : ButtonStyle.Secondary),
      userAccountButton('user:social:manage-account:check', '🔍 Check Account', ButtonStyle.Secondary),
      userAccountButton('user:social:manage-account:delete', '🗑️ Delete Account', ButtonStyle.Danger),
    ));
  }
  components.push(new ActionRowBuilder().addComponents(
    userAccountButton('user:social:open', '⬅️ Back', ButtonStyle.Secondary),
  ));

  const description = selected
    ? [
      `**Creator Profile**\n${creator.displayName || creator.creatorId}`,
      `**Platform**\n${String(selected.platform || 'Unknown')}`,
      `**Username / ID**\n${selected.username || selected.externalId || 'Not resolved'}`,
      `**Profile URL**\n${selected.profileUrl || 'Not available'}`,
      `**Monitoring**\n${selected.enabled === false ? 'Paused' : 'Enabled'}`,
      `**Provider Status**\n${selected.state?.status || selected.state?.providerStatus || 'Not checked'}`,
      `**Last Checked**\n${selected.state?.lastCheckedAt ? `<t:${Math.floor(new Date(selected.state.lastCheckedAt).getTime() / 1000)}:R>` : 'Never'}`,
      '',
      'Use the controls below to manage this linked account.',
    ].join('\n\n')
    : accounts.length
      ? 'Select one of your linked social accounts to manage it.'
      : 'No social accounts are connected to your Creator Profile.';

  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🛠️ Manage Account').setDescription(description).setFooter({ text: `Requested by ${getMemberDisplayName(interaction)}` }).setTimestamp()],
    components,
  };
}

function getSelectedOwnedAccount(interaction) {
  const context = getOwnedCreatorAndAccounts(interaction);
  if (context.error) return context;
  const accountId = getManagedAccountId(interaction);
  const account = context.accounts.find((entry) => String(entry.accountId) === String(accountId));
  if (!account) return { ...context, error: 'Select one of your linked accounts first.' };
  return { ...context, account };
}

function saveUserSocialSection(interaction, section) {
  guildManager.saveGuildSection(interaction.guildId, 'social', section, { guildId: interaction.guildId, actorId: interaction.user.id });
}

function buildUserAccountEditModal(account) {
  return new ModalBuilder()
    .setCustomId('user:social:manage-account:edit:submit')
    .setTitle('Edit Social Account')
    .addComponents(modalRow(new TextInputBuilder()
      .setCustomId('accountValue')
      .setLabel(`${String(account.platform || 'Account')} username, ID or URL`.slice(0, 45))
      .setPlaceholder('Enter the profile URL, username or channel ID')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(500)
      .setRequired(true)
      .setValue(String(account.profileUrl || account.username || account.externalId || '').slice(0, 500))));
}

async function handleUserManageAccountOpen(interaction) {
  const context = getOwnedCreatorAndAccounts(interaction);
  if (context.error) {
    await interaction.reply({ content: context.error, flags: 64 });
    return true;
  }
  const selectedId = context.accounts.some((account) => account.accountId === getManagedAccountId(interaction)) ? getManagedAccountId(interaction) : null;
  setManagedAccount(interaction, selectedId);
  return updatePanel(interaction, buildUserManageAccountPanel(interaction, context.creator, context.accounts, selectedId));
}

async function handleUserManageAccountSelect(interaction) {
  const context = getOwnedCreatorAndAccounts(interaction);
  if (context.error) return updatePanel(interaction, socialStudio.user.buildDenied(interaction));
  const accountId = String(interaction.values?.[0] || '');
  if (!context.accounts.some((account) => String(account.accountId) === accountId)) {
    await interaction.reply({ content: 'That account does not belong to your Creator Profile.', flags: 64 });
    return true;
  }
  setManagedAccount(interaction, accountId);
  return updatePanel(interaction, buildUserManageAccountPanel(interaction, context.creator, context.accounts, accountId));
}

async function handleUserManageAccountEdit(interaction) {
  const context = getSelectedOwnedAccount(interaction);
  if (context.error) {
    await interaction.reply({ content: context.error, flags: 64 });
    return true;
  }
  await interaction.showModal(buildUserAccountEditModal(context.account));
  return true;
}

async function handleUserManageAccountEditSubmit(interaction) {
  const context = getSelectedOwnedAccount(interaction);
  if (context.error) {
    await interaction.reply({ content: context.error, flags: 64 });
    return true;
  }
  const rawValue = interaction.fields.getTextInputValue('accountValue').trim();
  const normalized = normalizeAccountInput(context.account.platform, rawValue);
  const section = guildManager.getGuildSection(interaction.guildId, 'social', {});
  const current = migrateAccount(section.accounts?.[context.account.accountId] || context.account);
  section.accounts = section.accounts && typeof section.accounts === 'object' ? section.accounts : {};
  section.accounts[context.account.accountId] = {
    ...current,
    username: normalized.username,
    normalizedUsername: normalized.normalizedUsername,
    externalId: normalized.externalId || current.externalId || null,
    inputType: normalized.inputType,
    canonicalIdentity: normalized.canonicalIdentity,
    profileUrl: normalized.profileUrl,
    sourceInput: normalized.sourceInput,
    updatedAt: new Date().toISOString(),
  };
  saveUserSocialSection(interaction, section);
  if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();
  await interaction.followUp({ content: '✅ Social account updated.', flags: 64 }).catch(() => null);
  const refreshed = getOwnedCreatorAndAccounts(interaction);
  return updatePanel(interaction, buildUserManageAccountPanel(interaction, refreshed.creator, refreshed.accounts, context.account.accountId));
}

async function handleUserManageAccountToggle(interaction) {
  const context = getSelectedOwnedAccount(interaction);
  if (context.error) {
    await interaction.reply({ content: context.error, flags: 64 });
    return true;
  }
  const section = guildManager.getGuildSection(interaction.guildId, 'social', {});
  const account = section.accounts?.[context.account.accountId];
  if (!account) throw new Error('The selected account no longer exists.');
  account.enabled = account.enabled === false;
  account.updatedAt = new Date().toISOString();
  saveUserSocialSection(interaction, section);
  const refreshed = getOwnedCreatorAndAccounts(interaction);
  return updatePanel(interaction, buildUserManageAccountPanel(interaction, refreshed.creator, refreshed.accounts, account.accountId));
}

async function handleUserManageAccountCheck(interaction) {
  const context = getSelectedOwnedAccount(interaction);
  if (context.error) {
    await interaction.reply({ content: context.error, flags: 64 });
    return true;
  }
  if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();
  const result = await checkGuildAccounts(interaction.client, interaction.guildId);
  await interaction.followUp({ content: `🔍 Provider check complete. ${Number(result?.checked || 0)} account(s) checked.`, flags: 64 }).catch(() => null);
  const refreshed = getOwnedCreatorAndAccounts(interaction);
  return updatePanel(interaction, buildUserManageAccountPanel(interaction, refreshed.creator, refreshed.accounts, context.account.accountId));
}

async function handleUserManageAccountDelete(interaction) {
  const context = getSelectedOwnedAccount(interaction);
  if (context.error) {
    await interaction.reply({ content: context.error, flags: 64 });
    return true;
  }
  return updatePanel(interaction, {
    embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('⚠️ Delete Social Account').setDescription(`Delete **${accountDisplayName(context.account)}** from your Creator Profile?\n\nThis removes its monitoring and notification settings.`).setFooter({ text: `Requested by ${getMemberDisplayName(interaction)}` }).setTimestamp()],
    components: [new ActionRowBuilder().addComponents(
      userAccountButton('user:social:manage-account:delete:cancel', '⬅️ Cancel', ButtonStyle.Secondary),
      userAccountButton('user:social:manage-account:delete:confirm', '🗑️ Delete Account', ButtonStyle.Danger),
    )],
  });
}

async function handleUserManageAccountDeleteConfirm(interaction) {
  const context = getSelectedOwnedAccount(interaction);
  if (context.error) {
    await interaction.reply({ content: context.error, flags: 64 });
    return true;
  }
  const section = guildManager.getGuildSection(interaction.guildId, 'social', {});
  const creator = section.creators?.[context.creator.creatorId];
  if (!creator || String(creator.ownerDiscordId) !== String(interaction.user.id)) {
    await interaction.reply({ content: 'Your Creator Profile could not be verified.', flags: 64 });
    return true;
  }
  creator.accountIds = (creator.accountIds || []).filter((id) => String(id) !== String(context.account.accountId));
  creator.updatedAt = new Date().toISOString();
  if (section.accounts) delete section.accounts[context.account.accountId];
  saveUserSocialSection(interaction, section);
  setManagedAccount(interaction, null);
  await interaction.followUp({ content: '🗑️ Social account deleted.', flags: 64 }).catch(() => null);
  const refreshed = getOwnedCreatorAndAccounts(interaction);
  return updatePanel(interaction, buildUserManageAccountPanel(interaction, refreshed.creator, refreshed.accounts, null));
}

function getUserManualLiveState(guildId, creator, accounts = []) {
  if (!creator) return { canPost: false, reason: 'Your Creator Profile could not be found.' };
  const linked = Array.isArray(accounts) ? accounts : [];
  const liveAccounts = linked.filter((account) => account?.enabled !== false && account?.state?.isLive === true && account?.state?.lastLiveEvent && account?.state?.lastCheckedAt);
  if (!liveAccounts.length) return { canPost: false, reason: 'No checked LIVE account is currently available.' };
  const social = guildManager.getGuildSection(guildId, 'social', {});
  const history = Array.isArray(social?.history) ? social.history : [];
  const accountIds = new Set(linked.map((account) => String(account.accountId)));
  const cutoff = Date.now() - USER_MANUAL_LIVE_COOLDOWN_MS;
  const recentAccountPost = linked.find((account) => {
    if (!String(account?.state?.lastAlertKey || '').startsWith('live:')) return false;
    const sentAt = new Date(account?.state?.lastAlertAt || '').getTime();
    return Number.isFinite(sentAt) && sentAt >= cutoff;
  });
  const recentHistoryPost = [...history].reverse().find((entry) => {
    if (entry?.status !== 'alert_sent' || entry?.alertType !== 'live') return false;
    const sentAt = new Date(entry.createdAt || entry.sentAt || '').getTime();
    if (!Number.isFinite(sentAt) || sentAt < cutoff) return false;
    return String(entry.creatorId || '') === String(creator.creatorId) || accountIds.has(String(entry.accountId || ''));
  });
  const recentPost = recentAccountPost || recentHistoryPost;
  if (!recentPost) return { canPost: true, reason: `${liveAccounts.length} LIVE account${liveAccounts.length === 1 ? '' : 's'} ready.` };
  const timestamp = recentAccountPost?.state?.lastAlertAt || recentHistoryPost?.createdAt || recentHistoryPost?.sentAt;
  const sentAt = new Date(timestamp || '').getTime();
  const availableAt = Number.isFinite(sentAt) ? Math.floor((sentAt + USER_MANUAL_LIVE_COOLDOWN_MS) / 1000) : null;
  return { canPost: false, reason: availableAt ? `A LIVE notification was posted within the last hour. Manual posting is available <t:${availableAt}:R>.` : 'A LIVE notification was posted within the last hour.' };
}

async function handleUserManualPostLive(interaction) {
  const access = socialStudio.getAccess(interaction);
  if (!access.allowed) {
    await interaction.reply({ content: 'You do not currently have access to Social Studio.', flags: 64 });
    return true;
  }
  const creator = socialStudio.findByOwnerDiscordId(interaction.guildId, interaction.user.id);
  if (!creator || String(creator.ownerDiscordId) !== String(interaction.user.id)) {
    await interaction.reply({ content: 'Your Creator Profile could not be verified.', flags: 64 });
    return true;
  }
  const accounts = socialStudio.getAccountsForCreator(interaction.guildId, creator);
  const state = getUserManualLiveState(interaction.guildId, creator, accounts);
  if (!state.canPost) {
    await interaction.reply({ content: `📣 Manual Post LIVE is unavailable. ${state.reason}`, flags: 64 });
    return true;
  }
  if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();
  const result = await forcePostCreatorLive(interaction.client, interaction.guildId, creator.creatorId, { actorId: interaction.user.id, guild: interaction.guild, bypassCooldown: true });
  const sent = Array.isArray(result?.sent) ? result.sent : [];
  const failed = Array.isArray(result?.failed) ? result.failed : [];
  const channels = [...new Set(sent.map((item) => item.channelId).filter(Boolean))];
  const channelText = channels.length === 1 ? ` in <#${channels[0]}>` : channels.length > 1 ? ` across ${channels.length} channels` : '';
  const failedText = failed.length ? ` ${failed.length} failed.` : '';
  await interaction.followUp({ content: `📣 Sent ${sent.length} LIVE post${sent.length === 1 ? '' : 's'}${channelText}.${failedText}`, flags: 64 }).catch(() => null);
  return updatePanel(interaction, socialStudio.user.buildProfile(interaction, creator, socialStudio.getAccountsForCreator(interaction.guildId, creator)));
}

async function delegateModuleUserInteraction(interaction) {
  if (await socialStudio.user.handleInteraction(interaction, updatePanel)) return true;
  if (await notesUserPanel.user.handleInteraction(interaction, updatePanel)) return true;
  return false;
}

async function handleUserPanelInteraction(interaction) {
  const customId = String(interaction?.customId || '');
  if (!customId.startsWith('user:')) return false;
  if (!interaction.guild) {
    await interaction.reply({ content: 'This panel can only be used inside a server.', flags: 64 });
    return true;
  }

  if (customId === 'user:social:details' && interaction.isButton?.()) return handleUserManageProfile(interaction);
  if (customId === 'user:social:manage-profile:submit' && interaction.isModalSubmit?.()) return handleUserManageProfileSubmit(interaction);
  if (customId === 'user:social:manageAccount' && interaction.isButton?.()) return handleUserManageAccountOpen(interaction);
  if (customId === 'user:social:manage-account:select' && interaction.isStringSelectMenu?.()) return handleUserManageAccountSelect(interaction);
  if (customId === 'user:social:manage-account:edit' && interaction.isButton?.()) return handleUserManageAccountEdit(interaction);
  if (customId === 'user:social:manage-account:edit:submit' && interaction.isModalSubmit?.()) return handleUserManageAccountEditSubmit(interaction);
  if (customId === 'user:social:manage-account:toggle' && interaction.isButton?.()) return handleUserManageAccountToggle(interaction);
  if (customId === 'user:social:manage-account:check' && interaction.isButton?.()) return handleUserManageAccountCheck(interaction);
  if (customId === 'user:social:manage-account:delete' && interaction.isButton?.()) return handleUserManageAccountDelete(interaction);
  if (customId === 'user:social:manage-account:delete:cancel' && interaction.isButton?.()) return handleUserManageAccountOpen(interaction);
  if (customId === 'user:social:manage-account:delete:confirm' && interaction.isButton?.()) return handleUserManageAccountDeleteConfirm(interaction);
  if (customId === 'user:social:alerts' && interaction.isButton?.()) return handleUserManualPostLive(interaction);

  if (await delegateModuleUserInteraction(interaction)) return true;

  const memberDisplayName = getMemberDisplayName(interaction);
  if (customId === 'user:close' && interaction.isButton?.()) {
    if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();
    await interaction.deleteReply().catch(() => null);
    return true;
  }
  if (customId === 'user:home') return showProfile(interaction);
  if (customId === 'user:account:record' && interaction.isButton?.()) return updatePanel(interaction, buildAccountRecordPanel(memberDisplayName));
  if (customId === 'user:help' && interaction.isButton?.()) return updatePanel(interaction, buildHelpPanel(memberDisplayName));
  if (customId === 'user:preferences' && interaction.isButton?.()) return updatePanel(interaction, profileDevelopmentPage.buildPreferencesDevelopmentPanel(interaction));
  const inProgressMatch = customId.match(/^user:in-progress:(\d+)$/);
  if (inProgressMatch && interaction.isButton?.()) return updatePanel(interaction, buildInProgressPanel(memberDisplayName, Number(inProgressMatch[1])));
  if (customId === 'user:profile:refresh' || customId === 'user:module:profile') return showProfile(interaction);
  if (customId === 'user:profile:roles' && interaction.isButton?.()) {
    const settings = getUserPanelSettings(interaction.guildId).profile;
    if (!settings.rolesEnabled) return showProfile(interaction);
    return updatePanel(interaction, buildRolesPanel(interaction, settings));
  }
  if (customId === 'user:profile:progress' && interaction.isButton?.()) return showProgress(interaction);
  if (customId === 'user:leveling:history' && interaction.isButton?.()) return showLevelingHistory(interaction);
  if (customId === 'user:leveling:toggle' && interaction.isButton?.()) return toggleLevelingParticipation(interaction);
  const levelingLeaderboardMatch = customId.match(/^user:leveling:leaderboard:(xp|level|messages|voice):(\d+)$/);
  if (levelingLeaderboardMatch && interaction.isButton?.()) {
    return showLevelingLeaderboard(interaction, levelingLeaderboardMatch[1], Number(levelingLeaderboardMatch[2]));
  }
  if (interaction.isStringSelectMenu?.() && customId === 'user:search') {
    const [moduleKey] = interaction.values || [];
    if (moduleKey === 'notes') return updatePanel(interaction, notesUserPanel.user.buildPanel(interaction));
    if (moduleKey === 'social') return updatePanel(interaction, socialStudio.user.buildLanding(interaction));
    if (moduleKey === 'leveling') return showLeveling(interaction);
    if (moduleKey === 'ping') return executeUtilityCommand(interaction, pingCommand);
    if (moduleKey === 'help') return executeUtilityCommand(interaction, helpCommand);
    if (moduleKey === 'serverinfo') return executeUtilityCommand(interaction, serverInfoCommand);
    if (moduleKey === 'translate') return executeUtilityCommand(interaction, translateCommand);
    return updatePanel(interaction, buildModulePanel(moduleKey, memberDisplayName));
  }
  const categoryMatch = customId.match(/^user:category:([a-zA-Z0-9_-]+)$/);
  if (categoryMatch && interaction.isButton?.()) return updatePanel(interaction, buildCategoryPanel(categoryMatch[1], memberDisplayName));
  const moduleMatch = customId.match(/^user:module:([a-zA-Z0-9_-]+)$/);
  if (moduleMatch && interaction.isButton?.()) {
    const moduleKey = moduleMatch[1];
    if (moduleKey === 'profile') return showProfile(interaction);
    if (moduleKey === 'leveling') return showLeveling(interaction);
    if (moduleKey === 'ping') return executeUtilityCommand(interaction, pingCommand);
    if (moduleKey === 'help') return executeUtilityCommand(interaction, helpCommand);
    if (moduleKey === 'serverinfo') return executeUtilityCommand(interaction, serverInfoCommand);
    if (moduleKey === 'translate') return executeUtilityCommand(interaction, translateCommand);
    const placeholders = {
      'role-history': ['📜 Role History — Development', 'Role history access will be designed and connected in a later stage.'],
      'security-notifications': ['🔔 Security Notifications — Development', 'Member security notifications will be designed and connected in a later stage.'],
      verification: ['✅ Verification — Development', 'Member verification status will be designed and connected in a later stage.'],
    };
    if (placeholders[moduleKey]) return updatePanel(interaction, profileDevelopmentPage.buildSimpleDevelopmentPanel(interaction, placeholders[moduleKey][0], placeholders[moduleKey][1]));
    return updatePanel(interaction, buildModulePanel(moduleKey, memberDisplayName));
  }
  return false;
}

module.exports = {
  handleUserPanelInteraction,
  canUseUserSocialStudio: (interaction) => socialStudio.user.canAccess(interaction),
  buildUserHomePanel,
};
