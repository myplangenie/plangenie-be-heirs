const mongoose = require('mongoose');

/**
 * Financial Baseline Model
 *
 * Represents the confirmed financial reality for a workspace.
 * Revenue comes from RevenueStreams (aggregated, not entered here).
 * Costs are split into two intuitive buckets:
 * - "Costs that happen because we do the work" (variable/work-related)
 * - "Costs we pay no matter what" (fixed overhead)
 *
 * The baseline only changes when the user explicitly confirms a change.
 */

const FinancialBaselineSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  workspace: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    index: true,
  },

  // Revenue (aggregated from RevenueStreams - NOT entered directly)
  revenue: {
    totalMonthlyRevenue: { type: Number, default: 0 },
    totalMonthlyDeliveryCost: { type: Number, default: 0 },
    streamCount: { type: Number, default: 0 },
    lastSyncedAt: { type: Date, default: null },
  },

  // Cost Bucket 1: "Costs that happen because we do the work"
  // These scale with activity - more work means more cost
  workRelatedCosts: {
    total: { type: Number, default: 0 },
    // Optional breakdown (user can provide just total or breakdown)
    contractors: { type: Number, default: 0 },
    materials: { type: Number, default: 0 },
    commissions: { type: Number, default: 0 },
    shipping: { type: Number, default: 0 },
    other: { type: Number, default: 0 },
  },

  // Cost Bucket 2: "Costs we pay no matter what"
  // Fixed monthly costs regardless of revenue
  fixedCosts: {
    total: { type: Number, default: 0 },
    // Optional breakdown
    salaries: { type: Number, default: 0 },
    rent: { type: Number, default: 0 },
    software: { type: Number, default: 0 },
    insurance: { type: Number, default: 0 },
    utilities: { type: Number, default: 0 },
    marketing: { type: Number, default: 0 },
    other: { type: Number, default: 0 },
  },

  // Cash Position
  cash: {
    currentBalance: { type: Number, default: 0 },
    expectedFunding: { type: Number, default: 0 },
    fundingDate: { type: Date, default: null },
    fundingType: { type: String, enum: ['investment', 'loan', 'grant', null], default: null },
  },

  // Calculated Metrics (computed on save/sync)
  metrics: {
    // Monthly net surplus (revenue - all costs)
    monthlyNetSurplus: { type: Number, default: 0 },
    // EBITDA-style operating result
    operatingResult: { type: Number, default: 0 },
    // Months of runway at current burn rate
    cashRunwayMonths: { type: Number, default: null },
    // Revenue needed to break even
    breakEvenRevenue: { type: Number, default: null },
    // Monthly burn rate (if negative)
    monthlyBurnRate: { type: Number, default: 0 },
    // Gross profit (revenue - delivery costs - work-related costs)
    grossProfit: { type: Number, default: 0 },
    // Gross margin percentage
    grossMarginPercent: { type: Number, default: 0 },
    // Net margin percentage
    netMarginPercent: { type: Number, default: 0 },
  },

  // 12-month forecast (calculated)
  forecast: [{
    month: { type: Number }, // 1-12
    monthLabel: { type: String }, // "Jan 2024"
    revenue: { type: Number, default: 0 },
    costs: { type: Number, default: 0 },
    cashBalance: { type: Number, default: 0 },
    netSurplus: { type: Number, default: 0 },
  }],

  // Confirmation tracking
  lastConfirmedAt: { type: Date, default: null },
  lastConfirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

}, {
  timestamps: true,
});

// Compound index for efficient queries
FinancialBaselineSchema.index({ user: 1, workspace: 1 }, { unique: true });

/**
 * Calculate all metrics based on current data
 */
FinancialBaselineSchema.methods.calculateMetrics = function() {
  const { revenue, workRelatedCosts, fixedCosts, cash } = this;

  // Get totals
  const monthlyRevenue = revenue.totalMonthlyRevenue || 0;
  const deliveryCost = revenue.totalMonthlyDeliveryCost || 0;
  const workCosts = workRelatedCosts.total || 0;
  const fixedTotal = fixedCosts.total || 0;

  // Gross profit = Revenue - Delivery costs - Work-related costs
  const grossProfit = monthlyRevenue - deliveryCost - workCosts;

  // Net surplus = Gross profit - Fixed costs
  const monthlyNetSurplus = grossProfit - fixedTotal;

  // Operating result (EBITDA-style) = same as net surplus for simplicity
  const operatingResult = monthlyNetSurplus;

  // Margins
  const grossMarginPercent = monthlyRevenue > 0
    ? (grossProfit / monthlyRevenue) * 100
    : 0;
  const netMarginPercent = monthlyRevenue > 0
    ? (monthlyNetSurplus / monthlyRevenue) * 100
    : 0;

  // Burn rate (positive number if losing money)
  const monthlyBurnRate = monthlyNetSurplus < 0
    ? Math.abs(monthlyNetSurplus)
    : 0;

  // Cash runway
  let cashRunwayMonths = null;
  const currentCash = (cash.currentBalance || 0) + (cash.expectedFunding || 0);
  if (monthlyBurnRate > 0) {
    cashRunwayMonths = Math.floor(currentCash / monthlyBurnRate);
  } else if (monthlyNetSurplus >= 0) {
    cashRunwayMonths = 999; // Effectively infinite if profitable
  }

  // Break-even revenue (revenue needed to cover all costs)
  const totalCosts = deliveryCost + workCosts + fixedTotal;
  const breakEvenRevenue = totalCosts;

  this.metrics = {
    monthlyNetSurplus: Math.round(monthlyNetSurplus * 100) / 100,
    operatingResult: Math.round(operatingResult * 100) / 100,
    cashRunwayMonths,
    breakEvenRevenue: Math.round(breakEvenRevenue * 100) / 100,
    monthlyBurnRate: Math.round(monthlyBurnRate * 100) / 100,
    grossProfit: Math.round(grossProfit * 100) / 100,
    grossMarginPercent: Math.round(grossMarginPercent * 100) / 100,
    netMarginPercent: Math.round(netMarginPercent * 100) / 100,
  };

  return this.metrics;
};

/**
 * Generate 12-month forecast based on current metrics
 */
FinancialBaselineSchema.methods.generateForecast = function() {
  const { revenue, workRelatedCosts, fixedCosts, cash, metrics } = this;

  const monthlyRevenue = revenue.totalMonthlyRevenue || 0;
  const totalCosts = (revenue.totalMonthlyDeliveryCost || 0) +
    (workRelatedCosts.total || 0) +
    (fixedCosts.total || 0);
  const monthlyNet = metrics.monthlyNetSurplus || 0;

  const forecast = [];
  let runningCash = (cash.currentBalance || 0);
  const now = new Date();

  for (let i = 0; i < 12; i++) {
    const forecastDate = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const monthLabel = forecastDate.toLocaleDateString('en-US', {
      month: 'short',
      year: 'numeric',
    });

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

    runningCash = runningCash + monthlyNet + additionalFunding;

    forecast.push({
      month: i + 1,
      monthLabel,
      revenue: Math.round(monthlyRevenue * 100) / 100,
      costs: Math.round(totalCosts * 100) / 100,
      cashBalance: Math.round(runningCash * 100) / 100,
      netSurplus: Math.round(monthlyNet * 100) / 100,
    });
  }

  this.forecast = forecast;
  return forecast;
};

/**
 * Sync revenue from RevenueStreams
 */
FinancialBaselineSchema.methods.syncRevenueFromStreams = async function() {
  const RevenueStream = require('./RevenueStream');
  const aggregate = await RevenueStream.getAggregate(this.user, this.workspace);

  this.revenue = {
    totalMonthlyRevenue: aggregate.totalMonthlyRevenue,
    totalMonthlyDeliveryCost: aggregate.totalMonthlyDeliveryCost,
    streamCount: aggregate.streamCount,
    lastSyncedAt: new Date(),
  };

  return this.revenue;
};

// Pre-save hook to calculate metrics and forecast
FinancialBaselineSchema.pre('save', function(next) {
  this.calculateMetrics();
  this.generateForecast();
  next();
});

// Static method to get or create baseline for a workspace
FinancialBaselineSchema.statics.getOrCreate = async function(userId, workspaceId) {
  let baseline = await this.findOne({ user: userId, workspace: workspaceId });
  if (!baseline) {
    baseline = new this({ user: userId, workspace: workspaceId });
    await baseline.syncRevenueFromStreams();
    await baseline.save();
  }
  return baseline;
};

module.exports = mongoose.model('FinancialBaseline', FinancialBaselineSchema);
