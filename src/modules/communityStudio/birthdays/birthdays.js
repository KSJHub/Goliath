'use strict';

const { PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const guildManager = require('../../../core/guild/guildManager');
const { getModuleSection, saveModuleSection, updateModuleSection } = require('../../../core/guild/moduleSectionManager');
const sentinelScheduler = require('../../../owner/sentinel/schedulerRegistry.js');
const emojis = require('../../utilityStudio/emojis/emojis');

const SECTION = 'birthdays';
const TICK_MS = 60 * 1000;
const SCHEDULER_ID = 'birthdays:processor:global';
const UPCOMING_WINDOW_DAYS = 30;
const LEFT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const LEGACY_MESSAGE_TEMPLATE = '🎂 Happy Birthday {mention}! We hope you have a fantastic day! 🎉';
const DEFAULT_INDIVIDUAL_TEMPLATES = [
  '🎂 Happy Birthday {mention}! We hope you have a fantastic day! 🎉',
  '🎉 Happy Birthday {mention}! From everyone at {server}, we hope you have an amazing day! 🎂',
  '🥳 Wishing {mention} a very Happy Birthday from everyone at {server}! Have a brilliant day! 🎉',
  '🎈 It’s {mention}’s birthday! Everyone at {server} wishes you a fantastic day! 🎂',
  '🎁 Happy Birthday {mention}! Here’s to another amazing year from all of us at {server}! 🥳',
  '🎊 It’s time to celebrate {mention}! Happy Birthday from everyone at {server}! 🎂',
  '🥳 Another trip around the sun! Happy Birthday {mention}! Have an incredible day! 🎉',
  '🎂 Today is all about {mention}! Everyone at {server} wishes you the happiest of birthdays! 🎈',
  '🎉 Sending huge birthday wishes to {mention} from all of us at {server}! Have an amazing one! 🥳',
  '🎁 Happy Birthday {mention}! We hope your day is packed with laughs, celebrations and cake! 🎂',
];
const DEFAULT_GROUP_TEMPLATES = [
  '🎂 Happy Birthday {mentions}! From everyone at {server}, we hope you all have a fantastic day! 🎉',
  '🥳 We have {count} birthdays to celebrate today! Happy Birthday {mentions} from everyone at {server}! 🎂',
  '🎉 Birthday celebrations all round! Happy Birthday {mentions}! Have an amazing day from everyone at {server}! 🎈',
  '🎁 A very Happy Birthday to {mentions}! Everyone at {server} hopes you have a brilliant day! 🥳',
  '🎂 Today we’re celebrating {count} birthdays! Happy Birthday {mentions} from all of us at {server}! 🎉',
  '🎊 Double the cake, triple the fun — we have {count} birthdays today! Happy Birthday {mentions} from everyone at {server}! 🎂',
  '🥳 A huge Happy Birthday to {mentions}! All of us at {server} hope you have an incredible celebration! 🎉',
  '🎈 Today belongs to {mentions}! Happy Birthday from everyone at {server} — enjoy every minute! 🎂',
  '🎉 We’re celebrating {count} amazing people today! Happy Birthday {mentions} from all of us at {server}! 🥳',
  '🎁 Birthday wishes are going out to {mentions}! Everyone at {server} hopes your day is full of fun, laughs and cake! 🎂',
];
const DEFAULT_MESSAGE_TEMPLATE = DEFAULT_INDIVIDUAL_TEMPLATES[0];
const DEFAULT_CARD_IMAGE_URL = 'https://static2.klipy.com/ii/bea85337777ad0e23e63683391435543/47/a8/WjSzGEC0.gif';
const now = () => new Date().toISOString();
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const clean = (value, max = 1000) => String(value ?? '').trim().slice(0, max);
const cleanId = (value) => {
  const id = String(value || '').replace(/[<@&#!>]/g, '').trim();
  return /^\d{15,25}$/.test(id) ? id : null;
};
const validUrl = (value) => {
  const url = clean(value, 2000);
  return /^https?:\/\//i.test(url) ? url : null;
};
const validColor = (value) => /^#?[0-9a-f]{6}$/i.test(String(value || '').trim());
const colorInt = (value) => parseInt(String(value || '#5865F2').replace('#', ''), 16);

function normalizeTimezone(value) {
  const timezone = String(value || '').trim();
  if (!timezone) return null;
  if (/^(?:GMT|BST)$/i.test(timezone)) return 'Europe/London';
  return timezone;
}

function validTimezone(value) {
  try { new Intl.DateTimeFormat('en-GB', { timeZone: normalizeTimezone(value) || value }).format(new Date()); return true; }
  catch { return false; }
}

function validTime(value) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''));
}

function normalizeTemplates(input, fallback = DEFAULT_INDIVIDUAL_TEMPLATES) {
  const list = Array.isArray(input) ? input : String(input || '').split(/\r?\n/);
  const result = [...new Set(list.map((item) => clean(item, 1800)).filter(Boolean))].slice(0, 20);
  return result.length ? result : [...fallback];
}

function defaultSection() {
  return {
    settings: {
      announcementChannelId: null,
      announcementTime: '09:00',
      timezone: 'Europe/London',
      messageTemplate: DEFAULT_MESSAGE_TEMPLATE,
      messageTemplates: [...DEFAULT_INDIVIDUAL_TEMPLATES],
      groupMessageTemplates: [...DEFAULT_GROUP_TEMPLATES],
      birthdayRoleId: null,
      showAgeByDefault: false,
      announceByDefault: true,
      listByDefault: true,
      leapDayMode: 'feb28',
      monthlyBoardChannelId: null,
      monthlyBoardDay: 1,
      monthlyBoardTime: '09:00',
      combineSameDay: false,
      useBirthdayEmbed: true,
      cardTitle: '🎂 Happy Birthday!',
      cardFooter: 'From everyone at {server} 🎉',
      cardColor: '#5865F2',
      cardImageMode: 'default',
      cardImageUrl: null,
      cardUseServerIcon: true,
    },
    members: {},
    monthlyBoard: { lastPostedKey: null },
    analytics: {
      birthdaysStored: 0,
      announcementsSent: 0,
      monthlyBoardsSent: 0,
      rolesAssigned: 0,
      rolesRemoved: 0,
      staleRecordsRemoved: 0,
      imports: 0,
      failures: 0,
      lastProcessedAt: null,
      lastAnnouncementAt: null,
      lastMonthlyBoardAt: null,
      lastRoleAssignedAt: null,
      lastFailureAt: null,
    },
    createdAt: now(),
    updatedAt: now(),
  };
}

function normalizeMember(input = {}, userId = null, settings = defaultSection().settings) {
  const id = cleanId(input.userId || userId);
  if (!id) throw new Error('A valid Discord user is required.');
  const month = Math.floor(Number(input.month));
  const day = Math.floor(Number(input.day));
  const year = input.year == null || input.year === '' ? null : Math.floor(Number(input.year));
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error('Birthday month must be between 1 and 12.');
  const maxDay = new Date(Date.UTC(2024, month, 0)).getUTCDate();
  if (!Number.isInteger(day) || day < 1 || day > maxDay) throw new Error('Birthday day is invalid for that month.');
  const currentYear = new Date().getUTCFullYear();
  if (year != null && (!Number.isInteger(year) || year < 1900 || year > currentYear)) throw new Error('Birthday year is invalid.');
  return {
    userId: id,
    month,
    day,
    year,
    listPublic: input.listPublic == null ? settings.listByDefault !== false : input.listPublic !== false,
    announce: input.announce == null ? settings.announceByDefault !== false : input.announce !== false,
    showAge: input.showAge == null ? settings.showAgeByDefault === true : input.showAge === true,
    lastAnnouncedKey: clean(input.lastAnnouncedKey, 20) || null,
    roleAssignedAt: input.roleAssignedAt || null,
    roleAssignedRoleId: cleanId(input.roleAssignedRoleId),
    leftAt: input.leftAt || null,
    createdAt: input.createdAt || now(),
    updatedAt: now(),
  };
}

function normalizeSection(section = {}) {
  const base = defaultSection();
  const raw = section && typeof section === 'object' ? section : {};
  const rawTimezone = normalizeTimezone(raw.settings?.timezone);
  const rawMessageTemplate = clean(raw.settings?.messageTemplate, 1800);
  const templates = normalizeTemplates(raw.settings?.messageTemplates || rawMessageTemplate || base.settings.messageTemplates, DEFAULT_INDIVIDUAL_TEMPLATES);
  const groupTemplates = normalizeTemplates(raw.settings?.groupMessageTemplates || base.settings.groupMessageTemplates, DEFAULT_GROUP_TEMPLATES);
  const rawCardImageUrl = validUrl(raw.settings?.cardImageUrl);
  const requestedImageMode = String(raw.settings?.cardImageMode || '').trim().toLowerCase();
  const cardImageMode = ['default', 'custom', 'none'].includes(requestedImageMode)
    ? requestedImageMode
    : (rawCardImageUrl ? 'custom' : 'default');
  const settings = {
    ...base.settings,
    ...(raw.settings || {}),
    announcementChannelId: cleanId(raw.settings?.announcementChannelId),
    announcementTime: validTime(raw.settings?.announcementTime) ? raw.settings.announcementTime : base.settings.announcementTime,
    timezone: rawTimezone && validTimezone(rawTimezone) ? rawTimezone : base.settings.timezone,
    messageTemplate: !rawMessageTemplate || rawMessageTemplate === LEGACY_MESSAGE_TEMPLATE ? templates[0] : rawMessageTemplate,
    messageTemplates: templates,
    groupMessageTemplates: groupTemplates,
    birthdayRoleId: cleanId(raw.settings?.birthdayRoleId),
    showAgeByDefault: raw.settings?.showAgeByDefault === true,
    announceByDefault: raw.settings?.announceByDefault !== false,
    listByDefault: raw.settings?.listByDefault !== false,
    leapDayMode: 'feb28',
    monthlyBoardChannelId: cleanId(raw.settings?.monthlyBoardChannelId),
    monthlyBoardDay: Math.max(1, Math.min(28, Math.floor(Number(raw.settings?.monthlyBoardDay) || base.settings.monthlyBoardDay))),
    monthlyBoardTime: validTime(raw.settings?.monthlyBoardTime) ? raw.settings.monthlyBoardTime : base.settings.monthlyBoardTime,
    combineSameDay: raw.settings?.combineSameDay === true,
    useBirthdayEmbed: raw.settings?.useBirthdayEmbed !== false,
    cardTitle: clean(raw.settings?.cardTitle || base.settings.cardTitle, 256) || base.settings.cardTitle,
    cardFooter: clean(raw.settings?.cardFooter || base.settings.cardFooter, 2048) || base.settings.cardFooter,
    cardColor: validColor(raw.settings?.cardColor) ? `#${String(raw.settings.cardColor).replace('#', '').toUpperCase()}` : base.settings.cardColor,
    cardImageMode,
    cardImageUrl: rawCardImageUrl,
    cardUseServerIcon: raw.settings?.cardUseServerIcon !== false,
  };
  const members = {};
  for (const [userId, record] of Object.entries(raw.members || {})) {
    try { members[userId] = normalizeMember(record, userId, settings); } catch {}
  }
  return {
    ...base,
    ...clone(raw),
    settings,
    members,
    monthlyBoard: { ...base.monthlyBoard, ...(raw.monthlyBoard || {}) },
    analytics: { ...base.analytics, ...(raw.analytics || {}) },
    updatedAt: raw.updatedAt || now(),
  };
}

function getSection(guildId) {
  return normalizeSection(getModuleSection(guildId, SECTION, defaultSection()));
}
function saveSection(guildId, section, meta = {}) {
  return normalizeSection(saveModuleSection(guildId, SECTION, normalizeSection(section), meta));
}
function updateSection(guildId, updater, meta = {}) {
  return normalizeSection(updateModuleSection(guildId, SECTION, (current) => {
    const normalized = normalizeSection(current);
    const next = typeof updater === 'function' ? updater(clone(normalized)) : updater;
    return { ...normalizeSection(next), updatedAt: now() };
  }, defaultSection(), meta));
}
function incrementAnalytics(guildId, patch, meta = {}) {
  return updateSection(guildId, (section) => {
    const analytics = { ...section.analytics };
    for (const [key, value] of Object.entries(patch)) analytics[key] = typeof value === 'number' ? Number(analytics[key] || 0) + value : value;
    return { ...section, analytics };
  }, meta).analytics;
}
function updateSettings(guildId, patch = {}, meta = {}) {
  const normalizedPatch = { ...patch };
  if ('timezone' in normalizedPatch) normalizedPatch.timezone = normalizeTimezone(normalizedPatch.timezone);
  if ('messageTemplates' in normalizedPatch) normalizedPatch.messageTemplates = normalizeTemplates(normalizedPatch.messageTemplates, DEFAULT_INDIVIDUAL_TEMPLATES);
  if ('groupMessageTemplates' in normalizedPatch) normalizedPatch.groupMessageTemplates = normalizeTemplates(normalizedPatch.groupMessageTemplates, DEFAULT_GROUP_TEMPLATES);
  if ('cardImageMode' in normalizedPatch && !['default', 'custom', 'none'].includes(String(normalizedPatch.cardImageMode))) normalizedPatch.cardImageMode = 'default';
  return updateSection(guildId, (section) => ({ ...section, settings: { ...section.settings, ...normalizedPatch } }), meta).settings;
}

function getBirthday(guildId, userId) { return getSection(guildId).members[String(userId)] || null; }
function setBirthday(guildId, userId, input = {}, meta = {}) {
  const section = getSection(guildId);
  const existing = section.members[String(userId)] || {};
  const member = normalizeMember({ ...existing, ...input, userId }, userId, section.settings);
  const created = !section.members[member.userId];
  updateSection(guildId, (current) => ({ ...current, members: { ...current.members, [member.userId]: member } }), meta);
  if (created) incrementAnalytics(guildId, { birthdaysStored: 1 }, meta);
  return getBirthday(guildId, member.userId);
}
function removeBirthday(guildId, userId, meta = {}) {
  let removed = null;
  updateSection(guildId, (section) => {
    const members = { ...section.members };
    removed = members[String(userId)] || null;
    delete members[String(userId)];
    return { ...section, members };
  }, meta);
  return removed;
}

function zonedParts(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}
function isLeapYear(year) { return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0); }
function effectiveBirthday(member, year, settings) {
  if (member.month !== 2 || member.day !== 29 || isLeapYear(year)) return { month: member.month, day: member.day };
  return { month: 2, day: 28 };
}
function birthdayKey(member, year, settings) {
  const date = effectiveBirthday(member, year, settings);
  return `${year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}
function ageFor(member, year) { return member.year ? Math.max(0, year - member.year) : null; }
function nextBirthday(member, settings, from = new Date()) {
  const parts = zonedParts(from, settings.timezone);
  let year = Number(parts.year);
  for (let guard = 0; guard < 3; guard += 1, year += 1) {
    const effective = effectiveBirthday(member, year, settings);
    const key = `${year}-${String(effective.month).padStart(2, '0')}-${String(effective.day).padStart(2, '0')}`;
    if (key >= `${parts.year}-${parts.month}-${parts.day}`) return { year, month: effective.month, day: effective.day, key };
  }
  return null;
}
function dateKeyToUtcMs(key) {
  const match = String(key || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : NaN;
}
function listUpcoming(guildId, limit = 20, withinDays = UPCOMING_WINDOW_DAYS) {
  const section = getSection(guildId);
  const local = zonedParts(new Date(), section.settings.timezone);
  const todayKey = `${local.year}-${local.month}-${local.day}`;
  const todayMs = dateKeyToUtcMs(todayKey);
  const maxDays = Math.max(0, Math.min(366, Number(withinDays) || UPCOMING_WINDOW_DAYS));
  return Object.values(section.members)
    .filter((member) => member.listPublic !== false && !member.leftAt)
    .map((member) => ({ member, next: nextBirthday(member, section.settings) }))
    .filter((item) => item.next)
    .map((item) => ({ ...item, daysUntil: Math.round((dateKeyToUtcMs(item.next.key) - todayMs) / 86400000) }))
    .filter((item) => item.daysUntil >= 0 && item.daysUntil <= maxDays)
    .sort((a, b) => a.next.key.localeCompare(b.next.key))
    .slice(0, Math.max(1, Math.min(100, Number(limit) || 20)));
}

function monthlyWindow(section, from = new Date(), months = 2) {
  const local = zonedParts(from, section.settings.timezone);
  const startYear = Number(local.year); const startMonth = Number(local.month); const groups = [];
  for (let offset = 0; offset < Math.max(1, Math.min(12, Number(months) || 2)); offset += 1) {
    const zeroBased = (startMonth - 1) + offset;
    const year = startYear + Math.floor(zeroBased / 12); const month = (zeroBased % 12) + 1;
    const birthdays = Object.values(section.members)
      .filter((member) => member.listPublic !== false && !member.leftAt)
      .map((member) => ({ member, effective: effectiveBirthday(member, year, section.settings) }))
      .filter((item) => item.effective.month === month)
      .sort((a, b) => a.effective.day - b.effective.day || a.member.userId.localeCompare(b.member.userId));
    groups.push({ year, month, birthdays });
  }
  return groups;
}
function monthLabel(year, month) {
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 1)));
}
function monthlyBoardEmbed(guild, section) {
  const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('🎂 Upcoming Birthdays — Next 2 Months')
    .setFooter({ text: `Goliath Birthdays · Monthly Board · ${section.settings.timezone}` }).setTimestamp();
  for (const group of monthlyWindow(section, new Date(), 2)) {
    const lines = group.birthdays.length
      ? group.birthdays.map(({ member, effective }) => `**${String(effective.day).padStart(2, '0')} ${monthLabel(group.year, group.month).replace(/ \d{4}$/, '')}** — <@${member.userId}>`).join('\n')
      : 'No birthdays registered for this month.';
    embed.addFields({ name: `📅 ${monthLabel(group.year, group.month)}`, value: lines.slice(0, 1024) });
  }
  return embed;
}

function renderTemplate(template, guild, member, year) {
  const discordMember = guild.members.cache.get(member.userId);
  const display = discordMember?.displayName || discordMember?.user?.username || 'member';
  const age = member.showAge ? ageFor(member, year) : null;
  return clean(template, 1800).replaceAll('{mention}', `<@${member.userId}>`).replaceAll('{user}', display)
    .replaceAll('{server}', guild.name || 'this server').replaceAll('{age}', age == null ? '' : String(age));
}
function renderGroupTemplate(template, guild, members) {
  const mentions = members.map((member) => `<@${member.userId}>`).join(' ');
  return clean(template, 1800)
    .replaceAll('{mentions}', mentions)
    .replaceAll('{count}', String(members.length))
    .replaceAll('{server}', guild.name || 'this server');
}
function seededTemplate(templates, seedKey) {
  const normalized = normalizeTemplates(templates, DEFAULT_INDIVIDUAL_TEMPLATES);
  const seed = String(seedKey).split('').reduce((sum, ch) => (sum + ch.charCodeAt(0)) % 2147483647, 0);
  return normalized[seed % normalized.length];
}
function pickTemplate(settings, member, today) {
  return seededTemplate(settings.messageTemplates || settings.messageTemplate, `${member.userId}:${today}`);
}
function pickGroupTemplate(settings, members, today) {
  const templates = normalizeTemplates(settings.groupMessageTemplates, DEFAULT_GROUP_TEMPLATES);
  return seededTemplate(templates, `${members.map((member) => member.userId).sort().join(':')}:${today}:group`);
}
function resolvedCardImage(settings) {
  if (settings.cardImageMode === 'none') return null;
  if (settings.cardImageMode === 'custom') return validUrl(settings.cardImageUrl);
  return DEFAULT_CARD_IMAGE_URL;
}
function birthdayEmbed(guild, section, members, year, today, test = false) {
  const embed = new EmbedBuilder().setColor(colorInt(section.settings.cardColor)).setTitle(test ? `🧪 TEST · ${section.settings.cardTitle}` : section.settings.cardTitle);
  const description = members.length > 1
    ? renderGroupTemplate(pickGroupTemplate(section.settings, members, today), guild, members)
    : renderTemplate(pickTemplate(section.settings, members[0], today), guild, members[0], year);
  embed.setDescription(description.slice(0, 4096));
  const cardImage = resolvedCardImage(section.settings);
  if (cardImage) embed.setImage(cardImage);
  return embed;
}

function canManageBirthdayRole(guild, role) {
  const me = guild.members.me;
  return Boolean(me && role && role.id !== guild.id && !role.managed && me.permissions.has(PermissionFlagsBits.ManageRoles) && role.position < me.roles.highest.position);
}
async function birthdayRoleState(guild, roleId, userId) {
  const discordMember = await guild.members.fetch(userId).catch(() => null);
  const role = roleId ? (guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null)) : null;
  return { role, discordMember, hasRole: Boolean(roleId && discordMember?.roles?.cache?.has(roleId)) };
}
async function removeRole(guild, userId, roleId, reason) {
  if (!roleId) return false;
  const { role, discordMember, hasRole } = await birthdayRoleState(guild, roleId, userId);
  if (!discordMember || !role || !hasRole) return false;
  if (!canManageBirthdayRole(guild, role)) throw new Error(`Goliath cannot manage birthday role ${role.name}.`);
  await discordMember.roles.remove(roleId, reason);
  return true;
}

function noteFailure(section) { section.analytics.failures += 1; section.analytics.lastFailureAt = now(); }
function cleanupStaleRecords(section) {
  const cutoff = Date.now() - LEFT_RETENTION_MS; let removed = 0;
  for (const [userId, member] of Object.entries(section.members)) {
    const leftAtMs = member.leftAt ? Date.parse(member.leftAt) : NaN;
    if (Number.isFinite(leftAtMs) && leftAtMs <= cutoff) { delete section.members[userId]; removed += 1; }
  }
  if (removed) section.analytics.staleRecordsRemoved += removed;
  return removed;
}

async function resolvedBirthdayEmbeds(guild, embeds) {
  return emojis.resolveEmbeds(guild.client, guild.id, embeds);
}

async function sendPublicAnnouncement(guild, section, members, year, today, test = false) {
  const channelId = section.settings.announcementChannelId;
  if (!channelId) throw new Error('Birthday announcement channel is not configured.');
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.send) throw new Error('Birthday announcement channel is unavailable.');
  if (section.settings.useBirthdayEmbed) {
    await channel.send({ embeds: await resolvedBirthdayEmbeds(guild, [birthdayEmbed(guild, section, members, year, today, test)]), allowedMentions: { users: members.map((m) => m.userId) } });
  } else {
    const content = members.length > 1
      ? renderGroupTemplate(pickGroupTemplate(section.settings, members, today), guild, members)
      : renderTemplate(pickTemplate(section.settings, members[0], today), guild, members[0], year);
    const resolvedContent = await emojis.resolveText(guild.client, guild.id, test ? `🧪 **TEST**\n${content}` : content);
    await channel.send({ content: resolvedContent, allowedMentions: { users: members.map((m) => m.userId) } });
  }
}

async function processGuild(guild, meta = {}) {
  if (!guild || !guildManager.isModuleEnabled(guild.id, SECTION)) return { disabled: true };
  const section = getSection(guild.id); const staleRemoved = cleanupStaleRecords(section);
  const parts = zonedParts(new Date(), section.settings.timezone); const year = Number(parts.year);
  const today = `${parts.year}-${parts.month}-${parts.day}`; const currentTime = `${parts.hour}:${parts.minute}`;
  const result = { announced: 0, rolesAssigned: 0, rolesRemoved: 0, staleRemoved, failures: 0 };
  const roleId = section.settings.birthdayRoleId;

  for (const member of Object.values(section.members)) {
    const isToday = birthdayKey(member, year, section.settings) === today;
    try {
      if (member.leftAt) {
        if (member.roleAssignedRoleId && await removeRole(guild, member.userId, member.roleAssignedRoleId, 'Goliath birthday member left')) result.rolesRemoved += 1;
        member.roleAssignedAt = null; member.roleAssignedRoleId = null; continue;
      }
      if (member.roleAssignedRoleId && member.roleAssignedRoleId !== roleId) {
        if (await removeRole(guild, member.userId, member.roleAssignedRoleId, 'Goliath birthday role replaced')) result.rolesRemoved += 1;
        member.roleAssignedAt = null; member.roleAssignedRoleId = null;
      }
      if (isToday && roleId) {
        const { role, discordMember, hasRole } = await birthdayRoleState(guild, roleId, member.userId);
        if (!discordMember) throw new Error('Birthday member is unavailable.');
        if (!role || !canManageBirthdayRole(guild, role)) throw new Error('Configured birthday role cannot be managed.');
        if (!hasRole) { await discordMember.roles.add(roleId, 'Goliath birthday role'); result.rolesAssigned += 1; section.analytics.rolesAssigned += 1; section.analytics.lastRoleAssignedAt = now(); }
        member.roleAssignedAt = member.roleAssignedAt || now(); member.roleAssignedRoleId = roleId;
      } else if (!isToday && member.roleAssignedRoleId) {
        if (await removeRole(guild, member.userId, member.roleAssignedRoleId, 'Goliath birthday role ended')) { result.rolesRemoved += 1; section.analytics.rolesRemoved += 1; }
        member.roleAssignedAt = null; member.roleAssignedRoleId = null;
      }
    } catch (error) { result.failures += 1; noteFailure(section); console.warn(`[birthdays] role ${guild.id}/${member.userId}: ${error.message}`); }
  }

  if (currentTime >= section.settings.announcementTime) {
    const pending = Object.values(section.members).filter((member) => !member.leftAt && member.announce !== false && birthdayKey(member, year, section.settings) === today && member.lastAnnouncedKey !== today);
    try {
      if (pending.length) {
        if (section.settings.combineSameDay && pending.length > 1) {
          await sendPublicAnnouncement(guild, section, pending, year, today);
          for (const member of pending) member.lastAnnouncedKey = today;
          result.announced += pending.length;
        } else {
          for (const member of pending) { await sendPublicAnnouncement(guild, section, [member], year, today); member.lastAnnouncedKey = today; result.announced += 1; }
        }
        section.analytics.announcementsSent += result.announced; section.analytics.lastAnnouncementAt = now();
      }
    } catch (error) { result.failures += 1; noteFailure(section); console.warn(`[birthdays] announcement ${guild.id}: ${error.message}`); }
  }

  if (section.settings.monthlyBoardChannelId && Number(parts.day) === section.settings.monthlyBoardDay && currentTime >= section.settings.monthlyBoardTime) {
    const monthKey = `${parts.year}-${parts.month}`;
    if (section.monthlyBoard.lastPostedKey !== monthKey) {
      try {
        const channel = guild.channels.cache.get(section.settings.monthlyBoardChannelId) || await guild.channels.fetch(section.settings.monthlyBoardChannelId).catch(() => null);
        if (!channel?.send) throw new Error('Monthly birthday board channel is unavailable.');
        await channel.send({ embeds: await resolvedBirthdayEmbeds(guild, [monthlyBoardEmbed(guild, section)]), allowedMentions: { parse: [] } });
        section.monthlyBoard.lastPostedKey = monthKey; section.analytics.monthlyBoardsSent += 1; section.analytics.lastMonthlyBoardAt = now();
      } catch (error) { result.failures += 1; noteFailure(section); console.warn(`[birthdays] monthly ${guild.id}: ${error.message}`); }
    }
  }
  section.analytics.lastProcessedAt = now(); saveSection(guild.id, section, { ...meta, action: meta.action || 'birthday_process' }); return result;
}

function markMemberLeft(guildId, userId, meta = {}) {
  if (!getBirthday(guildId, userId)) return null;
  return setBirthday(guildId, userId, { leftAt: now() }, { ...meta, action: 'birthday_member_left' });
}
function markMemberJoined(guildId, userId, meta = {}) {
  const record = getBirthday(guildId, userId); if (!record) return null;
  return setBirthday(guildId, userId, { leftAt: null }, { ...meta, action: 'birthday_member_joined' });
}

async function testRoleAssignment(guild, userId) {
  const section = getSection(guild.id); const roleId = section.settings.birthdayRoleId;
  if (!roleId) throw new Error('No birthday role is configured.');
  const { role, discordMember, hasRole } = await birthdayRoleState(guild, roleId, userId);
  if (!discordMember || !role || !canManageBirthdayRole(guild, role)) throw new Error('Birthday role cannot be tested. Check role hierarchy and permissions.');
  if (!hasRole) await discordMember.roles.add(roleId, 'Goliath birthday role test');
  if (!hasRole) await discordMember.roles.remove(roleId, 'Goliath birthday role test complete');
  return { roleId, alreadyHadRole: hasRole };
}
async function testPublicAnnouncement(guild, userId) {
  const section = getSection(guild.id); const member = getBirthday(guild.id, userId) || normalizeMember({ userId, month: 1, day: 1 }, userId, section.settings);
  const parts = zonedParts(new Date(), section.settings.timezone); await sendPublicAnnouncement(guild, section, [member], Number(parts.year), `${parts.year}-${parts.month}-${parts.day}`, true); return true;
}
async function testMonthlyBoard(guild) {
  const section = getSection(guild.id); const channelId = section.settings.monthlyBoardChannelId;
  if (!channelId) throw new Error('No monthly board channel is configured.');
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.send) throw new Error('Monthly birthday board channel is unavailable.');
  await channel.send({ embeds: await resolvedBirthdayEmbeds(guild, [monthlyBoardEmbed(guild, section)]), allowedMentions: { parse: [] } }); return true;
}

function exportData(guildId) { const section = getSection(guildId); return { version: 2, exportedAt: now(), birthdays: section }; }
function importData(guildId, payload, meta = {}) {
  const source = payload?.birthdays || payload; if (!source || typeof source !== 'object') throw new Error('Invalid birthday import data.');
  const incoming = normalizeSection(source); const existing = getSection(guildId);
  const members = { ...existing.members, ...incoming.members };
  const merged = saveSection(guildId, { ...existing, members, settings: { ...existing.settings, ...incoming.settings }, monthlyBoard: existing.monthlyBoard }, { ...meta, action: 'birthday_import' });
  incrementAnalytics(guildId, { imports: 1 }, meta); return { imported: Object.keys(incoming.members).length, total: Object.keys(merged.members).length };
}

function nextSchedule(section) {
  const parts = zonedParts(new Date(), section.settings.timezone);
  return `${parts.year}-${parts.month}-${parts.day} ${section.settings.announcementTime} ${section.settings.timezone}`;
}
async function buildHealth(guild) {
  const section = getSection(guild.id); const issues = []; const warnings = [];
  if (!guildManager.isModuleEnabled(guild.id, SECTION)) warnings.push('Birthdays module is disabled.');
  for (const [label, channelId] of [['Birthday announcement', section.settings.announcementChannelId], ['Monthly birthday board', section.settings.monthlyBoardChannelId]]) {
    if (!channelId) { if (label.startsWith('Birthday')) warnings.push('No birthday announcement channel is configured.'); continue; }
    const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.send) issues.push(`${label} channel is missing or cannot receive messages.`);
  }
  if (section.settings.birthdayRoleId) {
    const role = guild.roles.cache.get(section.settings.birthdayRoleId) || await guild.roles.fetch(section.settings.birthdayRoleId).catch(() => null);
    if (!role) issues.push('Birthday role no longer exists.'); else if (!canManageBirthdayRole(guild, role)) issues.push('Goliath cannot manage the configured birthday role.');
  }
  return {
    healthy: issues.length === 0, issues, warnings, analytics: section.analytics,
    audit: { lastProcessed: section.analytics.lastProcessedAt, lastAnnouncement: section.analytics.lastAnnouncementAt, lastMonthlyBoard: section.analytics.lastMonthlyBoardAt, nextAnnouncement: nextSchedule(section), failures: section.analytics.failures, lastFailure: section.analytics.lastFailureAt, trackedMembers: Object.keys(section.members).length },
  };
}

const startedClients = new WeakSet();
const runningClients = new WeakSet();
const schedulerStates = new WeakMap();

async function runAllGuilds(client, action) {
  if (!client?.guilds?.cache) return { processed: 0, failed: 0, operationalFailures: 0 };
  if (runningClients.has(client)) return { skipped: true, processed: 0, failed: 0, operationalFailures: 0 };

  runningClients.add(client);
  let processed = 0;
  let failed = 0;
  let operationalFailures = 0;

  try {
    for (const guild of client.guilds.cache.values()) {
      try {
        const result = await processGuild(guild, { action });
        if (result?.disabled) continue;
        processed += 1;
        operationalFailures += Number(result?.failures || 0);
      } catch (error) {
        failed += 1;
        console.warn(`[birthdays] ${guild.id}: ${error.message}`);
      }
    }

    if (failed || operationalFailures) {
      sentinelScheduler.fail(SCHEDULER_ID, new Error(`${failed + operationalFailures} birthday scheduler failure(s).`), {
        action,
        guildsProcessed: processed,
        guildFailures: failed,
        operationFailures: operationalFailures,
      });
    } else {
      sentinelScheduler.beat(SCHEDULER_ID, {
        action,
        guildsProcessed: processed,
        guildFailures: 0,
        operationFailures: 0,
      });
    }

    return { processed, failed, operationalFailures };
  } catch (error) {
    sentinelScheduler.fail(SCHEDULER_ID, error, { action });
    throw error;
  } finally {
    runningClients.delete(client);
  }
}

function start(client) {
  if (!client || startedClients.has(client)) return;
  startedClients.add(client);

  sentinelScheduler.register({
    id: SCHEDULER_ID,
    module: SECTION,
    component: 'processor',
    intervalMs: TICK_MS,
    staleAfterMs: Math.max(TICK_MS * 3, 180_000),
    details: { scope: 'all-guilds' },
  });

  const state = { alignmentTimer: null, interval: null, readyHandler: null };
  schedulerStates.set(client, state);

  const startLoop = () => {
    state.readyHandler = null;
    runAllGuilds(client, 'birthday_startup_process').catch((error) => {
      console.warn(`[birthdays] startup: ${error.message}`);
    });

    const delay = TICK_MS - (Date.now() % TICK_MS) + 250;
    state.alignmentTimer = setTimeout(() => {
      runAllGuilds(client, 'birthday_aligned_process').catch((error) => {
        console.warn(`[birthdays] aligned process: ${error.message}`);
      });

      state.interval = setInterval(() => {
        runAllGuilds(client, 'birthday_interval_process').catch((error) => {
          console.warn(`[birthdays] interval process: ${error.message}`);
        });
      }, TICK_MS);
      state.interval.unref?.();
    }, delay);
    state.alignmentTimer.unref?.();
  };

  if (client.isReady?.()) startLoop();
  else {
    state.readyHandler = startLoop;
    client.once('ready', startLoop);
  }
}

function shutdown(client) {
  const state = schedulerStates.get(client);
  if (!state && !startedClients.has(client)) return false;

  if (state?.readyHandler) client.off?.('ready', state.readyHandler);
  if (state?.alignmentTimer) clearTimeout(state.alignmentTimer);
  if (state?.interval) clearInterval(state.interval);
  schedulerStates.delete(client);
  startedClients.delete(client);
  runningClients.delete(client);
  sentinelScheduler.stop(SCHEDULER_ID, 'birthday processor shutdown');
  return true;
}

module.exports = {
  SECTION, TICK_MS, SCHEDULER_ID, start, shutdown, runAllGuilds, defaultSection, normalizeSection, normalizeMember,
  DEFAULT_INDIVIDUAL_TEMPLATES, DEFAULT_GROUP_TEMPLATES, DEFAULT_CARD_IMAGE_URL,
  getSection, saveSection, updateSection, updateSettings, incrementAnalytics,
  getBirthday, setBirthday, removeBirthday, listUpcoming, nextBirthday, ageFor,
  monthlyWindow, monthlyBoardEmbed, birthdayEmbed, processGuild, buildHealth, validTimezone, validTime,
  markMemberLeft, markMemberJoined, testRoleAssignment, testPublicAnnouncement, testMonthlyBoard,
  exportData, importData,
  reset: (guildId, meta = {}) => saveSection(guildId, defaultSection(), meta),
};
