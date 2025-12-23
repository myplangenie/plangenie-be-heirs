const mongoose = require('mongoose');

const AssumptionHistorySchema = new mongoose.Schema(
  {
    version: { type: Number, required: true },
    value: { type: String, default: '' },
    changedAt: { type: Date, default: Date.now },
    changedBy: { type: String }, // user id or email
    decisionId: { type: String },
  },
  { _id: false }
);

const AssumptionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    journey: { type: mongoose.Schema.Types.ObjectId, ref: 'Journey', required: true, index: true },
    aid: { type: String, required: true, unique: true },
    key: { type: String, required: true }, // unique per journey
    label: { type: String, default: '' },
    category: { type: String, enum: ['revenue','cost','headcount','pricing','other'], default: 'other', index: true },
    unit: { type: String, default: '' },
    currentValue: { type: String, default: '' },
    source: { type: String, enum: ['manual','ai','import'], default: 'manual' },
    history: [AssumptionHistorySchema],
  },
  { timestamps: true }
);

AssumptionSchema.index({ user: 1, journey: 1, key: 1 }, { unique: true });

module.exports = mongoose.model('Assumption', AssumptionSchema);

