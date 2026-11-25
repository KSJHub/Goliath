'use strict';
const { navigationButton, goliathNavigation, emojiLabel, EMOJIS } = require('../../../core/guild/goliathNavigation');

const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  LabelBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} = require('discord.js');
const guildManager = require('../../../core/guild/guildManager');
const { variablesForModule } = require('../../../core/guild/guildVariables');
const {
  buildRolePicker,
  mergeRolePickerSelection,
  parseRolePickerId,
  rolePickerCustomId,
  rolePickerPageCount,
} = require('../../../core/ui/panelNavigation');
const timedRoles = require('./timedRoles');
const timedRolesHealth = require('./timedRolesHealth');

const PREFIX = 'admin:timedRoles';
const row = (...components) => new ActionRowBuilder().addComponents(...components.filter(Boolean));
const button = (customId, label, style = ButtonStyle.Secondary, disabled = false) => navigationButton(customId, label, style, disabled);

function formatDuration(rule) { return timedRoles.formatDuration(rule); }
function formatTimestamp(value, style = 'R') {
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) && timestamp > 0 ? `<t:${Math.floor(timestamp / 1000)}:${style}>` : 'Never';
}
function displayName(interaction) { return interaction.member?.displayName || interaction.user?.username || 'Unknown User'; }

async function buildTimedRolesPanel(guild, memberDisplayName = 'Unknown User', rolePage = 0) {
  const section = timedRoles.getSection(guild.id);
  const enabled = guildManager.isModuleEnabled(guild.id, 'timedRoles');
  const rules = timedRoles.listRules(guild.id);
  const health = await timedRolesHealth.buildTimedRolesHealth(guild);
  const mode = section.settings.progressionMode === 'keep_all' ? 'Keep every earned milestone role' : 'Keep highest milestone role only';
  const pageCount = rolePickerPageCount(guild);
  const safePage = Math.min(Math.max(0, Number(rolePage) || 0), pageCount - 1);
  const createPicker = buildRolePicker(guild, {
    customId: `${PREFIX}:createRole`,
    placeholder: 'Choose any role to create a milestone',
    minValues: 1,
    maxValues: 1,
    page: safePage,
    pagination: false,
  });
  const lines = rules.length
    ? rules.slice(0, 15).map((rule, index) => [
      `**${index + 1}. ${rule.enabled ? EMOJIS.SUCCESS : EMOJIS.USER_PAUSE} ${rule.name}**`,
      `↳ After **${formatDuration(rule)}** → <@&${rule.roleId}>`,
      rule.removeRoleIds.length ? `↳ Also removes ${rule.removeRoleIds.map((id) => `<@&${id}>`).join(', ')}` : null,
      rule.lastError ? `↳ ${EMOJIS.WARNING} ${rule.lastError}` : null,
    ].filter(Boolean).join('\n'))
    : ['No milestones configured. Select any role below to create the first one.'];

  const embed = new EmbedBuilder()
    .setColor(health.healthy ? 0x57F287 : 0xFAA61A)
    .setTitle(emojiLabel('TIMEOUT', 'Timed Roles · Member Tenure'))
    .setDescription([
      'Reward members automatically for how long they have stayed in the server.',
      '',
      `**Status:** ${enabled ? `Enabled ${EMOJIS.SUCCESS}` : `Disabled ${EMOJIS.ERROR}`}`,
      `**Progression:** ${mode}`,
      `**Promotion announcements:** ${section.settings.announcePromotions ? `Enabled in ${section.settings.announcementChannelId ? `<#${section.settings.announcementChannelId}>` : 'no channel selected'} ✅` : 'Disabled'}`,
      `**Scan interval:** ${section.settings.scanIntervalMinutes} minutes`,
      '',
      '### Configured milestones',
      ...lines,
      '',
      `Scans: \`${section.analytics.scans || 0}\` • Awarded: \`${section.analytics.awarded || 0}\` • Removed: \`${section.analytics.removed || 0}\` • Failed: \`${section.analytics.failed || 0}\``,
      `Last scan: ${formatTimestamp(section.analytics.lastScanAt)}`,
      '',
      health.issues.length ? `**Health issues**\n${health.issues.map((issue) => `• ${issue}`).join('\n')}` : '**Health:** Healthy ✅',
      health.warnings.length ? `\n**Warnings**\n${health.warnings.map((warning) => `• ${warning}`).join('\n')}` : '',
    ].join('\n').slice(0, 4096))
    .setFooter({ text: `Requested by ${memberDisplayName}` })
    .setTimestamp();

  const manageOptions = rules.length ? rules.slice(0, 25) : [{ ruleId: 'none', name: 'No milestones', enabled: false, value: 1, unit: 'day' }];
  return {
    embeds: [embed],
    components: [
      createPicker.rows[0],
      row(new StringSelectMenuBuilder()
        .setCustomId(`${PREFIX}:manage`)
        .setPlaceholder(rules.length ? 'Manage a milestone' : 'No milestones to manage')
        .setDisabled(!rules.length)
        .addOptions(manageOptions.map((rule) => new StringSelectMenuOptionBuilder()
          .setLabel(String(rule.name || 'Timed role').slice(0, 100))
          .setDescription(`${rule.enabled ? 'Enabled' : 'Disabled'} • ${formatDuration(rule)}`.slice(0, 100))
          .setValue(rule.ruleId)))),
      row(new UserSelectMenuBuilder().setCustomId(`${PREFIX}:preview`).setPlaceholder('Preview any member’s progression').setMinValues(1).setMaxValues(1)),
      row(
        button(`${PREFIX}:scan`, emojiLabel('INVESTIGATE', 'Scan Now'), ButtonStyle.Success),
        button(`${PREFIX}:simulate`, emojiLabel('TEST_SEND', 'Simulate'), ButtonStyle.Primary),
        button(`${PREFIX}:records`, emojiLabel('MEMBERS','Membership Records')),
        button(`${PREFIX}:maintenance`, emojiLabel('TOOLS', 'Maintenance')),
        button(`${PREFIX}:newReward`, emojiLabel('ADD','Create New Role'), ButtonStyle.Primary),
      ),
      goliathNavigation('admin:reactionRoles', PREFIX + ':settings'),
    ],
  };
}

function canViewMembershipRecords(interaction) {
  if(!interaction.guild?.id || !interaction.user?.id)return false;
  const access = timedRoles.getSection(interaction.guild.id).settings.recordsAccess || {};
  return interaction.user.id === interaction.guild.ownerId ||
    (access.allowAdministrators !== false && interaction.memberPermissions?.has('Administrator')) ||
    (Array.isArray(access.roleIds) ? access.roleIds : []).some(id => id !== interaction.guild.id && interaction.member?.roles?.cache?.has(id));
}
function buildRecordsAccessPanel(guild) {
  const access = timedRoles.getSection(guild.id).settings.recordsAccess || {};
  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle(emojiLabel('SETTINGS', 'Membership Records Access')).setDescription(
      'The guild owner always retains access.\nAdministrators: ' + (access.allowAdministrators !== false ? 'Allowed' : 'Not automatically allowed') +
      '\nAccess roles: ' + ((Array.isArray(access.roleIds) ? access.roleIds : []).map(id => '<@&' + id + '>').join(', ') || 'None')
    )],
    components: [
      row(new RoleSelectMenuBuilder().setCustomId(PREFIX + ':recordsAccessRoles').setPlaceholder('Choose permitted roles').setMinValues(0).setMaxValues(10)),
      row(button(PREFIX + ':recordsAccessToggle', 'Toggle administrator access')),
      row(button(PREFIX + ':settings', emojiLabel('BACK', 'Back'))),
    ],
  };
}
function buildMembershipRecordsPanel(guild, requestedPage = 0) {
  const records = Object.entries(guildManager.getGuildSection(guild.id, 'membershipRecords', {}).members || {}).filter(([id]) => /^\d{15,25}$/.test(id)).map(([id, record]) => ({ ...record, id })).sort((a,b) => a.id.localeCompare(b.id));
  const pages = Math.max(1, Math.ceil(records.length / 25));
  const page = Math.max(0, Math.min(pages - 1, Math.floor(Number(requestedPage) || 0)));
  const visible = records.slice(page * 25, page * 25 + 25);
  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('Membership Records').setDescription([
      'Guild membership history is retained independently of Timed Roles.',
      '**Tracked members:** ' + records.length,
      '**Active:** ' + records.filter(record => record.active === true).length,
      '**Inactive:** ' + records.filter(record => record.active === false).length,
      '**Unknown status:** ' + records.filter(record => record.active == null).length,
      'Browse current and departed members. Page ' + (page + 1) + ' of ' + pages,
    ].join('\n'))],
    components: [
      row(new UserSelectMenuBuilder().setCustomId(PREFIX + ':recordMember').setPlaceholder('Choose current member').setMinValues(1).setMaxValues(1)),
      ...(visible.length ? [row(new StringSelectMenuBuilder().setCustomId(PREFIX + ':recordHistorical').setPlaceholder('Browse recorded members').addOptions(visible.map(record => ({label:(guild.members.cache.get(record.id)?.displayName || record.id).slice(0,100),value:record.id,description:(record.active === true ? 'Active' : record.active === false ? 'Departed' : 'Unknown') + ' · ' + record.id}))))] : []),
      row(button(PREFIX + ':recordsPage:' + (page-1),emojiLabel('ROLE_PREVIOUS','Previous'),ButtonStyle.Secondary,page===0),button(PREFIX + ':recordsPage:' + (page+1),emojiLabel('ROLE_NEXT','Next'),ButtonStyle.Secondary,page>=pages-1),button(PREFIX + ':recordSearch',emojiLabel('SEARCH','Search'))),
      goliathNavigation(PREFIX,PREFIX + ':settings'),
    ],
  };
}
function buildMembershipRecordPanel(guild, id, canEdit = false) {
  const rules = timedRoles.listRules(guild.id).slice(0, 25);
  const record = guildManager.getGuildSection(guild.id, 'membershipRecords', {}).members?.[id];
  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('Membership Record').setDescription(record ? [
      '**Member:** <@' + id + '>',
      '**Original known join:** ' + formatTimestamp(record.firstJoinedAt, 'F'),
      '**Latest join:** ' + formatTimestamp(record.lastJoinedAt, 'F'),
      '**Last recorded departure:** ' + formatTimestamp(record.lastLeftAt, 'F'),
      '**Observed joins:** ' + (record.joinCount ?? 'Unknown'),
      '**User ID:** ' + id,
      '**Recent membership events:**\n' + (Array.isArray(record.history) ? record.history.slice(-5).map(event => String(event.type || 'Event') + ' · ' + formatTimestamp(event.at,'F')).join('\n') : 'None'),
      '**Status:** ' + (record.active == null ? 'Unknown' : record.active ? 'Active' : 'Inactive'),
    ].join('\n') : 'No membership record found.')],
    components: [
      ...(record && canEdit && rules.length ? [row(new StringSelectMenuBuilder().setCustomId(PREFIX + ':override:' + id).setPlaceholder('Edit individual milestone schedule').addOptions(rules.map(rule => ({ label: rule.name.slice(0,100), value: rule.ruleId }))))] : []),
      ...(record ? [row(button(PREFIX + ':recordAchievements:' + id,emojiLabel('ACHIEVEMENT','Achievements')))] : []),
      row(button(PREFIX + ':records', emojiLabel('BACK', 'Back'))),
    ],
  };
}

function buildRuleCelebrationPanel(guild, ruleId) {
  const rule = timedRoles.getRule(guild.id, ruleId);
  if (!rule) throw new Error('Milestone not found.');
  const own = rule.celebration || {};
  const s = { ...timedRoles.getSection(guild.id).settings, ...own };
  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('Celebration · ' + rule.name).setDescription([
      'Channel: ' + (s.announcementChannelId ? '<#' + s.announcementChannelId + '>' : 'Not selected') + (own.announcementChannelId ? '' : ' (inherited)'),
      'Format: ' + (s.celebrationEmbed === false ? 'Message' : 'Embed'),
      'Status: ' + (s.announcePromotions ? 'Enabled' : 'Disabled')
    ].join('\n'))],
    components: [
      row(new ChannelSelectMenuBuilder().setCustomId(PREFIX + ':ruleCelebrationChannel:' + ruleId).setPlaceholder('Choose channel or clear to inherit').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),
      row(new StringSelectMenuBuilder().setCustomId(PREFIX + ':ruleCelebrationFormat:' + ruleId).setPlaceholder('Message format').addOptions([
        {label:'Inherit global format',value:'inherit',default:own.celebrationEmbed === undefined},
        {label:'Embed',value:'embed',default:own.celebrationEmbed === true},
        {label:'Message',value:'message',default:own.celebrationEmbed === false}
      ])),
      row(button(PREFIX + ':ruleCelebrationEdit:' + ruleId,emojiLabel('EDIT','Edit Template')), button(PREFIX + ':ruleCelebrationPreview:' + ruleId,emojiLabel('PREVIEW','Preview'))),
      row(button(PREFIX + ':editBack:' + ruleId,emojiLabel('BACK','Back')))
    ]
  };
}
function buildRulePanel(guild, ruleId, rolePage = 0) {
  const rule = timedRoles.getRule(guild.id, ruleId);
  if (!rule) throw new Error('Timed role milestone not found.');
  const cleanupPicker = buildRolePicker(guild, {
    customId: `${PREFIX}:cleanup:${rule.ruleId}`,
    placeholder: 'Optional: roles to remove at this milestone',
    selectedIds: rule.removeRoleIds,
    minValues: 0,
    maxValues: 10,
    page: rolePage,
  });
  return {
    embeds: [new EmbedBuilder()
      .setColor(rule.enabled ? 0x5865F2 : 0x747F8D)
      .setTitle(emojiLabel('TIMER',rule.name))
      .setDescription([
        `**Award role:** ${guild.roles.cache.has(rule.roleId) ? `<@&${rule.roleId}>` : 'Missing — create a replacement role below.'}`,
        `**Required tenure:** ${formatDuration(rule)}`,
        `**Status:** ${rule.enabled ? `Enabled ${EMOJIS.SUCCESS}` : `Disabled ${EMOJIS.USER_PAUSE}`}`,
        `**Additional roles removed:** ${rule.removeRoleIds.length ? rule.removeRoleIds.map((id) => `<@&${id}>`).join(', ') : '`None`'}`,
        `**Last scan:** ${formatTimestamp(rule.lastRunAt)}`,
        `**Last awarded:** ${rule.lastAwarded || 0}`,
        rule.lastError ? `**Last error:** ${rule.lastError}` : '',
      ].filter(Boolean).join('\n'))],
    components: [
      ...cleanupPicker.rows,
      ...(!guild.roles.cache.has(rule.roleId) ? [row(new RoleSelectMenuBuilder().setCustomId(`${PREFIX}:replaceReward:${rule.ruleId}`).setPlaceholder('Select existing replacement role').setMinValues(1).setMaxValues(1))] : []),
      row(
        button(`${PREFIX}:edit:${rule.ruleId}`, emojiLabel('EDIT', 'Edit'), ButtonStyle.Primary),
        ...(guild.roles.cache.has(rule.roleId) ? [] : [button(`${PREFIX}:recoverRole:${rule.ruleId}`, 'Create Reward Role', ButtonStyle.Primary)]),
        button(`${PREFIX}:ruleCelebration:${rule.ruleId}`, 'Celebration'),
        button(`${PREFIX}:toggle:${rule.ruleId}`, rule.enabled ? emojiLabel('USER_PAUSE', 'Disable') : emojiLabel('USER_PLAY', 'Enable'), rule.enabled ? ButtonStyle.Secondary : ButtonStyle.Success),
        button(`${PREFIX}:delete:${rule.ruleId}`, emojiLabel('DELETE', 'Delete'), ButtonStyle.Danger),
      ),
      goliathNavigation(PREFIX,PREFIX + ':settings'),
    ],
  };
}

function buildSettingsPanel(guildId) {
  const section = timedRoles.getSection(guildId);
  const highestOnly = section.settings.progressionMode === 'highest_only';
  return {
    embeds: [new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(emojiLabel('SETTINGS', 'Timed Roles Settings'))
      .setDescription([
        `**Progression mode:** ${highestOnly ? 'Highest milestone only' : 'Keep all earned milestones'}`,
        `**Include bots:** ${section.settings.includeBots ? 'Yes' : 'No'}`,
        `**Scan interval:** ${section.settings.scanIntervalMinutes} minutes`,
        `**Announcements:** ${section.settings.announcePromotions ? 'Enabled' : 'Disabled'}`,
        `**Announcement channel:** ${section.settings.announcementChannelId ? `<#${section.settings.announcementChannelId}>` : 'Not selected'}`,
        '',
        '**Message placeholders**',
        '`{member}` • `{username}` • `{milestone}` • `{role}` • `{duration}` • `{server}` • `{joined}` • `{achieved}` • `{nextMilestone}` • `{nextDue}`',
        variablesForModule('timedRoles').map((entry) => `\`${entry.token}\``).join(' • ').slice(0, 900),
        '',
        `**Current message**\n${section.settings.announcementMessage}`,
      ].join('\n').slice(0, 4096))],
    components: [
      row(new ChannelSelectMenuBuilder()
        .setCustomId(`${PREFIX}:announcementChannel`)
        .setPlaceholder('Choose promotion announcement channel')
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(0).setMaxValues(1)),
      row(
        button(`${PREFIX}:toggleMode`, highestOnly ? emojiLabel('ACHIEVEMENT', 'Use Keep All') : emojiLabel('ROLE_GOLD_MEDAL', 'Use Highest Only'), ButtonStyle.Primary),
        button(`${PREFIX}:toggleAnnouncements`, section.settings.announcePromotions ? emojiLabel('WELCOME_MUTED', 'Disable Announcements') : emojiLabel('WELCOME_CHANNEL', 'Enable Announcements')),
        button(`${PREFIX}:toggleBots`, emojiLabel('AUTOMOD', 'Include Bots')),
      ),
      row(
        button(`${PREFIX}:interval`, emojiLabel('ROLE_CLOCK', 'Scan Interval')),
        button(`${PREFIX}:message`, emojiLabel('USER_FEEDBACK', 'Promotion Message')),
        button(`${PREFIX}:recordsAccess`, emojiLabel('PERMISSIONS','Records Access')),
        button(`${PREFIX}:celebrations`, emojiLabel('ACHIEVEMENT','Celebrations')),
        button(`${PREFIX}:logging`, emojiLabel('SCROLL','Logging')),
      ),
      row(button(PREFIX + ':auditPage:0',emojiLabel('HISTORY','Audit History'))),
      row(button(PREFIX, emojiLabel('BACK', 'Back'))),
    ],
  };
}

const LOG_EVENTS = ['milestone_created','milestone_updated','milestone_deleted','settings_updated','member_dates_updated','member_roles_changed','celebration_sent','celebration_failed','member_progression_failed'];
function buildAuditPanel(guildId, requestedPage = 0) {
  const events = timedRoles.getSection(guildId).operationalAudit || [];
  const pages = Math.max(1, Math.ceil(events.length / 5));
  const page = Math.max(0, Math.min(pages - 1, Number(requestedPage) || 0));
  const entries = events.slice().reverse().slice(page * 5, page * 5 + 5);
  const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('Timed Roles · Audit History').setDescription('Permanent records: ' + events.length + '\nPage ' + (page + 1) + ' of ' + pages);
  for (const event of entries) embed.addFields({ name: String(event.type || 'Event').replace(/_/g,' ').slice(0,256), value: (formatTimestamp(event.at,'F') + '\nActor: ' + (event.actorId ? '<@' + event.actorId + '>' : 'System / unknown') + '\n' + JSON.stringify(event.details || {})).slice(0,1024) });
  return { embeds: [embed], components: [
    row(button(PREFIX + ':auditPage:' + (page - 1),emojiLabel('ROLE_PREVIOUS','Previous'),ButtonStyle.Secondary,page === 0),button(PREFIX + ':auditPage:' + (page + 1),emojiLabel('ROLE_NEXT','Next'),ButtonStyle.Secondary,page >= pages - 1)),
    row(button(PREFIX + ':auditExport',emojiLabel('MOD_EXPORT','Export Audit'))),
    goliathNavigation(PREFIX + ':logging',PREFIX + ':settings')
  ] };
}
function buildLoggingPanel(guildId) {
  const s = timedRoles.getSection(guildId).settings.logging || {};
  const mode = s.mode || 'off';
  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('Timed Roles · Logging').setDescription('Permanent audit records remain active.\nNotification mode: ' + mode + '\nDestination: ' + (s.channelId ? '<#' + s.channelId + '>' : 'Not selected'))],
    components: [
      row(button(PREFIX + ':loggingChannelMode','Channel Logs: ' + (mode === 'channel' ? 'ON' : 'OFF'),mode === 'channel' ? ButtonStyle.Success : ButtonStyle.Secondary),button(PREFIX + ':loggingThreadMode','Thread Logs: ' + (mode === 'thread' ? 'ON' : 'OFF'),mode === 'thread' ? ButtonStyle.Success : ButtonStyle.Secondary)),
      row(new StringSelectMenuBuilder().setCustomId(PREFIX + ':loggingEvents').setPlaceholder('Select logging events').setMinValues(0).setMaxValues(LOG_EVENTS.length).addOptions(LOG_EVENTS.map(value => ({label:value.replace(/_/g,' '),value,default:(s.events || []).includes(value)})))),
      row(new ChannelSelectMenuBuilder().setCustomId(PREFIX + ':loggingDestination').setPlaceholder('Select logging channel').setChannelTypes(ChannelType.GuildText).setMinValues(0).setMaxValues(1)),
      row(new RoleSelectMenuBuilder().setCustomId(PREFIX + ':loggingRoles').setPlaceholder('Select notification roles').setMinValues(0).setMaxValues(10)),
      row(button(PREFIX + ':settings', emojiLabel('BACK','Back')))
    ]
  };
}
function buildCelebrationPanel(guildId) {
  const s = timedRoles.getSection(guildId).settings;
  const embed = new EmbedBuilder().setColor(0x57F287).setTitle(s.celebrationTitle || '{milestone} — Achievement Unlocked!').setDescription((s.announcementMessage || '').slice(0, 4096));
  if (s.celebrationGif && /^https:\/\//i.test(s.celebrationGif)) embed.setImage(s.celebrationGif);
  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('Celebration Settings').setDescription([
      'Announcements: ' + (s.announcePromotions ? 'Enabled' : 'Disabled'),
      'Channel: ' + (s.announcementChannelId ? '<#' + s.announcementChannelId + '>' : 'Not selected'),
      'Format: ' + (s.celebrationEmbed !== false ? 'Embed' : 'Message'),
      'Mentions: Individual member only',
      'Historical awards: ' + (s.celebrateRetroactive ? 'Celebrations allowed' : 'Silent'),
      'Template preview below (placeholders are not resolved).'
    ].join('\n')), embed],
    components: [
      row(new ChannelSelectMenuBuilder().setCustomId(PREFIX + ':celebrationChannel').setPlaceholder('Celebration channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),
      row(button(PREFIX + ':celebrationToggle', s.announcePromotions ? 'Disable' : 'Enable'), button(PREFIX + ':celebrationFormat', 'Switch Format'), button(PREFIX + ':celebrationEdit', emojiLabel('EDIT','Edit Template'))),
      row(button(PREFIX + ':settings', emojiLabel('BACK', 'Back'))),
    ],
  };
}
function readStartingPoint(interaction) {
  const startMode = interaction.fields.getStringSelectValues('startMode')[0];
  const date = interaction.fields.getTextInputValue('customStartAt').trim();
  if (!['original', 'continuous', 'custom'].includes(startMode)) throw new Error('Choose original, continuous or custom.');
  if (startMode === 'custom' && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) throw new Error('Enter a valid custom date in YYYY-MM-DD format.');
  return { startMode, customStartAt: startMode === 'custom' ? date : null };
}
function buildRuleModal(customId, title, rule = {}) {
  const field = (label, input) => new LabelBuilder().setLabel(label).setTextInputComponent(input);
  const select = (label, id, choices, selected) => new LabelBuilder().setLabel(label).setStringSelectMenuComponent(
    new StringSelectMenuBuilder().setCustomId(id).setMinValues(1).setMaxValues(1)
      .addOptions(choices.map(([value, name]) => ({ label: name, value, default: value === selected })))
  );
  return new ModalBuilder().setCustomId(customId).setTitle(title).addLabelComponents(
    field('Milestone name', new TextInputBuilder().setCustomId('name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100).setValue(rule.name || '')),
    field('Time value', new TextInputBuilder().setCustomId('value').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(6).setValue(String(rule.value || 1))),
    select('Time unit', 'unit', ['minutes','hours','days','weeks','months','years'].map(unit => [unit, unit[0].toUpperCase() + unit.slice(1)]), rule.unit || 'months'),
    select('Starting point', 'startMode', [['original','Original membership'],['continuous','Continuous membership'],['custom','Custom date']], rule.startMode || 'original'),
    field('Custom start date (YYYY-MM-DD)', new TextInputBuilder().setCustomId('customStartAt').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(10).setValue(rule.customStartAt?.slice(0, 10) || '')),
  );
}
function buildIntervalModal(current) {
  return new ModalBuilder().setCustomId(`${PREFIX}:intervalSubmit`).setTitle('Timed Roles Scan Interval').addComponents(
    row(new TextInputBuilder().setCustomId('minutes').setLabel('Minutes between scans (5–1440)').setStyle(TextInputStyle.Short).setRequired(true).setValue(String(current))),
  );
}
function buildMessageModal(current) {
  return new ModalBuilder().setCustomId(`${PREFIX}:messageSubmit`).setTitle('Promotion Announcement').addComponents(
    row(new TextInputBuilder().setCustomId('message').setLabel('Promotion message').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000).setValue(current)),
  );
}

async function buildPreviewPanel(guild, memberId) {
  const member = guild.members.cache.get(memberId) || await guild.members.fetch(memberId).catch(() => null);
  if (!member) throw new Error('Member not found.');
  const progression = timedRoles.getMemberProgression(member);
  const heldMilestones = timedRoles.listRules(guild.id).filter((rule) => member.roles.cache.has(rule.roleId));
  return {
    embeds: [new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(emojiLabel('SEARCH', 'Member Tenure Preview'))
      .setDescription([
        `**Member:** <@${member.id}>`,
        `**Original known join:** ${progression.joinedAt ? formatTimestamp(progression.joinedAt, 'F') : 'Unknown'}`,
        `**Current membership join:** ${formatTimestamp(member.joinedAt, 'F')}`,
        `**Current milestone:** ${progression.current ? `${progression.current.name} → <@&${progression.current.roleId}>` : 'No milestone reached yet'}`,
        `**Next milestone:** ${progression.next ? `${progression.next.name} → <@&${progression.next.roleId}>` : 'Highest configured milestone reached'}`,
        `**Next promotion:** ${progression.nextAt ? formatTimestamp(progression.nextAt) : 'None'}`,
        `**Milestone roles currently held:** ${heldMilestones.length ? heldMilestones.map((rule) => `<@&${rule.roleId}>`).join(', ') : 'None'}`,
        '',
        '> Preview does not change any roles.',
      ].join('\n'))],
    components: [row(
      button(`${PREFIX}:applyMember:${member.id}`, emojiLabel('SUCCESS', 'Apply Correct Roles'), ButtonStyle.Success),
      button(PREFIX, emojiLabel('BACK', 'Back')),
    )],
  };
}

function buildSimulationPanel(result) {
  const examples = result.changes.slice(0, 10).map((change) => `• <@${change.memberId}>: +${change.add.length} / -${change.remove.length}`);
  return {
    embeds: [new EmbedBuilder()
      .setColor(result.failed ? 0xFAA61A : 0x57F287)
      .setTitle(emojiLabel('TEST_SEND', 'Timed Roles Simulation'))
      .setDescription([
        'No roles were changed.',
        '',
        `**Members checked:** ${result.membersChecked}`,
        `**Roles to award:** ${result.awards}`,
        `**Roles to remove:** ${result.removals}`,
        `**Already correct:** ${result.unchanged}`,
        `**Failures:** ${result.failed}`,
        examples.length ? `\n**Example changes**\n${examples.join('\n')}` : '',
        result.changes.length > 10 ? `\n…and ${result.changes.length - 10} more member changes.` : '',
      ].filter(Boolean).join('\n'))],
    components: [row(
      button(`${PREFIX}:scan`, emojiLabel('DEPLOY', 'Apply Changes'), ButtonStyle.Success, !result.changes.length),
      button(PREFIX, emojiLabel('BACK', 'Back')),
    )],
  };
}

async function refresh(interaction, payload = null, rolePage = 0) {
  const next = payload || await buildTimedRolesPanel(interaction.guild, displayName(interaction), rolePage);
  if (interaction.deferred || interaction.replied) return interaction.editReply(next);
  return interaction.update(next);
}

async function handleTimedRolesInteraction(interaction) {
  const customId = String(interaction.customId || '');
  if (!customId.startsWith(PREFIX)) return false;
  try {
    if (customId === PREFIX) return refresh(interaction);
    if (customId === PREFIX + ':maintenance') {
      const enabled = guildManager.isModuleEnabled(interaction.guild.id,'timedRoles');
      const count = rolePickerPageCount(interaction.guild);
      return refresh(interaction, { embeds:[new EmbedBuilder().setColor(0x5865F2).setTitle(emojiLabel('TOOLS','Timed Roles Maintenance'))],components:[
        row(button(PREFIX + (enabled ? ':disable' : ':enable'),emojiLabel(enabled ? 'USER_PAUSE' : 'USER_PLAY',enabled ? 'Disable' : 'Enable')),button(PREFIX + ':repair',emojiLabel('REPAIR','Repair')),button(PREFIX + ':export',emojiLabel('MOD_EXPORT','Export'))),
        ...(count > 1 ? [row(new StringSelectMenuBuilder().setCustomId(PREFIX + ':rolePageSelect').setPlaceholder('Choose role picker page').addOptions(Array.from({length:Math.min(count,25)},(_,i)=>({label:'Role page ' + (i+1),value:String(i)}))))] : []),
        goliathNavigation(PREFIX,PREFIX + ':settings')
      ] });
    }
    if (customId === PREFIX + ':rolePageSelect') return refresh(interaction,null,Number(interaction.values[0]) || 0);
    if (customId.startsWith(PREFIX + ':auditPage:') || customId === PREFIX + ':auditExport') {
      if (interaction.user.id !== interaction.guild.ownerId && !interaction.memberPermissions?.has('Administrator')) throw new Error('Administrator access is required.');
      if (customId === PREFIX + ':auditExport') {
        const events = timedRoles.getSection(interaction.guild.id).operationalAudit || [];
        const file = Buffer.from(JSON.stringify(events,null,2),'utf8');
        if (file.length > 8 * 1024 * 1024) throw new Error('Audit export exceeds the safe attachment size.');
        return interaction.reply({ files: [new AttachmentBuilder(file,{name:'timed-roles-audit.json'})], ephemeral:true, allowedMentions:{parse:[]} });
      }
      const payload = buildAuditPanel(interaction.guild.id, Number(customId.split(':').pop()));
      if (interaction.message?.flags?.has(64)) return refresh(interaction,payload);
      return interaction.reply({ ...payload, ephemeral:true, allowedMentions:{parse:[]} });
    }
    if (customId.startsWith(PREFIX + ':logging')) {
      if (interaction.user.id !== interaction.guild.ownerId && !interaction.memberPermissions?.has('Administrator')) throw new Error('Administrator access is required.');
      const logging = { ...timedRoles.getSection(interaction.guild.id).settings.logging };
      const action = customId.slice((PREFIX + ':logging').length);
      if (action === 'ChannelMode' || action === 'ThreadMode') {
        const mode = action === 'ChannelMode' ? 'channel' : 'thread';
        logging.mode = logging.mode === mode ? 'off' : mode;
      } else if (action === 'Events') logging.events = interaction.values.filter(value => LOG_EVENTS.includes(value));
      else if (action === 'Destination') logging.channelId = interaction.values[0] || null;
      else if (action === 'Roles') logging.roleIds = interaction.values.filter(id => id !== interaction.guild.id && interaction.guild.roles.cache.has(id));
      else if (action !== '') throw new Error('Unknown logging control.');
      if (action) timedRoles.updateSettings(interaction.guild.id, { logging }, { actorId: interaction.user.id });
      return refresh(interaction, buildLoggingPanel(interaction.guild.id));
    }
    if ([PREFIX + ':recordSearch', PREFIX + ':recordSearchSubmit'].includes(customId)) {
      if (!canViewMembershipRecords(interaction)) throw new Error('You do not have permission to view membership records.');
      if (customId.endsWith(':recordSearch')) return interaction.showModal(new ModalBuilder().setCustomId(PREFIX + ':recordSearchSubmit').setTitle('Find Membership Record').addComponents(row(new TextInputBuilder().setCustomId('memberId').setLabel('Discord user ID or mention').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(30))));
      const id = interaction.fields.getTextInputValue('memberId').trim().replace(/^<@!?(\d+)>$/, '$1');
      if (!/^\d{15,25}$/.test(id)) throw new Error('Enter a valid Discord user ID.');
      if (!guildManager.getGuildSection(interaction.guild.id,'membershipRecords',{}).members?.[id]) throw new Error('No membership record exists for that user ID.');
      const payload = buildMembershipRecordPanel(interaction.guild,id,interaction.user.id === interaction.guild.ownerId || interaction.memberPermissions?.has('Administrator'));
      return interaction.reply({...payload,ephemeral:true,allowedMentions:{parse:[]}});
    }
    if (customId.startsWith(PREFIX + ':recordAchievements:')) {
      if (!canViewMembershipRecords(interaction)) throw new Error('You do not have permission to view membership records.');
      const [, , , id, requestedPage] = customId.split(':');
      if (!/^\d{15,25}$/.test(id)) throw new Error('Invalid member ID.');
      const section = timedRoles.getSection(interaction.guild.id);
      const entries = Object.entries(section.achievementHistory?.[id] || {}).sort((a,b) => String(b[1].achievedAt).localeCompare(String(a[1].achievedAt)));
      const pages = Math.max(1, Math.ceil(entries.length / 5));
      const page = Math.max(0,Math.min(pages-1,Math.floor(Number(requestedPage)||0)));
      const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('Membership · Achievements').setDescription('Member: <@' + id + '>\nRecorded achievements: ' + entries.length + '\nPage ' + (page+1) + ' of ' + pages);
      for (const [ruleId,entry] of entries.slice(page*5,page*5+5)) embed.addFields({name:(section.rules[ruleId]?.name || entry.milestoneName || 'Archived milestone ' + ruleId).slice(0,256),value:('Achieved: ' + formatTimestamp(entry.achievedAt,'F') + '\nReward: <@&' + entry.roleId + '>\nCelebration: ' + (entry.celebration || 'Unknown')).slice(0,1024)});
      const payload = { embeds:[embed],components:[row(button(PREFIX + ':recordAchievements:' + id + ':' + (page-1),emojiLabel('ROLE_PREVIOUS','Previous'),ButtonStyle.Secondary,page===0),button(PREFIX + ':recordAchievements:' + id + ':' + (page+1),emojiLabel('ROLE_NEXT','Next'),ButtonStyle.Secondary,page>=pages-1)),row(button(PREFIX + ':records',emojiLabel('BACK','Back')))] };
      if (interaction.message?.flags?.has(64)) return refresh(interaction,payload);
      return interaction.reply({...payload,ephemeral:true,allowedMentions:{parse:[]}});
    }
    if ([PREFIX + ':records', PREFIX + ':recordMember', PREFIX + ':recordHistorical'].includes(customId) || customId.startsWith(PREFIX + ':recordsPage:')) {
      if (!canViewMembershipRecords(interaction)) throw new Error('You do not have permission to view membership records.');
      const selected = customId.endsWith(':recordMember') || customId.endsWith(':recordHistorical');
      const payload = selected ? buildMembershipRecordPanel(interaction.guild, interaction.values[0], interaction.user.id === interaction.guild.ownerId || interaction.memberPermissions?.has('Administrator')) : buildMembershipRecordsPanel(interaction.guild, customId.startsWith(PREFIX + ':recordsPage:') ? Number(customId.split(':').pop()) : 0);
      if (interaction.message?.flags?.has(64)) return refresh(interaction,payload);
      return interaction.reply({ ...payload, ephemeral:true, allowedMentions:{parse:[]} });
    }

    if ([PREFIX + ':recordsAccess', PREFIX + ':recordsAccessRoles', PREFIX + ':recordsAccessToggle'].includes(customId)) {
      if (interaction.user.id !== interaction.guild.ownerId) throw new Error('Only the guild owner can change membership record access.');
      const access = timedRoles.getSection(interaction.guild.id).settings.recordsAccess || {};
      if (customId.endsWith('Roles')) {
        const ids=interaction.values || [];
        if(ids.length>10 || ids.some(id=>id===interaction.guild.id || !interaction.guild.roles.cache.has(id)))throw new Error('Select up to 10 valid guild roles other than @everyone.');
        timedRoles.updateSettings(interaction.guild.id,{recordsAccess:{...access,roleIds:[...new Set(ids)]}},{actorId:interaction.user.id});
      }
      if (customId.endsWith('Toggle')) timedRoles.updateSettings(interaction.guild.id, { recordsAccess: { ...access, allowAdministrators: access.allowAdministrators === false } }, {actorId:interaction.user.id});
      return refresh(interaction, buildRecordsAccessPanel(interaction.guild));
    }
    if (customId.startsWith(PREFIX + ':override:') || customId.startsWith(PREFIX + ':overrideSubmit:')) {
      if (!canViewMembershipRecords(interaction) || !(interaction.user.id === interaction.guild.ownerId || interaction.memberPermissions?.has('Administrator'))) throw new Error('Membership schedule editing requires administrator access.');
      const [, , action, memberId, submittedRule] = customId.split(':');
      const ruleId = action === 'override' ? interaction.values[0] : submittedRule;
      if (!timedRoles.getRule(interaction.guild.id, ruleId) || !guildManager.getGuildSection(interaction.guild.id, 'membershipRecords', {}).members?.[memberId]) throw new Error('Member record or milestone no longer exists.');
      if (action === 'override') {
        const current = timedRoles.getSection(interaction.guild.id).memberOverrides?.[memberId]?.[ruleId] || {};
        const dateField = (id, label) => {
          const input = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(10);
          if (current[id]) input.setValue(current[id].slice(0,10));
          return row(input);
        };
        return interaction.showModal(new ModalBuilder().setCustomId(PREFIX + ':overrideSubmit:' + memberId + ':' + ruleId).setTitle('Individual milestone schedule').addComponents(dateField('startAt','Start date (YYYY-MM-DD)'),dateField('dueAt','Due date (YYYY-MM-DD)')));
      }
      const dates = {};
      for (const key of ['startAt','dueAt']) {
        const value = interaction.fields.getTextInputValue(key).trim();
        if (value && (!/^\\d{4}-\\d{2}-\\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value)) throw new Error('Enter valid dates in YYYY-MM-DD format.');
        dates[key] = value || null;
      }
      timedRoles.setMemberMilestoneOverride(interaction.guild.id, memberId, ruleId, dates, { actorId: interaction.user.id });
      return refresh(interaction, buildMembershipRecordPanel(interaction.guild, memberId, true));
    }
    if (customId === PREFIX + ':newReward' || customId === PREFIX + ':newRewardSubmit' || customId.startsWith(PREFIX + ':replaceReward:')) {
      if (interaction.user.id !== interaction.guild.ownerId && !interaction.memberPermissions?.has('Administrator')) throw new Error('Administrator access is required.');
      if (customId === PREFIX + ':newReward') return interaction.showModal(buildRuleModal(PREFIX + ':newRewardSubmit', 'Create Milestone and Role'));
      const service = require('./timedRolesService');
      await interaction.deferUpdate();
      await service.withTimedRolesLock(interaction.guild.id, async () => {
        const guild = interaction.guild;
        if (!guild.members.me?.permissions.has('ManageRoles')) throw new Error('Goliath requires Manage Roles.');
        if (customId.startsWith(PREFIX + ':replaceReward:')) {
          const rule = timedRoles.getRule(guild.id, customId.split(':').pop());
          if (!rule) throw new Error('Milestone no longer exists.');
          const roles = await guild.roles.fetch();
          if (roles.has(rule.roleId)) throw new Error('The original reward role still exists.');
          const role = roles.get(interaction.values[0]);
          if (!role || role.id === guild.id || role.managed || role.position >= guild.members.me.roles.highest.position) throw new Error('Choose a manageable reward role.');
          if (timedRoles.listRules(guild.id).some(other => other.ruleId !== rule.ruleId && other.roleId === role.id)) throw new Error('This role is already assigned to a milestone.');
          timedRoles.saveRule(guild.id, { ...rule, roleId: role.id }, { actorId: interaction.user.id });
          return;
        }
        const name = interaction.fields.getTextInputValue('name').trim();
        const value = Number(interaction.fields.getTextInputValue('value'));
        const unit = interaction.fields.getStringSelectValues('unit')[0];
        const startingPoint = readStartingPoint(interaction);
        if (!name || !Number.isInteger(value) || value < 1 || value > 1000000 || !timedRoles.UNITS.includes(unit)) throw new Error('Enter a valid name and whole-number duration.');
        const roles = await guild.roles.fetch();
        if (roles.some(role => role.name.toLowerCase() === name.toLowerCase())) throw new Error('A role with this name exists. Select it from the existing role picker.');
        const role = await guild.roles.create({ name, permissions: [], mentionable: false, reason: 'Timed Roles milestone requested by ' + interaction.user.id });
        try {
          timedRoles.saveRule(guild.id, { name, value, unit, ...startingPoint, roleId: role.id, createdBy: interaction.user.id }, { actorId: interaction.user.id });
        } catch (error) {
          throw new Error('Role created (' + role.id + ') but milestone save failed. Select the existing role to retry: ' + error.message);
        }
      });
      return refresh(interaction);
    }
    if (customId.startsWith(PREFIX + ':recoverRole:')) {
      if (interaction.user.id !== interaction.guild.ownerId && !interaction.memberPermissions?.has('Administrator')) throw new Error('Administrator access is required.');
      const ruleId = customId.split(':').pop();
      await interaction.deferUpdate();
      const service = require('./timedRolesService');
      await service.withTimedRolesLock(interaction.guild.id, async () => {
        const rule = timedRoles.getRule(interaction.guild.id, ruleId);
        if (!rule) throw new Error('Milestone no longer exists.');
        const roles = await interaction.guild.roles.fetch();
        if (roles.has(rule.roleId)) throw new Error('The reward role already exists.');
        if (!interaction.guild.members.me?.permissions.has('ManageRoles')) throw new Error('Goliath requires Manage Roles.');
        const role = await interaction.guild.roles.create({ name: rule.name.slice(0,100), permissions: [], mentionable: false, reason: 'Timed Roles reward recovery requested by ' + interaction.user.id });
        timedRoles.saveRule(interaction.guild.id, { ...rule, roleId: role.id }, { actorId: interaction.user.id });
      });
      return refresh(interaction, buildRulePanel(interaction.guild, ruleId));
    }
    if ([PREFIX + ':celebrations', PREFIX + ':celebrationChannel', PREFIX + ':celebrationToggle', PREFIX + ':celebrationFormat', PREFIX + ':celebrationEdit', PREFIX + ':celebrationSubmit'].includes(customId)) {
      if (interaction.user.id !== interaction.guild.ownerId && !interaction.memberPermissions?.has('Administrator')) throw new Error('Administrator access is required.');
      const s = timedRoles.getSection(interaction.guild.id).settings;
      const patch = {};
      if (customId.endsWith(':celebrationChannel')) patch.announcementChannelId = interaction.values[0] || null;
      if (customId.endsWith(':celebrationToggle')) patch.announcePromotions = !s.announcePromotions;
      if (customId.endsWith(':celebrationFormat')) patch.celebrationEmbed = s.celebrationEmbed === false;
      if (customId.endsWith(':celebrationEdit')) {
        const field = (id, label, value, max, required, style) => {
          const input = new TextInputBuilder().setCustomId(id).setLabel(label).setMaxLength(max).setRequired(required).setStyle(style);
          if (value) input.setValue(value.slice(0,max));
          return row(input);
        };
        return interaction.showModal(new ModalBuilder().setCustomId(PREFIX + ':celebrationSubmit').setTitle('Celebration Template').addComponents(
          field('title','Title',s.celebrationTitle,256,true,TextInputStyle.Short),
          field('message','Message',s.announcementMessage,1000,true,TextInputStyle.Paragraph),
          field('gif','Optional HTTPS GIF URL',s.celebrationGif,1000,false,TextInputStyle.Short)
        ));
      }
      if (customId.endsWith(':celebrationSubmit')) {
        patch.celebrationTitle = interaction.fields.getTextInputValue('title').trim();
        patch.announcementMessage = interaction.fields.getTextInputValue('message').trim();
        const gif = interaction.fields.getTextInputValue('gif').trim();
        if (gif && (new URL(gif).protocol !== 'https:')) throw new Error('Use an HTTPS image URL.');
        if (!patch.celebrationTitle || !patch.announcementMessage) throw new Error('Title and message are required.');
        patch.celebrationGif = gif || null;
      }
      if (Object.keys(patch).length) timedRoles.updateSettings(interaction.guild.id, patch, { actorId: interaction.user.id });
      return refresh(interaction, buildCelebrationPanel(interaction.guild.id));
    }
    if (/^admin:timedRoles:ruleCelebration(?:Edit|Submit|Channel|Format|Preview)?:/.test(customId) || customId.startsWith(PREFIX + ':editBack:')) {
      if (interaction.user.id !== interaction.guild.ownerId && !interaction.memberPermissions?.has('Administrator')) throw new Error('Administrator access is required.');
      const ruleId = customId.split(':').pop();
      const rule = timedRoles.getRule(interaction.guild.id, ruleId);
      if (!rule) throw new Error('Milestone not found.');
      if (customId.startsWith(PREFIX + ':ruleCelebrationPreview:')) {
        const service = require('./timedRolesService');
        const member = await interaction.guild.members.fetch(interaction.user.id);
        const settings = { ...timedRoles.getSection(interaction.guild.id).settings, ...rule.celebration };
        const progression = timedRoles.getMemberProgression(member, timedRoles.listRules(interaction.guild.id));
        const channel = interaction.guild.channels.cache.get(settings.announcementChannelId) || interaction.channel;
        const { title, message } = service.renderCelebration(member, rule, interaction.guild.roles.cache.get(rule.roleId), settings, progression, channel);
        const allowedMentions = { parse: [], users: [], roles: [], repliedUser: false };
        if (settings.celebrationEmbed === false) return interaction.reply({ content: message.slice(0,2000), ephemeral: true, allowedMentions });
        const embed = new EmbedBuilder().setTitle(title.slice(0,256)).setDescription(message.slice(0,4096)).setColor(Number.isInteger(settings.celebrationColor) && settings.celebrationColor >= 0 && settings.celebrationColor <= 0xffffff ? settings.celebrationColor : 0x57F287).setTimestamp();
        if (settings.celebrationGif && /^https:\/\//i.test(settings.celebrationGif)) embed.setImage(settings.celebrationGif);
        return interaction.reply({ content: 'Private celebration preview — no achievement recorded.', embeds: [embed], ephemeral: true, allowedMentions });
      }
      if (customId.startsWith(PREFIX + ':editBack:')) return refresh(interaction, buildRulePanel(interaction.guild, ruleId));
      if (customId.startsWith(PREFIX + ':ruleCelebration:')) return refresh(interaction, buildRuleCelebrationPanel(interaction.guild, ruleId));
      if (customId.startsWith(PREFIX + ':ruleCelebrationChannel:') || customId.startsWith(PREFIX + ':ruleCelebrationFormat:')) {
        const celebration = { ...rule.celebration };
        if (customId.startsWith(PREFIX + ':ruleCelebrationChannel:')) {
          if (interaction.values[0]) celebration.announcementChannelId = interaction.values[0];
          else delete celebration.announcementChannelId;
        } else {
          const value = interaction.values[0];
          if (!['inherit','embed','message'].includes(value)) throw new Error('Invalid format.');
          if (value === 'inherit') delete celebration.celebrationEmbed;
          else celebration.celebrationEmbed = value === 'embed';
        }
        timedRoles.saveRule(interaction.guild.id, { ...rule, celebration }, { actorId: interaction.user.id });
        return refresh(interaction, buildRuleCelebrationPanel(interaction.guild, ruleId));
      }
      if (customId.startsWith(PREFIX + ':ruleCelebrationEdit:')) {
        const field = (id,label,value,max) => {
          const input = new TextInputBuilder().setCustomId(id).setLabel(label).setRequired(false).setMaxLength(max).setStyle(TextInputStyle.Short);
          if (value) input.setValue(String(value));
          return row(input);
        };
        const s = rule.celebration || {};
        return interaction.showModal(new ModalBuilder().setCustomId(PREFIX + ':ruleCelebrationSubmit:' + ruleId).setTitle('Milestone Celebration').addComponents(
          field('mode','Enabled / disabled / inherit',s.announcePromotions === undefined ? '' : s.announcePromotions ? 'enabled' : 'disabled',8),
          field('title','Title (blank inherits)',s.celebrationTitle,256),
          field('message','Message (blank inherits)',s.announcementMessage,1000),
          field('gif','HTTPS GIF URL (blank inherits)',s.celebrationGif,1000),
          field('color','Hex colour (blank inherits)',Number.isInteger(s.celebrationColor) ? s.celebrationColor.toString(16).padStart(6,'0') : '',7)
        ));
      }
      const read = id => interaction.fields.getTextInputValue(id).trim();
      const mode = read('mode').toLowerCase(), color = read('color'), gif = read('gif');
      if (mode && !['enabled','disabled','inherit'].includes(mode)) throw new Error('Choose enabled, disabled or inherit.');
      if (color && !/^#?[0-9a-f]{6}$/i.test(color)) throw new Error('Enter a six-digit hex colour.');
      if (gif && new URL(gif).protocol !== 'https:') throw new Error('Use an HTTPS GIF URL.');
      const celebration = { ...rule.celebration };
      for (const key of ['announcePromotions','celebrationTitle','announcementMessage','celebrationGif','celebrationColor']) delete celebration[key];
      if (mode === 'enabled' || mode === 'disabled') celebration.announcePromotions = mode === 'enabled';
      if (read('title')) celebration.celebrationTitle = read('title');
      if (read('message')) celebration.announcementMessage = read('message');
      if (gif) celebration.celebrationGif = gif;
      if (color) celebration.celebrationColor = parseInt(color.replace('#',''),16);
      timedRoles.saveRule(interaction.guild.id, { ...rule, celebration }, { actorId: interaction.user.id });
      return refresh(interaction, buildRuleCelebrationPanel(interaction.guild, ruleId));
    }
    const rolePicker = parseRolePickerId(customId);
    if (rolePicker?.baseId === `${PREFIX}:createRolePage` && rolePicker.kind === 'page') {
      return refresh(interaction, null, rolePicker.page);
    }
    if (rolePicker?.baseId === `${PREFIX}:createRole` && rolePicker.kind === 'select') {
      const roleId = interaction.values?.[0];
      if (!roleId || roleId === '__none__') throw new Error('Choose a role.');
      return interaction.showModal(buildRuleModal(`${PREFIX}:createSubmit:${roleId}`, 'Create Tenure Milestone'));
    }
    if (rolePicker?.baseId?.startsWith(`${PREFIX}:cleanup:`)) {
      const ruleId = rolePicker.baseId.slice(`${PREFIX}:cleanup:`.length);
      const rule = timedRoles.getRule(interaction.guild.id, ruleId);
      if (!rule) throw new Error('Timed role milestone not found.');
      if (rolePicker.kind === 'page') return refresh(interaction, buildRulePanel(interaction.guild, ruleId, rolePicker.page));
      const removeRoleIds = mergeRolePickerSelection(interaction.guild, rule.removeRoleIds, interaction.values || [], rolePicker.page);
      if (removeRoleIds.length > 10) throw new Error('A milestone can remove up to 10 roles. Remove a role before adding another.');
      timedRoles.saveRule(interaction.guild.id, { ...rule, removeRoleIds }, { actorId: interaction.user.id });
      return refresh(interaction, buildRulePanel(interaction.guild, ruleId, rolePicker.page));
    }

    if (interaction.isChannelSelectMenu?.() && customId === `${PREFIX}:announcementChannel`) {
      timedRoles.updateSettings(interaction.guild.id, { announcementChannelId: interaction.values[0] || null }, { actorId: interaction.user.id });
      return refresh(interaction, buildSettingsPanel(interaction.guild.id));
    }

    if (interaction.isUserSelectMenu?.() && customId === `${PREFIX}:preview`) {
      return refresh(interaction, await buildPreviewPanel(interaction.guild, interaction.values[0]));
    }

    if (interaction.isStringSelectMenu?.() && customId === `${PREFIX}:manage`) {
      return refresh(interaction, buildRulePanel(interaction.guild, interaction.values[0]));
    }

    if (interaction.isModalSubmit?.()) {
      if (customId.startsWith(`${PREFIX}:createSubmit:`)) {
        const roleId = customId.split(':').pop();
        timedRoles.saveRule(interaction.guild.id, {
          name: interaction.fields.getTextInputValue('name'),
          roleId,
          value: interaction.fields.getTextInputValue('value'),
          unit: interaction.fields.getStringSelectValues('unit')[0],
          ...readStartingPoint(interaction),
          createdBy: interaction.user.id,
        }, { actorId: interaction.user.id });
        return refresh(interaction);
      }
      if (customId.startsWith(`${PREFIX}:editSubmit:`)) {
        const ruleId = customId.split(':').pop();
        const rule = timedRoles.getRule(interaction.guild.id, ruleId);
        if (!rule) throw new Error('Timed role milestone not found.');
        timedRoles.saveRule(interaction.guild.id, {
          ...rule,
          name: interaction.fields.getTextInputValue('name'),
          value: interaction.fields.getTextInputValue('value'),
          unit: interaction.fields.getStringSelectValues('unit')[0],
          ...readStartingPoint(interaction),
        }, { actorId: interaction.user.id });
        return refresh(interaction, buildRulePanel(interaction.guild, ruleId));
      }
      if (customId === `${PREFIX}:intervalSubmit`) {
        timedRoles.updateSettings(interaction.guild.id, { scanIntervalMinutes: interaction.fields.getTextInputValue('minutes') }, { actorId: interaction.user.id });
        return refresh(interaction, buildSettingsPanel(interaction.guild.id));
      }
      if (customId === `${PREFIX}:messageSubmit`) {
        timedRoles.updateSettings(interaction.guild.id, { announcementMessage: interaction.fields.getTextInputValue('message') }, { actorId: interaction.user.id });
        return refresh(interaction, buildSettingsPanel(interaction.guild.id));
      }
    }

    if (customId === `${PREFIX}:settings`) return refresh(interaction, buildSettingsPanel(interaction.guild.id));
    if (customId === `${PREFIX}:enable`) guildManager.setModuleEnabled(interaction.guild.id, 'timedRoles', true, { actorId: interaction.user.id });
    if (customId === `${PREFIX}:disable`) guildManager.setModuleEnabled(interaction.guild.id, 'timedRoles', false, { actorId: interaction.user.id });
    if (customId === `${PREFIX}:toggleBots`) {
      const section = timedRoles.getSection(interaction.guild.id);
      timedRoles.updateSettings(interaction.guild.id, { includeBots: !section.settings.includeBots }, { actorId: interaction.user.id });
      return refresh(interaction, buildSettingsPanel(interaction.guild.id));
    }
    if (customId === `${PREFIX}:toggleMode`) {
      const section = timedRoles.getSection(interaction.guild.id);
      timedRoles.updateSettings(interaction.guild.id, { progressionMode: section.settings.progressionMode === 'highest_only' ? 'keep_all' : 'highest_only' }, { actorId: interaction.user.id });
      return refresh(interaction, buildSettingsPanel(interaction.guild.id));
    }
    if (customId === `${PREFIX}:toggleAnnouncements`) {
      const section = timedRoles.getSection(interaction.guild.id);
      timedRoles.updateSettings(interaction.guild.id, { announcePromotions: !section.settings.announcePromotions }, { actorId: interaction.user.id });
      return refresh(interaction, buildSettingsPanel(interaction.guild.id));
    }
    if (customId === `${PREFIX}:interval`) return interaction.showModal(buildIntervalModal(timedRoles.getSection(interaction.guild.id).settings.scanIntervalMinutes));
    if (customId === `${PREFIX}:message`) return interaction.showModal(buildMessageModal(timedRoles.getSection(interaction.guild.id).settings.announcementMessage));
    if (customId === `${PREFIX}:simulate`) {
      await interaction.deferUpdate();
      return refresh(interaction, buildSimulationPanel(await timedRoles.simulateGuild(interaction.guild)));
    }
    if (customId === `${PREFIX}:scan`) {
      await interaction.deferUpdate();
      await timedRoles.scanGuild(interaction.guild, { actorId: interaction.user.id });
      return refresh(interaction);
    }
    if (customId.startsWith(`${PREFIX}:applyMember:`)) {
      await interaction.deferUpdate();
      const memberId = customId.split(':').pop();
      const member = interaction.guild.members.cache.get(memberId) || await interaction.guild.members.fetch(memberId).catch(() => null);
      if (!member) throw new Error('Member not found.');
      await timedRoles.applyProgressionToMember(member);
      return refresh(interaction, await buildPreviewPanel(interaction.guild, memberId));
    }
    if (customId === `${PREFIX}:repair`) {
      await interaction.deferUpdate();
      await timedRolesHealth.repairTimedRoles(interaction.guild, { actorId: interaction.user.id });
      return refresh(interaction);
    }
    if (customId === `${PREFIX}:reset`) {
      return refresh(interaction,{embeds:[new EmbedBuilder().setColor(0xED4245).setTitle('Reset Timed Roles configuration?').setDescription('This resets milestone configuration. Membership records and achievement history are retained.')],components:[row(button(PREFIX+':confirmReset',emojiLabel('DELETE','Confirm Reset'),ButtonStyle.Danger)),row(button(PREFIX+':maintenance',emojiLabel('BACK','Back')))]});
    }
    if (customId === `${PREFIX}:confirmReset`) {
      await interaction.deferUpdate();
      timedRoles.reset(interaction.guild.id, { actorId: interaction.user.id });
      return refresh(interaction);
    }
    if (customId === `${PREFIX}:export`) {
      const exported = {
        ...timedRoles.exportConfiguration(interaction.guild.id),
        enabled: guildManager.isModuleEnabled(interaction.guild.id, 'timedRoles'),
      };
      const attachment = new AttachmentBuilder(Buffer.from(JSON.stringify(exported, null, 2), 'utf8'), { name: `goliath-timed-roles-${interaction.guild.id}.json` });
      await interaction.reply({ content: emojiLabel('MOD_EXPORT', 'Timed Roles configuration export.'), files: [attachment], ephemeral: true });
      return true;
    }
    if (customId.startsWith(`${PREFIX}:edit:`)) {
      const ruleId = customId.split(':').pop();
      const rule = timedRoles.getRule(interaction.guild.id, ruleId);
      if (!rule) throw new Error('Timed role milestone not found.');
      return interaction.showModal(buildRuleModal(`${PREFIX}:editSubmit:${ruleId}`, 'Edit Tenure Milestone', rule));
    }
    if (customId.startsWith(`${PREFIX}:duplicate:`)) {
      const ruleId = customId.split(':').pop();
      const rule = timedRoles.getRule(interaction.guild.id, ruleId);
      if (!rule) throw new Error('Timed role milestone not found.');
      timedRoles.saveRule(interaction.guild.id, { ...rule, ruleId: undefined, name: `${rule.name} Copy`, createdBy: interaction.user.id }, { actorId: interaction.user.id });
      return refresh(interaction);
    }
    if (customId.startsWith(`${PREFIX}:toggle:`)) {
      const ruleId = customId.split(':').pop();
      const rule = timedRoles.getRule(interaction.guild.id, ruleId);
      if (!rule) throw new Error('Timed role milestone not found.');
      timedRoles.saveRule(interaction.guild.id, { ...rule, enabled: !rule.enabled }, { actorId: interaction.user.id });
      return refresh(interaction, buildRulePanel(interaction.guild, ruleId));
    }
    if (customId.startsWith(`${PREFIX}:delete:`)) {
      const ruleId = customId.split(':').pop();
      const rule=timedRoles.getRule(interaction.guild.id,ruleId);
      if(!rule)throw new Error('Milestone not found.');
      return refresh(interaction,{embeds:[new EmbedBuilder().setColor(0xED4245).setTitle('Delete milestone?').setDescription('Delete **'+rule.name+'**? Existing Discord roles and historical membership records are not deleted.')],components:[row(button(PREFIX+':confirmDelete:'+ruleId,emojiLabel('DELETE','Confirm Delete'),ButtonStyle.Danger)),row(button(PREFIX+':editBack:'+ruleId,emojiLabel('BACK','Back')))]});
    }
    if (customId.startsWith(`${PREFIX}:confirmDelete:`)) {
      const ruleId=customId.split(':').pop();
      timedRoles.removeRule(interaction.guild.id, ruleId, { actorId: interaction.user.id });
      return refresh(interaction);
    }
    throw new Error('This Timed Roles control is no longer available. Reopen the module and try again.');
  } catch (error) {
    const payload = { content: `${EMOJIS.ERROR} Timed Roles setup failed: ${error.message}`, ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => null);
    else await interaction.reply(payload).catch(() => null);
    return true;
  }
}

module.exports = {
  canViewMembershipRecords,
  isMembershipReadControl: id => /^admin:timedRoles:(?:records|recordMember|recordHistorical|recordSearch|recordSearchSubmit|recordsPage:-?\d+|recordAchievements:\d{15,25}(?::-?\d+)?)$/.test(String(id || '')),
  PREFIX,
  formatDuration,
  buildOverview: buildTimedRolesPanel,
  buildTimedRolesPanel,
  buildSettingsPanel,
  buildPreviewPanel,
  handleTimedRolesInteraction,
};