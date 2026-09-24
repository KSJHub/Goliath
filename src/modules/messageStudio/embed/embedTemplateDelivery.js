'use strict';

const { TextDisplayBuilder } = require('discord.js');
const panel = require('./embedPanel');
const { buildEmbedPayload } = require('./embedRenderer');
const embedTemplateManager = require('./embedTemplates');

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizePanel(panelData = {}) {
  const footer = panelData.footer && typeof panelData.footer === 'object' ? panelData.footer : {};
  const thumbnail = panelData.thumbnail && typeof panelData.thumbnail === 'object' ? panelData.thumbnail : {};
  const image = panelData.image && typeof panelData.image === 'object' ? panelData.image : {};
  const author = panelData.author && typeof panelData.author === 'object' ? panelData.author : {};

  return {
    ...clone(panelData),
    title: typeof panelData.title === 'string' ? panelData.title : '',
    description: typeof panelData.description === 'string' ? panelData.description : '',
    color: panelData.color || '#5865F2',
    authorName: panelData.authorName || author.name || '',
    authorIcon: panelData.authorIcon || author.iconURL || author.icon_url || '',
    authorUrl: panelData.authorUrl || author.url || '',
    thumbnail:
      (typeof panelData.thumbnail === 'string' ? panelData.thumbnail : '') ||
      panelData.thumbnailURL ||
      thumbnail.url ||
      '',
    image:
      (typeof panelData.image === 'string' ? panelData.image : '') ||
      panelData.imageURL ||
      image.url ||
      '',
    footer:
      (typeof panelData.footer === 'string' ? panelData.footer : '') ||
      footer.text ||
      '',
    footerIcon: panelData.footerIcon || footer.iconURL || footer.icon_url || '',
    fields: Array.isArray(panelData.fields) ? clone(panelData.fields) : [],
    buttons: Array.isArray(panelData.buttons) ? clone(panelData.buttons) : [],
  };
}

function templateToState(template = {}) {
  const panels = Array.isArray(template.panels) && template.panels.length
    ? template.panels.map(normalizePanel)
    : [normalizePanel({
        title: template.embed?.title || '',
        description: template.embed?.description || '',
        color: template.embed?.color || '#5865F2',
        author: template.embed?.author,
        thumbnail: template.embed?.thumbnail,
        thumbnailURL: template.embed?.thumbnailURL,
        image: template.embed?.image,
        imageURL: template.embed?.imageURL,
        footer: template.embed?.footer,
        fields: template.embed?.fields,
        buttons: template.embed?.buttons,
      })];

  const selectedPanelIndex = Math.max(
    0,
    Math.min(Number(template.selectedPanelIndex) || 0, Math.max(0, panels.length - 1)),
  );

  const selectedPanel = panels[selectedPanelIndex] || panels[0] || {};

  return {
    ...clone(template),
    panels,
    selectedPanelIndex,
    buttons: Array.isArray(template.buttons)
      ? clone(template.buttons)
      : clone(selectedPanel.buttons || template.embed?.buttons || []),
    showTimestamp: template.showTimestamp !== false,
    fieldLayout: template.fieldLayout || 'auto',
    allowUserPing: template.allowUserPing === true,
    media: clone(template.media || { panels: [] }),
  };
}

function prependContent(payload, content) {
  const text = String(content || '').trim();
  if (!text) return payload;
  return {
    ...payload,
    components: [
      new TextDisplayBuilder().setContent(text.slice(0, 4000)),
      ...(Array.isArray(payload.components) ? payload.components : []),
    ],
  };
}

/**
 * Canonical delivery path for a saved Embed Studio template.
 *
 * Calling modules own WHEN/WHERE/WHO. Guild Variables owns dynamic data.
 * Embed Studio owns WHAT and this function owns the final component-based
 * rendering contract used to send that template to Discord.
 */
async function buildTemplateDeliveryPayload(options = {}) {
  const {
    template,
    variables = {},
    interaction = null,
    includeComponents = true,
    allowUserPing = false,
    userId = null,
    ephemeral = false,
    allowedMentions = { parse: [], repliedUser: false },
  } = options;

  if (!template) throw new Error('A saved Embed Studio template is required.');

  const rendered = embedTemplateManager.renderTemplate(template, variables);
  const state = templateToState(rendered);
  const embeds = panel.buildPreviewEmbeds(state, interaction);
  const actionRows = includeComponents ? panel.buttonRows(state, interaction) : [];

  let payload = await buildEmbedPayload({
    embeds,
    actionRows,
    allowUserPing,
    userId,
    ephemeral,
    media: state.media,
    mediaAlignment: state.mediaAlignment || {},
    interaction,
  });

  payload = prependContent(payload, rendered.content);
  payload.allowedMentions = allowedMentions;
  return payload;
}

module.exports = {
  normalizePanel,
  templateToState,
  buildTemplateDeliveryPayload,
};
