'use strict';

const guildManager = require('../../core/guild/guildManager');
const verificationStore = require('../../modules/securityStudio/verificationStore');
const verificationFlow = require('../../modules/securityStudio/verificationFlowContinuation');
const challengeInteractions = require('../../modules/securityStudio/verificationChallengeInteractions');
const verificationQuarantine = require('../../modules/securityStudio/verificationQuarantine');

const joinWindows = new Map();
function verificationEnabled(guildId) { return Boolean(guildId) && guildManager.isModuleEnabled(guildId, 'verification') === true; }
function settingsFor(guildId) { const section=verificationStore.getVerificationSection(guildId); return verificationStore.normalizeSettings(section?.settings||{}); }
function raidPressure(guildId, settings) {
  const raid=settings.raid||{};
  if(raid.enabled===false||raid.automatic===false) return {active:false,count:0};
  const windowMs=Math.max(5,Number(raid.windowSeconds||60))*1000, threshold=Math.max(2,Number(raid.joinThreshold||10)), now=Date.now();
  const recent=(joinWindows.get(guildId)||[]).filter(ts=>now-ts<=windowMs); recent.push(now); joinWindows.set(guildId,recent);
  return {active:recent.length>=threshold,count:recent.length,threshold,windowSeconds:Math.round(windowMs/1000)};
}
async function applyRaidPressure(member){
  if(!member?.guild||member.user?.bot||!verificationEnabled(member.guild.id))return;
  const settings=settingsFor(member.guild.id), pressure=raidPressure(member.guild.id,settings);
  if(!pressure.active||settings.raid?.elevateSecurity===false)return;
  const session=verificationStore.getSession(member.guild.id,member.id)||{};
  verificationStore.upsertSession(member.guild.id,member.id,{raidPressure:true,raidPressureAt:new Date().toISOString(),raidJoinCount:pressure.count});
  verificationStore.addSecurityHistory(member.guild.id,member.id,{type:'raid_security_elevated',joinCount:pressure.count,threshold:pressure.threshold,windowSeconds:pressure.windowSeconds});
  verificationStore.incrementAnalytics(member.guild.id,{raidEscalations:1,lastRaidEscalationAt:new Date().toISOString()});
}
async function notifyContinuation(member,result){if(!member?.user||!result)return;if(result.challenge&&typeof challengeInteractions.memberChallengePayload==='function'){const payload=challengeInteractions.memberChallengePayload(member.id,result.challenge);await member.user.send({content:result.message||'Continue Verification.',...payload}).catch(()=>null);return;}if(result.complete)await member.user.send({content:result.message||'Verification complete.'}).catch(()=>null);}
async function resumeAfterScreening(oldMember,newMember){if(!newMember?.guild||newMember.user?.bot||!verificationEnabled(newMember.guild.id))return;if(oldMember?.pending!==true||newMember.pending===true)return;const guildId=newMember.guild.id,settings=settingsFor(guildId);if(settings.security?.discordScreening!==true)return;const session=verificationStore.getSession(guildId,newMember.id);if(!session||session.state!=='verifying'||(session.completedSecurity||[]).includes('discord_screening'))return;verificationStore.addSecurityHistory(guildId,newMember.id,{type:'discord_screening_completed',automaticResume:true});verificationStore.incrementAnalytics(guildId,{screeningCompleted:1,lastScreeningCompletedAt:new Date().toISOString()});const result=await verificationFlow.resumeVerification({guild:newMember.guild,member:newMember,user:newMember.user});await notifyContinuation(newMember,result);}
async function ensureQuarantineFromRoleChange(oldMember,newMember){if(!newMember?.guild||newMember.user?.bot||!verificationEnabled(newMember.guild.id))return;const settings=settingsFor(newMember.guild.id);if(settings.quarantine?.enabled===false)return;const ids=Array.isArray(settings.roles?.quarantine)?settings.roles.quarantine.map(String):[];if(!ids.length)return;const added=ids.some(id=>!oldMember?.roles?.cache?.has?.(id)&&newMember.roles?.cache?.has?.(id));if(!added)return;const session=verificationStore.getSession(newMember.guild.id,newMember.id);if(!session||session.state!=='quarantined')return;await verificationQuarantine.ensureQuarantineCase(newMember.guild,newMember,'Verification quarantine threshold or staff action');}
async function resetJourneyOnLeave(member){if(!member?.guild||member.user?.bot||!verificationEnabled(member.guild.id))return;const guildId=member.guild.id,settings=settingsFor(guildId);if(settings.flow?.resetActiveSessionOnLeave===false)return;const session=verificationStore.getSession(guildId,member.id);if(!session)return;verificationStore.addSecurityHistory(guildId,member.id,{type:'member_left',previousState:session.state,completedSecurity:Array.isArray(session.completedSecurity)?session.completedSecurity:[]});if(session.quarantineChannelId)await verificationQuarantine.closeQuarantineCase(member.guild,member.id,'Verification member left the server').catch(error=>console.error('[Verification] Quarantine case cleanup failed:',error?.message||error));verificationStore.upsertSession(guildId,member.id,{state:'new',requiredSecurity:[],completedSecurity:[],failedAttempts:0,activeSecurityMethod:null,activeChallenge:null,startedAt:null,verifiedAt:null,quarantinedAt:null,quarantineChannelId:null,raidPressure:false,raidPressureAt:null,raidJoinCount:0,leftAt:new Date().toISOString()});verificationStore.clearAttempts(guildId,member.id);}
module.exports=[{name:'guildMemberAdd',async execute(member){try{await applyRaidPressure(member);}catch(error){console.error('[Verification] Raid pressure evaluation failed:',error?.stack||error?.message||error);} }},{name:'guildMemberUpdate',async execute(oldMember,newMember){try{await resumeAfterScreening(oldMember,newMember);await ensureQuarantineFromRoleChange(oldMember,newMember);}catch(error){console.error('[Verification] Member lifecycle continuation failed:',error?.stack||error?.message||error);} }},{name:'guildMemberRemove',async execute(member){try{await resetJourneyOnLeave(member);}catch(error){console.error('[Verification] Leave reset failed:',error?.stack||error?.message||error);} }}];
module.exports.resumeAfterScreening=resumeAfterScreening;module.exports.ensureQuarantineFromRoleChange=ensureQuarantineFromRoleChange;module.exports.resetJourneyOnLeave=resetJourneyOnLeave;module.exports.applyRaidPressure=applyRaidPressure;
