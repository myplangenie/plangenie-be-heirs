/**
 * Move specified users to the Enterprise plan.
 *
 * Run: node src/scripts/setEnterpriseUsers.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Subscription = require('../models/Subscription');

const ENTERPRISE_EMAILS = [
  'eadelekeife@gmail.com',
  'adelekeifeoluwase@gmail.com',
  'chike@karannagroup.com',
];

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB\n');

  for (const email of ENTERPRISE_EMAILS) {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      console.log(`[SKIP] ${email} — user not found`);
      continue;
    }

    // Update user flags
    user.hasActiveSubscription = true;
    user.planSlug = 'enterprise';
    await user.save();

    // Upsert subscription record
    const sub = await Subscription.findOneAndUpdate(
      { user: user._id },
      {
        $set: {
          planType: 'Enterprise',
          status: 'active',
          amountCents: 0,
          currentPeriodStart: new Date(),
          // No expiry — set far future
          currentPeriodEnd: new Date('2099-01-01'),
          renewalDate: new Date('2099-01-01'),
          cancelAtPeriodEnd: false,
          'workspaceSlots.included': 1000,
          'workspaceSlots.total': 1000,
        },
      },
      { upsert: true, new: true }
    );

    console.log(`[OK] ${email} → Enterprise (userId=${user._id}, subId=${sub._id})`);
  }

  console.log('\nDone.');
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
