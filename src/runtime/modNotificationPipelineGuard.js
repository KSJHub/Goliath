'use strict';

const { EmbedBuilder, ButtonStyle } = require('discord.js');
const { moderationNotice } = require('../core/ui/memberNotice');

const PATCH_KEY = Symbol.for('goliath.mod.notification-pipeline-v1');
const NOTICE_STORE_KEY = Symbol.for('goliath.mod.departure-notice-store-v1');
if (!globalThis[NOTICE_STORE_KEY]) globalThis[NOTICE_STORE_KEY] = new Map();

if (!globalThis[PATCH_KEY]) {
  globalThis[PATCH_KEY] = { installed: true };
  const storage = require('../core/administration/mod/storage');
  const guildManager = require('../core/guild/guildManager');
  const APPEAL_ACTIONS = new Set(['warn', 'timeout', 'kick', 'ban']);
  const ACTION_META = Object.freeze({
    warn: { emoji: '⚠️', label: 'Warning' }, timeout: { emoji: '⏳', label: 'Timeout' },
    kick: { emoji: '👢', label: 'Kick' }, ban: { emoji: '🔨', label: 'Ban' },
  });
  const actionMeta = (action) => ACTION_META[String(action || '').toLowerCase()] || { emoji: '🛡️', label: String(action || 'Moderation Action') };
  const appealsBaseUrl = () => String(process.env.CLIENT_URL || process.env.DASHBOARD_CLIENT_URL || process.env.VITE_CLIENT_URL || 'https://goliath.ksjdigital.co.uk').trim().replace(/\/+$/, '');
  const noticeAlreadyAttempted = (modCase) => Boolean(modCase?.metadata?.appealNotice?.attemptedAt);
  const departureNoticeKey = (guildId, userId) => `${String(guildId)}:${String(userId)}`;
  const durationValue = (modCase) => modCase?.metadata?.duration || modCase?.metadata?.durationRaw || null;

  function persistNotice(guildId, modCase, notice) {
    const metadata = { ...(modCase.metadata || {}), appealNotice: notice };
    if (metadata.punishmentReport && typeof metadata.punishmentReport === 'object') {
      metadata.punishmentReport = { ...metadata.punishmentReport, dmSent: Boolean(notice?.sent), dmError: notice?.error || null };
    }
    const updatedAt = new Date().toISOString();
    const result = storage.db.prepare('UPDATE cases SET metadata = ?, updated_at = ? WHERE guild_id = ? AND case_id = ?').run(JSON.stringify(metadata), updatedAt, String(guildId), Number(modCase.caseId));
    if (!result.changes) return null;
    const updated = storage.getCaseById(guildId, modCase.caseId);
    if (updated) storage.emitCaseUpdated(guildId, updated);
    return updated;
  }

  function issuerText(guild, modCase) {
    const id = modCase?.moderatorId || modCase?.moderator_id || modCase?.actorId || modCase?.metadata?.moderatorId;
    if (!id) return 'Goliath Moderation';
    const member = guild?.members?.cache?.get?.(String(id));
    return member ? `${member.displayName || member.user?.username || 'Management'} • <@${id}>` : `<@${id}>`;
  }

  function buildMemberNoticePayload(guild, modCase) {
    const appealWebUrl = `${appealsBaseUrl()}/appeals?guild=${encodeURIComponent(guild.id)}&case=${encodeURIComponent(modCase.caseId)}`;
    const allAppealsUrl = `${appealsBaseUrl()}/appeals`;
    const targetId = String(modCase.userId || modCase.user_id || 'Unknown');
    const created = modCase.createdAt || modCase.created_at;
    const action = actionMeta(modCase.action);
    return moderationNotice(guild, modCase, {
      status: '🔴 Active • Appeal Eligible',
      issuedBy: issuerText(guild, modCase),
      extraFields: [
        { name: '🪪 Case Identity', value: `**Case:** #${modCase.caseId}\n**Action:** ${action.emoji} ${action.label}${created ? `\n**Issued:** <t:${Math.floor(new Date(created).getTime() / 1000)}:F>` : ''}`, inline: false },
        { name: '👤 Member', value: `<@${targetId}>\n\`${targetId}\``, inline: true },
        { name: '⚖️ Appeal Status', value: '**Eligible**', inline: true },
      ],
      nextSteps: `If you believe this decision was incorrect, unfair, or important context was missed, request a Management review using **Appeal This Case** below. Goliath already knows the server, member, action and **Case #${modCase.caseId}**, so you do not need to enter those details again. Appeals remain available even if you are no longer in the server.`,
      buttons: [
        // URL buttons are deliberately used in DMs. They remain functional after
        // Kick/Ban and avoid Discord component-context failures outside a guild.
        { url: appealWebUrl, label: `Appeal This Case`, emoji: '⚖️' },
        { url: allAppealsUrl, label: 'Appeal Another Case', emoji: '🔎' },
      ],
    });
  }

  async function sendMemberCaseNotice({ guild, target = null, user = null, caseId = null }) {
    const normalizedCaseId = Number(caseId);
    if (!guild?.id || !Number.isInteger(normalizedCaseId) || normalizedCaseId <= 0) return { attempted: false, sent: false, error: 'Missing guild or case ID.' };
    const modCase = storage.getCaseById(guild.id, normalizedCaseId);
    if (!modCase || !APPEAL_ACTIONS.has(String(modCase.action || '').toLowerCase()) || modCase.status !== 'active') return { attempted: false, sent: false, skipped: true };
    if (noticeAlreadyAttempted(modCase)) return { ...modCase.metadata.appealNotice, duplicateSkipped: true };
    const recipient = target?.user || target || user?.user || user;
    const attemptedAt = new Date().toISOString();
    const departureKey = departureNoticeKey(guild.id, modCase.userId);
    const placeholder = globalThis[NOTICE_STORE_KEY].get(departureKey) || null;
    globalThis[NOTICE_STORE_KEY].delete(departureKey);
    let sent = false; let error = null;
    try {
      const payload = buildMemberNoticePayload(guild, modCase);
      if (placeholder?.edit) await placeholder.edit(payload);
      else { if (!recipient?.send) throw new Error('Could not resolve user DM target.'); await recipient.send(payload); }
      sent = true;
    } catch (deliveryError) {
      error = String(deliveryError?.message || deliveryError || 'DM delivery failed.').slice(0, 300);
      if (placeholder?.delete) await placeholder.delete().catch(() => null);
    }
    const notice = { attempted: true, attemptedAt, sent, sentAt: sent ? new Date().toISOString() : null, error };
    const persisted = persistNotice(guild.id, modCase, notice);
    storage.recordCaseAudit({ guildId: guild.id, caseId: modCase.caseId, actorId: null, event: sent ? 'case.appeal.notice.sent' : 'case.appeal.notice.failed', before: null, after: notice, metadata: { userId: modCase.userId, action: modCase.action } });
    return { ...notice, persisted: Boolean(persisted) };
  }

  function formatUser(user, fallback = 'Unknown User') {
    if (!user) return fallback;
    const real = user.user || user;
    const name = real.tag || real.username || real.displayName || real.name || fallback;
    return `${name}\n\`${real.id || user.id || 'N/A'}\``;
  }
  async function resolveLogChannel(guild) {
    const id = guildManager.getLogChannelId(guild.id, 'moderation', 'general');
    if (!id) return null;
    const channel = guild.channels.cache.get(id) || await guild.channels.fetch(id).catch(() => null);
    return channel?.isTextBased?.() ? channel : null;
  }
  async function sendManagementLog(payload, notice) {
    const { guild, target = null, user = null, moderator = null, caseId = null } = payload;
    if (!guild?.id) return false;
    try {
      if (typeof guildManager.isLogEventEnabled === 'function' && !guildManager.isLogEventEnabled(guild.id, 'moderationActions')) return false;
      const channel = await resolveLogChannel(guild); if (!channel) return false;
      const modCase = caseId ? storage.getCaseById(guild.id, caseId) : null;
      const action = String(modCase?.action || payload.action || 'moderation').toLowerCase(); const meta = actionMeta(action); const targetUser = target || user;
      const fields = [
        { name: 'Target', value: formatUser(targetUser), inline: false }, { name: 'Action', value: `**${meta.label}**`, inline: true },
        ...(caseId ? [{ name: 'Case', value: `**#${caseId}**`, inline: true }] : []),
        { name: 'Moderator', value: moderator ? formatUser(moderator, 'Unknown Moderator') : 'System', inline: false },
        { name: 'Reason', value: String(modCase?.reason || payload.reason || 'No reason provided').slice(0, 1024), inline: false },
      ];
      const duration = durationValue(modCase); if (duration) fields.push({ name: 'Duration', value: String(duration).slice(0, 1024), inline: true });
      if (modCase?.metadata?.deleteDays !== undefined) fields.push({ name: 'Message History', value: `Delete ${Number(modCase.metadata.deleteDays) || 0} day(s)`, inline: true });
      const report = modCase?.metadata?.punishmentReport || payload.metadata?.punishmentReport;
      if (report) { fields.push({ name: 'Discord Action', value: Array.isArray(report.applied) && report.applied.includes(action) ? 'Confirmed ✅' : `Applied: ${report.actionText || 'none'}`, inline: true }); if (report.failedText && report.failedText !== 'none') fields.push({ name: 'Failures', value: String(report.failedText).slice(0, 1024), inline: true }); }
      if (APPEAL_ACTIONS.has(action)) { const delivery = notice?.attempted ? (notice.sent ? 'Sent ✅' : `Failed ❌${notice.error ? `\n${notice.error}` : ''}`) : 'Not attempted'; fields.push({ name: 'Member Notice', value: delivery.slice(0, 1024), inline: true }, { name: 'Appeal', value: 'Eligible • linked to this case', inline: true }); }
      const embed = new EmbedBuilder().setColor('#5865F2').setTitle(`${meta.emoji} Moderation • ${meta.label}`.slice(0, 256)).addFields(fields.slice(0, 25)).setFooter({ text: caseId ? `Goliath Moderation • Case #${caseId}` : 'Goliath Moderation' }).setTimestamp();
      const avatar = targetUser?.user || targetUser; if (avatar?.displayAvatarURL) embed.setThumbnail(avatar.displayAvatarURL({ dynamic: true }));
      await channel.send({ embeds: [embed] }); return true;
    } catch (error) { console.error(`Failed to send hardened moderation log in guild ${guild?.id || 'unknown'}:`, error); return false; }
  }
  async function sendHardenedModLog(payload = {}) {
    const notice = await sendMemberCaseNotice({ guild: payload.guild, target: payload.target || payload.user || null, user: payload.user || null, caseId: payload.caseId });
    if (payload.metadata?.punishmentReport && typeof payload.metadata.punishmentReport === 'object') { payload.metadata.punishmentReport.dmSent = Boolean(notice.sent); payload.metadata.punishmentReport.dmError = notice.error || null; }
    const logged = await sendManagementLog(payload, notice); return Boolean(logged || notice.sent);
  }
  storage.sendCaseAppealNotice = sendMemberCaseNotice; storage.sendModLog = sendHardenedModLog;
  globalThis[PATCH_KEY].sendMemberCaseNotice = sendMemberCaseNotice; globalThis[PATCH_KEY].sendManagementLog = sendManagementLog;
}
