'use strict';

const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveBotMode, getRuntimeRoot, resolveRuntimePath } = require('../../../config/runtimePaths');
const security = require('../../../core/security/protection/core');

const router = express.Router();
const RUNTIME_MODE = resolveBotMode(process.env.BOT_MODE).toUpperCase();

function requireOwner(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({ success: false, error: 'Not authenticated.' });
  }

  if (!security.isBotOwner(req.session.user.id)) {
    return res.status(403).json({
      success: false,
      error: 'Forbidden',
      diagnostics: {
        sessionUserId: req.session.user.id,
        ownerMatch: false,
        ownerIdCount: security.getBotOwnerIds().length,
        configuredOwnerKeys: getConfiguredOwnerKeys(),
      },
    });
  }

  return next();
}

function getConfiguredOwnerKeys() {
  return {
    OWNER_IDS: security.getBotOwnerIds().length,
  };
}

function getDiscordClient(req) {
  return (
    req.client ||
    req.app?.get?.('goliath.client') ||
    req.app?.locals?.client ||
    req.app?.locals?.discordClient ||
    global.client ||
    global.discordClient ||
    null
  );
}

function getSafeEnvSummary() {
  return {
    NODE_ENV: process.env.NODE_ENV || 'unset',
    BOT_MODE: process.env.BOT_MODE || 'unset',
    PORT: process.env.PORT || process.env.BOT_API_PORT || 'unset',
    CLIENT_URL: Boolean(process.env.CLIENT_URL),
    DASHBOARD_CLIENT_URL: Boolean(process.env.DASHBOARD_CLIENT_URL),
    DISCORD_CLIENT_ID: Boolean(process.env.DISCORD_CLIENT_ID || process.env.CLIENT_ID),
    DISCORD_REDIRECT_URI: Boolean(process.env.DISCORD_REDIRECT_URI),
    SESSION_SECRET: Boolean(process.env.SESSION_SECRET || process.env.DASHBOARD_SESSION_SECRET),
    OWNER_INTERNAL_TOKEN: Boolean(process.env.OWNER_INTERNAL_TOKEN),
  };
}

function safeReadJson(filePath, fallback = null) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function getPackageInfo() {
  return safeReadJson(path.join(process.cwd(), 'package.json'), { name: 'goliath', version: 'unknown' }) || { name: 'goliath', version: 'unknown' };
}

function getRuntimeFolders(environment = RUNTIME_MODE) {
  const root = getRuntimeRoot(environment);
  const folders = ['guilds', 'logs', 'backups', 'data', 'cache', 'deployments'];
  return Object.fromEntries(folders.map((folder) => {
    const folderPath = path.join(root, folder);
    return [folder, { path: folderPath, exists: fs.existsSync(folderPath) }];
  }));
}

function readDeploymentHistory(environment = RUNTIME_MODE) {
  const candidates = [
    resolveRuntimePath(environment, 'deployments', 'history.json'),
    resolveRuntimePath(environment, 'data', 'deployments.json'),
    resolveRuntimePath(environment, 'logs', 'deployments.json'),
  ];

  for (const filePath of candidates) {
    const payload = safeReadJson(filePath, null);
    if (!payload) continue;
    const history = Array.isArray(payload) ? payload : Array.isArray(payload.history) ? payload.history : Array.isArray(payload.deployments) ? payload.deployments : [];
    return history.slice(-25).reverse();
  }

  return [];
}

function buildDeploymentPayload(req) {
  const client = getDiscordClient(req);
  const mode = RUNTIME_MODE;
  const branchMap = { DEV: 'dev', BETA: 'beta', PRODUCTION: 'production' };
  const packageInfo = getPackageInfo();
  const commitSha = String(process.env.GITHUB_SHA || process.env.COMMIT_SHA || process.env.GIT_COMMIT || '').trim() || null;
  const buildTime = String(process.env.BUILD_TIME || process.env.BUILD_DATE || process.env.DEPLOYED_AT || '').trim() || null;
  const branch = String(process.env.GIT_BRANCH || process.env.BRANCH_NAME || branchMap[mode] || 'dev').replace(/^origin\//, '');
  const runtimeFolders = getRuntimeFolders(mode);
  const deploymentHistory = readDeploymentHistory(mode);
  const warnings = [];

  if (!commitSha) warnings.push('Commit SHA not exposed to runtime.');
  if (!buildTime) warnings.push('Build time not exposed to runtime.');
  if (!runtimeFolders.guilds.exists) warnings.push('Runtime guild folder missing.');

  const deployment = {
    environment: mode,
    branch,
    expectedBranch: branchMap[mode] || 'dev',
    port: Number(process.env.PORT || process.env.BOT_API_PORT || 3001),
    status: client?.isReady?.() ? 'online' : 'degraded',
    health: warnings.length ? 'attention' : 'healthy',
    packageName: packageInfo.name || 'goliath',
    version: packageInfo.version || 'unknown',
    commitSha,
    shortCommit: commitSha ? commitSha.slice(0, 7) : 'unknown',
    buildTime,
    nodeVersion: process.version,
    hostname: os.hostname(),
    runtimeFolders,
    deploymentHistory,
    lastDeployment: deploymentHistory[0] || null,
    updateAvailable: false,
    restartControls: {
      available: false,
      reason: 'Restart controls are disabled until a safe PM2 adapter is configured.',
    },
    discord: {
      ready: Boolean(client?.isReady?.()),
      ping: client?.ws?.ping ?? null,
      guilds: client?.guilds?.cache?.size || 0,
      username: client?.user?.tag || client?.user?.username || null,
    },
    process: {
      pid: process.pid,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    },
    warnings,
    checkedAt: new Date().toISOString(),
  };

  return {
    deployments: [deployment],
    summary: {
      total: 1,
      online: deployment.status === 'online' ? 1 : 0,
      degraded: deployment.status === 'degraded' ? 1 : 0,
      offline: 0,
      attention: warnings.length ? 1 : 0,
      updateAvailable: 0,
      history: deploymentHistory.length,
    },
  };
}

router.get('/', requireOwner, (req, res) => {
  const client = getDiscordClient(req);
  const guildCount = client?.guilds?.cache?.size || 0;
  const ownerIds = security.getBotOwnerIds();
  const sessionUserId = String(req.session?.user?.id || '');

  return res.json({
    success: true,
    checkedAt: new Date().toISOString(),
    mode: RUNTIME_MODE,
    auth: {
      authenticated: Boolean(req.session?.user),
      sessionUserId,
      sessionUserName: req.session?.user?.username || req.session?.user?.displayName || null,
      sessionOwnerFlag: req.session?.user?.isOwner === true,
      ownerMatch: security.isBotOwner(sessionUserId),
      ownerIdCount: ownerIds.length,
      configuredOwnerKeys: getConfiguredOwnerKeys(),
    },
    routes: {
      authMe: '/api/auth/me',
      ownerMe: '/api/owner/me',
      ownerGuilds: '/api/owner/guilds/all',
      ownerDiagnostics: '/api/owner/diagnostics',
      ownerDeployments: '/api/owner/diagnostics/deployments',
    },
    runtime: {
      pid: process.pid,
      nodeVersion: process.version,
      uptimeSeconds: Math.round(process.uptime()),
      hostname: os.hostname(),
      platform: process.platform,
    },
    discord: {
      clientAvailable: Boolean(client),
      ready: Boolean(client?.isReady?.()),
      username: client?.user?.tag || client?.user?.username || null,
      guildCount,
      wsPing: client?.ws?.ping ?? null,
    },
    environment: getSafeEnvSummary(),
  });
});

router.get('/deployments', requireOwner, (req, res) => {
  try {
    const payload = buildDeploymentPayload(req);
    return res.json({
      success: true,
      owner: true,
      mode: RUNTIME_MODE,
      ...payload,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[OWNER DIAGNOSTICS DEPLOYMENTS]', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
