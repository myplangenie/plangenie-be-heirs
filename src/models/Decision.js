const mongoose = require('mongoose');

const TargetSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['goal','project','assumption','other'], default: 'project' },
    ref: { type: Object }, // flexible reference object (deptKey/index/etc.)
    label: { type: String }, // human-readable snapshot
  },
  { _id: false }
);

const ImpactSchema = new mongoose.Schema(
  {
    assumptionKey: { type: String },
    oldValue: { type: String },
    newValue: { type: String },
    note: { type: String },
  },
  { _id: false }
);

const DecisionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    did: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    context: { type: String, default: '' },
    rationale: { type: String, default: '' },
    decidedAt: { type: Date, default: Date.now },
    decidedBy: { type: String, default: '' },
    status: { type: String, enum: ['proposed','approved','rejected'], default: 'approved', index: true },
    tags: [{ type: String }],
    targets: [TargetSchema],
    impacts: [ImpactSchema],
  },
  { timestamps: true }
);

DecisionSchema.index({ user: 1, workspace: 1, decidedAt: -1 });
DecisionSchema.index({ user: 1, workspace: 1, status: 1 });

module.exports = mongoose.model('Decision', DecisionSchema);

