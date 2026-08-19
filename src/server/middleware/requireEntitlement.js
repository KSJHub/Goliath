'use strict';

const entitlementManager = require('../../core/billing/entitlementManager');
const { getRequiredPlanForFeature } = require('../../config/plans');

function resolveGuildId(req) {
  return String(
    req.params?.guildId ||
    req.body?.guildId ||
    req.query?.guildId ||
    ''
  ).replace(/\D/g, '');
}

function requireEntitlement(featureKey) {
  return (req, res, next) => {
    try {
      const guildId = resolveGuildId(req);
      if (!guildId || guildId.length < 15) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_GUILD_ID',
          error: 'Invalid guild ID.',
        });
      }

      if (entitlementManager.canUseFeature(guildId, featureKey)) return next();

      const requiredPlan = getRequiredPlanForFeature(featureKey);

      return res.status(403).json({
        success: false,
        code: 'FEATURE_LOCKED',
        featureKey,
        currentPlan: entitlementManager.getPlan(guildId),
        requiredPlan: requiredPlan?.id || 'pro',
        requiredPlanName: requiredPlan?.name || 'Pro',
        error: `This feature requires Goliath ${requiredPlan?.name || 'Pro'}.`,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        code: 'ENTITLEMENT_CHECK_FAILED',
        error: error.message || 'Failed to check feature entitlement.',
      });
    }
  };
}

module.exports = {
  requireEntitlement,
};
