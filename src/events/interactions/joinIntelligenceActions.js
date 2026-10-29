'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Events } = require('discord.js');
const { canUseModAction, recordModerationSystemEvent } = require('../../core/administration/mod/permissions');
const decisioning = require('../../core/administration/mod/memberDecisioning');
const joinIntelligence = require('../../core/administration/mod/joinIntelligence');
const intelligence = require('../../core/administration/mod/intelligence');
const { db } = require('../../core/administration/mod/storage');

// The central router and the legacy event loader may see the same object.
// Claim it synchronously so listener ordering cannot produce two responses.
const handledInteractions = new WeakSet();

function parseJson(value, fallback = {}) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try { return JSON.parse(value) || fallback; } catch { return fallback; }
}

function currentInvestigationWatch(guildId, userId) {
  try {
    const rows = db.prepare("SELECT after_value, metadata FROM case_audit WHERE guild_id = ? AND event = 'moderation.member_scan.watch_updated' ORDER BY created_at DESC LIMIT 250")
      .all(String(guildId));
    for (const row of rows) {
      const metadata = parseJson(row.metadata, {});
      if (String(metadata.targetId || '') !== String(userId)) continue;
      return Boolean(parseJson(row.after_value, {}).enabled);
    }
  } catch {}
  return false;
}

async function resolveTarget(interaction, userId) {
  return interaction.guild.members.cache.get(userId)
    || await interaction.guild.members.fetch(userId).catch(() => null);
}

function riskFactorLines(context) {
  const factors = Array.isArray(context?.risk?.reasons) ? context.risk.reasons : [];
  if (!factors.length) return 'No verified moderation-risk factors currently contribute to this score.';
  return factors.slice(0, 8).map((item) => `**+${Number(item.points || 0)}** • ${item.reason}`).join('\n');
}

async function buildEphemeralIntelligence(interaction, target) {
  const local = joinIntelligence.localSummary(interaction.guild.id, target.id);
  const suspects = joinIntelligence.suspectedAccounts(target);
  const context = await intelligence.buildContext(interaction.client, target, local);
  const assessment = decisioning.classify({ ...context, guild: interaction.guild }, suspects);
  const decision = decisioning.DECISIONS[assessment.decision];
  const history = context.guildHistory || [];
  const reputation = context.reputation || {};
  const externalCount = Number(reputation.verifiedExternal || 0) + Number(reputation.submitted || 0) + Number(reputation.unverified || 0);
  const correlation = suspects[0] || null;
  const watchOn = currentInvestigationWatch(interaction.guild.id, target.id);

  const embed = new EmbedBuilder()
    .setColor(decision.color)
    .setTitle(`🧠 Member Intelligence • ${target.user.tag || target.user.username}`)
    .setDescription([
      `**Target:** ${target.user} • \`${target.id}\``,
      `${decision.emoji} **${decision.label}** • Risk **${assessment.riskScore}/100**`,
      '',
      'This is a private staff view. The channel intelligence report remains unchanged.',
    ].join('\n'))
    .addFields(
      {
        name: '🚦 Risk Breakdown',
        value: [`**${context.risk?.score || 0}/100 • ${context.risk?.label || '🟢 Low'}**`, riskFactorLines(context)].join('\n').slice(0, 1024),
        inline: false,
      },
      {
        name: '⚖️ Moderation',
        value: `Local cases **${local.caseCount}** • Active **${local.activeCases}** • Warnings **${local.warningCount}** • Timeouts **${local.timeouts}** • Bans **${local.bans}**`,
        inline: false,
      },
      {
        name: '🌐 Network',
        value: `Observed guilds **${history.length}** • Cross-guild cases **${context.network?.caseCount || 0}** • Cross-guild bans **${context.network?.banCount || 0}** • External records **${externalCount}**`,
        inline: false,
      },
      {
        name: '🔗 Correlation',
        value: correlation
          ? `Highest current heuristic match **${correlation.score}%** with ${correlation.member.user}\n${correlation.signals.slice(0, 5).map((signal) => `• ${signal}`).join('\n')}\n\n*Correlation is an investigation aid, not proof of shared ownership.*`
          : 'No heuristic account correlations found in the current guild cache.',
        inline: false,
      },
      {
        name: '👁️ Investigation State',
        value: `Investigation Watch **${watchOn ? 'ON' : 'OFF'}** • Global watch state **${String(context.watch?.state || 'clear').toUpperCase()}**`,
        inline: false,
      },
    )
    .setFooter({ text: `Opened privately by ${interaction.user.tag || interaction.user.username}` })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mod_member_scan:${target.id}`).setLabel('Rescan').setEmoji('🔄').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`mod_scan_history:${target.id}`).setLabel('History').setEmoji('🕘').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`mod_intel_guilds:${target.id}`).setLabel('Network').setEmoji('🌐').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`mod_scan_watch:${target.id}`).setLabel(watchOn ? 'Watch On' : 'Watch Off').setEmoji('👁️').setStyle(watchOn ? ButtonStyle.Danger : ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row], flags: 64 };
}

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    const id = String(interaction?.customId || '');
    if (!id.startsWith('joinintel:')) return;
    if (!interaction.inGuild?.() || !interaction.isButton?.()) return;
    if (handledInteractions.has(interaction)) return;
    handledInteractions.add(interaction);
    try {

      const [, action, guildId, userId] = id.split(':');
      if (id.split(':').length !== 4 || !['view', 'watch', 'clear'].includes(action) || String(interaction.guild.id) !== String(guildId) || !/^\d{15,25}$/.test(userId || '')) {
        await interaction.reply({ content: '❌ That intelligence action is no longer valid.', flags: 64 }).catch(() => null);
        return;
      }

      const allowed = canUseModAction(interaction.member, interaction.guild, 'scan_run', interaction)
        || canUseModAction(interaction.member, interaction.guild, 'view_case_detail', interaction);
      if (!allowed) {
        await interaction.reply({ content: '❌ You do not have permission to manage Member Intelligence.', flags: 64 }).catch(() => null);
        return;
      }

      await interaction.deferReply({ flags: 64 });
      const target = await resolveTarget(interaction, userId);
      if (!target) {
        await interaction.editReply({ content: '❌ That member is no longer available in this server.' }).catch(() => null);
        return;
      }

      if (action === 'view') {
        const payload = await buildEphemeralIntelligence(interaction, target);
        delete payload.flags;
        await interaction.editReply(payload);
        return;
      }

      if (action === 'watch') {
        const before = currentInvestigationWatch(interaction.guild.id, userId);
        if (!before) {
          recordModerationSystemEvent({
            interaction,
            event: 'moderation.member_scan.watch_updated',
            action: 'member_watch',
            targetId: userId,
            before: { enabled: false },
            after: { enabled: true, reason: 'Enabled from persistent Member Intelligence report.' },
            metadata: { targetId: userId, source: 'join_intelligence_report' },
          });
        }
        await interaction.editReply({
          content: before
            ? `👁️ ${target.user} is already on **Investigation Watch**.`
            : `👁️ ${target.user} is now on **Investigation Watch**. The channel report has been left in place.`,
        });
        return;
      }

      if (action === 'clear') {
        const result = decisioning.markClear(interaction.guild.id, userId, interaction.user.id);
        await interaction.editReply({
          content: `✅ ${target.user} has been reviewed and marked **CLEAR** in Member Intelligence. This does not erase moderation history or watchlist evidence.`,
        });
        console.log(`[Join Intelligence] ${interaction.user.id} marked ${userId} clear in ${interaction.guild.id} (previous=${result.before?.decision || 'none'}).`);
      }
    } catch (error) {
      console.error('[Join Intelligence] Action failed:', error);
      const payload = { content: 'Member Intelligence could not complete this action. Please try again.' };
      if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => null);
      else await interaction.reply({ ...payload, flags: 64 }).catch(() => null);
    }
  },
};
