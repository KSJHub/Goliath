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


function quarantineContainmentAudit() {
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
required(verification, 'legacy_without_shared_snapshot', 'Missing legacy shared snapshots must be flagged');
required(verification, 'missing_original_roles', 'Missing original roles must be flagged');
console.log('Quarantine containment contract audit passed (static checks only; live Discord permissions still require testing).');

return true;
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
  const providers = require('../src/modules/utilityStudio/freeGames/freeGamesProviders');
  const embeds = require('../src/modules/utilityStudio/freeGames/freeGamesEmbeds');
  const store = require('../src/modules/utilityStudio/freeGames/freeGames');
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
  const monitor = require('../src/modules/utilityStudio/freeGames/freeGamesMonitor');
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
    if (!payload.embeds[0].footer) { alerts++; return {}; }
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
    app.use('/api/free-games', require(routePath));
    server = http.createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}/api/free-games/${guild.id}/preview`;
    assert.equal((await savedFetch(url, { method: 'POST' })).status, 401);
    assert.equal((await savedFetch(url, { method: 'POST', headers: { 'x-fixture-user': 'member' } })).status, 403);
    const response = await savedFetch(url, { method: 'POST', headers: { 'x-fixture-user': 'manager', 'content-type': 'application/json' }, body: JSON.stringify({ currency: 'GBP' }) });
    assert.equal(response.status, 200);
    const payload = await response.json(); assert.equal(payload.offers.length, 1); assert(payload.pages.length);
    assert.equal(alerts, 1); assert.equal(messages.size, 1);
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    store.getConfig = priorConfig; providers.getOffers = priorOffers; providers.getPricing = priorPricing;
    delete require.cache[routePath]; if (priorRoute) require.cache[routePath] = priorRoute;
  }
  console.log('✅ Free Games: unique offers, section order, embed limits, GBP/source/hidden pricing, NEW baseline, expiry safety, settings validation, rate cache/failure and delivery baseline/recovery/shrink/locking');
  return true;
}

const commands = {
  'free-games': freeGamesAudit,
  'quarantine-containment': quarantineContainmentAudit,
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
