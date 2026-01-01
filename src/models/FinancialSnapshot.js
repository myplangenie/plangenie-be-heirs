const mongoose = require('mongoose');
const { Schema, Types: { ObjectId } } = mongoose;

const AssumptionSchema = new Schema(
  {
    key: { type: String },
    value: { type: String },
    source: { type: String, enum: ['user', 'default', 'ai'], default: 'user' },
  },
  { _id: false }
);

const FinancialSnapshotSchema = new Schema(
  {
    user: { type: ObjectId, ref: 'User', required: true },
    workspace: { type: ObjectId, ref: 'Workspace' },

    // Revenue Section
    revenue: {
      monthlyRevenue: { type: Number, default: 0 },
      revenueGrowthPct: { type: Number, default: 0 },
      isRecurring: { type: Boolean, default: false },
      recurringPct: { type: Number, default: 0 },
      confidence: { type: Number, default: 0, min: 0, max: 100 },
    },

    // Costs Section
    costs: {
      monthlyCosts: { type: Number, default: 0 },
      fixedCosts: { type: Number, default: 0 },
      variableCostsPct: { type: Number, default: 0 },
      biggestCostCategory: { type: String },
      confidence: { type: Number, default: 0, min: 0, max: 100 },
    },

    // Cash Section
    cash: {
      currentCash: { type: Number, default: 0 },
      monthlyBurn: { type: Number, default: 0 },
      expectedFunding: { type: Number, default: 0 },
      fundingMonth: { type: Number, min: 1, max: 12 },
      confidence: { type: Number, default: 0, min: 0, max: 100 },
    },

    // Calculated Metrics (derived, updated on save)
    metrics: {
      netProfit: { type: Number, default: 0 },
      profitMarginPct: { type: Number, default: 0 },
      monthsOfRunway: { type: Number },
      breakEvenMonth: { type: Number },
      healthScore: { type: Number, default: 0, min: 0, max: 100 },
    },

    // User assumptions/overrides
    assumptions: [AssumptionSchema],

    // Tracking
    lastUpdatedSection: { type: String },
    completedOnboarding: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Unique index per user+workspace (workspace can be null)
FinancialSnapshotSchema.index({ user: 1, workspace: 1 }, { unique: true });

// Pre-save hook to calculate derived metrics
FinancialSnapshotSchema.pre('save', function (next) {
  const r = this.revenue || {};
  const c = this.costs || {};
  const cash = this.cash || {};

  // Net profit
  const monthlyRevenue = r.monthlyRevenue || 0;
  const monthlyCosts = c.monthlyCosts || 0;
  this.metrics.netProfit = monthlyRevenue - monthlyCosts;

  // Profit margin
  this.metrics.profitMarginPct =
    monthlyRevenue > 0
      ? Math.round((this.metrics.netProfit / monthlyRevenue) * 100)
      : 0;

  // Monthly burn (if losing money)
  const monthlyBurn = this.metrics.netProfit < 0 ? Math.abs(this.metrics.netProfit) : 0;
  this.cash.monthlyBurn = monthlyBurn;

  // Months of runway
  const currentCash = cash.currentCash || 0;
  const expectedFunding = cash.expectedFunding || 0;
  if (monthlyBurn > 0) {
    this.metrics.monthsOfRunway = Math.floor((currentCash + expectedFunding) / monthlyBurn);
  } else {
    this.metrics.monthsOfRunway = null; // null = not burning cash
  }

  // Break-even month calculation (if losing money and growing)
  const growthPct = r.revenueGrowthPct || 0;
  if (this.metrics.netProfit < 0 && growthPct > 0 && monthlyRevenue > 0) {
    // months until revenue >= costs at growth rate
    // revenue * (1 + g)^n >= costs
    // n = log(costs/revenue) / log(1 + g)
    const ratio = monthlyCosts / monthlyRevenue;
    if (ratio > 1) {
      const months = Math.ceil(Math.log(ratio) / Math.log(1 + growthPct / 100));
      this.metrics.breakEvenMonth = months;
    } else {
      this.metrics.breakEvenMonth = 0;
    }
  } else {
    this.metrics.breakEvenMonth = null;
  }

  // Health score (weighted average of confidences + profitability factor)
  const rConf = r.confidence || 0;
  const cConf = c.confidence || 0;
  const cashConf = cash.confidence || 0;
  const avgConfidence = (rConf + cConf + cashConf) / 3;
  const profitFactor = this.metrics.netProfit >= 0 ? 20 : 0;
  this.metrics.healthScore = Math.min(100, Math.round(avgConfidence * 0.8 + profitFactor));

  next();
});

module.exports = mongoose.model('FinancialSnapshot', FinancialSnapshotSchema);
