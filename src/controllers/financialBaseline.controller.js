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
 */
exports.updateWorkCosts = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const workspaceId = req.workspace?._id || null;
    const { total, contractors, materials, commissions, shipping, other } = req.body;

    const baseline = await FinancialBaseline.getOrCreate(userId, workspaceId);

    // Update work-related costs
    if (total !== undefined) baseline.workRelatedCosts.total = total;
    if (contractors !== undefined) baseline.workRelatedCosts.contractors = contractors;
    if (materials !== undefined) baseline.workRelatedCosts.materials = materials;
    if (commissions !== undefined) baseline.workRelatedCosts.commissions = commissions;
    if (shipping !== undefined) baseline.workRelatedCosts.shipping = shipping;
    if (other !== undefined) baseline.workRelatedCosts.other = other;

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

    await baseline.save();

    return res.json({ baseline: baseline.toObject() });
  } catch (err) {
    console.error('[financialBaseline.updateWorkCosts]', err?.message || err);
    return res.status(500).json({ message: 'Failed to update work costs' });
  }
};

/**
 * Update fixed costs
 * PATCH /api/dashboard/financial-baseline/fixed-costs
 */
exports.updateFixedCosts = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const workspaceId = req.workspace?._id || null;
    const { total, salaries, rent, software, insurance, utilities, marketing, other } = req.body;

    const baseline = await FinancialBaseline.getOrCreate(userId, workspaceId);

    // Update fixed costs
    if (total !== undefined) baseline.fixedCosts.total = total;
    if (salaries !== undefined) baseline.fixedCosts.salaries = salaries;
    if (rent !== undefined) baseline.fixedCosts.rent = rent;
    if (software !== undefined) baseline.fixedCosts.software = software;
    if (insurance !== undefined) baseline.fixedCosts.insurance = insurance;
    if (utilities !== undefined) baseline.fixedCosts.utilities = utilities;
    if (marketing !== undefined) baseline.fixedCosts.marketing = marketing;
    if (other !== undefined) baseline.fixedCosts.other = other;

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

    await baseline.save();

    return res.json({ baseline: baseline.toObject() });
  } catch (err) {
    console.error('[financialBaseline.updateFixedCosts]', err?.message || err);
    return res.status(500).json({ message: 'Failed to update fixed costs' });
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
    const { currentBalance, expectedFunding, fundingDate } = req.body;

    const baseline = await FinancialBaseline.getOrCreate(userId, workspaceId);

    // Update cash
    if (currentBalance !== undefined) baseline.cash.currentBalance = currentBalance;
    if (expectedFunding !== undefined) baseline.cash.expectedFunding = expectedFunding;
    if (fundingDate !== undefined) baseline.cash.fundingDate = fundingDate ? new Date(fundingDate) : null;

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
