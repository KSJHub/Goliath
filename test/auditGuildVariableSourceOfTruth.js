'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const CENTRAL = path.normalize(path.join(SRC, 'core', 'guild', 'guildVariables.js'));
const EXTENSIONS = new Set(['.js', '.cjs', '.mjs']);

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (EXTENSIONS.has(path.extname(entry.name))) files.push(full);
  }
  return files;
}

function relative(file) {
  return path.relative(ROOT, file).replace(/\\/g, '/');
}

function stripsTokenBraces(line) {
  return /\.replace\(\s*\/\^\\\{\|\\\}\$\/g\s*,\s*['"]{0,1}['"]\s*\)/.test(line)
    || /\.replace\(\s*\/\^\\\{\|\\\}\$\/g\s*,\s*['"]['"]\s*\)/.test(line)
    || line.includes("replace(/^\\{|\\}$/g, '')")
    || line.includes('replace(/^\\{|\\}$/g, "")');
}

function isDelegatorFunction(lines, index) {
  const window = lines.slice(index, Math.min(lines.length, index + 5)).join('\n');
  return /guildVariables\.(?:replaceVars|replaceVariables|renderVerificationTemplate)\s*\(/.test(window)
    || /replaceVariables\s*\(/.test(window)
    || /buildVariableMap\s*\(/.test(window);
}

const findings = [];
const files = walk(SRC);

const checks = [
  {
    name: 'manual placeholder replaceAll renderer',
    regex: /\.replaceAll\(\s*([`'\"])(?:\\?\{|\$\{[^}]+\}[^`'\"]*\})/g,
  },
  {
    name: 'manual placeholder replace renderer',
    regex: /\.replace\(\s*\/[^\n/]*\\\{[^\n/]*\//g,
  },
  {
    name: 'local generic template renderer',
    regex: /function\s+(?:renderTemplate|renderVariables|replaceVars|replaceVariables)\s*\(/g,
  },
];

for (const file of files) {
  if (path.normalize(file) === CENTRAL) continue;
  const source = fs.readFileSync(file, 'utf8');
  const lines = source.split(/\r?\n/);
  for (const check of checks) {
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      check.regex.lastIndex = 0;
      if (!check.regex.test(line)) continue;

      // Converting canonical "{token}" map keys to bare "token" keys is not rendering.
      if (check.name === 'manual placeholder replace renderer' && stripsTokenBraces(line)) continue;

      // Thin module helpers are allowed when they delegate replacement to guildVariables.
      if (check.name === 'local generic template renderer' && isDelegatorFunction(lines, index)) continue;

      findings.push(`${relative(file)}:${index + 1} [${check.name}] ${line.trim()}`);
    }
  }
}

if (findings.length) {
  console.error('❌ Central Guild Variables source-of-truth audit failed.');
  console.error('Template/placeholder replacement must go through src/core/guild/guildVariables.js.');
  for (const finding of findings) console.error(` - ${finding}`);
  process.exit(1);
}

const guildVariables = fs.readFileSync(CENTRAL, 'utf8');
for (const exportName of ['buildVariableMap', 'replaceVars', 'replaceVariables', 'variablesForModule']) {
  assert(guildVariables.includes(exportName), `guildVariables.js must retain ${exportName}.`);
}

console.log(`✅ Central Guild Variables source-of-truth audit passed across ${files.length} source files.`);
