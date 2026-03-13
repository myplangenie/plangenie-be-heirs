const mongoose = require('mongoose');

/**
 * OKR Model
 *
 * Represents an Objective and its associated Key Results.
 * Each OKR has one objective and multiple key results.
 */

const KeyResultSchema = new mongoose.Schema({
  // Human-readable name of the KR
  text: { type: String, required: true, trim: true },
  // Optional notes for this KR
  notes: { type: String, trim: true },

  // Optional owner for this KR (falls back to OKR owner if unset)
  ownerId: { type: String, trim: true },
  ownerName: { type: String, trim: true },

  // Metric tracking fields (source of truth)
  metric: { type: String, trim: true }, // e.g., 'revenue', 'margin', 'churn', 'growth', 'adoption', 'cost', or custom for departments
  unit: { type: String, trim: true }, // e.g., 'USD', '%', 'users'
  direction: { type: String, enum: ['increase', 'decrease'], default: 'increase' },
  baseline: { type: Number, default: 0 },
  target: { type: Number, default: 0 },
  current: { type: Number, default: 0 },
  startAt: { type: Date },
  endAt: { type: Date },

  // Tagging for department KRs
  linkTag: { type: String, enum: ['driver', 'enablement', 'operational', null], default: null },

  // Ownership flag: true for canonical company metrics on Core KRs
  canonicalMetric: { type: Boolean, default: false },

  // Deprecated manual status/progress fields (ignored by controllers; retained for backward compatibility)
  progress: { type: Number, default: 0, min: 0, max: 100 },
  status: { type: String, enum: ['not_started', 'in_progress', 'completed', 'deferred'], default: 'not_started' },
}, { _id: true });

const OKRSchema = new mongoose.Schema({
  workspace: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    required: true,
    index: true,
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  // OKR classification
  okrType: {
    type: String,
    enum: ['core', 'department'],
    default: 'core',
    index: true,
  },
  // Department ownership for department OKRs
  // departmentId is set when linked to a real Department document
  departmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', index: true },
  // departmentKey is a normalized key (used for scoping/filters) and may exist even when departmentId is unset
  departmentKey: { type: String, trim: true, index: true },
  // departmentLabel is the human-friendly label to display when departmentId is not set
  departmentLabel: { type: String, trim: true },
  // The Objective
  objective: {
    type: String,
    required: true,
    trim: true,
  },
  // Owner (display + optional id)
  ownerId: { type: String, trim: true },
  ownerName: { type: String, trim: true },
  // Key Results for this objective
  keyResults: {
    type: [KeyResultSchema],
    default: [],
  },
  // Core OKRs may be derived from 1-year goals
  derivedFromGoals: [{ type: mongoose.Schema.Types.ObjectId, ref: 'VisionGoal', index: true }],

  // Department OKRs must anchor to a single Core Key Result (contextual influence only)
  anchorCoreOKR: { type: mongoose.Schema.Types.ObjectId, ref: 'OKR', index: true },
  anchorCoreKrId: { type: mongoose.Schema.Types.ObjectId },

  // Optional notes
  notes: {
    type: String,
    trim: true,
  },
  // Overall status
  status: {
    type: String,
    enum: ['not_started', 'in_progress', 'completed', 'deferred'],
    default: 'not_started',
  },
  // Time horizon - useful for linking to goals
  timeframe: {
    type: String,
    enum: ['1y', '3-5y', 'quarterly', 'other'],
    default: '1y',
  },
  order: {
    type: Number,
    default: 0,
  },
  isDeleted: {
    type: Boolean,
    default: false,
  },
  deletedAt: {
    type: Date,
  },
}, {
  timestamps: true,
});

// Compound indexes
OKRSchema.index({ workspace: 1, isDeleted: 1, order: 1 });
OKRSchema.index({ user: 1, workspace: 1 });
OKRSchema.index({ okrType: 1, departmentKey: 1 });

// Soft delete method
OKRSchema.methods.softDelete = function() {
  this.isDeleted = true;
  this.deletedAt = new Date();
  return this.save();
};

// Restore method
OKRSchema.methods.restore = function() {
  this.isDeleted = false;
  this.deletedAt = undefined;
  return this.save();
};

// Static method to get next order number
OKRSchema.statics.getNextOrder = async function(workspaceId) {
  const last = await this.findOne({
    workspace: workspaceId,
    isDeleted: false,
  }).sort({ order: -1 }).lean();
  return (last?.order ?? -1) + 1;
};

// Static method to get all OKRs as formatted text for context
OKRSchema.statics.getAsContextString = async function(workspaceId) {
  const okrs = await this.find({
    workspace: workspaceId,
    isDeleted: false,
  }).sort({ order: 1 }).lean();

  if (!okrs.length) return '';

  return okrs.map((okr, i) => {
    const krs = okr.keyResults.map((kr, j) => `  KR${j + 1}: ${kr.text}`).join('\n');
    return `O${i + 1}: ${okr.objective}\n${krs}`;
  }).join('\n\n');
};

module.exports = mongoose.model('OKR', OKRSchema);
