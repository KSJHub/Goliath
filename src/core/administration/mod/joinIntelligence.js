'use strict';

const { ActionRowBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { navigationButton } = require('../../guild/goliathNavigation');
const intelligence = require('./intelligence');
const decisioning = require('./memberDecisioning');
const { db } = require('./storage');
const { recordModerationSystemEvent } = require('./permissions');
const verificationStore = require('../../../modules/securityStudio/verificationStore');

const DEFAULT_CONFIG = Object.freeze({
  enabled: false,
  channelId: null,
  includeBots: false,
  continuousEnabled: false,
  periodicMinutes: 15,
});

function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const channelId = /^\d{15,25}$/.test(String(source.channelId || '')) ? String(source.channelId) : null;
  const periodic = Number.parseInt(source.periodicMinutes, 10);
  return {
    enabled: source.enabled === true,
    channelId,
    includeBots: source.includeBots === true,
    continuousEnabled: source.continuousEnabled === true,
    periodicMinutes: Number.isFinite(periodic) ? Math.max(5, Math.min(60, periodic)) : 15,
  };
}

function getConfig(guildId) {
  const section = verificationStore.getVerificationSection(guildId);
  return normalizeConfig(section.settings?.joinIntelligence || DEFAULT_CONFIG);
}

function getOutputChannelId(guildId) {
  const section = verificationStore.getVerificationSection(guildId);
  const config = normalizeConfig(section.settings?.joinIntelligence || DEFAULT_CONFIG);
  return config.channelId || section.settings?.logChannelId || null;
}

function accountAgeDays(member) {
  const created = Number(member?.user?.createdTimestamp || 0);
  return created > 0 ? Math.max(0, Math.floor((Date.now() - created) / 86400000)) : null;
}

function localSummary(guildId, userId) {
  let warningCount = 0;
  try {
    warningCount = Number(db.prepare('SELECT COUNT(*) AS count FROM warnings WHERE guild_id = ? AND user_id = ?').get(String(guildId), String(userId))?.count || 0);
  } catch {}
  const cases = (() => {
    try { return db.prepare('SELECT action,status FROM cases WHERE guild_id = ? AND user_id = ?').all(String(guildId), String(userId)); }
    catch { return []; }
  })();
  return {
    warningCount,
    activeCases: cases.filter((entry) => String(entry.status || 'active') === 'active').length,
    timeouts: cases.filter((entry) => entry.action === 'timeout').length,
    bans: cases.filter((entry) => entry.action === 'ban').length,
    caseCount: cases.length,
  };
}

function normalizeIdentity(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function compareIdentitySignals(primary, candidate) {
  if (!primary?.user || !candidate?.user || primary.id === candidate.id) return { score: 0, signals: [] };
  const signals = [];
  let score = 0;
  const primaryUsername = normalizeIdentity(primary.user.username);
  const candidateUsername = normalizeIdentity(candidate.user.username);
  const primaryGlobal = normalizeIdentity(primary.user.globalName || primary.displayName);
  const candidateGlobal = normalizeIdentity(candidate.user.globalName || candidate.displayName);
  if (primary.user.avatar && candidate.user.avatar && primary.user.avatar === candidate.user.avatar) { score += 45; signals.push('same custom avatar hash'); }
  if (primaryUsername && candidateUsername === primaryUsername) { score += 30; signals.push('same normalized username'); }
  else if (primaryUsername && candidateUsername && (candidateUsername.includes(primaryUsername) || primaryUsername.includes(candidateUsername)) && Math.min(candidateUsername.length, primaryUsername.length) >= 5) { score += 12; signals.push('similar username'); }
  if (primaryGlobal && candidateGlobal && primaryGlobal === candidateGlobal) { score += 20; signals.push('same display/global name'); }
  const createdDelta = Math.abs((candidate.user.createdTimestamp || 0) - (primary.user.createdTimestamp || 0));
  if (createdDelta && createdDelta <= 86400000) { score += 10; signals.push('accounts created within 24h'); }
  const joinedDelta = Math.abs((candidate.joinedTimestamp || 0) - (primary.joinedTimestamp || 0));
  if (joinedDelta && joinedDelta <= 86400000) { score += 10; signals.push('joined server within 24h'); }
  return { score: Math.min(95, score), signals };
}

function suspectedAccounts(member) {
  const rows = [];
  for (const candidate of member.guild.members.cache.values()) {
    if (!candidate?.user || candidate.id === member.id || candidate.user.bot) continue;
    const result = compareIdentitySignals(member, candidate);
    if (result.score >= 35) rows.push({ member: candidate, ...result });
  }
  return rows.sort((a, b) => b.score - a.score).slice(0, 5);
}

function buildActionRows(member) {
  if (member.user.bot) return [];
  return [new ActionRowBuilder().addComponents(
    navigationButton(`joinintel:view:${member.guild.id}:${member.id}`, 'Open Intelligence', ButtonStyle.Primary).setEmoji('🧠'),
    navigationButton(`mod_open_quarantine:${member.id}`, 'Investigate', ButtonStyle.Danger).setEmoji('🔎'),
    navigationButton(`joinintel:watch:${member.guild.id}:${member.id}`, 'Watch Member', ButtonStyle.Secondary).setEmoji('👁️'),
    navigationButton(`joinintel:clear:${member.guild.id}:${member.id}`, 'Mark Clear', ButtonStyle.Success).setEmoji('✅'),
  )];
}

function buildEmbed(member, context, local, suspects, scanId, assessment) {
  const risk = context.risk || { score: 0, label: '🟢 Low', reasons: [] };
  const watch = context.watch || { state: 'clear' };
  const reputation = context.reputation || {};
  const history = context.guildHistory || [];
  const externalCount = Number(reputation.verifiedExternal || 0) + Number(reputation.submitted || 0) + Number(reputation.unverified || 0);
  const ageDays = accountAgeDays(member);
  const decision = decisioning.DECISIONS[assessment.decision];
  const suspectText = suspects.length
    ? suspects.slice(0, 3).map(({ member: candidate, score, signals }) => `**${score}%** • ${candidate.user} • ${signals.slice(0, 3).join(', ')}`).join('\n')
    : 'No heuristic account correlations found in the current guild cache.';
  const riskFactors = risk.reasons?.length
    ? risk.reasons.slice(0, 5).map((item) => `**+${item.points}** ${item.reason}`).join('\n')
    : 'No verified moderation-risk factors currently contribute to this score.';

  const embed = new EmbedBuilder()
    .setColor(decision.color)
    .setTitle(`🧠 Join Intelligence • ${member.user.tag || member.user.username}`)
    .setDescription([
      `**Automatic join scan** • \`${scanId}\``,
      `**Member:** ${member.user} • \`${member.id}\``,
      '',
      `${decision.emoji} **Decision: ${decision.label}**`,
      assessment.reasons.length ? assessment.reasons.slice(0, 4).map((reason) => `• ${reason}`).join('\n') : '• No attention threshold reached.',
      '',
      'Decisioning is an intelligence aid only. It does not automatically punish, isolate or blacklist the member.',
    ].join('\n'))
    .addFields(
      { name: '👤 Account', value: [`Created: <t:${Math.floor((member.user.createdTimestamp || Date.now()) / 1000)}:F>${ageDays !== null ? ` • **${ageDays}d old**` : ''}`, `Joined: <t:${Math.floor((member.joinedTimestamp || Date.now()) / 1000)}:R>`, `Screening: **${member.pending ? 'Pending' : 'Complete'}** • Bot: **${member.user.bot ? 'Yes' : 'No'}**`].join('\n'), inline: false },
      { name: '🚦 Risk', value: [`**${risk.score || 0}/100 • ${risk.label || '🟢 Low'}**`, `Watchlist: **${String(watch.state || 'clear').toUpperCase()}** • Local cases: **${local.caseCount}** • Active: **${local.activeCases}** • Warnings: **${local.warningCount}**`, riskFactors].join('\n').slice(0, 1024), inline: false },
      { name: '🌐 Network Intelligence', value: [`Observed guilds: **${history.length}** • Cross-guild cases: **${context.network?.caseCount || 0}** • Cross-guild bans: **${context.network?.banCount || 0}**`, `External records: **${externalCount}** • Verified: **${reputation.verifiedExternal || 0}** • Submitted: **${reputation.submitted || 0}** • Unverified: **${reputation.unverified || 0}**`].join('\n'), inline: false },
      { name: '🔗 Account Correlation', value: `${suspectText.slice(0, 900)}\n\n*Heuristic correlation is an investigation aid, not proof of shared ownership.*`, inline: false },
    )
    .setFooter({ text: 'Automatic Join Intelligence • report remains in-channel; staff actions open privately where appropriate' })
    .setTimestamp();
  const avatar = member.user.displayAvatarURL?.({ size: 256 });
  if (avatar) embed.setThumbnail(avatar);
  return embed;
}

async function resolveOutputChannel(member) {
  const channelId = getOutputChannelId(member.guild.id);
  if (!channelId) return null;
  return member.guild.channels.cache.get(channelId) || await member.guild.channels.fetch(channelId).catch(() => null);
}

async function scanMemberOnJoin(member) {
  if (!member?.guild?.id || !member?.user?.id) return { skipped: true, reason: 'missing_member' };
  const config = getConfig(member.guild.id);
  if (!config.enabled) return { skipped: true, reason: 'disabled' };
  if (member.user.bot && !config.includeBots) return { skipped: true, reason: 'bot_excluded' };

  const local = localSummary(member.guild.id, member.id);
  const context = await intelligence.buildContext(member.client, member, local);
  const suspects = member.user.bot ? [] : suspectedAccounts(member);
  const scanId = `join_${Date.now().toString(36)}_${member.id.slice(-6)}`;
  const assessment = decisioning.classify({ ...context, guild: member.guild }, suspects);
  decisioning.saveDecision(member.guild.id, member.id, assessment, { trigger: 'guild_member_add', scanId });
  const channel = await resolveOutputChannel(member);

  recordModerationSystemEvent({
    guildId: member.guild.id,
    actorId: 'system:auto-join-intelligence',
    event: 'moderation.member_scan.completed',
    action: 'member_scan',
    targetId: member.id,
    after: {
      scanId, automatic: true, trigger: 'guild_member_add', decision: assessment,
      caseCount: local.caseCount, suspectedCount: suspects.length,
      suspectedMatches: suspects.map((entry) => ({ userId: entry.member.id, score: entry.score, signals: entry.signals })),
      identity: { username: member.user.username || null, globalName: member.user.globalName || null, displayName: member.displayName || null, avatarHash: member.user.avatar || null, accountCreatedAt: member.user.createdTimestamp || null, joinedAt: member.joinedTimestamp || null },
      network: { otherGuildCount: context.network?.guildCount || 0, otherGuildCaseCount: context.network?.caseCount || 0 },
      risk: context.risk,
      investigation: { watched: false, noteCount: 0 },
      persistentLinkEvidence: [], visibleCapabilities: { automatic: true, fullSystemContext: true },
    },
    metadata: { targetId: member.id, automatic: true, trigger: 'guild_member_add', dataSources: ['discord_api', 'guild_cache', 'moderation_cases', 'warnings', 'member_intelligence', 'cross_guild_same_id_cases', 'watchlist', 'reputation'] },
  });

  if (!channel?.send) {
    console.warn(`[Join Intelligence] ${member.guild.name || member.guild.id}: enabled but no sendable output channel is configured.`);
    return { success: true, scanId, delivered: false, reason: 'missing_output_channel', risk: context.risk, assessment };
  }

  const embed = buildEmbed(member, context, local, suspects, scanId, assessment);
  await channel.send({ embeds: [embed], components: buildActionRows(member), allowedMentions: { parse: [] } });
  return { success: true, scanId, delivered: true, channelId: channel.id, risk: context.risk, assessment, suspectedCount: suspects.length };
}

module.exports = {
  DEFAULT_CONFIG,
  normalizeConfig,
  getConfig,
  getOutputChannelId,
  localSummary,
  suspectedAccounts,
  buildActionRows,
  resolveOutputChannel,
  scanMemberOnJoin,
};
