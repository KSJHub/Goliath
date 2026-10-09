'use strict';

const Discord = require('discord.js');
const { safeReply, safeEditReply } = require('../../../core/ui/interactionResponse');
const {
  requireModeratableTarget,
  recordModerationSystemEvent,
} = require('./permissions');
const {
  createCase,
  updateCaseStatus,
  recordCaseAudit,
} = require('./storage');
const {
  QUARANTINE_MODES,
  quarantineMember,
  restoreQuarantinedMember,
  getQuarantineState,
  getQuarantineMode,
  attachQuarantineCase,
} = require('../../security/protection/quarantine');
const { refreshDashboard } = require('./panel');
const investigationAccess = require('./investigationAccess');

function isGuildOwner(interaction) {
  return Boolean(
    interaction?.guild?.ownerId
    && interaction?.user?.id
    && String(interaction.guild.ownerId) === String(interaction.user.id)
  );
}

function targetIdFrom(customId) {
  return String(customId || '').split(':')[1] || null;
}

function fieldValue(interaction, key) {
  try {
    return String(interaction.fields?.getTextInputValue?.(key) || '').trim();
  } catch {
    return '';
  }
}

async function ensureInitiatorInterviewAccess(guild, channelId, initiatorId) {
  if (!guild || !channelId || !initiatorId) return { success: false, reason: 'Missing guild/channel/initiator.' };
  const channel = guild.channels.cache.get(String(channelId))
    || await guild.channels.fetch(String(channelId)).catch(() => null);
  if (!channel?.permissionOverwrites?.edit) return { success: false, reason: 'Investigation room is unavailable.' };
  const member = guild.members.cache.get(String(initiatorId))
    || await guild.members.fetch(String(initiatorId)).catch(() => null);
  if (!member) return { success: false, reason: 'Initiating moderator is no longer in the guild.' };
  try {
    // Keep this to the permissions required to use the room. Asking Discord to
    // grant unrelated bits (for example ManageMessages) can return 50013 when
    // the bot does not itself hold that bit in the private category.
    await channel.permissionOverwrites.edit(member.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
    }, { reason: 'Ensure investigating moderator can access the private interview room' });
    return { success: true, channelId: channel.id, memberId: member.id };
  } catch (error) {
    return { success: false, reason: error.message };
  }
}

function investigationModal(targetId) {
  return new Discord.ModalBuilder()
    .setCustomId(`mod_submit_quarantine_investigation:${targetId}`)
    .setTitle('Investigate Member')
    .addComponents(
      new Discord.ActionRowBuilder().addComponents(
        new Discord.TextInputBuilder()
          .setCustomId('reason')
          .setLabel('Reason for investigation')
          .setStyle(Discord.TextInputStyle.Paragraph)
          .setRequired(true)
          .setMinLength(2)
          .setMaxLength(500)
          .setPlaceholder('Why is this member being isolated for investigation?')
      )
    );
}

async function resolveTarget(interaction, targetId, action = 'quarantine') {
  if (!targetId) {
    await safeReply(interaction, { content: '❌ Missing target member.', flags: 64 });
    return null;
  }
  return requireModeratableTarget(interaction, targetId, action);
}

function currentSnapshot(interaction, targetId) {
  return getQuarantineState(interaction.guild.id)?.users?.[String(targetId)] || null;
}

async function openQuarantine(interaction, targetId) {
  const target = await resolveTarget(interaction, targetId, 'quarantine');
  if (!target) return true;
  const existing = currentSnapshot(interaction, target.id);
  if (existing) {
    const mode = getQuarantineMode(existing);
    return safeReply(interaction, {
      content: `⚠️ **${target.user.tag}** is already in **${mode === QUARANTINE_MODES.SECURITY ? 'Full Security Isolation' : 'Investigation Isolation'}**.`,
      flags: 64,
    });
  }

  // /mod is an investigation workflow only. Manual Full Security Isolation lives in /admin.
  await interaction.showModal(investigationModal(target.id));
  return true;
}

async function openInvestigationModal(interaction, targetId) {
  const target = await resolveTarget(interaction, targetId, 'quarantine');
  if (!target) return true;
  if (currentSnapshot(interaction, target.id)) {
    return safeReply(interaction, { content: `⚠️ **${target.user.tag}** is already isolated.`, flags: 64 });
  }
  await interaction.showModal(investigationModal(target.id));
  return true;
}

async function securityMovedToAdmin(interaction, targetId, submitAttempt = false) {
  recordModerationSystemEvent({
    interaction,
    event: 'moderation.quarantine.security_moved_to_admin',
    action: 'quarantine',
    targetId,
    reason: 'Manual Full Security Isolation is only available from the owner controls in /admin.',
    metadata: { submitAttempt },
  });
  return safeReply(interaction, {
    content: '🚨 **Full Security Isolation has moved to `/admin`.** The `/mod` panel is for staff investigations only.',
    flags: 64,
  });
}

function createQuarantineCase(interaction, target, mode, reason, result) {
  if (result?.dryRun) return null;
  const created = createCase({
    guildId: interaction.guild.id,
    userId: target.id,
    moderatorId: interaction.user.id,
    action: 'quarantine',
    reason,
    metadata: {
      containmentMode: mode,
      source: 'moderation',
      interviewChannelId: result?.interviewChannelId || null,
      securityEscalation: false,
      quarantineResult: {
        mode: result?.mode || mode,
        roleId: result?.roleId || null,
        interviewChannelId: result?.interviewChannelId || null,
        escalated: false,
      },
    },
    status: 'active',
    actorId: interaction.user.id,
  });
  if (created?.caseId) attachQuarantineCase(interaction.guild, target.id, created.caseId);
  return created;
}

async function submitQuarantine(interaction, targetId, requestedMode, legacy = false) {
  if (requestedMode === QUARANTINE_MODES.SECURITY) {
    return securityMovedToAdmin(interaction, targetId, true);
  }

  const mode = QUARANTINE_MODES.INVESTIGATION;
  const target = await resolveTarget(interaction, targetId, 'quarantine');
  if (!target) return true;
  const reason = fieldValue(interaction, 'reason');
  if (!reason) return safeReply(interaction, { content: '❌ An investigation reason is required.', flags: 64 });

  // Acknowledge first: isolation performs several Discord API writes and may outlive the modal deadline.
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: Discord.MessageFlags.Ephemeral });
  }

  const result = await quarantineMember(interaction.guild, target, {
    reason,
    quarantinedBy: interaction.user.id,
    source: 'moderation',
    mode,
  });

  if (!result?.success) {
    recordModerationSystemEvent({
      interaction,
      event: 'moderation.quarantine.failed',
      action: 'quarantine',
      targetId: target.id,
      reason,
      after: result,
      metadata: { containmentMode: mode, legacyEntryPoint: legacy },
    });
    return safeEditReply(interaction, {
      content: `❌ Failed to investigate **${target.user.tag}**: ${result?.error || result?.reason || 'Unknown error'}`,
      flags: 64,
    });
  }

  if (!result.dryRun && result.interviewChannelId) {
    const access = await ensureInitiatorInterviewAccess(
      interaction.guild,
      result.interviewChannelId,
      interaction.user.id,
    );
    if (!access.success) {
      console.warn(`[InvestigationIsolation] Could not guarantee initiator access in ${interaction.guild.id}: ${access.reason}`);
      recordModerationSystemEvent({
        interaction,
        event: 'moderation.investigation.initiator_access_failed',
        action: 'quarantine',
        targetId: target.id,
        reason: access.reason,
        metadata: { interviewChannelId: result.interviewChannelId },
      });
    }
  }

  let modCase = null;
  try {
    modCase = createQuarantineCase(interaction, target, mode, reason, result);
  } catch (error) {
    console.error('❌ Failed to create investigation moderation case:', error);
    recordModerationSystemEvent({
      interaction,
      event: 'moderation.quarantine.case_failed',
      action: 'quarantine',
      targetId: target.id,
      reason: error.message,
      metadata: { containmentMode: mode },
    });
  }

  recordModerationSystemEvent({
    interaction,
    event: 'moderation.quarantine.applied',
    action: 'quarantine',
    targetId: target.id,
    reason,
    after: result,
    metadata: {
      containmentMode: mode,
      caseId: modCase?.caseId || null,
      legacyEntryPoint: legacy,
      guildOwnerAuthorized: false,
    },
  });

  const content = result.dryRun
    ? `🧪 Investigation dry-run completed for **${target.user.tag}**.`
    : `🔒 **${target.user.tag}** is now under **Investigation Isolation**.${result.interviewChannelId ? ` • Interview room: <#${result.interviewChannelId}>` : ''}${modCase?.caseId ? ` • Case **#${modCase.caseId}**` : ''}`;

  await safeEditReply(interaction, { content, flags: 64 });
  await refreshDashboard(Discord, interaction, target, { view: 'actions' });
  return true;
}

function canUseInvestigationRoomControls(interaction, snapshot) {
  if (!interaction?.guild || !interaction?.user?.id || !snapshot) return false;
  return String(interaction.guild.ownerId || '') === String(interaction.user.id)
    || String(snapshot.quarantinedBy || '') === String(interaction.user.id);
}

async function openInvestigationAccess(interaction, targetId) {
  const snapshot = currentSnapshot(interaction, targetId);

  if (!snapshot) {
    return safeReply(interaction, {
      content: '⚠️ This investigation is no longer active.',
      flags: 64,
    });
  }

  if (getQuarantineMode(snapshot) !== QUARANTINE_MODES.INVESTIGATION) {
    return safeReply(interaction, {
      content: '❌ Channel Access is only available for Investigation Isolation.',
      flags: 64,
    });
  }

  if (!canUseInvestigationRoomControls(interaction, snapshot)) {
    return safeReply(interaction, {
      content: '❌ Only the lead investigator or server owner can manage investigation channel access.',
      flags: 64,
    });
  }

  if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: Discord.MessageFlags.Ephemeral });

  const target = interaction.guild.members.cache.get(String(targetId))
    || await interaction.guild.members.fetch(String(targetId)).catch(() => null);

  if (!target) {
    return safeEditReply(interaction, {
      content: '❌ The investigated member could not be found.',
      flags: 64,
    });
  }

  const allowedIds = [...new Set(
    (snapshot.allowedChannelIds || []).map(String)
  )];

  const allowedText = allowedIds.length
    ? allowedIds.map(id => `<#${id}>`).join('\n')
    : '**Private investigation room only**';

  const embed = new Discord.EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🔐 Investigation Channel Access')
    .setDescription([
      `**Member:** ${target}`,
      '',
      '**Currently Allowed**',
      allowedText,
      '',
      'Select a normal server channel below, then choose whether to allow or remove access.',
      '',
      'Use **Room Only** to remove all additional channel access.',
    ].join('\n'))
    .setFooter({
      text: 'Goliath • Investigation Isolation',
    })
    .setTimestamp();

  const channelSelect = new Discord.ChannelSelectMenuBuilder()
    .setCustomId(`mod_invroom_access_channel:${targetId}`)
    .setPlaceholder('Choose a server channel')
    .setMinValues(1)
    .setMaxValues(1)
    .addChannelTypes(
      Discord.ChannelType.GuildText,
      Discord.ChannelType.GuildAnnouncement
    );

  const actions = new Discord.ActionRowBuilder().addComponents(
    new Discord.ButtonBuilder()
      .setCustomId(`mod_invroom_access_allow:${targetId}`)
      .setLabel('Allow Access')
      .setEmoji('➕')
      .setStyle(Discord.ButtonStyle.Success)
      .setDisabled(true),

    new Discord.ButtonBuilder()
      .setCustomId(`mod_invroom_access_remove:${targetId}`)
      .setLabel('Remove Access')
      .setEmoji('➖')
      .setStyle(Discord.ButtonStyle.Danger)
      .setDisabled(true),

    new Discord.ButtonBuilder()
      .setCustomId(`mod_invroom_access_clear:${targetId}`)
      .setLabel('Room Only')
      .setEmoji('🔒')
      .setStyle(Discord.ButtonStyle.Secondary)
      .setDisabled(allowedIds.length === 0)
  );

  return safeEditReply(interaction, {
    embeds: [embed],
    components: [
      new Discord.ActionRowBuilder().addComponents(channelSelect),
      actions,
    ],
    flags: 64,
  });
}

function investigationAccessIds(customId) {
  const parts = String(customId || '').split(':');
  return {
    targetId: parts[1] || null,
    channelId: parts[2] || null,
  };
}

function investigationAccessAuthorised(interaction, targetId) {
  const snapshot = currentSnapshot(interaction, targetId);

  if (!snapshot) {
    return {
      allowed: false,
      snapshot: null,
      message: '⚠️ This investigation is no longer active.',
    };
  }

  if (getQuarantineMode(snapshot) !== QUARANTINE_MODES.INVESTIGATION) {
    return {
      allowed: false,
      snapshot,
      message: '❌ Channel Access is only available for Investigation Isolation.',
    };
  }

  if (!canUseInvestigationRoomControls(interaction, snapshot)) {
    return {
      allowed: false,
      snapshot,
      message: '❌ Only the lead investigator or server owner can manage investigation channel access.',
    };
  }

  return {
    allowed: true,
    snapshot,
    message: null,
  };
}

async function selectInvestigationAccessChannel(interaction) {
  const { targetId } = investigationAccessIds(interaction.customId);
  const auth = investigationAccessAuthorised(interaction, targetId);

  if (!auth.allowed) {
    return safeReply(interaction, {
      content: auth.message,
      flags: 64,
    });
  }

  const channelId = String(interaction.values?.[0] || '');

  if (!channelId) {
    return safeReply(interaction, {
      content: '❌ No channel was selected.',
      flags: 64,
    });
  }

  if (String(auth.snapshot.interviewChannelId || '') === channelId) {
    return safeReply(interaction, {
      content: 'ℹ️ The private investigation room is always available and does not need additional access.',
      flags: 64,
    });
  }

  if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();

  const channel = interaction.guild.channels.cache.get(channelId)
    || await interaction.guild.channels.fetch(channelId).catch(() => null);

  if (!channel) {
    return safeReply(interaction, {
      content: '❌ That channel could not be found.',
      flags: 64,
    });
  }

  const allowedIds = new Set(
    (auth.snapshot.allowedChannelIds || []).map(String)
  );

  const actions = new Discord.ActionRowBuilder().addComponents(
    new Discord.ButtonBuilder()
      .setCustomId(`mod_invroom_access_allow:${targetId}:${channelId}`)
      .setLabel('Allow Access')
      .setEmoji('➕')
      .setStyle(Discord.ButtonStyle.Success)
      .setDisabled(allowedIds.has(channelId)),

    new Discord.ButtonBuilder()
      .setCustomId(`mod_invroom_access_remove:${targetId}:${channelId}`)
      .setLabel('Remove Access')
      .setEmoji('➖')
      .setStyle(Discord.ButtonStyle.Danger)
      .setDisabled(!allowedIds.has(channelId)),

    new Discord.ButtonBuilder()
      .setCustomId(`mod_invroom_access_clear:${targetId}`)
      .setLabel('Room Only')
      .setEmoji('🔒')
      .setStyle(Discord.ButtonStyle.Secondary)
      .setDisabled(allowedIds.size === 0)
  );

  return interaction.update({
    components: [
      new Discord.ActionRowBuilder().addComponents(
        new Discord.ChannelSelectMenuBuilder()
          .setCustomId(`mod_invroom_access_channel:${targetId}`)
          .setPlaceholder(`Selected: #${channel.name}`.slice(0, 150))
          .setMinValues(1)
          .setMaxValues(1)
          .addChannelTypes(
            Discord.ChannelType.GuildText,
            Discord.ChannelType.GuildAnnouncement
          )
      ),
      actions,
    ],
  });
}

async function changeInvestigationAccess(interaction, action) {
  const { targetId, channelId } = investigationAccessIds(interaction.customId);
  const auth = investigationAccessAuthorised(interaction, targetId);

  if (!auth.allowed) {
    return safeReply(interaction, {
      content: auth.message,
      flags: 64,
    });
  }

  if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();

  const target = interaction.guild.members.cache.get(String(targetId))
    || await interaction.guild.members.fetch(String(targetId)).catch(() => null);

  if (!target) {
    return safeReply(interaction, {
      content: '❌ The investigated member could not be found.',
      flags: 64,
    });
  }

  let channel = null;

  if (action !== 'clear') {
    if (!channelId) {
      return safeReply(interaction, {
        content: '❌ Select a channel first.',
        flags: 64,
      });
    }

    channel = interaction.guild.channels.cache.get(String(channelId))
      || await interaction.guild.channels.fetch(String(channelId)).catch(() => null);

    if (!channel) {
      return safeReply(interaction, {
        content: '❌ The selected channel could not be found.',
        flags: 64,
      });
    }
  }

  try {
    const result = await investigationAccess.updateAccess(
      interaction,
      target,
      action,
      channel
    );

    const allowedIds = result.allowedChannelIds || [];

    const allowedText = allowedIds.length
      ? allowedIds.map(id => `<#${id}>`).join('\n')
      : '**Private investigation room only**';

    const actionText = action === 'add'
      ? `Access allowed for ${channel}.`
      : action === 'remove'
        ? `Access removed from ${channel}.`
        : 'All additional channel access removed.';

    const embed = new Discord.EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🔐 Investigation Channel Access')
      .setDescription([
        `**Member:** ${target}`,
        '',
        `✅ ${actionText}`,
        '',
        '**Currently Allowed**',
        allowedText,
        '',
        'Select another normal server channel below to continue managing access.',
      ].join('\n'))
      .setFooter({
        text: 'Goliath • Investigation Isolation',
      })
      .setTimestamp();

    const channelSelect = new Discord.ChannelSelectMenuBuilder()
      .setCustomId(`mod_invroom_access_channel:${targetId}`)
      .setPlaceholder('Choose a server channel')
      .setMinValues(1)
      .setMaxValues(1)
      .addChannelTypes(
        Discord.ChannelType.GuildText,
        Discord.ChannelType.GuildAnnouncement
      );

    const actions = new Discord.ActionRowBuilder().addComponents(
      new Discord.ButtonBuilder()
        .setCustomId(`mod_invroom_access_allow:${targetId}`)
        .setLabel('Allow Access')
        .setEmoji('➕')
        .setStyle(Discord.ButtonStyle.Success)
        .setDisabled(true),

      new Discord.ButtonBuilder()
        .setCustomId(`mod_invroom_access_remove:${targetId}`)
        .setLabel('Remove Access')
        .setEmoji('➖')
        .setStyle(Discord.ButtonStyle.Danger)
        .setDisabled(true),

      new Discord.ButtonBuilder()
        .setCustomId(`mod_invroom_access_clear:${targetId}`)
        .setLabel('Room Only')
        .setEmoji('🔒')
        .setStyle(Discord.ButtonStyle.Secondary)
        .setDisabled(allowedIds.length === 0)
    );

    return interaction.editReply({
      embeds: [embed],
      components: [
        new Discord.ActionRowBuilder().addComponents(channelSelect),
        actions,
      ],
    });
  } catch (error) {
    return safeReply(interaction, {
      content: `❌ I couldn't change that investigation access: ${error.message}`,
      flags: 64,
    });
  }
}

async function openInvestigationNoteModal(interaction, targetId) {
  const snapshot = currentSnapshot(interaction, targetId);
  if (!snapshot) return safeReply(interaction, { content: '⚠️ This investigation is no longer active.', flags: 64 });
  if (!canUseInvestigationRoomControls(interaction, snapshot)) return safeReply(interaction, { content: '❌ Only the lead investigator or server owner can use this room control.', flags: 64 });
  const modal = new Discord.ModalBuilder().setCustomId(`mod_invroom_note_submit:${targetId}`).setTitle('Add Investigation Note').addComponents(
    new Discord.ActionRowBuilder().addComponents(
      new Discord.TextInputBuilder().setCustomId('note').setLabel('Staff-only note').setStyle(Discord.TextInputStyle.Paragraph).setRequired(true).setMinLength(2).setMaxLength(1000).setPlaceholder('Record an observation, update, evidence lead or next step.')
    )
  );
  await interaction.showModal(modal);
  return true;
}

async function submitInvestigationRoomNote(interaction, targetId) {
  const snapshot = currentSnapshot(interaction, targetId);
  if (!snapshot) return safeReply(interaction, { content: '⚠️ This investigation is no longer active.', flags: 64 });
  if (!canUseInvestigationRoomControls(interaction, snapshot)) return safeReply(interaction, { content: '❌ Only the lead investigator or server owner can add room notes.', flags: 64 });
  const note = fieldValue(interaction, 'note').slice(0, 1000);
  if (!note) return safeReply(interaction, { content: '❌ The note cannot be empty.', flags: 64 });
  if (snapshot.caseId) {
    recordCaseAudit({ guildId: interaction.guild.id, caseId: snapshot.caseId, actorId: interaction.user.id, event: 'case.investigation.room_note_added', before: null, after: { note }, metadata: { targetId: String(targetId), interviewChannelId: snapshot.interviewChannelId || null, staffOnly: true } });
  }
  recordModerationSystemEvent({ interaction, event: 'moderation.investigation.room_note_added', action: 'investigation_note', targetId: String(targetId), after: { note }, metadata: { caseId: snapshot.caseId || null, interviewChannelId: snapshot.interviewChannelId || null } });
  return safeReply(interaction, { content: `✅ Staff note added${snapshot.caseId ? ` to **Case #${snapshot.caseId}**` : ''}.`, flags: 64 });
}

async function removeQuarantine(interaction, targetId) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: Discord.MessageFlags.Ephemeral });
  }

  const target = await resolveTarget(interaction, targetId, 'remove_quarantine');
  if (!target) {
    await safeEditReply(interaction, { content: '❌ Unable to resolve or authorise the member for isolation release.', flags: 64 });
    return true;
  }
  const snapshot = currentSnapshot(interaction, target.id);
  if (!snapshot) {
    return safeEditReply(interaction, { content: `⚠️ **${target.user.tag}** is not currently isolated.`, flags: 64 });
  }
  const mode = getQuarantineMode(snapshot);

  if (mode === QUARANTINE_MODES.SECURITY) {
    recordModerationSystemEvent({
      interaction,
      event: 'moderation.quarantine.security_remove_moved_to_admin',
      action: 'remove_quarantine',
      targetId: target.id,
      reason: 'Full Security Isolation release is only available from /admin.',
      metadata: { containmentMode: mode, caseId: snapshot.caseId || null },
    });
    return safeEditReply(interaction, {
      content: '🚨 **Full Security Isolation can only be cleared from `/admin` by the server owner.**',
      flags: 64,
    });
  }

  const result = await restoreQuarantinedMember(interaction.guild, target, {
    reason: `Investigation Isolation cleared by ${interaction.user?.tag || interaction.user?.id || 'staff'}`,
    restoredBy: interaction.user.id,
    source: 'moderation',
  });

  recordModerationSystemEvent({
    interaction,
    event: result.success ? 'moderation.quarantine.removed' : 'moderation.quarantine.remove_failed',
    action: 'remove_quarantine',
    targetId: target.id,
    after: result,
    metadata: { containmentMode: mode, caseId: snapshot.caseId || null },
  });

  if (!result.success) {
    return safeEditReply(interaction, {
      content: `❌ Failed to clear Investigation Isolation from **${target.user.tag}**: ${result.error || result.reason || 'Unknown error'}`,
      flags: 64,
    });
  }

  if (snapshot.caseId) {
    try {
      updateCaseStatus(interaction.guild.id, snapshot.caseId, 'reversed', interaction.user.id);
      recordCaseAudit({
        guildId: interaction.guild.id,
        caseId: snapshot.caseId,
        actorId: interaction.user.id,
        event: 'case.quarantine.released',
        before: { status: 'active', containmentMode: mode },
        after: { status: 'reversed', containmentMode: mode, restoredRoles: result.restoredRoles || 0 },
        metadata: { interviewArchive: result.archive || null },
      });
    } catch (error) {
      console.error(`❌ Failed to update investigation case #${snapshot.caseId}:`, error);
      recordModerationSystemEvent({
        interaction,
        event: 'moderation.quarantine.case_release_update_failed',
        action: 'remove_quarantine',
        targetId: target.id,
        reason: error.message,
        metadata: { caseId: snapshot.caseId, containmentMode: mode },
      });
    }
  }

  const archiveText = result.archive?.archived && result.archive?.channelId
    ? ` • Interview room archived: <#${result.archive.channelId}>`
    : '';
  await safeEditReply(interaction, {
    content: `🔓 **Investigation cleared** for **${target.user.tag}** • restored **${result.restoredRoles || 0}** role(s)${archiveText}.`,
    flags: 64,
  });
  await refreshDashboard(Discord, interaction, target, { view: 'actions' });
  return true;
}

async function handleQuarantineInteraction(interaction) {
  const id = String(interaction?.customId || '');
  if (!id) return false;

  if (interaction.isButton?.()) {
    if (id.startsWith('mod_open_quarantine:')) return openQuarantine(interaction, targetIdFrom(id));
    if (id.startsWith('mod_quarantine_investigation:')) return openInvestigationModal(interaction, targetIdFrom(id));
    if (id.startsWith('mod_quarantine_security:')) return securityMovedToAdmin(interaction, targetIdFrom(id), false);
    if (id.startsWith('mod_remove_quarantine:')) return removeQuarantine(interaction, targetIdFrom(id));
    if (id.startsWith('mod_invroom_note:')) return openInvestigationNoteModal(interaction, targetIdFrom(id));
    if (id.startsWith('mod_invroom_access:')) return openInvestigationAccess(interaction, targetIdFrom(id));
    if (id.startsWith('mod_invroom_access_allow:')) return changeInvestigationAccess(interaction, 'add');
    if (id.startsWith('mod_invroom_access_remove:')) return changeInvestigationAccess(interaction, 'remove');
    if (id.startsWith('mod_invroom_access_clear:')) return changeInvestigationAccess(interaction, 'clear');
    return false;
  }

  if (interaction.isChannelSelectMenu?.()) {
    if (id.startsWith('mod_invroom_access_channel:')) {
      return selectInvestigationAccessChannel(interaction);
    }
  }

  if (interaction.isModalSubmit?.()) {
    if (id.startsWith('mod_invroom_note_submit:')) return submitInvestigationRoomNote(interaction, targetIdFrom(id));
    if (id.startsWith('mod_submit_quarantine_investigation:')) {
      return submitQuarantine(interaction, targetIdFrom(id), QUARANTINE_MODES.INVESTIGATION, false);
    }
    if (id.startsWith('mod_submit_quarantine_security:')) {
      return securityMovedToAdmin(interaction, targetIdFrom(id), true);
    }
    // Legacy quarantine modal submissions are deliberately downgraded to Investigation Isolation.
    if (id.startsWith('mod_submit_quarantine:')) {
      return submitQuarantine(interaction, targetIdFrom(id), QUARANTINE_MODES.INVESTIGATION, true);
    }
  }

  return false;
}

module.exports = {
  handleQuarantineInteraction,
  ensureInitiatorInterviewAccess,
  isGuildOwner,
};
