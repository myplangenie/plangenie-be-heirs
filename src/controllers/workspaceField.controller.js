const Onboarding = require('../models/Onboarding');
const Workspace = require('../models/Workspace');
const { getWorkspaceFilter, getWorkspaceId } = require('../utils/workspaceQuery');
const { touchWorkspace } = require('../services/workspaceActivityService');
const crypto = require('crypto');

// Allowed single-value fields that can be updated individually
const ALLOWED_FIELDS = [
  // Vision & Purpose
  'ubp',
  'purpose',
  'bhag',
  'visionStatement',
  'missionStatement',
  'identitySummary',
  // Goals (newline-separated text)
  'vision1y',
  'vision3y',
  // Values & Culture
  'valuesCore',
  'valuesCoreKeywords',
  'cultureFeeling',
  // Market
  'targetMarket',
  'targetCustomer',
  'partners',
  'partnersYN',
  'competitorsNotes',
  // Financial
  'finSalesVolume',
  'finSalesGrowthPct',
  'finAvgUnitCost',
  'finFixedOperatingCosts',
  'finMarketingSalesSpend',
  'finPayrollCost',
  'finStartingCash',
  'finAdditionalFundingAmount',
  'finAdditionalFundingMonth',
  'finPaymentCollectionDays',
  'finTargetProfitMarginPct',
  'finMonthlyRevenue',
  'finRevenueGrowthPct',
  'finIsRecurring',
  'finRecurringPct',
  'finMonthlyCosts',
  'finFixedCosts',
  'finVariableCostsPct',
  'finBiggestCostCategory',
  'finCurrentCash',
  'finExpectedFunding',
  'finFundingMonth',
  'finFundingYear',
  // Forecast
  'financialForecast',
];

// Workspace-aware getOrCreate for onboarding
async function getOrCreate(userId, workspaceId = null) {
  let wsId = workspaceId;
  if (!wsId) {
    let defaultWs = await Workspace.findOne({ user: userId, defaultWorkspace: true });
    if (!defaultWs) {
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

  const filter = { user: userId, workspace: wsId };
  let ob = await Onboarding.findOne(filter);
  if (!ob) {
    ob = await Onboarding.create({ user: userId, workspace: wsId });
  }
  return ob;
}

/**
 * Get a single field value
 * GET /api/workspace-fields/:fieldName
 */
exports.getField = async (req, res, next) => {
  try {
    const { fieldName } = req.params;

    if (!ALLOWED_FIELDS.includes(fieldName)) {
      return res.status(400).json({ message: `Field '${fieldName}' is not allowed` });
    }

    const userId = req.user?.id;
    if (!userId) {
      return res.json({ field: fieldName, value: null });
    }

    const wsFilter = getWorkspaceFilter(req);
    const ob = await Onboarding.findOne(wsFilter).lean();

    let value = ob?.answers?.[fieldName] ?? null;
    // Handle legacy field name: 'bhag' might be stored as 'visionBhag' in older data
    if (fieldName === 'bhag' && value === null) {
      value = ob?.answers?.visionBhag ?? null;
    }
    return res.json({ field: fieldName, value });
  } catch (err) {
    next(err);
  }
};

/**
 * Update a single field value
 * PATCH /api/workspace-fields/:fieldName
 * Body: { value: any }
 */
exports.updateField = async (req, res, next) => {
  try {
    const { fieldName } = req.params;
    const { value } = req.body;

    if (!ALLOWED_FIELDS.includes(fieldName)) {
      return res.status(400).json({ message: `Field '${fieldName}' is not allowed` });
    }

    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const workspaceId = getWorkspaceId(req);
    const ob = await getOrCreate(userId, workspaceId);

    // Initialize answers if needed
    if (!ob.answers) {
      ob.answers = {};
    }

    // Update the specific field
    const oldValue = ob.answers[fieldName];
    ob.answers[fieldName] = value;

    // Mark answers as modified for Mongoose
    ob.markModified('answers');
    await ob.save();

    // Update workspace lastActivityAt
    if (ob.workspace) touchWorkspace(ob.workspace);

    console.log(`[updateField] user=${userId} workspace=${workspaceId} field=${fieldName} oldLen=${JSON.stringify(oldValue || '').length} newLen=${JSON.stringify(value || '').length}`);

    return res.json({
      field: fieldName,
      value: ob.answers[fieldName],
      message: `Field '${fieldName}' updated`,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Delete/clear a single field value
 * DELETE /api/workspace-fields/:fieldName
 */
exports.deleteField = async (req, res, next) => {
  try {
    const { fieldName } = req.params;

    if (!ALLOWED_FIELDS.includes(fieldName)) {
      return res.status(400).json({ message: `Field '${fieldName}' is not allowed` });
    }

    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const wsFilter = getWorkspaceFilter(req);
    const ob = await Onboarding.findOne(wsFilter);

    if (!ob) {
      return res.status(404).json({ message: 'Workspace data not found' });
    }

    if (ob.answers && Object.prototype.hasOwnProperty.call(ob.answers, fieldName)) {
      delete ob.answers[fieldName];
      ob.markModified('answers');
      await ob.save();

      // Update workspace lastActivityAt
      if (ob.workspace) touchWorkspace(ob.workspace);
    }

    console.log(`[deleteField] user=${userId} field=${fieldName}`);

    return res.json({ field: fieldName, message: `Field '${fieldName}' deleted` });
  } catch (err) {
    next(err);
  }
};

/**
 * Get multiple fields at once
 * POST /api/workspace-fields/batch
 * Body: { fields: string[] }
 */
exports.getFields = async (req, res, next) => {
  try {
    const { fields } = req.body;

    if (!Array.isArray(fields)) {
      return res.status(400).json({ message: 'Fields array is required' });
    }

    // Validate all fields
    const invalidFields = fields.filter(f => !ALLOWED_FIELDS.includes(f));
    if (invalidFields.length > 0) {
      return res.status(400).json({ message: `Invalid fields: ${invalidFields.join(', ')}` });
    }

    const userId = req.user?.id;
    if (!userId) {
      const result = {};
      fields.forEach(f => result[f] = null);
      return res.json({ values: result });
    }

    const wsFilter = getWorkspaceFilter(req);
    const ob = await Onboarding.findOne(wsFilter).lean();

    const result = {};
    fields.forEach(f => {
      let value = ob?.answers?.[f] ?? null;
      // Handle legacy field name: 'bhag' might be stored as 'visionBhag' in older data
      if (f === 'bhag' && value === null) {
        value = ob?.answers?.visionBhag ?? null;
      }
      result[f] = value;
    });

    return res.json({ values: result });
  } catch (err) {
    next(err);
  }
};

/**
 * Update multiple fields at once (atomic)
 * PUT /api/workspace-fields/batch
 * Body: { fields: { [fieldName]: value } }
 */
exports.updateFields = async (req, res, next) => {
  try {
    const { fields } = req.body;

    if (!fields || typeof fields !== 'object') {
      return res.status(400).json({ message: 'Fields object is required' });
    }

    const fieldNames = Object.keys(fields);

    // Validate all fields
    const invalidFields = fieldNames.filter(f => !ALLOWED_FIELDS.includes(f));
    if (invalidFields.length > 0) {
      return res.status(400).json({ message: `Invalid fields: ${invalidFields.join(', ')}` });
    }

    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const workspaceId = getWorkspaceId(req);
    const ob = await getOrCreate(userId, workspaceId);

    // Initialize answers if needed
    if (!ob.answers) {
      ob.answers = {};
    }

    // Update all specified fields
    const updated = [];
    for (const [fieldName, value] of Object.entries(fields)) {
      ob.answers[fieldName] = value;
      updated.push(fieldName);
    }

    // Mark answers as modified for Mongoose
    ob.markModified('answers');
    await ob.save();

    // Update workspace lastActivityAt
    if (ob.workspace) touchWorkspace(ob.workspace);

    console.log(`[updateFields] user=${userId} workspace=${workspaceId} fields=${updated.join(',')}`);

    // Return the updated values
    const result = {};
    fieldNames.forEach(f => {
      result[f] = ob.answers[f];
    });

    return res.json({
      values: result,
      message: `${updated.length} fields updated`,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * List all available field names
 * GET /api/workspace-fields
 */
exports.listFields = async (req, res) => {
  return res.json({ fields: ALLOWED_FIELDS });
};
