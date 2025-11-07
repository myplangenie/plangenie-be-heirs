const mongoose = require('mongoose');

const UserProfileSchema = new mongoose.Schema(
  {
    fullName: { type: String, trim: true },
    // Relax validation to allow a broader set of roles
    role: { type: String, trim: true },
    roleOther: { type: String, trim: true },
    builtPlanBefore: { type: Boolean },
    // Relax planningGoal to allow expanded options
    planningGoal: { type: String, trim: true },
    planningGoalOther: { type: String, trim: true },
    includePersonalPlanning: { type: Boolean },
    planningFor: { type: String, enum: ['personal', 'business'] },
  },
  { _id: false }
);

const BusinessProfileSchema = new mongoose.Schema(
  {
    businessName: { type: String, trim: true },
    businessStage: { type: String, trim: true },
    industry: { type: String },
    industryOther: { type: String },
    country: { type: String },
    city: { type: String },
    ventureType: { type: String, trim: true },
    teamSize: { type: String }, // categorical
    funding: { type: Boolean },
    tools: [{ type: String }],
    connectTools: { type: Boolean },
    description: { type: String },
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
