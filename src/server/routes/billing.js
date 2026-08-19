'use strict';

const express = require('express');

const {
  PLAN_DEFINITIONS,
  getPlanDefinition,
} = require('../../config/plans');
const security = require('../../core/security/securityCore');
const subscriptionManager = require('../../core/billing/subscriptionManager');
const entitlementManager = require('../../core/billing/entitlementManager');
const redemptionManager = require('../../core/billing/redemptionManager');
const subscriptionAdminManager = require('../../core/billing/subscriptionAdminManager');
const billingSettingsManager = require('../../core/billing/billingSettingsManager');

const router = express.Router();

function success(res, payload = {}) {
  return res.json({ success: true, ...payload });
}

function failure(res, error, status = 500) {
  console.error('[Billing API]', error);

  return res.status(status).json({
    success: false,
    error: error.message || 'Billing API request failed.',
  });
}

function getGuildId(req) {
  const guildId = String(req.params.guildId || '').trim();
  if (!/^\d{15,25}$/.test(guildId)) {
    throw new Error('Invalid guild ID.');
  }
  return guildId;
}

function isOwnerRequest(req) {
  return security.isBotOwner(req.session?.user?.id);
}

function requireOwner(req, res, next) {
  const userId = req.session?.user?.id;
  if (!userId) {
    return res.status(401).json({ success: false, error: 'Not authenticated.' });
  }

  if (!security.isBotOwner(userId)) {
    return res.status(403).json({ success: false, error: 'Owner access required.' });
  }

  return next();
}

function actor(req) {
  return req.session?.user?.id || 'owner';
}

function publicPlan(plan, settings = billingSettingsManager.getBillingSettings()) {
  return {
    id: plan.id,
    name: plan.name,
    icon: plan.icon,
    public: plan.public !== false,
    rank: plan.rank,
    features: [...(plan.features || [])],
    limits: { ...(plan.limits || {}) },
    pricing: { ...(settings.pricing?.[plan.id] || {}) },
  };
}

function shouldExposePlan(plan, settings, ownerView = false) {
  if (plan.public !== false) return true;
  if (plan.id === 'lifetime') return settings.publicLifetimeEnabled === true || ownerView;
  return ownerView;
}

router.get('/plans', (req, res) => {
  try {
    const settings = billingSettingsManager.getBillingSettings();
    const ownerView = isOwnerRequest(req) && req.query?.owner === 'true';
    const plans = Object.values(PLAN_DEFINITIONS)
      .filter((plan) => shouldExposePlan(plan, settings, ownerView))
      .map((plan) => publicPlan(plan, settings));

    return success(res, {
      plans,
      settings: {
        publicLifetimeEnabled: settings.publicLifetimeEnabled,
        pricing: settings.pricing,
      },
    });
  } catch (error) {
    return failure(res, error, 500);
  }
});

router.get('/settings', requireOwner, (req, res) => {
  try {
    return success(res, { settings: billingSettingsManager.getBillingSettings() });
  } catch (error) {
    return failure(res, error, 500);
  }
});

router.patch('/settings', requireOwner, (req, res) => {
  try {
    const updates = {
      pricing: req.body?.pricing || {},
    };
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'publicLifetimeEnabled')) {
      updates.publicLifetimeEnabled = req.body.publicLifetimeEnabled === true;
    }

    const settings = billingSettingsManager.updateBillingSettings(updates, actor(req));

    return success(res, { settings });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.get('/subscription/:guildId', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const settings = billingSettingsManager.getBillingSettings();
    const subscription = subscriptionManager.getSubscription(guildId);
    const plan = publicPlan(getPlanDefinition(subscription.plan), settings);

    return success(res, {
      guildId,
      subscription,
      plan,
    });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.get('/entitlements/:guildId', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const settings = billingSettingsManager.getBillingSettings();
    const summary = entitlementManager.getEntitlementSummary(guildId);

    return success(res, {
      guildId,
      ...summary,
      plan: publicPlan(summary.plan, settings),
    });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.post('/redeem/:guildId', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const result = redemptionManager.redeemCode(
      guildId,
      req.body?.code,
      req.session?.user?.id || 'dashboard',
    );

    return success(res, {
      guildId,
      code: result.code,
      subscription: result.subscription,
      entitlements: entitlementManager.getEntitlementSummary(guildId),
    });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.get('/codes', requireOwner, (req, res) => {
  try {
    return success(res, { codes: redemptionManager.listCodes() });
  } catch (error) {
    return failure(res, error, 500);
  }
});

router.post('/codes/generate', requireOwner, (req, res) => {
  try {
    const codes = redemptionManager.generateCodes({
      plan: req.body?.plan,
      duration: req.body?.duration,
      quantity: req.body?.quantity,
      createdBy: actor(req),
    });

    return success(res, { codes });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.post('/codes/:code/revoke', requireOwner, (req, res) => {
  try {
    const code = redemptionManager.revokeCode(req.params.code, actor(req));
    return success(res, { code });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.get('/subscriptions', requireOwner, (req, res) => {
  try {
    return success(res, {
      subscriptions: subscriptionAdminManager.listSubscriptions(),
      history: subscriptionAdminManager.listHistory(100),
    });
  } catch (error) {
    return failure(res, error, 500);
  }
});

router.post('/subscriptions/grant', requireOwner, (req, res) => {
  try {
    const subscription = subscriptionAdminManager.grantSubscription({
      guildId: req.body?.guildId,
      plan: req.body?.plan,
      duration: req.body?.duration,
      actor: actor(req),
    });

    return success(res, {
      guildId: req.body?.guildId,
      subscription,
      entitlements: entitlementManager.getEntitlementSummary(req.body?.guildId),
    });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.post('/subscriptions/extend', requireOwner, (req, res) => {
  try {
    const subscription = subscriptionAdminManager.extendSubscription({
      guildId: req.body?.guildId,
      duration: req.body?.duration,
      actor: actor(req),
    });

    return success(res, {
      guildId: req.body?.guildId,
      subscription,
      entitlements: entitlementManager.getEntitlementSummary(req.body?.guildId),
    });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.post('/subscriptions/remove', requireOwner, (req, res) => {
  try {
    const subscription = subscriptionAdminManager.removeSubscription({
      guildId: req.body?.guildId,
      actor: actor(req),
    });

    return success(res, {
      guildId: req.body?.guildId,
      subscription,
      entitlements: entitlementManager.getEntitlementSummary(req.body?.guildId),
    });
  } catch (error) {
    return failure(res, error, 400);
  }
});

module.exports = router;
