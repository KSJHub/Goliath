'use strict';

const crypto = require('crypto');
const { getModuleSection, saveModuleSection, updateModuleSection } = require('../../../core/guild/moduleSectionManager');

const MODULE = 'faq';
const now = () => new Date().toISOString();
const clone = (v) => v == null ? v : JSON.parse(JSON.stringify(v));
const cleanText = (v, max = 1000) => String(v ?? '').trim().slice(0, max);
const cleanKey = (v, fallback = 'faq') => (String(v || fallback).toLowerCase().trim().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || fallback).slice(0, 80);
const cleanDiscordId = (v) => { const id = String(v || '').replace(/[<@#!&>]/g, '').trim(); return /^\d{15,25}$/.test(id) ? id : null; };
const createId = (prefix) => `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
const cleanPrefix = (v) => String(v || 'FAQ').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'FAQ';
function deriveGuildPrefix(name) { const first = String(name || '').trim().split(/\s+/)[0] || 'FAQ'; return cleanPrefix(first.length <= 4 ? first : first.slice(0, 4)); }
function formatReference(prefix, number) { return `FAQ-${cleanPrefix(prefix)}${String(Math.max(1, Number(number) || 1)).padStart(6, '0')}`; }

function defaults() {
  return {
    settings: { channelId: null, inboxChannelId: null, managerRoleIds: [], ephemeralAnswers: true, referencePrefix: null },
    categories: {}, entries: {}, submissions: {},
    counters: { nextReference: 1 },
    panel: { channelId: null, messageId: null, deployedAt: null },
    analytics: { views: 0, searches: 0, submitted: 0, published: 0 },
    createdAt: now(), updatedAt: now(),
  };
}

function normalizeCategory(value = {}) {
  const id = cleanKey(value.id || createId('category'), 'category');
  return { id, name: cleanText(value.name || 'New Category', 100), description: cleanText(value.description, 200), emoji: cleanText(value.emoji, 50), enabled: value.enabled !== false, order: Number(value.order || 0), createdAt: value.createdAt || now(), updatedAt: value.updatedAt || now() };
}
function normalizeResource(value = {}) { return { label: cleanText(value.label || 'Resource', 100), url: cleanText(value.url, 500), type: ['guide','link','media'].includes(value.type) ? value.type : 'link' }; }
function normalizeEntry(value = {}) {
  const id = cleanKey(value.id || createId('faq'), 'faq');
  return { id, reference: cleanText(value.reference, 32), categoryId: cleanKey(value.categoryId || 'general', 'general'), question: cleanText(value.question || 'New Question', 200), answer: cleanText(value.answer || '', 4000), keywords: Array.isArray(value.keywords) ? value.keywords.map(x=>cleanText(x,50)).filter(Boolean).slice(0,20) : [], resources: Array.isArray(value.resources) ? value.resources.map(normalizeResource).filter(x=>x.url).slice(0,5) : [], supportChannelId: cleanDiscordId(value.supportChannelId), sourceSubmissionId: value.sourceSubmissionId ? cleanKey(value.sourceSubmissionId,'submission') : null, threadId: cleanDiscordId(value.threadId), threadMessageId: cleanDiscordId(value.threadMessageId), threadUrl: cleanText(value.threadUrl,500), enabled: value.enabled !== false, order: Number(value.order||0), createdAt: value.createdAt||now(), updatedAt: value.updatedAt||now() };
}
function normalizeSubmission(value = {}) {
  const id = cleanKey(value.id || createId('submission'),'submission');
  return { id, reference: cleanText(value.reference,32), referenceNumber: Math.max(0,Number(value.referenceNumber||0)), question: cleanText(value.question,200), details: cleanText(value.details,1500), answer: cleanText(value.answer,4000), categoryId: value.categoryId ? cleanKey(value.categoryId) : null, submittedBy: cleanDiscordId(value.submittedBy), claimedBy: cleanDiscordId(value.claimedBy), answeredBy: cleanDiscordId(value.answeredBy), publishedBy: cleanDiscordId(value.publishedBy), supportChannelId: cleanDiscordId(value.supportChannelId), resources: Array.isArray(value.resources) ? value.resources.map(normalizeResource).filter(x=>x.url).slice(0,5) : [], status: ['submitted','claimed','draft','review','published','dismissed','duplicate'].includes(value.status) ? value.status : 'submitted', teamChannelId: cleanDiscordId(value.teamChannelId), teamMessageId: cleanDiscordId(value.teamMessageId), entryId: value.entryId ? cleanKey(value.entryId) : null, threadId: cleanDiscordId(value.threadId), threadUrl: cleanText(value.threadUrl,500), createdAt: value.createdAt||now(), answeredAt: value.answeredAt||null, publishedAt: value.publishedAt||null, updatedAt: value.updatedAt||now() };
}
function normalize(section={}) {
  const base=defaults(); const source=section&&typeof section==='object'?clone(section):{};
  return { ...base,...source,
    settings:{...base.settings,...(source.settings||{}),channelId:cleanDiscordId(source.settings?.channelId),inboxChannelId:cleanDiscordId(source.settings?.inboxChannelId),managerRoleIds:Array.isArray(source.settings?.managerRoleIds)?source.settings.managerRoleIds.map(cleanDiscordId).filter(Boolean):[],referencePrefix:source.settings?.referencePrefix?cleanPrefix(source.settings.referencePrefix):null},
    categories:Object.fromEntries(Object.entries(source.categories||{}).map(([id,item])=>{const n=normalizeCategory({...item,id:item.id||id});return[n.id,n];})),
    entries:Object.fromEntries(Object.entries(source.entries||{}).map(([id,item])=>{const n=normalizeEntry({...item,id:item.id||id});return[n.id,n];})),
    submissions:Object.fromEntries(Object.entries(source.submissions||{}).map(([id,item])=>{const n=normalizeSubmission({...item,id:item.id||id});return[n.id,n];})),
    counters:{nextReference:Math.max(1,Number(source.counters?.nextReference||1))},
    panel:{...base.panel,...(source.panel||{}),channelId:cleanDiscordId(source.panel?.channelId),messageId:cleanDiscordId(source.panel?.messageId)}, analytics:{...base.analytics,...(source.analytics||{})}, updatedAt:source.updatedAt||now() };
}
function getSection(guildId){return normalize(getModuleSection(guildId,MODULE,defaults()));}
function saveSection(guildId,section,meta={}){return normalize(saveModuleSection(guildId,MODULE,normalize(section),meta));}
function updateSection(guildId,updater,meta={}){return normalize(updateModuleSection(guildId,MODULE,current=>{const n=normalize(current);return normalize(typeof updater==='function'?updater(clone(n)):updater);},defaults(),meta));}
function listCategories(guildId){return Object.values(getSection(guildId).categories).filter(x=>x.enabled!==false).sort((a,b)=>a.order-b.order||a.name.localeCompare(b.name));}
function listEntries(guildId,categoryId=null){return Object.values(getSection(guildId).entries).filter(x=>x.enabled!==false&&(!categoryId||x.categoryId===cleanKey(categoryId))).sort((a,b)=>a.order-b.order||a.question.localeCompare(b.question));}
function listSubmissions(guildId,statuses=null){const wanted=Array.isArray(statuses)?new Set(statuses):null;return Object.values(getSection(guildId).submissions).filter(x=>!wanted||wanted.has(x.status)).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));}
function getEntry(guildId,id){return getSection(guildId).entries[cleanKey(id)]||null;}
function getSubmission(guildId,id){const section=getSection(guildId);const key=cleanKey(id);return section.submissions[key]||Object.values(section.submissions).find(s=>s.reference.toLowerCase()===String(id||'').toLowerCase()||s.teamMessageId===String(id))||null;}
function findSubmissionByTeamMessage(guildId,messageId){return Object.values(getSection(guildId).submissions).find(s=>s.teamMessageId===String(messageId))||null;}
function allocateReference(guildId,guildName,meta={}){let allocated=null;updateSection(guildId,s=>{const prefix=s.settings.referencePrefix||deriveGuildPrefix(guildName);const number=Math.max(1,Number(s.counters?.nextReference||1));allocated={prefix,number,reference:formatReference(prefix,number)};return{...s,settings:{...s.settings,referencePrefix:prefix},counters:{...s.counters,nextReference:number+1},updatedAt:now()};},meta);return allocated;}
function saveCategory(guildId,category,meta={}){const n=normalizeCategory(category);return updateSection(guildId,s=>({...s,categories:{...s.categories,[n.id]:n},updatedAt:now()}),meta).categories[n.id];}
function saveEntry(guildId,entry,meta={}){const n=normalizeEntry(entry);return updateSection(guildId,s=>({...s,entries:{...s.entries,[n.id]:n},updatedAt:now()}),meta).entries[n.id];}
function saveSubmission(guildId,submission,meta={}){const n=normalizeSubmission(submission);return updateSection(guildId,s=>({...s,submissions:{...s.submissions,[n.id]:n},updatedAt:now()}),meta).submissions[n.id];}
function patchSubmission(guildId,id,patch,meta={}){const current=getSubmission(guildId,id);if(!current)return null;return saveSubmission(guildId,{...current,...patch,id:current.id,updatedAt:now()},meta);}
function deleteCategory(guildId,id,meta={}){id=cleanKey(id);return updateSection(guildId,s=>{const categories={...s.categories};delete categories[id];const entries=Object.fromEntries(Object.entries(s.entries).filter(([,e])=>e.categoryId!==id));return{...s,categories,entries,updatedAt:now()};},meta);}
function deleteEntry(guildId,id,meta={}){id=cleanKey(id);return updateSection(guildId,s=>{const entries={...s.entries};delete entries[id];return{...s,entries,updatedAt:now()};},meta);}
function search(guildId,query){const q=cleanText(query,100).toLowerCase();if(!q)return[];return listEntries(guildId).map(e=>({entry:e,score:scoreEntry(e,q)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,10).map(x=>x.entry);}
function scoreEntry(e,q){const terms=q.split(/\s+/).filter(x=>x.length>2);const hay=[e.reference,e.question,...e.keywords].join(' ').toLowerCase();if(e.reference?.toLowerCase()===q)return100;if(e.question.toLowerCase()===q)return100;if(e.question.toLowerCase().includes(q))return80;return terms.reduce((n,t)=>n+(hay.includes(t)?10:0),0);}
module.exports={MODULE,defaults,normalize,normalizeCategory,normalizeEntry,normalizeSubmission,getSection,saveSection,updateSection,listCategories,listEntries,listSubmissions,getEntry,getSubmission,findSubmissionByTeamMessage,allocateReference,saveCategory,saveEntry,saveSubmission,patchSubmission,deleteCategory,deleteEntry,search,cleanKey,cleanText,cleanDiscordId,cleanPrefix,deriveGuildPrefix,formatReference,createId};
