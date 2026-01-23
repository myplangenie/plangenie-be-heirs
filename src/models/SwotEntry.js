const mongoose = require('mongoose');

/**
 * SwotEntry Model
 *
 * Represents an individual SWOT analysis entry (strength, weakness, opportunity, or threat).
 * Stored as individual documents instead of bulk text fields in onboarding.answers.
 */

const SwotEntrySchema = new mongoose.Schema({
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
  // Type of SWOT entry
  entryType: {
    type: String,
    required: true,
    enum: ['strength', 'weakness', 'opportunity', 'threat'],
    index: true,
  },
  // The entry text
  text: {
    type: String,
    required: true,
    trim: true,
  },
  // Priority/importance level
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', null],
    default: null,
  },
  // Additional notes
  notes: {
    type: String,
    trim: true,
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
SwotEntrySchema.index({ workspace: 1, entryType: 1, isDeleted: 1, order: 1 });
SwotEntrySchema.index({ user: 1, workspace: 1 });

// Soft delete method
SwotEntrySchema.methods.softDelete = function() {
  this.isDeleted = true;
  this.deletedAt = new Date();
  return this.save();
};

// Restore method
SwotEntrySchema.methods.restore = function() {
  this.isDeleted = false;
  this.deletedAt = undefined;
  return this.save();
};

// Static method to get next order number
SwotEntrySchema.statics.getNextOrder = async function(workspaceId, entryType) {
  const last = await this.findOne({
    workspace: workspaceId,
    entryType,
    isDeleted: false,
  }).sort({ order: -1 }).lean();
  return (last?.order ?? -1) + 1;
};

// Static method to get entries as newline-separated string (for backward compatibility)
SwotEntrySchema.statics.getAsString = async function(workspaceId, entryType) {
  const entries = await this.find({
    workspace: workspaceId,
    entryType,
    isDeleted: false,
  }).sort({ order: 1 }).lean();
  return entries.map(e => e.text).join('\n');
};

// Static method to get all SWOT entries grouped by type
SwotEntrySchema.statics.getAllGrouped = async function(workspaceId) {
  const entries = await this.find({
    workspace: workspaceId,
    isDeleted: false,
  }).sort({ entryType: 1, order: 1 }).lean();

  const grouped = {
    strengths: [],
    weaknesses: [],
    opportunities: [],
    threats: [],
  };

  entries.forEach(entry => {
    switch (entry.entryType) {
      case 'strength':
        grouped.strengths.push(entry);
        break;
      case 'weakness':
        grouped.weaknesses.push(entry);
        break;
      case 'opportunity':
        grouped.opportunities.push(entry);
        break;
      case 'threat':
        grouped.threats.push(entry);
        break;
    }
  });

  return grouped;
};

module.exports = mongoose.model('SwotEntry', SwotEntrySchema);
