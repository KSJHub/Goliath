'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Events,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} = require('discord.js');

const adminPanel = require('./panel');
const socialStudioPanel = require('../../../modules/socialStudio/socialAlerts/socialStudioPanel');
const { errorEmbed } = require('../../ui/embeds');
const { safeEditReply } = require('../../ui/interactionResponse');
const { enforceCommandAccess } = require('../../commands/commandAccess');
const security = require('../../security/protection/core');
const {
  QUARANTINE_MODES,
  quarantineMember,
  restoreQuarantinedMember,
  getQuarantineState,
  getQuarantineMode,
  attachQuarantineCase,
} = require('../../security/protection/quarantine');
const {
  createCase,
  updateCaseStatus,
  recordCaseAudit,
} = require('../mod/storage');

const SETTINGS_ID = 'admin:settings';
const SETTINGS_BACK_ID = 'admin:settings:back';
const SECURITY_ID = 'admin:security-isolation';
const SECURITY_BACK_ID = 'admin:security-isolation:back';
const SECURITY_SELECT_ID = 'admin:security-isolation:select';
const wiredClients = new WeakSet();

function memberDisplayName(interaction) {
  return interaction.member?.displayName || interaction.user?.displayName || interaction.user?.username || 'Unknown User';
}

function isGuildOwner(interaction) {
  return Boolean(
    interaction?.guild?.ownerId
    && interaction?.user?.id
    && String(interaction.guild.ownerId) === String(interaction.user.id)
  );
}

function canUseSettings(interaction) {
  if (!interaction?.guild || !interaction?.user?.id) return false;
  return security.isBotOwner(interaction.user.id)
    || interaction.guild.ownerId === interaction.user.id
    || adminPanel.hasGuildPermission(interaction, 'admin.dashboard.view');
}

function addAdminControls(panel, interaction) {
  if (!panel) return panel;

  const showSettings = canUseSettings(interaction);
  const showSecurity = isGuildOwner(interaction);
  if (!showSettings && !showSecurity) return panel;

  const embeds = [...(panel.embeds || [])];
  if (embeds[0]) {
    const fields = [];
    if (showSettings) {
      fields.push({
        name: '⚙️ Settings',
        value: 'General Goliath server configuration and administration defaults',
        inline: true,
      });
    }
    if (showSecurity) {
      fields.push({
        name: '🚨 Full Security Isolation',
        value: 'Owner-only containment, escalation and release controls',
        inline: true,
      });
    }
    embeds[0] = EmbedBuilder.from(embeds[0]).addFields(fields);
  }

  const components = [...(panel.components || [])];
  if (components.length < 5) {
    const controls = [];
    if (showSettings) {
      controls.push(
        new ButtonBuilder()
          .setCustomId(SETTINGS_ID)
          .setLabel('Settings')
          .setEmoji('⚙️')
          .setStyle(ButtonStyle.Secondary),
      );
    }
    if (showSecurity) {
      controls.push(
        new ButtonBuilder()
          .setCustomId(SECURITY_ID)
          .setLabel('Full Security Isolation')
          .setEmoji('🚨')
          .setStyle(ButtonStyle.Danger),
      );
    }
    if (controls.length) components.push(new ActionRowBuilder().addComponents(controls));
  }

  return { ...panel, embeds, components };
}

function buildSettingsPanel(interaction) {
  const authority = adminPanel.getAuthorityConfig(interaction.guild.id);
  const configuredLogs = Object.values(adminPanel.LOG_TYPES || {})
    .filter((entry) => adminPanel.getLogChannelId(interaction.guild.id, entry.key))
    .length;

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('⚙️ Goliath Settings')
    .setDescription('General server-level Goliath configuration lives here. This gives the Admin Hub a dedicated settings home without mixing configuration into operational controls.')
    .addFields(
      { name: 'Server', value: `${interaction.guild.name}\n\`${interaction.guild.id}\``, inline: true },
      { name: 'Authority', value: authority.configured ? 'Configured ✅' : 'Legacy fallback ⚠️', inline: true },
      { name: 'Log Channels', value: `${configuredLogs}/5 configured`, inline: true },
    )
    .setFooter({ text: `Requested by ${memberDisplayName(interaction)}` })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(SETTINGS_BACK_ID)
          .setLabel('Back to Administration')
          .setEmoji('⬅️')
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function buildSecurityIsolationPanel(interaction) {
  const state = getQuarantineState(interaction.guild.id);
  const securityEntries = Object.values(state.users || {})
    .filter((entry) => getQuarantineMode(entry) === QUARANTINE_MODES.SECURITY);
  const investigations = Object.values(state.users || {})
    .filter((entry) => getQuarantineMode(entry) === QUARANTINE_MODES.INVESTIGATION);

  const embed = new EmbedBuilder()
    .setColor(0xED4245)
    .setTitle('🚨 Full Security Isolation')
    .setDescription([
      '**Server-owner only emergency containment.**',
      '',
      'Select a member to apply Full Security Isolation. If they are already under Investigation, the existing containment is escalated without losing the original role snapshot or linked case.',
      '',
      'Selecting a member already in Full Security Isolation opens the owner-only release control.',
      '',
      'Anti-Nuke can still apply Full Security Isolation automatically when required.',
    ].join('\n'))
    .addFields(
      { name: 'Full Security', value: `**${securityEntries.length}** active`, inline: true },
      { name: 'Investigations', value: `**${investigations.length}** active`, inline: true },
    )
    .setFooter({ text: `Owner control • Requested by ${memberDisplayName(interaction)}` })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId(SECURITY_SELECT_ID)
          .setPlaceholder('Select member for security isolation')
          .setMinValues(1)
          .setMaxValues(1),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(SECURITY_BACK_ID)
          .setLabel('Back to Administration')
          .setEmoji('⬅️')
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function buildSecurityIsolationModal(target, escalating = false) {
  return new ModalBuilder()
    .setCustomId(`admin:security-isolation:submit:${target.id}`)
    .setTitle(escalating ? 'Escalate to Full Security' : 'Full Security Isolation')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('reason')
          .setLabel(escalating ? 'Reason for security escalation' : 'Security isolation reason')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMinLength(2)
          .setMaxLength(500)
          .setPlaceholder('Why does this member require full Security Isolation?'),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('confirmation')
          .setLabel('Type FULL ISOLATION to confirm')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(14)
          .setMaxLength(14)
          .setPlaceholder('FULL ISOLATION'),
      ),
    );
}

function buildSecurityReleasePanel(interaction, target, snapshot) {
  const embed = new EmbedBuilder()
    .setColor(0xED4245)
    .setTitle(`🚨 Security Isolation • ${target.user.tag}`)
    .setDescription([
      `${target} is already in **Full Security Isolation**.`,
      '',
      `**Reason:** ${String(snapshot.reason || 'No reason recorded').slice(0, 1000)}`,
      snapshot.caseId ? `**Case:** #${snapshot.caseId}` : '**Case:** No linked case',
      '',
      'Only the server owner can release this member from security containment.',
    ].join('\n'))
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`admin:security-isolation:release:${target.id}`)
          .setLabel('Clear Full Security Isolation')
          .setEmoji('🔓')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(SECURITY_ID)
          .setLabel('Back')
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function buildSecurityReleaseModal(target) {
  return new ModalBuilder()
    .setCustomId(`admin:security-isolation:release-submit:${target.id}`)
    .setTitle('Clear Full Security Isolation')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('Release reason')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMinLength(2)
          .setMaxLength(500)
          .setPlaceholder('Why is Full Security Isolation being cleared?'),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('confirmation')
          .setLabel('Type RELEASE SECURITY to confirm')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(16)
          .setMaxLength(16)
          .setPlaceholder('RELEASE SECURITY'),
      ),
    );
}

function fieldValue(interaction, key) {
  try {
    return String(interaction.fields?.getTextInputValue?.(key) || '').trim();
  } catch {
    return '';
  }
}

function rootAdminPanel(interaction) {
  const isGoliathOwner = security.isBotOwner(interaction.user?.id);
  const panel = adminPanel.buildAdminPanel(
    interaction.guild,
    memberDisplayName(interaction),
    interaction,
  );
  return addAdminControls(panel, interaction);
}

async function denyOwnerSecurity(interaction) {
  const payload = { content: '❌ Full Security Isolation is restricted to the Discord server owner.', flags: 64 };
  if (interaction.replied || interaction.deferred) await interaction.editReply(payload).catch(() => null);
  else await interaction.reply(payload).catch(() => null);
  return true;
}

async function fetchSecurityTarget(interaction, targetId) {
  if (!targetId) return null;
  return interaction.guild.members.cache.get(String(targetId))
    || interaction.guild.members.fetch(String(targetId)).catch(() => null);
}

async function handleSettingsInteraction(interaction) {
  const id = String(interaction?.customId || '');
  if (id !== SETTINGS_ID && id !== SETTINGS_BACK_ID) return false;

  if (!canUseSettings(interaction)) {
    await interaction.reply({ content: '❌ You do not have permission to open Goliath Settings.', flags: 64 }).catch(() => null);
    return true;
  }

  if (id === SETTINGS_ID) {
    await interaction.update(buildSettingsPanel(interaction));
    return true;
  }

  await interaction.update(rootAdminPanel(interaction));
  return true;
}

async function handleSecurityIsolationInteraction(interaction) {
  const id = String(interaction?.customId || '');
  if (!id.startsWith('admin:security-isolation')) return false;
  if (!isGuildOwner(interaction)) return denyOwnerSecurity(interaction);

  if (interaction.isButton?.()) {
    if (id === SECURITY_ID) {
      await interaction.update(buildSecurityIsolationPanel(interaction));
      return true;
    }
    if (id === SECURITY_BACK_ID) {
      await interaction.update(rootAdminPanel(interaction));
      return true;
    }
    if (id.startsWith('admin:security-isolation:release:')) {
      const targetId = id.split(':').pop();
      const target = await fetchSecurityTarget(interaction, targetId);
      if (!target) {
        await interaction.reply({ content: '❌ Could not find that member.', flags: 64 });
        return true;
      }
      const snapshot = getQuarantineState(interaction.guild.id).users?.[target.id];
      if (!snapshot || getQuarantineMode(snapshot) !== QUARANTINE_MODES.SECURITY) {
        await interaction.reply({ content: '⚠️ That member is not currently in Full Security Isolation.', flags: 64 });
        return true;
      }
      await interaction.showModal(buildSecurityReleaseModal(target));
      return true;
    }
  }

  if (interaction.isUserSelectMenu?.() && id === SECURITY_SELECT_ID) {
    const target = await fetchSecurityTarget(interaction, interaction.values?.[0]);
    if (!target) {
      await interaction.reply({ content: '❌ Could not find that member.', flags: 64 });
      return true;
    }
    if (target.id === interaction.guild.ownerId) {
      await interaction.reply({ content: '❌ The server owner cannot be placed in security containment.', flags: 64 });
      return true;
    }
    const snapshot = getQuarantineState(interaction.guild.id).users?.[target.id] || null;
    if (snapshot && getQuarantineMode(snapshot) === QUARANTINE_MODES.SECURITY) {
      await interaction.update(buildSecurityReleasePanel(interaction, target, snapshot));
      return true;
    }
    await interaction.showModal(buildSecurityIsolationModal(
      target,
      Boolean(snapshot && getQuarantineMode(snapshot) === QUARANTINE_MODES.INVESTIGATION),
    ));
    return true;
  }

  if (interaction.isModalSubmit?.() && id.startsWith('admin:security-isolation:submit:')) {
    const targetId = id.split(':').pop();
    const target = await fetchSecurityTarget(interaction, targetId);
    if (!target) {
      await interaction.reply({ content: '❌ Could not find that member.', flags: 64 });
      return true;
    }
    if (target.id === interaction.guild.ownerId) {
      await interaction.reply({ content: '❌ The server owner cannot be placed in security containment.', flags: 64 });
      return true;
    }
    if (fieldValue(interaction, 'confirmation') !== 'FULL ISOLATION') {
      await interaction.reply({ content: '❌ Confirmation did not match `FULL ISOLATION`. No security isolation was applied.', flags: 64 });
      return true;
    }
    const reason = fieldValue(interaction, 'reason');
    const before = getQuarantineState(interaction.guild.id).users?.[target.id] || null;
    const beforeMode = before ? getQuarantineMode(before) : null;
    if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: 64 });
    const result = await quarantineMember(interaction.guild, target, {
      reason,
      quarantinedBy: interaction.user.id,
      source: 'admin',
      mode: QUARANTINE_MODES.SECURITY,
    });
    if (!result?.success) {
      await interaction.editReply({ content: `❌ Full Security Isolation failed: ${result?.error || result?.reason || 'Unknown error'}` });
      return true;
    }

    let caseId = before?.caseId || null;
    try {
      if (result.escalated && caseId) {
        recordCaseAudit({
          guildId: interaction.guild.id,
          caseId,
          actorId: interaction.user.id,
          event: 'case.quarantine.security_escalated',
          before: { containmentMode: beforeMode },
          after: { containmentMode: QUARANTINE_MODES.SECURITY },
          metadata: { source: 'admin', reason },
        });
      } else if (!caseId && !result.dryRun) {
        const created = createCase({
          guildId: interaction.guild.id,
          userId: target.id,
          moderatorId: interaction.user.id,
          action: 'quarantine',
          reason,
          metadata: {
            containmentMode: QUARANTINE_MODES.SECURITY,
            source: 'admin',
            securityEscalation: Boolean(result.escalated),
          },
          status: 'active',
          actorId: interaction.user.id,
        });
        caseId = created?.caseId || null;
        if (caseId) attachQuarantineCase(interaction.guild, target.id, caseId);
      }
    } catch (error) {
      console.error('❌ Failed to record admin security isolation case:', error);
    }

    await interaction.editReply({
      content: result.dryRun
        ? `🧪 Security isolation dry-run completed for **${target.user.tag}**.`
        : `${result.escalated ? '🚨 **Investigation escalated to Full Security Isolation**' : '🚨 **Full Security Isolation applied**'} for **${target.user.tag}**${caseId ? ` • Case **#${caseId}**` : ''}.`,
    });
    return true;
  }

  if (interaction.isModalSubmit?.() && id.startsWith('admin:security-isolation:release-submit:')) {
    const targetId = id.split(':').pop();
    const target = await fetchSecurityTarget(interaction, targetId);
    if (!target) {
      await interaction.reply({ content: '❌ Could not find that member.', flags: 64 });
      return true;
    }
    if (fieldValue(interaction, 'confirmation') !== 'RELEASE SECURITY') {
      await interaction.reply({ content: '❌ Confirmation did not match `RELEASE SECURITY`. No containment was cleared.', flags: 64 });
      return true;
    }
    const reason = fieldValue(interaction, 'reason');
    const snapshot = getQuarantineState(interaction.guild.id).users?.[target.id] || null;
    if (!snapshot || getQuarantineMode(snapshot) !== QUARANTINE_MODES.SECURITY) {
      await interaction.reply({ content: '⚠️ That member is not currently in Full Security Isolation.', flags: 64 });
      return true;
    }
    if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: 64 });
    const result = await restoreQuarantinedMember(interaction.guild, target, {
      reason: `Full Security Isolation cleared by ${interaction.user.tag}: ${reason}`,
      restoredBy: interaction.user.id,
      source: 'admin',
    });
    if (!result?.success) {
      await interaction.editReply({ content: `❌ Failed to clear Full Security Isolation: ${result?.error || result?.reason || 'Unknown error'}` });
      return true;
    }
    if (snapshot.caseId) {
      try {
        updateCaseStatus(interaction.guild.id, snapshot.caseId, 'reversed', interaction.user.id);
        recordCaseAudit({
          guildId: interaction.guild.id,
          caseId: snapshot.caseId,
          actorId: interaction.user.id,
          event: 'case.quarantine.security_released',
          before: { status: 'active', containmentMode: QUARANTINE_MODES.SECURITY },
          after: { status: 'reversed', restoredRoles: result.restoredRoles || 0 },
          metadata: { source: 'admin', reason },
        });
      } catch (error) {
        console.error(`❌ Failed to update security isolation case #${snapshot.caseId}:`, error);
      }
    }
    await interaction.editReply({
      content: `🔓 **Full Security Isolation cleared** for **${target.user.tag}** • restored **${result.restoredRoles || 0}** role(s).`,
    });
    return true;
  }

  return false;
}

function wireClient(client) {
  if (!client || wiredClients.has(client)) return false;
  wiredClients.add(client);
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (await handleSecurityIsolationInteraction(interaction)) return;
      await handleSettingsInteraction(interaction);
    } catch (error) {
      console.error('❌ Admin command interaction failed:', error?.stack || error?.message || error);
      if (interaction?.deferred || interaction?.replied) {
        await interaction?.editReply?.({ content: '❌ Failed to process the admin control.' }).catch(() => null);
      } else {
        await interaction?.reply?.({ content: '❌ Failed to process the admin control.', flags: 64 }).catch(() => null);
      }
    }
  });
  return true;
}

const command = {
  category: 'Admin',

  help: {
    name: 'admin',
    description: 'Open admin controls and server tools.',
    usage: '/admin',
  },

  access: {
    level: 'admin',
    ownerOnly: false,
  },

  data: new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Open Goliath admin controls and server tools')
    .setDMPermission(false),

  wireClient,

  async execute(interaction) {
    try {
      if (!interaction.guild) {
        return safeEditReply(interaction, {
          embeds: [errorEmbed('This command can only be used inside a server.')],
        });
      }

      const displayName = memberDisplayName(interaction);

      const isGoliathOwner = security.isBotOwner(interaction.user?.id);
      const isLegacyAdmin = security.hasPermission(interaction, 'admin');
      const hasConfiguredAdminAccess =
        adminPanel.hasGuildPermission(interaction, 'admin.dashboard.view');
      const canManageAuthority = adminPanel.canManageGuildAuthority(interaction);
      const canManageSocial =
        typeof socialStudioPanel.canManageSocialStudio === 'function' &&
        socialStudioPanel.canManageSocialStudio(interaction);

      if (!isLegacyAdmin && !hasConfiguredAdminAccess && !canManageAuthority && canManageSocial) {
        return safeEditReply(
          interaction,
          socialStudioPanel.buildSocialAdminPanel(interaction.guild, displayName),
        );
      }

      if (!isLegacyAdmin && !hasConfiguredAdminAccess && !canManageAuthority) {
        const denied = await enforceCommandAccess(interaction, command);
        if (denied) return;
      }

      const panel = adminPanel.buildAdminPanel(
        interaction.guild,
        displayName,
        interaction,
      );

      return safeEditReply(interaction, addAdminControls(panel, interaction));
    } catch (error) {
      if (error?.code === 10062 || error?.code === 40060) return;
      console.error('❌ Admin command failed:', error);
      return safeEditReply(interaction, {
        embeds: [errorEmbed('Failed to open the admin panel. Please try again.')],
        components: [],
      });
    }
  },
};

module.exports = command;
