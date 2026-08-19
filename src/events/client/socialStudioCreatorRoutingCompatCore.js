'use strict';

// Canonical Social Studio creator/account routing core.

const crypto = require('node:crypto');
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
const accountManagement = require('./socialStudioAccountManagementCompat');
const creatorRoutingCompat = require('../../modules/socialStudio/socialAlerts/socialStudioCreatorRoutingCompat');
const userChannelRouting = require('../../modules/socialStudio/socialAlerts/socialStudioUserChannelRouting');
const store = require('../../modules/socialStudio/socialAlerts/socialStudioStore');
const socialPanel = require('../../modules/socialStudio/socialAlerts/socialStudioPanel');
const { normalizeAccountInput, migrateAccount } = require('../../modules/socialStudio/socialAlerts/accountNormalizer');
const { providerInfo } = require('../../modules/socialStudio/socialAlerts/socialStudioProviders');

const P = 'social:';
const PLATFORMS = ['facebook', 'instagram', 'kick', 'tiktok', 'twitch', 'x', 'youtube'];
const LABEL = { twitch: 'Twitch', youtube: 'YouTube', tiktok: 'TikTok', kick: 'Kick', facebook: 'Facebook', instagram: 'Instagram', x: 'X' };
const ALERT_TYPES = ['live', 'ended', 'vod', 'clip', 'upload', 'short', 'post'];
const sessions = new Map();

function sessionKey(interaction) {
  return `${interaction.guildId}:${interaction.user?.id || 'unknown'}`;
}

function getSession(interaction) {
  return sessions.get(sessionKey(interaction)) || { creatorId: null, platforms: [] };
}

function setSession(interaction, patch) {
  const next = { ...getSession(interaction), ...patch };
  sessions.set(sessionKey(interaction), next);
  return next;
}

function row(...components) {
  return new ActionRowBuilder().addComponents(...components);
}

function button(id, label, style = ButtonStyle.Secondary, disabled = false) {
  return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
}

function makeCreatorId(config) {
  let creatorId;
  do {
    creatorId = `creator_${crypto.randomBytes(8).toString('hex')}`;
  } while (config.creators?.[creatorId]);
  return creatorId;
}

function makeAccountId(config) {
  let accountId;
  do {
    accountId = `account_${crypto.randomBytes(8).toString('hex')}`;
  } while (config.accounts?.[accountId]);
  return accountId;
}

function clean(value, max) {
  return String(value || '').trim().slice(0, max);
}

function supportedAlerts(platform) {
  const raw = providerInfo(platform)?.supportedAlertTypes || [];
  const supported = raw.filter((type) => ALERT_TYPES.includes(type));
  if (supported.includes('live') && !supported.includes('ended')) supported.splice(1, 0, 'ended');
  return supported;
}

function canonicalKey(account) {
  const migrated = migrateAccount(account);
  const identity = String(
    migrated.canonicalIdentity
    || migrated.externalId
    || migrated.normalizedUsername
    || migrated.username
    || '',
  ).toLowerCase();
  return `${String(migrated.platform || '').toLowerCase()}:${identity}`;
}

function platformSelect(selected = []) {
  return row(new StringSelectMenuBuilder()
    .setCustomId(`${P}account:platforms`)
    .setPlaceholder('Select platform(s) to add an account')
    .setMinValues(1)
    .setMaxValues(5)
    .addOptions(PLATFORMS.map((platform) => ({
      label: LABEL[platform],
      value: platform,
      default: selected.includes(platform),
    }))));
}

function accountAddPayload(interaction, creator, selected = []) {
  const config = store.getConfig(interaction.guildId);
  const selectedText = selected.length
    ? selected.map((platform) => LABEL[platform] || platform).join(', ')
    : 'None';

  return {
    embeds: [new EmbedBuilder()
      .setColor(config.enabled ? 0x5865F2 : 0x747F8D)
      .setTitle('➕ Add Accounts')
      .setDescription([
        `Add one or more social accounts to **${creator.displayName || creator.creatorId}**.`,
        '',
        'Select up to 5 platforms, then continue. The next form will ask for a username, channel ID or URL for each selected platform.',
        '',
        `**Selected:** ${selectedText}`,
      ].join('\n'))
      .setFooter({ text: `Requested by ${interaction.member?.displayName || interaction.user?.displayName || interaction.user?.username || 'Unknown User'}` })
      .setTimestamp()],
    components: [
      platformSelect(selected),
      row(
        button(`${P}creators`, '⬅️ Back'),
        button(`${P}account:continue`, '➡️ Continue', ButtonStyle.Success, !selected.length),
      ),
    ],
  };
}

function accountModal(platforms) {
  const modal = new ModalBuilder()
    .setCustomId(`${P}account:create-multi`)
    .setTitle('Add Social Accounts');

  for (const platform of platforms.slice(0, 5)) {
    modal.addComponents(row(new TextInputBuilder()
      .setCustomId(`account_${platform}`)
      .setLabel(`${LABEL[platform]} username, channel ID or URL`)
      .setPlaceholder(`Paste the ${LABEL[platform]} profile URL, username or ID here`)
      .setStyle(TextInputStyle.Short)
      .setMaxLength(500)
      .setRequired(true)));
  }

  return modal;
}

async function handleCreatorCreate(interaction) {
  if (String(interaction?.customId || '') !== `${P}creator:create`) return false;
  if (!interaction.guildId || !interaction.isModalSubmit?.()) return false;

  if (!socialPanel.canManageSocialStudio(interaction)) {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.reply({ content: 'You do not have permission to manage Social Studio.', flags: 64 });
    }
    return true;
  }

  const displayName = clean(interaction.fields.getTextInputValue('displayName'), 120);
  if (!displayName) throw new Error('Creator display name is required.');

  const config = store.getConfig(interaction.guildId);
  config.creators = config.creators && typeof config.creators === 'object' ? { ...config.creators } : {};

  const creatorId = makeCreatorId(config);
  const timestamp = new Date().toISOString();
  config.creators[creatorId] = {
    creatorId,
    displayName,
    group: clean(interaction.fields.getTextInputValue('group'), 120),
    tags: clean(interaction.fields.getTextInputValue('tags'), 300)
      .split(',')
      .map((value) => value.trim().slice(0, 60))
      .filter(Boolean),
    notes: clean(interaction.fields.getTextInputValue('notes'), 1000),
    adminNotes: clean(interaction.fields.getTextInputValue('adminNotes'), 1000),
    enabled: true,
    status: 'active',
    accountIds: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  store.saveConfig(interaction.guildId, config, {
    actorId: interaction.user?.id || null,
    guild: interaction.guild,
  });

  const payload = socialPanel.buildSectionPanel(interaction, 'creators');
  if (interaction.isFromMessage?.()) {
    await interaction.update(payload);
    await interaction.followUp({ content: `✅ Created creator profile **${displayName}**.`, flags: 64 }).catch(() => null);
  } else if (!interaction.deferred && !interaction.replied) {
    await interaction.reply({ content: `✅ Created creator profile **${displayName}**.`, flags: 64 });
  } else {
    await interaction.followUp({ content: `✅ Created creator profile **${displayName}**.`, flags: 64 }).catch(() => null);
  }

  return true;
}

async function handleAccountCreateFlow(interaction) {
  const id = String(interaction?.customId || '');
  if (!interaction.guildId) return false;

  if (id === `${P}creator:select`) {
    setSession(interaction, { creatorId: interaction.values?.[0] || null, platforms: [] });
    return false;
  }

  if (![`${P}account:platforms`, `${P}account:continue`, `${P}account:create-multi`].includes(id)) return false;

  if (!socialPanel.canManageSocialStudio(interaction)) {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.reply({ content: 'You do not have permission to manage Social Studio.', flags: 64 });
    }
    return true;
  }

  const state = getSession(interaction);
  const config = store.getConfig(interaction.guildId);
  const creator = config.creators?.[state.creatorId] || null;
  if (!creator) throw new Error('Select a creator profile first.');

  if (id === `${P}account:platforms`) {
    const platforms = (interaction.values || []).filter((platform) => PLATFORMS.includes(platform)).slice(0, 5);
    setSession(interaction, { platforms });
    const payload = accountAddPayload(interaction, creator, platforms);
    if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
    else await interaction.update(payload);
    return true;
  }

  if (id === `${P}account:continue`) {
    const platforms = state.platforms.filter((platform) => PLATFORMS.includes(platform)).slice(0, 5);
    if (!platforms.length) throw new Error('Select at least one platform first.');
    await interaction.showModal(accountModal(platforms));
    return true;
  }

  if (!interaction.isModalSubmit?.()) return false;
  const platforms = state.platforms.filter((platform) => PLATFORMS.includes(platform)).slice(0, 5);
  if (!platforms.length) throw new Error('The selected platforms expired. Open New Account and choose the platforms again.');

  const latest = store.getConfig(interaction.guildId);
  const latestCreator = latest.creators?.[state.creatorId];
  if (!latestCreator) throw new Error('The selected creator profile no longer exists.');

  let created = 0;
  let updated = 0;
  let duplicatesRemoved = 0;

  for (const platform of platforms) {
    const rawValue = clean(interaction.fields.getTextInputValue(`account_${platform}`), 500);
    if (!rawValue) continue;

    const normalized = normalizeAccountInput(platform, rawValue);
    const identity = String(
      normalized.canonicalIdentity
      || normalized.externalId
      || normalized.normalizedUsername
      || normalized.username
      || '',
    ).toLowerCase();
    const key = `${platform}:${identity}`;
    const matches = Object.values(latest.accounts || {}).filter((account) => {
      try { return canonicalKey(account) === key; } catch { return false; }
    });
    const primary = matches[0] || null;
    const duplicateIds = matches.slice(1).map((account) => account.accountId);
    const accountId = primary?.accountId || makeAccountId(latest);
    const timestamp = new Date().toISOString();

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
      displayName: latestCreator.displayName,
      enabled: primary?.enabled !== false,
      alertTypes: Array.isArray(primary?.alertTypes) ? primary.alertTypes : supportedAlerts(platform),
      alertChannelId: primary?.alertChannelId || null,
      alertChannels: primary?.alertChannels && typeof primary.alertChannels === 'object' ? { ...primary.alertChannels } : {},
      createdAt: primary?.createdAt || timestamp,
      updatedAt: timestamp,
    };

    store.upsertCreatorAccount(
      interaction.guildId,
      latestCreator.creatorId,
      account,
      duplicateIds,
      { actorId: interaction.user?.id || null, guild: interaction.guild },
    );

    if (primary) updated += 1;
    else created += 1;
    duplicatesRemoved += duplicateIds.length;
  }

  setSession(interaction, { platforms: [] });
  const message = [
    `✅ Added ${created} new social account${created === 1 ? '' : 's'}.`,
    updated ? `Updated ${updated} existing account${updated === 1 ? '' : 's'}.` : null,
    duplicatesRemoved ? `Removed ${duplicatesRemoved} duplicate account entr${duplicatesRemoved === 1 ? 'y' : 'ies'}.` : null,
  ].filter(Boolean).join(' ');

  if (!interaction.deferred && !interaction.replied) {
    await interaction.reply({ content: message, flags: 64 });
  } else {
    await interaction.followUp({ content: message, flags: 64 }).catch(() => null);
  }

  return true;
}

async function handle(interaction) {
  if (await handleCreatorCreate(interaction)) return true;
  if (await handleAccountCreateFlow(interaction)) return true;

  // The user/content/channel router owns the new usable multi-user flow and
  // must run before the older creator-wide compatibility screens.
  if (await userChannelRouting.handle(interaction)) return true;
  if (await creatorRoutingCompat.handle(interaction)) return true;
  if (await accountManagement.handle(interaction)) return true;
  return false;
}

module.exports = { handle };
