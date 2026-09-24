'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const welcome = read('src/modules/messageStudio/welcome/welcome.js');
const delivery = read('src/modules/messageStudio/embed/embedTemplateDelivery.js');
const panel = read('src/modules/messageStudio/welcome/welcomePanel.js');

assert(welcome.includes("require('../embed/embedTemplateDelivery')"), 'Welcome must use the shared Embed Studio delivery service.');
assert(welcome.includes('buildTemplateDeliveryPayload({'), 'Welcome payloads must delegate to the shared delivery service.');
assert(!welcome.includes('buildPreviewEmbeds(state, renderInteraction)'), 'Welcome must not keep a private embed-only renderer.');
assert(delivery.includes("require('./embedRenderer')"), 'Shared delivery must use the canonical Embed Studio renderer.');
assert(delivery.includes('buildEmbedPayload({'), 'Shared delivery must build the same Components V2 payload as Embed Studio.');
assert(delivery.includes('media: state.mediaV2 || state.media'), 'Shared delivery must preserve saved Embed Studio media.');
assert(delivery.includes('actionRows'), 'Shared delivery must preserve saved Embed Studio buttons/actions.');
assert(welcome.includes('guildVariables.buildVariableMap'), 'Welcome must continue to source runtime values from Guild Variables.');
assert(/const payload\s*=\s*await welcome\.buildDiscordPayload\(member\s*,\s*['"]welcome['"]/.test(panel), 'Welcome Preview must await the async shared Components V2 delivery payload.');
assert(panel.includes('ephemeral:true') || panel.includes('ephemeral: true'), 'Welcome Preview must remain private/ephemeral.');

console.log('✅ Welcome ↔ Embed Studio delivery contract audit passed.');
