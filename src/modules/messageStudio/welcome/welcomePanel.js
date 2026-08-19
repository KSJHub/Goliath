'use strict';

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  ChannelType,
  AttachmentBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const guildManager = require('../../../core/guild/guildManager');
const welcome = require('./welcome');
const scheduledWelcome = require('./scheduledWelcome');
const scheduledWelcomeHealth = require('./scheduledWelcomeHealth');
const embedTemplateManager = require('../embed/embedTemplates');

const selections = new Map();

function row(...components) {
  return new ActionRowBuilder().addComponents(...components.filter(Boolean));
}

function button(customId, label, style = ButtonStyle.Secondary, disabled = false) {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style).setDisabled(Boolean(disabled));
}

function displayName(interaction) {
  return interaction.member?.displayName || interaction.user?.username || 'Unknown User';
}

function selectionKey(interactionOrGuild, userId = 'panel') {
  const guildId = interactionOrGuild?.guild?.id || interactionOrGuild?.id;
  const resolvedUserId = interactionOrGuild?.user?.id || userId;
  return `${guildId}:${resolvedUserId}`;
}

function templateTypeLabel(template = {}) {
  const type = String(template.templateType || template.module || 'global');
  return type === 'global' ? 'General' : type.replace(/([a-z])([A-Z])/g, '$1 $2');
}

function getTemplateOptions(guildId) {
  return Object.values(embedTemplateManager.listTemplates(guildId))
    .filter(Boolean)
    .sort((a, b) => {
      const aWelcome = a.templateType === 'welcome' || a.module === 'welcome' ? 0 : 1;
      const bWelcome = b.templateType === 'welcome' || b.module === 'welcome' ? 0 : 1;
      return aWelcome - bWelcome || String(a.name || a.templateId).localeCompare(String(b.name || b.templateId));
    })
    .slice(0, 25)
    .map((template) => ({
      label: String(template.name || template.templateId).slice(0, 100),
      description: `${templateTypeLabel(template)} · ${template.embed?.title || template.panels?.[0]?.title || 'Embed Studio template'}`.slice(0, 100),
      value: String(template.templateId),
    }));
}

function templateMenu(guild, activeTemplateId, userId) {
  const options = getTemplateOptions(guild.id);
  const selected = selections.get(`${guild.id}:${userId}`) || activeTemplateId || null;
  const menu = new StringSelectMenuBuilder()
    .setCustomId('admin:welcome:template')
    .setPlaceholder(options.length ? 'Choose an Embed Studio template' : 'No templates available')
    .setMinValues(1)
    .setMaxValues(1)
    .setDisabled(options.length === 0);
  if (options.length) menu.addOptions(options.map((option) => ({ ...option, default: option.value === selected })));
  else menu.addOptions({ label: 'No templates found', value: 'none' });
  return menu;
}

async function buildWelcomePanel(guild, memberDisplayName = 'Unknown User') {
  const moduleEnabled = guildManager.isModuleEnabled(guild.id, 'welcome');
  const instant = welcome.getWelcomeSection(guild.id);
  const scheduled = scheduledWelcome.getScheduledConfig(guild.id);
  const instantHealth = await welcome.buildHealthReport(guild);
  const scheduledHealth = await scheduledWelcomeHealth.buildHealth(guild);
  const instantConfigured = Boolean(instant.channelId || instant.dmEnabled);

  return {
    embeds: [new EmbedBuilder()
      .setColor(!moduleEnabled ? 0xed4245 : (instantHealth.healthy && scheduledHealth.healthy) ? 0x57f287 : 0xfaa61a)
      .setTitle('👋 Welcome')
      .setDescription([
        'One Welcome module with two delivery modes.',
        '',
        `**Overall module:** ${moduleEnabled ? 'Enabled ✅' : 'Disabled ❌'}`,
        '',
        '**⚡ Instant Welcome**',
        `Status: ${instantConfigured ? 'Configured ✅' : 'Not configured'}`,
        `Channel: ${instant.channelId ? `<#${instant.channelId}>` : '`Not set`'} · DM: ${instant.dmEnabled ? 'On' : 'Off'}`,
        `Sent: \`${instant.analytics?.publicSent || 0}\` public · \`${instant.analytics?.dmSent || 0}\` DM`,
        '',
        '**📅 Scheduled Welcome**',
        `Status: ${scheduled.enabled ? 'Enabled ✅' : 'Disabled'}`,
        `Queue: ${scheduled.queueRoleId ? `<@&${scheduled.queueRoleId}>` : '`Not set`'} · Waiting: \`${scheduledHealth.waitingMembers || 0}\``,
        `Delivery: ${scheduled.time} · ${scheduled.timezone}`,
        `Welcomed: \`${scheduled.analytics?.membersWelcomed || 0}\``,
        '',
        `**Health:** Instant ${instantHealth.healthy ? '✅' : '⚠️'} · Scheduled ${scheduledHealth.healthy ? '✅' : '⚠️'}`,
      ].join('\n'))
      .setFooter({ text: `Requested by ${memberDisplayName}` })
      .setTimestamp()],
    components: [
      row(
        button('admin:welcome:instant', '⚡ Instant Welcome', ButtonStyle.Primary),
        button('admin:welcome:scheduled', '📅 Scheduled Welcome', ButtonStyle.Primary),
        button('admin:welcome:mentions', '🔔 Mentions', ButtonStyle.Secondary)
      ),
      row(
        button(moduleEnabled ? 'admin:welcome:disable' : 'admin:welcome:enable', moduleEnabled ? '⏸ Disable Welcome' : '▶ Enable Welcome', moduleEnabled ? ButtonStyle.Secondary : ButtonStyle.Success),
        button('admin:welcome:repairAll', '🩺 Repair All'),
        button('admin:welcome:export', '📤 Export'),
        button('admin:welcome:reset', '♻ Reset', ButtonStyle.Danger)
      ),
      row(button('admin:modules', '⬅ Modules')),
    ],
  };
}

async function buildInstantPanel(guild, memberDisplayName = 'Unknown User', userId = 'panel') {
  const config = welcome.getWelcomeSection(guild.id);
  const moduleEnabled = guildManager.isModuleEnabled(guild.id, 'welcome');
  const health = await welcome.buildHealthReport(guild);
  const publicBinding = welcome.getWelcomeBinding(guild.id, 'welcome');
  const dmBinding = welcome.getWelcomeBinding(guild.id, 'dm_welcome');
  const publicTemplate = welcome.getAssignedTemplate(guild.id, 'welcome', config);
  const dmTemplate = welcome.getAssignedTemplate(guild.id, 'dmWelcome', config);
  const activeTemplateId = publicTemplate?.templateId || config.templateId;
  const stagedTemplateId = selections.get(`${guild.id}:${userId}`);
  const stagedTemplate = stagedTemplateId ? embedTemplateManager.getTemplate(guild.id, stagedTemplateId) : null;

  return {
    embeds: [new EmbedBuilder()
      .setColor(!moduleEnabled ? 0xed4245 : health.healthy ? 0x57f287 : 0xfaa61a)
      .setTitle('⚡ Welcome · Instant')
      .setDescription([
        'Welcomes a member immediately from the Discord member-join event.',
        '',
        `**Channel:** ${config.channelId ? `<#${config.channelId}>` : '`Not set`'}`,
        `**DM:** ${config.dmEnabled ? 'Enabled ✅' : 'Disabled'}`,
        `**Member ping:** ${config.allowUserPing ? 'Enabled ✅' : 'Display only'}`,
        `**Role notifications:** ${config.allowRolePings ? 'Enabled ✅' : 'Disabled'}`,
        `**Bots:** ${config.ignoreBots ? 'Excluded' : 'Included'}`,
        '',
        `**Public template:** ${publicTemplate ? `\`${publicTemplate.name || publicTemplate.templateId}\`` : '`Not set`'} ${publicBinding ? '✅' : ''}`,
        `**DM template:** ${dmTemplate ? `\`${dmTemplate.name || dmTemplate.templateId}\`` : '`Not set`'} ${dmBinding || config.dmTemplateId ? '✅' : '(uses public)'}`,
        stagedTemplate ? `**Selected:** \`${stagedTemplate.name || stagedTemplate.templateId}\`` : null,
        '',
        `Public: \`${config.analytics?.publicSent || 0}\` · DMs: \`${config.analytics?.dmSent || 0}\` · Failed: \`${(config.analytics?.publicFailed || 0) + (config.analytics?.dmFailed || 0)}\``,
        health.warnings?.length ? `\n**Warnings**\n${health.warnings.map((warning) => `• ${warning}`).join('\n')}` : '\n**Health:** Healthy ✅',
      ].filter(Boolean).join('\n').slice(0, 4096))
      .setFooter({ text: `Requested by ${memberDisplayName}` })
      .setTimestamp()],
    components: [
      row(new ChannelSelectMenuBuilder()
        .setCustomId('admin:welcome:channel')
        .setPlaceholder('Select instant welcome channel')
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(0).setMaxValues(1)),
      row(templateMenu(guild, activeTemplateId, userId)),
      row(
        button('admin:welcome:toggleDm', config.dmEnabled ? '📨 DM On' : '📨 DM Off', config.dmEnabled ? ButtonStyle.Success : ButtonStyle.Secondary),
        button('admin:welcome:mentions', '🔔 Mentions', (config.allowUserPing || config.allowRolePings) ? ButtonStyle.Success : ButtonStyle.Secondary),
        button('admin:welcome:toggleBots', config.ignoreBots ? '🤖 Bots Off' : '🤖 Bots On', config.ignoreBots ? ButtonStyle.Secondary : ButtonStyle.Success)
      ),
      row(
        button('admin:welcome:assign', '✅ Set Public', ButtonStyle.Primary),
        button('admin:welcome:assignDm', '💬 Set DM', ButtonStyle.Primary),
        button('admin:welcome:test', '🧪 Preview', ButtonStyle.Success),
        button('admin:welcome:send', '📨 Send Test', ButtonStyle.Success),
        button('admin:welcome:repairInstant', '🩺 Repair')
      ),
      row(
        button('admin:welcome:dmPublic', '↩ DM = Public'),
        button('admin:welcome', '⬅ Welcome Home')
      ),
    ],
  };
}

function buildMentionSettingsPanel(guild, memberDisplayName = 'Unknown User') {
  const config = welcome.getWelcomeSection(guild.id);
  const selectedRoles = config.mentionRoleIds.length ? config.mentionRoleIds.map((roleId) => `<@&${roleId}>`).join(', ') : '`None`';
  return {
    embeds: [new EmbedBuilder()
      .setColor(config.allowRolePings ? 0x57f287 : 0x5865f2)
      .setTitle('🔔 Welcome · Instant Mentions')
      .setDescription([
        `**New member ping:** ${config.allowUserPing ? 'Enabled ✅' : 'Disabled'}`,
        `**Role pings:** ${config.allowRolePings ? 'Enabled ✅' : 'Disabled'}`,
        `**Selected roles:** ${selectedRoles}`,
        '',
        'Only explicitly selected users/roles can create real Discord pings.',
      ].join('\n'))
      .setFooter({ text: `Requested by ${memberDisplayName}` })
      .setTimestamp()],
    components: [
      row(new RoleSelectMenuBuilder()
        .setCustomId('admin:welcome:roles')
        .setPlaceholder('Choose roles to notify in instant welcomes')
        .setMinValues(0).setMaxValues(10)),
      row(
        button('admin:welcome:togglePing', config.allowUserPing ? '🔔 Member Ping On' : '🔕 Member Ping Off', config.allowUserPing ? ButtonStyle.Success : ButtonStyle.Secondary),
        button('admin:welcome:toggleRolePings', config.allowRolePings ? '📣 Role Pings On' : '📣 Role Pings Off', config.allowRolePings ? ButtonStyle.Success : ButtonStyle.Secondary),
        button('admin:welcome:instant', '⬅ Instant Welcome')
      ),
    ],
  };
}

async function buildScheduledPanel(guild, memberDisplayName = 'Unknown User') {
  const config = scheduledWelcome.getScheduledConfig(guild.id);
  const health = await scheduledWelcomeHealth.buildHealth(guild);
  const analytics = config.analytics || {};
  const lastRun = analytics.lastRunAt ? `<t:${Math.floor(new Date(analytics.lastRunAt).getTime() / 1000)}:R>` : 'Never';
  return {
    embeds: [new EmbedBuilder()
      .setColor(!config.enabled ? 0x747f8d : health.healthy ? 0x57f287 : 0xfaa61a)
      .setTitle('📅 Welcome · Scheduled')
      .setDescription([
        'At the configured local time, Goliath welcomes everyone currently holding the queue role, then removes that role after successful delivery.',
        '',
        `**Status:** ${config.enabled ? 'Enabled ✅' : 'Disabled'}`,
        `**Queue role:** ${config.queueRoleId ? `<@&${config.queueRoleId}>` : '`Not set`'}`,
        `**Channel:** ${config.channelId ? `<#${config.channelId}>` : '`Not set`'}`,
        `**Time:** \`${config.time}\``,
        `**Timezone:** \`${config.timezone}\``,
        `**Waiting now:** \`${health.waitingMembers || 0}\``,
        `**Ping members:** ${config.pingMembers ? 'Yes' : 'No'}`,
        `**Remove queue role:** ${config.removeQueueRole ? 'Yes ✅' : 'No'}`,
        `**Bots:** ${config.ignoreBots ? 'Excluded' : 'Included'}`,
        '',
        `**Message:**\n${String(config.message || '').slice(0, 700) || '`Not set`'}`,
        '',
        `Runs: \`${analytics.runs || 0}\` · Welcomed: \`${analytics.membersWelcomed || 0}\` · Failed sends: \`${analytics.sendFailed || 0}\``,
        `Last run: ${lastRun}`,
        health.issues.length ? `\n**Issues**\n${health.issues.map((issue) => `• ${issue}`).join('\n')}` : '',
        health.warnings.length ? `\n**Warnings**\n${health.warnings.map((warning) => `• ${warning}`).join('\n')}` : '',
      ].filter(Boolean).join('\n').slice(0, 4096))
      .setFooter({ text: `Requested by ${memberDisplayName}` })
      .setTimestamp()],
    components: [
      row(new RoleSelectMenuBuilder()
        .setCustomId('admin:welcome:scheduled:role')
        .setPlaceholder('Select the Welcome Queue role')
        .setMinValues(0).setMaxValues(1)),
      row(new ChannelSelectMenuBuilder()
        .setCustomId('admin:welcome:scheduled:channel')
        .setPlaceholder('Select scheduled welcome channel')
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(0).setMaxValues(1)),
      row(
        button('admin:welcome:scheduled:configure', '⚙️ Time & Message', ButtonStyle.Primary),
        button(config.enabled ? 'admin:welcome:scheduled:disable' : 'admin:welcome:scheduled:enable', config.enabled ? '⏸ Disable' : '▶ Enable', config.enabled ? ButtonStyle.Secondary : ButtonStyle.Success),
        button('admin:welcome:scheduled:previewQueue', '👥 Preview Queue'),
        button('admin:welcome:scheduled:runNow', '▶ Run Now', ButtonStyle.Success)
      ),
      row(
        button('admin:welcome:scheduled:togglePing', config.pingMembers ? '🔔 Pings On' : '🔕 Pings Off', config.pingMembers ? ButtonStyle.Success : ButtonStyle.Secondary),
        button('admin:welcome:scheduled:toggleRemove', config.removeQueueRole ? '🧹 Remove Role On' : '🧹 Remove Role Off', config.removeQueueRole ? ButtonStyle.Success : ButtonStyle.Secondary),
        button('admin:welcome:scheduled:toggleBots', config.ignoreBots ? '🤖 Bots Off' : '🤖 Bots On', config.ignoreBots ? ButtonStyle.Secondary : ButtonStyle.Success),
        button('admin:welcome:scheduled:repair', '🩺 Repair')
      ),
      row(button('admin:welcome', '⬅ Welcome Home')),
    ],
  };
}

function buildScheduledModal(config) {
  return new ModalBuilder()
    .setCustomId('admin:welcome:scheduled:configureSubmit')
    .setTitle('Scheduled Welcome')
    .addComponents(
      row(new TextInputBuilder().setCustomId('time').setLabel('Daily time (24-hour HH:MM)').setStyle(TextInputStyle.Short).setRequired(true).setValue(config.time || '19:00').setMaxLength(5)),
      row(new TextInputBuilder().setCustomId('timezone').setLabel('Timezone').setStyle(TextInputStyle.Short).setRequired(true).setValue(config.timezone || 'Europe/London').setMaxLength(80)),
      row(new TextInputBuilder().setCustomId('message').setLabel('Welcome message').setStyle(TextInputStyle.Paragraph).setRequired(true).setValue(String(config.message || '').slice(0, 1800)).setMaxLength(1800))
    );
}

async function updatePanel(interaction, payload = null) {
  const next = payload || await buildWelcomePanel(interaction.guild, displayName(interaction));
  if (interaction.deferred || interaction.replied) return interaction.editReply(next);
  return interaction.update(next);
}

function selectedTemplate(interaction) {
  const templateId = selections.get(selectionKey(interaction));
  if (!templateId || !embedTemplateManager.getTemplate(interaction.guild.id, templateId)) throw new Error('Choose a template from the dropdown first.');
  return templateId;
}

async function handleWelcomeInteraction(interaction) {
  const customId = String(interaction.customId || '');
  if (!customId.startsWith('admin:welcome')) return false;
  try {
    if (customId === 'admin:welcome') return updatePanel(interaction);
    if (customId === 'admin:welcome:instant') return updatePanel(interaction, await buildInstantPanel(interaction.guild, displayName(interaction), interaction.user.id));
    if (customId === 'admin:welcome:mentions') return updatePanel(interaction, buildMentionSettingsPanel(interaction.guild, displayName(interaction)));
    if (customId === 'admin:welcome:scheduled') return updatePanel(interaction, await buildScheduledPanel(interaction.guild, displayName(interaction)));

    if (interaction.isChannelSelectMenu?.() && customId === 'admin:welcome:channel') {
      welcome.updateConfig(interaction.guild.id, { channelId: interaction.values?.[0] || null }, { actorId: interaction.user.id });
      return updatePanel(interaction, await buildInstantPanel(interaction.guild, displayName(interaction), interaction.user.id));
    }
    if (interaction.isRoleSelectMenu?.() && customId === 'admin:welcome:roles') {
      welcome.updateConfig(interaction.guild.id, { mentionRoleIds: (interaction.values || []).filter((roleId) => roleId !== interaction.guild.id) }, { actorId: interaction.user.id });
      return updatePanel(interaction, buildMentionSettingsPanel(interaction.guild, displayName(interaction)));
    }
    if (interaction.isStringSelectMenu?.() && customId === 'admin:welcome:template') {
      const templateId = interaction.values?.[0];
      if (!templateId || templateId === 'none' || !embedTemplateManager.getTemplate(interaction.guild.id, templateId)) throw new Error('Choose a valid Embed Studio template.');
      selections.set(selectionKey(interaction), templateId);
      return updatePanel(interaction, await buildInstantPanel(interaction.guild, displayName(interaction), interaction.user.id));
    }

    if (interaction.isRoleSelectMenu?.() && customId === 'admin:welcome:scheduled:role') {
      scheduledWelcome.updateScheduledConfig(interaction.guild.id, { queueRoleId: interaction.values?.[0] || null, completedMemberIds: [] }, { actorId: interaction.user.id });
      return updatePanel(interaction, await buildScheduledPanel(interaction.guild, displayName(interaction)));
    }
    if (interaction.isChannelSelectMenu?.() && customId === 'admin:welcome:scheduled:channel') {
      scheduledWelcome.updateScheduledConfig(interaction.guild.id, { channelId: interaction.values?.[0] || null }, { actorId: interaction.user.id });
      return updatePanel(interaction, await buildScheduledPanel(interaction.guild, displayName(interaction)));
    }

    if (customId === 'admin:welcome:scheduled:configure') return interaction.showModal(buildScheduledModal(scheduledWelcome.getScheduledConfig(interaction.guild.id)));
    if (interaction.isModalSubmit?.() && customId === 'admin:welcome:scheduled:configureSubmit') {
      scheduledWelcome.updateScheduledConfig(interaction.guild.id, {
        time: interaction.fields.getTextInputValue('time'),
        timezone: interaction.fields.getTextInputValue('timezone'),
        message: interaction.fields.getTextInputValue('message'),
      }, { actorId: interaction.user.id });
      return updatePanel(interaction, await buildScheduledPanel(interaction.guild, displayName(interaction)));
    }

    if (customId === 'admin:welcome:scheduled:enable') {
      const config = scheduledWelcome.getScheduledConfig(interaction.guild.id);
      if (!config.queueRoleId || !config.channelId) throw new Error('Choose a queue role and channel before enabling Scheduled Welcome.');
      scheduledWelcome.updateScheduledConfig(interaction.guild.id, { enabled: true }, { actorId: interaction.user.id });
      return updatePanel(interaction, await buildScheduledPanel(interaction.guild, displayName(interaction)));
    }
    if (customId === 'admin:welcome:scheduled:disable') {
      scheduledWelcome.updateScheduledConfig(interaction.guild.id, { enabled: false }, { actorId: interaction.user.id });
      return updatePanel(interaction, await buildScheduledPanel(interaction.guild, displayName(interaction)));
    }
    if (customId === 'admin:welcome:scheduled:togglePing' || customId === 'admin:welcome:scheduled:toggleRemove' || customId === 'admin:welcome:scheduled:toggleBots') {
      const config = scheduledWelcome.getScheduledConfig(interaction.guild.id);
      const patch = customId.endsWith('togglePing') ? { pingMembers: !config.pingMembers }
        : customId.endsWith('toggleRemove') ? { removeQueueRole: !config.removeQueueRole }
          : { ignoreBots: !config.ignoreBots };
      scheduledWelcome.updateScheduledConfig(interaction.guild.id, patch, { actorId: interaction.user.id });
      return updatePanel(interaction, await buildScheduledPanel(interaction.guild, displayName(interaction)));
    }
    if (customId === 'admin:welcome:scheduled:previewQueue') {
      const members = await scheduledWelcome.getWaitingMembers(interaction.guild);
      const text = members.length ? members.slice(0, 50).map((member) => `• @${member.displayName || member.user?.username || member.id}`).join('\n') : 'No members are currently waiting.';
      return interaction.reply({ content: `**Scheduled Welcome Queue (${members.length})**\n${text}`.slice(0, 2000), ephemeral: true, allowedMentions: { parse: [] } });
    }
    if (customId === 'admin:welcome:scheduled:runNow') {
      await interaction.deferUpdate();
      const result = await scheduledWelcome.runScheduledWelcome(interaction.guild, { force: true, actorId: interaction.user.id });
      await interaction.editReply(await buildScheduledPanel(interaction.guild, displayName(interaction)));
      await interaction.followUp({ content: result.empty ? '✅ Queue is empty; nothing was posted.' : `✅ Scheduled Welcome run complete. Welcomed ${result.welcomed || 0} member(s) in ${result.messagesSent || 0} message(s).${result.roleRemovalFailed ? ` ${result.roleRemovalFailed} role cleanup failure(s) need Repair.` : ''}`, ephemeral: true });
      return true;
    }
    if (customId === 'admin:welcome:scheduled:repair') {
      await interaction.deferUpdate();
      await scheduledWelcomeHealth.repair(interaction.guild, { actorId: interaction.user.id });
      return updatePanel(interaction, await buildScheduledPanel(interaction.guild, displayName(interaction)));
    }

    if (customId === 'admin:welcome:assign') {
      welcome.bindWelcomeTemplate(interaction.guild.id, selectedTemplate(interaction), 'welcome', { actorId: interaction.user.id });
      selections.delete(selectionKey(interaction));
      return updatePanel(interaction, await buildInstantPanel(interaction.guild, displayName(interaction), interaction.user.id));
    }
    if (customId === 'admin:welcome:assignDm') {
      welcome.bindWelcomeTemplate(interaction.guild.id, selectedTemplate(interaction), 'dm_welcome', { actorId: interaction.user.id });
      welcome.updateConfig(interaction.guild.id, { dmEnabled: true }, { actorId: interaction.user.id });
      selections.delete(selectionKey(interaction));
      return updatePanel(interaction, await buildInstantPanel(interaction.guild, displayName(interaction), interaction.user.id));
    }

    const config = welcome.getWelcomeSection(interaction.guild.id);
    if (customId === 'admin:welcome:enable') guildManager.setModuleEnabled(interaction.guild.id, 'welcome', true, { actorId: interaction.user.id });
    if (customId === 'admin:welcome:disable') guildManager.setModuleEnabled(interaction.guild.id, 'welcome', false, { actorId: interaction.user.id });
    if (customId === 'admin:welcome:toggleDm') welcome.updateConfig(interaction.guild.id, { dmEnabled: !config.dmEnabled }, { actorId: interaction.user.id });
    if (customId === 'admin:welcome:toggleBots') welcome.updateConfig(interaction.guild.id, { ignoreBots: !config.ignoreBots }, { actorId: interaction.user.id });
    if (['admin:welcome:enable', 'admin:welcome:disable'].includes(customId)) return updatePanel(interaction);
    if (['admin:welcome:toggleDm', 'admin:welcome:toggleBots'].includes(customId)) return updatePanel(interaction, await buildInstantPanel(interaction.guild, displayName(interaction), interaction.user.id));

    if (customId === 'admin:welcome:togglePing') {
      welcome.updateConfig(interaction.guild.id, { allowUserPing: !config.allowUserPing }, { actorId: interaction.user.id });
      return updatePanel(interaction, buildMentionSettingsPanel(interaction.guild, displayName(interaction)));
    }
    if (customId === 'admin:welcome:toggleRolePings') {
      if (!config.allowRolePings && !config.mentionRoleIds.length) throw new Error('Choose at least one role before enabling role pings.');
      welcome.updateConfig(interaction.guild.id, { allowRolePings: !config.allowRolePings }, { actorId: interaction.user.id });
      return updatePanel(interaction, buildMentionSettingsPanel(interaction.guild, displayName(interaction)));
    }
    if (customId === 'admin:welcome:dmPublic') {
      welcome.clearDmTemplate(interaction.guild.id, { actorId: interaction.user.id });
      return updatePanel(interaction, await buildInstantPanel(interaction.guild, displayName(interaction), interaction.user.id));
    }
    if (customId === 'admin:welcome:test') {
      const member = interaction.member;
      if (!member) throw new Error('Your server member record is unavailable.');
      const payload = welcome.buildDiscordPayload(member, 'welcome', welcome.getWelcomeSection(interaction.guild.id), { suppressPing: true });
      payload.ephemeral = true;
      return interaction.reply(payload);
    }
    if (customId === 'admin:welcome:send') {
      const member = interaction.member;
      if (!member) throw new Error('Your server member record is unavailable.');
      const result = await welcome.sendWelcome(member, { force: true, previewOnly: true, silent: false });
      const lines = [
        result.publicSent ? '✅ Public test welcome sent.' : null,
        result.dmSent ? '✅ Test welcome DM sent.' : null,
        ...(result.errors || []).map((error) => `• ${error}`),
      ].filter(Boolean);
      if (!lines.length) lines.push('⚠️ Nothing was sent. Configure a channel or DM welcome first.');
      return interaction.reply({ content: lines.join('\n').slice(0, 2000), ephemeral: true });
    }
    if (customId === 'admin:welcome:repairInstant') {
      await interaction.deferUpdate();
      await welcome.repairConfiguration(interaction.guild, { actorId: interaction.user.id });
      return updatePanel(interaction, await buildInstantPanel(interaction.guild, displayName(interaction), interaction.user.id));
    }
    if (customId === 'admin:welcome:repairAll') {
      await interaction.deferUpdate();
      await welcome.repairConfiguration(interaction.guild, { actorId: interaction.user.id });
      await scheduledWelcomeHealth.repair(interaction.guild, { actorId: interaction.user.id });
      return updatePanel(interaction);
    }
    if (customId === 'admin:welcome:reset') {
      await interaction.deferUpdate();
      selections.delete(selectionKey(interaction));
      welcome.resetWelcome(interaction.guild.id, { actorId: interaction.user.id });
      return updatePanel(interaction);
    }
    if (customId === 'admin:welcome:export') {
      const attachment = new AttachmentBuilder(Buffer.from(JSON.stringify({
        ...welcome.exportConfiguration(interaction.guild.id),
        enabled: guildManager.isModuleEnabled(interaction.guild.id, 'welcome'),
      }, null, 2), 'utf8'), { name: `goliath-welcome-${interaction.guild.id}.json` });
      await interaction.reply({ content: '📤 Welcome configuration export.', files: [attachment], ephemeral: true });
      return true;
    }

    return updatePanel(interaction);
  } catch (error) {
    const payload = { content: `❌ Welcome setup failed: ${error.message}`, ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => null);
    else await interaction.reply(payload).catch(() => null);
    return true;
  }
}

module.exports = {
  buildWelcomePanel,
  buildInstantPanel,
  buildMentionSettingsPanel,
  buildScheduledPanel,
  handleWelcomeInteraction,
  buildWelcomeAdminPanel: buildWelcomePanel,
  handleWelcomeAdminInteraction: handleWelcomeInteraction,
};