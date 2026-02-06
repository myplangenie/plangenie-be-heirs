const FinancialBaseline = require('../models/FinancialBaseline');
const RevenueStream = require('../models/RevenueStream');

/**
 * Get the financial baseline for the current workspace
 * GET /api/dashboard/financial-baseline
 */
exports.get = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const workspaceId = req.workspace?._id || null;
    const baseline = await FinancialBaseline.getOrCreate(userId, workspaceId);

    return res.json({ baseline: baseline.toObject() });
  } catch (err) {
    console.error('[financialBaseline.get]', err?.message || err);
    return res.status(500).json({ message: 'Failed to fetch financial baseline' });
  }
};

/**
 * Get just the metrics (lighter endpoint)
 * GET /api/dashboard/financial-baseline/metrics
 */
exports.getMetrics = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const workspaceId = req.workspace?._id || null;
    const baseline = await FinancialBaseline.findOne({ user: userId, workspace: workspaceId })
      .select('metrics revenue forecast')
      .lean()
      .exec();

    if (!baseline) {
      return res.json({ metrics: null, revenue: null, forecast: [] });
    }

    return res.json({
      metrics: baseline.metrics,
      revenue: baseline.revenue,
      forecast: baseline.forecast,
    });
  } catch (err) {
    console.error('[financialBaseline.getMetrics]', err?.message || err);
    return res.status(500).json({ message: 'Failed to fetch metrics' });
  }
};

/**
 * Update work-related costs
 * PATCH /api/dashboard/financial-baseline/work-costs
 *
 * Supports both new items-based format and legacy format:
 * - New format: { items: [{ id, category, amount, description }], total }
 * - Legacy format: { contractors, materials, commissions, shipping, other, otherTitle, total }
 */
exports.updateWorkCosts = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const workspaceId = req.workspace?._id || null;
    const { items, total, contractors, materials, commissions, shipping, other, otherTitle } = req.body;

    let baseline;
    try {
      baseline = await FinancialBaseline.getOrCreate(userId, workspaceId);
    } catch (getErr) {
      console.error('[financialBaseline.updateWorkCosts] getOrCreate failed:', getErr?.message || getErr);
      return res.status(500).json({ message: `Failed to get/create baseline: ${getErr?.message || 'Unknown error'}` });
    }

    // Check if using new items-based format
    if (items && Array.isArray(items)) {
      // Use new items-based format
      baseline.workRelatedCosts.items = items.map(item => ({
        id: item.id || `cost-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        category: item.category,
        amount: item.amount || 0,
        description: item.description || '',
      }));

      // Calculate total from items
      const calculatedTotal = items.reduce((sum, item) => sum + (item.amount || 0), 0);
      baseline.workRelatedCosts.total = total !== undefined ? total : calculatedTotal;

      // Also update legacy fields by aggregating items by category (for backwards compatibility)
      const categoryTotals = items.reduce((acc, item) => {
        acc[item.category] = (acc[item.category] || 0) + (item.amount || 0);
        return acc;
      }, {});

      baseline.workRelatedCosts.contractors = categoryTotals.contractors || 0;
      baseline.workRelatedCosts.materials = categoryTotals.materials || 0;
      baseline.workRelatedCosts.commissions = categoryTotals.commissions || 0;
      baseline.workRelatedCosts.shipping = categoryTotals.shipping || 0;
      baseline.workRelatedCosts.other = categoryTotals.other || 0;
      // For otherTitle, use the description of the first "other" item if available
      const firstOther = items.find(item => item.category === 'other');
      baseline.workRelatedCosts.otherTitle = firstOther?.description || '';
    } else {
      // Use legacy format
      if (total !== undefined) baseline.workRelatedCosts.total = total;
      if (contractors !== undefined) baseline.workRelatedCosts.contractors = contractors;
      if (materials !== undefined) baseline.workRelatedCosts.materials = materials;
      if (commissions !== undefined) baseline.workRelatedCosts.commissions = commissions;
      if (shipping !== undefined) baseline.workRelatedCosts.shipping = shipping;
      if (other !== undefined) baseline.workRelatedCosts.other = other;
      if (otherTitle !== undefined) baseline.workRelatedCosts.otherTitle = otherTitle;

      // If breakdown provided but no total, calculate total
      if (total === undefined) {
        const breakdown = baseline.workRelatedCosts;
        baseline.workRelatedCosts.total =
          (breakdown.contractors || 0) +
          (breakdown.materials || 0) +
          (breakdown.commissions || 0) +
          (breakdown.shipping || 0) +
          (breakdown.other || 0);
      }

      // Clear items array when using legacy format
      baseline.workRelatedCosts.items = [];
    }

    try {
      await baseline.save();
    } catch (saveErr) {
      console.error('[financialBaseline.updateWorkCosts] save failed:', saveErr?.message || saveErr);
      return res.status(500).json({ message: `Failed to save work costs: ${saveErr?.message || 'Unknown error'}` });
    }

    return res.json({ baseline: baseline.toObject() });
  } catch (err) {
    console.error('[financialBaseline.updateWorkCosts]', err?.message || err);
    return res.status(500).json({ message: `Failed to update work costs: ${err?.message || 'Unknown error'}` });
  }
};

/**
 * Update fixed costs
 * PATCH /api/dashboard/financial-baseline/fixed-costs
 *
 * Supports both new items-based format and legacy format:
 * - New format: { items: [{ id, category, amount, description }], total }
 * - Legacy format: { salaries, rent, software, insurance, utilities, marketing, other, otherTitle, total }
 */
exports.updateFixedCosts = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const workspaceId = req.workspace?._id || null;
    const { items, total, salaries, rent, software, insurance, utilities, marketing, other, otherTitle } = req.body;

    let baseline;
    try {
      baseline = await FinancialBaseline.getOrCreate(userId, workspaceId);
    } catch (getErr) {
      console.error('[financialBaseline.updateFixedCosts] getOrCreate failed:', getErr?.message || getErr);
      return res.status(500).json({ message: `Failed to get/create baseline: ${getErr?.message || 'Unknown error'}` });
    }

    // Check if using new items-based format
    if (items && Array.isArray(items)) {
      // Use new items-based format
      baseline.fixedCosts.items = items.map(item => ({
        id: item.id || `cost-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        category: item.category,
        amount: item.amount || 0,
        description: item.description || '',
      }));

      // Calculate total from items
      const calculatedTotal = items.reduce((sum, item) => sum + (item.amount || 0), 0);
      baseline.fixedCosts.total = total !== undefined ? total : calculatedTotal;

      // Also update legacy fields by aggregating items by category (for backwards compatibility)
      const categoryTotals = items.reduce((acc, item) => {
        acc[item.category] = (acc[item.category] || 0) + (item.amount || 0);
        return acc;
      }, {});

      baseline.fixedCosts.salaries = categoryTotals.salaries || 0;
      baseline.fixedCosts.rent = categoryTotals.rent || 0;
      baseline.fixedCosts.software = categoryTotals.software || 0;
      baseline.fixedCosts.insurance = categoryTotals.insurance || 0;
      baseline.fixedCosts.utilities = categoryTotals.utilities || 0;
      baseline.fixedCosts.marketing = categoryTotals.marketing || 0;
      baseline.fixedCosts.other = categoryTotals.other || 0;
      // For otherTitle, use the description of the first "other" item if available
      const firstOther = items.find(item => item.category === 'other');
      baseline.fixedCosts.otherTitle = firstOther?.description || '';
    } else {
      // Use legacy format
      if (total !== undefined) baseline.fixedCosts.total = total;
      if (salaries !== undefined) baseline.fixedCosts.salaries = salaries;
      if (rent !== undefined) baseline.fixedCosts.rent = rent;
      if (software !== undefined) baseline.fixedCosts.software = software;
      if (insurance !== undefined) baseline.fixedCosts.insurance = insurance;
      if (utilities !== undefined) baseline.fixedCosts.utilities = utilities;
      if (marketing !== undefined) baseline.fixedCosts.marketing = marketing;
      if (other !== undefined) baseline.fixedCosts.other = other;
      if (otherTitle !== undefined) baseline.fixedCosts.otherTitle = otherTitle;

      // If breakdown provided but no total, calculate total
      if (total === undefined) {
        const breakdown = baseline.fixedCosts;
        baseline.fixedCosts.total =
          (breakdown.salaries || 0) +
          (breakdown.rent || 0) +
          (breakdown.software || 0) +
          (breakdown.insurance || 0) +
          (breakdown.utilities || 0) +
          (breakdown.marketing || 0) +
          (breakdown.other || 0);
      }

      // Clear items array when using legacy format
      baseline.fixedCosts.items = [];
    }

    try {
      await baseline.save();
    } catch (saveErr) {
      console.error('[financialBaseline.updateFixedCosts] save failed:', saveErr?.message || saveErr);
      return res.status(500).json({ message: `Failed to save fixed costs: ${saveErr?.message || 'Unknown error'}` });
    }

    return res.json({ baseline: baseline.toObject() });
  } catch (err) {
    console.error('[financialBaseline.updateFixedCosts]', err?.message || err);
    return res.status(500).json({ message: `Failed to update fixed costs: ${err?.message || 'Unknown error'}` });
  }
};

/**
 * Update cash position
 * PATCH /api/dashboard/financial-baseline/cash
 */
exports.updateCash = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const workspaceId = req.workspace?._id || null;
    const { currentBalance, expectedFunding, fundingDate, fundingType } = req.body;

    const baseline = await FinancialBaseline.getOrCreate(userId, workspaceId);

    // Update cash
    if (currentBalance !== undefined) baseline.cash.currentBalance = currentBalance;
    if (expectedFunding !== undefined) baseline.cash.expectedFunding = expectedFunding;
    if (fundingDate !== undefined) baseline.cash.fundingDate = fundingDate ? new Date(fundingDate) : null;
    if (fundingType !== undefined) baseline.cash.fundingType = fundingType;

    await baseline.save();

    return res.json({ baseline: baseline.toObject() });
  } catch (err) {
    console.error('[financialBaseline.updateCash]', err?.message || err);
    return res.status(500).json({ message: 'Failed to update cash' });
  }
};

/**
 * Sync revenue from revenue streams
 * POST /api/dashboard/financial-baseline/sync-revenue
 */
exports.syncRevenue = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const workspaceId = req.workspace?._id || null;
    const baseline = await FinancialBaseline.getOrCreate(userId, workspaceId);

    await baseline.syncRevenueFromStreams();
    await baseline.save();

    return res.json({ baseline: baseline.toObject() });
  } catch (err) {
    console.error('[financialBaseline.syncRevenue]', err?.message || err);
    return res.status(500).json({ message: 'Failed to sync revenue' });
  }
};

/**
 * Confirm baseline (marks as explicitly confirmed by user)
 * POST /api/dashboard/financial-baseline/confirm
 */
exports.confirm = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const workspaceId = req.workspace?._id || null;
    const baseline = await FinancialBaseline.getOrCreate(userId, workspaceId);

    baseline.lastConfirmedAt = new Date();
    baseline.lastConfirmedBy = userId;
    await baseline.save();

    return res.json({ baseline: baseline.toObject(), confirmed: true });
  } catch (err) {
    console.error('[financialBaseline.confirm]', err?.message || err);
    return res.status(500).json({ message: 'Failed to confirm baseline' });
  }
};

/**
 * Get forecast data
 * GET /api/dashboard/financial-baseline/forecast
 */
exports.getForecast = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const workspaceId = req.workspace?._id || null;
    const baseline = await FinancialBaseline.findOne({ user: userId, workspace: workspaceId })
      .select('forecast cash metrics')
      .lean()
      .exec();

    if (!baseline) {
      return res.json({ forecast: [], cash: null });
    }

    return res.json({
      forecast: baseline.forecast || [],
      cash: baseline.cash,
      metrics: baseline.metrics,
    });
  } catch (err) {
    console.error('[financialBaseline.getForecast]', err?.message || err);
    return res.status(500).json({ message: 'Failed to fetch forecast' });
  }
};
