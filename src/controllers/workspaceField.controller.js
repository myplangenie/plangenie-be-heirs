const Workspace = require('../models/Workspace');
const { getWorkspaceId } = require('../utils/workspaceQuery');
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
  // Department Configuration
  'editableDepts',
  'deptsConfirmed',
  // Actual financial data (monthly arrays)
  'finActualRevenue',
  'finActualCogs',
  'finActualMarketing',
  'finActualPayroll',
  'finActualFixed',
  'finActualFunding',
  'finActualNewCustomers',
  // Org structure
  'orgPositions',
  // Products
  'products',
  'competitorNames',
  // Action sections
  'actionSections',
  // Plan prose
  'planProse',
  // SWOT (legacy text format - SwotEntry model is primary)
  'swotStrengths',
  'swotWeaknesses',
  'swotOpportunities',
  'swotThreats',
  // Goals
  'goalsShortTerm',
  'goalsMidTerm',
  'goalsLongTerm',
  // Misc
  'companyLogoUrl',
];

// Get or create workspace for the user
async function getOrCreateWorkspace(userId, workspaceId = null) {
  if (workspaceId) {
    const ws = await Workspace.findById(workspaceId);
    if (ws) return ws;
  }

  // Find or create default workspace
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
  return defaultWs;
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

    const workspaceId = getWorkspaceId(req);
    const ws = await getOrCreateWorkspace(userId, workspaceId);

    // Read from Workspace.fields Map
    let value = ws.fields?.get(fieldName) ?? null;
    // Handle legacy field name: 'bhag' might be stored as 'visionBhag' in older data
    if (fieldName === 'bhag' && value === null) {
      value = ws.fields?.get('visionBhag') ?? null;
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
    const ws = await getOrCreateWorkspace(userId, workspaceId);

    // Initialize fields Map if needed
    if (!ws.fields) {
      ws.fields = new Map();
    }

    // Update the specific field
    const oldValue = ws.fields.get(fieldName);
    ws.fields.set(fieldName, value);

    // Mark fields as modified for Mongoose
    ws.markModified('fields');
    await ws.save();

    // Update workspace lastActivityAt
    touchWorkspace(ws._id);

    console.log(`[updateField] user=${userId} workspace=${workspaceId} field=${fieldName} oldLen=${JSON.stringify(oldValue || '').length} newLen=${JSON.stringify(value || '').length}`);

    return res.json({
      field: fieldName,
      value: ws.fields.get(fieldName),
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

    const workspaceId = getWorkspaceId(req);
    const ws = await getOrCreateWorkspace(userId, workspaceId);

    if (!ws) {
      return res.status(404).json({ message: 'Workspace not found' });
    }

    if (ws.fields && ws.fields.has(fieldName)) {
      ws.fields.delete(fieldName);
      ws.markModified('fields');
      await ws.save();

      // Update workspace lastActivityAt
      touchWorkspace(ws._id);
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

    const workspaceId = getWorkspaceId(req);
    const ws = await getOrCreateWorkspace(userId, workspaceId);

    const result = {};
    fields.forEach(f => {
      let value = ws.fields?.get(f) ?? null;
      // Handle legacy field name: 'bhag' might be stored as 'visionBhag' in older data
      if (f === 'bhag' && value === null) {
        value = ws.fields?.get('visionBhag') ?? null;
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
    const ws = await getOrCreateWorkspace(userId, workspaceId);

    // Initialize fields Map if needed
    if (!ws.fields) {
      ws.fields = new Map();
    }

    // Update all specified fields
    const updated = [];
    for (const [fieldName, value] of Object.entries(fields)) {
      ws.fields.set(fieldName, value);
      updated.push(fieldName);
    }

    // Mark fields as modified for Mongoose
    ws.markModified('fields');
    await ws.save();

    // Update workspace lastActivityAt
    touchWorkspace(ws._id);

    console.log(`[updateFields] user=${userId} workspace=${workspaceId} fields=${updated.join(',')}`);

    // Return the updated values
    const result = {};
    fieldNames.forEach(f => {
      result[f] = ws.fields.get(f);
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
