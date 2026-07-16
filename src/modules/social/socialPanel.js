'use strict';

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  RoleSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder,
} = require('discord.js');

const social = require('./social');
const socialHealth = require('./socialHealth');

const sessions = new Map();
const SCREENS = Object.freeze({ HOME: 'home', CREATORS: 'creators', STUDIO: 'studio', PROVIDERS: 'providers', OPERATIONS: 'operations', HEALTH: 'health' });
const TEMPLATE_KEYS = ['live', 'upload', 'short', 'post'];
const ROUTE_TYPES = ['live', 'upload', 'short', 'post'];
const VARIABLES = ['{creator}', '{platform}', '{title}', '{game}', '{viewers}', '{thumbnail}', '{streamUrl}', '{videoUrl}', '{uploadTime}', '{duration}', '{category}'];

function row(...components) { return new ActionRowBuilder().addComponents(...components); }
function button(customId, label, style = ButtonStyle.Secondary, disabled = false) { return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style).setDisabled(disabled); }
function clean(value, max = 1000) { return String(value || '').trim().slice(0, max); }
function sessionKey(interaction) { return `${interaction.guildId}:${interaction.user.id}`; }
function requestedBy(interaction) { return interaction.member?.displayName || interaction.user?.globalName || interaction.user?.username || 'Administrator'; }
function getConfig(guildId) { return social.getConfig(guildId); }
function accountMap(config) { return Object.fromEntries((config.accounts || []).map((account) => [account.accountId, account])); }
function selectedAccount(config, session) { return accountMap(config)[session.accountId] || null; }
function providerState(config, platform) { return config.providers?.[platform]?.enabled === false ? 'disabled' : social.providers.getProvider(platform)?.status || 'unknown'; }
function stateEmoji(status) { return status === 'ready' ? '✅' : status === 'disabled' ? '⏸️' : status === 'error' ? '❌' : '⚠️'; }

function getSession(interaction) {
  const config = getConfig(interaction.guildId);
  const existing = sessions.get(sessionKey(interaction));
  const session = existing || {
    screen: SCREENS.HOME,
    accountId: config.accounts?.[0]?.accountId || null,
    templateKey: 'live',
    operation: 'routing_live',
    queueId: null,
  };
  if (session.accountId && !config.accounts.some((account) => account.accountId === session.accountId)) session.accountId = config.accounts?.[0]?.accountId || null;
  sessions.set(sessionKey(interaction), session);
  return session;
}

function navigation(active) {
  return row(new StringSelectMenuBuilder()
    .setCustomId('admin:social:navigation')
    .setPlaceholder('Social Studio section')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions([
      { label: 'Overview', value: SCREENS.HOME, emoji: '🏠', default: active === SCREENS.HOME },
      { label: 'Creators', value: SCREENS.CREATORS, emoji: '👥', default: active === SCREENS.CREATORS },
      { label: 'Alert Studio', value: SCREENS.STUDIO, emoji: '🎨', default: active === SCREENS.STUDIO },
      { label: 'Providers', value: SCREENS.PROVIDERS, emoji: '🔌', default: active === SCREENS.PROVIDERS },
      { label: 'Operations', value: SCREENS.OPERATIONS, emoji: '🛠️', default: active === SCREENS.OPERATIONS },
      { label: 'Health', value: SCREENS.HEALTH, emoji: '🩺', default: active === SCREENS.HEALTH },
    ]));
}

function accountSelector(config, session) {
  const accounts = config.accounts || [];
  const menu = new StringSelectMenuBuilder().setCustomId('admin:social:account').setPlaceholder(accounts.length ? 'Select creator account' : 'No creator accounts configured').setMinValues(1).setMaxValues(1).setDisabled(!accounts.length);
  if (accounts.length) menu.addOptions(accounts.slice(0, 25).map((account) => ({
    label: clean(account.displayName || account.username || account.platform, 100),
    description: clean(`${account.platform} · ${account.username || account.externalId || 'unresolved'}`, 100),
    value: account.accountId,
    emoji: account.enabled === false ? '⏸️' : '📡',
    default: account.accountId === session.accountId,
  })));
  return row(menu);
}

function templateSelector(session) {
  return row(new StringSelectMenuBuilder().setCustomId('admin:social:template').setPlaceholder('Choose alert template').setMinValues(1).setMaxValues(1)
    .addOptions(TEMPLATE_KEYS.map((key) => ({ label: key[0].toUpperCase() + key.slice(1), value: key, default: key === session.templateKey }))));
}

function operationSelector(session) {
  return row(new StringSelectMenuBuilder().setCustomId('admin:social:operation').setPlaceholder('Choose operation').setMinValues(1).setMaxValues(1).addOptions([
    ...ROUTE_TYPES.map((type) => ({ label: `${type[0].toUpperCase() + type.slice(1)} routing`, value: `routing_${type}`, emoji: '🎯', default: session.operation === `routing_${type}` })),
    { label: 'Quiet hours', value: 'quiet', emoji: '🌙', default: session.operation === 'quiet' },
    { label: 'Alert history', value: 'history', emoji: '📜', default: session.operation === 'history' },
    { label: 'Delivery queue', value: 'queue', emoji: '📦', default: session.operation === 'queue' },
  ]));
}

function queueSelector(guildId, session) {
  const items = social.queue.list(guildId, { limit: 25 });
  if (session.queueId && !items.some((item) => item.id === session.queueId)) session.queueId = items[0]?.id || null;
  const menu = new StringSelectMenuBuilder().setCustomId('admin:social:queueItem').setPlaceholder(items.length ? 'Select queued delivery' : 'Queue is empty').setMinValues(1).setMaxValues(1).setDisabled(!items.length);
  if (items.length) menu.addOptions(items.map((item) => ({
    label: clean(`${item.platform || 'social'} · ${item.alertType}`, 100),
    description: clean(`${item.status} · attempt ${item.attempts}/${social.queue.MAX_ATTEMPTS} · ${item.reason}`, 100),
    value: item.id,
    emoji: item.status === 'failed' ? '❌' : '📦',
    default: item.id === session.queueId,
  })));
  return row(menu);
}

function embed(title, description, interaction, color = 0x5865f2) {
  return new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setFooter({ text: `Social Studio · ${requestedBy(interaction)}` }).setTimestamp();
}

function homePayload(interaction, config, session) {
  const overview = social.getOverview(interaction.guildId);
  const providers = social.providers.listProviders();
  const ready = providers.filter((provider) => provider.status === 'ready').length;
  const queue = social.queue.summary(interaction.guildId);
  return {
    embeds: [embed('📣 Social Studio', [
      'A zero-credential creator alert studio. Add public usernames, channel names, channel IDs or profile URLs — Goliath manages provider credentials centrally.',
      '',
      `**Module:** ${config.enabled !== false ? 'Enabled ✅' : 'Disabled ❌'}`,
      `**Creator Accounts:** ${overview.accountCount} total · ${overview.enabledAccountCount} enabled`,
      `**Providers Ready:** ${ready}/${providers.length}`,
      `**Alerts Sent:** ${overview.analytics?.alertsSent || 0}`,
      `**Queue:** ${queue.queued} waiting · ${queue.failed} failed`,
      `**History:** ${overview.history?.total || 0} recent operations`,
      '',
      '**Simple setup**',
      '1. Add a public creator handle, channel name, channel ID or URL.',
      '2. Choose the default destination and optional mention role.',
      '3. Use Operations to route each alert type and set quiet hours.',
      '4. Preview, test and monitor delivery health.',
    ].join('\n'), interaction, config.enabled !== false ? 0x57f287 : 0x5865f2)],
    components: [navigation(session.screen), accountSelector(config, session), row(
      button('admin:social:create', '➕ Add Creator', ButtonStyle.Success),
      button('admin:social:checkAll', '🔄 Check All', ButtonStyle.Primary, !config.accounts.length),
      button(config.enabled !== false ? 'admin:social:disable' : 'admin:social:enable', config.enabled !== false ? '⏸️ Disable' : '▶️ Enable'),
      button('admin:social:export', '📤 Export'),
      button('admin:modules', '⬅️ Modules'),
    )],
  };
}

function creatorsPayload(interaction, config, session) {
  const account = selectedAccount(config, session);
  const description = account ? [
    `**Creator:** ${account.displayName}`,
    `**Platform:** ${account.platform}`,
    `**Public Identifier:** ${account.username || account.externalId || 'Not resolved'}`,
    `**Default Destination:** ${account.alertChannelId ? `<#${account.alertChannelId}>` : 'Not set'}`,
    `**Mention:** ${account.mentionMode || 'none'}${account.mentionRoleId ? ` · <@&${account.mentionRoleId}>` : ''}`,
    `**Alert Types:** ${(account.alertTypes || []).join(', ') || 'None'}`,
    `**Status:** ${account.enabled !== false ? 'Enabled ✅' : 'Disabled ⏸️'}`,
    `**Provider:** ${stateEmoji(providerState(config, account.platform))} ${providerState(config, account.platform)}`,
    `**Last Check:** ${account.lastSeen?.lastCheckedAt || 'Never'}`,
    `**Last Alert:** ${account.lastSeen?.lastAlertAt || 'Never'}`,
    `**Last Error:** ${account.lastSeen?.lastProviderError || 'None'}`,
  ].join('\n') : 'Add a creator using a public username, channel name, channel ID or profile URL. No API keys or creator authentication are required.';
  const rows = [navigation(session.screen), accountSelector(config, session)];
  if (account) {
    rows.push(row(new ChannelSelectMenuBuilder().setCustomId('admin:social:creatorChannel').setPlaceholder('Choose default alert destination').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)));
    rows.push(row(new RoleSelectMenuBuilder().setCustomId('admin:social:creatorRole').setPlaceholder('Optional mention role').setMinValues(0).setMaxValues(1)));
    rows.push(row(
      button('admin:social:edit', '✏️ Edit'),
      button('admin:social:test', '🧪 Test', ButtonStyle.Primary),
      button('admin:social:check', '🔄 Check'),
      button('admin:social:toggleAccount', account.enabled !== false ? '⏸️ Disable' : '▶️ Enable'),
      button('admin:social:delete', '🗑️ Delete', ButtonStyle.Danger),
    ));
  } else rows.push(row(button('admin:social:create', '➕ Add Creator', ButtonStyle.Success)));
  return { embeds: [embed('👥 Creator Accounts', description, interaction, account?.enabled === false ? 0x5865f2 : 0x57f287)], components: rows };
}

function studioPayload(interaction, config, session) {
  const account = selectedAccount(config, session);
  const template = config.templates?.[session.templateKey] || {};
  const previewTitle = clean(template.title || '{creator} alert', 256).replace('{creator}', account?.displayName || 'Creator').replace('{platform}', account?.platform || 'Platform');
  const previewDescription = clean(template.description || '{title}', 4096).replace('{creator}', account?.displayName || 'Creator').replace('{platform}', account?.platform || 'Platform').replace('{title}', 'Example content title').replace('{game}', 'Example category').replace('{viewers}', '1,234');
  const preview = new EmbedBuilder().setColor(0x5865f2).setTitle(previewTitle).setDescription(previewDescription).addFields(
    { name: 'Template', value: session.templateKey, inline: true },
    { name: 'Button', value: template.buttonLabel || 'Watch now', inline: true },
    { name: 'Bound Creator', value: account?.displayName || 'General preview', inline: true },
  ).setFooter({ text: 'Social Studio Preview' }).setTimestamp();
  return {
    embeds: [preview],
    components: [navigation(session.screen), accountSelector(config, session), templateSelector(session), row(
      button('admin:social:templateEdit', '✏️ Edit Template', ButtonStyle.Primary),
      button('admin:social:test', '🧪 Send Preview', ButtonStyle.Success, !account),
      button('admin:social:variables', '🧩 Variables'),
      button('admin:social:templateReset', '↩️ Reset Template', ButtonStyle.Danger),
    )],
  };
}

function providersPayload(interaction, config, session) {
  const providers = social.providers.listProviders();
  const lines = providers.map((provider) => {
    const enabled = config.providers?.[provider.id]?.enabled !== false;
    const status = enabled ? provider.status : 'disabled';
    return `${stateEmoji(status)} **${provider.label}** — ${status}\nSupported: ${(provider.supportedAlertTypes || []).join(', ') || 'None'} · Credentials: Goliath-managed`;
  });
  return {
    embeds: [embed('🔌 Provider Centre', ['Provider credentials are centrally managed by Goliath. Server admins only supply public creator identifiers.', '', ...lines].join('\n\n'), interaction)],
    components: [navigation(session.screen), row(
      button('admin:social:provider:twitch', 'Twitch'),
      button('admin:social:provider:youtube', 'YouTube'),
      button('admin:social:provider:tiktok', 'TikTok'),
      button('admin:social:provider:kick', 'Kick'),
      button('admin:social:provider:more', 'More'),
    ), row(button('admin:social:checkAll', '🔄 Run Provider Check', ButtonStyle.Primary, !config.accounts.length))],
  };
}

function operationsPayload(interaction, config, session) {
  const account = selectedAccount(config, session);
  const queueSummary = social.queue.summary(interaction.guildId);
  const historySummary = social.history.summary(interaction.guildId);
  const quiet = config.settings?.quietHours || {};
  const rows = [navigation(session.screen), accountSelector(config, session), operationSelector(session)];
  let description;

  if (session.operation.startsWith('routing_')) {
    const routeType = session.operation.replace('routing_', '');
    const channelId = account?.metadata?.routing?.[routeType] || account?.alertChannelId || null;
    description = [
      `**Creator:** ${account?.displayName || 'Select a creator'}`,
      `**Alert Type:** ${routeType}`,
      `**Resolved Destination:** ${channelId ? `<#${channelId}>` : 'Not configured'}`,
      '',
      'Choose a channel below to override this alert type. Clearing the route returns it to the creator default channel.',
    ].join('\n');
    rows.push(row(new ChannelSelectMenuBuilder().setCustomId('admin:social:routeChannel').setPlaceholder(`Route ${routeType} alerts`).setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1).setDisabled(!account)));
    rows.push(row(
      button('admin:social:routeClear', 'Clear Route', ButtonStyle.Secondary, !account),
      button('admin:social:test', 'Send Test', ButtonStyle.Success, !account),
    ));
  } else if (session.operation === 'quiet') {
    description = [
      `**Global Quiet Hours:** ${quiet.enabled ? 'Enabled 🌙' : 'Disabled'}`,
      `**Window:** ${quiet.start || '23:00'} → ${quiet.end || '08:00'}`,
      `**Timezone:** ${quiet.timeZone || 'UTC'}`,
      `**Creator Override:** ${account?.metadata?.quietHours?.enabled === true ? 'Enabled' : account?.metadata?.quietHours?.enabled === false ? 'Disabled' : 'Use global'}`,
      '',
      'Alerts detected during quiet hours are queued and delivered after the quiet window.',
    ].join('\n');
    rows.push(row(
      button('admin:social:quietGlobal', 'Edit Global Hours', ButtonStyle.Primary),
      button('admin:social:quietAccount', 'Creator Override', ButtonStyle.Secondary, !account),
      button('admin:social:queueProcess', 'Process Queue'),
    ));
  } else if (session.operation === 'history') {
    const entries = social.history.list(interaction.guildId, { accountId: account?.accountId, limit: 10 });
    description = [
      `**Recent Operations:** ${historySummary.total}`,
      `**Sent:** ${historySummary.sent} · **Failed:** ${historySummary.failed} · **Suppressed:** ${historySummary.suppressed}`,
      '',
      entries.length ? entries.map((entry) => `${entry.status === 'failed' ? '❌' : entry.status === 'sent' || entry.status === 'retried' ? '✅' : entry.status === 'suppressed' ? '🔇' : '•'} **${entry.status}** · ${entry.platform || 'social'} · ${entry.alertType}\n${entry.creator || entry.accountId || 'System'} · ${entry.reason || entry.error || entry.title || entry.createdAt}`).join('\n\n') : 'No matching history entries.',
    ].join('\n');
    rows.push(row(
      button('admin:social:historyRefresh', 'Refresh', ButtonStyle.Primary),
      button('admin:social:historyClear', 'Clear History', ButtonStyle.Danger, !historySummary.total),
    ));
  } else {
    const items = social.queue.list(interaction.guildId, { accountId: account?.accountId, limit: 25 });
    const selected = items.find((item) => item.id === session.queueId) || items[0] || null;
    if (selected && !session.queueId) session.queueId = selected.id;
    description = [
      `**Queue:** ${queueSummary.queued} waiting · ${queueSummary.failed} failed`,
      `**Next Attempt:** ${queueSummary.nextAttemptAt || 'None'}`,
      '',
      selected ? `**Selected:** ${selected.platform || 'social'} · ${selected.alertType}\n**Status:** ${selected.status} · attempt ${selected.attempts}/${social.queue.MAX_ATTEMPTS}\n**Reason:** ${selected.reason}\n**Last Error:** ${selected.lastError || 'None'}\n**Next Attempt:** ${selected.nextAttemptAt}` : 'No queued deliveries.',
    ].join('\n');
    rows.push(queueSelector(interaction.guildId, session));
    rows.push(row(
      button('admin:social:queueRetry', 'Retry Now', ButtonStyle.Primary, !selected),
      button('admin:social:queueRemove', 'Remove', ButtonStyle.Danger, !selected),
      button('admin:social:queueProcess', 'Process All', ButtonStyle.Success, !queueSummary.total),
      button('admin:social:queueClear', 'Clear Queue', ButtonStyle.Danger, !queueSummary.total),
    ));
  }

  return { embeds: [embed('🛠️ Social Operations', description, interaction, queueSummary.failed ? 0xed4245 : 0x5865f2)], components: rows };
}

async function healthPayload(interaction, config, session) {
  const health = await socialHealth.buildHealth(interaction.guild);
  const issues = health.issues.length ? health.issues.slice(0, 15).map((issue) => `• **${issue.code}**${issue.accountId ? ` — ${issue.accountId}` : ''}${issue.error ? `\n  ${clean(issue.error, 180)}` : ''}`).join('\n') : '• No issues found.';
  return {
    embeds: [embed('🩺 Social Health', [
      `**Status:** ${health.healthy ? 'Healthy ✅' : 'Needs attention ⚠️'}`,
      `**Accounts:** ${health.accountCount} total · ${health.enabledAccountCount} enabled`,
      `**Queue:** ${health.queue?.queued || 0} waiting · ${health.queue?.failed || 0} failed`,
      '',
      issues,
    ].join('\n'), interaction, health.healthy ? 0x57f287 : 0xfee75c)],
    components: [navigation(session.screen), row(
      button('admin:social:repair', '🛠️ Repair', ButtonStyle.Primary),
      button('admin:social:checkAll', '🔄 Check All'),
      button('admin:social:export', '📤 Export'),
      button('admin:social:reset', '🗑️ Reset', ButtonStyle.Danger),
    )],
  };
}

async function render(interaction) {
  const config = getConfig(interaction.guildId);
  const session = getSession(interaction);
  if (session.screen === SCREENS.CREATORS) return creatorsPayload(interaction, config, session);
  if (session.screen === SCREENS.STUDIO) return studioPayload(interaction, config, session);
  if (session.screen === SCREENS.PROVIDERS) return providersPayload(interaction, config, session);
  if (session.screen === SCREENS.OPERATIONS) return operationsPayload(interaction, config, session);
  if (session.screen === SCREENS.HEALTH) return healthPayload(interaction, config, session);
  return homePayload(interaction, config, session);
}

function createModal(account = null) {
  return new ModalBuilder().setCustomId(account ? 'admin:social:editSubmit' : 'admin:social:createSubmit').setTitle(account ? 'Edit Creator Account' : 'Add Creator Account').addComponents(
    row(new TextInputBuilder().setCustomId('platform').setLabel('Platform').setPlaceholder('twitch, youtube, tiktok, kick, instagram or x').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(20).setValue(account?.platform || '')),
    row(new TextInputBuilder().setCustomId('identifier').setLabel('Public username, channel name, ID or URL').setPlaceholder('@creator or https://platform.com/creator').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(500).setValue(account?.url || account?.username || account?.externalId || '')),
    row(new TextInputBuilder().setCustomId('name').setLabel('Display name').setPlaceholder('Creator name shown in Goliath').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(120).setValue(account?.displayName || '')),
    row(new TextInputBuilder().setCustomId('types').setLabel('Alert types').setPlaceholder('live, upload, short, post').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100).setValue((account?.alertTypes || ['live']).join(', '))),
    row(new TextInputBuilder().setCustomId('mention').setLabel('Mention mode').setPlaceholder('none, role, here or everyone').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(20).setValue(account?.mentionMode || 'none')),
  );
}

function templateModal(config, session) {
  const template = config.templates?.[session.templateKey] || {};
  return new ModalBuilder().setCustomId('admin:social:templateSubmit').setTitle(`Edit ${session.templateKey} alert`).addComponents(
    row(new TextInputBuilder().setCustomId('title').setLabel('Title').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(256).setValue(template.title || '{creator} alert')),
    row(new TextInputBuilder().setCustomId('description').setLabel('Description').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(2000).setValue(template.description || '{title}')),
    row(new TextInputBuilder().setCustomId('buttonLabel').setLabel('Button label').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(80).setValue(template.buttonLabel || 'Watch now')),
  );
}

function quietModal(config, account = null) {
  const quiet = account ? (account.metadata?.quietHours || {}) : (config.settings?.quietHours || {});
  return new ModalBuilder().setCustomId(account ? 'admin:social:quietAccountSubmit' : 'admin:social:quietGlobalSubmit').setTitle(account ? 'Creator Quiet Hours' : 'Global Quiet Hours').addComponents(
    row(new TextInputBuilder().setCustomId('enabled').setLabel(account ? 'Enabled: yes, no, or inherit' : 'Enabled: yes or no').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(10).setValue(account && quiet.enabled === undefined ? 'inherit' : quiet.enabled ? 'yes' : 'no')),
    row(new TextInputBuilder().setCustomId('start').setLabel('Start time (HH:MM)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(5).setValue(quiet.start || '23:00')),
    row(new TextInputBuilder().setCustomId('end').setLabel('End time (HH:MM)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(5).setValue(quiet.end || '08:00')),
    row(new TextInputBuilder().setCustomId('timezone').setLabel('IANA timezone').setPlaceholder('Europe/London').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80).setValue(quiet.timeZone || config.settings?.quietHours?.timeZone || 'Europe/London')),
  );
}

async function respond(interaction, payload) {
  const resolved = await Promise.resolve(payload);
  if (interaction.deferred || interaction.replied) await interaction.editReply(resolved);
  else await interaction.update(resolved);
  return true;
}

function parseEnabled(value, allowInherit = false) {
  const text = clean(value, 10).toLowerCase();
  if (allowInherit && text === 'inherit') return undefined;
  if (['yes', 'true', 'on', 'enabled'].includes(text)) return true;
  if (['no', 'false', 'off', 'disabled'].includes(text)) return false;
  throw new Error(allowInherit ? 'Enabled must be yes, no, or inherit.' : 'Enabled must be yes or no.');
}

async function handleSocialAdminInteraction(interaction) {
  const customId = String(interaction.customId || '');
  if (!customId.startsWith('admin:social')) return false;
  const actorId = interaction.user?.id || null;
  const session = getSession(interaction);

  try {
    if (customId === 'admin:social') { session.screen = SCREENS.HOME; return respond(interaction, render(interaction)); }
    if (interaction.isStringSelectMenu?.() && customId === 'admin:social:navigation') { session.screen = interaction.values[0]; return respond(interaction, render(interaction)); }
    if (interaction.isStringSelectMenu?.() && customId === 'admin:social:account') { session.accountId = interaction.values[0]; return respond(interaction, render(interaction)); }
    if (interaction.isStringSelectMenu?.() && customId === 'admin:social:template') { session.templateKey = interaction.values[0]; return respond(interaction, render(interaction)); }
    if (interaction.isStringSelectMenu?.() && customId === 'admin:social:operation') { session.operation = interaction.values[0]; return respond(interaction, render(interaction)); }
    if (interaction.isStringSelectMenu?.() && customId === 'admin:social:queueItem') { session.queueId = interaction.values[0]; return respond(interaction, render(interaction)); }

    if (customId === 'admin:social:create') { await interaction.showModal(createModal()); return true; }
    if (customId === 'admin:social:edit') { const account = selectedAccount(getConfig(interaction.guildId), session); if (!account) throw new Error('Select a creator account first.'); await interaction.showModal(createModal(account)); return true; }

    if ((customId === 'admin:social:createSubmit' || customId === 'admin:social:editSubmit') && interaction.isModalSubmit?.()) {
      const platform = clean(interaction.fields.getTextInputValue('platform'), 20).toLowerCase();
      if (!social.providers.getProvider(platform)) throw new Error('Unsupported platform.');
      const identifier = clean(interaction.fields.getTextInputValue('identifier'), 500);
      const name = clean(interaction.fields.getTextInputValue('name'), 120) || identifier;
      const alertTypes = clean(interaction.fields.getTextInputValue('types'), 100).split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
      const mentionMode = clean(interaction.fields.getTextInputValue('mention'), 20).toLowerCase();
      const existing = selectedAccount(getConfig(interaction.guildId), session);
      const payload = { platform, username: identifier, url: /^https?:\/\//i.test(identifier) ? identifier : '', displayName: name, alertTypes, mentionMode, createdBy: actorId };
      if (customId.endsWith('editSubmit') && existing) social.updateAccount(interaction.guildId, existing.accountId, payload, { actorId, action: 'social_discord_creator_edit' });
      else {
        const account = social.addAccount(interaction.guildId, payload, { actorId, action: 'social_discord_creator_create' });
        session.accountId = account.accountId;
      }
      session.screen = SCREENS.CREATORS;
      await interaction.reply({ content: '✅ Creator account saved. Goliath will resolve the public identifier during provider checks.', flags: 64 });
      return true;
    }

    if (customId === 'admin:social:templateEdit') { await interaction.showModal(templateModal(getConfig(interaction.guildId), session)); return true; }
    if (customId === 'admin:social:templateSubmit' && interaction.isModalSubmit?.()) {
      const config = social.store.getSocialSection(interaction.guildId);
      config.templates[session.templateKey] = {
        ...(config.templates?.[session.templateKey] || {}),
        title: clean(interaction.fields.getTextInputValue('title'), 256),
        description: clean(interaction.fields.getTextInputValue('description'), 2000),
        buttonLabel: clean(interaction.fields.getTextInputValue('buttonLabel'), 80) || 'Watch now',
      };
      social.store.saveSocialSection(interaction.guildId, config, { actorId, action: 'social_template_update' });
      await interaction.reply({ content: `✅ ${session.templateKey} alert template saved.`, flags: 64 });
      return true;
    }

    if (customId === 'admin:social:quietGlobal') { await interaction.showModal(quietModal(getConfig(interaction.guildId))); return true; }
    if (customId === 'admin:social:quietAccount') { const account = selectedAccount(getConfig(interaction.guildId), session); if (!account) throw new Error('Select a creator account first.'); await interaction.showModal(quietModal(getConfig(interaction.guildId), account)); return true; }
    if ((customId === 'admin:social:quietGlobalSubmit' || customId === 'admin:social:quietAccountSubmit') && interaction.isModalSubmit?.()) {
      const config = getConfig(interaction.guildId);
      const allowInherit = customId.endsWith('quietAccountSubmit');
      const quietHours = {
        enabled: parseEnabled(interaction.fields.getTextInputValue('enabled'), allowInherit),
        start: clean(interaction.fields.getTextInputValue('start'), 5),
        end: clean(interaction.fields.getTextInputValue('end'), 5),
        timeZone: clean(interaction.fields.getTextInputValue('timezone'), 80),
      };
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(quietHours.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(quietHours.end)) throw new Error('Quiet-hour times must use HH:MM.');
      new Intl.DateTimeFormat('en-GB', { timeZone: quietHours.timeZone }).format(new Date());
      if (allowInherit) {
        const account = selectedAccount(config, session); if (!account) throw new Error('Select a creator account first.');
        const metadata = { ...(account.metadata || {}), quietHours };
        if (quietHours.enabled === undefined) delete metadata.quietHours;
        social.updateAccount(interaction.guildId, account.accountId, { metadata }, { actorId, action: 'social_quiet_account_update' });
      } else {
        social.store.updateSocialSection(interaction.guildId, (section) => ({ ...section, settings: { ...(section.settings || {}), quietHours } }), { actorId, action: 'social_quiet_global_update' });
      }
      await interaction.reply({ content: '✅ Quiet hours updated.', flags: 64 });
      return true;
    }

    if (interaction.isChannelSelectMenu?.() && customId === 'admin:social:creatorChannel') {
      const account = selectedAccount(getConfig(interaction.guildId), session); if (!account) throw new Error('Select a creator account first.');
      social.updateAccount(interaction.guildId, account.accountId, { alertChannelId: interaction.values?.[0] || null }, { actorId, action: 'social_creator_channel_update' });
      return respond(interaction, render(interaction));
    }
    if (interaction.isRoleSelectMenu?.() && customId === 'admin:social:creatorRole') {
      const account = selectedAccount(getConfig(interaction.guildId), session); if (!account) throw new Error('Select a creator account first.');
      social.updateAccount(interaction.guildId, account.accountId, { mentionRoleId: interaction.values?.[0] || null, mentionMode: interaction.values?.[0] ? 'role' : 'none' }, { actorId, action: 'social_creator_role_update' });
      return respond(interaction, render(interaction));
    }
    if (interaction.isChannelSelectMenu?.() && customId === 'admin:social:routeChannel') {
      const account = selectedAccount(getConfig(interaction.guildId), session); if (!account) throw new Error('Select a creator account first.');
      const routeType = session.operation.replace('routing_', '');
      const routing = { ...(account.metadata?.routing || {}), [routeType]: interaction.values?.[0] || null };
      social.updateAccount(interaction.guildId, account.accountId, { metadata: { ...(account.metadata || {}), routing } }, { actorId, action: 'social_routing_update' });
      return respond(interaction, render(interaction));
    }

    if (customId === 'admin:social:enable' || customId === 'admin:social:disable') { social.setEnabled(interaction.guildId, customId.endsWith(':enable'), { actorId }); return respond(interaction, render(interaction)); }
    if (customId === 'admin:social:checkAll') { await interaction.deferReply({ flags: 64 }); const result = await social.scheduler.runSocialCheck(interaction.client, { guildIds: [interaction.guildId] }); await interaction.editReply(`✅ Social check complete. Accounts checked: **${result.accountCount || 0}**.`); return true; }
    if (customId === 'admin:social:repair') { await interaction.deferReply({ flags: 64 }); const result = await socialHealth.repair(interaction.guild, { actorId }); await interaction.editReply(`✅ Repair complete. Checked: **${result.repaired.length}** · Failed: **${result.failed.length}**.`); return true; }
    if (customId === 'admin:social:export') { const data = socialHealth.exportConfig(interaction.guildId); const file = new AttachmentBuilder(Buffer.from(JSON.stringify(data, null, 2)), { name: `social-${interaction.guildId}.json` }); await interaction.reply({ content: 'Social Studio configuration export.', files: [file], flags: 64 }); return true; }
    if (customId === 'admin:social:variables') { await interaction.reply({ content: `**Available variables**\n${VARIABLES.map((value) => `\`${value}\``).join(' · ')}`, flags: 64 }); return true; }

    const config = getConfig(interaction.guildId);
    const account = selectedAccount(config, session);
    if (customId === 'admin:social:test') { if (!account) throw new Error('Select a creator account first.'); await interaction.deferReply({ flags: 64 }); const result = await social.sendTestAlert(interaction.guildId, account.accountId, interaction.client, { actorId }); if (!result.success) throw new Error(result.error || 'Test alert failed.'); await interaction.editReply('✅ Test alert sent.'); return true; }
    if (customId === 'admin:social:check') { if (!account) throw new Error('Select a creator account first.'); await interaction.deferReply({ flags: 64 }); const result = await social.providers.checkAccount(account); social.updateAccount(interaction.guildId, account.accountId, { externalId: result.externalId || account.externalId, lastSeen: { ...(account.lastSeen || {}), lastCheckedAt: result.checkedAt || new Date().toISOString(), lastProviderStatus: result.providerStatus || result.status || 'unknown', lastProviderError: result.success ? '' : result.error || '' } }, { actorId, action: 'social_manual_provider_check' }); await interaction.editReply(`Provider check: **${result.providerStatus || result.status || 'unknown'}**${result.error ? `\n${result.error}` : ''}`); return true; }
    if (customId === 'admin:social:toggleAccount') { if (!account) throw new Error('Select a creator account first.'); social.updateAccount(interaction.guildId, account.accountId, { enabled: account.enabled === false }, { actorId }); return respond(interaction, render(interaction)); }
    if (customId === 'admin:social:routeClear') { if (!account) throw new Error('Select a creator account first.'); const routeType = session.operation.replace('routing_', ''); const routing = { ...(account.metadata?.routing || {}) }; delete routing[routeType]; social.updateAccount(interaction.guildId, account.accountId, { metadata: { ...(account.metadata || {}), routing } }, { actorId, action: 'social_routing_clear' }); return respond(interaction, render(interaction)); }

    if (customId === 'admin:social:queueProcess') { await interaction.deferReply({ flags: 64 }); const result = await social.queue.processGuild(interaction.guildId, interaction.client, { meta: { actorId, action: 'social_queue_process_discord' } }); await interaction.editReply(`✅ Queue processed. Sent: **${result.sent}** · Failed: **${result.failed}** · Deferred: **${result.deferred}**.`); return true; }
    if (customId === 'admin:social:queueRetry') { if (!session.queueId) throw new Error('Select a queued delivery first.'); social.queue.retryNow(interaction.guildId, session.queueId, { actorId, action: 'social_queue_retry_discord' }); await social.queue.processGuild(interaction.guildId, interaction.client, { meta: { actorId } }); return respond(interaction, render(interaction)); }
    if (customId === 'admin:social:queueRemove') { if (!session.queueId) throw new Error('Select a queued delivery first.'); social.queue.remove(interaction.guildId, session.queueId, { actorId, action: 'social_queue_remove_discord' }); session.queueId = null; return respond(interaction, render(interaction)); }
    if (customId === 'admin:social:queueClear') return respond(interaction, { content: 'Clear every queued and failed Social delivery?', embeds: [], components: [row(button('admin:social:queueClearConfirm', 'Confirm Clear', ButtonStyle.Danger), button('admin:social:navigationCancel', 'Cancel'))] });
    if (customId === 'admin:social:queueClearConfirm') { social.queue.clear(interaction.guildId, { actorId, action: 'social_queue_clear_discord' }); session.queueId = null; return respond(interaction, render(interaction)); }
    if (customId === 'admin:social:historyRefresh') return respond(interaction, render(interaction));
    if (customId === 'admin:social:historyClear') return respond(interaction, { content: 'Clear Social alert history for this server?', embeds: [], components: [row(button('admin:social:historyClearConfirm', 'Confirm Clear', ButtonStyle.Danger), button('admin:social:navigationCancel', 'Cancel'))] });
    if (customId === 'admin:social:historyClearConfirm') { social.history.clear(interaction.guildId, { actorId, action: 'social_history_clear_discord' }); return respond(interaction, render(interaction)); }
    if (customId === 'admin:social:navigationCancel') return respond(interaction, render(interaction));

    if (customId === 'admin:social:delete') { if (!account) throw new Error('Select a creator account first.'); return respond(interaction, { content: `Delete **${account.displayName}** from Social Studio?`, embeds: [], components: [row(button('admin:social:deleteConfirm', 'Confirm Delete', ButtonStyle.Danger), button('admin:social:navigationCancel', 'Cancel'))] }); }
    if (customId === 'admin:social:deleteConfirm') { if (!account) throw new Error('Creator account no longer exists.'); social.removeAccount(interaction.guildId, account.accountId, { actorId }); session.accountId = null; return respond(interaction, render(interaction)); }
    if (customId === 'admin:social:reset') return respond(interaction, { content: 'Reset Social Studio and remove all configured creator accounts, templates, history and queue?', embeds: [], components: [row(button('admin:social:resetConfirm', 'Confirm Reset', ButtonStyle.Danger), button('admin:social:navigationCancel', 'Cancel'))] });
    if (customId === 'admin:social:resetConfirm') { socialHealth.reset(interaction.guildId, { actorId }); sessions.delete(sessionKey(interaction)); return respond(interaction, render(interaction)); }
    if (customId === 'admin:social:templateReset') { const current = social.store.getSocialSection(interaction.guildId); const defaults = social.store.defaultSocialSection(); current.templates[session.templateKey] = defaults.templates[session.templateKey]; social.store.saveSocialSection(interaction.guildId, current, { actorId, action: 'social_template_reset' }); return respond(interaction, render(interaction)); }

    if (customId.startsWith('admin:social:provider:')) {
      const platform = customId.split(':')[3];
      if (platform === 'more') { await interaction.reply({ content: 'Instagram and X provider status is visible in Provider Centre. Goliath manages all provider credentials centrally.', flags: 64 }); return true; }
      const section = social.store.getSocialSection(interaction.guildId);
      const provider = section.providers?.[platform] || { enabled: true };
      section.providers[platform] = { ...provider, enabled: provider.enabled === false };
      social.store.saveSocialSection(interaction.guildId, section, { actorId, action: 'social_provider_toggle' });
      return respond(interaction, render(interaction));
    }

    return respond(interaction, render(interaction));
  } catch (error) {
    const payload = { content: `❌ Social Studio failed: ${error.message}`, flags: 64 };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => null);
    else await interaction.reply(payload).catch(() => null);
    return true;
  }
}

function buildSocialAdminPanel(guild, memberDisplayName = 'Administrator') {
  const fakeInteraction = { guild, guildId: guild.id, user: { id: 'panel', username: memberDisplayName }, member: { displayName: memberDisplayName } };
  sessions.set(`${guild.id}:panel`, { screen: SCREENS.HOME, accountId: getConfig(guild.id).accounts?.[0]?.accountId || null, templateKey: 'live', operation: 'routing_live', queueId: null });
  return homePayload(fakeInteraction, getConfig(guild.id), sessions.get(`${guild.id}:panel`));
}

module.exports = { buildSocialAdminPanel, handleSocialAdminInteraction };
