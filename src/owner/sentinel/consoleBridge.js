'use strict';

const crypto = require('node:crypto');

let installed = false;
let originalError = null;

function textOf(args) {
  return args.map((value) => {
    if (value instanceof Error) return value.stack || value.message;
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch { return String(value); }
  }).join(' ').slice(0, 5000);
}

function normalizedFingerprint(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/\b\d{15,25}\b/g, '<discord-id>')
    .replace(/\b\d+\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .slice(0, 1000);
}

function classify(text) {
  const lower = String(text || '').toLowerCase();
  if (lower.includes('[interactioncreate]')) return { module: 'interactions', component: 'interaction-dispatch', severity: 'error' };
  if (lower.includes('[filestore]') || lower.includes('failed to write file')) return { module: 'runtime', component: 'persistence', severity: 'critical' };
  if (lower.includes('[audit intelligence]') || lower.includes('auditintelligence') || lower.includes('auditevents')) return { module: 'auditIntelligence', component: 'audit-runtime', severity: 'error' };
  if (lower.includes('[autoroles]')) return { module: 'autoRoles', component: 'runtime', severity: 'error' };
  if (lower.includes('[verification]')) return { module: 'verification', component: 'runtime', severity: 'error' };
  if (lower.includes('[tickets]')) return { module: 'tickets', component: 'runtime', severity: 'error' };
  if (lower.includes('cors blocked origin')) return { module: 'dashboard', component: 'cors', severity: 'warning' };
  return { module: 'runtime', component: 'console-error', severity: 'error' };
}

function install(client, sentinel) {
  if (installed || !client || typeof sentinel?.report !== 'function') return false;
  installed = true;
  originalError = console.error.bind(console);
  console.error = (...args) => {
    originalError(...args);
    try {
      const text = textOf(args);
      if (!text || text.includes('Goliath Sentinel console bridge')) return;
      const fingerprint = normalizedFingerprint(text);
      const code = `console-${crypto.createHash('sha1').update(fingerprint).digest('hex').slice(0, 12)}`;
      const classification = classify(text);
      sentinel.report(client, {
        ...classification,
        code,
        message: text.split('\n')[0].slice(0, 1000),
        details: { fingerprint, error: text.slice(0, 3500) },
      }).catch(() => null);
    } catch {}
  };
  return true;
}

function uninstall() {
  if (!installed || !originalError) return false;
  console.error = originalError;
  originalError = null;
  installed = false;
  return true;
}

module.exports = { install, uninstall, classify, normalizedFingerprint };
