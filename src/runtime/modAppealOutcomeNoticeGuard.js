'use strict';

const Discord = require('discord.js');
const { buildMemberNotice, COLORS } = require('../core/ui/memberNotice');

const PATCH_KEY = Symbol.for('goliath.mod.appeal-outcome-notice-v1');

if (!globalThis[PATCH_KEY]) {
  globalThis[PATCH_KEY] = { installed: true };

  const originalSend = Discord.User.prototype.send;

  function parseLegacyAppealOutcome(payload) {
    const content = typeof payload === 'string' ? payload : payload?.content;
    if (typeof content !== 'string' || !content.startsWith('Your appeal for **')) return null;

    const first = content.match(/^Your appeal for \*\*(.+?)\*\* • Case \*\*#(\d+)\*\* has been \*\*(approved|denied)\s*(✅|❌)?\*\*\./i);
    if (!first) return null;

    const review = content.match(/^Review:\s*(.+)$/im)?.[1]?.trim() || 'No review rationale was provided.';
    const outcome = content.match(/^Outcome:\s*(.+)$/im)?.[1]?.trim() || null;
    const invite = content.match(/^Rejoin link \(single use, expires in 24 hours\):\s*(https?:\/\/\S+)$/im)?.[1]?.trim() || null;

    return {
      guildName: first[1],
      caseId: Number(first[2]),
      decision: String(first[3]).toLowerCase(),
      review,
      outcome,
      invite,
    };
  }

  function resolveGuildAndCase(user, parsed) {
    const storage = require('../core/administration/mod/storage');
    const guilds = user?.client?.guilds?.cache;
    if (!guilds) return { guild: null, modCase: null };

    for (const guild of guilds.values()) {
      const modCase = storage.getCaseById(guild.id, parsed.caseId);
      if (!modCase) continue;
      if (String(modCase.userId) !== String(user.id)) continue;
      return { guild, modCase };
    }

    const guild = [...guilds.values()].find((item) => item.name === parsed.guildName) || null;
    return { guild, modCase: null };
  }

  Discord.User.prototype.send = async function goliathAppealOutcomeSend(payload, ...args) {
    const parsed = parseLegacyAppealOutcome(payload);
    if (!parsed) return originalSend.call(this, payload, ...args);

    try {
      const { guild, modCase } = resolveGuildAndCase(this, parsed);
      if (!guild) return originalSend.call(this, payload, ...args);

      const approved = parsed.decision === 'approved';
      const status = approved ? 'Approved' : 'Denied';
      const buttons = [];
      if (parsed.invite) buttons.push({ url: parsed.invite, label: 'Rejoin Server', emoji: '🔗' });

      const base = String(process.env.CLIENT_URL || process.env.DASHBOARD_CLIENT_URL || process.env.VITE_CLIENT_URL || 'https://goliath.ksjdigital.co.uk').trim().replace(/\/+$/, '');
      buttons.push({ url: `${base}/appeals`, label: 'Appeals Portal', emoji: '⚖️' });

      const notice = buildMemberNotice(guild, {
        module: 'Goliath Appeals',
        emoji: approved ? '✅' : '❌',
        title: approved ? 'Your Appeal Has Been Approved' : 'Your Appeal Has Been Denied',
        color: approved ? COLORS.success : COLORS.danger,
        description: `A decision has been recorded for your appeal relating to **Case #${parsed.caseId}**. This message is your official Goliath appeal outcome record.`,
        reference: `Case #${parsed.caseId}`,
        status,
        fields: [
          { name: '⚖️ Appeal Decision', value: `**${status}**`, inline: true },
          { name: '🛡️ Original Action', value: `**${String(modCase?.action || 'Moderation Case').replace(/(^|[-_ ])\w/g, (m) => m.toUpperCase())}**`, inline: true },
          ...(parsed.outcome ? [{ name: '🔄 Outcome / Remedy', value: parsed.outcome, inline: false }] : []),
          ...(parsed.invite ? [{ name: '🔗 Rejoin Access', value: 'A single-use rejoin link has been issued below and expires after 24 hours.', inline: false }] : []),
        ],
        reason: parsed.review,
        meaning: approved
          ? 'Management has completed its review and approved your appeal. Any recorded remedy shown above forms part of this decision.'
          : 'Management has completed its review and the original moderation decision remains in effect unless a later case update changes it.',
        nextSteps: parsed.invite
          ? 'Use the **Rejoin Server** button below before the invite expires. Keep this DM as your appeal record.'
          : approved
            ? 'No further action is required unless the outcome above gives you a specific next step. Keep this DM as your appeal record.'
            : 'You can keep this DM as your appeal record. The Appeals Portal remains available for any future eligible appeal action.',
        buttons,
      });

      return originalSend.call(this, notice, ...args);
    } catch (error) {
      console.error('[AppealOutcomeNotice] Failed to transform appeal outcome DM:', error);
      return originalSend.call(this, payload, ...args);
    }
  };
}
