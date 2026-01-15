/**
 * Migration script to initialize workspace slots for existing subscriptions.
 *
 * This script:
 * 1. Sets workspaceSlots.included = 1 for all subscriptions
 * 2. Sets workspaceSlots.purchased = 0
 * 3. Sets workspaceSlots.total = 1
 * 4. For users with multiple workspaces, grandfathers them by setting total = current workspace count
 *
 * Usage:
 *   node scripts/migrate-workspace-slots.js
 *   node scripts/migrate-workspace-slots.js --dry-run  # Preview changes without saving
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/plangenie';
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('Connected.');

  if (DRY_RUN) {
    console.log('\n⚠️  DRY RUN MODE - No changes will be saved.\n');
  }

  const Subscription = require('../src/models/Subscription');
  const Workspace = require('../src/models/Workspace');

  // Get all subscriptions
  const subscriptions = await Subscription.find({});
  console.log(`Found ${subscriptions.length} subscriptions to migrate.\n`);

  let updated = 0;
  let grandfathered = 0;
  let skipped = 0;

  for (const sub of subscriptions) {
    const userId = sub.user;

    // Skip if already has workspaceSlots configured
    if (sub.workspaceSlots?.total && sub.workspaceSlots.total > 0) {
      console.log(`[SKIP] User ${userId}: Already has workspaceSlots configured (${sub.workspaceSlots.total} slots)`);
      skipped++;
      continue;
    }

    // Count user's workspaces
    const workspaceCount = await Workspace.countDocuments({ user: userId });

    // Determine slot allocation
    const included = 1;
    const purchased = Math.max(0, workspaceCount - 1); // Grandfather existing workspaces
    const total = included + purchased;

    if (workspaceCount > 1) {
      console.log(`[GRANDFATHER] User ${userId}: ${workspaceCount} workspaces -> granting ${total} slots (1 included + ${purchased} grandfathered)`);
      grandfathered++;
    } else {
      console.log(`[UPDATE] User ${userId}: Setting to 1 slot (1 workspace)`);
      updated++;
    }

    if (!DRY_RUN) {
      sub.workspaceSlots = { included, purchased, total };
      await sub.save();
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Total subscriptions: ${subscriptions.length}`);
  console.log(`Updated (1 slot): ${updated}`);
  console.log(`Grandfathered (>1 slots): ${grandfathered}`);
  console.log(`Skipped (already configured): ${skipped}`);

  if (DRY_RUN) {
    console.log('\n⚠️  DRY RUN - No changes were saved. Run without --dry-run to apply.');
  } else {
    console.log('\n✅ Migration complete.');
  }

  await mongoose.disconnect();
  console.log('Disconnected from MongoDB.');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
