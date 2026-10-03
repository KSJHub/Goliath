'use strict';

const guildManager = require('../../guild/guildManager');
const { getQuarantineState, getQuarantineMode, QUARANTINE_MODES } = require('../../security/protection/quarantine');
const audit = require('../../../owner/auditIntelligence/auditIntelligence');

function save(guild, state) {
  return guildManager.updateSecurityConfig(guild.id, security => ({ ...security, quarantine: state }), guild);
}

async function editAccess(channel, memberId, allowed, reason) {
  if (!channel?.permissionOverwrites?.edit) throw new Error('That channel cannot be managed.');
  if (allowed) {
    await channel.permissionOverwrites.edit(memberId, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
    }, { reason });
  } else {
    await channel.permissionOverwrites.edit(memberId, { ViewChannel: false }, { reason });
  }
}

async function logAccessChange(interaction, target, action, channel, beforeIds, afterIds) {
  const actionLabels = {
    add: 'Investigation Channel Access Allowed',
    remove: 'Investigation Channel Access Removed',
    clear: 'Investigation Access Reset',
  };
  const before = [...beforeIds];
  const after = [...afterIds];
  return audit.captureGoliathAction(interaction.client, {
    type: `goliath.quarantine.investigationAccess.${action}`,
    category: 'goliath',
    action: action === 'add' ? 'create' : action === 'remove' ? 'delete' : 'update',
    title: actionLabels[action] || 'Investigation Access Changed',
    icon: '🔒',
    guild: interaction.guild,
    channel: channel || interaction.channel || null,
    user: target.user,
    member: target,
    actor: {
      id: interaction.user.id,
      username: interaction.user.username || null,
      globalName: interaction.user.globalName || null,
      bot: Boolean(interaction.user.bot),
    },
    target: { id: target.id, label: target.user.tag || target.user.username || target.id },
    summary: action === 'clear'
      ? `<@${interaction.user.id}> returned <@${target.id}> to private investigation-room-only access.`
      : `<@${interaction.user.id}> ${action === 'add' ? 'allowed' : 'removed'} <#${channel.id}> ${action === 'add' ? 'for' : 'from'} <@${target.id}>'s investigation access.`,
    before: { allowedChannelIds: before },
    after: { allowedChannelIds: after },
    metadata: {
      interactionId: interaction.id || null,
      investigationMode: QUARANTINE_MODES.INVESTIGATION,
      requestedAction: action,
      channelId: channel?.id || null,
      allowedChannelCount: after.length,
    },
  }).catch((error) => {
    console.warn('[InvestigationAccess] Audit capture failed:', error?.message || error);
    return null;
  });
}

async function updateAccess(interaction, target, action, channel = null) {
  if (!interaction?.guild) {
    throw new Error('Investigation access can only be changed inside a server.');
  }
  if (!target?.id || !target?.user) {
    throw new Error('The investigated member could not be resolved.');
  }
  if (!['add', 'remove', 'clear'].includes(action)) {
    throw new Error('Unknown investigation access action.');
  }

  const state = getQuarantineState(interaction.guild.id);
  const snapshot = state.users?.[target.id];

  if (!snapshot || getQuarantineMode(snapshot) !== QUARANTINE_MODES.INVESTIGATION) {
    throw new Error(`${target.user.tag} is not currently under Investigation Isolation.`);
  }

  if ((action === 'add' || action === 'remove') && !channel) {
    throw new Error('Choose a channel as well.');
  }

  if (channel && String(channel.id) === String(snapshot.interviewChannelId || '')) {
    throw new Error('The private investigation room is always available while the investigation is active.');
  }

  const existing = [...new Set((snapshot.allowedChannelIds || []).map(String))];
  const before = new Set(existing);
  const next = new Set(existing);
  const changedDuringClear = [];

  try {
    if (action === 'add') {
      await editAccess(
        channel,
        target.id,
        true,
        `Investigation channel access allowed by ${interaction.user.tag}`
      );
      next.add(String(channel.id));
    } else if (action === 'remove') {
      await editAccess(
        channel,
        target.id,
        false,
        `Investigation channel access removed by ${interaction.user.tag}`
      );
      next.delete(String(channel.id));
    } else {
      for (const channelId of existing) {
        const current = interaction.guild.channels.cache.get(channelId)
          || await interaction.guild.channels.fetch(channelId).catch(() => null);

        if (!current) continue;

        await editAccess(
          current,
          target.id,
          false,
          `Investigation returned to private-room-only by ${interaction.user.tag}`
        );

        changedDuringClear.push(current);
      }

      next.clear();
    }

    snapshot.allowedChannelIds = [...next];
    snapshot.allowedChannelsUpdatedAt = Date.now();
    snapshot.allowedChannelsUpdatedBy = interaction.user.id;
    state.users[target.id] = snapshot;

    save(interaction.guild, state);

    await logAccessChange(
      interaction,
      target,
      action,
      channel,
      before,
      next
    );

    return {
      snapshot,
      allowedChannelIds: [...next],
    };
  } catch (error) {
    if (action === 'clear' && changedDuringClear.length) {
      await Promise.allSettled(
        changedDuringClear.map(current =>
          editAccess(
            current,
            target.id,
            true,
            'Rollback incomplete investigation access reset'
          )
        )
      );
    } else if (channel) {
      await editAccess(
        channel,
        target.id,
        before.has(String(channel.id)),
        'Rollback failed investigation access change'
      ).catch(() => null);
    }

    throw error;
  }
}

module.exports = { updateAccess, editAccess, logAccessChange };
