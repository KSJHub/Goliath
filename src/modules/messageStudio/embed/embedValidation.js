'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { getAllEmbedDeployments, markEmbedDeploymentStatus, DEPLOYMENT_STATUS } = require('./embedDeployments');
const { listTemplates } = require('./embedTemplates');

const MAX_PANELS = 10;
const MAX_FIELDS = 25;
const MAX_BUTTONS = 20;
const MAX_BUTTONS_PER_ROW = 5;
const MAX_COMPONENT_ROWS = 5;
const MAX_DEPLOYED_BUTTON_ROWS = 4;
const KNOWN_BUTTON_ACTIONS = new Set(['reply', 'toggle-role', 'add-role', 'remove-role', 'user-info', 'server-info']);
const ROLE_BUTTON_ACTIONS = new Set(['toggle-role', 'add-role', 'remove-role']);

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac']);

function toCleanString(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  return '';
}

function isHttpUrl(value) {
  const text = toCleanString(value);
  if (!text) return false;

  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isVariableUrl(value) {
  const text = toCleanString(value);
  return /^\{[a-zA-Z0-9_]+\}$/.test(text);
}

function isUsableUrl(value) {
  return isHttpUrl(value) || isVariableUrl(value);
}

function normaliseButtonStyle(style) {
  const value = toCleanString(style).toLowerCase();

  if (value === 'secondary') return 'Secondary';
  if (value === 'success') return 'Success';
  if (value === 'danger') return 'Danger';
  if (value === 'link') return 'Link';

  return 'Primary';
}

function getButtonValidationErrors(buttons = []) {
  const errors = [];
  const safeButtons = Array.isArray(buttons) ? buttons : [];

  if (safeButtons.length > MAX_BUTTONS) {
    errors.push(`You can only add up to ${MAX_BUTTONS} buttons.`);
  }

  const requiredRows = Math.ceil(safeButtons.length / MAX_BUTTONS_PER_ROW);

  if (requiredRows > MAX_COMPONENT_ROWS) {
    errors.push(`Discord only supports ${MAX_COMPONENT_ROWS} button rows.`);
  }

  safeButtons.forEach((button, index) => {
    const number = index + 1;
    const label = toCleanString(button?.label);
    const style = normaliseButtonStyle(button?.style);
    const url = toCleanString(button?.url);

    if (!label) errors.push(`Button ${number} is missing a label.`);

    if (style === 'Link' || url) {
      if (!url) errors.push(`Button ${number} is a Link button but has no URL.`);
      else if (!isUsableUrl(url)) errors.push(`Button ${number} has an invalid URL.`);
    }
  });

  return errors;
}

function getUrlValidationErrors(state = {}) {
  const errors = [];
  const urlFields = [
    ['Author icon', state.authorIcon],
    ['Author URL', state.authorUrl],
    ['Footer icon', state.footerIcon],
    ['Thumbnail', state.thumbnail],
    ['Image', state.image],
  ];

  urlFields.forEach(([label, value]) => {
    const text = toCleanString(value);
    if (text && !isUsableUrl(text)) errors.push(`${label} must be a valid http(s) URL or supported variable.`);
  });

  return errors;
}

function sourceExtension(source = '') {
  try {
    const clean = String(source).split('?')[0].split('#')[0];
    const name = clean.split('/').pop() || '';
    const dot = name.lastIndexOf('.');
    return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
  } catch {
    return '';
  }
}

function isVariableSource(source = '') {
  return /\{\{[^{}]+\}\}|\$\{[^{}]+\}|\{[a-zA-Z0-9_]+\}/.test(String(source).trim());
}

function detectKind(source = '', declaredType = 'auto') {
  const declared = String(declaredType || 'auto').toLowerCase();
  if (declared === 'image' || declared === 'video') return declared;
  const ext = sourceExtension(source);
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  return ext ? 'file' : 'auto';
}

function validateSource(source = '', options = {}) {
  const value = String(source || '').trim();
  const kind = detectKind(value, options.type);
  if (!value) return { status: 'missing', valid: false, kind, message: 'No source set' };
  if (isVariableSource(value)) return { status: 'dynamic', valid: true, kind, message: 'Variable source — resolved when sent' };
  if (value.startsWith('attachment://')) return { status: 'ready', valid: true, kind, message: 'Cached attachment source' };

  let url;
  try {
    url = new URL(value);
  } catch {
    return { status: 'invalid', valid: false, kind, message: 'Source is not a valid URL or variable' };
  }

  if (url.protocol === 'https:') return { status: 'ready', valid: true, kind, message: kind === 'auto' ? 'HTTPS source — media type detected when sent' : `HTTPS ${kind} source` };
  if (url.protocol === 'http:') return { status: 'warning', valid: true, kind, message: 'HTTP source — HTTPS is recommended' };
  return { status: 'invalid', valid: false, kind, message: `Unsupported ${url.protocol} source` };
}

function validatePanelMedia(media = {}) {
  const thumbnail = validateSource(media?.thumbnail?.source || '', { type: 'image' });
  const gallery = (media?.gallery || []).map((item, index) => ({ index, item, ...validateSource(item?.source || '', { type: item?.type || 'auto' }) }));
  const files = (media?.files || []).map((item, index) => ({ index, item, ...validateSource(item?.source || '') }));
  const all = [...gallery, ...files, ...(media?.thumbnail?.source ? [thumbnail] : [])];
  return {
    thumbnail,
    gallery,
    files,
    ready: all.filter((entry) => entry.valid).length,
    warnings: all.filter((entry) => entry.status === 'warning').length,
    invalid: all.filter((entry) => !entry.valid).length,
  };
}

function statusIcon(status) {
  if (status === 'ready') return '✅';
  if (status === 'dynamic') return '🔄';
  if (status === 'warning') return '⚠️';
  if (status === 'invalid') return '❌';
  return '➖';
}

function validateEmbedState(state = {}) {
  return [
    ...getButtonValidationErrors(state.buttons),
    ...getUrlValidationErrors(state),
  ];
}

function pushUnique(list, message) {
  if (!list.includes(message)) list.push(message);
}

function panelVariableText(panel = {}) {
  return [
    panel.title,
    panel.description,
    panel.authorName,
    panel.authorIcon,
    panel.authorUrl,
    panel.footer,
    panel.footerIcon,
    panel.image,
    panel.thumbnail,
    ...(Array.isArray(panel.fields) ? panel.fields.flatMap((field) => [field?.name, field?.value]) : []),
  ].filter(Boolean).join('\n');
}

function unknownVariables(state = {}, helpers = []) {
  const source = [
    ...(Array.isArray(state.panels) ? state.panels.map(panelVariableText) : []),
    ...(Array.isArray(state.buttons) ? state.buttons.flatMap((button) => [button?.label, button?.url, button?.actionValue]) : []),
  ].join('\n');
  const found = [...source.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]);
  const known = new Set((Array.isArray(helpers) ? helpers : []).map((item) => String(item).replace(/[{}]/g, '').toLowerCase()));
  if (!known.size) return [];
  return [...new Set(found.filter((name) => !known.has(name.toLowerCase())))];
}

function cleanRoleId(value) {
  const id = toCleanString(value).replace(/[<@&>]/g, '');
  return /^\d{15,25}$/.test(id) ? id : null;
}

function getReadinessReport(interaction, state = {}, options = {}) {
  const errors = [];
  const warnings = [];
  const checks = [];
  const panels = Array.isArray(state.panels) ? state.panels : [];
  const buttons = Array.isArray(state.buttons) ? state.buttons : [];
  const mediaForPanel = typeof options.mediaForPanel === 'function' ? options.mediaForPanel : () => ({ thumbnail: {}, gallery: [], files: [] });
  const maxGalleryItems = Number(options.maxGalleryItems) || 10;
  const maxFiles = Number(options.maxFiles) || 10;

  if (!state.channelId) pushUnique(errors, 'Choose a destination channel.');
  else checks.push('Destination channel selected');
  if (!panels.length) pushUnique(errors, 'At least one content panel is required.');
  if (panels.length > MAX_PANELS) pushUnique(errors, `Only ${MAX_PANELS} panels can be used.`);

  panels.forEach((item, index) => {
    const number = index + 1;
    const fields = Array.isArray(item?.fields) ? item.fields : [];
    const hasContent = [item?.title, item?.description, item?.authorName, item?.footer, item?.image, item?.thumbnail].some((value) => toCleanString(value))
      || fields.some((field) => toCleanString(field?.name) || toCleanString(field?.value));
    if (!hasContent) pushUnique(warnings, `Panel ${number} is empty.`);
    if (fields.length > MAX_FIELDS) pushUnique(errors, `Panel ${number} exceeds the ${MAX_FIELDS}-field limit.`);
    fields.forEach((field, fieldIndex) => {
      if (!toCleanString(field?.name)) pushUnique(errors, `Panel ${number}, field ${fieldIndex + 1} is missing a name.`);
      if (!toCleanString(field?.value)) pushUnique(errors, `Panel ${number}, field ${fieldIndex + 1} is missing content.`);
    });
    [['Author icon', item?.authorIcon], ['Author URL', item?.authorUrl], ['Footer icon', item?.footerIcon], ['Thumbnail', item?.thumbnail], ['Image', item?.image]].forEach(([label, value]) => {
      if (toCleanString(value) && !isUsableUrl(value)) pushUnique(errors, `Panel ${number} ${label.toLowerCase()} is not a valid URL or variable.`);
    });

    const media = mediaForPanel(state, index) || { thumbnail: {}, gallery: [], files: [] };
    const gallery = Array.isArray(media.gallery) ? media.gallery : [];
    const files = Array.isArray(media.files) ? media.files : [];
    if (gallery.length > maxGalleryItems) pushUnique(errors, `Panel ${number} exceeds the gallery limit.`);
    if (files.length > maxFiles) pushUnique(errors, `Panel ${number} exceeds the attached-file limit.`);
    if (toCleanString(media.thumbnail?.source) && !isUsableUrl(media.thumbnail.source)) pushUnique(errors, `Panel ${number} thumbnail media source is invalid.`);
    gallery.forEach((entry, mediaIndex) => { if (!isUsableUrl(entry?.source)) pushUnique(errors, `Panel ${number}, media ${mediaIndex + 1} has an invalid source.`); });
    files.forEach((entry, fileIndex) => { if (!isUsableUrl(entry?.source)) pushUnique(errors, `Panel ${number}, file ${fileIndex + 1} has an invalid source.`); });
  });

  checks.push(`${panels.length}/${MAX_PANELS} panels`);
  checks.push(`${panels.reduce((sum, item) => sum + (Array.isArray(item?.fields) ? item.fields.length : 0), 0)} fields`);
  if (buttons.length > MAX_BUTTONS) pushUnique(errors, `Only ${MAX_BUTTONS} buttons can be deployed.`);

  const rowCounts = Array.from({ length: MAX_DEPLOYED_BUTTON_ROWS }, () => 0);
  buttons.forEach((button, index) => {
    const number = index + 1;
    const label = toCleanString(button?.label);
    const url = toCleanString(button?.url);
    const action = toCleanString(button?.action).toLowerCase();
    if (!label) pushUnique(errors, `Button ${number} is missing a label.`);
    if (url && action) pushUnique(errors, `Button ${number} cannot have both a link and a bot action.`);
    if (url && !isUsableUrl(url)) pushUnique(errors, `Button ${number} has an invalid link.`);
    if (action && !KNOWN_BUTTON_ACTIONS.has(action)) pushUnique(errors, `Button ${number} uses unsupported action \`${action}\`.`);
    if (!url && !action) pushUnique(warnings, `Button ${number} has no link or action configured.`);
    if (action === 'reply' && !toCleanString(button?.actionValue)) pushUnique(errors, `Button ${number} Reply action has no reply text.`);
    if (ROLE_BUTTON_ACTIONS.has(action)) {
      const id = cleanRoleId(button?.actionValue);
      if (!id) pushUnique(errors, `Button ${number} role action has no valid role selected.`);
      else {
        const role = interaction?.guild?.roles?.cache?.get?.(id);
        if (!role) pushUnique(errors, `Button ${number} selected role no longer exists.`);
        else if (role.id === interaction.guildId || role.managed) pushUnique(errors, `Button ${number} selected role cannot be managed by a self-service button.`);
        else if (!role.editable) pushUnique(errors, `Button ${number} selected role is above Goliath or otherwise not editable.`);
      }
    }
    const configuredRow = Number(button?.row);
    if (Number.isInteger(configuredRow) && configuredRow >= 0 && configuredRow < MAX_DEPLOYED_BUTTON_ROWS) rowCounts[configuredRow] += 1;
  });
  rowCounts.forEach((count, index) => {
    if (count > MAX_BUTTONS_PER_ROW) pushUnique(errors, `Button row ${index + 1} has ${count} buttons; Discord allows ${MAX_BUTTONS_PER_ROW}.`);
  });
  checks.push(`${buttons.length}/${MAX_BUTTONS} buttons`);

  const unknown = unknownVariables(state, options.helpers);
  unknown.forEach((name) => pushUnique(warnings, `Variable \`{${name}}\` is not in the current helper list.`));
  if (!unknown.length) checks.push('Variables recognised');
  if (state.hasUnsavedChanges) pushUnique(warnings, 'There are unsaved changes in the current builder session.');

  return { ready: errors.length === 0, errors, warnings, checks };
}

function getReadinessFixTarget(report) {
  const issue = String(report?.errors?.[0] || report?.warnings?.[0] || '');
  if (!issue) return { type: 'builder', label: '🛠️ Builder' };
  if (/destination channel/i.test(issue)) return { type: 'channel', label: '📢 Fix Channel' };
  const panelMatch = issue.match(/Panel\s+(\d+)/i);
  const fieldMatch = issue.match(/field\s+(\d+)/i);
  const buttonMatch = issue.match(/Button\s+(\d+)/i);
  if (buttonMatch || /button row/i.test(issue)) return { type: 'button', index: buttonMatch ? Math.max(0, Number(buttonMatch[1]) - 1) : null, label: '🔘 Fix Button' };
  if (panelMatch && /media|thumbnail|gallery|file|image|author icon|footer icon|author url/i.test(issue)) return { type: 'media', panelIndex: Math.max(0, Number(panelMatch[1]) - 1), label: '🖼️ Fix Media' };
  if (panelMatch && fieldMatch) return { type: 'field', panelIndex: Math.max(0, Number(panelMatch[1]) - 1), fieldIndex: Math.max(0, Number(fieldMatch[1]) - 1), label: '📋 Fix Field' };
  if (panelMatch) return { type: 'panel', panelIndex: Math.max(0, Number(panelMatch[1]) - 1), label: '🧩 Fix Panel' };
  if (/Variable/i.test(issue)) return { type: 'variables', label: '📖 Variables' };
  return { type: 'builder', label: '🛠️ Builder' };
}

function buildReadinessModel(interaction, state = {}, options = {}) {
  const report = getReadinessReport(interaction, state, options);
  const fix = getReadinessFixTarget(report);
  const status = report.ready
    ? (report.warnings.length ? '🟡 Ready with warnings' : '🟢 Ready to Send')
    : '🔴 Not Ready';
  const lines = [
    `**Status:** ${status}`,
    `**Channel:** ${state.channelId ? `<#${state.channelId}>` : 'Not selected'}`,
    `**Panels:** ${Array.isArray(state.panels) ? state.panels.length : 0}/${MAX_PANELS}`,
    `**Buttons:** ${Array.isArray(state.buttons) ? state.buttons.length : 0}/${MAX_BUTTONS}`,
    '',
    report.errors.length
      ? `### ❌ Fix before sending\n${report.errors.slice(0, 12).map((item) => `• ${item}`).join('\n')}${report.errors.length > 12 ? `\n• And ${report.errors.length - 12} more...` : ''}`
      : '### ✅ Required checks passed',
  ];
  if (report.warnings.length) {
    lines.push('', `### ⚠️ Warnings\n${report.warnings.slice(0, 8).map((item) => `• ${item}`).join('\n')}${report.warnings.length > 8 ? `\n• And ${report.warnings.length - 8} more...` : ''}`);
  }
  if (report.checks.length) lines.push('', `### 🔎 Checked\n${report.checks.slice(0, 8).map((item) => `• ${item}`).join('\n')}`);
  return { report, fix, status, lines };
}

function formatValidationErrors(errors = []) {
  if (!errors.length) return '';
  return [
    '⚠️ Embed Studio validation failed:',
    '',
    ...errors.slice(0, 10).map((error) => `• ${error}`),
    errors.length > 10 ? `• And ${errors.length - 10} more issue(s).` : null,
  ].filter(Boolean).join('\n');
}

function now() {
  return new Date().toISOString();
}

async function inspectDeployment(guild, deployment) {
  const issues = [];
  const channel = guild.channels.cache.get(deployment.channelId)
    || await guild.channels.fetch(deployment.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) {
    issues.push({ code: 'channel_missing', deploymentKey: deployment.key || deployment.deploymentKey });
    return { deployment, healthy: false, issues };
  }

  const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
  const permissions = me ? channel.permissionsFor(me) : null;
  for (const permission of [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]) {
    if (!permissions?.has(permission)) issues.push({ code: 'permission_missing', permission: String(permission), channelId: channel.id, deploymentKey: deployment.key });
  }

  if (deployment.messageId) {
    const message = await channel.messages.fetch(deployment.messageId).catch(() => null);
    if (!message) issues.push({ code: 'message_missing', channelId: channel.id, messageId: deployment.messageId, deploymentKey: deployment.key });
  }

  return { deployment, healthy: issues.length === 0, issues };
}

async function buildHealthReport(guild) {
  const deployments = Object.values(getAllEmbedDeployments(guild.id) || {});
  const checks = [];
  for (const deployment of deployments) checks.push(await inspectDeployment(guild, deployment));
  const issues = checks.flatMap((check) => check.issues);
  return {
    module: 'embed',
    healthy: issues.length === 0,
    templates: Object.keys(listTemplates(guild.id) || {}).length,
    deployments: deployments.length,
    issues,
    checkedAt: now(),
  };
}

async function repairAll(guild, actorId = null) {
  const report = await buildHealthReport(guild);
  for (const issue of report.issues) {
    if (!issue.deploymentKey) continue;
    const status = issue.code === 'channel_missing'
      ? DEPLOYMENT_STATUS.MISSING_CHANNEL
      : issue.code === 'message_missing'
        ? DEPLOYMENT_STATUS.MISSING_MESSAGE
        : DEPLOYMENT_STATUS.PERMISSION_ERROR;
    markEmbedDeploymentStatus(guild.id, issue.deploymentKey, status, {
      actorId,
      missingReason: issue.code,
      repairedAt: now(),
    });
  }
  return buildHealthReport(guild);
}

module.exports = {
  MAX_PANELS,
  MAX_FIELDS,
  MAX_BUTTONS,
  MAX_BUTTONS_PER_ROW,
  MAX_COMPONENT_ROWS,
  MAX_DEPLOYED_BUTTON_ROWS,
  KNOWN_BUTTON_ACTIONS,
  ROLE_BUTTON_ACTIONS,
  toCleanString,
  isHttpUrl,
  isVariableUrl,
  isUsableUrl,
  normaliseButtonStyle,
  getButtonValidationErrors,
  getUrlValidationErrors,
  sourceExtension,
  isVariableSource,
  detectKind,
  validateSource,
  validatePanelMedia,
  statusIcon,
  validateEmbedState,
  getReadinessReport,
  getReadinessFixTarget,
  buildReadinessModel,
  formatValidationErrors,
  buildHealthReport,
  repairAll,
  inspectDeployment,
};
