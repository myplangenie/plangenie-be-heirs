const mongoose = require('mongoose');

const ScenarioOverrideSchema = new mongoose.Schema(
  {
    assumptionKey: { type: String, required: true },
    value: { type: String, default: '' },
  },
  { _id: false }
);

const ScenarioSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    journey: { type: mongoose.Schema.Types.ObjectId, ref: 'Journey', required: true, index: true },
    sid: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    isBaseline: { type: Boolean, default: false },
    overrides: [ScenarioOverrideSchema],
  },
  { timestamps: true }
);

ScenarioSchema.index({ user: 1, journey: 1, name: 1 });

module.exports = mongoose.model('Scenario', ScenarioSchema);

