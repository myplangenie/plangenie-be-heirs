const mongoose = require('mongoose');

// Immutable event log for subscription lifecycle and attempts
const SubscriptionHistorySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    subscription: { type: mongoose.Schema.Types.ObjectId, ref: 'Subscription', required: true, index: true },

    // High-level event type capturing intent/outcome
    event: {
      type: String,
      enum: [
        'initialized', // checkout session created
        'completed', // checkout/session completed
        'canceled', // checkout/session canceled/expired
        'payment_failed', // invoice or payment failure
        'activated', // subscription moved/confirmed to active
        'deactivated', // subscription ended/canceled
        'updated', // status/plan update
        'portal_opened', // billing portal session created
        'cancellation_requested', // user requested cancellation at period end
      ],
      required: true,
      index: true,
    },

    // Stripe linkage for diagnostics
    stripeSessionId: { type: String },
    stripeCustomerId: { type: String },
    stripeSubscriptionId: { type: String },
    stripeInvoiceId: { type: String },
    stripePaymentIntentId: { type: String },

    // Free-form details
    reason: { type: String },
    errorMessage: { type: String },
    meta: { type: Object },
  },
  { timestamps: true }
);

SubscriptionHistorySchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('SubscriptionHistory', SubscriptionHistorySchema);

