const mongoose = require('mongoose');
const crypto = require('crypto');

const RefreshTokenSchema = new mongoose.Schema(
  {
    // Opaque token string (not a JWT)
    token: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    // User this token belongs to
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // Token expiration
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    // Token family for rotation detection (prevents replay attacks)
    family: {
      type: String,
      required: true,
      index: true,
    },
    // Whether this token has been used (for rotation tracking)
    used: {
      type: Boolean,
      default: false,
    },
    // Optional: client info for audit
    userAgent: { type: String },
    ipAddress: { type: String },
  },
  { timestamps: true }
);

// TTL index to auto-delete expired tokens
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Generate a secure opaque token (128 hex chars = 64 bytes)
RefreshTokenSchema.statics.generateToken = function () {
  return crypto.randomBytes(64).toString('hex');
};

// Generate a token family identifier
RefreshTokenSchema.statics.generateFamily = function () {
  return crypto.randomBytes(16).toString('hex');
};

module.exports = mongoose.model('RefreshToken', RefreshTokenSchema);
