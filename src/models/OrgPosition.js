const mongoose = require('mongoose');

/**
 * OrgPosition Model
 *
 * Represents a position in the organizational chart.
 * Stored as individual documents instead of embedded in onboarding.answers.orgPositions array.
 */

const OrgPositionSchema = new mongoose.Schema({
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
  // Position/title (e.g., "CEO", "Marketing Manager")
  position: {
    type: String,
    required: true,
    trim: true,
  },
  // Role description
  role: {
    type: String,
    trim: true,
    default: '',
  },
  // Person's name filling this position
  name: {
    type: String,
    trim: true,
    default: '',
  },
  // Department this position belongs to
  department: {
    type: String,
    trim: true,
  },
  // Parent position ID (for org chart hierarchy)
  parentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'OrgPosition',
    default: null,
  },
  // Legacy string parent ID for migration compatibility
  legacyParentId: {
    type: String,
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
OrgPositionSchema.index({ workspace: 1, isDeleted: 1, order: 1 });
OrgPositionSchema.index({ workspace: 1, parentId: 1 });
OrgPositionSchema.index({ user: 1, workspace: 1 });

// Soft delete method
OrgPositionSchema.methods.softDelete = function() {
  this.isDeleted = true;
  this.deletedAt = new Date();
  return this.save();
};

// Restore method
OrgPositionSchema.methods.restore = function() {
  this.isDeleted = false;
  this.deletedAt = undefined;
  return this.save();
};

// Static method to get next order number
OrgPositionSchema.statics.getNextOrder = async function(workspaceId) {
  const last = await this.findOne({
    workspace: workspaceId,
    isDeleted: false,
  }).sort({ order: -1 }).lean();
  return (last?.order ?? -1) + 1;
};

// Static method to get org chart as tree
OrgPositionSchema.statics.getOrgTree = async function(workspaceId) {
  const positions = await this.find({
    workspace: workspaceId,
    isDeleted: false,
  }).sort({ order: 1 }).lean();

  // Build tree structure
  const posMap = new Map();
  const roots = [];

  positions.forEach(pos => {
    posMap.set(pos._id.toString(), { ...pos, children: [] });
  });

  positions.forEach(pos => {
    const node = posMap.get(pos._id.toString());
    if (pos.parentId) {
      const parent = posMap.get(pos.parentId.toString());
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    } else {
      roots.push(node);
    }
  });

  return roots;
};

module.exports = mongoose.model('OrgPosition', OrgPositionSchema);
