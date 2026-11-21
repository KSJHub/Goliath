import { DASHBOARD_EMOJIS as E } from './PageShell.jsx';
export const MODULE_CATEGORIES = Object.freeze({ feature: 'Features', security: 'Security Studio', community: 'Community Studio', role: 'Role Studio', message: 'Message Studio', feedback: 'Feedback Studio', social: 'Social Studio', utility: 'Utility Studio', automation: 'Automation' });
export const MODULE_STUDIOS = Object.freeze([
  { name: MODULE_CATEGORIES.security, icon: E.SECURITY },
  { name: MODULE_CATEGORIES.community, icon: E.COMMUNITIES },
  { name: MODULE_CATEGORIES.role, icon: E.ROLES },
  { name: MODULE_CATEGORIES.message, icon: E.MESSAGES },
  { name: MODULE_CATEGORIES.feedback, icon: E.SUGGESTIONS },
  { name: MODULE_CATEGORIES.social, icon: E.SOCIAL },
  { name: MODULE_CATEGORIES.utility, icon: E.BUILDER },
  { name: MODULE_CATEGORIES.automation, icon: E.AUTOMATION },
]);
export const MODULE_STATUSES = { live: 'Live', backendReady: 'Backend Ready' };
export const MODULE_STATUS_META = {
  [MODULE_STATUSES.live]: { label: 'Live', tone: 'success' },
  [MODULE_STATUSES.backendReady]: { label: 'Dashboard Ready', tone: 'info' },
};

export const moduleRegistry = [
  { key: 'freeGames', name: 'Games', icon: E.GAMEPAD, route: '/games', category: MODULE_CATEGORIES.utility, status: MODULE_STATUSES.backendReady, enabled: false, summary: 'Game updates, publisher announcements, free offers and configurable notifications.' },
  { key: 'autoRoles', name: 'Auto Roles', icon: E.ROLES, route: '/autoroles', category: MODULE_CATEGORIES.role, status: MODULE_STATUSES.backendReady, enabled: false, summary: 'Assign roles automatically when members join or meet conditions.' },
  { key: 'automation', name: 'Automation', icon: E.AUTOMATION, route: '/automation', category: MODULE_CATEGORIES.automation, status: MODULE_STATUSES.backendReady, enabled: false, summary: 'Rules, triggers and execution history for server workflows.' },
  { key: 'birthdays', name: 'Birthdays', icon: E.BIRTHDAY, route: '/birthdays', category: MODULE_CATEGORIES.community, status: MODULE_STATUSES.backendReady, enabled: false, summary: 'Birthday announcements, optional birthday roles, upcoming dates and member preferences.' },
  { key: 'embedBuilder', name: 'Embed Studio', icon: E.DESIGN, route: '/embed-studio', category: MODULE_CATEGORIES.message, status: MODULE_STATUSES.backendReady, enabled: true, summary: 'Build, preview, save and manage Discord embeds from the dashboard.' },
  { key: 'emojis', name: 'Emoji Bank', icon: E.EMOJI, route: '/modules?panel=emojis', category: MODULE_CATEGORIES.utility, status: MODULE_STATUSES.backendReady, enabled: false, summary: 'Discord-hosted Goliath emoji bank with Emoji.gg imports and up to 100 selected emojis per guild.' },
  { key: 'forms', name: 'Forms', icon: E.CLIPBOARD, route: '/forms', category: MODULE_CATEGORIES.feedback, status: MODULE_STATUSES.backendReady, enabled: true, summary: 'Universal forms, submissions, analytics and workflow foundations.' },
  { key: 'giveaways', name: 'Giveaways', icon: E.PREMIUM_TICKET, route: '/giveaways', category: MODULE_CATEGORIES.community, status: MODULE_STATUSES.backendReady, enabled: false, summary: 'Create and manage server giveaways.' },
  { key: 'goodbye', name: 'Goodbye', icon: E.GOODBYE, route: '/goodbye', category: MODULE_CATEGORIES.message, status: MODULE_STATUSES.backendReady, enabled: false, summary: 'Public farewell messages, Embed Studio templates and delivery analytics.' },
  { key: 'invites', name: 'Invite Studio', icon: E.LINK, route: '/invites', category: MODULE_CATEGORIES.community, status: MODULE_STATUSES.backendReady, enabled: true, summary: 'Invite attribution, active referral tracking, reward roles, managed invites, leaderboard, history and health.' },
  { key: 'leveling', name: 'Leveling', icon: E.TREND, route: '/leveling', category: MODULE_CATEGORIES.community, status: MODULE_STATUSES.backendReady, enabled: false, summary: 'XP, levels, leaderboards, rewards and level roles.' },
  { key: 'polls', name: 'Polls', icon: E.CHART, route: '/polls', category: MODULE_CATEGORIES.community, status: MODULE_STATUSES.backendReady, enabled: false, summary: 'Create and manage community choice posts.' },
  { key: 'privateRooms', name: 'Private Rooms', icon: E.LOCK, route: '/private-rooms', category: MODULE_CATEGORIES.utility, status: MODULE_STATUSES.backendReady, enabled: false, summary: 'Temporary private conversation rooms with approvals, participant controls, audit history and transcripts.' },
  { key: 'reactionRoles', name: 'Reaction Roles', icon: E.EMOJI, route: '/reaction-roles', category: MODULE_CATEGORIES.role, status: MODULE_STATUSES.backendReady, enabled: false, summary: 'Reaction role panels, emoji mappings, deployments and analytics.' },
  { key: 'roleSelector', name: 'Role Selector', icon: E.ROLE_TAG, route: '/role-selector', category: MODULE_CATEGORIES.role, status: MODULE_STATUSES.backendReady, enabled: false, summary: 'Universal self-role categories with built-in colours, custom groups, dynamic role creation, placement and usage stats.' },
  { key: 'schedule', name: 'Schedule', icon: E.DATE, route: '/schedule', category: MODULE_CATEGORIES.utility, status: MODULE_STATUSES.backendReady, enabled: true, summary: 'Timezone-aware events, recurring schedules, RSVPs, waitlists, reminders and Discord deployments.' },
  { key: 'social', name: 'Social Studio', icon: E.SOCIAL, route: '/social', category: MODULE_CATEGORIES.social, status: MODULE_STATUSES.live, enabled: true, summary: 'Zero-credential creator monitoring, routing, templates, operations, diagnostics and alerts for Twitch, YouTube, Kick and X.' },
  { key: 'starboard', name: 'Starboard', icon: E.SPARKLES, route: '/starboard', category: MODULE_CATEGORIES.message, status: MODULE_STATUSES.backendReady, enabled: false, summary: 'Highlight popular server messages in a starboard channel.' },
  { key: 'stats', name: 'Stats', icon: E.CHART, route: '/stats', category: MODULE_CATEGORIES.utility, status: MODULE_STATUSES.backendReady, enabled: false, summary: 'Activity reporting, rankings and Statbot-style counter channels.' },
  { key: 'sticky', name: 'Sticky Messages', icon: E.MESSAGES, route: '/sticky', category: MODULE_CATEGORIES.message, status: MODULE_STATUSES.backendReady, enabled: false, summary: 'Keep important channel messages pinned to the bottom of chat.' },
  { key: 'suggestions', name: 'Suggestions', icon: E.SUGGESTIONS, route: '/suggestions', category: MODULE_CATEGORIES.feedback, status: MODULE_STATUSES.backendReady, enabled: false, summary: 'Suggestion collection, voting, review workflow, destinations, moderation history and analytics.' },
  { key: 'temporaryRoles', name: 'Temporary Roles', icon: E.TIMER, route: '/temporary-roles', category: MODULE_CATEGORIES.role, status: MODULE_STATUSES.backendReady, enabled: false, summary: 'Assign, renew, expire, remove and repair duration-based member roles.' },
  { key: 'tempVoice', name: 'Temp Voice', icon: E.VOICE, route: '/tempvoice', category: MODULE_CATEGORIES.utility, status: MODULE_STATUSES.backendReady, enabled: false, summary: 'Temporary voice channels and voice room automation.' },
  { key: 'tickets', name: 'Tickets', icon: E.TICKETS, route: '/tickets', category: MODULE_CATEGORIES.feedback, status: MODULE_STATUSES.backendReady, enabled: false, summary: 'Ticket panels, claims, closing, transcripts, recovery and analytics.' },
  { key: 'timedRoles', name: 'Timed Roles', icon: E.TIMER, route: '/timed-roles', category: MODULE_CATEGORIES.role, status: MODULE_STATUSES.backendReady, enabled: false, summary: 'Award progression roles when members reach configured server-tenure milestones.' },
  { key: 'translation', name: 'Translation', icon: E.GLOBE, route: '/translation', category: MODULE_CATEGORIES.utility, status: MODULE_STATUSES.backendReady, enabled: false, requiredFeature: 'translation.hub', requiredPlan: 'pro', summary: 'Language preferences, provider-ready storage and translation controls.' },
  { key: 'verification', name: 'Verification', icon: E.SECURITY, route: '/verification', category: MODULE_CATEGORIES.security, status: MODULE_STATUSES.backendReady, enabled: false, summary: 'Member verification and onboarding protection.' },
  { key: 'welcome', name: 'Welcome', icon: E.JOIN, route: '/welcome', category: MODULE_CATEGORIES.message, status: MODULE_STATUSES.backendReady, enabled: false, summary: 'Public welcome messages, member DMs, templates and onboarding analytics.' },
].sort((a, b) => a.name.localeCompare(b.name));

export const futureModules = [];
export function getModuleStatusMeta(status) { return MODULE_STATUS_META[status] || MODULE_STATUS_META[MODULE_STATUSES.backendReady]; }
export default moduleRegistry;
