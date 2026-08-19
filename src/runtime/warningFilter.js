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

try {
  const { AsyncLocalStorage } = require('async_hooks');
  const {
    ButtonInteraction,
    ChannelSelectMenuInteraction,
    ChatInputCommandInteraction,
    MentionableSelectMenuInteraction,
    ModalSubmitInteraction,
    RoleSelectMenuBuilder,
    RoleSelectMenuInteraction,
    StringSelectMenuInteraction,
    UserSelectMenuInteraction,
  } = require('discord.js');

  const ctx = new AsyncLocalStorage();
  const converted = new Set();
  const classes = [
    ChatInputCommandInteraction, ButtonInteraction, StringSelectMenuInteraction,
    RoleSelectMenuInteraction, ChannelSelectMenuInteraction, UserSelectMenuInteraction,
    MentionableSelectMenuInteraction, ModalSubmitInteraction,
  ].filter(Boolean);

  for (const InteractionClass of classes) {
    for (const method of ['reply', 'update', 'editReply', 'followUp']) {
      const original = InteractionClass?.prototype?.[method];
      if (typeof original !== 'function' || original.__goliathRoleContextWrapped) continue;
      const wrapped = function wrapped(...args) {
        return ctx.run({ guild: this.guild || null }, () => original.apply(this, args));
      };
      wrapped.__goliathRoleContextWrapped = true;
      InteractionClass.prototype[method] = wrapped;
    }
  }

  const originalToJSON = RoleSelectMenuBuilder?.prototype?.toJSON;
  if (typeof originalToJSON === 'function' && !originalToJSON.__goliathHierarchyAware) {
    const wrappedToJSON = function wrappedToJSON(...args) {
      const data = originalToJSON.apply(this, args);
      const guild = ctx.getStore()?.guild;
      const botMember = guild?.members?.me;
      const cache = guild?.roles?.cache;
      if (!guild || !botMember || !cache?.values) return data;

      const selected = new Set(
        (Array.isArray(data.default_values) ? data.default_values : [])
          .filter((entry) => entry?.type === 'role' && entry.id)
          .map((entry) => String(entry.id)),
      );

      const roles = [...cache.values()]
        .filter((role) => role && role.id !== guild.id && role.managed !== true
          && botMember.roles?.highest?.comparePositionTo?.(role) > 0)
        .sort((a, b) => Number(b.rawPosition ?? b.position ?? 0) - Number(a.rawPosition ?? a.position ?? 0)
          || String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }))
        .slice(0, 25);

      const customId = String(data.custom_id || '');
      if (customId) converted.add(customId);
      const available = roles.length;
      return {
        type: 3,
        custom_id: customId,
        placeholder: String(data.placeholder || (available ? 'Select role(s) in server hierarchy order' : 'No manageable roles available')).slice(0, 150),
        min_values: available ? Math.min(Math.max(0, Number(data.min_values ?? 1)), available) : 0,
        max_values: available ? Math.min(Math.max(1, Number(data.max_values || 1)), available, 25) : 1,
        disabled: Boolean(data.disabled) || !available,
        options: available ? roles.map((role) => ({
          label: String(role.name || role.id).slice(0, 100),
          value: String(role.id),
          description: `Hierarchy position ${Number(role.rawPosition ?? role.position ?? 0)}`.slice(0, 100),
          default: selected.has(String(role.id)),
          ...(role.unicodeEmoji ? { emoji: { name: role.unicodeEmoji } } : {}),
        })) : [{
          label: 'No manageable roles available',
          value: 'goliath:no-manageable-roles',
          description: 'Move Goliath above the roles it needs to manage.',
        }],
      };
    };
    wrappedToJSON.__goliathHierarchyAware = true;
    RoleSelectMenuBuilder.prototype.toJSON = wrappedToJSON;
  }

  if (StringSelectMenuInteraction?.prototype) {
    const original = StringSelectMenuInteraction.prototype.isRoleSelectMenu;
    StringSelectMenuInteraction.prototype.isRoleSelectMenu = function isRoleSelectMenu() {
      return converted.has(String(this.customId || ''))
        || (typeof original === 'function' && original.call(this));
    };
  }
} catch (error) {
  console.warn('[Runtime] Unable to apply hierarchy-aware role dropdown standard.');
  console.warn(error?.stack || error?.message || error);
}
