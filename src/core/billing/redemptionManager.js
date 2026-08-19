'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

const { resolveBillingPath } = require('./billingPaths');
const subscriptionManager = require('./subscriptionManager');
const { PLAN_IDS, normalizePlanId } = require('../../config/plans');

const CODE_PREFIX = 'GOL';
const VALID_DURATIONS = Object.freeze({
  '1m': 30,
  '3m': 90,
  '6m': 180,
});

function now() {
  return new Date().toISOString();
}

function getCodesFile() {
  return resolveBillingPath('codes.json');
}

function readCodes() {
  const file = getCodesFile();
  if (!fs.existsSync(file)) return { codes: [] };

  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { codes: Array.isArray(parsed.codes) ? parsed.codes : [] };
  } catch {
    return { codes: [] };
  }
}

function writeCodes(data) {
  fs.writeFileSync(getCodesFile(), JSON.stringify({ codes: Array.isArray(data.codes) ? data.codes : [] }, null, 2));
}

function cleanCode(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function cleanGuildId(value) {
  const guildId = String(value || '').trim();
  if (!/^\d{15,25}$/.test(guildId)) throw new Error('Invalid guild ID.');
  return guildId;
}

function normalizeDuration(value, plan) {
  if (plan === PLAN_IDS.LIFETIME) return null;
  const key = String(value || '1m').trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(VALID_DURATIONS, key)) return VALID_DURATIONS[key];
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) return Math.round(number);
  return VALID_DURATIONS['1m'];
}

function codePlanToken(plan) {
  if (plan === PLAN_IDS.LIFETIME) return 'LIFE';
  return plan.toUpperCase();
}

function durationToken(durationDays) {
  if (!durationDays) return '';
  if (durationDays === 30) return '1M';
  if (durationDays === 90) return '3M';
  if (durationDays === 180) return '6M';
  return `${durationDays}D`;
}

function generateCodeValue(plan, durationDays, existingCodes = new Set()) {
  const parts = [CODE_PREFIX, codePlanToken(plan)];
  const duration = durationToken(durationDays);
  if (duration) parts.push(duration);

  let code = '';
  do {
    const suffix = crypto.randomBytes(4).toString('hex').toUpperCase();
    code = [...parts, suffix].join('-');
  } while (existingCodes.has(code));

  return code;
}

function addDays(days) {
  const numericDays = Number(days);
  if (!Number.isFinite(numericDays) || numericDays <= 0) {
    throw new Error('Redeem code duration is invalid.');
  }

  const date = new Date();
  date.setUTCDate(date.getUTCDate() + Math.trunc(numericDays));
  if (!Number.isFinite(date.getTime())) {
    throw new Error('Redeem code duration exceeds the supported date range.');
  }

  return date.toISOString();
}

function generateCodes({ plan = PLAN_IDS.PLUS, duration = '1m', quantity = 1, createdBy = 'system' } = {}) {
  const normalizedPlan = normalizePlanId(plan);
  if (![PLAN_IDS.PLUS, PLAN_IDS.PRO, PLAN_IDS.LIFETIME].includes(normalizedPlan)) {
    throw new Error('Redeem codes can only grant Plus, Pro or Lifetime.');
  }

  const numericQuantity = Number(quantity);
  const safeQuantity = Number.isFinite(numericQuantity)
    ? Math.min(Math.max(Math.trunc(numericQuantity), 1), 100)
    : 1;
  const durationDays = normalizeDuration(duration, normalizedPlan);
  const data = readCodes();
  const existing = new Set(data.codes.map((item) => cleanCode(item.code)));
  const created = [];

  for (let index = 0; index < safeQuantity; index += 1) {
    const code = generateCodeValue(normalizedPlan, durationDays, existing);
    existing.add(code);
    const item = {
      code,
      plan: normalizedPlan,
      duration: durationDays,
      used: false,
      revoked: false,
      createdBy,
      createdAt: now(),
      guildId: null,
      redeemedAt: null,
      revokedAt: null,
    };
    data.codes.push(item);
    created.push(item);
  }

  writeCodes(data);
  return created;
}

function listCodes({ includeRevoked = true } = {}) {
  const data = readCodes();
  return data.codes.filter((code) => includeRevoked || code.revoked !== true);
}

function findCode(code) {
  const clean = cleanCode(code);
  return readCodes().codes.find((item) => cleanCode(item.code) === clean) || null;
}

function redeemCode(guildId, code, redeemedBy = 'dashboard') {
  const safeGuildId = cleanGuildId(guildId);
  const clean = cleanCode(code);
  if (!clean) throw new Error('Redeem code is required.');

  const data = readCodes();
  const index = data.codes.findIndex((item) => cleanCode(item.code) === clean);
  if (index < 0) throw new Error('Redeem code does not exist.');

  const item = data.codes[index];
  if (item.revoked === true) throw new Error('Redeem code has been revoked.');
  if (item.used === true) throw new Error('Redeem code has already been used.');

  const plan = normalizePlanId(item.plan);
  const expiresAt = plan === PLAN_IDS.LIFETIME ? null : addDays(item.duration || 30);
  const subscription = subscriptionManager.setSubscription(safeGuildId, plan, {
    source: 'redeem_code',
    expiresAt,
    redeemCode: item.code,
  });

  data.codes[index] = {
    ...item,
    used: true,
    guildId: safeGuildId,
    redeemedBy,
    redeemedAt: now(),
  };

  writeCodes(data);

  return {
    code: data.codes[index],
    subscription,
  };
}

function revokeCode(code, revokedBy = 'system') {
  const clean = cleanCode(code);
  const data = readCodes();
  const index = data.codes.findIndex((item) => cleanCode(item.code) === clean);
  if (index < 0) throw new Error('Redeem code does not exist.');

  data.codes[index] = {
    ...data.codes[index],
    revoked: true,
    revokedBy,
    revokedAt: now(),
  };

  writeCodes(data);
  return data.codes[index];
}

module.exports = {
  generateCodes,
  listCodes,
  redeemCode,
  revokeCode,
};
