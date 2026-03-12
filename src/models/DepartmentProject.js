const mongoose = require('mongoose');

const DeliverableSchema = new mongoose.Schema({
  text: { type: String, required: true },
  done: { type: Boolean, default: false },
  kpi: { type: String },
  dueWhen: { type: String },
  ownerId: { type: String },
  ownerName: { type: String },
}, { _id: true });

const DepartmentProjectSchema = new mongoose.Schema({
  // Ownership
  workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

  // Department this project belongs to
  departmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', index: true },
  departmentKey: { type: String, required: true, index: true },

  // Project identification
  title: { type: String },

  // Project details
  goal: { type: String },
  milestone: { type: String },
  resources: { type: String },
  dueWhen: { type: String },
  cost: { type: String },
  priority: { type: String, enum: ['high', 'medium', 'low', null] },

  // Owner assignment (person responsible)
  firstName: { type: String },
  lastName: { type: String },
  ownerId: { type: String },

  // Relationships
  linkedCoreProject: { type: mongoose.Schema.Types.ObjectId, ref: 'CoreProject' },
  linkedGoal: { type: Number }, // Index of linked 1-year goal
  // Link to a single Department Key Result (system rule)
  linkedDeptOKR: { type: mongoose.Schema.Types.ObjectId, ref: 'OKR' },
  linkedDeptKrId: { type: mongoose.Schema.Types.ObjectId },

  // Deliverables (sub-documents with their own IDs)
  deliverables: [DeliverableSchema],

  // Ordering within department
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
DepartmentProjectSchema.index({ workspace: 1, departmentKey: 1, isDeleted: 1, order: 1 });
DepartmentProjectSchema.index({ workspace: 1, departmentId: 1, isDeleted: 1, order: 1 });
DepartmentProjectSchema.index({ workspace: 1, isDeleted: 1, createdAt: -1 });
DepartmentProjectSchema.index({ linkedCoreProject: 1 });

// Virtual for owner full name
DepartmentProjectSchema.virtual('ownerFullName').get(function() {
  if (this.firstName || this.lastName) {
    return `${this.firstName || ''} ${this.lastName || ''}`.trim();
  }
  return 'Unassigned';
});

// Virtual for display title
DepartmentProjectSchema.virtual('displayTitle').get(function() {
  return this.title || this.goal || 'Untitled Project';
});

// Instance method to soft delete
DepartmentProjectSchema.methods.softDelete = function() {
  this.isDeleted = true;
  this.deletedAt = new Date();
  return this.save();
};

// Instance method to restore
DepartmentProjectSchema.methods.restore = function() {
  this.isDeleted = false;
  this.deletedAt = null;
  return this.save();
};

// Static method to find active projects for a workspace
DepartmentProjectSchema.statics.findActiveByWorkspace = function(workspaceId, departmentKey = null) {
  const query = { workspace: workspaceId, isDeleted: false };
  if (departmentKey) {
    query.departmentKey = departmentKey;
  }
  return this.find(query).sort({ departmentKey: 1, order: 1 });
};

// Static method to find active projects by department
DepartmentProjectSchema.statics.findActiveByDepartment = function(workspaceId, departmentKey) {
  return this.find({
    workspace: workspaceId,
    departmentKey: departmentKey,
    isDeleted: false,
  }).sort({ order: 1 });
};

// Static method to get next order number within a department
DepartmentProjectSchema.statics.getNextOrder = async function(workspaceId, departmentKey) {
  const last = await this.findOne({
    workspace: workspaceId,
    departmentKey: departmentKey,
    isDeleted: false,
  })
    .sort({ order: -1 })
    .select('order')
    .lean();
  return (last?.order ?? -1) + 1;
};

// Static method to get projects grouped by department
DepartmentProjectSchema.statics.findGroupedByDepartment = async function(workspaceId) {
  const projects = await this.find({
    workspace: workspaceId,
    isDeleted: false,
  }).sort({ departmentKey: 1, order: 1 }).lean();

  const grouped = {};
  for (const project of projects) {
    if (!grouped[project.departmentKey]) {
      grouped[project.departmentKey] = [];
    }
    grouped[project.departmentKey].push(project);
  }
  return grouped;
};

// Pre-save hook to set order if not provided
DepartmentProjectSchema.pre('save', async function(next) {
  if (this.isNew && (this.order === undefined || this.order === null)) {
    this.order = await this.constructor.getNextOrder(this.workspace, this.departmentKey);
  }
  next();
});

module.exports = mongoose.model('DepartmentProject', DepartmentProjectSchema);
