'use strict';

const { PermissionFlagsBits } = require('discord.js');
const crypto = require('node:crypto');
const security = require('../../../core/security/securityCore');
const { normalizeAccountInput, migrateAccount } = require('./accountNormalizer');
const { providerInfo } = require('./socialStudioProviders');
const store = require('./socialStudioStore');
const adminPanel = require('./socialStudioPanel');

const PLATFORMS = ['twitch', 'youtube', 'tiktok', 'kick', 'facebook', 'instagram', 'x'];
const ALERT_TYPES = ['live', 'ended', 'vod', 'clip', 'upload', 'short', 'post'];
const LABEL = { twitch: 'Twitch', youtube: 'YouTube', tiktok: 'TikTok', kick: 'Kick', facebook: 'Facebook', instagram: 'Instagram', x: 'X' };
const userAccountSessions = new Map();

function clean(value, max = 2000) {
  return String(value || '').trim().slice(0, max);
}

const getSection = store.getSection;
const getConfiguredRoleIds = store.getUserRoleIds;

function getAccess(interaction) {
  const roleIds = getConfiguredRoleIds(interaction.guildId);
  const override = Boolean(
    security.isBotOwner?.(interaction.user?.id)
    || interaction.guild?.ownerId === interaction.user?.id
    || interaction.member?.permissions?.has?.(PermissionFlagsBits.Administrator),
  );
  const allowed = override
    || !roleIds.length
    || roleIds.some((id) => interaction.member?.roles?.cache?.has?.(id));
  return { allowed, roleIds, override };
}

function findByOwnerDiscordId(guildId, ownerDiscordId) {
  return store.findCreatorByOwner(guildId, clean(ownerDiscordId, 25));
}

function getAccountsForCreator(guildId, creator) {
  return store.getCreatorAccounts(guildId, creator);
}

function completeCreatorProfile(member, values) {
  return store.completeCreatorProfile(member, values, { actorId: member.user.id });
}

const userCreatorModal =
  adminPanel.user.buildCreatorModal;

function userAccountSessionKey(interaction) {
  return `${interaction.guildId}:${interaction.user?.id || 'unknown'}`;
}

function getUserAccountSession(interaction) {
  return userAccountSessions.get(userAccountSessionKey(interaction)) || { platforms: [] };
}

function setUserAccountSession(interaction, patch) {
  const next = { ...getUserAccountSession(interaction), ...patch };
  userAccountSessions.set(userAccountSessionKey(interaction), next);
  return next;
}

function supportedAlerts(platform) {
  const supported = (providerInfo(platform).supportedAlertTypes || []).filter((type) => ALERT_TYPES.includes(type));
  if (supported.includes('live') && !supported.includes('ended')) supported.splice(1, 0, 'ended');
  return supported;
}

const userAccountModal =
  adminPanel.user.buildAccountModal;

const buildUserAddAccounts = (
  interaction,
  creator,
) => adminPanel.user.buildAddAccounts(
  interaction,
  creator,
  getUserAccountSession(interaction).platforms || [],
);

function canonicalIdentity(account) {
  return String(account.canonicalIdentity || account.externalId || account.normalizedUsername || account.username || '').toLowerCase();
}

function canonicalKey(account) {
  return `${String(account.platform || '').toLowerCase()}:${canonicalIdentity(account)}`;
}

function upsertUserAccount(guildId, creator, platform, rawValue, actorId) {
  const section = getSection(guildId);
  const normalized = normalizeAccountInput(platform, rawValue);
  const key = `${platform}:${String(normalized.canonicalIdentity || normalized.externalId || normalized.normalizedUsername || normalized.username || '').toLowerCase()}`;
  const matches = Object.values(section.accounts || {}).filter((account) => {
    try { return canonicalKey(migrateAccount(account)) === key; } catch { return false; }
  });
  const primary = matches[0] || null;
  const accountId = primary?.accountId || `account_${crypto.randomBytes(8).toString('hex')}`;
  const duplicateAccountIds = matches.slice(1).map((account) => account.accountId);
  const account = {
    ...(primary || {}),
    accountId,
    platform,
    username: normalized.username,
    normalizedUsername: normalized.normalizedUsername,
    externalId: primary?.externalId || normalized.externalId || null,
    inputType: normalized.inputType,
    canonicalIdentity: normalized.canonicalIdentity,
    profileUrl: normalized.profileUrl,
    sourceInput: normalized.sourceInput,
    displayName: creator.displayName,
    enabled: primary?.enabled !== false,
    alertTypes: Array.isArray(primary?.alertTypes) ? primary.alertTypes : supportedAlerts(platform),
    alertChannelId: primary?.alertChannelId || null,
    alertChannels: primary?.alertChannels && typeof primary.alertChannels === 'object' ? primary.alertChannels : {},
    createdAt: primary?.createdAt || new Date().toISOString(),
  };

  return store.upsertCreatorAccount(
    guildId,
    creator.creatorId,
    account,
    duplicateAccountIds,
    { actorId },
  );
}

const buildUserLanding =
  adminPanel.user.buildLanding;

const buildUserDenied =
  adminPanel.user.buildDenied;

const buildUserCreate =
  adminPanel.user.buildCreate;

const buildUserProfile =
  adminPanel.user.buildProfile;

const buildUserSection =
  adminPanel.user.buildSection;

function getCreatorContext(interaction) {
  const access = getAccess(interaction);
  if (!access.allowed) return { payload: buildUserDenied(interaction, access.roleIds) };
  const creator = findByOwnerDiscordId(interaction.guildId, interaction.user.id);
  if (!creator) return { payload: buildUserCreate(interaction) };
  return { creator, accounts: getAccountsForCreator(interaction.guildId, creator) };
}

function isUserSocialInteraction(customId) {
  return customId === 'user:category:social'
    || customId === 'user:module:social'
    || customId === 'user:social:open'
    || customId === 'user:social:create'
    || customId === 'user:social:create:submit'
    || customId === 'user:social:account:platforms'
    || customId === 'user:social:account:continue'
    || customId === 'user:social:account:create-multi'
    || /^user:social:(details|accounts|newAccount|manageAccount|alerts)$/.test(customId);
}

async function handleUserCreateProfile(interaction, updatePanel) {
  const access = getAccess(interaction);

  if (!access.allowed) {
    return updatePanel(
      interaction,
      buildUserDenied(interaction, access.roleIds),
    );
  }

  const creator = findByOwnerDiscordId(
    interaction.guildId,
    interaction.user.id,
  );

  if (creator?.profileCompleted === true) {
    return updatePanel(
      interaction,
      buildUserProfile(
        interaction,
        creator,
        getAccountsForCreator(interaction.guildId, creator),
      ),
    );
  }

  await interaction.showModal(
    userCreatorModal(creator, interaction),
  );

  return true;
}

async function handleUserCreateProfileSubmit(
  interaction,
  updatePanel,
) {
  const access = getAccess(interaction);

  if (!access.allowed) {
    await interaction.reply({
      content: 'You no longer have access to Social Studio.',
      flags: 64,
    });

    return true;
  }

  const displayName = interaction.fields
    .getTextInputValue('displayName')
    .trim();

  if (!displayName) {
    await interaction.reply({
      content: 'Creator display name is required.',
      flags: 64,
    });

    return true;
  }

  const result = completeCreatorProfile(interaction.member, {
    displayName,
    group: interaction.fields.getTextInputValue('group'),
    tags: interaction.fields.getTextInputValue('tags'),
    notes: interaction.fields.getTextInputValue('notes'),
  });

  const accounts = getAccountsForCreator(
    interaction.guildId,
    result.creator,
  );

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate();
  }

  return updatePanel(
    interaction,
    buildUserProfile(
      interaction,
      result.creator,
      accounts,
      true,
    ),
  );
}

function handleUserAddAccountOpen(interaction, updatePanel, creator) {
  setUserAccountSession(interaction, { platforms: [] });

  return updatePanel(
    interaction,
    buildUserAddAccounts(interaction, creator),
  );
}

function handleUserPlatformSelection(
  interaction,
  updatePanel,
  creator,
) {
  setUserAccountSession(interaction, {
    platforms: interaction.values || [],
  });

  return updatePanel(
    interaction,
    buildUserAddAccounts(interaction, creator),
  );
}

async function handleUserAccountContinue(
  interaction,
  updatePanel,
  creator,
) {
  const platforms =
    getUserAccountSession(interaction).platforms || [];

  if (!platforms.length) {
    return updatePanel(
      interaction,
      buildUserAddAccounts(interaction, creator),
    );
  }

  await interaction.showModal(userAccountModal(platforms));
  return true;
}

async function handleUserAccountsSubmit(
  interaction,
  updatePanel,
) {
  const platforms =
    getUserAccountSession(interaction).platforms || [];

  if (!platforms.length) {
    await interaction.reply({
      content: 'Select at least one platform before continuing.',
      flags: 64,
    });

    return true;
  }

  let creator = store.findCreatorByOwner(
    interaction.guildId,
    interaction.user.id,
  );

  if (!creator) {
    await interaction.reply({
      content: 'Your Creator Profile could not be found.',
      flags: 64,
    });

    return true;
  }

  for (const platform of platforms) {
    const value = interaction.fields
      .getTextInputValue(`account_${platform}`)
      .trim();

    if (!value) continue;

    const result = upsertUserAccount(
      interaction.guildId,
      creator,
      platform,
      value,
      interaction.user.id,
    );

    creator = result.creator;
  }

  creator =
    store.getCreator(interaction.guildId, creator.creatorId)
    || creator;

  setUserAccountSession(interaction, { platforms: [] });

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate();
  }

  return updatePanel(
    interaction,
    buildUserProfile(
      interaction,
      creator,
      getAccountsForCreator(interaction.guildId, creator),
    ),
  );
}

function handleUserSectionNavigation(
  interaction,
  updatePanel,
  context,
  customId,
) {
  const match = customId.match(
    /^user:social:(details|accounts|newAccount|manageAccount|alerts)$/,
  );

  const section = ['newAccount', 'manageAccount'].includes(match?.[1])
    ? 'accounts'
    : match?.[1];

  return updatePanel(
    interaction,
    section
      ? buildUserSection(
        interaction,
        context.creator,
        section,
        context.accounts,
      )
      : buildUserProfile(
        interaction,
        context.creator,
        context.accounts,
      ),
  );
}

async function handleUserInteraction(interaction, updatePanel) {
  const customId = String(interaction?.customId || '');

  if (!isUserSocialInteraction(customId)) {
    return false;
  }

  if (customId === 'user:category:social') {
    return updatePanel(
      interaction,
      buildUserLanding(interaction),
    );
  }

  if (
    customId === 'user:social:create'
    && interaction.isButton?.()
  ) {
    return handleUserCreateProfile(interaction, updatePanel);
  }

  if (
    customId === 'user:social:create:submit'
    && interaction.isModalSubmit?.()
  ) {
    return handleUserCreateProfileSubmit(
      interaction,
      updatePanel,
    );
  }

  const context = getCreatorContext(interaction);

  if (context.payload) {
    return updatePanel(interaction, context.payload);
  }

  if (
    customId === 'user:social:newAccount'
    || customId === 'user:social:accounts'
  ) {
    return handleUserAddAccountOpen(
      interaction,
      updatePanel,
      context.creator,
    );
  }

  if (
    customId === 'user:social:account:platforms'
    && interaction.isStringSelectMenu?.()
  ) {
    return handleUserPlatformSelection(
      interaction,
      updatePanel,
      context.creator,
    );
  }

  if (
    customId === 'user:social:account:continue'
    && interaction.isButton?.()
  ) {
    return handleUserAccountContinue(
      interaction,
      updatePanel,
      context.creator,
    );
  }

  if (
    customId === 'user:social:account:create-multi'
    && interaction.isModalSubmit?.()
  ) {
    return handleUserAccountsSubmit(
      interaction,
      updatePanel,
    );
  }

  return handleUserSectionNavigation(
    interaction,
    updatePanel,
    context,
    customId,
  );
}

const user = {
  buildLanding: buildUserLanding,
  buildDenied: buildUserDenied,
  buildCreate: buildUserCreate,
  buildProfile: buildUserProfile,
  buildSection: buildUserSection,
  handleInteraction: handleUserInteraction,
  canAccess: (interaction) => getAccess(interaction).allowed,
};

module.exports = {
  admin: adminPanel,
  user,
  getAccess,
  findByOwnerDiscordId,
  getAccountsForCreator,
  completeCreatorProfile,
};
