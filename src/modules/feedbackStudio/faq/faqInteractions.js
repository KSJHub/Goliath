'use strict';

const { MessageFlags } = require('discord.js');
const faq = require('./faq');
const panel = require('./faqPanel');
const tracking = require('./faqTracking');
const { isModuleEnabled, setModuleEnabled } = require('../../../core/guild/guildManager');

async function reply(interaction,payload){ const p=typeof payload==='string'?{content:payload}:{...payload}; p.flags=MessageFlags.Ephemeral; if(interaction.deferred||interaction.replied)return interaction.followUp(p).catch(()=>null); return interaction.reply(p).catch(()=>null); }
async function update(interaction,payload){ if(interaction.deferred||interaction.replied){await interaction.editReply(payload);return true;} await interaction.update(payload);return true; }
const displayName=(i)=>i.member?.displayName||i.user?.displayName||i.user?.username||'Unknown User';

async function handleMember(interaction){
  const id=String(interaction.customId||''); if(!id.startsWith('faq:')||!interaction.guildId)return false;
  try{
    if(!isModuleEnabled(interaction.guildId,'faq'))throw new Error('FAQ is currently disabled on this server.');
    if(id==='faq:home'){ tracking.increment(interaction.guildId,'views',interaction.guild); return update(interaction,panel.buildHomePanel(interaction.guildId)); }
    if(id.startsWith('faq:back:'))return update(interaction,panel.buildCategoryPanel(interaction.guildId,id.split(':')[2]));
    if(interaction.isStringSelectMenu?.()&&id==='faq:category'){ tracking.increment(interaction.guildId,'views',interaction.guild); return reply(interaction,panel.buildCategoryPanel(interaction.guildId,interaction.values[0])); }
    if(interaction.isStringSelectMenu?.()&&id.startsWith('faq:question:')){ tracking.increment(interaction.guildId,'views',interaction.guild); return update(interaction,panel.buildAnswerPanel(interaction.guildId,interaction.values[0])); }
    return false;
  }catch(error){await reply(interaction,`❌ FAQ action failed: ${error.message}`);return true;}
}

async function handleAdmin(interaction){
  const id=String(interaction.customId||''); if(!id.startsWith('admin:faq')||!interaction.guildId)return false;
  try{
    if(id==='admin:faq')return update(interaction,panel.buildAdminPanel(interaction.guild,displayName(interaction)));
    if(id==='admin:faq:addCategory'){await interaction.showModal(panel.buildCategoryModal());return true;}
    if(id==='admin:faq:addEntry'){await interaction.showModal(panel.buildEntryModal(faq.listCategories(interaction.guildId)));return true;}
    if(id==='admin:faq:manage')return update(interaction,panel.buildManagePanel(interaction.guildId));
    if(interaction.isChannelSelectMenu?.()&&id==='admin:faq:channel'){const value=interaction.values?.[0]||null;faq.updateSection(interaction.guildId,s=>({...s,settings:{...s.settings,channelId:value}}),interaction.guild);return update(interaction,panel.buildAdminPanel(interaction.guild,displayName(interaction)));}
    if(interaction.isRoleSelectMenu?.()&&id==='admin:faq:managerRoles'){faq.updateSection(interaction.guildId,s=>({...s,settings:{...s.settings,managerRoleIds:[...new Set(interaction.values||[])]}}),interaction.guild);return update(interaction,panel.buildAdminPanel(interaction.guild,displayName(interaction)));}
    if(id==='admin:faq:enable'){setModuleEnabled(interaction.guildId,'faq',true,{actorId:interaction.user.id,action:'faq_admin_enable'});return update(interaction,panel.buildAdminPanel(interaction.guild,displayName(interaction)));}
    if(id==='admin:faq:disable'){setModuleEnabled(interaction.guildId,'faq',false,{actorId:interaction.user.id,action:'faq_admin_disable'});return update(interaction,panel.buildAdminPanel(interaction.guild,displayName(interaction)));}
    if(id==='admin:faq:deploy'){await interaction.deferUpdate().catch(()=>null);await tracking.deploy(interaction.guild,interaction.user.id);return update(interaction,panel.buildAdminPanel(interaction.guild,displayName(interaction)));}
    if(interaction.isModalSubmit?.()&&id==='admin:faq:modal:category'){faq.saveCategory(interaction.guildId,{name:interaction.fields.getTextInputValue('name'),description:interaction.fields.getTextInputValue('description'),emoji:interaction.fields.getTextInputValue('emoji')},interaction.guild);return reply(interaction,'✅ FAQ category created.');}
    if(interaction.isModalSubmit?.()&&id==='admin:faq:modal:entry'){const categoryId=faq.cleanKey(interaction.fields.getTextInputValue('category'));if(!faq.getSection(interaction.guildId).categories[categoryId])throw new Error('That category ID does not exist.');faq.saveEntry(interaction.guildId,{categoryId,question:interaction.fields.getTextInputValue('question'),answer:interaction.fields.getTextInputValue('answer'),keywords:interaction.fields.getTextInputValue('keywords').split(',').map(x=>x.trim()).filter(Boolean)},interaction.guild);return reply(interaction,'✅ FAQ created.');}
    return false;
  }catch(error){await reply(interaction,`❌ FAQ setup failed: ${error.message}`);return true;}
}

async function handleFaqInteraction(interaction){if(await handleAdmin(interaction))return true;return handleMember(interaction);}
module.exports={handleFaqInteraction,handleFaqAdminInteraction:handleAdmin,handleMemberInteraction:handleMember,handleAdminInteraction:handleAdmin};
