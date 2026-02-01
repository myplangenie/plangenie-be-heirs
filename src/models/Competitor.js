const mongoose = require('mongoose');

/**
 * Competitor Model
 *
 * Represents a competitor in the market analysis.
 * Stored as individual documents instead of embedded in onboarding.answers.competitorNames array.
 */

const CompetitorSchema = new mongoose.Schema({
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
  // Competitor name
  name: {
    type: String,
    required: true,
    trim: true,
  },
  // What this competitor does better (competitive advantage)
  advantage: {
    type: String,
    trim: true,
  },
  // What we do better than this competitor (our advantage)
  weDoBetter: {
    type: String,
    trim: true,
  },
  // Website URL
  website: {
    type: String,
    trim: true,
  },
  // Notes about this competitor
  notes: {
    type: String,
    trim: true,
  },
  // Threat level
  threatLevel: {
    type: String,
    enum: ['low', 'medium', 'high', null],
    default: null,
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
CompetitorSchema.index({ workspace: 1, isDeleted: 1, order: 1 });
CompetitorSchema.index({ user: 1, workspace: 1 });

// Soft delete method
CompetitorSchema.methods.softDelete = function() {
  this.isDeleted = true;
  this.deletedAt = new Date();
  return this.save();
};

// Restore method
CompetitorSchema.methods.restore = function() {
  this.isDeleted = false;
  this.deletedAt = undefined;
  return this.save();
};

// Static method to get next order number
CompetitorSchema.statics.getNextOrder = async function(workspaceId) {
  const last = await this.findOne({
    workspace: workspaceId,
    isDeleted: false,
  }).sort({ order: -1 }).lean();
  return (last?.order ?? -1) + 1;
};

// Static method to get competitor names as array (for backward compatibility)
CompetitorSchema.statics.getNamesArray = async function(workspaceId) {
  const competitors = await this.find({
    workspace: workspaceId,
    isDeleted: false,
  }).sort({ order: 1 }).lean();
  return competitors.map(c => c.name);
};

// Static method to get advantages as array (for backward compatibility)
CompetitorSchema.statics.getAdvantagesArray = async function(workspaceId) {
  const competitors = await this.find({
    workspace: workspaceId,
    isDeleted: false,
  }).sort({ order: 1 }).lean();
  return competitors.map(c => c.advantage || '');
};

// Static method to get weDoBetter as array
CompetitorSchema.statics.getWeDoBettersArray = async function(workspaceId) {
  const competitors = await this.find({
    workspace: workspaceId,
    isDeleted: false,
  }).sort({ order: 1 }).lean();
  return competitors.map(c => c.weDoBetter || '');
};

module.exports = mongoose.model('Competitor', CompetitorSchema);
