'use strict';

const guildManager = require('../../../core/guild/guildManager');

const SECTION = 'social';
const CREATOR_DELETE_GRACE_MS = 5 * 24 * 60 * 60 * 1000;

function object(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function clean(value, max = 2000) {
  return String(value || '').trim().slice(0, max);
}


function normalizeCreator(creator = {}) {
  return {
    ...creator,
    group: creator.group || '',
    tags: Array.isArray(creator.tags)
      ? creator.tags
      : [],
    notes: creator.notes || '',
    adminNotes: creator.adminNotes || '',
    enabled: creator.enabled !== false,
    status: creator.status || 'active',
  };
}

function normalizeSection(input = {}) {
  const section = object(input);

  return {
    ...section,
    alertsChannelId: section.alertsChannelId || null,
    alertChannels: object(section.alertChannels),
    managerRoleIds: array(section.managerRoleIds).map(String),
    userRoleIds: array(section.userRoleIds).map(String),
    notificationMentionMode: ['none', 'role', 'everyone', 'here'].includes(section.notificationMentionMode)
      ? section.notificationMentionMode
      : 'none',
    notificationRoleId: section.notificationRoleId || null,
    creators: Object.fromEntries(Object.entries(object(section.creators)).map(([id, creator]) => [id, normalizeCreator(creator)])),
    accounts: object(section.accounts),
    settings: object(section.settings),
    templates: object(section.templates),
    history: array(section.history),
    queue: array(section.queue),
    analytics: object(section.analytics),
  };
}

function getSection(guildId) {
  return normalizeSection(guildManager.getGuildSection(guildId, SECTION, {}));
}

function getConfig(guildId) {
  return {
    ...getSection(guildId),
    enabled: isEnabled(guildId),
  };
}

function getManagerRoleIds(guildId) {
  return [...new Set(getSection(guildId).managerRoleIds.map(String).filter(Boolean))];
}

function getUserRoleIds(guildId) {
  return [...new Set(getSection(guildId).userRoleIds.map(String).filter(Boolean))];
}

function saveSection(guildId, section, meta = {}) {
  const normalized = normalizeSection(section);
  const saved = guildManager.saveGuildSection(guildId, SECTION, normalized, {
    guildId,
    ...object(meta),
  });

  if (!saved || typeof saved !== 'object') {
    throw new Error('Social Studio could not verify its saved guild data.');
  }

  return normalizeSection(saved);
}

function saveConfig(guildId, config, meta = {}) {
  const { enabled: _enabled, ...storedConfig } = object(config);
  const next = {
    ...storedConfig,
    updatedAt: new Date().toISOString(),
    lastActorId: meta.actorId || null,
  };

  const saved = saveSection(guildId, next, meta);

  for (const creatorId of Object.keys(next.creators || {})) {
    if (!saved.creators?.[creatorId]) {
      throw new Error(`Creator profile ${creatorId} was not persisted.`);
    }
  }

  for (const accountId of Object.keys(next.accounts || {})) {
    if (!saved.accounts?.[accountId]) {
      throw new Error(`Social account ${accountId} was not persisted.`);
    }
  }

  return {
    ...saved,
    enabled: isEnabled(guildId),
  };
}

function updateSection(guildId, updater, meta = {}) {
  const current = getSection(guildId);
  const next = typeof updater === 'function'
    ? updater(current)
    : { ...current, ...object(updater) };

  return saveSection(guildId, next, meta);
}

function getCreator(guildId, creatorId) {
  return getSection(guildId).creators[String(creatorId)] || null;
}

function findCreatorByOwner(guildId, ownerDiscordId) {
  const ownerId = String(ownerDiscordId || '');
  if (!ownerId) return null;

  return Object.values(getSection(guildId).creators)
    .find((creator) => String(creator?.ownerDiscordId || '') === ownerId) || null;
}

function getCreatorAccounts(guildId, creatorOrId) {
  const section = getSection(guildId);
  const creator = typeof creatorOrId === 'object'
    ? creatorOrId
    : section.creators[String(creatorOrId)] || null;

  if (!creator) return [];

  return array(creator.accountIds)
    .map((accountId) => section.accounts[String(accountId)])
    .filter(Boolean);
}

function nextCreatorId(section) {
  const used = new Set(Object.keys(section.creators));
  let sequence = Math.max(0, Number(section.creatorSequence || 0));
  let creatorId;

  do {
    sequence += 1;
    creatorId = `creator_${String(sequence).padStart(6, '0')}`;
  } while (used.has(creatorId));

  section.creatorSequence = sequence;
  return creatorId;
}

function createCreatorForMember(member, meta = {}) {
  const guildId = member.guild.id;
  const ownerDiscordId = String(member.user.id);
  const existing = findCreatorByOwner(guildId, ownerDiscordId);
  if (existing) return { creator: existing, created: false };

  let creator = null;
  updateSection(guildId, (section) => {
    const timestamp = new Date().toISOString();
    const creatorId = nextCreatorId(section);
    creator = {
      creatorId,
      ownerDiscordId,
      displayName: clean(member.displayName || member.user.globalName || member.user.username, 120),
      group: '',
      tags: [],
      notes: '',
      adminNotes: '',
      enabled: true,
      status: 'active',
      accountIds: [],
      profileCompleted: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    section.creators[creatorId] = creator;
    return section;
  }, meta);

  return { creator, created: true };
}

function completeCreatorProfile(member, values = {}, meta = {}) {
  const guildId = member.guild.id;
  const ownerDiscordId = String(member.user.id);
  let creator = findCreatorByOwner(guildId, ownerDiscordId);
  const wasCompleted = creator?.profileCompleted === true;

  if (!creator) creator = createCreatorForMember(member, meta).creator;

  const savedCreator = updateCreator(guildId, creator.creatorId, (current) => ({
    ...current,
    ownerDiscordId,
    displayName: clean(values.displayName, 120),
    group: clean(values.group, 120),
    tags: String(values.tags || '')
      .split(',')
      .map((value) => clean(value, 60))
      .filter(Boolean),
    notes: clean(values.notes, 1000),
    adminNotes: clean(values.adminNotes, 1000),
    enabled: current.enabled !== false,
    status: 'active',
    departureType: null,
    leftAt: null,
    scheduledDeletionAt: null,
    accountIds: array(current.accountIds),
    profileCompleted: true,
  }), meta);

  return { creator: savedCreator, created: !wasCompleted };
}

function updateCreator(guildId, creatorId, updater, meta = {}) {
  let savedCreator = null;

  updateSection(guildId, (section) => {
    const current = section.creators[String(creatorId)];
    if (!current) throw new Error('Creator profile was not found.');

    const next = typeof updater === 'function'
      ? updater({ ...current })
      : { ...current, ...object(updater) };

    next.creatorId = current.creatorId;
    next.ownerDiscordId = current.ownerDiscordId || next.ownerDiscordId || null;
    next.updatedAt = new Date().toISOString();
    section.creators[String(creatorId)] = next;
    savedCreator = next;
    return section;
  }, meta);

  return savedCreator;
}

function markCreatorActive(guildId, ownerDiscordId, meta = {}) {
  const creator = findCreatorByOwner(guildId, ownerDiscordId);
  if (!creator) return null;

  return updateCreator(guildId, creator.creatorId, (current) => ({
    ...current,
    enabled: current.enabled !== false,
    status: 'active',
    departureType: null,
    leftAt: null,
    scheduledDeletionAt: null,
  }), meta);
}

function markCreatorDeparted(guildId, ownerDiscordId, departureType = 'left', meta = {}) {
  const creator = findCreatorByOwner(guildId, ownerDiscordId);
  if (!creator) return null;

  const leftAt = new Date();
  return updateCreator(guildId, creator.creatorId, (current) => ({
    ...current,
    status: departureType === 'kicked' ? 'kicked' : 'left_server',
    departureType: departureType === 'kicked' ? 'kicked' : 'left',
    leftAt: leftAt.toISOString(),
    scheduledDeletionAt: new Date(leftAt.getTime() + CREATOR_DELETE_GRACE_MS).toISOString(),
  }), meta);
}

function getExpiredCreators(guildId, nowMs = Date.now()) {
  return Object.values(getSection(guildId).creators).filter((creator) => {
    if (!['left_server', 'kicked'].includes(String(creator?.status || ''))) return false;
    const deleteAt = new Date(creator?.scheduledDeletionAt || '').getTime();
    return Number.isFinite(deleteAt) && deleteAt <= nowMs;
  });
}

function deleteCreator(guildId, creatorId, meta = {}) {
  const id = String(creatorId);
  let deleted = false;

  updateSection(guildId, (section) => {
    const creator = section.creators[id];
    if (!creator) return section;

    const accountIds = new Set(array(creator.accountIds).map(String));
    delete section.creators[id];

    for (const accountId of accountIds) delete section.accounts[accountId];

    for (const key of ['drafts', 'scheduledPosts', 'creatorPreferences', 'notifications']) {
      const collection = object(section[key]);
      for (const [entryId, value] of Object.entries(collection)) {
        if (
          String(value?.creatorId || '') === id
          || String(value?.ownerDiscordId || '') === String(creator.ownerDiscordId || '')
        ) {
          delete collection[entryId];
        }
      }
      if (section[key]) section[key] = collection;
    }

    deleted = true;
    return section;
  }, meta);

  return deleted;
}

function deleteCreatorByOwner(guildId, ownerDiscordId, meta = {}) {
  const creator = findCreatorByOwner(guildId, ownerDiscordId);
  return creator ? deleteCreator(guildId, creator.creatorId, meta) : false;
}

function deleteExpiredCreators(guildId, nowMs = Date.now(), meta = {}) {
  const expired = getExpiredCreators(guildId, nowMs);
  const deleted = [];

  for (const creator of expired) {
    if (deleteCreator(guildId, creator.creatorId, meta)) deleted.push(creator.creatorId);
  }

  return deleted;
}

function getAccount(guildId, accountId) {
  return getSection(guildId).accounts[String(accountId)] || null;
}

function updateAccount(guildId, accountId, updater, meta = {}) {
  let savedAccount = null;

  updateSection(guildId, (section) => {
    const current = section.accounts[String(accountId)];
    if (!current) throw new Error('Social account was not found.');

    const next = typeof updater === 'function'
      ? updater({ ...current })
      : { ...current, ...object(updater) };

    next.accountId = current.accountId;
    next.updatedAt = new Date().toISOString();
    section.accounts[String(accountId)] = next;
    savedAccount = next;
    return section;
  }, meta);

  return savedAccount;
}

function upsertCreatorAccount(guildId, creatorId, account, duplicateAccountIds = [], meta = {}) {
  const id = String(creatorId);
  const accountId = String(account?.accountId || '');
  if (!accountId) throw new Error('Social account ID is required.');

  let saved = null;
  updateSection(guildId, (section) => {
    const creator = section.creators[id];
    if (!creator) throw new Error('Creator profile was not found.');

    const duplicateIds = new Set(array(duplicateAccountIds).map(String).filter(Boolean));
    duplicateIds.delete(accountId);

    for (const duplicateId of duplicateIds) delete section.accounts[duplicateId];
    for (const item of Object.values(section.creators)) {
      item.accountIds = array(item.accountIds)
        .map(String)
        .filter((value) => !duplicateIds.has(value));
    }

    const timestamp = new Date().toISOString();
    const current = section.accounts[accountId] || {};
    const nextAccount = {
      ...current,
      ...object(account),
      accountId,
      createdAt: current.createdAt || account.createdAt || timestamp,
      updatedAt: timestamp,
    };

    section.accounts[accountId] = nextAccount;
    creator.accountIds = [...new Set([...array(creator.accountIds).map(String), accountId])];
    creator.updatedAt = timestamp;
    saved = { account: nextAccount, creator };
    return section;
  }, meta);

  return saved;
}

function deleteAccount(guildId, accountId, meta = {}) {
  const id = String(accountId);
  let deleted = false;

  updateSection(guildId, (section) => {
    if (!section.accounts[id]) return section;

    delete section.accounts[id];
    for (const creator of Object.values(section.creators)) {
      creator.accountIds = array(creator.accountIds).filter((value) => String(value) !== id);
      creator.updatedAt = new Date().toISOString();
    }

    deleted = true;
    return section;
  }, meta);

  return deleted;
}

function isEnabled(guildId) {
  return guildManager.isModuleEnabled(guildId, SECTION);
}

function setEnabled(guildId, enabled, meta = {}) {
  guildManager.setModuleEnabled(guildId, SECTION, enabled === true, meta);
  return isEnabled(guildId);
}

module.exports = {
  getSection,
  getConfig,
  getManagerRoleIds,
  getUserRoleIds,
  saveConfig,
  getCreator,
  findCreatorByOwner,
  getCreatorAccounts,
  completeCreatorProfile,
  updateCreator,
  markCreatorActive,
  markCreatorDeparted,
  deleteExpiredCreators,
  deleteCreator,
  deleteCreatorByOwner,
  getAccount,
  updateAccount,
  upsertCreatorAccount,
  deleteAccount,
  isEnabled,
  setEnabled,
};
