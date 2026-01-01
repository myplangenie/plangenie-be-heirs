/**
 * Background Job: Recalculate Priorities
 * Runs hourly to update priority scores and risk analysis for all active users.
 */

const cron = require('node-cron');
const User = require('../models/User');
const Workspace = require('../models/Workspace');
const Onboarding = require('../models/Onboarding');
const PriorityCache = require('../models/PriorityCache');
const scoringService = require('../services/scoringService');
const riskService = require('../services/riskService');

let isRunning = false;

/**
 * Recalculate priorities for a specific user and workspace
 */
async function recalculateForUserWorkspace(userId, workspaceId) {
  try {
    // Get onboarding data
    const ob = await Onboarding.findOne({ user: userId }).lean();
    const answers = ob?.answers || {};

    // Extract and score all items
    const items = scoringService.extractItems(answers);
    const context = { allItems: items };

    const scoredItems = items.map((item) => {
      const { scores, totalScore } = scoringService.calculateScore(item, context);
      return { ...item, scores, totalScore };
    });

    // Get priorities
    const weeklyTop3 = scoringService.getWeeklyTop3(scoredItems);
    const monthlyThrust = scoringService.getMonthlyThrust(scoredItems);

    // Detect risks
    const { risks, clusters } = riskService.analyzeRisks(answers, scoredItems);

    // Update or create cache
    await PriorityCache.findOneAndUpdate(
      { user: userId, workspace: workspaceId },
      {
        user: userId,
        workspace: workspaceId,
        weeklyTop3,
        monthlyThrust,
        risks,
        clusters,
        calculatedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    return { success: true, itemCount: items.length, riskCount: risks.length };
  } catch (err) {
    console.error(`[recalculatePriorities] Error for user ${userId}, workspace ${workspaceId}:`, err?.message || err);
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Recalculate priorities for a single user (all their workspaces)
 */
async function recalculateForUser(userId) {
  const workspaces = await Workspace.find({ user: userId, status: 'active' }).lean();
  const results = [];

  for (const ws of workspaces) {
    const result = await recalculateForUserWorkspace(userId, ws._id);
    results.push({ workspaceId: ws._id, wid: ws.wid, ...result });
  }

  return results;
}

/**
 * Process a single user's workspaces
 */
async function processUser(userId) {
  const workspaces = await Workspace.find({ user: userId, status: 'active' }).lean();
  let success = 0;
  let errors = 0;

  for (const ws of workspaces) {
    const result = await recalculateForUserWorkspace(userId, ws._id);
    if (result.success) {
      success++;
    } else {
      errors++;
    }
  }

  return { success, errors };
}

/**
 * Process a batch of users concurrently
 */
async function processBatch(users) {
  const results = await Promise.allSettled(
    users.map((user) => processUser(user._id))
  );

  let successCount = 0;
  let errorCount = 0;

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      successCount += result.value.success;
      errorCount += result.value.errors;
    } else {
      errorCount++;
      console.error(`[recalculatePriorities] Error processing user ${users[index]._id}:`, result.reason);
    }
  });

  return { successCount, errorCount };
}

/**
 * Main job function: recalculate for all active users
 * Uses batch processing with concurrency for scalability
 */
async function runJob() {
  if (isRunning) {
    console.log('[recalculatePriorities] Job already running, skipping');
    return;
  }

  isRunning = true;
  const startTime = Date.now();
  console.log('[recalculatePriorities] Starting priority recalculation job...');

  // Concurrency settings
  const BATCH_SIZE = 10; // Process 10 users in parallel

  try {
    // Get users with active subscriptions or recent activity
    const users = await User.find({
      $or: [
        { hasActiveSubscription: true },
        { updatedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }, // Active in last 7 days
      ],
    })
      .select('_id')
      .lean();

    console.log(`[recalculatePriorities] Processing ${users.length} users in batches of ${BATCH_SIZE}...`);

    let successCount = 0;
    let errorCount = 0;

    // Process in batches
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      const batch = users.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(users.length / BATCH_SIZE);

      console.log(`[recalculatePriorities] Processing batch ${batchNum}/${totalBatches}...`);

      const result = await processBatch(batch);
      successCount += result.successCount;
      errorCount += result.errorCount;
    }

    const duration = Date.now() - startTime;
    console.log(`[recalculatePriorities] Job completed in ${duration}ms. Success: ${successCount}, Errors: ${errorCount}`);
  } catch (err) {
    console.error('[recalculatePriorities] Job failed:', err?.message || err);
  } finally {
    isRunning = false;
  }
}

/**
 * Initialize the cron job
 * Runs every hour at minute 0
 */
function init() {
  // Run every hour
  cron.schedule('0 * * * *', () => {
    runJob().catch((err) => {
      console.error('[recalculatePriorities] Unhandled error:', err);
    });
  });

  console.log('[recalculatePriorities] Job scheduled to run hourly');

  // Run once on startup (after a short delay to allow DB connection)
  setTimeout(() => {
    runJob().catch((err) => {
      console.error('[recalculatePriorities] Initial run error:', err);
    });
  }, 10000); // 10 second delay
}

module.exports = {
  init,
  runJob,
  recalculateForUser,
  recalculateForUserWorkspace,
};
