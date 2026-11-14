'use strict';

// Isolated wallet contract checks. No live guild files or Discord connection.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const walletPath = path.join(__dirname, 'wallet.js');
const source = fs.readFileSync(walletPath, 'utf8');
const guildId = '123456789012345678';
const alice = '123456789012345679';
const bob = '123456789012345680';
let state = { modules: { casino: {
  enabled: true,
  currency: { startingBalance: 100, maxBalance: 1000 },
  settings: { transfersEnabled: true },
  wallet: { balances: {}, transactions: {}, processedKeys: {} },
  analytics: { transactions: 0 }
} } };
const getGuildSection = (_guild, section) => {
  assert.equal(_guild, guildId);
  assert.equal(section, 'modules');
  return state.modules;
};
const updateGuildSection = (_guild, section, update) => {
  assert.equal(_guild, guildId);
  assert.equal(section, 'modules');
  const updated = update(state.modules);
  if (updated !== state.modules) state = { ...state, modules: updated };
};
const exports = {};
vm.runInNewContext(source, {
  module: { exports },
  exports,
  require: id => {
    assert.equal(id, '../../../core/guild/guildManager');
    return { getGuildSection, updateGuildSection };
  },
  Date, Number, Object, Array, String, JSON, Error, Set
}, { filename: walletPath });
const { casinoBalance, casinoTransaction } = exports;
assert.equal(casinoBalance(guildId, alice), 100);
const credit = casinoTransaction(guildId, { key: 'credit-1', operation: 'credit', userId: alice, amount: 50, reason: 'test' });
assert.equal(credit.balanceAfter, 150);
assert.equal(casinoBalance(guildId, alice), 150);
const duplicate = casinoTransaction(guildId, { key: 'credit-1', operation: 'credit', userId: alice, amount: 50, reason: 'test' });
assert.equal(duplicate.duplicate, true);
assert.equal(casinoBalance(guildId, alice), 150);
assert.throws(() => casinoTransaction(guildId, { key: 'credit-1', operation: 'credit', userId: alice, amount: 60, reason: 'test' }), /Idempotency/);
const debit = casinoTransaction(guildId, { key: 'debit-1', operation: 'debit', userId: alice, amount: 20 });
assert.equal(debit.balanceAfter, 130);
const transfer = casinoTransaction(guildId, { key: 'transfer-1', operation: 'transfer', userId: alice, targetUserId: bob, amount: 30 });
assert.equal(transfer.balanceAfter, 100);
assert.equal(casinoBalance(guildId, bob), 130);
assert.throws(() => casinoTransaction(guildId, { key: 'insufficient', operation: 'debit', userId: alice, amount: 101 }), /Insufficient/);
assert.throws(() => casinoTransaction(guildId, { key: 'overflow', operation: 'credit', userId: alice, amount: 901 }), /limit exceeded/);
assert.equal(Object.keys(state.modules.casino.wallet.transactions).length, 3);
assert.equal(state.modules.casino.analytics.transactions, 3);
state.modules.casino.enabled = false;
assert.throws(() => casinoTransaction(guildId, { key: 'disabled', operation: 'credit', userId: alice, amount: 1 }), /disabled/);
assert.equal(casinoBalance(guildId, alice), 100);
console.log('Casino wallet isolated contracts passed.');
