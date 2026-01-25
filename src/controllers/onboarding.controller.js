const { validationResult } = require('express-validator');
const Onboarding = require('../models/Onboarding');
const User = require('../models/User');
const Workspace = require('../models/Workspace');
const SwotEntry = require('../models/SwotEntry');
const CoreProject = require('../models/CoreProject');
const crypto = require('crypto');
const { getWorkspaceFilter, getWorkspaceId, addWorkspaceToDoc } = require('../utils/workspaceQuery');
const { touchWorkspace } = require('../services/workspaceActivityService');
const { getWorkspaceFields } = require('../services/workspaceFieldService');

// Helper to save answers to Workspace.fields
async function saveAnswersToWorkspace(workspaceId, updates) {
  if (!workspaceId) return;
  const ws = await Workspace.findById(workspaceId);
  if (!ws) return;
  if (!ws.fields) ws.fields = new Map();

  for (const [key, value] of Object.entries(updates)) {
    ws.fields.set(key, value);
  }

  ws.markModified('fields');
  await ws.save();
}

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

// --- 1-Year Goals CRUD (stored in onboarding.answers.vision1y as newline-separated text) ---

function parseGoals(str) {
  return String(str || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

function joinGoals(arr) {
  const list = Array.isArray(arr) ? arr : [];
  return list.map((s) => String(s || '').trim()).filter(Boolean).join('\n');
}

// GET /api/onboarding/vision/destination/1y/goals
exports.getVision1yGoals = async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.json({ goals: [] });
  const workspaceId = getWorkspaceId(req);
  // Read from Workspace.fields
  const wsFields = await getWorkspaceFields(workspaceId);
  const goals = parseGoals(wsFields.vision1y);
  return res.json({ goals });
};

// POST /api/onboarding/vision/destination/1y/goals
// Body: { goal: string, index?: number }
exports.addVision1yGoal = async (req, res) => {
  const userId = req.user?.id;
  const text = String(req.body?.goal || '').trim();
  const indexRaw = req.body?.index;
  if (!text) return res.status(400).json({ message: 'Goal text is required' });
  if (!userId) {
    // Ephemeral add when unauthenticated
    return res.json({ goals: [text] });
  }
  const workspaceId = getWorkspaceId(req);
  // Read from Workspace.fields
  const wsFields = await getWorkspaceFields(workspaceId);
  const goals = parseGoals(wsFields.vision1y);
  const idx = Number(indexRaw);
  if (Number.isFinite(idx) && idx >= 0 && idx <= goals.length) goals.splice(idx, 0, text);
  else goals.push(text);
  const vision1y = joinGoals(goals);
  // Save to Workspace.fields
  await saveAnswersToWorkspace(workspaceId, { vision1y });
  if (workspaceId) touchWorkspace(workspaceId);
  return res.status(201).json({ goals });
};

// PATCH /api/onboarding/vision/destination/1y/goals/:index
// Body: { goal: string }
exports.updateVision1yGoal = async (req, res) => {
  const userId = req.user?.id;
  const index = Number(req.params?.index);
  const text = String(req.body?.goal || '').trim();
  if (!Number.isFinite(index) || index < 0) return res.status(400).json({ message: 'Valid index is required' });
  if (!text) return res.status(400).json({ message: 'Goal text is required' });
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });
  const workspaceId = getWorkspaceId(req);
  // Read from Workspace.fields
  const wsFields = await getWorkspaceFields(workspaceId);
  const goals = parseGoals(wsFields.vision1y);
  if (index >= goals.length) return res.status(404).json({ message: 'Goal not found' });
  goals[index] = text;
  const vision1y = joinGoals(goals);
  // Save to Workspace.fields
  await saveAnswersToWorkspace(workspaceId, { vision1y });
  if (workspaceId) touchWorkspace(workspaceId);
  return res.json({ goals });
};

// DELETE /api/onboarding/vision/destination/1y/goals/:index
exports.deleteVision1yGoal = async (req, res) => {
  const userId = req.user?.id;
  const index = Number(req.params?.index);
  if (!Number.isFinite(index) || index < 0) return res.status(400).json({ message: 'Valid index is required' });
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });
  const workspaceId = getWorkspaceId(req);
  // Read from Workspace.fields
  const wsFields = await getWorkspaceFields(workspaceId);
  const goals = parseGoals(wsFields.vision1y);
  if (index >= goals.length) return res.status(404).json({ message: 'Goal not found' });
  const next = goals.filter((_, i) => i !== index);
  const vision1y = joinGoals(next);
  // Save to Workspace.fields
  await saveAnswersToWorkspace(workspaceId, { vision1y });
  if (workspaceId) touchWorkspace(workspaceId);
  return res.json({ goals: next });
};
// Optional: save full onboarding answers snapshot
exports.saveAllAnswers = async (req, res) => {
  const userId = req.user?.id;
  const payload = req.body || {};
  const answers = payload.answers || payload; // allow raw payload
  if (!userId) {
    // No auth: return ephemeral; do NOT auto-link financials for Lite
    return res.json({ answers });
  }
  const workspaceId = getWorkspaceId(req);

  // [DATA TRACKING] Log incoming save request
  const incomingKeys = Object.keys(answers || {});
  console.log(`[saveAllAnswers] user=${userId} workspace=${workspaceId} incomingKeys=${incomingKeys.join(',')}`);

  // Read existing from Workspace.fields
  const existing = await getWorkspaceFields(workspaceId);
  const incoming = answers || {};
  const merged = { ...existing };
  const changes = []; // Track what's changing
  const potentialDataLoss = []; // Track potential data loss (non-empty -> empty)

  for (const [key, value] of Object.entries(incoming)) {
    const existingValue = existing[key];
    // Skip null/undefined
    if (value === null || value === undefined) continue;
    // For arrays: only skip if BOTH are empty (no-op). Allow empty if user intentionally cleared.
    if (Array.isArray(value) && value.length === 0) {
      const existingIsEmptyArray = !existingValue || (Array.isArray(existingValue) && existingValue.length === 0);
      if (existingIsEmptyArray) continue; // Both empty - skip (no change)
      // Existing has data, incoming is empty - POTENTIAL DATA LOSS
      const existingLen = Array.isArray(existingValue) ? existingValue.length : 0;
      potentialDataLoss.push({ key, existingLen, newLen: 0 });
    }
    // For objects: only skip if BOTH are empty
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) {
      const existingIsEmptyObj = !existingValue || (typeof existingValue === 'object' && !Array.isArray(existingValue) && Object.keys(existingValue).length === 0);
      if (existingIsEmptyObj) continue; // Both empty - skip (no change)
      // Existing has data, incoming is empty - POTENTIAL DATA LOSS
      const existingKeyCount = existingValue ? Object.keys(existingValue).length : 0;
      potentialDataLoss.push({ key, existingKeys: existingKeyCount, newKeys: 0 });
    }
    // Track the change
    if (JSON.stringify(existingValue) !== JSON.stringify(value)) {
      changes.push(key);
    }
    merged[key] = value;
  }

  // [DATA TRACKING] Log changes and potential data loss
  if (changes.length > 0) {
    console.log(`[saveAllAnswers] user=${userId} workspace=${workspaceId} changedKeys=${changes.join(',')}`);
  }
  if (potentialDataLoss.length > 0) {
    console.warn(`[saveAllAnswers] POTENTIAL DATA LOSS user=${userId} workspace=${workspaceId}`, JSON.stringify(potentialDataLoss));
  }

  // Auto-populate forecasting fields when products are present (Pro only)
  try {
    const ent = require('../config/entitlements');
    const user = await User.findById(userId).lean().exec();
    const allowAuto = ent.hasFeature(user, 'financialAutoLinkage');
    if (allowAuto) {
      const list = Array.isArray(merged.products) ? merged.products : [];
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
        if (totalVol > 0) merged.finSalesVolume = String(totalVol);
        if (avgCost > 0) merged.finAvgUnitCost = String(Math.round(avgCost));
        if (marginPct > 0) merged.finTargetProfitMarginPct = String(marginPct);
      }
    }
  } catch {}

  // Save to Workspace.fields
  await saveAnswersToWorkspace(workspaceId, merged);
  // Update workspace lastActivityAt
  if (workspaceId) touchWorkspace(workspaceId);
  return res.json({ ok: true, answers: merged });
};

// Optional: get full onboarding answers snapshot
exports.getAllAnswers = async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.json({ answers: null });
  const workspaceId = getWorkspaceId(req);
  const wsFilter = getWorkspaceFilter(req);

  // Read from Workspace.fields instead of Onboarding.answers
  const wsFields = await getWorkspaceFields(workspaceId);
  const answers = { ...wsFields };

  // Map 'bhag' field to 'visionBhag' for frontend compatibility
  if (answers.bhag && !answers.visionBhag) {
    answers.visionBhag = answers.bhag;
  }

  // Map market fields to frontend-expected names
  if (answers.targetMarket && !answers.custType) {
    answers.custType = answers.targetMarket;
  }
  if (answers.targetCustomer && !answers.marketCustomer) {
    answers.marketCustomer = answers.targetCustomer;
  }
  if (answers.partners && !answers.partnersDesc) {
    answers.partnersDesc = answers.partners;
  }
  if (answers.competitorsNotes && !answers.compNotes) {
    answers.compNotes = answers.competitorsNotes;
  }

  // Enrich with SWOT data from SwotEntry collection
  try {
    const swotEntries = await SwotEntry.find({ ...wsFilter, isDeleted: false }).sort({ order: 1 }).lean();
    const swotByType = { strength: [], weakness: [], opportunity: [], threat: [] };
    swotEntries.forEach((e) => {
      if (swotByType[e.entryType]) {
        swotByType[e.entryType].push(e.text);
      }
    });
    if (swotByType.strength.length && !answers.swotStrengths) {
      answers.swotStrengths = swotByType.strength.join('\n');
    }
    if (swotByType.weakness.length && !answers.swotWeaknesses) {
      answers.swotWeaknesses = swotByType.weakness.join('\n');
    }
    if (swotByType.opportunity.length && !answers.swotOpportunities) {
      answers.swotOpportunities = swotByType.opportunity.join('\n');
    }
    if (swotByType.threat.length && !answers.swotThreats) {
      answers.swotThreats = swotByType.threat.join('\n');
    }
  } catch (e) {
    console.error('[getAllAnswers] Failed to fetch SwotEntry:', e.message);
  }

  // Enrich with OrgPosition data from OrgPosition collection
  try {
    const OrgPosition = require('../models/OrgPosition');
    const orgPositions = await OrgPosition.find({ ...wsFilter, isDeleted: false }).sort({ order: 1 }).lean();
    if (orgPositions.length > 0 && (!answers.orgPositions || answers.orgPositions.length === 0)) {
      answers.orgPositions = orgPositions.map(p => ({
        id: p._id,
        position: p.position,
        name: p.name,
        department: p.department,
        parentPosition: p.parentId,
      }));
    }
  } catch (e) {
    console.error('[getAllAnswers] Failed to fetch OrgPosition:', e.message);
  }

  // Check CoreProject count from new model
  let coreProjectsCount = 0;
  try {
    coreProjectsCount = await CoreProject.countDocuments({ ...wsFilter, isDeleted: false });
  } catch (e) {
    console.error('[getAllAnswers] Failed to count CoreProject:', e.message);
  }

  // [DATA TRACKING] Log data fetch with summary
  const answerKeys = answers ? Object.keys(answers) : [];
  const hasProducts = answers?.products?.length > 0;
  const hasCoreProjects = coreProjectsCount > 0;
  const hasUbp = !!answers?.ubp;
  console.log(`[getAllAnswers] user=${userId} workspace=${workspaceId} found=${!!ob} keys=${answerKeys.length} hasUbp=${hasUbp} hasProducts=${hasProducts} hasCoreProjects=${hasCoreProjects} coreProjectsCount=${coreProjectsCount}`);

  return res.json({ answers });
};
