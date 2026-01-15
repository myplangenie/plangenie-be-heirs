/**
 * Migration Script: Move onboardingDetailCompleted from User to Workspace level
 *
 * This script:
 * 1. Finds all users with onboardingDetailCompleted: true
 * 2. For each user, finds their default workspace
 * 3. Creates/updates the Onboarding record with onboardingDetailCompleted: true
 * 4. Removes the user-level onboardingDetailCompleted flag
 *
 * Usage:
 *   node scripts/migrate-onboarding-to-workspace.js
 *
 * Make sure MONGO_URI is set in environment or .env file
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

if (!MONGO_URI) {
  console.error('Error: MONGO_URI environment variable is not set');
  process.exit(1);
}

// Define schemas inline to avoid model conflicts
const UserSchema = new mongoose.Schema({
  email: String,
  onboardingDone: Boolean,
  onboardingDetailCompleted: Boolean,
  defaultWorkspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace' },
}, { strict: false });

const WorkspaceSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  wid: String,
  name: String,
}, { strict: false });

const OnboardingSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace' },
  onboardingDetailCompleted: Boolean,
}, { strict: false });

async function migrate() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('Connected!\n');

  const User = mongoose.model('User', UserSchema);
  const Workspace = mongoose.model('Workspace', WorkspaceSchema);
  const Onboarding = mongoose.model('Onboarding', OnboardingSchema);

  // Find all users with onboardingDetailCompleted: true
  const users = await User.find({ onboardingDetailCompleted: true }).lean();
  console.log(`Found ${users.length} users with onboardingDetailCompleted: true\n`);

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const user of users) {
    try {
      console.log(`Processing user: ${user.email || user._id}`);

      // Find user's workspace(s)
      let workspaceId = user.defaultWorkspace;

      // If no default workspace, find any workspace owned by this user
      if (!workspaceId) {
        const workspace = await Workspace.findOne({ user: user._id }).lean();
        if (workspace) {
          workspaceId = workspace._id;
          console.log(`  Found workspace: ${workspace.name || workspace.wid}`);
        }
      } else {
        console.log(`  Using default workspace: ${workspaceId}`);
      }

      if (!workspaceId) {
        console.log(`  ⚠ No workspace found for user, skipping`);
        skipped++;
        continue;
      }

      // Create or update Onboarding record with onboardingDetailCompleted: true
      const result = await Onboarding.findOneAndUpdate(
        { user: user._id, workspace: workspaceId },
        {
          $set: { onboardingDetailCompleted: true },
          $setOnInsert: { user: user._id, workspace: workspaceId }
        },
        { upsert: true, new: true }
      );

      console.log(`  ✓ Migrated onboardingDetailCompleted to workspace level`);
      migrated++;

    } catch (err) {
      console.error(`  ✗ Error: ${err.message}`);
      errors++;
    }
  }

  console.log('\n--- Migration Summary ---');
  console.log(`Total users processed: ${users.length}`);
  console.log(`Successfully migrated: ${migrated}`);
  console.log(`Skipped (no workspace): ${skipped}`);
  console.log(`Errors: ${errors}`);

  // Now remove the user-level onboardingDetailCompleted field
  console.log('\n--- Removing user-level onboardingDetailCompleted field ---');
  const unsetResult = await User.updateMany(
    {},
    { $unset: { onboardingDetailCompleted: 1 } }
  );
  console.log(`Updated ${unsetResult.modifiedCount} user documents`);

  console.log('\nMigration complete!');
  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
