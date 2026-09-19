'use strict';

const fs = require('node:fs');
const path = require('node:path');

const files = [];

function walk(target) {
  if (!fs.existsSync(target)) return;
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(target)) {
      if (target === 'src' && entry === 'dashboard') continue;
      if (['node_modules', 'dist', '.git'].includes(entry)) continue;
      walk(path.join(target, entry));
    }
    return;
  }
  if (/\.(js|cjs|mjs)$/.test(target)) files.push(target);
}

walk('server.js');
walk('scripts');
walk('src');

const patterns = [
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\b(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g,
];

const missing = [];
for (const file of files.sort()) {
  const source = fs.readFileSync(file, 'utf8');
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      const spec = match[1];
      if (!spec.startsWith('.')) continue;
      try {
        require.resolve(path.resolve(path.dirname(file), spec));
      } catch {
        missing.push(`${file} -> ${spec}`);
      }
    }
  }
}

if (missing.length) {
  const unique = [...new Set(missing)];
  console.error(`❌ Missing relative imports: ${unique.length}`);
  for (const item of unique) console.error(` - ${item}`);
  process.exit(1);
}

console.log(`✅ Relative import audit: ${files.length} backend files`);
