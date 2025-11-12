const { validationResult } = require('express-validator');
const Onboarding = require('../models/Onboarding');
const User = require('../models/User');

function ynToBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const val = v.trim().toLowerCase();
    if (val === 'yes') return true;
    if (val === 'no') return false;
  }
  return undefined;
}

async function getOrCreate(userId) {
  let ob = await Onboarding.findOne({ user: userId });
  if (!ob) ob = await Onboarding.create({ user: userId });
  return ob;
}

exports.get = async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.json({ onboarding: null });
  }
  const [ob, user] = await Promise.all([
    Onboarding.findOne({ user: userId }),
    User.findById(userId),
  ]);
  if (!ob) {
    // Return an ephemeral structure seeded with companyName if available
    const businessName = (user && user.companyName) ? user.companyName : undefined;
    return res.json({ onboarding: businessName ? { businessProfile: { businessName } } : null });
  }
  // If businessName missing, include a non-persistent fallback from user.companyName
  const out = ob.toObject({ getters: true, virtuals: false });
  if (!out.businessProfile) out.businessProfile = {};
  if (!out.businessProfile.businessName && user && user.companyName) {
    out.businessProfile.businessName = user.companyName;
  }
  return res.json({ onboarding: out });
};

exports.saveUserProfile = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: 'Invalid input', details: errors.array() });
  }
  const { fullName, role, roleOther, builtPlanBefore, planningGoal, planningGoalOther, includePersonalPlanning, planningFor } = req.body;

  const userId = req.user?.id;
  if (!userId) {
    // No auth: return ephemeral structure (not persisted)
    return res.json({
      onboarding: {
        userProfile: {
          fullName,
          role,
          roleOther,
          builtPlanBefore: ynToBool(builtPlanBefore),
          planningGoal,
          planningGoalOther,
          includePersonalPlanning: ynToBool(includePersonalPlanning),
          planningFor,
        },
      },
    });
  }

  const ob = await getOrCreate(userId);
  // Patch only provided fields; do not clear others
  const up = ob.userProfile || {};
  if (Object.prototype.hasOwnProperty.call(req.body, 'fullName')) up.fullName = fullName;
  if (Object.prototype.hasOwnProperty.call(req.body, 'role')) up.role = role;
  if (Object.prototype.hasOwnProperty.call(req.body, 'roleOther')) up.roleOther = roleOther;
  if (Object.prototype.hasOwnProperty.call(req.body, 'builtPlanBefore')) up.builtPlanBefore = ynToBool(builtPlanBefore);
  if (Object.prototype.hasOwnProperty.call(req.body, 'planningGoal')) up.planningGoal = planningGoal;
  if (Object.prototype.hasOwnProperty.call(req.body, 'planningGoalOther')) up.planningGoalOther = planningGoalOther;
  if (Object.prototype.hasOwnProperty.call(req.body, 'includePersonalPlanning')) up.includePersonalPlanning = ynToBool(includePersonalPlanning);
  if (Object.prototype.hasOwnProperty.call(req.body, 'planningFor')) up.planningFor = planningFor;
  ob.userProfile = up;
  await ob.save();

  // Optionally sync fullName onto User
  if (fullName) {
    await User.findByIdAndUpdate(userId, { fullName });
  }

  return res.json({ onboarding: ob });
};

exports.saveBusinessProfile = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: 'Invalid input', details: errors.array() });
  }
  const {
    businessName,
    businessStage,
    industry,
    industryOther,
    country,
    city,
    ventureType,
    teamSize,
    funding,
    tools,
    connectTools,
    description,
  } = req.body;

  const userId = req.user?.id;
  if (!userId) {
    return res.json({
      onboarding: {
        businessProfile: {
          businessName,
          businessStage,
          industry,
          industryOther,
          country,
          city,
          ventureType,
          teamSize,
          funding: ynToBool(funding),
          tools: Array.isArray(tools) ? tools : [],
          connectTools: ynToBool(connectTools),
          description,
      },
      },
    });
  }

  const ob = await getOrCreate(userId);
  // Progression enforcement: require user profile to be completed first
  if (!ob.userProfile || (!ob.userProfile.role && !ob.userProfile.planningGoal && !ob.userProfile.fullName)) {
    return res.status(409).json({ message: 'Complete the user profile step before business profile.' });
  }
  // Patch only provided business fields; do not clear others
  const bp = ob.businessProfile || {};
  if (Object.prototype.hasOwnProperty.call(req.body, 'businessName')) bp.businessName = businessName;
  if (Object.prototype.hasOwnProperty.call(req.body, 'businessStage')) bp.businessStage = businessStage;
  if (Object.prototype.hasOwnProperty.call(req.body, 'industry')) bp.industry = industry;
  if (Object.prototype.hasOwnProperty.call(req.body, 'industryOther')) bp.industryOther = industryOther;
  if (Object.prototype.hasOwnProperty.call(req.body, 'country')) bp.country = country;
  if (Object.prototype.hasOwnProperty.call(req.body, 'city')) bp.city = city;
  if (Object.prototype.hasOwnProperty.call(req.body, 'ventureType')) bp.ventureType = ventureType;
  if (Object.prototype.hasOwnProperty.call(req.body, 'teamSize')) bp.teamSize = teamSize;
  if (Object.prototype.hasOwnProperty.call(req.body, 'funding')) bp.funding = ynToBool(funding);
  if (Object.prototype.hasOwnProperty.call(req.body, 'tools')) bp.tools = Array.isArray(tools) ? tools : [];
  if (Object.prototype.hasOwnProperty.call(req.body, 'connectTools')) bp.connectTools = ynToBool(connectTools);
  if (Object.prototype.hasOwnProperty.call(req.body, 'description')) bp.description = description;
  ob.businessProfile = bp;
  await ob.save();
  return res.json({ onboarding: ob });
};

exports.saveVision = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: 'Invalid input', details: errors.array() });
  }
  const { ubp } = req.body;
  const userId = req.user?.id;
  if (!userId) {
    return res.json({ onboarding: { vision: { ubp } } });
  }
  const ob = await getOrCreate(userId);
  // Progression enforcement: require business profile to be completed first
  if (!ob.businessProfile || (!ob.businessProfile.businessName && !ob.businessProfile.ventureType && !ob.businessProfile.industry)) {
    return res.status(409).json({ message: 'Complete the business profile step before vision & purpose.' });
  }
  // Patch only provided vision fields
  const vv = ob.vision || {};
  if (Object.prototype.hasOwnProperty.call(req.body, 'ubp')) vv.ubp = ubp;
  ob.vision = vv;
  await ob.save();
  return res.json({ onboarding: ob });
};

// Optional: save full onboarding answers snapshot
exports.saveAllAnswers = async (req, res) => {
  const userId = req.user?.id;
  const payload = req.body || {};
  const answers = payload.answers || payload; // allow raw payload
  if (!userId) {
    // No auth: return ephemeral
    // Compute derived forecasting fields if products present
    try {
      if (answers && Array.isArray(answers.products)) {
        const nums = answers.products.map((p) => {
          const v = parseFloat(String(p?.monthlyVolume || '').replace(/[^0-9.]/g, '')) || 0;
          const price = parseFloat(String((p?.price ?? p?.pricing) || '').replace(/[^0-9.]/g, '')) || 0;
          const cost = parseFloat(String(p?.unitCost || '').replace(/[^0-9.]/g, '')) || 0;
          return { v, price, cost };
        });
        const totalVol = nums.reduce((sum, r) => sum + (r.v || 0), 0);
        const totalW = nums.reduce((sum, r) => sum + (r.v || 0), 0);
        const sumPrice = nums.reduce((sum, r) => sum + ((r.price || 0) * (r.v || 0)), 0);
        const sumCost = nums.reduce((sum, r) => sum + ((r.cost || 0) * (r.v || 0)), 0);
        const avgCost = totalW ? (sumCost / totalW) : 0;
        const avgPrice = totalW ? (sumPrice / totalW) : 0;
        const marginPct = avgPrice > 0 ? Math.max(0, Math.round(((avgPrice - avgCost) / avgPrice) * 100)) : 0;
        if (totalVol > 0) answers.finSalesVolume = String(totalVol);
        if (avgCost > 0) answers.finAvgUnitCost = String(Math.round(avgCost));
        if (marginPct > 0) answers.finTargetProfitMarginPct = String(marginPct);
      }
    } catch {}
    return res.json({ answers });
  }
  const ob = await getOrCreate(userId);
  ob.answers = { ...(ob.answers || {}), ...(answers || {}) };
  // Auto-populate forecasting fields in DB when products are present
  try {
    const a = ob.answers || {};
    const list = Array.isArray(a.products) ? a.products : [];
    if (list.length) {
      const nums = list.map((p) => {
        const v = parseFloat(String(p?.monthlyVolume || '').replace(/[^0-9.]/g, '')) || 0;
        const price = parseFloat(String((p?.price ?? p?.pricing) || '').replace(/[^0-9.]/g, '')) || 0;
        const cost = parseFloat(String(p?.unitCost || '').replace(/[^0-9.]/g, '')) || 0;
        return { v, price, cost };
      });
      const totalVol = nums.reduce((sum, r) => sum + (r.v || 0), 0);
      const totalW = nums.reduce((sum, r) => sum + (r.v || 0), 0);
      const sumPrice = nums.reduce((sum, r) => sum + ((r.price || 0) * (r.v || 0)), 0);
      const sumCost = nums.reduce((sum, r) => sum + ((r.cost || 0) * (r.v || 0)), 0);
      const avgCost = totalW ? (sumCost / totalW) : 0;
      const avgPrice = totalW ? (sumPrice / totalW) : 0;
      const marginPct = avgPrice > 0 ? Math.max(0, Math.round(((avgPrice - avgCost) / avgPrice) * 100)) : 0;
      if (totalVol > 0) ob.answers.finSalesVolume = String(totalVol);
      if (avgCost > 0) ob.answers.finAvgUnitCost = String(Math.round(avgCost));
      if (marginPct > 0) ob.answers.finTargetProfitMarginPct = String(marginPct);
    }
  } catch {}
  await ob.save();
  return res.json({ ok: true, answers: ob.answers });
};

// Optional: get full onboarding answers snapshot
exports.getAllAnswers = async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.json({ answers: null });
  const ob = await Onboarding.findOne({ user: userId });
  return res.json({ answers: ob?.answers || null });
};
