const mongoose = require('mongoose');

const FinancialAssumptionSchema = new mongoose.Schema(
  {
    key: String,
    value: String,
    assumption: String,
    control: { type: String, enum: ['input', 'select'], default: 'input' },
    placeholder: String,
    ai: String,
    aiClass: String,
    rationale: String,
  },
  { _id: false }
);

const FinancialsSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', index: true },
    metrics: {
      monthlyRevenue: String,
      monthlyCosts: String,
      netProfit: String,
      burnRate: String,
    },
    chart: [
      {
        name: String,
        Revenue: Number,
        Cost: Number,
        Profit: Number,
      },
    ],
    revenueBars: [Number],
    cashflowBars: [Number],
    assumptions: [FinancialAssumptionSchema],
  },
  { timestamps: true }
);

// Compound index for user + workspace uniqueness
FinancialsSchema.index({ user: 1, workspace: 1 }, { unique: true });

module.exports = mongoose.model('Financials', FinancialsSchema);
