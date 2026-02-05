const mongoose = require('mongoose');

/**
 * OKR Model
 *
 * Represents an Objective and its associated Key Results.
 * Each OKR has one objective and multiple key results.
 */

const KeyResultSchema = new mongoose.Schema({
  text: {
    type: String,
    required: true,
    trim: true,
  },
  progress: {
    type: Number,
    default: 0,
    min: 0,
    max: 100,
  },
  status: {
    type: String,
    enum: ['not_started', 'in_progress', 'completed', 'deferred'],
    default: 'not_started',
  },
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
  // The Objective
  objective: {
    type: String,
    required: true,
    trim: true,
  },
  // Key Results for this objective
  keyResults: {
    type: [KeyResultSchema],
    default: [],
  },
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
