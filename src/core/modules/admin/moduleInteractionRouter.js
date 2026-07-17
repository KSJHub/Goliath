'use strict';

const ADMIN_MODULE_IDS = Object.freeze({
  'admin:autoRoles': 'autoRoles',
  'admin:verification': 'verification',
  'admin:giveaways': 'giveaways',
  'admin:starboard': 'starboard',
  'admin:tempvoice': 'tempVoice',
  'admin:sticky': 'sticky',
  'admin:suggestions': 'suggestions',
  'admin:tickets': 'tickets',
  'admin:embed': 'embedStudio',
  'admin:invites': 'invites',
});

function resolveAdminModuleKey(customId) {
  return ADMIN_MODULE_IDS[String(customId || '').trim()] || null;
}

function isAdminModuleCustomId(customId) {
  return Boolean(resolveAdminModuleKey(customId));
}

module.exports = {
  ADMIN_MODULE_IDS,
  resolveAdminModuleKey,
  isAdminModuleCustomId,
};
