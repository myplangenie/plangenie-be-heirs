const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * Financial Scenario Model
 *
 * Scenarios are a "safe sandbox" for exploring what-if questions.
 * They start from the baseline and apply temporary adjustments.
 * Scenarios NEVER overwrite the baseline unless explicitly applied.
 *
 * Levers (natural language questions):
 * - Pricing: "What if we charge more or less?"
 * - Volume: "What if this happens more or less often?"
 * - Work costs: "What if doing the work gets more expensive?"
 * - Fixed costs: "What if overhead goes up or down?"
 * - Timing: "When does this change happen?"
 */

const ScenarioSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    workspace: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
      index: true,
    },
    sid: {
      type: String,
      required: true,
      unique: true,
      default: () => `scn_${uuidv4().slice(0, 8)}`,
    },
    name: {
      type: String,
      required: true,
      default: 'Untitled Scenario',
    },
    description: {
      type: String,
      default: '',
    },

    // Scenario status
    status: {
      type: String,
      enum: ['draft', 'saved', 'applied', 'discarded'],
      default: 'draft',
    },

    // === SCENARIO LEVERS ===
    // All percentages are expressed as the change from baseline
    // e.g., pricingAdjustment: 10 means +10% from baseline pricing

    levers: {
      // "What if we charge more or less?"
      // Affects revenue: baseline revenue * (1 + pricingAdjustment/100)
      pricingAdjustment: {
        type: Number,
        default: 0,
        min: -100,
        max: 500,
      },

      // "What if this happens more or less often?"
      // Affects revenue volume: baseline revenue * (1 + volumeAdjustment/100)
      volumeAdjustment: {
        type: Number,
        default: 0,
        min: -100,
        max: 500,
      },

      // "What if doing the work gets more expensive?"
      // Affects work-related costs: baseline work costs * (1 + workCostAdjustment/100)
      workCostAdjustment: {
        type: Number,
        default: 0,
        min: -100,
        max: 500,
      },

      // "What if overhead goes up or down?"
      // Affects fixed costs: baseline fixed costs * (1 + fixedCostAdjustment/100)
      fixedCostAdjustment: {
        type: Number,
        default: 0,
        min: -100,
        max: 500,
      },

      // "When does this change happen?"
      // Month offset from now (0 = immediate, 3 = in 3 months)
      timingOffset: {
        type: Number,
        default: 0,
        min: 0,
        max: 12,
      },

      // Optional: One-time expense to model (e.g., "Can we afford to hire?")
      oneTimeExpense: {
        type: Number,
        default: 0,
        min: 0,
      },
      oneTimeExpenseMonth: {
        type: Number,
        default: 1,
        min: 1,
        max: 12,
      },
      oneTimeExpenseDescription: {
        type: String,
        default: '',
      },

      // Optional: Additional monthly cost (e.g., new hire salary)
      additionalMonthlyCost: {
        type: Number,
        default: 0,
        min: 0,
      },
      additionalMonthlyCostDescription: {
        type: String,
        default: '',
      },
    },

    // === CALCULATED SCENARIO METRICS ===
    // These are computed when the scenario is calculated

    scenarioMetrics: {
      // Adjusted values
      adjustedMonthlyRevenue: { type: Number, default: 0 },
      adjustedWorkCosts: { type: Number, default: 0 },
      adjustedFixedCosts: { type: Number, default: 0 },
      adjustedTotalCosts: { type: Number, default: 0 },

      // Scenario outcomes
      monthlyNetSurplus: { type: Number, default: 0 },
      operatingResult: { type: Number, default: 0 },
      cashRunwayMonths: { type: Number, default: null },
      breakEvenRevenue: { type: Number, default: null },

      // Delta from baseline (for visual comparison)
      revenueDelta: { type: Number, default: 0 },
      costsDelta: { type: Number, default: 0 },
      surplusDelta: { type: Number, default: 0 },
      runwayDelta: { type: Number, default: null },
    },

    // 12-month scenario forecast
    scenarioForecast: [{
      month: { type: Number },
      monthLabel: { type: String },
      revenue: { type: Number, default: 0 },
      costs: { type: Number, default: 0 },
      cashBalance: { type: Number, default: 0 },
      netSurplus: { type: Number, default: 0 },
      // For comparison
      baselineRevenue: { type: Number, default: 0 },
      baselineCosts: { type: Number, default: 0 },
      baselineCashBalance: { type: Number, default: 0 },
    }],

    // Track when scenario was last calculated
    lastCalculatedAt: { type: Date, default: null },

    // If applied, when and by whom
    appliedAt: { type: Date, default: null },
    appliedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

ScenarioSchema.index({ user: 1, workspace: 1, status: 1 });
ScenarioSchema.index({ user: 1, workspace: 1, name: 1 });

/**
 * Calculate scenario metrics based on baseline data
 * @param {Object} baseline - FinancialBaseline document
 */
ScenarioSchema.methods.calculateFromBaseline = function(baseline) {
  const { levers } = this;
  const { revenue, workRelatedCosts, fixedCosts, cash } = baseline;

  // Extract baseline values
  const baselineRevenue = revenue.totalMonthlyRevenue || 0;
  const baselineDeliveryCost = revenue.totalMonthlyDeliveryCost || 0;
  const baselineWorkCosts = workRelatedCosts.total || 0;
  const baselineFixedCosts = fixedCosts.total || 0;
  const currentCash = (cash.currentBalance || 0) + (cash.expectedFunding || 0);

  // Apply scenario adjustments
  // Revenue is affected by both pricing and volume
  const pricingMultiplier = 1 + (levers.pricingAdjustment || 0) / 100;
  const volumeMultiplier = 1 + (levers.volumeAdjustment || 0) / 100;
  const adjustedMonthlyRevenue = baselineRevenue * pricingMultiplier * volumeMultiplier;

  // Delivery cost scales with volume (not pricing)
  const adjustedDeliveryCost = baselineDeliveryCost * volumeMultiplier;

  // Work costs - scale with volume and apply adjustment
  const workCostMultiplier = 1 + (levers.workCostAdjustment || 0) / 100;
  const adjustedWorkCosts = (baselineWorkCosts * volumeMultiplier * workCostMultiplier);

  // Fixed costs - apply adjustment + any additional monthly cost
  const fixedCostMultiplier = 1 + (levers.fixedCostAdjustment || 0) / 100;
  const adjustedFixedCosts = (baselineFixedCosts * fixedCostMultiplier) +
    (levers.additionalMonthlyCost || 0);

  // Calculate totals
  const adjustedTotalCosts = adjustedDeliveryCost + adjustedWorkCosts + adjustedFixedCosts;
  const grossProfit = adjustedMonthlyRevenue - adjustedDeliveryCost - adjustedWorkCosts;
  const monthlyNetSurplus = grossProfit - adjustedFixedCosts;
  const operatingResult = monthlyNetSurplus;

  // Cash runway (accounting for one-time expenses)
  let cashRunwayMonths = null;
  const effectiveCash = currentCash - (levers.oneTimeExpense || 0);
  const monthlyBurn = monthlyNetSurplus < 0 ? Math.abs(monthlyNetSurplus) : 0;

  if (monthlyBurn > 0) {
    cashRunwayMonths = Math.floor(effectiveCash / monthlyBurn);
  } else if (monthlyNetSurplus >= 0) {
    cashRunwayMonths = 999; // Effectively infinite if profitable
  }

  // Break-even revenue
  const breakEvenRevenue = adjustedTotalCosts;

  // Calculate deltas from baseline
  const baselineNetSurplus = baseline.metrics?.monthlyNetSurplus || 0;
  const baselineTotalCosts = baselineDeliveryCost + baselineWorkCosts + baselineFixedCosts;
  const baselineRunway = baseline.metrics?.cashRunwayMonths;

  this.scenarioMetrics = {
    adjustedMonthlyRevenue: Math.round(adjustedMonthlyRevenue * 100) / 100,
    adjustedWorkCosts: Math.round(adjustedWorkCosts * 100) / 100,
    adjustedFixedCosts: Math.round(adjustedFixedCosts * 100) / 100,
    adjustedTotalCosts: Math.round(adjustedTotalCosts * 100) / 100,
    monthlyNetSurplus: Math.round(monthlyNetSurplus * 100) / 100,
    operatingResult: Math.round(operatingResult * 100) / 100,
    cashRunwayMonths,
    breakEvenRevenue: Math.round(breakEvenRevenue * 100) / 100,
    revenueDelta: Math.round((adjustedMonthlyRevenue - baselineRevenue) * 100) / 100,
    costsDelta: Math.round((adjustedTotalCosts - baselineTotalCosts) * 100) / 100,
    surplusDelta: Math.round((monthlyNetSurplus - baselineNetSurplus) * 100) / 100,
    runwayDelta: cashRunwayMonths !== null && baselineRunway !== null
      ? cashRunwayMonths - baselineRunway
      : null,
  };

  // Generate 12-month forecast with timing offset
  this.generateScenarioForecast(baseline);

  this.lastCalculatedAt = new Date();
  return this.scenarioMetrics;
};

/**
 * Generate 12-month forecast with baseline comparison
 * @param {Object} baseline - FinancialBaseline document
 */
ScenarioSchema.methods.generateScenarioForecast = function(baseline) {
  const { levers, scenarioMetrics } = this;
  const { cash, forecast: baselineForecast } = baseline;

  const timingOffset = levers.timingOffset || 0;
  const oneTimeExpenseMonth = levers.oneTimeExpenseMonth || 1;
  const oneTimeExpense = levers.oneTimeExpense || 0;

  const scenarioForecast = [];
  let runningCash = (cash.currentBalance || 0);
  const now = new Date();

  // Get baseline values for pre-scenario months
  const baselineRevenue = baseline.revenue.totalMonthlyRevenue || 0;
  const baselineDeliveryCost = baseline.revenue.totalMonthlyDeliveryCost || 0;
  const baselineWorkCosts = baseline.workRelatedCosts.total || 0;
  const baselineFixedCosts = baseline.fixedCosts.total || 0;
  const baselineTotalCosts = baselineDeliveryCost + baselineWorkCosts + baselineFixedCosts;
  const baselineNet = baseline.metrics?.monthlyNetSurplus || 0;

  for (let i = 0; i < 12; i++) {
    const forecastDate = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const monthLabel = forecastDate.toLocaleDateString('en-US', {
      month: 'short',
      year: 'numeric',
    });

    // Determine if scenario adjustments apply this month
    const monthIndex = i + 1;
    const scenarioActive = monthIndex > timingOffset;

    // Get baseline forecast for this month
    const baselineForecastPoint = (baselineForecast || [])[i] || {};

    let monthRevenue, monthCosts, monthNet;

    if (scenarioActive) {
      // Apply scenario adjustments
      monthRevenue = scenarioMetrics.adjustedMonthlyRevenue;
      monthCosts = scenarioMetrics.adjustedTotalCosts;
      monthNet = scenarioMetrics.monthlyNetSurplus;
    } else {
      // Use baseline values
      monthRevenue = baselineRevenue;
      monthCosts = baselineTotalCosts;
      monthNet = baselineNet;
    }

    // Apply one-time expense in the specified month
    let oneTimeImpact = 0;
    if (monthIndex === oneTimeExpenseMonth && oneTimeExpense > 0) {
      oneTimeImpact = oneTimeExpense;
    }

    // Add expected funding in the funding month
    let additionalFunding = 0;
    if (cash.fundingDate) {
      const fundingMonth = new Date(cash.fundingDate).getMonth();
      const fundingYear = new Date(cash.fundingDate).getFullYear();
      if (forecastDate.getMonth() === fundingMonth &&
          forecastDate.getFullYear() === fundingYear) {
        additionalFunding = cash.expectedFunding || 0;
      }
    }

    runningCash = runningCash + monthNet - oneTimeImpact + additionalFunding;

    scenarioForecast.push({
      month: monthIndex,
      monthLabel,
      revenue: Math.round(monthRevenue * 100) / 100,
      costs: Math.round(monthCosts * 100) / 100,
      cashBalance: Math.round(runningCash * 100) / 100,
      netSurplus: Math.round(monthNet * 100) / 100,
      baselineRevenue: Math.round((baselineForecastPoint.revenue || baselineRevenue) * 100) / 100,
      baselineCosts: Math.round((baselineForecastPoint.costs || baselineTotalCosts) * 100) / 100,
      baselineCashBalance: Math.round((baselineForecastPoint.cashBalance || 0) * 100) / 100,
    });
  }

  this.scenarioForecast = scenarioForecast;
  return scenarioForecast;
};

/**
 * Check if this scenario represents a positive outcome
 */
ScenarioSchema.methods.isPositiveOutcome = function() {
  const { scenarioMetrics } = this;
  return scenarioMetrics.surplusDelta > 0 ||
    (scenarioMetrics.runwayDelta !== null && scenarioMetrics.runwayDelta > 0);
};

/**
 * Get a summary of what this scenario represents
 */
ScenarioSchema.methods.getSummary = function() {
  const { levers, scenarioMetrics } = this;
  const changes = [];

  if (levers.pricingAdjustment !== 0) {
    const direction = levers.pricingAdjustment > 0 ? 'increase' : 'decrease';
    changes.push(`${Math.abs(levers.pricingAdjustment)}% pricing ${direction}`);
  }
  if (levers.volumeAdjustment !== 0) {
    const direction = levers.volumeAdjustment > 0 ? 'increase' : 'decrease';
    changes.push(`${Math.abs(levers.volumeAdjustment)}% volume ${direction}`);
  }
  if (levers.workCostAdjustment !== 0) {
    const direction = levers.workCostAdjustment > 0 ? 'increase' : 'decrease';
    changes.push(`${Math.abs(levers.workCostAdjustment)}% work cost ${direction}`);
  }
  if (levers.fixedCostAdjustment !== 0) {
    const direction = levers.fixedCostAdjustment > 0 ? 'increase' : 'decrease';
    changes.push(`${Math.abs(levers.fixedCostAdjustment)}% fixed cost ${direction}`);
  }
  if (levers.additionalMonthlyCost > 0) {
    changes.push(`+$${levers.additionalMonthlyCost}/mo (${levers.additionalMonthlyCostDescription || 'additional cost'})`);
  }
  if (levers.oneTimeExpense > 0) {
    changes.push(`$${levers.oneTimeExpense} one-time expense`);
  }

  return {
    changes,
    impact: {
      revenueDelta: scenarioMetrics.revenueDelta,
      surplusDelta: scenarioMetrics.surplusDelta,
      runwayDelta: scenarioMetrics.runwayDelta,
    },
    isPositive: this.isPositiveOutcome(),
  };
};

module.exports = mongoose.model('Scenario', ScenarioSchema);
