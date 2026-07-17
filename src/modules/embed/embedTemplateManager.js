'use strict';

const crypto = require('crypto');
const {
  getGuildSection,
  updateGuildSection,
} = require('../../core/guild/guildManager');

const MAX_EMBED_TOTAL = 6000;
const MAX_HISTORY = 50;
const DEFAULT_TEMPLATE_IDS = new Set([
  'welcome_default',
  'goodbye_default',
  'leave_default',
  'dm_welcome_default',
  'ticket_panel_default',
  'form_submission_default',
]);

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

function assertGuildId(guildId) {
  const id = String(guildId || '').trim();
  if (!/^\d{15,25}$/.test(id)) throw new Error('Invalid guild ID.');
  return id;
}

function cleanKey(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 80);
}

function requiredKey(value, label = 'Key') {
  const key = cleanKey(value);
  if (!key) throw new Error(`${label} is required.`);
  return key;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function asObject(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function cleanText(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function cleanUrl(value, maxLength = 2048) {
  const url = String(value || '').trim().slice(0, maxLength);
  if (!url || /^\{[a-zA-Z0-9_.:-]+\}$/.test(url)) return url;
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) ? url : '';
  } catch {
    return '';
  }
}

function cleanColor(value) {
  const color = String(value || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color.toUpperCase();
  if (/^\d{1,8}$/.test(color)) {
    const numeric = Number(color);
    if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 0xFFFFFF) {
      return `#${numeric.toString(16).padStart(6, '0').toUpperCase()}`;
    }
  }
  return '#5865F2';
}

function normalizeButton(button = {}) {
  const action = cleanText(button.action || 'link', 64).toLowerCase();
  const style = cleanText(button.style || 'Link', 24);
  const url = cleanUrl(button.url, 512);
  return {
    label: cleanText(button.label || 'Button', 80) || 'Button',
    emoji: cleanText(button.emoji, 32),
    style,
    url: action === 'link' || style.toLowerCase() === 'link' ? url : '',
    action,
  };
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
  const templateType = requiredKey(preset.template || preset.templateType || 'global', 'Template type');
  return {
    ...clone(preset),
    templateId: requiredKey(preset.templateId || name, 'Template ID'),
    name: cleanText(preset.name || name, 100),
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
  const authorSource = asObject(source.author, {});
  const footerSource = asObject(source.footer, {});
  const fields = Array.isArray(source.fields)
    ? source.fields.slice(0, 25).map((field) => ({
      name: cleanText(field?.name || 'Field', 256) || 'Field',
      value: cleanText(field?.value || 'Value', 1024) || 'Value',
      inline: field?.inline === true,
    }))
    : [];

  const normalized = {
    ...clone(DEFAULT_EMBED),
    title: cleanText(source.title, 256),
    description: cleanText(source.description, 4096),
    color: cleanColor(source.color),
    author: {
      name: cleanText(authorSource.name, 256),
      iconURL: cleanUrl(authorSource.iconURL),
      url: cleanUrl(authorSource.url),
    },
    thumbnailURL: cleanUrl(source.thumbnailURL),
    imageURL: cleanUrl(source.imageURL),
    footer: {
      text: cleanText(footerSource.text, 2048),
      iconURL: cleanUrl(footerSource.iconURL),
    },
    fields,
    buttons: Array.isArray(source.buttons) ? source.buttons.slice(0, 20).map(normalizeButton) : [],
  };

  const totalLength = normalized.title.length
    + normalized.description.length
    + normalized.author.name.length
    + normalized.footer.text.length
    + normalized.fields.reduce((total, field) => total + field.name.length + field.value.length, 0);

  if (totalLength > MAX_EMBED_TOTAL) {
    throw new Error(`Embed content exceeds Discord's ${MAX_EMBED_TOTAL}-character total limit.`);
  }

  if (!normalized.title && !normalized.description && !normalized.fields.length && !normalized.imageURL && !normalized.thumbnailURL) {
    throw new Error('Embed must contain a title, description, field, image, or thumbnail.');
  }

  return normalized;
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
  const key = cleanKey(templateType) || 'global';
  return [...new Set([...MODULE_VARIABLES.global, ...(MODULE_VARIABLES[key] || [])])];
}

function normalizeTemplate(input = {}) {
  const key = requiredKey(input.templateId || input.id || input.name, 'Template ID');
  const templateType = requiredKey(input.templateType || input.module || 'global', 'Template type');
  const moduleName = requiredKey(input.module || templateType || 'global', 'Module');
  const embed = normalizeEmbed(input.embed || (Array.isArray(input.panels) ? panelToEmbed(input.panels[0]) : input));
  const content = String(input.content || '').trim().slice(0, 2000);
  const panels = Array.isArray(input.panels)
    ? input.panels.slice(0, 10).map((panel) => normalizeEmbed(panelToEmbed(panel)))
    : undefined;
  const usedVariables = [...extractVariables({ content, embed, panels })].sort();
  const supportedVariables = variablesForTemplateType(templateType);
  const createdAt = input.createdAt && !Number.isNaN(Date.parse(input.createdAt)) ? input.createdAt : now();

  return {
    id: key,
    templateId: key,
    name: cleanText(input.name || key, 100) || key,
    module: moduleName,
    templateType,
    content,
    embed,
    panels,
    buttons: Array.isArray(input.buttons) ? input.buttons.slice(0, 20).map(normalizeButton) : undefined,
    tags: Array.isArray(input.tags)
      ? [...new Set(input.tags.map((tag) => cleanText(tag, 40)).filter(Boolean))].slice(0, 20)
      : [],
    usedVariables,
    supportedVariables,
    unsupportedVariables: usedVariables.filter((variable) => !supportedVariables.includes(variable)),
    version: Math.max(1, Math.floor(Number(input.version) || 1)),
    createdAt,
    updatedAt: now(),
    migratedFromPreset: input.migratedFromPreset === true,
  };
}

function getEmbedSection(guildId) {
  const id = assertGuildId(guildId);
  const section = asObject(getGuildSection(id, 'embedStudio', {}), {});
  const stored = asObject(section.templates || section.presets, {});
  const legacy = asObject(getGuildSection(id, 'embedPresets', {}), {});
  const migrated = {};

  for (const [name, preset] of Object.entries(legacy)) {
    if (!preset || name === 'updatedAt') continue;
    try {
      const template = normalizeTemplate(legacyPresetToTemplate(name, preset));
      if (!stored[template.templateId]) migrated[template.templateId] = template;
    } catch (error) {
      console.warn(`[Embed Studio] Skipped invalid legacy preset ${name} in guild ${id}:`, error.message);
    }
  }

  if (Object.keys(migrated).length) {
    updateGuildSection(id, 'embedStudio', (current = {}) => ({
      ...asObject(current, {}),
      templates: { ...asObject(current.templates || current.presets, {}), ...migrated },
      updatedAt: now(),
    }), {});
  }

  return {
    ...section,
    templates: { ...clone(DEFAULT_TEMPLATES), ...stored, ...migrated },
    bindings: asObject(section.bindings, {}),
    history: Array.isArray(section.history) ? section.history.slice(-MAX_HISTORY) : [],
  };
}

function listTemplates(guildId) {
  const section = getEmbedSection(guildId);
  const output = {};
  for (const [key, template] of Object.entries(section.templates || {})) {
    try {
      output[key] = normalizeTemplate({ ...template, templateId: key });
    } catch (error) {
      console.warn(`[Embed Studio] Skipped invalid template ${key}:`, error.message);
    }
  }
  return output;
}

function getTemplate(guildId, templateId) {
  const key = requiredKey(templateId, 'Template ID');
  return listTemplates(guildId)[key] || null;
}

function saveTemplate(guildId, input = {}) {
  const id = assertGuildId(guildId);
  const template = normalizeTemplate(input);
  const section = updateGuildSection(id, 'embedStudio', (current = {}) => {
    const safeCurrent = asObject(current, {});
    const existingTemplates = asObject(safeCurrent.templates || safeCurrent.presets, {});
    const previous = existingTemplates[template.templateId];
    const history = Array.isArray(safeCurrent.history) ? safeCurrent.history : [];
    const storedTemplate = {
      ...template,
      version: Math.max(1, Number(previous?.version || 0) + 1),
      createdAt: previous?.createdAt || template.createdAt,
      updatedAt: now(),
    };
    return {
      ...safeCurrent,
      templates: { ...existingTemplates, [template.templateId]: storedTemplate },
      history: previous
        ? [...history.slice(-(MAX_HISTORY - 1)), {
          templateId: template.templateId,
          version: previous.version || 1,
          snapshot: clone(previous),
          archivedAt: now(),
        }]
        : history.slice(-MAX_HISTORY),
      updatedAt: now(),
    };
  }, {});

  const saved = section?.templates?.[template.templateId];
  if (!saved) throw new Error('Template save did not persist.');
  return normalizeTemplate(saved);
}

function deleteTemplate(guildId, templateId) {
  const id = assertGuildId(guildId);
  const key = requiredKey(templateId, 'Template ID');
  if (DEFAULT_TEMPLATE_IDS.has(key)) throw new Error('Default templates cannot be deleted.');

  let deleted = false;
  updateGuildSection(id, 'embedStudio', (current = {}) => {
    const safeCurrent = asObject(current, {});
    const templates = { ...asObject(safeCurrent.templates || safeCurrent.presets, {}) };
    if (!templates[key]) return safeCurrent;

    const bindings = {};
    for (const [moduleName, slots] of Object.entries(asObject(safeCurrent.bindings, {}))) {
      const filteredSlots = Object.fromEntries(
        Object.entries(asObject(slots, {})).filter(([, boundId]) => cleanKey(boundId) !== key)
      );
      if (Object.keys(filteredSlots).length) bindings[moduleName] = filteredSlots;
    }

    delete templates[key];
    deleted = true;
    return { ...safeCurrent, templates, bindings, updatedAt: now() };
  }, {});
  return deleted;
}

function bindTemplate(guildId, moduleKey, slot, templateId) {
  const id = assertGuildId(guildId);
  const moduleName = requiredKey(moduleKey, 'Module key');
  const slotName = requiredKey(slot, 'Template slot');
  const template = getTemplate(id, templateId);
  if (!template) throw new Error('Template not found.');

  updateGuildSection(id, 'embedStudio', (current = {}) => {
    const safeCurrent = asObject(current, {});
    return {
      ...safeCurrent,
      bindings: {
        ...asObject(safeCurrent.bindings, {}),
        [moduleName]: {
          ...asObject(safeCurrent.bindings?.[moduleName], {}),
          [slotName]: template.templateId,
        },
      },
      updatedAt: now(),
    };
  }, {});

  return { module: moduleName, slot: slotName, templateId: template.templateId, template };
}

function getBinding(guildId, moduleKey, slot) {
  const id = assertGuildId(guildId);
  const moduleName = requiredKey(moduleKey, 'Module key');
  const slotName = requiredKey(slot, 'Template slot');
  const section = getEmbedSection(id);
  const templateId = section.bindings?.[moduleName]?.[slotName] || null;
  if (!templateId) return null;
  return getTemplate(id, templateId);
}

function replaceVariables(value, variables = {}) {
  const safeVariables = asObject(variables, {});
  if (typeof value === 'string') {
    return value.replace(/\{[a-zA-Z0-9_.:-]+\}/g, (match) => {
      const replacement = safeVariables[match] ?? safeVariables[match.slice(1, -1)];
      return replacement === undefined || replacement === null ? match : String(replacement);
    });
  }
  if (Array.isArray(value)) return value.map((item) => replaceVariables(item, safeVariables));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceVariables(item, safeVariables)]));
  }
  return value;
}

function renderTemplate(template = {}, variables = {}) {
  const normalized = normalizeTemplate(template);
  const content = replaceVariables(normalized.content, variables).slice(0, 2000);
  const embed = normalizeEmbed(replaceVariables(normalized.embed, variables));
  const panels = Array.isArray(normalized.panels)
    ? normalized.panels.map((panel) => normalizeEmbed(replaceVariables(panel, variables)))
    : normalized.panels;
  return { ...normalized, content, embed, panels };
}

function renderBinding(guildId, moduleKey, slot, variables = {}, fallbackTemplateId = null) {
  const template = getBinding(guildId, moduleKey, slot)
    || (fallbackTemplateId ? getTemplate(guildId, fallbackTemplateId) : null);
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