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

// Keep the persistent report and its controls in sync with staff actions.
async function refreshJoinReport(interaction, watched, cleared = false) {
  const message = interaction.message;
  if (!message?.edit || !message.embeds?.length) return;
  const original = message.embeds[0];
  if (!String(original.title || '').startsWith('🧠 Join Intelligence')) return;
  const embed = EmbedBuilder.from(original);
  const fields = (original.fields || []).map(field => ({ ...field }));
  const risk = fields.find(field => field.name?.includes('Risk'));
  if (risk) {
    risk.value = String(risk.value).replace(/\nInvestigation Watch: \*\*(?:ON|OFF)\*\*/, '');
    risk.value = (risk.value + '\nInvestigation Watch: **' + (watched ? 'ON' : 'OFF') + '**').slice(0, 1024);
  }
  embed.setFields(fields);
  if (cleared) {
    embed.setDescription(String(original.description || '').replace(/[^\n]*\*\*Decision: [^\n]+/, '🟢 **Decision: CLEAR**'));
    embed.setColor(0x57F287);
  }
  const rows = (message.components || []).map(row => {
    const data = typeof row.toJSON === 'function' ? row.toJSON() : row;
    return new ActionRowBuilder().addComponents((data.components || []).map(button => {
      const updated = ButtonBuilder.from(button);
      if (String(button.custom_id || '').startsWith('joinintel:watch:')) {
        updated.setLabel(watched ? 'Remove Watch' : 'Watch Member')
          .setStyle(watched ? ButtonStyle.Danger : ButtonStyle.Secondary);
      }
      if (cleared && String(button.custom_id || '').startsWith('joinintel:clear:')) {
        updated.setLabel('Marked Clear').setDisabled(true);
      }
      return updated;
    }));
  });
  await message.edit({ embeds: [embed], components: rows, allowedMentions: { parse: [] } });
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
      // Acknowledge immediately. Permission checks and member fetches can exceed
      // Discord's three-second interaction deadline during busy join events.
      await interaction.deferReply({ flags: 64 });
      const [, action, guildId, userId] = id.split(':');
      if (id.split(':').length !== 4 || !['view', 'watch', 'clear'].includes(action) || String(interaction.guild.id) !== String(guildId) || !/^\d{15,25}$/.test(userId || '')) {
        await interaction.editReply({ content: '❌ That intelligence action is no longer valid.' });
        return;
      }

      const allowed = canUseModAction(interaction.member, interaction.guild, 'scan_run', interaction)
        || canUseModAction(interaction.member, interaction.guild, 'view_case_detail', interaction);
      if (!allowed) {
        await interaction.editReply({ content: '❌ You do not have permission to manage Member Intelligence.' });
        return;
      }

      // Mark Clear only updates guild-scoped intelligence state. It does not
      // need a Discord API member fetch, which can stall on busy join events.
      if (action === 'clear') {
        const result = decisioning.markClear(interaction.guild.id, userId, interaction.user.id);
        await interaction.editReply({
          content: `✅ <@${userId}> has been reviewed and marked **CLEAR** in Member Intelligence. This does not erase moderation history or watchlist evidence.`,
          allowedMentions: { parse: [] },
        });
        console.log(`[Join Intelligence] ${interaction.user.id} marked ${userId} clear in ${interaction.guild.id} (previous=${result.before?.decision || 'none'}).`);
        await refreshJoinReport(interaction, currentInvestigationWatch(interaction.guild.id, userId), true).catch(error => console.error('[Join Intelligence] Report refresh failed:', error));
        return;
      }

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
        recordModerationSystemEvent({
          interaction,
          event: 'moderation.member_scan.watch_updated',
          action: 'member_watch',
          targetId: userId,
          before: { enabled: before },
          after: { enabled: !before, reason: 'Toggled from persistent Member Intelligence report.' },
          metadata: { targetId: userId, source: 'join_intelligence_report' },
        });
        await interaction.editReply({
          content: before
            ? `👁️ ${target.user} has been **removed** from Investigation Watch.`
            : `👁️ ${target.user} is now on **Investigation Watch**.`,
        });
        await refreshJoinReport(interaction, !before).catch(error => console.error('[Join Intelligence] Report refresh failed:', error));
        return;
      }


    } catch (error) {
      console.error('[Join Intelligence] Action failed:', error);
      const payload = { content: 'Member Intelligence could not complete this action. Please try again.' };
      if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => null);
      else await interaction.reply({ ...payload, flags: 64 }).catch(() => null);
    }
  },
};
