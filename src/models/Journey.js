const mongoose = require('mongoose');

const JourneySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    jid: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    status: { type: String, enum: ['active', 'archived'], default: 'active', index: true },
    startedAt: { type: Date, default: Date.now },
    defaultJourney: { type: Boolean, default: false, index: true },
    reviewCadence: {
      weekly: { type: Boolean, default: true },
      monthly: { type: Boolean, default: false },
      quarterly: { type: Boolean, default: false },
      dayOfWeek: { type: Number, default: 1 }, // 0-6 (Mon default = 1)
      dayOfMonth: { type: Number, default: 1 }, // 1-28
      quarterMonth: { type: Number, default: 1 }, // 1-3 (which month of quarter: 1=first, 2=second, 3=third)
    },
    links: {
      onboardingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Onboarding', default: null },
      planId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', default: null },
    },
  },
  { timestamps: true }
);

JourneySchema.index({ user: 1, name: 1 });
JourneySchema.index({ user: 1, defaultJourney: 1 });

module.exports = mongoose.model('Journey', JourneySchema);

