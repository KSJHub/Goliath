'use strict';

const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const notifications = require('../../core/notifications/notificationStore');

const router = express.Router();

const ENVIRONMENT_PORTS = [
  { key: 'dev', environment: 'DEV', branch: 'dev', port: 3001 },
  { key: 'beta', environment: 'BETA', branch: 'beta', port: 3011 },
  { key: 'production', environment: 'PRODUCTION', branch: 'production', port: 3021 },
];

function splitIds(value) {
  return String(value || '').split(',').map((id) => id.trim()).filter(Boolean);
}

function getOwnerIds() {
  return [...new Set([
    ...splitIds(process.env.OWNER_ID),
    ...splitIds(process.env.OWNER_IDS),
    ...splitIds(process.env.BOT_OWNER_ID),
    ...splitIds(process.env.BOT_OWNER_IDS),
  ])];
}

function isOwnerUser(userId) {
  return Boolean(userId && getOwnerIds().includes(String(userId)));
}

function isInternalOwnerRequest(req) {
  const token = String(process.env.OWNER_INTERNAL_TOKEN || '').trim();
  if (!token) return false;
  return String(req.headers['x-goliath-owner-token'] || '').trim() === token;
}

function requireOwner(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ success: false, error: 'Not authenticated.' });
  if (!isOwnerUser(req.session.user.id)) return res.status(403).json({ success: false, error: 'Forbidden' });
  return next();
}

function requireOwnerOrInternal(req, res, next) {
  if (isInternalOwnerRequest(req)) return next();
  return requireOwner(req, res, next);
}

function getRuntimeMode() {
  return String(process.env.BOT_MODE || 'dev').trim().toUpperCase();
}

function getEnvironmentKey(environment = getRuntimeMode()) {
  const value = String(environment || 'DEV').toUpperCase();
  if (value === 'PRODUCTION' || value === 'PROD') return 'production';
  if (value === 'BETA') return 'beta';
  return 'dev';
}

function getEnvironmentConfig(environment = getRuntimeMode()) {
  const key = getEnvironmentKey(environment);
  return ENVIRONMENT_PORTS.find((item) => item.key === key) || ENVIRONMENT_PORTS[0];
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

function getGitCommitSha() {
  return String(process.env.GITHUB_SHA || process.env.COMMIT_SHA || process.env.GIT_COMMIT || '').trim() || null;
}

function getBuildTime() {
  return String(process.env.BUILD_TIME || process.env.BUILD_DATE || process.env.DEPLOYED_AT || '').trim() || null;
}

function getCurrentBranch(environment = getRuntimeMode()) {
  return String(process.env.GIT_BRANCH || process.env.BRANCH_NAME || getEnvironmentConfig(environment).branch || '').replace(/^origin\//, '') || getEnvironmentConfig(environment).branch;
}

function runtimePath(environment = getRuntimeMode(), ...parts) {
  return path.join(process.cwd(), 'src', 'runtime', getEnvironmentKey(environment), ...parts);
}

function readDeploymentHistory(environment = getRuntimeMode()) {
  const candidates = [
    runtimePath(environment, 'deployments', 'history.json'),
    runtimePath(environment, 'data', 'deployments.json'),
    runtimePath(environment, 'logs', 'deployments.json'),
  ];

  for (const filePath of candidates) {
    const payload = safeReadJson(filePath, null);
    if (!payload) continue;
    const history = Array.isArray(payload) ? payload : Array.isArray(payload.history) ? payload.history : Array.isArray(payload.deployments) ? payload.deployments : [];
    return history.slice(-25).reverse();
  }

  return [];
}

function getRuntimeFolders(environment = getRuntimeMode()) {
  const root = runtimePath(environment);
  const folders = ['guilds', 'logs', 'backups', 'data', 'cache', 'deployments'];
  return Object.fromEntries(folders.map((folder) => {
    const folderPath = path.join(root, folder);
    return [folder, { path: folderPath, exists: fs.existsSync(folderPath) }];
  }));
}

function getDiscordClient(req) {
  return req.client || req.app?.get?.('goliath.client') || req.app?.locals?.client || global.client || null;
}

function notifyDeployment(deployment = {}) {
  try {
    const environment = String(deployment.environment || getRuntimeMode()).toUpperCase();
    const sourceGuildId = process.env.OWNER_NOTIFICATION_GUILD_ID || process.env.PRIMARY_GUILD_ID || process.env.GUILD_ID || null;
    if (!sourceGuildId) return null;

    if (deployment.status === 'offline' || deployment.health === 'offline') {
      return notifications.addNotificationOnce(sourceGuildId, {
        level: 'danger',
        source: 'deployment',
        title: `${environment} deployment offline`,
        message: deployment.warnings?.[0] || deployment.error || `${environment} is unavailable.`,
        route: '/owner/deployments',
        metadata: { environment, status: deployment.status, health: deployment.health, port: deployment.port, commitSha: deployment.commitSha || null },
      }, { fingerprint: `deployment:offline:${environment}`, windowMs: 10 * 60_000 });
    }

    if (deployment.health === 'attention' || deployment.warnings?.length) {
      return notifications.addNotificationOnce(sourceGuildId, {
        level: 'warning',
        source: 'deployment',
        title: `${environment} deployment needs attention`,
        message: deployment.warnings?.[0] || 'Deployment health reported attention.',
        route: '/owner/deployments',
        metadata: { environment, status: deployment.status, health: deployment.health, branch: deployment.branch, commitSha: deployment.commitSha || null, warnings: deployment.warnings || [] },
      }, { fingerprint: `deployment:attention:${environment}:${deployment.warnings?.[0] || 'warning'}`, windowMs: 15 * 60_000 });
    }
  } catch (error) {
    console.warn('[OwnerDeployments] notification skipped:', error.message || error);
  }
  return null;
}

function buildLocalDeployment(req, environment = getRuntimeMode()) {
  const config = getEnvironmentConfig(environment);
  const client = getDiscordClient(req);
  const packageInfo = getPackageInfo();
  const commitSha = getGitCommitSha();
  const buildTime = getBuildTime();
  const folders = getRuntimeFolders(environment);
  const history = readDeploymentHistory(environment);
  const warnings = [];

  if (!commitSha) warnings.push('Commit SHA not exposed to runtime.');
  if (!buildTime) warnings.push('Build time not exposed to runtime.');
  if (!folders.guilds.exists) warnings.push('Runtime guild folder missing.');

  return {
    environment: config.environment,
    key: config.key,
    branch: getCurrentBranch(environment),
    expectedBranch: config.branch,
    port: Number(process.env.PORT || process.env.BOT_API_PORT || config.port),
    status: client?.isReady?.() ? 'online' : 'degraded',
    health: warnings.length ? 'attention' : 'healthy',
    version: packageInfo.version || 'unknown',
    packageName: packageInfo.name || 'goliath',
    commitSha,
    shortCommit: commitSha ? commitSha.slice(0, 7) : 'unknown',
    buildTime,
    nodeVersion: process.version,
    hostname: os.hostname(),
    process: {
      pid: process.pid,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    },
    discord: {
      ready: Boolean(client?.isReady?.()),
      ping: Number(client?.ws?.ping || 0),
      guilds: client?.guilds?.cache?.size || 0,
      user: client?.user?.tag || client?.user?.username || null,
    },
    runtimeFolders: folders,
    updateAvailable: false,
    restartControls: {
      available: false,
      reason: 'Restart controls are not enabled until a safe process supervisor adapter is configured.',
    },
    deploymentHistory: history,
    lastDeployment: history[0] || null,
    warnings,
    checkedAt: new Date().toISOString(),
  };
}

function summarise(environments = []) {
  return {
    total: environments.length,
    online: environments.filter((item) => item.status === 'online').length,
    degraded: environments.filter((item) => item.status === 'degraded').length,
    offline: environments.filter((item) => item.status === 'offline').length,
    attention: environments.filter((item) => item.health === 'attention' || item.warnings?.length).length,
    updateAvailable: environments.filter((item) => item.updateAvailable).length,
    history: environments.reduce((sum, item) => sum + (item.deploymentHistory?.length || 0), 0),
  };
}

async function fetchInternalDeployment(port, environment) {
  try {
    const token = String(process.env.OWNER_INTERNAL_TOKEN || '').trim();
    const response = await fetch(`http://127.0.0.1:${port}/api/owner/deployments/local`, {
      headers: {
        'Content-Type': 'application/json',
        'x-goliath-owner-token': token,
      },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    return { ...(payload.deployment || {}), environment, sourcePort: port };
  } catch (error) {
    return {
      environment,
      status: 'offline',
      health: 'offline',
      branch: getEnvironmentConfig(environment).branch,
      expectedBranch: getEnvironmentConfig(environment).branch,
      port,
      sourcePort: port,
      updateAvailable: false,
      restartControls: { available: false, reason: 'Environment unavailable.' },
      deploymentHistory: [],
      warnings: [error.message || 'Environment unavailable.'],
      checkedAt: new Date().toISOString(),
    };
  }
}

router.get('/local', requireOwnerOrInternal, (req, res) => {
  try {
    const deployment = buildLocalDeployment(req, getRuntimeMode());
    notifyDeployment(deployment);
    return res.json({ success: true, owner: true, deployment, deployments: [deployment], summary: summarise([deployment]), updatedAt: new Date().toISOString() });
  } catch (error) {
    console.error('[OWNER DEPLOYMENTS LOCAL]', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/', requireOwner, async (req, res) => {
  try {
    const requestedEnvironment = String(req.query.environment || 'all').toUpperCase();
    let deployments = await Promise.all(ENVIRONMENT_PORTS.map((item) => fetchInternalDeployment(item.port, item.environment)));
    if (requestedEnvironment !== 'ALL') deployments = deployments.filter((item) => String(item.environment || '').toUpperCase() === requestedEnvironment);
    deployments.forEach(notifyDeployment);
    return res.json({ success: true, owner: true, mode: 'GLOBAL', deployments, summary: summarise(deployments), updatedAt: new Date().toISOString() });
  } catch (error) {
    console.error('[OWNER DEPLOYMENTS]', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
