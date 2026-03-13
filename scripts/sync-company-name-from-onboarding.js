/**
 * Sync User.companyName from Onboarding.businessProfile.businessName
 *
 * Behavior:
 * - For each user, finds the default workspace (if any) and loads the Onboarding document
 *   for that workspace. If none, falls back to any Onboarding for the user with a
 *   non-empty businessProfile.businessName.
 * - If a business name is found and differs from User.companyName (after trim), updates it.
 *
 * Usage:
 *   node scripts/sync-company-name-from-onboarding.js [--dry-run] [--owners-only]
 *
 * Flags:
 *   --dry-run     Preview changes without writing to DB
 *   --owners-only Process only non-collaborator users (isCollaborator != true)
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGO_URI) {
  console.error('Error: MONGO_URI environment variable is not set');
  process.exit(1);
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const OWNERS_ONLY = args.includes('--owners-only');

// Minimal schemas to avoid model conflicts
const UserSchema = new mongoose.Schema({
  email: String,
  companyName: String,
  isCollaborator: Boolean,
  firstName: String,
  lastName: String,
}, { strict: false });

const WorkspaceSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  wid: String,
  name: String,
  defaultWorkspace: Boolean,
}, { strict: false });

const OnboardingSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace' },
  businessProfile: {
    businessName: String,
  },
}, { strict: false, timestamps: true });

async function run() {
  console.log('[sync-company-name] Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('[sync-company-name] Connected');

  const User = mongoose.model('User', UserSchema);
  const Workspace = mongoose.model('Workspace', WorkspaceSchema);
  const Onboarding = mongoose.model('Onboarding', OnboardingSchema);

  const userQuery = OWNERS_ONLY
    ? { $or: [ { isCollaborator: { $exists: false } }, { isCollaborator: { $ne: true } } ] }
    : {};

  let processed = 0;
  let updated = 0;
  let skippedNoBp = 0;
  let skippedSame = 0;
  let errors = 0;

  const cursor = User.find(userQuery).select('_id email companyName isCollaborator').cursor();
  for await (const user of cursor) {
    processed++;
    try {
      const ws = await Workspace.findOne({ user: user._id, defaultWorkspace: true }).select('_id').lean();
      let ob = null;
      if (ws) {
        ob = await Onboarding.findOne({
          user: user._id,
          workspace: ws._id,
          'businessProfile.businessName': { $exists: true, $ne: '' },
        }).sort({ updatedAt: -1 }).lean();
      }
      if (!ob) {
        ob = await Onboarding.findOne({
          user: user._id,
          'businessProfile.businessName': { $exists: true, $ne: '' },
        }).sort({ updatedAt: -1 }).lean();
      }

      const name = (ob && ob.businessProfile && ob.businessProfile.businessName || '').trim();
      if (!name) {
        skippedNoBp++;
        continue;
      }

      const current = (user.companyName || '').trim();
      if (current === name) {
        skippedSame++;
        continue;
      }

      if (DRY_RUN) {
        console.log(`[DRY] ${user.email || user._id}: "${current}" -> "${name}"`);
      } else {
        await User.updateOne({ _id: user._id }, { $set: { companyName: name } });
        console.log(`[SET] ${user.email || user._id}: "${current}" -> "${name}"`);
      }
      updated++;
    } catch (e) {
      errors++;
      console.error(`[ERR] ${user.email || user._id}: ${e?.message || e}`);
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Processed: ${processed}`);
  console.log(`Updated:   ${updated}`);
  console.log(`No BP:     ${skippedNoBp}`);
  console.log(`Same:      ${skippedSame}`);
  console.log(`Errors:    ${errors}`);

  await mongoose.disconnect();
  console.log('[sync-company-name] Done');
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

