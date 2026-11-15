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
const walletModule = { exports: {} };
vm.runInNewContext(source, {
  module: walletModule,
  exports: walletModule.exports,
  require: id => {
    if (id === 'node:crypto') return { randomInt: (min, max) => min }; 
    assert.equal(id, '../../../core/guild/guildManager');
    return { getGuildSection, updateGuildSection };
  },
  Date, Number, Object, Array, String, JSON, Error, Set
}, { filename: walletPath });
const { casinoBalance, casinoTransaction, casinoDice, casinoRoulette, casinoSlots, casinoPayout } = walletModule.exports;
assert.equal(casinoDice('under', 6).won, true);
assert.equal(casinoDice('seven', 7).won, true);
assert.equal(casinoDice('over', 8).won, true);
assert.equal(casinoDice('over', 7).won, false);
assert.throws(() => casinoDice('under', 14), /Invalid dice roll/);
assert.equal(casinoRoulette('green', 0).won, true);
assert.equal(casinoRoulette('red', 1).won, true);
assert.equal(casinoRoulette('black', 2).won, true);
assert.equal(casinoRoulette(36, 36).won, true);
assert.equal(casinoRoulette('red', 0).won, false);
assert.throws(() => casinoRoulette('blue', 1), /Invalid roulette choice/);
assert.equal(casinoSlots([0, 0, 0]).matches, 3);
assert.equal(casinoSlots([0, 1, 0]).matches, 2);
assert.equal(casinoSlots([0, 1, 2]).matches, 0);
assert.throws(() => casinoSlots([0, 6, 0]), /Invalid slot reels/);
assert.equal(casinoPayout('dice', 10, casinoDice('seven', 7)).total, 130);
assert.equal(casinoPayout('dice', 10, casinoDice('under', 9)).total, 0);
assert.equal(casinoPayout('roulette', 10, casinoRoulette('red', 1)).total, 20);
assert.equal(casinoPayout('roulette', 10, casinoRoulette(36, 36)).total, 360);
assert.equal(casinoPayout('slots', 10, casinoSlots([5, 5, 5])).total, 200);
assert.equal(casinoPayout('slots', 10, casinoSlots([0, 0, 1])).total, 20);
assert.equal(casinoPayout('slots', 10, casinoSlots([0, 1, 2])).total, 0);
assert.throws(() => casinoPayout('dice', 1, { choice: 'seven', roll: 1, won: true }), /Invalid dice outcome/);
assert.throws(() => casinoPayout('dice', Number.MAX_SAFE_INTEGER, casinoDice('seven', 7)), /safe integer range/);
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
// Read-only balance checks must reject corrupt values and currency configuration.
state.modules.casino.wallet.balances[alice] = 1001;
assert.throws(() => casinoBalance(guildId, alice), /Corrupt casino wallet balance/);
state.modules.casino.wallet.balances[alice] = 100;
state.modules.casino.currency.maxBalance = 50;
assert.throws(() => casinoBalance(guildId, alice), /Invalid casino currency limits/);
state.modules.casino.currency.maxBalance = 1000;
console.log('Casino wallet isolated contracts passed.');
