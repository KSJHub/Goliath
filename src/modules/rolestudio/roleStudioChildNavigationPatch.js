'use strict';

function transform(value) {
  if (Array.isArray(value)) return value.map(transform);
  if (!value || typeof value !== 'object') return value;
  const source = typeof value.toJSON === 'function' ? value.toJSON() : value;
  const next = Object.fromEntries(Object.entries(source).map(([key, item]) => [key, transform(item)]));
  if (next.custom_id === 'admin:modules') next.custom_id = 'admin:reactionRoles';
  if (next.label === '⬅️ Modules') next.label = '⬅️ Role Studio';
  return next;
}

function patchPanel(panel, handlerName, builderNames = []) {
  if (!panel || panel.__roleStudioNavigationPatched) return panel;
  Object.defineProperty(panel, '__roleStudioNavigationPatched', { value: true });

  for (const builderName of builderNames) {
    const original = panel[builderName];
    if (typeof original !== 'function') continue;
    panel[builderName] = async (...args) => transform(await original(...args));
  }

  const originalHandler = panel[handlerName];
  if (typeof originalHandler === 'function') {
    panel[handlerName] = async (interaction, ...args) => {
      const methods = {};
      for (const name of ['reply', 'update', 'editReply', 'followUp']) {
        if (typeof interaction[name] !== 'function') continue;
        methods[name] = interaction[name].bind(interaction);
        interaction[name] = (payload, ...rest) => methods[name](transform(payload), ...rest);
      }
      try {
        return await originalHandler(interaction, ...args);
      } finally {
        for (const [name, method] of Object.entries(methods)) interaction[name] = method;
      }
    };
  }

  return panel;
}

patchPanel(require('../autoroles/autorolesPanel'), 'handleAutoRolesInteraction', ['buildAutorolesPanel']);
patchPanel(require('../timedroles/timedRolesPanel'), 'handleTimedRolesInteraction', ['buildOverview', 'buildTimedRolesPanel']);

module.exports = { transform };