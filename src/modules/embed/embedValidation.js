// functions/embed/embedValidation.js

const MAX_BUTTONS = 20;
const MAX_BUTTONS_PER_ROW = 5;
const MAX_COMPONENT_ROWS = 5;

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
  return /^\{[a-zA-Z0-9]+\}$/.test(text);
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

    if (!label) {
      errors.push(`Button ${number} is missing a label.`);
    }

    if (style === 'Link' || url) {
      if (!url) {
        errors.push(`Button ${number} is a Link button but has no URL.`);
      } else if (!isUsableUrl(url)) {
        errors.push(`Button ${number} has an invalid URL.`);
      }
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
    if (!text) return;

    if (!isUsableUrl(text)) {
      errors.push(`${label} must be a valid http(s) URL or supported variable.`);
    }
  });

  return errors;
}

function validateEmbedState(state = {}) {
  return [
    ...getButtonValidationErrors(state.buttons),
    ...getUrlValidationErrors(state),
  ];
}

function formatValidationErrors(errors = []) {
  if (!errors.length) return '';

  return [
    '⚠️ Embed Studio validation failed:',
    '',
    ...errors.slice(0, 10).map((error) => `• ${error}`),
    errors.length > 10 ? `• And ${errors.length - 10} more issue(s).` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

module.exports = {
  MAX_BUTTONS,
  MAX_BUTTONS_PER_ROW,
  MAX_COMPONENT_ROWS,
  toCleanString,
  isHttpUrl,
  isVariableUrl,
  isUsableUrl,
  normaliseButtonStyle,
  getButtonValidationErrors,
  getUrlValidationErrors,
  validateEmbedState,
  formatValidationErrors,
};
