'use strict';

// Casino-only economy engine. Shared guild storage remains generic.
const { getGuildSection, updateGuildSection } = require('../../../core/guild/guildManager');

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function isPlainObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function getModuleSection(guildId, name, fallback = {}) {
  const modules = getGuildSection(guildId, 'modules', {});
  return isPlainObject(modules) && isPlainObject(modules[name]) ? modules[name] : fallback;
}

const CASINO_KEY_LIMIT = 2000;

function casinoUserId(value) {
  const id = String(value || '').trim();
  if (!/^\d{16,20}$/.test(id)) throw new Error('Invalid Discord user ID.');
  return id;
}

function casinoAmount(value, label = 'Amount') {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(label + ' must be a positive safe integer.');
  return value;
}

function casinoKey(value) {
  const key = String(value || '').trim();
  if (!/^[a-zA-Z0-9:_-]{1,128}$/.test(key)) throw new Error('A valid idempotency key is required.');
  return key;
}

function casinoBalance(guildId, userId) {
  const id = casinoUserId(userId);
  const section = getModuleSection(guildId, 'casino', { enabled: false });
  const initial = section.currency?.startingBalance ?? 0;
  const limit = section.currency?.maxBalance ?? 1000000000;
  if (!Number.isSafeInteger(initial) || initial < 0 ||
      !Number.isSafeInteger(limit) || limit < initial) {
    throw new Error('Invalid casino currency limits.');
  }
  const balance = section.wallet?.balances?.[id] ?? initial;
  if (!Number.isSafeInteger(balance) || balance < 0 || balance > limit) {
    throw new Error('Corrupt casino wallet balance.');
  }
  return balance;
}

/**
 * Server-side wallet ledger. All mutations are synchronous and serialized within
 * this Node process by updateGuildSection. Cross-process writers require an
 * external transactional store/lock before enabling casino payouts.
 *
 * operation: credit | debit | transfer
 * key: stable unique identifier supplied by the trusted calling workflow.
 */
function casinoTransaction(guildId, { key, operation, userId, targetUserId, amount, reason = '' } = {}) {
  const transactionKey = casinoKey(key);
  const sourceId = casinoUserId(userId);
  const quantity = casinoAmount(amount);
  if (!['credit', 'debit', 'transfer'].includes(operation)) throw new Error('Invalid casino operation.');
  const destinationId = operation === 'transfer' ? casinoUserId(targetUserId) : null;
  if (destinationId === sourceId) throw new Error('Cannot transfer to the same wallet.');
  const memo = String(reason || '').slice(0, 240);
  let result;
  updateGuildSection(guildId, 'modules', (modules = {}) => {
    const next = isPlainObject(modules) ? clone(modules) : {};
    const casino = isPlainObject(next.casino) ? next.casino : {};
    if (casino.enabled !== true) throw new Error('Casino is disabled for this server.');
    if (operation === 'transfer' && casino.settings?.transfersEnabled !== true) throw new Error('Casino transfers are disabled.');
    const wallet = isPlainObject(casino.wallet) ? casino.wallet : {};
    const balances = isPlainObject(wallet.balances) ? wallet.balances : {};
    const transactions = isPlainObject(wallet.transactions) ? wallet.transactions : {};
    // Never truncate financial history; fail closed at configured storage capacity.
    const processedKeys = isPlainObject(wallet.processedKeys) ? wallet.processedKeys : {};
    const fingerprint = JSON.stringify([operation, sourceId, destinationId, quantity, memo]);
    if (Object.prototype.hasOwnProperty.call(processedKeys, transactionKey)) {
      const prior = processedKeys[transactionKey];
      if (prior.fingerprint !== fingerprint) throw new Error('Idempotency key reused for different transaction.');
      result = { ...prior.result, duplicate: true };
      return modules;
    }
    const initial = casino.currency?.startingBalance ?? 0;
    const limit = casino.currency?.maxBalance ?? 1000000000;
    if (!Number.isSafeInteger(initial) || initial < 0 || !Number.isSafeInteger(limit) || limit < initial) {
      throw new Error('Invalid casino currency limits.');
    }
    const balanceOf = (id) => {
      const value = balances[id] ?? initial;
      if (!Number.isSafeInteger(value) || value < 0 || value > limit) throw new Error('Corrupt casino wallet balance.');
      return value;
    };
    const before = balanceOf(sourceId);
    const targetBefore = destinationId ? balanceOf(destinationId) : null;
    if (operation !== 'credit' && before < quantity) throw new Error('Insufficient casino balance.');
    if (operation === 'credit' && quantity > limit - before) throw new Error('Casino balance limit exceeded.');
    if (destinationId && quantity > limit - targetBefore) throw new Error('Recipient casino balance limit exceeded.');
    const after = operation === 'credit' ? before + quantity : before - quantity;
    balances[sourceId] = after;
    if (destinationId) balances[destinationId] = targetBefore + quantity;
    const entry = {
      key: transactionKey, operation, userId: sourceId, targetUserId: destinationId,
      amount: quantity, reason: memo, balanceBefore: before, balanceAfter: after,
      targetBalanceBefore: targetBefore,
      targetBalanceAfter: destinationId ? balances[destinationId] : null,
      createdAt: new Date().toISOString(),
    };
    result = { ...entry, duplicate: false };
    transactions[transactionKey] = entry;
    processedKeys[transactionKey] = { fingerprint, result: entry };
    // Preserve the complete idempotency index: eviction would permit replay.
    // Fail closed before allowing unbounded growth.
    if (Object.keys(processedKeys).length > CASINO_KEY_LIMIT) throw new Error('Casino ledger capacity reached; migrate to transactional storage before continuing.');
    next.casino = {
      ...casino,
      wallet: { ...wallet, balances, transactions, processedKeys },
      analytics: { ...(isPlainObject(casino.analytics) ? casino.analytics : {}), transactions:
        (Number.isSafeInteger(casino.analytics?.transactions) ? casino.analytics.transactions : 0) + 1 },
      updatedAt: new Date().toISOString(),
    };
    return next;
  });
  return result;
}

/**
 * Casino game outcomes only. These functions do not debit, credit or pay out
 * wallets: wagering stays disabled until durable transactional storage exists.
 * Randomness is supplied by Node's cryptographic randomInt.
 */
const { randomInt } = require('node:crypto');
const SLOT_SYMBOLS = Object.freeze(['cherry', 'lemon', 'orange', 'bell', 'star', 'seven']);

function casinoDice(choice, roll = randomInt(1, 14)) {
  if (!['under', 'seven', 'over'].includes(choice)) throw new Error('Invalid dice choice.');
  if (!Number.isInteger(roll) || roll < 1 || roll > 13) throw new Error('Invalid dice roll.');
  return Object.freeze({ roll, choice, won: choice === 'under' ? roll < 7 : choice === 'over' ? roll > 7 : roll === 7 });
}

function casinoRoulette(choice, roll = randomInt(0, 37)) {
  if (!Number.isInteger(roll) || roll < 0 || roll > 36) throw new Error('Invalid roulette roll.');
  const valid = choice === 'red' || choice === 'black' || choice === 'green' ||
    (Number.isInteger(choice) && choice >= 0 && choice <= 36);
  if (!valid) throw new Error('Invalid roulette choice.');
  // European single-zero roulette: 18 red, 18 black, one green.
  const red = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
  const colour = roll === 0 ? 'green' : red.has(roll) ? 'red' : 'black';
  return Object.freeze({ roll, colour, choice, won: typeof choice === 'number' ? choice === roll : choice === colour });
}

function casinoSlots(reels = [randomInt(0, 6), randomInt(0, 6), randomInt(0, 6)]) {
  if (!Array.isArray(reels) || reels.length !== 3 ||
      !reels.every(value => Number.isInteger(value) && value >= 0 && value < SLOT_SYMBOLS.length)) {
    throw new Error('Invalid slot reels.');
  }
  const symbols = reels.map(index => SLOT_SYMBOLS[index]);
  const matches = symbols[0] === symbols[1] && symbols[1] === symbols[2] ? 3 :
    (symbols[0] === symbols[1] || symbols[0] === symbols[2] || symbols[1] === symbols[2]) ? 2 : 0;
  return Object.freeze({ symbols: Object.freeze(symbols), matches });
}

module.exports = { casinoBalance, casinoTransaction, casinoDice, casinoRoulette, casinoSlots };
