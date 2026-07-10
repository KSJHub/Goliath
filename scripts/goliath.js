'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const mode = process.env.BOT_MODE || 'dev';
const COMMAND_NAME_REGEX = /^[a-z0-9_-]{1,32}$/;

function rel(file) {
  return path.relative(root, file).replace(/\\/g, '/');
}

function exists(file) {
  return fs.existsSync(path.join(root, file));
}

function section(title) {
  console.log(`\n${title}`);
  console.log('='.repeat(title.length));
}

function getAllJsFiles(dir) {
  if (!fs.existsSync(dir)) return [];

  const files = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...getAllJsFiles(fullPath));
      continue;
    }

    if (
      entry.isFile() &&
      entry.name.endsWith('.js') &&
      !entry.name.endsWith('.test.js') &&
      !entry.name.endsWith('.spec.js')
    ) {
      files.push(fullPath);
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

function runNode(script, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });

  return result.status === 0;
}

function printHelp() {
  console.log('Goliath scripts CLI');
  console.log('===================');
  console.log(`Mode: ${mode}`);
  console.log('');
  console.log('Commands:');
  console.log('  check             Run safe local checks');
  console.log('  audit             Run all audits');
  console.log('  commands          Audit slash command files');
  console.log('  modules           Audit key module files/exports');
  console.log('  dashboard         Run dashboard file + route audits');
  console.log('  dashboard:files   Run dashboard file audit only');
  console.log('  dashboard:routes  Run dashboard route audit only');
  console.log('  runtime           Inspect runtime folders for current BOT_MODE');
  console.log('  guilds            List runtime guild config files for current BOT_MODE');
}

function checkProjectShape() {
  section('Project shape');

  const expected = [
    'server.js',
    'package.json',
    'src/commands',
    'src/core',
    'src/dashboard',
    'src/events',
    'src/modules',
    'src/runtime',
    'src/server',
  ];

  const missing = expected.filter((item) => !exists(item));

  for (const item of expected) {
    console.log(`${missing.includes(item) ? '❌' : '✅'} ${item}`);
  }

  return missing.length === 0;
}

function validateCommandOption(option, filePath, errors, parent = '') {
  const label = parent ? `${parent}.${option?.name || 'unknown'}` : option?.name || 'unknown';

  if (!option || typeof option !== 'object') {
    errors.push(`${rel(filePath)}: option is not an object`);
    return;
  }

  if (!option.name || typeof option.name !== 'string') {
    errors.push(`${rel(filePath)}: option ${label} missing name`);
  } else if (!COMMAND_NAME_REGEX.test(option.name)) {
    errors.push(`${rel(filePath)}: invalid option name ${label}`);
  }

  if (!option.description || typeof option.description !== 'string') {
    errors.push(`${rel(filePath)}: option ${label} missing description`);
  } else if (option.description.length > 100) {
    errors.push(`${rel(filePath)}: option ${label} description too long (${option.description.length}/100)`);
  }

  if (Array.isArray(option.options)) {
    const childNames = new Set();
    for (const child of option.options) {
      if (child?.name) {
        if (childNames.has(child.name)) errors.push(`${rel(filePath)}: duplicate nested option name ${label}.${child.name}`);
        childNames.add(child.name);
      }
      validateCommandOption(child, filePath, errors, label);
    }
  }
}

function validateCommandPayload(payload, filePath, errors) {
  if (!payload || typeof payload !== 'object') {
    errors.push(`${rel(filePath)}: command payload is not an object`);
    return;
  }

  if (!payload.name || typeof payload.name !== 'string') {
    errors.push(`${rel(filePath)}: missing command name`);
  } else if (!COMMAND_NAME_REGEX.test(payload.name)) {
    errors.push(`${rel(filePath)}: invalid command name ${payload.name}`);
  }

  if (!payload.description || typeof payload.description !== 'string') {
    errors.push(`${rel(filePath)}: missing command description`);
  } else if (payload.description.length > 100) {
    errors.push(`${rel(filePath)}: command description too long (${payload.description.length}/100)`);
  }

  if (Array.isArray(payload.options)) {
    const optionNames = new Set();
    for (const option of payload.options) {
      if (option?.name) {
        if (optionNames.has(option.name)) errors.push(`${rel(filePath)}: duplicate option/subcommand name ${option.name}`);
        optionNames.add(option.name);
      }
      validateCommandOption(option, filePath, errors);
    }
  }
}

function auditCommands() {
  section('Command audit');

  const commandsDir = path.join(root, 'src', 'commands');
  const files = getAllJsFiles(commandsDir);
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

      if (!commandModule?.data) {
        errors.push(`${rel(file)}: missing data export`);
        continue;
      }

      if (typeof commandModule.execute !== 'function') {
        errors.push(`${rel(file)}: missing execute function`);
        continue;
      }

      if (typeof commandModule.data.toJSON !== 'function') {
        errors.push(`${rel(file)}: data export does not support toJSON()`);
        continue;
      }

      const payload = commandModule.data.toJSON();
      validateCommandPayload(payload, file, errors);

      if (payload?.name) {
        if (names.has(payload.name)) {
          errors.push(`${rel(file)}: duplicate command name /${payload.name}; first seen in ${rel(names.get(payload.name))}`);
        } else {
          names.set(payload.name, file);
        }
      }

      console.log(`✅ /${payload?.name || path.basename(file, '.js')}`);
      valid += 1;
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

function requireExport(modulePath, exportNames, errors) {
  const absolute = path.join(root, modulePath);

  if (!fs.existsSync(absolute)) {
    errors.push(`${modulePath}: missing file`);
    console.log(`❌ ${modulePath}`);
    return;
  }

  try {
    delete require.cache[require.resolve(absolute)];
    const loaded = require(absolute);
    const missing = exportNames.filter((name) => loaded?.[name] === undefined);

    if (missing.length) {
      errors.push(`${modulePath}: missing export(s) ${missing.join(', ')}`);
      console.log(`❌ ${modulePath}`);
      return;
    }

    console.log(`✅ ${modulePath}`);
  } catch (error) {
    errors.push(`${modulePath}: failed to load - ${error.message}`);
    console.log(`❌ ${modulePath}`);
  }
}

function auditModules() {
  section('Module audit');

  const errors = [];

  requireExport('src/modules/verification/verificationStore.js', [
    'defaultVerificationSection',
    'defaultPanelTemplate',
    'normalizeVerificationSection',
    'getVerificationSection',
    'saveVerificationSection',
    'updateVerificationSection',
    'savePanel',
    'getPanel',
    'getLatestPanel',
    'deletePanel',
    'updatePanelTemplate',
    'incrementAnalytics',
  ], errors);

  requireExport('src/modules/verification/verificationManager.js', [
    'buildVerificationEmbed',
    'buildVerificationRows',
    'configureVerification',
    'setVerificationEnabled',
    'getVerificationStatus',
    'updatePanelTemplate',
    'deployVerificationPanel',
    'refreshVerificationPanel',
    'deleteVerificationPanel',
    'getPanelHealth',
    'buildHealthReport',
    'verifyMember',
    'handleVerificationInteraction',
  ], errors);

  requireExport('src/modules/verification/verificationStartup.js', [
    'startupVerification',
  ], errors);

  requireExport('src/server/routes/verification.js', [], errors);

  requireExport('src/core/admin/functions/verificationAdminPanel.js', [
    'buildVerificationAdminPanel',
    'handleVerificationAdminInteraction',
  ], errors);

  if (errors.length) {
    console.log(`Module issues: ${errors.length}`);
    for (const error of errors) console.log(` - ${error}`);
    return false;
  }

  console.log('✅ Module audit passed.');
  return true;
}

function inspectRuntime() {
  section('Runtime');

  const runtimeRoot = path.join(root, 'src', 'runtime');
  const modeRoot = path.join(runtimeRoot, mode);
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

  const guildsDir = path.join(root, 'src', 'runtime', mode, 'guilds');
  if (!fs.existsSync(guildsDir)) {
    console.log(`❌ Missing ${rel(guildsDir)}`);
    return false;
  }

  const files = fs.readdirSync(guildsDir).filter((file) => file.endsWith('.json')).sort();
  console.log(`Found guild config files: ${files.length}`);

  for (const file of files) {
    console.log(`- ${file}`);
  }

  return true;
}

function runDashboard(modeName = 'all') {
  return require('./dashboard-audit').run(modeName);
}

function runCheck() {
  const results = [];
  results.push(checkProjectShape());
  results.push(auditCommands());
  results.push(auditModules());
  results.push(runDashboard('all'));
  results.push(inspectRuntime());

  const ok = results.every(Boolean);
  if (!ok) process.exitCode = 1;
  return ok;
}

function runAudit() {
  const results = [];
  results.push(runCheck());
  results.push(inspectGuilds());

  const ok = results.every(Boolean);
  if (!ok) process.exitCode = 1;
  return ok;
}

const command = process.argv[2] || 'help';

const commands = {
  help: printHelp,
  check: runCheck,
  audit: runAudit,
  commands: auditCommands,
  modules: auditModules,
  dashboard: () => runDashboard('all'),
  'dashboard:files': () => runDashboard('files'),
  'dashboard:routes': () => runDashboard('routes'),
  runtime: inspectRuntime,
  guilds: inspectGuilds,
};

if (!commands[command]) {
  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}

const result = commands[command]();
if (result === false) process.exit(1);
