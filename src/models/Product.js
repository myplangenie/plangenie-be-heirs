const mongoose = require('mongoose');

/**
 * Product Model
 *
 * Represents a product or service offered by the organization.
 * Stored as individual documents instead of embedded in onboarding.answers.products array.
 */

const ProductSchema = new mongoose.Schema({
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
  // Legacy string price field (e.g., "$100")
  pricing: {
    type: String,
    trim: true,
  },
  // Numeric price per unit
  price: {
    type: String,
    trim: true,
  },
  // Cost per unit
  unitCost: {
    type: String,
    trim: true,
  },
  // Expected monthly volume
  monthlyVolume: {
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
ProductSchema.index({ workspace: 1, isDeleted: 1, order: 1 });
ProductSchema.index({ user: 1, workspace: 1 });

// Soft delete method
ProductSchema.methods.softDelete = function() {
  this.isDeleted = true;
  this.deletedAt = new Date();
  return this.save();
};

// Restore method
ProductSchema.methods.restore = function() {
  this.isDeleted = false;
  this.deletedAt = undefined;
  return this.save();
};

// Static method to get next order number
ProductSchema.statics.getNextOrder = async function(workspaceId) {
  const last = await this.findOne({
    workspace: workspaceId,
    isDeleted: false,
  }).sort({ order: -1 }).lean();
  return (last?.order ?? -1) + 1;
};

module.exports = mongoose.model('Product', ProductSchema);
