const mongoose = require('mongoose');

/**
 * VisionGoal Model
 *
 * Represents an individual vision goal (1-year or 3-year).
 * Stored as individual documents instead of newline-separated strings in onboarding.answers.
 */

const VisionGoalSchema = new mongoose.Schema({
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
  // Type of goal: '1y' for 1-year goals, '3y' for 3-year goals
  goalType: {
    type: String,
    required: true,
    enum: ['1y', '3y'],
    index: true,
  },
  // The goal text
  text: {
    type: String,
    required: true,
    trim: true,
  },
  // Optional notes or details
  notes: {
    type: String,
    trim: true,
  },
  // Progress status
  status: {
    type: String,
    enum: ['not_started', 'in_progress', 'completed', 'deferred'],
    default: 'not_started',
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
VisionGoalSchema.index({ workspace: 1, goalType: 1, isDeleted: 1, order: 1 });
VisionGoalSchema.index({ user: 1, workspace: 1 });

// Soft delete method
VisionGoalSchema.methods.softDelete = function() {
  this.isDeleted = true;
  this.deletedAt = new Date();
  return this.save();
};

// Restore method
VisionGoalSchema.methods.restore = function() {
  this.isDeleted = false;
  this.deletedAt = undefined;
  return this.save();
};

// Static method to get next order number
VisionGoalSchema.statics.getNextOrder = async function(workspaceId, goalType) {
  const last = await this.findOne({
    workspace: workspaceId,
    goalType,
    isDeleted: false,
  }).sort({ order: -1 }).lean();
  return (last?.order ?? -1) + 1;
};

// Static method to get goals as newline-separated string (for backward compatibility)
VisionGoalSchema.statics.getAsString = async function(workspaceId, goalType) {
  const goals = await this.find({
    workspace: workspaceId,
    goalType,
    isDeleted: false,
  }).sort({ order: 1 }).lean();
  return goals.map(g => g.text).join('\n');
};

module.exports = mongoose.model('VisionGoal', VisionGoalSchema);
