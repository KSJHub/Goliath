'use strict';

const { EmbedBuilder } = require('discord.js');

const PATCH_KEY = Symbol.for('goliath.mod.departure-notice-v1');
const NOTICE_STORE_KEY = Symbol.for('goliath.mod.departure-notice-store-v1');

if (!globalThis[NOTICE_STORE_KEY]) globalThis[NOTICE_STORE_KEY] = new Map();

if (!globalThis[PATCH_KEY]) {
  globalThis[PATCH_KEY] = { installed: true };

  const engine = require('../core/administration/automod/engine');
  const originalApplyPunishmentEngine = engine.applyPunishmentEngine;

  function departureAction(options = {}) {
    if (String(options.source || '') !== 'moderation') return null;
    const punishments = Array.isArray(options.punishments) ? options.punishments.map((value) => String(value).toLowerCase()) : [];
    if (punishments.includes('ban')) return 'ban';
    if (punishments.includes('kick')) return 'kick';
    return null;
  }

  function keyFor(guildId, userId) {
    return `${String(guildId)}:${String(userId)}`;
  }

  async function removePlaceholder(key) {
    const message = globalThis[NOTICE_STORE_KEY].get(key);
    globalThis[NOTICE_STORE_KEY].delete(key);
    if (message?.delete) await message.delete().catch(() => null);
  }

  engine.applyPunishmentEngine = async function departureSafePunishment(input = {}, options = {}) {
    const action = departureAction(options);
    if (!action) return originalApplyPunishmentEngine(input, options);

    const guild = input.guild || input.member?.guild || null;
    const user = input.user || input.member?.user || null;
    const userId = String(input.targetId || user?.id || input.member?.id || '').trim();
    const key = guild?.id && userId ? keyFor(guild.id, userId) : null;

    // Discord can reject a brand-new DM once Kick/Ban has removed the last
    // mutual guild. Establish the bot-owned DM message while the member is
    // still present, then the case-aware pipeline edits this same message after
    // the Discord action and Case creation have both succeeded.
    if (key && user?.send) {
      try {
        const label = action === 'ban' ? 'Ban' : 'Kick';
        const placeholder = await user.send({
          embeds: [new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('🛡️ Goliath Moderation')
            .setDescription(`A **${label}** moderation action is being finalised for **${String(guild?.name || 'this server')}**. This notice will update with the recorded case details and appeal options.`)
            .setFooter({ text: 'Goliath Moderation • Finalising case' })
            .setTimestamp()],
        });
        globalThis[NOTICE_STORE_KEY].set(key, placeholder);
      } catch {
        // The punishment must never depend on DM availability. The canonical
        // notice pipeline will record the final delivery failure afterwards.
      }
    }

    try {
      const report = await originalApplyPunishmentEngine(input, options);
      const applied = Array.isArray(report?.applied) ? report.applied.map((value) => String(value).toLowerCase()) : [];
      if (key && !applied.includes(action)) await removePlaceholder(key);
      return report;
    } catch (error) {
      if (key) await removePlaceholder(key);
      throw error;
    }
  };

  globalThis[PATCH_KEY].store = globalThis[NOTICE_STORE_KEY];
}
