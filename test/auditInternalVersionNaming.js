'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
]);

const SKIP_FILES = new Set([
  'package-lock.json',
]);

const TEXT_EXTENSIONS = new Set([
  '.js',
  '.cjs',
  '.mjs',
  '.jsx',
  '.ts',
  '.tsx',
  '.json',
  '.md',
  '.txt',
  '.yml',
  '.yaml',
  '.css',
  '.scss',
  '.html',
]);

/*
 * Goliath rule:
 *
 * Canonical Goliath features must not be named as numbered replacement
 * generations. We improve the existing implementation in place.
 *
 * Do not treat externally-defined technical terminology, dependency
 * versions, user data, runtime data, protocol names, architecture names,
 * SVG path instructions or generated package metadata as Goliath feature
 * generation naming.
 */

const forbiddenNamePattern = new RegExp(
  '(^|[._ -])' + 'v' + '[23]' + '([._ -]|$)',
  'i'
);

const forbiddenWrittenPattern = new RegExp(
  '\\b' + 'version\\s*[23]' + '\\b',
  'i'
);

const forbiddenComponentPattern = new RegExp(
  '\\b' + 'components?\\s*[-_ ]?v[23]' + '\\b',
  'i'
);

const forbiddenGenerationSuffix = new RegExp(
  '(?:[_-]' + 'v[23]' + ')\\b',
  'i'
);

const violations = [];

function shouldSkipPath(relativePath) {
  const normalized = relativePath.replace(/\\/g, '/');

  if (
    normalized.startsWith('src/runtime/') ||
    normalized.startsWith('.github/')
  ) {
    return true;
  }

  return false;
}

function checkName(relativePath) {
  const normalized = relativePath.replace(/\\/g, '/');

  for (const segment of normalized.split('/')) {
    if (
      forbiddenNamePattern.test(segment) ||
      forbiddenGenerationSuffix.test(segment)
    ) {
      violations.push(`${normalized}: forbidden numbered-generation name`);
      return;
    }
  }
}

function checkFile(filePath, relativePath) {
  if (SKIP_FILES.has(path.basename(filePath))) return;
  if (shouldSkipPath(relativePath)) return;

  const ext = path.extname(filePath).toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext)) return;

  let content;

  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return;
  }

  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    /*
     * Ignore the audit's own dynamically constructed detection rules.
     */
    if (relativePath === 'test/auditInternalVersionNaming.js') return;

    if (
      forbiddenWrittenPattern.test(line) ||
      forbiddenComponentPattern.test(line)
    ) {
      violations.push(
        `${relativePath}:${index + 1}: ${line.trim()}`
      );
    }
  });
}

function walk(currentPath) {
  const entries = fs.readdirSync(currentPath, {
    withFileTypes: true,
  });

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;

    const fullPath = path.join(currentPath, entry.name);
    const relativePath = path
      .relative(ROOT, fullPath)
      .replace(/\\/g, '/');

    if (shouldSkipPath(relativePath)) continue;

    if (entry.isDirectory()) {
      checkName(relativePath);
      walk(fullPath);
      continue;
    }

    checkName(relativePath);
    checkFile(fullPath, relativePath);
  }
}

walk(ROOT);

if (violations.length) {
  console.error(
    '\n❌ Internal numbered-generation Goliath naming detected:\n'
  );

  for (const violation of violations) {
    console.error(`  ${violation}`);
  }

  process.exit(1);
}

console.log(
  '✅ Internal Goliath naming audit passed: no numbered replacement-generation naming detected.'
);
