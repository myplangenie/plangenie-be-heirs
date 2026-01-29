const { validationResult } = require('express-validator');
const Onboarding = require('../models/Onboarding');
const User = require('../models/User');
const Workspace = require('../models/Workspace');
const crypto = require('crypto');
const { getWorkspaceFilter, getWorkspaceId } = require('../utils/workspaceQuery');
const { touchWorkspace } = require('../services/workspaceActivityService');

function ynToBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const val = v.trim().toLowerCase();
    if (val === 'yes') return true;
    if (val === 'no') return false;
  }
  return undefined;
}

// Workspace-aware getOrCreate for onboarding
async function getOrCreate(userId, workspaceId = null) {
  // If no workspaceId provided, get or create default workspace
  let wsId = workspaceId;
  if (!wsId) {
    let defaultWs = await Workspace.findOne({ user: userId, defaultWorkspace: true });
    if (!defaultWs) {
      // Auto-create default workspace
      const wid = `ws_${crypto.randomBytes(6).toString('hex')}`;
      defaultWs = await Workspace.create({
        user: userId,
        wid,
        name: 'My Business',
        defaultWorkspace: true,
      });
    }
    wsId = defaultWs._id;
  }

  // Always include workspace in filter
  const filter = { user: userId, workspace: wsId };
  let ob = await Onboarding.findOne(filter);
  if (!ob) {
    const createData = { user: userId, workspace: wsId };
    ob = await Onboarding.create(createData);
  }
  return ob;
}

exports.get = async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.json({ onboarding: null });
  }
  const wsFilter = getWorkspaceFilter(req);
  const [ob, user] = await Promise.all([
    Onboarding.findOne(wsFilter),
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
  // Backward-compat: map legacy 'personal' to 'organization' in responses
  if (out.userProfile && out.userProfile.planningFor === 'personal') {
    out.userProfile.planningFor = 'organization';
  }
  return res.json({ onboarding: out });
};

exports.saveUserProfile = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: 'Invalid input', details: errors.array() });
  }
  const { fullName, role, roleOther, builtPlanBefore, planningGoal, planningGoalOther, includePersonalPlanning } = req.body;
  // Normalize legacy client values
  const planningForRaw = req.body.planningFor;
  const planningFor = planningForRaw === 'personal' ? 'organization' : planningForRaw;

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

  const workspaceId = getWorkspaceId(req);
  const ob = await getOrCreate(userId, workspaceId);
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
  // Update workspace lastActivityAt
  if (ob.workspace) touchWorkspace(ob.workspace);

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

  const workspaceId = getWorkspaceId(req);
  const ob = await getOrCreate(userId, workspaceId);
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

  // Sync workspace with business name (create if doesn't exist, update if it does)
  if (businessName) {
    try {
      const enableWorkspaces = String(process.env.FEATURE_WORKSPACES || process.env.FEATURE_JOURNEYS || '').toLowerCase() === 'true';
      if (enableWorkspaces) {
        let workspace = await Workspace.findOne({ user: userId, defaultWorkspace: true });
        if (!workspace) {
          // Create default workspace with business name
          const wid = `ws_${crypto.randomBytes(6).toString('hex')}`;
          workspace = await Workspace.create({
            user: userId,
            wid,
            name: businessName,
            defaultWorkspace: true,
          });
        } else if (workspace.name !== businessName) {
          // Update workspace name to match business name
          workspace.name = businessName;
          await workspace.save();
        }
        // Link onboarding to workspace if not already linked
        if (!ob.workspace) {
          ob.workspace = workspace._id;
          await ob.save();
        }
      }
    } catch (wsErr) {
      console.error('[onboarding] Failed to sync workspace:', wsErr?.message || wsErr);
    }
  }
  // Update workspace lastActivityAt
  if (ob.workspace) touchWorkspace(ob.workspace);

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
  const workspaceId = getWorkspaceId(req);
  const ob = await getOrCreate(userId, workspaceId);
  // Progression enforcement: require business profile to be completed first
  if (!ob.businessProfile || (!ob.businessProfile.businessName && !ob.businessProfile.ventureType && !ob.businessProfile.industry)) {
    return res.status(409).json({ message: 'Complete the business profile step before vision & purpose.' });
  }
  // Patch only provided vision fields
  const vv = ob.vision || {};
  if (Object.prototype.hasOwnProperty.call(req.body, 'ubp')) vv.ubp = ubp;
  ob.vision = vv;
  await ob.save();
  // Update workspace lastActivityAt
  if (ob.workspace) touchWorkspace(ob.workspace);
  return res.json({ onboarding: ob });
};

// REMOVED: Legacy 1-Year Goals CRUD that used Workspace.fields
// Use /api/vision-goals instead (VisionGoal model)

// REMOVED: Legacy getAllAnswers and saveAllAnswers endpoints
// Use individual CRUD APIs instead:
// - /api/workspace-fields (for simple text fields like ubp, purpose, values)
// - /api/competitors (Competitor model)
// - /api/swot (SwotEntry model)
// - /api/vision-goals (VisionGoal model)
// - /api/products (Product model)
// - /api/org-positions (OrgPosition model)
