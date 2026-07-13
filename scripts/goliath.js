'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const mode = process.env.BOT_MODE || 'dev';
const COMMAND_NAME_REGEX = /^[a-z0-9_-]{1,32}$/;
const SOURCE_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs'];
const IMPORT_TIMEOUT_MS = Number(process.env.GOLIATH_IMPORT_AUDIT_TIMEOUT_MS || 15000);
const SLOW_IMPORT_MS = Number(process.env.GOLIATH_IMPORT_AUDIT_SLOW_MS || 3000);

function rel(file) {
  return path.relative(root, file).replace(/\\/g, '/');
}

function absolute(file) {
  return path.join(root, file);
}

function exists(file) {
  return fs.existsSync(absolute(file));
}

function section(title) {
  console.log(`\n${title}`);
  console.log('='.repeat(title.length));
}

function walk(dir, extensions = ['.js']) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git'].includes(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(fullPath, extensions));
    else if (entry.isFile() && extensions.includes(path.extname(entry.name))) files.push(fullPath);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function checkProjectShape() {
  section('Project shape');
  const expected = ['server.js', 'package.json', 'src/commands', 'src/core', 'src/dashboard', 'src/events', 'src/modules', 'src/runtime', 'src/server'];
  const missing = expected.filter((item) => !exists(item));
  for (const item of expected) console.log(`${missing.includes(item) ? '❌' : '✅'} ${item}`);
  return missing.length === 0;
}

function validateCommandOption(option, filePath, errors, parent = '') {
  const label = parent ? `${parent}.${option?.name || 'unknown'}` : option?.name || 'unknown';
  if (!option || typeof option !== 'object') {
    errors.push(`${rel(filePath)}: option is not an object`);
    return;
  }
  if (!option.name || typeof option.name !== 'string') errors.push(`${rel(filePath)}: option ${label} missing name`);
  else if (!COMMAND_NAME_REGEX.test(option.name)) errors.push(`${rel(filePath)}: invalid option name ${label}`);
  if (!option.description || typeof option.description !== 'string') errors.push(`${rel(filePath)}: option ${label} missing description`);
  else if (option.description.length > 100) errors.push(`${rel(filePath)}: option ${label} description too long (${option.description.length}/100)`);
  if (Array.isArray(option.options)) {
    const names = new Set();
    for (const child of option.options) {
      if (child?.name && names.has(child.name)) errors.push(`${rel(filePath)}: duplicate nested option name ${label}.${child.name}`);
      if (child?.name) names.add(child.name);
      validateCommandOption(child, filePath, errors, label);
    }
  }
}

function validateCommandPayload(payload, filePath, errors) {
  if (!payload || typeof payload !== 'object') {
    errors.push(`${rel(filePath)}: command payload is not an object`);
    return;
  }
  if (!payload.name || typeof payload.name !== 'string') errors.push(`${rel(filePath)}: missing command name`);
  else if (!COMMAND_NAME_REGEX.test(payload.name)) errors.push(`${rel(filePath)}: invalid command name ${payload.name}`);
  if (!payload.description || typeof payload.description !== 'string') errors.push(`${rel(filePath)}: missing command description`);
  else if (payload.description.length > 100) errors.push(`${rel(filePath)}: command description too long (${payload.description.length}/100)`);
  if (Array.isArray(payload.options)) {
    const names = new Set();
    for (const option of payload.options) {
      if (option?.name && names.has(option.name)) errors.push(`${rel(filePath)}: duplicate option/subcommand name ${option.name}`);
      if (option?.name) names.add(option.name);
      validateCommandOption(option, filePath, errors);
    }
  }
}

function auditCommands() {
  section('Command audit');
  const files = walk(absolute('src/commands'));
  const names = new Map();
  const errors = [];
  let valid = 0;
  if (!files.length) {
    console.log('❌ No command files found.');
    return false;
  }
  for (const file of files) {
    try {
      delete require.cache[require.resolve(file)];
      const commandModule = require(file);
      if (!commandModule?.data) errors.push(`${rel(file)}: missing data export`);
      else if (typeof commandModule.execute !== 'function') errors.push(`${rel(file)}: missing execute function`);
      else if (typeof commandModule.data.toJSON !== 'function') errors.push(`${rel(file)}: data export does not support toJSON()`);
      else {
        const payload = commandModule.data.toJSON();
        validateCommandPayload(payload, file, errors);
        if (payload?.name) {
          if (names.has(payload.name)) errors.push(`${rel(file)}: duplicate command name /${payload.name}`);
          else names.set(payload.name, file);
        }
        console.log(`✅ /${payload?.name || path.basename(file, '.js')}`);
        valid += 1;
      }
    } catch (error) {
      errors.push(`${rel(file)}: failed to load - ${error.message}`);
      console.log(`❌ ${rel(file)}`);
    }
  }
  console.log(`\nCommand files scanned: ${files.length}`);
  console.log(`Commands loadable: ${valid}`);
  if (errors.length) {
    console.log(`Command issues: ${errors.length}`);
    for (const error of errors) console.log(` - ${error}`);
    return false;
  }
  console.log('✅ Command audit passed.');
  return true;
}

function checkFile(file, exportNames = [], errors = []) {
  const fullPath = absolute(file);
  if (!fs.existsSync(fullPath)) {
    errors.push(`${file}: missing file`);
    console.log(`❌ ${file}`);
    return;
  }
  if (!exportNames.length || !file.endsWith('.js')) {
    console.log(`✅ ${file}`);
    return;
  }
  try {
    delete require.cache[require.resolve(fullPath)];
    const loaded = require(fullPath);
    const missing = exportNames.filter((name) => loaded?.[name] === undefined);
    if (missing.length) errors.push(`${file}: missing export(s) ${missing.join(', ')}`);
    console.log(`${missing.length ? '❌' : '✅'} ${file}`);
  } catch (error) {
    errors.push(`${file}: failed to load - ${error.message}`);
    console.log(`❌ ${file}`);
  }
}

const MODULE_FILES = [
  ['src/modules/verification/verificationStore.js', ['defaultVerificationSection', 'normalizeVerificationSection', 'getVerificationSection']],
  ['src/modules/verification/verificationManager.js', ['buildVerificationEmbed', 'buildVerificationRows', 'handleVerificationInteraction']],
  ['src/modules/verification/verificationStartup.js', ['startupVerification']],
  ['src/core/admin/functions/verificationAdminPanel.js', ['buildVerificationAdminPanel', 'handleVerificationAdminInteraction']],
  ['src/server/routes/verification.js'],
  ['src/dashboard/js/pages/modules/VerificationEnhanced.jsx'],
  ['src/modules/autoRoles/autoRoleStore.js', ['defaultAutoRolesSection', 'normalizeAutoRolesSection', 'getAutoRolesSection']],
  ['src/modules/autoRoles/autoRoleManager.js', ['applyAutoRoles', 'buildHealthReport', 'exportConfiguration']],
  ['src/modules/autoRoles/autoRoleStartup.js', ['startupAutoRoles']],
  ['src/core/admin/functions/autoRolesAdminPanel.js', ['buildAutoRolesAdminPanel', 'handleAutoRolesAdminInteraction']],
  ['src/server/routes/autoRoles.js'],
  ['src/dashboard/js/pages/modules/AutoRoles.jsx'],
  ['docs/modules/auto-roles.md'],
  ['src/modules/welcome/welcomeStore.js', ['defaultWelcomeSection', 'normalizeWelcomeSection', 'getWelcomeSection']],
  ['src/modules/welcome/welcomeManager.js', ['buildTemplateVariables', 'sendWelcome', 'buildHealthReport']],
  ['src/modules/welcome/welcomeStartup.js', ['startupWelcome']],
  ['src/core/admin/functions/welcomeAdminPanel.js', ['buildWelcomeAdminPanel', 'handleWelcomeAdminInteraction']],
  ['src/server/routes/welcome.js'],
  ['src/dashboard/js/pages/modules/Welcome.jsx'],
  ['docs/modules/welcome.md'],
  ['src/modules/goodbye/goodbyeStore.js', ['defaultGoodbyeSection', 'normalizeGoodbyeSection', 'getGoodbyeSection']],
  ['src/modules/goodbye/goodbyeManager.js', ['buildTemplateVariables', 'sendGoodbye', 'buildHealthReport']],
  ['src/modules/goodbye/goodbyeStartup.js', ['startupGoodbye']],
  ['src/core/admin/functions/goodbyeAdminPanel.js', ['buildGoodbyeAdminPanel', 'handleGoodbyeAdminInteraction']],
  ['src/server/routes/goodbye.js'],
  ['src/dashboard/js/pages/modules/Goodbye.jsx'],
  ['docs/modules/goodbye.md'],
];

function auditModules() {
  section('Module audit');
  const errors = [];
  for (const [file, exports = []] of MODULE_FILES) checkFile(file, exports, errors);
  if (errors.length) {
    console.log(`Module issues: ${errors.length}`);
    for (const error of errors) console.log(` - ${error}`);
    return false;
  }
  console.log('✅ Module audit passed.');
  return true;
}

function normalise(value) {
  return path.normalize(value).replace(/\\/g, '/');
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function extractRelativeImports(source) {
  const imports = new Set();
  const patterns = [
    /import\s+(?:[^'";]+?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/g,
    /import\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g,
    /require\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g,
    /export\s+(?:[^'";]+?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) imports.add(match[1]);
  }
  return [...imports];
}

function resolveImport(fromFile, request) {
  const base = path.resolve(path.dirname(fromFile), request);
  const candidates = [];
  if (SOURCE_EXTENSIONS.includes(path.extname(base))) candidates.push(base);
  else {
    for (const extension of SOURCE_EXTENSIONS) candidates.push(base + extension);
    for (const extension of SOURCE_EXTENSIONS) candidates.push(path.join(base, `index${extension}`));
  }
  return candidates.map(normalise).find((candidate) => fs.existsSync(candidate)) || null;
}

function auditDashboardFiles() {
  section('Dashboard file audit');
  const dashboardRoot = absolute('src/dashboard/js');
  const files = walk(dashboardRoot, SOURCE_EXTENSIONS).map(normalise);
  const fileSet = new Set(files);
  const inbound = new Map(files.map((file) => [file, new Set()]));
  const entryFiles = new Set([
    normalise(path.join(dashboardRoot, 'main.jsx')),
    normalise(path.join(dashboardRoot, 'App.jsx')),
    normalise(path.join(dashboardRoot, 'ui', 'layout.js')),
  ]);
  const broken = [];
  for (const file of files) {
    for (const request of extractRelativeImports(read(file))) {
      const resolved = resolveImport(file, request);
      if (!resolved) broken.push({ from: file, request });
      else if (fileSet.has(resolved)) inbound.get(resolved)?.add(file);
    }
  }
  const orphanCandidates = files.filter((file) => !entryFiles.has(file)).filter((file) => (inbound.get(file)?.size || 0) === 0).map(rel).sort();
  console.log(`Scanned files: ${files.length}`);
  console.log(`Broken relative imports: ${broken.length}`);
  console.log(`Orphan candidates: ${orphanCandidates.length}`);
  if (broken.length) {
    console.log('\nBroken imports:');
    for (const item of broken) console.log(`- ${rel(item.from)} -> ${item.request}`);
  }
  if (orphanCandidates.length) {
    console.log('\nOrphan candidates, verify before deleting:');
    for (const file of orphanCandidates) console.log(`- ${file}`);
  }
  return broken.length === 0;
}

function auditDashboardRoutes() {
  section('Dashboard route audit');
  const layoutPath = absolute('src/dashboard/js/ui/layout.js');
  const registryPath = absolute('src/dashboard/js/shared/moduleRegistry.js');
  if (!fs.existsSync(layoutPath) || !fs.existsSync(registryPath)) {
    console.log('❌ Missing dashboard layout or module registry.');
    return false;
  }
  const routes = new Set([...read(layoutPath).matchAll(/path:\s*['"]([^'"]+)['"]/g)].map((match) => match[1]));
  const modules = [...read(registryPath).matchAll(/\{[\s\S]*?key:\s*['"]([^'"]+)['"][\s\S]*?name:\s*['"]([^'"]+)['"][\s\S]*?route:\s*['"]([^'"]+)['"][\s\S]*?\}/g)]
    .map((match) => ({ key: match[1], name: match[2], route: match[3] }));
  const broken = modules.filter((module) => !routes.has(module.route));
  console.log(`Routes found: ${routes.size}`);
  console.log(`Module registry entries: ${modules.length}`);
  console.log(`Broken module routes: ${broken.length}`);
  for (const module of broken) console.log(`- ${module.name} (${module.key}) -> ${module.route}`);
  return broken.length === 0;
}

function collectRuntimeTargets() {
  const directories = [absolute('src/events'), absolute('src/core/admin/functions'), absolute('src/server/routes')];
  const explicit = [
    'src/modules/autoRoles/autoRoleStartup.js',
    'src/modules/welcome/welcomeStartup.js',
    'src/modules/goodbye/goodbyeStartup.js',
    'src/modules/tickets/ticketStartup.js',
    'src/modules/translation/translationStartup.js',
    'src/modules/verification/verificationStartup.js',
    'src/modules/roles/rolesStartup.js',
    'src/modules/giveaways/giveawayScheduler.js',
  ].map(absolute).filter(fs.existsSync);
  return [...new Set([...directories.flatMap((dir) => walk(dir)), ...explicit])].sort((a, b) => a.localeCompare(b));
}

function auditRuntimeImports() {
  section('Runtime import audit');
  const files = collectRuntimeTargets();
  const errors = [];
  const slow = [];
  let loaded = 0;
  const code = "const file=process.argv[1];try{require(file);process.exit(0)}catch(error){console.error(error?.stack||error?.message||error);process.exit(1)}";
  for (const file of files) {
    process.stdout.write(`Checking ${rel(file)}... `);
    const startedAt = Date.now();
    const result = spawnSync(process.execPath, ['-e', code, file], {
      cwd: root,
      encoding: 'utf8',
      timeout: IMPORT_TIMEOUT_MS,
      windowsHide: true,
      env: { ...process.env, GOLIATH_IMPORT_AUDIT: 'true' },
    });
    const duration = Date.now() - startedAt;
    if (result.error?.code === 'ETIMEDOUT' || result.signal === 'SIGTERM') {
      console.log('❌');
      errors.push(`${rel(file)}: import exceeded ${IMPORT_TIMEOUT_MS}ms`);
    } else if (result.status !== 0) {
      console.log('❌');
      errors.push(`${rel(file)}: ${String(result.stderr || result.stdout || 'Unknown import failure').trim().split('\n').slice(0, 8).join('\n')}`);
    } else {
      console.log(duration >= SLOW_IMPORT_MS ? `⚠️ ${duration}ms` : `✅ ${duration}ms`);
      loaded += 1;
      if (duration >= SLOW_IMPORT_MS) slow.push(`${rel(file)}: ${duration}ms`);
    }
  }
  console.log(`\nRuntime files scanned: ${files.length}`);
  console.log(`Runtime files loadable: ${loaded}`);
  if (slow.length) {
    console.log(`Slow runtime imports: ${slow.length}`);
    for (const item of slow) console.log(` - ${item}`);
  }
  if (errors.length) {
    console.log(`Runtime import issues: ${errors.length}`);
    for (const error of errors) console.log(` - ${error}`);
    return false;
  }
  console.log('✅ Runtime import audit passed.');
  return true;
}

function auditModuleStandard() {
  section('Module standard audit');
  const { MODULE_MATURITY, REQUIRED_CAPABILITIES, getMissingCapabilities, isModuleComplete } = require('../src/core/modules/moduleStandard');
  const { moduleManifest } = require('../src/core/modules/moduleManifest');
  const modules = Object.values(moduleManifest);
  const errors = [];
  const active = modules.filter((definition) => definition.maturity === MODULE_MATURITY.IN_PROGRESS);
  if (active.length > 1) errors.push(`Only one module may be in progress; found ${active.map((item) => item.name).join(', ')}.`);
  for (const definition of modules.sort((a, b) => a.name.localeCompare(b.name))) {
    const missing = getMissingCapabilities(definition);
    const complete = isModuleComplete(definition);
    if (definition.maturity === MODULE_MATURITY.COMPLETE && !complete) errors.push(`${definition.name} is marked complete but is missing: ${missing.join(', ')}.`);
    for (const capability of REQUIRED_CAPABILITIES) {
      if (typeof definition.capabilities?.[capability] !== 'boolean') errors.push(`${definition.name}.${capability} must be boolean.`);
    }
    const marker = complete ? '🟢' : definition.maturity === MODULE_MATURITY.IN_PROGRESS ? '🟡' : '⚪';
    console.log(`${marker} ${definition.name} — ${definition.maturity}${missing.length ? ` (${missing.length} capability gaps)` : ''}`);
  }
  console.log(`\nModules tracked: ${modules.length}`);
  console.log(`Complete: ${modules.filter(isModuleComplete).length}`);
  console.log(`In progress: ${active.length}`);
  console.log(`Not started: ${modules.filter((item) => item.maturity === MODULE_MATURITY.NOT_STARTED).length}`);
  if (errors.length) {
    console.log(`Module standard issues: ${errors.length}`);
    for (const error of errors) console.log(` - ${error}`);
    return false;
  }
  console.log('✅ Module standard audit passed.');
  return true;
}

function inspectRuntime() {
  section('Runtime');
  const modeRoot = absolute(`src/runtime/${mode}`);
  const folders = ['guilds', 'logs', 'database', 'data', 'backups'];
  console.log(`BOT_MODE: ${mode}`);
  console.log(`Runtime path: ${rel(modeRoot)}`);
  if (!fs.existsSync(modeRoot)) {
    console.log('❌ Runtime mode folder missing.');
    return false;
  }
  for (const folder of folders) {
    const fullPath = path.join(modeRoot, folder);
    const count = fs.existsSync(fullPath) ? fs.readdirSync(fullPath).length : 0;
    console.log(`${fs.existsSync(fullPath) ? '✅' : '⚠️'} ${rel(fullPath)} (${count})`);
  }
  return true;
}

function inspectGuilds() {
  section('Guild configs');
  const guildsDir = absolute(`src/runtime/${mode}/guilds`);
  if (!fs.existsSync(guildsDir)) {
    console.log(`❌ Missing ${rel(guildsDir)}`);
    return false;
  }
  const files = fs.readdirSync(guildsDir).filter((file) => file.endsWith('.json')).sort();
  console.log(`Found guild config files: ${files.length}`);
  for (const file of files) console.log(`- ${file}`);
  return true;
}

function checkMediaDependencies() {
  section('Media dependencies');
  const ffmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  let sharp = true;
  try { require.resolve('sharp'); } catch { sharp = false; }
  console.log(`FFmpeg: ${ffmpeg.status === 0 ? '✅ available' : '❌ missing'}`);
  console.log(`Sharp:   ${sharp ? '✅ available' : '❌ missing'}`);
  return ffmpeg.status === 0 && sharp;
}

function runDashboard() {
  return [auditDashboardFiles(), auditDashboardRoutes()].every(Boolean);
}

function runCheck() {
  const results = [
    checkProjectShape(),
    auditCommands(),
    auditModules(),
    runDashboard(),
    auditRuntimeImports(),
    auditModuleStandard(),
    inspectRuntime(),
  ];
  const ok = results.every(Boolean);
  if (!ok) process.exitCode = 1;
  return ok;
}

function runAudit() {
  const ok = [runCheck(), inspectGuilds()].every(Boolean);
  if (!ok) process.exitCode = 1;
  return ok;
}

function printHelp() {
  console.log('Goliath CLI');
  console.log('===========');
  console.log(`Mode: ${mode}`);
  console.log('');
  console.log('Commands:');
  console.log('  check             Run the complete Doctor check');
  console.log('  audit             Run Doctor plus guild inspection');
  console.log('  commands          Check slash command files');
  console.log('  modules           Check completed module files and exports');
  console.log('  dashboard         Check dashboard imports and routes');
  console.log('  runtime           Inspect runtime folders');
  console.log('  imports           Check runtime imports');
  console.log('  standards         Check module completion standards');
  console.log('  guilds            List runtime guild configuration files');
  console.log('  media             Check FFmpeg and Sharp');
}

const command = process.argv[2] || 'help';
const commands = {
  help: printHelp,
  check: runCheck,
  audit: runAudit,
  commands: auditCommands,
  modules: auditModules,
  dashboard: runDashboard,
  runtime: inspectRuntime,
  imports: auditRuntimeImports,
  standards: auditModuleStandard,
  guilds: inspectGuilds,
  media: checkMediaDependencies,
};

if (!commands[command]) {
  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}

const result = commands[command]();
if (result === false) process.exit(1);
