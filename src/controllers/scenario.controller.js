const Workspace = require('../models/Workspace');
const Scenario = require('../models/Scenario');
const FinancialBaseline = require('../models/FinancialBaseline');
const { getFinancialInsights, answerFinancialQuestion } = require('../agents/financialInsightsAgent');

/**
 * Financial Scenario Controller
 *
 * Manages the Scenario Sandbox - a safe space to explore "what-if" questions
 * without affecting the Financial Baseline (confirmed reality).
 */

async function resolveWorkspace(userId, wid) {
  const ws = await Workspace.findOne({ user: userId, wid }).lean().exec();
  return ws;
}

/**
 * GET /api/workspaces/:wid/financial-scenarios
 * List all scenarios for a workspace
 */
exports.list = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const ws = await resolveWorkspace(userId, String(req.params?.wid || '').trim());
    if (!ws) return res.status(404).json({ message: 'Workspace not found' });

    const scenarios = await Scenario.find({
      user: userId,
      workspace: ws._id,
      status: { $ne: 'discarded' },
    })
      .sort({ updatedAt: -1 })
      .lean()
      .exec();

    return res.json({ scenarios });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/workspaces/:wid/financial-scenarios/:sid
 * Get a single scenario with its calculated metrics
 */
exports.get = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const ws = await resolveWorkspace(userId, String(req.params?.wid || '').trim());
    if (!ws) return res.status(404).json({ message: 'Workspace not found' });

    const sid = String(req.params?.sid || '').trim();
    const scenario = await Scenario.findOne({
      user: userId,
      workspace: ws._id,
      sid,
    }).lean().exec();

    if (!scenario) {
      return res.status(404).json({ message: 'Scenario not found' });
    }

    return res.json({ scenario });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/workspaces/:wid/financial-scenarios
 * Create a new scenario
 */
exports.create = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const ws = await resolveWorkspace(userId, String(req.params?.wid || '').trim());
    if (!ws) return res.status(404).json({ message: 'Workspace not found' });

    // Check entitlements (Pro feature)
    try {
      const ent = require('../config/entitlements');
      const User = require('../models/User');
      const user = await User.findById(userId).lean().exec();
      if (!ent.hasFeature(user, 'assumptionScenarios')) {
        return res.status(402).json({
          code: 'UPGRADE_REQUIRED',
          message: 'Scenarios are available on Pro plan',
          plan: ent.effectivePlan(user),
        });
      }
    } catch (e) {
      // If entitlements check fails, allow (fail open for dev)
      console.error('[scenario.create] Entitlements check failed:', e?.message);
    }

    const { name, description, levers } = req.body || {};

    // Get baseline to calculate initial metrics
    const baseline = await FinancialBaseline.getOrCreate(userId, ws._id);

    const scenario = new Scenario({
      user: userId,
      workspace: ws._id,
      name: String(name || '').trim() || 'Untitled Scenario',
      description: String(description || '').trim(),
      status: 'draft',
      levers: {
        pricingAdjustment: Number(levers?.pricingAdjustment) || 0,
        volumeAdjustment: Number(levers?.volumeAdjustment) || 0,
        workCostAdjustment: Number(levers?.workCostAdjustment) || 0,
        fixedCostAdjustment: Number(levers?.fixedCostAdjustment) || 0,
        timingOffset: Number(levers?.timingOffset) || 0,
        oneTimeExpense: Number(levers?.oneTimeExpense) || 0,
        oneTimeExpenseMonth: Number(levers?.oneTimeExpenseMonth) || 1,
        oneTimeExpenseDescription: String(levers?.oneTimeExpenseDescription || ''),
        additionalMonthlyCost: Number(levers?.additionalMonthlyCost) || 0,
        additionalMonthlyCostDescription: String(levers?.additionalMonthlyCostDescription || ''),
      },
    });

    // Calculate metrics from baseline
    scenario.calculateFromBaseline(baseline);
    await scenario.save();

    return res.status(201).json({ scenario });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/workspaces/:wid/financial-scenarios/:sid
 * Update scenario levers and recalculate
 */
exports.update = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const ws = await resolveWorkspace(userId, String(req.params?.wid || '').trim());
    if (!ws) return res.status(404).json({ message: 'Workspace not found' });

    const sid = String(req.params?.sid || '').trim();
    const scenario = await Scenario.findOne({
      user: userId,
      workspace: ws._id,
      sid,
    });

    if (!scenario) {
      return res.status(404).json({ message: 'Scenario not found' });
    }

    // Don't allow editing applied scenarios
    if (scenario.status === 'applied') {
      return res.status(400).json({
        message: 'Cannot edit an applied scenario. Create a new one instead.',
      });
    }

    const { name, description, levers, status } = req.body || {};

    // Update basic fields
    if (typeof name !== 'undefined') {
      scenario.name = String(name || '').trim() || scenario.name;
    }
    if (typeof description !== 'undefined') {
      scenario.description = String(description || '').trim();
    }
    if (status && ['draft', 'saved'].includes(status)) {
      scenario.status = status;
    }

    // Update levers if provided
    if (levers) {
      if (typeof levers.pricingAdjustment !== 'undefined') {
        scenario.levers.pricingAdjustment = Number(levers.pricingAdjustment) || 0;
      }
      if (typeof levers.volumeAdjustment !== 'undefined') {
        scenario.levers.volumeAdjustment = Number(levers.volumeAdjustment) || 0;
      }
      if (typeof levers.workCostAdjustment !== 'undefined') {
        scenario.levers.workCostAdjustment = Number(levers.workCostAdjustment) || 0;
      }
      if (typeof levers.fixedCostAdjustment !== 'undefined') {
        scenario.levers.fixedCostAdjustment = Number(levers.fixedCostAdjustment) || 0;
      }
      if (typeof levers.timingOffset !== 'undefined') {
        scenario.levers.timingOffset = Number(levers.timingOffset) || 0;
      }
      if (typeof levers.oneTimeExpense !== 'undefined') {
        scenario.levers.oneTimeExpense = Number(levers.oneTimeExpense) || 0;
      }
      if (typeof levers.oneTimeExpenseMonth !== 'undefined') {
        scenario.levers.oneTimeExpenseMonth = Number(levers.oneTimeExpenseMonth) || 1;
      }
      if (typeof levers.oneTimeExpenseDescription !== 'undefined') {
        scenario.levers.oneTimeExpenseDescription = String(levers.oneTimeExpenseDescription || '');
      }
      if (typeof levers.additionalMonthlyCost !== 'undefined') {
        scenario.levers.additionalMonthlyCost = Number(levers.additionalMonthlyCost) || 0;
      }
      if (typeof levers.additionalMonthlyCostDescription !== 'undefined') {
        scenario.levers.additionalMonthlyCostDescription = String(levers.additionalMonthlyCostDescription || '');
      }

      // Recalculate metrics
      const baseline = await FinancialBaseline.getOrCreate(userId, ws._id);
      scenario.calculateFromBaseline(baseline);
    }

    await scenario.save();
    return res.json({ scenario });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/workspaces/:wid/financial-scenarios/:sid/calculate
 * Recalculate scenario metrics against current baseline
 */
exports.calculate = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const ws = await resolveWorkspace(userId, String(req.params?.wid || '').trim());
    if (!ws) return res.status(404).json({ message: 'Workspace not found' });

    const sid = String(req.params?.sid || '').trim();
    const scenario = await Scenario.findOne({
      user: userId,
      workspace: ws._id,
      sid,
    });

    if (!scenario) {
      return res.status(404).json({ message: 'Scenario not found' });
    }

    // Get current baseline and recalculate
    const baseline = await FinancialBaseline.getOrCreate(userId, ws._id);
    scenario.calculateFromBaseline(baseline);
    await scenario.save();

    return res.json({
      scenario,
      summary: scenario.getSummary(),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/workspaces/:wid/financial-scenarios/:sid/apply
 * Apply scenario adjustments to the baseline (confirm changes)
 */
exports.apply = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const ws = await resolveWorkspace(userId, String(req.params?.wid || '').trim());
    if (!ws) return res.status(404).json({ message: 'Workspace not found' });

    const sid = String(req.params?.sid || '').trim();
    const scenario = await Scenario.findOne({
      user: userId,
      workspace: ws._id,
      sid,
    });

    if (!scenario) {
      return res.status(404).json({ message: 'Scenario not found' });
    }

    if (scenario.status === 'applied') {
      return res.status(400).json({ message: 'Scenario already applied' });
    }

    // Get baseline
    const baseline = await FinancialBaseline.findOne({
      user: userId,
      workspace: ws._id,
    });

    if (!baseline) {
      return res.status(404).json({ message: 'Financial baseline not found' });
    }

    // Apply scenario adjustments to baseline
    // Note: We apply the percentage changes, not the absolute values
    const { levers } = scenario;

    // Apply fixed cost adjustment + additional monthly cost
    if (levers.fixedCostAdjustment !== 0 || levers.additionalMonthlyCost > 0) {
      const multiplier = 1 + (levers.fixedCostAdjustment || 0) / 100;
      baseline.fixedCosts.total = Math.round(
        (baseline.fixedCosts.total * multiplier + (levers.additionalMonthlyCost || 0)) * 100
      ) / 100;
    }

    // Apply work cost adjustment
    if (levers.workCostAdjustment !== 0) {
      const multiplier = 1 + (levers.workCostAdjustment || 0) / 100;
      baseline.workRelatedCosts.total = Math.round(
        baseline.workRelatedCosts.total * multiplier * 100
      ) / 100;
    }

    // Mark baseline as confirmed
    baseline.lastConfirmedAt = new Date();
    baseline.lastConfirmedBy = userId;
    await baseline.save();

    // Mark scenario as applied
    scenario.status = 'applied';
    scenario.appliedAt = new Date();
    scenario.appliedBy = userId;
    await scenario.save();

    return res.json({
      message: 'Scenario applied to baseline',
      scenario,
      baseline,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/workspaces/:wid/financial-scenarios/:sid/discard
 * Discard a scenario
 */
exports.discard = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const ws = await resolveWorkspace(userId, String(req.params?.wid || '').trim());
    if (!ws) return res.status(404).json({ message: 'Workspace not found' });

    const sid = String(req.params?.sid || '').trim();
    const scenario = await Scenario.findOne({
      user: userId,
      workspace: ws._id,
      sid,
    });

    if (!scenario) {
      return res.status(404).json({ message: 'Scenario not found' });
    }

    if (scenario.status === 'applied') {
      return res.status(400).json({ message: 'Cannot discard an applied scenario' });
    }

    scenario.status = 'discarded';
    await scenario.save();

    return res.json({ message: 'Scenario discarded', scenario });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/workspaces/:wid/financial-scenarios/:sid
 * Permanently delete a scenario
 */
exports.delete = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const ws = await resolveWorkspace(userId, String(req.params?.wid || '').trim());
    if (!ws) return res.status(404).json({ message: 'Workspace not found' });

    const sid = String(req.params?.sid || '').trim();
    const result = await Scenario.deleteOne({
      user: userId,
      workspace: ws._id,
      sid,
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'Scenario not found' });
    }

    return res.json({ message: 'Scenario deleted' });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/workspaces/:wid/financial-scenarios/quick-calc
 * Quick calculation without saving - for real-time lever adjustments
 */
exports.quickCalc = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const ws = await resolveWorkspace(userId, String(req.params?.wid || '').trim());
    if (!ws) return res.status(404).json({ message: 'Workspace not found' });

    const { levers } = req.body || {};

    // Get baseline
    const baseline = await FinancialBaseline.getOrCreate(userId, ws._id);

    // Create a temporary scenario for calculation (not saved)
    const tempScenario = new Scenario({
      user: userId,
      workspace: ws._id,
      name: 'Quick Calculation',
      status: 'draft',
      levers: {
        pricingAdjustment: Number(levers?.pricingAdjustment) || 0,
        volumeAdjustment: Number(levers?.volumeAdjustment) || 0,
        workCostAdjustment: Number(levers?.workCostAdjustment) || 0,
        fixedCostAdjustment: Number(levers?.fixedCostAdjustment) || 0,
        timingOffset: Number(levers?.timingOffset) || 0,
        oneTimeExpense: Number(levers?.oneTimeExpense) || 0,
        oneTimeExpenseMonth: Number(levers?.oneTimeExpenseMonth) || 1,
        oneTimeExpenseDescription: String(levers?.oneTimeExpenseDescription || ''),
        additionalMonthlyCost: Number(levers?.additionalMonthlyCost) || 0,
        additionalMonthlyCostDescription: String(levers?.additionalMonthlyCostDescription || ''),
      },
    });

    // Calculate metrics
    tempScenario.calculateFromBaseline(baseline);

    return res.json({
      baseline: {
        revenue: baseline.revenue.totalMonthlyRevenue,
        workCosts: baseline.workRelatedCosts.total,
        fixedCosts: baseline.fixedCosts.total,
        metrics: baseline.metrics,
        forecast: baseline.forecast,
      },
      scenario: {
        levers: tempScenario.levers,
        metrics: tempScenario.scenarioMetrics,
        forecast: tempScenario.scenarioForecast,
        summary: tempScenario.getSummary(),
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/workspaces/:wid/financial-scenarios/compare
 * Compare baseline with a specific scenario
 */
exports.compare = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const ws = await resolveWorkspace(userId, String(req.params?.wid || '').trim());
    if (!ws) return res.status(404).json({ message: 'Workspace not found' });

    const sid = String(req.query?.sid || '').trim();

    // Get baseline
    const baseline = await FinancialBaseline.getOrCreate(userId, ws._id);

    // Get scenario if provided
    let scenario = null;
    if (sid) {
      scenario = await Scenario.findOne({
        user: userId,
        workspace: ws._id,
        sid,
      }).lean().exec();
    }

    // Build comparison data structure for charts
    const comparison = {
      baseline: {
        monthlyRevenue: baseline.revenue.totalMonthlyRevenue || 0,
        workCosts: baseline.workRelatedCosts.total || 0,
        fixedCosts: baseline.fixedCosts.total || 0,
        deliveryCost: baseline.revenue.totalMonthlyDeliveryCost || 0,
        metrics: baseline.metrics,
        forecast: baseline.forecast,
      },
      scenario: scenario ? {
        sid: scenario.sid,
        name: scenario.name,
        levers: scenario.levers,
        metrics: scenario.scenarioMetrics,
        forecast: scenario.scenarioForecast,
      } : null,
      // Pre-computed chart data for Cash Runway comparison
      cashRunwayComparison: baseline.forecast.map((point, i) => {
        const scenarioPoint = scenario?.scenarioForecast?.[i];
        return {
          month: point.month,
          monthLabel: point.monthLabel,
          baselineCash: point.cashBalance,
          scenarioCash: scenarioPoint?.cashBalance ?? null,
        };
      }),
      // Pre-computed chart data for Profitability Bridge comparison
      profitabilityComparison: {
        baseline: {
          revenue: baseline.revenue.totalMonthlyRevenue || 0,
          deliveryCost: -(baseline.revenue.totalMonthlyDeliveryCost || 0),
          workCosts: -(baseline.workRelatedCosts.total || 0),
          fixedCosts: -(baseline.fixedCosts.total || 0),
          surplus: baseline.metrics?.monthlyNetSurplus || 0,
        },
        scenario: scenario ? {
          revenue: scenario.scenarioMetrics?.adjustedMonthlyRevenue || 0,
          workCosts: -(scenario.scenarioMetrics?.adjustedWorkCosts || 0),
          fixedCosts: -(scenario.scenarioMetrics?.adjustedFixedCosts || 0),
          surplus: scenario.scenarioMetrics?.monthlyNetSurplus || 0,
        } : null,
      },
    };

    return res.json({ comparison });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/workspaces/:wid/financial-insights
 * Get AI-powered financial insights for baseline (and optionally a scenario)
 */
exports.getInsights = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const ws = await resolveWorkspace(userId, String(req.params?.wid || '').trim());
    if (!ws) return res.status(404).json({ message: 'Workspace not found' });

    const sid = String(req.query?.sid || '').trim();
    const forceRefresh = req.query?.refresh === 'true';

    // Get baseline
    const baseline = await FinancialBaseline.getOrCreate(userId, ws._id);

    // Get scenario if provided
    let scenario = null;
    if (sid) {
      scenario = await Scenario.findOne({
        user: userId,
        workspace: ws._id,
        sid,
      }).lean().exec();
    }

    // Get insights
    const insights = await getFinancialInsights(userId, baseline, {
      scenario,
      forceRefresh,
      workspaceId: ws._id,
    });

    return res.json({ insights });
  } catch (err) {
    // Handle AI errors gracefully
    if (err.code === 'NO_API_KEY') {
      return res.status(503).json({
        message: 'AI insights temporarily unavailable',
        code: 'AI_UNAVAILABLE',
      });
    }
    next(err);
  }
};

/**
 * POST /api/workspaces/:wid/financial-insights/ask
 * Ask a specific financial question
 */
exports.askQuestion = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const ws = await resolveWorkspace(userId, String(req.params?.wid || '').trim());
    if (!ws) return res.status(404).json({ message: 'Workspace not found' });

    const { question } = req.body || {};

    if (!question || typeof question !== 'string' || question.trim().length < 5) {
      return res.status(400).json({ message: 'Please provide a valid question' });
    }

    // Get baseline
    const baseline = await FinancialBaseline.getOrCreate(userId, ws._id);

    // Get answer
    const answer = await answerFinancialQuestion(userId, baseline, question.trim(), ws._id);

    return res.json({ answer });
  } catch (err) {
    // Handle AI errors gracefully
    if (err.code === 'NO_API_KEY') {
      return res.status(503).json({
        message: 'AI insights temporarily unavailable',
        code: 'AI_UNAVAILABLE',
      });
    }
    next(err);
  }
};
