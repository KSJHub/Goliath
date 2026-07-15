'use strict';

const crypto = require('crypto');
const {
  getGuildSection,
  updateGuildSection,
} = require('../../core/guild/guildManager');

const DEFAULT_EMBED = Object.freeze({
  title: '',
  description: '',
  color: '#5865F2',
  author: { name: '', iconURL: '', url: '' },
  thumbnailURL: '',
  imageURL: '',
  footer: { text: '', iconURL: '' },
  fields: [],
  buttons: [],
});

const MEMBER_VARIABLES = [
  '{user}', '{userMention}', '{username}', '{userId}', '{userAvatar}', '{memberAvatar}',
  '{guild}', '{guildName}', '{server}', '{serverName}', '{memberCount}', '{createdAt}',
];

const MODULE_VARIABLES = Object.freeze({
  global: ['{guild}', '{guildName}', '{server}', '{serverName}', '{guildId}', '{guildIcon}', '{guildBanner}', '{memberCount}', '{createdAt}', '{timestamp}'],
  welcome: [...MEMBER_VARIABLES, '{joinedAt}'],
  goodbye: [...MEMBER_VARIABLES, '{joinedAt}', '{leftAt}', '{timestamp}'],
  leave: [...MEMBER_VARIABLES, '{joinedAt}', '{leftAt}', '{timestamp}'],
  dmWelcome: [...MEMBER_VARIABLES, '{joinedAt}'],
  tickets: ['{ticketId}', '{ticketDisplayId}', '{ticketType}', '{ticketPriority}', '{ticketCreator}', '{ticketChannel}', '{ticketStatus}'],
  forms: ['{formId}', '{formName}', '{submissionId}', '{submitter}', '{submissionStatus}', '{reviewer}'],
  moderation: ['{caseId}', '{moderator}', '{target}', '{reason}', '{duration}', '{action}'],
});

const DEFAULT_TEMPLATES = Object.freeze({
  welcome_default: {
    name: 'Welcome Default',
    module: 'welcome',
    templateType: 'welcome',
    content: 'Welcome {userMention}!',
    embed: {
      ...DEFAULT_EMBED,
      title: 'Welcome to {guild}',
      description: 'Glad to have you here, {username}. You are member #{memberCount}.',
      color: '#22C55E',
      footer: { text: 'Joined {createdAt}', iconURL: '{guildIcon}' },
    },
  },
  goodbye_default: {
    name: 'Goodbye Default',
    module: 'goodbye',
    templateType: 'goodbye',
    content: '',
    embed: {
      ...DEFAULT_EMBED,
      title: '{username} left {guild}',
      description: 'We are sorry to see you go. Member count is now {memberCount}.',
      color: '#F97316',
      thumbnailURL: '{userAvatar}',
      footer: { text: 'Left {leftAt}', iconURL: '{guildIcon}' },
    },
  },
  leave_default: {
    name: 'Leave Default (Legacy)',
    module: 'welcome',
    templateType: 'leave',
    content: '',
    embed: {
      ...DEFAULT_EMBED,
      title: '{username} left {guild}',
      description: 'Member count is now {memberCount}.',
      color: '#F97316',
      footer: { text: 'Left {leftAt}', iconURL: '{guildIcon}' },
    },
  },
  dm_welcome_default: {
    name: 'DM Welcome Default',
    module: 'welcome',
    templateType: 'dmWelcome',
    content: 'Welcome to {guild}, {username}!',
    embed: {
      ...DEFAULT_EMBED,
      title: 'Welcome aboard',
      description: 'Thanks for joining {guild}. Please check the server rules and enjoy your stay.',
      color: '#5865F2',
      footer: { text: '{guild}', iconURL: '{guildIcon}' },
    },
  },
  ticket_panel_default: {
    name: 'Ticket Panel Default',
    module: 'tickets',
    templateType: 'ticketPanel',
    content: '',
    embed: {
      ...DEFAULT_EMBED,
      title: 'Need Support?',
      description: 'Press the button below to open a private support ticket.',
      color: '#5865F2',
      footer: { text: 'Goliath • Ticket System', iconURL: '' },
    },
  },
  form_submission_default: {
    name: 'Form Submission Default',
    module: 'forms',
    templateType: 'formSubmission',
    content: '',
    embed: {
      ...DEFAULT_EMBED,
      title: 'New Form Submission',
      description: '{submitter} submitted **{formName}**. Reference: `{submissionId}`',
      color: '#A855F7',
      footer: { text: 'Goliath • Forms', iconURL: '' },
    },
  },
});

function now() {
  return new Date().toISOString();
}

function cleanKey(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 80) || `template_${crypto.randomUUID()}`;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function asObject(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function panelToEmbed(panel = {}) {
  return {
    title: panel.title || '',
    description: panel.description || '',
    color: panel.color || '#5865F2',
    author: {
      name: panel.authorName || panel.author?.name || '',
      iconURL: panel.authorIcon || panel.author?.iconURL || '',
      url: panel.authorUrl || panel.author?.url || '',
    },
    thumbnailURL: panel.thumbnail || panel.thumbnailURL || '',
    imageURL: panel.image || panel.imageURL || '',
    footer: {
      text: typeof panel.footer === 'string' ? panel.footer : panel.footer?.text || '',
      iconURL: panel.footerIcon || panel.footer?.iconURL || '',
    },
    fields: Array.isArray(panel.fields) ? panel.fields : [],
    buttons: Array.isArray(panel.buttons) ? panel.buttons : [],
  };
}

function legacyPresetToTemplate(name, preset = {}) {
  const panel = Array.isArray(preset.panels) && preset.panels.length ? preset.panels[0] : preset;
  const templateType = cleanKey(preset.template || preset.templateType || 'global');
  return {
    ...clone(preset),
    templateId: cleanKey(preset.templateId || name),
    name: String(preset.name || name).slice(0, 100),
    module: templateType === 'custom' ? 'global' : templateType,
    templateType: templateType === 'custom' ? 'global' : templateType,
    content: String(preset.content || preset.message || '').slice(0, 2000),
    embed: panelToEmbed(panel),
    panels: Array.isArray(preset.panels) ? clone(preset.panels) : [clone(panel)],
    buttons: Array.isArray(preset.buttons) ? clone(preset.buttons) : [],
    tags: [...new Set([...(Array.isArray(preset.tags) ? preset.tags : []), 'embed-studio'])],
    migratedFromPreset: true,
  };
}

function normalizeEmbed(embed = {}) {
  const source = asObject(embed, {});
  return {
    ...clone(DEFAULT_EMBED),
    ...source,
    title: String(source.title || '').slice(0, 256),
    description: String(source.description || '').slice(0, 4096),
    color: String(source.color || '#5865F2').slice(0, 16),
    author: { ...DEFAULT_EMBED.author, ...asObject(source.author, {}) },
    footer: { ...DEFAULT_EMBED.footer, ...asObject(source.footer, {}) },
    fields: Array.isArray(source.fields)
      ? source.fields.slice(0, 25).map((field) => ({
        name: String(field.name || 'Field').slice(0, 256),
        value: String(field.value || 'Value').slice(0, 1024),
        inline: field.inline === true,
      }))
      : [],
    buttons: Array.isArray(source.buttons)
      ? source.buttons.slice(0, 20).map((button) => ({
        label: String(button.label || 'Button').slice(0, 80),
        emoji: String(button.emoji || '').slice(0, 32),
        style: String(button.style || 'Link').slice(0, 24),
        url: String(button.url || '').slice(0, 512),
        action: String(button.action || 'link').slice(0, 64),
      }))
      : [],
  };
}

function extractVariables(value, found = new Set()) {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/\{[a-zA-Z0-9_.:-]+\}/g)) found.add(match[0]);
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => extractVariables(item, found));
    return found;
  }
  if (value && typeof value === 'object') Object.values(value).forEach((item) => extractVariables(item, found));
  return found;
}

function variablesForTemplateType(templateType = 'global') {
  return [...new Set([...MODULE_VARIABLES.global, ...(MODULE_VARIABLES[templateType] || [])])];
}

function normalizeTemplate(input = {}) {
  const key = cleanKey(input.templateId || input.id || input.name);
  const templateType = cleanKey(input.templateType || input.module || 'global');
  const embed = normalizeEmbed(input.embed || (Array.isArray(input.panels) ? panelToEmbed(input.panels[0]) : input));
  const content = String(input.content || '').slice(0, 2000);
  const usedVariables = [...extractVariables({ content, embed, panels: input.panels })].sort();
  const supportedVariables = variablesForTemplateType(templateType);

  return {
    ...input,
    id: key,
    templateId: key,
    name: String(input.name || key).slice(0, 100),
    module: cleanKey(input.module || templateType || 'global'),
    templateType,
    content,
    embed,
    panels: Array.isArray(input.panels) ? clone(input.panels).slice(0, 10) : input.panels,
    buttons: Array.isArray(input.buttons) ? clone(input.buttons).slice(0, 20) : input.buttons,
    tags: Array.isArray(input.tags) ? input.tags.slice(0, 20).map(String) : [],
    usedVariables,
    supportedVariables,
    unsupportedVariables: usedVariables.filter((variable) => !supportedVariables.includes(variable)),
    version: Number(input.version || 1),
    createdAt: input.createdAt || now(),
    updatedAt: now(),
  };
}

function getEmbedSection(guildId) {
  const section = getGuildSection(guildId, 'embedStudio', {});
  const stored = asObject(section.templates || section.presets, {});
  const legacy = getGuildSection(guildId, 'embedPresets', {});
  const migrated = {};

  for (const [name, preset] of Object.entries(asObject(legacy, {}))) {
    if (!preset || name === 'updatedAt') continue;
    const template = normalizeTemplate(legacyPresetToTemplate(name, preset));
    if (!stored[template.templateId]) migrated[template.templateId] = template;
  }

  if (Object.keys(migrated).length) {
    updateGuildSection(guildId, 'embedStudio', (current = {}) => ({
      ...current,
      templates: { ...asObject(current.templates || current.presets, {}), ...migrated },
      updatedAt: now(),
    }), {});
  }

  return {
    ...section,
    templates: { ...clone(DEFAULT_TEMPLATES), ...stored, ...migrated },
    bindings: asObject(section.bindings, {}),
    history: Array.isArray(section.history) ? section.history : [],
  };
}

function listTemplates(guildId) {
  const section = getEmbedSection(guildId);
  return Object.fromEntries(Object.entries(section.templates || {}).map(([key, template]) => [key, normalizeTemplate({ ...template, templateId: key })]));
}

function getTemplate(guildId, templateId) {
  const templates = listTemplates(guildId);
  return templates[cleanKey(templateId)] || null;
}

function saveTemplate(guildId, input = {}) {
  const template = normalizeTemplate(input);
  const section = updateGuildSection(guildId, 'embedStudio', (current = {}) => {
    const existingTemplates = asObject(current.templates || current.presets, {});
    const previous = existingTemplates[template.templateId];
    const history = Array.isArray(current.history) ? current.history : [];
    return {
      ...current,
      templates: { ...existingTemplates, [template.templateId]: { ...template, version: Number(previous?.version || 0) + 1 } },
      history: previous ? [...history.slice(-49), { templateId: template.templateId, version: previous.version || 1, snapshot: previous, archivedAt: now() }] : history,
      updatedAt: now(),
    };
  }, {});
  return normalizeTemplate(section.templates?.[template.templateId] || template);
}

function deleteTemplate(guildId, templateId) {
  const key = cleanKey(templateId);
  let deleted = false;
  updateGuildSection(guildId, 'embedStudio', (current = {}) => {
    const templates = { ...asObject(current.templates || current.presets, {}) };
    if (templates[key]) {
      delete templates[key];
      deleted = true;
    }
    return { ...current, templates, updatedAt: now() };
  }, {});
  return deleted;
}

function bindTemplate(guildId, moduleKey, slot, templateId) {
  const moduleName = cleanKey(moduleKey);
  const slotName = cleanKey(slot);
  const template = getTemplate(guildId, templateId);
  if (!template) throw new Error('Template not found.');
  updateGuildSection(guildId, 'embedStudio', (current = {}) => ({
    ...current,
    bindings: { ...asObject(current.bindings, {}), [moduleName]: { ...asObject(current.bindings?.[moduleName], {}), [slotName]: template.templateId } },
    updatedAt: now(),
  }), {});
  return { module: moduleName, slot: slotName, templateId: template.templateId, template };
}

function getBinding(guildId, moduleKey, slot) {
  const section = getEmbedSection(guildId);
  const templateId = section.bindings?.[cleanKey(moduleKey)]?.[cleanKey(slot)] || null;
  return templateId ? getTemplate(guildId, templateId) : null;
}

function replaceVariables(value, variables = {}) {
  if (typeof value === 'string') {
    return value.replace(/\{[a-zA-Z0-9_.:-]+\}/g, (match) => String(variables[match] ?? variables[match.slice(1, -1)] ?? match));
  }
  if (Array.isArray(value)) return value.map((item) => replaceVariables(item, variables));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceVariables(item, variables)]));
  }
  return value;
}

function renderTemplate(template = {}, variables = {}) {
  const normalized = normalizeTemplate(template);
  const content = replaceVariables(normalized.content, variables);
  const embed = normalizeEmbed(replaceVariables(normalized.embed, variables));
  const panels = Array.isArray(normalized.panels) ? replaceVariables(normalized.panels, variables) : normalized.panels;
  return { ...normalized, content, embed, panels };
}

function renderBinding(guildId, moduleKey, slot, variables = {}, fallbackTemplateId = null) {
  const template = getBinding(guildId, moduleKey, slot) || (fallbackTemplateId ? getTemplate(guildId, fallbackTemplateId) : null);
  return template ? renderTemplate(template, variables) : null;
}

module.exports = {
  DEFAULT_EMBED,
  DEFAULT_TEMPLATES,
  MODULE_VARIABLES,
  cleanKey,
  normalizeEmbed,
  normalizeTemplate,
  extractVariables,
  variablesForTemplateType,
  getEmbedSection,
  listTemplates,
  getTemplate,
  saveTemplate,
  deleteTemplate,
  bindTemplate,
  getBinding,
  replaceVariables,
  renderTemplate,
  renderBinding,
  legacyPresetToTemplate,
};