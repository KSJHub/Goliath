'use strict';

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
const crypto = require('node:crypto');
const store = require('../../modules/socialStudio/socialAlerts/socialStudioStore');
const socialPanel = require('../../modules/socialStudio/socialAlerts/socialStudioPanel');
const { normalizeAccountInput } = require('../../modules/socialStudio/socialAlerts/accountNormalizer');

const P = 'social:';
const LABEL = { twitch: 'Twitch', youtube: 'YouTube', tiktok: 'TikTok', kick: 'Kick', facebook: 'Facebook', instagram: 'Instagram', x: 'X' };
const ICON = { twitch: '🟣', youtube: '🔴', tiktok: '⚫', kick: '🟢', facebook: '🔵', instagram: '🟠', x: '⚪' };
const sessions = new Map();

function sessionKey(interaction) {
  return `${interaction.guildId}:${interaction.user?.id || 'unknown'}`;
}

function getSession(interaction) {
  return sessions.get(sessionKey(interaction)) || { creatorId: null, accountId: null };
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

function who(interaction) {
  return interaction.member?.displayName || interaction.user?.displayName || interaction.user?.username || 'Unknown User';
}

function accountState(account) {
  const state = account?.state || {};
  if (account?.enabled === false) return '⏸️ Paused';
  if (state.isLive === true) return '🔴 LIVE';
  if (state.isLive === false) return '⚫ Offline';
  if (state.lastError) return '🟡 Unavailable';
  return '🟢 Monitoring';
}

function creatorFor(config, creatorId) {
  return config.creators?.[creatorId] || null;
}

function creatorForAccount(config, accountId) {
  return Object.values(config.creators || {}).find((creator) => (creator.accountIds || []).includes(accountId)) || null;
}

function linkedAccounts(config, creator) {
  return (creator?.accountIds || [])
    .map((accountId) => config.accounts?.[accountId])
    .filter(Boolean)
    .sort((a, b) => String(LABEL[a.platform] || a.platform || '').localeCompare(String(LABEL[b.platform] || b.platform || ''), 'en-GB', { sensitivity: 'base' }));
}

function accountListPayload(interaction, config, creator) {
  const accounts = linkedAccounts(config, creator);
  const state = getSession(interaction);
  const selected = accounts.find((account) => account.accountId === state.accountId) || null;
  const lines = accounts.length
    ? accounts.map((account) => `• ${ICON[account.platform] || '🌐'} **${LABEL[account.platform] || account.platform}** — ${account.username || account.externalId || 'Resolving…'} — ${accountState(account)}`)
    : ['No linked social accounts.'];
  const description = [
    `👤 **${creator.displayName || creator.creatorId}**`,
    '',
    '**Accounts**',
    `Linked: ${accounts.length}`,
    `Selected: ${selected ? `${LABEL[selected.platform] || selected.platform} — ${selected.username || selected.externalId || selected.accountId}` : accounts.length ? 'Choose an account below.' : 'None yet.'}`,
    '',
    ...lines,
  ].join('\n');

  const components = [];
  if (accounts.length) {
    const accountMenu = new StringSelectMenuBuilder()
      .setCustomId(`${P}account:select`)
      .setPlaceholder('Select an account to manage')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(accounts.slice(0, 25).map((account) => ({
        label: `${LABEL[account.platform] || account.platform} · ${account.username || account.externalId || 'Resolving'}`.slice(0, 100),
        value: account.accountId,
        description: String(account.profileUrl || account.externalId || account.accountId).slice(0, 100),
        default: account.accountId === state.accountId,
      })));
    components.push(row(accountMenu));
  }

  components.push(row(
    button(`${P}account:change`, '📝 Edit Account', ButtonStyle.Secondary, !selected),
    button(`${P}account:reset`, '🔄 Clear', ButtonStyle.Secondary, !selected),
    button(`${P}account:delete`, '🗑️ Delete', ButtonStyle.Danger, !selected),
  ));
  components.push(row(button(`${P}creators`, '⬅️ Back'), button(`${P}settings`, '⚙️ Settings')));

  return {
    embeds: [new EmbedBuilder()
      .setColor(config.enabled ? 0x5865F2 : 0x747F8D)
      .setTitle('🛠️ Manage Account')
      .setDescription(description)
      .setFooter({ text: `Requested by ${who(interaction)}` })
      .setTimestamp()],
    components,
  };
}

function accountDetailPayload(interaction, config, creator, account) {
  const routes = Object.entries(account.alertChannels || {})
    .filter(([, channelId]) => channelId)
    .map(([type, channelId]) => `${type}: <#${channelId}>`)
    .join(' • ');
  const description = [
    `${ICON[account.platform] || '🌐'} **${LABEL[account.platform] || account.platform} Account**`,
    `${accountState(account)} **${account.username || account.externalId || 'Resolving…'}**`,
    '',
    `**Creator:** ${creator.displayName || creator.creatorId}`,
    `**Profile:** ${account.profileUrl || 'Not resolved'}`,
    '',
    '**Routing**',
    `Account channel: ${account.alertChannelId ? `<#${account.alertChannelId}>` : 'Uses routing hierarchy'}`,
    `Dedicated account routes: ${routes || 'None'}`,
  ].join('\n');

  return {
    embeds: [new EmbedBuilder()
      .setColor(config.enabled ? 0x5865F2 : 0x747F8D)
      .setTitle('🔗 Manage Social Account')
      .setDescription(description)
      .setFooter({ text: `Requested by ${who(interaction)}` })
      .setTimestamp()],
    components: [
      row(
        button(`${P}account:change`, '📝 Edit'),
        button(`${P}account:toggle`, account.enabled === false ? '▶️ Resume' : '⏸️ Pause', account.enabled === false ? ButtonStyle.Success : ButtonStyle.Secondary),
        button(`${P}account:move`, '↪️ Move Account'),
        button(`${P}account:delete`, '🗑️ Delete', ButtonStyle.Danger),
      ),
      row(button(`${P}account:edit`, '⬅️ Accounts'), button(`${P}settings`, '⚙️ Settings')),
    ],
  };
}

function accountEditModal(account) {
  const input = new TextInputBuilder()
    .setCustomId('accountValue')
    .setLabel('Username, channel ID or URL')
    .setPlaceholder('Paste the profile URL, username or channel ID here')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(500)
    .setRequired(true)
    .setValue(String(account.sourceInput || account.profileUrl || account.externalId || account.username || '').slice(0, 500));
  return new ModalBuilder()
    .setCustomId(`${P}account:update:${account.accountId}`)
    .setTitle(`Edit ${LABEL[account.platform] || account.platform} Account`)
    .addComponents(row(input));
}

function movePayload(interaction, config, creator, account) {
  const creators = Object.values(config.creators || {})
    .filter((item) => item?.creatorId && item.creatorId !== creator.creatorId)
    .sort((a, b) => String(a.displayName || '').localeCompare(String(b.displayName || ''), 'en-GB', { sensitivity: 'base' }));
  const components = [];

  if (creators.length) {
    const creatorMenu = new StringSelectMenuBuilder()
      .setCustomId(`${P}account:move:creator`)
      .setPlaceholder('Move to existing creator profile')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(creators.slice(0, 25).map((item) => ({
        label: String(item.displayName || 'Unnamed creator').slice(0, 100),
        value: item.creatorId,
        description: `${(item.accountIds || []).length} linked account(s)`.slice(0, 100),
      })));
    components.push(row(creatorMenu));
  }

  components.push(row(button(`${P}account:move:new`, '➕ New Profile', ButtonStyle.Success), button(`${P}account:edit`, '⬅️ Back')));
  return {
    embeds: [new EmbedBuilder()
      .setColor(config.enabled ? 0x5865F2 : 0x747F8D)
      .setTitle('↪️ Move Social Account')
      .setDescription(`Move **${LABEL[account.platform] || account.platform} — ${account.username || account.externalId || account.accountId}** from **${creator.displayName || creator.creatorId}** to another creator profile.`)
      .setFooter({ text: `Requested by ${who(interaction)}` })
      .setTimestamp()],
    components,
  };
}

function moveNewCreatorModal() {
  const displayName = new TextInputBuilder().setCustomId('displayName').setLabel('New creator display name').setStyle(TextInputStyle.Short).setMaxLength(120).setRequired(true);
  const group = new TextInputBuilder().setCustomId('group').setLabel('Group or team').setStyle(TextInputStyle.Short).setMaxLength(120).setRequired(false);
  const tags = new TextInputBuilder().setCustomId('tags').setLabel('Tags (comma separated)').setStyle(TextInputStyle.Short).setMaxLength(300).setRequired(false);
  const notes = new TextInputBuilder().setCustomId('notes').setLabel('Profile Notes (optional)').setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(false);
  return new ModalBuilder()
    .setCustomId(`${P}account:move:create`)
    .setTitle('Move Account to New Profile')
    .addComponents(row(displayName), row(group), row(tags), row(notes));
}

async function render(interaction, payload) {
  if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
  else await interaction.update(payload);
  return true;
}

function requireSelection(interaction) {
  const state = getSession(interaction);
  const config = store.getConfig(interaction.guildId);
  const creator = creatorFor(config, state.creatorId);
  const account = config.accounts?.[state.accountId] || null;
  if (!creator) throw new Error('Select a creator profile first.');
  if (!account || !(creator.accountIds || []).includes(account.accountId)) throw new Error('Select an account first.');
  return { config, creator, account };
}

async function handleAccountUpdate(interaction, id) {
  if (!id.startsWith(`${P}account:update:`) || !interaction.isModalSubmit?.()) return false;
  const accountId = id.slice(`${P}account:update:`.length);
  const config = store.getConfig(interaction.guildId);
  const account = config.accounts?.[accountId] || null;
  const creator = creatorForAccount(config, accountId);
  if (!account || !creator) throw new Error('The selected Social Studio account no longer exists.');

  const rawValue = String(interaction.fields.getTextInputValue('accountValue') || '').trim();
  if (!rawValue) throw new Error('Enter a username, channel ID or profile URL.');
  const normalized = normalizeAccountInput(account.platform, rawValue);
  const updated = store.updateAccount(interaction.guildId, accountId, (current) => {
    const currentIdentity = String(
      current.canonicalIdentity ||
      current.normalizedUsername ||
      current.username ||
      ''
    ).toLowerCase();

    const nextIdentity = String(
      normalized.canonicalIdentity ||
      normalized.normalizedUsername ||
      normalized.username ||
      ''
    ).toLowerCase();

    const identityChanged =
      Boolean(currentIdentity) &&
      Boolean(nextIdentity) &&
      currentIdentity !== nextIdentity;

    return {
      ...current,
      username: normalized.username,
      normalizedUsername: normalized.normalizedUsername,
      externalId:
        normalized.externalId ||
        (identityChanged ? null : current.externalId) ||
        null,
      inputType: normalized.inputType,
      canonicalIdentity: normalized.canonicalIdentity,
      profileUrl: normalized.profileUrl,
      sourceInput: normalized.sourceInput,
    };
  }, { actorId: interaction.user?.id || null, guild: interaction.guild });
  setSession(interaction, { creatorId: creator.creatorId, accountId });

  const message = `✅ Updated ${LABEL[updated.platform] || updated.platform || 'social'} account.`;
  if (!interaction.deferred && !interaction.replied) await interaction.reply({ content: message, flags: 64 });
  else await interaction.followUp({ content: message, flags: 64 }).catch(() => null);
  return true;
}

async function handle(interaction) {
  const id = String(interaction?.customId || '');
  if (!interaction.guildId) return false;

  if (id === `${P}creator:select`) {
    setSession(interaction, { creatorId: interaction.values?.[0] || null, accountId: null });
    return false;
  }

  const managed = id === `${P}account:select`
    || id === `${P}account:change`
    || id.startsWith(`${P}account:update:`)
    || id === `${P}account:toggle`
    || id === `${P}account:reset`
    || id === `${P}account:delete`
    || id === `${P}account:move`
    || id === `${P}account:move:creator`
    || id === `${P}account:move:new`
    || id === `${P}account:move:create`
    || id === `${P}account:edit`;
  if (!managed) return false;

  if (!socialPanel.canManageSocialStudio(interaction)) {
    if (!interaction.deferred && !interaction.replied) await interaction.reply({ content: 'You do not have permission to manage Social Studio.', flags: 64 });
    return true;
  }

  if (await handleAccountUpdate(interaction, id)) return true;

  if (id === `${P}account:select`) {
    const accountId = interaction.values?.[0] || null;
    setSession(interaction, { accountId });
    const { config, creator, account } = requireSelection(interaction);
    return render(interaction, accountDetailPayload(interaction, config, creator, account));
  }

  if (id === `${P}account:reset`) {
    const state = setSession(interaction, { accountId: null });
    const config = store.getConfig(interaction.guildId);
    const creator = creatorFor(config, state.creatorId);
    if (!creator) throw new Error('Select a creator profile first.');
    return render(interaction, accountListPayload(interaction, config, creator));
  }

  if (id === `${P}account:edit`) {
    const state = getSession(interaction);
    const config = store.getConfig(interaction.guildId);
    const creator = creatorFor(config, state.creatorId);
    if (!creator) throw new Error('Select a creator profile first.');
    return render(interaction, accountListPayload(interaction, config, creator));
  }

  const { config, creator, account } = requireSelection(interaction);

  if (id === `${P}account:change`) {
    await interaction.showModal(accountEditModal(account));
    return true;
  }

  if (id === `${P}account:toggle`) {
    const updated = store.updateAccount(interaction.guildId, account.accountId, (current) => ({ ...current, enabled: current.enabled === false }), { actorId: interaction.user?.id || null, guild: interaction.guild });
    const latest = store.getConfig(interaction.guildId);
    return render(interaction, accountDetailPayload(interaction, latest, creatorFor(latest, creator.creatorId), updated));
  }

  if (id === `${P}account:delete`) {
    store.deleteAccount(interaction.guildId, account.accountId, { actorId: interaction.user?.id || null, guild: interaction.guild });
    setSession(interaction, { accountId: null });
    const latest = store.getConfig(interaction.guildId);
    const latestCreator = creatorFor(latest, creator.creatorId);
    await render(interaction, accountListPayload(interaction, latest, latestCreator));
    await interaction.followUp({ content: `✅ Deleted ${LABEL[account.platform] || account.platform} account.`, flags: 64 }).catch(() => null);
    return true;
  }

  if (id === `${P}account:move`) {
    return render(interaction, movePayload(interaction, config, creator, account));
  }

  if (id === `${P}account:move:creator`) {
    const targetId = interaction.values?.[0] || null;
    const target = config.creators?.[targetId];
    if (!target) throw new Error('Choose a valid destination creator profile.');
    for (const item of Object.values(config.creators || {})) item.accountIds = (item.accountIds || []).filter((value) => value !== account.accountId);
    target.accountIds = [...new Set([...(target.accountIds || []), account.accountId])];
    target.updatedAt = new Date().toISOString();
    account.displayName = target.displayName;
    account.updatedAt = new Date().toISOString();
    store.saveConfig(interaction.guildId, config, { actorId: interaction.user?.id || null, guild: interaction.guild });
    setSession(interaction, { creatorId: target.creatorId, accountId: account.accountId });
    const latest = store.getConfig(interaction.guildId);
    await render(interaction, accountDetailPayload(interaction, latest, latest.creators[target.creatorId], latest.accounts[account.accountId]));
    await interaction.followUp({ content: `✅ Moved account to **${target.displayName || target.creatorId}**.`, flags: 64 }).catch(() => null);
    return true;
  }

  if (id === `${P}account:move:new`) {
    await interaction.showModal(moveNewCreatorModal());
    return true;
  }

  if (id === `${P}account:move:create`) {
    const displayName = String(interaction.fields.getTextInputValue('displayName') || '').trim().slice(0, 120);
    if (!displayName) throw new Error('Creator display name is required.');
    const creatorId = `creator_${crypto.randomBytes(8).toString('hex')}`;
    const timestamp = new Date().toISOString();
    for (const item of Object.values(config.creators || {})) item.accountIds = (item.accountIds || []).filter((value) => value !== account.accountId);
    config.creators[creatorId] = {
      creatorId,
      displayName,
      group: String(interaction.fields.getTextInputValue('group') || '').trim().slice(0, 120),
      tags: String(interaction.fields.getTextInputValue('tags') || '').split(',').map((value) => value.trim().slice(0, 60)).filter(Boolean),
      notes: String(interaction.fields.getTextInputValue('notes') || '').trim().slice(0, 1000),
      adminNotes: '',
      enabled: true,
      status: 'active',
      accountIds: [account.accountId],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    account.displayName = displayName;
    account.updatedAt = timestamp;
    store.saveConfig(interaction.guildId, config, { actorId: interaction.user?.id || null, guild: interaction.guild });
    setSession(interaction, { creatorId, accountId: account.accountId });
    const message = `✅ Created **${displayName}** and moved the account.`;
    if (!interaction.deferred && !interaction.replied) await interaction.reply({ content: message, flags: 64 });
    else await interaction.followUp({ content: message, flags: 64 }).catch(() => null);
    return true;
  }

  return false;
}

module.exports = { handle };
