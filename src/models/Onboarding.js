const mongoose = require('mongoose');

const UserProfileSchema = new mongoose.Schema(
  {
    fullName: { type: String, trim: true },
    role: { type: String, enum: ['owner', 'founder', 'manager', 'other'] },
    builtPlanBefore: { type: Boolean },
    planningGoal: { type: String, enum: ['start', 'improve', 'invest', 'learn'] },
    includePersonalPlanning: { type: Boolean },
  },
  { _id: false }
);

const BusinessProfileSchema = new mongoose.Schema(
  {
    businessName: { type: String, trim: true },
    businessStage: { type: String, enum: ['pre-launch', 'startup', 'growth', 'established', 'other'] },
    industry: { type: String },
    country: { type: String },
    city: { type: String },
    ventureType: { type: String, enum: ['for-profit', 'nonprofit', 'hybrid'] },
    teamSize: { type: String }, // categorical
    funding: { type: Boolean },
    tools: [{ type: String }],
    connectTools: { type: Boolean },
  },
  { _id: false }
);

const VisionSchema = new mongoose.Schema(
  {
    ubp: { type: String }, // Unique Business Proposition free-text
  },
  { _id: false }
);

const OnboardingSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    userProfile: UserProfileSchema,
    businessProfile: BusinessProfileSchema,
    vision: VisionSchema,
    // Store full onboarding answers snapshot for resilience
    answers: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Onboarding', OnboardingSchema);
