const originalEmitWarning = process.emitWarning.bind(process);

process.emitWarning = (warning, ...args) => {
  const message = String(typeof warning === 'string' ? warning : warning?.message || '');
  const warningName = typeof args[0] === 'string' ? args[0] : args[0]?.type || warning?.name;
  if (warningName === 'DeprecationWarning' && message.includes('ready event has been renamed to clientReady')) return;
  if (warningName === 'DeprecationWarning' && message.includes('`punycode` module is deprecated')) return;
  originalEmitWarning(warning, ...args);
};

const originalConsoleWarn = console.warn.bind(console);
console.warn = (...args) => {
  const message = args.map((item) => String(item?.message || item || '')).join(' ');
  const runtimeMode = String(process.env.BOT_MODE || 'DEV').trim().toUpperCase();
  if (runtimeMode !== 'DEV' && message.includes('[Audit Intelligence] Configured Command Center guild') && message.includes('is unavailable.')) return;
  originalConsoleWarn(...args);
};

try {
  const { ModalSubmitInteraction } = require('discord.js');
  const original = ModalSubmitInteraction?.prototype?.isFromMessage;
  if (typeof original === 'function') {
    ModalSubmitInteraction.prototype.isFromMessage = function isFromMessage() {
      return Boolean(this.message) || original.call(this);
    };
  }
} catch (error) {
  console.warn('[Runtime] Unable to apply modal source-message compatibility fix.');
  console.warn(error?.stack || error?.message || error);
}

// Keep Discord's native Role Select component intact.
// Native role selects are searchable and can reach the full guild role list while
// preserving Discord's server hierarchy ordering. The previous runtime conversion
// to a String Select hard-capped every role picker at the first 25 manageable roles,
// which made lower hierarchy roles unreachable in large guilds.
