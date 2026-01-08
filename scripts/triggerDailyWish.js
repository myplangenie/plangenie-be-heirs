/**
 * Script to manually trigger the daily wish job for testing
 *
 * Usage:
 *   node scripts/triggerDailyWish.js
 *
 * Requirements:
 *   - MONGODB_URI environment variable
 *   - OPENAI_API_KEY environment variable
 *   - RESEND_API_KEY environment variable
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { runJob, sendWishToUser, generateWishForUser, getTodayDateET } = require('../src/jobs/dailyWish');
const User = require('../src/models/User');
const { Resend } = require('resend');
const { buildAgentContext } = require('../src/agents/base');

async function main() {
  const args = process.argv.slice(2);
  const testEmail = args.find(a => a.startsWith('--email='))?.split('=')[1];
  const dryRun = args.includes('--dry-run');
  const generateOnly = args.includes('--generate-only');

  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('Error: MONGODB_URI or MONGO_URI not set');
    process.exit(1);
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(mongoUri);
  console.log('Connected.\n');

  try {
    if (testEmail) {
      // Test for a specific user by email
      console.log(`Testing daily wish for: ${testEmail}`);
      const user = await User.findOne({ email: testEmail }).lean();

      if (!user) {
        console.error(`User not found: ${testEmail}`);
        process.exit(1);
      }

      if (generateOnly) {
        // Just generate and show the wish without sending
        const Workspace = require('../src/models/Workspace');
        const workspace = await Workspace.findOne({ user: user._id, defaultWorkspace: true }).lean();

        if (!workspace) {
          console.error('No default workspace found for user');
          process.exit(1);
        }

        const context = await buildAgentContext(user._id, workspace._id);
        console.log('\nBusiness context:');
        console.log(`  Business: ${context.businessName || '(not set)'}`);
        console.log(`  Industry: ${context.industry || '(not set)'}`);
        console.log(`  Stage: ${context.businessStage || '(not set)'}`);
        console.log(`  UBP: ${context.ubp?.slice(0, 100) || '(not set)'}...`);
        console.log(`  Projects: ${context.coreProjectDetails?.length || 0}`);

        console.log('\nGenerating wish...');
        const wish = await generateWishForUser(context);
        console.log('\nGenerated wish:');
        console.log(`  Category: ${wish.category}`);
        console.log(`  Title: ${wish.title}`);
        console.log(`  Message: ${wish.message}`);
        console.log(`\nDate (ET): ${getTodayDateET()}`);
      } else if (dryRun) {
        console.log('[DRY RUN] Would send to:', user.email);
        console.log('Use --generate-only to see the generated content');
      } else {
        if (!process.env.RESEND_API_KEY) {
          console.error('Error: RESEND_API_KEY not set');
          process.exit(1);
        }
        if (!process.env.OPENAI_API_KEY) {
          console.error('Error: OPENAI_API_KEY not set');
          process.exit(1);
        }

        const resend = new Resend(process.env.RESEND_API_KEY);
        const fromAddress = process.env.RESEND_FROM || 'Plan Genie <no-reply@plangenie.com>';
        const dashboardUrl = process.env.DASHBOARD_URL || 'https://app.plangenie.com';

        const result = await sendWishToUser(user, resend, fromAddress, dashboardUrl);
        console.log('Result:', result);
      }
    } else {
      // Run the full job
      if (dryRun) {
        const users = await User.find({
          isVerified: true,
          status: 'active',
          isCollaborator: { $ne: true },
        }).select('email').lean();

        console.log(`[DRY RUN] Would process ${users.length} users`);
        console.log('Sample users:', users.slice(0, 5).map(u => u.email).join(', '));
      } else {
        console.log('Running full daily wish job...\n');
        await runJob();
      }
    }
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB.');
  }
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
