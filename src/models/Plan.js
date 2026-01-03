const mongoose = require('mongoose');

const PlanSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', index: true },
    companyLogoUrl: { type: String, default: '' },
  },
  { timestamps: true }
);

// Compound index for user + workspace uniqueness
PlanSchema.index({ user: 1, workspace: 1 }, { unique: true });

module.exports = mongoose.model('Plan', PlanSchema);

