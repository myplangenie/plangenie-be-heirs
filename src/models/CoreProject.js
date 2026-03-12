const mongoose = require('mongoose');

const DeliverableSchema = new mongoose.Schema({
  text: { type: String, required: true },
  done: { type: Boolean, default: false },
  kpi: { type: String },
  dueWhen: { type: String },
  ownerId: { type: String },
  ownerName: { type: String },
}, { _id: true });

const CoreProjectSchema = new mongoose.Schema({
  // Ownership
  workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

  // Project identification
  title: { type: String, required: true },
  description: { type: String }, // The full original text from suggestions

  // Project details
  goal: { type: String },
  cost: { type: String },
  dueWhen: { type: String },
  priority: { type: String, enum: ['high', 'medium', 'low', null] },

  // Owner assignment
  ownerId: { type: String },
  ownerName: { type: String },

  // Executive sponsor and responsible lead (explicit fields)
  executiveSponsorName: { type: String },
  responsibleLeadName: { type: String },

  // Relationships
  linkedGoals: [{ type: Number }], // Indices of linked 1-year goals (legacy)
  // Link to a single Core Key Result (system rule)
  linkedCoreOKR: { type: mongoose.Schema.Types.ObjectId, ref: 'OKR' },
  linkedCoreKrId: { type: mongoose.Schema.Types.ObjectId },
  departments: [{ type: String }], // Legacy department keys/labels (kept for compatibility)
  departmentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Department' }], // Preferred id-based linkage
  relatedProjects: [{ type: mongoose.Schema.Types.ObjectId, ref: 'CoreProject' }],

  // Deliverables (sub-documents with their own IDs)
  deliverables: [DeliverableSchema],

  // Ordering for display
  order: { type: Number, default: 0 },

  // Soft delete - allows recovery
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Compound indexes for efficient queries
CoreProjectSchema.index({ workspace: 1, isDeleted: 1, order: 1 });
CoreProjectSchema.index({ workspace: 1, isDeleted: 1, createdAt: -1 });

// Virtual for owner display name
CoreProjectSchema.virtual('ownerDisplayName').get(function() {
  return this.ownerName || 'Unassigned';
});

// Instance method to soft delete
CoreProjectSchema.methods.softDelete = function() {
  this.isDeleted = true;
  this.deletedAt = new Date();
  return this.save();
};

// Instance method to restore
CoreProjectSchema.methods.restore = function() {
  this.isDeleted = false;
  this.deletedAt = null;
  return this.save();
};

// Static method to find active projects for a workspace
CoreProjectSchema.statics.findActiveByWorkspace = function(workspaceId) {
  return this.find({ workspace: workspaceId, isDeleted: false }).sort({ order: 1 });
};

// Static method to get next order number
CoreProjectSchema.statics.getNextOrder = async function(workspaceId) {
  const last = await this.findOne({ workspace: workspaceId, isDeleted: false })
    .sort({ order: -1 })
    .select('order')
    .lean();
  return (last?.order ?? -1) + 1;
};

// Pre-save hook to set order if not provided
CoreProjectSchema.pre('save', async function(next) {
  if (this.isNew && (this.order === undefined || this.order === null)) {
    this.order = await this.constructor.getNextOrder(this.workspace);
  }
  next();
});

module.exports = mongoose.model('CoreProject', CoreProjectSchema);
