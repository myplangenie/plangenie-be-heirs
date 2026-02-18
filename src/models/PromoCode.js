const mongoose = require('mongoose');

const promoCodeSchema = new mongoose.Schema(
  {
    // The promo code string (e.g., "WORKSHOP14", "PGFREE14")
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    // Type of promo code
    type: {
      type: String,
      enum: ['free_trial', 'discount', 'bypass'],
      default: 'free_trial',
    },
    // Which plan this grants access to
    planType: {
      type: String,
      enum: ['Lite', 'Pro'],
      default: 'Lite',
    },
    // Duration in days (for free trials)
    durationDays: {
      type: Number,
      default: 14,
    },
    // Discount percentage (for discount type)
    discountPercent: {
      type: Number,
      default: 100,
      min: 0,
      max: 100,
    },
    // Maximum number of times this code can be used (null = unlimited)
    usageLimit: {
      type: Number,
      default: null,
    },
    // Current usage count
    usageCount: {
      type: Number,
      default: 0,
    },
    // When this promo code expires (null = never)
    expiresAt: {
      type: Date,
      default: null,
    },
    // Whether this code is currently active
    isActive: {
      type: Boolean,
      default: true,
    },
    // Description/notes for admin reference
    description: {
      type: String,
      default: '',
    },
    // Track which users have redeemed this code
    redemptions: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        redeemedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

// Index for fast lookups (code index is already created by unique: true)
promoCodeSchema.index({ isActive: 1, expiresAt: 1 });

// Check if promo code is valid and can be used
promoCodeSchema.methods.isValid = function () {
  // Must be active
  if (!this.isActive) return { valid: false, reason: 'Code is inactive' };

  // Check expiration
  if (this.expiresAt && new Date() > this.expiresAt) {
    return { valid: false, reason: 'Code has expired' };
  }

  // Check usage limit
  if (this.usageLimit !== null && this.usageCount >= this.usageLimit) {
    return { valid: false, reason: 'Code usage limit reached' };
  }

  return { valid: true };
};

// Check if a specific user has already redeemed this code
promoCodeSchema.methods.hasUserRedeemed = function (userId) {
  return this.redemptions.some(
    (r) => r.user && r.user.toString() === userId.toString()
  );
};

// Record a redemption
promoCodeSchema.methods.recordRedemption = async function (userId) {
  this.usageCount += 1;
  this.redemptions.push({ user: userId, redeemedAt: new Date() });
  await this.save();
};

// Static method to find and validate a promo code
promoCodeSchema.statics.findAndValidate = async function (code, userId = null) {
  if (!code || typeof code !== 'string') {
    return { valid: false, reason: 'Code not found' };
  }

  const promoCode = await this.findOne({
    code: code.toUpperCase().trim(),
  });

  if (!promoCode) {
    return { valid: false, reason: 'Code not found' };
  }

  const validity = promoCode.isValid();
  if (!validity.valid) {
    return validity;
  }

  // Check if user already redeemed (if userId provided)
  if (userId && promoCode.hasUserRedeemed(userId)) {
    return { valid: false, reason: 'You have already used this code' };
  }

  return {
    valid: true,
    promoCode,
    planType: promoCode.planType,
    durationDays: promoCode.durationDays,
    discountPercent: promoCode.discountPercent,
    type: promoCode.type,
  };
};

module.exports = mongoose.model('PromoCode', promoCodeSchema);
