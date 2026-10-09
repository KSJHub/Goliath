'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const welcomeEntry = read('src/modules/messageStudio/welcome/welcome.js');
const welcome = read('src/modules/messageStudio/welcome/welcomeCore.js');
const delivery = read('src/modules/messageStudio/embed/embedTemplateDelivery.js');
const panel = read('src/modules/messageStudio/welcome/welcomePanel.js');

assert(welcomeEntry.includes("require('./welcomeCore')"), 'Stable Welcome entry point must use the canonical Welcome implementation.');
assert(welcome.includes("require('../embed/embedTemplateDelivery')"), 'Welcome must use the shared Embed Studio delivery service.');
assert(welcome.includes('buildTemplateDeliveryPayload({'), 'Welcome payloads must delegate to the shared delivery service.');
assert(!welcome.includes('buildPreviewEmbeds(state, renderInteraction)'), 'Welcome must not keep a private embed-only renderer.');
assert(delivery.includes("require('./embedRenderer')"), 'Shared delivery must use the canonical Embed Studio renderer.');
assert(delivery.includes('buildEmbedPayload({'), 'Shared delivery must build the same canonical payload as Embed Studio.');
assert(delivery.includes('media: state.media'), 'Shared delivery must preserve saved Embed Studio media.');
assert(delivery.includes('actionRows'), 'Shared delivery must preserve saved Embed Studio buttons/actions.');
assert(welcome.includes('guildVariables.buildVariableMap'), 'Welcome must continue to source runtime values from Guild Variables.');
assert(/const payload\s*=\s*await welcome\.buildDiscordPayload\(member\s*,\s*['"]welcome['"]/.test(panel), 'Welcome Preview must await the async shared canonical delivery payload.');
assert(panel.includes('ephemeral:true') || panel.includes('ephemeral: true'), 'Welcome Preview must remain private/ephemeral.');

const scheduled = read('src/modules/messageStudio/welcome/scheduledWelcome.js');
const dashboard = read('src/dashboard/js/pages/modules/Welcome.jsx');
const route = read('src/server/routes/modules/messageStudio/welcome.js');

assert(scheduled.includes('completed.add(member.id)'), 'Scheduled Welcome must checkpoint successful member deliveries.');
assert(scheduled.includes('scheduled_welcome_delivery_checkpoint'), 'Scheduled Welcome must persist the successful-delivery checkpoint.');
assert(scheduled.indexOf('scheduled_welcome_delivery_checkpoint') < scheduled.indexOf('await queue.removeQueueRole(member, config.queueRoleId)'), 'Delivery checkpoint must precede queue role cleanup.');
assert(panel.includes("customId==='admin:welcome:resetConfirm'"), 'Destructive Welcome reset must require a confirmation action.');
assert(panel.includes('result.publicFailed') && panel.includes('result.dmFailed'), 'Discord test feedback must expose public and DM failures.');
assert(panel.includes('result.sendFailed') && panel.includes('result.roleRemovalFailed'), 'Discord scheduled feedback must expose partial failures.');
assert(dashboard.includes('queueLoaded'), 'Dashboard must distinguish an unloaded queue from an empty queue.');
assert(dashboard.includes('scheduledHealth?.stuckMemberIds?.length'), 'Dashboard must expose pending role cleanup.');
assert(dashboard.includes('Members per batch'), 'Dashboard must expose the scheduled batch-size control.');
assert(route.includes("router.post('/:guildId/custom-message'"), 'Dashboard custom Welcome editor must save through the canonical API.');

assert(scheduled.includes('const activeRuns = new Set()'), 'Scheduled Welcome must maintain a per-guild active-run guard.');
assert(scheduled.includes("reason: 'already_running'"), 'Overlapping Scheduled Welcome runs must return an explicit skip reason.');
assert(scheduled.includes('activeRuns.delete(guild.id)'), 'Scheduled Welcome must release its active-run guard.');
assert(panel.includes("result.reason==='already_running'"), 'Discord Scheduled Welcome must explain overlapping runs.');
assert(dashboard.includes("result.reason === 'already_running'"), 'Dashboard Scheduled Welcome must explain overlapping runs.');
assert(dashboard.includes('if (result.skipped)'), 'Dashboard Scheduled Welcome must not report skipped runs as successful.');

console.log('✅ Welcome ↔ Embed Studio delivery contract audit passed.');
