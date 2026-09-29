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
const panelNavigation = optionalRequire('panel navigation', '../../core/ui/panelNavigation');
const verificationManager = optionalRequire('verification manager', '../../modules/securityStudio/verificationManager');
const ticketInteractionHandler = optionalRequire('tickets', '../../modules/feedbackStudio/tickets/tickets');
const pollsInteractions = optionalRequire('polls', '../../modules/communityStudio/polls/pollsInteractions');
const tempVoiceInteractionHandler = optionalRequire('temp voice', '../../modules/utilityStudio/tempVoice/tempVoiceInteractionHandler');
const suggestionsInteractions = optionalRequire('suggestions', '../../modules/feedbackStudio/suggestions/suggestionsInteractions');
const giveawaysInteractionHandler = optionalRequire('giveaways', '../../modules/communityStudio/giveaways/giveawaysInteractionHandler');
const formsInteractions = optionalRequire('forms', '../../modules/feedbackStudio/forms/formsInteractions');
const faqInteractions = optionalRequire('faq', '../../modules/feedbackStudio/faq/faqInteractions');
const embedPanel = optionalRequire('embed interactions', '../../modules/messageStudio/embed/embedInteractions');
const duplicator = optionalRequire('duplicator', '../../owner/dev/duplicator');
const adminPanel = optionalRequire('admin panel', '../../core/administration/admin/panel');
const automodPanel = optionalRequire('automod panel', '../../core/administration/automod/panel');
const modInteractions = optionalRequire('mod interactions', '../../core/administration/mod/interactions');
const restoreRequestManager = optionalRequire('restore requests', '../../core/security/restoreBackup/requests');
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
const moduleAdminPanels = optionalRequire('generic module admin', '../../core/administration/admin/modules');
const userPanelInteractions = optionalRequire('user panel', '../../core/administration/user/interactions');
const roleSelectorPanel = optionalRequire('role selector', '../../modules/roleStudio/roleSelector/roleSelectorPanel');
const roleStudioPanel = optionalRequire('role studio panel', '../../modules/roleStudio/roleStudioPanel');
const privateRoomsPanel = optionalRequire('private rooms panel', '../../modules/utilityStudio/privateRooms/privateRoomsPanel');
const birthdaysPanel = optionalRequire('birthdays panel', '../../modules/communityStudio/birthdays/birthdaysPanel');

const MODULE_STUDIO_PREFIXES = [
  ['communityStudio', ['admin:birthdays', 'birthdays:user:', 'admin:invites', 'invites:', 'admin:giveaways', 'giveaways:', 'admin:leveling', 'leveling:', 'admin:polls', 'poll_vote:']],
  ['feedbackStudio', ['admin:faq', 'faq:', 'admin:forms', 'forms:', 'admin:suggestions', 'suggestions:', 'admin:tickets', 'tickets:']],
  ['messageStudio', ['admin:embed', 'embed:', 'admin:goodbye', 'goodbye:', 'admin:starboard', 'starboard:', 'admin:sticky', 'sticky:', 'admin:welcome', 'welcome:']],
  ['roleStudio', ['admin:autoRoles', 'autoroles:', 'admin:reactionRoles', 'reactionRoles:', 'admin:temporaryRoles', 'temporaryRoles:', 'admin:timedRoles', 'timedRoles:']],
  ['securityStudio', ['admin:verification', 'verification:']],
  ['socialStudio', ['admin:social', 'social:']],
  ['utilityStudio', ['admin:schedule', 'schedule:', 'admin:stats', 'stats:', 'admin:translation', 'translation:', 'admin:tempVoice', 'tempVoice:']],
];

const ADMIN_MODULE_PREFIXES = Object.freeze([
  ['birthdays', 'admin:birthdays'], ['giveaways', 'admin:giveaways'], ['invites', 'admin:invites'], ['leveling', 'admin:leveling'], ['polls', 'admin:polls'],
  ['faq', 'admin:faq'], ['forms', 'admin:forms'], ['suggestions', 'admin:suggestions'], ['tickets', 'admin:tickets'],
  ['goodbye', 'admin:goodbye'], ['embed', 'admin:embed'], ['starboard', 'admin:starboard'], ['sticky', 'admin:sticky'], ['welcome', 'admin:welcome'],
  ['autoRoles', 'admin:autoRoles'], ['reactionRoles', 'admin:reactionRoles'], ['temporaryRoles', 'admin:temporaryRoles'], ['timedRoles', 'admin:timedRoles'],
  ['verification', 'admin:verification'], ['social', 'admin:social'],
  ['emojis', 'admin:module:emojis'], ['privateRooms', 'admin:privateRooms'], ['schedule', 'admin:schedule'], ['stats', 'admin:stats'], ['tempVoice', 'admin:tempVoice'], ['translation', 'admin:translation'],
]);

function resolveAdminModuleKey(customId) {
  const id = String(customId || '');
  const generic = id.match(/^admin:module:([a-zA-Z0-9_-]+)/);
  if (generic) return generic[1];
  const catalogMatch = (moduleAdminPanels.MODULE_CATALOG || []).find((module) => id === module.route || id.startsWith(`${module.route}:`));
  if (catalogMatch) return catalogMatch.key;
  return ADMIN_MODULE_PREFIXES.find(([, prefix]) => id === prefix || id.startsWith(`${prefix}:`))?.[0] || null;
}

async function enforceAdminModuleAuthority(interaction) {
  const id = String(interaction?.customId || '');
  if (!id.startsWith('admin:')) return false;
  const studio = id.match(/^admin:studio:([a-zA-Z0-9_-]+)$/);
  if (studio) {
    if (typeof adminPanel.canManageStudio !== 'function' || adminPanel.canManageStudio(interaction, studio[1])) return false;
  } else {
    const moduleKey = resolveAdminModuleKey(id);
    if (!moduleKey) return false;
    if (typeof adminPanel.canManageModule !== 'function' || adminPanel.canManageModule(interaction, moduleKey)) return false;
  }
  const payload = { content: '❌ Your guild authority profile does not permit this Studio or module.', flags: MessageFlags.Ephemeral };
  if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
  else await interaction.reply(payload);
  return true;
}

async function callHandler(target, method, ...args) {
  if (typeof target?.[method] !== 'function') return false;
  return Boolean(await target[method](...args));
}

function resolveParentStudio(customId) {
  const id = String(customId || '');
  for (const [studioKey, prefixes] of MODULE_STUDIO_PREFIXES) {
    if (prefixes.some((prefix) => id === prefix || id.startsWith(prefix))) return studioKey;
  }
  return null;
}

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction, client) {
    try {
      if (!interaction?.guildId) return;
      if (interaction.customId && await enforceAdminModuleAuthority(interaction)) return;
      if (await callHandler(adminPanel, 'handleAdminNavigation', interaction)) return;
      if (await callHandler(duplicator, 'handleInteraction', interaction)) return;
      if (interaction.isButton?.() && await callHandler(tempVoiceInteractionHandler, 'handleTempVoiceInteraction', interaction, client)) return;
      if (await callHandler(faqInteractions, 'handleFaqInteraction', interaction)) return;
      if (await callHandler(formsInteractions, 'handleFormsInteraction', interaction)) return;
      if (await callHandler(suggestionsInteractions, 'handleSuggestionsInteraction', interaction)) return;
      if (await callHandler(giveawaysInteractionHandler, 'handleGiveawayInteraction', interaction)) return;
      if (await callHandler(ticketInteractionHandler, 'handleTicketInteraction', interaction, client)) return;
      if (await callHandler(pollsInteractions, 'handlePollInteraction', interaction)) return;
      if (await callHandler(embedPanel, 'handleInteraction', interaction)) return;
      if (await callHandler(levelingInteractions, 'handleInteraction', interaction)) return;
      if (await callHandler(roleSelectorPanel, 'handleInteraction', interaction)) return;
      if (await callHandler(roleStudioPanel, 'handleInteraction', interaction)) return;
      if (await callHandler(privateRoomsPanel, 'handleInteraction', interaction)) return;
      if (await callHandler(birthdaysPanel, 'handleInteraction', interaction)) return;
      if (await callHandler(statsAdminPanel, 'handleInteraction', interaction)) return;
      if (await callHandler(reactionRolesAdminPanel, 'handleInteraction', interaction)) return;
      if (await callHandler(temporaryRolesPanel, 'handleInteraction', interaction)) return;
      if (await callHandler(giveawaysAdminPanel, 'handleInteraction', interaction)) return;
      if (await callHandler(starboardPanel, 'handleInteraction', interaction)) return;
      if (await callHandler(stickyAdminPanel, 'handleInteraction', interaction)) return;
      if (await callHandler(socialAdminPanel, 'handleInteraction', interaction)) return;
      if (await callHandler(socialCreatorActionCompat, 'handleInteraction', interaction)) return;
      if (await callHandler(schedulePanel, 'handleInteraction', interaction)) return;
      if (await callHandler(scheduleDeployment, 'handleInteraction', interaction)) return;
      if (await callHandler(verificationAdminPanel, 'handleInteraction', interaction)) return;
      if (await callHandler(autorolesPanel, 'handleInteraction', interaction)) return;
      if (await callHandler(timedRolesPanel, 'handleInteraction', interaction)) return;
      if (await callHandler(welcomePanel, 'handleInteraction', interaction)) return;
      if (await callHandler(goodbyePanel, 'handleInteraction', interaction)) return;
      if (await callHandler(moduleAdminPanels, 'handleInteraction', interaction)) return;
      if (await callHandler(userPanelInteractions, 'handleInteraction', interaction)) return;
      if (await callHandler(automodPanel, 'handleInteraction', interaction)) return;
      if (await callHandler(modInteractions, 'handleInteraction', interaction)) return;
      if (await callHandler(restoreRequestManager, 'handleInteraction', interaction)) return;
      if (await callHandler(verificationManager, 'handleInteraction', interaction)) return;
    } catch (error) {
      console.error('[InteractionCreate] Interaction handler failed:', error?.stack || error);
      if (!interaction.isRepliable?.()) return;
      const payload = { content: '❌ Something went wrong while handling that interaction.', flags: MessageFlags.Ephemeral };
      if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => null);
      else await interaction.reply(payload).catch(() => null);
    }
  },
};
