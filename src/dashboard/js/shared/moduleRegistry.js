export const MODULE_CATEGORIES = { feature: 'Features' };
export const MODULE_STATUSES = { live: 'Live', backendReady: 'Backend Ready' };
export const MODULE_STATUS_META = {
  [MODULE_STATUSES.live]: { label: 'Live', tone: 'success' },
  [MODULE_STATUSES.backendReady]: { label: 'Dashboard Ready', tone: 'info' },
};

export const moduleRegistry = [
  { key: 'autoRoles', name: 'Auto Roles', icon: 'AR', route: '/autoroles', category: MODULE_CATEGORIES.feature, status: MODULE_STATUSES.backendReady, enabled: false, summary: 'Assign roles automatically when members join or meet conditions.' },
  { key: 'automation', name: 'Automation', icon: 'AU', route: '/automation', category: MODULE_CATEGORIES.feature, status: MODULE_STATUSES.backendReady, enabled: false, summary: 'Rules, triggers and execution history for server workflows.' },
  { key: 'embedBuilder', name: 'Embed Studio', icon: 'ES', route: '/embed-studio', category: MODULE_CATEGORIES.feature, status: MODULE_STATUSES.backendReady, enabled: true, summary: 'Build, preview, save and manage Discord embeds from the dashboard.' },
  { key: 'forms', name: 'Forms', icon: 'FM', route: '/forms', category: MODULE_CATEGORIES.feature, status: MODULE_STATUSES.backendReady, enabled: true, summary: 'Universal forms, submissions, analytics and workflow foundations.' },
  { key: 'giveaways', name: 'Giveaways', icon: 'GW', route: '/giveaways', category: MODULE_CATEGORIES.feature, status: MODULE_STATUSES.backendReady, enabled: false, summary: 'Create and manage server giveaways.' },
  { key: 'goodbye', name: 'Goodbye', icon: 'GB', route: '/goodbye', category: MODULE_CATEGORIES.feature, status: MODULE_STATUSES.backendReady, enabled: false, summary: 'Public farewell messages, Embed Studio templates and delivery analytics.' },
  { key: 'invites', name: 'Invite Studio', icon: 'IV', route: '/invites', category: MODULE_CATEGORIES.feature, status: MODULE_STATUSES.backendReady, enabled: true, summary: 'Invite attribution, active referral tracking, reward roles, managed invites, leaderboard, history and health.' },
  { key: 'leveling', name: 'Leveling', icon: 'LV', route: '/leveling', category: MODULE_CATEGORIES.feature, status: MODULE_STATUSES.backendReady, enabled: false, summary: 'XP, levels, leaderboards, rewards and level roles.' },
  { key: 'polls', name: 'Polls', icon: 'PL', route: '/polls', category: MODULE_CATEGORIES.feature, status: MODULE_STATUSES.backendReady, enabled: false, summary: 'Create and manage community choice posts.' },
  { key: 'reactionRoles', name: 'Reaction Roles', icon: 'RR', route: '/reaction-roles', category: MODULE_CATEGORIES.feature, status: MODULE_STATUSES.backendReady, enabled: false, summary: 'Reaction role panels, emoji mappings, deployments and analytics.' },
  { key: 'schedule', name: 'Schedule', icon: 'SC', route: '/schedule', category: MODULE_CATEGORIES.feature, status: MODULE_STATUSES.backendReady, enabled: true, summary: 'Timezone-aware events, recurring schedules, RSVPs, waitlists, reminders and Discord deployments.' },
  { key: 'social', name: 'Social Studio', icon: 'SS', route: '/social', category: MODULE_CATEGORIES.feature, status: MODULE_STATUSES.live, enabled: true, summary: 'Zero-credential creator monitoring, routing, templates, operations, diagnostics and alerts for Twitch, YouTube, Kick and X.' },
  { key: 'starboard', name: 'Starboard', icon: 'SB', route: '/starboard', category: MODULE_CATEGORIES.feature, status: MODULE_STATUSES.backendReady, enabled: false, summary: 'Highlight popular server messages in a starboard channel.' },
  { key: 'stats', name: 'Stats', icon: 'ST', route: '/stats', category: MODULE_CATEGORIES.feature, status: MODULE_STATUSES.backendReady, enabled: false, summary: 'Activity reporting, rankings and Statbot-style counter channels.' },
  { key: 'sticky', name: 'Sticky Messages', icon: 'SM', route: '/sticky', category: MODULE_CATEGORIES.feature, status: MODULE_STATUSES.backendReady, enabled: false, summary: 'Keep important channel messages pinned to the bottom of chat.' },
  { key: 'tempVoice', name: 'Temp Voice', icon: 'TV', route: '/tempvoice', category: MODULE_CATEGORIES.feature, status: MODULE_STATUSES.backendReady, enabled: false, summary: 'Temporary voice channels and voice room automation.' },
  { key: 'tickets', name: 'Tickets', icon: 'TK', route: '/tickets', category: MODULE_CATEGORIES.feature, status: MODULE_STATUSES.backendReady, enabled: false, summary: 'Ticket panels, claims, closing, transcripts, recovery and analytics.' },
  { key: 'timedRoles', name: 'Timed Roles', icon: 'TM', route: '/timed-roles', category: MODULE_CATEGORIES.feature, status: MODULE_STATUSES.backendReady, enabled: false, summary: 'Award progression roles when members reach configured server-tenure milestones.' },
  { key: 'translation', name: 'Translation', icon: 'TR', route: '/translation', category: MODULE_CATEGORIES.feature, status: MODULE_STATUSES.backendReady, enabled: false, requiredFeature: 'translation.hub', requiredPlan: 'pro', summary: 'Language preferences, provider-ready storage and translation controls.' },
  { key: 'verification', name: 'Verification', icon: 'VF', route: '/verification', category: MODULE_CATEGORIES.feature, status: MODULE_STATUSES.backendReady, enabled: false, summary: 'Member verification and onboarding protection.' },
  { key: 'welcome', name: 'Welcome', icon: 'WC', route: '/welcome', category: MODULE_CATEGORIES.feature, status: MODULE_STATUSES.backendReady, enabled: false, summary: 'Public welcome messages, member DMs, templates and onboarding analytics.' },
].sort((a, b) => a.name.localeCompare(b.name));

export const futureModules = [];
export function getModuleStatusMeta(status) { return MODULE_STATUS_META[status] || MODULE_STATUS_META[MODULE_STATUSES.backendReady]; }
export default moduleRegistry;
