'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const required = [
  'src/modules/reactionroles/reactionRoles.js',
  'src/modules/reactionroles/reactionRolesRoute.js',
  'src/modules/reactionroles/reactionRoleMessageFinder.js',
  'src/modules/reactionroles/reactionRolesPanel.js',
  'src/dashboard/js/pages/modules/ReactionRoles.jsx',
  'src/events/messages/messageReactionAdd.js',
  'src/events/messages/messageReactionRemove.js',
];

const failures = [];
for (const relative of required) {
  const filename = path.join(root, relative);
  if (!fs.existsSync(filename)) failures.push(`Missing ${relative}`);
}

function contains(relative, snippets) {
  const content = fs.readFileSync(path.join(root, relative), 'utf8');
  for (const snippet of snippets) {
    if (!content.includes(snippet)) failures.push(`${relative} is missing: ${snippet}`);
  }
}

contains('src/modules/reactionroles/reactionRolesRoute.js', [
  "require('./reactionRoleMessageFinder')",
  "router.get('/:guildId/messages/search'",
  'messageFinder.searchGuildMessages',
  "router.put('/:guildId/panels/:panelId'",
  "router.patch('/:guildId/panels/:panelId/enabled'",
]);
contains('src/modules/reactionroles/reactionRoleMessageFinder.js', [
  'searchGuildMessages',
  'serializeEmbed',
  'authorAvatar',
  'reactions',
  'imageURL',
  'embedsOnly',
  'pinnedOnly',
  'botsOnly',
  'messageId',
]);
contains('src/dashboard/js/pages/modules/ReactionRoles.jsx', [
  'Find a Message',
  'Search Messages',
  'DiscordMessagePreview',
  'DiscordEmbedPreview',
  'Select Message',
  '+ Add Emoji → Role',
  'Attach to Selected Message',
  'Preview',
  'Edit mappings',
  'Save & Sync',
  'Duplicate',
  'Detach + Clear',
  'Open in Discord',
]);
contains('src/modules/reactionroles/reactionRoles.js', [
  'attachExistingMessage',
  'createFromTemplate',
  'updatePanelMappings',
  'setPanelEnabled',
  'repairAll',
  'handleReactionAdd',
  'handleReactionRemove',
]);

if (failures.length) {
  console.error('[Reaction Roles Doctor] FAILED');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('[Reaction Roles Doctor] PASS');