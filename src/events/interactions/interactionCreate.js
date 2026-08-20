'use strict';

const { Events, MessageFlags } = require('discord.js');

function optionalRequire(label, modulePath, fallback = {}) {
  try { return require(modulePath); }
  catch (error) {
    console.warn(`[InteractionCreate] Optional handler unavailable: ${label}`);
    console.warn(error?.stack || error?.message || error);
    return fallback;
  }
}

const guildManager = optionalRequire('guild manager', '../../core/guild/guildManager');
const verificationManager = optionalRequire('verification manager', '../../modules/securityStudio/verificationManager');
const ticketInteractionHandler = optionalRequire('tickets', '../../modules/feedbackStudio/tickets/tickets');
const pollsInteractions = optionalRequire('polls', '../../modules/communityStudio/polls/pollsInteractions');
const tempVoiceInteractionHandler = optionalRequire('temp voice', '../../modules/utilityStudio/tempVoice/tempVoiceInteractionHandler');
const suggestionsInteractions = optionalRequire('suggestions', '../../modules/feedbackStudio/suggestions/suggestionsInteractions');
const giveawaysInteractionHandler = optionalRequire('giveaways', '../../modules/communityStudio/giveaways/giveawaysInteractionHandler');
const formsInteractions = optionalRequire('forms', '../../modules/feedbackStudio/forms/formsInteractions');
const testSecurityCommand = optionalRequire('test security', '../../commands/admin/testsecurity');
const embedPanel = optionalRequire('embed interactions', '../../modules/messageStudio/embed/embedInteractions');
const duplicator = optionalRequire('duplicator', '../../owner/dev/duplicator');
const adminPanel = optionalRequire('admin panel', '../../core/admin/functions/adminPanel');
const restoreRequestManager = optionalRequire('restore requests', '../../core/security/restoreRequestManager');
const statsAdminPanel = optionalRequire('stats admin', '../../modules/utilityStudio/stats/statsPanel');
const reactionRolesAdminPanel = optionalRequire('reaction roles admin', '../../modules/roleStudio/reactionRoles/reactionRolesPanel');
const temporaryRolesPanel = optionalRequire('temporary roles', '../../modules/roleStudio/temporaryRoles/temporaryRolesPanel');
const giveawaysAdminPanel = optionalRequire('giveaways admin', '../../modules/communityStudio/giveaways/giveawaysAdminPanel');
const starboardPanel = optionalRequire('starboard admin', '../../modules/messageStudio/starboard/starboardPanel');
const stickyAdminPanel = optionalRequire('sticky admin', '../../modules/messageStudio/sticky/stickyAdminPanel');
const levelingInteractions = optionalRequire('leveling', '../../modules/communityStudio/leveling/levelingInteractions');
const socialAdminPanel = optionalRequire('social admin', '../../modules/socialStudio/socialAlerts/socialStudioPanel');
const socialCreatorActionCompat = optionalRequire('social creator actions', '../../modules/socialStudio/socialAlerts/socialStudioCreatorActionCompat');
const schedulePanel = optionalRequire('schedule admin', '../../modules/utilityStudio/schedule/schedulePanel');
const scheduleDeployment = optionalRequire('schedule RSVP', '../../modules/utilityStudio/schedule/scheduleDeployment');
const verificationAdminPanel = optionalRequire('verification admin', '../../modules/securityStudio/verificationPanel');
const autorolesPanel = optionalRequire('auto roles', '../../modules/roleStudio/autoRoles/autoRolesPanel');
const timedRolesPanel = optionalRequire('timed roles', '../../modules/roleStudio/timedRoles/timedRolesPanel');
const welcomePanel = optionalRequire('welcome', '../../modules/messageStudio/welcome/welcomePanel');
const goodbyePanel = optionalRequire('goodbye', '../../modules/messageStudio/goodbye/goodbyePanel');
const moduleAdminPanels = optionalRequire('generic module admin', '../../core/admin/functions/moduleAdminPanels');
const userPanelInteractions = optionalRequire('user panel', '../../core/panels/user/userInteractions');
const modInteractions = optionalRequire('mod interactions', '../../core/panels/mod/modInteractions');
const roleSelectorPanel = optionalRequire(
  'role selector',
  '../../modules/roleStudio/roleSelector/roleSelectorPanel'
);

const roleStudioPanel = optionalRequire(
  'role studio panel',
  '../../modules/roleStudio/roleStudioPanel'
);

const privateRoomsPanel = optionalRequire(
  'private rooms panel',
  '../../modules/utilityStudio/privateRooms/privateRoomsPanel'
);

const birthdaysPanel = optionalRequire(
  'birthdays panel',
  '../../modules/communityStudio/birthdays/birthdaysPanel'
);

const MODULE_STUDIO_PREFIXES = [
  ['communityStudio', ['admin:birthdays', 'birthdays:user:', 'admin:invites', 'invites:', 'admin:giveaways', 'giveaways:', 'admin:leveling', 'leveling:', 'admin:polls', 'poll_vote:']],
  ['feedbackStudio', ['admin:forms', 'forms:', 'admin:suggestions', 'suggestions:', 'admin:tickets', 'tickets:']],
  ['messageStudio', ['admin:embed', 'embed:', 'admin:goodbye', 'goodbye:', 'admin:starboard', 'starboard:', 'admin:sticky', 'sticky:', 'admin:welcome', 'welcome:']],
  ['roleStudio', ['admin:autoRoles', 'autoroles:', 'admin:reactionRoles', 'reactionRoles:', 'admin:temporaryRoles', 'temporaryRoles:', 'admin:timedRoles', 'timedRoles:']],
  ['securityStudio', ['admin:verification', 'verification:']],
  ['socialStudio', ['admin:social', 'social:']],
  ['utilityStudio', ['admin:schedule', 'schedule:', 'admin:stats', 'stats:', 'admin:translation', 'translation:', 'admin:tempVoice', 'tempVoice:']],
];

let invitesAdminPanel = null;
let invitesAdminPanelError = null;
function loadInvitesAdminPanel() {
  if (invitesAdminPanel?.buildInviteStudioPayload && invitesAdminPanel?.handleInviteStudioInteraction) return invitesAdminPanel;
  try {
    const modulePath = require.resolve('../../modules/communityStudio/invites/invitesAdminPanel');
    delete require.cache[modulePath];
    invitesAdminPanel = require(modulePath);
    invitesAdminPanelError = null;
    return invitesAdminPanel;
  } catch (error) {
    invitesAdminPanel = null;
    invitesAdminPanelError = error;
    console.error('[InteractionCreate] Invite Studio load failed:', error?.stack || error?.message || error);
    return null;
  }
}

const verificationLocks = new Map();
const handledInteractions = new WeakSet();

async function callHandler(target, method, ...args) {
  if (typeof target?.[method] !== 'function') return false;
  return Boolean(await target[method](...args));
}
function isValidHttpUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch { return false; }
}
function sanitizeEmbedData(embed) {
  const data = typeof embed?.toJSON === 'function' ? embed.toJSON() : { ...embed };
  if (!data || typeof data !== 'object') return data;
  const sanitized = { ...data };
  if (sanitized.footer?.icon_url && !isValidHttpUrl(sanitized.footer.icon_url)) {
    sanitized.footer = { ...sanitized.footer };
    delete sanitized.footer.icon_url;
  }
  if (sanitized.author?.icon_url && !isValidHttpUrl(sanitized.author.icon_url)) {
    sanitized.author = { ...sanitized.author };
    delete sanitized.author.icon_url;
  }
  if (sanitized.author?.url && !isValidHttpUrl(sanitized.author.url)) {
    sanitized.author = { ...sanitized.author };
    delete sanitized.author.url;
  }
  if (sanitized.thumbnail?.url && !isValidHttpUrl(sanitized.thumbnail.url)) delete sanitized.thumbnail;
  if (sanitized.image?.url && !isValidHttpUrl(sanitized.image.url)) delete sanitized.image;
  return sanitized;
}
function resolveParentStudio(customId) {
  const id = String(customId || '');
  for (const [studioKey, prefixes] of MODULE_STUDIO_PREFIXES) {
    if (prefixes.some((prefix) => id === prefix || id.startsWith(prefix))) return studioKey;
  }
  return null;
}
function normalizeBackComponent(component, interaction) {
  const data = typeof component?.toJSON === 'function' ? component.toJSON() : { ...component };
  const customId = data?.custom_id || data?.customId || null;
  const parentStudio = resolveParentStudio(interaction?.customId);
  if (!parentStudio || customId !== 'admin:modules') return data;
  return { ...data, custom_id: `admin:studio:${parentStudio}`, label: '⬅️ Back' };
}
function componentId(component) {
  return component?.custom_id || component?.customId || null;
}
function findComponent(rows, customId) {
  for (const rowData of rows) {
    const found = rowData?.components?.find((component) => componentId(component) === customId);
    if (found) return found;
  }
  return null;
}
function normalizeVerificationRows(payload, rows) {
  const title = payload?.embeds?.[0]?.title;

  if (title === '🔄 Verification · Workflow') {
    if (rows.length !== 3 || rows[0]?.components?.length !== 3 || rows[1]?.components?.length !== 5) return rows;
    const workflowButtons = [...rows[0].components, ...rows[1].components];
    return [
      { ...rows[0], components: workflowButtons.slice(0, 4) },
      { ...rows[1], components: workflowButtons.slice(4) },
      rows[2],
    ];
  }

  if (title === '✅ Verification · Overview') {
    const workflow = findComponent(rows, 'admin:verification:page:workflow');
    const roles = findComponent(rows, 'admin:verification:page:roles');
    const messages = findComponent(rows, 'admin:verification:page:messages');
    const panels = findComponent(rows, 'admin:verification:page:panel');
    const back = findComponent(rows, 'admin:studio:securityStudio')
      || findComponent(rows, 'admin:modules');
    const settings = findComponent(rows, 'admin:verification:page:settings');
    const requirements = findComponent(rows, 'admin:verification:page:requirements');
    if (![workflow, roles, messages, panels, back, settings, requirements].every(Boolean)) return rows;
    const next = {
      ...workflow,
      custom_id: 'admin:verification:overview:next',
      label: 'Next ➡️',
      style: 2,
    };
    return [
      { ...rows[0], components: [workflow, roles, messages, panels] },
      { ...rows[0], components: [back, settings, requirements, next] },
    ];
  }

  if (title === '🎨 Verification · Panel Builder') {
    const editRow = rows[0];
    const publishRow = rows[1];
    const savedPanels = findComponent(rows, 'admin:verification:page:saved_panels');
    const deletePanel = rows[3]?.components?.[0];
    const resetDesign = rows[3]?.components?.[1];
    const navRow = rows[4];
    if (
      editRow?.components?.length !== 4
      || publishRow?.components?.length !== 3
      || !savedPanels
      || !deletePanel
      || !resetDesign
      || !navRow?.components?.length
    ) return rows;
    return [
      editRow,
      { ...publishRow, components: [...publishRow.components, savedPanels] },
      { ...rows[3], components: [deletePanel, resetDesign] },
      navRow,
    ];
  }

  return rows;
}
function sanitizeComponentPayload(payload, interaction) {
  if (!payload || typeof payload !== 'object') return payload;
  const sanitizedPayload = {
    ...payload,
    ...(Array.isArray(payload.embeds) ? { embeds: payload.embeds.map(sanitizeEmbedData) } : {}),
  };
  if (!Array.isArray(payload.components)) return sanitizedPayload;
  const seen = new Set();
  const rows = [];
  for (const actionRow of payload.components) {
    const rowData = typeof actionRow?.toJSON === 'function' ? actionRow.toJSON() : actionRow;
    const components = Array.isArray(rowData?.components)
      ? rowData.components.map((component) => normalizeBackComponent(component, interaction)).filter((component) => {
        const customId = componentId(component);
        if (!customId) return true;
        if (seen.has(customId)) return false;
        seen.add(customId);
        return true;
      })
      : [];
    if (components.length) rows.push({ ...rowData, components });
  }
  return {
    ...sanitizedPayload,
    components: normalizeVerificationRows(sanitizedPayload, rows),
  };
}
function wrapInteractionResponses(interaction) {
  if (!interaction || interaction.__goliathResponsesWrapped) return;
  interaction.__goliathResponsesWrapped = true;

  const originals = {};
  for (const methodName of ['reply', 'update', 'editReply', 'followUp']) {
    if (typeof interaction[methodName] === 'function') originals[methodName] = interaction[methodName].bind(interaction);
  }

  for (const methodName of Object.keys(originals)) {
    interaction[methodName] = (payload, ...args) => {
      const sanitized = sanitizeComponentPayload(payload, interaction);
      const isPanelPayload = Array.isArray(sanitized?.embeds) || Array.isArray(sanitized?.components);
      const canReuseModalSource = methodName === 'reply'
        && interaction.isModalSubmit?.()
        && interaction.isFromMessage?.()
        && !interaction.deferred
        && !interaction.replied
        && isPanelPayload
        && typeof originals.update === 'function';

      if (canReuseModalSource) {
        const updatePayload = { ...sanitized };
        delete updatePayload.ephemeral;
        delete updatePayload.flags;
        return originals.update(updatePayload, ...args);
      }

      return originals[methodName](sanitized, ...args);
    };
  }
}
const startsWith = (interaction, prefix) => String(interaction?.customId || '').startsWith(prefix);
function isVerificationMemberInteraction(interaction) {
  if (!interaction?.isButton?.()) return false;
  return typeof verificationManager?.parseVerifyCustomId === 'function' && Boolean(verificationManager.parseVerifyCustomId(interaction.customId));
}
async function safeInteractionError(interaction, error = null) {
  const detail = error?.message ? `\n\`${String(error.message).slice(0, 300)}\`` : '';
  const payload = { content: `❌ Interaction failed.${detail}`, flags: MessageFlags.Ephemeral };
  try {
    if (interaction?.isAutocomplete?.()) { await interaction.respond([]).catch(() => null); return; }
    if (interaction?.deferred || interaction?.replied) {
      await interaction.editReply(payload).catch(() => interaction.followUp(payload).catch(() => null));
      return;
    }
    await interaction?.reply?.(payload).catch(() => null);
  } catch { }
}
async function fetchFreshMember(interaction) {
  const guild = interaction?.guild;
  const userId = interaction?.user?.id;
  if (!guild || !userId) return null;
  return guild.members.fetch({ user: userId, force: true }).catch(() => guild.members.fetch(userId).catch(() => null));
}
async function handleVerificationMemberInteraction(interaction) {
  if (typeof verificationManager?.verifyMember !== 'function') throw new Error('Verification handler is unavailable.');
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }
  const lockKey = `${interaction.guildId}:${interaction.user.id}`;
  const previous = verificationLocks.get(lockKey);
  if (previous) await previous.catch(() => null);
  const operation = (async () => {
    const member = await fetchFreshMember(interaction);
    if (!member) return { ok: false, message: 'Member not found. Please try again.' };
    return verificationManager.verifyMember({
      guild: interaction.guild,
      guildId: interaction.guildId,
      member,
      user: interaction.user,
      customId: interaction.customId,
      channelId: interaction.channelId || interaction.channel?.id,
      messageId: interaction.message?.id || interaction.messageId,
    });
  })();
  verificationLocks.set(lockKey, operation);
  try {
    const result = await operation;
    await interaction.editReply({ content: result.ok ? `✅ ${result.message}` : `❌ ${result.message}` });
  } finally {
    if (verificationLocks.get(lockKey) === operation) verificationLocks.delete(lockKey);
  }
  return true;
}

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction, client) {
    if (interaction && handledInteractions.has(interaction)) return;
    if (interaction) handledInteractions.add(interaction);

    try {
      wrapInteractionResponses(interaction);
      if (interaction?.isAutocomplete?.()) {
        const command = client.commands?.get?.(interaction.commandName);
        if (command?.autocomplete) await command.autocomplete(interaction, client);
        else await interaction.respond([]).catch(() => null);
        return;
      }
      if (!interaction?.customId && !interaction?.isChatInputCommand?.()) return;
      if (interaction.isChatInputCommand?.()) {
        const command = client.commands?.get?.(interaction.commandName);
        if (!command) return;
        await command.execute(interaction, client);
        return;
      }
      const interactionAgeMs = Math.max(0, Date.now() - Number(interaction.createdTimestamp || Date.now()));
const customId = String(interaction.customId || '');

      if (isVerificationMemberInteraction(interaction)) {
        await handleVerificationMemberInteraction(interaction);
        return;
      }

      if (customId === 'admin:studio:roleStudio') {
  interaction.customId = 'admin:roleStudio:handled';

  const payload = await roleStudioPanel.buildRoleStudioPanel(
    interaction.guild,
    interaction.member?.displayName ||
      interaction.user?.username ||
      'Unknown User'
  );

  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload);
  } else {
    await interaction.update(payload);
  }

  return;
}

if (
  customId.startsWith('admin:roleSelector') ||
  customId.startsWith('roleSelector:') ||
  customId.startsWith('admin:colourRoles') ||
  customId.startsWith('colourRoles:')
) {
  await roleSelectorPanel.handleRoleSelectorInteraction(interaction);
  return;
}

if (
  customId.startsWith('admin:privateRooms') ||
  customId.startsWith('user:privateRooms:') ||
  customId.startsWith('privateRooms:')
) {
  if (customId.startsWith('admin:privateRooms')) {
    await privateRoomsPanel.handleAdminInteraction(interaction);
    return;
  }

  if (customId.startsWith('user:privateRooms:')) {
    await privateRoomsPanel.handleUserInteraction(interaction);
    return;
  }

  if (typeof privateRoomsPanel.handleInteraction === 'function') {
    await privateRoomsPanel.handleInteraction(interaction);
    return;
  }
}

      const isTicketRuntimeInteraction = customId.startsWith('ticket_') || customId.startsWith('goliath_ticket_');
      if (isTicketRuntimeInteraction && interaction.guildId && guildManager.isModuleEnabled?.(interaction.guildId, 'tickets') === false) {
        await interaction.reply({ content: '❌ Tickets is currently disabled for this server.', flags: MessageFlags.Ephemeral });
        return;
      }
      if (customId.startsWith('restore_request_')) {
        if (!await callHandler(restoreRequestManager, 'handleRestoreButton', interaction)) throw new Error(`Restore request handler did not handle ${customId}.`);
        return;
      }
      if (customId.startsWith('admin:automod')) {
        if (!await callHandler(adminPanel, 'handleAdminNavigation', interaction)) throw new Error(`AutoMod admin did not handle ${customId}.`);
        return;
      }
      if (customId.startsWith('admin:birthdays')) {
        if (!await callHandler(birthdaysPanel, 'handleAdmin', interaction)) throw new Error(`Birthdays admin did not handle ${customId}.`);
        return;
      }
      if (customId.startsWith('birthdays:user:')) {
        if (!await callHandler(birthdaysPanel, 'handleUser', interaction)) throw new Error(`Birthdays user did not handle ${customId}.`);
        return;
      }
      if (customId.startsWith('user:')) {
        if (!await callHandler(userPanelInteractions, 'handleUserPanelInteraction', interaction)) throw new Error(`User panel did not handle ${customId}.`);
        return;
      }
      if (customId === 'admin:modules' || customId.startsWith('admin:modules:page:') || customId.startsWith('admin:module:') || customId.startsWith('admin:studio:')) {
        if (!await callHandler(moduleAdminPanels, 'handleModuleAdminInteraction', interaction)) throw new Error(`Module admin did not handle ${customId}.`);
        return;
      }
      if (customId === 'admin:invites') {
        const panel = loadInvitesAdminPanel();
        if (typeof panel?.buildInviteStudioPayload !== 'function') {
          const reason = String(invitesAdminPanelError?.message || 'Unknown module load error').slice(0, 500);
          throw new Error(`Invite Studio failed to load: ${reason}`);
        }
        await interaction.deferUpdate();
        await interaction.editReply(panel.buildInviteStudioPayload(interaction));
        return;
      }
      if (startsWith(interaction, 'invites:')) {
        const panel = loadInvitesAdminPanel();
        if (!panel) throw new Error('Invite Studio failed to load.');
        if (!await callHandler(panel, 'handleInviteStudioInteraction', interaction)) throw new Error(`Invite Studio did not handle ${customId}.`);
        return;
      }
      if (customId === 'admin:embed' || customId.startsWith('embed:')) {
        if (!await callHandler(embedPanel, 'handleInteraction', interaction)) throw new Error(`Embed Studio did not handle ${customId}.`);
        return;
      }
      if (customId === 'admin:social' || customId.startsWith('social:')) {
        await callHandler(socialCreatorActionCompat, 'capture', interaction);
        if (await callHandler(socialCreatorActionCompat, 'handle', interaction)) return;
        if (!await callHandler(socialAdminPanel, 'handleSocialAdminInteraction', interaction)) throw new Error(`Social Studio did not handle ${customId}.`);
        return;
      }
      if (customId === 'admin:verification:overview:next') {
        const displayName = interaction.member?.displayName
          || interaction.user?.displayName
          || interaction.user?.username
          || 'Unknown User';
        const payload = await verificationAdminPanel.buildVerificationAdminPanel(
          interaction.guild,
          displayName,
          'workflow'
        );
        if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
        else await interaction.update(payload);
        return;
      }
      if (startsWith(interaction, 'admin:verification')) { await callHandler(verificationAdminPanel, 'handleVerificationAdminInteraction', interaction); return; }
      if (startsWith(interaction, 'admin:autoRoles')) { await callHandler(autorolesPanel, 'handleAutoRolesInteraction', interaction); return; }
      if (startsWith(interaction, 'admin:temporaryRoles')) { await callHandler(temporaryRolesPanel, 'handleTemporaryRolesInteraction', interaction); return; }
      if (startsWith(interaction, 'admin:timedRoles')) { await callHandler(timedRolesPanel, 'handleTimedRolesInteraction', interaction); return; }
      if (startsWith(interaction, 'admin:welcome')) { await callHandler(welcomePanel, 'handleWelcomeInteraction', interaction); return; }
      if (startsWith(interaction, 'admin:goodbye')) { await callHandler(goodbyePanel, 'handleGoodbyeInteraction', interaction); return; }
      if (startsWith(interaction, 'admin:reactionRoles')) { await callHandler(reactionRolesAdminPanel, 'handleReactionRolesAdminInteraction', interaction); return; }
      if (startsWith(interaction, 'admin:schedule')) { await callHandler(schedulePanel, 'handleScheduleAdminInteraction', interaction); return; }
      if (startsWith(interaction, 'schedule:rsvp:')) { await callHandler(scheduleDeployment, 'handleMemberInteraction', interaction); return; }

      if (await callHandler(statsAdminPanel, 'handleStatsAdminInteraction', interaction)) return;
      if (await callHandler(suggestionsInteractions, 'handleSuggestionsAdminInteraction', interaction)) return;
      if (await callHandler(giveawaysAdminPanel, 'handleGiveawaysAdminInteraction', interaction)) return;
      if (await callHandler(formsInteractions, 'handleFormsAdminInteraction', interaction)) return;
      if (await callHandler(pollsInteractions, 'handlePollsInteraction', interaction)) return;
      if (await callHandler(starboardPanel, 'handleStarboardAdminInteraction', interaction)) return;
      if (await callHandler(stickyAdminPanel, 'handleStickyAdminInteraction', interaction)) return;
      if (await callHandler(levelingInteractions, 'handleLevelingInteraction', interaction)) return;
      if (await callHandler(adminPanel, 'handleAdminNavigation', interaction)) return;
      if (await callHandler(duplicator, 'handleInteraction', interaction)) return;
      if (interaction.isButton?.() && await callHandler(testSecurityCommand, 'handleButton', interaction)) return;
      if (interaction.isButton?.() && await callHandler(tempVoiceInteractionHandler, 'handleTempVoiceInteraction', interaction, client)) return;
      if (await callHandler(formsInteractions, 'handleFormsInteraction', interaction)) return;
      if (await callHandler(suggestionsInteractions, 'handleSuggestionsInteraction', interaction)) return;
      if (await callHandler(giveawaysInteractionHandler, 'handleGiveawayInteraction', interaction)) return;
      if (await callHandler(ticketInteractionHandler, 'handleTicketInteraction', interaction, client)) return;
    } catch (error) {
      console.error('[InteractionCreate] Failed to handle interaction:', error);
      await safeInteractionError(interaction, error);
    }
  },
};




