'use strict';

const assert = require('node:assert/strict');
const { rolePages, rolePager, rolePageSelect, mergePageSelection } = require('../src/core/ui/rolePagination');

const roles = new Map();
for (let i = 1; i <= 57; i++) {
  const id = String(100000000000000000n + BigInt(i));
  roles.set(id, { id, name: `Role ${i}`, position: i, managed: false });
}
const guild = { id: 'guild', roles: { cache: roles } };
const first = rolePages(guild, [], 0);
const second = rolePages(guild, [], 1);
const last = rolePages(guild, [], 99);
assert.equal(first.roles.length, 25);
assert.equal(second.roles.length, 25);
assert.equal(last.roles.length, 7);
assert.equal(last.page, 2);
assert.equal(last.pages, 3);
assert.equal(rolePages(guild, [], -5).page, 0);
assert.equal(rolePageSelect('test:roles', 'Choose roles', first).toJSON().options.length, 25);
assert.equal(rolePager('test:page', 0, 3).toJSON().components[0].disabled, true);
assert.equal(rolePager('test:page', 2, 3).toJSON().components[1].disabled, true);
const chosenFirst = first.roles[0].id;
const chosenSecond = second.roles[0].id;
const saved = mergePageSelection([], first.roles, [chosenFirst]);
assert.deepEqual(mergePageSelection(saved, second.roles, [chosenSecond]), [chosenFirst, chosenSecond]);
assert.deepEqual(mergePageSelection([chosenFirst, chosenSecond], first.roles, []), [chosenSecond]);
assert.throws(() => mergePageSelection([], first.roles, [chosenSecond]), /no longer valid/);
assert.throws(() => mergePageSelection([], first.roles, first.roles.slice(0, 11).map(role => role.id)), /no more than 10/);
console.log('Role pagination: page boundaries, buttons, selection preservation and validation passed');
