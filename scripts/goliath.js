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

function verificationLifecycleAudit() {
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
    assert(!panel.includes('admin:verification:page:panel'), 'Legacy Panels page must not remain in the canonical panel.');
    assert(!memberIntelligence.includes('verificationIntelligenceExtension'), 'Member Intelligence must not monkey-patch the Verification admin UI.');
    assert(!fs.existsSync(absolute('src/modules/securityStudio/verificationIntelligenceExtension.js')), 'Legacy Verification UI compatibility extension must be removed.');
    
    const forbiddenGenerationPattern = new RegExp('\\b' + 'v' + '[23]' + '\\b', 'i');
    assert(!forbiddenGenerationPattern.test([flow, quarantine, lifecycle, risk, store, manager, panel].join('\n')), 'Verification source contains forbidden numbered-generation naming.');
    
    console.log('Verification lifecycle and admin-surface contract audit passed.');
    
    return true;
  } catch (error) {
    console.error(`❌ Verification lifecycle audit failed: ${error.message}`);
    return false;
  }
}

function auditCommand() {
  section('Goliath audit');
  return [projectShape, commandAudit, dashboardAudit, dashboardImportAudit, sourceAudit, importAudit, runtimeAudit, goodbyeAudit, reactionRolesAudit, roleStudioAudit, inviteStudioAudit]
    .map((suite) => suite()).every(Boolean);
}
function doctor(target = '') {
  const suites = { goodbye: goodbyeAudit, reaction: reactionRolesAudit, reactionroles: reactionRolesAudit, 'reaction-roles': reactionRolesAudit, 'role-studio': roleStudioAudit, rolestudio: roleStudioAudit, invites: inviteStudioAudit };
  if (target) return suites[target]?.() ?? false;
  return [projectShape, commandAudit, dashboardAudit, sourceAudit, importAudit, runtimeAudit, goodbyeAudit, reactionRolesAudit, roleStudioAudit, inviteStudioAudit]
    .map((suite) => suite()).every(Boolean);
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

const commands = {
  doctor: () => doctor(process.argv[3]), audit: auditCommand, 'dashboard-imports': dashboardImportAudit, 'backend-imports': backendRelativeImportAudit, 'runtime-contracts': runtimeContractsAudit, 'guild-variable-source': guildVariableSourceAudit, 'internal-version-naming': internalVersionNamingAudit, 'verification-lifecycle': verificationLifecycleAudit,
  'deploy-plan': () => deployPlan(process.argv[3], process.argv[4], process.argv[5]),
  'sync-commands': () => syncCommands(process.argv[3]), promote: () => promote(process.argv[3]), guilds: guildAudit, media: mediaAudit,
};
const command = process.argv[2] || 'doctor';
const handler = commands[command];
if (!handler) { console.error(`Unknown Goliath command: ${command}`); process.exitCode = 1; }
else if (!handler()) process.exitCode = 1;
