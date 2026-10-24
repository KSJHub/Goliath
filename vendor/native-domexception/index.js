'use strict';

// fetch-blob imports the constructor through the legacy package name.
// Supported Node runtimes already provide the standard implementation.
if (typeof globalThis.DOMException !== 'function') {
  throw new Error('Goliath requires Node.js 22 or newer with native DOMException.');
}
module.exports = globalThis.DOMException;
