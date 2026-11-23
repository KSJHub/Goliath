'use strict';

const {
  EmbedBuilder, ActionRowBuilder, ButtonStyle, ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder, StringSelectMenuBuilder, ChannelType, AttachmentBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const { EMOJIS, emojiLabel } = require('../../../core/ui/emojis');
const { navigationButton: button } = require('../../../core/guild/goliathNavigation');
const guildManager = require('../../../core/guild/guildManager');
const welcome = require('./welcome');
const scheduledWelcome = require('./scheduledWelcome');
const scheduledWelcomeHealth = require('./scheduledWelcomeHealth');
const embedTemplateManager = require('../embed/embedTemplates');

const selections = new Map();
function row(...components){return new ActionRowBuilder().addComponents(...components.filter(Boolean));}
function displayName(interaction){return interaction.member?.displayName||interaction.user?.username||'Unknown User';}
function selectionKey(guildId,userId,scope='public'){return `${guildId}:${userId}:${scope}`;}
function getSelection(guildId,userId,scope='public'){return selections.get(selectionKey(guildId,userId,scope))||{};}
function setSelection(guildId,userId,scope,patch){const key=selectionKey(guildId,userId,scope);selections.set(key,{...getSelection(guildId,userId,scope),...patch});}
function clearSelection(guildId,userId,scope){if(scope)return selections.delete(selectionKey(guildId,userId,scope));selections.delete(selectionKey(guildId,userId,'public'));selections.delete(selectionKey(guildId,userId,'dm'));}
function templateTypeLabel(template={}){const type=String(template.templateType||template.module||'global');return type==='global'?'General':type.replace(/([a-z])([A-Z])/g,'$1 $2');}
function sourceLabel(source){return source==='preset'?emojiLabel('WELCOME_PRESET','Welcome Preset'):source==='custom'?emojiLabel('WELCOME_CUSTOM','Custom Welcome'):source==='inherit'?emojiLabel('WELCOME_INHERIT','Same as Public'):emojiLabel('WELCOME_EMBED','Embed Studio');}
function isEligibleWelcomeTemplate(guildId,templateId,scope='public'){
  const template=embedTemplateManager.getTemplate(guildId,templateId);
  if(!template)return false;
  const type=String(template.templateType||'');
  const module=String(template.module||'');
  return !['goodbye','leave','ticketPanel','formSubmission'].includes(type)
    &&(!module||['welcome','global'].includes(module))
    &&!(scope==='public'&&type==='dmWelcome')
    &&(!type||['welcome','dmWelcome','global'].includes(type));
}
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
  }).map(template=>({
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
  const all=getTemplateOptions(guild.id,scope);const staged=getSelection(guild.id,userId,scope);const selected=staged.templateId||activeTemplateId||null;
  const selectedIndex=all.findIndex(option=>option.value===selected);
  const page=Math.max(0,Math.min(Math.max(0,Math.ceil(all.length/25)-1),staged.page??Math.floor(Math.max(0,selectedIndex)/25)));
  const options=all.slice(page*25,page*25+25);
  const menu=new StringSelectMenuBuilder().setCustomId(scope==='dm'?'admin:welcome:dmTemplate':'admin:welcome:template').setPlaceholder(options.length?`Choose an Embed Studio message (${page+1}/${Math.ceil(all.length/25)})`:'No messages available').setMinValues(1).setMaxValues(1).setDisabled(options.length===0);
  if(options.length)menu.addOptions(options.map(option=>({...option,default:option.value===selected})));else menu.addOptions({label:'No messages found',value:'none'});return menu;
}


function templatePageButtons(guild,userId,scope,activeTemplateId){
  const all=getTemplateOptions(guild.id,scope),state=getSelection(guild.id,userId,scope);
  const index=all.findIndex(option=>option.value===(state.templateId||activeTemplateId));
  const max=Math.max(0,Math.ceil(all.length/25)-1),page=Math.max(0,Math.min(max,state.page??Math.floor(Math.max(0,index)/25)));
  return max? [button(`admin:welcome:templatePage:${scope}:${Math.max(0,page-1)}`,'Previous',ButtonStyle.Secondary,page===0),button(`admin:welcome:templatePage:${scope}:${Math.min(max,page+1)}`,'Next',ButtonStyle.Secondary,page===max)]:[];
}

function customTemplateId(scope){return scope==='dm'?'welcome_custom_dm':'welcome_custom_public';}
function customTemplateName(scope){return scope==='dm'?'Custom DM Welcome':'Custom Public Welcome';}
function normalDefault(scope){return scope==='scheduled'?"**👋 Welcome to our newest members!**\n\nLet's give a warm welcome to our newest arrivals.\n\nWe're delighted to have you here. Make yourself at home and enjoy the community! 🎉":scope==='dm'?'Welcome to {guild}, {username}!':'Welcome {userMention} to **{guild}**! You are member #{memberCount}.';}
function customEditorModal(guildId,scope){
  const config=welcome.getWelcomeSection(guildId);
  const saved=config.normalMessages?.[scope];
  const legacy=embedTemplateManager.getTemplate(guildId,customTemplateId(scope));
  const initial=saved||config.normalDefaults?.[scope]||legacy?.content||normalDefault(scope);
  const field=new TextInputBuilder().setCustomId('content').setLabel('Welcome message').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(2000).setValue(initial);
  return new ModalBuilder().setCustomId(scope==='dm'?'admin:welcome:customDmSubmit':'admin:welcome:customPublicSubmit').setTitle(scope==='dm'?'Edit DM Message':'Edit Public Message').addComponents(row(field));
}
function saveCustomWelcome(interaction,scope){
  const content=interaction.fields.getTextInputValue('content').trim();
  if(!content||content.length>2000)throw new Error('Enter a message of 1–2000 characters.');
  const guildId=interaction.guild.id;
  welcome.updateWelcomeSection(guildId,section=>({...section,normalMessages:{...section.normalMessages,[scope]:content},...(scope==='dm'?{dmMessageSource:'custom',dmTemplateId:section.dmTemplateId||'dm_welcome_default'}:{messageSource:'custom'})}),{actorId:interaction.user.id,action:'welcome_normal_message_save'});
  clearSelection(guildId,interaction.user.id,scope);
}

function activeNormalMessage(guildId,scope,config){return scope==='scheduled'?scheduledWelcome.getScheduledConfig(guildId).message:config.normalMessages?.[scope];}
function normalPresetPanel(guild,userId,scope){
  const config=welcome.getWelcomeSection(guild.id), presets=config.normalPresets?.[scope]||{};
  const entries=Object.entries(presets).sort(([,a],[,b])=>String(a.name).localeCompare(String(b.name),undefined,{sensitivity:'base'}));
  const state=getSelection(guild.id,userId,scope),page=Math.min(Math.max(0,Math.ceil(entries.length/25)-1),Math.max(0,state.presetPage||0));
  const selected=Object.hasOwn(presets,state.presetId)?state.presetId:null;
  const menu=new StringSelectMenuBuilder().setCustomId('admin:welcome:normalSelect:'+scope).setPlaceholder('Choose saved message preset').setDisabled(!entries.length).addOptions(entries.length?entries.slice(page*25,page*25+25).map(([id,v])=>({label:((v.content===config.normalDefaults?.[scope]?'⭐ ':'')+String(v.name)).slice(0,100),description:v.content===config.normalDefaults?.[scope]?'Default message':'Saved preset',value:id,default:id===selected})):[{label:'No saved presets',value:'none'}]);
  const has=Boolean(presets[selected]);
  const prefix='admin:welcome:normal:';
  return {embeds:[new EmbedBuilder().setColor(0x5865f2).setTitle(emojiLabel('PRESETS','Welcome Preset Manager')).setDescription(['Save, load and organise normal welcome messages without changing linked embeds.','','### '+emojiLabel('WORKSPACE','Workspace'),'**Workspace:** '+({public:'Instant Public',dm:'Instant DM',scheduled:'Scheduled Welcome'}[scope]),'**Saved presets:** '+entries.length,'**Page:** '+(page+1)+' / '+Math.max(1,Math.ceil(entries.length/25)),'**Selected:** '+(has?presets[selected].name:'None'),has?'**Status:** '+(presets[selected].content===config.normalDefaults?.[scope]?'Default message':'Saved preset'):'Select a preset to inspect it. Selecting does not overwrite your active message.','','### '+emojiLabel('PRESETS',has?'Selected Message':'Active Normal Message'),(has?presets[selected].content:activeNormalMessage(guild.id,scope,config)||'No normal message saved.').slice(0,1800)].join('\n'))],components:[
    row(menu),
    row(button(prefix+'load:'+scope,emojiLabel('MOD_CASE_OPEN','Load Message'),ButtonStyle.Primary,!has),button(prefix+'save:'+scope,emojiLabel('PRESETS','Update / Save'),ButtonStyle.Success,!has),button(prefix+'editPreset-'+selected+':'+scope,emojiLabel('EDIT','Edit Preset'),ButtonStyle.Secondary,!has),button(prefix+'saveAs:'+scope,emojiLabel('ADD','Save As'),ButtonStyle.Success)),
    row(button(prefix+'rename:'+scope,emojiLabel('EDIT','Rename'),ButtonStyle.Secondary,!has),button(prefix+'duplicate:'+scope,emojiLabel('DOCUMENT','Duplicate'),ButtonStyle.Secondary,!has),button(prefix+'delete:'+scope,emojiLabel('DELETE','Delete'),ButtonStyle.Danger,!has)),
    row(button(prefix+'default:'+scope,emojiLabel('USER_STARBOARD','Set Default'),ButtonStyle.Secondary,!has),button(prefix+'defaults:'+scope,'Manage Default',ButtonStyle.Secondary),button(prefix+'export:'+scope,emojiLabel('WELCOME_EXPORT','Export'),ButtonStyle.Secondary),button(prefix+'import:'+scope,'Import',ButtonStyle.Secondary),button(prefix+'variables:'+scope,emojiLabel('VARIABLES','Variables'),ButtonStyle.Secondary)),
    row(button(prefix+'prev:'+scope,'Previous',ButtonStyle.Secondary,page===0),button(prefix+'next:'+scope,'Next',ButtonStyle.Secondary,(page+1)*25>=entries.length),button('admin:welcome:'+(scope==='scheduled'?'scheduled':scope==='dm'?'dm':'instant'),emojiLabel('BACK','Back')))
  ]};
}
function normalPresetNameModal(scope,action,name=''){
  const field=new TextInputBuilder().setCustomId('name').setLabel('Preset name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80);
  if(name)field.setValue(name);
  return new ModalBuilder().setCustomId('admin:welcome:normalName:'+action+':'+scope).setTitle('Welcome · '+action).addComponents(row(field));
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
    .setTitle(emojiLabel('WELCOME', 'Welcome Studio'))
    .setDescription([
      'Build, test and manage your Discord welcome messages from one workspace.',
      '',
      '### '+emojiLabel('WORKSPACE','Workspace'),
      '**Public**　'+sourceLabel(instant.messageSource)+'　•　'+(instant.channelId?'<#'+instant.channelId+'>':'Choose destination'),
      '**Direct Message**　'+(instant.dmEnabled?sourceLabel(instant.dmMessageSource):'Disabled'),
      '**Scheduled**　'+(scheduled.enabled?'Enabled':'Disabled'),
      '',
      '### '+emojiLabel('PRESETS','Message Library'),
      '**Saved presets**　Public '+Object.keys(instant.normalPresets?.public||{}).length+'　•　DM '+Object.keys(instant.normalPresets?.dm||{}).length+'　•　Scheduled '+Object.keys(instant.normalPresets?.scheduled||{}).length,
      'Normal messages are edited here. Linked embeds are managed in Embed Studio.',
      '',
      '### '+emojiLabel('STATUS','Status'),
      '**Readiness**　'+(issues.length?issues.length+' items to review':'Ready'),
      '**Delivery**　'+(enabled?'Enabled':'Disabled')+'　•　**Queue**　'+(scheduledHealth.waitingMembers??'Unavailable'),
      '',
      '### ' + emojiLabel('NEXT_STEP', 'Next Step'),
      nextStep
    ].join('\n'))
    .setFooter({text:`Welcome Studio • ${memberDisplayName}`})
    .setTimestamp();
  return {embeds:[embed],components:[
    row(new ChannelSelectMenuBuilder().setCustomId('admin:welcome:homeChannel').setPlaceholder('Choose public destination').setChannelTypes(ChannelType.GuildText,ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),
    row(button('admin:welcome:instant',emojiLabel('BUILDER','Public Builder'),ButtonStyle.Primary),button('admin:welcome:dm',emojiLabel('BUILDER','DM Builder'),ButtonStyle.Primary),button('admin:welcome:scheduled',emojiLabel('BUILDER','Scheduled Builder'),ButtonStyle.Primary)),
    row(button('admin:welcome:settings',emojiLabel('SETTINGS','Settings')),button('admin:welcome:review',emojiLabel('HEALTHY','Review Readiness')),button('admin:welcome:mentions',emojiLabel('WELCOME_MENTIONS','Mentions'))),
    row(button('admin:modules',emojiLabel('BACK','Back')))
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
      row(button(enabled?'admin:welcome:disable':'admin:welcome:enable',enabled?emojiLabel('PAUSE_PLAIN', 'Disable Welcome'):emojiLabel('WELCOME_RUN', 'Enable Welcome'),enabled?ButtonStyle.Secondary:ButtonStyle.Success)),
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
    row(sourceMenu(config,userId,guild.id,'public')),
    row(new ChannelSelectMenuBuilder().setCustomId('admin:welcome:channel').setPlaceholder(emojiLabel('WELCOME_CHANNEL','Choose destination')).setChannelTypes(ChannelType.GuildText,ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1))
  ];
  if(source==='embedStudio')components.push(row(templateMenu(guild,template?.templateId||config.templateId,userId,'public')));
  const canApply=source!=='embedStudio'||Boolean(state.templateId||(config.messageSource==='embedStudio'&&config.templateId));
  components.push(row(
    button('admin:welcome:applySource',source==='custom'?emojiLabel('BUILDER','Edit Message'):emojiLabel('PRESETS','Apply Source'),ButtonStyle.Primary,!canApply),
    button('admin:welcome:normal:open:public',emojiLabel('PRESETS','Preset Manager'),ButtonStyle.Secondary),
    button('admin:welcome:test',emojiLabel('WELCOME_PREVIEW','Preview'),ButtonStyle.Secondary,!canApply||(source==='custom'&&hasUnsavedSelection)),
    button('admin:welcome:send',emojiLabel('TEST_SEND','Send Test'),ButtonStyle.Success)
  ));
  components.push(row(
    button('admin:welcome',emojiLabel('BACK','Back')),
    button('admin:welcome:instantSettings',emojiLabel('SETTINGS','Settings')),
    ...(source==='embedStudio'?templatePageButtons(guild,userId,'public',template?.templateId||config.templateId):[]),
    ...(hasUnsavedSelection?[button('admin:welcome:discardPublic','Discard',ButtonStyle.Secondary)]:[])
  ));
  const issues=health.warnings||[];
  const next=hasUnsavedSelection&&source==='custom'?emojiLabel('PRESETS','Choose Edit Message to edit and save your custom Welcome before previewing.'):hasUnsavedSelection?emojiLabel('WELCOME_PREVIEW','Preview your selection, then Apply Source to make it live.'):!enabled?emojiLabel('SETTINGS','Enable the Welcome module in Settings before live delivery.'):!config.channelId?emojiLabel('WELCOME_LOCATION','Select a public welcome channel.'):issues.length?emojiLabel('WARNING','Open Settings to review delivery warnings.'):emojiLabel('SUCCESS','Preview or send a test welcome to confirm the message.');
  return {embeds:[new EmbedBuilder().setColor(!enabled?0x747f8d:issues.length?0xfaa61a:0x57f287)
    .setTitle(emojiLabel('BUILDER','Public Message Builder'))
    .setDescription(['Configure the public greeting. Preview checks your selection; Send Test delivers the saved message.','',
      '### ' + emojiLabel('WORKSPACE', 'Workspace'),`**Destination**　${config.channelId?`<#${config.channelId}>`:emojiLabel('INACTIVE','Choose below')}`,`**Source**　${sourceLabel(config.messageSource)}`,`**Saved message**　${health.templateName||template?.name||'Not selected'}`,'','### '+emojiLabel('PRESETS','Message Library'),`**Presets**　${Object.keys(config.normalPresets?.public||{}).length} saved`,...(config.messageSource==='custom'&&config.normalMessages?.public?['**Message content**',config.normalMessages.public.slice(0,900)]:[]),
      ...(hasUnsavedSelection?[`**Pending selection**　${sourceLabel(source)}${pendingTemplate?` · ${pendingTemplate.name||pendingTemplate.templateId}`:''}`, source==='custom'?'**Not live yet** — Edit Message opens the custom editor. Save your message before previewing. Send Test uses the saved live message.':'**Not live yet** — Preview shows this selection. Send Test uses the saved live message until you choose Apply Source.']:[]),'',
      '### ' + emojiLabel('DELIVERY', 'Delivery'),`**Member pings**　${config.allowUserPing?emojiLabel('ACTIVE','On'):emojiLabel('INACTIVE', 'Off')}　•　**Role pings**　${config.allowRolePings?emojiLabel('ACTIVE','On'):emojiLabel('INACTIVE', 'Off')}`,`**Bots**　${config.ignoreBots?'Excluded':'Included'}　•　**DM**　${config.dmEnabled?'On':'Off'}`,`**Sent**　${config.analytics?.publicSent||0}　•　**Failed**　${config.analytics?.publicFailed||0}`,'',
      '### ' + emojiLabel('STATUS', 'Status'),`**Readiness**　${enabled&&config.channelId?emojiLabel('ACTIVE', 'Configured'):emojiLabel('SETUP_REQUIRED', 'Setup required')}`,`**Health**　${health.healthy?emojiLabel('HEALTHY', 'Healthy'):emojiLabel('WARNING', 'Needs attention')}`,`**Pending delivery**　${health.deferredWaiting ?? 'Unknown'}　•　**Partial delivery**　${health.deferredPartial ?? 'Unknown'}`,'',
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
  const canApply=source!=='embedStudio'||Boolean(state.templateId||(config.dmMessageSource==='embedStudio'&&config.dmTemplateId));
  components.push(row(
    button('admin:welcome:dmApply',source==='custom'?emojiLabel('BUILDER','Edit Message'):emojiLabel('PRESETS','Apply Source'),ButtonStyle.Primary,!canApply),
    button('admin:welcome:normal:open:dm',emojiLabel('PRESETS','Preset Manager'),ButtonStyle.Secondary),
    button('admin:welcome:dmPreview',emojiLabel('WELCOME_PREVIEW','Preview'),ButtonStyle.Secondary,!canApply||(source==='custom'&&hasUnsavedSelection)),
    button('admin:welcome:dmSend',emojiLabel('TEST_SEND','Send Test'),ButtonStyle.Success)
  ));
  components.push(row(
    button('admin:welcome',emojiLabel('BACK','Back')),
    button('admin:welcome:dmSettings',emojiLabel('SETTINGS','Settings')),
    ...(source==='embedStudio'?templatePageButtons(guild,userId,'dm',dmTemplate?.templateId||config.dmTemplateId):[]),
    ...(hasUnsavedSelection?[button('admin:welcome:discardDm','Discard',ButtonStyle.Secondary)]:[])
  ));
  const message=config.dmMessageSource==='inherit'?'Same as Public':config.dmMessageSource==='custom'&&config.normalMessages?.dm?'Normal message':dmTemplate?.name||'Not selected';
  return {embeds:[new EmbedBuilder().setColor(config.dmEnabled?0x57f287:0x747f8d)
    .setTitle(emojiLabel('BUILDER','DM Message Builder'))
    .setDescription(['Configure private greetings. Preview checks your selection; Send Test delivers the saved DM message.','',
      '### ' + emojiLabel('WORKSPACE', 'Workspace'),`**Source**　${sourceLabel(config.dmMessageSource)}`,`**Message**　${message}`,'','### '+emojiLabel('PRESETS','Message Library'),`**Presets**　${Object.keys(config.normalPresets?.dm||{}).length} saved`,...(config.dmMessageSource==='custom'&&config.normalMessages?.dm?['**Message content**',config.normalMessages.dm.slice(0,900)]:[]),
      ...(hasUnsavedSelection?[`**Pending selection**　${sourceLabel(source)}${pendingTemplate?` · ${pendingTemplate.name||pendingTemplate.templateId}`:''}`, source==='custom'?'**Not live yet** — Save Message opens the custom editor. Save your message before previewing. Send Test uses the saved live message.':'**Not live yet** — Preview shows this selection. Send Test uses the saved live message until you choose Save Message.']:[]),'',
      '### ' + emojiLabel('DELIVERY', 'Delivery'),`**Direct messages**　${config.dmEnabled?emojiLabel('ACTIVE', 'Enabled'):emojiLabel('INACTIVE','Disabled')}`,`**Sent**　${config.analytics?.dmSent||0}　•　**Failed**　${config.analytics?.dmFailed||0}`,'',
      '### ' + emojiLabel('STATUS', 'Status'),`**Readiness**　${config.dmEnabled?emojiLabel('ACTIVE','Active'):emojiLabel('INACTIVE','Paused')}`,`**Message sync**　${config.dmMessageSource==='inherit'?'Follows Public Welcome':'Independent template'}`,'',
      '### ' + emojiLabel('NEXT_STEP', 'Next Step'),hasUnsavedSelection&&source==='custom'?emojiLabel('PRESETS','Choose Save Message to edit and save your custom DM before previewing.'):hasUnsavedSelection?emojiLabel('WELCOME_PREVIEW','Preview your selection, then Save Message to make it live.'):!config.dmEnabled?emojiLabel('SETTINGS','Open Settings to enable DM delivery.'):source==='custom'?emojiLabel('PRESETS','Edit Message to edit your custom DM.'):emojiLabel('WELCOME_PREVIEW','Preview or send yourself a test DM.')].join('\n'))
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


async function buildScheduledPanel(guild,memberDisplayName='Unknown User'){const config=scheduledWelcome.getScheduledConfig(guild.id);const health=await scheduledWelcomeHealth.buildHealth(guild);const analytics=config.analytics||{};const lastRun=analytics.lastRunAt?`<t:${Math.floor(new Date(analytics.lastRunAt).getTime()/1000)}:R>`:'Never';return {embeds:[new EmbedBuilder().setColor(!config.enabled?0x747f8d:health.healthy?0x57f287:0xfaa61a).setTitle(emojiLabel('BUILDER','Scheduled Message Builder')).setDescription(['Build and test your scheduled greeting, then manage its delivery queue.','','### ' + emojiLabel('WORKSPACE', 'Workspace'),`**Status:** ${config.enabled?'Enabled ✅':'Disabled'}`,`**Queue role:** ${config.queueRoleId?`<@&${config.queueRoleId}>`:'`Not set`'}`,`**Channel:** ${config.channelId?`<#${config.channelId}>`:'`Not set`'}`,`**Time:** \`${config.time}\``,`**Timezone:** \`${config.timezone}\``,`**Waiting now:** \`${health.waitingMembers??'Unavailable'}\``,`**Already welcomed / cleanup pending:** \`${health.stuckMemberIds?.length||0}\``,`**Ping members:** ${config.pingMembers?'Yes':'No'}`,`**Remove queue role:** ${config.removeQueueRole?'Yes ✅':'No'}`,`**Bots:** ${config.ignoreBots?'Excluded':'Included'}`,'','### '+emojiLabel('PRESETS','Message Library'),`**Saved presets**　${Object.keys(welcome.getWelcomeSection(guild.id).normalPresets?.scheduled||{}).length}`,`**Source**　${config.templateId?'Linked Embed Studio message':'Normal message'}`,config.templateId?'Edit the linked embed in Embed Studio.':`**Message content**\n${String(config.message||'').slice(0,900)||'Not set'}`,'','### ' + emojiLabel('STATUS', 'Status'),`Runs: \`${analytics.runs||0}\` · Welcomed: \`${analytics.membersWelcomed||0}\` · Failed sends: \`${analytics.sendFailed||0}\``,`Last run: ${lastRun}`,analytics.lastError?`**Last delivery error:** ${String(analytics.lastError).slice(0,300)}`:null,health.issues.length?`\n**Issues**\n${health.issues.map(issue=>`• ${issue}`).join('\n')}`:'',health.warnings.length?`\n**Warnings**\n${health.warnings.map(warning=>`• ${warning}`).join('\n')}`:''].filter(Boolean).join('\n').slice(0,4096)).setFooter({text:`Requested by ${memberDisplayName}`}).setTimestamp()],components:[row(new RoleSelectMenuBuilder().setCustomId('admin:welcome:scheduled:role').setPlaceholder('Select the Welcome Queue role').setMinValues(0).setMaxValues(1)),row(new ChannelSelectMenuBuilder().setCustomId('admin:welcome:scheduled:channel').setPlaceholder('Select scheduled welcome channel').setChannelTypes(ChannelType.GuildText,ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),row(button('admin:welcome:scheduled:configure',emojiLabel('BUILDER','Schedule & Message'),ButtonStyle.Primary),button('admin:welcome:normal:open:scheduled',emojiLabel('PRESETS','Preset Manager')),button('admin:welcome:scheduled:previewQueue',emojiLabel('WELCOME_QUEUE','View Queue')),button('admin:welcome:scheduled:runNow',emojiLabel('WELCOME_RUN','Run Now'))),row(button('admin:welcome',emojiLabel('BACK','Back')),button('admin:welcome:scheduledSettings',emojiLabel('SETTINGS','Settings')))]};}
async function buildWelcomeDeliverySettingsPanel(guild,scope,memberDisplayName='Unknown User'){
  const config=welcome.getWelcomeSection(guild.id),scheduled=scheduledWelcome.getScheduledConfig(guild.id);
  const instant=scope==='instant',dm=scope==='dm';
  const messageScope=instant?'public':dm?'dm':'scheduled';
  const defaultsButton=()=>button('admin:welcome:normal:defaults:'+messageScope,emojiLabel('PRESETS','Default Message'));
  const libraryButton=()=>button('admin:welcome:normal:open:'+messageScope,emojiLabel('PRESETS','Preset Manager'));
  const controls=instant?[
    row(button('admin:welcome:mentions',emojiLabel('WELCOME_MENTIONS','Mention Settings')),button('admin:welcome:toggleBots',config.ignoreBots?emojiLabel('AUTOMOD','Exclude Bots: On'):emojiLabel('AUTOMOD','Exclude Bots: Off'),config.ignoreBots?ButtonStyle.Success:ButtonStyle.Secondary),button('admin:welcome:repairInstant',emojiLabel('WELCOME_DIAGNOSTICS','Diagnostics'))),
    row(defaultsButton(),libraryButton(),button('admin:welcome:instant',emojiLabel('BACK', 'Back')))
  ]:dm?[
    row(button('admin:welcome:toggleDm',config.dmEnabled?emojiLabel('PAUSE_PLAIN', 'Disable DM'):emojiLabel('WELCOME_RUN', 'Enable DM'),config.dmEnabled?ButtonStyle.Secondary:ButtonStyle.Success)),
    row(defaultsButton(),libraryButton(),button('admin:welcome:dm',emojiLabel('BACK','Back')))
  ]:[
    row(button('admin:welcome:scheduled:togglePing',scheduled.pingMembers?emojiLabel('WELCOME_MENTIONS','Pings: On'):emojiLabel('WELCOME_MUTED','Pings: Off'),scheduled.pingMembers?ButtonStyle.Success:ButtonStyle.Secondary),button('admin:welcome:scheduled:toggleRemove',scheduled.removeQueueRole?emojiLabel('WELCOME_CLEANUP','Cleanup: On'):emojiLabel('WELCOME_CLEANUP','Cleanup: Off'),scheduled.removeQueueRole?ButtonStyle.Success:ButtonStyle.Secondary),button('admin:welcome:scheduled:toggleBots',scheduled.ignoreBots?emojiLabel('AUTOMOD','Exclude Bots: On'):emojiLabel('AUTOMOD','Exclude Bots: Off'),scheduled.ignoreBots?ButtonStyle.Success:ButtonStyle.Secondary)),
    row(button(scheduled.enabled?'admin:welcome:scheduled:disable':'admin:welcome:scheduled:enable',scheduled.enabled?emojiLabel('PAUSE_PLAIN', 'Disable Scheduled'):emojiLabel('WELCOME_RUN', 'Enable Scheduled'),scheduled.enabled?ButtonStyle.Secondary:ButtonStyle.Success),button('admin:welcome:scheduled:repair',emojiLabel('WELCOME_DIAGNOSTICS','Diagnostics'))),
    row(defaultsButton(),libraryButton(),button('admin:welcome:scheduled',emojiLabel('BACK','Back')))
  ];
  return {embeds:[new EmbedBuilder().setColor(0x5865f2).setTitle(emojiLabel('SETTINGS', `Welcome · ${instant?'Instant':dm?'DM':'Scheduled'} Settings`))
    .setDescription(['### ' + emojiLabel('WORKSPACE', 'Workspace'),`**Area**　${instant?'Public Welcome':dm?'Direct Message':'Scheduled Queue'}`,'',
      '### ' + emojiLabel('DELIVERY', 'Delivery'),instant?'Configure bot exclusions, mentions and public delivery health.':dm?'Enable or disable private welcome messages.':'Configure member pings, queue cleanup, bot exclusions and schedule availability.','',
      '### '+emojiLabel('PRESETS','Message Library'),`**Default**　${config.normalDefaults?.[messageScope]?'Customised':'Original'}`,`**Saved presets**　${Object.keys(config.normalPresets?.[messageScope]||{}).length}`,'','### ' + emojiLabel('NEXT_STEP', 'Next Step'),'Change the settings below, then return to your Welcome workspace.'].join('\n'))
    .setFooter({text:`Welcome Studio • ${memberDisplayName}`}).setTimestamp()],components:controls};
}

function buildScheduledModal(config){return new ModalBuilder().setCustomId('admin:welcome:scheduled:configureSubmit').setTitle('Scheduled Welcome').addComponents(row(new TextInputBuilder().setCustomId('time').setLabel('Daily time (24-hour HH:MM)').setStyle(TextInputStyle.Short).setRequired(true).setValue(config.time||'19:00').setMaxLength(5)),row(new TextInputBuilder().setCustomId('timezone').setLabel('Timezone').setStyle(TextInputStyle.Short).setRequired(true).setValue(config.timezone||'Europe/London').setMaxLength(80)),row(new TextInputBuilder().setCustomId('message').setLabel('Welcome message').setStyle(TextInputStyle.Paragraph).setRequired(true).setValue(String(config.message||'').slice(0,1800)).setMaxLength(1800)),row(new TextInputBuilder().setCustomId('batchSize').setLabel('Members per batch (1-50)').setStyle(TextInputStyle.Short).setRequired(true).setValue(String(config.batchSize||20)).setMaxLength(2)));}
function getPreviewTemplate(guildId,userId,scope){
  const config=welcome.getWelcomeSection(guildId);
  const state=getSelection(guildId,userId,scope);
  const source=state.source||(scope==='dm'?config.dmMessageSource:config.messageSource);
  if(source==='embedStudio'&&state.source==='embedStudio'&&!state.templateId){
    const savedSource=scope==='dm'?config.dmMessageSource:config.messageSource;
    const savedTemplateId=scope==='dm'?config.dmTemplateId:config.templateId;
    if(savedSource!=='embedStudio'||!savedTemplateId)throw new Error('Choose an Embed Studio message before previewing.');
  }
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
    // Inherited plain messages must render as text, not force the linked public embed.
    if(config.messageSource==='custom'&&config.normalMessages?.public?.trim())return null;
    return welcome.getAssignedTemplate(guildId,'welcome',config);
  }
  return null;
}
async function updatePanel(interaction,payload=null){const next=payload||await buildWelcomePanel(interaction.guild,displayName(interaction));if(interaction.deferred||interaction.replied)return interaction.editReply(next);return interaction.update(next);}

async function handleWelcomeInteraction(interaction){const customId=String(interaction.customId||'');if(!customId.startsWith('admin:welcome'))return false;try{
if(/^admin:welcome:normal(?:Select|Name|):/.test(customId)){
  const parts=customId.split(':'),scope=parts.at(-1),action=parts[3],guildId=interaction.guild.id,userId=interaction.user.id;
  if(!['public','dm','scheduled'].includes(scope))throw new Error('Invalid message workspace.');
  const limit=scope==='scheduled'?1800:2000;
  const config=welcome.getWelcomeSection(guildId),presets=config.normalPresets?.[scope]||{},state=getSelection(guildId,userId,scope),selected=state.presetId,current=Object.hasOwn(presets,state.presetId)?presets[selected]:null;
  const panel=()=>normalPresetPanel(interaction.guild,userId,scope);
  const mutate=fn=>welcome.updateWelcomeSection(guildId,s=>({...s,normalPresets:{...s.normalPresets,[scope]:fn({...s.normalPresets?.[scope]})}}),{actorId:userId,action:'welcome_normal_preset'});
  if(parts[2]==='normalSelect'&&interaction.isStringSelectMenu?.()){const id=interaction.values?.[0];if(!Object.hasOwn(presets,id))throw new Error('Preset unavailable.');setSelection(guildId,userId,scope,{presetId:id});return updatePanel(interaction,panel());}
  if(parts[2]==='normalName'&&interaction.isModalSubmit?.()){
    const name=interaction.fields.getTextInputValue('name').trim();
    if(!name||name.length>80)throw new Error('Enter a valid preset name.');
    if(!['saveAs','rename','duplicate'].includes(action))throw new Error('Invalid preset action.');
    const content=action==='saveAs'?activeNormalMessage(guildId,scope,config):current?.content;
    if(!content||content.length>limit)throw new Error('Save a valid normal message or select a preset first.');
    const id=action==='rename'?selected:require('node:crypto').randomUUID();
    mutate(all=>{if(Object.entries(all).some(([key,v])=>key!==id&&v.name.toLowerCase()===name.toLowerCase()))throw new Error('That preset name already exists.');if(action==='rename'&&!all[id])throw new Error('Preset no longer exists.');all[id]={name,content};return all;});
    setSelection(guildId,userId,scope,{presetId:id});
    return interaction.reply({...panel(),ephemeral:true});
  }
  if(action.startsWith('editPreset-')){
    const id=action.slice('editPreset-'.length),preset=Object.hasOwn(presets,id)?presets[id]:null;
    if(!preset)throw new Error('Selected preset no longer exists.');
    const field=new TextInputBuilder().setCustomId('content').setLabel('Preset message').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(limit).setValue(preset.content.slice(0,limit));
    return interaction.showModal(new ModalBuilder().setCustomId('admin:welcome:normal:savePreset-'+id+':'+scope).setTitle('Edit Saved Preset').addComponents(row(field)));
  }
  if(action.startsWith('savePreset-')&&interaction.isModalSubmit?.()){
    const id=action.slice('savePreset-'.length),content=interaction.fields.getTextInputValue('content').trim();
    if(!content||content.length>limit)throw new Error('Enter a valid preset message.');
    mutate(all=>{if(!Object.hasOwn(all,id))throw new Error('Preset no longer exists.');all[id]={...all[id],content};return all;});
    setSelection(guildId,userId,scope,{presetId:id});
    return interaction.reply({...panel(),ephemeral:true});
  }
  if(action==='open')return updatePanel(interaction,panel());
  if(action==='defaults')return updatePanel(interaction,{embeds:[new EmbedBuilder().setColor(0x5865f2).setTitle('Welcome · Default Message').setDescription('Edit the saved default independently of the active message, or explicitly load it.\n\n'+(config.normalDefaults?.[scope]||normalDefault(scope)))],components:[row(button('admin:welcome:normal:editDefault:'+scope,'Edit Default',ButtonStyle.Primary),button('admin:welcome:normal:loadDefault:'+scope,'Load Default',ButtonStyle.Success),button('admin:welcome:normal:restore:'+scope,'Restore Original',ButtonStyle.Danger)),row(button('admin:welcome:normal:open:'+scope,emojiLabel('BACK','Back')))]});
  if(action==='editDefault'){
    const field=new TextInputBuilder().setCustomId('content').setLabel('Default message').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(limit).setValue((config.normalDefaults?.[scope]||normalDefault(scope)).slice(0,limit));
    return interaction.showModal(new ModalBuilder().setCustomId('admin:welcome:normal:saveDefault:'+scope).setTitle('Edit Default Message').addComponents(row(field)));
  }
  if(action==='saveDefault'&&interaction.isModalSubmit?.()){
    const content=interaction.fields.getTextInputValue('content').trim();
    if(!content||content.length>limit)throw new Error('Enter a valid default message.');
    welcome.updateWelcomeSection(guildId,s=>({...s,normalDefaults:{...s.normalDefaults,[scope]:content}}),{actorId:userId,action:'welcome_normal_default_edit'});
    return interaction.reply({...panel(),ephemeral:true});
  }
  if(action==='loadDefault')return updatePanel(interaction,{embeds:[new EmbedBuilder().setColor(0xfaa61a).setTitle('Activate saved default?').setDescription('This changes the active message source to a normal message. Linked Embed Studio templates are not deleted.')],components:[row(button('admin:welcome:normal:confirmLoadDefault:'+scope,'Activate Default',ButtonStyle.Success),button('admin:welcome:normal:defaults:'+scope,'Cancel'))]});
  if(action==='confirmLoadDefault'){
    const content=config.normalDefaults?.[scope]||normalDefault(scope);
    if(!content.trim()||content.length>limit)throw new Error('Saved default is invalid.');
    if(scope==='scheduled')scheduledWelcome.updateScheduledConfig(guildId,{message:content,templateId:null},{actorId:userId});
    else welcome.updateWelcomeSection(guildId,s=>({...s,normalMessages:{...s.normalMessages,[scope]:content},...(scope==='dm'?{dmMessageSource:'custom',dmTemplateId:s.dmTemplateId||'dm_welcome_default'}:{messageSource:'custom'})}),{actorId:userId,action:'welcome_normal_default_load'});
    clearSelection(guildId,userId,scope);
    return updatePanel(interaction,panel());
  }

  if(action==='variables'){
    const variables=require('../../../core/guild/guildVariables').variablesForModule('welcome');
    const list=Array.isArray(variables)?variables.map(v=>typeof v==='string'?v:v?.key).filter(Boolean):Object.keys(variables||{});
    const description=list.map(v=>'• `'+(v.startsWith('{')?v:'{'+v+'}')+'`').join('\n').slice(0,3500);
    return interaction.reply({embeds:[new EmbedBuilder().setColor(0x5865f2).setTitle('Welcome · Message Variables').setDescription('Use these placeholders in normal messages. They are resolved when the message is sent.\n\n'+(description||'No variables available.'))],ephemeral:true});
  }
  if(action==='prev'||action==='next'){setSelection(guildId,userId,scope,{presetPage:Math.max(0,(state.presetPage||0)+(action==='next'?1:-1))});return updatePanel(interaction,panel());}
  if(action==='saveAs')return interaction.showModal(normalPresetNameModal(scope,action));
  if(action==='import'){
    const field=new TextInputBuilder().setCustomId('json').setLabel('Preset JSON').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(4000);
    return interaction.showModal(new ModalBuilder().setCustomId('admin:welcome:normal:importSubmit:'+scope).setTitle('Import Welcome Presets').addComponents(row(field)));
  }
  if(action==='importSubmit'&&interaction.isModalSubmit?.()){
    let data;try{data=JSON.parse(interaction.fields.getTextInputValue('json'));}catch{throw new Error('Invalid JSON. Paste a Welcome preset export.');}
    if(data?.version!==1||data.scope!==scope||!Array.isArray(data.presets)||data.presets.length>100)throw new Error('Expected a version 1 export for this workspace, with at most 100 presets.');
    const imported=data.presets.map(v=>{
      if(typeof v?.name!=='string'||typeof v?.content!=='string'||!v.name.trim()||v.name.trim().length>80||!v.content.trim()||v.content.length>limit)throw new Error('Every preset must have a name (1–80 characters) and message within '+limit+' characters.');
      return {name:v.name.trim(),content:v.content.trim()};
    });
    const names=new Set();
    for(const v of imported){const key=v.name.toLowerCase();if(names.has(key))throw new Error('Duplicate names in import.');names.add(key);}
    if(data.defaultMessage!==undefined&&(typeof data.defaultMessage!=='string'||!data.defaultMessage.trim()||data.defaultMessage.length>limit))throw new Error('Invalid default message.');
    mutate(all=>{if(Object.values(all).some(v=>names.has(v.name.toLowerCase())))throw new Error('An imported preset name already exists. Rename it before importing.');for(const v of imported)all[require('node:crypto').randomUUID()]=v;return all;});
    return interaction.reply({...panel(),ephemeral:true});
  }
  if(action==='export'){const attachment=new AttachmentBuilder(Buffer.from(JSON.stringify({version:1,scope,presets:Object.values(presets),defaultMessage:config.normalDefaults?.[scope]||normalDefault(scope)},null,2)),{name:'welcome-'+scope+'-presets.json'});return interaction.reply({files:[attachment],ephemeral:true});}
  if(action==='restore')return updatePanel(interaction,{embeds:[new EmbedBuilder().setColor(0xfaa61a).setTitle('Restore original normal message?').setDescription('This resets the normal-message default and activates it. Saved presets and Embed Studio templates are retained.')],components:[row(button('admin:welcome:normal:confirmRestore:'+scope,'Confirm Restore',ButtonStyle.Danger),button('admin:welcome:normal:open:'+scope,'Cancel'))]});
  if(action==='confirmRestore'){const content=normalDefault(scope);if(scope==='scheduled'){scheduledWelcome.updateScheduledConfig(guildId,{message:content,templateId:null},{actorId:userId});welcome.updateWelcomeSection(guildId,s=>({...s,normalDefaults:{...s.normalDefaults,scheduled:content}}),{actorId:userId,action:'welcome_normal_default_restore'});return updatePanel(interaction,panel());}welcome.updateWelcomeSection(guildId,s=>({...s,normalDefaults:{...s.normalDefaults,[scope]:content},normalMessages:{...s.normalMessages,[scope]:content},...(scope==='dm'?{dmMessageSource:'custom',dmTemplateId:s.dmTemplateId||'dm_welcome_default'}:{messageSource:'custom'})}),{actorId:userId,action:'welcome_normal_default_restore'});return updatePanel(interaction,panel());}
  if(!current)throw new Error('Choose a saved preset first.');
  if(action==='rename'||action==='duplicate')return interaction.showModal(normalPresetNameModal(scope,action,action==='rename'?current.name:''));
  if(action==='default'){welcome.updateWelcomeSection(guildId,s=>({...s,normalDefaults:{...s.normalDefaults,[scope]:current.content}}),{actorId:userId,action:'welcome_normal_default_save'});return updatePanel(interaction,panel());}
  if(action==='save'){const content=activeNormalMessage(guildId,scope,config);if(!content||content.length>limit)throw new Error('Save a valid normal message first.');mutate(all=>{if(!all[selected])throw new Error('Preset unavailable.');all[selected]={...all[selected],content};return all;});}
  else if(action==='load'){if(scope==='scheduled'){if(current.content.length>1800)throw new Error('Scheduled messages must not exceed 1800 characters.');scheduledWelcome.updateScheduledConfig(guildId,{message:current.content,templateId:null},{actorId:userId});clearSelection(guildId,userId,scope);return updatePanel(interaction,await buildScheduledPanel(interaction.guild,displayName(interaction)));}welcome.updateWelcomeSection(guildId,s=>({...s,normalMessages:{...s.normalMessages,[scope]:current.content},...(scope==='dm'?{dmMessageSource:'custom',dmTemplateId:s.dmTemplateId||'dm_welcome_default'}:{messageSource:'custom'})}),{actorId:userId,action:'welcome_normal_preset_load'});clearSelection(guildId,userId,scope);return updatePanel(interaction,await (scope==='dm'?buildDmPanel:buildInstantPanel)(interaction.guild,displayName(interaction),userId));}
  else if(action==='delete')return updatePanel(interaction,{embeds:[new EmbedBuilder().setColor(0xed4245).setTitle('Delete selected preset?').setDescription('The active welcome message will not be changed.')],components:[row(button('admin:welcome:normal:confirmDelete-'+selected+':'+scope,'Confirm Delete',ButtonStyle.Danger),button('admin:welcome:normal:open:'+scope,'Cancel'))]});
  else if(action.startsWith('confirmDelete-')){const confirmed=action.slice('confirmDelete-'.length);if(confirmed!==selected)throw new Error('Selection changed. Confirm deletion again.');mutate(all=>{delete all[confirmed];return all;});setSelection(guildId,userId,scope,{presetId:null});}
  else throw new Error('Invalid preset action.');
  return updatePanel(interaction,panel());
}

if(customId==='admin:welcome:review'){
  const guild=interaction.guild,instant=await welcome.buildHealthReport(guild),scheduled=await scheduledWelcomeHealth.buildHealth(guild);
  const warnings=[...(instant.warnings||[]),...(scheduled.warnings?.length?scheduled.warnings:scheduled.issues||[])];
  return updatePanel(interaction,{embeds:[new EmbedBuilder().setColor(warnings.length?0xfaa61a:0x57f287).setTitle('Welcome Readiness').setDescription(['### '+emojiLabel('STATUS','Delivery Validation'),'**Instant**　'+(instant.healthy?'Healthy':'Review required'),'**Scheduled**　'+(scheduled.healthy?'Healthy':'Review required'),'','### '+emojiLabel('WELCOME_DIAGNOSTICS','Diagnostics'),...(warnings.length?warnings.map(w=>'• '+String(w)):['No reported warnings.'])].join('\n').slice(0,4096))],components:[row(button('admin:welcome:review','Recheck',ButtonStyle.Primary),button('admin:welcome:repairAll','Repair',ButtonStyle.Secondary)),row(button('admin:welcome','Back'))]});
}
if(/^admin:welcome:templatePage:(public|dm):\d+$/.test(customId)){const [, , ,scope,rawPage]=customId.split(':');setSelection(interaction.guild.id,interaction.user.id,scope,{page:Number(rawPage)});return updatePanel(interaction,await (scope==='dm'?buildDmPanel:buildInstantPanel)(interaction.guild,displayName(interaction),interaction.user.id));}
if(interaction.isStringSelectMenu?.()&&customId==='admin:welcome:navigate'){const choice=interaction.values?.[0];if(choice==='instant')return updatePanel(interaction,await buildInstantPanel(interaction.guild,displayName(interaction),interaction.user.id));if(choice==='dm')return updatePanel(interaction,await buildDmPanel(interaction.guild,displayName(interaction),interaction.user.id));if(choice==='scheduled')return updatePanel(interaction,await buildScheduledPanel(interaction.guild,displayName(interaction)));if(choice==='mentions')return updatePanel(interaction,buildMentionSettingsPanel(interaction.guild,displayName(interaction)));throw new Error('Choose a valid Welcome workspace.');}
if(interaction.isChannelSelectMenu?.()&&customId==='admin:welcome:homeChannel'){welcome.updateConfig(interaction.guild.id,{channelId:interaction.values?.[0]||null},{actorId:interaction.user.id});return updatePanel(interaction);}
if(['admin:welcome:instantSettings','admin:welcome:dmSettings','admin:welcome:scheduledSettings'].includes(customId)){const scope=customId==='admin:welcome:instantSettings'?'instant':customId==='admin:welcome:dmSettings'?'dm':'scheduled';return updatePanel(interaction,await buildWelcomeDeliverySettingsPanel(interaction.guild,scope,displayName(interaction)));}
if(customId==='admin:welcome:discardPublic'){clearSelection(interaction.guild.id,interaction.user.id,'public');return updatePanel(interaction,await buildInstantPanel(interaction.guild,displayName(interaction),interaction.user.id));}
if(customId==='admin:welcome:discardDm'){clearSelection(interaction.guild.id,interaction.user.id,'dm');return updatePanel(interaction,await buildDmPanel(interaction.guild,displayName(interaction),interaction.user.id));}
if(customId==='admin:welcome:settings')return updatePanel(interaction,await buildWelcomeSettingsPanel(interaction.guild,displayName(interaction)));if(customId==='admin:welcome')return updatePanel(interaction);if(customId==='admin:welcome:instant')return updatePanel(interaction,await buildInstantPanel(interaction.guild,displayName(interaction),interaction.user.id));if(customId==='admin:welcome:dm')return updatePanel(interaction,await buildDmPanel(interaction.guild,displayName(interaction),interaction.user.id));if(customId==='admin:welcome:mentions')return updatePanel(interaction,buildMentionSettingsPanel(interaction.guild,displayName(interaction)));if(customId==='admin:welcome:scheduled')return updatePanel(interaction,await buildScheduledPanel(interaction.guild,displayName(interaction)));
if(interaction.isChannelSelectMenu?.()&&customId==='admin:welcome:channel'){welcome.updateConfig(interaction.guild.id,{channelId:interaction.values?.[0]||null},{actorId:interaction.user.id});return updatePanel(interaction,await buildInstantPanel(interaction.guild,displayName(interaction),interaction.user.id));}
if(interaction.isRoleSelectMenu?.()&&customId==='admin:welcome:roles'){welcome.updateConfig(interaction.guild.id,{mentionRoleIds:(interaction.values||[]).filter(roleId=>roleId!==interaction.guild.id)},{actorId:interaction.user.id});return updatePanel(interaction,buildMentionSettingsPanel(interaction.guild,displayName(interaction)));}
if(interaction.isStringSelectMenu?.()&&customId==='admin:welcome:source'){const source=interaction.values?.[0];if(!['embedStudio','preset','custom'].includes(source))throw new Error('Choose a valid message source.');if(source==='custom'&&welcome.getWelcomeSection(interaction.guild.id).messageSource==='custom'){clearSelection(interaction.guild.id,interaction.user.id,'public');return updatePanel(interaction,await buildInstantPanel(interaction.guild,displayName(interaction),interaction.user.id));}setSelection(interaction.guild.id,interaction.user.id,'public',{source,templateId:source==='embedStudio'&&getSelection(interaction.guild.id,interaction.user.id,'public').source==='embedStudio'?getSelection(interaction.guild.id,interaction.user.id,'public').templateId:null});return updatePanel(interaction,await buildInstantPanel(interaction.guild,displayName(interaction),interaction.user.id));}
if(interaction.isStringSelectMenu?.()&&customId==='admin:welcome:template'){const templateId=interaction.values?.[0];if(!templateId||templateId==='none'||!isEligibleWelcomeTemplate(interaction.guild.id,templateId,'public'))throw new Error('Choose an available Public Welcome message.');setSelection(interaction.guild.id,interaction.user.id,'public',{source:'embedStudio',templateId});return updatePanel(interaction,await buildInstantPanel(interaction.guild,displayName(interaction),interaction.user.id));}
if(customId==='admin:welcome:applySource'){const state=getSelection(interaction.guild.id,interaction.user.id,'public');const source=state.source||welcome.getWelcomeSection(interaction.guild.id).messageSource||'preset';if(source==='custom')return interaction.showModal(customEditorModal(interaction.guild.id,'public'));if(source==='preset')welcome.bindWelcomeTemplate(interaction.guild.id,'welcome_default','welcome',{actorId:interaction.user.id});else{const templateId=state.templateId||(welcome.getWelcomeSection(interaction.guild.id).messageSource==='embedStudio'?welcome.getWelcomeSection(interaction.guild.id).templateId:null);if(!templateId||!isEligibleWelcomeTemplate(interaction.guild.id,templateId,'public'))throw new Error('Choose an available Public Welcome Embed Studio message first.');welcome.bindWelcomeTemplate(interaction.guild.id,templateId,'welcome',{actorId:interaction.user.id});}clearSelection(interaction.guild.id,interaction.user.id,'public');return updatePanel(interaction,await buildInstantPanel(interaction.guild,displayName(interaction),interaction.user.id));}
if(interaction.isStringSelectMenu?.()&&customId==='admin:welcome:dmSource'){const source=interaction.values?.[0];if(!['inherit','embedStudio','preset','custom'].includes(source))throw new Error('Choose a valid DM message source.');if(source==='custom'&&welcome.getWelcomeSection(interaction.guild.id).dmMessageSource==='custom'){clearSelection(interaction.guild.id,interaction.user.id,'dm');return updatePanel(interaction,await buildDmPanel(interaction.guild,displayName(interaction),interaction.user.id));}setSelection(interaction.guild.id,interaction.user.id,'dm',{source,templateId:source==='embedStudio'&&getSelection(interaction.guild.id,interaction.user.id,'dm').source==='embedStudio'?getSelection(interaction.guild.id,interaction.user.id,'dm').templateId:null});return updatePanel(interaction,await buildDmPanel(interaction.guild,displayName(interaction),interaction.user.id));}
if(interaction.isStringSelectMenu?.()&&customId==='admin:welcome:dmTemplate'){const templateId=interaction.values?.[0];if(!templateId||templateId==='none'||!isEligibleWelcomeTemplate(interaction.guild.id,templateId,'dm'))throw new Error('Choose an available DM Welcome message.');setSelection(interaction.guild.id,interaction.user.id,'dm',{source:'embedStudio',templateId});return updatePanel(interaction,await buildDmPanel(interaction.guild,displayName(interaction),interaction.user.id));}
if(customId==='admin:welcome:dmApply'){const state=getSelection(interaction.guild.id,interaction.user.id,'dm');const source=state.source||welcome.getWelcomeSection(interaction.guild.id).dmMessageSource||'inherit';if(source==='custom')return interaction.showModal(customEditorModal(interaction.guild.id,'dm'));if(source==='inherit')welcome.clearDmTemplate(interaction.guild.id,{actorId:interaction.user.id});else if(source==='preset')welcome.bindWelcomeTemplate(interaction.guild.id,'dm_welcome_default','dm_welcome',{actorId:interaction.user.id});else{const templateId=state.templateId||(welcome.getWelcomeSection(interaction.guild.id).dmMessageSource==='embedStudio'?welcome.getWelcomeSection(interaction.guild.id).dmTemplateId:null);if(!templateId||!isEligibleWelcomeTemplate(interaction.guild.id,templateId,'dm'))throw new Error('Choose an available DM Welcome Embed Studio message first.');welcome.bindWelcomeTemplate(interaction.guild.id,templateId,'dm_welcome',{actorId:interaction.user.id});}clearSelection(interaction.guild.id,interaction.user.id,'dm');return updatePanel(interaction,await buildDmPanel(interaction.guild,displayName(interaction),interaction.user.id));}
if(interaction.isModalSubmit?.()&&customId==='admin:welcome:customPublicSubmit'){saveCustomWelcome(interaction,'public');return interaction.reply({content:emojiLabel('SUCCESS','Public Welcome message saved and selected. Use Instant Welcome to preview or test it.'),ephemeral:true,components:[row(button('admin:welcome:instant',emojiLabel('THREAT', 'Open Instant Welcome'),ButtonStyle.Primary))]});}
if(interaction.isModalSubmit?.()&&customId==='admin:welcome:customDmSubmit'){saveCustomWelcome(interaction,'dm');return interaction.reply({content:emojiLabel('SUCCESS','DM Welcome message saved and selected. Use DM Welcome to preview or test it.'),ephemeral:true,components:[row(button('admin:welcome:dm',emojiLabel('WELCOME_DM','Open DM Welcome'),ButtonStyle.Primary))]});}
if(customId==='admin:welcome:dmPreview'){const member=interaction.member;if(!member)throw new Error('Your server member record is unavailable.');const payload=await welcome.buildDiscordPayload(member,'dmWelcome',welcome.getWelcomeSection(interaction.guild.id),{suppressPing:true,ephemeral:true,templateOverride:getPreviewTemplate(interaction.guild.id,interaction.user.id,'dm')});return interaction.reply(payload);}
if(customId==='admin:welcome:dmSend'){const member=interaction.member;if(!member)throw new Error('Your server member record is unavailable.');const config=welcome.getWelcomeSection(interaction.guild.id);if(!config.dmEnabled)throw new Error('Enable DM Welcome before sending a DM test.');const payload=await welcome.buildDiscordPayload(member,'dmWelcome',config,{suppressPing:true});await interaction.user.send(payload);return interaction.reply({content:emojiLabel('HEALTHY', 'Test Welcome DM sent to you.'),ephemeral:true});}
if(interaction.isRoleSelectMenu?.()&&customId==='admin:welcome:scheduled:role'){const previous=scheduledWelcome.getScheduledConfig(interaction.guild.id);const queueRoleId=interaction.values?.[0]||null;scheduledWelcome.updateScheduledConfig(interaction.guild.id,queueRoleId===previous.queueRoleId?{queueRoleId}:{queueRoleId,completedMemberIds:[]},{actorId:interaction.user.id});return updatePanel(interaction,await buildScheduledPanel(interaction.guild,displayName(interaction)));}
if(interaction.isChannelSelectMenu?.()&&customId==='admin:welcome:scheduled:channel'){scheduledWelcome.updateScheduledConfig(interaction.guild.id,{channelId:interaction.values?.[0]||null},{actorId:interaction.user.id});return updatePanel(interaction,await buildScheduledPanel(interaction.guild,displayName(interaction)));}
if(customId==='admin:welcome:scheduled:configure')return interaction.showModal(buildScheduledModal(scheduledWelcome.getScheduledConfig(interaction.guild.id)));if(interaction.isModalSubmit?.()&&customId==='admin:welcome:scheduled:configureSubmit'){scheduledWelcome.updateScheduledConfig(interaction.guild.id,{time:interaction.fields.getTextInputValue('time'),timezone:interaction.fields.getTextInputValue('timezone'),message:interaction.fields.getTextInputValue('message'),batchSize:(()=>{const raw=interaction.fields.getTextInputValue('batchSize').trim();if(!/^(?:[1-9]|[1-4][0-9]|50)$/.test(raw))throw new Error('Members per batch must be a number from 1 to 50.');return Number(raw);})()},{actorId:interaction.user.id});return updatePanel(interaction,await buildScheduledPanel(interaction.guild,displayName(interaction)));}
if(customId==='admin:welcome:scheduled:enable'){const config=scheduledWelcome.getScheduledConfig(interaction.guild.id);if(!config.queueRoleId||!config.channelId)throw new Error('Choose a queue role and channel before enabling Scheduled Welcome.');scheduledWelcome.updateScheduledConfig(interaction.guild.id,{enabled:true},{actorId:interaction.user.id});return updatePanel(interaction,await buildWelcomeDeliverySettingsPanel(interaction.guild,'scheduled',displayName(interaction)));}
if(customId==='admin:welcome:scheduled:disable'){scheduledWelcome.updateScheduledConfig(interaction.guild.id,{enabled:false},{actorId:interaction.user.id});return updatePanel(interaction,await buildWelcomeDeliverySettingsPanel(interaction.guild,'scheduled',displayName(interaction)));}
if(customId==='admin:welcome:scheduled:togglePing'||customId==='admin:welcome:scheduled:toggleRemove'||customId==='admin:welcome:scheduled:toggleBots'){const config=scheduledWelcome.getScheduledConfig(interaction.guild.id);const patch=customId.endsWith('togglePing')?{pingMembers:!config.pingMembers}:customId.endsWith('toggleRemove')?{removeQueueRole:!config.removeQueueRole}:{ignoreBots:!config.ignoreBots};scheduledWelcome.updateScheduledConfig(interaction.guild.id,patch,{actorId:interaction.user.id});return updatePanel(interaction,await buildWelcomeDeliverySettingsPanel(interaction.guild,'scheduled',displayName(interaction)));}
if(customId==='admin:welcome:scheduled:previewQueue'){const members=await scheduledWelcome.getWaitingMembers(interaction.guild);const config=scheduledWelcome.getScheduledConfig(interaction.guild.id);const completed=config.completedMemberIds.length;const text=members.length?members.slice(0,35).map(member=>`• @${member.displayName||member.user?.username||member.id}`).join('\n'):'No members are currently waiting.';return interaction.reply({content:`**Scheduled Welcome Queue**\nWaiting: **${members.length}** · Already welcomed / awaiting cleanup: **${completed}**\n\n${text}${members.length>35?'\n…and more members.':''}`.slice(0,2000),ephemeral:true,allowedMentions:{parse:[]}});}
if(customId==='admin:welcome:scheduled:runNow')return updatePanel(interaction,{embeds:[new EmbedBuilder().setColor(0xfaa61a).setTitle(emojiLabel('WARNING','Run Scheduled Welcome Now?')).setDescription('This will send the configured Scheduled Welcome to **all eligible members currently in the queue**. Successful deliveries are checkpointed and queue-role cleanup may follow.\n\nThis is a real delivery, not a preview.').setFooter({text:`Welcome Studio • ${displayName(interaction)}`})],components:[row(button('admin:welcome:scheduled:confirmRun',emojiLabel('WELCOME_RUN', 'Confirm Delivery'),ButtonStyle.Danger),button('admin:welcome:scheduled',emojiLabel('BACK_PLAIN', 'Cancel')))]});
if(customId==='admin:welcome:scheduled:confirmRun'){await interaction.deferUpdate();const result=await scheduledWelcome.runScheduledWelcome(interaction.guild,{actorId:interaction.user.id});await interaction.editReply(await buildScheduledPanel(interaction.guild,displayName(interaction)));await interaction.followUp({content:result.reason==='already_running'?emojiLabel('WARNING', 'Scheduled Welcome is already running for this server. Wait for it to finish before trying again.'):result.skipped?emojiLabel('WARNING', 'Scheduled Welcome was not sent because the Welcome module or Scheduled Welcome is disabled. Enable it in Settings first.'):result.empty?emojiLabel('INFO', 'Queue is empty; nothing was posted.'):`${result.sendFailed||result.roleRemovalFailed||result.errors?.length?emojiLabel('WARNING', 'Scheduled Welcome finished with issues.'):emojiLabel('HEALTHY', 'Scheduled Welcome run complete.')} Welcomed ${result.welcomed||0} member(s) in ${result.messagesSent||0} message(s).${result.sendFailed?` ${result.sendFailed} failed send(s).`:''}${result.roleRemovalFailed?` ${result.roleRemovalFailed} role cleanup failure(s).`:''}${result.errors?.length?` Errors: ${result.errors.slice(0,2).join(' | ')}`:''}`,ephemeral:true});return true;}
if(customId==='admin:welcome:scheduled:repair'){await interaction.deferUpdate();await scheduledWelcomeHealth.repair(interaction.guild,{actorId:interaction.user.id});return updatePanel(interaction,await buildWelcomeDeliverySettingsPanel(interaction.guild,'scheduled',displayName(interaction)));}
const config=welcome.getWelcomeSection(interaction.guild.id);if(customId==='admin:welcome:enable')guildManager.setModuleEnabled(interaction.guild.id,'welcome',true,{actorId:interaction.user.id});if(customId==='admin:welcome:disable')guildManager.setModuleEnabled(interaction.guild.id,'welcome',false,{actorId:interaction.user.id});if(customId==='admin:welcome:toggleDm')welcome.updateConfig(interaction.guild.id,{dmEnabled:!config.dmEnabled},{actorId:interaction.user.id});if(customId==='admin:welcome:toggleBots')welcome.updateConfig(interaction.guild.id,{ignoreBots:!config.ignoreBots},{actorId:interaction.user.id});if(['admin:welcome:enable','admin:welcome:disable'].includes(customId))return updatePanel(interaction,await buildWelcomeSettingsPanel(interaction.guild,displayName(interaction)));if(customId==='admin:welcome:toggleDm')return updatePanel(interaction,await buildWelcomeDeliverySettingsPanel(interaction.guild,'dm',displayName(interaction)));if(customId==='admin:welcome:toggleBots')return updatePanel(interaction,await buildWelcomeDeliverySettingsPanel(interaction.guild,'instant',displayName(interaction)));
if(customId==='admin:welcome:togglePing'){welcome.updateConfig(interaction.guild.id,{allowUserPing:!config.allowUserPing},{actorId:interaction.user.id});return updatePanel(interaction,buildMentionSettingsPanel(interaction.guild,displayName(interaction)));}
if(customId==='admin:welcome:toggleRolePings'){if(!config.allowRolePings&&!config.mentionRoleIds.length)throw new Error('Choose at least one role before enabling role pings.');welcome.updateConfig(interaction.guild.id,{allowRolePings:!config.allowRolePings},{actorId:interaction.user.id});return updatePanel(interaction,buildMentionSettingsPanel(interaction.guild,displayName(interaction)));}
if(customId==='admin:welcome:dmPublic'){welcome.clearDmTemplate(interaction.guild.id,{actorId:interaction.user.id});clearSelection(interaction.guild.id,interaction.user.id,'dm');return updatePanel(interaction,await buildDmPanel(interaction.guild,displayName(interaction),interaction.user.id));}
if(customId==='admin:welcome:test'){const member=interaction.member;if(!member)throw new Error('Your server member record is unavailable.');const payload=await welcome.buildDiscordPayload(member,'welcome',welcome.getWelcomeSection(interaction.guild.id),{suppressPing:true,ephemeral:true,templateOverride:getPreviewTemplate(interaction.guild.id,interaction.user.id,'public')});return interaction.reply(payload);}
if(customId==='admin:welcome:send'){const member=interaction.member;if(!member)throw new Error('Your server member record is unavailable.');const result=await welcome.sendWelcome(member,{force:true,previewOnly:true,silent:false,skipDm:true});const lines=[result.publicSent?emojiLabel('HEALTHY', 'Public test welcome sent.'):null,result.publicFailed?emojiLabel('ERROR', 'Public delivery failed.'):null,...(result.errors||[]).map(error=>`• ${error}`)].filter(Boolean);if(!lines.length)lines.push(emojiLabel('WARNING', 'No public Welcome was sent. Select a public Welcome channel in Instant Welcome settings, then try again. DM Welcome is tested separately.'));return interaction.reply({content:lines.join('\n').slice(0,2000),ephemeral:true});}
if(customId==='admin:welcome:repairInstant'){await interaction.deferUpdate();await welcome.repairConfiguration(interaction.guild,{actorId:interaction.user.id});return updatePanel(interaction,await buildWelcomeDeliverySettingsPanel(interaction.guild,'instant',displayName(interaction)));}
if(customId==='admin:welcome:repairAll'){await interaction.deferUpdate();await welcome.repairConfiguration(interaction.guild,{actorId:interaction.user.id});await scheduledWelcomeHealth.repair(interaction.guild,{actorId:interaction.user.id});return updatePanel(interaction,await buildWelcomeSettingsPanel(interaction.guild,displayName(interaction)));}
if(customId==='admin:welcome:reset'){return updatePanel(interaction,{embeds:[new EmbedBuilder().setColor(0xed4245).setTitle(emojiLabel('WARNING','Reset Welcome?')).setDescription('This will clear Instant Welcome, DM Welcome and Scheduled Welcome settings, including their active template bindings and delivery configuration. This cannot be undone from this panel.\n\n**Saved Embed Studio templates will remain available.**').setFooter({text:`Requested by ${displayName(interaction)}`})],components:[row(button('admin:welcome:resetConfirm',emojiLabel('DELETE_PLAIN', 'Confirm Reset'),ButtonStyle.Danger),button('admin:welcome','Cancel'))]});}
if(customId==='admin:welcome:resetConfirm'){await interaction.deferUpdate();clearSelection(interaction.guild.id,interaction.user.id);welcome.resetWelcome(interaction.guild.id,{actorId:interaction.user.id});return updatePanel(interaction);}
if(customId==='admin:welcome:export'){const attachment=new AttachmentBuilder(Buffer.from(JSON.stringify({...welcome.exportConfiguration(interaction.guild.id),enabled:guildManager.isModuleEnabled(interaction.guild.id,'welcome')},null,2),'utf8'),{name:`goliath-welcome-${interaction.guild.id}.json`});await interaction.reply({content:emojiLabel('MOD_EXPORT', 'Welcome configuration export.'),files:[attachment],ephemeral:true});return true;}
return updatePanel(interaction);}catch(error){const payload={content:`${EMOJIS.ERROR} Welcome setup failed: ${error.message}`,ephemeral:true};if(interaction.deferred||interaction.replied)await interaction.followUp(payload).catch(()=>null);else await interaction.reply(payload).catch(()=>null);return true;}}

module.exports={buildWelcomePanel,buildInstantPanel,buildDmPanel,buildMentionSettingsPanel,buildScheduledPanel,handleWelcomeInteraction,buildWelcomeAdminPanel:buildWelcomePanel,handleWelcomeAdminInteraction:handleWelcomeInteraction};
