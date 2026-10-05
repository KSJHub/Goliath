'use strict';

const fs = require('node:fs');
const path = require('node:path');

const roots = ['src', 'scripts', 'test'];
const extensions = new Set(['.js', '.jsx', '.cjs', '.mjs', '.json', '.md', '.txt']);
const versionPattern = new RegExp('(?:^|[^A-Za-z0-9])([vV][2-9][0-9]*)(?=$|[^A-Za-z0-9])|([A-Za-z_$][A-Za-z0-9_$]*[vV][2-9][0-9]*)', 'g');
const filenameVersionPattern = /(?:^|[._-])[vV][2-9][0-9]*(?=$|[._-])|[A-Za-z0-9_$][vV][2-9][0-9]*(?=\.|$)/;
const failures = [];

function externalProtocolLine(line) {
  const value = String(line || '');
  return value.includes('api.deepl.com/')
    || value.includes('api-free.deepl.com/')
    || value.includes('translation.googleapis.com/')
    || value.includes('googleapis.com/youtube/')
    || value.includes('graph.facebook.com/')
    || /\bIP[vV][46]\b/.test(value)
    || /\bIpv[46]\b/.test(value);
}

function generatedDependencyLine(target, line) {
  if (path.basename(target) !== 'package-lock.json') return false;
  const value = String(line || '').trim();
  return value.startsWith('"integrity":') || value.startsWith('"resolved":');
}

function inspectFilename(target) {
  const relative = path.relative(process.cwd(), target);
  for (const segment of relative.split(path.sep)) {
    if (filenameVersionPattern.test(segment)) {
      failures.push(`${relative}: internal version-suffixed file or directory name`);
      return;
    }
  }
}

function walk(target) {
  if (!fs.existsSync(target)) return;
  const stat = fs.statSync(target);
  inspectFilename(target);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(target)) {
      if (['node_modules', 'dist', '.git'].includes(entry)) continue;
      walk(path.join(target, entry));
    }
    return;
  }
  if (!extensions.has(path.extname(target).toLowerCase())) return;
  const lines = fs.readFileSync(target, 'utf8').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    versionPattern.lastIndex = 0;
    if (!versionPattern.test(line)) continue;
    if (externalProtocolLine(line) || generatedDependencyLine(target, line)) continue;
    failures.push(`${target}:${index + 1}: ${line.trim().slice(0, 220)}`);
  }
}

for (const root of roots) walk(root);

if (failures.length) {
  console.error('❌ Internal version-suffixed Goliath naming detected:');
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log('✅ Internal Goliath naming audit passed.');
