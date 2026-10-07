'use strict';

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
} = require('discord.js');
const guildManager = require('../../guild/guildManager');
const panelNav = require('../../ui/panelNavigation');
const security = require('../../security/protection/core');

const PANEL_COLOR = '#5865F2';
const ENABLED_COLOR = '#57F287';
const DISABLED_COLOR = '#ED4245';
const MODULE = 'automod';

const AUTOMOD_RULES = {
  antiSpam: { label: '🚫 Spam', title: '🚫 Spam Protection', editLabel: '⏱️ Limits', defaults: { enabled: false, maxMessages: 5, intervalSeconds: 10, actions: ['delete'] } },
  antiLinks: { label: '🔗 Links', title: '🔗 Link Protection', editLabel: '🌐 Domains', defaults: { enabled: false, allowStaff: true, allowedDomains: [], deniedDomains: [], actions: ['delete'] } },
  badWords: { label: '🤬 Bad Words', title: '🤬 Bad Word Filter', editLabel: '📝 Word List', defaults: { enabled: false, words: [], actions: ['delete'] } },
  caps: { label: '🔠 Caps', title: '🔠 Caps Protection', editLabel: '📏 Thresholds', defaults: { enabled: false, percent: 70, minLength: 12, actions: ['warn'] } },
  mentions: { label: '📣 Mentions', title: '📣 Mention Protection', editLabel: '📣 Limits', defaults: { enabled: false, maxMentions: 5, maxUserMentions: 5, maxRoleMentions: 3, blockEveryone: true, risk: 35, timeoutMinutes: 10, actions: ['warn'] } },
  invites: { label: '✉️ Invites', title: '✉️ Invite Protection', editLabel: '🔗 Invites', defaults: { enabled: false, allowOwnServer: true, allowedCodes: [], risk: 35, timeoutMinutes: 10, actions: ['delete'] } },
  duplicates: { label: '♻️ Duplicates', title: '♻️ Duplicate Protection', editLabel: '⏱️ Limits', defaults: { enabled: false, maxDuplicates: 3, intervalSeconds: 30, risk: 25, timeoutMinutes: 10, actions: ['delete'] } },
  flood: { label: '🌊 Flood', title: '🌊 Flood Protection', editLabel: '📏 Limits', defaults: { enabled: false, maxLines: 12, maxCharacters: 1800, maxRepeatedCharacters: 12, risk: 20, timeoutMinutes: 10, actions: ['delete'] } },
  emojiSpam: { label: '😀 Emoji', title: '😀 Emoji Protection', editLabel: '😀 Limit', defaults: { enabled: false, maxEmojis: 15, risk: 15, timeoutMinutes: 10, actions: ['delete'] } },
  attachments: { label: '📎 Attachments', title: '📎 Attachment Protection', editLabel: '📎 Limits', defaults: { enabled: false, maxAttachments: 5, blockedExtensions: [], risk: 20, timeoutMinutes: 10, actions: ['delete'] } },
};
const AUTOMOD_RULE_KEYS = Object.keys(AUTOMOD_RULES);
const AUTOMOD_ACTIONS = ['dm', 'delete', 'warn', 'timeout', 'kick', 'ban'];
const ACTION_LABELS = { dm: 'DM User', delete: 'Delete Message', warn: 'Warn User', timeout: 'Timeout User', kick: 'Kick User', ban: 'Ban User' };
const DEFAULT_DM_MESSAGES = {
  antiSpam: '⚠️ **{server} AutoMod**\nSpam Protection triggered: {reason}',
  antiLinks: '⚠️ **{server} AutoMod**\nLink Protection triggered: {reason}',
  badWords: '⚠️ **{server} AutoMod**\nBad Word Filter triggered: {reason}',
  caps: '⚠️ **{server} AutoMod**\nCaps Protection triggered: {reason}',
  mentions: '⚠️ **{server} AutoMod**\nMention Protection triggered: {reason}',
  invites: '⚠️ **{server} AutoMod**\nInvite Protection triggered: {reason}',
  duplicates: '⚠️ **{server} AutoMod**\nDuplicate Message Protection triggered: {reason}',
  flood: '⚠️ **{server} AutoMod**\nFlood Protection triggered: {reason}',
  emojiSpam: '⚠️ **{server} AutoMod**\nEmoji Protection triggered: {reason}',
  attachments: '⚠️ **{server} AutoMod**\nAttachment Protection triggered: {reason}',
};

const row = (...components) => new ActionRowBuilder().addComponents(...components);
const button = (id, label, style = ButtonStyle.Primary, disabled = false) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
const getMemberDisplayName = (interaction) => interaction.member?.displayName || interaction.user?.displayName || interaction.user?.username || 'Unknown User';
const status = (value) => value ? 'Enabled ✅' : 'Disabled ❌';
const canUseAutoMod = (interaction) => Boolean(
  security.hasPermission(interaction, 'admin')
  || security.isBotOwner(interaction.user?.id)
  || interaction.guild?.ownerId === interaction.user?.id
  || interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)
);

function createEmbed(title, description, memberDisplayName, color = PANEL_COLOR) {
  const embed = new EmbedBuilder().setColor(color).setTitle(title).setTimestamp();
  if (description) embed.setDescription(description);
  if (memberDisplayName) embed.setFooter({ text: `Requested by ${memberDisplayName}` });
  return embed;
}

function normalizeActions(value, fallback = ['delete']) {
  const actions = [...new Set((Array.isArray(value) ? value : value ? [value] : fallback)
    .map((entry) => String(entry).toLowerCase())
    .filter((entry) => AUTOMOD_ACTIONS.includes(entry)))];
  const compatible = actions.includes('ban') ? actions.filter((entry) => entry !== 'kick') : actions;
  return compatible.length ? compatible : [...fallback];
}

const formatActions = (actions) => normalizeActions(actions).map((entry) => ACTION_LABELS[entry]).join(', ');

function defaults() {
  return {
    dmUser: true,
    dmMessages: { ...DEFAULT_DM_MESSAGES },
    ...Object.fromEntries(AUTOMOD_RULE_KEYS.map((key) => [key, { ...AUTOMOD_RULES[key].defaults }])),
    ignoredRoles: [],
    ignoredChannels: [],
    ignoredCategories: [],
    ignoredUsers: [],
    caseMode: 'punishments',
    evidenceRetentionDays: 30,
    risk: { enabled: true, low: 25, medium: 50, high: 75, critical: 100, repeatWindowHours: 24, repeatWeight: 10 },
  };
}

function getAutomodConfig(guildId) {
  const current = guildManager.getGuildSection(guildId, MODULE, {});
  const base = defaults();
  const output = { ...base, ...current, enabled: guildManager.isModuleEnabled(guildId, MODULE) };
  for (const key of AUTOMOD_RULE_KEYS) {
    const entry = current[key] || {};
    output[key] = { ...base[key], ...entry, actions: normalizeActions(entry.actions || entry.action, base[key].actions) };
    delete output[key].action;
  }
  output.antiLinks.allowedDomains = Array.isArray(output.antiLinks.allowedDomains) ? output.antiLinks.allowedDomains : [];
  output.antiLinks.deniedDomains = Array.isArray(output.antiLinks.deniedDomains) ? output.antiLinks.deniedDomains : [];
  output.badWords.words = Array.isArray(output.badWords.words) ? output.badWords.words : [];
  output.invites.allowedCodes = Array.isArray(output.invites.allowedCodes) ? output.invites.allowedCodes : [];
  output.attachments.blockedExtensions = Array.isArray(output.attachments.blockedExtensions) ? output.attachments.blockedExtensions : [];
  output.dmMessages = { ...DEFAULT_DM_MESSAGES, ...(current.dmMessages || {}) };
  output.ignoredRoles = Array.isArray(current.ignoredRoles) ? current.ignoredRoles : [];
  output.ignoredChannels = Array.isArray(current.ignoredChannels) ? current.ignoredChannels : [];
  output.ignoredCategories = Array.isArray(current.ignoredCategories) ? current.ignoredCategories : [];
  output.ignoredUsers = Array.isArray(current.ignoredUsers) ? current.ignoredUsers : [];
  return output;
}

function saveAutomodConfig(guildId, config) {
  const { enabled: _enabled, ...section } = config || {};
  return guildManager.replaceGuildSection(guildId, MODULE, section);
}

function setAutomodEnabled(guildId, enabled, actorId = null) {
  return guildManager.setModuleEnabled(guildId, MODULE, Boolean(enabled), {
    actorId,
    action: 'automod_panel_toggle',
  });
}

function getLogChannelId(guildId) {
  return typeof guildManager.getLogChannelId === 'function'
    ? guildManager.getLogChannelId(guildId, 'automod')
    : guildManager.getGuildSection(guildId, 'logs', { channels: {} })?.channels?.automod || null;
}

function setLogChannelId(guildId, channelId = null) {
  if (typeof guildManager.setLogChannelId === 'function') return guildManager.setLogChannelId(guildId, 'automod', channelId);
  const logs = guildManager.getGuildSection(guildId, 'logs', { enabled: true, channels: {}, events: {} });
  return guildManager.replaceGuildSection(guildId, 'logs', { ...logs, channels: { ...(logs.channels || {}), automod: channelId } });
}

function canonicalState(route = 'admin:automod') {
  if (route === 'admin:automod') return { history: ['admin:home', 'admin:automod'] };
  if (route === 'admin:automod:configure' || route.startsWith('admin:automod:rule:')) return { history: ['admin:home', 'admin:automod', route] };
  if (route === 'admin:channel:automodlog') return { history: ['admin:home', 'admin:automod', 'admin:automod:configure', route] };
  return { history: ['admin:home', 'admin:automod'] };
}

const backButton = (route) => button(panelNav.buildCustomId(canonicalState(route), 'back'), '⬅️ Back', ButtonStyle.Secondary);
const navRow = (route, nextId, settingsId = null) => row(backButton(route), ...(settingsId ? [button(settingsId, '⚙️ Settings', ButtonStyle.Primary)] : []), button(nextId, 'Next ➡️', ButtonStyle.Secondary));

function buildAutomodPanel(guild, name = 'Unknown User') {
  const config = getAutomodConfig(guild.id);
  const enabledRules = AUTOMOD_RULE_KEYS.filter((key) => config[key].enabled).length;
  const selector = new StringSelectMenuBuilder()
    .setCustomId('admin:automod:protection')
    .setPlaceholder('Choose a protection to manage')
    .addOptions(AUTOMOD_RULE_KEYS.map((key) => ({
      label: AUTOMOD_RULES[key].title.replace(/^\S+\s/, '').slice(0, 100),
      value: key,
      description: (config[key].enabled ? 'Enabled' : 'Disabled') + ' • Risk ' + Number(config[key].risk || 0),
    })));
  return {
    embeds: [createEmbed('🤖 AutoMod Protection', [
      '**System:** ' + status(config.enabled),
      '**Protections:** ' + enabledRules + '/' + AUTOMOD_RULE_KEYS.length + ' enabled',
      '**Case policy:** ' + String(config.caseMode || 'punishments'),
      '**Evidence retention:** ' + Number(config.evidenceRetentionDays || 0) + ' days',
      '**Exceptions:** ' + ((config.ignoredRoles?.length || 0) + (config.ignoredChannels?.length || 0) + (config.ignoredCategories?.length || 0) + (config.ignoredUsers?.length || 0)),
      '',
      'AutoMod evaluates every enabled protection together, correlates violations into one incident and applies one compatible enforcement decision.',
      '',
      ...AUTOMOD_RULE_KEYS.map((key) => AUTOMOD_RULES[key].label + ': **' + (config[key].enabled ? 'ON' : 'OFF') + '**'),
    ].join('\n'), name, config.enabled ? ENABLED_COLOR : DISABLED_COLOR)],
    components: [
      row(selector),
      row(button('admin:automod:configure', '⚙️ System Settings'), button('admin:automod:risk', '🎯 Risk & Cases', ButtonStyle.Secondary)),
      navRow('admin:automod', 'admin:adminpanel'),
    ],
  };
}

function buildAutomodConfigurePanel(guild, name = 'Unknown User') {
  const config = getAutomodConfig(guild.id);
  return {
    embeds: [createEmbed('⚙️ AutoMod Settings', [
      `**AutoMod:** ${status(config.enabled)}`,
      `**DM users:** ${status(config.dmUser !== false)}`,
      `**AutoMod log:** ${getLogChannelId(guild.id) ? `<#${getLogChannelId(guild.id)}>` : 'Not set'}`,
      '',
      'Configure AutoMod status, logging and the DM sent for each infraction.',
    ].join('\n'), name, config.enabled ? ENABLED_COLOR : DISABLED_COLOR)],
    components: [
      row(
        button('admin:automod:toggle', config.enabled ? 'Disable AutoMod' : 'Enable AutoMod', config.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        button('admin:automod:dm', config.dmUser !== false ? 'Disable DMs' : 'Enable DMs', config.dmUser !== false ? ButtonStyle.Danger : ButtonStyle.Success),
        button('admin:automod:risk', '🎯 Risk & Cases', ButtonStyle.Primary)
      ),
      row(button('admin:setautomodlog', '🤖 AutoMod Log', ButtonStyle.Secondary), button('admin:automod:reset', '♻️ Reset', ButtonStyle.Danger)),
      navRow('admin:automod:configure', 'admin:automod:rule:antiSpam'),
    ],
  };
}

function buildRiskPanel(guild, name = 'Unknown User') {
  const config = getAutomodConfig(guild.id);
  const risk = config.risk || {};
  return {
    embeds: [createEmbed('🎯 AutoMod Risk, Cases & Evidence', [
      '**Risk engine:** ' + status(risk.enabled !== false),
      '**Thresholds:** Low ' + (risk.low || 25) + ' • Medium ' + (risk.medium || 50) + ' • High ' + (risk.high || 75) + ' • Critical ' + (risk.critical || 100),
      '**Repeat window:** ' + (risk.repeatWindowHours || 24) + 'h • +' + (risk.repeatWeight || 10) + ' risk per recent incident',
      '**Case policy:** ' + (config.caseMode || 'punishments'),
      '**Evidence retention:** ' + Number(config.evidenceRetentionDays || 0) + ' days',
      '',
      'Risk combines every protection triggered by the same message. Repeat incidents increase risk without silently changing the configured punishment actions.',
    ].join('\n'), name, PANEL_COLOR)],
    components: [
      row(button('admin:automod:risk:edit', '⚙️ Configure Risk & Cases'), button('admin:automod', '🛡️ Protections', ButtonStyle.Secondary)),
      row(backButton('admin:automod:configure')),
    ],
  };
}
function buildRiskModal(config) {
  const risk=config.risk||{};
  return new ModalBuilder().setCustomId('admin:automod:risk:modal').setTitle('Risk, Cases & Evidence').addComponents(
    textInput('thresholds','Risk thresholds: low,medium,high,critical',[risk.low||25,risk.medium||50,risk.high||75,risk.critical||100].join(',')),
    textInput('repeat','Repeat window hours, risk weight',[risk.repeatWindowHours||24,risk.repeatWeight||10].join(',')),
    textInput('caseMode','Case mode: off/punishments/medium/all',config.caseMode||'punishments'),
    textInput('retention','Evidence retention days (0-365)',config.evidenceRetentionDays??30)
  );
}
function buildRuleDmModal(key, config) {
  return new ModalBuilder().setCustomId('admin:automod:rule:'+key+':dm:modal').setTitle('Member Notice').addComponents(
    textInput('message','DM message for this protection',config.dmMessages?.[key]||DEFAULT_DM_MESSAGES[key],{required:false,style:TextInputStyle.Paragraph,maxLength:1000})
  );
}

function ruleSummary(key, rule) {
  const enforcement='**Risk:** '+Number(rule.risk||0)+'\n**Timeout:** '+Number(rule.timeoutMinutes||10)+' minutes\n**Actions:** '+formatActions(rule.actions);
  if(key==='antiSpam') return '**Maximum messages:** '+rule.maxMessages+'\n**Window:** '+rule.intervalSeconds+' seconds\n'+enforcement;
  if(key==='antiLinks') return '**Staff bypass:** '+(rule.allowStaff?'Yes':'No')+'\n**Allowed domains:** '+(rule.allowedDomains?.length||0)+'\n**Denied domains:** '+(rule.deniedDomains?.length||0)+'\n'+enforcement;
  if(key==='badWords') return '**Blocked words/phrases:** '+(rule.words?.length||0)+'\n**Matching:** '+(rule.matchMode||'boundary')+'\n'+enforcement;
  if(key==='caps') return '**Caps threshold:** '+rule.percent+'%\n**Minimum length:** '+rule.minLength+'\n'+enforcement;
  if(key==='mentions') return '**Total mentions:** '+rule.maxMentions+'\n**User/Role limits:** '+rule.maxUserMentions+'/'+rule.maxRoleMentions+'\n**@everyone/@here:** '+(rule.blockEveryone?'Blocked':'Allowed')+'\n'+enforcement;
  if(key==='invites') return '**Allow own server:** '+(rule.allowOwnServer?'Yes':'No')+'\n**Allowed invite codes:** '+(rule.allowedCodes?.length||0)+'\n'+enforcement;
  if(key==='duplicates') return '**Duplicates:** '+rule.maxDuplicates+' in '+rule.intervalSeconds+' seconds\n'+enforcement;
  if(key==='flood') return '**Lines:** '+rule.maxLines+'\n**Characters:** '+rule.maxCharacters+'\n**Repeated characters:** '+rule.maxRepeatedCharacters+'\n'+enforcement;
  if(key==='emojiSpam') return '**Maximum emojis:** '+rule.maxEmojis+'\n'+enforcement;
  if(key==='attachments') return '**Maximum attachments:** '+rule.maxAttachments+'\n**Blocked extensions:** '+(rule.blockedExtensions?.join(', ')||'None')+'\n'+enforcement;
  return enforcement;
}

function nextRuleId(key) {
  const index = AUTOMOD_RULE_KEYS.indexOf(key);
  return index === AUTOMOD_RULE_KEYS.length - 1 ? 'admin:automod' : `admin:automod:rule:${AUTOMOD_RULE_KEYS[index + 1]}`;
}

function buildActionSelect(key, rule) {
  return new StringSelectMenuBuilder()
    .setCustomId(`admin:automod:rule:${key}:actions`)
    .setPlaceholder('Select one or more actions')
    .setMinValues(1)
    .setMaxValues(AUTOMOD_ACTIONS.length)
    .addOptions(AUTOMOD_ACTIONS.map((value) => ({ label: ACTION_LABELS[value], value, default: normalizeActions(rule.actions).includes(value) })));
}

function buildAutomodRulePanel(guild, key, name = 'Unknown User') {
  const config = getAutomodConfig(guild.id);
  const meta = AUTOMOD_RULES[key];
  const rule = config[key];
  const route = `admin:automod:rule:${key}`;
  return {
    embeds: [createEmbed(meta.title, [`**Status:** ${status(rule.enabled)}`, '', ruleSummary(key, rule), '', 'Choose the exact settings and select every action that should run when this rule triggers.'].join('\n'), name, rule.enabled ? ENABLED_COLOR : DISABLED_COLOR)],
    components: [
      row(button(`${route}:toggle`, rule.enabled ? 'Disable' : 'Enable', rule.enabled ? ButtonStyle.Danger : ButtonStyle.Success), button(`${route}:edit`, meta.editLabel), button(`${route}:dm`, '✉️ DM Notice', ButtonStyle.Secondary)),
      row(buildActionSelect(key, rule)),
      navRow(route, nextRuleId(key), `${route}:edit`),
    ],
  };
}

function textInput(id, label, value, { placeholder = '', required = true, style = TextInputStyle.Short, maxLength = null } = {}) {
  const input = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required);
  const current = String(value ?? '').trim();
  if (current) input.setValue(current);
  if (placeholder) input.setPlaceholder(placeholder);
  if (maxLength) input.setMaxLength(maxLength);
  return row(input);
}

function buildRuleModal(key, rule) {
  const modal=new ModalBuilder().setCustomId('admin:automod:rule:'+key+':modal').setTitle(AUTOMOD_RULES[key].title+' Settings');
  const enforcement=[textInput('risk','Risk points (0-100)',rule.risk??20),textInput('timeoutMinutes','Timeout minutes',rule.timeoutMinutes??10)];
  if(key==='antiSpam') modal.addComponents(textInput('maxMessages','Maximum messages',rule.maxMessages),textInput('intervalSeconds','Time window in seconds',rule.intervalSeconds),...enforcement);
  if(key==='antiLinks') modal.addComponents(textInput('allowStaff','Allow staff? true or false',rule.allowStaff),textInput('allowedDomains','Allowed domains, comma separated',(rule.allowedDomains||[]).join(', '),{required:false,style:TextInputStyle.Paragraph}),textInput('deniedDomains','Denied domains, comma separated',(rule.deniedDomains||[]).join(', '),{required:false,style:TextInputStyle.Paragraph}),textInput('risk','Risk points (0-100)',rule.risk??30));
  if(key==='badWords') modal.addComponents(textInput('words','Blocked words/phrases, comma separated',(rule.words||[]).join(', '),{required:false,style:TextInputStyle.Paragraph}),textInput('matchMode','Match mode: boundary or contains',rule.matchMode||'boundary'),...enforcement);
  if(key==='caps') modal.addComponents(textInput('percent','Capital letter percentage',rule.percent),textInput('minLength','Minimum message length',rule.minLength),...enforcement);
  if(key==='mentions') modal.addComponents(textInput('maxMentions','Maximum total mentions',rule.maxMentions),textInput('maxUserMentions','Maximum user mentions',rule.maxUserMentions),textInput('maxRoleMentions','Maximum role mentions',rule.maxRoleMentions),textInput('blockEveryone','Block @everyone/@here? true/false',rule.blockEveryone),textInput('risk','Risk points (0-100)',rule.risk??35));
  if(key==='invites') modal.addComponents(textInput('allowOwnServer','Allow own server? true/false',rule.allowOwnServer),textInput('allowedCodes','Allowed invite codes',(rule.allowedCodes||[]).join(', '),{required:false,style:TextInputStyle.Paragraph}),...enforcement);
  if(key==='duplicates') modal.addComponents(textInput('maxDuplicates','Maximum duplicate messages',rule.maxDuplicates),textInput('intervalSeconds','Window in seconds',rule.intervalSeconds),...enforcement);
  if(key==='flood') modal.addComponents(textInput('maxLines','Maximum lines',rule.maxLines),textInput('maxCharacters','Maximum characters',rule.maxCharacters),textInput('maxRepeatedCharacters','Repeated character limit',rule.maxRepeatedCharacters),textInput('risk','Risk points (0-100)',rule.risk??20),textInput('timeoutMinutes','Timeout minutes',rule.timeoutMinutes??10));
  if(key==='emojiSpam') modal.addComponents(textInput('maxEmojis','Maximum emojis',rule.maxEmojis),...enforcement);
  if(key==='attachments') modal.addComponents(textInput('maxAttachments','Maximum attachments',rule.maxAttachments),textInput('blockedExtensions','Blocked extensions, comma separated',(rule.blockedExtensions||[]).join(', '),{required:false,style:TextInputStyle.Paragraph}),...enforcement);
  return modal;
}

function buildDmMessagesModal(config) {
  const modal = new ModalBuilder().setCustomId('admin:automod:dmmessage:modal').setTitle('AutoMod DM Messages');
  for (const key of AUTOMOD_RULE_KEYS) {
    modal.addComponents(textInput(`dm_${key}`, AUTOMOD_RULES[key].title.replace(/^\S+\s/, ''), config.dmMessages[key], { required: false, style: TextInputStyle.Paragraph, maxLength: 1000 }));
  }
  return modal;
}

function buildLogChannelPanel() {
  return {
    embeds: [createEmbed('🤖 Set AutoMod Log Channel', 'Select the text channel where AutoMod logs should be sent.')],
    components: [
      row(new ChannelSelectMenuBuilder().setCustomId('admin:selectautomodlog').setPlaceholder('Choose a text channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
      row(backButton('admin:channel:automodlog')),
    ],
  };
}

const parsePositive = (value, fallback, min = 1, max = 1000) => {
  const number = Number.parseInt(String(value), 10);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};
const parseList = (value) => [...new Set(String(value || '').split(',').map((entry) => entry.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')).filter(Boolean))].slice(0, 100);
async function updatePanel(interaction, panel) {
  if (interaction.deferred || interaction.replied) await interaction.editReply(panel);
  else await interaction.update(panel);
  return true;
}

async function handleAutomodModal(interaction) {
  if (interaction.customId === 'admin:automod:risk:modal') {
    const config=getAutomodConfig(interaction.guild.id);
    const thresholds=interaction.fields.getTextInputValue('thresholds').split(',').map((v)=>parsePositive(v,0,1,500));
    const repeat=interaction.fields.getTextInputValue('repeat').split(',').map((v)=>parsePositive(v,0,0,1000));
    const requested=interaction.fields.getTextInputValue('caseMode').trim().toLowerCase();
    config.risk={...(config.risk||{}),low:thresholds[0]||25,medium:thresholds[1]||50,high:thresholds[2]||75,critical:thresholds[3]||100,repeatWindowHours:repeat[0]||24,repeatWeight:Number.isFinite(repeat[1])?repeat[1]:10};
    config.caseMode=['off','punishments','medium','all'].includes(requested)?requested:'punishments';
    config.evidenceRetentionDays=parsePositive(interaction.fields.getTextInputValue('retention'),30,0,365);
    saveAutomodConfig(interaction.guild.id,config);
    await interaction.reply({content:'✅ AutoMod risk, case and evidence policy saved.',flags:64});
    return true;
  }
  const dmMatch=interaction.customId.match(/^admin:automod:rule:([^:]+):dm:modal$/);
  if(dmMatch && AUTOMOD_RULES[dmMatch[1]]) {
    const key=dmMatch[1],config=getAutomodConfig(interaction.guild.id),dmMessages={...config.dmMessages};
    dmMessages[key]=interaction.fields.getTextInputValue('message').trim()||DEFAULT_DM_MESSAGES[key];
    saveAutomodConfig(interaction.guild.id,{...config,dmMessages});
    await interaction.reply({content:'✅ Member notice saved.',flags:64});
    return true;
  }
  if (interaction.customId === 'admin:automod:dmmessage:modal') {
    const config = getAutomodConfig(interaction.guild.id);
    const dmMessages = { ...config.dmMessages };
    for (const key of AUTOMOD_RULE_KEYS) {
      const value = interaction.fields.getTextInputValue(`dm_${key}`).trim();
      dmMessages[key] = value || DEFAULT_DM_MESSAGES[key];
    }
    saveAutomodConfig(interaction.guild.id, { ...config, dmMessages });
    await interaction.reply({ content: '✅ AutoMod DM messages saved.', flags: 64 });
    return true;
  }

  const match = interaction.customId.match(/^admin:automod:rule:([^:]+):modal$/);
  if (!match || !AUTOMOD_RULES[match[1]]) return false;
  const key = match[1];
  const config = getAutomodConfig(interaction.guild.id);
  const rule = { ...config[key] };
  const optionalField = (fieldId) => { try { return interaction.fields.getTextInputValue(fieldId); } catch { return null; } };
  const riskValue=optionalField('risk');
  const timeoutValue=optionalField('timeoutMinutes');
  if(riskValue!==null) rule.risk=parsePositive(riskValue,rule.risk??20,0,100);
  if(timeoutValue!==null) rule.timeoutMinutes=parsePositive(timeoutValue,rule.timeoutMinutes??10,1,40320);
  if (key === 'antiSpam') {
    rule.maxMessages = parsePositive(interaction.fields.getTextInputValue('maxMessages'), rule.maxMessages, 2, 100);
    rule.intervalSeconds = parsePositive(interaction.fields.getTextInputValue('intervalSeconds'), rule.intervalSeconds, 1, 3600);
  }
  if (key === 'antiLinks') {
    rule.allowStaff = interaction.fields.getTextInputValue('allowStaff').trim().toLowerCase() !== 'false';
    rule.allowedDomains = parseList(interaction.fields.getTextInputValue('allowedDomains'));
    rule.deniedDomains = parseList(interaction.fields.getTextInputValue('deniedDomains'));
  }
  if (key === 'badWords') rule.words = parseList(interaction.fields.getTextInputValue('words'));
  if (key === 'caps') {
    rule.percent = parsePositive(interaction.fields.getTextInputValue('percent'), rule.percent, 1, 100);
    rule.minLength = parsePositive(interaction.fields.getTextInputValue('minLength'), rule.minLength, 1, 500);
  }
  if (key === 'mentions') {
    rule.maxMentions=parsePositive(interaction.fields.getTextInputValue('maxMentions'),rule.maxMentions,1,100);
    rule.maxUserMentions=parsePositive(interaction.fields.getTextInputValue('maxUserMentions'),rule.maxUserMentions,1,100);
    rule.maxRoleMentions=parsePositive(interaction.fields.getTextInputValue('maxRoleMentions'),rule.maxRoleMentions,1,100);
    rule.blockEveryone=interaction.fields.getTextInputValue('blockEveryone').trim().toLowerCase()!=='false';
  }
  saveAutomodConfig(interaction.guild.id, { ...config, [key]: rule });
  await interaction.reply({ content: `✅ ${AUTOMOD_RULES[key].title} settings saved.`, flags: 64 });
  return true;
}

async function handleAutomodInteraction(interaction) {
  const id = String(interaction.customId || '');
  if (!(id.startsWith('admin:automod') || id === 'admin:setautomodlog' || id === 'admin:selectautomodlog' || id === 'admin:channel:automodlog')) return false;
  if (!interaction.guild || !canUseAutoMod(interaction)) {
    await interaction.reply({ content: '❌ You do not have permission to manage AutoMod.', flags: 64 });
    return true;
  }

  const name = getMemberDisplayName(interaction);
  if (interaction.isModalSubmit?.()) return handleAutomodModal(interaction);
  if (interaction.isChannelSelectMenu?.() && id === 'admin:selectautomodlog') {
    setLogChannelId(interaction.guild.id, interaction.values?.[0] || null);
    return updatePanel(interaction, buildAutomodConfigurePanel(interaction.guild, name));
  }
  if (interaction.isStringSelectMenu?.()) {
    if (id === 'admin:automod:protection') {
      const key = interaction.values?.[0];
      if (!AUTOMOD_RULES[key]) return false;
      return updatePanel(interaction, buildAutomodRulePanel(interaction.guild, key, name));
    }
    const match = id.match(/^admin:automod:rule:([^:]+):actions$/);
    if (!match || !AUTOMOD_RULES[match[1]]) return false;
    const key = match[1];
    const config = getAutomodConfig(interaction.guild.id);
    const rule = { ...config[key], actions: normalizeActions(interaction.values, config[key].actions) };
    saveAutomodConfig(interaction.guild.id, { ...config, [key]: rule });
    return updatePanel(interaction, buildAutomodRulePanel(interaction.guild, key, name));
  }
  if (!interaction.isButton?.()) return false;

  if (id === 'admin:automod') return updatePanel(interaction, buildAutomodPanel(interaction.guild, name));
  if (id === 'admin:automod:configure') return updatePanel(interaction, buildAutomodConfigurePanel(interaction.guild, name));
  if (id === 'admin:automod:risk') return updatePanel(interaction, buildRiskPanel(interaction.guild, name));
  if (id === 'admin:automod:risk:edit') { await interaction.showModal(buildRiskModal(getAutomodConfig(interaction.guild.id))); return true; }
  if (id === 'admin:setautomodlog' || id === 'admin:channel:automodlog') return updatePanel(interaction, buildLogChannelPanel());
  if (id === 'admin:automod:dmmessage') {
    await interaction.showModal(buildDmMessagesModal(getAutomodConfig(interaction.guild.id)));
    return true;
  }
  if (id === 'admin:automod:toggle') {
    const config = getAutomodConfig(interaction.guild.id);
    setAutomodEnabled(interaction.guild.id, !config.enabled, interaction.user?.id || null);
    return updatePanel(interaction, buildAutomodConfigurePanel(interaction.guild, name));
  }
  if (id === 'admin:automod:dm') {
    const config = getAutomodConfig(interaction.guild.id);
    saveAutomodConfig(interaction.guild.id, { ...config, dmUser: config.dmUser === false });
    return updatePanel(interaction, buildAutomodConfigurePanel(interaction.guild, name));
  }
  if (id === 'admin:automod:reset') {
    setAutomodEnabled(interaction.guild.id, false, interaction.user?.id || null);
    saveAutomodConfig(interaction.guild.id, defaults());
    return updatePanel(interaction, buildAutomodConfigurePanel(interaction.guild, name));
  }

  const ruleMatch = id.match(/^admin:automod:rule:([^:]+)(?::(toggle|edit|dm))?$/);
  if (ruleMatch && AUTOMOD_RULES[ruleMatch[1]]) {
    const key = ruleMatch[1];
    const action = ruleMatch[2];
    if (!action) return updatePanel(interaction, buildAutomodRulePanel(interaction.guild, key, name));
    const config = getAutomodConfig(interaction.guild.id);
    const rule = { ...config[key] };
    if (action === 'dm') {
      await interaction.showModal(buildRuleDmModal(key, config));
      return true;
    }
    if (action === 'edit') {
      await interaction.showModal(buildRuleModal(key, rule));
      return true;
    }
    rule.enabled = !rule.enabled;
    saveAutomodConfig(interaction.guild.id, { ...config, [key]: rule });
    return updatePanel(interaction, buildAutomodRulePanel(interaction.guild, key, name));
  }
  return false;
}

module.exports = {
  AUTOMOD_RULES,
  AUTOMOD_ACTIONS,
  DEFAULT_DM_MESSAGES,
  getAutomodConfig,
  saveAutomodConfig,
  buildAutomodPanel,
  buildAutomodConfigurePanel,
  buildAutomodRulePanel,
  buildRiskPanel,
  buildLogChannelPanel,
  handleAutomodInteraction,
};
