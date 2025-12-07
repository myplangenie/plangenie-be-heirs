const User = require('../models/User');
const { effectivePlan, plans, hasFeature: hasFeat, getLimit: getLim } = require('../config/entitlements');

async function loadUser(req) {
  const id = req.user && req.user.id;
  if (!id) return null;
  try { return await User.findById(id).lean().exec(); } catch (_) { return null; }
}

function upgradeRequiredRes(res, feature, planSlug) {
  const upgradeTo = 'pro';
  const planName = plans[planSlug]?.name || planSlug;
  return res.status(402).json({ code: 'UPGRADE_REQUIRED', message: 'This feature requires Plan Genie Pro', feature, plan: planSlug, planName, upgradeTo });
}

function requireFeature(feature) {
  return async function (req, res, next) {
    const user = await loadUser(req);
    const plan = effectivePlan(user);
    const ok = hasFeat(user, feature);
    if (ok) return next();
    return upgradeRequiredRes(res, feature, plan);
  };
}

function enforceLimit(limitKey, getCount) {
  return async function (req, res, next) {
    const user = await loadUser(req);
    const plan = effectivePlan(user);
    const limit = getLim(user, limitKey);
    try {
      const count = await Promise.resolve(getCount(req));
      if (typeof count === 'number' && count > limit) {
        return res.status(402).json({ code: 'LIMIT_EXCEEDED', message: `Limit exceeded for ${limitKey}`, plan, limit, limitKey, upgradeTo: 'pro' });
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { requireFeature, enforceLimit };
