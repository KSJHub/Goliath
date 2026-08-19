'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const mode = process.env.BOT_MODE || 'dev';
const JS_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs'];

const absolute = (filePath) => path.join(root, filePath);
const relative = (filePath) => path.relative(root, filePath).replace(/\\/g, '/');
const exists = (filePath) => fs.existsSync(absolute(filePath));
const read = (filePath) => fs.readFileSync(filePath, 'utf8');

function section(title) {
  console.log(`\n${title}`);
  console.log('='.repeat(title.length));
}

function walk(directory, extensions = JS_EXTENSIONS) {
  if (!fs.existsSync(directory)) return [];

  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', 'dist', '.git', 'runtime'].includes(entry.name)) return [];
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(filePath, extensions);
    return entry.isFile() && extensions.includes(path.extname(entry.name)) ? [filePath] : [];
  });
}

function legacyCoreImports(filePath, source) {
  if (!JS_EXTENSIONS.includes(path.extname(filePath))) return [];

  const legacyRoot = path.join(root, 'core');
  const legacyPrefix = `${legacyRoot}${path.sep}`;
  const matches = [];
  const patterns = [
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\b(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specification = match[1];
      if (!specification.startsWith('.')) continue;
      const resolved = path.resolve(path.dirname(filePath), specification);
      if (resolved === legacyRoot || resolved.startsWith(legacyPrefix)) matches.push(specification);
    }
  }

  return [...new Set(matches)];
}

function projectShape() {
  section('Project shape');

  const required = [
    'server.js',
    'package.json',
    'scripts/goliath.js',
    'src/commands',
    'src/core',
    'src/dashboard',
    'src/events',
    'src/modules',
    'src/runtime',
    'src/server',
  ];

  const missing = required.filter((filePath) => {
    const present = exists(filePath);
    console.log(`${present ? '✅' : '❌'} ${filePath}`);
    return !present;
  });

  const retiredRoots = ['core', 'runtime'];
  const retiredFound = retiredRoots.filter(exists);
  for (const filePath of retiredRoots) console.log(`${exists(filePath) ? '❌' : '✅'} retired /${filePath}`);

  const extraScripts = fs.readdirSync(absolute('scripts'), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== 'goliath.js')
    .map((entry) => entry.name);

  for (const script of extraScripts) console.log(`❌ scripts/${script} must be absorbed`);
  return missing.length === 0 && retiredFound.length === 0 && extraScripts.length === 0;
}

function exportsAudit(title, checks) {
  section(title);
  const errors = [];

  for (const [filePath, names] of checks) {
    if (!exists(filePath)) {
      errors.push(`${filePath}: missing`);
      console.log(`❌ ${filePath}`);
      continue;
    }

    if (!names.length || !filePath.endsWith('.js')) {
      console.log(`✅ ${filePath}`);
      continue;
    }

    try {
      delete require.cache[require.resolve(absolute(filePath))];
      const moduleValue = require(absolute(filePath));
      const missing = names.filter((name) => moduleValue?.[name] === undefined);
      if (missing.length) errors.push(`${filePath}: missing ${missing.join(', ')}`);
      console.log(`${missing.length ? '❌' : '✅'} ${filePath}`);
    } catch (error) {
      errors.push(`${filePath}: ${error.message}`);
      console.log(`❌ ${filePath}`);
    }
  }

  for (const error of errors) console.log(` - ${error}`);
  return errors.length === 0;
}

function commandAudit() {
  section('Command audit');
  const seen = new Set();
  const errors = [];

  for (const filePath of walk(absolute('src/commands'))) {
    try {
      delete require.cache[require.resolve(filePath)];
      const command = require(filePath);
      const name = command?.data?.toJSON?.()?.name;
      if (!name) throw new Error('missing command name');
      if (seen.has(name)) throw new Error(`duplicate /${name}`);
      if (typeof command.execute !== 'function') throw new Error('missing execute');
      seen.add(name);
      console.log(`✅ /${name}`);
    } catch (error) {
      errors.push(`${relative(filePath)}: ${error.message}`);
      console.log(`❌ ${relative(filePath)}`);
    }
  }

  for (const error of errors) console.log(` - ${error}`);
  return errors.length === 0;
}

function sourceAudit() {
  section('Source audit');
  const errors = [];
  const mojibake = /[\u00e2\u00f0\u00ef\u00c3\ufffd]/g;
  const windowsPath = /\b[A-Za-z]:\\[^\r\n'"`]+/g;

  for (const filePath of walk(root, [...JS_EXTENSIONS, '.json', '.md', '.txt', '.yml', '.yaml'])) {
    const source = read(filePath);
    const repoPath = relative(filePath);
    const lines = source.split(/\r?\n/);

    lines.forEach((line, index) => {
      for (const match of line.matchAll(mojibake)) {
        const character = match[0];
        const codePoint = `U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
        errors.push(`UTF-8: ${repoPath}:${index + 1} ${codePoint} ${JSON.stringify(line.trim())}`);
      }
      for (const match of line.matchAll(windowsPath)) {
        errors.push(`Windows path: ${repoPath}:${index + 1} ${JSON.stringify(match[0])}`);
      }
    });

    for (const specification of legacyCoreImports(filePath, source)) {
      errors.push(`legacy core import: ${repoPath} -> ${specification}`);
    }
  }

  for (const error of errors) console.log(` - ${error}`);
  return errors.length === 0;
}

function importAudit() {
  section('Runtime imports');
  const files = [
    ...walk(absolute('src/events')),
    ...walk(absolute('src/core/admin/functions')),
    ...walk(absolute('src/server/routes')),
    ...walk(absolute('src/owner')),
  ];
  const errors = [];
  const probe = "try{require(process.argv[1]);process.exit(0)}catch(e){console.error(e?.stack||e);process.exit(1)}";

  for (const filePath of new Set(files)) {
    const result = spawnSync(process.execPath, ['-e', probe, filePath], {
      cwd: root,
      encoding: 'utf8',
      timeout: 15000,
      env: { ...process.env, GOLIATH_IMPORT_AUDIT: 'true' },
    });

    console.log(`${result.status === 0 ? '✅' : '❌'} ${relative(filePath)}`);
    if (result.status !== 0) {
      errors.push(`${relative(filePath)}: ${String(result.stderr || result.stdout).trim().split('\n').slice(0, 3).join(' | ')}`);
    }
  }

  for (const error of errors) console.log(` - ${error}`);
  return errors.length === 0;
}

const goodbyeAudit = () => exportsAudit('Goodbye doctor', [
  ['src/modules/messageStudio/goodbye/goodbye.js', []],
  ['src/modules/messageStudio/goodbye/goodbyeDeparture.js', ['getConfig', 'updateConfig', 'resetConfig', 'buildDmEmbed', 'sendDepartureDm']],
  ['src/modules/messageStudio/goodbye/goodbyePanel.js', []],
  ['src/server/routes/modules/messageStudio/goodbye.js', []],
  ['docs/modules/goodbye.md', []],
]);

const reactionRolesAudit = () => exportsAudit('Reaction Roles doctor', [
  ['src/modules/roleStudio/reactionRoles/reactionRoles.js', []],
  ['src/server/routes/modules/roleStudio/reactionRoles.js', []],
  ['src/modules/roleStudio/reactionRoles/reactionRolesPanel.js', []],
  ['src/dashboard/js/pages/modules/ReactionRoles.jsx', []],
]);

const roleStudioAudit = () => exportsAudit('Role Studio doctor', [
  ['src/modules/roleStudio/roleStudioPanel.js', ['buildRoleStudioPanel', 'buildRoleAnalyticsPanel', 'buildRoleHealthPanel']],
  ['src/modules/roleStudio/autoRoles/autoRoles.js', ['applyAutoRoles', 'startupAutoRoles', 'buildHealthReport', 'setAutoRolesEnabled']],
  ['src/modules/roleStudio/temporaryRoles/temporaryRoles.js', ['assignTemporaryRole', 'removeAssignment', 'scanExpired']],
  ['src/modules/roleStudio/timedRoles/timedRoles.js', ['getMemberProgression', 'applyProgressionToMember', 'simulateGuild', 'scanGuild']],
]);

const inviteStudioAudit = () => exportsAudit('Invite Studio doctor', [
  ['src/modules/communityStudio/invites/invites.js', ['defaults', 'getSection', 'setEnabled', 'updateSettings', 'buildHealth', 'repair', 'startup', 'exportConfiguration', 'reset']],
  ['src/server/routes/modules/communityStudio/invites.js', []],
  ['src/modules/communityStudio/invites/invitesAdminPanel.js', ['buildInviteStudioPayload', 'handleInviteStudioInteraction']],
  ['src/dashboard/js/pages/modules/Invites.jsx', []],
  ['docs/modules/communityStudio/invites.md', []],
]);

function dashboardAudit() {
  return exportsAudit('Dashboard entry surfaces', [
    ['src/dashboard/js/main.jsx', []],
    ['src/dashboard/js/App.jsx', []],
    ['src/dashboard/js/ui/layout.js', []],
    ['src/dashboard/js/shared/moduleRegistry.js', []],
  ]);
}

function runtimeAudit() {
  section('Runtime');
  const runtimeRoot = absolute(`src/runtime/${mode}`);
  console.log(`BOT_MODE: ${mode}`);
  if (!fs.existsSync(runtimeRoot)) return false;

  for (const directory of ['guilds', 'logs', 'database', 'data', 'backups']) {
    console.log(`${fs.existsSync(path.join(runtimeRoot, directory)) ? '✅' : '⚠️'} ${directory}`);
  }
  return true;
}

function guildAudit() {
  section('Guild configs');
  const directory = absolute(`src/runtime/${mode}/guilds`);
  if (!fs.existsSync(directory)) return false;
  fs.readdirSync(directory).filter((file) => file.endsWith('.json')).sort().forEach((file) => console.log(`- ${file}`));
  return true;
}

function mediaAudit() {
  section('Media');
  const ffmpeg = spawnSync('ffmpeg', ['-version']);
  const sharp = (() => {
    try {
      require.resolve('sharp');
      return true;
    } catch {
      return false;
    }
  })();

  console.log(`FFmpeg: ${ffmpeg.status === 0 ? '✅' : '❌'}`);
  console.log(`Sharp: ${sharp ? '✅' : '❌'}`);
  return ffmpeg.status === 0 && sharp;
}

function run(command, argumentsList, options = {}) {
  const result = spawnSync(command, argumentsList, { cwd: root, stdio: 'inherit', ...options });
  if (result.error) console.error(result.error.message);
  return result.status === 0;
}

function output(command, argumentsList) {
  const result = spawnSync(command, argumentsList, { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? String(result.stdout || '').trim() : '';
}

function classifyDeploymentChanges(files) {
  const plan = {
    changedFiles: files,
    affected: new Set(),
    commands: new Set(),
    needsDeps: false,
    needsCommandSync: false,
    needsDashboardBuild: false,
    needsAppReload: false,
    needsDoctor: false,
    fullFallback: false,
  };

  for (const rawFile of files) {
    const file = String(rawFile || '').replace(/\\/g, '/').trim();
    if (!file) continue;

    if (/^(package\.json|package-lock\.json|npm-shrinkwrap\.json)$/.test(file)) {
      plan.needsDeps = true;
      plan.needsCommandSync = true;
      plan.needsDashboardBuild = true;
      plan.needsAppReload = true;
      plan.needsDoctor = true;
      plan.affected.add('dependencies');
      continue;
    }

    if (file.startsWith('src/commands/')) {
      plan.needsCommandSync = true;
      plan.needsAppReload = true;
      plan.needsDoctor = true;
      plan.affected.add('commands');
      plan.commands.add(path.basename(file).replace(/\.[^.]+$/, ''));
      continue;
    }

    if (file.startsWith('src/dashboard/') || /^vite\.config\./.test(file)) {
      plan.needsDashboardBuild = true;
      plan.needsDoctor = true;
      plan.affected.add('dashboard');
      continue;
    }

    if (file.startsWith('src/modules/')) {
      const parts = file.split('/');
      const label = [parts[2], parts[3]].filter(Boolean).join('/');
      if (label) plan.affected.add(label);
      plan.needsAppReload = true;
      plan.needsDoctor = true;
      continue;
    }

    if (file.startsWith('src/owner/')) {
      const parts = file.split('/');
      plan.affected.add(`owner:${parts[2] || 'system'}`);
      plan.needsAppReload = true;
      plan.needsDoctor = true;
      continue;
    }

    if (file.startsWith('src/core/')) {
      plan.affected.add('core');
      plan.needsAppReload = true;
      plan.needsDoctor = true;
      continue;
    }

    if (file.startsWith('src/events/')) {
      plan.affected.add('events');
      plan.needsAppReload = true;
      plan.needsDoctor = true;
      continue;
    }

    if (file.startsWith('src/server/') || file === 'server.js') {
      plan.affected.add('server');
      plan.needsAppReload = true;
      plan.needsDoctor = true;
      continue;
    }

    if (/^src\/runtime\/.*\.js$/.test(file)) {
      plan.affected.add('runtime');
      plan.needsAppReload = true;
      plan.needsDoctor = true;
      continue;
    }

    if (file === 'scripts/goliath.js') {
      plan.affected.add('deployment');
      plan.needsAppReload = true;
      plan.needsDoctor = true;
      continue;
    }

    if (file.startsWith('.github/workflows/') || file.startsWith('test/') || file.startsWith('docs/') || file.endsWith('.md')) {
      continue;
    }

    if (/^src\/runtime\/(dev|beta|production)\//.test(file)) {
      continue;
    }

    plan.fullFallback = true;
    plan.affected.add(`unclassified:${file}`);
  }

  if (plan.fullFallback) {
    plan.needsDeps = true;
    plan.needsCommandSync = true;
    plan.needsDashboardBuild = true;
    plan.needsAppReload = true;
    plan.needsDoctor = true;
  }

  return plan;
}

function deployPlan(fromSha, toSha, format = 'human') {
  const from = String(fromSha || '').trim();
  const to = String(toSha || '').trim();
  let files = [];
  let forceFallback = false;

  if (!to || !output('git', ['cat-file', '-t', to])) {
    console.error(`Invalid deployment target commit: ${to || '(missing)'}`);
    return false;
  }

  if (!from || !output('git', ['cat-file', '-t', from])) {
    forceFallback = true;
  } else {
    const changed = output('git', ['diff', '--name-only', from, to]);
    files = changed ? changed.split(/\r?\n/).filter(Boolean) : [];
  }

  const plan = classifyDeploymentChanges(files);
  if (forceFallback) {
    plan.fullFallback = true;
    plan.needsDeps = true;
    plan.needsCommandSync = true;
    plan.needsDashboardBuild = true;
    plan.needsAppReload = true;
    plan.needsDoctor = true;
    plan.affected.add('fallback');
  }

  if (format === '--env') {
    const line = (name, value) => console.log(`${name}=${value}`);
    line('NEED_DEPS', plan.needsDeps);
    line('NEED_COMMAND_SYNC', plan.needsCommandSync);
    line('NEED_DASHBOARD_BUILD', plan.needsDashboardBuild);
    line('NEED_APP_RELOAD', plan.needsAppReload);
    line('NEED_DOCTOR', plan.needsDoctor);
    line('FULL_FALLBACK', plan.fullFallback);
    line('CHANGED_COUNT', plan.changedFiles.length);
    line('AFFECTED_SYSTEMS', [...plan.affected].join(','));
    line('AFFECTED_COMMANDS', [...plan.commands].join(','));
    return true;
  }

  section('Deployment plan');
  console.log(`From: ${from || 'unknown'}`);
  console.log(`To:   ${to}`);
  console.log(`Changed files: ${plan.changedFiles.length}`);
  for (const file of plan.changedFiles) console.log(` - ${file}`);
  console.log(`Affected: ${[...plan.affected].join(', ') || 'repository only'}`);
  console.log(`Commands: ${[...plan.commands].map((name) => `/${name}`).join(', ') || 'none'}`);
  console.log(`Dependencies: ${plan.needsDeps}`);
  console.log(`Dashboard: ${plan.needsDashboardBuild}`);
  console.log(`Command sync: ${plan.needsCommandSync}`);
  console.log(`App reload: ${plan.needsAppReload}`);
  console.log(`Doctor: ${plan.needsDoctor}`);
  console.log(`Full fallback: ${plan.fullFallback}`);
  return true;
}

function syncCommands(target = mode) {
  const environment = String(target || mode).toLowerCase();
  if (!['dev', 'beta', 'production'].includes(environment)) {
    console.error(`Invalid command-sync environment: ${environment}`);
    return false;
  }

  section(`Sync Discord commands (${environment})`);
  const result = spawnSync(process.execPath, [absolute('src/core/commands/syncCommands.js')], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, BOT_MODE: environment },
  });
  return result.status === 0;
}

function dashboardImportAudit() {
  section('Dashboard imports');

  const dashboardFiles = walk(absolute('src/dashboard'), [
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
  ]);

  const errors = [];

  for (const filePath of dashboardFiles) {
    const source = read(filePath);

    const imports = [
      ...source.matchAll(
        /(?:import|export).*?from\s+['"]([^'"]+)['"]/g
      ),
    ].map((match) => match[1]);

    for (const specification of imports) {
      if (!specification.startsWith('.')) continue;

      const resolved = path.resolve(
        path.dirname(filePath),
        specification
      );

      const candidates = [
        resolved,
        `${resolved}.js`,
        `${resolved}.jsx`,
        path.join(resolved, 'index.js'),
        path.join(resolved, 'index.jsx'),
      ];

      if (!candidates.some((candidate) => fs.existsSync(candidate))) {
        errors.push(
          `${relative(filePath)} -> ${specification}`
        );
      }
    }
  }

  for (const error of errors) {
    console.log(` - ${error}`);
  }

  return errors.length === 0;
}

function auditCommand() {
  section('Goliath audit');

  return [
    projectShape,
    commandAudit,
    dashboardAudit,
    dashboardImportAudit,
    sourceAudit,
    importAudit,
    runtimeAudit,
    goodbyeAudit,
    reactionRolesAudit,
    roleStudioAudit,
    inviteStudioAudit,
  ].map((suite) => suite()).every(Boolean);
}

function doctor(target = '') {
  const suites = {
    goodbye: goodbyeAudit,
    reaction: reactionRolesAudit,
    reactionroles: reactionRolesAudit,
    'reaction-roles': reactionRolesAudit,
    'role-studio': roleStudioAudit,
    rolestudio: roleStudioAudit,
    invites: inviteStudioAudit,
  };

  if (target) return suites[target]?.() ?? false;

  return [
    projectShape,
    commandAudit,
    dashboardAudit,
    sourceAudit,
    importAudit,
    runtimeAudit,
    goodbyeAudit,
    reactionRolesAudit,
    roleStudioAudit,
    inviteStudioAudit,
  ].map((suite) => suite()).every(Boolean);
}

function promote(target) {
  const environment = String(target || '').toLowerCase();
  const plan = {
    beta: { source: 'dev', deploy: '/home/goliath/deploy-beta.sh' },
    production: { source: 'beta', deploy: '/home/goliath/deploy-production.sh' },
  }[environment];

  if (!plan) {
    console.error(`Invalid promotion target: ${environment}`);
    return false;
  }

  section(`Promote ${plan.source} -> ${environment}`);
  if (!run('git', ['fetch', 'origin'])) return false;
  if (output('git', ['status', '--porcelain'])) {
    console.error('Working tree is not clean.');
    return false;
  }

  const sourceRef = `origin/${plan.source}`;
  const targetRef = `origin/${environment}`;
  const sourceSha = output('git', ['rev-parse', sourceRef]);
  const targetSha = output('git', ['rev-parse', targetRef]);
  if (!sourceSha || !targetSha) return false;

  console.log(`Source ${sourceRef}: ${sourceSha}`);
  console.log(`Target ${targetRef}: ${targetSha}`);
  if (sourceSha === targetSha) {
    console.log(`${environment} already matches ${plan.source}.`);
    return true;
  }

  if (!run('git', ['merge-base', '--is-ancestor', targetRef, sourceRef])) {
    console.error(`${environment} cannot fast-forward to ${plan.source}; promotion aborted.`);
    return false;
  }

  if (!run('git', ['checkout', '-B', environment, targetRef])) return false;
  if (!run('git', ['merge', '--ff-only', sourceRef])) return false;
  if (!run('git', ['push', 'origin', environment])) return false;
  console.log(`${environment} fast-forwarded to ${plan.source}.`);
  return true;
}

const commands = {
  doctor: () => doctor(process.argv[3]),
  audit: auditCommand,
  'dashboard-imports': dashboardImportAudit,
  'deploy-plan': () => deployPlan(process.argv[3], process.argv[4], process.argv[5]),
  'sync-commands': () => syncCommands(process.argv[3]),
  promote: () => promote(process.argv[3]),
  guilds: guildAudit,
  media: mediaAudit,
};

const command = process.argv[2] || 'doctor';
const handler = commands[command];
if (!handler) {
  console.error(`Unknown Goliath command: ${command}`);
  process.exitCode = 1;
} else if (!handler()) {
  process.exitCode = 1;
}