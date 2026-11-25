'use strict';

const { PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const guildManager = require('../../../core/guild/guildManager');
const { replaceVars } = require('../../../core/guild/guildVariables');
const sentinelScheduler = require('../../../owner/sentinel/schedulerRegistry.js');
const base = require('./timedRoles');
const { withTimedRolesLock } = require('./timedRolesLocks');

const SECTION = base.SECTION;
const SCHEDULER_TICK_MS = 5 * 60 * 1000;
const SCHEDULER_ID = 'timedRoles:progression:global';
const now = () => new Date().toISOString();

async function resolveRole(guild, roleId) {
  return guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
}

async function refreshMember(guild, member) {
  return member?.id ? await guild.members.fetch({user:member.id,force:true}) : member;
}

function assertManageableMember(guild, member) {
  if (!member) throw new Error('Member could not be found.');
  if (member.id === guild.members.me?.id) throw new Error('Goliath cannot manage its own timed roles.');
  if (member.id === guild.ownerId) throw new Error('Timed roles cannot be managed on the server owner.');
  if (member.manageable === false) throw new Error(`${member.displayName || member.user?.username || 'This member'} is above Goliath and cannot be managed.`);
  return member;
}

function assertManageableRole(guild, role) {
  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) throw new Error('Goliath requires Manage Roles.');
  if (!role) throw new Error('A configured Timed Roles role no longer exists.');
  if (role.id === guild.id) throw new Error('@everyone cannot be used by Timed Roles.');
  if (role.managed) throw new Error(`${role.name} is managed by an integration.`);
  if (role.position >= me.roles.highest.position) throw new Error(`${role.name} is above Goliath's highest role.`);
  return role;
}

function assertUniqueTargetRole(guildId, input = {}) {
  const roleId = String(input.roleId || '');
  if (!roleId) return;
  const ruleId = String(input.ruleId || input.id || '');
  const duplicate = base.listRules(guildId).find((rule) => rule.roleId === roleId && rule.ruleId !== ruleId);
  if (duplicate) throw new Error(`That Discord role is already used by the Timed Roles milestone “${duplicate.name}”.`);
}

function saveRule(guildId, input, meta = {}) {
  assertUniqueTargetRole(guildId, input);
  return base.saveRule(guildId, input, meta);
}

function desiredState(member, section, rules, context = {}) {
  const progression = base.getMemberProgression(member, rules, context);
  const targetRules = section.settings.progressionMode === 'keep_all'
    ? progression.due
    : (progression.current ? [progression.current] : []);
  const targetRoleIds = new Set(targetRules.map((rule) => rule.roleId));
  const milestoneRoleIds = new Set(rules.map((rule) => rule.roleId));
  const cleanupRoleIds = new Set();
  for (const rule of targetRules) {
    for (const roleId of rule.removeRoleIds || []) {
      if (!targetRoleIds.has(roleId)) cleanupRoleIds.add(roleId);
    }
  }
  if (section.settings.progressionMode === 'highest_only') {
    for (const roleId of milestoneRoleIds) if (!targetRoleIds.has(roleId)) cleanupRoleIds.add(roleId);
  }
  return { progression, targetRules, targetRoleIds, milestoneRoleIds, cleanupRoleIds };
}

function renderCelebration(member, rule, role, settings, progression, channel = null) {
  const interaction = {
    guild: member.guild,
    guildId: member.guild.id,
    user: member.user,
    member,
    channel,
    channelId: channel?.id || null,
  };
  const record = guildManager.getGuildSection(member.guild.id, 'membershipRecords', { members: {} }).members?.[member.id];
  const timestamp = value => {
    const ms = value instanceof Date ? value.getTime() : Date.parse(value);
    return Number.isFinite(ms) ? '<t:' + Math.floor(ms / 1000) + ':D>' : 'Not available';
  };
  const variables = {
    '{member}': '<@' + member.id + '>',
    '{username}': member.user.username,
    '{milestone}': rule.name,
    '{role}': '<@&' + (role?.id || rule.roleId) + '>',
    '{duration}': base.formatDuration(rule),
    '{server}': member.guild.name,
    '{joined}': timestamp(record?.firstJoinedAt || member.joinedAt),
    '{achieved}': timestamp(progression?.dueAtByRule?.[rule.ruleId] || now()),
    '{nextMilestone}': progression?.next?.name || 'No further milestone',
    '{nextDue}': timestamp(progression?.nextAt),
  };
  const render = template => replaceVars(String(template || ''), interaction, true, variables);
  const message = render(settings.announcementMessage || 'Congratulations {member}! You have achieved {milestone} after {duration} in {server}.');
  return { message, title: render(settings.celebrationTitle || '{milestone} — Achievement Unlocked!') };
}

async function announcePromotion(member, rule, role, settings, progression) {
  if (!settings.announcePromotions || !settings.announcementChannelId) return false;
  const channel = member.guild.channels.cache.get(settings.announcementChannelId)
    || await member.guild.channels.fetch(settings.announcementChannelId).catch(() => null);
  if (!channel?.isTextBased?.() || typeof channel.send !== 'function') return false;
  const permissions = channel.permissionsFor?.(member.guild.members.me);
  if (permissions && (!permissions.has(PermissionFlagsBits.ViewChannel) || !permissions.has(PermissionFlagsBits.SendMessages))) return false;
  const { message, title } = renderCelebration(member, rule, role, settings, progression, channel);
  const allowedMentions = { parse: [], users: [member.id], roles: [], repliedUser: false };
  if (settings.celebrationEmbed !== false) {
    if (!permissions?.has(PermissionFlagsBits.EmbedLinks)) throw new Error('Goliath requires Embed Links for celebrations.');
    const embed = new EmbedBuilder().setTitle(title.slice(0,256)).setDescription(message.slice(0,4096)).setColor(Number.isInteger(settings.celebrationColor) && settings.celebrationColor >= 0 && settings.celebrationColor <= 0xffffff ? settings.celebrationColor : 0x57F287).setTimestamp();
    if (settings.celebrationGif && /^https:\/\//i.test(settings.celebrationGif)) embed.setImage(settings.celebrationGif);
    await channel.send({ content: '<@' + member.id + '>', embeds: [embed], allowedMentions });
  } else await channel.send({ content: message.slice(0,2000), allowedMentions });
  return true;
}

async function applyUnlocked(member, section = base.getSection(member.guild.id), rules = base.listRules(member.guild.id).filter((rule) => rule.enabled), context = {}) {
  const guild = member.guild;
  if (!member?.joinedAt) return { status: 'skipped', awarded: [], removed: [], announced: 0 };
  if (member.user?.bot && section.settings.includeBots !== true) return { status: 'skipped', awarded: [], removed: [], announced: 0 };
  if(member.id===guild.ownerId || member.id===guild.members.me?.id || member.manageable===false)return {status:'skipped',awarded:[],removed:[],announced:0};
  assertManageableMember(guild, member);

  const state = desiredState(member, section, rules, context);
  const targetRoles = [];
  const blocked=[];
  for (const rule of state.targetRules) {
    try{targetRoles.push({rule,role:assertManageableRole(guild,await resolveRole(guild,rule.roleId))});}
    catch(error){blocked.push({ruleId:rule.ruleId,error:error.message});}
  }
  const cleanupRoles = [];
  // Never remove existing milestone roles if a desired reward cannot be granted.
  for (const roleId of blocked.length ? [] : state.cleanupRoleIds) {
    const role = await resolveRole(guild, roleId);
    if (!role) continue;
    cleanupRoles.push(assertManageableRole(guild, role));
  }

  if(blocked.length && !targetRoles.length)throw new Error(blocked.map(item=>item.error).join('; '));
  const initial = member;
  const initiallyHeld = new Set(initial.roles.cache.keys());

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let live = attempt===0 ? initial : await refreshMember(guild, member);
    for (const { role } of targetRoles) if (!live.roles.cache.has(role.id)) await live.roles.add(role, 'Goliath Timed Roles progression');
    if(targetRoles.some(({role})=>!live.roles.cache.has(role.id)))live = await refreshMember(guild, live);
    for (const role of cleanupRoles) if (live.roles.cache.has(role.id)) await live.roles.remove(role, 'Goliath Timed Roles progression cleanup');
    if(targetRoles.some(({role})=>!initiallyHeld.has(role.id)) || cleanupRoles.some(role=>initiallyHeld.has(role.id)))live = await refreshMember(guild, live);

    const targetOk = targetRoles.every(({ role }) => live.roles.cache.has(role.id));
    const cleanupOk = cleanupRoles.every((role) => !live.roles.cache.has(role.id));
    if (targetOk && cleanupOk) {
      const awarded = targetRoles.map(({ role }) => role.id).filter((roleId) => !initiallyHeld.has(roleId));
      const removed = cleanupRoles.map((role) => role.id).filter((roleId) => initiallyHeld.has(roleId));
      let announced = 0;
      for (const { rule, role } of targetRoles) {
        const existing = base.getSection(guild.id).achievementHistory?.[member.id]?.[rule.ruleId];
        if (existing) continue;
        // Persist before sending to avoid repeated celebrations after restart or role recovery.
        base.updateSection(guild.id, current => {
          const history = { ...current.achievementHistory };
          history[member.id] = { ...history[member.id], [rule.ruleId]: { achievedAt: now(), milestoneName: rule.name, roleId: role.id, celebration: 'suppressed' } };
          return { ...current, achievementHistory: history };
        });
        const celebrationSettings = { ...section.settings, ...rule.celebration };
        if (!awarded.includes(role.id) || !celebrationSettings.announcePromotions) continue;
        const dueAt = Date.parse(state.progression.dueAtByRule?.[rule.ruleId]);
        const baseline = Date.parse(section.analytics?.celebrationBaselineAt);
        const lastScan = Date.parse(section.analytics?.lastScanAt);
        const configuredAt = Date.parse(rule.createdAt);
        const cutoffs = [baseline, lastScan, configuredAt].filter(Number.isFinite);
        const cutoff = cutoffs.length ? Math.max(...cutoffs) : NaN;
        const newlyDue = Number.isFinite(dueAt) && Number.isFinite(cutoff) && dueAt > cutoff && dueAt <= Date.now();
        if (!newlyDue && !section.settings.celebrateRetroactive) continue;
        let status = 'failed';
        try { if (await announcePromotion(live, rule, role, celebrationSettings, state.progression)) { announced += 1; status = 'sent'; } } catch (error) { console.warn('[TimedRoles] Celebration failed:', error.message); }
        base.updateSection(guild.id, current => {
          const history = { ...current.achievementHistory };
          const entries = { ...history[member.id] };
          entries[rule.ruleId] = { ...entries[rule.ruleId], celebration: status };
          history[member.id] = entries;
          return { ...current, achievementHistory: history };
        });
        base.recordAudit(guild.id, 'celebration_' + status, { memberId: member.id, ruleId: rule.ruleId, roleId: role.id });
      }
      if (awarded.length || removed.length) base.recordAudit(guild.id, 'member_roles_changed', { memberId: member.id, awarded, removed });
      return { status: awarded.length || removed.length ? 'changed' : 'noop', awarded, removed, announced, blocked, progression: state.progression };
    }
  }

  throw new Error('Discord did not converge to the requested Timed Roles state.');
}

async function applyProgressionToMember(member) {
  if (!member?.guild?.id) throw new Error('Guild member is required.');
  return withTimedRolesLock(member.guild.id, async () => {
    if (!guildManager.isModuleEnabled(member.guild.id, SECTION)) throw new Error('Timed Roles is disabled.');
    const section = base.getSection(member.guild.id);
    const rules = base.listRules(member.guild.id).filter((rule) => rule.enabled);
    try { return await applyUnlocked(member, section, rules); }
    catch (error) {
      base.recordAudit(member.guild.id, 'member_progression_failed', { memberId: member.id, error: String(error.message).slice(0,500) });
      throw error;
    }
  });
}

async function simulateGuild(guild) {
  const section = base.getSection(guild.id);
  const rules = base.listRules(guild.id).filter((rule) => rule.enabled);
  const context = {membershipRecords:guildManager.getGuildSection(guild.id,'membershipRecords',{}).members || {},memberOverrides:section.memberOverrides || {}};
  const members = await guild.members.fetch();
  const result = { membersChecked: 0, awards: 0, removals: 0, unchanged: 0, failed: 0, skipped: 0, blocked: [], changes: [] };
  for (const member of members.values()) {
    if (member.user?.bot && section.settings.includeBots !== true) continue;
    result.membersChecked += 1;
    try {
      const state = desiredState(member, section, rules, context);
      if(!member.joinedAt || member.id===guild.ownerId || member.id===guild.members.me?.id || member.manageable===false){
        result.skipped++;
        if(state.targetRules.some(rule=>!member.roles.cache.has(rule.roleId)))result.blocked.push({memberId:member.id,error:'Member is the guild owner, bot itself, above Goliath, or lacks a join date.'});
        continue;
      }
      for(const rule of state.targetRules)assertManageableRole(guild,await resolveRole(guild,rule.roleId));
      for(const id of state.cleanupRoleIds){const role=await resolveRole(guild,id);if(role)assertManageableRole(guild,role);}
      const add = [...state.targetRoleIds].filter((roleId) => !member.roles.cache.has(roleId));
      const remove = [...state.cleanupRoleIds].filter((roleId) => member.roles.cache.has(roleId));
      if (add.length || remove.length) {
        result.awards += add.length;
        result.removals += remove.length;
        result.changes.push({ memberId: member.id, add, remove });
      } else result.unchanged += 1;
    } catch(error) {
      result.failed += 1;
      result.blocked.push({memberId:member.id,error:error.message});
    }
  }
  base.updateSection(guild.id, (current) => ({ ...current, analytics: { ...current.analytics, simulations: Number(current.analytics?.simulations || 0) + 1 } }), { action: 'timed_roles_simulation' });
  return result;
}

async function scanGuild(guild, meta = {}) {
  return withTimedRolesLock(guild.id, async () => {
    if (!guildManager.isModuleEnabled(guild.id, SECTION)) return { guildId: guild.id, disabled: true, rules: 0, membersChecked: 0, awarded: 0, removed: 0, announced: 0, skipped: 0, failed: 0 };
    const section = base.getSection(guild.id);
    const rules = base.listRules(guild.id).filter((rule) => rule.enabled);
    if (!rules.length) return { guildId: guild.id, rules: 0, membersChecked: 0, awarded: 0, removed: 0, announced: 0, skipped: 0, failed: 0 };
    const context = {membershipRecords:guildManager.getGuildSection(guild.id,'membershipRecords',{}).members || {},memberOverrides:section.memberOverrides || {}};
    const members = await guild.members.fetch();
    const result = { guildId: guild.id, rules: rules.length, membersChecked: 0, awarded: 0, removed: 0, announced: 0, skipped: 0, failed: 0 };
    const stats = new Map(rules.map((rule) => [rule.ruleId, { awarded: 0, error: null }]));

    for (const member of members.values()) {
      if (member.user?.bot && section.settings.includeBots !== true) continue;
      result.membersChecked += 1;
      try {
        const applied = await applyUnlocked(member, section, rules, context);
        result.awarded += applied.awarded.length;
        result.removed += applied.removed.length;
        result.announced += applied.announced;
        if(applied.blocked?.length){result.failed+=1;for(const item of applied.blocked){if(stats.has(item.ruleId))stats.get(item.ruleId).error ||= item.error;}base.recordAudit(guild.id,'member_progression_failed',{memberId:member.id,blocked:applied.blocked},meta);}
        for (const rule of rules) if (applied.awarded.includes(rule.roleId)) stats.get(rule.ruleId).awarded += 1;
        if (applied.status === 'noop' || applied.status === 'skipped') result.skipped += 1;
      } catch (error) {
        result.failed += 1;
        base.recordAudit(guild.id, 'member_progression_failed', { memberId: member.id, error: String(error.message).slice(0,500) }, meta);
        const progression = base.getMemberProgression(member, rules, context);
        const affected = progression.current ? [progression.current] : [];
        for (const rule of affected) stats.get(rule.ruleId).error ||= error.message;
      }
    }

    const scannedAt = now();
    for (const rule of rules) {
      const stat = stats.get(rule.ruleId);
      const latest = base.getRule(guild.id, rule.ruleId);
      if (latest) base.saveRule(guild.id, { ...latest, lastRunAt: scannedAt, lastAwarded: stat.awarded, lastError: stat.error }, meta);
    }
    base.updateSection(guild.id, (current) => ({
      ...current,
      analytics: {
        ...current.analytics,
        scans: Number(current.analytics?.scans || 0) + 1,
        membersChecked: Number(current.analytics?.membersChecked || 0) + result.membersChecked,
        awarded: Number(current.analytics?.awarded || 0) + result.awarded,
        removed: Number(current.analytics?.removed || 0) + result.removed,
        announced: Number(current.analytics?.announced || 0) + result.announced,
        skipped: Number(current.analytics?.skipped || 0) + result.skipped,
        failed: Number(current.analytics?.failed || 0) + result.failed,
        lastScanAt: scannedAt,
        celebrationBaselineAt: current.analytics?.celebrationBaselineAt || scannedAt,
      },
    }), { ...meta, action: meta.action || 'timed_roles_scan' });
    return result;
  });
}

async function deliverAuditNotifications(guild) {
  return withTimedRolesLock(guild.id, async () => {
    const section = base.getSection(guild.id);
    const config = section.settings.logging || {};
    const events = Array.isArray(section.operationalAudit) ? section.operationalAudit : [];
    const cursor = section.auditDelivery?.cursor;
    const index = cursor ? events.findIndex(event => event.id === cursor) : -1;
    // Never broadcast historical audit records when notifications are first configured.
    const pending = index < 0 ? [] : events.slice(index + 1, index + 26);
    const advance = (id, extra = {}) => base.updateSection(guild.id, current => ({ ...current, auditDelivery: { ...current.auditDelivery, ...extra, cursor: id } }));
    if (index < 0) {
      if (events.length) advance(events[events.length - 1].id);
      return;
    }
    for (const event of pending) {
      if (!['channel','thread'].includes(config.mode) || !config.channelId || !config.events?.includes(event.type)) { advance(event.id); continue; }
      const channel = await guild.channels.fetch(config.channelId).catch(() => null);
      if (!channel?.isTextBased?.() || !channel.send) throw new Error('Timed Roles log channel unavailable.');
      const permissions = channel.permissionsFor(guild.members.me);
      if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) throw new Error('Missing Timed Roles logging permissions.');
      let destination = channel;
      if (config.mode === 'thread') {
        if (!permissions.has([PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.SendMessagesInThreads])) throw new Error('Missing Timed Roles thread permissions.');
        const saved = base.getSection(guild.id).auditDelivery?.threadId;
        destination = saved ? await guild.channels.fetch(saved).catch(() => null) : null;
        if (!destination?.isThread?.() || destination.parentId !== channel.id || destination.archived || destination.locked) {
          destination = await channel.threads.create({ name: 'Timed Roles Audit', autoArchiveDuration: 1440, reason: 'Timed Roles operational logging' });
          base.updateSection(guild.id, current => ({ ...current, auditDelivery: { ...current.auditDelivery, threadId: destination.id } }));
        }
      }
      const roles = (Array.isArray(config.roleIds) ? config.roleIds : []).filter(id => id !== guild.id && guild.roles.cache.has(id)).slice(0,10);
      const embed = new EmbedBuilder().setTitle('Timed Roles · ' + event.type.replace(/_/g,' ')).setColor(event.type.includes('failed') ? 0xED4245 : 0x5865F2).setDescription('An operational event was recorded. Authorised administrators can inspect its details in Timed Roles Audit History.').setFooter({ text: 'Audit ' + event.id }).setTimestamp(new Date(event.at));
      // Persist the attempt before sending: prefer a missed notification to duplicate pings after a crash.
      advance(event.id, { lastAttemptAt: now(), lastStatus: 'attempted' });
      try {
        await destination.send({ content: roles.map(id => '<@&' + id + '>').join(' ') || undefined, embeds: [embed], allowedMentions: { parse: [], roles, users: [], repliedUser: false } });
        advance(event.id, { lastStatus: 'sent', lastError: null });
      } catch (error) {
        advance(event.id, { lastStatus: 'failed', lastError: String(error.message).slice(0,500) });
        console.warn('[TimedRoles] Audit delivery failed:', error.message);
      }
    }
  });
}

async function startup(client) {
  if (client.__goliathTimedRolesStarted) return null;
  client.__goliathTimedRolesStarted = true;
  sentinelScheduler.register({ id: SCHEDULER_ID, module: SECTION, component: 'progression-scan', intervalMs: SCHEDULER_TICK_MS, staleAfterMs: Math.max(SCHEDULER_TICK_MS * 3, 180_000) });
  const run = async (force = false) => {
    const timestamp = Date.now();
    let scannedGuilds = 0; let guildFailures = 0; let memberFailures = 0;
    for (const guild of client.guilds.cache.values()) {
      if (!guild.available || (!force && !base.shouldScanGuild(guild.id, timestamp))) continue;
      try {
        const result = await scanGuild(guild, { actorId: client.user?.id, action: force ? 'timed_roles_startup_scan' : 'timed_roles_scheduled_scan' });
        scannedGuilds += 1;
        memberFailures += Number(result?.failed || 0);
      } catch (error) {
        guildFailures += 1;
        console.warn(`[TimedRoles] ${guild.id}: ${error.message}`);
      }
    }
    if (guildFailures || memberFailures) sentinelScheduler.fail(SCHEDULER_ID, new Error(`${guildFailures} guild and ${memberFailures} member Timed Roles failure(s).`), { scannedGuilds, guildFailures, memberFailures });
    else sentinelScheduler.beat(SCHEDULER_ID, { scannedGuilds, guildFailures: 0, memberFailures: 0 });
    return { scannedGuilds, guildFailures, memberFailures };
  };
  // Do not force a full Timed Roles guild scan during startup.
  // scanGuild() performs guild.members.fetch(), which hydrates the
  // complete Discord member cache. Normal scheduled scans remain active.
  let delivering = false;
  const deliveryTimer = setInterval(async () => {
    if (delivering) return;
    delivering = true;
    try {
      for (const guild of client.guilds.cache.values()) {
        if (!guild.available) continue;
        try { await deliverAuditNotifications(guild); } catch (error) { console.warn('[TimedRoles] Audit notification:', error.message); }
      }
    } finally { delivering = false; }
  }, 30000);
  deliveryTimer.unref?.();
  let scanning = false;
  const timer = setInterval(async () => {
    if(scanning)return;
    scanning=true;
    try{await run(false);}
    catch(error){console.warn(`[TimedRoles] Scheduler failed: ${error.message}`);}
    finally{scanning=false;}
  }, SCHEDULER_TICK_MS);
  timer.unref?.();
  return timer;
}

module.exports = {
  renderCelebration,
  ...base,
  SECTION,
  applyProgressionToMember,
  saveRule,
  scanGuild,
  simulateGuild,
  startup,
  withTimedRolesLock,
};
