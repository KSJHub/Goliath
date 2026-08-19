const { getRuntimePaths } = require('../../config/runtimePaths');

const runtimePaths = getRuntimePaths(process.env.BOT_MODE);

const DEFAULT_GENERAL_SETTINGS = Object.freeze({
  prefix: '!',
  appealUrl: '',
  dashboardEnabled: true,

  managerRoleIds: [],
  dashboardAccessRoleIds: [],
  commandManagerRoleIds: [],
  restrictedChannelIds: [],

  commandNotFoundEnabled: true,
  wrongCommandUsageEnabled: true,
  noCommandPermissionsEnabled: true,
  disabledInChannelEnabled: false,
  commandCooldownEnabled: true,
  instantDeleteDataEnabled: false,
});

const DEFAULT_SUBSCRIPTION = Object.freeze({
  plan: 'free',
  status: 'active',
  source: 'system',
  expiresAt: null,
});

const DEFAULT_LOGS = Object.freeze({
  enabled: true,

  channels: {
    general: null,
    moderation: null,
    admin: null,
    automod: null,
    member: null,
    messageDelete: null,
    messageEdit: null,
    voice: null,
  },

  events: {},
});

const DEFAULT_SECURITY = Object.freeze({
  enabled: true,
  threatLevel: 'low',
  totalIncidents: 0,
  criticalIncidents: 0,
  incidents: [],

  lockdown: {
    active: false,
    channels: [],
    bypassRoleIds: [],
  },

  ownerMonitoring: {
    enabled: true,
    webhookMirrorEnabled: true,
  },
});

const DEFAULT_SERVER_BACKUPS = Object.freeze({
  enabled: true,

  storage: {
    path: process.env.SERVER_BACKUP_DIR || runtimePaths.backups,
  },

  retention: {
    maxBackups: Number(process.env.SERVER_BACKUP_RETENTION || 4),
    autoCleanup: true,
  },
});

const DEFAULT_EMBED = Object.freeze({
  title: '',
  description: '',
  color: '#5865F2',

  author: {
    name: '',
    iconURL: '',
    url: '',
  },

  thumbnailURL: '',
  imageURL: '',

  footer: {
    text: '',
    iconURL: '',
  },

  fields: [],

  buttons: [],
});

const DEFAULT_EMBED_DEFAULTS = Object.freeze({
  welcome: null,
  leave: null,
  logs: null,
  moderation: null,
  tickets: null,
  appeals: null,
  announcements: null,
});

const DEFAULT_TICKETS = Object.freeze({
  settings: {
    enabled: true,

    numbering: {
      nextNumber: 1,
      prefix: 'ticket',
      padding: 4,
    },

    tickets: {
      allowMultipleTickets: true,
      oneActivePerType: true,
      defaultPriority: 'low',
      defaultStatus: 'open',
      cooldownMs: 60 * 1000,
      maxActiveTicketsPerUser: 5,
    },

    permissions: {
      allowCreatorView: true,
      allowUserClose: false,
      staffRoleIds: [],
      managerRoleIds: [],
      viewerRoleIds: [],
    },

    discord: {
      categoryId: null,
      archiveCategoryId: null,
      logsChannelId: null,
      transcriptsChannelId: null,
    },

    transcripts: {
      enabled: true,
      saveHtml: true,
      saveJson: true,
      uploadToDiscord: true,
      includeAttachments: true,
      includeEmbeds: true,
      autoGenerateOnClose: true,
      autoGenerateOnArchive: true,
    },

    dashboard: {
      realtimeEnabled: true,
      allowRealtimeSync: true,
    },
  },

  panels: [],
  tickets: [],
  analytics: {},
});

const DEFAULT_MODULES = Object.freeze({
  sticky: {
    enabled: true,
    channels: {},
  },
  starboard: {
    enabled: true,
    channelId: null,
    threshold: 3,
    emoji: '⭐',
    allowBotMessages: false,
    allowSelfStar: false,
    posts: {},
  },
  giveaways: {
    enabled: true,
    giveaways: {},
    settings: {
      defaultWinnerCount: 1,
      allowBotEntries: false,
    },
  },
  tempVoice: {
    enabled: true,
    hubs: {},
    channels: {},
    settings: {
      defaultUserLimit: 0,
      deleteWhenEmpty: true,
    },
  },
  suggestions: {
    enabled: true,
    items: {},
  },
  timeline: {
    enabled: true,
    events: [],
    settings: {
      maxEvents: 250,
      auditEnabled: true,
    },
    stats: {
      totalEvents: 0,
      clearedEvents: 0,
    },
  },
  forms: {
    enabled: true,
    settings: {
      defaultAction: 'create_ticket',
      dmSubmitter: true,
      requireStaffReview: true,
    },
    forms: {},
    submissions: {},
    panels: {},
    analytics: {
      submitted: 0,
      ticketsCreated: 0,
      approved: 0,
      denied: 0,
    },
  },
  polls: {
    enabled: false,
    settings: {
      defaultChannelId: null,
      allowMultipleVotes: false,
      anonymousVotes: false,
      autoCloseHours: 24,
    },
    polls: {},
    analytics: {
      created: 0,
      deployed: 0,
      closed: 0,
      votes: 0,
    },
  },
  stats: {
    enabled: false,
    trackMessages: true,
    trackVoice: true,
    trackMembers: true,
    ignoreBots: true,
    ignoredChannels: [],
    ignoredRoles: [],
    counters: [],
    settings: {
      showLiveGuildStats: true,
      showModuleStats: true,
      showStoredWorkflowStats: true,
      retentionDays: 30,
    },
    data: {
      messages: {},
      voice: {},
      members: {
        joins: 0,
        leaves: 0,
        snapshots: [],
      },
    },
    snapshots: [],
    analytics: {
      viewed: 0,
    },
  },
  translation: {
    enabled: false,
    settings: {
      provider: 'manual',
      autoDetect: true,
      threadMode: true,
      translateEdits: false,
      defaultSourceLanguage: 'auto',
      defaultTargetLanguage: 'en',
      targetLanguages: ['en'],
      maxCharacters: 1500,
      cooldownMs: 10000,
      createThreadForManual: true,
      createThreadForAuto: true,
      logTranslations: true,
    },
    channels: {},
    userPreferences: {},
    cache: {},
    analytics: {
      manualTranslations: 0,
      autoTranslations: 0,
      threadsCreated: 0,
      failedTranslations: 0,
    },
  },
  duplicator: {
    enabled: true,
    hidden: true,
    ownerOnly: true,
    allowedUserIds: [],
    allowedGuildIds: [],
    logChannelId: null,
    templates: {},
    settings: {
      createRollbackBackup: true,
      requireFinalConfirm: true,
      maxSessionMinutes: 20,
    },
    analytics: {
      runs: 0,
      successfulRuns: 0,
      failedRuns: 0,
      exports: 0,
      builds: 0,
      copies: 0,
    },
  },
});

const DEFAULT_GUILD_DATA = Object.freeze({
  guildId: null,
  guildName: null,

  createdAt: null,
  updatedAt: null,

  subscription: DEFAULT_SUBSCRIPTION,

  generalSettings: DEFAULT_GENERAL_SETTINGS,
  logs: DEFAULT_LOGS,
  security: DEFAULT_SECURITY,
  serverBackups: DEFAULT_SERVER_BACKUPS,

  embedDefaults: DEFAULT_EMBED_DEFAULTS,
  embedPresets: {},

  embedBuilder: {
    draft: DEFAULT_EMBED,
    templates: {},
  },

  modules: DEFAULT_MODULES,

  tickets: DEFAULT_TICKETS,
});

module.exports = {
  DEFAULT_GUILD_DATA,
  DEFAULT_SUBSCRIPTION,
  DEFAULT_GENERAL_SETTINGS,
  DEFAULT_LOGS,
  DEFAULT_SECURITY,
  DEFAULT_SERVER_BACKUPS,
  DEFAULT_EMBED,
  DEFAULT_EMBED_DEFAULTS,
  DEFAULT_TICKETS,
  DEFAULT_MODULES,
};
