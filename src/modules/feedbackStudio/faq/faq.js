'use strict';

const crypto = require('crypto');
const { getModuleSection, saveModuleSection, updateModuleSection } = require('../../../core/guild/moduleSectionManager');

const MODULE = 'faq';
const now = () => new Date().toISOString();
const clone = (v) => v == null ? v : JSON.parse(JSON.stringify(v));
const cleanText = (v, max = 1000) => String(v ?? '').trim().slice(0, max);
const cleanKey = (v, fallback = 'faq') => (String(v || fallback).toLowerCase().trim().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || fallback).slice(0, 80);
const cleanDiscordId = (v) => { const id = String(v || '').replace(/[<@#!&>]/g, '').trim(); return /^\d{15,25}$/.test(id) ? id : null; };
const createId = (prefix) => `${prefix}_${crypto.randomUUID().slice(0, 8)}`;

function defaults() {
  return {
    settings: { channelId: null, managerRoleIds: [], ephemeralAnswers: true },
    categories: {},
    entries: {},
    panel: { channelId: null, messageId: null, deployedAt: null },
    analytics: { views: 0, searches: 0 },
    createdAt: now(), updatedAt: now(),
  };
}

function normalizeCategory(value = {}) {
  const id = cleanKey(value.id || createId('category'), 'category');
  return { id, name: cleanText(value.name || 'New Category', 100), description: cleanText(value.description, 200), emoji: cleanText(value.emoji, 50), enabled: value.enabled !== false, order: Number(value.order || 0), createdAt: value.createdAt || now(), updatedAt: value.updatedAt || now() };
}

function normalizeEntry(value = {}) {
  const id = cleanKey(value.id || createId('faq'), 'faq');
  return { id, categoryId: cleanKey(value.categoryId || 'general', 'general'), question: cleanText(value.question || 'New Question', 200), answer: cleanText(value.answer || '', 4000), keywords: Array.isArray(value.keywords) ? value.keywords.map((x) => cleanText(x, 50)).filter(Boolean).slice(0, 20) : [], enabled: value.enabled !== false, order: Number(value.order || 0), createdAt: value.createdAt || now(), updatedAt: value.updatedAt || now() };
}

function normalize(section = {}) {
  const base = defaults();
  const source = section && typeof section === 'object' ? clone(section) : {};
  return {
    ...base, ...source,
    settings: { ...base.settings, ...(source.settings || {}), channelId: cleanDiscordId(source.settings?.channelId), managerRoleIds: Array.isArray(source.settings?.managerRoleIds) ? source.settings.managerRoleIds.map(cleanDiscordId).filter(Boolean) : [] },
    categories: Object.fromEntries(Object.entries(source.categories || {}).map(([id, item]) => { const n = normalizeCategory({ ...item, id: item.id || id }); return [n.id, n]; })),
    entries: Object.fromEntries(Object.entries(source.entries || {}).map(([id, item]) => { const n = normalizeEntry({ ...item, id: item.id || id }); return [n.id, n]; })),
    panel: { ...base.panel, ...(source.panel || {}), channelId: cleanDiscordId(source.panel?.channelId), messageId: cleanDiscordId(source.panel?.messageId) },
    analytics: { views: Math.max(0, Number(source.analytics?.views || 0)), searches: Math.max(0, Number(source.analytics?.searches || 0)) },
    updatedAt: source.updatedAt || now(),
  };
}

function getSection(guildId) { return normalize(getModuleSection(guildId, MODULE, defaults())); }
function saveSection(guildId, section, meta = {}) { return normalize(saveModuleSection(guildId, MODULE, normalize(section), meta)); }
function updateSection(guildId, updater, meta = {}) { return normalize(updateModuleSection(guildId, MODULE, (current) => { const n = normalize(current); return normalize(typeof updater === 'function' ? updater(clone(n)) : updater); }, defaults(), meta)); }
function listCategories(guildId) { return Object.values(getSection(guildId).categories).filter((x) => x.enabled !== false).sort((a,b) => a.order-b.order || a.name.localeCompare(b.name)); }
function listEntries(guildId, categoryId = null) { return Object.values(getSection(guildId).entries).filter((x) => x.enabled !== false && (!categoryId || x.categoryId === cleanKey(categoryId))).sort((a,b) => a.order-b.order || a.question.localeCompare(b.question)); }
function getEntry(guildId, id) { return getSection(guildId).entries[cleanKey(id)] || null; }
function saveCategory(guildId, category, meta = {}) { const n = normalizeCategory(category); return updateSection(guildId, s => ({ ...s, categories: { ...s.categories, [n.id]: n }, updatedAt: now() }), meta).categories[n.id]; }
function saveEntry(guildId, entry, meta = {}) { const n = normalizeEntry(entry); return updateSection(guildId, s => ({ ...s, entries: { ...s.entries, [n.id]: n }, updatedAt: now() }), meta).entries[n.id]; }
function deleteCategory(guildId, id, meta = {}) { id = cleanKey(id); return updateSection(guildId, s => { const categories = { ...s.categories }; delete categories[id]; const entries = Object.fromEntries(Object.entries(s.entries).filter(([,e]) => e.categoryId !== id)); return { ...s, categories, entries, updatedAt: now() }; }, meta); }
function deleteEntry(guildId, id, meta = {}) { id = cleanKey(id); return updateSection(guildId, s => { const entries = { ...s.entries }; delete entries[id]; return { ...s, entries, updatedAt: now() }; }, meta); }
function search(guildId, query) { const q = cleanText(query, 100).toLowerCase(); if (!q) return []; return listEntries(guildId).filter(e => [e.question,e.answer,...e.keywords].join(' ').toLowerCase().includes(q)).slice(0,25); }

module.exports = { MODULE, defaults, normalize, normalizeCategory, normalizeEntry, getSection, saveSection, updateSection, listCategories, listEntries, getEntry, saveCategory, saveEntry, deleteCategory, deleteEntry, search, cleanKey, cleanText, cleanDiscordId };
