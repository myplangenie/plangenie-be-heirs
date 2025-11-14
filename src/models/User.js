const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema(
  {
    // Prefer first/last name going forward; keep fullName for compatibility
    firstName: { type: String, trim: true, default: '' },
    lastName: { type: String, trim: true, default: '' },
    fullName: { type: String, trim: true },
    companyName: { type: String, trim: true, default: '' },

    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, select: false },
    isVerified: { type: Boolean, default: false },
    verificationCode: { type: String, select: false },
    verificationExpires: { type: Date, select: false },

    // Onboarding: user profile (relaxed to allow broader options)
    role: { type: String, trim: true, default: undefined },
    builtPlanBefore: { type: Boolean, default: undefined },
    planningGoal: { type: String, trim: true, default: undefined },
    includePersonalPlanning: { type: Boolean, default: undefined },

    // Additional profile fields (previously on Dashboard.profile)
    jobTitle: { type: String, default: '' },
    phone: { type: String, default: '' },
    avatarUrl: { type: String, default: '' },

    // Onboarding completion flag: set true once user reaches dashboard via flow
    onboardingDone: { type: Boolean, default: false },

    // Admin controls and activity tracking
    isAdmin: { type: Boolean, default: false },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
    lastActiveAt: { type: Date },
  },
  { timestamps: true }
);

UserSchema.methods.toSafeJSON = function toSafeJSON() {
  const obj = this.toObject({ versionKey: false });
  delete obj.password;
  return obj;
};

UserSchema.statics.hashPassword = async function (plain) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(plain, salt);
};

UserSchema.methods.comparePassword = async function (plain) {
  return bcrypt.compare(plain, this.password);
};

module.exports = mongoose.model('User', UserSchema);
