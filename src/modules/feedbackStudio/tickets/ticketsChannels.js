'use strict';

/**
 * Canonical Tickets channels layer.
 *
 * This file is the single source of truth for the responsibilities
 * consolidated below. Legacy ticket implementation files were removed.
 */

let ticketNamingApi;
let ticketPermissionsApi;
let ticketChannelManagerApi;
let ticketGuardApi;

// ============================================================================
// ticketNaming
// ============================================================================
{
  'use strict';

  const DEFAULT_TICKET_TYPE = 'ticket';
  const DEFAULT_TICKET_USER = 'user';
  const DEFAULT_TICKET_NUMBER = 0;
  const DEFAULT_TICKET_PADDING = 4;
  const DEFAULT_USERNAME_LENGTH = 10;
  const MAX_DISCORD_CHANNEL_NAME_LENGTH = 90;

  function cleanTicketType(value, fallback = DEFAULT_TICKET_TYPE) {
    return (
      String(value || fallback)
        .toLowerCase()
        .replace(/_/g, '-')
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || fallback
    );
  }

  function cleanChannelPart(value, fallback = DEFAULT_TICKET_USER, maxLength = DEFAULT_USERNAME_LENGTH) {
    const cleaned = String(value || fallback)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, maxLength);

    return cleaned || fallback;
  }

  function getTicketCreatorName(ticket, guild = null) {
    const metadataName =
      ticket?.metadata?.creatorUsername ||
      ticket?.metadata?.creatorTag ||
      ticket?.creatorUsername ||
      ticket?.username ||
      null;

    if (metadataName) return metadataName;

    const creatorId =
      ticket?.creatorId ||
      ticket?.userId ||
      ticket?.createdBy ||
      null;

    if (creatorId && guild?.members?.cache?.has(creatorId)) {
      const member = guild.members.cache.get(creatorId);

      return (
        member?.user?.username ||
        member?.displayName ||
        creatorId
      );
    }

    return creatorId || DEFAULT_TICKET_USER;
  }

  function getTicketNumber(ticket) {
    return (
      ticket?.number ||
      ticket?.ticketNumber ||
      String(ticket?.displayId || '').match(/(\d+)$/)?.[1] ||
      DEFAULT_TICKET_NUMBER
    );
  }

  function buildTicketChannelName(ticket, guild = null, options = {}) {
    if (!ticket) return `${DEFAULT_TICKET_TYPE}-${DEFAULT_TICKET_USER}-0000`;

    const type = cleanTicketType(ticket.type || options.type || DEFAULT_TICKET_TYPE);
    const username = cleanChannelPart(
      getTicketCreatorName(ticket, guild),
      DEFAULT_TICKET_USER,
      options.usernameLength || DEFAULT_USERNAME_LENGTH
    );

    const padding = Number(options.padding || DEFAULT_TICKET_PADDING);
    const number = String(getTicketNumber(ticket)).padStart(padding, '0');

    return `${type}-${username}-${number}`.slice(0, MAX_DISCORD_CHANNEL_NAME_LENGTH);
  }

  ticketNamingApi = {
    DEFAULT_TICKET_TYPE,
    DEFAULT_TICKET_USER,
    DEFAULT_TICKET_NUMBER,
    DEFAULT_TICKET_PADDING,
    DEFAULT_USERNAME_LENGTH,
    MAX_DISCORD_CHANNEL_NAME_LENGTH,

    cleanTicketType,
    cleanChannelPart,
    getTicketCreatorName,
    getTicketNumber,
    buildTicketChannelName,
  };
}

// ============================================================================
// ticketPermissions
// ============================================================================
{
  'use strict';

  const {
    PermissionsBitField,
  } = require('discord.js');

  const {
    getTicketSettings,
    getPanel,
  } = require('./tickets');

  const TICKET_ACTIONS = Object.freeze({
    VIEW: 'view',
    VIEW_ALL: 'view_all',

    CREATE: 'create',

    UPDATE: 'update',

    CLAIM: 'claim',
    ASSIGN: 'assign',

    CLOSE: 'close',
    REOPEN: 'reopen',

    APPROVE: 'approve',
    DENY: 'deny',

    ARCHIVE: 'archive',
    DELETE: 'delete',

    ADD_NOTE: 'add_note',

    MANAGE_SETTINGS: 'manage_settings',
    MANAGE_PANELS: 'manage_panels',
  });

  const LOCKED_STATUSES = [
    'closed',
    'archived',
    'deleted',
  ];

  function normaliseArray(value) {
    if (!Array.isArray(value)) {
      return [];
    }

    return [...new Set(value.filter(Boolean).map(String))];
  }

  function normaliseStatus(status) {
    return String(status || 'open').toLowerCase();
  }

  function hasRole(member, roleId) {
    if (!member || !roleId) return false;

    return Boolean(
      member.roles?.cache?.has(String(roleId))
    );
  }

  function hasAnyRole(member, roleIds = []) {
    const ids = normaliseArray(roleIds);

    if (!member || !ids.length) {
      return false;
    }

    return ids.some((roleId) => hasRole(member, roleId));
  }

  function isGuildOwner(member) {
    return member?.guild?.ownerId === member?.id;
  }

  function isAdministrator(member) {
    return Boolean(
      member?.permissions?.has?.(
        PermissionsBitField.Flags.Administrator
      )
    );
  }

  function hasManageGuild(member) {
    return Boolean(
      member?.permissions?.has?.(
        PermissionsBitField.Flags.ManageGuild
      )
    );
  }

  function isSystemOverride(member) {
    return (
      isGuildOwner(member) ||
      isAdministrator(member)
    );
  }

  function getPermissionConfig(settings = {}) {
    const permissions = settings?.permissions || {};

    return {
      administratorOverride:
        permissions.administratorOverride !== false,

      allowCreatorView:
        permissions.allowCreatorView !== false,

      allowUserClose:
        permissions.allowUserClose === true,

      managerRoleIds:
        normaliseArray(
          permissions.managerRoleIds ||
            permissions.managerRoles ||
            permissions.managers ||
            []
        ),

      staffRoleIds:
        normaliseArray(
          permissions.staffRoleIds ||
            permissions.staffRoles ||
            permissions.staff ||
            []
        ),

      viewerRoleIds:
        normaliseArray(
          permissions.viewerRoleIds ||
            permissions.viewerRoles ||
            permissions.viewers ||
            []
        ),
    };
  }

  function getPanelPermissionConfig(panel = {}) {
    return {
      allowUserClose:
        panel?.allowUserClose === true,

      managerRoleIds:
        normaliseArray(panel?.managerRoleIds),

      staffRoleIds:
        normaliseArray(panel?.staffRoleIds),

      viewerRoleIds:
        normaliseArray(panel?.viewerRoleIds),
    };
  }

  function getMergedRoles(globalRoles = [], panelRoles = []) {
    return [
      ...new Set([
        ...normaliseArray(globalRoles),
        ...normaliseArray(panelRoles),
      ]),
    ];
  }

  function getTicketPanel(guildId, ticket = null) {
    if (!guildId || !ticket) return null;

    const panelId =
      ticket.metadata?.panelId ||
      ticket.panelId ||
      ticket.sourceId ||
      null;

    if (!panelId) return null;

    return getPanel(guildId, panelId);
  }

  function getMergedPermissionConfig(settings = {}, panel = null) {
    const globalConfig = getPermissionConfig(settings);
    const panelConfig = getPanelPermissionConfig(panel);

    return {
      administratorOverride:
        globalConfig.administratorOverride,

      allowCreatorView:
        globalConfig.allowCreatorView,

      allowUserClose:
        panelConfig.allowUserClose ||
        globalConfig.allowUserClose,

      managerRoleIds:
        getMergedRoles(
          globalConfig.managerRoleIds,
          panelConfig.managerRoleIds
        ),

      staffRoleIds:
        getMergedRoles(
          globalConfig.staffRoleIds,
          panelConfig.staffRoleIds
        ),

      viewerRoleIds:
        getMergedRoles(
          globalConfig.viewerRoleIds,
          panelConfig.viewerRoleIds
        ),
    };
  }

  function isManager(member, settings = {}, panel = null) {
    const config =
      getMergedPermissionConfig(settings, panel);

    return hasAnyRole(
      member,
      config.managerRoleIds
    );
  }

  function isStaff(member, settings = {}, panel = null) {
    const config =
      getMergedPermissionConfig(settings, panel);

    return hasAnyRole(
      member,
      config.staffRoleIds
    );
  }

  function isViewer(member, settings = {}, panel = null) {
    const config =
      getMergedPermissionConfig(settings, panel);

    return hasAnyRole(
      member,
      config.viewerRoleIds
    );
  }

  function isTicketCreator(member, ticket) {
    if (!member || !ticket) return false;

    const userId = member.id;

    return (
      ticket.creatorId === userId ||
      ticket.userId === userId ||
      ticket.createdBy === userId
    );
  }

  function isAllowedTicketUser(member, ticket) {
    if (!member || !ticket) return false;

    const allowedUserIds =
      normaliseArray(ticket.allowedUserIds);

    return allowedUserIds.includes(String(member.id));
  }

  function isDeleted(ticket) {
    return (
      normaliseStatus(ticket?.status) === 'deleted' ||
      Boolean(ticket?.deletedAt)
    );
  }

  function isLocked(ticket) {
    return (
      isDeleted(ticket) ||
      LOCKED_STATUSES.includes(
        normaliseStatus(ticket?.status)
      )
    );
  }

  function getRoleLevel(member, settings = {}, panel = null) {
    if (!member) return 'none';

    if (isSystemOverride(member)) {
      return 'admin';
    }

    if (isManager(member, settings, panel)) {
      return 'manager';
    }

    if (isStaff(member, settings, panel)) {
      return 'staff';
    }

    if (isViewer(member, settings, panel)) {
      return 'viewer';
    }

    return 'none';
  }

  function canView(member, ticket, settings = {}, panel = null) {
    if (!member) return false;

    const config =
      getMergedPermissionConfig(settings, panel);

    if (
      config.administratorOverride &&
      isSystemOverride(member)
    ) {
      return true;
    }

    if (
      isManager(member, settings, panel) ||
      isStaff(member, settings, panel) ||
      isViewer(member, settings, panel)
    ) {
      return true;
    }

    if (
      config.allowCreatorView &&
      isTicketCreator(member, ticket)
    ) {
      return true;
    }

    if (isAllowedTicketUser(member, ticket)) {
      return true;
    }

    return false;
  }

  function canManagePanels(member, settings = {}, panel = null) {
    if (!member) return false;

    const config =
      getMergedPermissionConfig(settings, panel);

    if (
      config.administratorOverride &&
      isSystemOverride(member)
    ) {
      return true;
    }

    if (hasManageGuild(member)) {
      return true;
    }

    return isManager(member, settings, panel);
  }

  function canCreate(member, settings = {}, panel = null) {
    if (!member) return false;

    const config =
      getMergedPermissionConfig(settings, panel);

    if (
      config.administratorOverride &&
      isSystemOverride(member)
    ) {
      return true;
    }

    if (!panel) return true;

    const allowedRoleIds =
      normaliseArray(panel.allowedRoleIds);

    const blockedRoleIds =
      normaliseArray(panel.blockedRoleIds);

    if (
      blockedRoleIds.length &&
      hasAnyRole(member, blockedRoleIds)
    ) {
      return false;
    }

    if (
      allowedRoleIds.length &&
      !hasAnyRole(member, allowedRoleIds)
    ) {
      return false;
    }

    return true;
  }

  function canUpdate(member, ticket, settings = {}, panel = null) {
    if (!member || !ticket) return false;

    if (isLocked(ticket)) {
      return false;
    }

    const config =
      getMergedPermissionConfig(settings, panel);

    if (
      config.administratorOverride &&
      isSystemOverride(member)
    ) {
      return true;
    }

    return (
      isManager(member, settings, panel) ||
      isStaff(member, settings, panel)
    );
  }

  function canClaim(member, ticket, settings = {}, panel = null) {
    if (!member || !ticket) return false;

    if (isLocked(ticket)) {
      return false;
    }

    const config =
      getMergedPermissionConfig(settings, panel);

    if (
      config.administratorOverride &&
      isSystemOverride(member)
    ) {
      return true;
    }

    return (
      isManager(member, settings, panel) ||
      isStaff(member, settings, panel)
    );
  }

  function canAssign(member, ticket, settings = {}, panel = null) {
    if (!member || !ticket) return false;

    if (isLocked(ticket)) {
      return false;
    }

    const config =
      getMergedPermissionConfig(settings, panel);

    if (
      config.administratorOverride &&
      isSystemOverride(member)
    ) {
      return true;
    }

    return isManager(member, settings, panel);
  }

  function canClose(member, ticket, settings = {}, panel = null) {
    if (!member || !ticket) return false;

    if (isLocked(ticket)) {
      return false;
    }

    const config =
      getMergedPermissionConfig(settings, panel);

    if (
      config.administratorOverride &&
      isSystemOverride(member)
    ) {
      return true;
    }

    if (
      isManager(member, settings, panel) ||
      isStaff(member, settings, panel)
    ) {
      return true;
    }

    return (
      config.allowUserClose &&
      isTicketCreator(member, ticket)
    );
  }

  function canReopen(member, ticket, settings = {}, panel = null) {
    if (!member || !ticket || isDeleted(ticket)) return false;

    const status = normaliseStatus(ticket.status);

    if (!['closed', 'archived'].includes(status)) {
      return false;
    }

    const config =
      getMergedPermissionConfig(settings, panel);

    if (
      config.administratorOverride &&
      isSystemOverride(member)
    ) {
      return true;
    }

    return (
      isManager(member, settings, panel) ||
      isStaff(member, settings, panel)
    );
  }

  function canApproveOrDeny(member, ticket, settings = {}, panel = null) {
    if (!member || !ticket) return false;

    if (isLocked(ticket)) {
      return false;
    }

    const config =
      getMergedPermissionConfig(settings, panel);

    if (
      config.administratorOverride &&
      isSystemOverride(member)
    ) {
      return true;
    }

    return (
      isManager(member, settings, panel) ||
      isStaff(member, settings, panel)
    );
  }

  function canArchive(member, ticket, settings = {}, panel = null) {
    if (!member || !ticket || isDeleted(ticket)) return false;

    const status = normaliseStatus(ticket.status);

    if (status === 'archived') {
      return false;
    }

    const config =
      getMergedPermissionConfig(settings, panel);

    if (
      config.administratorOverride &&
      isSystemOverride(member)
    ) {
      return true;
    }

    return (
      isManager(member, settings, panel) ||
      isStaff(member, settings, panel)
    );
  }

  function canDelete(member, ticket, settings = {}, panel = null) {
    if (!member || !ticket || isDeleted(ticket)) return false;

    const config =
      getMergedPermissionConfig(settings, panel);

    if (
      config.administratorOverride &&
      isSystemOverride(member)
    ) {
      return true;
    }

    return isManager(member, settings, panel);
  }

  function canAddNote(member, ticket, settings = {}, panel = null) {
    if (!member || !ticket) return false;

    const config =
      getMergedPermissionConfig(settings, panel);

    if (
      config.administratorOverride &&
      isSystemOverride(member)
    ) {
      return true;
    }

    return (
      isManager(member, settings, panel) ||
      isStaff(member, settings, panel)
    );
  }

  function memberGuildId(member) {
    return member?.guild?.id || null;
  }

  function can(member, action, ticket = null) {
    if (!member) return false;

    const guildId =
      memberGuildId(member) ||
      ticket?.guildId ||
      null;

    const settings =
      guildId ? getTicketSettings(guildId) : {};

    const panel =
      ticket ? getTicketPanel(guildId, ticket) : null;

    switch (action) {
      case TICKET_ACTIONS.VIEW:
        return canView(member, ticket, settings, panel);

      case TICKET_ACTIONS.VIEW_ALL:
        return (
          isSystemOverride(member) ||
          isManager(member, settings, panel) ||
          isStaff(member, settings, panel) ||
          isViewer(member, settings, panel)
        );

      case TICKET_ACTIONS.CREATE:
        return canCreate(member, settings, panel);

      case TICKET_ACTIONS.UPDATE:
        return canUpdate(member, ticket, settings, panel);

      case TICKET_ACTIONS.CLAIM:
        return canClaim(member, ticket, settings, panel);

      case TICKET_ACTIONS.ASSIGN:
        return canAssign(member, ticket, settings, panel);

      case TICKET_ACTIONS.CLOSE:
        return canClose(member, ticket, settings, panel);

      case TICKET_ACTIONS.REOPEN:
        return canReopen(member, ticket, settings, panel);

      case TICKET_ACTIONS.APPROVE:
      case TICKET_ACTIONS.DENY:
        return canApproveOrDeny(member, ticket, settings, panel);

      case TICKET_ACTIONS.ARCHIVE:
        return canArchive(member, ticket, settings, panel);

      case TICKET_ACTIONS.DELETE:
        return canDelete(member, ticket, settings, panel);

      case TICKET_ACTIONS.ADD_NOTE:
        return canAddNote(member, ticket, settings, panel);

      case TICKET_ACTIONS.MANAGE_SETTINGS:
      case TICKET_ACTIONS.MANAGE_PANELS:
        return canManagePanels(member, settings, panel);

      default:
        return false;
    }
  }

  ticketPermissionsApi = {
    TICKET_ACTIONS,
    LOCKED_STATUSES,

    can,

    canView,
    canCreate,
    canUpdate,
    canClaim,
    canAssign,
    canClose,
    canReopen,
    canApproveOrDeny,
    canArchive,
    canDelete,
    canAddNote,
    canManagePanels,

    isManager,
    isStaff,
    isViewer,
    isTicketCreator,
    isAllowedTicketUser,
    isSystemOverride,
    isDeleted,
    isLocked,
    getRoleLevel,

    getPermissionConfig,
    getPanelPermissionConfig,
    getMergedPermissionConfig,
  };
}

// ============================================================================
// ticketChannelManager
// ============================================================================
{
  'use strict';

  const {
    ChannelType,
    PermissionFlagsBits,
  } = require('discord.js');

  const {
    getTicketSettings,
    updateTicket,
  } = require('./tickets');

  const {
    addTimelineEntry,
  } = require('./ticketsTracking');

  const {
    buildTicketChannelName: buildCleanTicketChannelName,
  } = ticketNamingApi;

  const {
    TICKET_CHANNEL_PERMISSIONS,
    getBotId,
    getBotMember,
    guardChannelAccess,
    guardCategoryAccess,
    syncBotToChannel,
    syncBotToCategory,
  } = require('../../../core/security/protection/permissions');

  const BOT_CHANNEL_PERMISSIONS = TICKET_CHANNEL_PERMISSIONS;

  function uniqueIds(ids = []) {
    return [
      ...new Set(
        (Array.isArray(ids) ? ids : [])
          .filter(Boolean)
          .map(String)
      ),
    ];
  }

  async function ensureBotReady(guild) {
    const botMember = await getBotMember(guild);
    return botMember?.id || getBotId(guild);
  }

  async function ensureBotChannelPermissions(channel) {
    if (!channel?.guild) return false;

    const result = await syncBotToChannel(
      channel.guild,
      channel.id,
      BOT_CHANNEL_PERMISSIONS,
      {
        scope: 'tickets.channel_sync',
        reason: 'Goliath ticket channel permission sync',
      }
    ).catch((error) => {
      console.error('[Tickets] Failed to repair bot channel permissions:', error);
      return null;
    });

    return Boolean(result?.ok);
  }

  async function ensureBotCategoryPermissions(guild, categoryId) {
    if (!guild || !categoryId) return false;

    const result = await syncBotToCategory(
      guild,
      categoryId,
      BOT_CHANNEL_PERMISSIONS,
      {
        scope: 'tickets.category_sync',
        reason: 'Goliath ticket category permission sync',
      }
    ).catch((error) => {
      console.error('[Tickets] Failed to repair bot category permissions:', error);
      return null;
    });

    return Boolean(result?.ok);
  }

  function buildTicketChannelName(ticket, guild = null) {
    return buildCleanTicketChannelName(ticket, guild);
  }

  function getPanelOrGlobalCategory(settings, panel) {
    return (
      panel?.outputCategoryId ||
      settings.discord?.categoryId ||
      null
    );
  }

  function getArchiveCategory(settings, panel) {
    return (
      panel?.archiveCategoryId ||
      settings.discord?.archiveCategoryId ||
      null
    );
  }

  async function resolveAvailableCategory(guild, categoryId) {
    if (!guild || !categoryId) return null;

    const baseCategory = guild.channels.cache.get(categoryId);

    if (!baseCategory || baseCategory.type !== ChannelType.GuildCategory) {
      return null;
    }

    await guardCategoryAccess(
      guild,
      baseCategory.id,
      BOT_CHANNEL_PERMISSIONS,
      {
        scope: 'tickets.category',
        autoFix: true,
        throwOnFail: true,
        reason: 'Goliath ticket category validation',
      }
    );

    const MAX_CHANNELS_PER_CATEGORY = 48;

    const getChildCount = (id) =>
      guild.channels.cache.filter((channel) => channel.parentId === id).size;

    if (getChildCount(baseCategory.id) < MAX_CHANNELS_PER_CATEGORY) {
      return baseCategory.id;
    }

    const overflowName = `${baseCategory.name} Overflow`;

    let overflowCategory = guild.channels.cache.find(
      (channel) =>
        channel.type === ChannelType.GuildCategory &&
        channel.name === overflowName
    );

    if (!overflowCategory) {
      overflowCategory = await guild.channels
        .create({
          name: overflowName,
          type: ChannelType.GuildCategory,
          permissionOverwrites:
            baseCategory.permissionOverwrites.cache.map((overwrite) => ({
              id: overwrite.id,
              allow: overwrite.allow.bitfield,
              deny: overwrite.deny.bitfield,
              type: overwrite.type,
            })),
        })
        .catch((error) => {
          console.error('[Tickets] Failed to create overflow category:', error);
          return null;
        });
    }

    if (!overflowCategory) return baseCategory.id;

    await guardCategoryAccess(
      guild,
      overflowCategory.id,
      BOT_CHANNEL_PERMISSIONS,
      {
        scope: 'tickets.overflow_category',
        autoFix: true,
        throwOnFail: true,
        reason: 'Goliath ticket overflow category validation',
      }
    );

    return overflowCategory.id;
  }

  function creatorPermissions(userId) {
    if (!userId) return null;

    return {
      id: userId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    };
  }

  function botPermissions(botId) {
    if (!botId) return null;

    return {
      id: botId,
      allow: BOT_CHANNEL_PERMISSIONS,
    };
  }

  function staffPermissions(roleId) {
    return {
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    };
  }

  function managerPermissions(roleId) {
    return {
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ManageChannels,
      ],
    };
  }

  function viewerPermissions(roleId) {
    return {
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
      ],
      deny: [
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.AddReactions,
      ],
    };
  }

  function getPanelRoleIds(panel = {}) {
    return {
      staffRoleIds: uniqueIds(panel.staffRoleIds),
      managerRoleIds: uniqueIds(panel.managerRoleIds),
      viewerRoleIds: uniqueIds(panel.viewerRoleIds),
    };
  }

  function getGlobalRoleIds(settings = {}) {
    const permissions = settings.permissions || {};

    return {
      staffRoleIds: uniqueIds(
        permissions.staffRoleIds ||
          permissions.staffRoles ||
          []
      ),

      managerRoleIds: uniqueIds(
        permissions.managerRoleIds ||
          permissions.managerRoles ||
          []
      ),

      viewerRoleIds: uniqueIds(
        permissions.viewerRoleIds ||
          permissions.viewerRoles ||
          []
      ),
    };
  }

  function mergeRoleIds(globalIds = {}, panelIds = {}) {
    return {
      staffRoleIds: uniqueIds([
        ...(globalIds.staffRoleIds || []),
        ...(panelIds.staffRoleIds || []),
      ]),

      managerRoleIds: uniqueIds([
        ...(globalIds.managerRoleIds || []),
        ...(panelIds.managerRoleIds || []),
      ]),

      viewerRoleIds: uniqueIds([
        ...(globalIds.viewerRoleIds || []),
        ...(panelIds.viewerRoleIds || []),
      ]),
    };
  }

  function buildTicketPermissionOverwrites({
    guild,
    ticket,
    panel = null,
    settings = {},
  } = {}) {
    const overwrites = [];

    if (!guild || !ticket) return overwrites;

    const everyoneId = guild.roles.everyone.id;
    const botId = getBotId(guild);

    overwrites.push({
      id: everyoneId,
      deny: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
      ],
    });

    const botOverwrite = botPermissions(botId);
    if (botOverwrite) overwrites.push(botOverwrite);

    const creatorId =
      ticket.creatorId ||
      ticket.userId ||
      ticket.createdBy ||
      null;

    const creatorOverwrite = creatorPermissions(creatorId);
    if (creatorOverwrite) overwrites.push(creatorOverwrite);

    const roles = mergeRoleIds(
      getGlobalRoleIds(settings),
      getPanelRoleIds(panel)
    );

    for (const roleId of roles.viewerRoleIds) {
      overwrites.push(viewerPermissions(roleId));
    }

    for (const roleId of roles.staffRoleIds) {
      overwrites.push(staffPermissions(roleId));
    }

    for (const roleId of roles.managerRoleIds) {
      overwrites.push(managerPermissions(roleId));
    }

    const allowedUsers = uniqueIds(ticket.allowedUserIds);

    for (const userId of allowedUsers) {
      if (userId === creatorId) continue;

      overwrites.push(creatorPermissions(userId));
    }

    return dedupeOverwrites(overwrites);
  }

  function dedupeOverwrites(overwrites = []) {
    const map = new Map();

    for (const overwrite of overwrites) {
      if (!overwrite?.id) continue;

      const existing = map.get(overwrite.id);

      if (!existing) {
        map.set(overwrite.id, overwrite);
        continue;
      }

      map.set(overwrite.id, {
        id: overwrite.id,
        allow: [
          ...new Set([
            ...(existing.allow || []),
            ...(overwrite.allow || []),
          ]),
        ],
        deny: [
          ...new Set([
            ...(existing.deny || []),
            ...(overwrite.deny || []),
          ]),
        ],
      });
    }

    return [...map.values()];
  }

  async function createTicketChannel({
    client,
    guild,
    ticket,
    panel = null,
  } = {}) {
    if (!guild || !ticket) {
      throw new Error('Missing guild or ticket.');
    }

    await ensureBotReady(guild);

    const settings = getTicketSettings(guild.id);

    const categoryId = getPanelOrGlobalCategory(settings, panel);
    const parentId = await resolveAvailableCategory(guild, categoryId);

    const name = buildTicketChannelName(ticket, guild);

    const permissionOverwrites = buildTicketPermissionOverwrites({
      guild,
      ticket,
      panel,
      settings,
    });

    const channel = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: parentId || undefined,
      topic: [
        `Ticket: ${ticket.displayId || ticket.ticketId}`,
        `Creator: ${ticket.creatorId || ticket.userId || ticket.createdBy || 'Unknown'}`,
        `Type: ${ticket.type || 'ticket'}`,
        `Priority: ${ticket.priority || 'low'}`,
      ].join(' • '),
      permissionOverwrites,
      reason: `Goliath ticket created: ${
        ticket.displayId || ticket.ticketId
      }`,
    });

    await guardChannelAccess(
      guild,
      channel.id,
      BOT_CHANNEL_PERMISSIONS,
      {
        scope: 'tickets.created_channel',
        autoFix: true,
        throwOnFail: true,
        reason: 'Goliath ticket channel validation after create',
      }
    );

    updateTicket(
      guild.id,
      ticket.ticketId,
      {
        discordChannelId: channel.id,
        channelId: channel.id,
      }
    );

    addTimelineEntry(
      guild.id,
      ticket.ticketId,
      {
        type: 'discord_channel_created',
        actorId: null,
        actorTag: 'System',
        message: `Discord ticket channel created: #${channel.name}`,
        metadata: {
          channelId: channel.id,
          parentId: channel.parentId || null,
        },
      }
    );

    return channel;
  }

  async function syncTicketChannelPermissions({
    guild,
    channel,
    ticket,
    panel = null,
  } = {}) {
    if (!guild || !channel || !ticket) {
      return false;
    }

    await guardChannelAccess(
      guild,
      channel.id,
      BOT_CHANNEL_PERMISSIONS,
      {
        scope: 'tickets.channel_sync',
        autoFix: true,
        throwOnFail: true,
        reason: 'Goliath ticket channel validation before sync',
      }
    );

    const settings = getTicketSettings(guild.id);

    const overwrites = buildTicketPermissionOverwrites({
      guild,
      ticket,
      panel,
      settings,
    });

    for (const overwrite of overwrites) {
      await channel.permissionOverwrites
        .edit(overwrite.id, {
          ViewChannel: overwrite.allow?.includes(PermissionFlagsBits.ViewChannel) || false,
          SendMessages: overwrite.allow?.includes(PermissionFlagsBits.SendMessages) || false,
          ReadMessageHistory:
            overwrite.allow?.includes(PermissionFlagsBits.ReadMessageHistory) || false,
          AttachFiles: overwrite.allow?.includes(PermissionFlagsBits.AttachFiles) || false,
          EmbedLinks: overwrite.allow?.includes(PermissionFlagsBits.EmbedLinks) || false,
          ManageChannels:
            overwrite.allow?.includes(PermissionFlagsBits.ManageChannels) || false,
          ManageMessages:
            overwrite.allow?.includes(PermissionFlagsBits.ManageMessages) || false,
          AddReactions:
            overwrite.deny?.includes(PermissionFlagsBits.AddReactions) ? false : null,
        })
        .catch((error) => {
          console.error(
            '[Tickets] Failed to sync ticket channel overwrite:',
            overwrite.id,
            error
          );
        });
    }

    await guardChannelAccess(
      guild,
      channel.id,
      BOT_CHANNEL_PERMISSIONS,
      {
        scope: 'tickets.channel_sync_complete',
        autoFix: true,
        throwOnFail: true,
        reason: 'Goliath ticket channel validation after sync',
      }
    );

    return true;
  }

  async function closeTicketChannel({
    guild,
    channel,
    ticket,
    actorId = null,
  } = {}) {
    if (!guild || !channel || !ticket) return false;

    await guardChannelAccess(
      guild,
      channel.id,
      BOT_CHANNEL_PERMISSIONS,
      {
        scope: 'tickets.close_channel',
        autoFix: true,
        throwOnFail: true,
        reason: 'Goliath ticket close validation',
      }
    );

    const name = buildTicketChannelName(ticket, guild);

    await channel.setName(name).catch(() => null);

    const creatorId =
      ticket.creatorId ||
      ticket.userId ||
      ticket.createdBy ||
      null;

    if (creatorId) {
      await channel.permissionOverwrites
        .edit(creatorId, {
          SendMessages: false,
          AttachFiles: false,
        })
        .catch(() => null);
    }

    addTimelineEntry(
      guild.id,
      ticket.ticketId,
      {
        type: 'discord_channel_closed',
        actorId,
        message: 'Discord ticket channel locked after close.',
        metadata: {
          channelId: channel.id,
        },
      }
    );

    return true;
  }

  async function archiveTicketChannel({
    guild,
    channel,
    ticket,
    panel = null,
    actorId = null,
  } = {}) {
    if (!guild || !channel || !ticket) return false;

    await guardChannelAccess(
      guild,
      channel.id,
      BOT_CHANNEL_PERMISSIONS,
      {
        scope: 'tickets.archive_channel',
        autoFix: true,
        throwOnFail: true,
        reason: 'Goliath ticket archive validation',
      }
    );

    const settings = getTicketSettings(guild.id);
    const archiveCategoryId = getArchiveCategory(settings, panel);

    const resolvedArchiveId = await resolveAvailableCategory(
      guild,
      archiveCategoryId
    );

    await channel
      .setName(buildTicketChannelName(ticket, guild))
      .catch(() => null);

    if (resolvedArchiveId) {
      await channel.setParent(resolvedArchiveId).catch(() => null);
    }

    addTimelineEntry(
      guild.id,
      ticket.ticketId,
      {
        type: 'discord_channel_archived',
        actorId,
        message: 'Discord ticket channel archived.',
        metadata: {
          channelId: channel.id,
          archiveCategoryId: resolvedArchiveId || null,
        },
      }
    );

    return true;
  }

  async function reopenTicketChannel({
    guild,
    channel,
    ticket,
    panel = null,
    actorId = null,
  } = {}) {
    if (!guild || !channel || !ticket) return false;

    await guardChannelAccess(
      guild,
      channel.id,
      BOT_CHANNEL_PERMISSIONS,
      {
        scope: 'tickets.reopen_channel',
        autoFix: true,
        throwOnFail: true,
        reason: 'Goliath ticket reopen validation',
      }
    );

    const settings = getTicketSettings(guild.id);
    const categoryId = getPanelOrGlobalCategory(settings, panel);
    const resolvedCategoryId = await resolveAvailableCategory(guild, categoryId);

    await channel
      .setName(buildTicketChannelName(ticket, guild))
      .catch(() => null);

    if (resolvedCategoryId) {
      await channel.setParent(resolvedCategoryId).catch(() => null);
    }

    const creatorId =
      ticket.creatorId ||
      ticket.userId ||
      ticket.createdBy ||
      null;

    if (creatorId) {
      await channel.permissionOverwrites
        .edit(creatorId, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
          AttachFiles: true,
          EmbedLinks: true,
        })
        .catch(() => null);
    }

    await syncTicketChannelPermissions({
      guild,
      channel,
      ticket,
      panel,
    });

    addTimelineEntry(
      guild.id,
      ticket.ticketId,
      {
        type: 'discord_channel_reopened',
        actorId,
        message: 'Discord ticket channel reopened.',
        metadata: {
          channelId: channel.id,
          parentId: channel.parentId || null,
        },
      }
    );

    return true;
  }

  async function deleteTicketChannel({
    guild,
    channel,
    ticket,
    actorId = null,
  } = {}) {
    if (!guild || !channel || !ticket) return false;

    await guardChannelAccess(
      guild,
      channel.id,
      BOT_CHANNEL_PERMISSIONS,
      {
        scope: 'tickets.delete_channel',
        autoFix: false,
        throwOnFail: true,
        reason: 'Goliath ticket delete validation',
      }
    );

    addTimelineEntry(
      guild.id,
      ticket.ticketId,
      {
        type: 'discord_channel_deleted',
        actorId,
        message: 'Discord ticket channel deleted.',
        metadata: {
          channelId: channel.id,
          channelName: channel.name,
        },
      }
    );

    await channel.delete('Goliath ticket deleted').catch(() => null);

    return true;
  }

  ticketChannelManagerApi = {
    BOT_CHANNEL_PERMISSIONS,

    buildTicketChannelName,
    buildTicketPermissionOverwrites,

    createTicketChannel,
    syncTicketChannelPermissions,

    closeTicketChannel,
    archiveTicketChannel,
    reopenTicketChannel,
    deleteTicketChannel,

    ensureBotReady,
    ensureBotChannelPermissions,
    ensureBotCategoryPermissions,

    resolveAvailableCategory,
  };
}

// ============================================================================
// ticketGuard
// ============================================================================
{
  /**
   * GOLIATH TICKET GUARD
   *
   * Handles:
   * - duplicate ticket protection
   * - one active ticket per type
   * - per-panel max open ticket limits
   * - 0 = unlimited ticket limits
   * - cooldowns
   * - basic spam protection
   *
   * Standardized to lowercase ticket statuses.
   */

  const ticketManager = require('./ticketsLifecycle');

  const DEFAULT_COOLDOWN_MS = 60 * 1000;

  const memoryCooldowns = new Map();

  const ACTIVE_STATUSES = [
    'open',
    'claimed',
    'waiting_user',
    'in_review',
    'approved',
    'denied',
  ];

  function now() {
    return Date.now();
  }

  function normaliseStatus(status) {
    return String(status || 'open').toLowerCase();
  }

  function normaliseType(type) {
    return String(type || 'ticket')
      .toLowerCase()
      .replace(/_/g, '-')
      .trim();
  }

  function normalisePanelId(panelId) {
    return panelId ? String(panelId).trim() : null;
  }

  function formatTypeLabel(type) {
    return String(type || 'ticket')
      .replace(/_/g, ' ')
      .replace(/-/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function getCooldownKey(guildId, userId, type) {
    return `${guildId}:${userId}:${normaliseType(type)}`;
  }

  async function getAllTickets(guildId) {
    if (typeof ticketManager.getTickets === 'function') {
      return ticketManager.getTickets(guildId);
    }

    if (typeof ticketManager.listTickets === 'function') {
      return ticketManager.listTickets(guildId);
    }

    if (typeof ticketManager.getAllTickets === 'function') {
      return ticketManager.getAllTickets(guildId);
    }

    return [];
  }

  function isSameUser(ticket, userId) {
    return (
      ticket.creatorId === userId ||
      ticket.userId === userId ||
      ticket.createdBy === userId
    );
  }

  function isActiveTicket(ticket) {
    return (
      ACTIVE_STATUSES.includes(
        normaliseStatus(ticket.status)
      ) &&
      !ticket.deletedAt
    );
  }

  function isSameType(ticket, type) {
    if (!type) return true;

    return (
      normaliseType(ticket.type) ===
      normaliseType(type)
    );
  }

  function getTicketPanelId(ticket = {}) {
    return (
      ticket.panelId ||
      ticket.sourceId ||
      ticket.metadata?.panelId ||
      ticket.metadata?.sourcePanelId ||
      null
    );
  }

  function isSamePanel(ticket, panelId) {
    const cleanPanelId = normalisePanelId(panelId);

    if (!cleanPanelId) return true;

    return normalisePanelId(getTicketPanelId(ticket)) === cleanPanelId;
  }

  async function findActiveTicket({ guildId, userId, type, panelId = null } = {}) {
    const tickets = await getAllTickets(guildId);

    return (
      tickets.find((ticket) => {
        return (
          ticket.guildId === guildId &&
          isSameUser(ticket, userId) &&
          isSameType(ticket, type) &&
          isSamePanel(ticket, panelId) &&
          isActiveTicket(ticket)
        );
      }) || null
    );
  }

  async function findActiveTickets({ guildId, userId, type, panelId = null } = {}) {
    const tickets = await getAllTickets(guildId);

    return tickets.filter((ticket) => {
      return (
        ticket.guildId === guildId &&
        isSameUser(ticket, userId) &&
        isSameType(ticket, type) &&
        isSamePanel(ticket, panelId) &&
        isActiveTicket(ticket)
      );
    });
  }

  function checkCooldown({
    guildId,
    userId,
    type,
    cooldownMs = DEFAULT_COOLDOWN_MS,
  } = {}) {
    const cleanCooldownMs = Number(cooldownMs || 0);

    if (cleanCooldownMs <= 0) {
      return {
        allowed: true,
        remainingMs: 0,
      };
    }

    const key = getCooldownKey(guildId, userId, type);
    const lastUsed = memoryCooldowns.get(key);

    if (!lastUsed) {
      return {
        allowed: true,
        remainingMs: 0,
      };
    }

    const elapsed = now() - lastUsed;
    const remainingMs = cleanCooldownMs - elapsed;

    if (remainingMs > 0) {
      return {
        allowed: false,
        remainingMs,
      };
    }

    return {
      allowed: true,
      remainingMs: 0,
    };
  }

  function setCooldown({ guildId, userId, type } = {}) {
    if (!guildId || !userId) return false;

    const key = getCooldownKey(guildId, userId, type);
    memoryCooldowns.set(key, now());

    return true;
  }

  function clearCooldown({ guildId, userId, type } = {}) {
    if (!guildId || !userId) return false;

    const key = getCooldownKey(guildId, userId, type);
    memoryCooldowns.delete(key);

    return true;
  }

  function formatRemaining(ms) {
    const seconds = Math.ceil(Number(ms || 0) / 1000);

    if (seconds <= 1) return '1s';
    if (seconds < 60) return `${seconds}s`;

    const minutes = Math.ceil(seconds / 60);

    if (minutes <= 1) return '1m';
    if (minutes < 60) return `${minutes}m`;

    const hours = Math.ceil(minutes / 60);

    if (hours <= 1) return '1h';

    return `${hours}h`;
  }

  function resolveConfiguredMax({
    maxOpenTicketsPerUser = null,
    maxOpenTickets = null,
    maxActiveTicketsPerUser = null,
    oneActivePerType = true,
  } = {}) {
    const raw =
      maxOpenTicketsPerUser ??
      maxOpenTickets ??
      maxActiveTicketsPerUser ??
      (oneActivePerType ? 1 : 0);

    const value = Number(raw);

    if (!Number.isFinite(value)) {
      return oneActivePerType ? 1 : 0;
    }

    return Math.max(0, Math.floor(value));
  }

  function buildLimitReason({
    type,
    count,
    max,
    panelScoped = false,
  } = {}) {
    const label = formatTypeLabel(type);
    const scope = panelScoped ? ' from this panel' : '';

    if (max === 1) {
      return `You already have an active ${label} ticket${scope}.`;
    }

    return `You already have ${count}/${max} active ${label} tickets${scope}.`;
  }

  async function checkPanelLimit({
    guildId,
    userId,
    type,
    panelId = null,
    maxOpenTicketsPerUser = null,
    maxOpenTickets = null,
    maxActiveTicketsPerUser = null,
    oneActivePerType = true,
  } = {}) {
    const configuredMax = resolveConfiguredMax({
      maxOpenTicketsPerUser,
      maxOpenTickets,
      maxActiveTicketsPerUser,
      oneActivePerType,
    });

    const activeTickets = await findActiveTickets({
      guildId,
      userId,
      type,
      panelId,
    });

    if (configuredMax === 0) {
      return {
        allowed: true,
        unlimited: true,
        count: activeTickets.length,
        maxOpenTickets: 0,
        maxOpenTicketsPerUser: 0,
        panelId: normalisePanelId(panelId),
        tickets: activeTickets,
      };
    }

    if (activeTickets.length >= configuredMax) {
      const firstTicket = activeTickets[0] || null;

      return {
        allowed: false,
        reason: buildLimitReason({
          type,
          count: activeTickets.length,
          max: configuredMax,
          panelScoped: Boolean(panelId),
        }),
        code:
          configuredMax === 1
            ? 'DUPLICATE_ACTIVE_TICKET'
            : 'MAX_ACTIVE_TICKETS_REACHED',
        ticket: firstTicket,
        tickets: activeTickets,
        count: activeTickets.length,
        maxOpenTickets: configuredMax,
        maxOpenTicketsPerUser: configuredMax,
        panelId: normalisePanelId(panelId),
        unlimited: false,
      };
    }

    return {
      allowed: true,
      unlimited: false,
      count: activeTickets.length,
      maxOpenTickets: configuredMax,
      maxOpenTicketsPerUser: configuredMax,
      panelId: normalisePanelId(panelId),
      tickets: activeTickets,
    };
  }

  async function canCreateTicket({
    guildId,
    userId,
    type,
    panelId = null,
    cooldownMs = DEFAULT_COOLDOWN_MS,
    oneActivePerType = true,
    maxOpenTickets = null,
    maxOpenTicketsPerUser = null,
    maxActiveTicketsPerUser = null,
  } = {}) {
    if (!guildId) {
      return {
        allowed: false,
        reason: 'Missing guild id.',
        code: 'MISSING_GUILD_ID',
      };
    }

    if (!userId) {
      return {
        allowed: false,
        reason: 'Missing user id.',
        code: 'MISSING_USER_ID',
      };
    }

    const cooldown = checkCooldown({
      guildId,
      userId,
      type,
      cooldownMs,
    });

    if (!cooldown.allowed) {
      return {
        allowed: false,
        reason: `Please wait ${formatRemaining(
          cooldown.remainingMs
        )} before opening another ticket.`,
        code: 'COOLDOWN',
        remainingMs: cooldown.remainingMs,
      };
    }

    const limit = await checkPanelLimit({
      guildId,
      userId,
      type,
      panelId,
      oneActivePerType,
      maxOpenTickets,
      maxOpenTicketsPerUser,
      maxActiveTicketsPerUser,
    });

    if (!limit.allowed) {
      return limit;
    }

    return {
      allowed: true,
      code: 'ALLOWED',
      count: limit.count,
      maxOpenTickets: limit.maxOpenTickets,
      maxOpenTicketsPerUser: limit.maxOpenTicketsPerUser,
      panelId: limit.panelId,
      unlimited: limit.unlimited,
    };
  }

  async function markTicketCreated({
    guildId,
    userId,
    type,
  } = {}) {
    if (!guildId || !userId) return false;

    return setCooldown({
      guildId,
      userId,
      type,
    });
  }

  ticketGuardApi = {
    ACTIVE_STATUSES,
    DEFAULT_COOLDOWN_MS,

    canCreateTicket,
    markTicketCreated,

    checkPanelLimit,

    findActiveTicket,
    findActiveTickets,

    checkCooldown,
    setCooldown,
    clearCooldown,

    formatRemaining,
    formatTypeLabel,
    normaliseStatus,
    normaliseType,
    normalisePanelId,
    getTicketPanelId,
  };
}

module.exports = {
  ...ticketNamingApi,
  ...ticketPermissionsApi,
  ...ticketChannelManagerApi,
  ...ticketGuardApi,
  ticketNaming: ticketNamingApi,
  ticketPermissions: ticketPermissionsApi,
  ticketChannelManager: ticketChannelManagerApi,
  ticketGuard: ticketGuardApi,
};
