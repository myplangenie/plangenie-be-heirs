const mongoose = require('mongoose');

const SubscriptionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    planType: { type: String, enum: ['Free', 'Trial', 'Pro', 'Enterprise'], default: 'Free', index: true },
    renewalDate: { type: Date },
    paymentStatus: { type: String, enum: ['active', 'pending', 'overdue'], default: 'active', index: true },
    amountCents: { type: Number, default: 0 },
  },
  { timestamps: true }
);

SubscriptionSchema.index({ user: 1 }, { unique: true });

module.exports = mongoose.model('Subscription', SubscriptionSchema);

