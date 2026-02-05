const mongoose = require('mongoose');

const StrategyDocumentSchema = new mongoose.Schema({
  // Ownership
  workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // File metadata
  title: { type: String, required: true },
  description: { type: String },
  fileUrl: { type: String, required: true },
  fileKey: { type: String, required: true },
  fileSize: { type: Number },
  mimeType: { type: String },
  originalFilename: { type: String },

  // Categorization (matches document types from requirements)
  category: {
    type: String,
    enum: ['strategy-vision', 'okrs-goals', 'board-decisions', 'operating-plans', 'other'],
    default: 'other',
  },

  // Extracted text content for RAG
  extractedText: { type: String },
  extractionStatus: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending',
  },
  extractionError: { type: String },

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
StrategyDocumentSchema.index({ workspace: 1, isDeleted: 1, order: 1 });
StrategyDocumentSchema.index({ workspace: 1, isDeleted: 1, createdAt: -1 });

// Instance method to soft delete
StrategyDocumentSchema.methods.softDelete = function() {
  this.isDeleted = true;
  this.deletedAt = new Date();
  return this.save();
};

// Instance method to restore
StrategyDocumentSchema.methods.restore = function() {
  this.isDeleted = false;
  this.deletedAt = null;
  return this.save();
};

// Static method to find active documents for a workspace
StrategyDocumentSchema.statics.findActiveByWorkspace = function(workspaceId) {
  return this.find({ workspace: workspaceId, isDeleted: false }).sort({ order: 1 });
};

// Static method to get all extracted text for RAG context
StrategyDocumentSchema.statics.getContextForWorkspace = async function(workspaceId) {
  const docs = await this.find({
    workspace: workspaceId,
    isDeleted: false,
    extractionStatus: 'completed',
    extractedText: { $exists: true, $ne: '' },
  })
    .select('title category extractedText')
    .sort({ category: 1, order: 1 })
    .lean();

  return docs.map(doc => ({
    title: doc.title,
    category: doc.category,
    content: doc.extractedText,
  }));
};

// Static method to get next order number
StrategyDocumentSchema.statics.getNextOrder = async function(workspaceId) {
  const last = await this.findOne({ workspace: workspaceId, isDeleted: false })
    .sort({ order: -1 })
    .select('order')
    .lean();
  return (last?.order ?? -1) + 1;
};

// Pre-save hook to set order if not provided
StrategyDocumentSchema.pre('save', async function(next) {
  if (this.isNew && (this.order === undefined || this.order === null)) {
    this.order = await this.constructor.getNextOrder(this.workspace);
  }
  next();
});

module.exports = mongoose.model('StrategyDocument', StrategyDocumentSchema);
