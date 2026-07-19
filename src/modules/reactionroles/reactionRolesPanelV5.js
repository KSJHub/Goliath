'use strict';

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const reactionRoles = require('./reactionRoles');
const messageFinder = require('./reactionRoleMessageFinder');
const basePanel = require('./reactionRolesPanelV4');
const runtimePanel = require('./reactionRolesPanelV3');

const row = (...items) => new ActionRowBuilder().addComponents(...items.filter(Boolean));
const button = (id, label, style = ButtonStyle.Secondary, disabled = false) => new ButtonBuilder()
  .setCustomId(id)
  .setLabel(label)
  .setStyle(style)
  .setDisabled(Boolean(disabled));

function modeLabel(mode) {
  if (mode === reactionRoles.MODES.ADD) return 'Add only';
  if (mode === reactionRoles.MODES.REMOVE) return 'Remove role';
  return 'Add + remove on unreact';
}

function messageSummary(message) {
  const content = String(message.content || '').trim();
  const embedTitle = String(message.embedTitle || '').trim();
  const embedDescription = String(message.embedDescription || '').trim();
  return (content || embedTitle || embedDescription || 'Message has no text preview available.')
    .replace(/\s+/g, ' ')
    .slice(0, 900);
}

async function selectedMessage(guild, draft) {
  if (!draft?.channelId || !draft?.messageId) return null;
  const result = await messageFinder.searchGuildMessages(guild, {
    channelId: draft.channelId,
    messageId: draft.messageId,
    resultLimit: 1,
  });
  return result.messages?.[0] || null;
}

async function buildMessagePreview(guild, userId) {
  const draft = reactionRoles.getDraft(guild.id, userId);
  const message = await selectedMessage(guild, draft);
  if (!message) throw new Error('The selected message is no longer accessible. Choose it again or check Goliath’s channel permissions.');

  const messageUrl = message.jumpUrl || `https://discord.com/channels/${guild.id}/${message.channelId}/${message.id}`;
  const created = message.createdAt ? new Date(message.createdAt).toLocaleString() : 'Unknown';
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('👁️ Confirm Selected Message')
    .setDescription([
      `**Author:** ${message.authorName || 'Unknown'}${message.bot ? ' • Bot/Webhook' : ''}`,
      `**Channel:** <#${message.channelId}>`,
      `**Created:** ${created}`,
      `**Message:** [Open in Discord](${messageUrl})`,
      '',
      '### Preview',
      messageSummary(message),
      '',
      `**Embeds:** \`${message.embedCount || 0}\`  •  **Existing reactions:** \`${message.reactionCount || 0}\``,
      '',
      '### Preservation guarantees',
      '✅ Original text and embeds preserved',
      '✅ Existing buttons/components preserved',
      '✅ Unrelated reactions preserved',
      '✅ Only configured role reactions are added',
    ].join('\n').slice(0, 4096));

  if (message.authorAvatar) embed.setThumbnail(message.authorAvatar);

  return {
    embeds: [embed],
    components: [
      row(
        button('admin:reactionRoles:source', 'Change Message'),
        button('admin:reactionRoles:continue', 'Correct Message — Configure Roles', ButtonStyle.Success),
        button('admin:reactionRoles:wizard:cancel', 'Cancel', ButtonStyle.Danger),
      ),
    ],
  };
}

async function buildDeploymentReview(guild, userId) {
  const draft = reactionRoles.getDraft(guild.id, userId);
  const existing = draft.type === reactionRoles.DRAFT_TYPES.EXISTING;
  const message = existing ? await selectedMessage(guild, draft) : null;
  if (existing && !message) throw new Error('The selected message is no longer accessible. Return to message selection and choose it again.');
  if (!draft.mappings?.length) throw new Error('Add at least one role mapping before review.');

  const mappingLines = draft.mappings.slice(0, 20).map((mapping, index) => {
    const role = guild.roles.cache.get(mapping.roleId);
    return `**${index + 1}. ${mapping.emoji}** → ${role ? `<@&${role.id}>` : `\`${mapping.roleId}\``} • ${modeLabel(mapping.mode)}`;
  });
  const emojis = draft.mappings.map((mapping) => mapping.emoji).join(' ');

  const targetLines = existing ? [
    `**Target:** <#${draft.channelId}> / \`${draft.messageId}\``,
    `**Author:** ${message.authorName || 'Unknown'}`,
    `**Preview:** ${messageSummary(message).slice(0, 350)}`,
  ] : [
    `**Target channel:** ${draft.channelId ? `<#${draft.channelId}>` : 'Not selected'}`,
    `**Embed Studio template:** ${draft.templateId ? `\`${draft.templateId}\`` : 'Not selected'}`,
  ];

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(existing ? '✅ Final Review — Attach Roles' : '✅ Final Review — Create Panel')
    .setDescription([
      ...targetLines,
      '',
      `### Role mappings (${draft.mappings.length})`,
      ...mappingLines,
      '',
      `**Reactions to add:** ${emojis}`,
      '',
      '### Safety checks',
      existing ? '✅ Existing message content preserved' : '✅ Embed Studio controls presentation',
      existing ? '✅ Existing embeds and components preserved' : '✅ New panel will be created in the selected channel',
      existing ? '✅ Unrelated reactions preserved' : '✅ Only configured role mappings will be deployed',
      '✅ Roles are validated against Goliath’s hierarchy before assignment',
      '',
      '> Nothing is changed until you confirm below.',
    ].join('\n').slice(0, 4096));

  return {
    embeds: [embed],
    components: [
      row(
        button('admin:reactionRoles:review:back', 'Back to Builder'),
        button('admin:reactionRoles:wizard:confirm', existing ? 'Attach Roles Now' : 'Create Panel Now', ButtonStyle.Success),
        button('admin:reactionRoles:wizard:cancel', 'Cancel', ButtonStyle.Danger),
      ),
    ],
  };
}

async function respond(interaction, payload) {
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  if (interaction.isButton?.() || interaction.isAnySelectMenu?.()) return interaction.update(payload);
  return interaction.reply({ ...payload, ephemeral: true });
}

async function handleReactionRolesAdminInteraction(interaction) {
  const id = String(interaction.customId || '');
  if (!id.startsWith('admin:reactionRoles')) return false;

  if (id === 'admin:reactionRoles:source:continue') {
    return respond(interaction, await buildMessagePreview(interaction.guild, interaction.user.id));
  }

  if (id === 'admin:reactionRoles:wizard:deploy') {
    return respond(interaction, await buildDeploymentReview(interaction.guild, interaction.user.id));
  }

  if (id === 'admin:reactionRoles:review:back') {
    interaction.customId = 'admin:reactionRoles:continue';
    return runtimePanel.handleReactionRolesAdminInteraction(interaction);
  }

  if (id === 'admin:reactionRoles:wizard:confirm') {
    interaction.customId = 'admin:reactionRoles:wizard:deploy';
    return runtimePanel.handleReactionRolesAdminInteraction(interaction);
  }

  return basePanel.handleReactionRolesAdminInteraction(interaction);
}

module.exports = {
  buildReactionRolesAdminPanel: basePanel.buildReactionRolesAdminPanel,
  handleReactionRolesAdminInteraction,
};
