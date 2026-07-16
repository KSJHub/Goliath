'use strict';

const crypto = require('crypto');
const socialStore = require('./socialStore');

function now() { return new Date().toISOString(); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function clean(value, fallback = '', max = 500) { return String(value ?? fallback).trim().slice(0, max); }
function cleanId(value, fallback = 'creator') {
  return (String(value || fallback).toLowerCase().trim().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || fallback).slice(0, 80);
}
function uniqueStrings(value, maxItems = 20, maxLength = 50) {
  return [...new Set((Array.isArray(value) ? value : String(value || '').split(',')).map((item) => clean(item, '', maxLength)).filter(Boolean))].slice(0, maxItems);
}
function normalizeProfile(profile = {}) {
  const creatorId = cleanId(profile.creatorId || profile.id || `creator-${crypto.randomUUID().slice(0, 8)}`);
  return {
    creatorId,
    id: creatorId,
    displayName: clean(profile.displayName || profile.name || 'Creator', 'Creator', 120),
    notes: clean(profile.notes, '', 2000),
    tags: uniqueStrings(profile.tags),
    group: clean(profile.group, '', 80) || null,
    enabled: profile.enabled !== false,
    accountIds: uniqueStrings(profile.accountIds, 25, 100),
    defaults: profile.defaults && typeof profile.defaults === 'object' && !Array.isArray(profile.defaults) ? clone(profile.defaults) : {},
    createdAt: profile.createdAt || now(),
    updatedAt: profile.updatedAt || profile.createdAt || now(),
  };
}
function profileMap(guildId) {
  const section = socialStore.getSocialSection(guildId);
  const source = section.creatorProfiles && typeof section.creatorProfiles === 'object' && !Array.isArray(section.creatorProfiles) ? section.creatorProfiles : {};
  return Object.fromEntries(Object.entries(source).map(([id, profile]) => {
    const normalized = normalizeProfile({ ...profile, creatorId: profile.creatorId || id });
    return [normalized.creatorId, normalized];
  }));
}
function list(guildId) { return Object.values(profileMap(guildId)).sort((a, b) => a.displayName.localeCompare(b.displayName)); }
function get(guildId, creatorId) { return profileMap(guildId)[cleanId(creatorId)] || null; }
function save(guildId, profile, meta = {}) {
  const normalized = normalizeProfile(profile);
  return socialStore.updateSocialSection(guildId, (section) => ({
    ...section,
    creatorProfiles: { ...(section.creatorProfiles || {}), [normalized.creatorId]: { ...(section.creatorProfiles?.[normalized.creatorId] || {}), ...normalized, updatedAt: now() } },
    updatedAt: now(),
  }), { action: 'social_creator_profile_save', ...meta }).creatorProfiles[normalized.creatorId];
}
function remove(guildId, creatorId, meta = {}) {
  const safeId = cleanId(creatorId);
  let removed = false;
  socialStore.updateSocialSection(guildId, (section) => {
    const creatorProfiles = { ...(section.creatorProfiles || {}) };
    removed = Boolean(creatorProfiles[safeId]);
    delete creatorProfiles[safeId];
    const accounts = Object.fromEntries(Object.entries(section.accounts || {}).map(([accountId, account]) => [accountId, {
      ...account,
      metadata: account.metadata?.creatorId === safeId ? { ...(account.metadata || {}), creatorId: null } : account.metadata,
    }]));
    return { ...section, creatorProfiles, accounts, updatedAt: now() };
  }, { action: 'social_creator_profile_remove', ...meta });
  return removed;
}
function linkAccount(guildId, creatorId, accountId, meta = {}) {
  const safeCreatorId = cleanId(creatorId);
  const safeAccountId = cleanId(accountId, 'account');
  const section = socialStore.getSocialSection(guildId);
  const account = section.accounts?.[safeAccountId];
  if (!account) throw new Error('Social account not found.');
  let profile = get(guildId, safeCreatorId);
  if (!profile) profile = save(guildId, { creatorId: safeCreatorId, displayName: account.displayName || account.username || 'Creator' }, meta);
  socialStore.updateSocialSection(guildId, (current) => ({
    ...current,
    creatorProfiles: {
      ...(current.creatorProfiles || {}),
      [safeCreatorId]: normalizeProfile({ ...(current.creatorProfiles?.[safeCreatorId] || profile), accountIds: [...new Set([...(current.creatorProfiles?.[safeCreatorId]?.accountIds || profile.accountIds || []), safeAccountId])], updatedAt: now() }),
    },
    accounts: {
      ...(current.accounts || {}),
      [safeAccountId]: { ...current.accounts[safeAccountId], metadata: { ...(current.accounts[safeAccountId].metadata || {}), creatorId: safeCreatorId }, updatedAt: now() },
    },
    updatedAt: now(),
  }), { action: 'social_creator_account_link', ...meta });
  return get(guildId, safeCreatorId);
}
function unlinkAccount(guildId, creatorId, accountId, meta = {}) {
  const safeCreatorId = cleanId(creatorId);
  const safeAccountId = cleanId(accountId, 'account');
  socialStore.updateSocialSection(guildId, (section) => ({
    ...section,
    creatorProfiles: section.creatorProfiles?.[safeCreatorId] ? {
      ...(section.creatorProfiles || {}),
      [safeCreatorId]: normalizeProfile({ ...section.creatorProfiles[safeCreatorId], accountIds: (section.creatorProfiles[safeCreatorId].accountIds || []).filter((id) => id !== safeAccountId), updatedAt: now() }),
    } : section.creatorProfiles,
    accounts: section.accounts?.[safeAccountId] ? {
      ...(section.accounts || {}),
      [safeAccountId]: { ...section.accounts[safeAccountId], metadata: { ...(section.accounts[safeAccountId].metadata || {}), creatorId: null }, updatedAt: now() },
    } : section.accounts,
    updatedAt: now(),
  }), { action: 'social_creator_account_unlink', ...meta });
  return get(guildId, safeCreatorId);
}
function rebuild(guildId, meta = {}) {
  const section = socialStore.getSocialSection(guildId);
  const existing = profileMap(guildId);
  const profiles = { ...existing };
  for (const account of Object.values(section.accounts || {})) {
    const linkedId = cleanId(account.metadata?.creatorId || account.displayName || account.username || account.accountId);
    const current = profiles[linkedId] || normalizeProfile({ creatorId: linkedId, displayName: account.displayName || account.username || 'Creator' });
    profiles[linkedId] = normalizeProfile({ ...current, accountIds: [...new Set([...(current.accountIds || []), account.accountId])] });
  }
  socialStore.updateSocialSection(guildId, (current) => ({ ...current, creatorProfiles: profiles, updatedAt: now() }), { action: 'social_creator_profiles_rebuild', ...meta });
  return list(guildId);
}
function summary(guildId) {
  const profiles = list(guildId);
  return { total: profiles.length, enabled: profiles.filter((profile) => profile.enabled !== false).length, linkedAccounts: profiles.reduce((sum, profile) => sum + profile.accountIds.length, 0), groups: [...new Set(profiles.map((profile) => profile.group).filter(Boolean))] };
}

module.exports = { normalizeProfile, list, get, save, remove, linkAccount, unlinkAccount, rebuild, summary };
