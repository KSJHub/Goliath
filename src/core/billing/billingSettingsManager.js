'use strict';

const fs = require('node:fs');

const { resolveBillingPath } = require('./billingPaths');

const DEFAULT_PRICING = Object.freeze({
  free: Object.freeze({ price: '£0', cadence: 'Free', note: 'No payment required.' }),
  plus: Object.freeze({ price: '£4.99', cadence: 'per month', note: 'Stripe and PayPal checkout coming soon.' }),
  pro: Object.freeze({ price: '£9.99', cadence: 'per month', note: 'Stripe and PayPal checkout coming soon.' }),
  lifetime: Object.freeze({ price: 'Not publicly sold', cadence: 'KSJ Digital controlled', note: 'Only appears when KSJ Digital makes Lifetime available.' }),
});

const DEFAULT_SETTINGS = Object.freeze({
  publicLifetimeEnabled: false,
  pricing: DEFAULT_PRICING,
  updatedAt: null,
  updatedBy: null,
});

function now() {
  return new Date().toISOString();
}

function getSettingsFile() {
  return resolveBillingPath('billingSettings.json');
}

function cleanText(value, fallback, maxLength = 80) {
  const text = String(value ?? '').trim().slice(0, maxLength);
  return text || fallback;
}

function normalizePricing(pricing = {}) {
  const source = pricing && typeof pricing === 'object' && !Array.isArray(pricing) ? pricing : {};
  const output = {};

  for (const [planId, defaults] of Object.entries(DEFAULT_PRICING)) {
    const planPricing = source[planId] && typeof source[planId] === 'object' ? source[planId] : {};
    output[planId] = {
      price: cleanText(planPricing.price, defaults.price, 40),
      cadence: cleanText(planPricing.cadence, defaults.cadence, 40),
      note: cleanText(planPricing.note, defaults.note, 140),
    };
  }

  return output;
}

function normalizeSettings(settings = {}) {
  const source = settings && typeof settings === 'object' ? settings : {};

  return {
    ...DEFAULT_SETTINGS,
    ...source,
    publicLifetimeEnabled: source.publicLifetimeEnabled === true,
    pricing: normalizePricing(source.pricing),
    updatedAt: source.updatedAt || null,
    updatedBy: source.updatedBy || null,
  };
}

function getBillingSettings() {
  const file = getSettingsFile();
  if (!fs.existsSync(file)) return normalizeSettings();

  try {
    return normalizeSettings(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return normalizeSettings();
  }
}

function saveBillingSettings(nextSettings = {}) {
  const settings = normalizeSettings(nextSettings);
  fs.writeFileSync(getSettingsFile(), JSON.stringify(settings, null, 2));
  return settings;
}

function updateBillingSettings(updates = {}, actor = 'owner') {
  const current = getBillingSettings();
  const hasLifetimeUpdate = Object.prototype.hasOwnProperty.call(updates, 'publicLifetimeEnabled');
  return saveBillingSettings({
    ...current,
    ...updates,
    pricing: normalizePricing({
      ...(current.pricing || {}),
      ...(updates.pricing || {}),
    }),
    publicLifetimeEnabled: hasLifetimeUpdate
      ? updates.publicLifetimeEnabled === true
      : current.publicLifetimeEnabled,
    updatedAt: now(),
    updatedBy: actor,
  });
}

module.exports = {
  getBillingSettings,
  updateBillingSettings,
};
