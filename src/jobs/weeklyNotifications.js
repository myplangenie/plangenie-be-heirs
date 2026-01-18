/**
 * Weekly Notifications Job
 * Sends Friday digest emails to users with overdue or upcoming tasks.
 */

const cron = require('node-cron');
const { Resend } = require('resend');
const User = require('../models/User');
const Workspace = require('../models/Workspace');
const Onboarding = require('../models/Onboarding');
const scoringService = require('../services/scoringService');
const { generateWeeklyDigest } = require('../emails/weeklyDigest');

let isRunning = false;

/**
 * Get overdue items for a user
 */
function getOverdueItems(scoredItems) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  return scoredItems.filter((item) => {
    const due = scoringService.parseDate(item.dueWhen);
    return due && due < now;
  });
}

/**
 * Get items due this week (today through end of week)
 */
function getDueThisWeekItems(scoredItems) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  // Get end of current week (Saturday 23:59:59)
  const endOfWeek = new Date(now);
  const daysUntilSaturday = 6 - now.getDay();
  endOfWeek.setDate(now.getDate() + daysUntilSaturday);
  endOfWeek.setHours(23, 59, 59, 999);

  return scoredItems.filter((item) => {
    const due = scoringService.parseDate(item.dueWhen);
    if (!due) return false;

    // Include if due today through end of week (not overdue)
    return due >= now && due <= endOfWeek;
  });
}

/**
 * Check if digest should be sent based on frequency setting
 * @param {string} frequency - 'daily', 'weekly', 'monthly', 'never'
 * @returns {boolean} - true if should send today
 */
function shouldSendDigestByFrequency(frequency) {
  if (!frequency || frequency === 'weekly') return true; // Weekly is default for digest
  if (frequency === 'never') return false;
  if (frequency === 'daily') return true; // If they want daily, send on weekly schedule too

  if (frequency === 'monthly') {
    // Send only on the first Friday of the month
    const now = new Date();
    const dayOfMonth = now.getDate();
    // First Friday is between 1-7
    return dayOfMonth <= 7;
  }

  return true; // Default to sending
}

/**
 * Format due date for display in email
 */
function formatDueDate(dueWhen) {
  if (!dueWhen) return null;
  const date = new Date(dueWhen);
  if (isNaN(date.getTime())) return null;

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = new Date(date);
  due.setHours(0, 0, 0, 0);

  const diffDays = Math.round((due - now) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    const daysAgo = Math.abs(diffDays);
    if (daysAgo === 1) return 'Yesterday';
    if (daysAgo <= 7) return `${daysAgo} days ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays <= 7) {
    return date.toLocaleDateString('en-US', { weekday: 'long' });
  }

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Send weekly digest to a single user
 */
async function sendDigestToUser(user, resend, fromAddress, dashboardUrl) {
  try {
    // Get user's default workspace with notification preferences
    const workspace = await Workspace.findOne({ user: user._id, defaultWorkspace: true }).lean();
    if (!workspace) {
      return { sent: false, reason: 'no_workspace' };
    }

    // Check notification frequency preference
    const frequency = workspace.notificationPreferences?.emailFrequency?.digest || 'weekly';
    if (!shouldSendDigestByFrequency(frequency)) {
      return { sent: false, reason: 'frequency_skip' };
    }

    // Check if digest emails are disabled entirely
    const digestEnabled = workspace.notificationPreferences?.email?.weeklyDigest;
    if (digestEnabled === false) {
      return { sent: false, reason: 'disabled' };
    }

    // Get user's onboarding data for their default workspace
    const ob = await Onboarding.findOne({ user: user._id, workspace: workspace._id }).lean();
    const answers = ob?.answers || {};

    // Extract and score items
    const items = scoringService.extractItems(answers);
    const context = { allItems: items };

    const scoredItems = items.map((item) => {
      const { scores, totalScore } = scoringService.calculateScore(item, context);
      return { ...item, scores, totalScore };
    });

    // Get overdue and due this week
    const overdue = getOverdueItems(scoredItems);
    const dueThisWeek = getDueThisWeekItems(scoredItems);

    // Skip if no items to notify about
    if (overdue.length === 0 && dueThisWeek.length === 0) {
      return { sent: false, reason: 'no_items' };
    }

    // Format items for email
    const overdueItems = overdue
      .sort((a, b) => b.totalScore - a.totalScore)
      .map((item) => ({
        title: item.title,
        dueWhen: formatDueDate(item.dueWhen),
        projectTitle: item.projectTitle || null,
      }));

    const dueThisWeekItems = dueThisWeek
      .sort((a, b) => b.totalScore - a.totalScore)
      .map((item) => ({
        title: item.title,
        dueWhen: formatDueDate(item.dueWhen),
        projectTitle: item.projectTitle || null,
      }));

    // Generate email content
    const userName = user.firstName || user.fullName || user.email.split('@')[0];
    const { html, text, subject } = generateWeeklyDigest({
      userName,
      overdueItems,
      dueThisWeek: dueThisWeekItems,
      dashboardUrl,
    });

    // Send email
    const result = await resend.emails.send({
      from: fromAddress,
      to: user.email,
      subject: `📅 ${subject}`,
      html,
      text,
    });

    if (result?.error) {
      console.error(`[weeklyNotifications] Email send error for ${user.email}:`, result.error?.message || result.error);
      return { sent: false, reason: 'send_error', error: result.error?.message };
    }

    // Update last sent timestamp
    await User.findByIdAndUpdate(user._id, {
      'notifications.lastWeeklyDigestSent': new Date(),
    });

    return {
      sent: true,
      overdueCount: overdueItems.length,
      dueThisWeekCount: dueThisWeekItems.length,
    };
  } catch (err) {
    console.error(`[weeklyNotifications] Error processing user ${user._id}:`, err?.message || err);
    return { sent: false, reason: 'error', error: err?.message || String(err) };
  }
}

/**
 * Process a batch of users concurrently
 */
async function processBatch(users, resend, fromAddress, dashboardUrl) {
  const results = await Promise.allSettled(
    users.map((user) => sendDigestToUser(user, resend, fromAddress, dashboardUrl))
  );

  let sent = 0;
  let skipped = 0;
  let errors = 0;

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      const r = result.value;
      if (r.sent) {
        sent++;
        console.log(`[weeklyNotifications] Sent to ${users[index].email}: ${r.overdueCount} overdue, ${r.dueThisWeekCount} due this week`);
      } else if (r.reason === 'no_items' || r.reason === 'no_workspace' || r.reason === 'frequency_skip' || r.reason === 'disabled') {
        skipped++;
      } else {
        errors++;
      }
    } else {
      errors++;
      console.error(`[weeklyNotifications] Failed for ${users[index].email}:`, result.reason);
    }
  });

  return { sent, skipped, errors };
}

/**
 * Main job function: send weekly digests to all eligible users
 * Uses batch processing with concurrency for scalability
 */
async function runJob() {
  if (isRunning) {
    console.log('[weeklyNotifications] Job already running, skipping');
    return;
  }

  // Check if Resend is configured
  if (!process.env.RESEND_API_KEY) {
    console.log('[weeklyNotifications] RESEND_API_KEY not configured, skipping');
    return;
  }

  isRunning = true;
  const startTime = Date.now();
  console.log('[weeklyNotifications] Starting weekly digest job...');

  // Concurrency settings
  const BATCH_SIZE = 10; // Process 10 users in parallel
  const BATCH_DELAY_MS = 200; // 200ms between batches to respect rate limits

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const fromAddress = process.env.RESEND_FROM || 'Plan Genie <no-reply@plangenie.com>';
    const dashboardUrl = process.env.DASHBOARD_URL || 'https://www.plangenie.com/dashboard';

    // Get users with weekly digest enabled (exclude collaborators - they view owner's data)
    const users = await User.find({
      isVerified: true,
      status: 'active',
      isCollaborator: { $ne: true }, // Exclude collaborators
      'notifications.weeklyDigest': { $ne: false }, // Default is true
    })
      .select('_id email firstName fullName notifications')
      .lean();

    console.log(`[weeklyNotifications] Processing ${users.length} users in batches of ${BATCH_SIZE}...`);

    let sentCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    // Process in batches
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      const batch = users.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(users.length / BATCH_SIZE);

      console.log(`[weeklyNotifications] Processing batch ${batchNum}/${totalBatches}...`);

      const { sent, skipped, errors } = await processBatch(batch, resend, fromAddress, dashboardUrl);
      sentCount += sent;
      skipCount += skipped;
      errorCount += errors;

      // Delay between batches to avoid rate limiting
      if (i + BATCH_SIZE < users.length) {
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }

    const duration = Date.now() - startTime;
    console.log(
      `[weeklyNotifications] Job completed in ${duration}ms. Sent: ${sentCount}, Skipped: ${skipCount}, Errors: ${errorCount}`
    );
  } catch (err) {
    console.error('[weeklyNotifications] Job failed:', err?.message || err);
  } finally {
    isRunning = false;
  }
}

/**
 * Initialize the cron job
 * Runs every Friday at 9 AM Eastern Time (Canada)
 * Cron: minute hour dayOfMonth month dayOfWeek
 * 0 14 * * 5 = At 14:00 UTC on Friday = 9 AM EST / 10 AM EDT
 */
function init() {
  cron.schedule('0 14 * * 5', () => {
    runJob().catch((err) => {
      console.error('[weeklyNotifications] Unhandled error:', err);
    });
  });

  console.log('[weeklyNotifications] Job scheduled for Fridays at 9 AM Eastern (14:00 UTC)');
}

module.exports = {
  init,
  runJob,
  sendDigestToUser,
};
