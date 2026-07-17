'use strict';

const { StringSelectMenuBuilder } = require('discord.js');

const PATCH_FLAG = Symbol.for('goliath.socialSelectMenuSafety');

function installSocialSelectMenuSafety() {
  const prototype = StringSelectMenuBuilder?.prototype;
  if (!prototype || prototype[PATCH_FLAG]) return false;

  const originalToJSON = prototype.toJSON;
  if (typeof originalToJSON !== 'function') return false;

  Object.defineProperty(prototype, PATCH_FLAG, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  prototype.toJSON = function safeSocialSelectMenuToJSON(...args) {
    const data = originalToJSON.apply(this, args);
    const customId = String(data?.custom_id || '');
    const options = Array.isArray(data?.options) ? data.options : [];

    if (customId.startsWith('admin:social:') && options.length === 0) {
      return {
        ...data,
        disabled: true,
        options: [{
          label: 'No options available',
          value: '__none__',
          description: 'Configure an item before using this menu.',
        }],
      };
    }

    return data;
  };

  return true;
}

installSocialSelectMenuSafety();

module.exports = {
  name: 'clientReady',
  once: true,
  execute() {
    installSocialSelectMenuSafety();
  },
  installSocialSelectMenuSafety,
};
