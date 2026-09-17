'use strict';

const fs = require('fs');
const path = require('path');
const { Events } = require('discord.js');
const maintenanceStatus = require('../../owner/dev/maintenanceStatus');
const auditRouter = require('../../owner/auditIntelligence/auditRouter');
const auditStore = require('../../owner/auditIntelligence/auditStore');
const { PROJECT_ROOT } = require('../../config/runtimePaths');

let processHandlersWired = false;
let relayTimer = null;
let relayBusy = false;
const RELAY_INTERVAL_MS = 1500;
const RELAY_BATCH_LIMIT = 250;
const SHARED_ROOT = path.dirname(PROJECT_ROOT);
const RELAY_CURSOR_FILE = path.join(auditStore.getRoot(), 'command-center-relay-cursors.json');

function runtimeMode() { const mode = String(auditStore.runtimeMode?.() || process.env.BOT_MODE || 'DEV').toUpperCase(); return mode === 'PROD' ? 'PRODUCTION' : mode; }
function guildLabel(guild) { return `${guild?.name || 'Unknown Guild'} (${guild?.id || 'unknown'})`; }
function logShutdownNoticePolicy(client, signal) {
  const kind = 'restart';
  let permitted = 0; let suppressed = 0;
  for (const guild of client?.guilds?.cache?.values?.() || []) {
    const settings = maintenanceStatus.noticeSettings?.(guild.id) || {};
    const allowed = maintenanceStatus.noticeAllowed?.(guild.id, kind) !== false;
    if (allowed) permitted += 1; else suppressed += 1;
    const reason = settings.paused ? 'Operational Notices paused' : settings.restart === false ? 'Restart notices disabled' : 'Restart notices enabled';
    console.log(`[MaintenanceStatus] ${guildLabel(guild)} • RESTART → ${allowed ? 'PERMITTED' : 'SUPPRESSED'} • ${reason} • ${runtimeMode()} • ${signal}`);
  }
  console.log(`[MaintenanceStatus] Shutdown notice policy: ${permitted} permitted • ${suppressed} suppressed • ${permitted + suppressed} local guild(s) • ${runtimeMode()}.`);
}
function logRecoveryResults(client, results) {
  let sent = 0; let suppressed = 0; let none = 0; let failed = 0;
  for (const result of results || []) {
    const guild = client?.guilds?.cache?.get?.(String(result?.guildId || ''));
    if (!result?.ok) {
      failed += 1;
      console.warn(`[MaintenanceStatus] ${guildLabel(guild || { id: result?.guildId })} • RECOVERY → FAILED • ${result?.error || result?.reason || 'unknown error'} • ${runtimeMode()}`);
    } else if (result?.skipped) {
      suppressed += 1;
      console.log(`[MaintenanceStatus] ${guildLabel(guild || { id: result?.guildId })} • RECOVERY → SUPPRESSED • Recovery notices disabled/paused • ${runtimeMode()}`);
    } else if (result?.found) {
      sent += 1;
      console.log(`[MaintenanceStatus] ${guildLabel(guild || { id: result?.guildId })} • RECOVERY → SENT • channel ${result?.channelId || 'unknown'} • ${runtimeMode()}`);
    } else {
      none += 1;
      console.log(`[MaintenanceStatus] ${guildLabel(guild || { id: result?.guildId })} • RECOVERY → NOT NEEDED • no maintenance channel • ${runtimeMode()}`);
    }
  }
  console.log(`[MaintenanceStatus] Startup recovery summary: ${sent} sent • ${suppressed} suppressed • ${none} not needed • ${failed} failed • ${runtimeMode()}.`);
  return { sent, suppressed, none, failed };
}
function remoteAuditRoots() {
  if (runtimeMode() !== 'DEV') return [];
  return [
    { mode: 'BETA', root: path.join(SHARED_ROOT, 'beta', 'src', 'runtime', 'beta', 'data', 'audit') },
    { mode: 'PRODUCTION', root: path.join(SHARED_ROOT, 'production', 'src', 'runtime', 'production', 'data', 'audit') },
  ].filter((item) => fs.existsSync(path.join(item.root, 'events')));
}
function readJson(file, fallback = {}) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJsonAtomic(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); const temp = `${file}.${process.pid}.tmp`; fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); fs.renameSync(temp, file); }
function eventFiles(root) {
  const eventsRoot = path.join(root, 'events'); if (!fs.existsSync(eventsRoot)) return [];
  const files = [];
  for (const guildId of fs.readdirSync(eventsRoot)) {
    const guildDir = path.join(eventsRoot, guildId); try { if (!fs.statSync(guildDir).isDirectory()) continue; } catch { continue; }
    for (const name of fs.readdirSync(guildDir).filter((entry) => /^\d{4}-\d{2}\.jsonl$/.test(entry)).sort()) files.push({ guildId, file: path.join(guildDir, name) });
  }
  return files;
}
function cursorKey(mode, file) { return `${mode}:${path.relative(SHARED_ROOT, file).replace(/\\/g, '/')}`; }
function readNewLines(file, offset) {
  const stat = fs.statSync(file); const safeOffset = Math.max(0, Math.min(Number(offset || 0), stat.size)); if (safeOffset >= stat.size) return { lines: [], nextOffset: stat.size };
  const length = stat.size - safeOffset; const buffer = Buffer.alloc(length); const fd = fs.openSync(file, 'r'); try { fs.readSync(fd, buffer, 0, length, safeOffset); } finally { fs.closeSync(fd); }
  const text = buffer.toString('utf8'); const lastNewline = text.lastIndexOf('\n'); if (lastNewline < 0) return { lines: [], nextOffset: safeOffset };
  const complete = text.slice(0, lastNewline + 1); return { lines: complete.split(/\r?\n/).filter(Boolean), nextOffset: safeOffset + Buffer.byteLength(complete, 'utf8') };
}
function registryGuild(guildId, event) {
  const known = (auditStore.getGuildRegistry?.() || []).find((item) => String(item?.guildId || '') === String(guildId));
  return { id: String(guildId), name: event?.guildName || known?.name || String(guildId), ownerId: known?.ownerId || null, memberCount: known?.memberCount ?? null };
}
async function relayRemoteAuditEvents(client) {
  if (runtimeMode() !== 'DEV' || relayBusy) return; relayBusy = true;
  try {
    const cursors = readJson(RELAY_CURSOR_FILE, { version: 1, files: {} }); cursors.files ||= {}; let delivered = 0;
    for (const source of remoteAuditRoots()) {
      for (const item of eventFiles(source.root)) {
        if (delivered >= RELAY_BATCH_LIMIT) break;
        const key = cursorKey(source.mode, item.file); const existing = cursors.files[key];
        if (!existing) { cursors.files[key] = { offset: fs.statSync(item.file).size, mode: source.mode, guildId: item.guildId, updatedAt: new Date().toISOString() }; continue; }
        const chunk = readNewLines(item.file, existing.offset);
        for (const line of chunk.lines) {
          if (delivered >= RELAY_BATCH_LIMIT) break; let event; try { event = JSON.parse(line); } catch { continue; }
          if (!event?.guildId || String(event.guildId) === String(auditRouter.getOwnerAuditGuildId?.() || '')) continue;
          event.metadata = { ...(event.metadata || {}), collectorEnvironment: source.mode, relayedToCommandCenter: true };
          await auditRouter.deliver(client, registryGuild(event.guildId, event), event).catch((error) => console.warn(`[Audit Relay] ${source.mode} -> DEV delivery failed for ${event.guildId}:`, error?.message || error)); delivered += 1;
        }
        if (delivered < RELAY_BATCH_LIMIT || chunk.lines.length === 0) existing.offset = chunk.nextOffset;
        existing.mode = source.mode; existing.guildId = item.guildId; existing.updatedAt = new Date().toISOString();
      }
      if (delivered >= RELAY_BATCH_LIMIT) break;
    }
    writeJsonAtomic(RELAY_CURSOR_FILE, cursors); if (delivered) console.log(`[Audit Relay] Mirrored ${delivered} BETA/PRODUCTION event(s) into the DEV Command Center.`);
  } catch (error) { console.warn('[Audit Relay] Cross-environment relay pass failed:', error?.stack || error?.message || error); } finally { relayBusy = false; }
}
function startAuditRelay(client) {
  if (runtimeMode() !== 'DEV' || relayTimer) return; void relayRemoteAuditEvents(client); relayTimer = setInterval(() => { void relayRemoteAuditEvents(client); }, RELAY_INTERVAL_MS); relayTimer.unref?.();
  console.log('[Audit Relay] DEV Command Center cross-environment relay active for BETA + PRODUCTION.');
}
function wireGuildControlsFirst(client) {
  if (runtimeMode() !== 'DEV') return;
  client.prependListener('interactionCreate', (interaction) => {
    const id = String(interaction?.customId || ''); if (!id.startsWith('owner:commandcenter:')) return;
    if (!id.startsWith('owner:commandcenter:guildcontrols:')) {
      const timer = setTimeout(() => { maintenanceStatus.ensureCommandCenterControls?.(client).catch((error) => console.warn('[CommandCenter Guild Controls] Could not restore home entry:', error?.message || error)); }, 350); timer.unref?.(); return;
    }
    const task = maintenanceStatus.handleControlInteraction(client, interaction); try { interaction.customId = `owner:guildcontrols:handled:${interaction.id}`; } catch {}
    Promise.resolve(task).catch((error) => console.warn('[CommandCenter Guild Controls]', error?.stack || error?.message || error));
  });
}

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    if (!processHandlersWired) {
      maintenanceStatus.wireProcessHandlers(client);
      // Decision observer: logs the exact per-guild policy that the shutdown sender uses.
      // Registered after the sender so it cannot alter or intercept shutdown behavior.
      process.once('SIGTERM', () => logShutdownNoticePolicy(client, 'SIGTERM'));
      process.once('SIGINT', () => logShutdownNoticePolicy(client, 'SIGINT'));
      wireGuildControlsFirst(client);
      processHandlersWired = true;
    }
    auditStore.publishGuildRegistry?.(client);
    startAuditRelay(client);
    const results = await maintenanceStatus.recoverAll(client).catch((error) => { console.warn('[MaintenanceStatus] Startup recovery pass failed:', error?.stack || error?.message || error); return []; });
    await maintenanceStatus.ensureCommandCenterControls?.(client).catch((error) => console.warn('[MaintenanceStatus] Command Center controls bootstrap failed:', error?.message || error));
    const summary = logRecoveryResults(client, results);
    if (summary.sent) console.log(`[MaintenanceStatus] Restored ${summary.sent} maintenance channel(s); cleanup scheduled in 5 minutes.`);
  },
};
