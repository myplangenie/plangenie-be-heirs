const mongoose = require('mongoose');

const PlanSectionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', index: true },
    sid: { type: String, required: true, index: true },
    name: String,
    complete: { type: Number, default: 0 },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

PlanSectionSchema.index({ user: 1, workspace: 1, order: 1 });
PlanSectionSchema.index({ user: 1, workspace: 1, sid: 1 }, { unique: true });

module.exports = mongoose.model('PlanSection', PlanSectionSchema);

