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
  const ob = await Onboarding.findOne({ user: userId });
  return res.json({ onboarding: ob });
};

exports.saveUserProfile = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: 'Invalid input', details: errors.array() });
  }
  const { fullName, role, builtPlanBefore, planningGoal, includePersonalPlanning, planningFor } = req.body;

  const userId = req.user?.id;
  if (!userId) {
    // No auth: return ephemeral structure (not persisted)
    return res.json({
      onboarding: {
        userProfile: {
          fullName,
          role,
          builtPlanBefore: ynToBool(builtPlanBefore),
          planningGoal,
          includePersonalPlanning: ynToBool(includePersonalPlanning),
          planningFor,
        },
      },
    });
  }

  const ob = await getOrCreate(userId);
  ob.userProfile = {
    fullName,
    role,
    builtPlanBefore: ynToBool(builtPlanBefore),
    planningGoal,
    includePersonalPlanning: ynToBool(includePersonalPlanning),
    planningFor,
  };
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
  ob.businessProfile = {
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
  };
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
  ob.vision = { ubp };
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
    return res.json({ answers });
  }
  const ob = await getOrCreate(userId);
  ob.answers = { ...(ob.answers || {}), ...(answers || {}) };
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
