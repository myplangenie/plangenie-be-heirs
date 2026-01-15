const mongoose = require('mongoose');

// Central subscription record for a user. One active record per user.
// Tracks Stripe identifiers and lifecycle/status.
const SubscriptionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    // Plan info (assume monthly Pro by default)
    // Note: 'Lite' is a paid tier with reduced entitlements
    planType: { type: String, enum: ['Free', 'Lite', 'Trial', 'Pro', 'Enterprise'], default: 'Pro', index: true },
    currency: { type: String, default: 'usd' },
    amountCents: { type: Number, default: 0 },

    // Stripe identifiers
    stripeCustomerId: { type: String, index: true },
    stripeSubscriptionId: { type: String, index: true },
    stripePriceId: { type: String },
    stripeProductId: { type: String },

    // Workspace add-on tracking
    workspaceSlots: {
      included: { type: Number, default: 1 },    // Base slots included with plan
      purchased: { type: Number, default: 0 },   // Add-on slots purchased
      total: { type: Number, default: 1 },       // Computed: included + purchased
    },
    stripeWorkspaceAddonSubscriptionId: { type: String, index: true },
    stripeWorkspaceAddonPriceId: { type: String },

    // Lifecycle timeline
    currentPeriodStart: { type: Date },
    currentPeriodEnd: { type: Date },
    renewalDate: { type: Date },
    cancelAtPeriodEnd: { type: Boolean, default: false },

    // Status reflects overall subscription state
    status: {
      type: String,
      enum: [
        'none',
        'initialized',
        'active',
        'trialing',
        'past_due',
        'canceled',
        'incomplete',
        'incomplete_expired',
        'unpaid',
      ],
      default: 'none',
      index: true,
    },

    // Deprecated: kept for backward compatibility with any existing reads
    paymentStatus: { type: String, enum: ['active', 'pending', 'overdue'], default: 'active', index: true },
  },
  { timestamps: true }
);

SubscriptionSchema.index({ user: 1 }, { unique: true });

module.exports = mongoose.model('Subscription', SubscriptionSchema);
