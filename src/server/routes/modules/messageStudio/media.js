'use strict';

const express = require('express');

const mediaTools = require('../../../../core/mediaTools/mediaService');
const entitlementManager = require('../../../../core/billing/entitlementManager');
const { FEATURE_KEYS } = require('../../../../config/plans');

const router = express.Router();

function success(res, payload = {}) {
  return res.json({ success: true, ...payload });
}

function failure(res, error, status = 500) {
  console.error('[Media API]', error);

  if (error?.code === 'FEATURE_LOCKED') {
    return res.status(403).json({
      success: false,
      code: error.code,
      error: error.message,
      featureKey: error.featureKey,
      requiredPlan: error.requiredPlan,
      currentPlan: error.currentPlan,
      upgradeHint: 'Upgrade to Goliath Plus or higher to unlock Media Tools.',
    });
  }

  return res.status(status).json({
    success: false,
    error: error.message || 'Media API request failed.',
  });
}

function getGuildId(req) {
  const guildId = String(req.params.guildId || req.body?.guildId || '').trim();
  if (!/^\d{15,25}$/.test(guildId)) throw new Error('Invalid guild ID.');
  return guildId;
}

function requireMediaTools(req) {
  const guildId = getGuildId(req);
  entitlementManager.requireFeature(guildId, FEATURE_KEYS.MEDIA_TOOLS);
  return guildId;
}

router.get('/:guildId/entitlements', (req, res) => {
  try {
    const guildId = getGuildId(req);
    return success(res, {
      featureKey: FEATURE_KEYS.MEDIA_TOOLS,
      unlocked: entitlementManager.canUseFeature(guildId, FEATURE_KEYS.MEDIA_TOOLS),
      entitlements: entitlementManager.getEntitlementSummary(guildId),
    });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.get('/:guildId/status', async (req, res) => {
  try {
    const guildId = requireMediaTools(req);
    const status = await mediaTools.getMediaToolsStatus(guildId);
    return success(res, { status });
  } catch (error) {
    return failure(res, error, error?.code === 'FEATURE_LOCKED' ? 403 : 400);
  }
});

router.get('/:guildId/library', (req, res) => {
  try {
    return success(res, { assets: mediaTools.listMediaAssets(requireMediaTools(req)) });
  } catch (error) {
    return failure(res, error, error?.code === 'FEATURE_LOCKED' ? 403 : 400);
  }
});

router.post('/:guildId/:tool/create', async (req, res) => {
  try {
    const guildId = requireMediaTools(req);
    const tool = String(req.params.tool || '').trim();
    const result = await mediaTools.createMediaAsset(guildId, tool, req.body || {});
    return success(res, result);
  } catch (error) {
    return failure(res, error, error?.code === 'FEATURE_LOCKED' ? 403 : 400);
  }
});

router.delete('/:guildId/assets/:assetId', (req, res) => {
  try {
    const result = mediaTools.deleteMediaAsset(requireMediaTools(req), req.params.assetId);
    return success(res, result);
  } catch (error) {
    return failure(res, error, error?.code === 'FEATURE_LOCKED' ? 403 : 400);
  }
});

router.get('/:guildId/assets/:assetId/download', (req, res) => {
  try {
    const asset = mediaTools.resolveAssetDownload(requireMediaTools(req), req.params.assetId);
    return res.download(asset.path, asset.filename);
  } catch (error) {
    return failure(res, error, error?.code === 'FEATURE_LOCKED' ? 403 : 404);
  }
});

module.exports = router;
