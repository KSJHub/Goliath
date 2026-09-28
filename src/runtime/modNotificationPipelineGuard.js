'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

const PATCH_KEY = Symbol.for('goliath.mod.notification-pipeline-v1');

if (!globalThis[PATCH_KEY]) {
  globalThis[PATCH_KEY] = { installed: true };

  const storage = require('../core/administration/mod/storage');
  const guildManager = require('../core/guild/guildManager');

  const APPEAL_ACTIONS = new Set(['warn', 'timeout', 'kick', 'ban']);
  const ACTION_META = Object.freeze({
    warn: { emoji: '⚠️', label: 'Warning', title: 'You Have Received a Warning', consequence: 'A warning has been recorded on your moderation history. Further incidents may result in additional moderation action.' },
    timeout: { emoji: '⏳', label: 'Timeout', title: 'You Have Been Timed Out', consequence: 'Your ability to interact in the server has been temporarily restricted for the duration shown below.' },
    kick: { emoji: '👢', label: 'Kick', title: 'You Have Been Kicked', consequence: 'You have been removed from the server. This action does not by itself prevent you from joining again unless another restriction applies.' },
    ban: { emoji: '🔨', label: 'Ban', title: 'You Have Been Banned', consequence: 'You have been banned from the server and cannot rejoin while the ban remains active.' },
  });

  function actionMeta(action) {
    const key = String(action || '').toLowerCase();
    return ACTION_META[key] || { emoji: '🛡️', label: String(action || 'Moderation Action'), title: 'Moderation Action', consequence: 'A moderation action has been recorded on your account.' };
  }

  function appealsBaseUrl() {
    return String(process.env.CLIENT_URL || process.env.DASHBOARD_CLIENT_URL || process.env.VITE_CLIENT_URL || 'https://goliath.ksjdigital.co.uk').trim().replace(/\/+$/, '');
  }

  function noticeAlreadyAttempted(modCase) {
    return Boolean(modCase?.metadata?.appealNotice?.attemptedAt);
  }

  function persistNotice(guildId, modCase, notice) {
    const metadata = { ...(modCase.metadata || {}), appealNotice: notice };
    const updatedAt = new Date().toISOString();
    const result = storage.db.prepare('UPDATE cases SET metadata = ?, updated_at = ? WHERE guild_id = ? AND case_id = ?')
      .run(JSON.stringify(metadata), updatedAt, String(guildId), Number(modCase.caseId));
    if (!result.changes) return null;
    const updated = storage.getCaseById(guildId, modCase.caseId);
    if (updated) storage.emitCaseUpdated(guildId, updated);
    return updated;
  }

  function durationValue(modCase) {
    return modCase?.metadata?.duration || modCase?.metadata?.durationRaw || null;
  }

  async function sendMemberCaseNotice({ guild, target = null, user = null, caseId = null }) {
    const normalizedCaseId = Number(caseId);
    if (!guild?.id || !Number.isInteger(normalizedCaseId) || normalizedCaseId <= 0) return { attempted: false, sent: false, error: 'Missing guild or case ID.' };
    const modCase = storage.getCaseById(guild.id, normalizedCaseId);
    if (!modCase || !APPEAL_ACTIONS.has(String(modCase.action || '').toLowerCase()) || modCase.status !== 'active') return { attempted: false, sent: false, skipped: true };
    if (noticeAlreadyAttempted(modCase)) return { ...modCase.metadata.appealNotice, duplicateSkipped: true };

    const recipient = target?.user || target || user?.user || user;
    const attemptedAt = new Date().toISOString();
    let sent = false;
    let error = null;
    try {
      if (!recipient?.send) throw new Error('Could not resolve user DM target.');
      const meta = actionMeta(modCase.action);
      const fields = [
        { name: 'Action', value: `**${meta.label}**`, inline: true },
        { name: 'Case', value: `**#${modCase.caseId}**`, inline: true },
        { name: 'Server', value: String(guild.name || 'Discord Server').slice(0, 1024), inline: false },
        { name: 'Reason', value: String(modCase.reason || 'No reason provided').slice(0, 1024), inline: false },
      ];
      const duration = durationValue(modCase);
      if (duration && String(modCase.action).toLowerCase() === 'timeout') fields.push({ name: 'Duration', value: String(duration).slice(0, 1024), inline: true });
      fields.push(
        { name: 'What This Means', value: meta.consequence, inline: false },
        { name: 'Appeal', value: `If you believe this decision should be reconsidered, you can appeal **Case #${modCase.caseId}** below. You can appeal even if you are no longer in the server.`, inline: false },
      );
      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle(`${meta.emoji} ${meta.title} • ${String(guild.name || 'Server').slice(0, 100)}`.slice(0, 256))
        .setDescription('This is an official Goliath moderation notice. The details below come from your recorded moderation case.')
        .addFields(fields)
        .setFooter({ text: `Goliath Moderation • ${String(guild.name || 'Server').slice(0, 80)} • Case #${modCase.caseId}` })
        .setTimestamp();
      const appealWebUrl = `${appealsBaseUrl()}/appeals?guild=${encodeURIComponent(guild.id)}&case=${encodeURIComponent(modCase.caseId)}`;
      await recipient.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`mod_appeal_external:${guild.id}:${modCase.caseId}`).setLabel(`Appeal Case #${modCase.caseId}`.slice(0, 80)).setEmoji('⚖️').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setLabel('Appeal Online').setEmoji('🌐').setStyle(ButtonStyle.Link).setURL(appealWebUrl),
        new ButtonBuilder().setCustomId('mod_appeal_lookup').setLabel('Appeal Another Case').setStyle(ButtonStyle.Secondary),
      )] });
      sent = true;
    } catch (deliveryError) {
      error = String(deliveryError?.message || deliveryError || 'DM delivery failed.').slice(0, 300);
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
      const channel = await resolveLogChannel(guild);
      if (!channel) return false;
      const modCase = caseId ? storage.getCaseById(guild.id, caseId) : null;
      const action = String(modCase?.action || payload.action || 'moderation').toLowerCase();
      const meta = actionMeta(action);
      const targetUser = target || user;
      const fields = [
        { name: 'Target', value: formatUser(targetUser), inline: false },
        { name: 'Action', value: `**${meta.label}**`, inline: true },
        ...(caseId ? [{ name: 'Case', value: `**#${caseId}**`, inline: true }] : []),
        { name: 'Moderator', value: moderator ? formatUser(moderator, 'Unknown Moderator') : 'System', inline: false },
        { name: 'Reason', value: String(modCase?.reason || payload.reason || 'No reason provided').slice(0, 1024), inline: false },
      ];
      const duration = durationValue(modCase);
      if (duration) fields.push({ name: 'Duration', value: String(duration).slice(0, 1024), inline: true });
      if (modCase?.metadata?.deleteDays !== undefined) fields.push({ name: 'Message History', value: `Delete ${Number(modCase.metadata.deleteDays) || 0} day(s)`, inline: true });
      const report = modCase?.metadata?.punishmentReport || payload.metadata?.punishmentReport;
      if (report) {
        fields.push({ name: 'Discord Action', value: Array.isArray(report.applied) && report.applied.includes(action) ? 'Confirmed ✅' : `Applied: ${report.actionText || 'none'}`, inline: true });
        if (report.failedText && report.failedText !== 'none') fields.push({ name: 'Failures', value: String(report.failedText).slice(0, 1024), inline: true });
      }
      if (APPEAL_ACTIONS.has(action)) {
        const delivery = notice?.attempted ? (notice.sent ? 'Sent ✅' : `Failed ❌${notice.error ? `\n${notice.error}` : ''}`) : 'Not attempted';
        fields.push({ name: 'Member Notice', value: delivery.slice(0, 1024), inline: true });
        fields.push({ name: 'Appeal', value: 'Eligible • linked to this case', inline: true });
      }
      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle(`${meta.emoji} Moderation • ${meta.label}`.slice(0, 256))
        .addFields(fields.slice(0, 25))
        .setFooter({ text: caseId ? `Goliath Moderation • Case #${caseId}` : 'Goliath Moderation' })
        .setTimestamp();
      const avatar = (targetUser?.user || targetUser);
      if (avatar?.displayAvatarURL) embed.setThumbnail(avatar.displayAvatarURL({ dynamic: true }));
      await channel.send({ embeds: [embed] });
      return true;
    } catch (error) {
      console.error(`Failed to send hardened moderation log in guild ${guild?.id || 'unknown'}:`, error);
      return false;
    }
  }

  async function sendHardenedModLog(payload = {}) {
    // Canonical ordering: case already exists -> member notice -> persist/audit delivery -> management log.
    // This makes the management log report the real case-notice outcome, not the old pre-case engine DM flag.
    const notice = await sendMemberCaseNotice({ guild: payload.guild, target: payload.target || payload.user || null, user: payload.user || null, caseId: payload.caseId });
    const logged = await sendManagementLog(payload, notice);
    return Boolean(logged || notice.sent);
  }

  storage.sendCaseAppealNotice = sendMemberCaseNotice;
  storage.sendModLog = sendHardenedModLog;
  globalThis[PATCH_KEY].sendMemberCaseNotice = sendMemberCaseNotice;
  globalThis[PATCH_KEY].sendManagementLog = sendManagementLog;
}
