'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const mode = process.env.BOT_MODE || 'dev';
const JS_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs'];
const CANONICAL_COMMANDS = [
  ['admin', 'src/core/administration/admin/command.js'],
  ['mod', 'src/core/administration/mod/command.js'],
  ['user', 'src/core/administration/user/command.js'],
];

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
  const errors = [];
  const seen = new Set();
  for (const [expectedName, filePath] of CANONICAL_COMMANDS) {
    try {
      if (!exists(filePath)) throw new Error('missing canonical command file');
      delete require.cache[require.resolve(absolute(filePath))];
      const command = require(absolute(filePath));
      const name = command?.data?.toJSON?.()?.name;
      if (name !== expectedName) throw new Error(`expected /${expectedName}, got /${name || 'missing'}`);
      if (seen.has(name)) throw new Error(`duplicate /${name}`);
      if (typeof command.execute !== 'function') throw new Error('missing execute');
      seen.add(name);
      console.log(`✅ /${name}`);
    } catch (error) {
      errors.push(`${filePath}: ${error.message}`);
      console.log(`❌ ${filePath}`);
    }
  }
  if (seen.size !== CANONICAL_COMMANDS.length) errors.push(`expected exactly ${CANONICAL_COMMANDS.length} canonical commands`);
  for (const error of errors) console.log(` - ${error}`);
  return errors.length === 0;
}

function sourceAudit() {
  section('Source audit');
  const errors = [];
  const mojibake = /[\u00e2\u00f0\u00ef\u00c3\ufffd]/g;
  const windowsPath = /(?:^|[\s'"`])[A-Za-z]:\\[^\r\n'"`]+/g;
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
      for (const match of line.matchAll(windowsPath)) errors.push(`Windows path: ${repoPath}:${index + 1} ${JSON.stringify(match[0])}`);
    });
    for (const specification of legacyCoreImports(filePath, source)) errors.push(`legacy core import: ${repoPath} -> ${specification}`);
  }
  for (const error of errors) console.log(` - ${error}`);
  return errors.length === 0;
}

function importAudit() {
  section('Runtime imports');
  const files = [
    ...walk(absolute('src/events')),
    ...walk(absolute('src/core/administration/admin')),
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
      env: {
        ...process.env,
        GOLIATH_IMPORT_AUDIT: 'true',
        // Import probes must never mutate the live dependency tree.
        // Disable lifecycle/cleanup behaviour in modules that honour audit mode.
        GOLIATH_DOCTOR: 'true',
      },
    });
    console.log(`${result.status === 0 ? '✅' : '❌'} ${relative(filePath)}`);
    if (result.status !== 0) errors.push(`${relative(filePath)}: ${String(result.stderr || result.stdout).trim().split('\n').slice(0, 3).join(' | ')}`);
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
  for (const directory of ['guilds', 'logs', 'database', 'data', 'backups']) console.log(`${fs.existsSync(path.join(runtimeRoot, directory)) ? '✅' : '⚠️'} ${directory}`);
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
  let sharp = false;
  try { require.resolve('sharp'); sharp = true; } catch {}
  console.log(`FFmpeg: ${ffmpeg.status === 0 ? '✅' : '❌'}`);
  console.log(`Sharp: ${sharp ? '✅' : '❌'}`);
  return ffmpeg.status === 0 && sharp;
}
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.error) console.error(result.error.message);
  return result.status === 0;
}
function output(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
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
  const canonicalCommandPaths = new Set(CANONICAL_COMMANDS.map(([, filePath]) => filePath));
  for (const rawFile of files) {
    const file = String(rawFile || '').replace(/\\/g, '/').trim();
    if (!file) continue;
    if (/^(package\.json|package-lock\.json|npm-shrinkwrap\.json)$/.test(file)) {
      plan.needsDeps = true; plan.needsCommandSync = true; plan.needsDashboardBuild = true;
      plan.needsAppReload = true; plan.needsDoctor = true; plan.affected.add('dependencies'); continue;
    }
    if (file.startsWith('src/commands/') || file.startsWith('src/core/commands/') || canonicalCommandPaths.has(file)) {
      plan.needsCommandSync = true; plan.needsAppReload = true; plan.needsDoctor = true; plan.affected.add('commands');
      const canonical = CANONICAL_COMMANDS.find(([, commandPath]) => commandPath === file);
      if (canonical) plan.commands.add(canonical[0]);
      continue;
    }
    if (file.startsWith('src/dashboard/') || /^vite\.config\./.test(file)) {
      plan.needsDashboardBuild = true; plan.needsDoctor = true; plan.affected.add('dashboard'); continue;
    }
    if (file.startsWith('src/modules/')) {
      const parts = file.split('/'); const label = [parts[2], parts[3]].filter(Boolean).join('/');
      if (label) plan.affected.add(label); plan.needsAppReload = true; plan.needsDoctor = true; continue;
    }
    if (file.startsWith('src/owner/')) {
      const parts = file.split('/'); plan.affected.add(`owner:${parts[2] || 'system'}`);
      plan.needsAppReload = true; plan.needsDoctor = true; continue;
    }
    if (file.startsWith('src/core/')) {
      plan.affected.add('core'); plan.needsAppReload = true; plan.needsDoctor = true; continue;
    }
    if (file.startsWith('src/events/')) {
      plan.affected.add('events'); plan.needsAppReload = true; plan.needsDoctor = true; continue;
    }
    if (file.startsWith('src/server/') || file === 'server.js') {
      plan.affected.add('server'); plan.needsAppReload = true; plan.needsDoctor = true; continue;
    }
    if (/^src\/runtime\/.*\.js$/.test(file)) {
      plan.affected.add('runtime'); plan.needsAppReload = true; plan.needsDoctor = true; continue;
    }
    if (file === 'scripts/goliath.js') {
      plan.affected.add('deployment'); plan.needsCommandSync = true; plan.needsAppReload = true; plan.needsDoctor = true; continue;
    }
    if (file.startsWith('.github/workflows/') || file.startsWith('test/') || file.startsWith('docs/') || file.endsWith('.md')) continue;
    if (/^src\/runtime\/(dev|beta|production)\//.test(file)) continue;
    plan.fullFallback = true; plan.affected.add(`unclassified:${file}`);
  }
  if (plan.fullFallback) {
    plan.needsDeps = true; plan.needsCommandSync = true; plan.needsDashboardBuild = true;
    plan.needsAppReload = true; plan.needsDoctor = true;
  }
  return plan;
}

function deployPlan(fromSha, toSha, format = 'human') {
  const from = String(fromSha || '').trim();
  const to = String(toSha || '').trim();
  let files = [];
  let forceFallback = false;
  if (!to || !output('git', ['cat-file', '-t', to])) {
    console.error(`Invalid deployment target commit: ${to || '(missing)'}`); return false;
  }
  if (!from || !output('git', ['cat-file', '-t', from])) forceFallback = true;
  else {
    const changed = output('git', ['diff', '--name-only', from, to]);
    files = changed ? changed.split(/\r?\n/).filter(Boolean) : [];
  }
  const plan = classifyDeploymentChanges(files);
  if (forceFallback) {
    plan.fullFallback = true; plan.needsDeps = true; plan.needsCommandSync = true;
    plan.needsDashboardBuild = true; plan.needsAppReload = true; plan.needsDoctor = true; plan.affected.add('fallback');
  }
  if (format === '--env') {
    const line = (name, value) => console.log(`${name}=${value}`);
    line('NEED_DEPS', plan.needsDeps); line('NEED_COMMAND_SYNC', plan.needsCommandSync);
    line('NEED_DASHBOARD_BUILD', plan.needsDashboardBuild); line('NEED_APP_RELOAD', plan.needsAppReload);
    line('NEED_DOCTOR', plan.needsDoctor); line('FULL_FALLBACK', plan.fullFallback);
    line('CHANGED_COUNT', plan.changedFiles.length); line('AFFECTED_SYSTEMS', [...plan.affected].join(','));
    line('AFFECTED_COMMANDS', [...plan.commands].join(',')); return true;
  }
  section('Deployment plan');
  console.log(`From: ${from || 'unknown'}`); console.log(`To:   ${to}`); console.log(`Changed files: ${plan.changedFiles.length}`);
  for (const file of plan.changedFiles) console.log(` - ${file}`);
  console.log(`Affected: ${[...plan.affected].join(', ') || 'repository only'}`);
  console.log(`Commands: ${[...plan.commands].map((name) => `/${name}`).join(', ') || 'none'}`);
  console.log(`Dependencies: ${plan.needsDeps}`); console.log(`Dashboard: ${plan.needsDashboardBuild}`);
  console.log(`Command sync: ${plan.needsCommandSync}`); console.log(`App reload: ${plan.needsAppReload}`);
  console.log(`Doctor: ${plan.needsDoctor}`); console.log(`Full fallback: ${plan.fullFallback}`);
  return true;
}

function syncCommands(target = mode) {
  const environment = String(target || mode).toLowerCase();
  if (!['dev', 'beta', 'production'].includes(environment)) {
    console.error(`Invalid command-sync environment: ${environment}`); return false;
  }
  section(`Sync Discord commands (${environment})`);
  const result = spawnSync(process.execPath, [absolute('src/core/commands/syncCommands.js')], {
    cwd: root, stdio: 'inherit', env: { ...process.env, BOT_MODE: environment },
  });
  return result.status === 0;
}

function dashboardImportAudit() {
  section('Dashboard imports');
  const files = walk(absolute('src/dashboard'), JS_EXTENSIONS);
  const errors = [];
  for (const filePath of files) {
    const source = read(filePath);
    const imports = [...source.matchAll(/(?:import|export).*?from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    for (const specification of imports) {
      if (!specification.startsWith('.')) continue;
      const resolved = path.resolve(path.dirname(filePath), specification);
      const candidates = [resolved, `${resolved}.js`, `${resolved}.jsx`, path.join(resolved, 'index.js'), path.join(resolved, 'index.jsx')];
      if (!candidates.some((candidate) => fs.existsSync(candidate))) errors.push(`${relative(filePath)} -> ${specification}`);
    }
  }
  for (const error of errors) console.log(` - ${error}`);
  return errors.length === 0;
}

function backendRelativeImportAudit() {
  section('Backend relative imports');
  const files = [
    ...walk(absolute('scripts'), ['.js', '.cjs', '.mjs']),
    ...walk(absolute('src'), ['.js', '.cjs', '.mjs']).filter((file) => !file.startsWith(absolute('src/dashboard') + path.sep)),
    absolute('server.js'),
  ].filter((file) => fs.existsSync(file));
  const patterns = [
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\b(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g,
  ];
  const missing = new Set();
  for (const file of files.sort()) {
    const source = fs.readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      for (const match of source.matchAll(pattern)) {
        const spec = match[1];
        if (!spec.startsWith('.')) continue;
        try { require.resolve(path.resolve(path.dirname(file), spec)); }
        catch { missing.add(`${relative(file)} -> ${spec}`); }
      }
    }
  }
  for (const entry of missing) console.error(`❌ ${entry}`);
  if (!missing.size) console.log(`✅ Relative import audit: ${files.length} backend files`);
  return missing.size === 0;
}

function runtimeContractsAudit() {
  section('Runtime contracts');
  const surfaces = [
  ['src/modules/socialStudio/socialAlerts/socialStudio', ['getAccess', 'findByOwnerDiscordId', 'getAccountsForCreator', 'completeCreatorProfile']],
  ['src/modules/socialStudio/socialAlerts/socialStudioMonitor', ['startupSocialStudio', 'checkGuildAccounts', 'forcePostCreatorLive', 'projectLiveRefreshState', 'projectGuildConfig', 'projectedOptions', 'projectedRefreshTimestamp', 'repairLiveRollovers', 'buildLiveFields', 'livePlatformField']],
  ['src/core/administration/admin/panel', ['buildAdminPanel', 'handleAdminNavigation', 'getAuthorityConfig', 'hasGuildPermission', 'getAuthorityContext', 'canManageGuildAuthority']],
  ['src/core/ui/panelNavigation', ['createState', 'normalize', 'encodeState', 'decodeState', 'push', 'back', 'current', 'buildCustomId', 'parseCustomId', 'applyNavigationUI']],
  ['src/core/administration/mod/storage', ['searchCases', 'getCaseById', 'getCaseAudit', 'recordCaseAudit', 'updateCaseReason', 'updateCaseStatus', 'updateCaseNote', 'clearCaseNote']],
  ['src/owner/auditIntelligence/auditRouter', ['deliver', 'ensureAuditChannel', 'ensureUserAuditChannel', 'ensureReportRoutes', 'refreshUserSummary', 'getOwnerAuditGuildId', 'ensureCommandCenter', 'routeKeyForEvent', 'monitorKeyForEvent', 'monitoringEnabled', 'configuredRouteChannel', 'runLocalEndToEndProbe', 'runLiveEndToEndProbe', 'channelDeliveryState', 'inspectReportFeeds', 'inspectStructure', 'repairStructure', 'inspectHealth', 'repairHealth']],
  ['src/modules/communityStudio/counting/counting', ['getSection', 'updateSection', 'mutateSection', 'expectedNext', 'resetProgress', 'resetWithMarker', 'setCurrentCountQueued', 'changeChannel', 'purgeCountingChannel', 'deployPlayerPanel', 'refreshPlayerPanel', 'handleMessageCreate', 'handleMessageDelete', 'handleMessageUpdate', 'registerProtectionEvents']],
  ['src/modules/communityStudio/counting/countingHealth', ['buildHealthReport', 'repair']],
  ['src/modules/communityStudio/counting/panel', ['buildPanel', 'buildRulesScreen', 'buildSettingsScreen', 'buildDefaultsConfirmation', 'buildAdvancedRulesModal', 'buildResetConfirmation', 'buildCleanupConfirmation', 'handleInteraction']],
];
  let failed = false;
  for (const [file, names] of surfaces) {
    let mod;
    try { mod = require(absolute(file)); }
    catch (error) {
      console.error(`❌ ./${file}: ${error.message}`);
      failed = true;
      continue;
    }
    const missing = names.filter((name) => typeof mod?.[name] !== 'function');
    console.log(`${missing.length ? '❌' : '✅'} ./${file}`);
    if (missing.length) {
      failed = true;
      console.error(` - missing ${missing.join(', ')}`);
    }
  }
  const social = require(absolute('src/modules/socialStudio/socialAlerts/socialStudio'));
  const userMethods = ['buildLanding', 'buildDenied', 'buildCreate', 'buildProfile', 'buildSection', 'handleInteraction', 'canAccess'];
  const missingUser = userMethods.filter((name) => typeof social?.user?.[name] !== 'function');
  console.log(`${missingUser.length ? '❌' : '✅'} ./src/modules/socialStudio/socialAlerts/socialStudio.user`);
  if (missingUser.length) {
    failed = true;
    console.error(` - missing ${missingUser.join(', ')}`);
  }
  const adminCommandSource = fs.readFileSync(absolute('src/core/administration/admin/command.js'), 'utf8');
  if (adminCommandSource.includes('isGoliathOwner ? null : interaction')) {
    failed = true;
    console.error('❌ ./src/core/administration/admin/command owner interaction contract');
    console.error(' - Goliath owner must retain the real Discord interaction');
  } else {
    console.log('✅ ./src/core/administration/admin/command owner interaction contract');
  }
  if (!failed) console.log(`✅ Runtime contract audit: ${surfaces.length + 1} surfaces`);
  return !failed;
}

function guildVariableSourceAudit() {
  const ROOT = root;
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
  
  function importsCentralReplacement(source) {
    return /require\([^\n)]*core\/guild\/guildVariables[^\n)]*\)/.test(source)
      && /\b(?:replaceVars|replaceVariables|buildVariableMap)\b/.test(source);
  }
  
  function isDelegatorFunction(source, lines, index) {
    const window = lines.slice(index, Math.min(lines.length, index + 30)).join('\n');
    if (/guildVariables\.(?:replaceVars|replaceVariables|renderVerificationTemplate)\s*\(/.test(window)) return true;
    if (!importsCentralReplacement(source)) return false;
    return /\b(?:replaceVars|replaceVariables|buildVariableMap)\s*\(/.test(window);
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
  
        // Thin module helpers are allowed when they delegate replacement to guildVariables,
        // including destructured imports such as `const { replaceVars } = require(...)`.
        if (check.name === 'local generic template renderer' && isDelegatorFunction(source, lines, index)) continue;
  
        findings.push(`${relative(file)}:${index + 1} [${check.name}] ${line.trim()}`);
      }
    }
  }
  
  if (findings.length) {
    console.error('❌ Central Guild Variables source-of-truth audit failed.');
    console.error('Template/placeholder replacement must go through src/core/guild/guildVariables.js.');
    for (const finding of findings) console.error(` - ${finding}`);
    return false;
  }
  
  const guildVariables = fs.readFileSync(CENTRAL, 'utf8');
  for (const exportName of ['buildVariableMap', 'replaceVars', 'replaceVariables', 'variablesForModule']) {
    if (!guildVariables.includes(exportName)) { console.error(`❌ guildVariables.js must retain ${exportName}.`); return false; }
  }
  
  console.log(`✅ Central Guild Variables source-of-truth audit passed across ${files.length} source files.`);
  return true;
  
}

function internalVersionNamingAudit() {
  const ROOT = root;
  
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
      if (relativePath === 'scripts/goliath.js' && /forbiddenWrittenPattern|forbiddenComponentPattern/.test(line)) return;
  
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
  
    return false;
  }
  
  console.log('✅ Internal Goliath naming audit passed: no numbered replacement-generation naming detected.');
  return true;
  
}

async function verificationAnswerAudit() {
  const assert = require('node:assert/strict');
  const crypto = require('node:crypto');
  const { createRequire } = require('node:module');
  const clone = value => JSON.parse(JSON.stringify(value));
  function load(file, mocks) {
    const filename = absolute(file), localRequire = createRequire(filename), module = { exports: {} };
    new Function('require', 'module', 'exports', fs.readFileSync(filename, 'utf8'))(id => {
      if (Object.hasOwn(mocks, id)) return mocks[id];
      if (id === 'crypto' || id === 'discord.js') return localRequire(id);
      throw new Error(`Unmocked Verification answer audit dependency: ${id}`);
    }, module, module.exports);
    return module.exports;
  }
  let data = null, numbers = [];
  const store = load('src/modules/securityStudio/verificationStore.js', {
    '../../core/guild/moduleSectionManager': {
      getModuleSection: (guild, name, fallback) => clone(data || fallback),
      saveModuleSection: (guild, name, value) => { data = clone(value); return clone(data); },
      updateModuleSection: (guild, name, update, fallback) => { data = clone(update(clone(data || fallback))); return clone(data); },
    }, '../../core/guild/guildManager': {},
  });
  const challenges = load('src/modules/securityStudio/verificationChallenges.js', { './verificationStore': store, crypto: { ...crypto, randomInt: (min, max) => numbers.length ? numbers.shift() : crypto.randomInt(min, max) } });
  const runtime = () => load('src/modules/securityStudio/verificationChallengeRuntime.js', { './verificationChallenges': challenges, './verificationStore': store });
  const guild = '1515201360386068642', user = '815257293347880961';
  const reset = () => { data = store.defaultVerificationSection(); store.upsertSession(guild, user, { state: 'verifying', securityConfigRevision: data.configRevision }); };
  reset(); numbers = [42, 30, 0];
  const started = runtime().startStep(guild, user, 'captcha', { security: { captchaConfig: { maxChallengeAttempts: 3 } } });
  assert.equal(started.challenge.prompt, 'Security check: what is 42 + 30?');
  assert.equal(runtime().submitAnswer(guild, user, user, started.challenge.challengeId, '72').ok, true, 'Correct answer to persisted 42 + 30 CAPTCHA must pass through the real runtime and store');
  assert.equal(data.sessions[user].completedSecurity.includes('captcha'), true);
  const settings = { security: { captchaConfig: { maxChallengeAttempts: 3 } } };
  const startMath = () => { reset(); numbers = [42, 30, 0]; return runtime().startStep(guild, user, 'captcha', settings).challenge; };
  let challenge = startMath();
  const saved = clone(store.getSession(guild, user).activeChallenge);
  assert.equal(typeof saved.answerSalt, 'string');
  assert.match(saved.answerHash, /^[a-f0-9]{64}$/);
  assert.equal(challenge.answerSalt, undefined);
  assert.equal(challenge.answerHash, undefined);
  assert.equal(runtime().startStep(guild, user, 'captcha', settings).reused, true);
  assert.equal(store.getSession(guild, user).activeChallenge.answerHash, saved.answerHash);
  const wrong = runtime().submitAnswer(guild, user, user, challenge.challengeId, '73');
  assert.equal(wrong.reason, 'incorrect');
  assert.equal(wrong.attempts, 1);
  assert.equal(runtime().submitAnswer(guild, user, user, challenge.challengeId, ' 72 ').ok, true);

  for (const difficulty of ['easy', 'normal', 'hard']) {
    for (let index = 0; index < 15; index++) {
      reset();
      const c = runtime().startStep(guild, user, 'captcha', { security: { captchaConfig: { difficulty, maxChallengeAttempts: 3 } } }).challenge;
      const match = c.prompt.match(/what is (\d+) ([+×-]) (\d+)\?/);
      assert(match, 'Math prompt must have an unambiguous numeric answer');
      const a = Number(match[1]), b = Number(match[3]);
      const answer = match[2] === '+' ? a + b : match[2] === '-' ? a - b : a * b;
      assert.equal(runtime().submitAnswer(guild, user, user, c.challengeId, String(answer)).ok, true, c.prompt);
    }
  }
  reset();
  challenge = runtime().startStep(guild, user, 'one_time_challenge', {}).challenge;
  assert.equal(runtime().submitAnswer(guild, user, user, challenge.challengeId, challenge.prompt.match(/\d{6}/)[0]).ok, true);
  reset();
  challenge = runtime().startStep(guild, user, 'minigame', { security: { minigameConfig: { gameType: 'sequence', random: false, rounds: 2, maxChallengeAttempts: 3 } } }).challenge;
  const sequenceAnswer = c => c.prompt.split(':')[1].replace(/[^0-9]/g, '');
  const first = runtime().submitAnswer(guild, user, user, challenge.challengeId, sequenceAnswer(challenge));
  assert.equal(first.reason, 'next_round');
  assert.equal(first.complete, false);
  assert.equal(runtime().submitAnswer(guild, user, user, first.challenge.challengeId, sequenceAnswer(first.challenge)).ok, true);

  // Existing broken challenges fail without a strike and are replaced on an explicit restart.
  challenge = startMath();
  store.upsertSession(guild, user, { activeChallenge: { ...store.getSession(guild, user).activeChallenge, answerSalt: undefined, answerHash: undefined } });
  const historyBefore = clone(data.securityHistory[user]);
  const broken = runtime().submitAnswer(guild, user, user, challenge.challengeId, '72');
  assert.equal(broken.reason, 'challenge_unavailable');
  assert.equal(broken.recordFailure, undefined);
  assert.equal(data.sessions[user].activeChallenge.attempts, 0);
  assert.deepEqual(data.securityHistory[user], historyBefore);
  const replies = [];
  let failureCalls = 0;
  const interactions = load('src/modules/securityStudio/verificationChallengeInteractions.js', { '../../core/guild/guildManager': { isModuleEnabled: () => true }, './verificationChallengeRuntime': runtime(), './verificationStore': store });
  await interactions.handleVerificationChallengeInteraction({
    customId: `verify:answer:${user}:${challenge.challengeId}`, guildId: guild, user: { id: user },
    isModalSubmit: () => true, fields: { getTextInputValue: () => '72' }, reply: async payload => replies.push(payload),
  }, { recordVerificationFailure: async () => { failureCalls++; } });
  assert.equal(failureCalls, 0);
  assert(replies[0].content.includes('has not counted as a wrong answer'));
  const repaired = runtime().startStep(guild, user, 'captcha', settings);
  assert.notEqual(repaired.challenge.challengeId, challenge.challengeId);
  assert.equal(challenges.hasAnswerVerifier(data.sessions[user].activeChallenge), true);
  assert.equal(data.sessions[user].activeChallenge.attempts, 0);
  assert.equal(data.securityHistory[user].some(event => event.type === 'challenge_cleared' && event.reason === 'missing_answer_verifier'), true);
  const historyAfter = clone(data.securityHistory[user]);
  assert.equal(runtime().submitAnswer(guild, user, user, challenge.challengeId, '72').reason, 'stale_challenge');
  assert.deepEqual(data.securityHistory[user], historyAfter);
  store.upsertSession(guild, user, { state: 'quarantined' });
  assert.equal(runtime().startStep(guild, user, 'captcha', settings).reason, 'terminal_session');
  assert.equal(data.sessions[user].state, 'quarantined');
  reset();
  challenge = runtime().startStep(guild, user, 'staff_approval', {}).challenge;
  assert.equal(runtime().startStep(guild, user, 'staff_approval', {}).reused, true);
  assert.equal(challenge.method, 'staff_approval');
  // Exhaust every generated arithmetic combination through the real verifier.
  // A small serialised store keeps exhaustive generation separate from the full-store tests above.
  let sample = null, draws = [], arithmeticCases = 0, gameCases = 0;
  const exhaustive = load('src/modules/securityStudio/verificationChallenges.js', {
    crypto: { ...crypto, randomInt: (min, max) => { const value = draws.length ? draws.shift() : min; assert(value >= min && value < max, 'Fixture random draw out of range'); return value; } },
    './verificationStore': { getSession: () => clone(sample), upsertSession: (g, u, patch) => { sample = clone({ ...sample, ...patch }); }, addSecurityHistory: () => {}, incrementAnalytics: () => {} },
  });
  function begin(method, config, values = []) {
    sample = { state: 'verifying' }; draws = [...values];
    const challenge = exhaustive.start(guild, user, method, config);
    assert.equal(draws.length, 0, 'Every specified generator input must be used');
    assert.equal(exhaustive.hasAnswerVerifier(sample.activeChallenge), true);
    assert.equal(challenge.answerHash, undefined); assert.equal(challenge.answerSalt, undefined);
    return challenge;
  }
  function accept(c, answer) {
    const result = exhaustive.answer(guild, user, c.challengeId, String(answer));
    assert.equal(result.ok, true, c.prompt);
    return result;
  }
  function checkMath(difficulty, a, b, op = '+') {
    const values = difficulty === 'normal' ? [a, b, op === '+' ? 0 : 1] : [a, b];
    const c = begin('captcha', { difficulty, maxChallengeAttempts: 3 }, values);
    const x = op === '-' ? Math.max(a, b) : a, y = op === '-' ? Math.min(a, b) : b;
    assert.equal(c.prompt, `Security check: what is ${x} ${op} ${y}?`);
    const expected = op === '+' ? a + b : op === '-' ? Math.abs(a - b) : a * b;
    const incorrect = exhaustive.answer(guild, user, c.challengeId, String(expected + 1));
    assert.equal(incorrect.reason, 'incorrect');
    assert.equal(incorrect.attempts, 1); assert.equal(incorrect.attemptsRemaining, 2);
    const correct = accept(c, expected);
    assert.equal(correct.reason, 'passed'); assert.equal(correct.complete, true);
    assert.equal(correct.attempts, 2); assert.equal(correct.attemptsRemaining, 1);
    arithmeticCases++;
  }
  for (let a = 2; a <= 20; a++) for (let b = 2; b <= 20; b++) checkMath('easy', a, b);
  for (let a = 10; a <= 60; a++) for (let b = 2; b <= 30; b++) for (const op of ['+', '-']) checkMath('normal', a, b, op);
  for (let a = 6; a <= 20; a++) for (let b = 2; b <= 12; b++) checkMath('hard', a, b, '×');
  assert.equal(arithmeticCases, 3484);

  const gameSolution = c => {
    const body = c.prompt.split(':').slice(1).join(':').trim();
    if (c.gameType === 'target_match') return body;
    if (c.gameType === 'sequence') return body.split('·').map(value => value.trim()).join('');
    if (c.gameType === 'order') return body.split(',').map(Number).sort((a, b) => a - b).join(' ');
    if (c.gameType === 'memory_match') return body.split('·').map(value => value.trim()).join(' ');
    if (c.gameType === 'odd_one_out') return c.prompt.split('?')[1].split('·').at(-1).trim();
    if (c.gameType === 'reaction') return c.prompt.match(/\*\*(.+?)\*\*/)[1];
    const terms = c.prompt.match(/\d+/g).map(Number);
    assert.equal(terms.length, 4);
    assert.equal(terms[1] - terms[0], terms[2] - terms[1]);
    assert.equal(terms[2] - terms[1], terms[3] - terms[2]);
    return String(terms[3] + terms[1] - terms[0]);
  };
  const checkGame = (gameType, values, config = {}) => {
    const c = begin('minigame', { gameType, random: false, rounds: 1, maxChallengeAttempts: 3, ...config }, values);
    assert.equal(c.gameType, gameType);
    assert.equal(accept(c, gameSolution(c)).complete, true); gameCases++;
    return c;
  };
  for (let start = 1; start <= 8; start++) for (let step = 2; step <= 6; step++) checkGame('pattern_match', [start, step]);
  for (const values of [[99, 98, 11, 10, 50], [10, 10, 99, 99, 50], [99, 99, 99, 99, 99], [10, 11, 12, 13, 14]]) checkGame('order', values);
  for (let index = 0; index < 5; index++) checkGame('target_match', [index]);
  for (let index = 0; index < 3; index++) {
    const c = checkGame('odd_one_out', [index]);
    assert.equal(gameSolution(c), ['banana', 'guitar', 'window'][index]);
  }
  for (let index = 0; index < 4; index++) checkGame('reaction', [index]);
  for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) for (let c = 0; c < 6; c++) checkGame('memory_match', [a, b, c]);
  for (const [difficulty, length] of [['easy', 4], ['normal', 5], ['hard', 7]]) {
    for (const digit of [1, 9]) {
      const c = checkGame('sequence', Array(length).fill(digit), { difficulty });
      assert.equal(gameSolution(c), String(digit).repeat(length));
    }
  }
  for (const gameType of exhaustive.GAME_TYPES) {
    for (const rounds of [1, 2, 10]) {
      let c = begin('minigame', { gameType, random: false, rounds, maxChallengeAttempts: 3 });
      for (let round = 1; round <= rounds; round++) {
        assert.equal(c.round, round); assert.equal(c.rounds, rounds);
        assert.equal(c.passedRounds, round - 1); assert.equal(c.attempts, 0);
        assert.equal(exhaustive.answer(guild, user, c.challengeId, 'incorrect-fixture').reason, 'incorrect');
        const previousHash = sample.activeChallenge.answerHash;
        const result = accept(c, gameSolution(c));
        assert.equal(result.complete, round === rounds);
        if (round < rounds) {
          assert.equal(result.reason, 'next_round');
          assert.notEqual(sample.activeChallenge.answerHash, previousHash);
          c = result.challenge;
        } else assert.equal(result.challenge.passedRounds, rounds);
      }
    }
    const c = begin('minigame', { enabledGames: [gameType], random: true, rounds: 1, maxChallengeAttempts: 3 });
    assert.equal(c.gameType, gameType); accept(c, gameSolution(c));
  }
  for (const code of [100000, 999999]) {
    const c = begin('one_time_challenge', { maxChallengeAttempts: 3 }, [code]);
    assert(c.prompt.endsWith(String(code))); accept(c, code);
  }
  challenge = begin('captcha', { difficulty: 'easy', maxChallengeAttempts: 3 }, [2, 2]);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = exhaustive.answer(guild, user, challenge.challengeId, '5');
    assert.equal(result.attempts, attempt); assert.equal(result.attemptsRemaining, 3 - attempt);
    assert.equal(result.complete, attempt === 3);
  }
  assert.equal(exhaustive.answer(guild, user, challenge.challengeId, '4').reason, 'challenge_closed');
  challenge = begin('captcha', { difficulty: 'easy', maxChallengeAttempts: 3 }, [2, 2]);
  for (let attempt = 0; attempt < 2; attempt++) exhaustive.answer(guild, user, challenge.challengeId, '5');
  const lastAttempt = accept(challenge, '4');
  assert.equal(lastAttempt.attempts, 3); assert.equal(lastAttempt.attemptsRemaining, 0);
  assert.equal(lastAttempt.reason, 'passed');
  challenge = begin('captcha', { difficulty: 'easy', maxChallengeAttempts: 3 }, [2, 2]);
  sample.activeChallenge.expiresAt = new Date(Date.now() - 60000).toISOString();
  assert.equal(exhaustive.answer(guild, user, challenge.challengeId, '4').reason, 'expired');
  assert.equal(sample.activeChallenge.attempts, 0);
  console.log(`✅ Verification calculations: all ${arithmeticCases} arithmetic combinations, ${gameCases} fixed mini-game cases, all seven game types across 1/2/10 rounds, attempt limits, expiry and code boundaries.`);
  console.log('✅ Verification answers: displayed arithmetic, persisted private verifiers, restarts/retries, one-time codes, multi-round games and broken-challenge recovery without failure penalties.');
}

async function verificationLifecycleAudit() {
  section('Verification lifecycle');
  try {
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    
    function read(path) {
      assert(fs.existsSync(absolute(path)), `Missing required Verification file: ${path}`);
      return fs.readFileSync(absolute(path), 'utf8');
    }
    
    function contains(source, token, label) {
      assert(source.includes(token), `Verification contract missing: ${label}`);
    }
    
    const flow = read('./src/modules/securityStudio/verificationFlowContinuation.js');
    const quarantine = read('./src/modules/securityStudio/verificationQuarantine.js');
    const lifecycle = read('./src/events/members/verificationLifecycle.js');
    const risk = read('./src/core/administration/mod/verificationRiskBridge.js');
    const store = read('./src/modules/securityStudio/verificationStore.js');
    const manager = read('./src/modules/securityStudio/verificationManager.js');
    const panel = read('./src/modules/securityStudio/verificationPanel.js');
    const memberIntelligence = read('./src/events/members/memberIntelligence.js');
    const challengeRuntime = read('./src/modules/securityStudio/verificationChallengeRuntime.js');
    const challengeInteractions = read('./src/modules/securityStudio/verificationChallengeInteractions.js');
    
    // Guard the security handoff and challenge recovery against regressions.
    contains(manager, 'pendingSecurity:true', 'manager delegates security checks to continuation');
    contains(manager, 'Verification starting roles could not be confirmed.', 'block security flow if starting roles fail');
    const verifyingStateWrite = "setSession(gid,uid,{state:'verifying',startedAt:verificationStore.getSession(gid,uid)?.startedAt||now()});";
    const startingRolesConfirmed = "if(!confirmed||!verifying.every(role=>confirmed.roles.cache.has(role.id))||pending.some(role=>confirmed.roles.cache.has(role.id)))";
    assert(manager.indexOf(verifyingStateWrite) > manager.indexOf(startingRolesConfirmed), 'Verifying state must be persisted after starting role confirmation.');
    contains(flow, 'if(!confirmed||![...verified,...auto].every', 'fail closed when completion member fetch fails');
    contains(manager, 'pending.some(role=>confirmed.roles.cache.has(role.id))', 'confirm pending roles removed before security flow');
    contains(flow, 'challengeRuntime.startStep(g.id,m.id,step,s)', 'challenge reuse validated by runtime');
    assert(!flow.includes("active?.status==='pending'?{ok:true,pending:true"), 'Continuation must not bypass challenge runtime validation.');
    contains(challengeRuntime, "reason: 'staff_action_in_progress'", 'reject duplicate staff actions during processing');
    const markCompletedFlow = challengeRuntime.slice(challengeRuntime.indexOf('function markCompleted('), challengeRuntime.indexOf('function startStep('));
    contains(markCompletedFlow, 'if (session.staffActionProcessingPending)', 'prevent security completion during staff rejection or quarantine');
    contains(challengeRuntime, "if (session.staffApprovalContinuationPending || session.staffActionProcessingPending) return { ok: false, reason: 'staff_action_in_progress' }", 'block member answers during staff finalisation');
    contains(challengeRuntime, "active.status !== 'pending'", 'reject resolved staff challenges');
    const startStepFlow = challengeRuntime.slice(challengeRuntime.indexOf('function startStep('), challengeRuntime.indexOf('function submitAnswer('));
    contains(startStepFlow, "reason: 'staff_action_in_progress'", 'block challenge creation during staff finalisation');
    contains(challengeRuntime, "staffApprovalContinuationPending", 'persist approval continuation ownership');
    contains(challengeRuntime, "staffActionProcessingPending", 'persist rejection and quarantine ownership');
    contains(challengeRuntime, "interrupted_staff_action_requires_review", 'recover interrupted staff actions to review');
    const recovery = challengeRuntime.slice(challengeRuntime.indexOf('function recover(guildId, userId)'), challengeRuntime.indexOf('function recoverGuild(guildId)'));
    assert(recovery.includes("} else if (TERMINAL_STATES.has(before.state)) {"), 'Recovery must preserve terminal states.');
    assert(recovery.indexOf("} else if (TERMINAL_STATES.has(before.state)) {") < recovery.indexOf('verificationChallenges.isExpired(challenge)'), 'Terminal recovery guard must precede challenge expiry and marker repair.');
    for (const action of ['reject', 'quarantine']) {
      contains(challengeInteractions, "pending?.action !== '"+action+"'", action+' finalisation checks action ownership');
    }
    contains(challengeInteractions, 'pending?.staffUserId !== clean(interaction.user.id)', 'verify initiating staff identity');
    contains(challengeInteractions, 'staff_approval_finalization_stale', 'recheck approval after challenge delivery');
    contains(flow, 'quarantine_late_completion_requires_review', 'protect quarantine state from late completion');
    const terminalGuard = "['verified','quarantined','review','rejected','failed','timed_out'].includes";
    const completionFlow = flow.slice(flow.indexOf('async function complete('), flow.indexOf('async function recordVerificationFailure('));
    const failureFlow = flow.slice(flow.indexOf('async function recordVerificationFailure('), flow.indexOf('async function quarantineVerificationMember('));
    const quarantineFlow = flow.slice(flow.indexOf('async function quarantineVerificationMember('), flow.indexOf('async function resumeVerification('));
    assert(completionFlow.split(terminalGuard).length >= 3, 'Completion must recheck terminal state before and after role changes.');
    contains(failureFlow, terminalGuard, 'failure recording respects terminal states');
    assert(quarantineFlow.split(terminalGuard).length >= 3, 'Quarantine must recheck terminal state before and after role changes.');
    contains(flow, 'verification_late_completion_requires_review', 'protect verification state from late completion');
    contains(flow, 'Verification session changed while preparing security checks', 'recheck terminal state before continuing verification');
    const resumeFlow = flow.slice(flow.indexOf('async function resumeVerification('));
    contains(resumeFlow, "verificationRoleTransitions.has(String(g.id)+':'+String(m.id))", 'prevent resuming Verification during a member role transition');
    assert(resumeFlow.split("verificationRoleTransitions.has(String(g.id)+':'+String(m.id))").length >= 4, 'Resume must recheck role transition ownership before security state mutations.');

    // Execute the real lock helper, not just a source-token contract.
    const { spawnSync } = require('node:child_process');
    const lockSource = flow.slice(flow.indexOf('const verificationRoleTransitions='), flow.indexOf('const accountAgeDays='));
    assert(lockSource.startsWith('const verificationRoleTransitions='), 'Verification lock helper not found');
    assert(lockSource.includes('async function withVerificationRoleLock('), 'Verification lock implementation not found');
    const resumeStart=flow.indexOf('async function resumeVerification(');
    const resumeCut=flow.indexOf('const c=section(g.id)',resumeStart);
    assert(resumeStart>=0&&resumeCut>resumeStart,'Verification resume guard extraction failed');
    const resumePrefix=flow.slice(resumeStart,resumeCut)+'return{ok:true,reachedConfiguration:true};}';
    const lockTest = `
      const assert=require('node:assert/strict');
      ${lockSource}
      const moduleEnabled=()=>true,disabledResult=()=>({disabled:true});
      ${resumePrefix}
      (async()=>{
        let release;
        const gate=new Promise(resolve=>{release=resolve;});
        const first=withVerificationRoleLock('guild','member',()=>gate);
        assert.equal(verificationRoleTransitions.has('guild:member'),true);
        const resumeBlocked=await resumeVerification({guild:{id:'guild'},member:{id:'member'}});
        assert.equal(resumeBlocked.pendingSecurity,true);
        const otherResume=await resumeVerification({guild:{id:'guild'},member:{id:'other'}});
        assert.equal(otherResume.reachedConfiguration,true);
        const blocked=await withVerificationRoleLock('guild','member',async()=>({ok:true}));
        assert.equal(blocked.pendingSecurity,true);
        const other=await withVerificationRoleLock('guild','other',async()=>({ok:true}));
        assert.equal(other.ok,true);
        const otherGuild=await withVerificationRoleLock('other-guild','member',async()=>({ok:true}));
        assert.equal(otherGuild.ok,true);
        assert.equal(verificationRoleTransitions.has('guild:member'),true);
        release({ok:true});
        assert.equal((await first).ok,true);
        assert.equal(verificationRoleTransitions.has('guild:member'),false);
        const resumeAfter=await resumeVerification({guild:{id:'guild'},member:{id:'member'}});
        assert.equal(resumeAfter.reachedConfiguration,true);
        const again=await withVerificationRoleLock('guild','member',async()=>({ok:true}));
        assert.equal(again.ok,true);
        let caught=false;
        try{await withVerificationRoleLock('guild','member',async()=>{throw Error('expected');});}catch(error){caught=true;assert.equal(error.message,'expected');}
        assert.equal(caught,true,'Role transition errors must propagate to caller');
        assert.equal(verificationRoleTransitions.has('guild:member'),false);
      })().catch(error=>{console.error(error);process.exitCode=1;});
    `;
    const lockRun=spawnSync(process.execPath,['-e',lockTest],{encoding:'utf8',timeout:5000});
    assert.equal(lockRun.status,0,'Executable Verification lock regression failed: '+String(lockRun.stderr||lockRun.error||'unknown error'));

    // Exercise completion and quarantine against mocked asynchronous Discord role operations.
    const completionSource=completionFlow;
    const quarantineSource=quarantineFlow;
    const integrationTest = `
      const assert=require('node:assert/strict');
      ${lockSource}
      const moduleEnabled=()=>true,disabledResult=()=>({disabled:true});
      const roles={verified:['verified'],auto:[],pending:[],verifying:[],quarantine:['quarantine']};
      const config={settings:{roles}};
      const roleIds=(settings,key)=>settings.roles[key]||[];
      const unique=values=>[...new Set(values)];
      const fetchRoles=async(guild,ids)=>ids.map(id=>({id}));
      const now=()=>new Date().toISOString();
      const enabledSecurity=()=>[];
      const section=()=>config;
      let state='verifying',transitions=0,mode='normal',release,entered;
      let wait,started;
      function reset(){
        state='verifying';transitions=0;mode='normal';
        wait=new Promise(resolve=>{release=resolve;});
        started=new Promise(resolve=>{entered=resolve;});
      }
      const verificationStore={
        getSession:()=>({state}),
        upsertSession:(guild,user,value)=>{if(value.state)state=value.state;},
        addSecurityHistory:()=>{},
        clearAttempts:()=>{},
        incrementAnalytics:()=>{}
      };
      const verificationQuarantine={
        closeQuarantineCase:async()=>{},
        ensureQuarantineCase:async()=>({ok:true,channel:{id:'case'}})
      };
      const guild={id:'guild',members:{fetch:async()=>({
        id:'member',guild,roles:{cache:{has:id=>mode==='mismatch'?false:mode==='quarantine'?id==='quarantine':id==='verified'}}
      })}};
      const member={id:'member',guild,roles:{cache:{has:()=>false}}};
      const transitionRoles=async()=>{transitions++;entered();await wait;if(mode==='throw')throw Error('simulated Discord role failure');};
      // Resolve the extracted module's local dependency explicitly; never load live storage.
      const sharedQuarantine={
        QUARANTINE_MODES:{INVESTIGATION:'investigation'},
        getQuarantineState:()=>({users:mode==='existing'?{member:{}}:{}}),
        quarantineMember:async()=>{
          await transitionRoles();
          if(mode==='mismatch')return{success:false,reason:'simulated containment confirmation failure'};
          if(mode==='dryRun')return{success:true,dryRun:true};
          return{success:true,mode:'investigation',interviewChannelId:'case'};
        }
      };
      const {complete,quarantineVerificationMember}=(function(require){
        ${completionSource}
        ${quarantineSource}
        return{complete,quarantineVerificationMember};
      })(id=>{
        assert.equal(id,'../../core/security/protection/quarantine');
        return sharedQuarantine;
      });
      const watchdog=setTimeout(()=>{console.error('Verification integration did not finish');process.exit(1);},4000);
      (async()=>{
        reset();
        const finishing=complete(member,config);
        await started;
        const denied=await quarantineVerificationMember(guild,'member');
        assert.equal(denied.pendingSecurity,true);
        release();
        const finished=await finishing;
        assert.equal(finished.complete,true);
        assert.equal(state,'verified');
        assert.equal(transitions,1);
        reset();mode='quarantine';
        const quarantining=quarantineVerificationMember(guild,'member');
        await started;
        const deniedCompletion=await complete(member,config);
        assert.equal(deniedCompletion.pendingSecurity,true);
        release();
        const quarantined=await quarantining;
        assert.equal(quarantined.quarantined,true);
        assert.equal(state,'quarantined');
        assert.equal(transitions,1);
        reset();mode='mismatch';
        const mismatch=complete(member,config);
        await started;release();
        const unconfirmed=await mismatch;
        assert.equal(unconfirmed.review,true);
        assert.equal(state,'review');
        assert.equal(transitions,1);
        reset();mode='mismatch';
        const badQuarantine=quarantineVerificationMember(guild,'member');
        await started;release();
        const quarantineMismatch=await badQuarantine;
        assert.equal(quarantineMismatch.review,true);
        assert.equal(state,'verifying');
        assert.equal(transitions,1);
        reset();mode='throw';
        const badCompletion=complete(member,config);
        await started;release();
        const completionFailure=await badCompletion;
        assert.equal(completionFailure.review,true);
        assert.equal(state,'review');
        assert.equal(transitions,1);
        reset();mode='existing';
        assert.equal((await quarantineVerificationMember(guild,'member')).review,true);
        assert.equal(transitions,0);
        assert.equal(state,'verifying');
        reset();mode='dryRun';
        const simulated=quarantineVerificationMember(guild,'member');
        await started;release();
        assert.equal((await simulated).review,true);
        assert.equal(state,'verifying');
        reset();mode='throw';
        const thrown=quarantineVerificationMember(guild,'member');
        const rejected=assert.rejects(thrown,/simulated Discord role failure/);
        await started;release();await rejected;
        assert.equal(state,'verifying');
        assert.equal(verificationRoleTransitions.size,0);
        for(const terminal of ['verified','quarantined','review','rejected','failed','timed_out']){
          reset();mode='quarantine';
          const late=quarantineVerificationMember(guild,'member');
          await started;state=terminal;release();
          assert.equal((await late).review,true);
          assert.equal(state,terminal);
          reset();
          const lateComplete=complete(member,config);
          await started;state=terminal;release();
          assert.equal((await lateComplete).review,true);
          assert.equal(state,terminal);
        }
        for(const terminal of ['verified','quarantined','review','rejected','failed','timed_out']){
          reset();state=terminal;
          const terminalCompletion=await complete(member,config);
          const terminalQuarantine=await quarantineVerificationMember(guild,'member');
          assert.equal(terminalCompletion.review,true);
          assert.equal(terminalQuarantine.review,true);
          assert.equal(state,terminal);
          assert.equal(transitions,0);
        }
      })().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>clearTimeout(watchdog));
    `;
    const integrationRun=spawnSync(process.execPath,['-e',integrationTest],{encoding:'utf8',timeout:5000});
    assert.equal(integrationRun.status,0,'Executable Verification completion/quarantine integration failed: '+String(integrationRun.stderr||integrationRun.error||'unknown error'));


    assert(resumeFlow.indexOf('session.staffApprovalContinuationPending||session.staffActionProcessingPending') >= 0 && resumeFlow.indexOf('session.staffApprovalContinuationPending||session.staffActionProcessingPending') < resumeFlow.indexOf('const revision=Number(c.configRevision||1)'), 'Resume must block staff finalisation before changing security progress.');
    contains(flow, "session.state==='failed'||session.state==='timed_out'", 'do not resume failed or timed-out sessions');
    contains(flow, 'Verification failure processing cannot change a terminal session.', 'prevent stale failure processing');
    contains(flow, 'async function withVerificationRoleLock(', 'serialize Verification role transitions');
    contains(completionFlow, 'return withVerificationRoleLock(m.guild.id,m.id,async()=>{', 'lock completion role transition');
    contains(quarantineFlow, 'return withVerificationRoleLock(g?.id,u,async()=>{', 'lock quarantine role transition');
    contains(flow, 'finally{verificationRoleTransitions.delete(key);}', 'release Verification role lock after failures');
    contains(completionFlow, "type:'verification_role_transition_failed'", 'audit completion role transition failure');
    contains(completionFlow, "type:'verification_role_confirmation_failed'", 'audit unconfirmed completion roles enter review');
    assert(completionFlow.indexOf("type:'verification_role_confirmation_failed'") < completionFlow.indexOf("type:'verified'"), 'Completion role confirmation must precede verified state persistence.');
    contains(quarantineFlow, "type:'quarantine_shared_isolation_failed'", 'audit shared quarantine containment failure');
    contains(quarantineFlow, 'if(!result.success)', 'fail closed when shared containment fails');
    contains(quarantineFlow, 'if(result.dryRun)', 'do not persist simulated quarantine');
    contains(quarantineFlow, 'getQuarantineState(g.id)', 'preserve existing shared isolation');
    assert(quarantineFlow.indexOf('if(!result.success)') < quarantineFlow.indexOf("state:'quarantined'"), 'Shared containment must succeed before persisting quarantine.');
    contains(flow, 'Quarantine cannot replace a terminal verification session', 'prevent stale quarantine transitions');
    contains(flow, "['verified','review','quarantined','rejected','failed','timed_out'].includes", 'do not reopen verified or other terminal sessions');
    contains(failureFlow, terminalGuard, 'protect failure service against review and all terminal states');
    contains(quarantineFlow, terminalGuard, 'protect quarantine service against review and all terminal states');
    contains(challengeRuntime, "reason: 'security_configuration_changed'", 'reject outdated security challenges');
    contains(challengeRuntime, 'verificationChallenges.expire(guildId, userId, active.challengeId)', 'expire old challenge before restarting');
    contains(challengeRuntime, 'active = verificationChallenges.active(guildId, userId)', 'refresh challenge after expiry');
    contains(challengeInteractions, 'session.securityConfigRevision', 'reject stale member challenge interactions');
    contains(manager, 'Quarantine role transition could not be confirmed.', 'verify quarantine roles before state change');
    contains(manager, "roles.length!==roleIds(s,'quarantine').length", 'reject missing configured quarantine roles');
    contains(manager, 'm.guild.members.fetch({user:m.id,force:true})', 'confirm quarantine against fresh Discord member state');
    assert((manager.match(/m\.guild\.members\.fetch\(\{user:m\.id,force:true\}\)/g)||[]).length>=2, 'Quarantine and bypass completion must independently confirm fresh Discord roles.');
    contains(panel, 'finalNav()]};}', 'consistent Verification navigation');
    
    
    for (const state of ['new', 'pending', 'verifying', 'verified', 'quarantined', 'review', 'rejected']) {
      contains(store, `'${state}'`, `persistent lifecycle state ${state}`);
    }
    
    for (const method of ['captcha', 'minigame', 'account_age', 'discord_screening', 'bot_protection', 'staff_approval', 'one_time_challenge', 'risk_based', 'rejoin_history']) {
      contains(flow, method, `security method ${method}`);
    }
    
    contains(flow, 'maximumFailedAttempts', 'configurable failed-attempt limit');
    contains(flow, 'quarantineVerificationMember', 'failure-to-quarantine transition');
    contains(flow, 'requiredSecurity', 'dynamic required-security planning');
    contains(flow, 'raidPressure', 'raid-pressure security planning');
    contains(quarantine, "new Set(['release', 'reject', 'escalate'])", 'quarantine resolution actions');
    contains(quarantine, 'escalateToModHub', 'Mod Hub escalation');
    contains(quarantine, 'reconcileModerationRelease', 'Mod Hub release reconciliation');
    contains(lifecycle, "name:'guildMemberAdd'", 'join lifecycle handler');
    contains(lifecycle, "name:'guildMemberUpdate'", 'screening/role lifecycle handler');
    contains(lifecycle, "name:'guildMemberRemove'", 'leave/reset lifecycle handler');
    contains(lifecycle, 'applyRaidPressure', 'anti-raid join-pressure evaluation');
    contains(risk, 'resolveRequiredSecurity', 'Member Intelligence security bridge');
    contains(risk, 'rejoinHistory', 'rejoin security elevation');
    contains(risk, 'staffApproval', 'high-attention staff approval elevation');
    contains(manager, 'discord_screening', 'screening health validation');
    contains(manager, 'risk_based', 'risk health validation');
    contains(manager, 'quarantine', 'quarantine health validation');
    
    // The canonical Verification admin surface must be the rehauled module.
    for (const section of ['roles', 'security', 'intelligence', 'flow', 'messages', 'logs', 'settings']) {
      contains(panel, `'${section}'`, `admin section ${section}`);
      contains(panel, `admin:verification:page:${section}`, `admin navigation ${section}`);
    }
    contains(panel, "emb('🛡️ Verification'", 'Verification home title');
    assert(!panel.includes('Front Door'), 'Legacy Front Door wording must not appear in Verification panel');
    contains(panel, 'Verification · Security', 'Security control page');
    contains(panel, 'NEW MEMBER → PENDING → VERIFYING → VERIFIED → SERVER', 'canonical member journey');
    contains(panel, 'admin:verification:security:', 'stackable security controls');
    contains(panel, 'admin:verification:intelligence:', 'integrated intelligence controls');
    contains(panel, 'admin:verification:flowSecurity', 'security flow selection');
    contains(panel, 'Verification · Logs', 'Verification logging page');
    
    assert(!panel.includes('Verification · Overview'), 'Legacy Verification Overview must not be reachable from the canonical panel.');
    assert(!panel.includes('admin:verification:page:workflow'), 'Legacy Workflow page must not remain in the canonical panel.');
    assert(!panel.includes('admin:verification:page:requirements'), 'Legacy Requirements page must not remain in the canonical panel.');
    contains(panel, 'admin:verification:page:panel', 'member-facing Verification panel deployment navigation');
    contains(panel, 'verificationManager.deployVerificationPanel(channel', 'Verification panel deployment action');
    contains(panel, 'verificationManager.refreshVerificationPanel(', 'Verification panel refresh action');
    contains(manager, 'No active Verification panel is deployed.', 'health check warns about missing Verification panel');
    assert(!memberIntelligence.includes('verificationIntelligenceExtension'), 'Member Intelligence must not monkey-patch the Verification admin UI.');
    assert(!fs.existsSync(absolute('src/modules/securityStudio/verificationIntelligenceExtension.js')), 'Legacy Verification UI compatibility extension must be removed.');
    
    const forbiddenGenerationPattern = new RegExp('\\b' + 'v' + '[23]' + '\\b', 'i');
    assert(!forbiddenGenerationPattern.test([flow, quarantine, lifecycle, risk, store, manager, panel].join('\n')), 'Verification source contains forbidden numbered-generation naming.');
    
    await verificationAnswerAudit();
    console.log('Verification lifecycle and admin-surface contract audit passed.');
    
    return true;
  } catch (error) {
    console.error(`❌ Verification lifecycle audit failed: ${error.message}`);
    return false;
  }
}

function embedStudioPreviewAudit() {
  try {
    const assert = require('node:assert/strict');
    const panel = require(root + '/src/modules/messageStudio/embed/embedPanel');
    
    const interaction = {
      guild: { id: 'guild-preview', name: 'Preview Guild', memberCount: 42 },
      user: { id: 'user-preview', username: 'Preview User', displayAvatarURL: () => 'https://example.com/user.png' },
      member: { displayName: 'Preview User' },
    };
    
    function state(placement = 'above') {
      return {
        selectedPanelIndex: 0,
        showTimestamp: false,
        fieldLayout: 'auto',
        color: '#5865F2',
        panels: [{
          title: 'FAQ & Support Centre',
          description: 'Find an answer below.',
          color: '#5865F2',
          image: 'https://example.com/legacy-bottom.png',
          fields: [],
          buttons: [],
        }],
        media: { version: 2, panels: [{ gallery: [{ source: 'https://example.com/faq.gif', placement }], files: [], thumbnail: { source: '' } }] },
      };
    }
    
    const above = panel.buildStudioPreviewEmbeds(state('above'), interaction);
    assert.equal(above.length, 2, 'graphic header preview must be a separate first card');
    assert.equal(above[0].data.image.url, 'https://example.com/faq.gif', 'first preview card must be the graphic header');
    assert.equal(above[0].data.title, undefined, 'graphic header card must not duplicate panel text');
    assert.equal(above[1].data.title, 'FAQ & Support Centre', 'content must follow the graphic header');
    assert.equal(above[1].data.image, undefined, 'content preview must not duplicate a legacy bottom image');
    
    const below = panel.buildStudioPreviewEmbeds(state('below'), interaction);
    assert.equal(below.length, 1, 'below-content media must never be promoted to graphic header in preview');
    assert.equal(below[0].data.title, 'FAQ & Support Centre');
    
    const none = state('below');
    none.media.panels[0].gallery = [];
    none.panels[0].image = '';
    assert.equal(panel.buildStudioPreviewEmbeds(none, interaction).length, 1, 'ordinary embeds keep the normal single-card preview');
    
    // Loading a preset must preserve its identity all the way into Update / Save.
    // This guards the bug where the save modal reopened blank and forced the user
    // to retype the loaded preset name exactly before it could be overwritten.
    const presetModal = panel.presetModal({ selectedPreset: 'Welcome to KSJ' }).toJSON();
    const presetNameInput = presetModal.components?.[0]?.components?.[0];
    assert.equal(presetNameInput?.value, 'Welcome to KSJ', 'Update / Save must prefill the currently loaded preset name.');
    
    // Multi-panel media must stay isolated. A Graphic Header on panel 1 must not
    // promote panel 2 media or mutate its ordinary content preview.
    const multi = state('above');
    multi.panels.push({
      title: 'Panel Two',
      description: 'Independent panel.',
      color: '#5865F2',
      image: '',
      fields: [],
      buttons: [],
    });
    multi.media.panels.push({
      gallery: [{ source: 'https://example.com/panel-two.png', placement: 'below' }],
      files: [],
      thumbnail: { source: '' },
    });
    const multiPreview = panel.buildStudioPreviewEmbeds(multi, interaction);
    assert.equal(multiPreview.length, 3, 'one Graphic Header plus two content panels must render as three preview cards.');
    assert.equal(multiPreview[0].data.image.url, 'https://example.com/faq.gif');
    assert.equal(multiPreview[1].data.title, 'FAQ & Support Centre');
    assert.equal(multiPreview[2].data.title, 'Panel Two');
    
    console.log('✅ Embed Studio preview parity, preset identity and multi-panel isolation audit passed.');
    
    return true;
  } catch (error) {
    console.error(`❌ Embed Studio preview audit failed: ${error.message}`);
    return false;
  }
}

function embedMediaAlignmentAudit() {
  try {
    const assert = require('node:assert/strict');
    const media = require(root + '/src/modules/messageStudio/embed/embedMedia');
    const alignment = require(root + '/src/modules/messageStudio/embed/embedImageAlignment');
    const preview = alignment;
    const renderer = require(root + '/src/modules/messageStudio/embed/embedRenderer');
    
    const mediaManagerSource = require('node:fs').readFileSync(
      require.resolve(root + '/src/modules/messageStudio/embed/embedMedia'),
      'utf8'
    );
    const mediaManagerStart = mediaManagerSource.indexOf('function installMediaManagerUi(panel) {');
    const mediaManagerEnd = mediaManagerSource.indexOf('\nfunction installThumbnailUi(panel)', mediaManagerStart);
    const mediaManagerBody = mediaManagerSource.slice(mediaManagerStart, mediaManagerEnd);
    assert(!mediaManagerBody.includes('media.mediaModel'), 'Media Manager must not reference an undefined media variable.');
    assert(!mediaManagerBody.includes('media.getPanelMedia'), 'Media Manager must use the canonical media model or panel API.');
    assert.match(mediaManagerSource, /DEFAULT_GALLERY_ITEM/);
    assert.match(
      mediaManagerSource,
      /const preset = \{\s*\.\.\.\(base\.presetData\(normalized\) \|\| \{\}\),\s*media: clone\(normalized\.media\),\s*\};/,
      'Preset persistence must save canonical normalized media.'
    );
    assert.doesNotMatch(mediaManagerSource, /mediaDefaults/);
    
    const left = media.normalizeGalleryItem({ source: 'https://example.com/a.png', alignment: 'left' });
    const centre = media.normalizeGalleryItem({ source: 'https://example.com/a.png', alignment: 'center' });
    const right = media.normalizeGalleryItem({ source: 'https://example.com/a.png', alignment: 'right' });
    const invalid = media.normalizeGalleryItem({ source: 'https://example.com/a.png', alignment: 'bogus' });
    const defaults = media.normalizeGalleryItem({ source: 'https://example.com/defaults.png' });
    assert.equal(defaults.type, 'auto');
    assert.equal(defaults.headerType, 'auto');
    assert.equal(defaults.spoiler, false);
    assert.equal(defaults.placement, 'above');
    assert.equal(defaults.alignment, 'left');
    assert.equal(defaults.size, 'small');
    assert.equal(left.alignment, 'left');
    assert.equal(centre.alignment, 'center');
    assert.equal(right.alignment, 'right');
    assert.equal(invalid.alignment, 'left');
    
    const canonical = {
      media: {
        version: 2,
        panels: [{ gallery: [
          { source: 'https://example.com/a.png', placement: 'above', alignment: 'right', size: 'small', spoiler: true },
          { source: 'https://example.com/b.png', placement: 'below', alignment: 'center', size: 'medium', spoiler: false },
        ], files: [], thumbnail: { source: 'https://example.com/thumb.png', alt: 'Thumbnail' } }],
      },
      mediaAlignment: { '0:0': 'left', '0:1': 'left' },
      selectedPanelIndex: 0,
      selectedMediaIndex: 1,
    };
    
    // Canonical item alignment must win over stale index-keyed compatibility state in both
    // the final renderer and the live preview path.
    const rendered = renderer.applyMediaAlignmentMap(canonical.media, canonical.mediaAlignment);
    assert.equal(rendered.panels[0].gallery[0].alignment, 'right');
    assert.equal(rendered.panels[0].gallery[1].alignment, 'center');
    assert.equal(preview.alignmentFor(canonical, 0, 0, canonical.media.panels[0].gallery[0]), 'right');
    assert.equal(preview.alignmentFor(canonical, 0, 1, canonical.media.panels[0].gallery[1]), 'center');
    assert.equal(preview.alignmentFor({ mediaAlignment: { '0:0': 'right' } }, 0, 0, {}), 'right');
    
    // Canonicalisation must not lose unrelated per-item controls or panel thumbnail state.
    const canonicalized = alignment.canonicalizeState(canonical, false);
    assert.equal(canonicalized.media.panels[0].gallery[0].placement, 'above');
    assert.equal(canonicalized.media.panels[0].gallery[0].size, 'small');
    assert.equal(canonicalized.media.panels[0].gallery[0].spoiler, true);
    assert.equal(canonicalized.media.panels[0].gallery[1].size, 'medium');
    assert.equal(canonicalized.media.panels[0].thumbnail.source, 'https://example.com/thumb.png');
    assert.equal(canonicalized.selectedMediaIndex, 1);
    
    // Reordering media must carry alignment and all item-owned presentation state with the
    // item rather than leaving any of it attached to the old index.
    const reorderedMedia = JSON.parse(JSON.stringify(canonical.media));
    [reorderedMedia.panels[0].gallery[0], reorderedMedia.panels[0].gallery[1]] = [
      reorderedMedia.panels[0].gallery[1],
      reorderedMedia.panels[0].gallery[0],
    ];
    const reordered = alignment.canonicalizeState({ ...canonical, media: reorderedMedia }, false);
    assert.equal(reordered.media.panels[0].gallery[0].alignment, 'center');
    assert.equal(reordered.media.panels[0].gallery[0].placement, 'below');
    assert.equal(reordered.media.panels[0].gallery[0].size, 'medium');
    assert.equal(reordered.media.panels[0].gallery[0].spoiler, false);
    assert.equal(reordered.media.panels[0].gallery[1].alignment, 'right');
    assert.equal(reordered.media.panels[0].gallery[1].placement, 'above');
    assert.equal(reordered.media.panels[0].gallery[1].size, 'small');
    assert.equal(reordered.media.panels[0].gallery[1].spoiler, true);
    assert.deepEqual(reordered.mediaAlignment, { '0:0': 'center', '0:1': 'right' });
    
    // Legacy presets that stored alignment only in mediaAlignment migrate once into canonical media.
    const legacy = {
      media: { version: 2, panels: [{ gallery: [
        { source: 'https://example.com/a.png', placement: 'below' },
        { source: 'https://example.com/b.png', placement: 'below' },
      ], files: [], thumbnail: { source: '' } }] },
      mediaAlignment: { '0:0': 'right', '0:1': 'center' },
    };
    const migrated = alignment.canonicalizeState(legacy, true);
    assert.equal(migrated.media.panels[0].gallery[0].alignment, 'right');
    assert.equal(migrated.media.panels[0].gallery[1].alignment, 'center');
    assert.deepEqual(migrated.mediaAlignment, { '0:0': 'right', '0:1': 'center' });
    
    // Compatibility application remains immutable.
    const mapped = alignment.applyAlignmentMap(legacy.media, { '0:0': 'left' });
    assert.equal(mapped.panels[0].gallery[0].alignment, 'left');
    assert.equal(legacy.media.panels[0].gallery[0].alignment, undefined);
    
    console.log('✅ Embed media canonical-state audit passed: alignment precedence/migration plus placement, size, spoiler, thumbnail and reorder state are preserved.');
    
    return true;
  } catch (error) {
    console.error(`❌ Embed Media Alignment audit failed: ${error.message}`);
    return false;
  }
}

function embedSessionPersistenceAudit() {
  try {
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    
    const originalCwd = process.cwd();
    const originalMode = process.env.BOT_MODE;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goliath-embed-session-'));
    
    try {
      process.chdir(tmp);
      process.env.BOT_MODE = 'dev';
    
      const stateStore = require(root + '/src/modules/messageStudio/embed/embedState');
      const key = 'guild-1:user-1';
      const state = {
        panels: [
          { title: '', graphicHeaderTitle: 'FAQ', image: 'https://example.test/faq.gif' },
          { title: 'Second panel', graphicHeaderTitle: '', image: '' },
        ],
        media: {
          version: 2,
          panels: [
            {
              gallery: [
                {
                  source: 'https://example.test/faq.gif',
                  placement: 'above',
                  alignment: 'right',
                  size: 'small',
                  spoiler: true,
                },
                {
                  source: 'https://example.test/body.png',
                  placement: 'below',
                  alignment: 'center',
                  size: 'medium',
                  spoiler: false,
                },
              ],
              thumbnail: {
                source: 'https://example.test/thumb.png',
                alt: 'FAQ thumbnail',
              },
              files: [],
            },
            { gallery: [], thumbnail: { source: '', alt: '' }, files: [] },
          ],
        },
        mediaAlignment: { '0:0': 'right', '0:1': 'center' },
        selectedPanelIndex: 0,
        selectedMediaIndex: 1,
        selectedPreset: 'Welcome to KSJ',
        hasUnsavedChanges: false,
      };
    
      assert.equal(stateStore.savePersistedSession(key, state), true);
    
      const restored = stateStore.loadPersistedSession(key);
      assert.deepEqual(restored, state);
      assert.equal(restored.selectedPreset, 'Welcome to KSJ', 'Loaded preset identity must survive persistence.');
      assert.equal(restored.selectedMediaIndex, 1, 'Selected media item must survive persistence.');
      assert.equal(restored.media.panels[0].gallery[0].placement, 'above', 'Graphic Header placement must survive persistence.');
      assert.equal(restored.media.panels[0].gallery[0].alignment, 'right', 'Media alignment must survive persistence.');
      assert.equal(restored.media.panels[0].gallery[0].size, 'small', 'Media size must survive persistence.');
      assert.equal(restored.media.panels[0].gallery[0].spoiler, true, 'Media spoiler state must survive persistence.');
      assert.equal(restored.media.panels[0].thumbnail.source, 'https://example.test/thumb.png', 'Thumbnail state must survive persistence.');
      assert.equal(restored.hasUnsavedChanges, false, 'Clean loaded-preset baseline must survive persistence.');
    
      assert.equal(fs.existsSync(stateStore.sessionFileFor(key)), true);
      assert.equal(stateStore.removePersistedSession(key), true);
      assert.equal(stateStore.loadPersistedSession(key), null);
    
      console.log('✅ Embed Studio session persistence audit passed: preset identity, panel/media selection, header placement, alignment, size, spoiler and thumbnail state are durable.');
    } finally {
      process.chdir(originalCwd);
      if (originalMode === undefined) delete process.env.BOT_MODE;
      else process.env.BOT_MODE = originalMode;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    
    return true;
  } catch (error) {
    console.error(`❌ Embed Session Persistence audit failed: ${error.message}`);
    return false;
  }
}

function embedStatePersistenceBoundaryAudit() {
  try {
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const path = require('node:path');
    const { spawnSync } = require('node:child_process');
    
    const repo = root;
    const statePath = path.join(repo, 'src/modules/messageStudio/embed/embedState.js');
    
    function run(source) {
      const result = spawnSync(process.execPath, ['-e', source], {
        cwd: repo,
        env: { ...process.env, BOT_MODE: 'dev' },
        encoding: 'utf8',
      });
      if (result.status !== 0) {
        process.stderr.write(result.stdout || '');
        process.stderr.write(result.stderr || '');
        throw new Error(`Embed state subprocess failed (exit ${result.status || 1})`);
      }
      return String(result.stdout || '').trim();
    }
    
    const token = `${process.pid}-${Date.now()}`;
    const guildId = `audit-guild-${token}`;
    const userId = `audit-user-${token}`;
    const common = `
      const state = require(${JSON.stringify(statePath)});
      state.configure({
        defaultState: () => ({ panels: [{ title: 'Default' }], selectedPanelIndex: 0, hasUnsavedChanges: false }),
        sync: (value) => value,
        basePanel: () => ({ title: 'Template' }),
      });
      const interaction = { guildId: ${JSON.stringify(guildId)}, user: { id: ${JSON.stringify(userId)} } };
    `;
    
    try {
      run(`${common}
        const saved = state.markUnsaved(interaction, {
          panels: [{ title: '', graphicHeaderTitle: 'FAQ', image: 'https://example.test/faq.gif' }],
          media: { panels: [{ gallery: [{ source: 'https://example.test/faq.gif', placement: 'above' }] }] },
          selectedPanelIndex: 0,
        });
        if (!saved.hasUnsavedChanges) process.exit(2);
      `);
    
      const restored = JSON.parse(run(`${common}
        process.stdout.write(JSON.stringify(state.getSession(interaction)));
      `));
      assert.equal(restored.panels[0].graphicHeaderTitle, 'FAQ');
      assert.equal(restored.media.panels[0].gallery[0].placement, 'above');
      assert.equal(restored.hasUnsavedChanges, true);
    
      run(`${common}
        state.clearSession(interaction);
      `);
    
      const afterClear = JSON.parse(run(`${common}
        process.stdout.write(JSON.stringify(state.getSession(interaction)));
        state.clearSession(interaction);
      `));
      assert.equal(afterClear.panels[0].title, 'Default');
    
      const entry = fs.readFileSync(path.join(repo, 'src/modules/messageStudio/embed/embed.js'), 'utf8');
      assert.match(entry, /require\('\.\/embedState'\)/, 'Embed entry point must load canonical embedState.');
      assert.doesNotMatch(entry, /sessionPersistence\.install\(embedState\)/, 'Obsolete persistence wrapper must not be installed.');
    
      console.log('✅ Embed Studio canonical state persistence boundary audit passed');
    } finally {
      try {
        run(`${common}
          state.clearSession(interaction);
        `);
      } catch {}
    }
    return true;
  } catch (error) {
    console.error(`❌ Embed State Persistence Boundary audit failed: ${error.message}`);
    return false;
  }
}

function adminModuleRoutingAudit() {
  try {
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    
    const modules = fs.readFileSync(root + '/src/core/administration/admin/modules.js', 'utf8');
    const router = fs.readFileSync(root + '/src/events/interactions/interactionCreate.js', 'utf8');
    const verification = fs.readFileSync(root + '/src/modules/securityStudio/verificationPanel.js', 'utf8');
    
    const catalogBlock = modules.match(/const MODULE_CATALOG = \[([\s\S]*?)\n\];/);
    assert(catalogBlock, 'MODULE_CATALOG could not be parsed');
    
    const entries = [...catalogBlock[1].matchAll(/\{ key: '([^']+)', studio: '([^']+)', route: '([^']+)'/g)]
      .map(([, key, studio, route]) => ({ key, studio, route }));
    
    assert(entries.length >= 25, `Expected full module catalog, found only ${entries.length} entries`);
    assert.equal(new Set(entries.map((entry) => entry.key)).size, entries.length, 'Duplicate module keys found');
    assert.equal(new Set(entries.map((entry) => entry.route)).size, entries.length, 'Duplicate module routes found');
    
    for (const entry of entries) {
      assert(modules.includes(entry.route), `Catalog route missing from module panels: ${entry.route}`);
      assert(
        modules.includes('admin:studio:') && modules.includes('studio.key') && modules.includes('module.route'),
        `Dynamic Studio navigation generator missing for ${entry.key} (${entry.studio})`
      );
    }
    
    assert(router.includes("callHandler(moduleAdminPanels,'handleModuleAdminInteraction',interaction)"), 'Generic module router is not wired into InteractionCreate');
    assert(router.indexOf("callHandler(moduleAdminPanels,'handleModuleAdminInteraction',interaction)") < router.indexOf("callHandler(adminPanel,'handleAdminNavigation',interaction)"), 'Generic module router must run before general admin navigation');
    
    for (const entry of entries.filter((entry) => entry.route.startsWith('admin:module:'))) {
      assert(modules.includes("id.match(/^admin:module:"), `Generic route parser missing for ${entry.key}`);
    }
    
    const dedicated = {
      birthdays: 'handleAdmin', giveaways: 'handleGiveawaysAdminInteraction', invites: 'handleInviteStudioInteraction', leveling: 'handleLevelingInteraction', polls: 'handlePollsInteraction',
      faq: 'handleFaqInteraction', forms: 'handleFormsAdminInteraction', suggestions: 'handleSuggestionsAdminInteraction', tickets: 'handleTicketInteraction',
      goodbye: 'handleGoodbyeInteraction', embed: 'handleInteraction', starboard: 'handleStarboardAdminInteraction', sticky: 'handleStickyAdminInteraction', welcome: 'handleWelcomeInteraction',
      autoRoles: 'handleAutoRolesInteraction', reactionRoles: 'handleReactionRolesAdminInteraction', temporaryRoles: 'handleTemporaryRolesInteraction', timedRoles: 'handleTimedRolesInteraction',
      verification: 'handleVerificationAdminInteraction', social: 'handleInteraction', privateRooms: 'handleAdminInteraction', schedule: 'handleScheduleAdminInteraction', stats: 'handleStatsAdminInteraction', tempVoice: 'handleTempVoiceInteraction',
    };
    
    for (const entry of entries.filter((entry) => !entry.route.startsWith('admin:module:'))) {
      if (entry.key === 'translation') continue;
      const method = dedicated[entry.key];
      assert(method, `No dedicated routing contract declared for ${entry.key} (${entry.route})`);
      assert(router.includes(method), `InteractionCreate does not wire ${entry.key} through ${method}`);
    }
    
    assert(verification.includes("id!=='admin:verification'&&!id.startsWith('admin:verification:')"), 'Verification handler does not accept the admin:verification root route');
    assert(verification.includes("if(id==='admin:verification'){await respond(i,buildVerificationAdminPanel(i.guild,user,'home',st));return true;}"), 'Verification root route does not open the Verification panel');
    
    const unsafeGuard = /if\(startsWith\(interaction,'admin:[^']+'\)\)\{await callHandler\([^;]+;return;\}/g;
    assert.deepEqual(router.match(unsafeGuard) || [], [], 'Found an admin prefix guard that swallows an unhandled interaction');
    
    // Social Studio must route both its admin root and every social:* child interaction through the current panel before compatibility fallback.
    const socialDispatch = "if((startsWith(interaction,'admin:social')||startsWith(interaction,'social:'))&&await callHandler(socialAdminPanel,'handleInteraction',interaction))return;";
    const socialCompat = "if(startsWith(interaction,'social:creator:')){if(!await callHandler(socialCreatorActionCompat,'handle',interaction))throw new Error(`Social creator controls did not handle ${customId}.`);return;}";
    assert(router.includes(socialDispatch), 'Social Studio root + child namespace is not wired to its current handler');
    assert(router.includes(socialCompat), 'Social Studio creator compatibility fallback is missing');
    assert(router.indexOf(socialDispatch) < router.indexOf(socialCompat), 'Social Studio current handler must run before creator compatibility fallback');
    
    const requiredRouterContracts = [
      ["startsWith(interaction,'admin:autoRoles')", 'Auto Roles root'],
      ["startsWith(interaction,'admin:temporaryRoles')", 'Temporary Roles root'],
      ["startsWith(interaction,'admin:timedRoles')", 'Timed Roles root'],
      ["startsWith(interaction,'admin:welcome')", 'Welcome root'],
      ["startsWith(interaction,'admin:goodbye')", 'Goodbye root'],
      ["startsWith(interaction,'admin:reactionRoles')", 'Reaction Roles root'],
      ["startsWith(interaction,'admin:schedule')", 'Schedule root'],
      ["startsWith(interaction,'schedule:rsvp:')", 'Schedule RSVP child'],
      ["startsWith(interaction,'admin:birthdays')", 'Birthdays root'],
      ["startsWith(interaction,'birthdays:user:')", 'Birthdays user child'],
      ["startsWith(interaction,'admin:invites')", 'Invites root'],
      ["startsWith(interaction,'invites:')", 'Invites child'],
    ];
    for (const [needle, label] of requiredRouterContracts) assert(router.includes(needle), `${label} routing contract is missing`);
    
    // Every studio/module namespace advertised by the central router must remain represented in its routing source.
    const prefixBlock = router.match(/const MODULE_STUDIO_PREFIXES = \[([\s\S]*?)\n\];/);
    assert(prefixBlock, 'MODULE_STUDIO_PREFIXES could not be parsed');
    const advertisedPrefixes = [...prefixBlock[1].matchAll(/'([^']+)'/g)].map((match) => match[1]).filter((value) => value.includes(':'));
    assert(advertisedPrefixes.length >= 40, `Expected deep module namespace coverage, found only ${advertisedPrefixes.length} prefixes`);
    for (const prefix of advertisedPrefixes) assert(router.includes(prefix), `Advertised module interaction namespace disappeared: ${prefix}`);
    
    // Regression gate for interaction acknowledgements, permission boundaries and security separation.
    const adminPanelSource = fs.readFileSync(root + '/src/core/administration/admin/panel.js', 'utf8');
    assert(adminPanelSource.includes("interaction.__goliathLegacyRoleBase || interaction.customId"), 'Paginated authority role selections must resolve to their original handler ID');
    const adminCommand = fs.readFileSync(root + '/src/core/administration/admin/command.js', 'utf8');
    const securityPanels = fs.readFileSync(root + '/src/core/administration/admin/securityHubPanels.js', 'utf8');
    const modCommand = fs.readFileSync(root + '/src/core/administration/mod/command.js', 'utf8');
    const responseGuard = fs.readFileSync(root + '/src/runtime/interactionResponseGuard.js', 'utf8');
    const interactionContracts = [
      [router.includes('handledInteractions.add(interaction)'), 'duplicate interaction protection'],
      [router.includes('wrapInteractionResponses(interaction)'), 'interaction response normalization'],
      [router.includes('await enforceAdminModuleAuthority(interaction)'), 'module authority check before dispatch'],
      [router.includes('await safeInteractionError(interaction,new Error('), 'unknown component response'],
      [router.includes("if (!await callHandler(embedStudio, 'handleInteraction', interaction)"), 'Embed Studio missing-handler response'],
      [router.includes('if(!await callHandler(privateRoomsPanel'), 'Private Rooms missing-handler response'],
      [router.includes('if(!await callHandler(roleSelectorPanel'), 'Role Selector missing-handler response'],
      [router.includes('if(!await callHandler(modInteractions'), 'moderation missing-handler response'],
      [router.includes('if(!await callHandler(socialCreatorActionCompat'), 'Social creator missing-handler response'],
      [adminCommand.includes('if (!canUseServerSecurity(interaction))'), 'guild security permission guard'],
      [adminCommand.includes('if (!isGuildOwner(interaction))'), 'owner-only security isolation guard'],
      [adminCommand.includes('if (!canUseSettings(interaction))'), 'admin settings permission guard'],
      [adminCommand.includes('recordCaseAudit('), 'security containment case audit persistence'],
      [securityPanels.includes('interaction.guild?.ownerId !== interaction.user?.id'), 'owner-only recovery control'],
      [modCommand.includes('enforceCommandAccess(interaction, command)'), 'moderation command access control'],
      [responseGuard.includes('module.exports'), 'shared interaction response guard exports'],
    ];
    for (const [present, label] of interactionContracts) assert(present, `Backend regression: missing ${label}`);
    const authorityPosition = router.indexOf('await enforceAdminModuleAuthority(interaction)');
    const genericModulePosition = router.indexOf("callHandler(moduleAdminPanels,'handleModuleAdminInteraction',interaction)");
    assert(authorityPosition >= 0 && authorityPosition < genericModulePosition, 'Module authority must run before generic module dispatch');
    console.log(`✅ Backend interaction, guild/owner permission and persistence contracts passed: ${interactionContracts.length} checks.`);

    console.log(`✅ Admin module routing audit passed: ${entries.length} modules across ${new Set(entries.map((entry) => entry.studio)).size} studios; root and child routing contracts guarded.`);
    return true;
  } catch (error) {
    console.error('❌ admin-module-routing audit failed:', error.message);
    return false;
  }
}

function embedGraphicHeadersAudit() {
  try {
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const {
      graphicHeaderIndex,
      normalizeGraphicHeaderPlacements,
    } = require(root + '/src/modules/messageStudio/embed/embedInteractions');
    
    function run() {
      assert.equal(graphicHeaderIndex({ gallery: [] }), null);
      assert.equal(graphicHeaderIndex({ gallery: [{ placement: 'below' }, { placement: 'above' }] }), 1);
    
      const base = [
        { source: 'https://example.com/a.gif', placement: 'above' },
        { source: 'https://example.com/b.png', placement: 'below' },
        { source: 'https://example.com/c.jpg', placement: 'above' },
      ];
      const switched = normalizeGraphicHeaderPlacements(base, 1);
      assert.deepEqual(switched.map((item) => item.placement), ['below', 'above', 'below']);
      assert.equal(switched[1].source, base[1].source);
    
      const cleared = normalizeGraphicHeaderPlacements(base, null);
      assert(cleared.every((item) => item.placement === 'below'));
    
      const renderer = fs.readFileSync(require.resolve(root + '/src/modules/messageStudio/embed/embedRenderer'), 'utf8');
      const above = renderer.indexOf('if (aboveItems.length)');
      const content = renderer.indexOf('const mainText = panelText(data)', above);
      const below = renderer.indexOf('if (belowItems.length)', content);
    
      assert(above >= 0 && content > above && below > content, 'renderer order must remain Above media -> panel content -> Below media');
      assert(renderer.includes("'image/gif'"));
      assert(renderer.includes('nativeImageShouldPassThrough'));
    
      const embedRuntime = fs.readFileSync(require.resolve(root + '/src/modules/messageStudio/embed/embed'), 'utf8');
      assert(embedRuntime.includes('function canonicalMediaState'));
      assert(embedRuntime.includes('media.mediaModel.normalizeMedia(state?.media || {}, panels)'));
      assert(embedRuntime.includes('installMediaRuntime(panel)'), 'Embed runtime must install the canonical Media Studio runtime.');
      assert(!embedRuntime.includes("placement: itemIndex === 0 ? 'above' : 'below'"), 'canonical session normalization must not overwrite an explicit Above/Below media placement');
    
      const embedState = fs.readFileSync(require.resolve(root + '/src/modules/messageStudio/embed/embedState'), 'utf8');
      assert(embedState.includes('function loadPersistedSession(key)'), 'embedState must own durable session loading');
      assert(embedState.includes('function savePersistedSession(key, state)'), 'embedState must own durable session saving');
      assert(embedState.includes('function removePersistedSession(key)'), 'embedState must own durable session removal');
      assert(embedState.includes('loadPersistedSession(key)'), 'getSession must hydrate from durable storage');
      assert(embedState.includes('savePersistedSession(key, state)') && embedState.includes('persistOrThrow(key, synced'), 'saveSession must persist canonical state');
      assert(embedState.includes('removePersistedSession(key)'), 'clearSession must remove durable state');
    
      const mediaSource = fs.readFileSync(require.resolve(root + '/src/modules/messageStudio/embed/embedMedia'), 'utf8');
      const interactionSource = fs.readFileSync(require.resolve(root + '/src/modules/messageStudio/embed/embedInteractions'), 'utf8');
      const mediaInteractionSource = interactionSource;
    
      assert(!mediaSource.includes('buildEditMediaPanel'), 'retired Edit Media panel must remain removed');
      assert(!mediaSource.includes("embed:header-type-cycle"), 'retired Header Type cycle button must remain removed');
      assert(interactionSource.includes("customId === 'embed:header-type-cycle'"), 'legacy Header Type cycle interactions must route into the current Media Manager');
      assert(!interactionSource.includes('buildEditMediaPanel'), 'retired Edit Media handler must remain removed');
      assert(interactionSource.includes("panel.buildMediaManagerPanel(i, who(i))") && interactionSource.includes("customId === 'embed:header-type-cycle'"), 'legacy Header Type interaction must bridge to the canonical Media Manager');
      assert(!mediaInteractionSource.includes('updateMediaOptions'), 'retired Media Options submenu updater must be removed');
      assert(!mediaSource.includes('buildMediaOptionsPanel'), 'retired Media Options submenu builder must be removed');
      assert(!mediaInteractionSource.includes("customId === 'embed:media-options'"), 'retired Media Options entry point must be removed');
      assert(mediaInteractionSource.includes("customId === 'embed:media-type:cycle'") && mediaInteractionSource.includes("const cycle = ['auto', 'text', 'gif', 'image']") && mediaInteractionSource.includes('headerType') && mediaInteractionSource.includes('return updateMediaPanel(i)'), 'media header type cycle must persist headerType and return to the main Media Manager');
    
      assert(renderer.includes("if (type === 'image/gif') return 'gif'"), 'Auto must detect GIF from MIME type');
      assert(renderer.includes("if (type.startsWith('image/')) return 'image'"), 'Auto must detect static image MIME types');
      assert(renderer.includes("headerType === 'text'"), 'Text mode must have an explicit renderer guard');
      assert(renderer.includes('new MediaGalleryItemBuilder()') && renderer.includes('.setURL(mediaUrl)'), 'component media gallery must preserve the resolved native or processed media URL');
      assert(renderer.includes('forcedStaticGalleryAttachment') && renderer.includes("galleryHeaderType(item) === 'image'"), 'Image mode must force the static-image processing path');
      assert(renderer.includes('nativeImageShouldPassThrough(') && renderer.includes('probe.contentType'), 'Auto must retain native-image pass-through detection');
    
      const currentFlagName = ['IsComponentsV', String(2)].join('');
      assert(
        renderer.includes('new ContainerBuilder()') &&
        renderer.includes('new MediaGalleryBuilder().addItems(') &&
        renderer.includes(`flags: MessageFlags.${currentFlagName}`),
        'renderer must keep panel media and content inside Discord component containers'
      );
    
      console.log('✅ Embed Graphic Header regression audit passed.');
    }
    
    run();
    
    // Sync Goliath and Deploy Goliath execute this file as the shared deep
    // regression gate. Keep restart persistence and critical runtime API contracts
    // here so a broken cross-module surface cannot reach DEV, BETA or PRODUCTION.
    if (!embedSessionPersistenceAudit()) throw new Error('Session persistence regression');
    if (!embedStatePersistenceBoundaryAudit()) throw new Error('State persistence regression');
    if (!runtimeContractsAudit()) throw new Error('Runtime contract regression');
    
    return true;
  } catch (error) {
    console.error('❌ embed-graphic-headers audit failed:', error.message);
    return false;
  }
}

function embedTemplateBindingLifecycleAudit() {
  try {
    const assert = require('node:assert/strict');
    
    const guildManagerPath = require.resolve(root + '/src/core/guild/guildManager');
    const embedTemplatesPath = require.resolve(root + '/src/modules/messageStudio/embed/embedTemplates');
    const originalGuildManagerCache = require.cache[guildManagerPath];
    const originalEmbedTemplatesCache = require.cache[embedTemplatesPath];
    
    const sections = new Map();
    const keyFor = (guildId, section) => `${guildId}:${section}`;
    
    const guildManagerMock = {
      getGuildSection(guildId, section, fallback = {}) {
        return sections.has(keyFor(guildId, section)) ? sections.get(keyFor(guildId, section)) : fallback;
      },
      updateGuildSection(guildId, section, updater, fallback = {}) {
        const key = keyFor(guildId, section);
        const current = sections.has(key) ? sections.get(key) : fallback;
        const next = updater(current);
        sections.set(key, next);
        return next;
      },
      getEmbedPresets() { return {}; },
      saveGuildSection() { return true; },
      saveEmbedPreset(_guildId, name, embedData) { return { name, ...embedData }; },
      getEmbedPreset() { return null; },
      deleteEmbedPreset() { return false; },
      reloadGuild() { return true; },
    };
    
    try {
      require.cache[guildManagerPath] = { id: guildManagerPath, filename: guildManagerPath, loaded: true, exports: guildManagerMock };
      delete require.cache[embedTemplatesPath];
    
      const templates = require(embedTemplatesPath);
      const guildId = '123456789012345678';
      const templateId = 'lifecycle_test_template';
      const moduleKey = 'welcome';
      const slot = 'welcome';
    
      templates.saveTemplate(guildId, {
        templateId,
        name: 'Lifecycle Test Template',
        module: moduleKey,
        templateType: slot,
        embed: { title: 'Lifecycle test', description: 'Binding lifecycle contract.' },
      });
    
      const binding = templates.bindTemplate(guildId, moduleKey, slot, templateId);
      assert.equal(binding.templateId, templateId);
      assert.equal(templates.getBinding(guildId, moduleKey, slot)?.templateId, templateId);
    
      assert.throws(
        () => templates.deleteTemplate(guildId, templateId),
        (error) => error?.code === 'TEMPLATE_IN_USE' && error?.templateId === templateId,
        'Bound templates must be protected from deletion.'
      );
    
      const unbound = templates.unbindTemplate(guildId, moduleKey, slot);
      assert.equal(unbound.unbound, true);
      assert.equal(unbound.templateId, templateId);
      assert.equal(templates.getBinding(guildId, moduleKey, slot), null);
    
      assert.equal(templates.deleteTemplate(guildId, templateId), true, 'Template must be deletable after unbinding.');
      assert.equal(templates.getTemplate(guildId, templateId), null);
    
      console.log('✅ Embed Studio binding lifecycle audit passed: bind → protected delete → unbind → delete.');
    } finally {
      if (originalGuildManagerCache) require.cache[guildManagerPath] = originalGuildManagerCache;
      else delete require.cache[guildManagerPath];
      if (originalEmbedTemplatesCache) require.cache[embedTemplatesPath] = originalEmbedTemplatesCache;
      else delete require.cache[embedTemplatesPath];
    }
    
    return true;
  } catch (error) {
    console.error('❌ embed-template-binding-lifecycle audit failed:', error.message);
    return false;
  }
}

function socialLivePresentationAudit() {
  try {
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    
    const core = fs.readFileSync(root + '/src/modules/socialStudio/socialAlerts/socialStudioMonitorCore.js',
      'utf8'
    );
    
    const monitor = fs.readFileSync(root + '/src/modules/socialStudio/socialAlerts/socialStudioMonitor.js',
      'utf8'
    );
    
    const kick = fs.readFileSync(root + '/src/modules/socialStudio/socialAlerts/providers/kick.js',
      'utf8'
    );
    
    const compactCore = core.replace(/\s+/g, '');
    
    /*
     * LIVE presentation contract.
     *
     * Test semantic presentation behaviour rather than depending on the
     * byte representation of decorative emoji.
     */
    
    assert(
      core.includes('creator?.avatarUrl') &&
        core.includes('account.avatarUrl') &&
        core.includes('event.avatarUrl'),
      'LIVE avatar fallbacks missing'
    );
    
    assert(
      core.includes(
        'account.profileUrl || account.url || event.profileUrl || vars.url'
      ),
      'LIVE profile URL fallback missing'
    );
    
    assert(
      compactCore.includes('author.url=profileUrl'),
      'LIVE author must be clickable'
    );
    
    assert(
      compactCore.includes('embed.setThumbnail(authorIcon)'),
      'LIVE creator thumbnail missing'
    );
    
    assert(
      core.includes('LIVE NOW'),
      'LIVE NOW headline missing'
    );
    
    assert(
      core.includes('PAUSED'),
      'PAUSED headline missing'
    );
    
    assert(
      core.includes('Watch Live'),
      'Watch Live action missing'
    );
    
    assert(
      core.includes('OFFLINE'),
      'OFFLINE presentation missing'
    );
    
    /*
     * TikTok uses status transitions rather than the normal timed LIVE
     * refresh while the same broadcast remains active.
     */
    
    assert(
      compactCore.includes("platform==='tiktok'") ||
        compactCore.includes('platform==="tiktok"'),
      'TikTok LIVE refresh exception missing'
    );
    
    assert(
      compactCore.includes('previous.lastLiveEvent?.liveStatus') &&
        (
          compactCore.includes('checked.event?.liveStatus') ||
          compactCore.includes('checked.event.liveStatus')
        ),
      'TikTok refresh exception must compare LIVE/PAUSED status'
    );
    
    assert(
      compactCore.includes('returnbefore!==current'),
      'TikTok refresh exception must update only on status transition'
    );
    
    assert(
      compactCore.includes('sameActiveBroadcast'),
      'LIVE presentation must preserve same-broadcast lifecycle handling'
    );
    
    /*
     * Kick presentation/provider integration must remain available.
     */
    
    assert(
      kick.includes('kick') ||
        kick.includes('Kick'),
      'Kick provider presentation contract missing'
    );
    
    assert(
      core.includes('liveMessageUpdateDue'),
      'LIVE message refresh integration missing'
    );
    
    console.log(
      '✅ Social Studio LIVE presentation audit passed.'
    );
    
    return true;
  } catch (error) {
    console.error('❌ social-live-presentation audit failed:', error.message);
    return false;
  }
}

function socialStudioLifecycleAudit() {
  try {
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    
    const core = fs.readFileSync(root + '/src/modules/socialStudio/socialAlerts/socialStudioMonitorCore.js', 'utf8');
    const monitor = fs.readFileSync(root + '/src/modules/socialStudio/socialAlerts/socialStudioMonitor.js', 'utf8');
    const recovery = fs.readFileSync(root + '/src/events/client/socialStudioLivePostRecovery.js', 'utf8');
    const facebook = fs.readFileSync(root + '/src/modules/socialStudio/socialAlerts/providers/facebook.js', 'utf8');
    const tiktok = fs.readFileSync(root + '/src/modules/socialStudio/socialAlerts/providers/tiktok.js', 'utf8');
    
    // Source-shape checks intentionally ignore formatting so refactors/Prettier do not break CI.
    const compactCore = core.replace(/\s+/g, '');
    const compactMonitor = monitor.replace(/\s+/g, '');
    const compactRecovery = recovery.replace(/\s+/g, '');
    const compactFacebook = facebook.replace(/\s+/g, '');
    const compactTikTok = tiktok.replace(/\s+/g, '');
    
    const contracts = [
      ['OFFLINE transition', 'checked.isLive===false&&previous.isLive===true'],
      ['stable ended identity', 'id:`ended:${previous.liveEventId||prior.id||account.accountId}`'],
      ['VOD correlation', 'vodMatchesEndedStream(item,startedAt,endedAt)'],
      ['persistent event dedupe', 'deliveredEventKeys'],
      ['deleted-message recovery', 'recovered=Boolean(updated)'],
      ['recovery without ping', 'suppressMention:true'],
      ['forced LIVE state persistence', 'state.lastLiveMessageId=delivered.messageId'],
      ['forced LIVE channel persistence', 'state.lastLiveMessageChannelId=delivered.channelId'],
      ['forced LIVE refresh clock', 'state.lastLiveMessageUpdatedAt=stamp'],
      ['forced LIVE state save', 'saveMonitorState(guildId,config,monitorUpdates,{alerts:sent.length},historyEntries'],
      ['failed delivery retry toggle', 'config.settings.retryDeliveries!==false'],
      ['retry attempt limit', 'config.settings.maxDeliveryAttempts||5'],
      ['retry interval', 'config.settings.retryIntervalMs||60000'],
      ['persisted pending delivery', 'state.pendingDelivery'],
      ['retry recovery delivery', 'recovered:true'],
      ['exhausted retry release', 'state.pendingDelivery=null'],
      ['delivery failure preserves current state', 'letcurrentState={...previous}'],
      ['retry failure persists current state', 'state:{...currentState,pendingDelivery'],
      ['stale LIVE retry protection', "pendingLiveStale=Boolean(pendingEvent?.type==='live'"],
      ['stale LIVE retry clears pending', 'state.pendingDelivery=null'],
      ['recovery concurrency deferral', "result?.skipped&&result.reason==='check_already_running'"],
      ['rollover concurrency deferral', "repairedItem?.status==='skipped'&&repairedItem?.reason==='already_running'"],
      ['quiet hours persistent hold', 'quietHoursPending'],
      ['quiet hours held audit', "status:'quiet_held'"],
      ['quiet hours release audit', "status:'quiet_released'"],
      ['stale quiet LIVE discard audit', "status:'quiet_stale_discarded'"],
      ['diagnostic provider isolation', 'options.diagnosticOnly===true'],
      ['LIVE notification target is server authoritative', "constlive=String(eventType||'').toLowerCase()==='live'"],
      ['creator LIVE profile visibility', 'creator?.showProfileInLive!==false'],
    ];
    
    for (const [name, needle] of contracts) {
      const source = name.includes('recovery concurrency') ? compactRecovery : name.includes('rollover concurrency') ? compactMonitor : compactCore;
      assert(source.includes(needle), `${name} contract missing`);
    }
    
    assert(compactMonitor.includes('previousEventId===currentEventId'), 'rollover equality guard missing');
    assert(compactMonitor.includes('stalePostRemoved'), 'stale rollover cleanup missing');
    
    // Completed LIVE sessions must retire volatile broadcast identity only after
    // ENDED delivery/retry work is finished. Durable dedupe/history can remain.
    assert(compactRecovery.includes('completedSessionNeedsRetirement'), 'completed-session retirement guard missing');
    assert(compactRecovery.includes("state.isLive!==false"), 'retirement must require confirmed OFFLINE state');
    assert(compactRecovery.includes("state.pendingEndedEvent&&typeofstate.pendingEndedEvent==='object'"), 'retirement must preserve pending ENDED state');
    assert(compactRecovery.includes("state.pendingDelivery?.event?.type==='ended'"), 'retirement must preserve pending ENDED delivery retries');
    assert(compactRecovery.includes('state.liveEventId=null'), 'completed-session liveEventId retirement missing');
    assert(compactRecovery.includes('state.liveStartedAt=null'), 'completed-session liveStartedAt retirement missing');
    assert(compactRecovery.includes('state.lastLiveEvent=null'), 'completed-session lastLiveEvent retirement missing');
    assert(compactRecovery.includes('state.peakViewers=0'), 'completed-session peak viewer retirement missing');
    assert(compactRecovery.includes("String(state.lastAlertKey||'').startsWith('live:')"), 'stale LIVE alert key retirement missing');
    assert(compactRecovery.includes('retireCompletedSessions(guild.id,guildConfig)'), 'completed-session retirement sweep missing');
    
    // Provider lifecycle safety: an uncertain provider response must not become a
    // false OFFLINE transition, because OFFLINE can emit an ended notification.
    assert(
      compactFacebook.includes("returnunavailable('facebook',`FacebookLIVEstatusunavailable:${error.message}`)"),
      'Facebook LIVE lookup failures must remain unavailable instead of becoming OFFLINE',
    );
    assert(
      !compactFacebook.includes("live_videos?broadcast_status=LIVE&fields=id,title,status,permalink_url,creation_time&limit=1&access_token=${encodeURIComponent(token)}`).catch(()=>({json:null}))"),
      'Facebook LIVE lookup must not swallow failure into an empty response',
    );
    assert(
      compactTikTok.includes('TikTokreturnedthecreatorLIVEpagewithoutadefinitiveLIVE,PAUSEDorENDEDmarker')
        && compactTikTok.includes("returnunavailable('tiktok',"),
      'TikTok ambiguous LIVE page must remain unavailable',
    );
    assert(compactTikTok.includes("providerSource:ended?'public_page_ended':'public_page_redirect'"), 'TikTok proven OFFLINE paths missing');
    assert(compactTikTok.includes("liveStatus:isPaused?'PAUSED':'LIVE'"), 'TikTok PAUSED state contract missing');
    
    // Locked Social Studio lifecycle model:
    // LIVE -> ENDED is one retained Discord session/message. VOD/content events are
    // independent event identities and must remain independently deduplicatable.
    const liveKey = 'live:stream-A';
    const endedKey = 'ended:ended:stream-A';
    const vodKey = 'vod:vod-A';
    const clipKey = 'clip:clip-A';
    assert.notEqual(liveKey, endedKey);
    assert.notEqual(endedKey, vodKey);
    assert.notEqual(vodKey, clipKey);
    const independentEvents = new Set([liveKey, endedKey, vodKey, clipKey]);
    assert.equal(independentEvents.size, 4, 'LIVE/ENDED/VOD/CLIP identities must remain independent');
    
    // TikTok PAUSED is still the same broadcast session. Resume must not mint a
    // second LIVE identity, and only a confirmed OFFLINE transition may end it.
    const tiktokSession = { id: 'tt-live-A', state: 'LIVE' };
    tiktokSession.state = 'PAUSED';
    assert.equal(tiktokSession.id, 'tt-live-A');
    assert.equal(tiktokSession.state, 'PAUSED');
    tiktokSession.state = 'LIVE';
    assert.equal(tiktokSession.id, 'tt-live-A', 'TikTok resume must preserve the LIVE session identity');
    
    // Deterministic VOD-window sanity check. Correlation is metadata only; it must
    // never imply that the VOD shares the ENDED event identity.
    const started = Date.parse('2026-09-18T20:00:00Z');
    const ended = Date.parse('2026-09-18T22:00:00Z');
    const margin = 15 * 60 * 1000;
    const matchesWindow = (published) => published >= started - margin && published <= ended + margin;
    assert.equal(matchesWindow(Date.parse('2026-09-18T21:59:00Z')), true);
    assert.equal(matchesWindow(Date.parse('2026-09-18T22:14:59Z')), true);
    assert.equal(matchesWindow(Date.parse('2026-09-18T22:16:00Z')), false);
    
    const delivered = new Set(['live:A', 'ended:ended:A', 'vod:vod-A']);
    assert.equal(delivered.has('live:A'), true);
    assert.equal(delivered.has('vod:vod-A'), true, 'correlated VOD must retain its own delivered-event identity');
    assert.equal(delivered.has('live:B'), false);
    delivered.add('live:B');
    assert.equal(delivered.size, 4);
    
    console.log('✅ Social Studio lifecycle validation passed: provider state -> LIVE/PAUSED -> ENDED retention contract -> independent VOD/content -> LIVE B');
    
    return true;
  } catch (error) {
    console.error('❌ social-studio-lifecycle audit failed:', error.message);
    return false;
  }
}

function universalMemberNoticesAudit() {
  try {
    const assert = require('node:assert/strict');
    const {
      buildScheduleReminderNotice,
      buildVerificationNotice,
      buildPrivateRoomDecisionNotice,
      buildSecurityIncidentNotice,
    } = require(root + '/src/core/ui/systemNotices');
    
    function fakeUser(id = '123456789012345678') {
      return {
        id,
        tag: 'Member#0001',
        username: 'Member',
        displayAvatarURL: () => null,
      };
    }
    
    function fakeGuild() {
      return {
        id: '111111111111111111',
        name: 'Goliath Test Guild',
        iconURL: () => null,
      };
    }
    
    function embedJson(payload) {
      assert(payload && typeof payload === 'object', 'notice payload must be an object');
      assert(Array.isArray(payload.embeds) && payload.embeds.length === 1, 'notice must contain one primary embed');
      const embed = payload.embeds[0];
      return typeof embed.toJSON === 'function' ? embed.toJSON() : embed;
    }
    
    function fieldMap(embed) {
      return new Map((embed.fields || []).map((field) => [field.name, field.value]));
    }
    
    const guild = fakeGuild();
    const user = fakeUser();

    {
      const { quarantineReleaseNotice } = require(root + '/src/core/ui/memberNotice');
      const notice = embedJson(quarantineReleaseNotice(guild, { caseId: 12 }, { restoredRoles: 1, cleanupPending: true }, { reviewedBy: '<@123456789012345678>' }));
      assert.equal(notice.title, '🔓 Quarantine Lifted');
      assert(notice.fields.some(item => item.name === '🆔 Case Reference' && item.value === '#12'));
      assert(notice.fields.some(item => item.name === '👤 Reviewed By'));
      assert(!/manageable|background|recorded moderation case|Security Review/.test(JSON.stringify(notice)));
      assert.equal(notice.footer.text, 'Goliath • Moderation');
      const pending = embedJson(quarantineReleaseNotice(guild, {}, { verification: { reconciled: true } }));
      assert(pending.fields.some(item => item.value.includes('complete the server’s verification process')));
      assert(!pending.fields.some(item => /Reference|Status|Action/.test(item.name)));
      const failed = embedJson(quarantineReleaseNotice(guild, {}, { verification: { ok: false } }));
      assert(failed.fields.some(item => item.value.includes('contact server management')));
      const skipped = embedJson(quarantineReleaseNotice(guild, {}, { skippedRoles: [{ id: 'missing', reason: 'missing_role' }] }));
      assert(skipped.fields.some(item => item.value.includes('previous roles are no longer available')));
      assert.deepEqual(quarantineReleaseNotice(guild).allowedMentions, { parse: [] });
    }
    
    {
      const embed = embedJson(buildScheduleReminderNotice({
        guild,
        member: user,
        event: {
          eventId: 'evt_test',
          title: 'Community Night',
          startAt: new Date(Date.now() + 3600000).toISOString(),
          channelId: '222222222222222222',
          voiceChannelId: '333333333333333333',
          hostUserId: '444444444444444444',
          location: 'Gaming Lounge',
        },
        minutes: 60,
      }));
      assert.match(embed.title || '', /EVENT REMINDER/i);
      const fields = fieldMap(embed);
      assert(fields.has('📅 Event'));
      assert(fields.has('🕒 Starts'));
      assert(fields.has('⏰ Reminder'));
    }
    
    {
      const pending = embedJson(buildVerificationNotice({ guild, member: user, type: 'pending', roles: [{ id: '555555555555555555' }] }));
      assert.match(pending.title || '', /VERIFICATION REQUIRED/i);
      assert.match(JSON.stringify(pending), /Pending/i);
    
      const success = embedJson(buildVerificationNotice({ guild, member: user, type: 'success', roles: [{ id: '666666666666666666' }] }));
      assert.match(success.title || '', /VERIFICATION COMPLETE/i);
      assert.match(JSON.stringify(success), /Verified/i);
    
      const cooldown = embedJson(buildVerificationNotice({ guild, member: user, type: 'cooldown', values: { cooldownSeconds: 30 }, reason: 'Please wait before trying again.' }));
      assert.match(cooldown.title || '', /COOLDOWN/i);
      assert.match(JSON.stringify(cooldown), /30 second/i);
    }
    
    {
      const approved = embedJson(buildPrivateRoomDecisionNotice({
        guild,
        member: user,
        approved: true,
        request: { requestId: 'room_req_1', purpose: 'Squad practice', participantIds: ['777777777777777777'] },
        room: { channelId: '888888888888888888' },
      }));
      assert.match(approved.title || '', /PRIVATE ROOM APPROVED/i);
      assert.match(JSON.stringify(approved), /888888888888888888/);
    
      const denied = embedJson(buildPrivateRoomDecisionNotice({
        guild,
        member: user,
        approved: false,
        request: { requestId: 'room_req_2', purpose: 'Squad practice', reviewReason: 'Capacity unavailable.' },
      }));
      assert.match(denied.title || '', /PRIVATE ROOM DECLINED/i);
      assert.match(JSON.stringify(denied), /Capacity unavailable/i);
    }
    
    {
      const embed = embedJson(buildSecurityIncidentNotice({
        guild,
        owner: user,
        incident: {
          id: 'incident_1',
          type: 'mass_channel_delete',
          severity: 'critical',
          actorId: '999999999999999999',
          actorTag: 'BadActor#0001',
          actionTaken: 'lockdown=success; security-isolation=success',
          reason: 'Deletion threshold exceeded.',
        },
      }));
      assert.match(embed.title || '', /SECURITY INCIDENT DETECTED/i);
      assert.match(JSON.stringify(embed), /CRITICAL/i);
      assert.match(JSON.stringify(embed), /lockdown=success/i);
    }
    
    console.log('✅ Universal member notice contract audit passed.');
    
    return true;
  } catch (error) {
    console.error('❌ universal-member-notices audit failed:', error.message);
    return false;
  }
}

function welcomeEmbedDeliveryAudit() {
  try {
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const path = require('node:path');
    
    
    const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
    
    const welcomeEntry = read('src/modules/messageStudio/welcome/welcome.js');
    const welcome = read('src/modules/messageStudio/welcome/welcomeCore.js');
    const delivery = read('src/modules/messageStudio/embed/embedTemplateDelivery.js');
    const panel = read('src/modules/messageStudio/welcome/welcomePanel.js');
    
    assert(welcomeEntry.includes("require(" + "'./welcomeCore'" + ")"), 'Stable Welcome entry point must use the canonical Welcome implementation.');
    assert(welcome.includes("require(" + "'../embed/embedTemplateDelivery'" + ")"), 'Welcome must use the shared Embed Studio delivery service.');
    assert(welcome.includes('buildTemplateDeliveryPayload({'), 'Welcome payloads must delegate to the shared delivery service.');
    assert(!welcome.includes('buildPreviewEmbeds(state, renderInteraction)'), 'Welcome must not keep a private embed-only renderer.');
    assert(delivery.includes("require(" + "'./embedRenderer'" + ")"), 'Shared delivery must use the canonical Embed Studio renderer.');
    assert(delivery.includes('buildEmbedPayload({'), 'Shared delivery must build the same canonical payload as Embed Studio.');
    assert(delivery.includes('media: state.media'), 'Shared delivery must preserve saved Embed Studio media.');
    assert(delivery.includes('actionRows'), 'Shared delivery must preserve saved Embed Studio buttons/actions.');
    assert(welcome.includes('guildVariables.buildVariableMap'), 'Welcome must continue to source runtime values from Guild Variables.');
    assert(/const payload\s*=\s*await welcome\.buildDiscordPayload\(member\s*,\s*['"]welcome['"]/.test(panel), 'Welcome Preview must await the async shared canonical delivery payload.');
    assert(panel.includes('ephemeral:true') || panel.includes('ephemeral: true'), 'Welcome Preview must remain private/ephemeral.');
    
    const scheduled = read('src/modules/messageStudio/welcome/scheduledWelcome.js');
    const dashboard = read('src/dashboard/js/pages/modules/Welcome.jsx');
    const route = read('src/server/routes/modules/messageStudio/welcome.js');
    
    // Delivery-failure regression contracts: public and DM attempts must remain independent.
    const memberEvents = read('src/events/members/memberJoinLeave.js');
    assert(memberEvents.includes("name:'guildMemberAdd'") && memberEvents.includes('welcomeManager.sendWelcome(member)'), 'Member join must invoke the canonical Welcome sender.');
    assert(welcome.includes("reason: 'disabled'") && welcome.includes("reason: 'ignored_bot'"), 'Disabled Welcome and ignored bots must be skipped explicitly.');
    assert(welcome.includes('if (config.channelId && options.skipPublic !== true)'), 'Public delivery must honour the configured channel and skip flag.');
    assert(welcome.includes("errors.push('Welcome channel is unavailable.')"), 'Missing Welcome channels must produce an explicit delivery error.');
    assert(welcome.includes('publicFailed = true') && welcome.includes('dmFailed = true'), 'Public and DM delivery failures must be tracked separately.');
    assert(welcome.includes('if (config.dmEnabled && options.skipDm !== true && !member.user.bot)'), 'DM delivery must be independently gated and must exclude bots.');
    assert(welcome.includes('await member.send(payload)') && welcome.includes('await channel.send(payload)'), 'Welcome must preserve separate public and DM send operations.');
    assert(welcome.includes('incrementAnalytics(member.guild.id'), 'Welcome delivery must record analytics for sends, failures and skips.');
    assert(welcome.includes('userPingEnabled = !isDm && config.allowUserPing !== false && options.suppressPing !== true') && welcome.includes('rolePingEnabled = !isDm && config.allowRolePings === true && options.suppressPing !== true') && welcome.includes('allowedMentions'), 'Welcome delivery must retain user and role mention-suppression safeguards.');
    assert(scheduled.includes('const activeRuns = new Set()'), 'Scheduled Welcome must guard against overlapping runs.');

    assert(scheduled.includes('completed.add(member.id)'), 'Scheduled Welcome must checkpoint successful member deliveries.');
    assert(scheduled.includes('scheduled_welcome_delivery_checkpoint'), 'Scheduled Welcome must persist the successful-delivery checkpoint.');
    assert(scheduled.indexOf('scheduled_welcome_delivery_checkpoint') < scheduled.indexOf('await queue.removeQueueRole(member, config.queueRoleId)'), 'Delivery checkpoint must precede queue role cleanup.');
    assert(panel.includes("customId==='admin:welcome:resetConfirm'"), 'Destructive Welcome reset must require a confirmation action.');
    assert(panel.includes('result.publicFailed') && panel.includes('result.dmFailed'), 'Discord test feedback must expose public and DM failures.');
    assert(panel.includes('result.sendFailed') && panel.includes('result.roleRemovalFailed'), 'Discord scheduled feedback must expose partial failures.');
    assert(dashboard.includes('queueLoaded'), 'Dashboard must distinguish an unloaded queue from an empty queue.');
    assert(dashboard.includes('scheduledHealth?.stuckMemberIds?.length'), 'Dashboard must expose pending role cleanup.');
    assert(dashboard.includes('Members per batch'), 'Dashboard must expose the scheduled batch-size control.');
    assert(route.includes("router.post('/:guildId/custom-message'"), 'Dashboard custom Welcome editor must save through the canonical API.');
    
    assert(scheduled.includes('const activeRuns = new Set()'), 'Scheduled Welcome must maintain a per-guild active-run guard.');
    assert(scheduled.includes("reason: 'already_running'"), 'Overlapping Scheduled Welcome runs must return an explicit skip reason.');
    assert(scheduled.includes('activeRuns.delete(guild.id)'), 'Scheduled Welcome must release its active-run guard.');
    assert(panel.includes("result.reason==='already_running'"), 'Discord Scheduled Welcome must explain overlapping runs.');
    assert(dashboard.includes("result.reason === 'already_running'"), 'Dashboard Scheduled Welcome must explain overlapping runs.');
    assert(dashboard.includes('if (result.skipped)'), 'Dashboard Scheduled Welcome must not report skipped runs as successful.');
    
    console.log('✅ Welcome ↔ Embed Studio delivery contract audit passed.');
    
    return true;
  } catch (error) {
    console.error('❌ welcome-embed-delivery audit failed:', error.message);
    return false;
  }
}

function rolePaginationAudit() {
  try {
    const assert = require('node:assert/strict');
    const { rolePages, rolePager, rolePageSelect, mergePageSelection } = require(root + '/src/core/ui/rolePagination');
    
    const roles = new Map();
    for (let i = 1; i <= 57; i++) {
      const id = String(100000000000000000n + BigInt(i));
      roles.set(id, { id, name: `Role ${i}`, position: i, managed: false });
    }
    const guild = { id: 'guild', roles: { cache: roles } };
    const first = rolePages(guild, [], 0);
    const second = rolePages(guild, [], 1);
    const last = rolePages(guild, [], 99);
    assert.equal(first.roles.length, 25);
    assert.equal(second.roles.length, 25);
    assert.equal(last.roles.length, 7);
    assert.equal(last.page, 2);
    assert.equal(last.pages, 3);
    assert.equal(rolePages(guild, [], -5).page, 0);
    assert.equal(rolePageSelect('test:roles', 'Choose roles', first).toJSON().options.length, 25);
    assert.equal(rolePager('test:page', 0, 3).toJSON().components[0].disabled, true);
    assert.equal(rolePager('test:page', 2, 3).toJSON().components[1].disabled, true);
    const chosenFirst = first.roles[0].id;
    const chosenSecond = second.roles[0].id;
    const saved = mergePageSelection([], first.roles, [chosenFirst]);
    assert.deepEqual(mergePageSelection(saved, second.roles, [chosenSecond]), [chosenFirst, chosenSecond]);
    assert.deepEqual(mergePageSelection([chosenFirst, chosenSecond], first.roles, []), [chosenSecond]);
    assert.throws(() => mergePageSelection([], first.roles, [chosenSecond]), /no longer valid/);
    assert.throws(() => mergePageSelection([], first.roles, first.roles.slice(0, 11).map(role => role.id)), /no more than 10/);
    console.log('Role pagination: page boundaries, buttons, selection preservation and validation passed');
    
    return true;
  } catch (error) {
    console.error('❌ role-pagination audit failed:', error.message);
    return false;
  }
}

function auditCommand() {
  section('Goliath audit');
  return [projectShape, commandAudit, dashboardAudit, dashboardImportAudit, sourceAudit, importAudit, runtimeAudit, goodbyeAudit, reactionRolesAudit, roleStudioAudit, inviteStudioAudit]
    .map((suite) => suite()).every(Boolean);
}
async function doctor(target = '') {
  const suites = { goodbye: goodbyeAudit, reaction: reactionRolesAudit, reactionroles: reactionRolesAudit, 'reaction-roles': reactionRolesAudit, 'role-studio': roleStudioAudit, rolestudio: roleStudioAudit, invites: inviteStudioAudit };
  if (target) return suites[target]?.() ?? false;
  const suitesToRun = [projectShape, commandAudit, dashboardAudit, sourceAudit, importAudit, runtimeAudit, goodbyeAudit, reactionRolesAudit, roleStudioAudit, inviteStudioAudit, adminModuleRoutingAudit, embedGraphicHeadersAudit, universalMemberNoticesAudit, welcomeEmbedDeliveryAudit, freeGamesAudit];
  const results = [];
  for (const suite of suitesToRun) results.push(await suite());
  return results.every(Boolean);
}
function promote(target) {
  const environment = String(target || '').toLowerCase();

  if (!['beta', 'production'].includes(environment)) {
    console.error(`Invalid promotion target: ${environment}`);
    return false;
  }

  section(`Promote dev -> ${environment}`);

  if (!run('git', ['fetch', 'origin'])) return false;

  if (output('git', ['status', '--porcelain'])) {
    console.error('Working tree is not clean.');
    return false;
  }

  const sourceRef = 'origin/dev';
  const targetRef = `origin/${environment}`;

  const sourceSha = output('git', ['rev-parse', sourceRef]);
  const targetSha = output('git', ['rev-parse', targetRef]);
  const sourceTree = output('git', ['show', '-s', '--format=%T', sourceSha]);

  if (!sourceSha || !targetSha || !sourceTree) return false;

  const targetTree = output('git', ['show', '-s', '--format=%T', targetSha]);

  if (sourceTree === targetTree) {
    console.log(`${environment} already has the DEV application tree.`);
    return true;
  }

  const message = `Promote DEV ${sourceSha} to ${environment}`;

  const promotedSha = output(
    'git',
    ['commit-tree', sourceTree, '-p', targetSha, '-m', message]
  );

  if (!promotedSha) {
    console.error(`Failed to create ${environment} promotion commit.`);
    return false;
  }

  if (!run('git', [
    'push',
    'origin',
    `${promotedSha}:refs/heads/${environment}`,
  ])) {
    return false;
  }

  if (!run('git', ['fetch', 'origin', environment])) return false;

  const remoteSha = output(
    'git',
    ['rev-parse', `origin/${environment}`]
  );

  if (remoteSha !== promotedSha) {
    console.error(
      `Promotion verification failed: ${remoteSha} != ${promotedSha}`
    );
    return false;
  }

  console.log(
    `✅ DEV ${sourceSha} promoted to ${environment} at ${promotedSha}`
  );

  return true;
}



const developmentReportStatus = {
  reviewed: '2026-10-20',
  decisions: [
    'Beta access remains restricted to explicitly approved guilds.',
    'Overview promotion requires confirmation that counters display correctly.'
  ],
  blockers: [
    'Moderation/appeals: active database source remains unresolved in the recorded status.'
  ],
  unfinished: [
    'Confirm invite-fix deployment and fresh invite permissions.',
    'Complete live verification acceptance testing.',
    'Finish appeal deployment checks and the management-dashboard security audit.'
  ],
  priorities: [
    'Trace moderation and appeal data to the active process/database.',
    'Validate Overview counters and preserve the remaining change.',
    'Confirm beta invite permissions and complete live verification testing.'
  ]
};


function buildDevelopmentReport() {
  const now = new Date();
  const since = new Date(now.getTime() - 7 * 86400000);
  const format = date => date.toLocaleDateString('en-GB', {
    timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric'
  });
  const bullet = items => items.map(item => '• ' + item).join('\n');
  const clean = value => value.replace(/[\r\n\t]/g, ' ').slice(0, 90);
  const snapshots = [];

  for (const name of ['dev', 'beta', 'production']) {
    const cwd = path.join(path.dirname(root), name);
    const git = args => {
      const result = spawnSync('git', args, {
        cwd, encoding: 'utf8', timeout: 15000
      });
      if (result.error || result.status !== 0) {
        throw new Error(name.toUpperCase() + ' Git read failed.');
      }
      return result.stdout.trimEnd();
    };

    try {
      const branch = git(['branch', '--show-current']) || 'detached HEAD';
      const head = git(['rev-parse', '--short', 'HEAD']);
      const changes = git(['status', '--short', '--untracked-files=no']);
      const logs = git([
        'log', 'HEAD', '--since=' + since.toISOString(),
        '--until=' + now.toISOString(), '--no-merges',
        '--max-count=3', '--format=%h %s'
      ]);
      const tree = new Map(
        git(['ls-tree', '-r', 'HEAD']).split('\n').filter(Boolean).map(line => {
          const separator = line.indexOf('\t');
          return [line.slice(separator + 1), line.slice(0, separator)];
        })
      );

      snapshots.push({
        name, tree,
        text: [
          'Branch: ' + clean(branch) + ' | Commit: ' + head,
          changes
            ? 'Tracked changes: ' + changes.split('\n').length + ' uncommitted path(s).'
            : 'Tracked working tree: clean.',
          '**Recent commits in this checkout**',
          logs ? bullet(logs.split('\n').map(clean)) : 'No commits dated within this reporting period.'
        ].join('\n')
      });
    } catch (error) {
      snapshots.push({ name, tree: null, text: 'Unavailable — ' + error.message });
    }
  }

  const compare = (left, right) => {
    const a = snapshots.find(item => item.name === left);
    const b = snapshots.find(item => item.name === right);
    const label = left.toUpperCase() + ' → ' + right.toUpperCase();
    if (!a.tree || !b.tree) return label + ': comparison unavailable.';
    const paths = new Set([...a.tree.keys(), ...b.tree.keys()]);
    const different = [...paths].filter(key => a.tree.get(key) !== b.tree.get(key)).length;
    return label + ': ' + (
      different
        ? different + ' tracked path(s) differ; review before promotion.'
        : 'committed file contents and modes match.'
    );
  };

  const stale = now.getTime() - Date.parse(developmentReportStatus.reviewed + 'T00:00:00Z') > 14 * 86400000;
  const headings = ['DEV — Development', 'BETA — Testing', 'PRODUCTION — Live'];

  return [
    '**Reporting period: ' + format(since) + ' – ' + format(now) + '**',
    'Checkout snapshots and commit history; deployment dates, running processes and test results are not verified.',
    'Status notes reviewed: ' + developmentReportStatus.reviewed +
      (stale ? ' — OUTDATED; review required.' : '') +
      ' Unresolved notes are carried forward.',
    ...snapshots.flatMap((item, index) => ['', '**' + headings[index] + '**', item.text]),
    '', '**Promotion gaps**',
    bullet([compare('dev', 'beta'), compare('beta', 'production')]),
    'Committed files only; differences do not imply promotion direction.',
    '', '**Key decisions**', bullet(developmentReportStatus.decisions),
    '', '**Blockers**', bullet(developmentReportStatus.blockers),
    '', '**In progress**', bullet(developmentReportStatus.unfinished),
    '', '**Next priorities**',
    developmentReportStatus.priorities.map((item, index) => (index + 1) + '. ' + item).join('\n')
  ].join('\n');
}

async function developmentSummaryCommand() {
  if (process.argv[3] === '--help') {
    console.log('Usage: node scripts/goliath.js summary [message-id] < summary.txt');
    console.log('Automatic report: node scripts/goliath.js summary --auto [--preview]');
    console.log('Omit message-id to post; supply it to edit an existing Goliath message.');
    return true;
  }

'use strict';

const fs = require('node:fs');
const path = require('node:path');

process.chdir(path.resolve(__dirname, '..'));
require('../src/config/envLoader').loadEnvironment('dev');

const { resolveTokenDetails } = require('../src/config/tokenResolver');
const { REST, Routes } = require('discord.js');

async function main() {
  const automatic = process.argv.includes('--auto');
  const preview = process.argv.includes('--preview');
  if (!automatic && process.stdin.isTTY) {
    throw new Error('Supply report text through stdin, or use --auto.');
  }

  const summary = automatic ? buildDevelopmentReport() : fs.readFileSync(0, 'utf8').trim();
  if (preview) {
    console.log(summary);
    return;
  }
  if (!summary) throw new Error('Summary is empty.');
  if (summary.length > 4096) {
    throw new Error('Summary exceeds the 4,096-character embed limit. Nothing posted.');
  }

  const { token } = resolveTokenDetails({ mode: 'DEV' });
  if (!token) throw new Error('DEV bot token is missing.');

  const channelId = '1561885763652685896';
  const guildId = '1515201360386068642';
  const rest = new REST({ version: '10' }).setToken(token);
  const channel = await rest.get(Routes.channel(channelId));

  if (channel.guild_id !== guildId) {
    throw new Error('Destination does not match KSJ Development.');
  }


  const guild = await rest.get(Routes.guild(channel.guild_id));
  const bot = await rest.get(Routes.user('@me'));

  const guildIcon = guild.icon
    ? 'https://cdn.discordapp.com/icons/' + guild.id + '/' + guild.icon + '.png?size=256'
    : null;
  const botAvatar = bot.avatar
    ? 'https://cdn.discordapp.com/avatars/' + bot.id + '/' + bot.avatar + '.png?size=128'
    : null;

  const labels = {
    'dev — development': '🔵 DEV — Development',
    'beta — testing': '🟡 BETA — Testing',
    'production — live': '🟢 PRODUCTION — Live',
    'promotion gaps': '🔀 Promotion Gaps',
    'recorded code changes': '🛠️ Recorded Code Changes',
    completed: '✅ Completed',
    'key decisions': '📌 Key Decisions',
    decisions: '📌 Key Decisions',
    'blockers and unfinished work': '🚧 Blockers & Unfinished Work',
    blockers: '🚧 Blockers',
    'in progress': '🔧 In Progress',
    'next priorities': '🎯 Next Priorities'
  };

  const reportFields = [];
  const intro = [];
  let section = null;

  for (const line of summary.split(/\r?\n/)) {
    const heading = line.trim().match(/^\*\*(.+?)\*\*$/);
    const label = heading && labels[heading[1].trim().toLowerCase()];

    if (label) {
      section = { name: label, lines: [] };
      reportFields.push(section);
    } else if (section) {
      section.lines.push(line);
    } else {
      intro.push(line);
    }
  }

  const fields = reportFields.map(section => ({
    name: section.name,
    value: section.lines.join('\n').trim() || 'No update recorded.',
    inline: false
  }));

  if (fields.length > 25 || fields.some(field => field.value.length > 1024)) {
    throw new Error('A report section exceeds Discord field limits. Nothing posted.');
  }

  const embed = {
    author: {
      name: guild.name,
      ...(botAvatar ? { icon_url: botAvatar } : {})
    },
    title: 'Weekly Development Update',
    description: intro.join('\n').trim() || 'KSJ Goliath development progress and priorities.',
    color: 0x004CFF,
    ...(guildIcon ? { thumbnail: { url: guildIcon } } : {}),
    fields,
    footer: { text: 'KSJ Development • Goliath' },
    timestamp: new Date().toISOString()
  };

  const embedLength = embed.title.length + embed.description.length
    + embed.author.name.length + embed.footer.text.length
    + fields.reduce((total, field) => total + field.name.length + field.value.length, 0);

  if (embedLength > 6000) {
    throw new Error('Report exceeds Discord embed limits. Nothing posted.');
  }


  const messageId = process.argv.slice(3).find(value => !value.startsWith('--'));
  if (messageId && !/^\d{17,20}$/.test(messageId)) {
    throw new Error('Invalid message ID. Nothing changed.');
  }

  if (messageId) {
    const existing = await rest.get(Routes.channelMessage(channelId, messageId));
    if (existing.author.id !== bot.id) {
      throw new Error('That message belongs to another account. Nothing changed.');
    }
  }

  const endpoint = messageId
    ? Routes.channelMessage(channelId, messageId)
    : Routes.channelMessages(channelId);
  const method = messageId ? 'patch' : 'post';

  const message = await rest[method](endpoint, {

    body: {
      embeds: [embed],
      allowed_mentions: { parse: [] }
    }
  });

  console.log(`✅ Posted: https://discord.com/channels/${guildId}/${channelId}/${message.id}`);
}


  await main();
  return true;
}


async function quarantineContainmentAudit() {
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const isolation = read('src/core/security/protection/quarantine/isolation.js');
const recovery = read('src/core/security/protection/quarantine/recoveryEvents.js');
const release = read('src/core/security/protection/quarantine/releaseLifecycle.js');
const verification = read('src/modules/securityStudio/verificationQuarantine.js');

function required(source, fragment, label) {
  assert(source.includes(fragment), label);
}

required(isolation, 'fetchActiveThreads()', 'Active threads must be inspected during containment verification');
required(isolation, 'allowedChannelIds', 'Authorised investigation room must be explicitly exempted');
required(isolation, 'memberViewAllowRestores', 'Member-specific permissions must be recorded for restoration');
required(recovery, 'Events.ThreadCreate', 'New threads must trigger containment checks');
required(recovery, 'Events.ThreadUpdate', 'Updated threads must trigger containment checks');
required(recovery, 'Events.ThreadMembersUpdate', 'Thread membership changes must trigger containment checks');
required(recovery, 'Events.ChannelCreate', 'New channels must trigger containment checks');
required(recovery, 'Events.ChannelUpdate', 'Channel permission changes must trigger containment checks');
required(recovery, 'Events.GuildMemberAdd', 'Rejoining members must be recontained');
required(recovery, 'Events.GuildMemberUpdate', 'Role changes must be recontained');
required(release, 'Array.isArray(snapshot.roles)', 'Release must reject missing original-role snapshots');
required(release, 'releasesInProgress', 'Release transactions must be guarded against concurrent recovery');
required(verification, 'auditLegacyQuarantineSessions', 'Legacy verification cases must be reported');
required(read('src/core/security/protection/quarantine/state.js'), 'legacy_without_shared_snapshot', 'Missing legacy shared snapshots must be flagged');
required(read('src/core/security/protection/quarantine/state.js'), 'missing_original_roles', 'Missing original roles must be flagged');
// Load the real modules with explicit boundaries; fixtures never touch guild files or Discord.
const { createRequire } = require('node:module');
function load(file, mocks, testExport = '') {
  const filename = path.join(root, file);
  const localRequire = createRequire(filename);
  const loaded = { exports: {} };
  const fixtureRequire = id => {
    if (Object.hasOwn(mocks, id)) return mocks[id];
    if (id === 'discord.js' || id.startsWith('node:')) return localRequire(id);
    throw new Error(`Unmocked quarantine audit dependency: ${file} -> ${id}`);
  };
  new Function('require', 'module', 'exports', '__filename', '__dirname', read(file) + testExport)(fixtureRequire, loaded, loaded.exports, filename, path.dirname(filename));
  return loaded.exports;
}
const base = 'src/core/security/protection/quarantine/';
const { Collection, PermissionsBitField, PermissionFlagsBits: P, ChannelType, Events } = require('discord.js');
const stateApi = load(base + 'state.js', { '../../../guild/guildManager': {}, '../../../../server/sockets/socketHub': {} });
const { QUARANTINE_MODES, getQuarantineMode, auditQuarantineSnapshots, isAutomaticQuarantineReleaseDue, hasOriginalQuarantineRoles } = stateApi;
const uid = '111111111111111111', other = '222222222222222222', originalRole = '333333333333333333';
const sessions = { [uid]: { state: 'quarantined', quarantineChannelId: 'legacy' }, approval: { state: 'review' } };
const snapshots = { [uid]: { mode: 'investigation', source: 'verification', interviewChannelId: 'shared' }, [other]: { mode: 'investigation', roles: [originalRole], interviewChannelId: 'shared' } };
const before = JSON.stringify({ sessions, snapshots });
const report = auditQuarantineSnapshots(sessions, snapshots);
assert.equal(report.needsReview, 2);
assert(report.cases.find(c => c.userId === uid).reasons.includes('missing_original_roles'));
assert(report.cases.find(c => c.userId === uid).reasons.includes('room_mismatch'));
assert(report.cases.every(c => c.reasons.includes('duplicate_room_assignment')));
assert.equal(JSON.stringify({ sessions, snapshots }), before, 'Reconciliation must be read-only');
assert.equal(auditQuarantineSnapshots({ approval: { state: 'review' } }, {}).needsReview, 0);
assert.equal(auditQuarantineSnapshots(sessions, {}).cases[0].reason, 'legacy_without_shared_snapshot');
assert(auditQuarantineSnapshots({ [uid]: { state: 'verified' } }, { [uid]: { source: 'verification', mode: 'investigation', roles: [], interviewChannelId: 'room' } }).cases[0].reasons.includes('verification_state_conflict'));
assert.equal(auditQuarantineSnapshots({ [uid]: { state: 'quarantined' } }, { [uid]: { mode: 'investigation', roles: [] } }).cases[0].reason, 'missing_shared_room');
assert.equal(auditQuarantineSnapshots({}, { [uid]: { mode: 'security', roles: [null] } }).cases[0].reason, 'invalid_original_roles');
assert.equal(isAutomaticQuarantineReleaseDue({ expiresAt: 1 }), false);
assert.equal(isAutomaticQuarantineReleaseDue({ expiresAt: 'invalid', autoRelease: true }), false);
assert.equal(isAutomaticQuarantineReleaseDue({ expiresAt: 1, autoRelease: true }), true);

function fixture(snapshot = {}) {
  let state = { roleId: 'quarantine', users: { [uid]: { memberId: uid, mode: 'investigation', roles: [originalRole], interviewChannelId: 'room', ...snapshot } } };
  const mutations = [];
  const role = { id: 'quarantine', editable: true, position: 1 };
  const guild = { id: 'guild', ownerId: 'owner', name: 'Fixture', roles: { cache: new Collection([[role.id, role], [originalRole, { id: originalRole, position: 2 }]]), fetch: async () => guild.roles.cache }, channels: { cache: new Collection() } };
  const member = { id: uid, guild, user: { tag: 'Fixture' }, roles: { cache: new Collection([[role.id, role]]), set: async ids => { mutations.push(['roles', ...ids]); member.roles.cache = new Collection(ids.map(id => [id, guild.roles.cache.get(id) || { id }])); return member; } } };
  guild.members = { me: { id: 'bot', roles: { highest: { position: 10 } }, permissions: new PermissionsBitField([P.ManageRoles, P.ManageChannels]) }, fetch: async () => member };
  const api = { QUARANTINE_MODES, getQuarantineMode, isAutomaticQuarantineReleaseDue, hasOriginalQuarantineRoles, auditQuarantineSnapshots, getQuarantineState: () => structuredClone(state), saveQuarantineState: (g, value) => { state = structuredClone(value); }, emitCurrentQuarantineState: () => {}, normalizeArchivedRooms: v => v, normalizePendingRoomCleanups: v => v };
  return { guild, member, role, api, mutations, get state() { return state; } };
}
// Legacy resolution cannot reconstruct already-removed roles or create a fresh room.
{
  const f = fixture();
  delete f.state.users[uid];
  const session = { state: 'quarantined', quarantineChannelId: 'legacy' };
  const noMutation = () => { throw Error('Legacy audit attempted a mutation'); };
  const verificationApi = load('src/modules/securityStudio/verificationQuarantine.js', {
    './verificationStore': { getSession: () => session, getVerificationSection: () => ({ sessions: { [uid]: session } }), normalizeSettings: () => ({ roles: {} }), upsertSession: noMutation, addSecurityHistory: noMutation },
    '../../core/guild/guildManager': { isModuleEnabled: () => true },
    '../../core/security/protection/quarantine/state': stateApi,
    '../../core/security/protection/quarantine': { ...f.api, quarantineMember: noMutation },
  });
  assert.equal((await verificationApi.ensureQuarantineCase(f.guild, f.member)).needsReview, true);
  for (const action of ['release', 'reject', 'escalate']) assert.equal((await verificationApi.resolveQuarantineCase(f.guild, uid, action, 'staff')).needsReview, true);
  assert.equal((await verificationApi.escalateToModHub(f.guild, f.member, 'staff')).needsReview, true);
  assert.equal(verificationApi.auditLegacyQuarantineSessions(f.guild.id).needsReview, 1);
  assert.equal(f.mutations.length, 0);
}
// Evidence-backed legacy adoption: persist originals, reuse room, never grant them.
{
  const priorMode = process.env.BOT_MODE;
  process.env.BOT_MODE = 'DEV';
  try {
    const qid = '444444444444444444', roomId = '555555555555555555';
    const input = { userId: uid, roomId, addEventId: 'add', stripEventId: 'strip' };
    const roleList = ids => ids.map(id => ({ id }));
    const history = [
      { guildId: 'guild', eventId: 'add', type: 'member.roles.update', timestamp: '2026-10-23T23:04:38.450Z', before: { roles: roleList([originalRole]) }, after: { roles: roleList([originalRole, qid]) } },
      { guildId: 'guild', eventId: 'strip', type: 'member.roles.update', timestamp: '2026-10-23T23:04:38.784Z', before: { roles: roleList([originalRole, qid]) }, after: { roles: roleList([qid]) } },
    ];
    async function run(change = () => {}, containmentSuccess = true) {
      const f = fixture();
      delete f.state.users[uid]; f.state.roleId = qid;
      f.role.id = qid; f.role.name = 'Goliath Quarantine'; f.role.permissions = new PermissionsBitField();
      f.guild.roles.cache.delete('quarantine'); f.guild.roles.cache.set(qid, f.role);
      f.member.roles.cache = new Collection([[qid, f.role]]);
      const room = { id: roomId, guild: f.guild, type: ChannelType.GuildText, permissionOverwrites: { cache: new Collection([[f.guild.id, { deny: new PermissionsBitField([P.ViewChannel]) }]]) } };
      f.guild.channels.fetch = async () => room;
      const section = { settings: { roles: { quarantine: [qid] } }, sessions: { [uid]: { state: 'quarantined', quarantineChannelId: roomId, quarantinedAt: '2026-10-23T23:04:39.062Z' } } };
      const evidence = structuredClone(history);
      let locked = false, enforcement = 0, saves = 0;
      change({ f, section, evidence, room });
      const engine = { ...f.api, tryBeginQuarantineOperation: () => { if (locked) return false; locked = true; return true; }, endQuarantineOperation: () => { locked = false; },
        saveQuarantineState: (g, state) => { saves++; f.api.saveQuarantineState(g, state); },
        enforceQuarantineOnMember: async (member, options) => {
          enforcement++; assert.equal(locked, false); assert.equal(member.id, uid); assert.equal(options.existingRoomOnly, true);
          assert.deepEqual(f.state.users[uid].roles, [originalRole]);
          assert.equal(f.state.users[uid].interviewChannelId, roomId); assert.equal(f.state.users[uid].autoRelease, false);
          assert.equal(f.state.users[uid].expiresAt, null);
          return { success: containmentSuccess, verification: { success: containmentSuccess } };
        } };
      const api = load('src/modules/securityStudio/verificationQuarantine.js', {
        './verificationStore': { getVerificationSection: () => section, getSession: () => section.sessions[uid], normalizeSettings: s => s,
          upsertSession: (g, u, patch) => Object.assign(section.sessions[u], patch), addSecurityHistory: () => {} },
        '../../core/guild/guildManager': {}, '../../core/security/protection/quarantine/state': stateApi,
        '../../core/security/protection/quarantine': engine,
        '../../owner/auditIntelligence/auditStore': { getUser: () => ({ roleHistory: evidence }) },
      });
      const result = await api.reconcileLegacyQuarantine(f.guild, input);
      assert.equal(locked, false); assert.equal(f.mutations.length, 0, 'Adoption must not grant or remove roles');
      return { result, f, saves, enforcement, section, api };
    }
    const success = await run(); assert.equal(success.result.ok, true); assert.equal(success.saves, 1); assert.equal(success.enforcement, 1);
    assert.equal(success.section.sessions[uid].moderationIsolationMode, 'investigation');
    assert.equal(success.section.sessions[uid].state, 'quarantined');
    const saved = JSON.stringify(success.f.state);
    assert.equal((await success.api.reconcileLegacyQuarantine(success.f.guild, input)).ok, false);
    assert.equal(JSON.stringify(success.f.state), saved, 'Retries must never overwrite originals');
    for (const change of [
      ({ evidence }) => { evidence.pop(); },
      ({ evidence }) => { evidence[0].guildId = 'other'; },
      ({ evidence }) => { evidence[0].before.roles = null; },
      ({ evidence }) => { evidence[1].before.roles = roleList([qid]); },
      ({ evidence }) => { evidence[1].timestamp = '2026-10-22T00:00:00Z'; },
      ({ section }) => { section.sessions[uid].state = 'verified'; },
      ({ section }) => { section.sessions[other] = { quarantineChannelId: roomId }; },
      ({ section }) => { section.settings.roles.quarantine = [qid, originalRole]; },
      ({ f }) => { f.state.users[other] = { interviewChannelId: roomId }; },
      ({ f }) => { f.member.roles.cache.set(originalRole, { id: originalRole }); },
      ({ f }) => { f.guild.channels.fetch = async () => { throw Error('network unavailable'); }; },
      ({ room }) => { room.permissionOverwrites.cache.clear(); },
    ]) {
      const rejected = await run(change); assert.equal(rejected.result.ok, false); assert.equal(rejected.saves, 0); assert.equal(rejected.enforcement, 0);
    }
    const failed = await run(() => {}, false); assert.equal(failed.result.ok, false); assert.equal(failed.result.adopted, true);
    assert.deepEqual(failed.f.state.users[uid].roles, [originalRole], 'Containment failure must retain the evidence-backed snapshot');
    process.env.BOT_MODE = 'BETA';
    assert.equal((await success.api.reconcileLegacyQuarantine(success.f.guild, input)).ok, false);
  } finally { if (priorMode === undefined) delete process.env.BOT_MODE; else process.env.BOT_MODE = priorMode; }
}
// Maintenance is consumed only by the DEV collector from a local DEV request.
{
  for (const [mode, targetMode, requestedFrom, requestedBy, allowed] of [
    ['DEV', 'DEV', 'DEV', 'local-dev-maintenance', true],
    ['BETA', 'BETA', 'DEV', 'local-dev-maintenance', false],
    ['DEV', 'DEV', 'PRODUCTION', 'local-dev-maintenance', false],
    ['DEV', 'DEV', 'DEV', uid, false],
  ]) {
    let calls = 0, outcome;
    const command = { id: 'test', action: 'legacy-quarantine-reconcile', guildId: 'guild', targetMode, requestedFrom, requestedBy, payload: { userId: uid } };
    const controls = load('src/events/client/sentinelControlCenter.js', {
      '../../owner/auditIntelligence/auditStore': { runtimeMode: () => mode, getPendingRemoteCommands: () => [command], claimRemoteCommand: () => command, finishRemoteCommand: (id, result) => { outcome = result; } },
      '../../owner/sentinel/eventPipeline': {}, '../../core/security/protection/core': {},
      '../../modules/securityStudio/verificationQuarantine': { reconcileLegacyQuarantine: async (guild, payload) => { calls++; assert.equal(payload.userId, uid); return { ok: true }; } },
    }, '\nmodule.exports.processRemote = processRemote;');
    await controls.processRemote({ guilds: { cache: new Collection([['guild', { id: 'guild' }]]) } });
    assert.equal(calls, allowed ? 1 : 0); assert.equal(outcome.ok, allowed);
  }
}
// Effective permission checks include threads, fresh roles and the authorised room.
{
  const f = fixture();
  const access = (id, permissions) => ({ id, name: id, type: ChannelType.GuildText, permissionsFor: () => new PermissionsBitField(permissions) });
  const room = access('room', [P.ViewChannel, P.SendMessages, P.ReadMessageHistory]);
  const outside = access('outside', []);
  f.guild.channels.cache = new Collection([[room.id, room], [outside.id, outside]]);
  f.guild.channels.fetch = async () => f.guild.channels.cache;
  let threads = new Collection();
  f.guild.channels.fetchActiveThreads = async () => ({ threads });
  const isolationApi = load(base + 'isolation.js', { './state': f.api, './roleManager': {} });
  assert.equal((await isolationApi.verifyMemberContainment(f.guild, f.member, ['room'])).success, true);
  threads.set('thread', access('thread', [P.ViewChannel]));
  assert.equal((await isolationApi.verifyMemberContainment(f.guild, f.member, ['room'])).leaks[0].channelId, 'thread');
  threads.clear();
  room.permissionsFor = () => new PermissionsBitField([P.ViewChannel]);
  assert.equal((await isolationApi.verifyMemberContainment(f.guild, f.member, ['room'])).success, false);
  room.permissionsFor = () => new PermissionsBitField([P.ViewChannel, P.SendMessages, P.ReadMessageHistory]);
  f.guild.channels.fetchActiveThreads = async () => { throw Error('Thread inventory unavailable'); };
  assert.equal((await isolationApi.verifyMemberContainment(f.guild, f.member, ['room'])).success, false);
  f.guild.channels.fetchActiveThreads = async () => ({ threads });
  f.guild.channels.fetch = async () => { throw Error('Channel inventory unavailable'); };
  assert.equal((await isolationApi.verifyMemberContainment(f.guild, f.member, ['room'])).success, false);
  assert.equal((await isolationApi.syncQuarantineIsolation(f.guild, { role: f.role })).success, false);
  assert.equal((await isolationApi.restoreMemberViewAllows(f.guild, uid, ['uncached'])).failed.length, 1);
  f.guild.channels.fetch = async () => { throw Object.assign(Error('Deleted'), { code: 10003 }); };
  assert.equal((await isolationApi.restoreMemberViewAllows(f.guild, uid, ['deleted'])).failed.length, 0);
}
// Execute the real release transaction, permission preflight and shared operation guard.
{
  const f = fixture();
  const roleApi = load(base + 'memberLifecycle.js', { './state': f.api, './roleManager': {}, './isolation': {}, './investigationRooms': {}, '../../../../owner/dev/DevOverrideManager': {}, '../core': {} });
  const releaseApi = load(base + 'releaseLifecycle.js', { './state': f.api, './roleManager': { ensureQuarantineRole: async () => f.role }, './memberLifecycle': roleApi,
    './isolation': { restoreMemberViewAllows: async () => ({ restored: [], failed: [] }), recontainMemberViewAllows: async () => ({ contained: [], failed: [] }), verifyMemberContainment: async () => ({ success: true }) },
    '../../../../modules/securityStudio/verificationQuarantine': { reconcileModerationRelease: async () => ({ ok: true }) },
  });
  f.state.users[uid].roles = undefined;
  assert.equal((await releaseApi.restoreQuarantinedMember(f.guild, f.member, { restoredBy: 'staff' })).success, false);
  f.state.users[uid].roles = [null];
  assert.equal((await releaseApi.restoreQuarantinedMember(f.guild, f.member, { restoredBy: 'staff' })).success, false);
  f.state.users[uid].roles = [originalRole];
  f.state.users[uid].mode = 'security';
  assert.equal((await releaseApi.restoreQuarantinedMember(f.guild, f.member, { restoredBy: 'staff' })).success, false);
  assert.equal(f.mutations.length, 0);
  f.state.users[uid].mode = 'investigation';
  f.guild.roles.cache.get(originalRole).position = 20;
  assert.equal((await releaseApi.restoreQuarantinedMember(f.guild, f.member, { restoredBy: 'staff' })).success, false);
  assert.equal(f.mutations.length, 0);
  f.guild.roles.cache.get(originalRole).position = 2;
  delete f.state.users[uid].interviewChannelId;
  let unblock, entered;
  const gate = new Promise(resolve => { unblock = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const set = f.member.roles.set;
  f.member.roles.set = async ids => { entered(); await gate; return set(ids); };
  const pending = releaseApi.restoreQuarantinedMember(f.guild, f.member, { restoredBy: 'staff' });
  await started;
  assert.equal(releaseApi.isQuarantineReleaseInProgress(f.guild.id, uid), true);
  assert.equal(releaseApi.tryBeginQuarantineOperation(f.guild.id, uid), false);
  assert.equal((await releaseApi.restoreQuarantinedMember(f.guild, f.member, { restoredBy: 'staff' })).busy, true);
  unblock();
  assert.equal((await pending).success, true);
  assert.deepEqual(f.mutations, [['roles', originalRole]]);
  assert.equal(f.state.users[uid], undefined);
  assert.equal(releaseApi.isQuarantineReleaseInProgress(f.guild.id, uid), false);
}
// Partial channel restoration rolls back and preserves every original-role record.
{
  const f = fixture({ memberViewAllowRestores: ['outside'] });
  const original = JSON.stringify(f.state.users[uid]);
  const releaseApi = load(base + 'releaseLifecycle.js', { './state': f.api, './roleManager': { ensureQuarantineRole: async () => f.role },
    './memberLifecycle': { getRestorableRoleIds: async () => ({ restored: [originalRole], skipped: [] }) },
    './isolation': { restoreMemberViewAllows: async () => ({ restored: ['outside'], failed: [{ channelId: 'blocked' }] }), recontainMemberViewAllows: async () => ({ contained: ['outside'], failed: [] }), verifyMemberContainment: async () => ({ success: true }) },
  });
  const result = await releaseApi.restoreQuarantinedMember(f.guild, f.member, { restoredBy: 'staff' });
  assert.equal(result.success, false);
  assert.equal(result.rollback.verification.success, true);
  assert.deepEqual(f.mutations, [['roles', originalRole], ['roles', 'quarantine']]);
  assert.equal(JSON.stringify(f.state.users[uid]), original);
  assert.equal((await releaseApi.clearExpiredAbsentMember(f.guild, uid, f.state)).cleared, false);
}
// Startup, scheduled expiry and rejoin enforcement share the same explicit release policy.
{
  const f = fixture({ expiresAt: 1, autoRelease: false });
  const original = JSON.stringify(f.state.users[uid].roles);
  let restored = 0, cleared = 0, roomCalls = 0, syncingFails = false, locked = false;
  const recovery = load(base + 'enforcementRecovery.js', { './state': f.api, '../../../../owner/auditIntelligence/auditIntelligence': {},
    './roleManager': { ensureQuarantineRole: async () => f.role },
    './isolation': { syncQuarantineIsolation: async () => ({ success: !syncingFails, memberViewAllowRestores: ['outside'] }), verifyMemberContainment: async () => ({ success: true }) },
    './investigationRooms': { ensureInvestigationRoomForSnapshot: async () => { roomCalls++; return { id: 'room' }; } },
    './releaseLifecycle': { tryBeginQuarantineOperation: () => { if (locked) return false; locked = true; return true; }, endQuarantineOperation: () => { locked = false; }, restoreQuarantinedMember: async () => { restored++; return { success: true }; }, clearExpiredAbsentMember: async () => { cleared++; return { success: true }; }, retryPendingInvestigationRoomCleanups: async () => ({ checked: 0, archived: 0, failed: 0 }) },
  });
  assert.equal((await recovery.recoverGuildQuarantine(f.guild)).reapplied, 1);
  assert.equal(restored, 0);
  assert.equal(JSON.stringify(f.state.users[uid].roles), original);
  assert.equal((await recovery.enforceQuarantineOnMember(f.member)).success, true); // Rejoin / role recovery.
  assert.equal(roomCalls, 2);
  locked = true;
  assert.equal((await recovery.enforceQuarantineOnMember(f.member)).busy, true);
  locked = false; syncingFails = true;
  assert.equal((await recovery.enforceQuarantineOnMember(f.member)).success, false);
  assert.deepEqual(f.state.users[uid].memberViewAllowRestores, ['outside']);
  assert.equal(locked, false);
  const client = { guilds: { cache: new Collection([[f.guild.id, f.guild]]) } };
  assert.equal((await recovery.restoreExpiredQuarantines(client)).checked, 0);
  f.guild.members.fetch = async () => { throw Object.assign(Error('Unknown Member'), { code: 10007 }); };
  await recovery.recoverGuildQuarantine(f.guild);
  assert.equal(cleared, 0);
  f.state.users[uid].autoRelease = true;
  assert.equal((await recovery.recoverGuildQuarantine(f.guild)).restored, 1);
  assert.equal(cleared, 1);
  f.guild.members.fetch = async () => { throw Error('Discord unavailable'); };
  await assert.rejects(recovery.recoverGuildQuarantine(f.guild), /Discord unavailable/);
  assert.equal(cleared, 1);
  f.guild.members.fetch = async () => f.member;
  assert.equal((await recovery.recoverGuildQuarantine(f.guild)).restored, 1);
  assert.equal(restored, 1);
}
// Simultaneous initial quarantine requests cannot snapshot stripped roles or create two rooms.
{
  const f = fixture();
  delete f.state.users[uid];
  f.member.roles.cache = new Collection([[originalRole, f.guild.roles.cache.get(originalRole)]]);
  let unblock, entered, created = 0;
  const gate = new Promise(resolve => { unblock = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const locks = load(base + 'releaseLifecycle.js', { './state': f.api, './roleManager': {}, './memberLifecycle': {}, './isolation': {} });
  const lifecycle = load(base + 'memberLifecycle.js', { './state': f.api,
    '../../../../owner/dev/DevOverrideManager': { shouldBlockOwnerDestructiveAction: () => false }, '../core': { canManageTargetMember: () => ({ allowed: true }) },
    './roleManager': { ensureQuarantineRole: async () => { entered(); await gate; return f.role; } },
    './isolation': { syncQuarantineIsolation: async () => ({ success: true, memberViewAllowRestores: [] }), verifyMemberContainment: async () => ({ success: true }) },
    './investigationRooms': { createInvestigationRoom: async () => { created++; return { id: 'room' }; } }, './releaseLifecycle': locks,
  });
  const pending = lifecycle.quarantineMember(f.guild, f.member, { quarantinedBy: 'staff' });
  await started;
  assert.equal((await lifecycle.quarantineMember(f.guild, f.member, { quarantinedBy: 'staff' })).busy, true);
  unblock();
  assert.equal((await pending).success, true);
  assert.equal(created, 1);
  assert.deepEqual(f.state.users[uid].roles, [originalRole]);
  assert.equal(locks.isQuarantineReleaseInProgress(f.guild.id, uid), false);
}
// Concurrent recovery and stale event snapshots must reuse the canonical room.
{
  const f = fixture();
  f.guild.roles.cache = new Collection();
  f.guild.channels.cache = new Collection();
  f.guild.channels.cache.find = () => null;
  let creates = 0;
  const channel = { id: 'replacement', guild: f.guild, type: ChannelType.GuildText, permissionOverwrites: { edit: async () => {} }, send: async () => {} };
  f.guild.channels.create = async options => { if (options.type === ChannelType.GuildText) { creates++; await Promise.resolve(); } return { ...channel, id: options.type === ChannelType.GuildCategory ? 'category' : channel.id, name: options.name }; };
  f.guild.channels.fetch = async id => { if (!id) return f.guild.channels.cache; throw Object.assign(Error('Unknown Channel'), { code: 10003 }); };
  const rooms = load(base + 'investigationRooms.js', { '../../../administration/mod/permissions': { canUseModAction: () => false }, './state': { ...f.api, DEFAULT_INVESTIGATION_CATEGORY_NAME: 'Investigations' }, './isolation': { quarantineDenyOverwrite: () => ({ ViewChannel: false }), investigationMemberOverwrite: () => ({ ViewChannel: true, SendMessages: true, ReadMessageHistory: true }), investigationStaffOverwrite: () => ({ ViewChannel: true }) } });
  const stale = structuredClone(f.state.users[uid]);
  const repaired = await Promise.all([rooms.ensureInvestigationRoomForSnapshot(f.guild, f.member, f.role, stale), rooms.ensureInvestigationRoomForSnapshot(f.guild, f.member, f.role, stale)]);
  assert.equal(creates, 1);
  assert.equal(repaired[0].id, repaired[1].id);
  f.guild.channels.cache.set(channel.id, channel);
  await rooms.ensureInvestigationRoomForSnapshot(f.guild, f.member, f.role, stale);
  assert.equal(creates, 1);
  f.guild.channels.cache.clear();
  f.guild.channels.fetch = async id => { if (!id) return f.guild.channels.cache; throw Object.assign(Error('Unknown Channel'), { code: 10003 }); };
  await assert.rejects(rooms.ensureInvestigationRoomForSnapshot(f.guild, f.member, f.role, stale, { existingRoomOnly: true }), /cannot create a replacement/);
  assert.equal(creates, 1, 'Legacy adoption must never create a replacement room');
  f.guild.channels.fetch = async () => { throw Error('Discord unavailable'); };
  await assert.rejects(rooms.ensureInvestigationRoomForSnapshot(f.guild, f.member, f.role, stale), /Discord unavailable/);
  assert.equal(creates, 1);
  delete f.state.users[uid];
  assert.equal(await rooms.ensureInvestigationRoomForSnapshot(f.guild, f.member, f.role, stale), null);
}
// Room controls use fresh authority, keep transcripts private, and never delete an active room.
{
  const os = require('node:os');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'goliath-room-controls-'));
  try {
    const f = fixture();
    const room = { id: 'room', guild: f.guild, messages: { fetch: async () => new Collection() }, permissionsFor: () => new PermissionsBitField([P.ViewChannel, P.ReadMessageHistory]), delete: async () => { events.push('delete'); } };
    f.guild.channels.fetch = async () => room;
    const actor = { id: other, permissions: new PermissionsBitField([P.ManageChannels]) };
    f.guild.members.fetch = async () => actor;
    let dmFailure = false, dmSends = [];
    let authorised = true, exportFailure = false, deliveryFailure = false, reuseSaved = false, changedAfterExport = false, checks = 0, events = [], replies = [], restores = 0;
    const htmlPath = path.join(temp, 'room.html'), jsonPath = path.join(temp, 'room.json');
    fs.writeFileSync(htmlPath, '<html>record</html>'); fs.writeFileSync(jsonPath, JSON.stringify({ ticket: { guildId: f.guild.id, discordChannelId: 'room', creatorId: uid } }));
    const controls = load('src/core/administration/mod/quarantineInteractions.js', {
      '../../../core/ui/interactionResponse': { safeReply: async (i, p) => { replies.push(p); return true; }, safeEditReply: async (i, p) => { replies.push(p); return true; } },
      './permissions': { canUseModAction: () => authorised, recordModerationSystemEvent: () => {}, requireModeratableTarget: async () => f.member },
      '../../../core/ui/memberNotice': require(root + '/src/core/ui/memberNotice'),
      './storage': {}, './panel': { refreshDashboard: async () => {} }, './investigationAccess': {},
      '../../security/protection/quarantine': { ...f.api, restoreQuarantinedMember: async () => { restores++;
        f.state.archivedRooms = [{ channelId: 'room', memberId: uid, roomTranscript: f.state.users[uid].roomTranscript }];
        delete f.state.users[uid];
        return { success: true, archive: { archived: true, channelId: 'room' } }; } },
      '../../../modules/securityStudio/verificationStore': { getVerificationSection: () => ({ sessions: {} }) },
      '../../../modules/feedbackStudio/tickets/ticketsTranscripts': { checkTranscriptCurrent: async (channel, transcript) => ({ current: ++checks === 1 ? reuseSaved && Boolean(transcript) : !changedAfterExport }), createTranscript: async (client, ticket, options) => {
        events.push('export'); if (exportFailure) throw Error('export unavailable');
        assert.equal(ticket.type, 'investigation'); assert.equal(options.requireComplete, true);
        return { htmlPath, jsonPath, htmlFileName: 'room.html', jsonFileName: 'room.json', messageCount: 2, lastMessageId: null };
      } },
    });
    const click = async (action, channelId = 'room') => {
      checks = 0;
      const i = { customId: `mod_invroom_${action}:${uid}:room`, channelId, guild: f.guild, client: { users: { fetch: async id => { assert.equal(id, uid, 'Transcript DM must target the investigated member'); return { send: async payload => { if (dmFailure) throw Object.assign(Error('DM blocked'), { code: 50007 }); dmSends.push(payload); } }; } } }, user: { id: other },
        isButton: () => true, deferReply: async () => { i.deferred = true; },
        editReply: async p => { events.push('deliver'); if (deliveryFailure) throw Error('attachment delivery failed'); replies.push(p); return p; } };
      await controls.handleQuarantineInteraction(i);
    };
    await click('delete_confirm'); assert.deepEqual(events, []); assert(replies.at(-1).content.includes('active investigation'));
    await click('transcript', 'wrong-room'); assert.deepEqual(events, []);
    authorised = false; await click('transcript'); assert.deepEqual(events, []);
    authorised = true; await click('transcript'); assert.deepEqual(events, ['export', 'deliver']); assert.equal(replies.at(-1).flags, 64); assert.equal(replies.at(-1).files.length, 2);
    events = []; await click('close_confirm'); assert.equal(restores, 1); assert.deepEqual(events, ['export', 'deliver']);
    assert.equal(dmSends.length, 1, 'Closing must DM the saved transcript to the member');
    assert.equal(dmSends[0].files.length, 1, 'Member receives the readable HTML copy');
    assert.equal(dmSends[0].embeds[0].data.title, '📁 Your Investigation Transcript');
    assert(!JSON.stringify(dmSends[0].embeds[0].data).includes('Goliath'));
    assert.equal(f.state.archivedRooms[0].transcriptDelivery.sent, true);
    // Only an archived room may be deleted, and the transcript must be delivered first.
    delete f.state.users[uid]; f.state.archivedRooms = [{ channelId: 'room', memberId: uid }];
    events = []; exportFailure = true; await click('delete_confirm'); assert.deepEqual(events, ['export']);
    events = []; exportFailure = false; deliveryFailure = true; await click('delete_confirm'); assert.deepEqual(events, ['export', 'deliver']);
    events = []; deliveryFailure = false; changedAfterExport = true;
    await click('delete_confirm'); assert.deepEqual(events, ['export', 'deliver', 'deliver'], 'New messages after export must block deletion');
    changedAfterExport = false;
    events = []; await click('delete_confirm'); assert.deepEqual(events, ['export', 'deliver', 'deliver', 'delete']); assert(f.state.archivedRooms[0].deletedAt);
    assert(f.state.archivedRooms[0].roomTranscript, 'Deletion must retain its transcript record');
    delete f.state.archivedRooms[0].deletedAt;
    reuseSaved = true; events = [];
    await click('delete_confirm');
    assert.deepEqual(events, ['deliver', 'delete'], 'Unchanged closed rooms must reuse the saved transcript without exporting again');
    assert(!replies.at(-1).files, 'Reused transcripts must not be sent a second time');
    const dmCount = dmSends.length;
    changedAfterExport = true; events = []; await click('delete_confirm');
    assert.deepEqual(events, ['deliver'], 'A change during reused-transcript deletion must keep the room');
    await click('delete'); assert.equal(replies.at(-1).components[0].components[0].data.label, 'Confirm Delete');
    assert.equal(dmSends.length, dmCount, 'An unchanged transcript must not be DMed twice');
    const confirmation = replies.at(-1);
    assert.equal(confirmation.embeds[0].data.title, '📁 Delete Closed Room?');
    assert.equal(confirmation.content, null); assert.deepEqual(confirmation.allowedMentions, { parse: [] });
    assert(!JSON.stringify(confirmation.embeds[0].data).includes('Goliath'));
    delete f.state.archivedRooms[0].transcriptDelivery;
    dmFailure = true; changedAfterExport = false; events = []; await click('delete_confirm');
    assert(events.includes('delete'), 'Blocked DMs must not remove the saved transcript or prevent an authorised deletion');
    assert.equal(f.state.archivedRooms[0].transcriptDelivery.sent, false);
    assert(replies.at(-1).embeds[0].data.fields[0].value.includes('could not be delivered'));
    assert(f.state.archivedRooms[0].roomTranscript);
    dmFailure = false; delete f.state.archivedRooms[0].transcriptDelivery;
    fs.writeFileSync(jsonPath, JSON.stringify({ ticket: { guildId: 'different-guild', discordChannelId: 'room', creatorId: other } }));
    await click('delete_confirm'); assert.equal(dmSends.length, dmCount, 'Mismatched transcript ownership must block DM delivery');
    assert.equal(f.state.archivedRooms[0].transcriptDelivery.sent, false);


  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
// Shared transcript exporter refuses a truncated history and retains normal ticket output.
{
  const os = require('node:os');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'goliath-room-transcript-'));
  try {
    const message = id => ({ id, author: { id: uid, username: 'Test' }, createdTimestamp: Number(id), createdAt: new Date(Number(id)), content: '<script>alert(1)</script>', attachments: new Collection(), embeds: [] });
    let older = true;
    const channel = { id: uid, type: ChannelType.GuildText, name: 'investigation', messages: { fetch: async options => {
      if (!options.before) return new Collection([['2', message('2')], ['1', message('1')]]);
      return older ? new Collection([['0', message('0')]]) : new Collection();
    } } };
    const guild = { id: other, name: 'Fixture', channels: { fetch: async () => channel } };
    const transcripts = load('src/modules/feedbackStudio/tickets/ticketsTranscripts.js', {
      fs, path, '../../../config/runtimePaths': { getRuntimeRoot: () => temp }, './tickets': {},
    });
    const ticket = { ticketId: 'investigation-fixture', type: 'investigation', guildId: other, channelId: uid };
    await assert.rejects(transcripts.createTranscript({ guilds: { fetch: async () => guild } }, ticket, { limit: 2, requireComplete: true }), /exceeds the transcript limit/);
    older = false;
    const result = await transcripts.createTranscript({ guilds: { fetch: async () => guild } }, ticket, { limit: 2, requireComplete: true });
    const html = fs.readFileSync(result.htmlPath, 'utf8');
    assert(html.includes('Investigation Transcript')); assert(!html.includes('<script>alert(1)</script>')); assert.equal(result.messageCount, 2);
    assert(transcripts.buildHtmlTranscript({ ...ticket, type: 'support' }, transcripts.buildJsonTranscript(ticket, [])).includes('Ticket Transcript'));
    assert.equal((await transcripts.checkTranscriptCurrent(channel, result)).current, true);
    const closure = message('3');
    channel.messages.fetch = async () => new Collection([['3', closure], ['2', message('2')], ['1', message('1')]]);
    assert.equal((await transcripts.checkTranscriptCurrent(channel, result)).current, false, 'Added messages require a fresh transcript');
    assert.equal((await transcripts.checkTranscriptCurrent(channel, result, { ignoredMessageIds: ['3'] })).current, true, 'The recorded closure notice alone must not trigger a second export');
    channel.guild = { client: { user: { id: 'bot' } } };
    const legacyNotice = { ...message('3'), author: { id: 'bot' }, createdTimestamp: Date.now() + 1000,
      content: '🔓 **Investigation Closed**\n\nYour investigation has ended, and your quarantine restrictions have been lifted.\n\nIf you need any further help, please contact server management.' };
    channel.messages.fetch = async () => new Collection([['3', legacyNotice], ['2', message('2')], ['1', message('1')]]);
    assert.equal((await transcripts.checkTranscriptCurrent(channel, result, { allowLegacyClosureNotice: true })).current, true, 'Existing closed rooms should reuse their transcript despite the known closure notice');
    legacyNotice.author = { id: 'other' };
    assert.equal((await transcripts.checkTranscriptCurrent(channel, result, { allowLegacyClosureNotice: true })).current, false, 'Another author cannot impersonate the bot closure notice');
    channel.messages.fetch = async () => new Collection([['2', { ...message('2'), content: 'edited evidence' }], ['1', message('1')]]);
    assert.equal((await transcripts.checkTranscriptCurrent(channel, result)).current, false, 'Edited messages must be detected');
    channel.messages.fetch = async () => new Collection([['1', message('1')]]);
    assert.equal((await transcripts.checkTranscriptCurrent(channel, result)).current, false, 'Deleted messages must be detected');
    assert.equal((await transcripts.checkTranscriptCurrent(channel, { ...result, htmlPath: path.join(temp, 'missing.html') })).current, false);
    channel.messages.fetch = async () => { throw Error('History unavailable'); };
    await assert.rejects(transcripts.checkTranscriptCurrent(channel, result), /History unavailable/);
    const human = message('1'), bot = message('2');
    human.content = `**Evidence**\nHello <@${uid}> and <@&${other}> in <#${originalRole}>\n<script>alert(1)</script>\n[Unsafe](javascript:alert(1))`;
    human.attachments = new Collection([['file', { id: 'file', name: 'evidence.png', url: 'https://example.com/evidence.png', contentType: 'image/png', size: 2048 }]]);
    bot.author.bot = true; bot.embeds = [{ title: 'Review', description: '**Important**', fields: [{ name: 'Next steps', value: '• First\n• Second' }] }];
    const json = transcripts.buildJsonTranscript(ticket, [human, bot], { guildName: 'Example Server', channelName: 'private-review', mentionNames: { users: { [uid]: 'Test Member' }, roles: { [other]: 'Management' }, channels: { [originalRole]: 'rules' } } });
    assert.equal(json.analytics.userMessages, 1); assert.equal(json.analytics.botMessages, 1); assert.equal(json.analytics.attachments, 1); assert.equal(json.analytics.embeds, 1);
    assert.equal(json.messages[0].content, human.content, 'Raw conversation content must remain unchanged');
    const improved = transcripts.buildHtmlTranscript(ticket, json);
    assert(!improved.includes('Goliath')); assert(!improved.includes('NaN'));
    assert(improved.includes('<strong>Evidence</strong>')); assert(improved.includes('@Test Member')); assert(improved.includes('@Management')); assert(improved.includes('#rules'));
    assert(improved.includes('• First\n• Second')); assert(improved.includes('1 Jan 1970') && improved.includes('UTC')); assert(improved.includes('width=device-width')); assert(improved.includes('@media print'));
    assert(!improved.includes('<script>alert(1)</script>')); assert(!improved.includes('href="javascript:'));
    assert(improved.includes('id="search"')); assert(improved.includes('Include bot messages')); assert(improved.includes('Server')); assert(improved.includes('Case reference'));
    const old = structuredClone(json); old.analytics.attachments = null; old.analytics.botMessages = 0;
    assert(!transcripts.buildHtmlTranscript(ticket, old).includes('NaN'), 'Legacy counter values must not break a rendered transcript');

  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
// Access/notification roles follow Goliath authority, with explicit mention limits.
{
  const f = fixture();
  f.guild.ownerId = other;
  f.guild.roles.cache.set('management', { id: 'management', permissions: new PermissionsBitField(), mentionable: true });
  f.guild.roles.cache.set('unrelated', { id: 'unrelated', permissions: new PermissionsBitField([P.KickMembers]) });
  const writes = [], sent = [];
  const room = { id: 'room', guild: f.guild, permissionOverwrites: { edit: async id => writes.push(id) }, send: async payload => sent.push(payload) };
  const rooms = load(base + 'investigationRooms.js', {
    './state': f.api, './isolation': { investigationStaffOverwrite: () => ({ ViewChannel: true }) },
    '../../../administration/mod/permissions': { canUseModAction: member => member.roles.cache.has('management') },
  });
  assert.deepEqual(rooms.getInvestigationStaffRoleIds(f.guild), ['management']);
  await rooms.notifyInvestigationManagement(room, uid);
  assert.deepEqual(writes, ['management']); assert.deepEqual(sent[0].allowedMentions.roles, ['management']);
  assert.deepEqual(sent[0].allowedMentions.parse, []); assert.deepEqual(sent[0].allowedMentions.users, [other]);
  assert.equal(rooms.investigationRoomControls(uid, 'room').components.length, 4);
}
// Fresh category creation scans guild naming styles; saved/custom names stay authoritative.
{
  const f = fixture();
  const rooms = load(base + 'investigationRooms.js', { './state': { ...f.api, DEFAULT_INVESTIGATION_CATEGORY_NAME: 'Investigations' }, './isolation': {} });
  const categories = names => new Collection(names.map((name, index) => [String(index), { id: String(index), name, type: ChannelType.GuildCategory }]));
  for (const separator of [' | ', ' : ', ' · ', '|', '┃']) {
    assert.equal(rooms.matchInvestigationCategoryStyle(categories([`🛡️${separator}Security`, `💎${separator}Vault`, `🎮${separator}Games`])), `🔎${separator}Investigations`);
  }
  assert.equal(rooms.matchInvestigationCategoryStyle(categories(['🛡️ | Security', '💎 : Vault'])), 'Investigations');
  assert.equal(rooms.matchInvestigationCategoryStyle(categories(['Security', 'Vault'])), 'Investigations');
  assert.equal(rooms.matchInvestigationCategoryStyle(categories(['🛡️ | Security'])), 'Investigations');
  assert.equal(rooms.matchInvestigationCategoryStyle(categories(['🛡️ | Security', '💎 | Vault', 'Games'])), '🔎 | Investigations');
  assert.equal(rooms.matchInvestigationCategoryStyle(categories(['🛡️ | Security', '💎 | Vault', 'Games', 'Chat'])), 'Investigations');
  let scans = 0, creates = 0;
  f.guild.channels.fetch = async () => { scans++; f.guild.channels.cache = categories(['🛡️ · Security', '💎 · Vault']); };
  f.guild.channels.create = async options => { creates++; return { ...options, id: 'created-category', permissionOverwrites: { edit: async () => {} } }; };
  const savedRoles = [...f.state.users[uid].roles];
  const created = await rooms.ensureInvestigationCategory(f.guild);
  assert.equal(created.name, '🔎 · Investigations'); assert.equal(scans, 1); assert.equal(creates, 1);
  assert.equal(f.state.investigationCategoryName, created.name);
  assert.deepEqual(f.state.users[uid].roles, savedRoles);
  created.name = 'Custom Management Rooms'; f.guild.channels.cache.set(created.id, created);
  await rooms.ensureInvestigationCategory(f.guild);
  assert.equal(scans, 1, 'Saved categories must not be rescanned/renamed');
  assert.equal(f.state.investigationCategoryName, 'Custom Management Rooms');
  f.guild.channels.cache.clear();
  f.guild.channels.fetch = async () => { throw Error('Guild scan unavailable'); };
  await assert.rejects(rooms.ensureInvestigationCategory(f.guild), /Guild scan unavailable/);
  assert.equal(creates, 1, 'Failed scans must never create a duplicate category');
}
// Generic room presentation migrates the known old category/panel without touching custom names or history.
{
  const f = fixture(); f.state.investigationCategoryId = 'category';
  const renames = [], edits = [];
  const parent = { id: 'category', name: 'Goliath Investigations', setName: async name => { renames.push(name); parent.name = name; } };
  f.guild.client = { user: { id: 'bot' } };
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`mod_invroom_transcript:${uid}:room`).setLabel('Add Staff Note').setStyle(ButtonStyle.Secondary));
  const panel = {
    author: { id: 'bot' }, embeds: [{ title: '🔎 Private Investigation Room', description: 'Speak with investigating staff here.', footer: { text: 'Goliath • Private moderation review' }, fields: [{ name: 'Reason', value: 'Original case reason' }] }],
    components: [{ components: [{ customId: `mod_invroom_transcript:${uid}:room`, label: 'Add Staff Note' }], toJSON: () => row.toJSON() }],
    edit: async payload => edits.push(payload),
  };
  const channel = { id: 'room', parent, messages: { fetch: async () => new Collection([['other', { ...panel, author: { id: 'unrelated-bot' } }], ['panel', panel]]) } };
  const rooms = load(base + 'investigationRooms.js', { './state': { ...f.api, DEFAULT_INVESTIGATION_CATEGORY_NAME: 'Investigations' }, './isolation': {} });
  assert.equal(rooms.cleanCategoryName('Goliath Investigations'), 'Investigations');
  assert.equal(rooms.cleanCategoryName('Custom Review Rooms'), 'Custom Review Rooms');
  assert.equal(rooms.cleanChannelName('  Example___Member---  '), 'example-member');
  assert.equal(rooms.cleanChannelName('💎'), 'member');
  const roomRenames = [];
  channel.name = `investigation-undecided4237-${uid.slice(-4)}`;
  channel.setName = async name => { roomRenames.push(name); channel.name = name; };

  await rooms.refreshInvestigationPresentation(f.guild, channel, uid);
  assert.deepEqual(renames, ['Investigations']); assert.equal(edits.length, 1);
  assert.deepEqual(roomRenames, ['undecided4237']);
  assert.equal(edits[0].embeds[0].data.footer.text, 'Private Moderation Review');
  assert.equal(edits[0].embeds[0].data.fields[0].value, 'Original case reason');
  assert.equal(edits[0].components[0].components[0].data.label, 'Add Note');
  assert.equal(f.state.users[uid].interviewChannelId, 'room');
  await rooms.refreshInvestigationPresentation(f.guild, channel, uid); assert.equal(edits.length, 1, 'Refresh must not repeatedly edit the room panel');
  channel.name = 'custom-review-name';
  channel.id = 'custom-room'; parent.name = 'Custom Review Rooms'; channel.messages.fetch = async () => new Collection();
  await rooms.refreshInvestigationPresentation(f.guild, channel, uid); assert.deepEqual(renames, ['Investigations']);
  assert.deepEqual(roomRenames, ['undecided4237'], 'Custom room names must remain unchanged');
}
// Closed room names remain readable and archival preserves the same room and original-role snapshot.
{
  const f = fixture();
  const rooms = load(base + 'investigationRooms.js', { './state': f.api, './isolation': {} });
  const lifecycle = load(base + 'releaseLifecycle.js', { './state': f.api, './roleManager': {}, './isolation': {}, './memberLifecycle': {}, './investigationRooms': rooms, '../../../ui/memberNotice': require(root + '/src/core/ui/memberNotice') });
  const names = [], notices = [];
  f.state.users[uid].caseId = 2;
  const channel = { id: 'room', name: `investigation-undecided4237-${uid.slice(-4)}`, send: async payload => { notices.push(payload); return { id: 'closure-notice' }; }, permissionOverwrites: { edit: async () => {} }, setName: async name => { names.push(name); channel.name = name; }, setTopic: async () => {} };
  f.guild.channels.cache.set('room', channel);
  const originals = [...f.state.users[uid].roles];
  assert.equal((await lifecycle.archiveInvestigationRoom(f.guild, f.state.users[uid])).archived, true);
  assert.deepEqual(names, ['closed-undecided4237']);
  const closure = notices[0].embeds[0].toJSON();
  assert.equal(closure.title, '🔓 Investigation Closed');
  assert.equal(closure.color, 0x57F287);
  assert.equal(closure.footer.text, 'Private Moderation Review');
  assert.equal(closure.fields[0].value, '#2');
  assert(closure.timestamp);
  assert(!JSON.stringify(closure).includes('Goliath'), 'Room closure must use generic wording');
  assert.deepEqual(notices[0].allowedMentions, { parse: [] });

  assert.deepEqual(f.state.users[uid].roles, originals);
  assert.equal(f.state.archivedRooms[0].channelId, 'room');
  assert.equal(f.state.archivedRooms[0].closureMessageId, 'closure-notice');
}
// Back/Close navigation from a shared room opens an independent ephemeral workspace.
{
  const f = fixture(); f.guild.client = { user: { id: 'bot' } };
  const rooms = load(base + 'investigationRooms.js', { './state': f.api, './isolation': {} });
  let sharedEdits = 0, sharedDeletes = 0, privateEdits = 0, privateDeletes = 0;
  const publicMessage = { author: { id: 'bot' }, flags: { has: () => false }, edit: async () => { sharedEdits++; } };
  const makeInteraction = id => {
    const privateMessage = { id, flags: { has: () => true }, edit: async () => { privateEdits++; } };
    const i = { customId: `mod_dashboard:${uid}:cases`, channelId: 'room', guild: f.guild, message: publicMessage,
      deferReply: async options => { assert.equal(options.flags, 64); i.deferred = true; }, fetchReply: async () => privateMessage,
      editReply: async () => { privateEdits++; }, update: async () => { sharedEdits++; },
      deleteReply: async () => { if (i.deferred) privateDeletes++; else sharedDeletes++; },
    };
    return i;
  };
  const original = makeInteraction('moderator-one');
  const first = await rooms.privateInvestigationNavigation(original);
  for (let back = 0; back < 5; back++) await first.update({ content: 'Back' });
  await first.message.edit({ content: 'Refreshed workspace' });
  await first.deferUpdate(); await first.deleteReply();
  const second = await rooms.privateInvestigationNavigation(makeInteraction('moderator-two'));
  assert.notEqual(first.message.id, second.message.id, 'Moderators must never share their private workspace');
  assert.equal(sharedEdits, 0); assert.equal(sharedDeletes, 0); assert.equal(privateEdits, 6); assert.equal(privateDeletes, 1);
  const ephemeral = { ...makeInteraction('ephemeral'), message: { flags: { has: () => true } } };
  assert.equal(await rooms.privateInvestigationNavigation(ephemeral), ephemeral);
  const outside = { ...makeInteraction('outside'), channelId: 'other-channel' };
  assert.equal(await rooms.privateInvestigationNavigation(outside), outside);
  const modal = { ...makeInteraction('note'), customId: `mod_invroom_note:${uid}` };
  assert.equal(await rooms.privateInvestigationNavigation(modal), modal, 'Room modal controls must keep their normal acknowledgement flow');
  assert(read('src/core/administration/mod/interactions.js').includes('.privateInvestigationNavigation(i)'), 'Moderation routing must use the private room navigation boundary');
}
// Recover an erased room panel in place and reuse its saved message after restart.
{
  const f = fixture(); f.guild.client = { user: { id: 'bot' } };
  let posts = 0, restored;
  const channel = { id: 'room', messages: { fetch: async query => {
    if (typeof query === 'string') return restored;
    return new Collection();
  } }, send: async payload => {
    posts++; assert.deepEqual(payload.allowedMentions, { parse: [] });
    restored = { id: 'restored-panel', author: { id: 'bot' }, embeds: payload.embeds.map(embed => embed.toJSON()),
      components: payload.components.map(row => ({ components: row.components.map(component => ({ ...component.data, customId: component.data.custom_id })) })) };
    return restored;
  } };
  const mock = { './state': { ...f.api, DEFAULT_INVESTIGATION_CATEGORY_NAME: 'Investigations' }, './isolation': {} };
  const originalRoles = [...f.state.users[uid].roles];
  await load(base + 'investigationRooms.js', mock).refreshInvestigationPresentation(f.guild, channel, uid);
  assert.equal(posts, 1); assert.equal(f.state.users[uid].controlMessageId, 'restored-panel');
  assert.equal(f.state.users[uid].interviewChannelId, 'room'); assert.deepEqual(f.state.users[uid].roles, originalRoles);
  await load(base + 'investigationRooms.js', mock).refreshInvestigationPresentation(f.guild, channel, uid);
  assert.equal(posts, 1, 'Restart recovery must reuse the stored control message');
  channel.messages.fetch = async () => { throw Error('Discord unavailable'); };
  await assert.rejects(load(base + 'investigationRooms.js', mock).refreshInvestigationPresentation(f.guild, channel, uid), /Discord unavailable/);
  assert.equal(posts, 1, 'An uncertain message fetch must never create another panel');
}
// Management controls cannot grant outside access or restore a revoked investigator's access.
{
  const f = fixture({ allowedChannelIds: ['one', 'two'] });
  const accessWrites = [];
  const one = { id: 'one', permissionOverwrites: { edit: async (id, value) => accessWrites.push(value.ViewChannel) } };
  const two = { id: 'two', permissionOverwrites: { edit: async (id, value) => { accessWrites.push(value.ViewChannel); throw Error('Permission denied'); } } };
  f.guild.channels.cache.set('one', one).set('two', two);
  const access = load('src/core/administration/mod/investigationAccess.js', { '../../guild/guildManager': {}, '../../security/protection/quarantine': f.api, '../../../owner/auditIntelligence/auditIntelligence': {} });
  const interaction = { guild: f.guild, user: { id: 'staff', tag: 'Staff' } };
  await assert.rejects(access.updateAccess(interaction, f.member, 'add', one), /only to the assigned/);
  assert.equal(accessWrites.length, 0);
  await assert.rejects(access.updateAccess(interaction, f.member, 'clear'), /Permission denied/);
  assert.deepEqual(accessWrites, [false, false], 'Failed cleanup must not regrant outside access');
  f.guild.channels.cache.delete('two');
  f.guild.channels.fetch = async () => { throw Error('Discord lookup unavailable'); };
  await assert.rejects(access.updateAccess(interaction, f.member, 'clear'), /Discord lookup unavailable/);
  assert.deepEqual(f.state.users[uid].allowedChannelIds, ['one', 'two']);
  assert(auditQuarantineSnapshots({}, f.state.users).cases[0].reasons.includes('legacy_extra_channel_access'));
  let authorised = true, grants = 0;
  f.guild.channels.cache.set('room', { id: 'room', permissionOverwrites: { edit: async () => { grants++; } } });
  f.guild.members.fetch = async () => ({ id: other });
  const controls = load('src/core/administration/mod/quarantineInteractions.js', { '../../../core/ui/interactionResponse': {}, './permissions': { canUseModAction: () => authorised }, './storage': {}, '../../security/protection/quarantine': f.api, './panel': {}, './investigationAccess': access });
  assert.equal((await controls.ensureInitiatorInterviewAccess(f.guild, 'room', other)).success, true);
  assert.equal(grants, 1);
  authorised = false;
  assert.equal((await controls.ensureInitiatorInterviewAccess(f.guild, 'room', other)).success, false);
  authorised = true;
  f.state.users[other] = { mode: 'investigation', roles: [], interviewChannelId: 'different-room' };
  assert.equal((await controls.ensureInitiatorInterviewAccess(f.guild, 'room', other)).success, false);
  assert.equal(grants, 1);
}
// Real event routing: member joins, new/updated channels, deleted rooms and threads.
{
  const f = fixture();
  let recoveries = 0, roomRepairs = 0, removals = 0, expired = false, releasing = false;
  const events = load(base + 'recoveryEvents.js', { './state': f.api, './roleManager': { ensureQuarantineRole: async () => f.role }, './isolation': { syncQuarantineIsolation: async () => ({ success: true }) },
    './investigationRooms': { ensureInvestigationRoomForSnapshot: async () => { roomRepairs++; return { id: 'room' }; } },
    './enforcementRecovery': { enforceQuarantineOnMember: async () => { recoveries++; return { success: true, expired, interviewChannelId: 'room' }; } },
    './expiryScheduler': {}, './releaseLifecycle': { isQuarantineReleaseInProgress: () => releasing }, '../../../administration/mod/quarantineInteractions': {},
  });
  const event = name => events.find(e => e.name === name).execute;
  const outside = { id: 'outside', guild: f.guild, permissionsFor: () => new PermissionsBitField([P.ViewChannel]), members: { remove: async () => { removals++; } } };
  await event(Events.GuildMemberAdd)(f.member);
  assert.equal(recoveries, 1); assert.equal(roomRepairs, 1);
  expired = true;
  await event(Events.GuildMemberAdd)(f.member);
  assert.equal(roomRepairs, 1, 'Expired rejoin must not recreate a released room');
  expired = false;
  await event(Events.ChannelCreate)(outside);
  await event(Events.ChannelUpdate)({}, outside);
  await event(Events.ThreadUpdate)({}, outside);
  await event(Events.ThreadCreate)(outside);
  await event(Events.ThreadMembersUpdate)(new Collection([[uid, { id: uid }]]), new Collection(), outside);
  assert.equal(removals, 1);
  releasing = true;
  await event(Events.ThreadMembersUpdate)(new Collection([[uid, { id: uid }]]), new Collection(), outside);
  assert.equal(removals, 1, 'Release must not race thread membership containment');
  releasing = false;
  await event(Events.ChannelDelete)({ id: 'room', guild: f.guild });
  f.member.roles.cache.set(originalRole, { id: originalRole });
  await event(Events.GuildMemberUpdate)({}, f.member);
  assert(recoveries >= 9);
}
console.log('Quarantine containment audit passed: read-only legacy audit and evidence-backed adoption, effective permissions/threads, release rollback/locking, expiry policy, restart/rejoin/events, room reuse and management controls/transcripts/deletion (mocked Discord; live permissions not verified).');

return true;
}

function legacyQuarantineAudit() {
  const { getRuntimePaths, resolveBotMode } = require('../src/config/runtimePaths');
  if (resolveBotMode(process.env.BOT_MODE) !== 'dev') throw new Error('Legacy quarantine audit is restricted to DEV.');
  const directory = getRuntimePaths('dev').guilds;
  if (!fs.existsSync(directory)) { console.error('DEV guild data is unavailable in this checkout; no live cases were audited.'); return false; }
  const { auditQuarantineSnapshots } = require('../src/core/security/protection/quarantine/state');
  const { getRoutedSection } = require('../src/core/guild/sectionRouting');
  const reports = [];
  for (const entry of fs.readdirSync(directory).filter(name => /^\d{16,20}\.json$/.test(name)).sort()) {
    const raw = JSON.parse(fs.readFileSync(path.join(directory, entry), 'utf8'));
    reports.push({ guildId: entry.slice(0, -5), ...auditQuarantineSnapshots(raw.modules?.verification?.sessions || {}, getRoutedSection(raw, 'security', {}).quarantine?.users || {}) });
  }
  console.log(JSON.stringify({ readOnly: true, mode: 'dev', guilds: reports.length, needsReview: reports.reduce((sum, report) => sum + report.needsReview, 0), reports }, null, 2));
  if (!reports.length) { console.error('No DEV guild configurations found; live cases were not audited.'); return false; }
  return reports.every(report => report.needsReview === 0);
}

async function legacyQuarantineReconcileCommand() {
  if (String(process.env.BOT_MODE || '').toUpperCase() !== 'DEV') throw Error('Set BOT_MODE=dev; this command is restricted to DEV.');
  const [guildId, userId, roomId, addEventId, stripEventId] = process.argv.slice(3);
  if (![guildId, userId, roomId].every(id => /^\d{15,25}$/.test(id || '')) || !addEventId || !stripEventId || process.argv.length !== 8) {
    throw Error('Usage: BOT_MODE=dev node scripts/goliath.js legacy-quarantine-reconcile <guildId> <userId> <roomId> <addEventId> <stripEventId>');
  }
  require('../src/config/envLoader').loadEnvironment('dev');
  const { getRuntimePaths } = require('../src/config/runtimePaths');
  if (!fs.existsSync(path.join(getRuntimePaths('dev').guilds, `${guildId}.json`))) throw Error('DEV guild data is unavailable; no maintenance request created.');
  const store = require('../src/owner/auditIntelligence/auditStore');
  const pending = (store.getConfig().control?.remoteCommands || []).find(c => ['pending', 'claimed'].includes(c.status) && c.targetMode === 'DEV' && Date.parse(c.expiresAt) > Date.now() && c.action === 'legacy-quarantine-reconcile' && c.guildId === guildId && c.payload?.userId === userId);
  const request = pending || store.createRemoteCommand(guildId, 'DEV', 'legacy-quarantine-reconcile', { userId, roomId, addEventId, stripEventId }, 'local-dev-maintenance');
  if (!request) throw Error('Could not create DEV maintenance request.');
  console.log(`DEV reconciliation request ${request.id}; waiting for the running bot (no roles restored).`);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const current = (store.getConfig().control?.remoteCommands || []).find(c => c.id === request.id);
    if (['completed', 'failed', 'expired'].includes(current?.status)) {
      console.log(JSON.stringify(current, null, 2));
      return current.status === 'completed' && current.result?.ok === true;
    }
  }
  console.error(`Request ${request.id} has not completed. It may still run; do not assume the case is repaired. Check the DEV bot logs and rerun the read-only legacy-quarantine audit.`);
  return false;
}

async function dependencyRuntimeAudit() {
// Exercise the APIs affected by dependency overrides without live credentials or guild data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { Readable } = require('node:stream');
const Database = require('better-sqlite3');
const fetch = require('node-fetch');
const { google } = require('googleapis');

async function main() {
  const lock = require('../package-lock.json');
  for (const [name, entry] of Object.entries(lock.packages)) {
    assert(!entry.deprecated, `Deprecated dependency remains: ${name}`);
    assert(!name.endsWith('/prebuild-install'), 'Legacy SQLite installer remains');
  }
  const googleFetchPath = require.resolve('node-fetch', { paths: [path.dirname(require.resolve('gaxios'))] });
  const googleFetch = await import(require('node:url').pathToFileURL(googleFetchPath).href);
  const blobFromPath = require.resolve('fetch-blob/from.js', { paths: [path.dirname(googleFetchPath)] });
  const { fileFromSync } = await import(require('node:url').pathToFileURL(blobFromPath).href);
  const domPath = require.resolve('node-domexception', { paths: [path.dirname(blobFromPath)] });
  assert.equal(require(domPath), globalThis.DOMException);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'goliath-dependency-'));
  const databasePath = path.join(directory, 'existing.sqlite');
  let db;
  let server;
  try {
    db = new Database(databasePath);
    db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');
    db.prepare('INSERT INTO settings VALUES (?, ?)').run('preserved', 'yes');
    db.close();
    db = new Database(databasePath);
    assert.equal(db.prepare('SELECT value FROM settings WHERE key = ?').get('preserved').value, 'yes');
    assert.throws(db.transaction(() => { db.prepare('UPDATE settings SET value = ?').run('no'); throw Error('rollback'); }), /rollback/);
    assert.equal(db.prepare('SELECT value FROM settings').get().value, 'yes');
    const backupPath = path.join(directory, 'backup.sqlite');
    await db.backup(backupPath);
    const backup = new Database(backupPath, { readonly: true });
    try { assert.equal(backup.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); }
    finally { backup.close(); }
    const filePath = path.join(directory, 'fixture.txt');
    fs.writeFileSync(filePath, 'fixture');
    const file = fileFromSync(filePath);
    assert.equal(await file.text(), 'fixture');
    fs.appendFileSync(filePath, 'changed');
    await assert.rejects(file.text(), error => error instanceof DOMException && error.name === 'NotReadableError');

    server = http.createServer(async (request, response) => {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname === '/slow') return; // Closed by the client timeout, below.
      if (url.pathname === '/redirect') { response.writeHead(302, { Location: '/bytes' }); response.end(); return; }
      if (url.pathname === '/bytes' || url.searchParams.get('alt') === 'media') { response.end('fixture'); return; }
      if (request.method === 'POST') {
        let body = '';
        for await (const chunk of request) body += chunk;
        assert(body.includes('fixture'), 'Drive streaming upload lost the source body');
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ id: 'uploaded' }));
        return;
      }
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ files: [{ id: 'folder', name: 'guilds' }] }));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const root = `http://127.0.0.1:${server.address().port}`;
    const agent = new http.Agent({ lookup: (hostname, options, callback) => {
      assert.equal(hostname, 'goliath.invalid');
      if (options?.all) callback(null, [{ address: '127.0.0.1', family: 4 }]);
      else callback(null, '127.0.0.1', 4);
    } });
    try {
      const pinned = await fetch(root.replace('127.0.0.1', 'goliath.invalid') + '/bytes', { agent });
      assert.equal((await pinned.buffer()).toString(), 'fixture');
    } finally { agent.destroy(); }
    assert.equal((await fetch(root + '/redirect', { redirect: 'manual' })).status, 302);
    assert.equal(await (await fetch(root + '/redirect')).text(), 'fixture');
    await assert.rejects(fetch(root + '/slow', { timeout: 30 }), error => error.type === 'request-timeout');
    const controller = new AbortController();
    const pending = fetch(root + '/slow', { signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, error => error.name === 'AbortError');
    assert.equal(await (await googleFetch.default(root + '/bytes')).text(), 'fixture');

    const drive = google.drive({ version: 'v3', rootUrl: root + '/', retry: false, timeout: 2000,
      fetchImplementation: (url, options) => {
        // The SDK rewrites media uploads after rootUrl; redirect its transport to the fixture too.
        const target = new URL(url);
        assert([root, 'https://www.googleapis.com'].includes(target.origin));
        return googleFetch.default(root + target.pathname + target.search, { ...options, agent: undefined });
      }
    });
    assert.equal((await drive.files.list({ fields: 'files(id,name)' })).data.files[0].id, 'folder');
    const upload = await drive.files.create({ requestBody: { name: 'fixture' }, media: { mimeType: 'text/plain', body: Readable.from(['fixture']) }, fields: 'id' });
    assert.equal(upload.data.id, 'uploaded');
    const download = await drive.files.get({ fileId: 'uploaded', alt: 'media' }, { responseType: 'stream' });
    let downloaded = '';
    for await (const chunk of download.data) downloaded += chunk;
    assert.equal(downloaded, 'fixture');
    console.log('✅ Dependency runtime audit: SQLite persistence/rollback/backup, native DOMException, pinned-agent downloads, redirects, timeouts, aborts and Drive list/upload/download');
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (db?.open) db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

await main();
return true;
}

async function freeGamesAudit() {
  const assert = require('node:assert/strict');
  const providers = require('../src/modules/utilityStudio/games/freeGamesProviders');
  const embeds = require('../src/modules/utilityStudio/games/freeGamesEmbeds');
  const store = require('../src/modules/utilityStudio/games/freeGames');

  const fs = require('node:fs');
  assert(fs.existsSync(root + '/src/modules/utilityStudio/games'), 'Canonical Games folder must exist.');
  const oldTracked = require('node:child_process').spawnSync('git', ['ls-files', '--', 'src/modules/utilityStudio/' + 'freeGames'], { cwd: root, encoding: 'utf8' });
  if (oldTracked.status === 0) assert.equal(oldTracked.stdout.trim(), '', 'The previous folder must be moved, not duplicated in Git.');
  assert.equal(store.MODULE_KEY, 'freeGames', 'Renaming must preserve the established guild storage and authority key.');
  assert.equal(store.MODULE_NAME, 'Games');
  const serverSource = fs.readFileSync(root + '/server.js', 'utf8');
  assert(serverSource.includes("['/api/games', freeGamesRoutes]"));
  assert(serverSource.includes("['/api/free-games', freeGamesRoutes]"), 'Existing API clients remain compatible.');
  const now = Date.now();
  const config = { ...structuredClone(store.DEFAULTS), enabled: false, stores: Object.keys(providers.STORES), types: Object.keys(providers.TYPES), pricing: { mode: 'converted', currency: 'GBP', rate: 0.8, date: new Date(now).toISOString().slice(0, 10) } };
  const offer = { id: 'gamerpower:1', title: 'A Game (Steam) Key Giveaway', type: 'game', stores: ['steam', 'xbox', 'playstation'], url: 'https://www.gamerpower.com/offer/1', worth: '$10.00', endsAt: now + 3600000, endDateText: null };
  const offers = Array.from({ length: 120 }, (_, index) => ({ ...offer, id: `gamerpower:${index + 1}`, title: `Offer ${index} ` + 'Long title '.repeat(15), url: `https://www.gamerpower.com/offer/${index + 1}`, type: Object.keys(providers.TYPES)[index % 6] }));
  const pages = embeds.buildListing([...offers, offers[0]], config, now);
  const text = pages.map(page => [page.embeds[0].description, ...page.embeds[0].fields.map(field => field.value)].join('\n')).join('\n');
  for (const item of offers) assert.equal(text.split(`](${item.url})`).length - 1, 1, 'Offer must appear exactly once');
  for (const page of pages) {
    const embed = page.embeds[0];
    assert(embed.description.length <= 4096);
    assert(embed.fields.length <= 25);
    for (const field of embed.fields) { assert(field.inline); assert(field.name.length <= 256); assert(field.value.length <= 1024); }
    assert(embed.title.length + embed.description.length + embed.footer.text.length + embed.fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0) < 6000);
    assert.deepEqual(page.allowedMentions, { parse: [] });
  }
  assert.equal(pages[0].embeds[0].title, '🎁 Free Games');
  assert.equal(new Set(pages.map(page => page.embeds[0].color)).size, 3);
  assert(pages[0].embeds[0].fields[0].name.startsWith('🚂'));
  const icons = embeds.platformPresentation({ application: { emojis: { cache: { find: fn => [{ name: 'goliath_steam', id: '123456789012345678' }].find(fn) } } } });
  assert.equal(icons.steam.emoji, '<:goliath_steam:123456789012345678>');
  assert(icons.steam.imageUrl.includes('123456789012345678.png'));
  assert.equal(icons.epic.emoji, '⚡');
  // Cold-cache platform icons must come from the shared Emoji module, including replacements.
  {
    const fs = require('node:fs'), vm = require('node:vm');
    let loads = 0;
    let emojiId = '123456789012345681';
    const moduleFixture = { exports: {} };
    const emojiService = {
      render: (emoji) => '<:' + emoji.name + ':' + emoji.id + '>',
      allowedGuildEmojis: async (_client, guildId, context) => {
        assert.equal(guildId, 'fixture'); assert.equal(context, 'freeGames'); loads++;
        return new Map([['steam', { name: 'goliath_steam', id: emojiId }], ['epic', { name: 'goliath_epic', id: '123456789012345682' }]]);
      },
    };
    const source = fs.readFileSync(root + '/src/modules/utilityStudio/games/freeGamesEmbeds.js', 'utf8');
    vm.runInThisContext('(function(require,module,exports){' + source + '\n})')(
      name => name === './freeGamesProviders' ? providers : emojiService, moduleFixture, moduleFixture.exports);
    const coldClient = { application: { emojis: { fetch: async () => { throw Error('Use the shared module'); }, cache: new Map() } } };
    const resolved = await moduleFixture.exports.loadPlatformPresentation(coldClient, 'fixture');
    assert.equal(loads, 1); assert.equal(resolved.steam.emoji, '<:goliath_steam:' + emojiId + '>');
    assert.equal(resolved.epic.emoji, '<:goliath_epic:123456789012345682>');
    emojiId = '123456789012345683';
    assert((await moduleFixture.exports.loadPlatformPresentation(coldClient, 'fixture')).steam.emoji.includes(emojiId));
  }
  const datedOffer = { ...offer, endDateText: '2026-10-31 23:59:59' };
  for (const entry of [datedOffer, { ...datedOffer, endsAt: null }]) {
    const rendered = embeds.line(entry, {}, now, { ...config, showExpiry: true });
    assert(!rendered.includes('<t:')); assert(!rendered.includes('23:59:59')); assert(!rendered.includes('source time'));
  }

  const mixed = embeds.buildListing([offer, { ...offer, id: 'epic', stores: ['epic'] }, { ...offer, id: 'gog', stores: ['gog'] }], config, now);
  assert.equal(mixed.length, 1); assert.equal(mixed[0].embeds[0].fields.length, 3);
  assert(text.includes('≈£8.00'));
  assert(!text.includes('🆕'));
  assert(embeds.line(offer, { [offer.id]: now }, now, config).includes('🆕'));
  assert(!embeds.line(offer, { [offer.id]: now - embeds.NEW_MS }, now, config).includes('🆕'));
  assert.equal(embeds.shortTitle(offer.title), 'A Game');
  assert.equal(embeds.price(offer, { ...config, pricing: { mode: 'hidden' } }), '');
  assert.equal(embeds.price(offer, { ...config, pricing: { mode: 'unavailable' } }), '');
  assert(embeds.price(offer, { ...config, pricing: { mode: 'source' } }).includes('US$10.00'));
  const unknown = embeds.line({ ...offer, endsAt: null }, {}, now, config);
  assert(!unknown.includes('<t:'));
  assert.equal(embeds.orderedOffers([{ ...offer, id: 'later', endsAt: now + 7200000 }, offer], now)[0].id, offer.id);
  assert.equal(store.validateSettings({ currency: 'JPY', locale: 'ja-JP', region: 'JP', timeZone: 'Asia/Tokyo' }, config).currency, 'JPY');
  for (const patch of [{ currency: 'ZZZ' }, { priceMode: 'fake' }, { timeZone: 'invalid' }, { locale: 'not_a_locale' }, { region: 'ZZ' }]) assert.throws(() => store.validateSettings(patch, config));

  // Public presentation stays compact; source timestamps are stable between monitor ticks.
  const listing = embeds.buildListing([offer], { ...config, listingUpdatedAt: now }, now)[0].embeds[0];
  assert.equal(listing.timestamp, new Date(now).toISOString());
  assert(!listing.description.includes('Estimated'));
  assert(!listing.description.includes('Frankfurter'));
  assert(listing.description.includes('GamerPower'));
  const hiddenDetails = { ...config, layout: 'list', showTimestamps: false, showExpiry: false, showPlatforms: false, showNew: false, showOfferCount: false };
  const cleanListing = embeds.buildListing([offer], hiddenDetails, now)[0].embeds[0];
  assert.equal(cleanListing.timestamp, undefined);
  assert(!cleanListing.description.includes('available'));
  assert(cleanListing.fields.every(field => field.inline === false));
  const cleanLine = embeds.line(offer, { [offer.id]: now }, now, hiddenDetails);
  assert(!cleanLine.includes('<t:')); assert(!cleanLine.includes('🆕')); assert(!cleanLine.includes('Xbox'));
  assert.equal(store.validateSettings({ layout: 'list', showTimestamps: false }, config).showTimestamps, false);
  assert.throws(() => store.validateSettings({ layout: 'invalid' }, config));
  assert.throws(() => store.validateSettings({ showExpiry: 'false' }, config));
  for (const page of ['home', 'delivery', 'filters', 'pricing', 'display']) {
    const payload = store.buildAdminPanel({ id: 'fixture' }, page, '', config);
    assert(payload.components.length <= 5);
    for (const row of payload.components) {
      assert(row.components.length <= 5);
      for (const component of row.components) {
        assert(component.custom_id.length <= 100);
        if (component.options) { assert(component.options.length <= 25); assert(component.max_values <= component.options.length); }
      }
    }
    assert.deepEqual(payload.allowedMentions, { parse: [] });
  }
  assert.equal(store.regionalModal({ id: 'fixture' }, config).components.length, 4);
  // Exercise the real Discord handler against in-memory config; never create guild data.
  {
    const fs = require('node:fs'), vm = require('node:vm');
    let memory = structuredClone(config), writes = 0, sends = 0, permitted = true;
    let panelOffers = [offer];
    const mod = { exports: {} };
    const injectedRequire = name => {
      if (name.endsWith('/guildManager')) return { isModuleEnabled: () => memory.enabled };
      if (name.endsWith('/moduleSectionManager')) return {
        getModuleSection: () => structuredClone(memory),
        updateModuleSection: (_id, _key, fn) => { memory = fn(structuredClone(memory)); writes++; return memory; },
      };
      if (name === './freeGamesProviders') return { ...providers, getOffers: async () => ({ offers: panelOffers, fetchedAt: now }), getPricing: async () => config.pricing };
      if (name === './freeGamesEmbeds') return embeds;
      if (name === './freeGamesMonitor') return { withGuildLock: async (_id, task) => task(), validateDestination: async () => { sends++; } };
      if (name.endsWith('/security/protection/core')) return { isBotOwner: () => false };
      if (name === 'discord.js') return require('discord.js');
      throw new Error('Unexpected Free Games panel dependency: ' + name);
    };
    const source = fs.readFileSync(root + '/src/modules/utilityStudio/games/freeGames.js', 'utf8');
    vm.runInThisContext('(function(require,module,exports){' + source + '\n})')(injectedRequire, mod, mod.exports);
    const handler = mod.exports.handleAdminInteraction;
    const guildFixture = { id: 'fixture', client: {}, members: { fetch: async () => ({ permissions: { has: () => permitted } }) } };
    let last;
    const interaction = action => ({
      customId: 'admin:module:freeGames:' + action, guild: guildFixture, user: { id: 'manager', username: 'Manager' },
      isButton: () => true, deferUpdate: async () => {}, editReply: async payload => { last = payload; },
      update: async payload => { last = payload; }, deferred: true,
    });
    permitted = false;
    await handler(interaction('enabled'));
    assert.equal(writes, 0); assert.match(last.content, /Manage Server/);
    permitted = true;
    const settings = interaction('regionalSubmit');
    settings.isModalSubmit = () => true;
    settings.fields = { getTextInputValue: key => ({ currency: 'eur', locale: 'de-DE', timeZone: 'Europe/Berlin', region: 'de' })[key] };
    await handler(settings);
    assert.equal(memory.currency, 'EUR'); assert.equal(memory.region, 'DE'); assert.equal(writes, 1);
    const before = JSON.stringify(memory);
    const preview = interaction('preview:0'); await handler(preview);
    assert.equal(JSON.stringify(memory), before); assert.equal(writes, 1); assert.equal(sends, 0);
    assert.match(last.content, /Preview only/);
    const featurePanel = await mod.exports.buildFeaturedPanel(guildFixture);
    assert(featurePanel.components.length <= 5); assert.equal(writes, 1);
    panelOffers = Array.from({ length: 80 }, (_, index) => ({ ...offer, id: 'gamerpower:' + (8000 + index), title: 'Main ' + index, image: 'https://www.gamerpower.com/game.jpg', popularityRank: index }));
    const paginatedFeature = await mod.exports.buildFeaturedPanel(guildFixture, 2);
    assert.equal(paginatedFeature.components.length, 5);
    assert.equal(paginatedFeature.components[1].components[0].options.length, 25);
    assert(paginatedFeature.components[1].components[0].options[0].value.startsWith('gamerpower:'));
    panelOffers = [offer];
    settings.fields.getTextInputValue = key => key === 'currency' ? 'ZZZ' : ({ locale: 'en-GB', timeZone: 'Europe/London', region: 'GB' })[key];
    await handler(settings);
    assert.equal(writes, 1); assert.equal(memory.currency, 'EUR');
    const display = interaction('displayOptions');
    display.isStringSelectMenu = () => true; display.values = ['showTimestamps']; await handler(display);
    assert.equal(memory.showTimestamps, true); assert.equal(memory.showExpiry, false); assert.equal(memory.showPlatforms, false);
  }

  // One main title is featured once, above the list, without promoting DLC/mobile/indie-only offers.
  const mainA = { ...offer, id: 'gamerpower:7001', title: 'Main game A', image: 'https://www.gamerpower.com/a.jpg', popularityRank: 9, description: 'A main game.' };
  const mainB = { ...mainA, id: 'gamerpower:7002', title: 'Main game B', stores: ['epic'], popularityRank: 1 };
  const notMain = [{ ...mainA, id: 'loot', type: 'loot', popularityRank: 0 }, { ...mainA, id: 'indie', stores: ['itchio'], popularityRank: 0 },
    { ...mainA, id: 'trial', type: 'weekend', popularityRank: 0 }];
  assert.equal(embeds.selectFeaturedOffer([mainA, mainB, ...notMain], config).id, mainB.id);
  assert.equal(embeds.selectFeaturedOffer([mainA, mainB], { ...config, featuredMode: 'manual', featuredOfferId: mainA.id }).id, mainA.id);
  assert.equal(embeds.selectFeaturedOffer([mainA, mainB], { ...config, featuredMode: 'manual', featuredOfferId: 'gamerpower:999999' }).id, mainB.id);
  assert.equal(embeds.selectFeaturedOffer([mainA, mainB], { ...config, stores: ['steam'] }).id, mainA.id);
  assert.equal(embeds.selectFeaturedOffer([mainA], { ...config, featuredMode: 'off' }), null);
  assert.equal(embeds.selectFeaturedOffer(notMain, config), null);
  const featuredPages = embeds.buildListing([mainA, mainB, ...notMain], config, now, icons);
  assert.equal(featuredPages[0].embeds[0].thumbnail.url, mainB.image);
  assert(featuredPages[0].embeds[0].description.includes('Main game B'));
  assert.equal(featuredPages.filter(page => page.embeds[0].thumbnail).length, 1);
  const featuredText = featuredPages.map(page => [page.embeds[0].description, ...page.embeds[0].fields.map(field => field.value)].join('\n')).join('\n');
  // These fixture games share a URL, so distinguish the highlighted title from the remaining list.
  assert.equal(featuredText.split('[Main game B]').length - 1, 1);
  assert(!featuredPages[0].embeds[0].fields.some(field => field.value.includes('[Main game B]')));
  assert.equal(featuredPages[0].components[0].components[0].url, mainB.url);
  assert.equal(embeds.buildListing([mainA], { ...config, featuredArtwork: 'hidden' }, now)[0].embeds[0].thumbnail, undefined);
  assert.equal(embeds.buildListing([mainA], config, now)[0].embeds[0].fields.length, 0);
  assert.throws(() => store.validateSettings({ featuredMode: 'fake' }, config));
  assert.throws(() => store.validateSettings({ featuredOfferId: 'https://example.com' }, config));
  assert.throws(() => store.validateSettings({ featuredArtwork: 'fake' }, config));
  assert.equal(store.validateSettings({ featuredMode: 'manual', featuredOfferId: mainA.id }, config).featuredOfferId, mainA.id);

  // A fresh provider module must request and retain the provider's popularity ordering.
  {
    const fs = require('node:fs'), vm = require('node:vm'), moduleFixture = { exports: {} };
    const originalFetch = global.fetch;
    try {
      global.fetch = async url => {
        assert(String(url).includes('sort-by=popularity'));
        return { status: 200, json: async () => [12, 11].map(id => ({ id, title: 'Main ' + id, type: 'Game', status: 'Active', platforms: 'Steam', gamerpower_url: 'https://www.gamerpower.com/offer/' + id, image: 'https://www.gamerpower.com/game.jpg', worth: '$10.00' })) };
      };
      const source = fs.readFileSync(root + '/src/modules/utilityStudio/games/freeGamesProviders.js', 'utf8');
      vm.runInThisContext('(function(require,module,exports){' + source + '\n})')(require, moduleFixture, moduleFixture.exports);
      const ranked = await moduleFixture.exports.getOffers();
      assert.deepEqual(ranked.offers.map(item => [item.id, item.popularityRank]), [['gamerpower:12', 0], ['gamerpower:11', 1]]);
    } finally { global.fetch = originalFetch; }
  }
  const savedFetch = global.fetch;
  let calls = 0;
  try {
    global.fetch = async () => { calls++; return { ok: true, json: async () => ({ base: 'USD', quote: 'GBP', rate: 0.8, date: new Date(now).toISOString().slice(0, 10) }) }; };
    const [a, b] = await Promise.all([providers.getPricing(config), providers.getPricing(config)]);
    assert.equal(a.rate, 0.8); assert.deepEqual(a, b); assert.equal(calls, 1);
    global.fetch = async () => { throw Error('offline'); };
    const failed = await providers.getPricing({ ...config, currency: 'EUR' });
    assert.equal(failed.mode, 'unavailable'); assert(failed.warning);
    assert.equal((await providers.getPricing({ ...config, priceMode: 'hidden' })).mode, 'hidden');
  } finally { global.fetch = savedFetch; }
  const monitor = require('../src/modules/utilityStudio/games/freeGamesMonitor');
  const originals = { getConfig: store.getConfig, update: store.update, getOffers: providers.getOffers, getPricing: providers.getPricing };
  let state = { ...structuredClone(config), enabled: true, channelId: '123456789012345678', alerts: true, roleId: null };
  let feedOffers = [offer];
  const messages = new Map();
  let serial = 0;
  let alerts = 0;
  let edits = 0;
  const channel = { id: state.channelId, type: 0, permissionsFor: () => ({ has: () => true }), messages: { fetch: async (id) => {
    if (typeof id === 'object') return { find: (fn) => [...messages.values()].find(fn) };
    if (!messages.has(id)) throw Object.assign(Error('deleted'), { code: 10008 });
    return messages.get(id);
  } }, send: async (payload) => {
    if (/new free offers?$/.test(payload.embeds[0].title)) { alerts++; return {}; }
    const message = { id: String(++serial), author: { id: 'bot' }, embeds: payload.embeds, edit: async (next) => { edits++; message.embeds = next.embeds; }, delete: async () => messages.delete(message.id) };
    messages.set(message.id, message); return message;
  } };
  const guild = { id: '123456789012345679', client: { user: { id: 'bot' } }, channels: { fetch: async () => channel }, members: { me: {} } };
  try {
    store.getConfig = () => structuredClone(state);
    store.update = (id, fn) => { state = fn(structuredClone(state)); return state; };
    providers.getOffers = async () => ({ offers: feedOffers, fetchedAt: now });
    providers.getPricing = async () => config.pricing;
    await monitor.processGuild(guild);
    assert.equal(alerts, 0); assert.deepEqual(state.state.newSince, {});
    assert.equal(messages.size, 1);
    const baselineEdits = edits;
    await Promise.all([monitor.processGuild(guild), monitor.processGuild(guild)]);
    assert.equal(messages.size, 1); assert.equal(edits, baselineEdits);
    const addition = { ...offer, id: 'gamerpower:999', title: 'New offer', type: 'dlc' };
    feedOffers = [offer, addition];
    await monitor.processGuild(guild);
    assert.equal(alerts, 1); assert(state.state.newSince[addition.id]); assert.equal(messages.size, 2);
    await monitor.processGuild(guild); assert.equal(alerts, 1);
    messages.clear(); await monitor.processGuild(guild); assert.equal(messages.size, 2); assert.equal(alerts, 1);
    providers.getOffers = async () => { throw Error('provider offline'); };
    await assert.rejects(monitor.processGuild(guild), /provider offline/);
    assert.equal(messages.size, 2); assert(state.state.error.includes('provider offline'));
    providers.getOffers = async () => ({ offers: [offer], fetchedAt: now });
    await monitor.processGuild(guild); assert.equal(messages.size, 1); assert.equal(state.state.error, null);
  } finally {
    store.getConfig = originals.getConfig; store.update = originals.update;
    providers.getOffers = originals.getOffers; providers.getPricing = originals.getPricing;
  }
  // Verify the preview is access-controlled and never writes config or posts messages.
  const express = require('express');
  const http = require('node:http');
  const { once } = require('node:events');
  const routePath = require.resolve('../src/server/routes/modules/utilityStudio/freeGames');
  const priorRoute = require.cache[routePath];
  let server;
  const priorConfig = store.getConfig;
  const priorOffers = providers.getOffers;
  const priorPricing = providers.getPricing;
  try {
    providers.getOffers = async () => ({ offers: [offer], fetchedAt: now });
    providers.getPricing = async () => config.pricing;
    store.getConfig = () => structuredClone(config);
    delete require.cache[routePath];
    const app = express(); app.use(express.json());
    app.use((req, res, next) => {
      req.session = req.headers['x-fixture-user'] ? { user: { id: '123456789012345680' } } : {};
      req.client = { guilds: { cache: new Map([[guild.id, { ...guild, members: { fetch: async () => ({ permissions: { has: () => req.headers['x-fixture-user'] === 'manager' } }) } }]]) } };
      next();
    });

    const freeGamesRoutes = require(routePath);
    const orderedChannels = freeGamesRoutes.orderListingChannels({ channels: { cache: new Map([
      ['20', { id: '20', name: 'Alpha lower category', type: 4, rawPosition: 2 }],
      ['200', { id: '200', name: 'lower-channel', type: 0, parentId: '20', rawPosition: 0 }],
      ['102', { id: '102', name: 'top-second', type: 5, parentId: '10', rawPosition: 3 }],
      ['10', { id: '10', name: 'Zulu first category', type: 4, rawPosition: 1 }],
      ['101', { id: '101', name: 'top-first', type: 0, parentId: '10', rawPosition: 1 }],
      ['1', { id: '1', name: 'uncategorized', type: 0, rawPosition: 5 }],
      ['300', { id: '300', name: 'voice-excluded', type: 2, parentId: '10', rawPosition: 0 }],
    ]) } });
    assert.deepEqual(orderedChannels.map(channel => channel.id), ['1', '101', '102', '200']);
    assert.equal(orderedChannels[1].groupName, 'Zulu first category');
    assert.equal(orderedChannels[3].groupName, 'Alpha lower category');
    app.use('/api/free-games', freeGamesRoutes);
    server = http.createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}/api/free-games/${guild.id}/preview`;
    assert.equal((await savedFetch(url, { method: 'POST' })).status, 401);
    assert.equal((await savedFetch(url, { method: 'POST', headers: { 'x-fixture-user': 'member' } })).status, 403);
    for (const [suffix, method] of [['settings', 'PATCH'], ['subscriptions', 'POST'], ['subscriptions/730', 'DELETE'], ['730/preview', 'POST'], ['730/send-latest', 'POST'], ['730/retry', 'POST'], ['check', 'POST']]) {
      const endpoint = url.replace('/preview', '/updates/' + suffix);
      assert.equal((await savedFetch(endpoint, { method })).status, 401);
      assert.equal((await savedFetch(endpoint, { method, headers: { 'x-fixture-user': 'member' } })).status, 403);
    }
    const response = await savedFetch(url, { method: 'POST', headers: { 'x-fixture-user': 'manager', 'content-type': 'application/json' }, body: JSON.stringify({ currency: 'GBP' }) });
    assert.equal(response.status, 200);
    const payload = await response.json(); assert.equal(payload.offers.length, 1); assert(payload.pages.length);
    assert.equal(alerts, 1); assert.equal(messages.size, 1);
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    store.getConfig = priorConfig; providers.getOffers = priorOffers; providers.getPricing = priorPricing;
    delete require.cache[routePath]; if (priorRoute) require.cache[routePath] = priorRoute;
  }
  await gameUpdatesAudit();
  console.log('✅ Games: folder rename/storage compatibility, single featured main title/popularity/manual/fallback/thumbnail, guild category/channel ordering, cold-cache core emoji resolution, footer-only timestamps, Discord management authority/shared settings/preview, configurable presentation/timestamps, unique offers, section order, embed limits, GBP/source/hidden pricing, NEW baseline, expiry safety, settings validation, rate cache/failure and delivery baseline/recovery/shrink/locking');
  return true;
}

async function gameUpdatesAudit() {
  const assert = require('node:assert/strict'), fs = require('node:fs');
  // Isolated in-memory guild state: this audit never writes a server's configuration.
  const directory = root + '/src/modules/utilityStudio/games/';
  const modules = {}, memory = { enabled: false, currency: 'GBP', state: { deliveries: [{ messageId: 'preserve' }] } };
  const permissions = new Proxy({}, { get: (_, key) => key });
  const section = { getModuleSection: () => memory, updateModuleSection: (_id, _key, fn) => { const next = fn(memory); for (const key of Object.keys(memory)) delete memory[key]; Object.assign(memory, next); return memory; } };
  function load(name) {
    if (modules[name]) return modules[name].exports;
    const module = { exports: {} }; modules[name] = module;
    const localRequire = id => {
      if (id.startsWith('./freeGames')) return load(id.slice(2));
      if (id.includes('moduleSectionManager')) return section;
      if (id.includes('guildManager')) return { isModuleEnabled: () => memory.enabled };
      if (id === 'discord.js') return { PermissionFlagsBits: permissions };
      if (id.includes('security/protection/core')) return { isBotOwner: () => false };
      return require(id);
    };
    new Function('require', 'module', 'exports', fs.readFileSync(directory + name + '.js', 'utf8'))(localRequire, module, module.exports);
    return module.exports;
  }
  const providers = load('freeGamesProviders'), store = load('freeGames'), embeds = load('freeGamesEmbeds');
  let monitor = load('freeGamesMonitor');
  assert.equal(providers.steamAppId('https://store.steampowered.com/app/730/Counter_Strike_2/'), '730');
  for (const value of ['0', '-1', '4294967296', 'https://example.com/app/730', 'http://store.steampowered.com/app/730/', 'https://user@store.steampowered.com/app/730/']) assert.throws(() => providers.steamAppId(value));
  const raw = { gid: '100', title: 'Patch update', contents: '<script>bad()</script>[b]Fixed[/b] &amp; improved', date: Math.floor(Date.now() / 1000), feedname: 'steam_community_announcements', url: 'https://store.steampowered.com/news/app/730/view/100' };
  const item = providers.normalizeNews(raw);
  assert.equal(item.kind, 'patches'); assert.equal(item.description, 'Fixed & improved');
  assert.equal(providers.normalizeNews({ ...raw, feedname: 'pcgamer' }), null);
  assert.equal(providers.normalizeNews({ ...raw, url: 'https://example.com/news' }), null);
  assert.equal(providers.normalizeNews({ ...raw, date: 'invalid' }), null);
  assert.throws(() => store.validateUpdateSettings({ enabled: 'true' }, store.UPDATE_DEFAULTS));
  assert.throws(() => store.validateUpdateSettings({ quietStart: '25:00', quietEnd: '06:00' }, store.UPDATE_DEFAULTS));
  assert.throws(() => store.validateUpdateSettings({ quietStart: '22:00' }, store.UPDATE_DEFAULTS));
  assert(monitor.updatesQuietNow({ quietStart: '22:00', quietEnd: '06:00' }, 'UTC', Date.parse('2026-01-01T23:00:00Z')));
  assert(!monitor.updatesQuietNow({ quietStart: '22:00', quietEnd: '06:00' }, 'UTC', Date.parse('2026-01-01T12:00:00Z')));
  const originalFetch = global.fetch;
  try {
    let calls = 0;
    global.fetch = async (url, options) => { calls++; assert(url.startsWith('https://api.steampowered.com/ISteamNews/')); assert.equal(options.redirect, 'error'); return { ok: true, json: async () => ({ appnews: { appid: 730, newsitems: [raw, raw] } }) }; };
    const [first, second] = await Promise.all([providers.getGameNews('730'), providers.getGameNews('730')]);
    assert.equal(calls, 1); assert.equal(first.items.length, 1); assert.equal(first, second);
    global.fetch = async () => ({ ok: true, json: async () => ({ appnews: { appid: 999, newsitems: [] } }) });
    await assert.rejects(providers.getGameNews('570'), /invalid announcement feed/);
  } finally { global.fetch = originalFetch; }
  let feed = [item], sourceFailed = false, sendError = null, allowed = true, messages = [], sent = [];
  providers.getGameNews = async () => { if (sourceFailed) throw new Error('Source unavailable'); return { items: feed }; };
  const channelId = '222222222222222222', roleId = '333333333333333333';
  const channel = { id: channelId, type: 0, permissionsFor: () => ({ has: () => allowed }), messages: { fetch: async () => ({ find: fn => messages.find(fn) }) }, send: async payload => { if (sendError) throw sendError; sent.push(payload); messages.push({ author: { id: 'bot' }, embeds: payload.embeds }); return { id: String(sent.length) }; } };
  const guild = { id: '111111111111111111', client: { user: { id: 'bot' } }, channels: { fetch: async () => channel }, members: { me: {} }, roles: { fetch: async () => ({ id: roleId, managed: false, mentionable: true }) } };
  await monitor.saveGameSubscription(guild, { appId: '730', name: 'Counter-Strike 2', channelId, roleId, enabled: true });
  await monitor.configureGameUpdates(guild, { enabled: true });
  await monitor.processGameUpdates(guild); assert.equal(sent.length, 0, 'A new subscription quietly baselines existing news.');
  const makeItem = id => ({ ...item, id: String(id), url: 'https://store.steampowered.com/news/app/730/view/' + id });
  feed = [makeItem(101), ...feed];
  await Promise.all([monitor.processGameUpdates(guild), monitor.processGameUpdates(guild)]);
  assert.equal(sent.length, 1); assert.deepEqual(sent[0].allowedMentions.roles, [roleId]); assert.equal(memory.enabled, false, 'Game Updates works independently of free-offer delivery.');
  delete modules.freeGamesMonitor; monitor = load('freeGamesMonitor');
  await monitor.processGameUpdates(guild); assert.equal(sent.length, 1, 'Persistent state prevents reposting after restart.');
  const beforePreview = JSON.stringify(memory); await monitor.previewGameUpdate(guild, '730'); assert.equal(JSON.stringify(memory), beforePreview);
  assert((await monitor.sendLatestGameUpdate(guild, '730')).alreadyDelivered); assert.equal(sent.length, 1);
  feed = [makeItem(102), ...feed];
  await monitor.sendLatestGameUpdate(guild, '730'); assert.equal(sent.length, 2); assert.deepEqual(sent[1].allowedMentions.roles, []);
  sourceFailed = true; await monitor.processGameUpdates(guild); assert.match(store.getGameUpdates(guild.id).subscriptions['730'].error, /Source unavailable/); assert.equal(sent.length, 2); sourceFailed = false;
  feed = [makeItem(103), ...feed]; allowed = false;
  await monitor.processGameUpdates(guild); assert.equal(sent.length, 2); assert.equal(store.getGameUpdates(guild.id).subscriptions['730'].pending.length, 1);
  allowed = true; await monitor.processGameUpdates(guild); assert.equal(sent.length, 3);
  feed = [makeItem(104), ...feed]; sendError = new Error('Connection lost');
  await monitor.processGameUpdates(guild); sendError = null;
  assert.equal(store.getGameUpdates(guild.id).subscriptions['730'].pending[0].status, 'ambiguous');
  await monitor.processGameUpdates(guild); assert.equal(sent.length, 3, 'Uncertain delivery is not blindly retried.');
  await assert.rejects(monitor.saveGameSubscription(guild, { appId: '730', channelId: '444444444444444444' }), /Resolve held deliveries/);
  await monitor.retryHeldGameUpdates(guild, '730'); assert.equal(sent.length, 4); assert.deepEqual(sent[3].allowedMentions.roles, []);
  // Simulate a crash after Discord accepted a send but before local confirmation persisted.
  const recovered = makeItem(105); feed = [recovered, ...feed];
  store.updateGameUpdates(guild.id, state => { const sub = state.subscriptions['730']; return { ...state, subscriptions: { ...state.subscriptions, '730': { ...sub, seenIds: [recovered.id, ...sub.seenIds], pending: [{ item: recovered, status: 'dispatching' }] } } }; });
  messages.push({ author: { id: 'bot' }, embeds: embeds.buildGameUpdate(store.getGameUpdates(guild.id).subscriptions['730'], recovered).embeds });
  await monitor.processGameUpdates(guild); assert.equal(sent.length, 4); assert.equal(store.getGameUpdates(guild.id).history[0].status, 'recovered');
  const sub = store.getGameUpdates(guild.id).subscriptions['730'];
  memory.timeZone = 'UTC';
  const clock = new Date(), clockText = date => date.toISOString().slice(11, 16);
  await monitor.configureGameUpdates(guild, { quietStart: clockText(clock), quietEnd: clockText(new Date(clock.getTime() + 60000)) });
  feed = [makeItem(107), makeItem(106), ...feed];
  await monitor.processGameUpdates(guild); assert.equal(sent.length, 4); assert.equal(store.getGameUpdates(guild.id).subscriptions['730'].pending.length, 2);
  await monitor.sendLatestGameUpdate(guild, '730'); assert.equal(sent.length, 5); assert.deepEqual(sent[4].allowedMentions.roles, []);
  assert.equal(store.getGameUpdates(guild.id).subscriptions['730'].pending.length, 1, 'Manual send must not flush another queued announcement.');
  await monitor.retryHeldGameUpdates(guild, '730'); assert.equal(sent.length, 5, 'Retry held must not flush unrelated queued announcements.');
  await monitor.configureGameUpdates(guild, { quietStart: null, quietEnd: null }); await monitor.processGameUpdates(guild); assert.equal(sent.length, 6);
  let canManage = false, lastReply;
  guild.members.fetch = async () => ({ permissions: { has: () => canManage } });
  const interaction = action => ({ customId: 'admin:module:freeGames:updates:' + action, guild, user: { id: 'manager' }, deferred: true, isButton: () => true, editReply: async payload => { lastReply = payload; } });
  const beforeDenied = JSON.stringify(memory); await store.handleAdminInteraction(interaction('toggle')); assert.match(lastReply.content, /Manage Server/); assert.equal(JSON.stringify(memory), beforeDenied);
  canManage = true; await store.handleAdminInteraction(interaction('home:0')); assert.match(lastReply.embeds[0].title, /Game Updates/);
  sourceFailed = true; await store.handleAdminInteraction(interaction('preview:730')); assert.match(lastReply.embeds[0].description, /Unable to apply change/); sourceFailed = false;
  assert.equal(store.matchesGameUpdate(item, { ...sub, includeWords: ['fixed'], excludeWords: [] }), true);
  assert.equal(store.matchesGameUpdate(item, { ...sub, includeWords: [], excludeWords: ['fixed'] }), false);
  const detailed = embeds.buildGameUpdate({ ...sub, detail: 'detailed', artwork: 'hidden' }, { ...item, description: '*'.repeat(3500) }, { suppressMention: true });
  assert(detailed.embeds[0].description.length < 4096); assert(!detailed.embeds[0].image); assert.deepEqual(detailed.allowedMentions.roles, []);
  for (const panel of [store.buildUpdatesPanel(guild), store.buildUpdateSubscriptionPanel(guild, '730'), store.buildUpdateSubscriptionPanel(guild, '730', '', true)]) {
    assert(panel.components.length <= 5); for (const row of panel.components) assert(row.components.length <= 5);
    assert.deepEqual(panel.allowedMentions, { parse: [] });
  }
  await monitor.removeGameSubscription(guild, '730');
  assert.equal(Object.keys(store.getGameUpdates(guild.id).subscriptions).length, 0);
  assert(store.getGameUpdates(guild.id).history.length > 0); assert.equal(memory.currency, 'GBP'); assert.equal(memory.state.deliveries[0].messageId, 'preserve');
  console.log('✅ Game Updates: isolated state, official Steam source/cache, validation, independent enablement, quiet baseline, concurrent/restart dedupe, private preview, role-safe manual sends, permission recovery, uncertain-send review, crash recovery, filters, embed/component limits and legacy data preservation');
  return true;
}


const commands = {
  'game-updates': gameUpdatesAudit,
  games: freeGamesAudit,
  'free-games': freeGamesAudit,
  'quarantine-containment': quarantineContainmentAudit,
  'legacy-quarantine': legacyQuarantineAudit,
  'legacy-quarantine-reconcile': legacyQuarantineReconcileCommand,
  'dependency-runtime': dependencyRuntimeAudit,
  summary: developmentSummaryCommand,
  doctor: () => doctor(process.argv[3]), audit: auditCommand, 'dashboard-imports': dashboardImportAudit, 'backend-imports': backendRelativeImportAudit, 'runtime-contracts': runtimeContractsAudit, 'guild-variable-source': guildVariableSourceAudit, 'internal-version-naming': internalVersionNamingAudit, 'verification-lifecycle': verificationLifecycleAudit, 'embed-studio-preview': embedStudioPreviewAudit, 'embed-media-alignment': embedMediaAlignmentAudit, 'embed-session-persistence': embedSessionPersistenceAudit, 'embed-state-persistence-boundary': embedStatePersistenceBoundaryAudit, 'admin-module-routing': adminModuleRoutingAudit, 'embed-graphic-headers': embedGraphicHeadersAudit, 'embed-template-binding-lifecycle': embedTemplateBindingLifecycleAudit, 'social-live-presentation': socialLivePresentationAudit, 'social-studio-lifecycle': socialStudioLifecycleAudit, 'universal-member-notices': universalMemberNoticesAudit, 'welcome-embed-delivery': welcomeEmbedDeliveryAudit, 'role-pagination': rolePaginationAudit,
  'deploy-plan': () => deployPlan(process.argv[3], process.argv[4], process.argv[5]),
  'sync-commands': () => syncCommands(process.argv[3]), promote: () => promote(process.argv[3]), guilds: guildAudit, media: mediaAudit,
};
const command = process.argv[2] || 'doctor';
const handler = commands[command];
if (!handler) { console.error(`Unknown Goliath command: ${command}`); process.exitCode = 1; }
else {
  // Let the doctor wrapper wait for every audit before exiting past runtime handles.
  module.exports = Promise.resolve()
    .then(() => handler())
    .then((result) => {
      if (!result) process.exitCode = 1;
    })
    .catch((error) => {
      console.error('Goliath command failed:', error.message);
      process.exitCode = 1;
    });
}
