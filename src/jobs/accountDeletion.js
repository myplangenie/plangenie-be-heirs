/**
 * Account Deletion Job
 *
 * Finds users whose deletionScheduledFor is due and permanently removes
 * their account and related data.
 */

const cron = require('node-cron');
const mongoose = require('mongoose');
const User = require('../models/User');

// Lazy requires for optional models inside run loop
let Collaboration;

function nowUtc() { return new Date(); }

async function deleteUserAndData(userId) {
  // Use the same model list as admin bulk deletion for completeness
  const modelsToClean = [
    'Onboarding',
    'Notification',
    'NotificationSettings',
    'Subscription',
    'SubscriptionHistory',
    'RefreshToken',
    'Workspace',
    'Journey',
    'Dashboard',
    'Financials',
    'FinancialSnapshot',
    'OrgPosition',
    'Department',
    'AgentCache',
    'PriorityCache',
    'ReviewSession',
    'Decision',
    'Assumption',
    'Scenario',
    'Plan',
    'PlanSection',
    'Product',
    'VisionGoal',
    'Competitor',
    'SwotEntry',
    'OrgPosition',
    'CoreProject',
    'DepartmentProject',
    'RevenueStream',
    'FinancialBaseline',
  ];

  // Delete collaborations where this user is involved
  try {
    if (!Collaboration) Collaboration = require('../models/Collaboration');
    await Collaboration.deleteMany({ $or: [{ owner: userId }, { viewer: userId }, { collaborator: userId }] });
  } catch {}

  // Delete all related data
  for (const modelName of modelsToClean) {
    try {
      const Model = require(`../models/${modelName}`);
      await Model.deleteMany({ user: userId });
    } catch (_) {}
  }

  // Finally remove the user
  await User.deleteOne({ _id: userId });
}

async function runJob() {
  const due = nowUtc();
  // Find users with scheduled deletion due now or earlier
  const users = await User.find({
    deletionScheduledFor: { $ne: null, $lte: due },
  }).select('_id email').lean().exec();

  if (!users.length) {
    console.log('[accountDeletion] No users scheduled for deletion.');
    return { processed: 0, deleted: 0 };
  }

  console.log(`[accountDeletion] Processing ${users.length} user(s) for deletion...`);
  let deleted = 0;
  for (const u of users) {
    try {
      await deleteUserAndData(String(u._id));
      deleted++;
      console.log(`[accountDeletion] Deleted user ${u.email} (${u._id})`);
    } catch (err) {
      console.error(`[accountDeletion] Failed to delete user ${u._id}:`, err?.message || err);
    }
  }
  return { processed: users.length, deleted };
}

// Optional: schedule to run daily at 03:00 server time when imported and schedule() is called
function schedule() {
  cron.schedule('0 3 * * *', async () => {
    try {
      await runJob();
    } catch (err) {
      console.error('[accountDeletion] Scheduled job error:', err?.message || err);
    }
  });
  console.log('[accountDeletion] Scheduled daily at 03:00.');
}

module.exports = { runJob, schedule };

