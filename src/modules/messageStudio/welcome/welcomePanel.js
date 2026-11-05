'use strict';

const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder, StringSelectMenuBuilder, ChannelType, AttachmentBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const { EMOJIS, emojiLabel } = require('../../../core/ui/emojis');
const guildManager = require('../../../core/guild/guildManager');
const welcome = require('./welcome');
const scheduledWelcome = require('./scheduledWelcome');
const scheduledWelcomeHealth = require('./scheduledWelcomeHealth');
const embedTemplateManager = require('../embed/embedTemplates');

const selections = new Map();
function row(...components){return new ActionRowBuilder().addComponents(...components.filter(Boolean));}
function button(customId,label,style=ButtonStyle.Secondary,disabled=false){
  const component = new ButtonBuilder().setCustomId(customId).setStyle(style).setDisabled(Boolean(disabled));
  const backPrefix = `${EMOJIS.BACK} `;
  if (typeof label === 'string' && label.startsWith(backPrefix)) {
    return component.setEmoji(EMOJIS.BACK).setLabel(label.slice(backPrefix.length));
  }
  return component.setLabel(label);
}
function displayName(interaction){return interaction.member?.displayName||interaction.user?.username||'Unknown User';}
function selectionKey(guildId,userId,scope='public'){return `${guildId}:${userId}:${scope}`;}
function getSelection(guildId,userId,scope='public'){return selections.get(selectionKey(guildId,userId,scope))||{};}
function setSelection(guildId,userId,scope,patch){const key=selectionKey(guildId,userId,scope);selections.set(key,{...getSelection(guildId,userId,scope),...patch});}
function clearSelection(guildId,userId,scope){if(scope)return selections.delete(selectionKey(guildId,userId,scope));selections.delete(selectionKey(guildId,userId,'public'));selections.delete(selectionKey(guildId,userId,'dm'));}
function templateTypeLabel(template={}){const type=String(template.templateType||template.module||'global');return type==='global'?'General':type.replace(/([a-z])([A-Z])/g,'$1 $2');}
function sourceLabel(source){return source==='preset'?emojiLabel('WELCOME_PRESET','Welcome Preset'):source==='custom'?emojiLabel('WELCOME_CUSTOM','Custom Welcome'):source==='inherit'?emojiLabel('WELCOME_INHERIT','Same as Public'):emojiLabel('WELCOME_EMBED','Embed Studio');}
function getTemplateOptions(guildId,scope='public'){
  const templates=Object.values(embedTemplateManager.listTemplates(guildId)).filter(Boolean);
  const relevant=templates.filter(template=>{
    const type=String(template.templateType||'');
    const module=String(template.module||'');
    if(['goodbye','leave','ticketPanel','formSubmission'].includes(type))return false;
    if(module&&!['welcome','global'].includes(module))return false;
    if(scope==='public'&&type==='dmWelcome')return false;
    return !type||['welcome','dmWelcome','global'].includes(type);
  });
  return relevant.sort((a,b)=>{
    const priority=template=>template.templateType===(scope==='dm'?'dmWelcome':'welcome')?0:template.templateType==='welcome'?1:template.module==='welcome'?2:3;
    return priority(a)-priority(b)||String(a.name||a.templateId).localeCompare(String(b.name||b.templateId));
  }).slice(0,25).map(template=>({
    label:String(template.name||template.templateId).slice(0,100),
    description:`${templateTypeLabel(template)} · ${template.embed?.title||template.panels?.[0]?.title||'Embed Studio message'}`.slice(0,100),
    value:String(template.templateId),
  }));
}
function sourceMenu(config,userId,guildId,scope='public'){
  const isDm=scope==='dm';const state=getSelection(guildId,userId,scope);const selected=state.source||(isDm?config.dmMessageSource:config.messageSource)||(isDm?'inherit':'preset');
  const options=[];
  if(isDm)options.push({label:'Same as Public',description:'DM always uses the current Public Welcome',value:'inherit',emoji:EMOJIS.WELCOME_INHERIT,default:selected==='inherit'});
  options.push(
    {label:'Embed Studio',description:'Use a saved Embed Studio message',value:'embedStudio',emoji:EMOJIS.WELCOME_EMBED,default:selected==='embedStudio'},
    {label:'Welcome Preset',description:'Use Goliath’s built-in Welcome message',value:'preset',emoji:EMOJIS.WELCOME_PRESET,default:selected==='preset'},
    {label:'Custom Welcome',description:'Create or edit a custom Welcome message',value:'custom',emoji:EMOJIS.WELCOME_CUSTOM,default:selected==='custom'},
  );
  return new StringSelectMenuBuilder().setCustomId(isDm?'admin:welcome:dmSource':'admin:welcome:source').setPlaceholder(isDm?'Choose DM message source':'Choose message source').addOptions(options);
}
function templateMenu(guild,activeTemplateId,userId,scope='public'){
  const options=getTemplateOptions(guild.id,scope);const staged=getSelection(guild.id,userId,scope);const selected=staged.templateId||activeTemplateId||null;
  const menu=new StringSelectMenuBuilder().setCustomId(scope==='dm'?'admin:welcome:dmTemplate':'admin:welcome:template').setPlaceholder(options.length?'Choose an Embed Studio message':'No messages available').setMinValues(1).setMaxValues(1).setDisabled(options.length===0);
  if(options.length)menu.addOptions(options.map(option=>({...option,default:option.value===selected})));else menu.addOptions({label:'No messages found',value:'none'});return menu;
}


function customTemplateId(scope){return scope==='dm'?'welcome_custom_dm':'welcome_custom_public';}
function customTemplateName(scope){return scope==='dm'?'Custom DM Welcome':'Custom Public Welcome';}
function customEditorModal(guildId,scope){
  const template=embedTemplateManager.getTemplate(guildId,customTemplateId(scope));
  const embed=template?.embed||{};
  const input=(id,label,value,maxLength,style=TextInputStyle.Short,required=false)=>{const field=new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setMaxLength(maxLength);const initial=String(value||'').replace(/^\u200b$/,'').slice(0,maxLength);if(initial)field.setValue(initial);return field;};
  return new ModalBuilder().setCustomId(scope==='dm'?'admin:welcome:customDmSubmit':'admin:welcome:customPublicSubmit').setTitle(scope==='dm'?'Edit DM Welcome':'Edit Public Welcome').addComponents(
    row(input('content','Message text',template?.content,1800,TextInputStyle.Paragraph)),
    row(input('title','Embed title',embed.title,256)),
    row(input('description','Embed description',embed.description,3500,TextInputStyle.Paragraph)),
    row(input('footer','Embed footer',embed.footer?.text,200)),
    row(input('color','Embed colour (hex)',embed.color||'#5865F2',7))
  );
}
function saveCustomWelcome(interaction,scope){
  const field=id=>interaction.fields.getTextInputValue(id).trim();
  const content=field('content'),title=field('title'),description=field('description'),footer=field('footer'),color=field('color')||'#5865F2';
  if(!content&&!title&&!description)throw new Error('Add message text, an embed title, or an embed description.');
  if(!/^#[0-9a-fA-F]{6}$/.test(color))throw new Error('Embed colour must be a six-digit hex value such as #5865F2.');
  const guildId=interaction.guild.id,slot=scope==='dm'?'dm_welcome':'welcome',templateId=customTemplateId(scope);
  const existing=embedTemplateManager.getTemplate(guildId,templateId);
  const saved=embedTemplateManager.saveTemplate(guildId,{
    ...(existing||{}),templateId,name:customTemplateName(scope),module:'welcome',templateType:scope==='dm'?'dmWelcome':'welcome',content,
    embed:{...(existing?.embed||{}),title,description:description||(content?'\u200b':''),color,footer:{...(existing?.embed?.footer||{}),text:footer}},
    tags:['welcome','custom']
  });
  welcome.bindWelcomeTemplate(guildId,saved.templateId,slot,{actorId:interaction.user.id});
  welcome.updateConfig(guildId,scope==='dm'?{dmMessageSource:'custom'}:{messageSource:'custom'},{actorId:interaction.user.id});
  clearSelection(guildId,interaction.user.id,scope);
}

async function buildWelcomePanel(guild,memberDisplayName='Unknown User'){
  const enabled=guildManager.isModuleEnabled(guild.id,'welcome');
  const instant=welcome.getWelcomeSection(guild.id);
  const scheduled=scheduledWelcome.getScheduledConfig(guild.id);
  const instantHealth=await welcome.buildHealthReport(guild);
  const scheduledHealth=await scheduledWelcomeHealth.buildHealth(guild);
  const configured=Boolean(instant.channelId||instant.dmEnabled);
  const issues=[
    ...(!enabled?['Welcome is disabled.']:[]),
    ...(enabled&&!configured?['Choose an instant welcome channel or enable a welcome DM.']:[]),
    ...(enabled&&configured&&!instantHealth.healthy?['Review Instant Welcome diagnostics.']:[]),
    ...(scheduled.enabled&&!scheduledHealth.healthy?['Review Scheduled Welcome diagnostics.']:[])
  ];
  const nextStep=issues.length?`${EMOJIS.WARNING} ${issues[0]}`:emojiLabel('SUCCESS','Welcome is ready. Preview or send a test from Instant Welcome.');
  const embed=new EmbedBuilder()
    .setColor(!enabled?0x747f8d:issues.length?0xfaa61a:0x57f287)
    .setTitle(emojiLabel('WELCOME', 'Welcome'))
    .setDescription([
      'Build, test and manage your member greetings from one workspace.',
      '',
      '### ' + emojiLabel('WORKSPACE', 'Workspace'),
      `**Module**　${enabled?emojiLabel('ACTIVE', 'Enabled'):emojiLabel('WELCOME_DISABLED','Disabled')}`,
      `**Destination**　${instant.channelId?`<#${instant.channelId}>`:emojiLabel('INACTIVE','Choose below')}`,
      `**Message**　${sourceLabel(instant.messageSource)}`,
      '',
      '### ' + emojiLabel('DELIVERY', 'Delivery'),
      `**Instant**　${enabled&&configured?emojiLabel('ACTIVE', 'Configured'):emojiLabel('INACTIVE','Not configured')}　•　**DM**　${instant.dmEnabled?emojiLabel('ACTIVE','On'):emojiLabel('INACTIVE', 'Off')}`,
      `**Scheduled**　${scheduled.enabled?emojiLabel('ACTIVE','On'):emojiLabel('INACTIVE', 'Off')}　•　**Queue**　${scheduledHealth.waitingMembers||0} waiting`,
      `**Sent**　${instant.analytics?.publicSent||0} public　•　${instant.analytics?.dmSent||0} DM　•　${scheduled.analytics?.membersWelcomed||0} scheduled`,
      '',
      '### ' + emojiLabel('STATUS', 'Status'),
      `**Readiness**　${issues.length?`${EMOJIS.SETUP_REQUIRED} ${issues.length} item${issues.length===1?'':'s'} to review`:emojiLabel('ACTIVE', 'Ready')}`,
      `**Health**　Instant ${instantHealth.healthy?EMOJIS.HEALTHY:EMOJIS.WARNING}　•　Scheduled ${scheduledHealth.healthy?EMOJIS.HEALTHY:EMOJIS.WARNING}`,
      `**Delivery**　Member ping ${instant.allowUserPing?'On':'Off'}　•　Role pings ${instant.allowRolePings?'On':'Off'}`,
      '',
      '### ' + emojiLabel('NEXT_STEP', 'Next Step'),
      nextStep
    ].join('\n'))
    .setFooter({text:`Welcome Studio • ${memberDisplayName}`})
    .setTimestamp();
  return {embeds:[embed],components:[
    row(new StringSelectMenuBuilder().setCustomId('admin:welcome:navigate').setPlaceholder(emojiLabel('WELCOME', 'Choose Welcome workspace')).addOptions(
      {label:'Instant Welcome',description:'Public greeting, template and delivery tests',value:'instant',emoji:EMOJIS.WELCOME_INSTANT},
      {label:'DM Welcome',description:'Private greeting and test DM',value:'dm',emoji:EMOJIS.WELCOME_DM},
      {label:'Scheduled Welcome',description:'Queue, delivery time and batch settings',value:'scheduled',emoji:EMOJIS.WELCOME_SCHEDULED},
      {label:'Mention Settings',description:'Member and role notifications',value:'mentions',emoji:EMOJIS.WELCOME_MENTIONS}
    )),
    row(new ChannelSelectMenuBuilder().setCustomId('admin:welcome:homeChannel').setPlaceholder(instant.channelId?emojiLabel('WELCOME_CHANNEL','Change Welcome Channel'):emojiLabel('WELCOME_CHANNEL','Select Welcome Channel')).setChannelTypes(ChannelType.GuildText,ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),
    row(button('admin:welcome:instant',emojiLabel('WELCOME_INSTANT', 'Instant Welcome'),ButtonStyle.Primary),button('admin:welcome:dm',emojiLabel('WELCOME_DM', 'DM Welcome'),ButtonStyle.Primary),button('admin:welcome:scheduled',emojiLabel('WELCOME_SCHEDULED', 'Scheduled Welcome'),ButtonStyle.Primary)),
    row(button('admin:modules',emojiLabel('BACK','Back')),button('admin:welcome:settings',emojiLabel('SETTINGS','Settings')))
  ]};
}

async function buildWelcomeSettingsPanel(guild,memberDisplayName='Unknown User'){
  const enabled=guildManager.isModuleEnabled(guild.id,'welcome');
  const instant=await welcome.buildHealthReport(guild);
  const scheduled=await scheduledWelcomeHealth.buildHealth(guild);
  const issues=[...(instant.healthy?[]:['Instant Welcome needs attention.']),...(scheduled.healthy?[]:['Scheduled Welcome needs attention.'])];
  const description=[
    'Manage notifications, troubleshoot delivery and control your Welcome configuration.',
    '',
    '### ' + emojiLabel('WORKSPACE', 'Workspace'),
    `**Module**　${enabled?emojiLabel('ACTIVE', 'Enabled'):emojiLabel('INACTIVE','Disabled')}`,
    '**Configuration**　Instant · Direct Message · Scheduled',
    '',
    '### ' + emojiLabel('WELCOME_MENTIONS','Notifications'),
    'Choose who receives welcome mentions and role alerts.',
    '',
    '### ' + emojiLabel('STATUS', 'Status'),
    `**Instant**　${instant.healthy?emojiLabel('ACTIVE','Healthy'):emojiLabel('SETUP_REQUIRED','Needs attention')}　•　**Scheduled**　${scheduled.healthy?emojiLabel('ACTIVE','Healthy'):emojiLabel('SETUP_REQUIRED','Needs attention')}`,
    `**Diagnostics**　${issues.length?`${issues.length} area${issues.length===1?'':'s'} to review`:'No reported issues'}`,
    '',
    '### ' + emojiLabel('SETTINGS','Management'),
    'Export your settings, enable or pause Welcome, or reset the configuration.',
    '',
    '### ' + emojiLabel('NEXT_STEP', 'Next Step'),
    issues.length?emojiLabel('WELCOME_DIAGNOSTICS','Run Diagnostics & Repair to investigate the reported issues.'):emojiLabel('SUCCESS','Settings are ready. Choose an option below.')
  ].join('\n');
  return {embeds:[new EmbedBuilder()
    .setColor(!enabled?0x747f8d:issues.length?0xfaa61a:0x57f287)
    .setTitle(emojiLabel('SETTINGS', 'Welcome · Settings'))
    .setDescription(description)
    .setFooter({text:`Welcome Studio • ${memberDisplayName}`})
    .setTimestamp()],components:[
      row(button('admin:welcome:mentions',emojiLabel('WELCOME_MENTIONS','Mentions'),ButtonStyle.Primary),button('admin:welcome:repairAll',emojiLabel('WELCOME_DIAGNOSTICS','Diagnostics'),ButtonStyle.Secondary),button('admin:welcome:export',emojiLabel('WELCOME_EXPORT','Export'),ButtonStyle.Secondary)),
      row(button(enabled?'admin:welcome:disable':'admin:welcome:enable',enabled?'⏸ Disable Welcome':'▶ Enable Welcome',enabled?ButtonStyle.Secondary:ButtonStyle.Success)),
      row(button('admin:welcome',emojiLabel('BACK','Back'),ButtonStyle.Secondary),button('admin:welcome:reset',emojiLabel('DELETE','Reset'),ButtonStyle.Danger))
    ]};
}

async function buildInstantPanel(guild,memberDisplayName='Unknown User',userId='panel'){
  const config=welcome.getWelcomeSection(guild.id),enabled=guildManager.isModuleEnabled(guild.id,'welcome');
  const health=await welcome.buildHealthReport(guild);
  const template=welcome.getAssignedTemplate(guild.id,'welcome',config);
  const state=getSelection(guild.id,userId,'public'),source=state.source||config.messageSource||'preset';
  const pendingTemplate=state.templateId?embedTemplateManager.getTemplate(guild.id,state.templateId):null;
  const hasUnsavedSelection=Boolean(state.source&&(state.source!==config.messageSource||(state.source==='embedStudio'&&state.templateId&&state.templateId!==config.templateId)));
  const components=[
    row(new ChannelSelectMenuBuilder().setCustomId('admin:welcome:channel').setPlaceholder(emojiLabel('WELCOME_CHANNEL','Select Welcome Channel')).setChannelTypes(ChannelType.GuildText,ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),
    row(sourceMenu(config,userId,guild.id,'public'))
  ];
  if(source==='embedStudio')components.push(row(templateMenu(guild,template?.templateId||config.templateId,userId,'public')));
  components.push(row(button('admin:welcome:applySource',emojiLabel('PRESETS','Save Message'),ButtonStyle.Primary,source==='embedStudio'&&!(state.templateId||(config.messageSource==='embedStudio'&&config.templateId))),button('admin:welcome:test',emojiLabel('WELCOME_PREVIEW','Preview'),ButtonStyle.Secondary),button('admin:welcome:send',emojiLabel('TEST_SEND','Send Test'),ButtonStyle.Success)));
  components.push(row(button('admin:welcome',emojiLabel('BACK','Back')),button('admin:welcome:instantSettings',emojiLabel('SETTINGS','Settings'))));
  const issues=health.warnings||[];
  const next=!enabled?emojiLabel('SETTINGS','Enable the Welcome module in Settings before live delivery.'):!config.channelId?emojiLabel('WELCOME_LOCATION','Select a public welcome channel.'):issues.length?emojiLabel('WARNING','Open Settings to review delivery warnings.'):emojiLabel('SUCCESS','Preview or send a test welcome to confirm the message.');
  return {embeds:[new EmbedBuilder().setColor(!enabled?0x747f8d:issues.length?0xfaa61a:0x57f287)
    .setTitle(emojiLabel('WELCOME_INSTANT','Welcome · Instant'))
    .setDescription(['Configure the public greeting. Preview checks your selection; Send Test delivers the saved message.','',
      '### ' + emojiLabel('WORKSPACE', 'Workspace'),`**Destination**　${config.channelId?`<#${config.channelId}>`:emojiLabel('INACTIVE','Choose below')}`,`**Source**　${sourceLabel(config.messageSource)}`,`**Saved message**　${template?.name||'Not selected'}`,
      ...(hasUnsavedSelection?[`**Selected for preview**　${sourceLabel(source)}${pendingTemplate?` · ${pendingTemplate.name||pendingTemplate.templateId}`:''}`, '**Not live yet** — Preview shows this selection. Send Test uses the saved live message until you choose Save Message.']:[]),'',
      '### ' + emojiLabel('DELIVERY', 'Delivery'),`**Member pings**　${config.allowUserPing?emojiLabel('ACTIVE','On'):emojiLabel('INACTIVE', 'Off')}　•　**Role pings**　${config.allowRolePings?emojiLabel('ACTIVE','On'):emojiLabel('INACTIVE', 'Off')}`,`**Bots**　${config.ignoreBots?'Excluded':'Included'}　•　**DM**　${config.dmEnabled?'On':'Off'}`,`**Sent**　${config.analytics?.publicSent||0}　•　**Failed**　${config.analytics?.publicFailed||0}`,'',
      '### ' + emojiLabel('STATUS', 'Status'),`**Readiness**　${enabled&&config.channelId?emojiLabel('ACTIVE', 'Configured'):emojiLabel('SETUP_REQUIRED', 'Setup required')}`,`**Health**　${health.healthy?emojiLabel('HEALTHY', 'Healthy'):emojiLabel('WARNING', 'Needs attention')}`,'',
      '### ' + emojiLabel('NEXT_STEP', 'Next Step'),next].join('\n').slice(0,4096))
    .setFooter({text:`Welcome Studio • ${memberDisplayName}`}).setTimestamp()],components};
}


async function buildDmPanel(guild,memberDisplayName='Unknown User',userId='panel'){
  const config=welcome.getWelcomeSection(guild.id);
  const publicTemplate=welcome.getAssignedTemplate(guild.id,'welcome',config),dmTemplate=welcome.getAssignedTemplate(guild.id,'dmWelcome',config);
  const state=getSelection(guild.id,userId,'dm'),source=state.source||config.dmMessageSource||'inherit';
  const pendingTemplate=state.templateId?embedTemplateManager.getTemplate(guild.id,state.templateId):null;
  const hasUnsavedSelection=Boolean(state.source&&(state.source!==config.dmMessageSource||(state.source==='embedStudio'&&state.templateId&&state.templateId!==config.dmTemplateId)));
  const components=[row(sourceMenu(config,userId,guild.id,'dm'))];
  if(source==='embedStudio')components.push(row(templateMenu(guild,dmTemplate?.templateId||config.dmTemplateId,userId,'dm')));
  components.push(row(button('admin:welcome:dmApply',emojiLabel('PRESETS','Save Message'),ButtonStyle.Primary,source==='embedStudio'&&!(state.templateId||(config.dmMessageSource==='embedStudio'&&config.dmTemplateId))),button('admin:welcome:dmPreview',emojiLabel('WELCOME_PREVIEW','Preview')),button('admin:welcome:dmSend',emojiLabel('TEST_SEND','Send Test'),ButtonStyle.Success)));
  components.push(row(button('admin:welcome',emojiLabel('BACK','Back')),button('admin:welcome:dmSettings',emojiLabel('SETTINGS','Settings'))));
  const message=config.dmMessageSource==='inherit'?publicTemplate?.name||'Same as Public':dmTemplate?.name||'Not selected';
  return {embeds:[new EmbedBuilder().setColor(config.dmEnabled?0x57f287:0x747f8d)
    .setTitle(emojiLabel('WELCOME_DM','Welcome · Direct Message'))
    .setDescription(['Configure private greetings. Preview checks your selection; Send Test delivers the saved DM message.','',
      '### ' + emojiLabel('WORKSPACE', 'Workspace'),`**Source**　${sourceLabel(config.dmMessageSource)}`,`**Message**　${message}`,
      ...(hasUnsavedSelection?[`**Selected for preview**　${sourceLabel(source)}${pendingTemplate?` · ${pendingTemplate.name||pendingTemplate.templateId}`:''}`, '**Not live yet** — Preview shows this selection. Send Test uses the saved live message until you choose Save Message.']:[]),'',
      '### ' + emojiLabel('DELIVERY', 'Delivery'),`**Direct messages**　${config.dmEnabled?emojiLabel('ACTIVE', 'Enabled'):emojiLabel('INACTIVE','Disabled')}`,`**Sent**　${config.analytics?.dmSent||0}　•　**Failed**　${config.analytics?.dmFailed||0}`,'',
      '### ' + emojiLabel('STATUS', 'Status'),`**Readiness**　${config.dmEnabled?emojiLabel('ACTIVE','Active'):emojiLabel('INACTIVE','Paused')}`,`**Message sync**　${config.dmMessageSource==='inherit'?'Follows Public Welcome':'Independent template'}`,'',
      '### ' + emojiLabel('NEXT_STEP', 'Next Step'),!config.dmEnabled?emojiLabel('SETTINGS','Open Settings to enable DM delivery.'):source==='custom'?emojiLabel('PRESETS','Save Message to edit your custom DM.'):emojiLabel('WELCOME_PREVIEW','Preview or send yourself a test DM.')].join('\n'))
    .setFooter({text:`Welcome Studio • ${memberDisplayName}`}).setTimestamp()],components};
}


function buildMentionSettingsPanel(guild,memberDisplayName='Unknown User'){
  const config=welcome.getWelcomeSection(guild.id);
  const roles=config.mentionRoleIds.length?config.mentionRoleIds.map(id=>`<@&${id}>`).join(', '):'None selected';
  return {embeds:[new EmbedBuilder().setColor(config.allowRolePings?0x57f287:0x5865f2)
    .setTitle(emojiLabel('WELCOME_MENTIONS','Welcome · Mentions'))
    .setDescription(['Control which members and roles receive notifications.','',
      '### ' + emojiLabel('WORKSPACE', 'Workspace'),`**Selected roles**　${roles}`,'',
      '### ' + emojiLabel('DELIVERY', 'Delivery'),`**Member mentions**　${config.allowUserPing?emojiLabel('ACTIVE','On'):emojiLabel('INACTIVE', 'Off')}`,`**Role mentions**　${config.allowRolePings?emojiLabel('ACTIVE','On'):emojiLabel('INACTIVE', 'Off')}`,'',
      '### ' + emojiLabel('STATUS', 'Status'),'Only explicitly permitted members and roles can be pinged.','',
      '### ' + emojiLabel('NEXT_STEP', 'Next Step'),'Choose notification roles below, then enable the notifications you want.'].join('\n'))
    .setFooter({text:`Welcome Studio • ${memberDisplayName}`}).setTimestamp()],components:[
      row(new RoleSelectMenuBuilder().setCustomId('admin:welcome:roles').setPlaceholder(emojiLabel('WELCOME_MENTIONS','Choose roles to notify')).setMinValues(0).setMaxValues(10)),
      row(button('admin:welcome:togglePing',config.allowUserPing?emojiLabel('WELCOME_MENTIONS','Member Pings: On'):emojiLabel('WELCOME_MUTED','Member Pings: Off'),config.allowUserPing?ButtonStyle.Success:ButtonStyle.Secondary),button('admin:welcome:toggleRolePings',config.allowRolePings?emojiLabel('WELCOME_ROLE_PINGS','Role Pings: On'):emojiLabel('WELCOME_ROLE_PINGS','Role Pings: Off'),config.allowRolePings?ButtonStyle.Success:ButtonStyle.Secondary)),
      row(button('admin:welcome',emojiLabel('BACK','Back')),button('admin:welcome:settings',emojiLabel('SETTINGS','Settings')))
    ]};
}


async function buildScheduledPanel(guild,memberDisplayName='Unknown User'){const config=scheduledWelcome.getScheduledConfig(guild.id);const health=await scheduledWelcomeHealth.buildHealth(guild);const analytics=config.analytics||{};const lastRun=analytics.lastRunAt?`<t:${Math.floor(new Date(analytics.lastRunAt).getTime()/1000)}:R>`:'Never';return {embeds:[new EmbedBuilder().setColor(!config.enabled?0x747f8d:health.healthy?0x57f287:0xfaa61a).setTitle(emojiLabel('WELCOME_SCHEDULED','Welcome · Scheduled')).setDescription(['Manage the queued welcome delivered at your chosen local time.','','### ' + emojiLabel('WORKSPACE', 'Workspace'),`**Status:** ${config.enabled?'Enabled ✅':'Disabled'}`,`**Queue role:** ${config.queueRoleId?`<@&${config.queueRoleId}>`:'`Not set`'}`,`**Channel:** ${config.channelId?`<#${config.channelId}>`:'`Not set`'}`,`**Time:** \`${config.time}\``,`**Timezone:** \`${config.timezone}\``,`**Waiting now:** \`${health.waitingMembers||0}\``,`**Already welcomed / cleanup pending:** \`${health.stuckMemberIds?.length||0}\``,`**Ping members:** ${config.pingMembers?'Yes':'No'}`,`**Remove queue role:** ${config.removeQueueRole?'Yes ✅':'No'}`,`**Bots:** ${config.ignoreBots?'Excluded':'Included'}`,'',`**Message:**\n${String(config.message||'').slice(0,700)||'`Not set`'}`,'','### ' + emojiLabel('STATUS', 'Status'),`Runs: \`${analytics.runs||0}\` · Welcomed: \`${analytics.membersWelcomed||0}\` · Failed sends: \`${analytics.sendFailed||0}\``,`Last run: ${lastRun}`,analytics.lastError?`**Last delivery error:** ${String(analytics.lastError).slice(0,300)}`:null,health.issues.length?`\n**Issues**\n${health.issues.map(issue=>`• ${issue}`).join('\n')}`:'',health.warnings.length?`\n**Warnings**\n${health.warnings.map(warning=>`• ${warning}`).join('\n')}`:''].filter(Boolean).join('\n').slice(0,4096)).setFooter({text:`Requested by ${memberDisplayName}`}).setTimestamp()],components:[row(new RoleSelectMenuBuilder().setCustomId('admin:welcome:scheduled:role').setPlaceholder('Select the Welcome Queue role').setMinValues(0).setMaxValues(1)),row(new ChannelSelectMenuBuilder().setCustomId('admin:welcome:scheduled:channel').setPlaceholder('Select scheduled welcome channel').setChannelTypes(ChannelType.GuildText,ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),row(button('admin:welcome:scheduled:configure',emojiLabel('SETTINGS','Schedule & Message'),ButtonStyle.Primary),button('admin:welcome:scheduled:previewQueue',emojiLabel('WELCOME_QUEUE','View Queue')),button('admin:welcome:scheduled:runNow',emojiLabel('WELCOME_RUN','Run Now'))),row(button('admin:welcome',emojiLabel('BACK','Back')),button('admin:welcome:scheduledSettings',emojiLabel('SETTINGS','Settings')))]};}
async function buildWelcomeDeliverySettingsPanel(guild,scope,memberDisplayName='Unknown User'){
  const config=welcome.getWelcomeSection(guild.id),scheduled=scheduledWelcome.getScheduledConfig(guild.id);
  const instant=scope==='instant',dm=scope==='dm';
  const controls=instant?[
    row(button('admin:welcome:mentions',emojiLabel('WELCOME_MENTIONS','Mention Settings')),button('admin:welcome:toggleBots',config.ignoreBots?emojiLabel('AUTOMOD','Exclude Bots: On'):emojiLabel('AUTOMOD','Exclude Bots: Off'),config.ignoreBots?ButtonStyle.Success:ButtonStyle.Secondary),button('admin:welcome:repairInstant',emojiLabel('WELCOME_DIAGNOSTICS','Diagnostics'))),
    row(button('admin:welcome:instant',emojiLabel('BACK', 'Back')))
  ]:dm?[
    row(button('admin:welcome:toggleDm',config.dmEnabled?'⏸ Disable DM':'▶ Enable DM',config.dmEnabled?ButtonStyle.Secondary:ButtonStyle.Success)),
    row(button('admin:welcome:dm',emojiLabel('BACK','DM Welcome')))
  ]:[
    row(button('admin:welcome:scheduled:togglePing',scheduled.pingMembers?emojiLabel('WELCOME_MENTIONS','Pings: On'):emojiLabel('WELCOME_MUTED','Pings: Off'),scheduled.pingMembers?ButtonStyle.Success:ButtonStyle.Secondary),button('admin:welcome:scheduled:toggleRemove',scheduled.removeQueueRole?emojiLabel('WELCOME_CLEANUP','Cleanup: On'):emojiLabel('WELCOME_CLEANUP','Cleanup: Off'),scheduled.removeQueueRole?ButtonStyle.Success:ButtonStyle.Secondary),button('admin:welcome:scheduled:toggleBots',scheduled.ignoreBots?emojiLabel('AUTOMOD','Exclude Bots: On'):emojiLabel('AUTOMOD','Exclude Bots: Off'),scheduled.ignoreBots?ButtonStyle.Success:ButtonStyle.Secondary)),
    row(button(scheduled.enabled?'admin:welcome:scheduled:disable':'admin:welcome:scheduled:enable',scheduled.enabled?'⏸ Disable Scheduled':'▶ Enable Scheduled',scheduled.enabled?ButtonStyle.Secondary:ButtonStyle.Success),button('admin:welcome:scheduled:repair',emojiLabel('WELCOME_DIAGNOSTICS','Diagnostics'))),
    row(button('admin:welcome:scheduled',emojiLabel('BACK','Scheduled Welcome')))
  ];
  return {embeds:[new EmbedBuilder().setColor(0x5865f2).setTitle(emojiLabel('SETTINGS', `Welcome · ${instant?'Instant':dm?'DM':'Scheduled'} Settings`))
    .setDescription(['### ' + emojiLabel('WORKSPACE', 'Workspace'),`**Area**　${instant?'Public Welcome':dm?'Direct Message':'Scheduled Queue'}`,'',
      '### ' + emojiLabel('DELIVERY', 'Delivery'),instant?'Configure bot exclusions, mentions and public delivery health.':dm?'Enable or disable private welcome messages.':'Configure member pings, queue cleanup, bot exclusions and schedule availability.','',
      '### ' + emojiLabel('NEXT_STEP', 'Next Step'),'Change the settings below, then return to your Welcome workspace.'].join('\n'))
    .setFooter({text:`Welcome Studio • ${memberDisplayName}`}).setTimestamp()],components:controls};
}

function buildScheduledModal(config){return new ModalBuilder().setCustomId('admin:welcome:scheduled:configureSubmit').setTitle('Scheduled Welcome').addComponents(row(new TextInputBuilder().setCustomId('time').setLabel('Daily time (24-hour HH:MM)').setStyle(TextInputStyle.Short).setRequired(true).setValue(config.time||'19:00').setMaxLength(5)),row(new TextInputBuilder().setCustomId('timezone').setLabel('Timezone').setStyle(TextInputStyle.Short).setRequired(true).setValue(config.timezone||'Europe/London').setMaxLength(80)),row(new TextInputBuilder().setCustomId('message').setLabel('Welcome message').setStyle(TextInputStyle.Paragraph).setRequired(true).setValue(String(config.message||'').slice(0,1800)).setMaxLength(1800)),row(new TextInputBuilder().setCustomId('batchSize').setLabel('Members per batch (1-50)').setStyle(TextInputStyle.Short).setRequired(true).setValue(String(config.batchSize||20)).setMaxLength(2)));}
function getPreviewTemplate(guildId,userId,scope){
  const config=welcome.getWelcomeSection(guildId);
  const state=getSelection(guildId,userId,scope);
  const source=state.source||(scope==='dm'?config.dmMessageSource:config.messageSource);
  if(source==='embedStudio'&&state.source==='embedStudio'&&!state.templateId)throw new Error('Choose an Embed Studio message before previewing.');
  if(source==='embedStudio'&&state.templateId){
    const selected=embedTemplateManager.getTemplate(guildId,state.templateId);
    if(!selected)throw new Error('Selected Embed Studio message is unavailable.');
    return selected;
  }
  if(source==='custom'&&state.source)throw new Error('Save your custom Welcome message before previewing it.');
  if(source==='preset'&&state.source){
    const presetId=scope==='dm'?'dm_welcome_default':'welcome_default';
    const preset=embedTemplateManager.getTemplate(guildId,presetId);
    if(!preset)throw new Error('Default Welcome preset is unavailable.');
    return preset;
  }
  if(scope==='dm'&&source==='inherit'&&state.source){
    return welcome.getAssignedTemplate(guildId,'welcome',config);
  }
  return null;
}
async function updatePanel(interaction,payload=null){const next=payload||await buildWelcomePanel(interaction.guild,displayName(interaction));if(interaction.deferred||interaction.replied)return interaction.editReply(next);return interaction.update(next);}

async function handleWelcomeInteraction(interaction){const customId=String(interaction.customId||'');if(!customId.startsWith('admin:welcome'))return false;try{
if(interaction.isStringSelectMenu?.()&&customId==='admin:welcome:navigate'){const choice=interaction.values?.[0];if(choice==='instant')return updatePanel(interaction,await buildInstantPanel(interaction.guild,displayName(interaction),interaction.user.id));if(choice==='dm')return updatePanel(interaction,await buildDmPanel(interaction.guild,displayName(interaction),interaction.user.id));if(choice==='scheduled')return updatePanel(interaction,await buildScheduledPanel(interaction.guild,displayName(interaction)));if(choice==='mentions')return updatePanel(interaction,buildMentionSettingsPanel(interaction.guild,displayName(interaction)));throw new Error('Choose a valid Welcome workspace.');}
if(interaction.isChannelSelectMenu?.()&&customId==='admin:welcome:homeChannel'){welcome.updateConfig(interaction.guild.id,{channelId:interaction.values?.[0]||null},{actorId:interaction.user.id});return updatePanel(interaction);}
if(['admin:welcome:instantSettings','admin:welcome:dmSettings','admin:welcome:scheduledSettings'].includes(customId)){const scope=customId==='admin:welcome:instantSettings'?'instant':customId==='admin:welcome:dmSettings'?'dm':'scheduled';return updatePanel(interaction,await buildWelcomeDeliverySettingsPanel(interaction.guild,scope,displayName(interaction)));}
if(customId==='admin:welcome:settings')return updatePanel(interaction,await buildWelcomeSettingsPanel(interaction.guild,displayName(interaction)));if(customId==='admin:welcome')return updatePanel(interaction);if(customId==='admin:welcome:instant')return updatePanel(interaction,await buildInstantPanel(interaction.guild,displayName(interaction),interaction.user.id));if(customId==='admin:welcome:dm')return updatePanel(interaction,await buildDmPanel(interaction.guild,displayName(interaction),interaction.user.id));if(customId==='admin:welcome:mentions')return updatePanel(interaction,buildMentionSettingsPanel(interaction.guild,displayName(interaction)));if(customId==='admin:welcome:scheduled')return updatePanel(interaction,await buildScheduledPanel(interaction.guild,displayName(interaction)));
if(interaction.isChannelSelectMenu?.()&&customId==='admin:welcome:channel'){welcome.updateConfig(interaction.guild.id,{channelId:interaction.values?.[0]||null},{actorId:interaction.user.id});return updatePanel(interaction,await buildInstantPanel(interaction.guild,displayName(interaction),interaction.user.id));}
if(interaction.isRoleSelectMenu?.()&&customId==='admin:welcome:roles'){welcome.updateConfig(interaction.guild.id,{mentionRoleIds:(interaction.values||[]).filter(roleId=>roleId!==interaction.guild.id)},{actorId:interaction.user.id});return updatePanel(interaction,buildMentionSettingsPanel(interaction.guild,displayName(interaction)));}
if(interaction.isStringSelectMenu?.()&&customId==='admin:welcome:source'){const source=interaction.values?.[0];if(!['embedStudio','preset','custom'].includes(source))throw new Error('Choose a valid message source.');setSelection(interaction.guild.id,interaction.user.id,'public',{source,templateId:source==='embedStudio'&&getSelection(interaction.guild.id,interaction.user.id,'public').source==='embedStudio'?getSelection(interaction.guild.id,interaction.user.id,'public').templateId:null});return updatePanel(interaction,await buildInstantPanel(interaction.guild,displayName(interaction),interaction.user.id));}
if(interaction.isStringSelectMenu?.()&&customId==='admin:welcome:template'){const templateId=interaction.values?.[0];if(!templateId||templateId==='none'||!getTemplateOptions(interaction.guild.id,'public').some(option=>option.value===templateId))throw new Error('Choose an available Public Welcome message.');setSelection(interaction.guild.id,interaction.user.id,'public',{source:'embedStudio',templateId});return updatePanel(interaction,await buildInstantPanel(interaction.guild,displayName(interaction),interaction.user.id));}
if(customId==='admin:welcome:applySource'){const state=getSelection(interaction.guild.id,interaction.user.id,'public');const source=state.source||welcome.getWelcomeSection(interaction.guild.id).messageSource||'preset';if(source==='custom')return interaction.showModal(customEditorModal(interaction.guild.id,'public'));if(source==='preset')welcome.bindWelcomeTemplate(interaction.guild.id,'welcome_default','welcome',{actorId:interaction.user.id});else{if(!state.templateId||!embedTemplateManager.getTemplate(interaction.guild.id,state.templateId))throw new Error('Choose an Embed Studio message first.');welcome.bindWelcomeTemplate(interaction.guild.id,state.templateId,'welcome',{actorId:interaction.user.id});}clearSelection(interaction.guild.id,interaction.user.id,'public');return updatePanel(interaction,await buildInstantPanel(interaction.guild,displayName(interaction),interaction.user.id));}
if(interaction.isStringSelectMenu?.()&&customId==='admin:welcome:dmSource'){const source=interaction.values?.[0];if(!['inherit','embedStudio','preset','custom'].includes(source))throw new Error('Choose a valid DM message source.');setSelection(interaction.guild.id,interaction.user.id,'dm',{source,templateId:source==='embedStudio'&&getSelection(interaction.guild.id,interaction.user.id,'dm').source==='embedStudio'?getSelection(interaction.guild.id,interaction.user.id,'dm').templateId:null});return updatePanel(interaction,await buildDmPanel(interaction.guild,displayName(interaction),interaction.user.id));}
if(interaction.isStringSelectMenu?.()&&customId==='admin:welcome:dmTemplate'){const templateId=interaction.values?.[0];if(!templateId||templateId==='none'||!getTemplateOptions(interaction.guild.id,'dm').some(option=>option.value===templateId))throw new Error('Choose an available DM Welcome message.');setSelection(interaction.guild.id,interaction.user.id,'dm',{source:'embedStudio',templateId});return updatePanel(interaction,await buildDmPanel(interaction.guild,displayName(interaction),interaction.user.id));}
if(customId==='admin:welcome:dmApply'){const state=getSelection(interaction.guild.id,interaction.user.id,'dm');const source=state.source||welcome.getWelcomeSection(interaction.guild.id).dmMessageSource||'inherit';if(source==='custom')return interaction.showModal(customEditorModal(interaction.guild.id,'dm'));if(source==='inherit')welcome.clearDmTemplate(interaction.guild.id,{actorId:interaction.user.id});else if(source==='preset')welcome.bindWelcomeTemplate(interaction.guild.id,'dm_welcome_default','dm_welcome',{actorId:interaction.user.id});else{if(!state.templateId||!embedTemplateManager.getTemplate(interaction.guild.id,state.templateId))throw new Error('Choose an Embed Studio message first.');welcome.bindWelcomeTemplate(interaction.guild.id,state.templateId,'dm_welcome',{actorId:interaction.user.id});}clearSelection(interaction.guild.id,interaction.user.id,'dm');return updatePanel(interaction,await buildDmPanel(interaction.guild,displayName(interaction),interaction.user.id));}
if(interaction.isModalSubmit?.()&&customId==='admin:welcome:customPublicSubmit'){saveCustomWelcome(interaction,'public');return interaction.reply({content:emojiLabel('SUCCESS','Public Welcome message saved and selected. Use Instant Welcome to preview or test it.'),ephemeral:true,components:[row(button('admin:welcome:instant','⚡ Open Instant Welcome',ButtonStyle.Primary))]});}
if(interaction.isModalSubmit?.()&&customId==='admin:welcome:customDmSubmit'){saveCustomWelcome(interaction,'dm');return interaction.reply({content:emojiLabel('SUCCESS','DM Welcome message saved and selected. Use DM Welcome to preview or test it.'),ephemeral:true,components:[row(button('admin:welcome:dm',emojiLabel('WELCOME_DM','Open DM Welcome'),ButtonStyle.Primary))]});}
if(customId==='admin:welcome:dmPreview'){const member=interaction.member;if(!member)throw new Error('Your server member record is unavailable.');const payload=await welcome.buildDiscordPayload(member,'dmWelcome',welcome.getWelcomeSection(interaction.guild.id),{suppressPing:true,ephemeral:true,templateOverride:getPreviewTemplate(interaction.guild.id,interaction.user.id,'dm')});return interaction.reply(payload);}
if(customId==='admin:welcome:dmSend'){const member=interaction.member;if(!member)throw new Error('Your server member record is unavailable.');const config=welcome.getWelcomeSection(interaction.guild.id);if(!config.dmEnabled)throw new Error('Enable DM Welcome before sending a DM test.');const payload=await welcome.buildDiscordPayload(member,'dmWelcome',config,{suppressPing:true});await interaction.user.send(payload);return interaction.reply({content:'✅ Test Welcome DM sent to you.',ephemeral:true});}
if(interaction.isRoleSelectMenu?.()&&customId==='admin:welcome:scheduled:role'){const previous=scheduledWelcome.getScheduledConfig(interaction.guild.id);const queueRoleId=interaction.values?.[0]||null;scheduledWelcome.updateScheduledConfig(interaction.guild.id,queueRoleId===previous.queueRoleId?{queueRoleId}:{queueRoleId,completedMemberIds:[]},{actorId:interaction.user.id});return updatePanel(interaction,await buildScheduledPanel(interaction.guild,displayName(interaction)));}
if(interaction.isChannelSelectMenu?.()&&customId==='admin:welcome:scheduled:channel'){scheduledWelcome.updateScheduledConfig(interaction.guild.id,{channelId:interaction.values?.[0]||null},{actorId:interaction.user.id});return updatePanel(interaction,await buildScheduledPanel(interaction.guild,displayName(interaction)));}
if(customId==='admin:welcome:scheduled:configure')return interaction.showModal(buildScheduledModal(scheduledWelcome.getScheduledConfig(interaction.guild.id)));if(interaction.isModalSubmit?.()&&customId==='admin:welcome:scheduled:configureSubmit'){scheduledWelcome.updateScheduledConfig(interaction.guild.id,{time:interaction.fields.getTextInputValue('time'),timezone:interaction.fields.getTextInputValue('timezone'),message:interaction.fields.getTextInputValue('message'),batchSize:(()=>{const raw=interaction.fields.getTextInputValue('batchSize').trim();if(!/^(?:[1-9]|[1-4][0-9]|50)$/.test(raw))throw new Error('Members per batch must be a number from 1 to 50.');return Number(raw);})()},{actorId:interaction.user.id});return updatePanel(interaction,await buildScheduledPanel(interaction.guild,displayName(interaction)));}
if(customId==='admin:welcome:scheduled:enable'){const config=scheduledWelcome.getScheduledConfig(interaction.guild.id);if(!config.queueRoleId||!config.channelId)throw new Error('Choose a queue role and channel before enabling Scheduled Welcome.');scheduledWelcome.updateScheduledConfig(interaction.guild.id,{enabled:true},{actorId:interaction.user.id});return updatePanel(interaction,await buildWelcomeDeliverySettingsPanel(interaction.guild,'scheduled',displayName(interaction)));}
if(customId==='admin:welcome:scheduled:disable'){scheduledWelcome.updateScheduledConfig(interaction.guild.id,{enabled:false},{actorId:interaction.user.id});return updatePanel(interaction,await buildWelcomeDeliverySettingsPanel(interaction.guild,'scheduled',displayName(interaction)));}
if(customId==='admin:welcome:scheduled:togglePing'||customId==='admin:welcome:scheduled:toggleRemove'||customId==='admin:welcome:scheduled:toggleBots'){const config=scheduledWelcome.getScheduledConfig(interaction.guild.id);const patch=customId.endsWith('togglePing')?{pingMembers:!config.pingMembers}:customId.endsWith('toggleRemove')?{removeQueueRole:!config.removeQueueRole}:{ignoreBots:!config.ignoreBots};scheduledWelcome.updateScheduledConfig(interaction.guild.id,patch,{actorId:interaction.user.id});return updatePanel(interaction,await buildWelcomeDeliverySettingsPanel(interaction.guild,'scheduled',displayName(interaction)));}
if(customId==='admin:welcome:scheduled:previewQueue'){const members=await scheduledWelcome.getWaitingMembers(interaction.guild);const config=scheduledWelcome.getScheduledConfig(interaction.guild.id);const completed=config.completedMemberIds.length;const text=members.length?members.slice(0,35).map(member=>`• @${member.displayName||member.user?.username||member.id}`).join('\n'):'No members are currently waiting.';return interaction.reply({content:`**Scheduled Welcome Queue**\nWaiting: **${members.length}** · Already welcomed / awaiting cleanup: **${completed}**\n\n${text}${members.length>35?'\n…and more members.':''}`.slice(0,2000),ephemeral:true,allowedMentions:{parse:[]}});}
if(customId==='admin:welcome:scheduled:runNow')return updatePanel(interaction,{embeds:[new EmbedBuilder().setColor(0xfaa61a).setTitle(emojiLabel('WARNING','Run Scheduled Welcome Now?')).setDescription('This will send the configured Scheduled Welcome to **all eligible members currently in the queue**. Successful deliveries are checkpointed and queue-role cleanup may follow.\n\nThis is a real delivery, not a preview.').setFooter({text:`Welcome Studio • ${displayName(interaction)}`})],components:[row(button('admin:welcome:scheduled:confirmRun','▶ Confirm Delivery',ButtonStyle.Danger),button('admin:welcome:scheduled','⬅ Cancel'))]});
if(customId==='admin:welcome:scheduled:confirmRun'){await interaction.deferUpdate();const result=await scheduledWelcome.runScheduledWelcome(interaction.guild,{actorId:interaction.user.id});await interaction.editReply(await buildScheduledPanel(interaction.guild,displayName(interaction)));await interaction.followUp({content:result.reason==='already_running'?'⚠️ Scheduled Welcome is already running for this server. Wait for it to finish before trying again.':result.skipped?'⚠️ Scheduled Welcome was not sent because the Welcome module or Scheduled Welcome is disabled. Enable it in Settings first.':result.empty?'ℹ️ Queue is empty; nothing was posted.':`${result.sendFailed||result.roleRemovalFailed||result.errors?.length?'⚠️ Scheduled Welcome finished with issues.':'✅ Scheduled Welcome run complete.'} Welcomed ${result.welcomed||0} member(s) in ${result.messagesSent||0} message(s).${result.sendFailed?` ${result.sendFailed} failed send(s).`:''}${result.roleRemovalFailed?` ${result.roleRemovalFailed} role cleanup failure(s).`:''}${result.errors?.length?` Errors: ${result.errors.slice(0,2).join(' | ')}`:''}`,ephemeral:true});return true;}
if(customId==='admin:welcome:scheduled:repair'){await interaction.deferUpdate();await scheduledWelcomeHealth.repair(interaction.guild,{actorId:interaction.user.id});return updatePanel(interaction,await buildWelcomeDeliverySettingsPanel(interaction.guild,'scheduled',displayName(interaction)));}
const config=welcome.getWelcomeSection(interaction.guild.id);if(customId==='admin:welcome:enable')guildManager.setModuleEnabled(interaction.guild.id,'welcome',true,{actorId:interaction.user.id});if(customId==='admin:welcome:disable')guildManager.setModuleEnabled(interaction.guild.id,'welcome',false,{actorId:interaction.user.id});if(customId==='admin:welcome:toggleDm')welcome.updateConfig(interaction.guild.id,{dmEnabled:!config.dmEnabled},{actorId:interaction.user.id});if(customId==='admin:welcome:toggleBots')welcome.updateConfig(interaction.guild.id,{ignoreBots:!config.ignoreBots},{actorId:interaction.user.id});if(['admin:welcome:enable','admin:welcome:disable'].includes(customId))return updatePanel(interaction,await buildWelcomeSettingsPanel(interaction.guild,displayName(interaction)));if(customId==='admin:welcome:toggleDm')return updatePanel(interaction,await buildWelcomeDeliverySettingsPanel(interaction.guild,'dm',displayName(interaction)));if(customId==='admin:welcome:toggleBots')return updatePanel(interaction,await buildWelcomeDeliverySettingsPanel(interaction.guild,'instant',displayName(interaction)));
if(customId==='admin:welcome:togglePing'){welcome.updateConfig(interaction.guild.id,{allowUserPing:!config.allowUserPing},{actorId:interaction.user.id});return updatePanel(interaction,buildMentionSettingsPanel(interaction.guild,displayName(interaction)));}
if(customId==='admin:welcome:toggleRolePings'){if(!config.allowRolePings&&!config.mentionRoleIds.length)throw new Error('Choose at least one role before enabling role pings.');welcome.updateConfig(interaction.guild.id,{allowRolePings:!config.allowRolePings},{actorId:interaction.user.id});return updatePanel(interaction,buildMentionSettingsPanel(interaction.guild,displayName(interaction)));}
if(customId==='admin:welcome:dmPublic'){welcome.clearDmTemplate(interaction.guild.id,{actorId:interaction.user.id});clearSelection(interaction.guild.id,interaction.user.id,'dm');return updatePanel(interaction,await buildDmPanel(interaction.guild,displayName(interaction),interaction.user.id));}
if(customId==='admin:welcome:test'){const member=interaction.member;if(!member)throw new Error('Your server member record is unavailable.');const payload=await welcome.buildDiscordPayload(member,'welcome',welcome.getWelcomeSection(interaction.guild.id),{suppressPing:true,ephemeral:true,templateOverride:getPreviewTemplate(interaction.guild.id,interaction.user.id,'public')});return interaction.reply(payload);}
if(customId==='admin:welcome:send'){const member=interaction.member;if(!member)throw new Error('Your server member record is unavailable.');const result=await welcome.sendWelcome(member,{force:true,previewOnly:true,silent:false,skipDm:true});const lines=[result.publicSent?'✅ Public test welcome sent.':null,result.publicFailed?'❌ Public delivery failed.':null,...(result.errors||[]).map(error=>`• ${error}`)].filter(Boolean);if(!lines.length)lines.push('⚠️ No public Welcome was sent. Select a public Welcome channel in Instant Welcome settings, then try again. DM Welcome is tested separately.');return interaction.reply({content:lines.join('\n').slice(0,2000),ephemeral:true});}
if(customId==='admin:welcome:repairInstant'){await interaction.deferUpdate();await welcome.repairConfiguration(interaction.guild,{actorId:interaction.user.id});return updatePanel(interaction,await buildWelcomeDeliverySettingsPanel(interaction.guild,'instant',displayName(interaction)));}
if(customId==='admin:welcome:repairAll'){await interaction.deferUpdate();await welcome.repairConfiguration(interaction.guild,{actorId:interaction.user.id});await scheduledWelcomeHealth.repair(interaction.guild,{actorId:interaction.user.id});return updatePanel(interaction,await buildWelcomeSettingsPanel(interaction.guild,displayName(interaction)));}
if(customId==='admin:welcome:reset'){return updatePanel(interaction,{embeds:[new EmbedBuilder().setColor(0xed4245).setTitle(emojiLabel('WARNING','Reset Welcome?')).setDescription('This will clear Instant Welcome, DM Welcome and Scheduled Welcome settings, including their active template bindings and delivery configuration. This cannot be undone from this panel.\n\n**Saved Embed Studio templates will remain available.**').setFooter({text:`Requested by ${displayName(interaction)}`})],components:[row(button('admin:welcome:resetConfirm','🗑 Confirm Reset',ButtonStyle.Danger),button('admin:welcome','Cancel'))]});}
if(customId==='admin:welcome:resetConfirm'){await interaction.deferUpdate();clearSelection(interaction.guild.id,interaction.user.id);welcome.resetWelcome(interaction.guild.id,{actorId:interaction.user.id});return updatePanel(interaction);}
if(customId==='admin:welcome:export'){const attachment=new AttachmentBuilder(Buffer.from(JSON.stringify({...welcome.exportConfiguration(interaction.guild.id),enabled:guildManager.isModuleEnabled(interaction.guild.id,'welcome')},null,2),'utf8'),{name:`goliath-welcome-${interaction.guild.id}.json`});await interaction.reply({content:'📤 Welcome configuration export.',files:[attachment],ephemeral:true});return true;}
return updatePanel(interaction);}catch(error){const payload={content:`❌ Welcome setup failed: ${error.message}`,ephemeral:true};if(interaction.deferred||interaction.replied)await interaction.followUp(payload).catch(()=>null);else await interaction.reply(payload).catch(()=>null);return true;}}

module.exports={buildWelcomePanel,buildInstantPanel,buildDmPanel,buildMentionSettingsPanel,buildScheduledPanel,handleWelcomeInteraction,buildWelcomeAdminPanel:buildWelcomePanel,handleWelcomeAdminInteraction:handleWelcomeInteraction};
