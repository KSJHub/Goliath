import { lazy } from 'react';

const Overview = lazy(() => import('../pages/core/Overview'));
const Billing = lazy(() => import('../pages/core/Billing'));
const Notifications = lazy(() => import('../pages/core/Notifications'));
const AutoMod = lazy(() => import('../pages/administration/AutoMod'));
const Admin = lazy(() => import('../pages/administration/AdminRoleWorkspace'));
const Moderation = lazy(() => import('../pages/moderation/Moderation'));
const Cases = lazy(() => import('../pages/moderation/Cases'));
const GeneralSettings = lazy(() => import('../pages/administration/GeneralSettings'));
const Warnings = lazy(() => import('../pages/moderation/Warnings'));
const Forms = lazy(() => import('../pages/modules/forms/FormsWorkflowEnhanced'));
const Modules = lazy(() => import('../pages/modules/Modules'));
const Automation = lazy(() => import('../pages/modules/Automation'));
const EmbedStudio = lazy(() => import('../pages/modules/embed/EmbedStudioEnhanced'));
const Verification = lazy(() => import('../pages/modules/VerificationEnhanced'));
const AutoRoles = lazy(() => import('../pages/modules/AutoRoles'));
const TimedRoles = lazy(() => import('../pages/modules/TimedRoles'));
const Welcome = lazy(() => import('../pages/modules/Welcome'));
const Goodbye = lazy(() => import('../pages/modules/Goodbye'));
const Tickets = lazy(() => import('../pages/modules/tickets/TicketsWorkflowEnhanced'));
const Social = lazy(() => import('../pages/modules/Social'));
const Schedule = lazy(() => import('../pages/modules/Schedule'));
const Invites = lazy(() => import('../pages/modules/Invites'));
const Giveaways = lazy(() => import('../pages/modules/Giveaways'));
const Starboard = lazy(() => import('../pages/modules/Starboard'));
const Sticky = lazy(() => import('../pages/modules/Sticky'));
const TempVoice = lazy(() => import('../pages/modules/TempVoice'));
const Timeline = lazy(() => import('../pages/modules/Timeline'));
const Translation = lazy(() => import('../pages/modules/Translation'));
const ReactionRoles = lazy(() => import('../pages/modules/ReactionRoles'));
const Leveling = lazy(() => import('../pages/modules/Leveling'));
const Polls = lazy(() => import('../pages/modules/Polls'));
const Stats = lazy(() => import('../pages/modules/Stats'));
const Restore = lazy(() => import('../pages/security/Restore'));
const Security = lazy(() => import('../pages/security/Security'));
const MediaTools = lazy(() => import('../pages/core/MediaTools'));
const Logs = lazy(() => import('../pages/core/Logs'));
const OwnerView = lazy(() => import('../pages/owner/OwnerOverviewPhase2'));
const OwnerGlobalServers = lazy(() => import('../pages/owner/GlobalServers'));
const OwnerRuntimeMonitor = lazy(() => import('../pages/owner/RuntimeMonitor'));
const OwnerBillingAdmin = lazy(() => import('../pages/owner/BillingAdmin'));
const OwnerSecurityCenter = lazy(() => import('../pages/owner/SecurityCenter'));
const OwnerBackupCenter = lazy(() => import('../pages/owner/BackupCenter'));
const OwnerDeploymentCenter = lazy(() => import('../pages/owner/DeploymentCenter'));
const OwnerFormsHub = lazy(() => import('../pages/owner/FormsHub'));
const OwnerTicketsHub = lazy(() => import('../pages/owner/TicketsHub'));
const OwnerTranslationHub = lazy(() => import('../pages/owner/TranslationHub'));
const OwnerPermissionHealth = lazy(() => import('../pages/owner/PermissionHealth'));

export const DASHBOARD_LAYOUT = { navbarExpandedWidth: '280px', navbarCollapsedWidth: '72px', topBarHeight: '72px', pageGap: '20px', cardRadius: '20px', cardPadding: '24px', sectionPadding: '18px' };
export const NAV_ITEMS = [
  { key: 'overview', label: 'Overview', icon: 'overview', path: '/overview' },
  { key: 'administration', label: 'Administration', icon: 'admin', children: [
    { key: 'adminPage', label: 'Admin', icon: 'admin', path: '/admin' },
    { key: 'automod', label: 'AutoMod', icon: 'automod', path: '/automod' },
    { key: 'generalSettings', label: 'General Settings', icon: 'generalSettings', path: '/generalSettings' },
  ] },
  { key: 'moderationGroup', label: 'Moderation', icon: 'admin', children: [
    { key: 'moderation', label: 'Moderation', icon: 'admin', path: '/moderation' },
    { key: 'cases', label: 'Cases', icon: 'warnings', path: '/cases' },
    { key: 'warnings', label: 'Warnings', icon: 'warnings', path: '/warnings' },
  ] },
  { key: 'modules', label: 'Modules', icon: 'modules', path: '/modules' },
];
export const NAV_BOTTOM = [
  { key: 'securityCenter', label: 'Security Center', icon: 'admin', children: [
    { key: 'restore', label: 'Restore', icon: 'admin', path: '/restore' },
    { key: 'security', label: 'Security', icon: 'admin', path: '/security' },
  ] },
  { key: 'notifications', label: 'Notifications', icon: 'logs', path: '/notifications' },
  { key: 'mediaTools', label: 'Media Tools', icon: 'modules', path: '/media-tools' },
  { key: 'logs', label: 'Logs', icon: 'logs', path: '/logs' },
];

export const ROUTES = [
  { key: 'overview', label: 'Overview', icon: 'overview', path: '/overview', component: Overview },
  { key: 'billing', label: 'Billing', icon: 'admin', path: '/billing', component: Billing, hidden: true },
  { key: 'notifications', label: 'Notifications', icon: 'logs', path: '/notifications', component: Notifications },
  { key: 'ownerView', label: 'Owner View', icon: 'admin', path: '/owner', component: OwnerView, ownerOnly: true },
  { key: 'ownerServers', label: 'Global Servers', icon: 'modules', path: '/owner/servers', component: OwnerGlobalServers, ownerOnly: true },
  { key: 'ownerRuntime', label: 'Runtime Monitor', icon: 'admin', path: '/owner/runtime', component: OwnerRuntimeMonitor, ownerOnly: true },
  { key: 'ownerBilling', label: 'Billing Admin', icon: 'admin', path: '/owner/billing', component: OwnerBillingAdmin, ownerOnly: true },
  { key: 'ownerSecurity', label: 'Owner Security', icon: 'admin', path: '/owner/security', component: OwnerSecurityCenter, ownerOnly: true },
  { key: 'ownerPermissionHealth', label: 'Permission Health', icon: 'admin', path: '/owner/permission-health', component: OwnerPermissionHealth, ownerOnly: true },
  { key: 'ownerBackups', label: 'Backup Center', icon: 'admin', path: '/owner/backups', component: OwnerBackupCenter, ownerOnly: true },
  { key: 'ownerDeployments', label: 'Deployment Center', icon: 'modules', path: '/owner/deployments', component: OwnerDeploymentCenter, ownerOnly: true },
  { key: 'ownerForms', label: 'Forms Hub', icon: 'modules', path: '/owner/forms', component: OwnerFormsHub, ownerOnly: true },
  { key: 'ownerTickets', label: 'Tickets Hub', icon: 'modules', path: '/owner/tickets', component: OwnerTicketsHub, ownerOnly: true },
  { key: 'ownerTranslation', label: 'Translation Hub', icon: 'modules', path: '/owner/translation', component: OwnerTranslationHub, ownerOnly: true },
  { key: 'modules', label: 'Modules', icon: 'modules', path: '/modules', component: Modules },
  { key: 'automation', label: 'Automation', icon: 'modules', path: '/automation', component: Automation, hidden: true },
  { key: 'embedStudio', label: 'Embed Studio', icon: 'modules', path: '/embed-studio', component: EmbedStudio, hidden: true },
  { key: 'verification', label: 'Verification', icon: 'modules', path: '/verification', component: Verification, hidden: true },
  { key: 'autoRoles', label: 'Auto Roles', icon: 'modules', path: '/autoroles', component: AutoRoles, hidden: true },
  { key: 'timedRoles', label: 'Timed Roles', icon: 'modules', path: '/timed-roles', component: TimedRoles, hidden: true },
  { key: 'welcome', label: 'Welcome', icon: 'modules', path: '/welcome', component: Welcome, hidden: true },
  { key: 'goodbye', label: 'Goodbye', icon: 'modules', path: '/goodbye', component: Goodbye, hidden: true },
  { key: 'reactionRoles', label: 'Reaction Roles', icon: 'modules', path: '/reaction-roles', component: ReactionRoles, hidden: true },
  { key: 'leveling', label: 'Leveling', icon: 'modules', path: '/leveling', component: Leveling, hidden: true },
  { key: 'forms', label: 'Forms', icon: 'modules', path: '/forms', component: Forms, hidden: true },
  { key: 'giveaways', label: 'Giveaways', icon: 'modules', path: '/giveaways', component: Giveaways, hidden: true },
  { key: 'polls', label: 'Polls', icon: 'modules', path: '/polls', component: Polls, hidden: true },
  { key: 'stats', label: 'Stats', icon: 'overview', path: '/stats', component: Stats, hidden: true },
  { key: 'social', label: 'Social Studio', icon: 'modules', path: '/social', component: Social, hidden: true },
  { key: 'schedule', label: 'Schedule', icon: 'modules', path: '/schedule', component: Schedule, hidden: true },
  { key: 'invites', label: 'Invite Studio', icon: 'modules', path: '/invites', component: Invites, hidden: true },
  { key: 'starboard', label: 'Starboard', icon: 'modules', path: '/starboard', component: Starboard, hidden: true },
  { key: 'sticky', label: 'Sticky Messages', icon: 'modules', path: '/sticky', component: Sticky, hidden: true },
  { key: 'tempVoice', label: 'Temp Voice', icon: 'modules', path: '/tempvoice', component: TempVoice, hidden: true },
  { key: 'tickets', label: 'Tickets', icon: 'modules', path: '/tickets', component: Tickets, hidden: true },
  { key: 'timeline', label: 'Timeline', icon: 'modules', path: '/timeline', component: Timeline, hidden: true },
  { key: 'translation', label: 'Translation', icon: 'modules', path: '/translation', component: Translation, hidden: true },
  { key: 'generalSettings', label: 'General Settings', icon: 'generalSettings', path: '/generalSettings', component: GeneralSettings },
  { key: 'automod', label: 'AutoMod', icon: 'automod', path: '/automod', component: AutoMod },
  { key: 'admin', label: 'Admin', icon: 'admin', path: '/admin', component: Admin },
  { key: 'moderation', label: 'Moderation', icon: 'admin', path: '/moderation', component: Moderation },
  { key: 'cases', label: 'Cases', icon: 'warnings', path: '/cases', component: Cases },
  { key: 'warnings', label: 'Warnings', icon: 'warnings', path: '/warnings', component: Warnings },
  { key: 'security', label: 'Security', icon: 'admin', path: '/security', component: Security },
  { key: 'restore', label: 'Restore', icon: 'admin', path: '/restore', component: Restore },
  { key: 'mediaTools', label: 'Media Tools', icon: 'modules', path: '/media-tools', component: MediaTools },
  { key: 'logs', label: 'Logs', icon: 'logs', path: '/logs', component: Logs },
];

export const navItems = NAV_ITEMS;
export const navBottomItems = NAV_BOTTOM;
export const PAGE_LAYOUTS = Object.fromEntries(ROUTES.map((route) => [route.key, { title: route.label, description: route.key === 'schedule' ? 'Timezone-aware events, recurring schedules, RSVPs and reminders.' : route.key === 'invites' ? 'Invite attribution, rewards, leaderboard, history and managed invites.' : `${route.label} management.`, emptyDescription: `Select a server to manage ${route.label}.`, sections: [] }]));
export default DASHBOARD_LAYOUT;
