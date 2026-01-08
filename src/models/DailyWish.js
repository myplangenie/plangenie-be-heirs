const mongoose = require('mongoose');

const DailyWishSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', index: true },
    // The date this wish is for (YYYY-MM-DD format, in ET timezone)
    wishDate: { type: String, required: true, index: true },
    // The AI-generated recommendation
    title: { type: String, required: true },
    message: { type: String, required: true },
    // Optional: category of the recommendation
    category: {
      type: String,
      enum: ['growth', 'operations', 'finance', 'team', 'strategy', 'marketing', 'sales', 'general'],
      default: 'general'
    },
    // Track if email was sent
    emailSent: { type: Boolean, default: false },
    emailSentAt: { type: Date },
    // Track if user has viewed this wish
    viewed: { type: Boolean, default: false },
    viewedAt: { type: Date },
  },
  { timestamps: true }
);

// Ensure one wish per user per workspace per day
DailyWishSchema.index({ user: 1, workspace: 1, wishDate: 1 }, { unique: true });
// For querying recent wishes
DailyWishSchema.index({ user: 1, workspace: 1, createdAt: -1 });

module.exports = mongoose.model('DailyWish', DailyWishSchema);
