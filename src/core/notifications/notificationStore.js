'use strict';

const crypto = require('node:crypto');
const { getGuildSection, updateGuildSection } = require('../guild/guildManager');
const activity = require('../activity/activityStore');

function now() { return new Date().toISOString(); }
function obj(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function text(value = '', max = 1000) { return String(value || '').trim().slice(0, max); }
function base() { return { notifications: [], updatedAt: now() }; }
function notificationArray(value) { return Array.isArray(value) ? value : []; }

function normalise(input = {}) {
  const level = ['info', 'success', 'warning', 'danger'].includes(input.level) ? input.level : 'info';
  return {
    id: input.id || `notif_${crypto.randomUUID()}`,
    level,
    source: text(input.source || 'system', 80),
    title: text(input.title || 'Notification', 160),
    message: text(input.message || '', 1000),
    route: text(input.route || '', 200),
    read: Boolean(input.read),
    createdAt: input.createdAt || now(),
    updatedAt: input.updatedAt || now(),
    metadata: obj(input.metadata),
  };
}

function section(guildId) {
  const current = { ...base(), ...obj(getGuildSection(guildId, 'notifications', base())) };
  return { ...current, notifications: notificationArray(current.notifications) };
}

function listNotifications(guildId, options = {}) {
  let items = [...section(guildId).notifications].map(normalise);
  if (options.unreadOnly) items = items.filter((item) => !item.read);
  if (options.source) items = items.filter((item) => item.source === options.source);
  if (options.level) items = items.filter((item) => item.level === options.level);
  const requestedLimit = Number(options.limit ?? 100);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(300, requestedLimit)) : 100;
  return items.slice(0, limit);
}

function mirrorActivity(guildId, notification) {
  if (!guildId || notification.metadata?.skipActivity === true) return null;
  try {
    return activity.logActivity(guildId, {
      module: notification.source,
      event: notification.metadata?.event || `${notification.source}.notification`,
      title: notification.title,
      message: notification.message,
      severity: notification.level,
      route: notification.route,
      actorId: notification.metadata?.actorId || notification.metadata?.userId || notification.metadata?.createdBy || null,
      targetId: notification.metadata?.ticketId || notification.metadata?.submissionId || notification.metadata?.backupId || notification.metadata?.ruleId || null,
      createdAt: notification.createdAt,
      metadata: {
        ...notification.metadata,
        notificationId: notification.id,
      },
    });
  } catch (error) {
    console.warn('[NotificationStore] Activity mirror skipped:', error.message || error);
    return null;
  }
}

function addNotification(guildId, input = {}) {
  const notification = normalise(input);
  updateGuildSection(guildId, 'notifications', (current = base()) => {
    const next = { ...base(), ...obj(current) };
    const notifications = notificationArray(next.notifications);
    return { ...next, notifications: [notification, ...notifications].slice(0, 300), updatedAt: now() };
  }, base());
  mirrorActivity(guildId, notification);
  return notification;
}

function addNotificationOnce(guildId, input = {}, options = {}) {
  const fingerprint = text(options.fingerprint || input.metadata?.fingerprint || `${input.source || 'system'}:${input.title || 'Notification'}`, 200);
  const requestedWindowMs = Number(options.windowMs ?? 10 * 60_000);
  const windowMs = Number.isFinite(requestedWindowMs) ? Math.max(60_000, requestedWindowMs) : 10 * 60_000;
  const cutoff = Date.now() - windowMs;
  const existing = listNotifications(guildId, { limit: 300 }).find((item) => {
    const itemFingerprint = item.metadata?.fingerprint || `${item.source}:${item.title}`;
    const createdAt = Date.parse(item.createdAt || 0) || 0;
    return itemFingerprint === fingerprint && createdAt >= cutoff;
  });
  if (existing) return existing;
  return addNotification(guildId, { ...input, metadata: { ...(input.metadata || {}), fingerprint } });
}

function markRead(guildId, notificationId, read = true) {
  let updated = null;
  updateGuildSection(guildId, 'notifications', (current = base()) => {
    const next = { ...base(), ...obj(current) };
    const notifications = notificationArray(next.notifications).map((item) => {
      if (item.id !== notificationId) return item;
      updated = { ...normalise(item), read: Boolean(read), updatedAt: now() };
      return updated;
    });
    return { ...next, notifications, updatedAt: now() };
  }, base());
  return updated;
}

function markAllRead(guildId) {
  updateGuildSection(guildId, 'notifications', (current = base()) => {
    const next = { ...base(), ...obj(current) };
    return { ...next, notifications: notificationArray(next.notifications).map((item) => ({ ...normalise(item), read: true, updatedAt: now() })), updatedAt: now() };
  }, base());
  return listNotifications(guildId);
}

function clearNotifications(guildId) {
  updateGuildSection(guildId, 'notifications', () => base(), base());
  return [];
}

function summary(guildId) {
  const items = listNotifications(guildId, { limit: 300 });
  return {
    total: items.length,
    unread: items.filter((item) => !item.read).length,
    danger: items.filter((item) => item.level === 'danger').length,
    warning: items.filter((item) => item.level === 'warning').length,
    sources: [...new Set(items.map((item) => item.source))],
  };
}

module.exports = { listNotifications, addNotification, addNotificationOnce, markRead, markAllRead, clearNotifications, summary };
