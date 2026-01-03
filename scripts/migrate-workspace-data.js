/**
 * Migration Script: Assign existing data to user's default workspace
 *
 * This script:
 * 1. Finds all users who have data (Onboarding, Plan, etc.)
 * 2. Ensures each user has a default workspace
 * 3. Updates all their data documents to reference that workspace
 *
 * Run with: node scripts/migrate-workspace-data.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

// Models
const User = require('../src/models/User');
const Workspace = require('../src/models/Workspace');
const Onboarding = require('../src/models/Onboarding');
const Plan = require('../src/models/Plan');
const PlanSection = require('../src/models/PlanSection');
const Dashboard = require('../src/models/Dashboard');
const Notification = require('../src/models/Notification');
const Financials = require('../src/models/Financials');
const TeamMember = require('../src/models/TeamMember');
const Department = require('../src/models/Department');
const AgentCache = require('../src/models/AgentCache');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

function generateWid() {
  return `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function migrateUserData(userId, workspaceId) {
  const filter = { user: userId, workspace: { $exists: false } };
  const update = { $set: { workspace: workspaceId } };

  const results = {
    onboarding: 0,
    plan: 0,
    planSection: 0,
    dashboard: 0,
    notification: 0,
    financials: 0,
    teamMember: 0,
    department: 0,
    agentCache: 0,
  };

  // Update each collection
  let r;

  r = await Onboarding.updateMany(filter, update);
  results.onboarding = r.modifiedCount || 0;

  r = await Plan.updateMany(filter, update);
  results.plan = r.modifiedCount || 0;

  r = await PlanSection.updateMany(filter, update);
  results.planSection = r.modifiedCount || 0;

  r = await Dashboard.updateMany(filter, update);
  results.dashboard = r.modifiedCount || 0;

  r = await Notification.updateMany(filter, update);
  results.notification = r.modifiedCount || 0;

  r = await Financials.updateMany(filter, update);
  results.financials = r.modifiedCount || 0;

  r = await TeamMember.updateMany(filter, update);
  results.teamMember = r.modifiedCount || 0;

  r = await Department.updateMany(filter, update);
  results.department = r.modifiedCount || 0;

  r = await AgentCache.updateMany(filter, update);
  results.agentCache = r.modifiedCount || 0;

  return results;
}

async function main() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('Connected.');

  // Get all users who have onboarding data (indicates they've used the app)
  const usersWithData = await Onboarding.distinct('user');
  console.log(`Found ${usersWithData.length} users with onboarding data.`);

  let totalMigrated = 0;
  let workspacesCreated = 0;

  for (const userId of usersWithData) {
    try {
      // Check if user already has a default workspace
      let workspace = await Workspace.findOne({ user: userId, defaultWorkspace: true });

      if (!workspace) {
        // Get business name from onboarding for workspace name
        const ob = await Onboarding.findOne({ user: userId }).lean();
        const businessName = ob?.businessProfile?.businessName || ob?.answers?.businessName || 'My Business';

        // Create default workspace
        workspace = await Workspace.create({
          user: userId,
          wid: generateWid(),
          name: businessName,
          description: 'Default workspace from onboarding',
          defaultWorkspace: true,
          status: 'active',
        });
        workspacesCreated++;
        console.log(`  Created workspace "${businessName}" for user ${userId}`);
      }

      // Migrate all data to this workspace
      const results = await migrateUserData(userId, workspace._id);
      const totalUpdated = Object.values(results).reduce((a, b) => a + b, 0);

      if (totalUpdated > 0) {
        totalMigrated++;
        console.log(`  Migrated ${totalUpdated} documents for user ${userId}:`, results);
      }
    } catch (err) {
      console.error(`  Error migrating user ${userId}:`, err.message);
    }
  }

  console.log('\n--- Migration Complete ---');
  console.log(`Workspaces created: ${workspacesCreated}`);
  console.log(`Users with migrated data: ${totalMigrated}`);

  await mongoose.disconnect();
  console.log('Disconnected from MongoDB.');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
