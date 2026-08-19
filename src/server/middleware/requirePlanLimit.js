'use strict';

const planLimitManager = require('../../core/billing/planLimitManager');

function countFromRequest(req, counter) {
  if (typeof counter === 'function') return counter(req);
  return Number(req.body?.currentCount ?? req.query?.currentCount ?? 0);
}

function requirePlanLimit(limitKey, counter, options = {}) {
  return (req, res, next) => {
    try {
      const guildId = String(req.params?.guildId || req.body?.guildId || req.query?.guildId || '').trim();
      if (!/^\d{15,25}$/.test(guildId)) {
        return res.status(400).json({ success: false, code: 'INVALID_GUILD_ID', error: 'Invalid guild ID.' });
      }

      const currentCount = countFromRequest(req, counter);
      const check = planLimitManager.assertCanCreateResource(guildId, limitKey, currentCount, options);
      req.planLimit = check;
      return next();
    } catch (error) {
      if (error?.code === 'PLAN_LIMIT_REACHED') {
        return res.status(403).json({
          success: false,
          code: error.code,
          error: error.message,
          limitKey: error.limitKey,
          label: error.label,
          currentPlan: error.currentPlan,
          currentPlanName: error.currentPlanName,
          currentCount: error.currentCount,
          limit: error.limit,
          remaining: error.remaining,
          upgradeHint: error.upgradeHint,
        });
      }

      return res.status(500).json({
        success: false,
        code: 'PLAN_LIMIT_CHECK_FAILED',
        error: error.message || 'Plan limit check failed.',
      });
    }
  };
}

module.exports = {
  requirePlanLimit,
};
