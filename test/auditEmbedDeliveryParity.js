'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const interactionsPath = path.join(__dirname, '..', 'src', 'modules', 'messageStudio', 'embed', 'embedInteractions.js');
const panelPath = path.join(__dirname, '..', 'src', 'modules', 'messageStudio', 'embed', 'embedPanel.js');
const rendererPath = path.join(__dirname, '..', 'src', 'modules', 'messageStudio', 'embed', 'embedRenderer.js');

const interactions = fs.readFileSync(interactionsPath, 'utf8');
const panel = fs.readFileSync(panelPath, 'utf8');
const renderer = fs.readFileSync(rendererPath, 'utf8');
const modern = interactions.split('async function handleLegacyInteraction')[0];

// All externally visible delivery operations must pass through the same payload
// builder. This keeps Test, Deploy and Update Existing aligned with one another.
assert.match(modern, /const DELIVERY_ACTIONS = new Set\(\['embed:test-send', 'embed:use', 'embed:update-existing'\]\)/);
assert.match(modern, /customId === 'embed:test-send'[\s\S]*?buildPayload\(state, i, true\)/);
assert.match(modern, /customId === 'embed:update-existing'[\s\S]*?buildPayload\(state, i, false\)/);
assert.match(modern, /customId === 'embed:use'[\s\S]*?buildPayload\(state, i, false\)/);

// The canonical placement-aware media model must win over the compatibility
// alias. Otherwise a stale legacy image can move a Graphic Header to the bottom.
assert.match(modern, /media:\s*state\.mediaV2\s*\|\|\s*state\.media/);

// Readiness is the Review gate for every delivery action, not just Deploy.
assert.match(interactions, /if \(DELIVERY_ACTIONS\.has\(customId\)\)[\s\S]*?getReadinessReport\(interaction\)/);

// Modern delivery must not bypass the canonical payload builder with the old
// prepareEmbedMedia path. Legacy compatibility is intentionally excluded here.
const modernPrepareCalls = (modern.match(/prepareEmbedMedia\s*\(/g) || []).length;
assert.equal(modernPrepareCalls, 0, 'Modern Embed Studio delivery bypasses canonical buildPayload');

// The preview and delivery renderer must both retain explicit Graphic Header
// placement semantics.
assert.match(panel, /buildStudioPreviewEmbeds/);
assert.match(panel, /placement\s*===\s*['"]above['"]/);
assert.match(renderer, /placement\s*===\s*['"]above['"]/);

// Deploy must persist the message identity and Update Existing must consume it.
assert.match(modern, /saveEmbedDeployment\([\s\S]*?channelId:\s*channel\.id[\s\S]*?messageId:\s*sent\.id/);
assert.match(modern, /getEmbedDeployment\(i\.guild\.id, getDeploymentKeyFromState\(state\)\)/);
assert.match(modern, /channel\.messages\.fetch\(deployment\.messageId\)/);
assert.match(modern, /message\.edit\(payload\)/);

// Deploy also snapshots the canonical state as the active preset so a later
// restart/reopen can reconstruct the same Embed Studio document.
assert.match(modern, /guildManager\.saveEmbedPreset\(i\.guild\.id, presetName, panel\.presetData\(state\), i\.guild\)/);
assert.match(modern, /setGuildPresetDefault\(i\.guild\.id, state\.template, presetName, i\.guild\)/);

console.log('✅ Embed Studio delivery lifecycle parity audit passed.');
