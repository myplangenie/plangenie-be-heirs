const mongoose = require('mongoose');
const crypto = require('crypto');

/**
 * Revenue Stream Model
 *
 * Represents one way an organization earns money.
 * Supports 7 different stream types, each with type-specific inputs.
 * All types normalize to: estimatedMonthlyRevenue, estimatedMonthlyDeliveryCost, stability
 */

const RevenueStreamSchema = new mongoose.Schema({
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
  rsid: {
    type: String,
    unique: true,
    default: () => `rs_${crypto.randomBytes(6).toString('hex')}`,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    trim: true,
    default: '',
  },
  type: {
    type: String,
    required: true,
    enum: [
      'one_off_project',
      'ongoing_retainer',
      'time_based',
      'product_sales',
      'program_cohort',
      'grants_donations',
      'mixed_unsure',
    ],
  },
  isPrimary: {
    type: Boolean,
    default: false,
  },
  isActive: {
    type: Boolean,
    default: true,
  },

  // Type-specific inputs (only relevant fields populated based on type)
  inputs: {
    // One-off Projects
    projectPrice: { type: Number, default: null },
    projectsPerMonth: { type: Number, default: null },
    deliveryCostPerProject: { type: Number, default: null },

    // Ongoing Retainers
    monthlyFee: { type: Number, default: null },
    numberOfClients: { type: Number, default: null },
    avgClientLifespanMonths: { type: Number, default: null },

    // Time-based Work
    hourlyRate: { type: Number, default: null },
    hoursPerMonth: { type: Number, default: null },
    capacityLimitHours: { type: Number, default: null },

    // Product Sales (current model)
    unitPrice: { type: Number, default: null },
    unitCost: { type: Number, default: null },
    unitsPerMonth: { type: Number, default: null },

    // Programs/Cohorts
    pricePerParticipant: { type: Number, default: null },
    cohortSize: { type: Number, default: null },
    cohortsPerYear: { type: Number, default: null },
    deliveryCostPerCohort: { type: Number, default: null },

    // Grants/Donations
    awardAmount: { type: Number, default: null },
    frequency: {
      type: String,
      enum: ['monthly', 'quarterly', 'annual', 'one_time', null],
      default: null,
    },
    restrictionType: {
      type: String,
      enum: ['unrestricted', 'restricted', 'grant', null],
      default: null,
    },

    // Mixed/Unsure
    approximateMonthlyRevenue: { type: Number, default: null },
    confidenceLevel: {
      type: String,
      enum: ['low', 'medium', 'high', null],
      default: null,
    },
  },

  // Normalized outputs (calculated on save)
  normalized: {
    estimatedMonthlyRevenue: { type: Number, default: 0 },
    estimatedMonthlyDeliveryCost: { type: Number, default: 0 },
    grossMarginPercent: { type: Number, default: 0 },
    stability: {
      type: String,
      enum: ['volatile', 'moderate', 'stable', 'recurring'],
      default: 'moderate',
    },
  },
}, {
  timestamps: true,
});

// Compound index for efficient queries
RevenueStreamSchema.index({ user: 1, workspace: 1 });
RevenueStreamSchema.index({ workspace: 1, isActive: 1 });

/**
 * Calculate normalized values based on stream type and inputs
 */
RevenueStreamSchema.methods.calculateNormalized = function() {
  const { type, inputs } = this;
  let monthlyRevenue = 0;
  let monthlyCost = 0;
  let stability = 'moderate';

  switch (type) {
    case 'one_off_project': {
      const price = inputs.projectPrice || 0;
      const perMonth = inputs.projectsPerMonth || 0;
      const deliveryCost = inputs.deliveryCostPerProject || 0;
      monthlyRevenue = price * perMonth;
      monthlyCost = deliveryCost * perMonth;
      stability = 'volatile';
      break;
    }

    case 'ongoing_retainer': {
      const fee = inputs.monthlyFee || 0;
      const clients = inputs.numberOfClients || 0;
      monthlyRevenue = fee * clients;
      monthlyCost = 0; // Typically absorbed in fixed costs
      stability = 'recurring';
      break;
    }

    case 'time_based': {
      const rate = inputs.hourlyRate || 0;
      const hours = inputs.hoursPerMonth || 0;
      monthlyRevenue = rate * hours;
      monthlyCost = 0; // Time is the cost
      stability = 'moderate';
      break;
    }

    case 'product_sales': {
      const price = inputs.unitPrice || 0;
      const cost = inputs.unitCost || 0;
      const units = inputs.unitsPerMonth || 0;
      monthlyRevenue = price * units;
      monthlyCost = cost * units;
      stability = 'moderate';
      break;
    }

    case 'program_cohort': {
      const pricePerPerson = inputs.pricePerParticipant || 0;
      const size = inputs.cohortSize || 0;
      const cohortsYear = inputs.cohortsPerYear || 0;
      const deliveryCost = inputs.deliveryCostPerCohort || 0;
      // Annualize then divide by 12
      const annualRevenue = pricePerPerson * size * cohortsYear;
      const annualCost = deliveryCost * cohortsYear;
      monthlyRevenue = annualRevenue / 12;
      monthlyCost = annualCost / 12;
      stability = 'moderate';
      break;
    }

    case 'grants_donations': {
      const amount = inputs.awardAmount || 0;
      const freq = inputs.frequency || 'annual';
      // Convert to monthly based on frequency
      const frequencyMultiplier = {
        monthly: 1,
        quarterly: 1 / 3,
        annual: 1 / 12,
        one_time: 1 / 12, // Spread over a year
      };
      monthlyRevenue = amount * (frequencyMultiplier[freq] || 1 / 12);
      monthlyCost = 0;
      stability = freq === 'monthly' ? 'stable' : 'volatile';
      break;
    }

    case 'mixed_unsure': {
      monthlyRevenue = inputs.approximateMonthlyRevenue || 0;
      monthlyCost = 0;
      const conf = inputs.confidenceLevel || 'medium';
      stability = conf === 'high' ? 'stable' : conf === 'low' ? 'volatile' : 'moderate';
      break;
    }

    default:
      break;
  }

  // Calculate gross margin
  const grossMargin = monthlyRevenue > 0
    ? ((monthlyRevenue - monthlyCost) / monthlyRevenue) * 100
    : 0;

  this.normalized = {
    estimatedMonthlyRevenue: Math.round(monthlyRevenue * 100) / 100,
    estimatedMonthlyDeliveryCost: Math.round(monthlyCost * 100) / 100,
    grossMarginPercent: Math.round(grossMargin * 100) / 100,
    stability,
  };

  return this.normalized;
};

// Pre-save hook to calculate normalized values
RevenueStreamSchema.pre('save', function(next) {
  this.calculateNormalized();
  next();
});

// Static method to get aggregate metrics for a workspace
RevenueStreamSchema.statics.getAggregate = async function(userId, workspaceId) {
  const filter = { user: userId, isActive: true };
  if (workspaceId) filter.workspace = workspaceId;

  const streams = await this.find(filter).lean().exec();

  const aggregate = {
    totalMonthlyRevenue: 0,
    totalMonthlyDeliveryCost: 0,
    streamCount: streams.length,
    avgGrossMargin: 0,
    stabilityBreakdown: {
      volatile: 0,
      moderate: 0,
      stable: 0,
      recurring: 0,
    },
  };

  if (streams.length === 0) return aggregate;

  let totalMargin = 0;
  for (const stream of streams) {
    const norm = stream.normalized || {};
    aggregate.totalMonthlyRevenue += norm.estimatedMonthlyRevenue || 0;
    aggregate.totalMonthlyDeliveryCost += norm.estimatedMonthlyDeliveryCost || 0;
    totalMargin += norm.grossMarginPercent || 0;
    const stab = norm.stability || 'moderate';
    if (aggregate.stabilityBreakdown[stab] !== undefined) {
      aggregate.stabilityBreakdown[stab]++;
    }
  }

  aggregate.avgGrossMargin = Math.round((totalMargin / streams.length) * 100) / 100;
  aggregate.totalMonthlyRevenue = Math.round(aggregate.totalMonthlyRevenue * 100) / 100;
  aggregate.totalMonthlyDeliveryCost = Math.round(aggregate.totalMonthlyDeliveryCost * 100) / 100;

  return aggregate;
};

module.exports = mongoose.model('RevenueStream', RevenueStreamSchema);
