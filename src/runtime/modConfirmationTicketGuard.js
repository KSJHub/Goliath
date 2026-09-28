'use strict';

const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');

const PATCH_KEY = Symbol.for('goliath.mod.confirmation-ticket-v1');

if (!globalThis[PATCH_KEY]) {
  globalThis[PATCH_KEY] = { installed: true };

  const punishments = require('../core/administration/mod/punishments');
  const adminPanel = require('../core/administration/admin/panel');

  const originalCreateConfirmation = punishments.createConfirmation;
  const originalSubmitPunishmentRequest = punishments.submitPunishmentRequest;

  const TIER_META = Object.freeze({
    administrator: { rank: 300, badge: '👑' },
    moderator: { rank: 200, badge: '🛡️' },
    juniorModerator: { rank: 100, badge: '🔰' },
  });

  const ACTION_META = Object.freeze({
    kick: { label: 'Kick Member', emoji: '👢', warning: 'This action will remove the member from the server.' },
    ban: { label: 'Ban Member', emoji: '🔨', warning: 'This action will ban the member from the server.' },
    'remove-warning': { label: 'Remove Warning', emoji: '🗑️', warning: 'This action will reverse the selected warning.' },
    'remove-timeout': { label: 'Remove Timeout', emoji: '✅', warning: 'This action will remove the member’s active timeout.' },
  });

  function memberRoleIds(member) {
    const cache = member?.roles?.cache;
    if (cache?.keys) return [...cache.keys()].map(String);
    if (Array.isArray(member?.roles)) return member.roles.map(String);
    return [];
  }

  function mappedAuthority(member, guild) {
    if (!member || !guild || typeof adminPanel.getAuthorityConfig !== 'function') return null;
    let config;
    try { config = adminPanel.getAuthorityConfig(guild.id); } catch { return null; }
    if (!config?.configured) return null;

    const matches = memberRoleIds(member)
      .map((roleId) => ({ roleId, profile: config.roleProfiles?.[roleId] }))
      .filter(({ profile }) => profile && TIER_META[profile.tier])
      .map(({ roleId, profile }) => ({
        roleId,
        tier: profile.tier,
        rank: TIER_META[profile.tier].rank,
        badge: TIER_META[profile.tier].badge,
        role: guild.roles?.cache?.get?.(roleId) || null,
      }))
      .sort((a, b) => (b.rank - a.rank) || ((b.role?.position || 0) - (a.role?.position || 0)));

    const best = matches[0];
    if (!best) return null;
    return {
      source: 'authority-control',
      badge: best.badge,
      label: best.role?.name || ({ administrator: 'Admin', moderator: 'Moderator', juniorModerator: 'Staff' }[best.tier] || 'Staff'),
      roleId: best.roleId,
      tier: best.tier,
    };
  }

  function fallbackAuthority(member) {
    const permissions = member?.permissions;
    if (permissions?.has?.(PermissionFlagsBits.Administrator) || permissions?.has?.(PermissionFlagsBits.BanMembers)) {
      return { source: 'legacy', badge: '👑', label: 'Admin' };
    }
    if (permissions?.has?.(PermissionFlagsBits.KickMembers) || permissions?.has?.(PermissionFlagsBits.ModerateMembers)) {
      return { source: 'legacy', badge: '🛡️', label: 'Moderator' };
    }
    return { source: 'legacy', badge: '👥', label: 'Staff' };
  }

  function resolveIssuingAuthority(interaction) {
    return mappedAuthority(interaction?.member, interaction?.guild) || fallbackAuthority(interaction?.member);
  }

  function actionMeta(type) {
    return ACTION_META[type] || { label: String(type || 'Moderation Action').replaceAll('-', ' ').replace(/\b\w/g, (c) => c.toUpperCase()), emoji: '🛡️', warning: 'The action will be revalidated when confirmed.' };
  }

  function targetLabel(interaction, targetId) {
    const member = interaction?.guild?.members?.cache?.get?.(String(targetId));
    const name = member?.displayName || member?.user?.globalName || member?.user?.username || String(targetId || 'Unknown');
    return { name, mention: targetId ? `<@${targetId}>` : name };
  }

  function buildTicket(interaction, targetId, type, data = {}) {
    const meta = actionMeta(type);
    const target = targetLabel(interaction, targetId);
    const authority = resolveIssuingAuthority(interaction);
    const actorMention = interaction?.user?.id ? `<@${interaction.user.id}>` : (interaction?.user?.username || 'Unknown');
    const reason = String(data.reason || data.removalReason || 'No additional reason supplied.').trim().slice(0, 1000);

    const embed = new EmbedBuilder()
      .setColor(type === 'kick' || type === 'ban' ? 0xED4245 : 0x5865F2)
      .setTitle(`${meta.emoji} Confirm ${meta.label} • ${target.name}`.slice(0, 256))
      .addFields(
        { name: 'Target', value: `${target.mention}\n\`${String(targetId || 'Unknown')}\``, inline: true },
        { name: 'Action', value: `**${meta.label}**`, inline: true },
        { name: 'Issuing Authority', value: `${authority.badge} **${authority.label}** • ${actorMention}`, inline: false },
        { name: 'Reason', value: reason || 'No additional reason supplied.', inline: false },
      );

    if (type === 'ban' && data.deleteDays !== undefined) {
      embed.addFields({ name: 'Message History', value: `Delete **${Number(data.deleteDays) || 0} day(s)** of messages`, inline: true });
    }

    embed.addFields(
      { name: 'Safety Check', value: 'Authority, Discord hierarchy, target safety and current permissions will be rechecked when this action is confirmed.', inline: false },
      { name: '⚠️ Confirmation', value: meta.warning, inline: false },
    );
    return embed;
  }

  function decorateConfirmationPayload(payload, interaction, targetId, type, data) {
    if (!payload || typeof payload !== 'object') return payload;
    const components = payload.components;
    const hasConfirm = Array.isArray(components) && components.some((row) => {
      const items = row?.components || row?.data?.components || [];
      return items.some((button) => String(button?.data?.custom_id || button?.custom_id || '').startsWith('mod_confirm_action:'));
    });
    if (!hasConfirm) return payload;

    const meta = actionMeta(type);
    const next = { ...payload, content: null, embeds: [buildTicket(interaction, targetId, type, data)] };
    for (const row of components) {
      const items = row?.components || row?.data?.components || [];
      for (const button of items) {
        const customId = String(button?.data?.custom_id || button?.custom_id || '');
        if (!customId.startsWith('mod_confirm_action:')) continue;
        const label = `Confirm ${meta.label.replace(/ Member$/, '')}`.slice(0, 80);
        if (button?.setLabel) button.setLabel(label);
        else if (button?.data) button.data.label = label;
        else button.label = label;
      }
    }
    return next;
  }

  async function withConfirmationDecoration(interaction, targetId, type, data, fn) {
    const restores = [];
    for (const method of ['reply', 'update', 'editReply']) {
      if (typeof interaction?.[method] !== 'function') continue;
      const original = interaction[method];
      interaction[method] = function decoratedModerationConfirmation(payload, ...rest) {
        return original.call(this, decorateConfirmationPayload(payload, interaction, targetId, type, data), ...rest);
      };
      restores.push(() => { interaction[method] = original; });
    }
    try { return await fn(); }
    finally { while (restores.length) restores.pop()(); }
  }

  async function createTicketConfirmation(interaction, targetId, type, data, message, context) {
    return withConfirmationDecoration(interaction, targetId, type, data || {}, () =>
      originalCreateConfirmation(interaction, targetId, type, data, message, context));
  }

  punishments.createConfirmation = createTicketConfirmation;
  punishments.submitPunishmentRequest = async function ticketedPunishmentRequest(interaction, target, action) {
    return originalSubmitPunishmentRequest(interaction, target, action, createTicketConfirmation);
  };

  globalThis[PATCH_KEY].resolveIssuingAuthority = resolveIssuingAuthority;
  globalThis[PATCH_KEY].buildTicket = buildTicket;
}
