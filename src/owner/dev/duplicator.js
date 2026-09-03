'use strict';

const { Client } = require('discord.js');
const duplicator = require('./duplicatorV2');

const BOOTSTRAP_KEY = Symbol.for('goliath.duplicator.bridge-bootstrap');

if (!Client.prototype[BOOTSTRAP_KEY]) {
  const originalLogin = Client.prototype.login;
  Object.defineProperty(Client.prototype, BOOTSTRAP_KEY, { value: true });
  Client.prototype.login = function goliathDuplicatorLogin(...args) {
    duplicator.initializeBridge(this);
    return originalLogin.apply(this, args);
  };
}

module.exports = duplicator;
