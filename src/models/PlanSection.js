const mongoose = require('mongoose');

const PlanSectionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    sid: { type: String, required: true, index: true },
    name: String,
    complete: { type: Number, default: 0 },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

PlanSectionSchema.index({ user: 1, order: 1 });

module.exports = mongoose.model('PlanSection', PlanSectionSchema);

