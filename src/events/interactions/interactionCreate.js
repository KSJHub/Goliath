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

const verificationManager = optionalRequire('verification manager', '../../modules/verification/verification');
const ticketInteractionHandler = optionalRequire('tickets', '../../modules/tickets/tickets');
const legacyReactionRoleButtons = optionalRequire('legacy reaction role buttons', '../../modules/reactionroles/reactionRolesLegacyButtons');
const polls = optionalRequire('polls', '../../modules/polls/polls');
const tempVoiceInteractionHandler = optionalRequire('temp voice', '../../modules/tempvoice/tempVoiceInteractionHandler');
const suggestionsInteractionHandler = optionalRequire('suggestions', '../../modules/suggestions/suggestionsInteractionHandler');
const giveawaysInteractionHandler = optionalRequire('giveaways', '../../modules/giveaways/giveawaysInteractionHandler');
const formsInteractionHandler = optionalRequire('forms', '../../modules/forms/formsInteractionHandler');
const testSecurityCommand = optionalRequire('test security', '../../commands/admin/testsecurity');
const embedPanel = optionalRequire('embed panel', '../../modules/embed/embedPanel');
const duplicator = optionalRequire('duplicator', '../../core/dev/duplicator');
const adminPanel = optionalRequire('admin panel', '../../core/admin/functions/adminPanel');
const statsAdminPanel = optionalRequire('stats admin', '../../modules/stats/statsPanel');
const reactionRolesAdminPanel = optionalRequire('reaction roles admin', '../../modules/reactionroles/reactionRolesPanel');
const suggestionsAdminPanel = optionalRequire('suggestions admin', '../../modules/suggestions/suggestionsAdminPanel');
const giveawaysAdminPanel = optionalRequire('giveaways admin', '../../modules/giveaways/giveawaysAdminPanel');
const formsAdminPanel = optionalRequire('forms admin', '../../modules/forms/formsAdminPanel');
const pollsAdminPanel = optionalRequire('polls admin', '../../modules/polls/pollsPanel');
const starboardAdminPanel = optionalRequire('starboard admin', '../../modules/starboard/starboardAdminPanel');
const stickyAdminPanel = optionalRequire('sticky admin', '../../modules/sticky/stickyAdminPanel');
const levelingAdminPanel = optionalRequire('leveling admin', '../../modules/leveling/levelingAdminPanel');
const socialAdminPanel = optionalRequire('social admin', '../../modules/social/socialPanel');
const socialCreatorPanel = optionalRequire('social creator hub', '../../modules/social/socialCreatorPanel');
const schedulePanel = optionalRequire('schedule admin', '../../modules/schedule/schedulePanel');
const scheduleDeployment = optionalRequire('schedule RSVP', '../../modules/schedule/scheduleDeployment');
const verificationAdminPanel = optionalRequire('verification admin', '../../modules/verification/verificationPanel');
const autorolesPanel = optionalRequire('auto roles', '../../modules/autoroles/autorolesPanel');
const timedRolesPanel = optionalRequire('timed roles', '../../modules/timedroles/timedRolesPanel');
const welcomePanel = optionalRequire('welcome', '../../modules/welcome/welcomePanel');
const goodbyePanel = optionalRequire('goodbye', '../../modules/goodbye/goodbyePanel');
const moduleAdminPanels = optionalRequire('generic module admin', '../../core/admin/functions/moduleAdminPanels');

let invitesAdminPanel = null;
let invitesAdminPanelError = null;
function loadInvitesAdminPanel() {
  if (invitesAdminPanel?.buildInviteStudioPayload && invitesAdminPanel?.handleInviteStudioInteraction) return invitesAdminPanel;
  try {
    const modulePath = require.resolve('../../modules/invites/invitesAdminPanel');
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

async function callHandler(target, method, ...args) {
  if (typeof target?.[method] !== 'function') return false;
  return Boolean(await target[method](...args));
}

function sanitizeComponentPayload(payload) {
  if (!payload || !Array.isArray(payload.components)) return payload;
  const seen = new Set(); const rows = [];
  for (const actionRow of payload.components) {
    const rowData = typeof actionRow?.toJSON === 'function' ? actionRow.toJSON() : actionRow;
    const components = Array.isArray(rowData?.components) ? rowData.components.filter((component) => {
      const customId = component?.custom_id || component?.customId || null;
      if (!customId) return true;
      if (seen.has(customId)) { console.warn(`[InteractionCreate] Removed duplicate component custom_id: ${customId}`); return false; }
      seen.add(customId); return true;
    }) : [];
    if (components.length) rows.push({ ...rowData, components });
  }
  return { ...payload, components: rows };
}

function wrapInteractionResponses(interaction) {
  if (!interaction || interaction.__goliathResponsesWrapped) return;
  interaction.__goliathResponsesWrapped = true;
  for (const methodName of ['reply', 'update', 'editReply', 'followUp']) {
    if (typeof interaction[methodName] !== 'function') continue;
    const original = interaction[methodName].bind(interaction);
    interaction[methodName] = (payload, ...args) => original(sanitizeComponentPayload(payload), ...args);
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
    if (interaction?.deferred || interaction?.replied) { await interaction.editReply(payload).catch(() => interaction.followUp(payload).catch(() => null)); return; }
    await interaction?.reply?.(payload).catch(() => null);
  } catch { }
}

async function fetchFreshMember(interaction) {
  const guild = interaction?.guild;
  const userId = interaction?.user?.id;
  if (!guild || !userId) return null;
  return guild.members.fetch({ user: userId, force: true })
    .catch(() => guild.members.fetch(userId).catch(() => null));
}

async function handleVerificationMemberInteraction(interaction) {
  if (typeof verificationManager?.verifyMember !== 'function') throw new Error('Verification handler is unavailable.');
  if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const lockKey = `${interaction.guildId}:${interaction.user.id}`;
  const previous = verificationLocks.get(lockKey);
  if (previous) await previous.catch(() => null);
  const operation = (async () => {
    const member = await fetchFreshMember(interaction);
    if (!member) return { ok: false, message: 'Member not found. Please try again.' };
    const result = await verificationManager.verifyMember({ guild: interaction.guild, guildId: interaction.guildId, member, user: interaction.user });
    const refreshed = await fetchFreshMember(interaction);
    if (result.ok && refreshed) console.log(`[Verification] Completed for ${interaction.user.id} in ${interaction.guildId}; roles=${[...refreshed.roles.cache.keys()].join(',')}`);
    return result;
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
    try {
      wrapInteractionResponses(interaction);
      if (interaction?.isAutocomplete?.()) {
        const command = client.commands?.get?.(interaction.commandName);
        if (command?.autocomplete) await command.autocomplete(interaction, client); else await interaction.respond([]).catch(() => null);
        return;
      }
      if (!interaction?.customId && !interaction?.isChatInputCommand?.()) return;
      if (interaction.isChatInputCommand?.()) {
        const command = client.commands?.get?.(interaction.commandName); if (!command) return; await command.execute(interaction, client); return;
      }
      if (interaction.customId === 'admin:invites') {
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
        if (!panel) {
          const reason = String(invitesAdminPanelError?.message || 'Unknown module load error').slice(0, 500);
          throw new Error(`Invite Studio failed to load: ${reason}`);
        }
        if (!await callHandler(panel, 'handleInviteStudioInteraction', interaction)) throw new Error(`Invite Studio did not handle ${interaction.customId}.`);
        return;
      }
      if (startsWith(interaction, 'admin:verification')) { await callHandler(verificationAdminPanel, 'handleVerificationAdminInteraction', interaction); return; }
      if (startsWith(interaction, 'admin:autoRoles')) { await callHandler(autorolesPanel, 'handleAutoRolesInteraction', interaction); return; }
      if (startsWith(interaction, 'admin:timedRoles')) { await callHandler(timedRolesPanel, 'handleTimedRolesInteraction', interaction); return; }
      if (startsWith(interaction, 'admin:welcome')) { await callHandler(welcomePanel, 'handleWelcomeInteraction', interaction); return; }
      if (startsWith(interaction, 'admin:goodbye')) { await callHandler(goodbyePanel, 'handleGoodbyeInteraction', interaction); return; }
      if (startsWith(interaction, 'admin:reactionRoles')) { await callHandler(reactionRolesAdminPanel, 'handleReactionRolesAdminInteraction', interaction); return; }
      if (startsWith(interaction, 'admin:socialhub')) { await callHandler(socialCreatorPanel, 'handleSocialCreatorInteraction', interaction); return; }
      if (startsWith(interaction, 'admin:schedule')) { await callHandler(schedulePanel, 'handleScheduleAdminInteraction', interaction); return; }
      if (startsWith(interaction, 'schedule:rsvp:')) { await callHandler(scheduleDeployment, 'handleMemberInteraction', interaction); return; }
      if (isVerificationMemberInteraction(interaction)) { await handleVerificationMemberInteraction(interaction); return; }
      if (await callHandler(statsAdminPanel, 'handleStatsAdminInteraction', interaction)) return;
      if (await callHandler(suggestionsAdminPanel, 'handleSuggestionsAdminInteraction', interaction)) return;
      if (await callHandler(giveawaysAdminPanel, 'handleGiveawaysAdminInteraction', interaction)) return;
      if (await callHandler(formsAdminPanel, 'handleFormsAdminInteraction', interaction)) return;
      if (await callHandler(pollsAdminPanel, 'handlePollsAdminInteraction', interaction)) return;
      if (await callHandler(starboardAdminPanel, 'handleStarboardAdminInteraction', interaction)) return;
      if (await callHandler(stickyAdminPanel, 'handleStickyAdminInteraction', interaction)) return;
      if (await callHandler(levelingAdminPanel, 'handleLevelingAdminInteraction', interaction)) return;
      if (await callHandler(socialAdminPanel, 'handleSocialAdminInteraction', interaction)) return;
      if (await callHandler(moduleAdminPanels, 'handleModuleAdminInteraction', interaction)) return;
      if (await callHandler(adminPanel, 'handleAdminNavigation', interaction)) return;
      if (await callHandler(duplicator, 'handleInteraction', interaction)) return;
      if (await callHandler(embedPanel, 'handleInteraction', interaction)) return;
      if (interaction.isButton?.() && await callHandler(testSecurityCommand, 'handleButton', interaction)) return;
      if (interaction.isButton?.() && await callHandler(tempVoiceInteractionHandler, 'handleTempVoiceInteraction', interaction, client)) return;
      if (await callHandler(formsInteractionHandler, 'handleFormsInteraction', interaction)) return;
      if (await callHandler(suggestionsInteractionHandler, 'handleSuggestionsInteraction', interaction)) return;
      if (await callHandler(giveawaysInteractionHandler, 'handleGiveawayInteraction', interaction)) return;
      if (interaction.isButton?.() && await callHandler(polls, 'vote', interaction)) return;
      if (await callHandler(ticketInteractionHandler, 'handleTicketInteraction', interaction, client)) return;
      if (await callHandler(legacyReactionRoleButtons, 'handleLegacyButtonInteraction', interaction)) return;
    } catch (error) {
      console.error('[InteractionCreate] Failed to handle interaction:', error);
      await safeInteractionError(interaction, error);
    }
  },
};