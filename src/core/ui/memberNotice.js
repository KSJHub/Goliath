'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

const COLORS = Object.freeze({
  info: 0x5865F2,
  success: 0x57F287,
  warning: 0xFEE75C,
  caution: 0xFAA61A,
  danger: 0xED4245,
  security: 0x9B59B6,
  neutral: 0x95A5A6,
});

const clean = (value, fallback = 'Not provided', max = 1024) => {
  const text = String(value ?? '').trim().slice(0, max);
  return text || fallback;
};
const validUrl = (value) => /^https?:\/\//i.test(String(value || '').trim());

function guildIcon(guild) {
  try { return guild?.iconURL?.({ size: 256 }) || null; } catch { return null; }
}

function field(name, value, inline = false) {
  if (value == null || value === '') return null;
  return { name: clean(name, 'Details', 256), value: clean(value, 'Not provided', 1024), inline };
}

function button(def = {}) {
  const item = new ButtonBuilder()
    .setLabel(clean(def.label, 'Open', 80))
    .setStyle(def.url ? ButtonStyle.Link : (def.style ?? ButtonStyle.Secondary));
  if (def.url) item.setURL(def.url);
  else if (def.customId) item.setCustomId(def.customId);
  else return null;
  if (def.emoji) item.setEmoji(def.emoji);
  if (def.disabled === true) item.setDisabled(true);
  return item;
}

function buildMemberNotice(guild, options = {}) {
  const moduleName = clean(options.module, 'Goliath', 80);
  const reference = options.reference ? clean(options.reference, '', 100) : '';
  const status = options.status ? clean(options.status, '', 100) : '';
  const title = `${options.emoji || '💎'} ${clean(options.title, 'Goliath Notice', 220)}`.slice(0, 256);
  const description = clean(options.description, `This is an official ${moduleName} notice from ${guild?.name || 'this server'}.`, 4096);
  const embed = new EmbedBuilder()
    .setColor(options.color ?? COLORS.info)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp(options.timestamp ? new Date(options.timestamp) : new Date());

  const icon = guildIcon(guild);
  if (icon) embed.setThumbnail(icon);

  const fields = [
    field('🏠 Server', guild?.name || 'Discord Server', true),
    reference ? field('🆔 Reference', reference, true) : null,
    status ? field('📌 Status', status, true) : null,
    ...(Array.isArray(options.fields) ? options.fields.map((item) => item && field(item.name, item.value, item.inline === true)) : []),
    options.reason ? field('📝 Reason / Details', options.reason) : null,
    options.issuedBy ? field('👤 Issued / Updated By', options.issuedBy) : null,
    options.meaning ? field('ℹ️ What This Means', options.meaning) : null,
    options.nextSteps ? field('➡️ What Happens Next', options.nextSteps) : null,
  ].filter(Boolean).slice(0, 25);
  if (fields.length) embed.addFields(fields);

  const footerBits = ['Goliath', moduleName, guild?.name || 'Server', reference].filter(Boolean);
  embed.setFooter({ text: footerBits.join(' • ').slice(0, 2048), ...(icon ? { iconURL: icon } : {}) });

  const buttons = (Array.isArray(options.buttons) ? options.buttons : []).map(button).filter(Boolean).slice(0, 5);
  return { embeds: [embed], components: buttons.length ? [new ActionRowBuilder().addComponents(buttons)] : [], allowedMentions: { parse: [] } };
}

function moderationNotice(guild, modCase, options = {}) {
  const action = String(modCase?.action || options.action || 'moderation').toLowerCase();
  const meta = {
    warn: { emoji: '⚠️', title: 'You Have Received a Warning', label: 'Warning', color: COLORS.warning, meaning: 'A warning has been recorded on your moderation history. Further incidents may result in additional moderation action.' },
    timeout: { emoji: '⏳', title: 'You Have Been Timed Out', label: 'Timeout', color: COLORS.caution, meaning: 'Your ability to interact in the server has been temporarily restricted for the duration shown below.' },
    kick: { emoji: '👢', title: 'You Have Been Kicked', label: 'Kick', color: COLORS.danger, meaning: 'You have been removed from the server. This action does not by itself prevent you from joining again unless another restriction applies.' },
    ban: { emoji: '🔨', title: 'You Have Been Banned', label: 'Ban', color: COLORS.danger, meaning: 'You have been banned from the server and cannot rejoin while the ban remains active.' },
    quarantine: { emoji: '🔒', title: 'Your Account Has Been Quarantined', label: 'Quarantine', color: COLORS.security, meaning: 'Your access has been restricted while a security or moderation review is completed.' },
    unquarantine: { emoji: '🔓', title: 'Your Quarantine Has Been Released', label: 'Quarantine Released', color: COLORS.success, meaning: 'The quarantine restriction has been removed. Any separately applied moderation restrictions remain in effect.' },
  }[action] || { emoji: '🛡️', title: 'Moderation Notice', label: clean(action, 'Moderation Action', 80), color: COLORS.info, meaning: 'A moderation action has been recorded on your account.' };

  const caseId = modCase?.caseId || options.caseId;
  const fields = [field('🛡️ Action', `**${meta.label}**`, true)];
  const duration = modCase?.metadata?.duration || modCase?.metadata?.durationRaw || options.duration;
  if (duration) fields.push(field('⏱️ Duration', duration, true));
  if (options.extraFields) fields.push(...options.extraFields);
  return buildMemberNotice(guild, {
    module: 'Goliath Moderation', emoji: meta.emoji, title: meta.title, color: meta.color,
    description: options.description || 'This is an official Goliath moderation notice. The details below come from your recorded moderation case.',
    reference: caseId ? `Case #${caseId}` : options.reference,
    status: options.status || modCase?.status || 'Active', fields,
    reason: modCase?.reason || options.reason || 'No reason provided', issuedBy: options.issuedBy,
    meaning: options.meaning || meta.meaning, nextSteps: options.nextSteps, buttons: options.buttons,
  });
}

module.exports = { COLORS, buildMemberNotice, moderationNotice, guildIcon, validUrl };
