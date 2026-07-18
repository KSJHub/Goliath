'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const requiredFiles = [
  'src/modules/goodbye/goodbye.js',
  'src/modules/goodbye/departureTemplateSender.js',
  'src/modules/goodbye/goodbyeDepartureDm.js',
  'src/modules/goodbye/goodbyeDmPanel.js',
  'src/modules/goodbye/goodbyePanel.js',
  'src/modules/goodbye/goodbyeRoute.js',
  'src/events/members/memberJoinLeave.js',
  'src/dashboard/js/pages/modules/Goodbye.jsx',
  'docs/modules/goodbye.md',
];

const errors = [];
for (const relativePath of requiredFiles) {
  if (!fs.existsSync(path.join(root, relativePath))) errors.push(`Missing ${relativePath}`);
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

if (!errors.length) {
  const dm = require(path.join(root, 'src/modules/goodbye/goodbyeDepartureDm.js'));
  for (const name of ['getConfig', 'updateConfig', 'resetConfig', 'buildDmEmbed', 'sendDepartureDm']) {
    if (typeof dm[name] !== 'function') errors.push(`goodbyeDepartureDm.${name} is not exported.`);
  }

  const eventSource = read('src/events/members/memberJoinLeave.js');
  if (!eventSource.includes('goodbyeDepartureDm.sendDepartureDm(member, removal)')) {
    errors.push('guildMemberRemove does not invoke the departure DM service with the detected removal.');
  }
  if (!eventSource.includes('departureTemplateSender.sendDeparture(member, removal)')) {
    errors.push('guildMemberRemove no longer invokes the staff departure template sender.');
  }

  const dmSource = read('src/modules/goodbye/goodbyeDepartureDm.js');
  for (const eventKey of ['left', 'kicked', 'banned', 'pruned']) {
    if (!dmSource.includes(`${eventKey}:`)) errors.push(`Departure DM is missing ${eventKey} event support.`);
  }
  for (const heading of ['YOUR ACCOUNT', 'YOUR TIME HERE', 'DEPARTURE']) {
    if (!dmSource.includes(heading)) errors.push(`Departure DM is missing the ${heading} section.`);
  }

  const panelSource = read('src/modules/goodbye/goodbyePanel.js');
  if (!panelSource.includes("admin:goodbye:dm")) errors.push('Goodbye admin panel has no Departure DM entry point.');
  const dmPanelSource = read('src/modules/goodbye/goodbyeDmPanel.js');
  if (!dmPanelSource.includes('Send Test DM')) errors.push('Departure DM panel has no test action.');

  const routeSource = read('src/modules/goodbye/goodbyeRoute.js');
  for (const endpoint of ['/dm-config', '/dm-test', '/dm-reset']) {
    if (!routeSource.includes(endpoint)) errors.push(`Goodbye API is missing ${endpoint}.`);
  }
}

if (errors.length) {
  console.error(`\nGoodbye doctor failed (${errors.length} issue${errors.length === 1 ? '' : 's'}):`);
  for (const error of errors) console.error(` - ${error}`);
  process.exitCode = 1;
} else {
  console.log('\n✅ Goodbye staff-log and departure-DM audit passed.');
}
